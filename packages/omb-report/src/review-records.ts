import {canonicalSha256} from '../../bio-core/src/index.ts';
import {assertContext,type ReportContext} from './context.ts';
import {record,requireThat} from './common.ts';
import {exactKeys,readPW5Receipt,type PW5Receipt,type PW5Authority} from './pw5-evidence.ts';
import {assertPrismaFlow,member,recordId,uniqueIds,type PrismaFlowData} from './prisma-flow.ts';

export const REVIEW_DOMAIN='omb-report/systematic-review@1';
export const OUTCOMES={
 'adverse-events':'adverse events (unfavourable occurrences, without an implied causal relationship)',
 'serious-adverse-events':'serious adverse events (death, life threat, hospitalisation, disability or congenital anomaly)',
 'overall-survival':'overall survival (time to death from any cause)',
 'progression-free-survival':'progression-free survival (time to progression or death)',
 'disease-free-survival':'disease-free survival (time to recurrence or death)',
} as const;
export type ReviewOutcome=keyof typeof OUTCOMES;
export interface ReviewPolicy {
 purpose:'adverse-event-screen'|'trial-level-surrogacy';dataLevel:'aggregate';
 population:'adults'|'children'|'all-ages';condition:'all-conditions'|'cancer';
 intervention:'drug'|'non-drug'|'mixed';comparator:'placebo'|'usual-care'|'active-control'|'any-control';
 outcomes:ReviewOutcome[];design:'randomized-trial';minimumFollowupDays:number;
 grouping:'outcome-and-comparison';outcomeSelection:'all-compatible-results';missingOutcome:'retain-study';
}
export interface ReviewSearch {id:string;source:'pubmed'|'embase'|'central'|'clinicaltrials'|'website'|'organisation'|'citation';date:string;terms:('randomized-trial'|ReviewOutcome)[];operator:'AND'|'OR';language:'all'|'english';from:string|null;to:string|null}
export interface ReviewWorkflow {recordReviewers:number;reportReviewers:number;independent:boolean;automation:'none'|'deterministic-rules';resolution:'consensus'|'third-reviewer';}
export interface ReviewCollection {reviewers:number;independent:boolean;automation:'none'|'structured-import';investigatorContact:'none'|'requested'|'confirmed';missingVariables:'record-missing';}
export interface ReviewStudy {
 id:string;participants:number;population:ReviewPolicy['population'];condition:ReviewPolicy['condition'];intervention:ReviewPolicy['intervention'];comparator:ReviewPolicy['comparator'];followupDays:number;
 harms:{outcome:'adverse-events'|'serious-adverse-events';ascertainment:'active'|'passive'|'patient-report';startDay:number;endDay:number;citationKey:string}[];
}
export interface ReviewAnalysis {
 id:string;claimId:string;outcome:ReviewOutcome;studyIds:string[];certificateHash:string;
 role:'primary'|'sensitivity'|'heterogeneity';model:'fixed-effect'|'random-effects-reml'|'weighted-linear-regression';
 rationale:'common-effect'|'between-study-variation'|'trial-treatment-association';
 weighting:'inverse-variance'|'sample-size';preparation:'reported-estimates'|'log-transform';
 missingSummary:'exclude-unavailable';zeroEvents:'not-applicable'|'none-observed'|'continuity-half'|'exclude-double-zero';
 software:{name:'metafor'|'meta'|'stats';version:string};citationKey:string;
 heterogeneity:'Q-and-I-squared'|'residual-variance';sensitivity:'none'|'leave-one-out';subgroups:'none'|'intervention';
 display:'tables'|'forest-plot';
 surrogacy:null|{unit:'trial';effectMetric:'log-hazard-ratio'|'log-odds-ratio';effectSource:'trial-reported';measurementError:'ignored'|'errors-in-variables';ste:'not-estimated'|'prediction-limit';validation:'none'|'leave-one-trial-out'};
}
export interface ReviewRecords {
 schema:'systematic-review@1';policy:ReviewPolicy;searches:ReviewSearch[];workflow:ReviewWorkflow|null;collection:ReviewCollection|null;studies:ReviewStudy[];analyses:ReviewAnalysis[];
 causality:'not-assessed'|'human-assessment';
}
export interface ReviewDocument {paperHash:string;records:ReviewRecords;flow:PrismaFlowData;sha256:string}
const documents=new WeakMap<ReviewDocument,string>();
export function reviewDate(x:unknown):asserts x is string {
 requireThat(typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/u.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x,'invalid review date');
}
function count(x:unknown,minimum=0):asserts x is number {requireThat(Number.isSafeInteger(x)&&(x as number)>=minimum,'invalid review count');}
export function outcome(x:unknown):asserts x is ReviewOutcome {member(x,Object.keys(OUTCOMES),'review outcome');}
function nonempty<T>(xs:T[]):void {requireThat(Array.isArray(xs)&&xs.length>0&&new Set(xs).size===xs.length,'empty or repeated review values');}
function citation(ctx:ReportContext,key:string):void {recordId(key);requireThat(ctx.quotes.some(q=>q.key===key&&q.status==='fulltext-verified'),'review citation unavailable');}
export function assertReview(ctx:ReportContext,doc:ReviewDocument):void {
 assertContext(ctx);requireThat(doc.paperHash===ctx.input.sha256&&documents.get(doc)===canonicalSha256(doc),'review changed, foreign or not software-built');assertPrismaFlow(ctx,doc.flow);
}
/** Host must attest archived search/extraction logs and selected kernel execution
 * records. Never issue this capability for a drafter's JSON or free-text checklist. */
