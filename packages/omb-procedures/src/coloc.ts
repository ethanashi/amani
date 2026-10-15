import { harmoniseColoc } from "./coloc-harmonise.ts";
import { colocABF, colocMaskedABF, type BetaSE, type ColocPriors, type ColocPosterior, type ColocVerdict } from './coloc-abf.ts';
import { condition, countSignals, dosageLD, ldConsistency, maxAllelicR2, validateLD } from './coloc-ld.ts';
import type { ProcedureAssumption, ProcedureDiagnostic, ProcedureEnvelope } from './types.ts';

export interface ColocVariant extends BetaSE {
  eaf?: number; n?: number;
  id: string; chromosome: string; position: number; effect_allele: string; other_allele: string; maf: number;
}
export interface ColocInput {
  exposure: readonly ColocVariant[];
  outcome: readonly ColocVariant[];
  reference: { ids: readonly string[]; effect_alleles: readonly string[]; effect_allele_frequencies?: readonly number[] } &
    ({ ld: readonly (readonly number[])[]; dosages?: never } | { dosages: readonly (readonly number[])[]; ld?: never });
  window: { chromosome: string; start: number; end: number };
  priors: ColocPriors;
  /** Locked before analysis; no automatic outcome threshold chosen from observed evidence. */
  outcome_p_threshold: number;
  exposure_p_threshold?: number;
  mask_r2?: number;
  max_signals?: number;
  selection_max_r2?: number;
  ld_check?: { min_r2: number; noise_floor: number; alpha: number };
}
export const COLOC_DIAGNOSTIC_POLICY = Object.freeze({signal_p_floor:5e-8,mask_r2:.1,selection_max_r2:.9,
  ld_check:Object.freeze({min_r2:.5,noise_floor:.1,alpha:1e-6})});
const declarations = [
  {id:'coloc.single-signal-per-trait',assumption:'each trait has at most one causal signal in the window',mandatory:true,
    blocks:['coloc.single','coloc.single.pp_h4','coloc.single.verdict']},
  {id:'coloc.ld-reference-match',assumption:'summary z-scores are consistent with reference LD',mandatory:false,
    blocks:['coloc.conditioning']},
  {id:'coloc.mask-separates-signals',assumption:'the masking threshold preserves each target signal while removing other signals',mandatory:true,
    blocks:['coloc.masking']},
  {id:'coloc.methods-agree',assumption:'per-signal conditioning and masking agree on verdict category',mandatory:true,
    blocks:['coloc.method_verdicts']},
];
export const COLOC_ASSUMPTIONS: readonly ProcedureAssumption[] = declarations.map(a => {
  const alternatives = a.id === 'coloc.single-signal-per-trait' ? ['coloc.per_signal'] :
    a.id === 'coloc.ld-reference-match' ? ['coloc.masking','coloc.common'] :
    a.id === 'coloc.mask-separates-signals' ? ['coloc.conditioning','coloc.common'] : ['coloc.per_signal'];
  return {...a, diagnostic:a.id, valid_alternatives:alternatives, default_rule:{on_fail:alternatives,on_not_evaluable:'not-estimable'}};
});
export interface SignalPair {
  exposure_lead: string; outcome_lead: string;
  exposure_detected: boolean; outcome_detected: boolean;
  conditioning: ColocPosterior|null; masking: ColocPosterior|null;
  verdict: ColocVerdict;
}
export interface ColocResult extends ProcedureEnvelope {
  procedure: 'coloc.abf-signals@1';
  diagnostics: ProcedureDiagnostic[];
  coloc: {
    single: ColocPosterior;
    per_signal: SignalPair[];
    common: ColocPosterior|null;
    signal_counts: { exposure:number; outcome:number };
    leads: { exposure:string[]; outcome:string[] };
    settings: { exposure_p_threshold:number; outcome_p_threshold:number; mask_r2:number; max_signals:number; selection_max_r2:number; ld_check:{min_r2:number;noise_floor:number;alpha:number} };
    ld_check: ReturnType<typeof ldConsistency>;
    mask_checks: {lead:string;target:string;max_r2:number;observed_r2:number;safe:boolean}[];
  };
}
export function methodVerdict(conditioning: ColocPosterior|null, masking: ColocPosterior|null, maskSafe=true): ColocVerdict {
  if(!conditioning || !masking || !maskSafe)return 'method-sensitive';
  if(conditioning.verdict!==masking.verdict)return conditioning.verdict!=='shared-variant'&&masking.verdict!=='shared-variant'?'inconclusive':'method-sensitive';
  return conditioning.verdict;
}
/** Pure trusted procedure. Harmonises alleles internally; conditioning uses explicit
 * per-variant N or SE/MAF-implied relative information under nested sample overlap. */
