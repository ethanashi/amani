import { Rng } from './rng.ts';
import { choose, tPValue, tQuantileUpper, type Direction } from './special.ts';
import { contentSeed, decimalsOf, reduceByGcd, scaleColumn, scaleValue, shiftToZero, sortedAsc } from './scale.ts';
import { atLeastAsExtreme, mcThreshold, refused, type ProcedureResult, type TestSpec } from './types.ts';
import { DEFAULT_DIAGNOSTICS, diagnose, type DiagnosticsConfig } from './diagnostics.ts';

/** Exhaustive enumeration of label splits when C(N, k) is at most this. */
export const ENUM_LIMIT = 20000;

export interface Welch { diff: number; se: number; t: number; df: number; va: number; vb: number }

/** Welch t of group b minus group a from sums. Cancellation is snapped to exact zero. */
export function welchFromSums(na: number, sa: number, qa: number, nb: number, sb: number, qb: number): Welch {
  let num = na * sb - nb * sa;
  if (Math.abs(num) <= 1e-12 * (na * Math.abs(sb) + nb * Math.abs(sa))) num = 0;
  let ssa = na * qa - sa * sa; if (ssa <= 1e-12 * na * qa) ssa = 0;
  let ssb = nb * qb - sb * sb; if (ssb <= 1e-12 * nb * qb) ssb = 0;
  const va = ssa / na / (na - 1), vb = ssb / nb / (nb - 1);
  const ua = va / na, ub = vb / nb, se2 = ua + ub, se = Math.sqrt(se2);
  const diff = num / (na * nb);
  const t = se > 0 ? diff / se : num === 0 ? 0 : Math.sign(num) * Infinity;
  const df = se > 0 ? se2 * se2 / (ua * ua / (na - 1) + ub * ub / (nb - 1)) : NaN;
  return { diff, se, t, df, va, vb };
}

function sums(v: ArrayLike<number>, from: number, to: number): [number, number] {
  let s = 0, q = 0; for (let i = from; i < to; i++) { const x = v[i]!; s += x; q += x * x; } return [s, q];
}

/** Welch statistics for the canonical pooled vector v = [a..., b...]. */
export function welchOf(v: ArrayLike<number>, na: number): Welch {
  const n = v.length, [sa, qa] = sums(v, 0, na), [sb, qb] = sums(v, na, n);
  return welchFromSums(na, sa, qa, n - na, sb, qb);
}

/** Pooled-variance (Student) two-sample t: the oracle under normal equal-variance errors. */
export function pooledT(v: ArrayLike<number>, na: number): { t: number; df: number } {
  const n = v.length, nb = n - na, [sa, qa] = sums(v, 0, na), [sb, qb] = sums(v, na, n);
  const diff = sb / nb - sa / na, ss = (qa - sa * sa / na) + (qb - sb * sb / nb), df = n - 2;
  const se = Math.sqrt(Math.max(0, ss) / df * (1 / na + 1 / nb));
  return { t: se > 0 ? diff / se : diff === 0 ? 0 : Math.sign(diff) * Infinity, df };
}

/**
 * Label-permutation engine over a fixed canonical vector. Subsets are index-based so that the
 * same seed yields the same subsets at every null value (used for interval inversion).
 * The selected subset (size k = min(na, nb)) plays the role of the smaller group.
 */
