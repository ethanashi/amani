import { coloc, COLOC_ASSUMPTIONS, COLOC_DIAGNOSTIC_POLICY, type ColocInput } from '../../omb-procedures/src/coloc.ts';
import { canonicalSha256 } from '../../bio-core/src/index.ts';
import { diagnose, twoGroupWelchPermutation, pairedSignFlip, crossoverHillsArmitage, stratifiedWeightedWelch, stratifiedCr2,
  olsWildBootstrap, binaryRiskDifference, brunnerMunzelPermutation, ratioOfGeometricMeans, decimalsOf, restrictedMle,
  type ProcedureResult, type ProcedureAssumption } from '../../omb-procedures/src/index.ts';
import type { PlanClaim } from '../../omb-gauntlet/src/index.ts';
import { POLICY } from '../../omb-gauntlet/src/policy.ts';
import type { ClaimData } from './producers.ts';

// k2b.3 (K2b-fix1): unique floor units for independent-unit designs, worst-case CR2 strata minimums,
// procedure-scale nulls, one-sided .025 directional level, calibrated-only diagnostics, and
// registry-owned guarantee / contamination text.
export const PROCEDURE_REGISTRY_VERSION = 'omb-procedures@2/k4.1';
/** Bounded-contamination ladder text (omb-procedures BUILD-NOTES "Contamination-bound label
 * wording" and the owner's contamination-bound decision, including its diagnostics clause). */
const CONTAMINATION_BOUND='For the bounded-contamination result, the population core is centered at its mean and contaminating mass lies no farther than 3 core standard deviations from that mean. The tested two-point law uses +L and −2L and is admitted only when its farthest point is within 3 core SDs. This is a population assumption, not inferred from the sample; unbounded or farther contamination is not covered. Validity diagnostics passed (generalized ESD outlier test at 0.01 per claim; ties rule).';
/** Each entry's `ladder` says whether the bounded-contamination ladder ran for that procedure
 * (omb-procedures BUILD-NOTES envelope table); otherwise only its release grid is validated. */
const DEFINITIONS:Record<string,{estimands:readonly string[];id:string;minimum:number;limitation:string;ladder?:true}>={
  'two-group':{ladder:true,id:'two-group.welch-perm@2',estimands:['linear difference','mean difference','additive difference'],minimum:5,limitation:'two-group Welch/permutation envelope requires the admitted arm sizes and imbalance'},
  paired:{ladder:true,id:'paired.signflip-t@2',estimands:['linear difference','mean difference','additive difference'],minimum:6,limitation:'paired envelope requires at least six independent unit contrasts'},
  repeated:{ladder:true,id:'paired.signflip-t@2',estimands:['linear difference','mean difference','additive difference'],minimum:6,limitation:'repeated-measures contrast requires at least six complete independent units and a locked visit contrast'},
  crossover:{ladder:true,id:'crossover.hills-armitage@2',estimands:['linear difference','mean difference','additive difference'],minimum:5,limitation:'crossover envelope requires at least five participants per sequence and imbalance no greater than 1:2'},
  'stratified-weighted':{ladder:true,id:'stratified.weighted-welch@2',estimands:['linear difference','mean difference','additive difference'],minimum:2,limitation:'weighted Welch envelope requires two to four complete strata and at least five observations per arm and stratum'},
  'stratified-cr2':{ladder:true,id:'stratified.cr2-bm-relabel@2',estimands:['linear difference','mean difference','additive difference'],minimum:5,limitation:'CR2/BM envelope requires the admitted stratum count, allocation and variance ratio'},
  regression:{ladder:true,id:'ols.wild-hc2-bm@2',estimands:['linear slope','linear difference','mean difference','additive difference'],minimum:8,limitation:'HC2/Bell–McCaffrey regression envelope is limited to calibrated design degrees of freedom'},
  binary:{id:'binary.exact-rd@1',estimands:['risk difference','binary risk difference'],minimum:5,limitation:'exact binary risk-difference envelope covers arm sizes 5–50 and nulls 0, 0.1 or −0.2'},
  'brunner-munzel':{id:'rank.brunner-munzel-perm@2',estimands:['probability superiority','relative effect','common language effect'],minimum:39,limitation:'Brunner–Munzel is released only on its calibrated 39/41 release grid'},
  ratio:{id:'ratio.log-gm-welch-perm@2',estimands:['geometric mean ratio','ratio of geometric means'],minimum:35,limitation:'geometric-mean ratio is released only on its calibrated 35/35 release grid'},
};
export const VALIDITY_ASSUMPTIONS: readonly ProcedureAssumption[] = [{
  id: 'procedure.data-validity', assumption: 'data pass the registered refusal-only validity checks',
  mandatory: true, blocks: ['estimate', 'p', 'ci'], diagnostic: 'procedure.data-validity',
  valid_alternatives: [], default_rule: { on_fail: [], on_not_evaluable: 'not-estimable' },
}];
export const PROCEDURE_OUTPUT_FIELDS = ['estimate', 'p', 'ci'] as const;
export interface RegisteredProcedure { outputFields: readonly string[]; assumptions: readonly ProcedureAssumption[]; procedureId:string;registryVersion:string;registryHash:string;guarantee:string;
  /** The bounded-contamination statement when that ladder ran for the procedure, else null. */
  contaminationBound:string|null;withinEnvelope:boolean;diagnosticsPassed:boolean;limitation:string|null;design:string;envelope:Readonly<Record<string,number>>;
  /** True when the claim is outside for a structural reason (not the contract floor, repeated claim
   * units, an adjustment or strata the procedure ignores): the procedure's numbers would answer a
   * different question, so it may not even run descriptively. */
  structural:boolean }
