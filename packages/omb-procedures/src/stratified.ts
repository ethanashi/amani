import { Rng } from './rng.ts';
import { choose, tPValue, tQuantileUpper, type Direction } from './special.ts';
import { contentSeed, decimalsOf, gcdAll, scaleColumn, scaleValue, sortedAsc } from './scale.ts';
import { atLeastAsExtreme, mcThreshold, refused, type ProcedureResult, type TestSpec } from './types.ts';
import { ENUM_LIMIT, invertBoundary } from './twogroup.ts';
import { DEFAULT_DIAGNOSTICS, diagnose, type DiagnosticsConfig } from './diagnostics.ts';

/** One stratum after scaling: values of arm a then arm b (each sorted), null imposed on b. */
export interface StratumData { v: Float64Array; na: number }

/** Mixed-radix enumeration / sampling of within-stratum relabelings. Each stratum relabels its
 * smaller arm's positions; the visitor receives per-stratum selected sums (s, q) of the subset. */
class WithinStrata {
  readonly strata: StratumData[]; readonly k: number[]; readonly smallIsA: boolean[]; readonly total: number; readonly exhaustive: boolean;
  constructor(strata: StratumData[]) {
    this.strata = strata;
    this.smallIsA = strata.map(s => s.na <= s.v.length - s.na);
    this.k = strata.map(s => Math.min(s.na, s.v.length - s.na));
    let total = 1; for (let j = 0; j < strata.length; j++) { total *= choose(strata[j]!.v.length, this.k[j]!); if (total > 1e15) { total = Infinity; break; } }
    this.total = total; this.exhaustive = total <= ENUM_LIMIT;
  }
  /** Visit all relabelings (exhaustive): sel[j] = [s, q] of stratum j's selected subset. */
  enumerate(visit: (sel: Float64Array) => boolean | void): void {
    const S = this.strata.length, lists: Float64Array[] = [];
    for (let j = 0; j < S; j++) {
      const st = this.strata[j]!, n = st.v.length, k = this.k[j]!, out: number[] = [], idx = Array.from({ length: k }, (_, i) => i);
      for (;;) {
        let s = 0, q = 0; for (const i of idx) { const x = st.v[i]!; s += x; q += x * x; } out.push(s, q);
        let i = k - 1; while (i >= 0 && idx[i] === n - k + i) i--;
        if (i < 0) break;
        idx[i]!++; for (let m = i + 1; m < k; m++) idx[m] = idx[m - 1]! + 1;
      }
      lists.push(Float64Array.from(out));
    }
    const pos = new Int32Array(S), sel = new Float64Array(2 * S);
    for (;;) {
      for (let j = 0; j < S; j++) { sel[2 * j] = lists[j]![2 * pos[j]!]!; sel[2 * j + 1] = lists[j]![2 * pos[j]! + 1]!; }
      if (visit(sel) === false) return;
      let j = 0; while (j < S) { pos[j]!++; if (2 * pos[j]! < lists[j]!.length) break; pos[j] = 0; j++; }
      if (j === S) return;
    }
  }
  sample(seed: string, B: number, visit: (sel: Float64Array) => boolean | void): void {
    const S = this.strata.length, rng = new Rng(seed), work = this.strata.map(s => Int32Array.from({ length: s.v.length }, (_, i) => i)), sel = new Float64Array(2 * S);
    for (let b = 0; b < B; b++) {
      for (let j = 0; j < S; j++) {
        const st = this.strata[j]!, w = work[j]!, n = st.v.length, k = this.k[j]!;
        let s = 0, q = 0;
        for (let i = 0; i < k; i++) { const m = i + rng.int(n - i), t = w[i]!; w[i] = w[m]!; w[m] = t; const x = st.v[w[i]!]!; s += x; q += x * x; }
        sel[2 * j] = s; sel[2 * j + 1] = q;
      }
      if (visit(sel) === false) return;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// (a) Few large strata: weighted Welch combination with locked weights.
// ---------------------------------------------------------------------------------------------

export interface WeightedWelch { est: number; se: number; t: number; df: number }

/** Weighted combination of per-stratum Welch differences from per-arm sums. */
export function weightedWelchFromSums(w: ArrayLike<number>, na: ArrayLike<number>, nb: ArrayLike<number>, sums: ArrayLike<number>): WeightedWelch {
  // sums layout per stratum j: [sa, qa, sb, qb]
  let est = 0, mag = 0, se2 = 0, dfDen = 0;
  for (let j = 0; j < w.length; j++) {
    const a = na[j]!, b = nb[j]!, sa = sums[4 * j]!, qa = sums[4 * j + 1]!, sb = sums[4 * j + 2]!, qb = sums[4 * j + 3]!;
    const d = sb / b - sa / a;
    est += w[j]! * d; mag += w[j]! * (Math.abs(sb / b) + Math.abs(sa / a));
    let ssa = a * qa - sa * sa; if (ssa <= 1e-12 * a * qa) ssa = 0;
    let ssb = b * qb - sb * sb; if (ssb <= 1e-12 * b * qb) ssb = 0;
    const ua = w[j]! * w[j]! * ssa / a / (a - 1) / a, ub = w[j]! * w[j]! * ssb / b / (b - 1) / b;
    se2 += ua + ub; dfDen += ua * ua / (a - 1) + ub * ub / (b - 1);
  }
  if (Math.abs(est) <= 1e-12 * mag) est = 0;
  const se = Math.sqrt(se2);
  return { est, se, t: se > 0 ? est / se : est === 0 ? 0 : Math.sign(est) * Infinity, df: se > 0 ? se2 * se2 / dfDen : NaN };
}

export class WeightedWelchDesign {
  readonly strata: StratumData[]; readonly w: Float64Array; readonly na: Float64Array; readonly nb: Float64Array; readonly perms: WithinStrata;
  constructor(strata: StratumData[], weights: ArrayLike<number>) {
    this.strata = strata;
    let tot = 0; for (let j = 0; j < weights.length; j++) tot += weights[j]!;
    this.w = Float64Array.from(weights as ArrayLike<number>, v => v / tot);
    this.na = Float64Array.from(strata, s => s.na); this.nb = Float64Array.from(strata, s => s.v.length - s.na);
    this.perms = new WithinStrata(strata);
  }
  stat(shift = 0): WeightedWelch {
    const sums = new Float64Array(4 * this.strata.length);
    this.strata.forEach((s, j) => {
      let sa = 0, qa = 0, sb = 0, qb = 0;
      for (let i = 0; i < s.v.length; i++) { const x = i < s.na ? s.v[i]! : s.v[i]! - shift; if (i < s.na) { sa += x; qa += x * x; } else { sb += x; qb += x * x; } }
      sums[4 * j] = sa; sums[4 * j + 1] = qa; sums[4 * j + 2] = sb; sums[4 * j + 3] = qb;
    });
    return weightedWelchFromSums(this.w, this.na, this.nb, sums);
  }
  /** Visit permutation statistics for strata data (optionally with b shifted by `shift`). */
  visit(seed: string, B: number, visit: (t: number) => boolean | void, shift = 0): { exhaustive: boolean } {
    const strata = shift === 0 ? this.strata : this.strata.map(s => ({ na: s.na, v: Float64Array.from(s.v, (x, i) => (i >= s.na ? x - shift : x)) }));
    const tot = strata.map(s => { let a = 0, b = 0; for (const x of s.v) { a += x; b += x * x; } return [a, b] as const; });
    const perms = shift === 0 ? this.perms : new WithinStrata(strata);
    const sums = new Float64Array(4 * strata.length);
    const f = (sel: Float64Array) => {
      for (let j = 0; j < strata.length; j++) {
        const s = sel[2 * j]!, q = sel[2 * j + 1]!, rs = tot[j]![0] - s, rq = tot[j]![1] - q;
        if (perms.smallIsA[j]) { sums[4 * j] = s; sums[4 * j + 1] = q; sums[4 * j + 2] = rs; sums[4 * j + 3] = rq; }
        else { sums[4 * j] = rs; sums[4 * j + 1] = rq; sums[4 * j + 2] = s; sums[4 * j + 3] = q; }
      }
      return visit(weightedWelchFromSums(this.w, this.na, this.nb, sums).t);
    };
    if (perms.exhaustive) { perms.enumerate(f); return { exhaustive: true }; }
    perms.sample(seed, B, f); return { exhaustive: false };
  }
  permP(tObs: number, direction: Direction, seed: string, B: number, shift = 0): number {
    let extreme = 0, draws = 0;
    const { exhaustive } = this.visit(seed, B, t => { draws++; if (atLeastAsExtreme(t, tObs, direction)) extreme++; }, shift);
    return exhaustive ? extreme / draws : (1 + extreme) / (1 + B);
  }
}

export function weightedWelchDecide(d: WeightedWelchDesign, seedIn: string | (() => string), B: number, tests: readonly TestSpec[]): { reject: boolean[]; tReject: boolean[]; refused: boolean } {
  const seedOf = (): string => (typeof seedIn === 'string' ? seedIn : seedIn());
  const o = d.stat();
  if (o.se === 0 && o.est !== 0) return { reject: tests.map(() => false), tReject: tests.map(() => false), refused: true };
  const pT = tests.map(s => (o.se === 0 ? 1 : tPValue(o.t, o.df, s.direction)));
  const tReject = tests.map((s, i) => pT[i]! <= s.alpha);
  if (!tReject.some(Boolean)) return { reject: tReject, tReject, refused: false };
  const counts = tests.map(() => 0), thr = tests.map(s => mcThreshold(s.alpha, B)), enumerate = d.perms.exhaustive;
  let draws = 0;
  d.visit(seedOf(), B, t => {
    draws++; let open = enumerate;
    tests.forEach((s, i) => { if (!tReject[i]) return; if (atLeastAsExtreme(t, o.t, s.direction)) counts[i]!++; if (counts[i]! <= thr[i]!) open = true; });
    return open;
  });
  return { reject: tests.map((s, i) => tReject[i]! && (enumerate ? counts[i]! / draws <= s.alpha : counts[i]! <= thr[i]!)), tReject, refused: false };
}

export interface StratumInput { a: readonly (number | string)[]; b: readonly (number | string)[] }
export interface StratifiedInput {
  strata: readonly StratumInput[];
  decimals: number;
  /** Locked weights (default: proportional to stratum size, fixed by design). */
  weights?: readonly number[];
  /** H0: weighted mean difference (b - a) = nullValue. */
  nullValue?: number | string;
  /** Refusal-only data-validity diagnostics (default on). */
  diagnostics?: DiagnosticsConfig | false;
  direction?: Direction; alpha?: number; B?: number; seed?: string;
  /** Compute the interval by inverting the decision rule (default true). */
  interval?: boolean;
}

function canonicalStrata(strata: readonly StratumInput[], decimals: number, nullValue: number | string, weights?: readonly number[]): { data: StratumData[]; dec: number; nullInt: number; g: number; weights: number[]; seedData: StratumData[] } {
  const dec = Math.max(decimals, decimalsOf(nullValue)), d0 = Number(scaleValue(nullValue, dec));
  return { ...canonicalStrataInts(strata.map(s => ({ a: scaleColumn(s.a, dec), b: scaleColumn(s.b, dec) })), d0, weights), dec, nullInt: d0 };
}

function shiftReduce(strata: readonly { a: readonly number[]; b: readonly number[] }[]): { data: StratumData[]; g: number } {
  let min = Infinity; for (const s of strata) for (const x of [...s.a, ...s.b]) min = Math.min(min, x);
  const g = gcdAll(strata.flatMap(s => [...s.a, ...s.b].map(x => x - min))) || 1;
  return { g, data: strata.map(s => ({ na: s.a.length, v: Float64Array.from([...sortedAsc(s.a.map(x => (x - min) / g)), ...sortedAsc(s.b.map(x => (x - min) / g))]) })) };
}

/**
 * Canonical strata from integer-scaled arms.
 * - Stratum order is fixed by the NULL-FREE canonical content (shift, gcd, sorted arms), so it cannot change
 *   with the tested null value. Locked weights travel with their stratum (audit 1).
 * - `data` has the null imposed on b (shifted to zero, gcd-reduced), in that order.
 * - `seedData` is the null-free canonical content: the default seed derives from it, so every null value uses the
 *   same index-based resampling draws and the reported interval inverts the public decision (audit 2).
 */
export function canonicalStrataInts(strataInts: readonly { a: readonly number[]; b: readonly number[] }[], d0: number, weights?: readonly number[]): { data: StratumData[]; g: number; weights: number[]; seedData: StratumData[] } {
  if (weights && weights.length !== strataInts.length) throw new Error('one weight per stratum');
  const free = shiftReduce(strataInts).data;
  const order = strataInts.map((_, i) => i).sort((i, j) => { const x = free[i]!, y = free[j]!; return x.v.length - y.v.length || x.na - y.na || compareArrays(x.v, y.v) || i - j; });
  const ordered = order.map(i => strataInts[i]!);
  const nul = shiftReduce(ordered.map(s => ({ a: s.a, b: s.b.map(x => x - d0) })));
  const w = order.map(i => (weights ? weights[i]! : strataInts[i]!.a.length + strataInts[i]!.b.length));
  return { data: nul.data, g: nul.g, weights: w, seedData: order.map(i => free[i]!) };
}

/** Stratified two-group, few large strata: weighted Welch, decision p = max(p_within-stratum-perm, p_Satterthwaite-t). */
export function stratifiedWeightedWelch(input: StratifiedInput): ProcedureResult {
  const id = WW_ID, direction = input.direction ?? 'two-sided', alpha = input.alpha ?? 0.05, B = input.B ?? 9999;
  const c = canonicalStrata(input.strata, input.decimals, input.nullValue ?? 0, input.weights), scale = 10 ** -c.dec, nullValue = c.nullInt * scale;
  const minArm = Math.min(...c.data.map(s => Math.min(s.na, s.v.length - s.na)));
  const envelope = { strata: c.data.length, minArmPerStratum: minArm };
  if (minArm < 2) return refused(id, 'a stratum arm has fewer than two units', direction, alpha, nullValue, envelope);
  const d = new WeightedWelchDesign(c.data, c.weights), o = d.stat();
  if (input.diagnostics !== false) {
    const armA = c.data.flatMap(s => Array.from(s.v.slice(0, s.na))), armB = c.data.flatMap(s => Array.from(s.v.slice(s.na)));
    const dg = diagnose(c.data.flatMap(s => [s.v.slice(0, s.na), s.v.slice(s.na)]), [armA, armB], input.diagnostics ?? DEFAULT_DIAGNOSTICS);
    if (dg.refused) return refused(id, `data-validity diagnostic: ${dg.reason}`, direction, alpha, nullValue, envelope, (o.est * c.g + c.nullInt) * scale);
  }
  if (o.se === 0 && o.est !== 0) return refused(id, 'zero within-arm variance (near-zero SE)', direction, alpha, nullValue, envelope);
  const seed = input.seed ?? strataSeed(id, c.seedData, B, d.w);
  const pT = o.se === 0 ? 1 : tPValue(o.t, o.df, direction), pPerm = d.permP(o.t, direction, seed, B);
  const accept = (delta: number) => {
    const oo = d.stat(delta), pt = oo.se === 0 ? (oo.est === 0 ? 1 : 0) : tPValue(oo.t, oo.df, direction);
    return pt > alpha || d.permP(oo.t, direction, seed, B, delta) > alpha;
  };
  const step = o.se > 0 ? o.se : 1;
  const lo = input.interval === false ? NaN : direction === 'less' ? -Infinity : invertBoundary(accept, o.est, step, -1);
  const hi = input.interval === false ? NaN : direction === 'greater' ? Infinity : invertBoundary(accept, o.est, step, 1);
  const g = c.g;
  return { procedure: id, status: 'ok', estimate: (o.est * g + c.nullInt) * scale, nullValue, direction, alpha, p: Math.max(pT, pPerm),
    ci: [(lo * g + c.nullInt) * scale, (hi * g + c.nullInt) * scale], components: { t: o.t, df: o.df, se: o.se * g * scale, pT, pPerm }, envelope };
}

/** Procedure ids (also the default-seed labels). */
export const WW_ID = 'stratified.weighted-welch@2', CR2_ID = 'stratified.cr2-bm-relabel@2';

/** Content seed of the stratified procedures (exported for the simulator). */
export function strataSeed(id: string, data: readonly StratumData[], B: number, weights?: ArrayLike<number>): string {
  return weights ? contentSeed(id, data.map(s => [s.na, Array.from(s.v)]), Array.from(weights), B) : contentSeed(id, data.map(s => [s.na, Array.from(s.v)]), B);
}

function compareArrays(a: ArrayLike<number>, b: ArrayLike<number>): number { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! - b[i]!; return 0; }

// ---------------------------------------------------------------------------------------------
// (b) Many small strata: stratum fixed effects, CR2 clustered on stratum, BM df,
//     maxed with within-stratum relabeling. Same procedure as paired / repeated measures.
// ---------------------------------------------------------------------------------------------

/**
 * Binary exposure within strata. With stratum fixed effects the FWL residual exposure is x minus
 * its stratum mean; |xt_s|^2 = k_s (n_s - k_s) / n_s is invariant under within-stratum relabeling,
 * so c_s = |xt_s|^2 / SXX, the CR2 adjustment and the BM df depend on design only.
 * CR2 (pseudo-inverse square root on the 1_s complement): u_s = xt_s' e_s / sqrt(1 - c_s).
 * BM df = 1 / (sum c_s^2 + (sum c_s^2/(1-c_s))^2 - sum c_s^4/(1-c_s)^2).
 */
export class Cr2Design {
  readonly strata: StratumData[]; readonly c: Float64Array; readonly sxx: number; readonly bmDf: number; readonly perms: WithinStrata;
  readonly ok: boolean; readonly problem: string; readonly kOverN: Float64Array;
  constructor(strata: StratumData[]) {
    // Strata with no exposure variation carry no information about the coefficient.
    this.strata = strata.filter(s => s.na > 0 && s.na < s.v.length);
    const xx = this.strata.map(s => s.na * (s.v.length - s.na) / s.v.length); // na rows have x=0, nb rows x=1
    this.sxx = xx.reduce((a, b) => a + b, 0);
    this.c = Float64Array.from(xx, v => v / this.sxx);
    this.kOverN = Float64Array.from(this.strata, s => (s.v.length - s.na) / s.v.length);
    let problem = '';
    if (this.strata.length < 2) problem = 'fewer than two informative strata';
    let s2 = 0, s21 = 0, s42 = 0;
    for (const cs of this.c) { if (cs >= 1 - 1e-12) problem ||= 'one stratum carries all exposure variation (CR2 undefined)'; s2 += cs * cs; s21 += cs * cs / (1 - cs); s42 += cs ** 4 / (1 - cs) ** 2; }
    this.bmDf = 1 / (s2 + s21 * s21 - s42);
    this.perms = new WithinStrata(this.strata);
    this.ok = problem === ''; this.problem = problem;
  }
  /** t from per-stratum T_s = xt_s' y (y with null imposed). */
  statFromT(T: ArrayLike<number>): { beta: number; se: number; t: number } {
    let num = 0, mag = 0; for (let j = 0; j < T.length; j++) { num += T[j]!; mag += Math.abs(T[j]!); }
    if (Math.abs(num) <= 1e-12 * mag) num = 0;
    const beta = num / this.sxx;
    let v = 0;
    for (let j = 0; j < T.length; j++) { let u = T[j]! - beta * this.c[j]! * this.sxx; if (Math.abs(u) <= 1e-12 * (Math.abs(T[j]!) + Math.abs(beta * this.c[j]! * this.sxx))) u = 0; v += u * u / (1 - this.c[j]!); }
    const se = Math.sqrt(v) / this.sxx;
    return { beta, se, t: se > 0 ? beta / se : beta === 0 ? 0 : Math.sign(beta) * Infinity };
  }
  /** T_s for the observed labels (rows na.. are x = 1), with b shifted by `shift`. */
  observedT(shift = 0): Float64Array {
    return Float64Array.from(this.strata, s => {
      const n = s.v.length, k = n - s.na; let sb = 0, sAll = 0;
      for (let i = 0; i < n; i++) { const x = i >= s.na ? s.v[i]! - shift : s.v[i]!; sAll += x; if (i >= s.na) sb += x; }
      // xt'y = sum_b y - (k/n) sum y, computed as (n sb - k sAll)/n to keep integer cancellation exact.
      return (n * sb - k * sAll) / n;
    });
  }
  stat(shift = 0): { beta: number; se: number; t: number } { return this.statFromT(this.observedT(shift)); }
  /** Internally studentized fixed-effects residuals e_i / sqrt(1 - h_ii), h_ii = 1/n_s + xt_i^2 / SXX (null-independent). */
  standardizedResiduals(): Float64Array {
    const beta = this.stat().beta, out: number[] = [];
    for (const s of this.strata) {
      const n = s.v.length, k = n - s.na; let m = 0; for (const x of s.v) m += x; m /= n;
      for (let i = 0; i < n; i++) {
        const xt = (i >= s.na ? 1 : 0) - k / n, h = 1 / n + xt * xt / this.sxx, e = s.v[i]! - m - beta * xt;
        if (1 - h > 1e-12) out.push(e / Math.sqrt(1 - h));
      }
    }
    return Float64Array.from(out);
  }
  visit(seed: string, B: number, visit: (t: number) => boolean | void, shift = 0): { exhaustive: boolean } {
    const strata = shift === 0 ? this.strata : this.strata.map(s => ({ na: s.na, v: Float64Array.from(s.v, (x, i) => (i >= s.na ? x - shift : x)) }));
    const tot = strata.map(s => { let a = 0; for (const x of s.v) a += x; return a; });
    const perms = shift === 0 ? this.perms : new WithinStrata(strata);
    const T = new Float64Array(strata.length);
    const f = (sel: Float64Array) => {
      for (let j = 0; j < strata.length; j++) {
        const n = strata[j]!.v.length, k = n - strata[j]!.na, s = sel[2 * j]!;
        const sb = perms.smallIsA[j] ? tot[j]! - s : s; // selected subset is the smaller arm
        T[j] = (n * sb - k * tot[j]!) / n;
      }
      return visit(this.statFromT(T).t);
    };
    if (perms.exhaustive) { perms.enumerate(f); return { exhaustive: true }; }
    perms.sample(seed, B, f); return { exhaustive: false };
  }
  permP(tObs: number, direction: Direction, seed: string, B: number, shift = 0): number {
    let extreme = 0, draws = 0;
    const { exhaustive } = this.visit(seed, B, t => { draws++; if (atLeastAsExtreme(t, tObs, direction)) extreme++; }, shift);
    return exhaustive ? extreme / draws : (1 + extreme) / (1 + B);
  }
}

export function cr2Decide(d: Cr2Design, seedIn: string | (() => string), B: number, tests: readonly TestSpec[]): { reject: boolean[]; tReject: boolean[]; refused: boolean } {
  const seedOf = (): string => (typeof seedIn === 'string' ? seedIn : seedIn());
  const o = d.stat();
  if (!d.ok || (o.se === 0 && o.beta !== 0)) return { reject: tests.map(() => false), tReject: tests.map(() => false), refused: true };
  const pT = tests.map(s => (o.se === 0 ? 1 : tPValue(o.t, d.bmDf, s.direction)));
  const tReject = tests.map((s, i) => pT[i]! <= s.alpha);
  if (!tReject.some(Boolean)) return { reject: tReject, tReject, refused: false };
  const counts = tests.map(() => 0), thr = tests.map(s => mcThreshold(s.alpha, B)), enumerate = d.perms.exhaustive;
  let draws = 0;
  d.visit(seedOf(), B, t => {
    draws++; let open = enumerate;
    tests.forEach((s, i) => { if (!tReject[i]) return; if (atLeastAsExtreme(t, o.t, s.direction)) counts[i]!++; if (counts[i]! <= thr[i]!) open = true; });
    return open;
  });
  return { reject: tests.map((s, i) => tReject[i]! && (enumerate ? counts[i]! / draws <= s.alpha : counts[i]! <= thr[i]!)), tReject, refused: false };
}

/** Stratified / repeated binary exposure, many small strata: CR2 + BM df, max with within-stratum relabeling. */
export function stratifiedCr2(input: StratifiedInput): ProcedureResult {
  const id = CR2_ID, direction = input.direction ?? 'two-sided', alpha = input.alpha ?? 0.05, B = input.B ?? 9999;
  const c = canonicalStrata(input.strata, input.decimals, input.nullValue ?? 0), scale = 10 ** -c.dec, nullValue = c.nullInt * scale;
  const d = new Cr2Design(c.data);
  const envelope = { strata: d.strata.length, bmDf: d.bmDf };
  if (!d.ok) return refused(id, d.problem, direction, alpha, nullValue, envelope);
  const o = d.stat();
  if (input.diagnostics !== false) {
    const armA = d.strata.flatMap(s => Array.from(s.v.slice(0, s.na))), armB = d.strata.flatMap(s => Array.from(s.v.slice(s.na)));
    const dg = diagnose([d.standardizedResiduals()], [armA, armB], input.diagnostics ?? DEFAULT_DIAGNOSTICS);
    if (dg.refused) return refused(id, `data-validity diagnostic: ${dg.reason}`, direction, alpha, nullValue, envelope, (o.beta * c.g + c.nullInt) * scale);
  }
  if (o.se === 0 && o.beta !== 0) return refused(id, 'zero residual variance (near-zero SE)', direction, alpha, nullValue, envelope);
  const seed = input.seed ?? strataSeed(id, c.seedData, B);
  const pT = o.se === 0 ? 1 : tPValue(o.t, d.bmDf, direction), pPerm = d.permP(o.t, direction, seed, B);
  const accept = (delta: number) => {
    const oo = d.stat(delta), pt = oo.se === 0 ? (oo.beta === 0 ? 1 : 0) : tPValue(oo.t, d.bmDf, direction);
    return pt > alpha || d.permP(oo.t, direction, seed, B, delta) > alpha;
  };
  const step = o.se > 0 ? o.se : 1;
  const lo = input.interval === false ? NaN : direction === 'less' ? -Infinity : invertBoundary(accept, o.beta, step, -1);
  const hi = input.interval === false ? NaN : direction === 'greater' ? Infinity : invertBoundary(accept, o.beta, step, 1);
  const q = tQuantileUpper(direction === 'two-sided' ? alpha / 2 : alpha, d.bmDf);
  const g = c.g;
  return { procedure: id, status: 'ok', estimate: (o.beta * g + c.nullInt) * scale, nullValue, direction, alpha, p: Math.max(pT, pPerm),
    ci: [(lo * g + c.nullInt) * scale, (hi * g + c.nullInt) * scale],
    components: { t: o.t, bmDf: d.bmDf, se: o.se * g * scale, pT, pPerm, tLower: ((o.beta - q * o.se) * g + c.nullInt) * scale, tUpper: ((o.beta + q * o.se) * g + c.nullInt) * scale }, envelope };
}

export { canonicalStrata };
