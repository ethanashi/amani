import { Rng } from './rng.ts';
import { tPValue, tQuantileUpper, type Direction } from './special.ts';
import { contentSeed, decimalsOf, reduceByGcd, scaleColumn, scaleValue } from './scale.ts';
import { mcThreshold, refused, atLeastAsExtreme, type ProcedureResult, type TestSpec } from './types.ts';
import { invertBoundary, twoGroupWelchPermutation } from './twogroup.ts';
import { DEFAULT_DIAGNOSTICS, diagnose, type DiagnosticsConfig } from './diagnostics.ts';

/** One-sample bootstrap-t draws: resample contrasts, t* = (mean* - mean) / se*. Invariant to the tested null. */
export function oneSampleBootDraws(c: ArrayLike<number>, seed: string, B: number): Float64Array {
  const n = c.length, rng = new Rng(seed + ':boot'), out = new Float64Array(B);
  let m = 0; for (let i = 0; i < n; i++) m += c[i]!; m /= n;
  for (let b = 0; b < B; b++) {
    let s = 0, q = 0; for (let i = 0; i < n; i++) { const x = c[rng.int(n)]! - m; s += x; q += x * x; }
    let num = s; if (Math.abs(num) <= 1e-12 * Math.sqrt(q * n)) num = 0;
    const ss = Math.max(0, n * q - s * s), se = Math.sqrt(ss / n / (n - 1) / n);
    out[b] = se > 0 ? num / n / se : num === 0 ? 0 : Math.sign(num) * Infinity;
  }
  return out;
}
function bootP(draws: Float64Array, tObs: number, direction: Direction): number {
  let e = 0; for (const t of draws) if (atLeastAsExtreme(t, tObs, direction)) e++; return (1 + e) / (1 + draws.length);
}

/** Sign-flip enumerates all 2^n patterns when n is at most this. */
export const FLIP_ENUM_MAX_N = 16;

/** One-sample t of contrasts c (mean / (sd / sqrt n)). Integer inputs give exact S and nQ - S^2. */
export function oneSampleT(c: ArrayLike<number>): { mean: number; se: number; t: number; df: number; s: number; q: number } {
  const n = c.length; let s = 0, q = 0; for (let i = 0; i < n; i++) { s += c[i]!; q += c[i]! * c[i]!; }
  let mag = 0; for (let i = 0; i < n; i++) mag += Math.abs(c[i]!);
  if (Math.abs(s) <= 1e-12 * mag) s = 0;
  let ss = n * q - s * s; if (ss <= 1e-12 * n * q) ss = 0;
  const se = Math.sqrt(ss / n / (n - 1) / n), mean = s / n;
  return { mean, se, t: se > 0 ? mean / se : s === 0 ? 0 : Math.sign(s) * Infinity, df: n - 1, s, q };
}

/**
 * Sign-flip of unit contrasts. With q fixed, the studentized mean is monotone in S = sum v_i c_i,
 * so comparisons use S directly (exact for integer contrasts).
 */
export function signFlipVisit(c: ArrayLike<number>, seed: string, B: number, visit: (s: number) => boolean | void): { exhaustive: boolean } {
  const n = c.length;
  if (n <= FLIP_ENUM_MAX_N) {
    // Gray code: start with all +1, flip one sign per step.
    let s = 0; for (let i = 0; i < n; i++) s += c[i]!;
    const sign = new Int8Array(n).fill(1), total = 2 ** n;
    if (visit(s) === false) return { exhaustive: true };
    for (let g = 1; g < total; g++) {
      let j = 0; while (((g >> j) & 1) === 0) j++;
      s -= 2 * sign[j]! * c[j]!; sign[j] = -sign[j]! as -1 | 1;
      if (visit(s) === false) break;
    }
    return { exhaustive: true };
  }
  const rng = new Rng(seed);
  for (let b = 0; b < B; b++) {
    let s = 0, word = 0;
    for (let i = 0; i < n; i++) { if ((i & 31) === 0) word = rng.word(); s += (word >>> (i & 31)) & 1 ? c[i]! : -c[i]!; }
    if (visit(s) === false) break;
  }
  return { exhaustive: false };
}

function sExtreme(s: number, sObs: number, direction: Direction): boolean {
  // Studentized t is monotone in S; a 1e-9 relative band covers non-integer contrasts.
  return atLeastAsExtreme(s, sObs, direction);
}

export function signFlipP(c: ArrayLike<number>, direction: Direction, seed: string, B: number): { p: number; draws: number; exhaustive: boolean } {
  let sObs = 0, mag = 0; for (let i = 0; i < c.length; i++) { sObs += c[i]!; mag += Math.abs(c[i]!); }
  if (Math.abs(sObs) <= 1e-12 * mag) sObs = 0;
  let extreme = 0, draws = 0;
  const { exhaustive } = signFlipVisit(c, seed, B, s => { draws++; if (sExtreme(s, sObs, direction)) extreme++; });
  return { p: exhaustive ? extreme / draws : (1 + extreme) / (1 + B), draws, exhaustive };
}

