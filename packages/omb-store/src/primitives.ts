import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { canonicalJson } from '../../bio-core/src/index.ts';
export { canonicalJson };
export function fail(message: string): never { throw new Error(`omb-store: ${message}`); }
export function text(value: string): void { if (typeof value !== 'string' || !value.length) fail('nonempty string required'); }
export function hash(value: string): void { if (!/^[a-f0-9]{64}$/.test(value)) fail('SHA-256 required'); }
export function key(value: Uint8Array): Buffer { if (value.length < 32) fail('host key must have at least 32 bytes'); return Buffer.from(value); }
export function digest(value: Uint8Array | string): string { return createHash('sha256').update(value).digest('hex'); }
/** Reject lossy/non-JSON objects before canonicalizing host boundary payloads. */
export function json(value: unknown): string {
  const seen = new Set<object>();
  function check(v: unknown): void {
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return;
    if (typeof v === 'number') { if (!Number.isFinite(v) || Object.is(v, -0)) fail('invalid JSON number'); return; }
    if (typeof v !== 'object' || seen.has(v)) fail('invalid JSON');
    seen.add(v);
    if (Array.isArray(v)) {
      if (Object.keys(v).length !== v.length) fail('sparse or decorated array');
      for (let i = 0; i < v.length; i++) {
        const d = Object.getOwnPropertyDescriptor(v, String(i));
        if (!d || !('value' in d)) fail('array accessor or hole');
        check(d.value);
      }
    } else {
      if (Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) fail('plain JSON object required');
      for (const [k, d] of Object.entries(Object.getOwnPropertyDescriptors(v))) {
        if (!d.enumerable || !('value' in d) || ['__proto__', 'constructor', 'prototype'].includes(k)) fail('unsafe JSON object');
        check(d.value);
      }
    }
    if (Object.getOwnPropertySymbols(v).length) fail('symbol JSON key');
    seen.delete(v);
  }
  check(value); return canonicalJson(value);
}
export function contentHash(value: unknown): string { return digest(json(value)); }
export function mac(hostKey: Uint8Array, domain: string, value: unknown): string {
  return createHmac('sha256', hostKey).update(domain).update('\0').update(json(value)).digest('hex');
}
export function equal(a: string, b: string): boolean {
  return /^[a-f0-9]{64}$/.test(a) && /^[a-f0-9]{64}$/.test(b) && timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}
export interface ContentTuple { registryVersion: string; planLockHash: string; contractHash: string; frozenCodeHash: string; dataHash: string }
export function tuple(t: ContentTuple): ContentTuple {
  text(t.registryVersion); [t.planLockHash, t.contractHash, t.frozenCodeHash, t.dataHash].forEach(hash);
  return { registryVersion: t.registryVersion, planLockHash: t.planLockHash, contractHash: t.contractHash, frozenCodeHash: t.frozenCodeHash, dataHash: t.dataHash };
}
export function deriveSeed(hostKey: Uint8Array, input: ContentTuple, purpose: string): string {
  text(purpose); return mac(key(hostKey), 'omb-store/content-seed/v1', [tuple(input), purpose]);
}