export class LabelPermutations {
  readonly n: number; readonly na: number; readonly nb: number; readonly k: number; readonly smallIsA: boolean;
  readonly total: number; readonly exhaustive: boolean;
  constructor(n: number, na: number) {
    this.n = n; this.na = na; this.nb = n - na; this.smallIsA = na <= n - na; this.k = Math.min(na, n - na);
    this.total = choose(n, this.k); this.exhaustive = this.total <= ENUM_LIMIT;
  }
  /** Statistic for a split given the selected-subset sums. */
  stat(sSel: number, qSel: number, sAll: number, qAll: number): number {
    const sRest = sAll - sSel, qRest = qAll - qSel;
    return this.smallIsA ? welchFromSums(this.na, sSel, qSel, this.nb, sRest, qRest).t
      : welchFromSums(this.na, sRest, qRest, this.nb, sSel, qSel).t;
  }
  /** Visit every split (exhaustive). Returns early if visit returns false. */
  enumerate(v: ArrayLike<number>, visit: (t: number) => boolean | void): void {
    const n = this.n, k = this.k, [sAll, qAll] = sums(v, 0, n), idx = new Int32Array(k);
    for (let i = 0; i < k; i++) idx[i] = i;
    for (;;) {
      let s = 0, q = 0; for (let i = 0; i < k; i++) { const x = v[idx[i]!]!; s += x; q += x * x; }
      if (visit(this.stat(s, q, sAll, qAll)) === false) return;
      let i = k - 1; while (i >= 0 && idx[i] === n - k + i) i--;
      if (i < 0) return;
      idx[i]!++; for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1]! + 1;
    }
  }
  /** Draw B random splits from the seeded stream (partial Fisher-Yates on an index array). */
  sample(v: ArrayLike<number>, seed: string, B: number, visit: (t: number) => boolean | void): void {
    const n = this.n, k = this.k, [sAll, qAll] = sums(v, 0, n), rng = new Rng(seed), w = new Int32Array(n);
    for (let i = 0; i < n; i++) w[i] = i;
    for (let b = 0; b < B; b++) {
      let s = 0, q = 0;
      for (let i = 0; i < k; i++) {
        const j = i + rng.int(n - i), t = w[i]!; w[i] = w[j]!; w[j] = t;
        const x = v[w[i]!]!; s += x; q += x * x;
      }
      if (visit(this.stat(s, q, sAll, qAll)) === false) return;
    }
  }
}

/** Permutation p-value of the observed Welch t in one direction (exact or plus-one Monte Carlo). */
export function permutationP(v: ArrayLike<number>, na: number, direction: Direction, seed: string, B: number): { p: number; extreme: number; draws: number; exhaustive: boolean } {
  const perm = new LabelPermutations(v.length, na), tObs = welchOf(v, na).t;
  let extreme = 0, draws = 0;
  const visit = (t: number) => { draws++; if (atLeastAsExtreme(t, tObs, direction)) extreme++; };
  if (perm.exhaustive) { perm.enumerate(v, visit); return { p: extreme / draws, extreme, draws, exhaustive: true }; }
  perm.sample(v, seed, B, visit);
  return { p: (1 + extreme) / (1 + B), extreme, draws, exhaustive: false };
}

/**
 * Decision-only path used by the simulator: identical decisions to the full procedure with the
 * same seed (same subsets in the same order), but skips resampling when the Welch branch already
 * retains and stops early once a Monte Carlo count passes its threshold.
 */
export function welchPermDecide(v: ArrayLike<number>, na: number, seedIn: string | (() => string), B: number, tests: readonly TestSpec[]): { reject: boolean[]; pWelch: number[]; welchReject: boolean[]; refused: boolean } {
  const seedOf = (): string => (typeof seedIn === 'string' ? seedIn : seedIn());
  const w = welchOf(v, na);
  if (na < 2 || v.length - na < 2 || (w.se === 0 && w.diff !== 0)) return { reject: tests.map(() => false), pWelch: tests.map(() => 1), welchReject: tests.map(() => false), refused: true };
  const pW = tests.map(s => w.se === 0 ? 1 : tPValue(w.t, w.df, s.direction));
  const welchReject = tests.map((s, i) => pW[i]! <= s.alpha);
  const need = tests.map((_, i) => welchReject[i]!);
  if (!need.some(Boolean)) return { reject: need, pWelch: pW, welchReject, refused: false };
  const perm = new LabelPermutations(v.length, na), counts = tests.map(() => 0);
  if (perm.exhaustive) {
    let total = 0;
    perm.enumerate(v, t => { total++; tests.forEach((s, i) => { if (need[i] && atLeastAsExtreme(t, w.t, s.direction)) counts[i]!++; }); });
    return { reject: tests.map((s, i) => need[i]! && counts[i]! / total <= s.alpha), pWelch: pW, welchReject, refused: false };
  }
  const thresholds = tests.map(s => mcThreshold(s.alpha, B));
  perm.sample(v, seedOf(), B, t => {
    let open = false;
    tests.forEach((s, i) => {
      if (!need[i]) return;
      if (atLeastAsExtreme(t, w.t, s.direction)) counts[i]!++;
      if (counts[i]! <= thresholds[i]!) open = true;
    });
    return open;
  });
  return { reject: tests.map((_, i) => need[i]! && counts[i]! <= thresholds[i]!), pWelch: pW, welchReject, refused: false };
}