export function deriveProcedureSeed(identity:{planHash:string;contractHash:string|null;inputHash:string;codeHash:string},procedureId:string,claimId:string,purpose:string):string {
  return canonicalSha256(['omb/content-seed@1',identity.planHash,identity.contractHash,identity.inputHash,identity.codeHash,procedureId,claimId,purpose]);
}
function lockedDesign(claim:PlanClaim):string|null {const a=claim.knobs.procedureDesign,b=claim.knobs.design;if(a!==undefined&&b!==undefined&&a!==b)return null;const value=a??b;return typeof value==='string'?value:null;}
/** The registered procedure's null scale. A ratio or Brunner–Munzel null of 0 is the plan parser's
 * additive default; those procedures test ratio 1 and P = 1/2. The certifier decides, calibrates,
 * plants and judges materiality on this canonical claim, so the decision engine and the procedure
 * test the same null. Any other null is left as locked; the registry refuses one that is not on the
 * procedure's calibrated null list. */
export function canonicalClaim<C extends PlanClaim>(claim:C):C {
  const design=lockedDesign(claim);
  if(design==='ratio'&&claim.nullValue===0)return {...claim,nullValue:1};
  if(design==='brunner-munzel'&&claim.nullValue===0)return {...claim,nullValue:.5};
  return claim;
}
/** Owner decision (ICH E9): a registered procedure decides, inverts its interval and is calibrated
 * at one-sided .025 at most for a directional claim; the false-direction bound (<= 5%) was
 * calibrated only at that level. The decision engine applies the same cap (POLICY). */