/** Decision-only path for the simulator (same draws as signFlipP). */
export function pairedDecide(c: ArrayLike<number>, seedIn: string | (() => string), B: number, tests: readonly TestSpec[]): { reject: boolean[]; tReject: boolean[]; refused: boolean } {
  const seedOf = (): string => (typeof seedIn === 'string' ? seedIn : seedIn());
  const o = oneSampleT(c);
  if (c.length < 3 || (o.se === 0 && o.s !== 0)) return { reject: tests.map(() => false), tReject: tests.map(() => false), refused: true };
  const pT = tests.map(s => (o.se === 0 ? 1 : tPValue(o.t, o.df, s.direction)));
  const tReject = tests.map((s, i) => pT[i]! <= s.alpha);
  if (!tReject.some(Boolean)) return { reject: tReject, tReject, refused: false };
  const counts = tests.map(() => 0), thr = tests.map(s => mcThreshold(s.alpha, B)), enumerate = c.length <= FLIP_ENUM_MAX_N;
  let draws = 0;
  signFlipVisit(c, seedOf(), B, s => {
    draws++; let open = enumerate;
    tests.forEach((t, i) => { if (!tReject[i]) return; if (sExtreme(s, o.s, t.direction)) counts[i]!++; if (counts[i]! <= thr[i]!) open = true; });
    return open;
  });
  const base = tests.map((t, i) => tReject[i]! && (enumerate ? counts[i]! / draws <= t.alpha : counts[i]! <= thr[i]!));
  // Directional tests add the bootstrap-t branch (registered procedure @2).
  if (!base.some((x, i) => x && tests[i]!.direction !== 'two-sided')) return { reject: base, tReject, refused: false };
  const bd = oneSampleBootDraws(c, seedOf(), B);
  return { reject: tests.map((t, i) => base[i]! && (t.direction === 'two-sided' || bootP(bd, o.t, t.direction) <= t.alpha)), tReject, refused: false };
}

/** Canonical contrasts from integer contrasts (null imposed): gcd-reduced and sorted. */
export function canonicalContrastInts(c: readonly number[]): number[] { return reduceByGcd(c).values.sort((x, y) => x - y); }
export function pairedSeed(c: readonly number[], B: number): string { return contentSeed('paired.signflip-t@1', c, B); }

export interface PairedUnit { control: readonly (number | string)[]; treated: readonly (number | string)[] }
export interface PairedInput {
  /** One entry per independent unit; each unit has at least one control and one treated value. */
  units: readonly PairedUnit[];
  decimals: number;
  /** H0: mean within-unit change (treated minus control) = nullValue. */
  nullValue?: number | string;
  direction?: Direction; alpha?: number; B?: number; seed?: string;
  /** Compute the interval by inverting the decision rule (default true). */
  interval?: boolean;
  /** Refusal-only data-validity diagnostics on the unit contrasts (default on). */
  diagnostics?: DiagnosticsConfig | false;
}

function gcd(a: number, b: number): number { while (b) [a, b] = [b, a % b]; return a; }

