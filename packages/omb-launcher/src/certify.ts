import { canonicalJson, canonicalSha256 } from '../../bio-core/src/index.ts';
import { certify, parsePlan, parsePrimary, planLockHash, evaluateG2 } from '../../omb-gauntlet/src/index.ts';
import { GateAuthority, SignedGateBoard, validBinding, type Binding } from '../../omb-certify/src/auth.ts';
import { capLabel, OS_SEPARATION_LIMITATION } from '../../omb-certify/src/degraded.ts';
import type { OmbStore, Look } from '../../omb-store/src/index.ts';
import { sha256 } from './os-backend.ts';
import { LauncherError } from './process.ts';
import { signResult } from './signing.ts';

export const CERTIFY_INPUT_CAP = 96 * 1024 * 1024;
export const CERTIFY_BYTES_CAP = 64 * 1024 * 1024;
export interface CertifyWireRequest {
  schema: 'omb-certify/v1'; ticket: string;
  artifacts: { hash: string; base64: string }[];
}
/** Written only by an authority-side producer after native preparation/evaluation.
 * Uploading bytes NEVER creates a ticket, a lock, a passed gate or an OS attestation. */
export interface CertificationTicket {
  schema: 'omb-certification-ticket/v1'; datasetId: string; binding: Binding;
  planArtifact: string; primaryArtifact: string | null; gatesArtifact: string;
  artifacts: string[]; hardStops: string[];
}
function object(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new LauncherError('refused', 'object required');
  return v as Record<string, unknown>;
}
function keys(v: Record<string, unknown>, expected: string): void {
  if (Object.keys(v).sort().join(',') !== expected) throw new LauncherError('refused', 'unexpected schema fields');
}
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
export function parseCertifyRequest(value: unknown): { request: CertifyWireRequest; bytes: Map<string, Buffer> } {
  const v = object(value); keys(v, 'artifacts,schema,ticket');
  if (v.schema !== 'omb-certify/v1' || !hash(v.ticket) || !Array.isArray(v.artifacts) || v.artifacts.length > 256) throw new LauncherError('refused', 'certify schema');
  const bytes = new Map<string, Buffer>(); let total = 0;
  for (const item of v.artifacts) {
    const a = object(item); keys(a, 'base64,hash');
    if (!hash(a.hash) || bytes.has(a.hash) || typeof a.base64 !== 'string' || a.base64.length > Math.ceil(CERTIFY_BYTES_CAP / 3) * 4) throw new LauncherError('refused', 'artifact schema');
    // Round-trip rejects whitespace, invalid alphabet, omitted padding and trailing garbage.
    const decoded = Buffer.from(a.base64, 'base64'); total += decoded.length;
    if (total > CERTIFY_BYTES_CAP) throw new LauncherError('request-limit', 'decoded artifact cap');
    if (decoded.toString('base64') !== a.base64 || sha256(decoded) !== a.hash) throw new LauncherError('refused', 'artifact content binding');
    bytes.set(a.hash, decoded);
  }
  return { request: v as unknown as CertifyWireRequest, bytes };
}
export function parseCertificationTicket(value: unknown): CertificationTicket {
  const v = object(value); keys(v, 'artifacts,binding,datasetId,gatesArtifact,hardStops,planArtifact,primaryArtifact,schema');
  if (v.schema !== 'omb-certification-ticket/v1' || typeof v.datasetId !== 'string' || !v.datasetId.trim() || v.datasetId.length > 256 || !validBinding(v.binding as Binding) || !hash(v.planArtifact) || !(v.primaryArtifact === null || hash(v.primaryArtifact)) || !hash(v.gatesArtifact) || !Array.isArray(v.artifacts) || v.artifacts.length > 256 || !v.artifacts.every(hash) || new Set(v.artifacts).size !== v.artifacts.length || !Array.isArray(v.hardStops) || v.hardStops.length > 64 || !v.hardStops.every(x => typeof x === 'string' && x.length <= 128)) throw new LauncherError('refused', 'certification ticket schema');
  if (![v.planArtifact, v.gatesArtifact, ...(v.primaryArtifact ? [v.primaryArtifact] : [])].every(x => (v.artifacts as string[]).includes(x as string))) throw new LauncherError('refused', 'ticket artifact inventory');
  return v as unknown as CertificationTicket;
}
export function certifyFromTicket(options: {
  request: unknown; ticket: unknown; store: OmbStore; hostKey: Uint8Array; releaseHash: string;
  /** Actual OS check performed in the installed dispatcher, never a request field. */
  separated: boolean;
}) {
  const { request, bytes } = parseCertifyRequest(options.request), ticket = parseCertificationTicket(options.ticket);
  if (sha256(Buffer.from(canonicalJson(ticket))) !== request.ticket) throw new LauncherError('refused', 'ticket content binding');
  for (const [digest, data] of bytes) {
    if (!ticket.artifacts.includes(digest)) throw new LauncherError('refused', 'unrequested artifact');
    if (options.store.putArtifact(data) !== digest) throw new LauncherError('refused', 'artifact persistence');
  }
  for (const digest of ticket.artifacts) if (!options.store.hasArtifact(digest)) throw new LauncherError('refused', 'missing certification artifact');
  const planBytes = options.store.artifact(ticket.planArtifact), plan = parsePlan(planBytes.toString()).plan;
  if (!plan) throw new LauncherError('refused', 'invalid authority plan');
  // Native L4 wraps the V7 request. Require the authority timeline, not an owner-supplied lock time.
  const timeline = options.store.timeline(ticket.datasetId), lock = timeline.find(e => e.record.stage === 'L4-plan-lock');
  const look = timeline.find(e => e.record.stage === 'L6-look-record');
  if (!lock || lock.record.stage !== 'L4-plan-lock' || !look || look.record.stage !== 'L6-look-record' || lock.record.sequence >= look.record.sequence || look.record.plan_hash !== lock.record.plan_hash || look.record.frozen_code_hash !== ticket.binding.frozenCodeHash || look.record.public_contract_hash !== ticket.binding.contractHash || look.record.partition_hash !== ticket.binding.partitionHash) throw new LauncherError('refused', 'native lock/look binding');
  const storedLook = options.store.events().filter(e => e.kind === 'look').map(e => e.payload as Look).find(l => l.hash === look.hash);
  if (!storedLook?.executable || storedLook.attempt.executionId !== ticket.binding.executionId || storedLook.attempt.tuple.dataHash !== ticket.binding.inputManifestHash) throw new LauncherError('refused', 'native execution binding');
  const locked = JSON.parse(options.store.artifact(lock.record.plan_hash).toString()) as { v7?: { planHash?: string; planBytesHash?: string } };
  if (planLockHash(plan) !== ticket.binding.planHash || locked.v7?.planHash !== ticket.binding.planHash || locked.v7?.planBytesHash !== sha256(planBytes)) throw new LauncherError('refused', 'native plan artifact binding');
  const gates: unknown = JSON.parse(options.store.artifact(ticket.gatesArtifact).toString());
  if (!Array.isArray(gates) || gates.length > 4096) throw new LauncherError('refused', 'gate inventory');
  const board = new SignedGateBoard(gates, ticket.binding, new GateAuthority(options.hostKey));
  if (board.rejected) throw new LauncherError('refused', 'unsigned or stale certification gates');
  const primary = ticket.primaryArtifact === null ? null : parsePrimary(options.store.artifact(ticket.primaryArtifact).toString()).primary;
  const certification = certify({ plan, primary, metricsJson: null, gates: [...board.results.filter(g => g.gate !== 'G2'), evaluateG2({ plan, lock: { planHash: ticket.binding.planHash, lockedAt: lock.record.sequence }, firstLookAt: look.record.sequence })], hardStops: ticket.hardStops });
  const separated = options.separated && options.store.separation === 'os-users';
  const claims = certification.assessments.map(a => {
    const label = separated ? a.label : capLabel(a.label, [OS_SEPARATION_LIMITATION]);
    return { claimId: a.claimId, kind: a.kind, status: label.status, taskStatus: label.taskStatus, reasons: [...label.reasons], limitations: [...a.limitations, ...(separated ? [] : [OS_SEPARATION_LIMITATION])], voided: label.voided };
  });
  const result = { ticket: request.ticket, binding: ticket.binding, claims, metrics: Object.fromEntries(certification.metrics.values), separation: separated ? 'OS-user separation' : 'no OS-user separation', gates: board.results.map(g => ({ gate: g.gate, claimId: g.claimId ?? null, outcome: g.outcome })) };
  const signed = signResult(result, options.releaseHash, canonicalSha256(request), options.hostKey);
  options.store.putArtifact(Buffer.from(canonicalJson(signed)));
  return signed;
}