export function decisionAlpha(claim:Pick<PlanClaim,'alpha'|'direction'>):number {
  return claim.direction==='two-sided'?Math.min(claim.alpha,POLICY.alphaMax):Math.min(claim.alpha,POLICY.directionalAlphaMax);
}
/** The locked registered design name, or null when the plan names none (or conflicting ones). */
export function registeredDesign(claim:PlanClaim):string|null {const locked=lockedDesign(claim);return locked&&Object.hasOwn(DEFINITIONS,locked)?locked:null;}
function resolveDesign(claim:PlanClaim,_data:ClaimData):string|null {const locked=lockedDesign(claim);return locked&&Object.hasOwn(DEFINITIONS,locked)?locked:null;}
function contaminationText(design:string,data:ClaimData):string|null {
  if(!DEFINITIONS[design]?.ladder)return null;
  const binaryExposure=design==='regression'&&new Set(data.x).size===2;
  return `${CONTAMINATION_BOUND}${binaryExposure?' Binary exposure additionally requires smaller group m ≥ 9.':''}`;
}
function guaranteeText(design:string,claim:PlanClaim,contamination:string|null):string {
  // The validated bound holds only at the calibrated level: one-sided .025 (directional) or
  // two-sided .05. A claim decided above it carries no bound.
  const level=decisionAlpha(claim),calibrated=claim.direction==='two-sided'?level<=POLICY.alphaMax:level<=POLICY.directionalAlphaMax;
  if(!calibrated)return `no validated bound: decision alpha ${level} exceeds the calibrated ${claim.direction==='two-sided'?'two-sided .05':'one-sided .025'} level`;
  const alpha=claim.direction==='two-sided'?'worst-case Confirmed rate ≤ 6.25%':'false-direction rate ≤ 5%';
  if(contamination===null)return `${alpha} validated only on the registered ${design} release grid. No bounded-contamination ladder was run; no wider population claim is covered.`;
  return `${alpha} validated over the listed calibration generators and designs at the registered ${design} envelope. ${contamination}`;
}
function numbers(data:ClaimData,claim:PlanClaim,design?:string):{a:number[];b:number[];levels:number[]} {
  const observed=[...new Set(data.x)].sort((a,b)=>a-b),levels=design==='repeated'?[
    Number(claim.knobs.controlLevel),Number(claim.knobs.treatedLevel)]:observed;
  if(design==='repeated'&&(!Number.isFinite(levels[0])||!Number.isFinite(levels[1])||levels[0]===levels[1]||levels.some(v=>!observed.includes(v))))throw new Error('locked controlLevel and treatedLevel must select two observed repeated visits');
  if(levels.length!==2)throw new Error('procedure requires exactly two locked exposure levels');
  return {levels,a:data.y.filter((_,i)=>data.x[i]===levels[0]),b:data.y.filter((_,i)=>data.x[i]===levels[1])};
}
function decimals(data:ClaimData,claim:PlanClaim):number {
  if(data.decimalResolution)return decimalsOf(data.decimalResolution);
  const i=data.header.indexOf(claim.outcome??''),tokens=data.rows.map(r=>r[i]??'').filter(Boolean),raw=Math.max(0,...tokens.map(decimalsOf));
  const magnitude=Math.max(1,...tokens.map(v=>Math.abs(Number(v))).filter(Number.isFinite));
  // No resolution was declared. Preserve the serialized precision up to the safe integer
  // scaling limit required by omb-procedures; never pass a value its integer engine cannot hold.
  const safe=Math.max(0,Math.floor(Math.log10(Number.MAX_SAFE_INTEGER/magnitude))-1);
  return Math.min(raw,safe);
}
function direction(claim:PlanClaim):'two-sided'|'greater'|'less' {return claim.direction;}
function weights(claim:PlanClaim):number[]|undefined {const w=claim.knobs.weights;if(!Array.isArray(w)||!w.every(v=>typeof v==='number'&&Number.isFinite(v)&&v>0))return undefined;return w as number[];}
function strataInput(data:ClaimData,levels:number[]){const strata=[...new Set(data.strata)].sort();return strata.map(name=>({a:data.y.filter((_,i)=>data.strata[i]===name&&data.x[i]===levels[0]),b:data.y.filter((_,i)=>data.strata[i]===name&&data.x[i]===levels[1])}));}
function variance(values:number[]):number {if(values.length<2)return NaN;const mean=values.reduce((s,v)=>s+v,0)/values.length;return values.reduce((s,v)=>s+(v-mean)**2,0)/(values.length-1);}
function varianceRatio(a:number[],b:number[]):number {const va=variance(a),vb=variance(b);return Math.min(va,vb)>0?Math.max(va,vb)/Math.min(va,vb):Infinity;}
function testedImbalance(r:number):boolean {return [1,1.5,2,3,4].some(x=>Math.abs(r-x)<1e-9);}
// These are the evaluated simulator design axes; the rank and ratio procedures have no
// monotone release map, so larger unlisted samples are not admitted by extrapolation.
const RELEASE_N=[5,8,10,15,20,30,50],RELEASE_K=[1,1.5,2,3,4];
function onReleaseGrid(a:number,b:number):boolean {const small=Math.min(a,b),ratio=Math.max(a,b)/small;return RELEASE_N.includes(small)&&RELEASE_K.some(k=>Math.abs(ratio-k)<1e-9);}
// The published BM covering-array report has two cells above the two-sided CP limit
// (n=5,k=2, ratio=9 and n=8,k=3, ratio=4); all 41 directional cells pass. Refuse
// those sample-size/allocation pairs for two-sided claims, and do not impose an
// unreported minimum n=10 on directional claims.
const BM_TWO_SIDED_FAILED_PAIRS=new Set(['5:10','8:24']);
function crossoverInput(claim:PlanClaim,data:ClaimData){
  const seq=claim.knobs.sequenceColumn,period=claim.knobs.periodColumn;
  if(typeof seq!=='string'||typeof period!=='string')throw new Error('locked crossover sequenceColumn and periodColumn required');
  const si=data.header.indexOf(seq),pi=data.header.indexOf(period);if(si<0||pi<0)throw new Error('crossover sequence or period column missing');
  const groups=new Map<string,{sequence:string;rows:Map<number,number>}>();
  data.units.forEach((unit,i)=>{const sequence=data.rows[i]?.[si]!,p=Number(data.rows[i]?.[pi]);if(!['AB','BA'].includes(sequence)||![1,2].includes(p))throw new Error('invalid locked crossover sequence/period');const group=groups.get(unit)??{sequence,rows:new Map()};if(group.sequence!==sequence||group.rows.has(p))throw new Error('crossover sequence or period repeated within participant');group.rows.set(p,data.y[i]!);groups.set(unit,group);});
  const ab:number[][]=[],ba:number[][]=[];for(const g of groups.values()){if(g.rows.size!==2)throw new Error('crossover participant lacks two periods');(g.sequence==='AB'?ab:ba).push([g.rows.get(1)!,g.rows.get(2)!]);}
  return {ab:ab as [number,number][],ba:ba as [number,number][]};
}
/** Designs whose procedure resamples whole units with several rows each (unit contrasts). */
const PAIRED_DESIGNS=new Set(['paired','repeated','crossover']);
export const REPEATED_UNITS_LIMITATION='repeated claim units: design requires a clustered or paired procedure';
export const NOT_FLOOR_LIMITATION='claim unit is not the contract floor (the verified independence level); the registered envelopes are calibrated on floor units only';
/** Owner decision (kernel v3, 2026-10-12): only a procedure that implements the declared adjustment
 * (regression/HC2, whose covariates are the adjustment columns) may decide an adjusted claim. */
