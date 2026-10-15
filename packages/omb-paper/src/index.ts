import { medicDeviations } from './medic-deviations.ts';
import { paperLiterature } from './literature.ts';
export { stage1LiteratureInput } from './literature.ts';
export {archivePhaseOutputs} from './archived-journal.ts';
import path from 'node:path';
import { openSync, closeSync, fstatSync, readSync, constants } from 'node:fs';
import { readInvestigationJournal } from './sqlite-journal.ts';
import { capLabel } from '../../omb-certify/src/degraded.ts';
import { numericAgreement } from '../../omb-certify/src/numeric.ts';
export type * from './records.ts';
export * from './derivations.ts';
import { buildFactExtensions, type FactExtensions } from './derivations.ts';
import type { PaperLockRecord, PaperLook, TimestampRecord } from './records.ts';
import { createHash } from 'node:crypto';
import { canonicalJson, canonicalSha256 } from '../../bio-core/src/index.ts';
import type { CertifiedReport } from '../../omb-certify/src/index.ts';
import { GateAuthority, SignedGateBoard } from '../../omb-certify/src/index.ts';
import { foldKey, labelClaim, parsePlan, planLockHash, FILE_CAPS } from '../../omb-gauntlet/src/index.ts';
import type { OmbStore } from '../../omb-store/src/index.ts';

export type JsonObject = Record<string, unknown>;
export type EntityKind = 'gene' | 'dataset' | 'cohort' | 'variant' | 'drug' | 'tissue' | 'population' | 'genomeBuild';
export type NumberGrade = 'kernel-recomputed' | 'worker-matches-kernel' | 'worker-disagrees-with-kernel' | 'worker-reported-unverified';