export function coloc(input: ColocInput): ColocResult {
  input=harmoniseColoc(input);
  const {exposure:a,outcome:b,reference,window,priors}=input;
  const exposureThreshold=input.exposure_p_threshold??COLOC_DIAGNOSTIC_POLICY.signal_p_floor,outcomeThreshold=input.outcome_p_threshold,
    maskR2=input.mask_r2??COLOC_DIAGNOSTIC_POLICY.mask_r2,maxSignals=input.max_signals??10,selectionMaxR2=input.selection_max_r2??COLOC_DIAGNOSTIC_POLICY.selection_max_r2,
    ldCheck=input.ld_check??COLOC_DIAGNOSTIC_POLICY.ld_check;
  for(const p of [exposureThreshold,outcomeThreshold,maskR2,selectionMaxR2,ldCheck.min_r2,ldCheck.noise_floor,ldCheck.alpha])
    if(!Number.isFinite(p)||p<=0||p>=1)throw new Error('thresholds must be finite in (0,1)');
  if(exposureThreshold<COLOC_DIAGNOSTIC_POLICY.signal_p_floor || outcomeThreshold<COLOC_DIAGNOSTIC_POLICY.signal_p_floor)throw new Error('signal threshold is stricter than registry floor 5e-8');
  if(maskR2!==COLOC_DIAGNOSTIC_POLICY.mask_r2 || selectionMaxR2!==COLOC_DIAGNOSTIC_POLICY.selection_max_r2 || Object.keys(COLOC_DIAGNOSTIC_POLICY.ld_check).some(k=>ldCheck[k as keyof typeof ldCheck]!==COLOC_DIAGNOSTIC_POLICY.ld_check[k as keyof typeof ldCheck]))throw new Error('diagnostic settings are fixed by registry');
  if(!Number.isInteger(maxSignals)||maxSignals<1||maxSignals>100)throw new Error('max_signals must be 1–100');
  if(!Number.isSafeInteger(window.start)||!Number.isSafeInteger(window.end)||window.start<0||window.start>window.end)throw new Error('invalid window');
  if(!a.length||a.length!==b.length||a.length>5000)throw new Error('1–5000 aligned variants required');
  if(new Set(a.map(v=>v.id)).size!==a.length||new Set(reference.ids).size!==reference.ids.length)throw new Error('duplicate variant id');
  if(reference.ids.length!==reference.effect_alleles.length)throw new Error('reference allele dimensions differ');
  for(let i=0;i<a.length;i++) {
    const x=a[i]!,y=b[i]!;
    for(const v of [x,y])if(!v.id||!v.effect_allele||!v.other_allele||v.effect_allele===v.other_allele||!Number.isFinite(v.maf)||v.maf<=0||v.maf>.5||!Number.isSafeInteger(v.position)||v.chromosome!==window.chromosome||v.position<window.start||v.position>window.end)throw new Error('invalid variant/window/MAF');
    if(x.id!==y.id||x.position!==y.position||x.effect_allele!==y.effect_allele||x.other_allele!==y.other_allele)throw new Error('summary tables must be harmonised and aligned');
  }
  const referenceIndex=new Map(reference.ids.map((id,i)=>[id,i]));
  const indices=a.map(v=>{const i=referenceIndex.get(v.id);if(i===undefined||reference.effect_alleles[i]!==v.effect_allele)throw new Error('missing or unaligned reference variant');return i;});
  if(reference.ld && reference.dosages)throw new Error('supply LD or dosages, not both');
  const full=reference.ld??dosageLD(reference.dosages!);
  if(full.length!==reference.ids.length||full.some(row=>row.length!==reference.ids.length))throw new Error('reference dimensions differ');
  const r=indices.map(i=>indices.map(j=>full[i]![j]!));validateLD(r,a.length);
  const single=colocABF(a,b,priors);
  const selectedA=countSignals(a,r,exposureThreshold,maxSignals,selectionMaxR2),selectedB=countSignals(b,r,outcomeThreshold,maxSignals,selectionMaxR2);
  const exhausted=selectedA.exhausted||selectedB.exhausted;
  const multiple=selectedA.leads.length>1||selectedB.leads.length>1;
  // A trait with no selected signal still has one explicitly labelled exploratory comparison.
  // Never call that fallback a detected signal, nor change its threshold.
  const strongest=(s:readonly BetaSE[])=>s.reduce((best,v,i)=>Math.abs(v.beta/v.se)>Math.abs(s[best]!.beta/s[best]!.se)?i:best,0);
  const leadsA=selectedA.leads.length?selectedA.leads:[strongest(a)],leadsB=selectedB.leads.length?selectedB.leads:[strongest(b)];
  const subset=(x: readonly (BetaSE|null)[],y: readonly (BetaSE|null)[],keep:(i:number)=>boolean)=>{
    const ids=a.map((_,i)=>i).filter(i=>keep(i)&&x[i]!==null&&y[i]!==null);
    return ids.length?colocABF(ids.map(i=>x[i]!),ids.map(i=>y[i]!),priors):null;
  };
  const common=subset(a,b,i=>a[i]!.maf>=.05&&b[i]!.maf>=.05);
  const maskChecks:ColocResult['coloc']['mask_checks']=[];
  const perSignal:SignalPair[]=[];
  for(const i of leadsA)for(const j of leadsB) {
    const otherA=selectedA.leads.filter(k=>k!==i),otherB=selectedB.leads.filter(k=>k!==j);
    let safe=true;
    for(const [other,target] of [...otherA.map(k=>[k,i] as const),...otherB.map(k=>[k,j] as const)]) {
      const maxR2=maxAllelicR2(a[other]!.maf,a[target]!.maf),observed=r[other]![target]!**2;
      // A rare/common pair can be erased by an apparently small r² cutoff. Flag the
      // theoretical risk as well as actual removal of either target.
      const rarePair=Math.min(a[other]!.maf,a[target]!.maf)<.05 && Math.max(a[other]!.maf,a[target]!.maf)>=.05;
      const pairSafe=observed<maskR2&&(!rarePair||maskR2>maxR2);
      safe&&=pairSafe;maskChecks.push({lead:a[other]!.id,target:a[target]!.id,max_r2:maxR2,observed_r2:observed,safe:pairSafe});
    }
    const conditioning=subset(condition(a,r,otherA,selectionMaxR2),condition(b,r,otherB,selectionMaxR2),()=>true);
    const masking=colocMaskedABF(a,b,priors,a.map((_,k)=>otherA.some(lead=>r[k]![lead]!**2>maskR2)),b.map((_,k)=>otherB.some(lead=>r[k]![lead]!**2>maskR2)));
    perSignal.push({exposure_lead:a[i]!.id,outcome_lead:a[j]!.id,exposure_detected:selectedA.leads.includes(i),outcome_detected:selectedB.leads.includes(j),
      conditioning,masking,verdict:methodVerdict(conditioning,masking,safe&&!exhausted)});
  }
  const consistency=ldConsistency(a,b,r,ldCheck.min_r2,ldCheck.noise_floor,ldCheck.alpha);
  const diagnostics:ProcedureDiagnostic[]=[];
  const add=(id:string,status:ProcedureDiagnostic['status'],valid_alternatives:string[],detail:string)=>{
    const declaration=COLOC_ASSUMPTIONS.find(v=>v.id===id)!;
    diagnostics.push({id,mandatory:declaration.mandatory!==false,assumption:declaration.assumption,status,blocks:[...declaration.blocks],valid_alternatives,detail});
  };
  add('coloc.single-signal-per-trait',exhausted?'not-evaluable':multiple?'fail':'pass',exhausted?[]:['coloc.per_signal'],
    `signals exposure=${selectedA.leads.length}, outcome=${selectedB.leads.length}; p thresholds=${exposureThreshold},${outcomeThreshold}; marginal-p filter required; selection multiple r2 < ${selectionMaxR2}; excluded collinear=${selectedA.excluded_collinear.length},${selectedB.excluded_collinear.length}; exhausted=${exhausted}`);
  add('coloc.ld-reference-match',consistency.failures.length?'fail':consistency.tests?'pass':'not-evaluable',['coloc.masking','coloc.common'],
    `pairwise standardized z/LD screen: tests=${consistency.tests}, max residual=${consistency.max_residual}, outliers=${consistency.failures.length}; min r2=${ldCheck.min_r2}, variance floor=${ldCheck.noise_floor}, family alpha=${ldCheck.alpha}; suppressed marginally-null conditional candidates=${selectedA.suppressed_null_candidates.length},${selectedB.suppressed_null_candidates.length}. LD mismatch blocks conditioning-based answers.`);
  const maskSafe=maskChecks.every(v=>v.safe);
  add('coloc.mask-separates-signals',maskSafe?'pass':'fail',['coloc.conditioning','coloc.common'],
    `mask r2=${maskR2}; unsafe rare-frequency/lead comparisons=${maskChecks.filter(v=>!v.safe).length}; see mask_checks for attainable and observed r2`);
  add('coloc.methods-agree',perSignal.some(v=>v.verdict==='method-sensitive')?'fail':'pass',['coloc.per_signal'],
    `method-sensitive pairs=${perSignal.filter(v=>v.verdict==='method-sensitive').length}/${perSignal.length}; official verdict is method-sensitive for disagreement or unavailable/unsafe method`);
  return {procedure:'coloc.abf-signals@1',status:exhausted?'refused':'ok',diagnostics,coloc:{single,per_signal:perSignal,common,
    signal_counts:{exposure:selectedA.leads.length,outcome:selectedB.leads.length},leads:{exposure:selectedA.leads.map(i=>a[i]!.id),outcome:selectedB.leads.map(i=>a[i]!.id)},
    settings:{exposure_p_threshold:exposureThreshold,outcome_p_threshold:outcomeThreshold,mask_r2:maskR2,max_signals:maxSignals,selection_max_r2:selectionMaxR2,ld_check:ldCheck},ld_check:consistency,mask_checks:maskChecks}};
}