export const ADJUSTMENT_LIMITATION='declared adjustment not implemented by the registered procedure';
/** Only the stratified procedures use declared strata; every other design would ignore them. */
export const STRATA_LIMITATION='declared strata not implemented by the registered procedure';
/** Designs whose registered procedure takes the claim's adjustment columns as covariates. */
const ADJUSTING_DESIGNS=new Set(['regression']);
/** Designs whose registered procedure is computed within the claim's declared strata. */
const STRATIFIED_DESIGNS=new Set(['stratified-weighted','stratified-cr2']);
/** Pre-execution validity diagnostics are exactly the refusal-only checks K2a calibrated each
 * procedure with, never a generic raw-scale screen: the ties rule would refuse every 0/1 arm, and
 * raw-scale outliers refuse most lognormal ratio data the log-scale procedure accepts. Designs whose
 * diagnostics act on quantities only the procedure forms (period differences, stratum-arm or
 * studentized residual vectors, ranks) are judged by the procedure itself at execution, where a
 * refusal fails G5c. */
function calibratedDiagnostics(design:string,a:readonly number[],b:readonly number[],data:ClaimData):boolean {
  switch(design){
    case 'two-group':return !diagnose([a,b],[a,b]).refused;
    case 'ratio':return a.length>0&&b.length>0&&[...a,...b].every(v=>v>0)&&!diagnose([a.map(Math.log),b.map(Math.log)],[a,b]).refused;
    case 'binary':return a.length>0&&b.length>0&&data.y.every(v=>v===0||v===1);
    default:return true;
  }
}
export function resolveRegisteredProcedure(claim:PlanClaim,data:ClaimData):RegisteredProcedure|null {
  if(!claim.exposure||!claim.outcome||data.x.length!==data.y.length||data.x.length!==data.units.length)return null;
  const design=resolveDesign(claim,data),entry=design?DEFINITIONS[design]:undefined,estimand=claim.estimand?.trim().toLowerCase();
  if(!entry||!entry.estimands.includes(estimand??''))return null;
  let envelope:Record<string,number>={},diagnosticsPassed=false,withinEnvelope=false;
  // Amendment 4 (pseudoreplication): an independent-unit procedure treats every row as an
  // independent unit, so its claim units must be unique after replicate collapse; a paired
  // procedure pairs within the unit. Either way the unit must be the contract floor. Fail closed:
  // a ClaimData without a positive floor attestation is outside every envelope.
  const structural:string[]=[];
  if(data.unitAtFloor!==true)structural.push(NOT_FLOOR_LIMITATION);
  if(!PAIRED_DESIGNS.has(design!)&&new Set(data.units).size!==data.units.length)structural.push(REPEATED_UNITS_LIMITATION);
  // K2b-fix2: a procedure that ignores the declared adjustment set or strata would decide a different
  // estimand than the one the label is conditional on; the claim is outside every such envelope.
  if(claim.adjustment.length&&!ADJUSTING_DESIGNS.has(design!))structural.push(ADJUSTMENT_LIMITATION);
  if(claim.strata.length&&!STRATIFIED_DESIGNS.has(design!))structural.push(STRATA_LIMITATION);
  try{
    const {a,b,levels}=design==='regression'?{a:[],b:[],levels:[...new Set(data.x)]}:numbers(data,claim,design??undefined);
    const imbalance=a.length&&b.length?Math.max(a.length,b.length)/Math.min(a.length,b.length):1,observedVarianceRatio=a.length&&b.length?varianceRatio(a,b):NaN;
    envelope=design==='regression'?{n:data.x.length}:{nA:a.length,nB:b.length,nMin:Math.min(a.length,b.length),imbalance,...(a.length&&b.length?{observedVarianceRatio}:{})};
    diagnosticsPassed=calibratedDiagnostics(design!,a,b,data);
    if(design==='paired'||design==='repeated'){
      const groups=new Map<string,{a:number[];b:number[]}>();data.units.forEach((u,i)=>{if(data.x[i]!==levels[0]&&data.x[i]!==levels[1])return;const g=groups.get(u)??{a:[],b:[]};(data.x[i]===levels[0]?g.a:g.b).push(data.y[i]!);groups.set(u,g);});
      const contrasts=[...groups.values()].filter(g=>g.a.length&&g.b.length).map(g=>g.b.reduce((s,v)=>s+v,0)/g.b.length-g.a.reduce((s,v)=>s+v,0)/g.a.length);
      const complete=[...groups.values()].filter(g=>g.a.length===1&&g.b.length===1).length;
      envelope={nUnits:contrasts.length,completeUnits:complete,...(design==='repeated'?{visits:new Set(data.x).size}: {})};diagnosticsPassed=complete===contrasts.length&&!diagnose([contrasts],[contrasts]).refused;withinEnvelope=contrasts.length>=entry.minimum&&complete===contrasts.length;
    }else if(design==='crossover'){
      const x=crossoverInput(claim,data);envelope={nAB:x.ab.length,nBA:x.ba.length,nMin:Math.min(x.ab.length,x.ba.length)};withinEnvelope=x.ab.length>=entry.minimum&&x.ba.length>=entry.minimum&&Math.max(x.ab.length,x.ba.length)/Math.min(x.ab.length,x.ba.length)<=2;
    }else if(design?.startsWith('stratified')){
      const ss=strataInput(data,levels),stratumImbalances=ss.map(s=>s.a.length&&s.b.length?Math.max(s.a.length,s.b.length)/Math.min(s.a.length,s.b.length):Infinity),stratumVarianceRatio=varianceRatio(ss.flatMap(s=>s.a),ss.flatMap(s=>s.b));
      envelope={strata:ss.length,minArmPerStratum:Math.min(...ss.flatMap(s=>[s.a.length,s.b.length])),maxStratumImbalance:Math.max(...stratumImbalances),observedVarianceRatio:stratumVarianceRatio};
      if(design==='stratified-weighted')withinEnvelope=ss.length>=2&&ss.length<=4&&envelope.minArmPerStratum!>=5&&envelope.maxStratumImbalance!<=4;
      else {
        const signatures=ss.map(s=>`${Math.min(s.a.length,s.b.length)}:${Math.max(s.a.length,s.b.length)}`),sameShape=signatures.every(x=>x===signatures[0]),allocation=signatures[0]??'';
        // The within-stratum variance ratio is not observable (one treated unit per stratum, and
        // stratum offsets mask it in pooled arms), so the worst-case ratio-9 column always applies:
        // >= 5 strata at 2:1 and 6:3, >= 10 at 4:1 and 6:1 (omb-procedures BUILD-NOTES, TABLES.md).
        const minimum=['1:2','3:6'].includes(allocation)?5:['1:4','1:6'].includes(allocation)?10:Infinity;
        const {observedVarianceRatio:_pooled,...observable}=envelope;
        envelope={...observable,allocationRatio:allocation==='1:2'?2:allocation==='1:4'?4:allocation==='1:6'?6:allocation==='3:6'?2:NaN,varianceRatioBand:9,requiredStrata:minimum};
        withinEnvelope=sameShape&&ss.length>=minimum;
      }
    }else if(design==='regression'){
      const roughDf=data.x.length-data.nuisance.length-2,required=claim.direction==='two-sided'?7.8:10.2;
      envelope={n:data.x.length,roughDf,requiredBmDf:required};withinEnvelope=roughDf>=required;
    }else if(design==='binary'){withinEnvelope=envelope.nMin!>=5&&Math.max(a.length,b.length)<=50&&imbalance<=4&&[-.2,0,.1].includes(claim.nullValue);}
    else if(design==='brunner-munzel'){
      const small=Math.min(a.length,b.length),large=Math.max(a.length,b.length),failedTwoSided=claim.direction==='two-sided'&&BM_TWO_SIDED_FAILED_PAIRS.has(`${small}:${large}`);
      // P = 1/2 is the only calibrated Brunner–Munzel null; callers pass the canonical claim.
      withinEnvelope=onReleaseGrid(a.length,b.length)&&!failedTwoSided&&observedVarianceRatio<=9&&claim.nullValue===.5;
    }
    else if(design==='ratio')withinEnvelope=onReleaseGrid(a.length,b.length)&&[1,1.5].includes(claim.nullValue)&&data.y.every(v=>v>0);
    else if(design==='two-group'){
      const minimum=claim.direction!=='two-sided'?5:imbalance<=1?5:imbalance<=1.5?8:imbalance<=2?10:imbalance<=3?15:8;
      withinEnvelope=envelope.nMin!>=minimum&&testedImbalance(imbalance)&&observedVarianceRatio<=9;
    }else withinEnvelope=envelope.nMin!>=entry.minimum&&imbalance<=4;
  }catch{diagnosticsPassed=false;withinEnvelope=false;}
  if(structural.length){withinEnvelope=false;envelope={...envelope,claimRows:data.units.length,distinctClaimUnits:new Set(data.units).size};}
  // Averaged replicate outcomes are passed at their derived grid (K2b-fix1, k1b-round4 finding 22).
  if(data.replicateMeanResolution)envelope={...envelope,replicateMeanDecimals:data.replicateMeanResolution.decimals,replicateMeanExact:data.replicateMeanResolution.exact?1:0};
  const registryHash=canonicalSha256({version:PROCEDURE_REGISTRY_VERSION,design:design!,entry,assumptions:VALIDITY_ASSUMPTIONS});
  const described=`(${Object.entries(envelope).map(([k,v])=>`${k}=${v}`).join(', ')})`;
  const limitation=withinEnvelope&&diagnosticsPassed?null:structural.length?`${structural.join('; ')} ${described}`:!withinEnvelope?`${entry.limitation} ${described}`:`${entry.id} validity diagnostic refused the observed design`;
  const contaminationBound=contaminationText(design!,data),guarantee=guaranteeText(design!,claim,contaminationBound);
  return {outputFields:PROCEDURE_OUTPUT_FIELDS,assumptions:VALIDITY_ASSUMPTIONS,procedureId:entry.id,registryVersion:PROCEDURE_REGISTRY_VERSION,registryHash,guarantee,contaminationBound,withinEnvelope,diagnosticsPassed,limitation,design:design!,envelope,structural:structural.length>0};
}
export function registeredResultWithinEnvelope(procedure:RegisteredProcedure,claim:PlanClaim,data:ClaimData,result:ProcedureResult):boolean {
  if(procedure.design!=='regression')return procedure.withinEnvelope;
  const bmDf=result.components.bmDf,required=claim.direction==='two-sided'?7.8:10.2;
  const levels=[...new Set(data.x)],binary=levels.length===2;
  const binaryGroupMinimum=binary?Math.min(...levels.map(level=>data.x.filter(x=>x===level).length)):Infinity;
  return typeof bmDf==='number'&&Number.isFinite(bmDf)&&bmDf>=required&&(!binary||binaryGroupMinimum>=9);
}
/** Event counts per arm of a two-level 0/1 design (arm a = the lower exposure level). */
export function binaryArms(data:Pick<ClaimData,'x'|'y'>):{levels:[number,number];xa:number;na:number;xb:number;nb:number} {
  const levels=[...new Set(data.x)].sort((u,v)=>u-v);if(levels.length!==2)throw new Error('binary design requires exactly two exposure levels');
  if(!data.y.every(v=>v===0||v===1))throw new Error('binary design requires a 0/1 outcome');
  let xa=0,na=0,xb=0,nb=0;data.x.forEach((x,i)=>{if(x===levels[0]){na++;xa+=data.y[i]!;}else{nb++;xb+=data.y[i]!;}});
  return {levels:[levels[0]!,levels[1]!],xa,na,xb,nb};
}
/** Farrington–Manning / Miettinen–Nurminen restricted MLE of the arm rates under p_b − p_a = rd
 * (omb-procedures restrictedMle, the same constrained estimate the exact score test uses). */
