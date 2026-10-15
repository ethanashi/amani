import {aiReviewNotice,type AIProseReview} from './ai-review.ts';
import { CHECK_NAMES } from './labels.ts';
import { lexicalKey, normalise, confusableSkeleton } from './normalise.ts';
import { canonicalSha256 } from '../../bio-core/src/index.ts';
import { type ReportContext, assertContext } from './context.ts';
import { type EntityRegistry } from './entities.ts';
import { renderDraft } from './render.ts';
import { record, requireThat, plain } from './common.ts';
export const LIMITATION_TWINS=Object.freeze({
 association:{technical:'Associational: no result here shows that an exposure changes an outcome.',plain:'The findings do not show that changing an exposure changes an outcome.'},
 confounding:{technical:'Unmeasured confounding is not addressed; results depend on the stated adjustment assumptions.',plain:'Factors that were not measured could explain the findings.'},
 system:{technical:'Software checks have limits; see the system methods and full system limitations in the supplement.',plain:'Passing these checks does not establish biological importance or remove uncertainty.'},
 multiplicity:{technical:'The number of hypotheses previously tested on these data is not known.',plain:'Earlier tests on these data may affect how surprising a finding is.'},
 G1:{technical:'Raw-file staging checks did not pass.',plain:'The raw-file checks remain incomplete.'},
 G1a:{technical:'Effective units did not pass their check.',plain:'Some observations may count the same source more than once.'},
 G1b:{technical:'Unit-disjoint data splits did not pass.',plain:'The training and test groups may share sources.'},
 G1c:{technical:'Measured confounding was not ruled out or handled.',plain:'A measured factor may explain the apparent association.'},
 G2:{technical:'The plan was not shown to precede the confirming look.',plain:'The analysis may have been chosen after seeing the data.'},
 G3:{technical:'Software recomputation did not agree with the reported values.',plain:'Recalculation did not establish the reported numbers.'},
 G4:{technical:'The same code did not reproduce the outputs from raw data in a fresh sandbox.',plain:'Running the same code again did not establish the same outputs.'},
 G5a:{technical:'False-alarm calibration did not pass.',plain:'The test may report findings when no effect exists.'},
 'G5b-power':{technical:'Power at the smallest effect of interest did not reach the required threshold.',plain:'The data may miss an effect of the size we care about.'},
 'G5b-recovery':{technical:'Interval coverage did not pass calibration.',plain:'The uncertainty intervals may miss the true value too often.'},
 G5c:{technical:'Registered procedure validity did not pass.',plain:'The procedure has not passed checks for this design.'},
 G6:{technical:'Program-wide multiple-testing control was not established.',plain:'Testing many ideas may produce chance findings.'},
 G7:{technical:'A second AI system, re-analysing from the locked plan, did not obtain the same result.',plain:'Independent re-analysis by another AI system did not agree with the result.'},
 G8:{technical:'A single recorded confirming look was not established.',plain:'The number or timing of looks at the confirming data is uncertain.'},
 G9:{technical:'Required prediction-performance checks did not pass.',plain:'The prediction has not passed the required tests on unseen data.'},
 CIT:{technical:'Reference resolution did not pass.',plain:'The reference has not been checked against its source.'},
});
export interface ProtectedRegion {id:string;text:string;sha256:string}
export function protect(id:string,text:string):ProtectedRegion{return {id,text,sha256:canonicalSha256({id,text})};}
export function verifyProtected(expected:readonly ProtectedRegion[],actual:readonly ProtectedRegion[]):void{
 requireThat(expected.length===actual.length&&new Set(actual.map(r=>r.id)).size===actual.length,'missing or duplicated protected region');
 for(const e of expected){const a=actual.find(a=>a.id===e.id);requireThat(a&&a.text===e.text&&a.sha256===e.sha256&&canonicalSha256({id:a.id,text:a.text})===a.sha256,'protected region modified');}
}
export function limitationsPartA(ctx:ReportContext):ProtectedRegion[]{
 assertContext(ctx);const lines:ProtectedRegion[]=[];const add=(id:string,text:string)=>lines.push(protect(id,text));
 if(ctx.claims.some(c=>c.rung<2))add('association',LIMITATION_TWINS.association.technical);
 if(ctx.claims.some(c=>c.rung>=2)){
  const assumptions=record(ctx.input.assumptionLedger).assumptions;requireThat(Array.isArray(assumptions)&&assumptions.length,'causal labels need assumption ledger');
  for(const [i,value]of assumptions.entries()){const a=record(value);requireThat(typeof a.assumption==='string'&&typeof a.assessed==='string'&&typeof a.result==='string'&&['tested','probed','untestable'].includes(String(a.status)),'incomplete assumption record');add(`assumption-${i}`,`${a.assumption} | ${a.assessed} | ${a.result} | ${a.status}`);}
 }
 add('confounding',LIMITATION_TWINS.confounding.technical);add('system',LIMITATION_TWINS.system.technical);add('multiplicity',LIMITATION_TWINS.multiplicity.technical);
 const failures=new Map<string,string[]>();
 for(const c of ctx.claims)for(const r of c.requirements.filter(r=>!r.passed))failures.set(r.gate,[...failures.get(r.gate)??[],c.id]);
 for(const [gate,ids]of failures){const twin=LIMITATION_TWINS[gate as keyof typeof LIMITATION_TWINS];requireThat(twin,'missing gate plain twin');add(`failure-${gate}`,gateLimitation(ctx,gate,false));}
 for(const c of ctx.claims){const cert=ctx.input.certifications.find(x=>x.id===c.certificationId)!;for(const [suffix,label]of [['plasmode_bias','Measured simulated bias'],['e_value','Sensitivity to unmeasured confounding'],['sample_overlap_bias','Bias associated with sample overlap']] as const){const f=cert.metricGrades.find(f=>f.claimId===c.id&&f.key===`${c.id}.${suffix}`&&f.source==='kernel'&&f.grade==='kernel-recomputed'&&f.producerGate);if(f&&typeof f.value==='number'&&Number.isFinite(f.value))add(`${c.id}-${suffix}`,`${c.id}: ${label}: ${f.value}.`);}}

 return lines;
}
export const LIMITATION_CHECKLISTS=Object.freeze({
 MR:['ancestry','tissue','sample overlap',"winner's curse",'selection and survival','canalisation','pleiotropy'],
 prediction:['spectrum and case-control bias','batch','prevalence shift','calibration transport','array cross-hybridisation'],
 observational:['case definition and diagnostic criteria','control source','cell composition','sampling frame'],
 integrity:['legitimate explanations for re-deposits'],
});
/** Checklist-specific uncertainty; no unsupported direction or claim of mitigation. */
const ITEM_LIMITATIONS:Readonly<Record<string,string>>=Object.freeze({
 ancestry:'Ancestry differences may limit transportability',tissue:'Tissue differences may affect biological interpretation',
 'sample overlap':'Shared samples may affect uncertainty',"winner's curse":'Selection of discovery estimates may distort effect sizes',
 'selection and survival':'Selection and survival processes may influence the sampled population',canalisation:'Developmental compensation may complicate interpretation',pleiotropy:'Alternative biological pathways may violate instrument assumptions',
 'spectrum and case-control bias':'Recruitment may change the clinical spectrum',batch:'Processing batches may introduce systematic differences',
 'prevalence shift':'Changes in prevalence may alter predictive performance','calibration transport':'Calibration may not transfer between settings','array cross-hybridisation':'Cross-hybridisation may affect signal specificity',
 'case definition and diagnostic criteria':'Differences in diagnostic criteria may change case classification','control source':'The control source may not represent the intended comparison population','cell composition':'Cell composition may affect the interpretation of biological measurements','sampling frame':'The sampling frame may limit representativeness',
 'legitimate explanations for re-deposits':'Legitimate re-deposition may explain apparent duplication',
});
export interface LimitationEntry {claimId:string;item:string;bias?:string;direction?:'towards the null'|'away from the null'|'either'|'unknown';couldOverturn?:'yes'|'no'|'unknown';settlingData?:string;notApplicable?:string}
export function checklist(kind:string):readonly string[]{return kind==='causal-genetic'?LIMITATION_CHECKLISTS.MR:kind==='out-of-sample'?LIMITATION_CHECKLISTS.prediction:kind==='data-integrity'?LIMITATION_CHECKLISTS.integrity:LIMITATION_CHECKLISTS.observational;}
export function limitationsPartBDocument(ctx:ReportContext,entries:readonly LimitationEntry[],registry:EntityRegistry):{text:string;reviews:AIProseReview[]}{
 assertContext(ctx);requireThat(entries.length,'Limitations Part B must not be empty');
 const expected=ctx.claims.flatMap(c=>checklist(c.kind).map(item=>({claimId:c.id,item})));
 requireThat(entries.length===expected.length&&new Set(entries.map(e=>`${e.claimId}:${e.item}`)).size===expected.length&&expected.every(x=>entries.some(e=>x.claimId===e.claimId&&x.item===e.item)),'missing or extra Part B checklist item');
 const reviews:AIProseReview[]=[];
 const text=expected.map(key=>{const e=entries.find(e=>e.claimId===key.claimId&&e.item===key.item)!;
  requireThat(e.notApplicable===undefined,'not-applicable requires a certified applicability producer');
  const narrative=(value:unknown,choices:readonly string[])=>{
   requireThat(typeof value==='string'&&value.trim().length>0,'missing limitation text');
   const key=lexicalKey(normalise(value).replace(/[.!?]+$/u,'')),choice=choices.find(c=>lexicalKey(c)===key);
   // Existing software-owned choices remain conveniences, not a free-text whitelist.
   if(choice)return plain(choice);
   const rendered=renderDraft(ctx,/[.!?]$/u.test(value.trim())?value:value+'.','limitations',registry);
   requireThat(rendered.sentences.length>0&&rendered.sentences.every(s=>s.claimIds.every(id=>id===e.claimId)),'Part B prose belongs to another claim');
   if(rendered.aiReview.flags.length)reviews.push(rendered.aiReview);
   return plain(rendered.sentences.map(s=>s.text).join(' ').replace(/[.!?]+$/u,''));
  };
  requireThat(e.couldOverturn&&['yes','no','unknown'].includes(e.couldOverturn),'invalid closed limitation choice');
  requireThat(e.direction==='unknown','bias direction requires a certified producer');
  const bias=narrative(e.bias,BIAS_TEMPLATES),settle=narrative(e.settlingData,SETTLING_TEMPLATES);
  requireThat(e.couldOverturn!=='no','excluding an overturn requires certified evidence');
  return `- ${plain(e.item)} (${plain(claimName(ctx,e.claimId))}): Potential limitation: ${ITEM_LIMITATIONS[e.item]}. ${bias}. Possible direction: ${e.direction}. Could overturn the conclusion: ${e.couldOverturn}. Settling data: ${settle}.`;
 }).join('\n');
 return {text,reviews};
}
export function limitationsPartB(ctx:ReportContext,entries:readonly LimitationEntry[],registry:EntityRegistry):string{
 const doc=limitationsPartBDocument(ctx,entries,registry);return [doc.text,...doc.reviews.map(r=>plain(aiReviewNotice(r)))].join('\n\n');
}
export function repeatKey(text:string):string{
 const decoded=text.replace(/&#(\d+);/gu,(_,n:string)=>String.fromCodePoint(Number(n))).replace(/&(?:amp|lt|gt|quot|apos);/gu,e=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'"}[e]!));
 return lexicalKey(stripParentheticals(decoded.replace(/<!--[^]*?-->|<[^>]*>/gu,' ').replace(/\[[a-z]+:[^\]]+\]/gu,' ').replace(/[\\*_]/gu,''))).replace(/[^\p{L}\p{N}]+/gu,' ').trim();
}
export function lintAtMostOnce(mainText:string,regions:readonly ProtectedRegion[]):void{
 mainText=repeatKey(mainText);
 for(const text of new Set(regions.map(r=>repeatKey(r.text)))){requireThat(text.length>0,'empty protected sentence');let count=0,pos=0;while((pos=mainText.indexOf(text,pos))!==-1){count++;pos+=text.length;}requireThat(count<=1,'protected sentence repeated in main text');}
}

