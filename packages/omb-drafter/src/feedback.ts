import {literatureContext} from './literature.ts';
import {narrativeIssues} from '../../omb-report/src/text-quality.ts';
import {parseDraft,ReportRefusal,renderDraft,limitationsPartB,record,type EntityRegistry,type Region} from '../../omb-report/src/index.ts';
import type {ManuscriptInputs} from './manuscript.ts';
export interface ProseIssue {region:string;sentence:string;rule:string}
/** Diagnostics never authorize text: the same validators run again at assembly. */
export function sentenceIssues(text:unknown,region:string,registry:EntityRegistry,check:(sentence:string)=>void):ProseIssue[]{
 if(typeof text!=='string')return [{region,sentence:JSON.stringify(text)??'missing',rule:'prose must be text'}];
 let sentences:string[];
 try{sentences=parseDraft(text,registry).map(s=>s.text);}catch(error){if(!(error instanceof ReportRefusal))throw error;
  // Preserve the exact offending text even when grammar prevents sentence parsing.
  sentences=text.match(/[^.!?]+[.!?](?:\s|$)|[^.!?]+$/gu)?.map(s=>s.trim()).filter(Boolean)??[text];
 }
 const issues:ProseIssue[]=[];
 for(const sentence of sentences)try{check(sentence);}catch(error){if(!(error instanceof ReportRefusal))throw error;issues.push({region,sentence,rule:error.message});}
 return issues;
}
export function resultRepairFeedback(input:ManuscriptInputs,raw:unknown,refusal:string){
 const data=record(raw),issues:ProseIssue[]=[];
 for(const [key,region]of [['summary','plain-summary'],['results','results'],['discussion','discussion']] as const){
  issues.push(...sentenceIssues(data[key],key,input.registry,s=>{renderDraft(input.ctx,s,region as Region,input.registry);}));
 }
 if(Array.isArray(data.partB))for(const row of data.partB){const r=record(row);for(const key of ['bias','settlingData'])if(typeof r[key]==='string')issues.push(...sentenceIssues(String(r[key]).replace(/([^.?!])$/u,'$1.'),'partB.'+key,input.registry,s=>{renderDraft(input.ctx,s,'limitations',input.registry);}));}
 if(typeof data.discussion==='string')issues.push(...qualityFeedback(data.discussion,'discussion',input.registry));
 return {refusal,issues,allowed:{claims:input.ctx.claims.map(c=>`[claim:${c.id}].`),summary:[`[claim:${input.ctx.input.plannedFound.primaryClaimId}].`],numbers:[],citations:literatureContext(input.ctx.input.frozenLiteratureIndex),interpretations:input.ctx.claims.map(c=>`[proc:${c.id}.interpretation].`),rules:'Summary and Results: claim-token sentences only, each claim once in plan order. Discussion: use bound interpretation tokens and exact approved citations, connected by concrete scientific distinctions and specific limitations; no unbound finding, status, procedure or number. Do not paraphrase numerical bundles or labels. Software adds them. Citation tokens require the exact frozen approved sentence; an empty approval list permits none.'}};
}

/** Invalid grammar must generate repair feedback, never abort feedback itself. */
export function qualityFeedback(text:string,region:string,registry:EntityRegistry):ProseIssue[]{
 try{return narrativeIssues(text,registry).map(i=>({...i,region}));}
 catch(error){if(!(error instanceof ReportRefusal))throw error;return sentenceIssues(text,region,registry,s=>{parseDraft(s,registry);});}
}