export function binaryRatesAt(data:Pick<ClaimData,'x'|'y'>,rd:number):{levels:[number,number];pa:number;pb:number} {
  if(!(rd>-1&&rd<1))throw new Error('risk difference outside (-1, 1)');
  const {levels,xa,na,xb,nb}=binaryArms(data),[pa,pb]=restrictedMle(xa,na,xb,nb,rd);
  return {levels,pa:Math.min(1,Math.max(0,pa)),pb:Math.min(1,Math.max(0,pb))};
}
/** runRegisteredProcedure with a per-run memo for procedures that depend only on sufficient counts
 * (the exact binary RD depends only on the arm event counts). Twins repeat counts often, and one exact
 * call costs up to seconds, so calibration and planting reuse identical results. Exact: the same
 * inputs give the same output. Other procedures are never memoised. */
export function memoRegisteredProcedure():typeof runRegisteredProcedure {
  const cache=new Map<string,ProcedureResult>();
  return (procedure,claim,data,identity,B)=>{
    if(procedure.procedureId!=='binary.exact-rd@1')return runRegisteredProcedure(procedure,claim,data,identity,B);
    let key:string;try{const {xa,na,xb,nb}=binaryArms(data);key=JSON.stringify([xa,na,xb,nb,claim.nullValue,claim.direction,decisionAlpha(claim)]);}catch{return runRegisteredProcedure(procedure,claim,data,identity,B);}
    const hit=cache.get(key);if(hit)return hit;
    const result=runRegisteredProcedure(procedure,claim,data,identity,B);cache.set(key,result);return result;
  };
}
function executeRegisteredProcedure(procedure:RegisteredProcedure,claim:PlanClaim,data:ClaimData,identity:{planHash:string;contractHash:string;inputHash:string;codeHash:string},B=9_999):ProcedureResult {
  const dataHash=canonicalSha256([data.file,data.header,data.rows,data.units,data.x,data.y,data.strata,data.nuisance]);
  const seed=deriveProcedureSeed({...identity,inputHash:canonicalSha256([identity.inputHash,dataHash])},procedure.procedureId,claim.id,'procedure-randomization'),common={direction:direction(claim),alpha:decisionAlpha(claim),B,seed,decimals:decimals(data,claim),nullValue:claim.nullValue};
  if(procedure.procedureId==='ols.wild-hc2-bm@2'){const d=common.decimals,col=(values:readonly number[])=>({values,decimals:d});return olsWildBootstrap({...common,y:col(data.y),x:col(data.x),covariates:data.nuisance.map(col)});}
  const {a,b,levels}=numbers(data,claim,procedure.design);
  switch(procedure.procedureId){
    case 'two-group.welch-perm@2':return twoGroupWelchPermutation({...common,a,b});
    case 'paired.signflip-t@2':{const groups=new Map<string,{control:number[];treated:number[]}>();data.units.forEach((u,i)=>{if(data.x[i]!==levels[0]&&data.x[i]!==levels[1])return;const g=groups.get(u)??{control:[],treated:[]};(data.x[i]===levels[0]?g.control:g.treated).push(data.y[i]!);groups.set(u,g);});return pairedSignFlip({...common,units:[...groups.values()]});}
    case 'crossover.hills-armitage@2':return crossoverHillsArmitage({...common,...crossoverInput(claim,data)});
    case 'stratified.weighted-welch@2':{const w=weights(claim);return stratifiedWeightedWelch({...common,strata:strataInput(data,levels),...(w?{weights:w}:{})});}
    case 'stratified.cr2-bm-relabel@2':{const w=weights(claim);return stratifiedCr2({...common,strata:strataInput(data,levels),...(w?{weights:w}:{})});}
    case 'binary.exact-rd@1':return binaryRiskDifference({xa:a.filter(v=>v===1).length,na:a.length,xb:b.filter(v=>v===1).length,nb:b.length,nullValue:claim.nullValue,direction:direction(claim),alpha:decisionAlpha(claim)});
    case 'rank.brunner-munzel-perm@2':return brunnerMunzelPermutation({...common,a,b,nullValue:claim.nullValue===0?.5:claim.nullValue});
    case 'ratio.log-gm-welch-perm@2':return ratioOfGeometricMeans({...common,a,b,nullRatio:claim.nullValue>0?claim.nullValue:1});
    default:throw new Error(`registered executor unavailable for ${procedure.procedureId}`);
  }
}