export interface TwoGroupInput {
  a: readonly (number | string)[];
  b: readonly (number | string)[];
  /** Contract decimal resolution of the outcome. */
  decimals: number;
  /** H0: mean(b) - mean(a) = nullValue. */
  nullValue?: number | string;
  direction?: Direction;
  alpha?: number;
  /** Monte Carlo resamples when enumeration is too large. */
  B?: number;
  /** Defaults to a content-derived seed (invariant under the metamorphic transformations). */
  seed?: string;
  /** Refusal-only data-validity diagnostics (default on). */
  diagnostics?: DiagnosticsConfig | false;
  /** Compute the interval by inverting the decision rule (default true). */
  interval?: boolean;
}

export interface CanonicalTwoGroup { v: Float64Array; na: number; decimals: number; nullInt: number; estimateInt: number; g: number }

/** Integer-scale, impose the null on b, shift to zero, sort each group: the canonical vector. */
export function canonicalTwoGroup(a: readonly (number | string)[], b: readonly (number | string)[], decimals: number, nullValue: number | string = 0): CanonicalTwoGroup {
  const dec = Math.max(decimals, decimalsOf(nullValue));
  return canonicalTwoGroupInts(scaleColumn(a, dec), scaleColumn(b, dec), Number(scaleValue(nullValue, dec)), dec);
}

/** Canonical form from integer-scaled arms (used directly by the simulator). */
export function canonicalTwoGroupInts(ai: readonly number[], bi: readonly number[], d0: number, decimals = 0): CanonicalTwoGroup {
  // Exact numerator in BigInt: raw sums of safe integers can exceed 2^53 (audit 6).
  let sa = 0n, sb = 0n; for (const x of ai) sa += BigInt(x); for (const x of bi) sb += BigInt(x);
  const estimateNum = Number(BigInt(ai.length) * sb - BigInt(bi.length) * sa);
  const { values: pooled, g } = reduceByGcd(shiftToZero([...ai, ...bi.map(x => x - d0)]));
  const v = Float64Array.from([...sortedAsc(pooled.slice(0, ai.length)), ...sortedAsc(pooled.slice(ai.length))]);
  return { v, na: ai.length, decimals, nullInt: d0, estimateInt: estimateNum / (ai.length * bi.length), g };
}

/** The content seed the two-group procedure derives (exported so the simulator uses the same). */
export function twoGroupSeed(c: CanonicalTwoGroup, B: number): string { return contentSeed('two-group.welch-perm@1', c.na, Array.from(c.v), B); }

/** Find the boundary of {delta : accept(delta)} moving away from est in direction sign. */
export function invertBoundary(accept: (delta: number) => boolean, est: number, step: number, sign: 1 | -1): number {
  if (!(step > 0) || !Number.isFinite(step)) step = Math.max(1, Math.abs(est));
  let inside = est, outside = NaN;
  for (let m = 0; m < 60; m++) {
    const d = est + sign * step * 2 ** m;
    if (!accept(d)) { outside = d; break; }
    inside = d;
  }
  if (Number.isNaN(outside)) return sign * Infinity;
  for (let i = 0; i < 80; i++) {
    const mid = (inside + outside) / 2;
    if (mid === inside || mid === outside) break;
    if (accept(mid)) inside = mid; else outside = mid;
  }
  return inside;
}

/**
 * Two-group difference in means: Welch-studentized label permutation, decision
 * p = max(p_perm, p_Welch-Satterthwaite). The interval inverts the same max rule, which is the
 * union (hull) of the Welch interval and the permutation interval.
 */