export interface VariableRecord { role: 'exposure' | 'outcome' | 'adjustment' | 'feature'; name: string; claimId: string }
export interface EntityInput { kind: EntityKind; value: string; source?: string; claimId?: string }
export interface EntityRecord extends EntityInput { id: string; canonicalForm: string; key: string; claimIds: string[]; sources: string[] }
export interface OwnerAction { action: string; at: string; actor: string; evidence?: string }
export interface EndorsementRecord { paperInputHash: string; actor: string; at: string; endorsement: 'endorsed' | 'declined'; signature: string }
export interface ContactRecord {
  required: boolean;
  status: 'not-required' | 'pending' | 'contacted' | 'replied' | 'no-reply';
  waitDays?: number;
  draftHash?: string;
  contacts?: { name: string; date: string; paperInputHash: string; reply?: string; permissionToQuote?: boolean; waitEnd?: string }[];
  /** @deprecated accepted only as an input compatibility field, immediately normalized to contacts. */
  contact?: { name: string; date: string; paperInputHash: string; reply?: string; permissionToQuote?: boolean; waitEnd?: string };
}
export interface LockEvidence { record: PaperLockRecord; receipt: string }
export interface TimestampEvidence { record: TimestampRecord; receipt: string }
export interface LineageInventoryRecord {
  schema: 'omb/paper-lineage-inventory@1';
  lineageId: string;
  certifications: { id: string; certificationSha256: string; metricsSha256: string; binding: unknown; sequence: number | null; supersedes: string | null; pass: string | null }[];
  planVersions: string[];
  looks: string[];
  claims: string[];
  timestamps: string[];
  stagerManifests: string[];
  sandboxExecutionLogs: string[];
  singletonHashes: Record<string, string>;
}
export interface LineageInventoryEvidence { record: LineageInventoryRecord; receipt: string }
export interface CertificationSource {
  id: string;
  /** A real certifyDirectory output directory. Paths are not copied into PaperInput. */
  directory: string;
  /** Optional path to the exact metrics.json consumed by certifyDirectory. */
  metricsPath?: string;
  sequence?: number;
  supersedes?: string;
  pass?: 'certify' | 'replicate' | 'route-n';
}
export interface PaperLineage {
  lineageId: string;
  inventory: LineageInventoryEvidence;
  lockedPlan: { plan: JsonObject; lock: LockEvidence };
  certifications: readonly CertificationSource[];
  planVersions: readonly unknown[];
  looks: readonly PaperLook[];
  claims: readonly unknown[];
  timestamps: readonly TimestampEvidence[];
  lookLedger: unknown;
  assumptionLedger: unknown;
  stagerManifests: readonly unknown[];
  sandboxExecutionLogs: readonly unknown[];
  environmentLock: unknown;
  frozenLiteratureIndex: unknown;
  runMetadata: unknown;
  ownerDeclarations: readonly OwnerAction[];
  contact: ContactRecord;
  entities?: readonly EntityInput[];
}
export interface PaperInputOptions {
  authority: GateAuthority;
  /** Native V5 store is mandatory: caller-provided verification callbacks are not an authority. */
  store: OmbStore;
  journalFile?: string;
}
export interface EnumeratedLineage {
  lineageId: string;
  storeEvents: ReturnType<OmbStore['events']>;
  v7Journal: JsonObject[];
  ledgerJournal: JsonObject[];
  authorityArtifacts: JsonObject[];
  locks: JsonObject[];
  looks: JsonObject[];
  claims: JsonObject[];
  gates: JsonObject[];
  amendments: JsonObject[];
  certificationOutputs: JsonObject[];
  phaseOutputs: { phase: string; sequence: number; output: JsonObject }[];
}
export function sealCertificationBody(authority: GateAuthority, binding: CertifiedReport['binding'], body: JsonObject): unknown {
  return authority.sealEvidence('omb/certification@1', binding, '*', { sha256: canonicalSha256(JSON.parse(JSON.stringify(body))) });
}
export interface GradedFact {
  id: string;
  certificationId: string;
  source: 'kernel' | 'worker';
  key: string;
  value: unknown;
  grade: NumberGrade;
  producerGate: string | null;
  claimId: string | null;
  certHash: string;
  kind: 'parameter'|'ci'|'p'|'se'|'n'|'effect'|'companion';
  unit: string | null;
  ciLevel: number | null;
  method: string | null;
  deciding: boolean;
}
export interface PlannedFound {
  primaryClaimId: string | null;
  plannedClaimIds: string[];
  found: { claimId: string; certificationId: string; status: string; classification: 'held' | 'not-held' | 'tentative' | 'undecided' | 'exploratory' | 'voided'; assessment: unknown; certifierAssessment?: unknown; lateLock: boolean }[];
  missingClaimIds: string[];
  deviations: unknown[];
  abandonedAnalyses: unknown[];
  registeredHypotheses: number;
}
export interface PaperInput {
  literatureBrief: import('../../omb-literature/src/index.ts').FrozenBrief | null;
  literatureBriefHash: string | null;
  priorKnowledge: unknown;
  noveltyCheck: unknown;
  schema: 'omb/paper-input@1';
  lineageId: string;
  lockedPlan: JsonObject;
  plainStatement: string;
  paperSet: unknown;
  lock: unknown;
  lineageInventory: LineageInventoryRecord;
  sourceRecords: EnumeratedLineage;
  terminalAnchor: JsonObject;
  ownerConfiguration: JsonObject | null;
  certifications: { id: string; sequence: number; supersedes: string | null; pass: 'certify' | 'replicate' | 'route-n' | null; certificate: CertifiedReport; metrics: unknown; metricGrades: GradedFact[] }[];
  planVersions: unknown[];
  looks: unknown[];
  claims: unknown[];
  timestamps: unknown[];
  lookLedger: unknown;
  assumptionLedger: unknown;
  stagerManifests: unknown[];
  sandboxExecutionLogs: unknown[];
  environmentLock: unknown;
  frozenLiteratureIndex: unknown;
  runMetadata: unknown;
  ownerDeclarations: OwnerAction[];
  contact: ContactRecord;
  entities: EntityRecord[];
  variables: VariableRecord[];
  paperStatus: 'draft-not-owner-approved' | 'owner-approved';
  introductionRequirement: 'stage-1 introduction verified' | 'blind pass applies';
  plannedFound: PlannedFound;
  factExtensions: FactExtensions;
  sha256: string;
}

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as JsonObject;
}
function nonempty(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`);
  return value;
}
function readJson(file: string): unknown { return JSON.parse(readBytes(file).toString('utf8')) as unknown; }
function readBytes(file: string): Buffer {
  let fd: number | undefined;
  try {
    fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    const stat=fstatSync(fd);
    if(!stat.isFile()||stat.size>FILE_CAPS.metrics)throw new Error('not a capped regular file');
    const buffer=Buffer.alloc(stat.size+1);let length=0;
    while(length<buffer.length){const n=readSync(fd,buffer,length,buffer.length-length,length);if(!n)break;length+=n;}
    if(length!==stat.size||fstatSync(fd).size!==stat.size)throw new Error('file changed while reading');
    return buffer.subarray(0,length);
  } catch {throw new Error(`refused or missing input file: ${path.basename(file)}`);}
  finally{if(fd!==undefined)closeSync(fd);}
}
const cmp = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
// events() verifies the current complete artifact inventory before enumeration. V5 artifacts are
// content-addressed and immutable, so previously verified bytes for that same store/hash are safe
// to reuse. This avoids repeating the store's full-inventory verification for every artifact.
const artifactCache=new WeakMap<OmbStore,Map<string,Buffer>>();
function storedArtifact(store:OmbStore,hash:string):Buffer {
  let cache=artifactCache.get(store);if(!cache){cache=new Map();artifactCache.set(store,cache);}
  let bytes=cache.get(hash);if(!bytes){bytes=store.artifact(hash);cache.set(hash,bytes);}
  return bytes;
}


/** Enumerate persisted V5 records and V7 journal artifacts for a lineage identifier. Store events()
 * verifies the append-only chain, artifact inventory, and host MAC before any payload is returned. */
export function enumerateLineage(store: OmbStore, lineageId: string, journalFile?: string): EnumeratedLineage {
  nonempty(lineageId, 'lineage id');
  const storeEvents = store.events();
  const v7Journal: JsonObject[] = journalFile ? readInvestigationJournal(journalFile, lineageId) : [];
  for (const event of (journalFile ? [] : storeEvents.filter(e => e.kind === 'artifact'))) {
    const ref = object(event.payload, 'artifact event');
    if (typeof ref.hash !== 'string') continue;
    let parsed: unknown;
    try { parsed = JSON.parse(storedArtifact(store,ref.hash).toString('utf8')) as unknown; } catch { continue; }
    if (!parsed || typeof parsed !== 'object' || (parsed as JsonObject).domain !== 'omb-investigate/journal/v1') continue;
    const journal = object((parsed as JsonObject).event, 'V7 journal event');
    if (journal.stream !== `inv:${lineageId}`) continue;
    v7Journal.push(journal);
  }
  v7Journal.sort((a, b) => Number(a.seq) - Number(b.seq));
  let prior: string | null = null;
  for (let i = 0; !journalFile && i < v7Journal.length; i++) {
    const entry = v7Journal[i]!;
    if (entry.seq !== i + 1 || entry.prevHash !== prior || typeof entry.hash !== 'string') throw new Error('V7 lineage journal chain is incomplete');
    const { hash, ...withoutHash } = entry;
    const base = { stream: withoutHash.stream, seq: withoutHash.seq, at: withoutHash.at, type: withoutHash.type, payload: withoutHash.payload, prevHash: withoutHash.prevHash };
    if (canonicalSha256(base) !== hash) throw new Error('V7 lineage journal hash is invalid');
    prior = hash;
  }
  let priorOutput: unknown = null;
  const seenPhases = new Set<string>();
  const phaseOrder=['question','stage','plan','plan-lock','code','dry-run','freeze','look','certify','replicate','interpret','deliverable'];
  let previousPhase=-1;
  for (const event of v7Journal.filter(e=>e.type==='phase-completed')) {
    const p=object(event.payload,'phase payload');
    if (p.prevOutputHash !== priorOutput || p.outputHash !== canonicalSha256({output:p.output,prev:priorOutput}) || seenPhases.has(String(p.phase))) throw new Error('V7 phase output chain is invalid');
    const ordinal=phaseOrder.indexOf(String(p.phase));
    if(ordinal<=previousPhase)throw new Error('V7 phase order is invalid');
    previousPhase=ordinal;seenPhases.add(String(p.phase));priorOutput=p.outputHash;
  }
  const phaseOutputs = v7Journal.flatMap(e => {
    const payload = e.payload && typeof e.payload === 'object' ? e.payload as JsonObject : {};
    const output = payload.output && typeof payload.output === 'object' ? payload.output as JsonObject : null;
    return e.type === 'phase-completed' && typeof payload.phase === 'string' && output ? [{ phase: payload.phase, sequence: Number(e.seq), output }] : [];
  });
  const stage = phaseOutputs.find(p => p.phase === 'stage')?.output;
  const staged = stage?.staged as JsonObject | undefined;
  const datasetIds = new Set([staged?.datasetId ?? stage?.datasetId]);
  for(const e of v7Journal) {const p=object(e.payload,'journal payload');if(e.type==='step-completed'&&p.name==='route-n-stage'&&p.output)datasetIds.add(object(p.output,'route N stage').datasetId);}
  const belongs = (payload: unknown): boolean => {
    if (!payload || typeof payload !== 'object') return false;
    const p = payload as JsonObject;
    return p.lineageId === lineageId || datasetIds.has(p.datasetId);
  };
  const byKind = (kind: string) => storeEvents.filter(e => e.kind === kind && belongs(e.payload)).map(e => object(e.payload, `${kind} event`));
  let certificationOutputs: JsonObject[] = phaseOutputs.filter(e => ['certify', 'replicate', 'route-n'].includes(e.phase) && e.output.certification != null).map(e => ({...e.output, phase: e.phase, journalSequence: e.sequence}));
  // Native V7 persists every kernel pass as a step, including route N, which has no
  // separate phase-level certification field. Those receipts also preserve actual pass order.
  const stepPasses: Record<string,string> = {'certify':'certify','certify-g7':'replicate','route-n-certify':'route-n'};
  const steps=v7Journal.flatMap(e=>{const p=object(e.payload,'step payload');if(e.type!=='step-completed'||!stepPasses[String(p.name)]||p.output==null)return [];const c=object(p.output,'certification step');return typeof c.report==='string'&&Array.isArray(c.claims)?[{certification:c,phase:stepPasses[String(p.name)]!,journalSequence:Number(e.seq)}]:[];});
  if(steps.length) {
    for(const phase of certificationOutputs) if(!steps.some(s=>s.phase===phase.phase&&canonicalSha256(s.certification.report)===canonicalSha256(object(phase.certification,'phase certification').report)))throw new Error('V7 phase certification has no matching step receipt');
    certificationOutputs=steps;
  }
  const authorityArtifacts:JsonObject[]=[];
  const ledgerJournal=readStoreJournal(store,'ledger',authorityArtifacts);
  return { lineageId, storeEvents, v7Journal, ledgerJournal, authorityArtifacts, locks: byKind('lock'), looks: byKind('look'), claims: byKind('claim'), gates: byKind('gate'), amendments: storeEvents.filter(e=>e.kind==='amendment'&&belongs(e.payload)).map(e=>({...object(e.payload,'amendment'),time_ms:e.time})), certificationOutputs, phaseOutputs };

}
function readStoreJournal(store: OmbStore, stream: string, authorityArtifacts: JsonObject[]): JsonObject[] {
  const rows: JsonObject[] = [];
  for(const e of store.events().filter(e=>e.kind==='artifact')) {
    const bytes=storedArtifact(store,String(object(e.payload,'artifact').hash));
    let value: JsonObject;try{value=JSON.parse(bytes.toString('utf8')) as JsonObject;}catch{continue;}
    if(value?.record && typeof value.record==='object' && ['omb-investigate/terminal-anchor@1','omb-paper/owners@1','omb-paper/draft@1'].includes(String((value.record as JsonObject).domain)))authorityArtifacts.push(value);
    if(value?.domain==='omb-investigate/journal/v1' && (value.event as JsonObject)?.stream===stream) rows.push(object(value.event,'journal event'));
  }
  rows.sort((a,b)=>Number(a.seq)-Number(b.seq));let prior:unknown=null;
  for(const [i,e] of rows.entries()) {const {hash,...body}=e;if(e.seq!==i+1||e.prevHash!==prior)throw new Error('V7 ledger journal chain is incomplete');if(canonicalSha256(body)!==hash)throw new Error('V7 ledger journal hash is invalid');prior=hash;}
  return rows;
}


export function recordOwnerConfiguration(store: OmbStore, investigationId: string, ownerActor: string, actors: readonly string[] = [ownerActor]): string {
  nonempty(investigationId,'investigation ID');nonempty(ownerActor,'owner actor');
  if(!actors.includes(ownerActor)||actors.some(a=>typeof a!=='string'||!a.trim()))throw new Error('invalid owner configuration');
  const record={domain:'omb-paper/owners@1',investigationId,ownerActor,actors:[...new Set(actors)].sort(cmp)};
  return store.putArtifact(Buffer.from(canonicalJson({record,receipt:store.authorityReceipt(record)})));
}

function authorityRecords(store: OmbStore, lineageRecords: EnumeratedLineage, domain: string, lineageId: string): JsonObject[] {
  const records: JsonObject[] = [];
  for (const value of lineageRecords.authorityArtifacts) {
    const record=value?.record as JsonObject | undefined;
    if(record?.domain!==domain || record.investigationId!==lineageId)continue;
    if(typeof value.receipt!=='string'||!store.verifyAuthority(record,value.receipt))throw new Error(`${domain} authority receipt is invalid`);
    records.push(record);
  }
  return records;
}
function verifyTerminalAnchor(records: EnumeratedLineage, store: OmbStore): JsonObject {
  const head=records.v7Journal.at(-1);
  if(!head || head.type!=='phase-completed' || object(head.payload,'terminal payload').phase!=='deliverable')throw new Error('investigation has no terminal deliverable');
  const anchors=authorityRecords(store,records,'omb-investigate/terminal-anchor@1',records.lineageId);
  if(anchors.length!==1)throw new Error('terminal journal anchor missing or ambiguous');
  const anchor=anchors[0]!;
  if(anchor.headSequence!==head.seq || anchor.headEventHash!==head.hash)throw new Error('terminal journal anchor head mismatch');
  const certifications=records.certificationOutputs.map(e=>({pass:e.phase,reportHash:canonicalSha256(object(e.certification,'certification').report)}));
  if(canonicalJson(anchor.certifications)!==canonicalJson(certifications))throw new Error('terminal journal anchor certification list mismatch');
  return anchor;
}

function flattenLeaves(value: unknown, prefix: string | null = null): [string, unknown][] {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const out: [string, unknown][] = [];
    const keys = Object.keys(value);
    if (!keys.length && prefix !== null) return [[prefix, null]];
    for (const key of keys.sort(cmp)) out.push(...flattenLeaves((value as JsonObject)[key], prefix !== null ? `${prefix}.${key}` : key));
    return out;
  }
  if (Array.isArray(value)) return value.length ? value.flatMap((v, i) => flattenLeaves(v, prefix !== null ? `${prefix}.${i}` : String(i))) : prefix !== null ? [[prefix, null]] : [['[]', null]];
  return prefix !== null ? [[prefix, value]] : [];
}
function planClaimIds(plan: JsonObject): string[] {
  const claims = plan.claims;
  if (!Array.isArray(claims)) throw new Error('locked plan claims are missing');
  const ids = claims.map((c, i) => foldKey(nonempty(object(c, `claim ${i}`).id, `claim ${i} id`)));
  if (new Set(ids).size !== ids.length) throw new Error('duplicate locked claim id');
  return ids;
}
function requiredPaperSet(paperSet: unknown): { certifications: string[]; claims: string[] } {
  if (!Array.isArray(paperSet) || paperSet.length === 0 || !paperSet.every(v => typeof v === 'string' && v.trim())) throw new Error('locked paper_set must be a folded claim-id array');
  const claims = paperSet.map(v => foldKey(v as string));
  if (new Set(claims).size !== claims.length) throw new Error('paper_set has folded claim-id collisions');
  return { certifications: [], claims };
}
function statusForClaim(certificate: CertifiedReport, claimId: string): string | null {
  return certificate.certification.assessments.find(a => a.claimId === claimId)?.status ?? null;
}
function normalizeMetricGrade(certificationId: string, cert: CertifiedReport, metrics: unknown, bodySealed: boolean, plan: ReturnType<typeof parsePlan>['plan']): GradedFact[] {
  const table = bodySealed ? cert.certification.metrics?.values : {};
  const flatten = (value: unknown) => {
    const out = new Map<string, unknown>();
    for (const [raw, v] of flattenLeaves(value)) {
      const key = foldKey(raw);
      if (out.has(key) && canonicalJson(out.get(key)) !== canonicalJson(v)) throw new Error(`metric key collision: ${key}`);
      out.set(key, v);
    }
    return out;
  };
  const kernel = flatten(table), worker = flatten(metrics), certHash = canonicalSha256(cert);
  const claims = cert.certification.assessments.map(a => foldKey(a.claimId));
  const facts: GradedFact[] = [];
  for (const [source, rows] of [['kernel', kernel], ['worker', worker]] as const) for (const [key, value] of rows) {
    const claimId = claims.filter(id => key === id || key.startsWith(`${id}.`)).sort((a,b) => b.length-a.length)[0] ?? null;
    if (claimId && key.slice(claimId.length + 1).split('.').some(part => claims.includes(part))) throw new Error(`cross-claim metric rebinding: ${key}`);
    const trusted = kernel.get(key);
    const matching = kernel.has(key) && (typeof value === 'number' && typeof trusted === 'number' ? numericAgreement(value, trusted) : canonicalJson(value) === canonicalJson(trusted));
    const grade: NumberGrade = source === 'kernel' ? 'kernel-recomputed' : kernel.has(key) ? matching ? 'worker-matches-kernel' : 'worker-disagrees-with-kernel' : 'worker-reported-unverified';
    const kind = /(^|\.)(alpha|nullvalue|mei|threshold|seed|df)$/u.test(key) ? 'parameter' : /(^|\.)(ci|interval)(\.|$)/u.test(key) ? 'ci' : /(^|\.)p(_adjusted)?$/u.test(key) ? 'p' : /(^|\.)se$/u.test(key) ? 'se' : /(^|\.)n(_units)?$/u.test(key) ? 'n' : /(^|\.)estimate$/u.test(key) ? 'effect' : 'companion';
    const procedure = cert.procedures?.[claimId ?? ''], result = cert.procedureResults?.[claimId ?? ''];
    // Registered intervals invert the directional decision rule; legacy software intervals are
    // two-sided 95%, regardless of the directional decision alpha.
    const ciLevel = kind !== 'ci' ? null : result?.status === 'ok' ? 1-result.alpha : 0.95;
    facts.push({ id:canonicalSha256([certificationId,source,key]), certificationId, source, key, value, grade, producerGate: source === 'kernel' ? 'certifier-seal' : null,
      claimId, certHash, kind, unit: null, ciLevel, method: procedure?.procedureId ?? result?.procedure ?? cert.kernel?.[claimId ?? '']?.scheme ?? null,
      deciding: source === 'kernel' && claimId !== null && (kind === 'effect' || kind === 'p') });
  }
  return facts.sort((a,b) => cmp(a.key,b.key) || cmp(a.source,b.source));
}
interface CertificationSnapshot { certBytes: Buffer; metricsBytes: Buffer }
function readCertification(source: CertificationSource, authority: GateAuthority, lockedPlan: ReturnType<typeof parsePlan>['plan'], snapshot: CertificationSnapshot): { certificate: CertifiedReport; metrics: unknown; bodySealed: boolean; certBytes: Buffer; metricsBytes: Buffer } {
  const { certBytes, metricsBytes } = snapshot;
  const certRaw = object(JSON.parse(certBytes.toString('utf8')) as unknown, 'certification.json');
  const certificate = certRaw as unknown as CertifiedReport;
  if (!certificate.binding || !Array.isArray(certificate.gates) || !certificate.certification?.assessments) throw new Error(`invalid certification output: ${source.id}`);
  const { certificationSeal, ...body } = certRaw;
  const sealBody = authority.verifyEvidence(certificationSeal, 'omb/certification@1', certificate.binding, '*');
  const bodySealed = !!sealBody && sealBody.sha256 === canonicalSha256(body);
  if (!bodySealed) throw new Error(`certification body seal missing or invalid: ${source.id}`);
  if (!certificate.gates.length) throw new Error(`unsigned or empty gate board: ${source.id}`);
  for (const gate of certificate.gates) if (!authority.verify(gate, certificate.binding)) throw new Error(`unsigned or invalid gate: ${source.id}`);
  const board = new SignedGateBoard(certificate.gates, certificate.binding, authority);
  if (board.rejected) throw new Error(`unsigned gate board: ${source.id}`);
  const hardStops=certRaw.hardStops;
  if(!Array.isArray(hardStops)||!hardStops.every(v=>typeof v==='string'))throw new Error('sealed hard-stop context missing or invalid');
  for (const assessment of certificate.certification.assessments) {
    const claimId = foldKey(assessment.claimId);
    const claim = lockedPlan?.claims.find(c => c.id === claimId) ?? null;
    let rebuilt = labelClaim({ claimId, claim, decision: assessment.decision, board, hardStops });
    const caps = object(certRaw.labelCaps, 'sealed label caps')[claimId];
    if (!Array.isArray(caps) || !caps.every(c => typeof c === 'string')) throw new Error('sealed label caps missing');
    if (caps.length) rebuilt = capLabel(rebuilt, caps);
    if (rebuilt.status !== assessment.status || rebuilt.taskStatus !== assessment.taskStatus || rebuilt.voided !== assessment.label?.voided) throw new Error(`certification label mismatch: ${source.id}:${claimId}`);
    // Global gates resolve through the same board lookup as the certifier. Optional replication
    // and simulation gates are authenticated by the body seal, never invented by PW0.
    const present = new Set(board.results.filter(g => g.claimId === claimId || g.claimId === null || g.claimId === undefined).map(g => g.gate));
    if ((!claim || claim.kind === 'data-integrity' || claim.kind === 'citation' ? ['G1','G2'] : ['G1','G2','G3','G4']).some(g => !present.has(g as never))) throw new Error(`incomplete gate set: ${source.id}:${claimId}`);
  }
  if (source.metricsPath) throw new Error('metricsPath is forbidden: use the certificate-bound worker output');
  const unscored = object(JSON.parse(metricsBytes.toString('utf8')) as unknown, 'worker-output-unscored.json');
  if (certRaw.workerOutputSha256 !== canonicalSha256(unscored)) throw new Error('worker output differs from certifier seal');
  const metrics = unscored.metrics === null || unscored.metrics === undefined ? {} : unscored.metrics;
  if (!metrics || typeof metrics !== 'object') throw new Error('worker metrics must be a JSON object or array');
  return { certificate, metrics, bodySealed, certBytes, metricsBytes };
}

export function createLineageInventoryRecord(lineage: Omit<PaperLineage, 'inventory'>, snapshots?: ReadonlyMap<string, CertificationSnapshot>): LineageInventoryRecord {
  const hashes = (values: readonly unknown[]) => values.map(value => canonicalSha256(value)).sort();
  const certifications = lineage.certifications.map(source => {
    if (source.metricsPath) throw new Error('metricsPath is forbidden in lineage inventory');
    const snapshot = snapshots?.get(source.id);
    const certBytes = snapshot?.certBytes ?? readBytes(path.join(source.directory, 'certification.json'));
    const metricsBytes = snapshot?.metricsBytes ?? readBytes(path.join(source.directory, 'worker-output-unscored.json'));
    const cert = object(JSON.parse(certBytes.toString('utf8')) as unknown, 'certification.json');
    return { id: source.id, certificationSha256: createHash('sha256').update(certBytes).digest('hex'), metricsSha256: createHash('sha256').update(metricsBytes).digest('hex'), binding: cert.binding ?? null, sequence: source.sequence ?? null, supersedes: source.supersedes ?? null, pass: source.pass ?? null };
  }).sort((a, b) => cmp(a.id, b.id) || cmp(a.certificationSha256, b.certificationSha256));
  return {
    schema: 'omb/paper-lineage-inventory@1', lineageId: lineage.lineageId,
    certifications, planVersions: hashes(lineage.planVersions), looks: hashes(lineage.looks), claims: hashes(lineage.claims),
    timestamps: hashes(lineage.timestamps.map(t => t.record)), stagerManifests: hashes(lineage.stagerManifests), sandboxExecutionLogs: hashes(lineage.sandboxExecutionLogs),
    singletonHashes: {
      lockedPlan: canonicalSha256(lineage.lockedPlan), lookLedger: canonicalSha256(lineage.lookLedger), assumptionLedger: canonicalSha256(lineage.assumptionLedger),
      environmentLock: canonicalSha256(lineage.environmentLock), frozenLiteratureIndex: canonicalSha256(lineage.frozenLiteratureIndex), runMetadata: canonicalSha256(lineage.runMetadata),
      ownerDeclarations: canonicalSha256(lineage.ownerDeclarations), contact: canonicalSha256(lineage.contact), entities: canonicalSha256(buildEntityRecords(lineage.entities ?? [])),
    },
  };
}

export function canonicalEntityForm(kind: EntityKind, value: string): string {
  const clean = value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
  if (!clean) throw new Error('entity canonical form is empty');
  if (kind === 'gene') return clean;
  if (kind === 'variant') return /^rs\d+$/iu.test(clean) ? `rs${clean.slice(2)}` : clean;
  if (kind === 'dataset') return clean.toUpperCase();
  if (kind === 'genomeBuild') return clean.toLowerCase();
  return clean;
}
export function buildEntityRecords(inputs: readonly EntityInput[] = []): EntityRecord[] {
  const records = [...inputs].sort((a,b) => cmp(canonicalJson(a),canonicalJson(b))).map(input => {
    if (!['gene', 'dataset', 'cohort', 'variant', 'drug', 'tissue', 'population', 'genomeBuild'].includes(input.kind)) throw new Error('unknown entity kind');
    nonempty(input.value, 'entity value');
    const canonicalForm = canonicalEntityForm(input.kind, input.value);
    const key = `${input.kind}:${canonicalForm}`;
    return { ...input, ...(input.claimId?{claimId:foldKey(input.claimId)}:{}), value: canonicalForm, canonicalForm, key, claimIds: input.claimId ? [foldKey(input.claimId)] : [], sources: input.source ? [input.source] : [], id: canonicalSha256([input.kind, canonicalForm]) };
  });
  const byId = new Map<string, EntityRecord>();
  for (const record of records) {
    const prior = byId.get(record.id);
    const sources = prior ? [...new Set([...prior.sources, ...record.sources])].sort(cmp) : record.sources;
    const deterministicSource = sources[0];
    if (prior) {
      const merged = { ...prior, claimIds: [...new Set([...prior.claimIds, ...record.claimIds])].sort(cmp), sources };
      if (merged.claimIds.length) merged.claimId=merged.claimIds[0]!; else delete merged.claimId;
      if (deterministicSource) merged.source = deterministicSource; else delete merged.source;
      byId.set(record.id, merged);
    } else byId.set(record.id, { ...record, ...(deterministicSource ? { source: deterministicSource } : {}) });
  }
  return [...byId.values()].sort((a, b) => cmp(a.kind, b.kind) || cmp(a.canonicalForm, b.canonicalForm));
}
export function validateOwnerDeclarations(actions: readonly OwnerAction[]): OwnerAction[] {
  const allowed = new Set(['approved-question', 'approved-plan', 'reran-analysis', 'blind-citation-verdict', 'wrote-interpretation', 'comprehension-check', 'contacted-authors', 'endorsed']);
  const out = actions.map(a => {
    if (!allowed.has(a.action) || !isStrictUtc(a.at)) throw new Error('invalid owner declaration');
    nonempty(a.actor, 'declaration actor');
    if (a.action === 'reran-analysis' || a.action === 'blind-citation-verdict' || a.action === 'comprehension-check') {
      const evidence = a.evidence;
      if (typeof evidence !== 'string' || !/^[a-f0-9]{64}$/u.test(evidence)) throw new Error(`${a.action} requires sha256 evidence`);
    }
    if (a.action === 'endorsed') throw new Error('endorsement is bound to a final PaperInput and cannot be embedded in input declarations');
    return structuredClone(a);
  });
  if (out.some((a, i) => i > 0 && Date.parse(out[i - 1]!.at) > Date.parse(a.at))) throw new Error('owner declarations must be timestamp ordered');
  return out;
}
function isStrictUtc(value: string): boolean {
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/u.test(value)) return false;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && new Date(ms).toISOString().replace('.000Z', 'Z') === value.replace('.000Z', 'Z');
}
export function validateContactRecord(contact: ContactRecord, lineageHash?: string): ContactRecord {
  if (!contact || !['not-required', 'pending', 'contacted', 'replied', 'no-reply'].includes(contact.status) || typeof contact.required !== 'boolean') throw new Error('invalid contact record');
  if (contact.required && contact.status === 'not-required' || !contact.required && contact.status !== 'not-required') throw new Error('contact status conflicts with required flag');
  const contacts = contact.contacts ?? (contact.contact ? [contact.contact] : []);
  if (contacts.length && (!contact.draftHash || !/^[a-f0-9]{64}$/u.test(contact.draftHash))) throw new Error('contact record must bind a prior draft hash');
  if (contact.required && contacts.length === 0 && contact.status !== 'pending') throw new Error('contact action details are required');
  const waitDays = contact.waitDays ?? 21;
  if (!Number.isSafeInteger(waitDays) || waitDays < 1 || waitDays > 365) throw new Error('contact waitDays is invalid');
  for (const c of contacts) {
    nonempty(c.name, 'contact name');
    if (!isStrictUtc(c.date)) throw new Error('contact date must be strict UTC');
    if (!/^[a-f0-9]{64}$/u.test(c.paperInputHash)) throw new Error('contact paperInputHash must be sha256');
    const expectedHash = lineageHash ?? contact.draftHash;
    if (expectedHash && c.paperInputHash !== expectedHash) throw new Error('contact record is bound to a different draft');
    if (contact.status === 'replied' && !c.reply) throw new Error('reply text or summary is required');
    if (contact.status === 'no-reply' && (!c.waitEnd || !isStrictUtc(c.waitEnd) || Date.parse(c.waitEnd) < Date.parse(c.date) + waitDays * 86_400_000)) throw new Error('no-reply requires a valid completed wait period');
  }
  const normalized = { ...structuredClone(contact), contacts, waitDays };
  delete (normalized as ContactRecord).contact;
  return normalized;
}
/** Endorsements are separate post-draft records and are never embedded in PaperInput. */
export function validateEndorsementRecord(record: EndorsementRecord, finalPaperInputHash: string): EndorsementRecord {
  if (!record || record.paperInputHash !== finalPaperInputHash || !/^[a-f0-9]{64}$/u.test(finalPaperInputHash)) throw new Error('endorsement is bound to a different PaperInput');
  nonempty(record.actor, 'endorsement actor');
  if (!isStrictUtc(record.at) || !['endorsed', 'declined'].includes(record.endorsement) || !/^[a-f0-9]{64}$/u.test(record.signature)) throw new Error('invalid endorsement record');
  throw new Error('endorsement verification key is unavailable');
}
function makePlannedFound(plan: JsonObject, paperSet: unknown, certificates: PaperInput['certifications'], lineageClaims: readonly unknown[], planVersions: readonly unknown[], logs: readonly unknown[], storeAmendments: readonly unknown[] = [], registeredHypotheses = 0, looks: readonly unknown[] = []): PlannedFound {
  const expected = requiredPaperSet(paperSet), ids = planClaimIds(plan);
  for (const id of expected.claims) if (!ids.includes(id)) throw new Error(`paper_set names unknown claim: ${id}`);
  let plannedClaimIds = ids.filter(id => expected.claims.includes(foldKey(id)));
  const assessments = certificates.flatMap(c => c.certificate.certification.assessments.map(assessment => ({ claimId: foldKey(assessment.claimId), certificationId: c.id, sequence: c.sequence, supersedes: c.supersedes, status: assessment.status, assessment, lateLock: c.certificate.gates.some(g => g.result.gate === 'G2' && g.result.outcome === 'failed') })));
  const demoted=new Set(assessments.filter(a=>a.lateLock).map(a=>a.claimId));
  plannedClaimIds=plannedClaimIds.filter(id=>!demoted.has(id));
  const found = plannedClaimIds.flatMap(id => {
    const rows = assessments.filter(a => a.claimId === foldKey(id)).sort((a, b) => a.sequence - b.sequence);
    if (!rows.length) return [];
    for (let i = 1; i < rows.length; i++) if (rows[i]!.sequence <= rows[i - 1]!.sequence || rows[i]!.supersedes !== rows[i - 1]!.certificationId) throw new Error(`claim certification supersession is missing or unordered: ${id}`);
    const a = rows.at(-1)!;
    const classification: PlannedFound['found'][number]['classification'] = demoted.has(id) ? 'exploratory' : a.assessment.label.voided === true ? 'voided' : a.status === 'confirmed' || a.status === 'replicated' ? 'held' : a.status === 'refuted' ? 'not-held' : a.status === 'exploratory' ? 'exploratory' : a.status === 'tentative' ? 'tentative' : 'undecided';
    return [{ ...a, supersessionChain:rows.map(r=>r.certificationId), classification, reason: a.lateLock ? 'Certifier G2 failed: plan was not locked before the first look' : a.assessment.decision.reason, looks: looks.length }];
  });
  const foundIds = new Set(found.map(a => a.claimId));
  const abandonedAnalyses = ids.filter(id => !assessments.some(a => a.claimId === id)).map(claimId => ({claimId, reason:'Locked analysis has no certification'}));
  const earliestLook = Math.min(...looks.map(v => {const row=object(v,'look'),r=row.record ? object(row.record,'look record'):row;return typeof r.time_ms === 'number'?r.time_ms:typeof r.at === 'number'?r.at:Date.parse(String(r.at));}));
  const amendments = [...storeAmendments, ...planVersions.flatMap(v => { const o = v && typeof v === 'object' ? v as JsonObject : {}; return Array.isArray(o.amendments) ? o.amendments : []; })].sort((a, b) => cmp(canonicalJson(a), canonicalJson(b))).map(a => {
    const o = a && typeof a === 'object' ? a as JsonObject : {};
    return { ...o, changes: Array.isArray(o.changes)?o.changes:[], reason: typeof o.reason === 'string' && o.reason.trim() ? o.reason : 'No reason was recorded at the time of the change', postFirstLook: (typeof o.time_ms === 'number' ? o.time_ms : Date.parse(String(o.at))) > earliestLook };
  });
  for (const amendment of amendments) for (const change of Array.isArray(amendment.changes)?amendment.changes:[]) { const c=object(change,'amendment change');if(c.kind==='abandon-analysis' && typeof c.claimId==='string')abandonedAnalyses.push({claimId:foldKey(c.claimId),reason:amendment.reason}); }
  const exploratoryIds=[...new Set([...ids,...assessments.map(a=>a.claimId)])].filter(id=>!plannedClaimIds.includes(id));
  const exploratory = exploratoryIds.flatMap(id=>{
    const rows=assessments.filter(a=>a.claimId===id).sort((a,b)=>a.sequence-b.sequence),a=rows.at(-1);
    if (!a) return [];
    const reason = 'Certifier G2 failed: plan was not locked before the first look';
    // The display assessment must agree with the lineage-wide demotion. Preserve the
    // signed final-pass assessment separately, for audit rather than Results labels.
    const demotion = demoted.has(id) ? {
      lateLock: true, status: 'exploratory', reason, certifierAssessment: a.assessment,
      assessment: {status: 'exploratory', label: {status: 'exploratory'}, reason},
    } : {};
    return [{...a,supersessionChain:rows.map(r=>r.certificationId),classification:'exploratory' as const,...demotion}];
  });
  const rawClaims = plan.claims as JsonObject[];
  const primary = rawClaims.find(c => c.primary === true && plannedClaimIds.includes(foldKey(String(c.id)))) ?? rawClaims.find(c => !c.exploratory && plannedClaimIds.includes(foldKey(String(c.id))));
  return { primaryClaimId: primary ? foldKey(String(primary.id)) : null, plannedClaimIds, found: [...found, ...exploratory], missingClaimIds: plannedClaimIds.filter(id => !foundIds.has(foldKey(id))), deviations: amendments, abandonedAnalyses, registeredHypotheses: registeredHypotheses-rawClaims.filter(c=>!c.exploratory&&demoted.has(foldKey(String(c.id)))).length };
}

/** Assemble from host-enumerated lineage evidence. Enumeration is explicit and every trust-bearing
 * record is verified before it enters the canonical, path-free value. */
export function buildPaperInput(lineage: PaperLineage, options: PaperInputOptions): PaperInput {
  nonempty(lineage.lineageId, 'lineage id');
  if (!Array.isArray(lineage.certifications) || lineage.certifications.length === 0) throw new Error('lineage has no certifications');
  if (new Set(lineage.certifications.map(c => c.id)).size !== lineage.certifications.length) throw new Error('duplicate certification id');
  if (!lineage.planVersions.length || !lineage.looks.length || !lineage.claims.length || !lineage.timestamps.length || !lineage.stagerManifests.length || !lineage.sandboxExecutionLogs.length) throw new Error('lineage evidence is incomplete');
  object(lineage.lookLedger, 'look ledger'); object(lineage.assumptionLedger, 'assumption ledger'); object(lineage.environmentLock, 'environment lock'); object(lineage.frozenLiteratureIndex, 'frozen literature index'); object(lineage.runMetadata, 'run metadata');
  const snapshots = new Map(lineage.certifications.map(source => [source.id, {
    certBytes: readBytes(path.join(source.directory, 'certification.json')),
    metricsBytes: readBytes(path.join(source.directory, 'worker-output-unscored.json')),
  }]));
  const storeLineage = enumerateLineage(options.store, lineage.lineageId, options.journalFile);
  const phases = storeLineage.phaseOutputs;
  const lockOutput = phases.find(p => p.phase === 'plan-lock')?.output;
  const storedPlan = parsePlan(lineage.lockedPlan.plan);
  if (!lockOutput || storedPlan.status !== 'accepted' || !storedPlan.plan || lockOutput.planHash !== planLockHash(storedPlan.plan)) throw new Error('V7 store is missing or conflicts with the plan lock');
  const nativeLock = storeLineage.locks.map(e => object(e.record, 'native lock')).find(r => r.stage === 'L4-plan-lock');
  const compatibility = storeLineage.ledgerJournal.find(e => e.type === 'plan-locked' && object(e.payload,'ledger lock').investigationId === lineage.lineageId);
  let request: JsonObject, lock: JsonObject;
  const v7Lock = object(lockOutput.lock, 'V7 plan lock');
  if (nativeLock) {
    if (canonicalJson(nativeLock) !== canonicalJson(lineage.lockedPlan.lock.record)) throw new Error('native L4 lock differs from supplied lock');
    const artifact = object(JSON.parse(storedArtifact(options.store,String(nativeLock.plan_hash)).toString('utf8')), 'L4 plan artifact');
    request = object(artifact.v7, 'native V7 lock request');
    const entry = storeLineage.locks.find(e => (e.record as JsonObject).stage === 'L4-plan-lock')!;
    if (v7Lock.sequence !== nativeLock.sequence || v7Lock.hash !== entry.hash) throw new Error('V5/V7 lock receipt mismatch');
    lock = {...nativeLock, plain_statement:artifact.plain_statement,paper_set:artifact.paper_set,approval_actor:request.approvalActor};
  } else {
    if (!compatibility || canonicalJson(compatibility) !== canonicalJson(lineage.lockedPlan.lock.record)) throw new Error('authenticated V5 lock record is missing or differs');
    request=object(compatibility.payload,'compatibility lock request');
    if(v7Lock.sequence!==compatibility.seq||v7Lock.hash!==compatibility.hash)throw new Error('V5/V7 lock receipt mismatch');
    lock={stage:'L4-plan-lock',sequence:compatibility.seq,time_ms:compatibility.at,plain_statement:request.plainStatement,paper_set:request.paperSet,approval_actor:request.approvalActor};
  }
  if (request.investigationId !== lineage.lineageId || request.planHash !== planLockHash(storedPlan.plan)) throw new Error('plan hash mismatch between parsed plan and locked artifact');
  if (canonicalJson(lockOutput.paperSet) !== canonicalJson(lock.paper_set) || lockOutput.plainStatement !== lock.plain_statement || lockOutput.approvalActor !== request.approvalActor) throw new Error('V5/V7 lock record differs from verified artifact');
  const literature = paperLiterature(storeLineage.ledgerJournal, lineage.lineageId, request);
  const nativeLooks = nativeLock ? storeLineage.looks : storeLineage.ledgerJournal.filter(e=>e.type==='look-recorded'&&object(e.payload,'look').investigationId===lineage.lineageId);
  if (storeLineage.certificationOutputs.length !== lineage.certifications.length) throw new Error('V5 lineage store certification inventory is incomplete');
  const lookOutput = phases.find(p => p.phase === 'look')?.output;
  const routeN = phases.find(p=>p.phase==='replicate')?.output.routeN as JsonObject | undefined;
  const journalLooks = [...(lookOutput && Array.isArray(lookOutput.looks) ? lookOutput.looks : []),...(routeN?.look ? [routeN.look] : [])];
  if (journalLooks.length !== lineage.looks.length || nativeLooks.length !== lineage.looks.length) throw new Error('V5 lineage store look inventory is incomplete');
  const sorted = (xs: readonly unknown[]) => [...xs].map(v => canonicalJson(v)).sort(cmp);
  if (canonicalJson(sorted(lineage.looks)) !== canonicalJson(sorted(nativeLooks))) throw new Error('native looks differ from supplied lineage');
  if (journalLooks.some(v => { const j = object(v,'journal look'); return !nativeLooks.some(l => l.hash === j.hash && (nativeLock ? object(l.record,'look record').sequence : l.seq) === j.sequence); })) throw new Error('V5/V7 look records differ from supplied lineage');
  const ledger = object(lineage.lookLedger, 'look ledger');
  if (!Array.isArray(ledger.records) || canonicalJson(sorted(ledger.records)) !== canonicalJson(sorted(lineage.looks))) throw new Error('look ledger differs from looks');
  const expectedInventory = createLineageInventoryRecord(lineage, snapshots);
  if (canonicalJson(lineage.inventory.record) !== canonicalJson(expectedInventory) || !options.store.verifyAuthority(lineage.inventory.record, lineage.inventory.receipt))
    throw new Error('lineage inventory is incomplete or unverifiable');
  if (!options.store.verifyAuthority(lineage.lockedPlan.lock.record, lineage.lockedPlan.lock.receipt)) throw new Error('plan lock is unverifiable');
  if (lineage.timestamps.some(t => !options.store.verifyAuthority(t.record, t.receipt))) throw new Error('timestamp receipt is unverifiable');
  const planRaw = structuredClone(object(lineage.lockedPlan.plan, 'locked plan'));
  const parsed = parsePlan(planRaw);
  if (parsed.status !== 'accepted' || !parsed.plan) throw new Error('locked plan is not parseable');
  const plan = planRaw;
  if (lock.stage !== 'L4-plan-lock') throw new Error('plan lock must be L4-plan-lock');
  const plainStatement = nonempty(lock.plain_statement, 'verified lock plain_statement');
  const paperSet = lock.paper_set;
  if (canonicalJson(paperSet) !== canonicalJson(parsed.plan.paperSet)) throw new Error('locked plan paper_set differs from verified lock record');
  if ((plan.plain_statement ?? plan.plainStatement) !== plainStatement) throw new Error('locked plan plain_statement differs from verified lock record');
  const paperRequirements = requiredPaperSet(paperSet);
  const lockedClaimIds = parsed.plan.claims.map(c => c.id);
  for (const id of paperRequirements.certifications) if (!lineage.certifications.some(c => c.id === id)) throw new Error(`paper_set certification missing: ${id}`);
  for (const id of paperRequirements.claims) if (!lockedClaimIds.includes(id)) throw new Error(`paper_set names unknown claim: ${id}`);
  const lockedPlanHash = request.planHash;
  const parsedHash = planLockHash(parsed.plan);
  if (lockedPlanHash !== parsedHash) throw new Error('plan hash mismatch between parsed plan and L4 lock');
  const lockSequence = Number(lock.sequence);
  if (!Number.isSafeInteger(lockSequence) || lockSequence < 1) throw new Error('L4 lock sequence is missing');
  const lookSequences = lineage.looks.map(value => {
    const row = object(value, 'look record'), nested = row.record && typeof row.record === 'object' ? row.record as JsonObject : {};
    return Number(row.sequence ?? nested.sequence ?? row.seq);
  });
  if (lookSequences.some(seq => !Number.isSafeInteger(seq))) throw new Error('invalid look sequence');
  const ledgerLateLock=lookSequences.some(seq=>seq<=lockSequence);
  const firstLookSequence=Math.min(...lookSequences);
  const lockAt = Number(lock.time_ms);
  const cutover = Date.parse('2026-10-12T00:00:00Z');
  const timestampRecords = lineage.timestamps.map(t => object(t.record, 'timestamp receipt record'));
  if (timestampRecords.some(t => t.planHash !== parsedHash || typeof t.at !== 'string' || !isStrictUtc(t.at) || Date.parse(t.at) > lockAt)) throw new Error('timestamp receipt does not cover plan before lock');
  if (lockAt >= cutover && timestampRecords.some(t => typeof t.stage1IntroductionHash !== 'string' || !/^[a-f0-9]{64}$/u.test(t.stage1IntroductionHash))) throw new Error('timestamp receipt does not cover stage-1 introduction');
  const lockActor = lock.approval_actor;
  if(lockActor !== 'owner' && lockActor !== 'policy')throw new Error('unknown lock approval actor');
  const ownerConfigs=authorityRecords(options.store,storeLineage,'omb-paper/owners@1',lineage.lineageId);
  if(ownerConfigs.length>1)throw new Error('owner configuration is ambiguous');
  const ownerConfiguration=ownerConfigs[0]??null;
  const allowedActors=new Set(ownerConfiguration && Array.isArray(ownerConfiguration.actors)?ownerConfiguration.actors:[]);
  if (lineage.ownerDeclarations.some(a => !allowedActors.has(a.actor))) throw new Error('owner declaration actor is not authorized by the receipted owner configuration');
  const approval = lineage.ownerDeclarations.find(a => a.action === 'approved-plan');
  if(approval && approval.actor!==ownerConfiguration?.ownerActor)throw new Error('approved-plan actor differs from lock approver / designated owner');
  const ownerApproved=!!approval && approval.actor===ownerConfiguration?.ownerActor && isStrictUtc(approval.at) && Date.parse(approval.at)<=lockAt;
  if(!Number.isFinite(lockAt) || (lockActor==='owner'&&!ownerApproved))throw new Error('approved-plan declaration must precede the L4 lock');
  const evidenceTypes: Record<string,string> = { 'reran-analysis': 'analysis-rerun', 'blind-citation-verdict': 'citation-verdict', 'comprehension-check': 'comprehension-check', 'wrote-interpretation':'owner-interpretation', 'contacted-authors':'author-contact' };
  const evidenceRecords = [...lineage.sandboxExecutionLogs, ...lineage.planVersions, ...timestampRecords].map(v => object(v,'typed evidence'));
  if (lineage.ownerDeclarations.some(a => a.evidence && (typeof evidenceTypes[a.action] !== 'string' || !evidenceRecords.some(e => e.type === evidenceTypes[a.action] && e.sha256 === a.evidence)))) throw new Error('owner declaration evidence type/hash is not present in the lineage');
  const sources = [...lineage.certifications].sort((a,b)=>Number(a.sequence)-Number(b.sequence));
  const certificates = sources.map((source, index) => {
    nonempty(source.id, 'certification id');
    const loaded = readCertification(source, options.authority, parsed.plan, snapshots.get(source.id)!);
    const g2=loaded.certificate.gates.find(g=>g.result.gate==='G2')?.result;
    const g2Evidence=object(g2?.evidence,'G2 evidence');
    if(g2Evidence.lockedAt!==lockSequence || g2Evidence.firstLookAt!==firstLookSequence)throw new Error('G2 evidence differs from authenticated lock/look sequences');
    if(ledgerLateLock && g2?.outcome!=='failed')throw new Error('plan lock must precede every look for a planned claim');
    if (loaded.certificate.binding.planHash !== lockedPlanHash) throw new Error(`certification plan binding mismatch: ${source.id}`);
    if (loaded.certificate.binding.inputManifestHash !== lineage.stagerManifests.map(m => object(m, 'stager manifest').inputManifestHash ?? object(m, 'stager manifest').hash).find(h => h === loaded.certificate.binding.inputManifestHash)) throw new Error(`input manifest binding mismatch: ${source.id}`);
    const frozen = object(lineage.environmentLock, 'environment lock').frozenCodeHash ?? object(lineage.environmentLock, 'environment lock').frozen_code_hash ?? object(lineage.runMetadata, 'run metadata').frozenCodeHash;
    if (frozen !== loaded.certificate.binding.frozenCodeHash) throw new Error(`frozen code binding mismatch: ${source.id}`);
    const executions = [...lineage.sandboxExecutionLogs, lineage.runMetadata].map(v => v && typeof v === 'object' ? v as JsonObject : {});
    if (!executions.some(v => v.executionId === loaded.certificate.binding.executionId || v.execution_id === loaded.certificate.binding.executionId)) throw new Error(`execution binding mismatch: ${source.id}`);
    if (loaded.certificate.certification.plain_statement !== plainStatement || canonicalJson(loaded.certificate.certification.paper_set) !== canonicalJson(paperSet))
      throw new Error(`certification locked paper context mismatch: ${source.id}`);
    const journal = storeLineage.certificationOutputs[index]!;
    const summary = object(journal.certification,'V7 certification');
    const reportHash = canonicalSha256(loaded.certificate.report);
    if (reportHash !== (summary.reportHash ?? canonicalSha256(summary.report ?? null))) throw new Error('certification report hash differs from V7 journal');
    const statuses = (claims: readonly unknown[]) => claims.map(v => {const a=object(v,'claim status');return [foldKey(String(a.claimId)),a.status,a.taskStatus];}).sort((a,b)=>cmp(String(a[0]),String(b[0])));
    if (!Array.isArray(summary.claims) || canonicalJson(statuses(summary.claims)) !== canonicalJson(statuses(loaded.certificate.certification.assessments))) throw new Error('certification claim statuses differ from V7 journal');
    const expectedPass = journal.phase === 'route-n' ? 'route-n' : journal.phase === 'replicate' ? 'replicate' : 'certify';
    const expectedPrevious = index ? sources[index-1]!.id : undefined;
    if (source.pass !== expectedPass || source.sequence !== journal.journalSequence || source.supersedes !== expectedPrevious) throw new Error('certification supersession differs from journal phase order');
    return { id: source.id, sequence: Number(journal.journalSequence), supersedes: source.supersedes ?? null, pass: expectedPass as 'certify' | 'replicate' | 'route-n', certificate: loaded.certificate, metrics: loaded.metrics, metricGrades: normalizeMetricGrade(source.id, loaded.certificate, loaded.metrics, loaded.bodySealed, parsed.plan) };
  }).sort((a, b) => a.sequence - b.sequence || cmp(a.id, b.id));
  if (new Set(certificates.map(c => c.id)).size !== certificates.length) throw new Error('duplicate certification id');
  const certificationDigests = lineage.inventory.record.certifications.map(c => c.certificationSha256);
  if (new Set(certificationDigests).size !== certificationDigests.length) throw new Error('duplicate certification content hash');
  const metadata = object(lineage.runMetadata, 'run metadata');
  const contactRequired = parsed.plan.claims.some(c => c.kind === 'data-integrity' || c.kind === 'reproduction') || ['reanalysisOfOthersData','differingNumbers','pipelineReuse'].some(k => metadata[k] === true);
  if (contactRequired && !lineage.contact.required) throw new Error('locked claim kinds require author contact');
  const canonicalArray = (values: readonly unknown[]) => [...values].sort((a, b) => cmp(canonicalJson(a), canonicalJson(b)));
  if (lineage.contact.draftHash && !authorityRecords(options.store,storeLineage,'omb-paper/draft@1',lineage.lineageId).some(r=>r.draftHash===lineage.contact.draftHash)) throw new Error('contact draft hash has no host-receipted V5 draft');
  const derivedEntities: EntityInput[] = [...(lineage.entities ?? [])];
  const variables: VariableRecord[] = [];
  for (const claim of parsed.plan.claims) {
    if (claim.exposure) variables.push({role:'exposure',name:claim.exposure,claimId:claim.id});
    if (claim.outcome) variables.push({role:'outcome',name:claim.outcome,claimId:claim.id});
    for (const item of claim.adjustment) variables.push({role:'adjustment',name:item,claimId:claim.id});
  }
  for (const manifest of lineage.stagerManifests) {
    const m = object(manifest, 'stager manifest');
    for (const value of Array.isArray(m.accessions) ? m.accessions : []) if (typeof value === 'string') derivedEntities.push({ kind: 'dataset', value, source: 'stager-manifest' });
  }
  const core = {
    ...literature,
    schema: 'omb/paper-input@1' as const, lineageId: lineage.lineageId, lockedPlan: plan, plainStatement, paperSet,
    lock: structuredClone(lineage.lockedPlan.lock.record), certifications: certificates, variables,
    ownerConfiguration,
    paperStatus: ((lockActor==='owner'||lockActor==='policy') && ownerApproved ? 'owner-approved' : 'draft-not-owner-approved') as PaperInput['paperStatus'],
    introductionRequirement: (lockAt < cutover ? 'blind pass applies' : 'stage-1 introduction verified') as PaperInput['introductionRequirement'],
    lineageInventory: structuredClone(lineage.inventory.record), sourceRecords: structuredClone(storeLineage),
    planVersions: structuredClone(canonicalArray(lineage.planVersions)), looks: structuredClone(canonicalArray(lineage.looks)), claims: structuredClone(canonicalArray(lineage.claims)),
    timestamps: structuredClone([...lineage.timestamps.map(t => t.record)].sort((a, b) => cmp(canonicalJson(a), canonicalJson(b)))), lookLedger: structuredClone(lineage.lookLedger), assumptionLedger: structuredClone(lineage.assumptionLedger),
    stagerManifests: structuredClone(canonicalArray(lineage.stagerManifests)), sandboxExecutionLogs: structuredClone(canonicalArray(lineage.sandboxExecutionLogs)),
    environmentLock: structuredClone(lineage.environmentLock), frozenLiteratureIndex: structuredClone(lineage.frozenLiteratureIndex), runMetadata: structuredClone(lineage.runMetadata),
    ownerDeclarations: validateOwnerDeclarations(lineage.ownerDeclarations), contact: validateContactRecord(lineage.contact), entities: buildEntityRecords(derivedEntities),
  };
  const registeredHypotheses = parsed.plan.claims.filter(c => !c.exploratory).length;
  const plannedFound = makePlannedFound(plan, paperSet, certificates, lineage.claims, lineage.planVersions, lineage.sandboxExecutionLogs, storeLineage.amendments, registeredHypotheses, lineage.looks);
  plannedFound.deviations.push(...medicDeviations(storeLineage.v7Journal));
  if (plannedFound.missingClaimIds.length) throw new Error(`lineage has missing certification claim(s): ${plannedFound.missingClaimIds.join(', ')}`);
  const terminalAnchor=verifyTerminalAnchor(storeLineage,options.store);
  const factExtensions = buildFactExtensions(plan, core.stagerManifests, certificates.flatMap(c=>c.metricGrades));
  const digestInput = { ...core, plannedFound, terminalAnchor, factExtensions };
  const sha256 = canonicalSha256(digestInput);
  const freeze = <T>(value:T):T => { if(value && typeof value === 'object') { Object.values(value).forEach(freeze);Object.freeze(value); } return value; };
  return freeze(structuredClone({ ...digestInput, sha256 }));
}

export function canonicalPaperInput(input: PaperInput): string {
  const { sha256, ...body } = input;
  if (canonicalSha256(body) !== sha256) throw new Error('PaperInput hash mismatch');
  return canonicalJson(input);
}

/** Evidence that V7 does not produce is explicitly supplied; the lineage's plan, lock, looks,
 * claims, certification order and deliverable are collected from the verified journals. */
export type SupplementaryPaperEvidence = Pick<PaperLineage, 'timestamps'|'assumptionLedger'|'stagerManifests'|'sandboxExecutionLogs'|'environmentLock'|'frozenLiteratureIndex'|'runMetadata'|'ownerDeclarations'|'contact'|'entities'>;
export function buildPaperInputForLineage(lineageId: string, options: PaperInputOptions, certificationDirectories: readonly string[], evidence: SupplementaryPaperEvidence): PaperInput {
  const records=enumerateLineage(options.store,lineageId,options.journalFile);
  const phase=(name:string)=>records.phaseOutputs.find(p=>p.phase===name)?.output;
  const planOutput=object(phase('plan'),'V7 plan output');
  const planBytes=readBytes(nonempty(planOutput.lockedPlan,'locked plan path'));
  if(createHash('sha256').update(planBytes).digest('hex')!==planOutput.planBytesHash)throw new Error('locked plan artifact bytes differ from V7 pin');
  const plan=object(JSON.parse(planBytes.toString('utf8')),'locked plan');
  const native=records.locks.map(e=>object(e.record,'lock')).find(r=>r.stage==='L4-plan-lock');
  const lock=native??records.ledgerJournal.find(e=>e.type==='plan-locked'&&object(e.payload,'lock').investigationId===lineageId);
  if(!lock)throw new Error('lineage has no authenticated lock');
  const looks=native?records.looks:records.ledgerJournal.filter(e=>e.type==='look-recorded'&&object(e.payload,'look').investigationId===lineageId);
  const delivery=object(phase('deliverable'),'V7 deliverable');
  const paperBytes=readBytes(path.join(nonempty(delivery.dir,'deliverable path'),'paper-input.json'));
  if(createHash('sha256').update(paperBytes).digest('hex')!==object(delivery.files,'deliverable files')['paper-input.json'])throw new Error('V7 paper deliverable hash differs');
  const paper=object(JSON.parse(paperBytes.toString('utf8')),'V7 paper deliverable');
  if(paper.lineageId!==lineageId||paper.schema!=='omb-investigate/paper-input-fields@1')throw new Error('V7 paper deliverable lineage mismatch');
  const unused=new Set(certificationDirectories);
  if(unused.size!==certificationDirectories.length)throw new Error('duplicate certification directory');
  const certifications:CertificationSource[]=records.certificationOutputs.map((entry,i)=>{
    const summary=object(entry.certification,'certification summary');
    const matches=[...unused].filter(dir=>{const cert=object(readJson(path.join(dir,'certification.json')),'certification');return canonicalSha256(cert.report)===canonicalSha256(summary.report);});
    if(matches.length!==1)throw new Error('missing or ambiguous certification artifact for lineage');
    const directory=matches[0]!;unused.delete(directory);
    return {id:`cert-${i}`,directory,sequence:Number(entry.journalSequence),pass:entry.phase==='route-n'?'route-n':entry.phase==='replicate'?'replicate':'certify',...(i?{supersedes:`cert-${i-1}`}:{})};
  });
  if(unused.size)throw new Error('certification artifacts from another lineage');
  const base:Omit<PaperLineage,'inventory'>={...evidence,lineageId,lockedPlan:{plan,lock:{record:lock as unknown as PaperLockRecord,receipt:options.store.authorityReceipt(lock)}},certifications,
    planVersions:records.phaseOutputs.filter(p=>p.phase==='plan').map(p=>p.output),looks:looks as unknown as PaperLook[],lookLedger:{records:looks},
    claims:records.certificationOutputs.flatMap(e=>{const c=object(e.certification,'certification');return Array.isArray(c.claims)?c.claims:[];})};
  const inventory=createLineageInventoryRecord(base);
  return buildPaperInput({...base,inventory:{record:inventory,receipt:options.store.authorityReceipt(inventory)}},options);
}
