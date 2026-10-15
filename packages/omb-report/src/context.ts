import { planAliases } from './boundaries.ts';
import { validatePlan, PLAN_NOUNS } from './prose.ts';
import { canonicalSha256 } from '../../bio-core/src/index.ts';
import { canonicalPaperInput, derive, verifyDerivation, type Derivation, type GradedFact, type PaperInput, type SourceFact } from '../../omb-paper/src/index.ts';
import { finite, record, requireThat, strings } from './common.ts';
import { formatBundle, formatNumber, type BundleNumbers } from './format.ts';
export type Status='confirmed'|'tentative'|'replicated'|'refuted'|'insufficient-evidence'|'non-identifiable'|'exploratory'|'voided';
export type Region='background'|'introduction'|'methods'|'results'|'discussion'|'title'|'abstract'|'key-points'|'plain-summary'|'caption'|'alt'|'limitations'|'abstract-background'|'abstract-methods'|'abstract-results'|'abstract-conclusions'|'conclusion'|'plain-summary-context'|'plain-summary-results';
export interface RequiredCheck {gate:string;passed:boolean;outcome:string}
export interface ClaimView {id:string;status:Status;kind:string;scope:string;rung:number;plan:Record<string,unknown>;certificationId:string;certHash:string;requirements:RequiredCheck[];entities:string[];companions:string[];comparisons:string[];nullValue:number|null;mei:number|null;familySize:number;registered:boolean;reason:string;evidenceType:string;bundle:BundleNumbers|null}
export interface ResolvedFact {key:string;claimId:string|null;display:string;raw:unknown;grade:'kernel'|'exec'|'unverified'|'input';producerGate:string|null;factIds:string[];certHash:string|null;derivation?:Derivation;classification?:'input'|'derived'}
export interface QuoteRecord {key:string;quote:string;status:string;approvedSentenceHashes:readonly string[];numbers:readonly number[];year:number|null}
export interface ReportContext {readonly input:PaperInput;readonly claims:readonly ClaimView[];readonly slots:ReadonlyMap<string,ResolvedFact>;readonly quotes:readonly QuoteRecord[];readonly sources:readonly SourceFact[]}
const contexts=new WeakMap<ReportContext,string>();
function seal(ctx:ReportContext):ReportContext{const hash=canonicalSha256({input:ctx.input,claims:ctx.claims,slots:[...ctx.slots],quotes:ctx.quotes,sources:ctx.sources});contexts.set(ctx,hash);return ctx;}
export function assertContext(ctx:ReportContext):void{requireThat(contexts.get(ctx)===canonicalSha256({input:ctx.input,claims:ctx.claims,slots:[...ctx.slots],quotes:ctx.quotes,sources:ctx.sources}),'report context changed or was not built by software');}
export const EXEC_FOOTNOTE='computed by AI-written code, re-run by software, not recomputed by the kernel';
export function displayFact(f:ResolvedFact):string{requireThat(f.grade!=='unverified'&&f.producerGate!==null,'unverified fact or missing producer gate');return f.display+(f.grade==='exec'?'†':'');}
function num(f:GradedFact|undefined):number|null{return f&&f.source==='kernel'&&f.grade==='kernel-recomputed'&&f.producerGate&&finite(f.value)?f.value:null;}
/** Trusted host boundary: pass the frozen PW0 buildPaperInput result, never model JSON.
 * Its digest is checked again, then copied, and all public context mutations are detected. */