export function twoGroupWelchPermutation(input: TwoGroupInput): ProcedureResult {
  const id = 'two-group.welch-perm@2';
  const direction = input.direction ?? 'two-sided', alpha = input.alpha ?? 0.05, B = input.B ?? 9999;
  const c = canonicalTwoGroup(input.a, input.b, input.decimals, input.nullValue ?? 0);
  // Null-free canonical content for the default seed (audit 2): identical draws at every null value.
  const ai = scaleColumn(input.a, c.decimals), bi = scaleColumn(input.b, c.decimals);
  const c0 = canonicalTwoGroupInts(ai, bi, 0, c.decimals);
  const scale = 10 ** -c.decimals, na = c.na, nb = c.v.length - na, nullValue = c.nullInt * scale;
  const envelope = { nA: na, nB: nb, nMin: Math.min(na, nb), imbalance: Math.max(na, nb) / Math.min(na, nb) };
  if (na < 2 || nb < 2) return refused(id, 'fewer than two units in an arm', direction, alpha, nullValue, envelope);
  const estimate = c.estimateInt * scale;
  if (input.diagnostics !== false) {
    const dg = diagnose([ai, bi], [ai, bi], input.diagnostics ?? DEFAULT_DIAGNOSTICS);
    if (dg.refused) return refused(id, `data-validity diagnostic: ${dg.reason}`, direction, alpha, nullValue, envelope, estimate);
  }
  const w = welchOf(c.v, na);
  if (w.se === 0 && w.diff !== 0) return refused(id, 'zero within-arm variance (near-zero SE)', direction, alpha, nullValue, envelope, estimate);
  const seed = input.seed ?? twoGroupSeed(c0, B);
  const pW = w.se === 0 ? 1 : tPValue(w.t, w.df, direction);
  const perm = permutationP(c.v, na, direction, seed, B);
  // Directional claims add a studentized bootstrap-t branch (second-order correct for skewed arms).
  const boot = direction === 'two-sided' ? null : bootstrapTDraws(c.v, na, seed, B);
  const pB = boot ? bootPFrom(boot, w.t, direction) : 0;
  const p = Math.max(pW, perm.p, pB);
  // Interval: work in integer units relative to the null-imposed canonical vector.
  const est = w.diff; // estimate minus null, integer units
  const accept = (delta: number) => {
    const shifted = Float64Array.from(c.v, (x, i) => (i >= na ? x - delta : x));
    const ww = welchOf(shifted, na);
    const pw = ww.se === 0 ? (ww.diff === 0 ? 1 : 0) : tPValue(ww.t, ww.df, direction);
    if (pw > alpha) return true;
    if (boot && bootPFrom(boot, ww.t, direction) > alpha) return true;
    return permutationP(shifted, na, direction, seed, B).p > alpha;
  };
  const step = w.se > 0 ? w.se : 1;
  const lo = input.interval === false ? NaN : direction === 'less' ? -Infinity : invertBoundary(accept, est, step, -1);
  const hi = input.interval === false ? NaN : direction === 'greater' ? Infinity : invertBoundary(accept, est, step, 1);
  const ciAlphaQ = direction === 'two-sided' ? alpha / 2 : alpha;
  const welchHalf = w.se > 0 ? tQuantileUpper(ciAlphaQ, w.df) * w.se : 0;
  return {
    procedure: id, status: 'ok', estimate, nullValue, direction, alpha, p,
    ci: [(lo * c.g + c.nullInt) * scale, (hi * c.g + c.nullInt) * scale],
    components: { t: w.t, df: w.df, se: w.se * c.g * scale, pWelch: pW, pPerm: perm.p, pBoot: boot ? pB : NaN, permDraws: perm.draws, permExhaustive: perm.exhaustive ? 1 : 0,
      welchLower: ((est - welchHalf) * c.g + c.nullInt) * scale, welchUpper: ((est + welchHalf) * c.g + c.nullInt) * scale },
    envelope,
  };
}

/** Plain Welch-Satterthwaite p (no resampling): a component and a reference. */
export function welchP(v: ArrayLike<number>, na: number, direction: Direction): number {
  const w = welchOf(v, na); return w.se === 0 ? (w.diff === 0 ? 1 : 0) : tPValue(w.t, w.df, direction);
}

// ---------------------------------------------------------------------------------------------
// EXPERIMENTAL (K2a): Welch-studentized bootstrap-t branch for directional claims.
// The permutation and Welch branches share the same first-order skewness error under the weak
// null with differently shaped arms; the two-sample bootstrap-t (each arm resampled separately,
// t* = (d* - d_hat) / se*) removes the O(n^-1/2) term for one-sided tests (Hall 1992). Decision:
// p = max(p_Welch, p_perm, p_boot), so the sharp-null exactness of the permutation branch is kept.
// ---------------------------------------------------------------------------------------------

