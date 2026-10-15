import {canonicalSha256} from '../../bio-core/src/index.ts';
import {assertContext,type ReportContext} from './context.ts';
import {record,requireThat} from './common.ts';
import {exactKeys,readPW5Receipt,type PW5Receipt,type PW5Authority} from './pw5-evidence.ts';
import {member,recordId} from './prisma-flow.ts';
import {renderDraft} from './render.ts';
import {buildRegistry} from './entities.ts';
import type {ChecklistEvidence} from './checklist-evidence.ts';
export const MR_DOMAIN='omb-report/mr-reporting@1';
export interface MRReportingRecords {
 schema:'mr-reporting@1';
 policy:{design:'one-sample'|'two-sample';assumptions:('relevance'|'independence'|'exclusion-restriction')[];additionalAssumptions:('homogeneity'|'monotonicity'|'no-horizontal-pleiotropy'|'gene-environment-equivalence')[];missingData:'complete-case'|'exclude-missing-summary';multiplicity:'holm'|'bonferroni'|'none'};
 executions:{claimId:string;certificateHash:string;estimator:'inverse-variance-weighted'|'wald-ratio'|'two-stage-least-squares';software:{name:'MendelianRandomization'|'TwoSampleMR'|'ivreg';version:string};standardErrors:'delta'|'bootstrap';seed:number;resamples:number}[];
}
export interface MRDocument {paperHash:string;records:MRReportingRecords}
const sealed=new WeakMap<MRDocument,string>();
export function assertMR(ctx:ReportContext,doc:MRDocument):void {assertContext(ctx);requireThat(doc.paperHash===ctx.input.sha256&&sealed.get(doc)===canonicalSha256(doc),'MR reporting changed, foreign or not software-built');}
export function buildMRReporting(ctx:ReportContext,envelope:PW5Receipt<MRReportingRecords>,verify:PW5Authority):MRDocument {
 const r=readPW5Receipt(ctx,envelope,MR_DOMAIN,verify);
 requireThat(canonicalSha256(r)===canonicalSha256(record(ctx.input.runMetadata).mrReporting),'MR reporting differs from PaperInput');
 exactKeys(r,['schema','policy','executions'],'MR reporting fields');requireThat(r.schema==='mr-reporting@1','invalid MR reporting schema');
 const p=r.policy;exactKeys(p,['design','assumptions','additionalAssumptions','missingData','multiplicity'],'MR policy fields');requireThat(canonicalSha256(p)===canonicalSha256(ctx.input.lockedPlan.mrReporting),'MR policy differs from locked plan');
 member(p.design,['one-sample','two-sample'],'MR design');requireThat(Array.isArray(p.assumptions)&&p.assumptions.length===3&&new Set(p.assumptions).size===3&&['relevance','independence','exclusion-restriction'].every(x=>p.assumptions.includes(x as typeof p.assumptions[number])),'MR core assumptions incomplete');
 requireThat(Array.isArray(p.additionalAssumptions)&&new Set(p.additionalAssumptions).size===p.additionalAssumptions.length,'duplicate MR additional assumptions');p.additionalAssumptions.forEach(x=>member(x,['homogeneity','monotonicity','no-horizontal-pleiotropy','gene-environment-equivalence'],'additional MR assumption'));
 member(p.missingData,['complete-case','exclude-missing-summary'],'MR missing data');member(p.multiplicity,['holm','bonferroni','none'],'MR multiplicity');
 requireThat(Array.isArray(r.executions)&&r.executions.length===ctx.claims.length&&new Set(r.executions.map(e=>e.claimId)).size===r.executions.length,'MR execution coverage');
 for(const e of r.executions){
  exactKeys(e,['claimId','certificateHash','estimator','software','standardErrors','seed','resamples'],'MR execution fields');recordId(e.claimId);
  const c=ctx.claims.find(c=>c.id===e.claimId);requireThat(c&&c.certHash===e.certificateHash,'MR selected certificate mismatch');
  requireThat(p.multiplicity!=='none'||c.familySize===1,'MR multiplicity contradicts claim family');
  requireThat(p.multiplicity!=='bonferroni'||!c.bundle||typeof c.plan.alpha==='number'&&Math.abs(c.bundle.effectiveAlpha-c.plan.alpha/c.familySize)<1e-12,'MR Bonferroni threshold mismatch');
  member(e.estimator,['inverse-variance-weighted','wald-ratio','two-stage-least-squares'],'MR estimator');member(e.standardErrors,['delta','bootstrap'],'MR uncertainty');
  requireThat(Number.isSafeInteger(e.seed)&&e.seed>=0&&Number.isSafeInteger(e.resamples)&&e.resamples>=0&&(e.standardErrors==='bootstrap'?e.resamples>0:e.resamples===0),'invalid MR randomization settings');
  exactKeys(e.software,['name','version'],'MR software fields');member(e.software.name,['MendelianRandomization','TwoSampleMR','ivreg'],'MR software');requireThat(/^\d+\.\d+(?:\.\d+)?$/u.test(e.software.version),'invalid MR software version');
  const packages=record(ctx.input.environmentLock).packages;requireThat(Array.isArray(packages)&&packages.some(x=>record(x).name===e.software.name&&record(x).version===e.software.version),'MR software absent from environment');
  const cert=ctx.input.certifications.find(x=>x.id===c.certificationId)!;const executions=record(cert.certificate).mrExecutions;const {certificateHash:_,...execution}=e;
  requireThat(Array.isArray(executions)&&executions.some(x=>canonicalSha256(x)===canonicalSha256({policy:p,execution})),'MR lacks matching certified execution');
 }
 const doc={paperHash:ctx.input.sha256,records:r};sealed.set(doc,canonicalSha256(doc));return doc;
}
export function mrEvidence(ctx:ReportContext,doc:MRDocument,id:string):ChecklistEvidence|null {
 assertMR(ctx,doc);const r=doc.records,p=r.policy;let text:string;
 switch(id){
  case '1':text=`Mendelian randomization study using a ${p.design.replaceAll('-',' ')} design.`;break;
  case '3':text=`The recorded objectives were ${ctx.claims.map(c=>`to estimate the effect of ${c.plan.exposure} on ${c.plan.outcome}`).join('; ')}. Mendelian randomization targets causal effects only under its instrumental-variable assumptions.`;break;
  case '5':text=`The main analysis assumed instrument relevance, independence from confounders, and exclusion restriction. Additional analysis assumptions recorded in the plan: ${p.additionalAssumptions.length?p.additionalAssumptions.map(x=>x.replaceAll('-',' ')).join(', '):'none'}. These statements do not establish the validity of the assumptions.`;break;
  case '6d':text=p.missingData==='complete-case'?'Missing observations were handled by complete-case analysis for the recorded Mendelian randomization procedures.':'Genetic variants with unavailable summary associations were excluded from the recorded instrumental-variable analyses.';break;
  case '6e':text=`Multiple-testing handling for the instrumental-variable analyses used ${p.multiplicity==='none'?'no multiplicity adjustment':p.multiplicity+' adjustment'}.`;break;
  case '9a':text=`Statistical software and execution settings: ${r.executions.map(e=>`${e.claimId}, ${e.software.name} ${e.software.version}, ${e.estimator.replaceAll('-',' ')}, ${e.standardErrors} standard errors, seed ${e.seed}, ${e.resamples} resamples`).join('; ')}.`;break;
  case '14':if(ctx.claims.some(c=>!c.bundle))return null;text=`Key instrumental-variable findings for the recorded objectives: ${ctx.claims.map(c=>renderDraft(ctx,`[claim:${c.id}].`,'results',buildRegistry([])).text).join(' ')}`;break;
  default:return null;
 }
 const source=`mr:${id}`;return {source,text,verified:true,sha256:canonicalSha256({paperHash:ctx.input.sha256,name:'STROBE-MR',item:id,source,text,records:r})};
}
