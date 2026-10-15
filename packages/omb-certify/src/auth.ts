import { createHmac, timingSafeEqual } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { canonicalJson } from '../../bio-core/src/index.ts';
import { GateBoard, readGateResult, type GateResult } from '../../omb-gauntlet/src/index.ts';

export interface Binding { planHash: string; inputManifestHash: string; frozenCodeHash: string; executionId: string; contractHash?:string; partitionHash?:string; privateContractHash?:string|null }
export interface SealedEvidence { schema: 'omb/evidence@1'; domain: string; binding: Binding; claimId: string; evidence: Record<string, unknown>; mac: string }
export interface SignedGate { schema: 'omb/gate@2'; producer: string; binding: Binding; result: GateResult; mac: string }
export const gateProducer=(gate:string):string=>gate==='G7'?'omb-replicator':gate==='G8'?'omb-seal':'omb-certify';
const digest = /^[a-f0-9]{64}$/;
export function validBinding(b: Binding): boolean {
  return !!b && digest.test(b.planHash) && digest.test(b.inputManifestHash) && digest.test(b.frozenCodeHash)
    && (b.partitionHash===undefined||digest.test(b.partitionHash)) && (b.contractHash===undefined||digest.test(b.contractHash)) && (b.privateContractHash===undefined||b.privateContractHash===null||digest.test(b.privateContractHash))
    && typeof b.executionId === 'string' && b.executionId.trim().length > 0;
}
export function outside(child: string, parent: string): boolean {
  const rel = path.relative(realpathSync(parent), realpathSync(child));
  return rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel);
}
/** Host capability: never import/pass this object in a worker process. The key is neither
 * serialized nor present in executor environment/read mounts. HMAC authenticates producers,
 * not scientifically correct evidence; GateBoard still checks every evidence predicate. */
export class GateAuthority {
  readonly #key: Buffer;
  constructor(key: Uint8Array) {
    if (key.byteLength < 32) throw new Error('host key must have at least 256 bits');
    this.#key = Buffer.from(key);
  }
  static fromFile(file: string, workerRoots: readonly string[]): GateAuthority {
    const st = lstatSync(file);
    if (!st.isFile() || st.isSymbolicLink() || st.nlink !== 1 || (st.mode & 0o077) !== 0
      || workerRoots.some(root => !outside(file, root))) throw new Error('host key must be private and outside every worker scope');
    return new GateAuthority(readFileSync(file));
  }
  /** Domain-separated, host-secret deterministic simulation randomness. */
  simulationSeed(binding:Binding,claimId:string):string { return this.mac({domain:'omb/dependence@1',binding,claimId}); }
  seal(binding: Binding, result: GateResult, producer = gateProducer(result.gate)): SignedGate {
    if (!validBinding(binding) || !producer.trim() || !readGateResult(result)) throw new Error('invalid signed gate');
    const payload = structuredClone({ schema: 'omb/gate@2' as const, producer, binding, result });
    return { ...payload, mac: this.mac(payload) };
  }
  verify(value: unknown, binding: Binding, producers: readonly string[] = ['omb-certify', 'omb-seal', 'omb-replicator']): GateResult | null {
    try {
      if (!validBinding(binding) || !value || typeof value !== 'object') return null;
      const v = value as SignedGate;
      if (v.producer!==gateProducer(v.result?.gate) || v.schema !== 'omb/gate@2' || !producers.includes(v.producer) || !validBinding(v.binding)
        || canonicalJson(v.binding) !== canonicalJson(binding) || !digest.test(v.mac)) return null;
      const { mac, ...payload } = v;
      if (!timingSafeEqual(Buffer.from(mac, 'hex'), Buffer.from(this.mac(payload), 'hex'))) return null;
      return readGateResult(v.result);
    } catch { return null; }
  }
  /** Host-producer seal for trusted evidence that is not a gate (domain-separated from gate
   * envelopes and seeds by schema and domain), bound to the certification binding and claim. */
  sealEvidence(domain: string, binding: Binding, claimId: string, evidence: Record<string, unknown>): SealedEvidence {
    if (!validBinding(binding) || !domain.trim() || !claimId.trim() || !evidence || typeof evidence !== 'object' || Array.isArray(evidence)) throw new Error('invalid sealed evidence');
    const payload = structuredClone({ schema: 'omb/evidence@1' as const, domain, binding, claimId, evidence });
    return { ...payload, mac: this.mac(payload) };
  }
  verifyEvidence(value: unknown, domain: string, binding: Binding, claimId: string): Record<string, unknown> | null {
    try {
      if (!validBinding(binding) || !value || typeof value !== 'object') return null;
      const v = value as SealedEvidence;
      // Comparisons are written differently from verify() so each guard-mutation needle stays unique.
      if (v.schema !== 'omb/evidence@1' || v.domain !== domain || v.claimId !== claimId || !validBinding(v.binding) || canonicalJson(binding) !== canonicalJson(v.binding)
        || !v.evidence || typeof v.evidence !== 'object' || Array.isArray(v.evidence) || typeof v.mac !== 'string' || !digest.test(v.mac)) return null;
      const { mac, ...payload } = v;
      if (Object.keys(payload).sort().join() !== 'binding,claimId,domain,evidence,schema') return null;
      const expected = Buffer.from(this.mac(payload), 'hex');
      if (!timingSafeEqual(Buffer.from(mac, 'hex'), expected)) return null;
      return structuredClone(v.evidence);
    } catch { return null; }
  }
  private mac(payload: unknown): string { return createHmac('sha256', this.#key).update(canonicalJson(payload)).digest('hex'); }
  /** Derive host-only, domain-separated keys from the persistent host key. */
  deriveKey(domain:string):Buffer {
    if(!domain.trim()||domain.length>128)throw new Error('invalid host key domain');
    return createHmac('sha256',this.#key).update('omb-host-derived-key/v1\0'+domain).digest();
  }
}
/** Production board accepts authenticated envelopes only. V1 GateBoard remains a pure testable
 * evaluator, not an input boundary; never feed mailbox JSON directly into it. */
export class SignedGateBoard extends GateBoard {
  readonly rejected: number;
  constructor(values: readonly unknown[], binding: Binding, authority: GateAuthority) {
    const verified = values.map(v => authority.verify(v, binding));
    super(verified.filter((v): v is GateResult => v !== null));
    this.rejected = verified.filter(v => v === null).length;
  }
}
