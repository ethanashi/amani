/** PW6 comprehension gate (design 9, "Readability gate: comprehension"). A referee from the
 * other model family sees the abstract, plain summary and authenticated registration card, never the Summary of
 * findings table, and answers five fixed questions in a closed form. Software compares each
 * answer with the records: the label must match exactly and the numbers must equal the
 * printed facts. The gate passes only at 5/5. Referee orchestration is PW7's; this module
 * builds the packet, scores the answers and blocks. */
import { honestNullReason } from './templates.ts';
import { canonicalSha256 } from '../../bio-core/src/index.ts';
import { record, requireThat, strings } from './common.ts';
import { assertContext, type ReportContext } from './context.ts';
import { type EntityRegistry } from './entities.ts';
import { registrationValues, threePartLabel } from './labels.ts';
import { canonicalText, lexicalKey } from './normalise.ts';
import { plainify } from './acronyms.ts';
import { assertSoftwareBox, type PlainSummary } from './boxes.ts';
import { assertTermRegistry, type TermRegistry } from './glossary.ts';

export const COMPREHENSION_QUESTIONS=Object.freeze(['What was tested?','What was found, and with what range?','How sure is it (which label, and why)?','What does it not show?','How could I check it?'] as const);
export const PACKET_SCHEMA='omb-paper/comprehension-packet@2';
export const ANSWERS_SCHEMA='omb-paper/comprehension-answers@2';
export interface ComprehensionPacket {schema:string;paperInputHash:string;abstract:string;plainSummary:string;plainSummarySha256:string;registration:{planHash:string|null;lockDate:string|null;location:'Declarations'};questions:readonly string[];sha256:string}
export interface ComprehensionAnswers {
 schema:string;packetSha256:string;paperInputHash:string;
 tested:{exposure:string;outcome:string};
 found:{kind:'result';measure:string;estimate:number;ciLower:number;ciUpper:number}|{kind:'honest-null';status:'voided'|'non-identifiable';reason:string};
 sure:{label:string;checks:string};
 notShown:string[];
 check:{planHash:string;lockDate:string};
}
export interface QuestionScore {question:string;ok:boolean;reason:string}
export interface ComprehensionResult {packetSha256:string;answersSha256:string;score:number;passed:boolean;questions:QuestionScore[]}

/** Host-owned execution metadata, never taken from model-editable answers. PW7 must
 * populate it from the actual isolated run. A digest binds it to that run's payload. */
export interface RefereeExecution {drafterModel:string;refereeModel:string;packetSha256:string;answersSha256:string}
const FAMILY_ALIASES:Readonly<Record<string,string>>=Object.freeze({
 openai:'openai-gpt',openaigpt:'openai-gpt',gpt6:'openai-gpt',gpt6mini:'openai-gpt',gpt6astra:'openai-gpt',gpt6sol:'openai-gpt',gpt6luna:'openai-gpt',
 anthropic:'anthropic-claude',anthropicclaude:'anthropic-claude',claude:'anthropic-claude',claudeopus46:'anthropic-claude',claudesonnet46:'anthropic-claude',
});
export function canonicalModelFamily(model:string):string {
 requireThat(typeof model==='string','missing host model identity');
 const key=canonicalText(model).toLowerCase().replace(/[ _.-]/gu,'');const family=Object.hasOwn(FAMILY_ALIASES,key)?FAMILY_ALIASES[key]:undefined;
 requireThat(family,'unknown host model identity');return family;
}
const scoredResults=new WeakMap<ComprehensionResult,{result:string;packet:string}>();
/** Only the abstract, plain summary and authenticated registration card go in. Tables, headings, hidden markup and any
 * full protected label (which appears only in the Summary of findings and label box) are refused. */
