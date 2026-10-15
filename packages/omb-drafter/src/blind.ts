import {literatureContext} from './literature.ts';
import {assertNarrativeQuality,narrativeIssues} from '../../omb-report/src/text-quality.ts';
import {sentenceIssues,qualityFeedback} from './feedback.ts';
import { venueProfile, wordCount, type VenueProfile } from './manuscript.ts';
import { verifyLedgerReceipt, verifyTemporalProof, type LookLedgerReceipt, type LedgerTrust } from './temporal.ts';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { canonicalJson, canonicalSha256 } from '../../bio-core/src/index.ts';
import type { PaperInput } from '../../omb-paper/src/index.ts';
import { parseDraft, normalise, lexicalKey, LEXICONS, lintBlindWording, checkBlindAIProse, exactKeys, requireThat, record, type EntityRegistry, type QuoteRecord } from '../../omb-report/src/index.ts';
import { planAliases } from '../../omb-report/src/boundaries.ts';
import { DraftRuntime, type Model } from './runtime.ts';

export interface BlindSource {
  lineageId: string;
  lockedPlan: Record<string, unknown>;
  frozenLiteratureIndex: unknown;
  mode: 'stage-1' | 'legacy-blind';
  lockedAt: string;
  /** Host evidence that the new-plan drafting turn precedes the first look. */
  firstLookAt: string | null;
}
export interface BlindDraft { introduction: string; methods: string }
export interface BlindArtifact extends BlindDraft { ledgerReceipt?:LookLedgerReceipt; schema: 'omb/blind-draft@1'; sourceHash: string; planHash: string; indexHash: string; lineageId: string; mode: BlindSource['mode']; sha256: string }
export const BLIND_INSTRUCTION = 'Draft Introduction context and gap, and a short Methods bridge. Return exactly {"introduction":string,"methods":string}. CONSTRAINTS: the supplied frozen literature contains titles, findings, keys and approvedSentences. Use those exact approved citation sentences, with their citation tokens, to ground a substantive background for the locked question. Do not invent references or paraphrase a frozen citation. Explain concrete scientific distinctions such as diagnosis versus prognosis, measurement timing, population selection and what evidence is still needed. No result data are supplied: do not infer any result, status or completed procedure. No numbers, including spelled-out quantities, except inside approved tokens. Named entities may appear in their approved citation sentences; do not assert unsupported biological relationships. Use ordinary declarative paragraphs, without headings or questions. Software supplies aims, shared technical Methods and claim specifications; do not repeat them. Avoid abstract filler about meaning, interpretation and uncertainty. Each paragraph should develop a different concrete point grounded in the frozen literature. Match the supplied word floor without repeating phrases.';
export function blindProjection(input: PaperInput): BlindSource {
  return { lineageId: input.lineageId, lockedPlan: structuredClone(input.lockedPlan), frozenLiteratureIndex: structuredClone(input.frozenLiteratureIndex), mode: 'legacy-blind', lockedAt: String(record(input.timestamps[0]).at), firstLookAt: null };
}
/** Uses PW1 grammar, PW2 wording and PW5 AI-name guard. No results context exists.
 * Final assembly also uses renderDraft, including full entity and citation binding. */
