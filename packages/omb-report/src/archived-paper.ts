/** Retrospective reading manuscripts for archived V7 investigations.
 * This is deliberately separate from PW0/PW9 endorsement: an old V7 deliverable
 * is not a modern authenticated PaperInput, and reported values never become
 * kernel-recomputed facts merely by being typeset. */
import {canonicalSha256} from '../../bio-core/src/index.ts';
import {pointer,type Json} from '../../omb-amani/src/results.ts';
import {record,requireThat} from './common.ts';

export interface ArchiveFact {pointer:string;value:Json;source:'evaluated-run-report'}
export interface ArchivePaperInput {
 schema:'omb/archive-paper-input@1';question:string;plan:unknown;
 execution?:{completedLook:true;outputSnapshotHash:string;code:{name:string;source:string}[]};
 facts:ArchiveFact[];claims:{claimId:string;status:string}[];
 provenance:{journalSha256:string;reportSha256:string;planSha256:string;certificationSha256:string};
 sha256:string;
}
export interface ArchiveNarrative {title:string;abstract:string;introduction:string;methods:string;results:string;discussion:string}
export interface ArchivePaper {schema:'omb/archive-paper@1';inputHash:string;title:string;sections:{heading:string;paragraphs:string[]}[];sha256:string}
const digest=(v:{sha256:string})=>{const {sha256,...body}=v;return canonicalSha256(body);};
/** The host selects fields from an evaluated report, never an answer key. Null
 * fields are unavailable. Keep the original scientific status independently. */
export function archivePublicValue(value:unknown):unknown {
 if(typeof value==='string')return value.replace(/(?:\/(?:Users|home|private|tmp)\/|~\/)[^\s"'<>\],;)]*/gu,p=>p.split('/').at(-1)??'source');
 if(Array.isArray(value))return value.map(archivePublicValue);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,archivePublicValue(v)]));
 return value;
}
export function archivePaperInput(source:{question:string;plan:unknown;report:Json;paths:readonly string[];claims:ArchivePaperInput['claims'];provenance:ArchivePaperInput['provenance'];execution?:ArchivePaperInput['execution']}):ArchivePaperInput {
 requireThat(source.question.trim()&&source.paths.length,'archive question and fact selection required');
 requireThat(new Set(source.paths).size===source.paths.length,'duplicate archive fact');
 for(const hash of Object.values(source.provenance))requireThat(/^[a-f0-9]{64}$/u.test(hash),'archive source digest required');
 requireThat(canonicalSha256(source.report)===source.provenance.reportSha256&&canonicalSha256(source.plan)===source.provenance.planSha256,'archive source differs from pinned report or plan');
 const facts=source.paths.map(p=>{const value=pointer(source.report,p);requireThat(value!==undefined&&value!==null,'archive fact unavailable: '+p);return {pointer:p,value,source:'evaluated-run-report' as const};});
 requireThat(canonicalSha256(archivePublicValue(source.plan))===canonicalSha256(source.plan),'archive plan contains historical filesystem locations');
 const body={schema:'omb/archive-paper-input@1' as const,question:source.question,plan:source.plan,...source.execution?{execution:source.execution}:{},facts,claims:structuredClone(source.claims),provenance:source.provenance};
 return {...body,sha256:canonicalSha256(body)};
}
export function assertArchiveInput(input:ArchivePaperInput):void {requireThat(input.schema==='omb/archive-paper-input@1'&&digest(input)===input.sha256,'archive input changed');}
const printable=(value:Json):string=>typeof value==='number'?Number.isInteger(value)?String(value):Number(value.toPrecision(6)).toString():Array.isArray(value)?value.map(printable).join(', '):typeof value==='object'?JSON.stringify(value):String(value).replaceAll('-',' ');
/** A draft can request an existing JSON Pointer; it cannot type a measurement.
 * Digit-bearing blinded identifiers must come from the supplied task/plan. */
export function buildArchivePaper(input:ArchivePaperInput,candidate:unknown):ArchivePaper {
 assertArchiveInput(input);const d=record(candidate);const names=['title','abstract','introduction','methods','results','discussion'] as const;
 requireThat(Object.keys(d).length===names.length&&names.every(k=>typeof d[k]==='string'&&(d[k] as string).trim()),'archive narrative shape');
 const vocabulary=new Set((input.question+' '+JSON.stringify(input.plan)+' '+JSON.stringify(input.facts)+' '+JSON.stringify(input.execution??{})).match(/[A-Za-z][A-Za-z_-]*\d[A-Za-z\d_-]*/gu)??[]);
 const expand=(text:string):string=>{
  const certificationText=text.replace(/\bconfirmed (?=duplicat(?:e|ed)(?:s)?\b|identity groups\b)/giu,'verified ');
  requireThat(!/[<>\\`]|https?:|\b(?:confirmed|fully replicated|owner.approved|certified finding)\b/iu.test(certificationText),'archive narrative cannot claim certification or contain markup');
  let bare=text.replace(/\[\[(\/[^\]\r\n]*)\]\]/gu,(_all,p:string)=>{requireThat(input.facts.some(f=>f.pointer===p),'unavailable archive slot: '+p);return '';});
  requireThat(!/[\[\]]/u.test(bare),'unknown archive slot syntax');
  bare=bare.replace(/[A-Za-z][A-Za-z_-]*\d[A-Za-z\d_-]*/gu,id=>{requireThat(vocabulary.has(id),'unknown blinded identifier: '+id);return '';});
  requireThat(!/\p{N}/u.test(bare),'typed archive number; use a fact slot');
  return text.replace(/\[\[(\/[^\]\r\n]*)\]\]/gu,(_all,p:string)=>printable(input.facts.find(f=>f.pointer===p)!.value));
 };
 const title=expand(d.title as string);
 const sections=names.slice(1).map(k=>({heading:k[0]!.toUpperCase()+k.slice(1),paragraphs:expand(d[k] as string).split(/\n\s*\n/u)}));
 // Software owns the provenance and evidence-status notice, not the drafter.
 sections.push({heading:'Evidence and provenance',paragraphs:[
  'This reading manuscript was drafted retrospectively from the archived blind investigation. Numerical values are reported outputs of that run; typesetting does not independently certify them. The study identity and published answer were unavailable to the manuscript drafter.',
  'Native claim status: '+input.claims.map(c=>c.claimId.replaceAll('_',' ').replaceAll('-',' ')+' = '+c.status.replaceAll('-',' ')).join('; ')+'.',
  'This manuscript is an unendorsed reading draft. Cross-family manuscript review and owner endorsement are pending.',
 ]});
 const body={schema:'omb/archive-paper@1' as const,inputHash:input.sha256,title,sections};return {...body,sha256:canonicalSha256(body)};
}
export function assertArchivePaper(paper:ArchivePaper):void {requireThat(paper.schema==='omb/archive-paper@1'&&digest(paper)===paper.sha256,'archive paper changed');}