export function buildComprehensionPacket(ctx:ReportContext,abstract:string,plainSummary:PlainSummary):ComprehensionPacket {
 assertContext(ctx);
 requireThat(typeof abstract==='string'&&abstract.trim().length>0,'comprehension packet needs the abstract');
 assertSoftwareBox(ctx,plainSummary,'plain summary');
 requireThat(Object.isFrozen(plainSummary)&&typeof plainSummary.text==='string'&&plainSummary.sha256===canonicalSha256({paperInput:ctx.input.sha256,text:plainSummary.text,notShown:plainSummary.notShown,limitationsPointer:plainSummary.limitationsPointer,fullLimitationsSha256:plainSummary.fullLimitationsSha256}),'comprehension packet needs the software plain summary for this PaperInput');
 for(const text of [abstract,plainSummary.text]){
  requireThat(!/\||<[A-Za-z!/]|^\s*#/mu.test(text),'comprehension packet carries only abstract and plain-summary prose: no tables, headings or markup');
  requireThat(!ctx.claims.some(c=>text.includes(threePartLabel(ctx,c.id).full)),'comprehension packet must not contain Summary of findings or label-box text');
 }
 const reg=registrationValues(ctx);
 const body={registration:{planHash:reg.plan_hash,lockDate:reg.lock_date,location:'Declarations' as const},schema:PACKET_SCHEMA,paperInputHash:ctx.input.sha256,abstract,plainSummary:plainSummary.text,plainSummarySha256:plainSummary.sha256,questions:[...COMPREHENSION_QUESTIONS]};
 return Object.freeze({...body,sha256:canonicalSha256(body)});
}
/** Rebuild all packet fields from current authenticated content, including fixed questions. */
export function verifyComprehensionPacket(ctx:ReportContext,packet:ComprehensionPacket,summary:PlainSummary):void {
 const expected=buildComprehensionPacket(ctx,packet.abstract,summary);
 requireThat(canonicalSha256(packet)===canonicalSha256(expected),'comprehension packet was changed or differs from the scored plain summary');
}
/** Case, Unicode form, confusables and trailing sentence punctuation do not change an answer. */
const key=(x:string)=>lexicalKey(x).replace(/[.!?\s]+$/u,'');
const same=(a:unknown,b:unknown)=>typeof a==='string'&&typeof b==='string'&&key(a)===key(b);
const unwrap=(label:string)=>{const t=canonicalText(label);return t.startsWith('(')&&t.endsWith(')')?t.slice(1,-1):t;};
/** Printed primary bundle: "<measure> <estimate> (<level>% CI <lower> to <upper>; ...". */
export function printedBundle(ctx:ReportContext):{measure:string;estimate:number;ciLower:number;ciUpper:number}|null {
 assertContext(ctx);const primary=ctx.claims.find(c=>c.id===ctx.input.plannedFound.primaryClaimId);
 if(primary&&honestNullReason(primary)!==null)return null;
 const id=ctx.input.plannedFound.primaryClaimId;const display=ctx.slots.get(`m:${id}.result`)?.display;if(typeof display!=='string')return null;
 const m=/^(.+?) was (-?\d+(?:\.\d+)?(?:e[+-]?\d+)?) \(\d+(?:\.\d+)?% CI (-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)–(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?);/u.exec(display);
 return m?{measure:m[1]!,estimate:Number(m[2]),ciLower:Number(m[3]),ciUpper:Number(m[4])}:null;
}
function verifyAnswerShape(a:unknown):asserts a is ComprehensionAnswers {
 const r=record(a);requireThat(r.schema===ANSWERS_SCHEMA,'unknown comprehension answer schema');
 requireThat((()=>{try{canonicalSha256(a);return true;}catch{return false;}})(),'comprehension answers must be plain JSON');
 for(const key of ['packetSha256','paperInputHash'])requireThat(typeof r[key]==='string'&&(r[key] as string).trim().length>0,`comprehension answers need ${key}`);
 requireThat(!Object.hasOwn(r,'drafterFamily')&&!Object.hasOwn(r,'refereeFamily'),'model identities belong to the host execution receipt');
 requireThat(Array.isArray(r.notShown)&&strings(r.notShown).length===r.notShown.length,'notShown must be a list of strings');
}
/** Scores the five answers against the records. Integrity faults refuse; wrong answers score zero. */
export function scoreComprehension(ctx:ReportContext,packet:ComprehensionPacket,plainSummary:PlainSummary,answers:unknown,registry:EntityRegistry,terms:TermRegistry,execution:RefereeExecution):ComprehensionResult {
 assertContext(ctx);assertTermRegistry(terms);verifyAnswerShape(answers);
 const {sha256,...body}=packet;requireThat(canonicalSha256(body)===sha256&&packet.schema===PACKET_SCHEMA,'comprehension packet was changed');
 requireThat(packet.paperInputHash===ctx.input.sha256&&answers.paperInputHash===ctx.input.sha256,'comprehension answers are bound to a different PaperInput');
 requireThat(answers.packetSha256===packet.sha256,'comprehension answers are bound to a different packet');
 requireThat(packet.plainSummary===plainSummary.text&&packet.plainSummarySha256===plainSummary.sha256,'packet differs from the scored plain summary');
 requireThat(execution&&execution.packetSha256===packet.sha256&&execution.answersSha256===canonicalSha256(answers),'host execution receipt differs from packet or answers');
 requireThat(canonicalModelFamily(execution.drafterModel)!==canonicalModelFamily(execution.refereeModel),'the comprehension referee must come from the other model family');
 verifyComprehensionPacket(ctx,packet,plainSummary);
 const id=ctx.input.plannedFound.primaryClaimId;const c=ctx.claims.find(c=>c.id===id);requireThat(c,'comprehension gate needs the primary claim');
 const plainName=(v:unknown)=>typeof v==='string'?[v,plainify(v,terms,registry)]:[];
 const scores:QuestionScore[]=[];const score=(i:number,ok:boolean,reason:string)=>scores.push({question:COMPREHENSION_QUESTIONS[i]!,ok,reason:ok?'matches the records':reason});
 const t=record(answers.tested);
 score(0,plainName(c.plan.exposure).some(v=>same(t.exposure,v))&&plainName(c.plan.outcome).some(v=>same(t.outcome,v)),'exposure or outcome differs from the primary claim');
 const f=record(answers.found);const printed=printedBundle(ctx);
 const nullReason=honestNullReason(c);
 const foundOk=nullReason!==null?f.kind==='honest-null'&&f.status===c.status&&plainName(nullReason).some(v=>same(f.reason,v))&&Object.keys(f).length===3:f.kind==='result'&&printed!==null&&plainName(printed.measure).some(v=>same(f.measure,v))&&(['estimate','ciLower','ciUpper'] as const).every(k=>f[k]===printed[k])&&Object.keys(f).length===5;
 score(1,foundOk,printed?'measure or numbers differ from the printed result':'no primary result bundle');
 const s=record(answers.sure);const label=threePartLabel(ctx,c.id).short;const checks=unwrap(label).split('; ')[1];
 score(2,typeof s.label==='string'&&unwrap(s.label)===unwrap(label)&&same(s.checks,checks),'label or check count differs from the records');
 const lines=plainSummary.notShown;const expected=lines.map(r=>key(r.text)).sort();
 const given=answers.notShown.map(key).sort();
 score(3,given.length===expected.length&&given.every((g,i)=>g===expected[i]),'limitations missing or not from the records');
 const reg=registrationValues(ctx);const k=record(answers.check);
 score(4,reg.plan_hash!==null&&reg.lock_date!==null&&k.planHash===reg.plan_hash&&k.lockDate===reg.lock_date,'plan hash or lock date differs from the registration');
 const total=scores.filter(q=>q.ok).length;
 const result={packetSha256:packet.sha256,answersSha256:canonicalSha256(answers),score:total,passed:total===COMPREHENSION_QUESTIONS.length,questions:scores};
 scoredResults.set(result,{result:canonicalSha256(result),packet:canonicalSha256(packet)});return result;
}
/** Blocking: the gate passes only at 5/5. */
export function assertComprehensionGate(result:ComprehensionResult,packet:ComprehensionPacket):void {
 requireThat(result.questions.length===COMPREHENSION_QUESTIONS.length&&result.score===result.questions.filter(q=>q.ok).length,'malformed comprehension result');
 requireThat(result.passed&&result.score===COMPREHENSION_QUESTIONS.length,`comprehension gate scored ${result.score}/${COMPREHENSION_QUESTIONS.length}; it passes only at 5/5`);
 requireThat(scoredResults.get(result)?.result===canonicalSha256(result)&&scoredResults.get(result)?.packet===canonicalSha256(packet)&&result.packetSha256===packet.sha256,'comprehension result was not scored by software for this packet');
}