export function validateBlind(source: BlindSource, raw: unknown, registry: EntityRegistry): BlindDraft {
  exactKeys(raw as object, ['introduction','methods'], 'blind output');
  const draft = raw as BlindDraft;
  const entries = record(source.frozenLiteratureIndex).entries;
  const quotes = (Array.isArray(entries) ? entries : []).map(record) as unknown as QuoteRecord[];
  const aliases = (Array.isArray(source.lockedPlan.claims) ? source.lockedPlan.claims : []).flatMap(c => planAliases(record(c))).map(s => normalise(s).toLowerCase());
  for (const region of ['introduction','methods'] as const) {
    requireThat(typeof draft[region] === 'string', 'blind prose must be text');
    for (const sentence of parseDraft(draft[region], registry)) {
      requireThat(!new RegExp(`\\b(?:${LEXICONS[17]})\\b`,'iu').test(lexicalKey(sentence.prose)),'blind hypothesis phrasing requires software aims');
      requireThat(sentence.placeholders.every(p => p.kind === 'c'), 'blind pass may only use frozen citation slots');
      const keys = sentence.placeholders.map(p => p.key);
      for (const key of keys) requireThat(quotes.some(q => q.key === key && ['fulltext-verified','abstract-supported'].includes(q.status) && q.approvedSentenceHashes?.includes(canonicalSha256(sentence.text))), 'blind citation not frozen and approved');
      requireThat(sentence.entities.every(e => aliases.includes(normalise(e.label).toLowerCase()) || quotes.some(q => keys.includes(q.key) && q.quote.includes(e.label))), 'blind entity outside plan or frozen quote');
      checkBlindAIProse(sentence.prose);
      lintBlindWording({ quotes }, { sentence, claims: [], quoteKeys: keys }, region);
    }
  }
  assertNarrativeQuality(draft.introduction,registry);
  return structuredClone(draft);
}
export function blindRepairFeedback(source:BlindSource,raw:unknown,registry:EntityRegistry,refusal:string){
 const data=record(raw);const issues=['introduction','methods'].flatMap(region=>sentenceIssues(data[region],region,registry,s=>{validateBlind(source,{introduction:region==='introduction'?s:'Interpretation requires caution.',methods:region==='methods'?s:'Interpretation requires caution.'},registry);}));
 issues.push(...qualityFeedback(typeof data.introduction==='string'?data.introduction:'','introduction',registry));
 return {refusal,issues,allowed:{claims:[],numbers:[],citations:record(source.frozenLiteratureIndex).entries??[],rules:'No claim or number tokens in the blind pass. Citation slots require an exact approved frozen sentence. No study names in free prose. Explain concrete measurement, sampling and clinical questions using the supplied frozen literature. Avoid abstract filler. Software provides the aims and completed Methods.'}};
}
export class BlindStore {
  constructor(readonly directory: string) { mkdirSync(directory, { recursive: true, mode: 0o700 }); }
  save(source: BlindSource, draft: BlindDraft, ledgerReceipt?:LookLedgerReceipt): BlindArtifact {
    const body = { schema: 'omb/blind-draft@1' as const, ...draft, sourceHash: canonicalSha256(source), planHash: canonicalSha256(source.lockedPlan), indexHash: canonicalSha256(source.frozenLiteratureIndex), lineageId: source.lineageId, mode: source.mode };
    const artifact = { ...body, sha256: canonicalSha256(body),...ledgerReceipt?{ledgerReceipt}:{} };
    const file = path.join(this.directory, `${canonicalSha256([source.lineageId, body.planHash])}.json`);
    // wx is the no-rewrite boundary. An existing draft is never silently replaced.
    writeFileSync(file, canonicalJson(artifact), { flag: 'wx', mode: 0o400 });
    return artifact;
  }
  load(lineageId: string, planHash: string): BlindArtifact {
    return JSON.parse(readFileSync(path.join(this.directory, `${canonicalSha256([lineageId, planHash])}.json`), 'utf8')) as BlindArtifact;
  }
}
export function enforceBlindProfile(draft:BlindDraft,profile:VenueProfile,registry:EntityRegistry):BlindDraft {
 const count=wordCount(draft.introduction),min=profile.sectionMinimums.introduction,cap=profile.sectionCaps.introduction;
 requireThat(Number.isSafeInteger(min)&&min!>0&&Number.isSafeInteger(cap)&&cap!>=min!,'invalid Introduction profile');
 requireThat(count>=min!&&count<=cap!,'Introduction outside profile bounds before freeze');
 requireThat(new Set(parseDraft(draft.introduction,registry).map(s=>lexicalKey(s.text))).size>=profile.minDistinctNarrativeSentences,'Introduction lacks distinct narrative before freeze');
 return draft;
}
export interface Stage1Authority extends LedgerTrust {
 snapshot:LookLedgerReceipt;
 /** Host atomically appends the hash before permitting any look, then signs the head. */
 recordIntroduction(hash:string):Promise<LookLedgerReceipt>;
}
export async function draftAtPlanLock(source:BlindSource,authority:Stage1Authority,runtime:DraftRuntime,model:Model,store:BlindStore,registry:EntityRegistry,profile:VenueProfile=venueProfile('preprint')):Promise<BlindArtifact> {
 const copy=structuredClone(source),snapshot=verifyLedgerReceipt(authority.snapshot,authority);
 requireThat(copy.mode==='stage-1'&&snapshot.looks.length===0&&snapshot.introductionHash===null,'stage-1 must run at plan lock before results');
 requireThat(snapshot.lineageId===copy.lineageId&&snapshot.planHash===canonicalSha256(copy.lockedPlan)&&snapshot.indexHash===canonicalSha256(copy.frozenLiteratureIndex),'unauthenticated plan-lock snapshot');
 const raw=await runtime.call('blind',model,BLIND_INSTRUCTION+` Introduction prose must contain at least ${profile.sectionMinimums.introduction} words, at most ${profile.sectionCaps.introduction} words, and ${profile.minDistinctNarrativeSentences} distinct sentences. These constraints are host instructions; never type numeric literals in prose.`,{...copy,literature:literatureContext(copy.frozenLiteratureIndex)});requireThat(raw.kind==='output','drafter refused blind turn');
 const draft=enforceBlindProfile(validateBlind(copy,raw.value,registry),profile,registry);
 const body={schema:'omb/blind-draft@1' as const,...draft,sourceHash:canonicalSha256(copy),planHash:canonicalSha256(copy.lockedPlan),indexHash:canonicalSha256(copy.frozenLiteratureIndex),lineageId:copy.lineageId,mode:copy.mode};
 const hash=canonicalSha256(body),receipt=await authority.recordIntroduction(hash),r=verifyLedgerReceipt(receipt,authority);
 requireThat(r.lineageId===snapshot.lineageId&&r.planHash===snapshot.planHash&&r.indexHash===snapshot.indexHash&&r.introductionHash===hash&&r.introductionRecordedAt!==null&&r.introductionRecordedAt>=snapshot.issuedAt&&r.looks.length===0,'stage-1 ledger append raced a look or changed the introduction');
 return store.save(copy,draft,receipt);
}
export function verifyBlind(input: PaperInput, artifact: BlindArtifact, temporal?:{receipt:LookLedgerReceipt;trust:LedgerTrust}): void {
  const { sha256, ledgerReceipt, ...body } = artifact;
  requireThat(sha256 === canonicalSha256(body) && artifact.lineageId === input.lineageId && artifact.planHash === canonicalSha256(input.lockedPlan) && artifact.indexHash === canonicalSha256(input.frozenLiteratureIndex), 'blind artifact changed or belongs to another plan/index');
  if (input.introductionRequirement === 'stage-1 introduction verified') {
    requireThat(ledgerReceipt&&temporal,'missing signed stage-1 temporal proof');
    verifyTemporalProof(input,sha256,ledgerReceipt,temporal.receipt,temporal.trust);
    requireThat(artifact.mode === 'stage-1' && input.timestamps.length > 0 && input.timestamps.every(t => record(t).stage1IntroductionHash === sha256), 'stage-1 hash absent from timestamp receipt');
  } else requireThat(artifact.mode === 'legacy-blind' || artifact.mode === 'stage-1', 'unknown blind mode');
}
