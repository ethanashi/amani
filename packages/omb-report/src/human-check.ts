/** PW6 human-check record (design 9, "Human check before endorsed"; 12 packaging lint
 * "a missing human-check record"). An LLM already knows the jargon, so the comprehension gate
 * cannot prove human understanding. The owner, and when available a reader from another
 * field, answer the same five questions in their own words. The owner signs the record with
 * Ed25519; it is bound to the final PaperInput hash, the plain summary and the packet that
 * was read, and is a separate post-draft record like PW0's EndorsementRecord. */
import { sign as edSign, verify as edVerify, type KeyObject } from 'node:crypto';
import { canonicalJson } from '../../bio-core/src/index.ts';
import { record, requireThat } from './common.ts';
import { assertContext, type ReportContext } from './context.ts';
import { canonicalText, lexicalKey } from './normalise.ts';
import { type PlainSummary } from './boxes.ts';
import { verifyComprehensionPacket, type ComprehensionPacket } from './comprehension.ts';

export const HUMAN_CHECK_SCHEMA='omb-paper/human-check@1';
export const HUMAN_ANSWER_KEYS=Object.freeze(['tested','found','sure','notShown','check'] as const);
export interface HumanAnswers {tested:string;found:string;sure:string;notShown:string;check:string}
export interface HumanReader {role:'owner'|'cross-field-reader';reader:string;field:string;nonSpecialist:boolean;at:string;answers:HumanAnswers}
export interface HumanCheckBody {schema:string;paperInputHash:string;plainSummarySha256:string;packetSha256:string;owner:string;signedAt:string;readers:HumanReader[]}
export interface HumanCheckRecord extends HumanCheckBody {signature:string}
/** "Own words": an answer may not copy this many consecutive words from what was read. */
export const VERBATIM_WINDOW=12;
export const MIN_ANSWER_WORDS=3;

