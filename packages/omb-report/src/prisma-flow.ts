import {canonicalSha256} from '../../bio-core/src/index.ts';
import {assertContext,type ReportContext} from './context.ts';
import {record,requireThat} from './common.ts';
import {exactKeys,readPW5Receipt,type PW5Receipt,type PW5Authority} from './pw5-evidence.ts';

export const PRISMA_FLOW_DOMAIN='omb-report/prisma-flow@1';
export const FLOW_SOURCE='https://www.prisma-statement.org/prisma-2020-flow-diagram';
export const EXCLUSION_REASONS=['population','intervention','comparator','outcome','design','duplicate-study','unusable-data'] as const;
export type ExclusionReason=typeof EXCLUSION_REASONS[number];
export type IdentificationRoute='database'|'register'|'website'|'organisation'|'citation';
export interface PrismaSelectionLedger {
 schema:'prisma-selection@1'; reviewType:'new'|'updated';
 records:{id:string;sourceId:string;route:IdentificationRoute;disposition:'duplicate'|'automation-excluded'|'other-removed'|'screen-excluded'|'sought';duplicateOf:string|null;reportId:string|null}[];
 reports:{id:string;studyId:string;citationKey:string;decision:'not-retrieved'|'excluded'|'included';reason:ExclusionReason|null}[];
 previousReports:{id:string;studyId:string}[];
}
export interface PrismaFlowBranch {
 identified:number; bySource:{sourceId:string;route:IdentificationRoute;count:number}[];
 removedBeforeScreening:{duplicates:number;automation:number;other:number};
 screened:number; excludedAtScreening:number; reportsSought:number; reportsNotRetrieved:number; reportsAssessed:number;
 reportsExcluded:number; exclusions:{reason:ExclusionReason;count:number;reportIds:string[]}[];
 includedReports:number; includedStudies:number;
}
/** PW3/PW9 consume this serializable data, not author-entered box totals. Counts
 * report the recorded decisions, not independent verification of screening judgments. */
