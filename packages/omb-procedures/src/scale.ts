import { sha256 } from './rng.ts';

/**
 * Integer scaling. The contract records each numeric column's decimal resolution; kernels
 * compute on integers m with value = m * 10^-decimals. Rescaling a column by 10^k together
 * with its resolution, writing 101 as 101.0, shifting by a multiple of the resolution, or
 * reordering rows then yields the same canonical integers, hence the same decision.
 */

export interface Decimal { mantissa: bigint; exponent: number }

/** Strict decimal grammar: optional sign, digits, optional fraction, optional exponent.
 * Hex (0x65), Infinity, NaN, '.5', '5.' and embedded spaces are refused. */
const DECIMAL = /^([+-]?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/;

export function parseDecimal(text: string): Decimal {
  const m = DECIMAL.exec(text);
  if (!m) throw new Error(`not a decimal number: ${JSON.stringify(text)}`);
  const sign = m[1] === '-' ? -1n : 1n, whole = m[2]!, frac = m[3] ?? '', exp = Number(m[4] ?? '0');
  if (!Number.isSafeInteger(exp) || Math.abs(exp) > 400) throw new Error('decimal exponent out of range');
  return { mantissa: sign * BigInt(whole + frac), exponent: exp - frac.length };
}

/** Shortest round-trip decimal of a finite double (String(v) is shortest round-trip in JS). */
export function numberToDecimal(v: number): Decimal {
  if (!Number.isFinite(v)) throw new Error('non-finite number');
  const s = String(v).replace('e+', 'e');
  return parseDecimal(s);
}

const pow10 = (k: number): bigint => 10n ** BigInt(k);

/**
 * Scale one value onto the grid 10^-decimals. Strings must lie exactly on the grid.
 * Numbers may carry binary floating-point noise: they are rounded to the grid only when the
 * distance to the nearest grid point is within 4 ULPs of the value AND within 1e-3 of the grid
 * step (so 0.1 + 0.2 at 2 decimals is 30, but 1000000000.4 at 0 decimals is refused: audit 7).
 */
export function scaleValue(value: number | string, decimals: number): bigint {
  if (!Number.isSafeInteger(decimals) || Math.abs(decimals) > 300) throw new Error('invalid decimal resolution');
  const d = typeof value === 'string' ? parseDecimal(value.trim() === value ? value : '!') : numberToDecimal(value);
  const shift = d.exponent + decimals; // value * 10^decimals = mantissa * 10^shift
  if (shift >= 0) return d.mantissa * pow10(shift);
  const div = pow10(-shift), q = d.mantissa / div, r = d.mantissa % div;
  if (r === 0n) return q;
  if (typeof value === 'string') throw new Error(`value ${value} is finer than the declared resolution (${decimals} decimals)`);
  // Round half away from zero; the distance to the grid point, in grid units, is exact from the remainder.
  const absR = r < 0n ? -r : r, twice = 2n * absR, up = twice >= div;
  const rounded = up ? q + (d.mantissa < 0n ? -1n : 1n) : q;
  const devGrid = Number(up ? div - absR : absR) / Number(div);
  const ulpGrid = ulp(value) * 10 ** decimals;
  if (!(devGrid <= 1e-3 && devGrid <= 4 * ulpGrid)) {
    throw new Error(`value ${value} is finer than the declared resolution (${decimals} decimals)`);
  }
  return rounded;
}

/** Unit in the last place of a finite double. */
export function ulp(v: number): number {
  const a = Math.abs(v);
  if (a === 0) return Number.MIN_VALUE;
  if (a < 2.2250738585072014e-308) return Number.MIN_VALUE;
  let e = Math.floor(Math.log2(a));
  if (2 ** e > a) e--; else if (2 ** (e + 1) <= a) e++;
  return 2 ** (e - 52);
}

/** Scale a column; every result must be a safe integer. */
export function scaleColumn(values: readonly (number | string)[], decimals: number): number[] {
  return values.map(v => {
    const m = scaleValue(v, decimals);
    if (m > BigInt(Number.MAX_SAFE_INTEGER) || m < -BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('scaled value exceeds the safe integer range; coarsen the resolution');
    return Number(m);
  });
}

/** Minimal decimals a value needs (negative for trailing zeros, -Infinity for zero: no requirement). */
export function decimalsOf(value: number | string): number {
  const d = typeof value === 'string' ? parseDecimal(value) : numberToDecimal(value);
  if (d.mantissa === 0n) return -Infinity;
  let m = d.mantissa, e = d.exponent;
  while (m % 10n === 0n) { m /= 10n; e++; }
  return -e;
}

/** Greatest common divisor of the absolute values of safe integers (0 if all are zero). */
export function gcdAll(ints: ArrayLike<number>): number {
  let g = 0;
  for (let i = 0; i < ints.length; i++) { let a = Math.abs(ints[i]!), b = g; while (b) { const t = a % b; a = b; b = t; } g = a; if (g === 1) return 1; }
  return g;
}
/** Divide by the gcd: canonical integers no longer depend on how fine the declared resolution is. */
export function reduceByGcd(ints: readonly number[]): { values: number[]; g: number } {
  const g = gcdAll(ints) || 1; return { values: ints.map(v => v / g), g };
}

/** Subtract the minimum: invariant under shifts by a multiple of the resolution. */
export function shiftToZero(ints: readonly number[]): number[] {
  let min = Infinity; for (const v of ints) if (v < min) min = v;
  return ints.map(v => v - min);
}

/** Ascending numeric copy. */
export function sortedAsc(values: readonly number[]): number[] { return [...values].sort((a, b) => a - b); }

/** Seed derived only from canonical content, so equivalent inputs draw identical resamples. */
export function contentSeed(procedure: string, ...parts: readonly unknown[]): string {
  return sha256(JSON.stringify([procedure, ...parts]));
}

export interface ScaledInput { values: readonly (number | string)[]; decimals: number }
