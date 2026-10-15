import { canonicalJson as coreCanonicalJson, canonicalSha256 } from '../../bio-core/src/index.ts';
export const MAX_JSON_BYTES = 16_000_000;
export const MAX_JSON_VALUES = 1_000_000;
export const MAX_JSON_OBJECT_KEYS = 65_536;
const malformedUnicode = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
/** Reject lossy JS inputs before the core canonicalizer sees them. No getters are evaluated. */
export function assertJson(value: unknown): void {
  const ancestors = new Set<object>();
  let count = 0;
  function visit(v: unknown, depth: number, tuple = false): void {
    if (++count > MAX_JSON_VALUES || depth > 100) throw new Error('JSON resource limit');
    if (v === null || typeof v === 'boolean') return;
    if (typeof v === 'string') { if(tuple){const embedded:unknown=JSON.parse(v);if(Array.isArray(embedded)){count+=embedded.length;if(count>MAX_JSON_VALUES)throw new Error('JSON resource limit: tuple components');}} if (malformedUnicode.test(v)) throw new Error('unpaired Unicode surrogate'); return; }
    if (typeof v === 'number') { if (!Number.isFinite(v) || (Number.isInteger(v) && !Number.isSafeInteger(v)) || Object.is(v, -0)) throw new Error('lossy JSON number'); return; }
    if (typeof v !== 'object') throw new Error('non-JSON value');
    if (ancestors.has(v)) throw new Error('cyclic JSON');
    if (Object.getPrototypeOf(v) !== (Array.isArray(v) ? Array.prototype : Object.prototype) && Object.getPrototypeOf(v) !== null) throw new Error('non-plain JSON object');
    ancestors.add(v);
    // Reject giant arrays before allocating descriptors/keys proportional to their length.
    if (Array.isArray(v) && v.length > MAX_JSON_VALUES - count) throw new Error('JSON resource limit');
    const keys = Reflect.ownKeys(v);
    if (!Array.isArray(v) && keys.length > MAX_JSON_OBJECT_KEYS) throw new Error('JSON resource limit: object keys');
    if (keys.length > MAX_JSON_VALUES - count) throw new Error('JSON resource limit');
    if (Array.isArray(v) && keys.length !== v.length + 1) throw new Error('sparse or decorated array');
    let index = 0;
    for (const k of keys) {
      if (typeof k !== 'string') throw new Error('symbol key');
      if (Array.isArray(v) && k === 'length') continue;
      if (Array.isArray(v) && k !== String(index++)) throw new Error('sparse or decorated array');
      const d = Object.getOwnPropertyDescriptor(v, k)!;
      if (forbidden.has(k) || !d.enumerable || !('value' in d)) throw new Error('unsafe JSON property');
      if (malformedUnicode.test(k)) throw new Error('unpaired Unicode key');
      visit(d.value, depth + 1, (k === 'original' || k === 'canonical') && Object.getOwnPropertyDescriptor(v, 'encoding')?.value === 'canonical-json-array');
    }
    ancestors.delete(v);
  }
  visit(value, 0);
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_JSON_BYTES) throw new Error('JSON byte limit');
}
export function canonicalJson(value: unknown): string { assertJson(value); return coreCanonicalJson(value); }
export function contentHash(value: unknown): string { assertJson(value); return canonicalSha256(value); }
export function canonicalTuple(values: readonly string[]): string {
  if (!Array.isArray(values) || !values.length || values.some(v => typeof v !== 'string')) throw new Error('expected a nonempty string tuple');
  return canonicalJson(values);
}
/** JSON.parse alone discards duplicate keys. Scan the complete grammar before parsing. */
export function parseStrictJson(text: string): unknown {
  if (Buffer.byteLength(text, 'utf8') > MAX_JSON_BYTES) throw new Error('JSON byte limit');
  let i = 0, count = 0;
  const whitespace = () => { while (/[\x20\t\r\n]/.test(text[i] ?? '') && i < text.length) i++; };
  const string = (): string => {
    const start = i++;
    while (i < text.length) {
      const c = text[i++];
      if (c === '"') return JSON.parse(text.slice(start, i)) as string;
      if (c === '\\') i++;
    }
    throw new Error('unterminated string');
  };
  function scan(depth: number): void {
    if (++count > MAX_JSON_VALUES) throw new Error('JSON resource limit');
    if (depth > 100) throw new Error('JSON depth limit');
    whitespace();
    if (text[i] === '"') { string(); return; }
    if (text[i] === '{') {
      i++; whitespace(); const keys = new Set<string>();
      if (text[i] === '}') { i++; return; }
      while (true) {
        whitespace(); if (text[i] !== '"') throw new Error('expected object key');
        const key = string(); if (keys.has(key) || forbidden.has(key)) throw new Error('duplicate or unsafe key'); keys.add(key); if (keys.size > MAX_JSON_OBJECT_KEYS) throw new Error('JSON resource limit: object keys');
        whitespace(); if (text[i++] !== ':') throw new Error('expected colon'); scan(depth + 1); whitespace();
        const c = text[i++]; if (c === '}') return; if (c !== ',') throw new Error('expected comma');
      }
    }
    if (text[i] === '[') {
      i++; whitespace(); if (text[i] === ']') { i++; return; }
      while (true) { scan(depth + 1); whitespace(); const c = text[i++]; if (c === ']') return; if (c !== ',') throw new Error('expected comma'); }
    }
    const match = /^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(text.slice(i));
    if (!match) throw new Error('invalid JSON token'); i += match[0].length;
  }
  scan(0); whitespace(); if (i !== text.length) throw new Error('trailing JSON');
  const value: unknown = JSON.parse(text); assertJson(value); return value;
}