/** Integer unit contrasts L * (mean treated - mean control - null), sorted (row and unit order free). */
export function canonicalContrasts(input: PairedInput): { c: number[]; L: number; decimals: number; nullInt: number } {
  const dec = Math.max(input.decimals, decimalsOf(input.nullValue ?? 0));
  let L = 1;
  for (const u of input.units) {
    if (!u.control.length || !u.treated.length) throw new Error('every unit needs a control and a treated value');
    const m = u.control.length * u.treated.length; L = L / gcd(L, m) * m;
    if (L > 1e6) throw new Error('unit row counts too irregular for exact contrasts');
  }
  const d0 = Number(scaleValue(input.nullValue ?? 0, dec));
  // Exact per-unit contrasts in BigInt (audit 6: raw sums can exceed 2^53).
  const c = input.units.map(u => {
    const t = scaleColumn(u.treated, dec), k = scaleColumn(u.control, dec);
    let st = 0n, sk = 0n; for (const v of t) st += BigInt(v); for (const v of k) sk += BigInt(v);
    const v = BigInt(L / t.length) * st - BigInt(L / k.length) * sk - BigInt(L) * BigInt(d0);
    if (v > BigInt(Number.MAX_SAFE_INTEGER) || v < -BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('contrast exceeds the safe integer range');
    return Number(v);
  });
  const r = reduceByGcd(c);
  return { c: r.values.sort((x, y) => x - y), L: L / r.g, decimals: dec, nullInt: d0 };
}

/**
 * Paired / repeated two-condition design: sign-flip of equal-weight unit contrasts, decision
 * p = max(p_signflip, p_paired-t). Estimand: mean within-unit change (not a treatment effect
 * unless the within-unit order was randomized).
 */
export function pairedSignFlip(input: PairedInput): ProcedureResult {
  const id = 'paired.signflip-t@2', direction = input.direction ?? 'two-sided', alpha = input.alpha ?? 0.05, B = input.B ?? 9999;
  const k = canonicalContrasts(input), n = k.c.length, scale = 10 ** -k.decimals, nullValue = k.nullInt * scale;
  const envelope = { nUnits: n };
  if (n < 3) return refused(id, 'fewer than three units', direction, alpha, nullValue, envelope);
  const o = oneSampleT(k.c);
  const toOrig = (v: number) => (v / k.L + k.nullInt) * scale;
  if (input.diagnostics !== false) {
    const dg = diagnose([k.c], [k.c], input.diagnostics ?? DEFAULT_DIAGNOSTICS);
    if (dg.refused) return refused(id, `data-validity diagnostic: ${dg.reason}`, direction, alpha, nullValue, envelope, toOrig(o.mean));
  }
  if (o.se === 0 && o.s !== 0) return refused(id, 'all unit contrasts identical (near-zero SE)', direction, alpha, nullValue, envelope, toOrig(o.mean));
  const seed = input.seed ?? pairedSeed(canonicalContrasts({ ...input, nullValue: 0, decimals: k.decimals }).c, B);
  const pT = o.se === 0 ? 1 : tPValue(o.t, o.df, direction);
  const flip = signFlipP(k.c, direction, seed, B);
  const boot = direction === 'two-sided' ? null : oneSampleBootDraws(k.c, seed, B);
  const pB = boot ? bootP(boot, o.t, direction) : 0;
  const accept = (delta: number) => {
    const cc = k.c.map(v => v - delta), oo = oneSampleT(cc);
    const pt = oo.se === 0 ? (oo.s === 0 ? 1 : 0) : tPValue(oo.t, oo.df, direction);
    return pt > alpha || (boot !== null && bootP(boot, oo.t, direction) > alpha) || signFlipP(cc, direction, seed, B).p > alpha;
  };
  const step = o.se > 0 ? o.se : 1;
  const lo = input.interval === false ? NaN : direction === 'less' ? -Infinity : invertBoundary(accept, o.mean, step, -1);
  const hi = input.interval === false ? NaN : direction === 'greater' ? Infinity : invertBoundary(accept, o.mean, step, 1);
  const q = tQuantileUpper(direction === 'two-sided' ? alpha / 2 : alpha, o.df);
  return { procedure: id, status: 'ok', estimate: toOrig(o.mean), nullValue, direction, alpha, p: Math.max(pT, flip.p, pB),
    ci: [toOrig(lo), toOrig(hi)],
    components: { t: o.t, df: o.df, se: o.se / k.L * scale, pT, pFlip: flip.p, pBoot: boot ? pB : NaN, flipDraws: flip.draws, flipExhaustive: flip.exhaustive ? 1 : 0,
      tLower: toOrig(o.mean - q * o.se), tUpper: toOrig(o.mean + q * o.se) }, envelope };
}

export interface CrossoverInput {
  /** Sequence AB: [period 1 (A), period 2 (B)] per subject. */
  ab: readonly (readonly [number | string, number | string])[];
  /** Sequence BA: [period 1 (B), period 2 (A)] per subject. */
  ba: readonly (readonly [number | string, number | string])[];
  decimals: number;
  /** H0: treatment effect A - B = nullValue. */
  nullValue?: number | string;
  direction?: Direction; alpha?: number; B?: number; seed?: string;
  /** Compute the interval by inverting the decision rule (default true). */
  interval?: boolean;
  diagnostics?: DiagnosticsConfig | false;
}

/**
 * Two-period two-sequence crossover (Hills-Armitage): period differences D = P1 - P2 compared
 * between sequences; E[D_AB] - E[D_BA] = 2 (A - B), period effects cancel, no carryover assumed.
 * The comparison uses the registered two-group procedure (Welch-studentized permutation of
 * sequence labels, max with Welch-Satterthwaite).
 */
export function crossoverHillsArmitage(input: CrossoverInput): ProcedureResult {
  const id = 'crossover.hills-armitage@2', dec = Math.max(input.decimals, decimalsOf(input.nullValue ?? 0));
  const diff = (r: readonly [number | string, number | string]) => { const [p1, p2] = scaleColumn([r[0], r[1]], dec); return p1! - p2!; };
  const dAB = input.ab.map(diff), dBA = input.ba.map(diff);
  const nullInt = Number(scaleValue(input.nullValue ?? 0, dec));
  const r = twoGroupWelchPermutation({ a: dBA, b: dAB, decimals: 0, nullValue: 2 * nullInt, direction: input.direction ?? 'two-sided',
    alpha: input.alpha ?? 0.05, B: input.B ?? 9999, ...(input.seed !== undefined ? { seed: input.seed } : {}), ...(input.interval !== undefined ? { interval: input.interval } : {}), ...(input.diagnostics !== undefined ? { diagnostics: input.diagnostics } : {}) });
  const scale = 10 ** -dec, half = (v: number) => v / 2 * scale;
  return { ...r, procedure: id, estimate: half(r.estimate), nullValue: nullInt * scale, ci: [half(r.ci[0]), half(r.ci[1])],
    components: { ...r.components, se: (r.components.se as number) / 2 * scale }, envelope: { nAB: dAB.length, nBA: dBA.length, nMin: Math.min(dAB.length, dBA.length) } };
}