export function buildReview(ctx:ReportContext,envelope:PW5Receipt<ReviewRecords>,verify:PW5Authority,flow:PrismaFlowData):ReviewDocument {
 assertPrismaFlow(ctx,flow);const r=readPW5Receipt(ctx,envelope,REVIEW_DOMAIN,verify);
 requireThat(canonicalSha256(r)===canonicalSha256(record(ctx.input.runMetadata).systematicReview),'review differs from PaperInput records');
 exactKeys(r,['schema','policy','searches','workflow','collection','studies','analyses','causality'],'review fields');requireThat(r.schema==='systematic-review@1','invalid review schema');
 const p=r.policy;exactKeys(p,['purpose','dataLevel','population','condition','intervention','comparator','outcomes','design','minimumFollowupDays','grouping','outcomeSelection','missingOutcome'],'review policy fields');
 requireThat(canonicalSha256(p)===canonicalSha256(ctx.input.lockedPlan.systematicReview),'review policy differs from locked plan');
 member(p.purpose,['adverse-event-screen','trial-level-surrogacy'],'review purpose');member(p.dataLevel,['aggregate'],'review data level');
 const population=['adults','children','all-ages'] as const,condition=['all-conditions','cancer'] as const,intervention=['drug','non-drug','mixed'] as const,comparator=['placebo','usual-care','active-control','any-control'] as const;
 member(p.population,population,'review population');member(p.condition,condition,'review condition');member(p.intervention,intervention,'review intervention');member(p.comparator,comparator,'review comparator');
 member(p.design,['randomized-trial'],'study design');member(p.grouping,['outcome-and-comparison'],'synthesis grouping');member(p.outcomeSelection,['all-compatible-results'],'outcome selection');member(p.missingOutcome,['retain-study'],'missing outcome policy');count(p.minimumFollowupDays);
 nonempty(p.outcomes);p.outcomes.forEach(outcome);
 requireThat(p.purpose!=='adverse-event-screen'||p.outcomes.every(x=>['adverse-events','serious-adverse-events'].includes(x)),'harms purpose/outcome mismatch');
 requireThat(p.purpose!=='trial-level-surrogacy'||p.outcomes.includes('overall-survival')&&p.outcomes.some(x=>x==='progression-free-survival'||x==='disease-free-survival'),'surrogacy endpoints absent');
 uniqueIds(r.searches);requireThat(r.searches.length>0,'missing review searches');
 for(const s of r.searches){
  exactKeys(s,['id','source','date','terms','operator','language','from','to'],'search fields');member(s.source,['pubmed','embase','central','clinicaltrials','website','organisation','citation'],'search source');reviewDate(s.date);
  nonempty(s.terms);s.terms.forEach(x=>member(x,['randomized-trial',...Object.keys(OUTCOMES)],'search term'));member(s.operator,['AND','OR'],'query operator');member(s.language,['all','english'],'search language');
  if(s.from!==null)reviewDate(s.from);if(s.to!==null)reviewDate(s.to);requireThat(s.from===null||s.to===null||s.from<=s.to,'reversed search limits');requireThat(s.to===null||s.to<=s.date,'search limit after execution');
 }
 for(const rec of flow.trace.records){const s=r.searches.find(s=>s.id===rec.sourceId);requireThat(s,'selection source absent from searches');const route=s.source==='central'||s.source==='clinicaltrials'?'register':['website','organisation','citation'].includes(s.source)?s.source:'database';requireThat(route===rec.route,'search/flow route mismatch');}
 if(r.workflow!==null){const w=r.workflow;exactKeys(w,['recordReviewers','reportReviewers','independent','automation','resolution'],'screening fields');count(w.recordReviewers,1);count(w.reportReviewers,1);requireThat(typeof w.independent==='boolean'&&(!w.independent||w.recordReviewers>=2&&w.reportReviewers>=2),'invalid independent screening');member(w.automation,['none','deterministic-rules'],'screening automation');member(w.resolution,['consensus','third-reviewer'],'screening resolution');requireThat(w.automation!=='none'||flow.databasesAndRegisters.removedBeforeScreening.automation===0,'screening automation contradicts selection ledger');}
 if(r.collection!==null){const c=r.collection;exactKeys(c,['reviewers','independent','automation','investigatorContact','missingVariables'],'collection fields');count(c.reviewers,1);requireThat(typeof c.independent==='boolean'&&(!c.independent||c.reviewers>=2),'invalid independent extraction');member(c.automation,['none','structured-import'],'extraction automation');member(c.investigatorContact,['none','requested','confirmed'],'investigator contact');member(c.missingVariables,['record-missing'],'missing variables');}
 uniqueIds(r.studies);const included=[...new Set([...flow.trace.reports.filter(x=>x.decision==='included'),...flow.trace.previousReports].map(x=>x.studyId))].sort();
 requireThat(canonicalSha256(r.studies.map(x=>x.id).sort())===canonicalSha256(included),'review studies differ from included flow');
 for(const s of r.studies){
  exactKeys(s,['id','participants','population','condition','intervention','comparator','followupDays','harms'],'study fields');count(s.participants,1);count(s.followupDays);member(s.population,population,'study population');member(s.condition,condition,'study condition');member(s.intervention,intervention,'study intervention');member(s.comparator,comparator,'study comparator');
  requireThat(s.followupDays>=p.minimumFollowupDays,'included study followup violates eligibility');
  requireThat((p.population==='all-ages'||p.population===s.population)&&(p.condition==='all-conditions'||p.condition===s.condition)&&(p.intervention==='mixed'||p.intervention===s.intervention)&&(p.comparator==='any-control'||p.comparator===s.comparator),'included study violates eligibility');
  requireThat(Array.isArray(s.harms)&&new Set(s.harms.map(h=>h.outcome)).size===s.harms.length,'duplicate harm definition');
  for(const h of s.harms){exactKeys(h,['outcome','ascertainment','startDay','endDay','citationKey'],'harm fields');member(h.outcome,['adverse-events','serious-adverse-events'],'harm outcome');requireThat(p.outcomes.includes(h.outcome),'unplanned harm');member(h.ascertainment,['active','passive','patient-report'],'harm ascertainment');count(h.startDay);count(h.endDay);requireThat(h.endDay>=h.startDay&&h.endDay<=s.followupDays,'invalid harm period');citation(ctx,h.citationKey);requireThat(flow.trace.reports.some(x=>x.studyId===s.id&&x.decision==='included'&&x.citationKey===h.citationKey),'harm citation belongs to another study');}
 }
 uniqueIds(r.analyses);requireThat(new Set(r.analyses.map(a=>a.claimId)).size===r.analyses.length,'reused analysis claim');
 requireThat(r.analyses.length===0||canonicalSha256(r.analyses.map(a=>a.claimId).sort())===canonicalSha256(ctx.claims.map(c=>c.id).sort()),'review analysis inventory incomplete');
 for(const a of r.analyses){
  exactKeys(a,['id','claimId','outcome','studyIds','certificateHash','role','model','rationale','weighting','preparation','missingSummary','zeroEvents','software','citationKey','heterogeneity','sensitivity','subgroups','display','surrogacy'],'analysis fields');recordId(a.claimId);outcome(a.outcome);requireThat(p.outcomes.includes(a.outcome),'unplanned analysis outcome');nonempty(a.studyIds);requireThat(a.studyIds.every(id=>r.studies.some(s=>s.id===id)),'analysis includes excluded study');
  const c=ctx.claims.find(c=>c.id===a.claimId);requireThat(c&&c.certHash===a.certificateHash,'analysis selected certificate mismatch');
  requireThat(p.purpose==='trial-level-surrogacy'?c.plan.exposure===a.outcome&&c.plan.outcome==='overall-survival'&&c.plan.estimand==='r squared':c.plan.outcome===a.outcome&&['risk ratio','odds ratio','risk difference'].includes(String(c.plan.estimand)),'analysis claim outcome mismatch');
  requireThat(!c.bundle||c.bundle.nullValue===(p.purpose==='trial-level-surrogacy'||c.plan.estimand==='risk difference'?0:1),'analysis null value differs from effect scale');
  requireThat(!c.bundle||c.bundle.n===a.studyIds.length,'analysis trial count differs from certified bundle');
  requireThat(!c.bundle||p.purpose!=='trial-level-surrogacy'||c.bundle.estimate>=0&&c.bundle.estimate<=1&&c.bundle.ci[0]>=0&&c.bundle.ci[1]<=1,'invalid certified R squared');
  const cert=ctx.input.certifications.find(x=>x.id===c.certificationId)!;const executions=record(cert.certificate).systematicReviewExecutions;
  const {certificateHash:_,...execution}=a;
  requireThat(Array.isArray(executions)&&executions.some(e=>canonicalSha256(e)===canonicalSha256(execution)),'analysis lacks matching certified execution');
  member(a.role,['primary','sensitivity','heterogeneity'],'analysis role');member(a.model,['fixed-effect','random-effects-reml','weighted-linear-regression'],'synthesis model');member(a.rationale,['common-effect','between-study-variation','trial-treatment-association'],'model rationale');
  requireThat(({ 'fixed-effect':'common-effect','random-effects-reml':'between-study-variation','weighted-linear-regression':'trial-treatment-association'} as const)[a.model]===a.rationale,'model rationale mismatch');
  member(a.weighting,['inverse-variance','sample-size'],'analysis weights');member(a.preparation,['reported-estimates','log-transform'],'data preparation');member(a.missingSummary,['exclude-unavailable'],'missing summary policy');member(a.zeroEvents,['not-applicable','none-observed','continuity-half','exclude-double-zero'],'zero event policy');
  exactKeys(a.software,['name','version'],'analysis software');member(a.software.name,['metafor','meta','stats'],'analysis software');requireThat(/^\d+\.\d+(?:\.\d+)?$/u.test(a.software.version),'invalid software version');
  const packages=record(ctx.input.environmentLock).packages;requireThat(Array.isArray(packages)&&packages.some(x=>record(x).name===a.software.name&&record(x).version===a.software.version),'analysis software absent from environment lock');citation(ctx,a.citationKey);
  member(a.heterogeneity,['Q-and-I-squared','residual-variance'],'heterogeneity method');member(a.sensitivity,['none','leave-one-out'],'sensitivity method');member(a.subgroups,['none','intervention'],'subgroup method');member(a.display,['tables','forest-plot'],'display method');
  requireThat((p.purpose==='trial-level-surrogacy')===(a.surrogacy!==null),'surrogacy analysis scope');
  if(a.surrogacy!==null){const s=a.surrogacy;exactKeys(s,['unit','effectMetric','effectSource','measurementError','ste','validation'],'surrogacy fields');member(s.unit,['trial'],'surrogacy unit');member(s.effectMetric,['log-hazard-ratio','log-odds-ratio'],'surrogacy effect metric');member(s.effectSource,['trial-reported'],'effect source');member(s.measurementError,['ignored','errors-in-variables'],'measurement error');member(s.ste,['not-estimated','prediction-limit'],'threshold method');member(s.validation,['none','leave-one-trial-out'],'surrogacy validation');requireThat(a.model==='weighted-linear-regression'&&a.heterogeneity==='residual-variance','surrogacy model mismatch');}
  else requireThat(a.model!=='weighted-linear-regression'&&a.heterogeneity==='Q-and-I-squared','meta-analysis model mismatch');
 }
 member(r.causality,['not-assessed','human-assessment'],'causality assessment');
 const doc={paperHash:ctx.input.sha256,records:r,flow,sha256:canonicalSha256(r)};documents.set(doc,canonicalSha256(doc));return doc;
}