export function humanCheckMessage(body:HumanCheckBody):Buffer {return Buffer.from(`${HUMAN_CHECK_SCHEMA}\u0000${canonicalJson(body)}`,'utf8');}
/** Owner-side helper: the private key never enters PaperInput, the drafter or the renderer. */
export function signHumanCheck(body:HumanCheckBody,ownerPrivateKey:KeyObject):HumanCheckRecord {
 requireThat(ownerPrivateKey.type==='private'&&ownerPrivateKey.asymmetricKeyType==='ed25519','human check is signed with the owner Ed25519 key');
 return {...structuredClone(body),signature:edSign(null,humanCheckMessage(body),ownerPrivateKey).toString('base64')};
}
const isUtc=(v:unknown):v is string=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(v)&&Number.isFinite(Date.parse(v))&&new Date(Date.parse(v)).toISOString().slice(0,19)===v.slice(0,19);
/** record() maps null, arrays and primitives to {}, which never has the required keys. */
function exactKeys(value:unknown,keys:readonly string[],what:string):Record<string,unknown> {const r=record(value);requireThat(Object.keys(r).length===keys.length&&keys.every(k=>Object.hasOwn(r,k)),`${what} has missing or extra fields`);return r;}
const tokens=(text:string)=>lexicalKey(text).normalize('NFD').replace(/\p{M}/gu,'').match(/[\p{L}\p{N}]+/gu)??[];
/** True when the answer repeats VERBATIM_WINDOW consecutive words of the source. */
export function copiesVerbatim(answer:string,source:string,window=VERBATIM_WINDOW):boolean {
 const a=tokens(answer);const grams=new Set<string>();const s=tokens(source);
 for(let i=0;i+window<=s.length;i++)grams.add(s.slice(i,i+window).join(' '));
 for(let i=0;i+window<=a.length;i++)if(grams.has(a.slice(i,i+window).join(' ')))return true;
 return false;
}
export interface HumanCheckBinding {ctx:ReportContext;plainSummary:PlainSummary;packet:ComprehensionPacket;ownerPublicKey:KeyObject}
/** Verifies the owner signature and every binding. The owner key is a trusted host input. */
export function verifyHumanCheck(value:unknown,binding:HumanCheckBinding):HumanCheckBody {
 const {ctx,plainSummary,packet,ownerPublicKey}=binding;assertContext(ctx);
 const r=exactKeys(value,['schema','paperInputHash','plainSummarySha256','packetSha256','owner','signedAt','readers','signature'],'human-check record');
 requireThat(r.schema===HUMAN_CHECK_SCHEMA,'unknown human-check schema');
 requireThat(r.paperInputHash===ctx.input.sha256,'human check is bound to a different PaperInput');
 requireThat(r.plainSummarySha256===plainSummary.sha256&&packet.plainSummarySha256===plainSummary.sha256,'human check read a different plain summary');
 requireThat(r.packetSha256===packet.sha256&&packet.paperInputHash===ctx.input.sha256,'human check read a different comprehension packet');
 verifyComprehensionPacket(ctx,packet,plainSummary);
 const owner=record(ctx.input.ownerConfiguration).ownerActor;
 requireThat(typeof owner==='string'&&r.owner===owner,'human check must be signed by the receipted owner');
 requireThat(isUtc(r.signedAt),'human check signedAt must be strict UTC');
 requireThat(Array.isArray(r.readers)&&r.readers.length>=1&&r.readers.length<=5,'human check needs between one and five readers');
 const readers=(r.readers as unknown[]).map(v=>exactKeys(v,['role','reader','field','nonSpecialist','at','answers'],'human-check reader'));
 requireThat(new Set(readers.map(x=>x.reader)).size===readers.length,'human-check readers must be distinct');
 requireThat(readers.filter(x=>x.role==='owner').length===1&&readers.some(x=>x.role==='owner'&&x.reader===owner),'the owner must answer the five questions');
 const read=`${packet.abstract}\n${packet.plainSummary}`;
 for(const x of readers){
  requireThat(x.role==='owner'||x.role==='cross-field-reader','unknown human-check reader role');
  requireThat(typeof x.reader==='string'&&x.reader.trim().length>0&&typeof x.field==='string'&&x.field.trim().length>0,'each reader records who they are and their field');
  requireThat(typeof x.nonSpecialist==='boolean','each reader records whether they are a non-specialist');
  requireThat(isUtc(x.at)&&Date.parse(x.at)<=Date.parse(String(r.signedAt)),'reader answers must precede the owner signature');
  const answers=exactKeys(x.answers,HUMAN_ANSWER_KEYS,'human-check answers');
  for(const key of HUMAN_ANSWER_KEYS){
   const answer=answers[key];requireThat(typeof answer==='string'&&tokens(canonicalText(answer)).length>=MIN_ANSWER_WORDS,`answer to "${key}" must be written out`);
   requireThat(!copiesVerbatim(answer,read),`answer to "${key}" copies the summary instead of using the reader's own words`);
  }
 }
 requireThat(readers.some(x=>x.nonSpecialist===true),'a non-specialist must read the plain summary');
 requireThat(typeof r.signature==='string'&&/^[A-Za-z0-9+/]+={0,2}$/u.test(r.signature),'missing owner signature');
 requireThat(ownerPublicKey?.type==='public'&&ownerPublicKey.asymmetricKeyType==='ed25519','owner verification key must be Ed25519');
 const {signature,...body}=r as unknown as HumanCheckRecord;
 requireThat(edVerify(null,humanCheckMessage(body),ownerPublicKey,Buffer.from(signature,'base64')),'owner signature does not verify');
 return Object.freeze(structuredClone(body));
}
/** Packaging lint: refuses when the record is absent, then verifies it. */
export function assertHumanCheckRecorded(value:unknown,binding:HumanCheckBinding):HumanCheckBody {
 requireThat(value!==undefined&&value!==null,'missing human-check record: a non-specialist must read the plain summary before endorsement');
 return verifyHumanCheck(value,binding);
}