export interface PrismaFlowData {
 schema:'prisma-2020-flow@1';version:'2020';source:string;paperHash:string;ledgerHash:string;
 variant:'new-databases-registers'|'new-other-sources'|'updated-databases-registers'|'updated-other-sources';
 databasesAndRegisters:PrismaFlowBranch;otherSources:PrismaFlowBranch;
 previous:{reports:number;studies:number}; included:{newReports:number;newStudies:number;totalReports:number;totalStudies:number};
 trace:PrismaSelectionLedger;
}
const flows=new WeakMap<PrismaFlowData,string>();
export function recordId(x:unknown):asserts x is string {requireThat(typeof x==='string'&&/^[a-z][a-z0-9-]{0,63}$/u.test(x),'invalid review record ID');}
export function member<T extends string>(x:unknown,values:readonly T[],label:string):asserts x is T {requireThat(typeof x==='string'&&values.includes(x as T),`invalid ${label}`);}
export function uniqueIds(xs:readonly {id:string}[]):void {requireThat(Array.isArray(xs)&&new Set(xs.map(x=>x.id)).size===xs.length,'duplicate review record ID');for(const x of xs)recordId(x.id);}
export function assertPrismaFlow(ctx:ReportContext,flow:PrismaFlowData):void {
 assertContext(ctx);requireThat(flow.paperHash===ctx.input.sha256&&flows.get(flow)===canonicalSha256(flow),'flow changed, foreign or not software-built');
}
export function buildPrismaFlow(ctx:ReportContext,envelope:PW5Receipt<PrismaSelectionLedger>,verify:PW5Authority):PrismaFlowData {
 const ledger=readPW5Receipt(ctx,envelope,PRISMA_FLOW_DOMAIN,verify);
 requireThat(canonicalSha256(ledger)===canonicalSha256(record(ctx.input.runMetadata).prismaSelection),'flow differs from PaperInput selection record');
 exactKeys(ledger,['schema','reviewType','records','reports','previousReports'],'selection ledger fields');
 requireThat(ledger.schema==='prisma-selection@1','invalid selection schema');member(ledger.reviewType,['new','updated'],'review type');
 uniqueIds(ledger.records);uniqueIds(ledger.reports);uniqueIds(ledger.previousReports);
 requireThat(ledger.reviewType==='updated'||ledger.previousReports.length===0,'new review has previous studies');
 const sources=new Map<string,string>();
 for(const r of ledger.records){
  exactKeys(r,['id','sourceId','route','disposition','duplicateOf','reportId'],'selection record fields');recordId(r.sourceId);
  member(r.route,['database','register','website','organisation','citation'],'identification route');
  requireThat(!sources.has(r.sourceId)||sources.get(r.sourceId)===r.route,'source route conflict');sources.set(r.sourceId,r.route);
  member(r.disposition,['duplicate','automation-excluded','other-removed','screen-excluded','sought'],'record disposition');
  requireThat((r.disposition==='duplicate')===(r.duplicateOf!==null),'duplicate target state');
  if(r.duplicateOf!==null){const target=ledger.records.find(x=>x.id===r.duplicateOf);requireThat(target&&target.id!==r.id&&target.disposition!=='duplicate','invalid duplicate target');}
  requireThat((r.disposition==='sought')===(r.reportId!==null),'report retrieval state');
  if(r.reportId!==null)requireThat(ledger.reports.some(x=>x.id===r.reportId),'missing retrieval report');
  requireThat(['database','register'].includes(r.route)||['sought','duplicate','other-removed'].includes(r.disposition),'other sources bypass title screening');
 }
 for(const r of ledger.reports){
  exactKeys(r,['id','studyId','citationKey','decision','reason'],'report fields');recordId(r.studyId);recordId(r.citationKey);
  requireThat(ctx.quotes.some(q=>q.key===r.citationKey&&(r.decision==='not-retrieved'||q.status==='fulltext-verified')),'report citation absent from frozen index');
  requireThat(ledger.records.filter(x=>x.reportId===r.id).length===1,'orphan or multiply retrieved report');
  member(r.decision,['not-retrieved','excluded','included'],'report decision');
  requireThat((r.decision==='excluded')===(r.reason!==null),'exclusion reason state');
  if(r.reason!==null)member(r.reason,EXCLUSION_REASONS,'exclusion reason');
 }
 for(const r of ledger.previousReports){exactKeys(r,['id','studyId'],'previous report fields');recordId(r.studyId);requireThat(!ledger.reports.some(x=>x.id===r.id),'previous/new report overlap');}
 const db=(route:IdentificationRoute)=>route==='database'||route==='register';
 const branch=(database:boolean):PrismaFlowBranch=>{
  const rows=ledger.records.filter(r=>db(r.route)===database),reports=ledger.reports.filter(r=>rows.some(x=>x.reportId===r.id));
  const count=(state:string)=>rows.filter(r=>r.disposition===state).length,rc=(state:string)=>reports.filter(r=>r.decision===state).length;
  const included=reports.filter(r=>r.decision==='included');
  return {identified:rows.length,bySource:[...new Set(rows.map(r=>r.sourceId))].sort().map(sourceId=>({sourceId,route:rows.find(r=>r.sourceId===sourceId)!.route,count:rows.filter(r=>r.sourceId===sourceId).length})),
   removedBeforeScreening:{duplicates:count('duplicate'),automation:count('automation-excluded'),other:count('other-removed')},
   screened:database?count('screen-excluded')+count('sought'):0,excludedAtScreening:count('screen-excluded'),reportsSought:reports.length,reportsNotRetrieved:rc('not-retrieved'),reportsAssessed:rc('included')+rc('excluded'),reportsExcluded:rc('excluded'),
   exclusions:EXCLUSION_REASONS.flatMap(reason=>{const reportIds=reports.filter(r=>r.reason===reason).map(r=>r.id).sort();return reportIds.length?[{reason,count:reportIds.length,reportIds}]:[];}),includedReports:included.length,includedStudies:new Set(included.map(r=>r.studyId)).size};
 };
 const included=ledger.reports.filter(r=>r.decision==='included');const previous=ledger.previousReports;
 const data:PrismaFlowData={schema:'prisma-2020-flow@1',version:'2020',source:FLOW_SOURCE,paperHash:ctx.input.sha256,ledgerHash:canonicalSha256(ledger),
  variant:`${ledger.reviewType}-${ledger.records.some(r=>!db(r.route))?'other-sources':'databases-registers'}`,
  databasesAndRegisters:branch(true),otherSources:branch(false),previous:{reports:previous.length,studies:new Set(previous.map(r=>r.studyId)).size},
  included:{newReports:included.length,newStudies:new Set(included.filter(r=>!previous.some(p=>p.studyId===r.studyId)).map(r=>r.studyId)).size,totalReports:included.length+previous.length,totalStudies:new Set([...included,...previous].map(r=>r.studyId)).size},trace:ledger};
 flows.set(data,canonicalSha256(data));return data;
}
