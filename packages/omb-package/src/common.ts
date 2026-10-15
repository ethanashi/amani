import { sign, verify, type KeyObject } from 'node:crypto';
import { canonicalJson, canonicalSha256, sha256, safePath } from '@omerta-bio/certificate';
import type { HostAuthority, Signed, Submission } from './types.ts';
export { canonicalJson, canonicalSha256, sha256, safePath };
export const fail = (condition: unknown, message: string): asserts condition => { if (!condition) throw new Error(`PW9: ${message}`); };
export function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(`PW9: ${message}`); }
export function utc(value: string): number {
  assert(typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value), 'strict UTC timestamp required');
  const n = Date.parse(value); assert(Number.isFinite(n) && new Date(n).toISOString().replace('.000Z','Z') === value.replace('.000Z','Z'), 'invalid date'); return n;
}
export function submissionHash(s: Submission): string {
  return canonicalSha256({ ...s, reproduction: { ...s.reproduction, files: s.reproduction.files.map(f => ({path:f.path,sha256:sha256(f.bytes)})) } });
}
export function signRecord<T>(record: T, key: KeyObject): Signed<T> {
  return { record: structuredClone(record), signature: sign(null, Buffer.from(canonicalJson({domain:'omb/pw9-host@1',record})), key).toString('base64') };
}
export class Ed25519Authority implements HostAuthority {
  constructor(readonly publicKey: KeyObject) { assert(publicKey.asymmetricKeyType === 'ed25519', 'Ed25519 host key required'); }
  verify<T>(value: Signed<T>): boolean {
    try { return verify(null, Buffer.from(canonicalJson({domain:'omb/pw9-host@1',record:value.record})), this.publicKey, Buffer.from(value.signature,'base64')); } catch { return false; }
  }
}
export const html = (s: string): string => s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
