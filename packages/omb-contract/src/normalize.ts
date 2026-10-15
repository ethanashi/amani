import { canonicalTuple, MAX_JSON_VALUES } from './json.ts';
import { DECIMAL_PATTERN, MAX_DECIMAL_LENGTH, type ContractStructure } from './schema.ts';
const decimalGrammar=new RegExp(DECIMAL_PATTERN,'u');
export function isStrictDecimal(value: string): boolean { return value.length <= MAX_DECIMAL_LENGTH && decimalGrammar.test(value); }
/** Exact decimal coefficient/exponent, without binary floating point or large powers of ten. */
export function decimalParts(value: string): { coefficient: bigint; exponent: bigint } {
  if (!isStrictDecimal(value)) throw new Error('invalid decimal');
  const [mantissa = '', exponent = '0'] = value.toLowerCase().split('e');
  const [whole = '', fraction = ''] = mantissa.split('.');
  const digits = whole + fraction;
  const trimmed = digits.replace(/0+$/, '');
  if (trimmed === '' || trimmed === '-') return { coefficient: 0n, exponent: 0n };
  const coefficient = BigInt(trimmed);
  const power = BigInt(exponent) - BigInt(fraction.length) + BigInt(digits.length - trimmed.length);
  return { coefficient, exponent: power };
}
const zeroWidth = /\p{Default_Ignorable_Code_Point}/gu;
const asciiUpper = /[A-Z]/g;
const hasAsciiUpper = /[A-Z]/;
const lowerAscii = (c: string) => c.toLowerCase();
const asciiSpace = (c: string) => c === ' ' || c === '\t' || c === '\r' || c === '\n';
/** Shared, deterministic work budget; callers can reuse it across an entire layer. */
export class UnicodeBudget {
  private work = 0;
  private values = 0;
  charge(value: string): void {
    // ASCII is cheap; count all ICU input/output, with a tighter non-ASCII budget.
    this.work += value.length * (/[^\x00-\x7f]/.test(value) ? 8 : 1);
    if (this.work > 8_000_000) throw new Error('Unicode work limit');
  }
  tuple(count: number): void {
    this.values += count;
    if (this.values > MAX_JSON_VALUES) throw new Error('JSON resource limit: tuple components');
  }
}
const nonAscii = /[^\x00-\x7f]/;
const mark = /\p{M}/u;
export function boundedIdentifier(value: string): void {
  if (value.length > MAX_DECIMAL_LENGTH) throw new Error('identifier token length limit');
  if (!nonAscii.test(value)) return;
  let run = 0;
  for (const c of value) {
    if (c.charCodeAt(0) < 0x300 || !mark.test(c)) run = 0;
    else if (++run > 32) throw new Error('identifier combining-mark run limit');
  }
}
export function normalizeIdentifier(original: string, namespace: ContractStructure['namespaces'][number], budget = new UnicodeBudget()): string {
  // A bit set avoids per-token allocation; declarations remain mutable and are never cached.
  let rules = 0;
  for (const rule of namespace.rules) {
    switch (rule) {
      case 'remove-zero-width': rules |= 1; break;
      case 'nfkc': rules |= 2; break;
      case 'trim-ascii': rules |= 4; break;
      case 'ascii-case-fold': rules |= 8; break;
      case 'canonical-decimal': rules |= 16; break;
      default: throw new Error('unknown normalization rule');
    }
  }
  // Bound ICU canonical reordering before invoking normalize, for every rule set.
  boundedIdentifier(original);
  budget.charge(original);
  let value = nonAscii.test(original) ? original.replace(zeroWidth, '') : original;
  boundedIdentifier(value);
  // Decompose before ASCII folding so NFC and NFD spellings remain equivalent.
  if (rules & 8) value = (nonAscii.test(value) ? value.normalize('NFD') : value).replace(asciiUpper, lowerAscii);
  if (nonAscii.test(value)) value = value.normalize('NFC');
  // Return only a demonstrated fixed point. A bounded refusal also covers future Unicode changes.
  for (let pass = 0; pass < 8; pass++) {
    const before = value;
    if (nonAscii.test(value)) value = value.replace(zeroWidth, '');
    if (rules & 8) value = (nonAscii.test(value) ? value.normalize('NFD') : value).replace(asciiUpper, lowerAscii);
    budget.charge(value);
    if (nonAscii.test(value)) value = value.normalize(rules & 2 ? 'NFKC' : 'NFC');
    if (value.length > original.length * 4) throw new Error('Unicode expansion exceeds 4x');
    budget.charge(value);
    boundedIdentifier(value);
    if (rules & 4) {
      let start = 0, end = value.length;
      while (start < end && asciiSpace(value[start]!)) start++;
      while (end > start && asciiSpace(value[end - 1]!)) end--;
      value = value.slice(start, end);
    }
    if ((rules & 8) && hasAsciiUpper.test(value)) value = value.replace(asciiUpper, lowerAscii);
    if ((rules & 16) && isStrictDecimal(value)) {
      const p = decimalParts(value); value = p.coefficient === 0n ? '0' : `${p.coefficient}e${p.exponent}`;
    }
    boundedIdentifier(value);
    if (before === value) return value;
  }
  throw new Error('normalization did not converge');
}
/** Compare exact decimals using digit strings; exponent magnitude cannot allocate a giant power. */
export function compareDecimals(left: string, right: string): -1 | 0 | 1 {
  const a = decimalParts(left), b = decimalParts(right);
  const sign = (x: bigint) => x < 0n ? -1 : x > 0n ? 1 : 0;
  const sa = sign(a.coefficient), sb = sign(b.coefficient);
  if (sa !== sb) return sa < sb ? -1 : 1;
  if (sa === 0) return 0;
  const ad = (a.coefficient < 0n ? -a.coefficient : a.coefficient).toString();
  const bd = (b.coefficient < 0n ? -b.coefficient : b.coefficient).toString();
  const am = BigInt(ad.length) + a.exponent, bm = BigInt(bd.length) + b.exponent;
  let order: -1 | 0 | 1;
  if (am !== bm) order = am < bm ? -1 : 1;
  else { const length = Math.max(ad.length, bd.length); const x = ad.padEnd(length, '0'), y = bd.padEnd(length, '0'); order = x === y ? 0 : x < y ? -1 : 1; }
  return sa < 0 ? (order === 0 ? 0 : order === 1 ? -1 : 1) : order;
}

/** Tuple aliases normalize components, never the serialized array as an opaque token. */
export function normalizeAlias(alias: ContractStructure['aliases'][number], namespace: ContractStructure['namespaces'][number], budget = new UnicodeBudget()): string {
  if (alias.encoding === 'token') return normalizeIdentifier(alias.original, namespace, budget);
  // Count embedded JSON strings against the same budget before per-component work.
  const parts: unknown = JSON.parse(alias.original);
  if (Array.isArray(parts)) budget.tuple(parts.length);
  if (Array.isArray(parts) && parts.length > 65_536) throw new Error('JSON resource limit: tuple arity');
  if (!Array.isArray(parts) || parts.some(v => typeof v !== 'string') || canonicalTuple(parts as string[]) !== alias.original) throw new Error('alias tuple must be a canonical JSON string array');
  return canonicalTuple(parts.map(v => normalizeIdentifier(v as string, namespace, budget)));
}
