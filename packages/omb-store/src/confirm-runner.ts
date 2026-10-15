import { setImmediate as yieldToWriters } from 'node:timers/promises';
import { planFrom, type ApplyPlan } from './apply-plan.ts';
export type { ApplyPlan } from './apply-plan.ts';
import { contentHash, fail, json, mac, key } from './primitives.ts';
import { openSealV2, verifySealV2 } from './seal-v2.ts';
import { floorResolver, type Cell, type ResolvedTable } from './sealer.ts';
import type { PublicLayer } from '../../omb-contract/src/index.ts';
import type { ContentTuple, Look, PartitionCommitment } from './types.ts';
import type { OmbStore, StoreCheckpoint } from './store.ts';

export interface ApplyInput {
  /** Only tokens and plan-locked features: never keys, outcomes, IDs or store paths. */
  headers: string[]; rows: Cell[][]; frozenCode: Uint8Array; trainingArtifact: Uint8Array;
  network: 'none'; acceptedOutput: 'predictions.tsv'; runAs: '_ombrun' | 'current-user';
}
export interface ApplyOutput { files: Record<string, string>; networkEvidence: 'verified-no-egress' | 'egress' | 'unavailable'; evidenceHash: string | null }
/** This is a trusted HOST adapter, never a callback implemented by worker code.
 * The adapter must sandbox, enforce network denial, cap/reap the process tree,
 * clean scratch on all exits, and audit the actual users/ownership/permissions.
 */
export interface ConfirmBackend { execute(input: ApplyInput): Promise<ApplyOutput> }
export interface OSUserAttestation {
  certUser: '_ombcert'; runUser: '_ombrun'; certUid: number; runUid: number;
  effectiveUid: number; storeOwnerUid: number; storeMode: number; keyOwnerUid: number; keyMode: number;
}
export type ConfirmMode = { kind: 'single-user'; backend: ConfirmBackend } | { kind: 'os-users'; backend: ConfirmBackend; attest: () => OSUserAttestation };
export interface ConfirmRequest {
  store: OmbStore; datasetId: string; partitionId: string; tuple: ContentTuple; executionId: string;
  sealingKey: Uint8Array; mode: ConfirmMode; curatedContract: boolean;
  trainingNetworkEvidence: 'verified-no-egress' | 'egress' | 'unavailable';
  trainingNetworkEvidenceHash: string | null;
  /** Trusted external sink: resolve only after durable storage outside worker reach. */
  persistCheckpoint?: (checkpoint: StoreCheckpoint, look: Readonly<Look>) => void | Promise<void>;
}
export interface ConfirmResult {
  look: Look | null; status: 'completed' | 'refused' | 'failed' | 'persistence-pending';
  /** Host-only retry of the same validated bytes; never executes apply again. */
  retryPersistence?: () => Promise<ConfirmResult>;
  claimCeiling: 'Tentative' | 'requires-certification';
  separation: 'OS-user separation' | 'no OS-user separation'; curatedEligible: boolean;
  sequestration: 'eligible-for-sequestered-checks' | 'internal, not sequestered';
  /** `unit`: HMAC of the row's sorted contract floor-unit nodes (no row index), so replicate rows of
   * one unit share it. K2b clusters held-out resampling on it (K2b-fix1 finding 14). */
  predictions: { token: string; unit: string; prediction: number; outcome: Cell; simpleRule?: Cell }[];
  limitation: string | null;
}
function separated(mode: ConfirmMode): boolean {
  if (mode.kind === 'single-user') return false;
  if (mode.kind !== 'os-users') fail('unknown confirm mode');
  const a = mode.attest();
  if (a.certUser !== '_ombcert' || a.runUser !== '_ombrun' || !Number.isSafeInteger(a.certUid) || !Number.isSafeInteger(a.runUid) || a.certUid <= 0 || a.runUid <= 0 || a.certUid === a.runUid || a.effectiveUid !== a.certUid || a.storeOwnerUid !== a.certUid || a.keyOwnerUid !== a.certUid || !Number.isInteger(a.storeMode) || !Number.isInteger(a.keyMode) || (a.storeMode & 0o077) !== 0 || (a.keyMode & 0o077) !== 0) fail('OS-user separation not attested');
  return true;
}
/** No label is assigned here. K2b still needs calibration, sub-batch invariance,
 * archive sequestration, dual amendment checks, and all other required gates. */