export const runRegisteredProcedure: typeof executeRegisteredProcedure = (...args) => {
  const result = executeRegisteredProcedure(...args);
  return { ...result, diagnostics: [...(result.diagnostics ?? []), {
    id:VALIDITY_ASSUMPTIONS[0]!.id, assumption:VALIDITY_ASSUMPTIONS[0]!.assumption, blocks:[...VALIDITY_ASSUMPTIONS[0]!.blocks], status: result.status === 'ok' ? 'pass' : 'fail',
    valid_alternatives: [], detail: result.refusal ?? 'registered validity checks passed',
  }] };
};

/** Bayesian posterior procedures have their own typed inputs; never route through p-value gates. */
export const COLOC_REGISTRATION = {
  procedureId: 'coloc.abf-signals@1', registryVersion: PROCEDURE_REGISTRY_VERSION,
  diagnosticPolicy: COLOC_DIAGNOSTIC_POLICY,
  design: 'coloc', estimand: 'shared causal variant posterior',
  outputFields: ['coloc.single', 'coloc.single.pp_h4', 'coloc.single.verdict', 'coloc.per_signal', 'coloc.conditioning', 'coloc.masking', 'coloc.common', 'coloc.method_verdicts'],
  assumptions: COLOC_ASSUMPTIONS,
  guarantee: 'Exact Wakefield ABF arithmetic under the declared priors and single-causal model; multi-signal summaries use approximate LD conditioning and masking. No frequentist error-rate or causal-effect guarantee.',
} as const;
export const COLOC_REGISTRY_HASH = canonicalSha256(COLOC_REGISTRATION);
export function runRegisteredColoc(input: ColocInput) { return coloc(input); }