export function renderProtected(regions:readonly ProtectedRegion[]):string {
 return regions.map(r=>{requireThat(/^[A-Za-z0-9_.-]+$/u.test(r.id),'invalid protected ID');return `<!-- protected:${r.id} sha256=${r.sha256} -->\n${r.text}\n<!-- endprotected:${r.id} -->`;}).join('\n');
}
export function verifyProtectedText(expected:readonly ProtectedRegion[],text:string):void {
 const actual:ProtectedRegion[]=[];
 for(const m of text.matchAll(/<!-- protected:([A-Za-z0-9_.-]+) sha256=([a-f0-9]{64}) -->\n([\s\S]*?)\n<!-- endprotected:\1 -->/gu))actual.push({id:m[1]!,sha256:m[2]!,text:m[3]!});
 verifyProtected(expected,actual);lintAtMostOnce(text,expected);
}

/** Plain counterparts are software-owned and keyed to the selected Part A rows. */
export function limitationsPlainTwins(ctx:ReportContext):ProtectedRegion[]{
 return limitationsPartA(ctx).map((region,index)=>{
  const key=region.id.replace(/^failure-/u,'') as keyof typeof LIMITATION_TWINS;
  const twin=LIMITATION_TWINS[key];
  let text=region.id.startsWith('failure-')?gateLimitation(ctx,key,true):twin?.plain as string|undefined;
  if(region.id.startsWith('assumption-')){
   const assumptions=record(ctx.input.assumptionLedger).assumptions as unknown[];
   const a=record(assumptions[Number(region.id.slice('assumption-'.length))]);
   text=`Causal interpretation assumes ${String(a.assumption)}. This was assessed with ${String(a.assessed)}; the recorded result was ${String(a.result)} (${String(a.status)}).`;
  }
  const measured=[['plasmode_bias','The simulated bias estimate'],['e_value','The sensitivity estimate for unmeasured factors'],['sample_overlap_bias','The estimate of bias from shared samples']] as const;
  for(const [suffix,label] of measured)if(region.id.endsWith('-'+suffix))text=`${label} for ${claimName(ctx,region.id.slice(0,-suffix.length-1))} was ${region.text.slice(region.text.lastIndexOf(': ')+2).replace(/\.$/u,'')}.`;
  requireThat(text,'missing required plain limitation twin');
  return protect(`plain-${index}`,text);
 });
}