export function createReportContext(source:PaperInput):ReportContext{
 canonicalPaperInput(source);const input=structuredClone(source);const claims:ClaimView[]=[];const slots=new Map<string,ResolvedFact>();
 const sources=structuredClone(input.factExtensions.sources);
 const compute=(formula:string,inputs:SourceFact[])=>{for(const source of inputs){const prior=sources.find(s=>s.id===source.id);requireThat(!prior||canonicalSha256(prior.value)===canonicalSha256(source.value),'derivation source collision');if(!prior)sources.push(source);}return derive(formula,inputs);};
 requireThat(input.plannedFound.missingClaimIds.length===0,'missing claim in paper set');
 const rawClaims=Array.isArray(input.lockedPlan.claims)?input.lockedPlan.claims.map(record):[];
 const fact=(key:string,display:string,raw:unknown,claim:ClaimView,inputs:GradedFact[],derivation?:Derivation):void=>{
  requireThat(inputs.length>0&&inputs.every(f=>f.claimId===claim.id&&f.certificationId===claim.certificationId&&f.certHash===claim.certHash&&f.source==='kernel'&&f.grade==='kernel-recomputed'&&f.producerGate),'missing producer gate or cross-claim derived fact');
  slots.set(`m:${key}`,{key,claimId:claim.id,display,raw,grade:'kernel',producerGate:'certifier-seal',factIds:inputs.map(f=>f.id),certHash:claim.certHash,...derivation?{derivation}:{}});
 };
 for(const found of input.plannedFound.found){
  const certificate=input.certifications.find(c=>c.id===found.certificationId);requireThat(certificate,'missing claim certification');
  const certHash=canonicalSha256(certificate.certificate);
  for(const f of certificate.metricGrades)requireThat(f.certHash===certHash&&f.certificationId===certificate.id&&(f.claimId===null||f.key===f.claimId||f.key.startsWith(f.claimId+'.')),'graded fact provenance mismatch');
  const rawPlan=rawClaims.find(c=>String(c.id).toLowerCase()===found.claimId)??{};const plan={...record(rawPlan.knobs),...rawPlan};
  validatePlan(plan,[...PLAN_NOUNS,...input.variables.filter(v=>v.claimId===found.claimId).map(v=>v.name),...input.entities.filter(e=>e.claimIds.includes(found.claimId)).map(e=>e.canonicalForm)]);
  const assessment=record(found.assessment),label=record(assessment.label),decision=record(assessment.decision);
  const status=found.classification==='voided'?'voided':found.classification==='exploratory'?'exploratory':found.status;
  requireThat(['confirmed','tentative','replicated','refuted','insufficient-evidence','non-identifiable','exploratory','voided'].includes(status),'unknown referee status');
  requireThat(label.status===found.status,'label differs from referee assessment');
  const requirements=(Array.isArray(label.requirements)?label.requirements:[]).map(r=>{const row=record(r);return {gate:String(row.gate),passed:row.passed===true&&row.outcome==='passed',outcome:String(row.outcome)};});
  if(['confirmed','replicated'].includes(status))requireThat(requirements.length>0&&requirements.every(r=>r.passed),'top label with absent or failed checks');
  const fs=certificate.metricGrades.filter(f=>f.claimId===found.claimId);const get=(suffix:string)=>fs.find(f=>f.key.toLowerCase()===`${found.claimId}.${suffix}`.toLowerCase()&&f.source==='kernel');
  const parameter=(key:string,defaultValue?:number):number|null=>num(get(key))??(finite(plan[key])?plan[key] as number:defaultValue??null);
  const families=Array.isArray(input.lockedPlan.families)?input.lockedPlan.families.map(record):[];
  const family=families.find(f=>f.name===plan.family)??record(record(input.lockedPlan.families)[String(plan.family)]);
  const familySize=finite(family.size)?family.size:Math.max(1,rawClaims.filter(c=>c.family===plan.family).length);
  const nullValue=parameter('nullValue');const mei=parameter('mei');
  const gate=(id:string)=>certificate.certificate.gates.find(g=>g.result.gate===id&&(!g.result.claimId||g.result.claimId===found.claimId))?.result;
  const validation=record(gate('G8')?.evidence);
  const evidenceType=status==='replicated'&&validation.route==='N'?'replicated in independent data':validation.route==='N'&&gate('G8')?.outcome==='passed'?'external validation':validation.split==='random'&&gate('G8')?.outcome==='passed'?'internal validation (random split of one dataset)':'validation not established';
  if(status==='replicated')requireThat(validation.route==='N','replication requires independent-data route N evidence');
  const claim:ClaimView={id:found.claimId,status:status as Status,kind:String(plan.kind??assessment.kind??'unknown'),scope:String(plan.scope??'associational'),rung:finite(label.rung)?label.rung:1,plan,certificationId:certificate.id,certHash,requirements,
   entities:[...input.entities.filter(e=>e.claimIds.includes(found.claimId)).flatMap(e=>[e.id,e.value,e.canonicalForm]),...input.variables.filter(v=>v.claimId===found.claimId).map(v=>v.name),...planAliases(plan)],
   companions:strings(plan.companions),comparisons:strings(plan.comparisons),nullValue,mei,familySize,registered:input.plannedFound.plannedClaimIds.includes(found.claimId)&&!found.lateLock&&status!=='exploratory',reason:String(decision.reason??assessment.reason??'Evidence unavailable'),evidenceType,bundle:null};
  const software=(suffix:string,display:string,raw:unknown)=>{const derivation=finite(raw)?compute('identity',[{id:canonicalSha256([input.sha256,claim.id,suffix,raw]),path:`referee.${claim.id}.${suffix}`,value:raw}]):undefined;slots.set(`m:${claim.id}.${suffix}`,{key:`${claim.id}.${suffix}`,claimId:claim.id,display,raw,grade:'kernel',producerGate:'referee-label',factIds:[canonicalSha256(found.assessment)],certHash,...derivation?{derivation}:{}});};
  software('n_agree',String(requirements.filter(r=>r.passed).length),requirements.filter(r=>r.passed).length);software('n_total',String(requirements.length),requirements.length);
  const estimate=num(get('estimate')),lo=num(get('ci.0')),hi=num(get('ci.1')),n=num(get('n_units'));
  if(estimate!==null&&lo!==null&&hi!==null&&n!==null&&nullValue!==null){
   const p=num(get('p_adjusted'))??(familySize===1?num(get('p')):null);const alpha=num(get('alpha'));
   const level=get('ci.0')?.ciLevel;
   if(alpha!==null&&level!==null&&level!==undefined){
    const b:BundleNumbers={measure:String(plan.estimand??'estimate'),estimate,ci:[lo,hi],ciLevel:level,n,adjustment:strings(plan.adjustment).length?`adjusted for ${strings(plan.adjustment).join(' and ')}`:'unadjusted',nullValue,mei,p,effectiveAlpha:alpha,familySize,looks:Math.max(1,input.looks.length),oneSided:plan.direction==='greater'||plan.direction==='less'};
    const tlo=num(get('two_sided_ci.0')),thi=num(get('two_sided_ci.1'));
    if(tlo!==null&&thi!==null)b.twoSidedCI=[tlo,thi];if(typeof plan.one_sided_justification==='string')b.oneSidedJustification=plan.one_sided_justification;
    // Incomplete one-sided provenance is unavailable, never filled from a one-sided CI.
    if(!b.oneSided||b.twoSidedCI&&b.oneSidedJustification){claim.bundle=b;fact(`${claim.id}.result`,formatBundle(b),b,claim,[get('estimate')!,get('ci.0')!,get('ci.1')!,get('n_units')!,get('alpha')!,...p===null?[]:[get('p_adjusted')??get('p')!]]);}
   }
   const sources:SourceFact[]=[{id:get('ci.0')!.id,path:'lower',value:lo},{id:get('ci.1')!.id,path:'upper',value:hi}];
   const width=compute('upper - lower',sources);fact(`${claim.id}.ci_width`,formatNumber(width.value as number,'effect'),width.value,claim,[get('ci.0')!,get('ci.1')!],width);
   const nullSource={id:canonicalSha256([input.sha256,claim.id,'nullValue',nullValue]),path:'plan.nullValue',value:nullValue};
   const direction=compute('direction(lower, upper, null)',[...sources,nullSource]);fact(`${claim.id}.direction`,String(direction.value),direction.value,claim,[get('ci.0')!,get('ci.1')!],direction);
   if(mei!==null){const mag=compute('magnitude(estimate, null, mei)',[{id:get('estimate')!.id,path:'estimate',value:estimate},nullSource,{id:canonicalSha256([input.sha256,claim.id,'mei',mei]),path:'plan.mei',value:mei}]);fact(`${claim.id}.magnitude`,String(mag.value),mag.value,claim,[get('estimate')!],mag);}
  }
  if(mei!==null)software('mei',formatNumber(mei,'effect'),mei);
  software('family_size',formatNumber(familySize,'count'),familySize);
  for(const key of ['sens_agree','sens_total','power_n']){const f=get(key);if(num(f)!==null){const derivation=compute('identity',[{id:f!.id,path:f!.key,value:num(f)!}]);fact(`${claim.id}.${key}`,formatNumber(num(f)!,'count'),num(f),claim,[f!],derivation);}}
  const alpha=num(get('alpha'));if(alpha!==null){const d=compute('family_size * alpha',[{id:canonicalSha256([input.sha256,claim.id,'familySize',familySize]),path:'plan.family.size',value:familySize},{id:get('alpha')!.id,path:'alpha',value:alpha}]);fact(`${claim.id}.expected_false`,formatNumber(d.value as number,'effect'),d.value,claim,[get('alpha')!],d);}
  for(const other of claim.comparisons){const base=`vs.${other}`;const e=get(`${base}.estimate`),l=get(`${base}.ci.0`),h=get(`${base}.ci.1`);if(num(e)!==null&&num(l)!==null&&num(h)!==null){const d=compute('identity',[{id:e!.id,path:e!.key,value:num(e)!}]);fact(`${claim.id}.${base}`,`difference ${formatNumber(num(e)!,'effect',[0])} (CI ${formatNumber(num(l)!,'ci',[0])} to ${formatNumber(num(h)!,'ci',[0])})`,{estimate:num(e),ci:[num(l),num(h)]},claim,[e!,l!,h!],d);}}
  if(claim.rung>=2)requireThat(Array.isArray(record(input.assumptionLedger).assumptions)&&(record(input.assumptionLedger).assumptions as unknown[]).length>0,'causal labels need assumption ledger');
  claims.push(claim);
 }
 requireThat(new Set(claims.map(c=>c.id)).size===claims.length,'duplicate claim');
 for(const d of input.factExtensions.dataSlots){
  requireThat(input.factExtensions.sources.some(source=>source.id===d.sourceId&&source.value===d.value),'data slot differs from its source');
  if(d.classification==='derived'){requireThat(d.derivation,'missing data derivation');verifyDerivation(d.derivation,input.factExtensions.sources);}else requireThat(d.classification==='input'&&d.derivation===null,'invalid data classification');
  slots.set(`d:${d.key}`,{key:d.key,claimId:null,display:String(d.value),raw:d.value,grade:'input',producerGate:'stager-manifest',factIds:[d.sourceId],certHash:null,classification:d.classification,...d.derivation?{derivation:d.derivation}:{}});
 }
 for(const e of input.entities)slots.set(`e:${e.id}`,{key:e.id,claimId:null,display:e.canonicalForm,raw:e.canonicalForm,grade:'input',producerGate:'entity-record',factIds:[e.id],certHash:null});
 const quotes:QuoteRecord[]=(Array.isArray(record(input.frozenLiteratureIndex).entries)?record(input.frozenLiteratureIndex).entries as unknown[]:[]).map(record).map(q=>({key:String(q.key),quote:String(q.quote??''),status:String(q.status),approvedSentenceHashes:strings(q.approvedSentenceHashes),numbers:Array.isArray(q.numbers)&&q.numbers.every(finite)?q.numbers:[],year:finite(q.year)?q.year:null}));
 return seal({input,claims,slots,quotes,sources});
}