/** Visit bootstrap-t statistics (centred at the observed difference) from the seeded stream. */
export function bootstrapT(v: ArrayLike<number>, na: number, seed: string, B: number, visit: (t: number) => boolean | void): void {
  const n = v.length, nb = n - na, rng = new Rng(seed + ':boot'), dHat = welchOf(v, na).diff;
  for (let b = 0; b < B; b++) {
    let sa = 0, qa = 0, sb = 0, qb = 0;
    for (let i = 0; i < na; i++) { const x = v[rng.int(na)]!; sa += x; qa += x * x; }
    for (let i = 0; i < nb; i++) { const x = v[na + rng.int(nb)]!; sb += x; qb += x * x; }
    const w = welchFromSums(na, sa, qa, nb, sb, qb);
    let num = w.diff - dHat; if (Math.abs(num) <= 1e-12 * (Math.abs(w.diff) + Math.abs(dHat))) num = 0;
    const t = w.se > 0 ? num / w.se : num === 0 ? 0 : Math.sign(num) * Infinity;
    if (visit(t) === false) return;
  }
}

/** All B bootstrap-t draws (centred at the observed difference, so invariant to the tested null). */
export function bootstrapTDraws(v: ArrayLike<number>, na: number, seed: string, B: number): Float64Array {
  const out = new Float64Array(B); let i = 0; bootstrapT(v, na, seed, B, t => { out[i++] = t; }); return out;
}
export function bootPFrom(draws: Float64Array, tObs: number, direction: Direction): number {
  let extreme = 0; for (const t of draws) if (atLeastAsExtreme(t, tObs, direction)) extreme++;
  return (1 + extreme) / (1 + draws.length);
}

export function bootstrapTP(v: ArrayLike<number>, na: number, direction: Direction, seed: string, B: number): number {
  const tObs = welchOf(v, na).t; let extreme = 0;
  bootstrapT(v, na, seed, B, t => { if (atLeastAsExtreme(t, tObs, direction)) extreme++; });
  return (1 + extreme) / (1 + B);
}

/** Decision path of the registered procedure: max(Welch, permutation) for two-sided tests and
 * max(Welch, permutation, bootstrap-t) for directional tests. Identical to computing the p-values. */
export function twoGroupDecide(v: ArrayLike<number>, na: number, seedIn: string | (() => string), B: number, tests: readonly TestSpec[]): { reject: boolean[]; welchReject: boolean[]; refused: boolean } {
  const r = welchPermBootDecide(v, na, seedIn, B, tests, t => t.direction !== 'two-sided');
  return { reject: r.reject, welchReject: r.welchReject, refused: r.refused };
}

/** Decision path for max(Welch, permutation, bootstrap-t) on the tests selected by `withBoot` (default all). */
export function welchPermBootDecide(v: ArrayLike<number>, na: number, seedIn: string | (() => string), B: number, tests: readonly TestSpec[], withBoot: (t: TestSpec) => boolean = () => true): { reject: boolean[]; welchReject: boolean[]; permBootReject: boolean[]; refused: boolean } {
  const base = welchPermDecide(v, na, seedIn, B, tests);
  const permReject = base.reject;
  if (base.refused || !permReject.some((x, i) => x && withBoot(tests[i]!))) return { reject: permReject, welchReject: base.welchReject, permBootReject: permReject, refused: base.refused };
  const seed = typeof seedIn === 'string' ? seedIn : seedIn(), tObs = welchOf(v, na).t;
  const counts = tests.map(() => 0), thr = tests.map(s => mcThreshold(s.alpha, B));
  bootstrapT(v, na, seed, B, t => {
    let open = false;
    tests.forEach((s, i) => { if (!permReject[i] || !withBoot(s)) return; if (atLeastAsExtreme(t, tObs, s.direction)) counts[i]!++; if (counts[i]! <= thr[i]!) open = true; });
    return open;
  });
  const reject = tests.map((s, i) => permReject[i]! && (!withBoot(s) || counts[i]! <= thr[i]!));
  return { reject, welchReject: base.welchReject, permBootReject: reject, refused: false };
}