export const BIAS_TEMPLATES=Object.freeze(['Sampling may vary','Sampling may vary across sites']);
export const SETTLING_TEMPLATES=Object.freeze(['Additional observations are needed','Broader sampling would clarify representativeness','Recruitment records from each site','Samples with minor allele data are needed','A matched control cohort would settle this','Matched controls would help']);
function claimName(ctx:ReportContext,id:string):string{const c=ctx.claims.find(c=>c.id===id);requireThat(c,'unknown plain claim');return `${String(c.plan.exposure??'the exposure')} and ${String(c.plan.outcome??'the outcome')}`;}
function gateLimitation(ctx:ReportContext,gate:string,plainText:boolean):string{
 const twin=LIMITATION_TWINS[gate as keyof typeof LIMITATION_TWINS];requireThat(twin,'missing gate plain twin');
 const rows=ctx.claims.filter(c=>c.requirements.some(r=>r.gate===gate&&!r.passed)).map(c=>{
  const requirement=c.requirements.find(r=>r.gate===gate&&!r.passed)!;
  const name=CHECK_NAMES[gate];requireThat(name,'unknown gate wording');
  const text=requirement.outcome==='failed'?(plainText?twin.plain:twin.technical):(plainText?`The ${name} check has no completed result; we cannot say whether it agreed.`:`The ${name} check was not completed successfully; its result remains unavailable.`);
  return {name:claimName(ctx,c.id),exposure:String(c.plan.exposure),outcome:String(c.plan.outcome),text};
 });
 // Share an identical explanation without dropping any affected exposure/outcome.
 // Failed and incomplete checks have different text and therefore stay separate.
 const groups=new Map<string,typeof rows>();
 for(const row of rows)groups.set(row.text,[...groups.get(row.text)??[],row]);
 const list=(names:string[])=>names.length<2?names[0]!:names.slice(0,-1).join(', ')+' and '+names.at(-1);
 return [...groups].map(([text,affected])=>{
  const commonOutcome=affected.every(r=>r.outcome===affected[0]!.outcome);
  const scope=affected.length>1&&commonOutcome?`${list(affected.map(r=>r.exposure))} in relation to ${affected[0]!.outcome}`:list(affected.map(r=>r.name));
  return `For ${scope}, ${text[0]!.toLowerCase()+text.slice(1)}`;
 }).join(' ');
}

function stripParentheticals(text:string):string{
 let depth=0,out='';for(const c of text){if(c==='('){depth++;out+=' ';}else if(c===')'){depth=Math.max(0,depth-1);out+=' ';}else if(depth===0)out+=c;}return out;
}

/** Kernel-owned severity: failed validity checks, causal scope, measured/general bias,
 * multiplicity, then system caveats. Stable IDs break ties, never caller ordering. */
export interface RankedLimitation extends ProtectedRegion {severity:number}
export function rankedPlainLimitations(ctx:ReportContext):RankedLimitation[] {
 const full=limitationsPartA(ctx),twins=limitationsPlainTwins(ctx);
 requireThat(full.length===twins.length,'plain twins differ from Limitations Part A');
 const severity=(id:string)=>id.startsWith('failure-')?0:id==='association'||id.startsWith('assumption-')?1:id==='confounding'||/_(?:bias|value)$/u.test(id)?2:id==='multiplicity'?3:4;
 return full.map((row,i)=>({...protect(`plain-summary-${row.id}`,twins[i]!.text),severity:severity(row.id)}))
  .sort((a,b)=>a.severity-b.severity||(a.id<b.id?-1:a.id>b.id?1:0));
}