export async function runConfirm(request: ConfirmRequest): Promise<ConfirmResult> {
  const { store, mode } = request;
  const base: ConfirmResult = { claimCeiling: 'Tentative', look: null, status: 'refused', separation: 'no OS-user separation', curatedEligible: false, sequestration: 'internal, not sequestered', predictions: [], limitation: null };
  let isSeparated: boolean, plan: ApplyPlan, sealedBytes: Buffer, trainingProof: boolean, resolveFloor: (node: string) => string[];
  const proofPresent = (hash: unknown): boolean => typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash) && store.hasArtifact(hash) && store.artifact(hash).length > 0;
  try {
    if (request.trainingNetworkEvidence === 'egress') fail('training egress known before look');
    isSeparated = separated(mode);
    if (mode.kind !== store.separation) fail('separation differs from immutable store policy');
    plan = planFrom(store.artifact(request.tuple.planLockHash), store.artifact(request.tuple.contractHash));
    resolveFloor = floorResolver((JSON.parse(store.artifact(request.tuple.contractHash).toString()) as PublicLayer).structure);
    const commitment = store.events().filter(e => e.kind === 'partition').map(e => e.payload as PartitionCommitment).find(p => p.id === request.partitionId && p.datasetId === request.datasetId) ?? fail('missing committed partition');
    if (store.burned(commitment.units.filter(u => u.allocation === 'held-out').flatMap(u => u.identities)).length) fail('held-out identities already burned');
    sealedBytes = store.artifact(commitment.sealedArtifactHash);
    verifySealV2(sealedBytes, request.sealingKey);
    const shape = commitment.sealedTables.find(t => t.id === plan.table);
    if (!shape || !shape.recordAxis || shape.rowCount < 1 || ![...plan.features, plan.outcome, ...(plan.simpleRule === undefined ? [] : [plan.simpleRule])].every(f => shape.headers.includes(f))) fail('apply needs nonempty resolved record-axis table and all locked features');
    trainingProof = proofPresent(request.trainingNetworkEvidenceHash);
  } catch { return { ...base, limitation: 'confirm preflight failed: egress, prior burn, separation, locked plan, seal key or table shape' }; }
  // Attestation and public plan checks expose no held-out data. The durable
  // boundary still precedes decryption and execution.
  const look = store.recordLook(request.datasetId, request.partitionId, request.tuple, request.executionId, isSeparated ? 'os-users' : 'single-user');
  base.look = look;
  if (!look.executable) return { ...base, limitation: 'look already consumed or units burned' };
  base.separation = isSeparated ? 'OS-user separation' : 'no OS-user separation';
  base.curatedEligible = isSeparated;
  base.claimCeiling = look.claimCeiling;
  if (!isSeparated) base.limitation = 'no OS-user separation; all claims capped at Tentative';
  try { await request.persistCheckpoint?.(store.checkpoint(), structuredClone(look)); }
  catch { return { ...base, limitation: 'external L6 checkpoint not persisted; execution refused' }; }
  let completed: ConfirmResult, bytes: Buffer;
  try {
    const tables = JSON.parse(openSealV2(sealedBytes, key(request.sealingKey)).toString()) as ResolvedTable[];
    const table = tables.find(t => t.id === plan.table) ?? fail('missing apply table');
    const indices = plan.features.map(f => table.headers.indexOf(f)), outcome = table.headers.indexOf(plan.outcome), simple = plan.simpleRule === undefined ? null : table.headers.indexOf(plan.simpleRule);
    if (indices.some(i => i < 0) || outcome < 0 || simple === -1 || table.columnNodes.some(n => n.length) || !table.rows.length || table.rowNodes.some(n => !n.length)) fail('apply needs resolved record-axis table and all locked features');
    const tokenKey = Buffer.from(store.seed(request.tuple, 'confirm-tokenization'), 'hex');
    const floorUnits = (nodes: string[]): string[] => [...new Set(nodes.flatMap(n => resolveFloor(n)))].sort();
    const mapped = table.rows.map((row, i) => ({ row, token: mac(tokenKey, 'omb-store/apply-token/v1', [table.rowNodes[i], i]), unit: mac(tokenKey, 'omb-store/apply-unit/v1', floorUnits(table.rowNodes[i]!)), outcome: row[outcome]!, simpleRule: simple === null ? undefined : row[simple]! }));
    // Stable content-derived keyed shuffle; execution IDs do not enter it.
    mapped.sort((a, b) => mac(tokenKey, 'omb-store/apply-order/v1', a.token).localeCompare(mac(tokenKey, 'omb-store/apply-order/v1', b.token)));
    const output = await mode.backend.execute({ headers: ['token', ...plan.features], rows: mapped.map(r => [r.token, ...indices.map(i => r.row[i]!)]), frozenCode: store.artifact(look.record.frozen_code_hash), trainingArtifact: store.artifact(look.record.artifact_hash), network: 'none', acceptedOutput: 'predictions.tsv', runAs: isSeparated ? '_ombrun' : 'current-user' });
    if (json(Object.keys(output.files)) !== json(['predictions.tsv'])) fail('only predictions.tsv accepted');
    const lines = output.files['predictions.tsv']!.trimEnd().split(/\r?\n/);
    if (lines.shift() !== 'token\tprediction' || lines.length !== mapped.length) fail('incomplete prediction coverage');
    const seen = new Set<string>();
    const predictions = lines.map(line => {
      const fields = line.split('\t'), token = fields[0]!, value = fields[1];
      const source = mapped.find(r => r.token === token);
      if (fields.length !== 2 || !source || seen.has(token) || value === undefined || !/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value) || !Number.isFinite(Number(value))) fail('invalid prediction');
      seen.add(token); return { token, unit: source.unit, prediction: Number(value) || 0, outcome: source.outcome, ...(source.simpleRule === undefined ? {} : { simpleRule: source.simpleRule }) };
    });
    if (output.networkEvidence === 'egress') return { ...base, status: 'failed', limitation: 'observed egress invalidates held-out evidence' };
    const proof = proofPresent(output.evidenceHash);
    const sequestration = isSeparated && request.trainingNetworkEvidence === 'verified-no-egress' && output.networkEvidence === 'verified-no-egress' && trainingProof && proof ? 'eligible-for-sequestered-checks' : 'internal, not sequestered';
    // Persist software output as an immutable artifact, even in degraded mode.
    bytes = Buffer.from(json({ lookHash: look.hash, predictions, separation: base.separation, claimCeiling: base.claimCeiling, sequestration, resultHash: contentHash({ files: { 'predictions.tsv': output.files['predictions.tsv'] }, networkEvidence: output.networkEvidence === 'verified-no-egress' ? 'verified-no-egress' : 'unavailable', evidenceHash: proof ? output.evidenceHash : null }) }));
    completed = { ...base, status: 'completed', predictions, sequestration };
  } catch {
    // Private errors never cross the worker boundary; detailed diagnostics belong
    // in a host-only adapter audit. A failed look remains durably spent.
    return { ...base, status: 'failed', limitation: 'confirm execution or evidence validation failed' };
  }
  // Infrastructure failures must not be confused with invalid evidence or cause
  // another execution. Keep the exact bytes and result across bounded retries.
  const persist = async (): Promise<ConfirmResult> => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try { store.putArtifact(bytes); return structuredClone(completed); }
      catch (error) {
        const code = (error as { errcode?: number }).errcode;
        if (code !== 5 && code !== 6) break;
        await yieldToWriters();
      }
    }
    return { ...structuredClone(completed), status: 'persistence-pending', limitation: 'validated result retained; persistence requires retry', retryPersistence: persist };
  };
  return persist();
}
