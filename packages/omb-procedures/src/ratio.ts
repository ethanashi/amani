import { tPValue, tQuantileUpper, type Direction } from './special.ts';
import { contentSeed, gcdAll, scaleColumn, sortedAsc } from './scale.ts';
import { refused, type ProcedureResult } from './types.ts';
import { bootPFrom, bootstrapTDraws, invertBoundary, permutationP, welchOf } from './twogroup.ts';
import { DEFAULT_DIAGNOSTICS, diagnose, type DiagnosticsConfig } from './diagnostics.ts';

/**
 * Ratio of geometric means for positive concentrations: the registered two-group procedure
 * (Welch-studentized permutation, max with Welch-Satterthwaite) on log values of the
 * integer-scaled data. Rescaling by 10^k with the resolution, and row order, cannot change the
 * decision; shifts are not an invariance of a ratio estimand. Zeros and negatives are refused.
 */
export interface RatioInput { a: readonly (number | string)[]; b: readonly (number | string)[]; decimals: number; nullRatio?: number; direction?: Direction; alpha?: number; B?: number; seed?: string; diagnostics?: DiagnosticsConfig | false;
  /** Compute the interval by inverting the decision rule (default true). */
  interval?: boolean }

export function canonicalLogs(a: readonly (number | string)[], b: readonly (number | string)[], decimals: number, nullRatio = 1): { v: Float64Array; na: number } | null {
  const ai = scaleColumn(a, decimals), bi = scaleColumn(b, decimals);
  if ([...ai, ...bi].some(v => v <= 0)) return null;
  const g = gcdAll([...ai, ...bi]) || 1, l0 = Math.log(nullRatio);
  return { v: Float64Array.from([...sortedAsc(ai).map(x => Math.log(x / g)), ...sortedAsc(bi).map(x => Math.log(x / g) - l0)]), na: ai.length };
}

/** Procedure id (also the default-seed label). */
export const RATIO_ID = 'ratio.log-gm-welch-perm@2';
export function ratioSeed(na: number, nullFreeLogs: ArrayLike<number>, B: number): string { return contentSeed(RATIO_ID, na, Array.from(nullFreeLogs), B); }

export function ratioOfGeometricMeans(input: RatioInput): ProcedureResult {
  const id = RATIO_ID, direction = input.direction ?? 'two-sided', alpha = input.alpha ?? 0.05, B = input.B ?? 9999, r0 = input.nullRatio ?? 1;
  if (!(r0 > 0)) throw new Error('null ratio must be positive');
  const c = canonicalLogs(input.a, input.b, input.decimals, r0);
  const envelope = { nA: input.a.length, nB: input.b.length, nMin: Math.min(input.a.length, input.b.length) };
  if (!c) return refused(id, 'non-positive value on a ratio scale', direction, alpha, r0, envelope);
  if (c.na < 2 || c.v.length - c.na < 2) return refused(id, 'fewer than two units in an arm', direction, alpha, r0, envelope);
  const w = welchOf(c.v, c.na);
  if (input.diagnostics !== false) {
    const la = c.v.slice(0, c.na), lb = c.v.slice(c.na);
    const dg = diagnose([la, lb], [scaleColumn(input.a, input.decimals), scaleColumn(input.b, input.decimals)], input.diagnostics ?? DEFAULT_DIAGNOSTICS);
    if (dg.refused) return refused(id, `data-validity diagnostic: ${dg.reason}`, direction, alpha, r0, envelope, r0 * Math.exp(w.diff));
  }
  if (w.se === 0 && w.diff !== 0) return refused(id, 'zero within-arm variance (near-zero SE)', direction, alpha, r0, envelope);
  const seed = input.seed ?? ratioSeed(c.na, canonicalLogs(input.a, input.b, input.decimals, 1)!.v, B);
  const pW = w.se === 0 ? 1 : tPValue(w.t, w.df, direction), perm = permutationP(c.v, c.na, direction, seed, B);
  const boot = direction === 'two-sided' ? null : bootstrapTDraws(c.v, c.na, seed, B), pB = boot ? bootPFrom(boot, w.t, direction) : 0;
  const accept = (delta: number) => {
    const s = Float64Array.from(c.v, (x, i) => (i >= c.na ? x - delta : x)), ww = welchOf(s, c.na);
    const pw = ww.se === 0 ? (ww.diff === 0 ? 1 : 0) : tPValue(ww.t, ww.df, direction);
    return pw > alpha || (boot !== null && bootPFrom(boot, ww.t, direction) > alpha) || permutationP(s, c.na, direction, seed, B).p > alpha;
  };
  const step = w.se > 0 ? w.se : 1;
  const lo = input.interval === false ? NaN : direction === 'less' ? -Infinity : invertBoundary(accept, w.diff, step, -1);
  const hi = input.interval === false ? NaN : direction === 'greater' ? Infinity : invertBoundary(accept, w.diff, step, 1);
  const q = w.se > 0 ? tQuantileUpper(direction === 'two-sided' ? alpha / 2 : alpha, w.df) : 0;
  return { procedure: id, status: 'ok', estimate: r0 * Math.exp(w.diff), nullValue: r0, direction, alpha, p: Math.max(pW, perm.p, pB),
    ci: [r0 * Math.exp(lo), r0 * Math.exp(hi)],
    components: { tLog: w.t, df: w.df, seLog: w.se, pWelch: pW, pPerm: perm.p, welchLower: r0 * Math.exp(w.diff - q * w.se), welchUpper: r0 * Math.exp(w.diff + q * w.se) }, envelope };
}
