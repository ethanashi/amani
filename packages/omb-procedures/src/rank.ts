import { Rng } from './rng.ts';
import { choose, tPValue, tQuantileUpper, type Direction } from './special.ts';
import { contentSeed, reduceByGcd, scaleColumn, shiftToZero, sortedAsc } from './scale.ts';
import { atLeastAsExtreme, mcThreshold, refused, type ProcedureResult, type TestSpec } from './types.ts';
import { ENUM_LIMIT } from './twogroup.ts';

/**
 * Brunner-Munzel for the relative effect p = P(A < B) + P(A = B)/2, studentized permutation
 * (Neubert & Brunner 2007), decision p = max(p_perm, p_t with BM df). Ranks are computed on the
 * integer-scaled values, so the procedure is invariant to rescaling, shifting and row order.
 */

/** Midranks of sorted values (ties share the average rank). */
function midranksSorted(v: ArrayLike<number>): Float64Array {
  const n = v.length, r = new Float64Array(n);
  for (let i = 0; i < n;) { let j = i; while (j + 1 < n && v[j + 1] === v[i]) j++; const m = (i + j) / 2 + 1; for (let k = i; k <= j; k++) r[k] = m; i = j + 1; }
  return r;
}

export interface BmStat { phat: number; t: number; df: number; se: number }

/**
 * Brunner-Munzel statistic given pooled sorted values (with pooled midranks) and a membership mask
 * (1 = group b). Internal midranks are recomputed in one pass over the sorted order.
 */
export function bmStatistic(sorted: Float64Array, pooledRank: Float64Array, inB: Uint8Array, nb: number, p0 = 0.5): BmStat {
  const N = sorted.length, na = N - nb;
  // internal midranks: walk tie blocks, counting members of each group.
  let ca = 0, cb = 0, sumRa = 0, sumRb = 0;
  const intRank = new Float64Array(N);
  for (let i = 0; i < N;) {
    let j = i; while (j + 1 < N && sorted[j + 1] === sorted[i]) j++;
    let ta = 0, tb = 0; for (let k = i; k <= j; k++) { if (inB[k]) tb++; else ta++; }
    const ra = ca + (ta + 1) / 2, rb = cb + (tb + 1) / 2;
    for (let k = i; k <= j; k++) { intRank[k] = inB[k] ? rb : ra; if (inB[k]) sumRb += pooledRank[k]!; else sumRa += pooledRank[k]!; }
    ca += ta; cb += tb; i = j + 1;
  }
  const ma = sumRa / na, mb = sumRb / nb;
  let va = 0, vb = 0;
  for (let k = 0; k < N; k++) {
    if (inB[k]) { const d = pooledRank[k]! - intRank[k]! - mb + (nb + 1) / 2; vb += d * d; }
    else { const d = pooledRank[k]! - intRank[k]! - ma + (na + 1) / 2; va += d * d; }
  }
  va /= na - 1; vb /= nb - 1;
  const phat = (mb - (nb + 1) / 2) / na;
  // se of phat: sqrt(va/(na nb^2) + vb/(nb na^2)) (lawstat brunner.munzel.test)
  const se2 = va / (na * nb * nb) + vb / (nb * na * na), se = Math.sqrt(se2);
  const A = na * va, Bv = nb * vb;
  const df = (A + Bv) ** 2 / (A * A / (na - 1) + Bv * Bv / (nb - 1));
  let num = phat - p0; if (Math.abs(num) <= 1e-12) num = 0;
  return { phat, t: se > 0 ? num / se : num === 0 ? 0 : Math.sign(num) * Infinity, df: se > 0 ? df : NaN, se };
}

/** Procedure id (also the default-seed label). */
export const BM_ID = 'rank.brunner-munzel-perm@2';

export class BmDesign {
  readonly sorted: Float64Array; readonly rank: Float64Array; readonly inB: Uint8Array; readonly na: number; readonly nb: number;
  readonly total: number; readonly exhaustive: boolean;
  constructor(a: ArrayLike<number>, b: ArrayLike<number>) {
    const rows = [...Array.from(a, v => [v, 0] as const), ...Array.from(b, v => [v, 1] as const)].sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    this.sorted = Float64Array.from(rows, r => r[0]); this.inB = Uint8Array.from(rows, r => r[1]);
    this.rank = midranksSorted(this.sorted); this.na = a.length; this.nb = b.length;
    this.total = choose(this.na + this.nb, Math.min(this.na, this.nb)); this.exhaustive = this.total <= ENUM_LIMIT;
  }
  stat(p0 = 0.5): BmStat { return bmStatistic(this.sorted, this.rank, this.inB, this.nb, p0); }
  /** Visit permuted statistics (always studentized about 1/2, the permutation null). */
  visit(seed: string, B: number, visit: (t: number) => boolean | void): void {
    const N = this.sorted.length, nb = this.nb, mask = new Uint8Array(N);
    if (this.exhaustive) {
      const idx = Array.from({ length: nb }, (_, i) => i);
      for (;;) {
        mask.fill(0); for (const i of idx) mask[i] = 1;
        if (visit(bmStatistic(this.sorted, this.rank, mask, nb).t) === false) return;
        let i = nb - 1; while (i >= 0 && idx[i] === N - nb + i) i--;
        if (i < 0) return;
        idx[i]!++; for (let m = i + 1; m < nb; m++) idx[m] = idx[m - 1]! + 1;
      }
    }
    const rng = new Rng(seed), w = Int32Array.from({ length: N }, (_, i) => i);
    for (let b = 0; b < B; b++) {
      mask.fill(0);
      for (let i = 0; i < nb; i++) { const j = i + rng.int(N - i), t = w[i]!; w[i] = w[j]!; w[j] = t; mask[w[i]!] = 1; }
      if (visit(bmStatistic(this.sorted, this.rank, mask, nb).t) === false) return;
    }
  }
  permP(tObs: number, direction: Direction, seed: string, B: number): number {
    let extreme = 0, draws = 0;
    this.visit(seed, B, t => { draws++; if (atLeastAsExtreme(t, tObs, direction)) extreme++; });
    return this.exhaustive ? extreme / draws : (1 + extreme) / (1 + B);
  }
}

function bmTP(s: BmStat, direction: Direction): number {
  if (s.se > 0) return tPValue(s.t, s.df, direction);
  if (s.t === 0) return 1;
  // Complete separation: the t branch is degenerate; it cannot be the binding branch, the
  // permutation branch decides alone (still exact under exchangeability).
  return (direction === 'greater' && s.t > 0) || (direction === 'less' && s.t < 0) || direction === 'two-sided' ? 0 : 1;
}

export function bmDecide(d: BmDesign, seedIn: string | (() => string), B: number, tests: readonly TestSpec[]): { reject: boolean[]; tReject: boolean[]; refused: boolean } {
  const seedOf = (): string => (typeof seedIn === 'string' ? seedIn : seedIn());
  const o = d.stat();
  if (o.phat <= 0 || o.phat >= 1 || !(o.se > 0) || !Number.isFinite(o.df)) return { reject: tests.map(() => false), tReject: tests.map(() => false), refused: true };
  const pT = tests.map(s => bmTP(o, s.direction)), tReject = tests.map((s, i) => pT[i]! <= s.alpha);
  if (!tReject.some(Boolean)) return { reject: tReject, tReject, refused: false };
  const counts = tests.map(() => 0), thr = tests.map(s => mcThreshold(s.alpha, B)), enumerate = d.exhaustive;
  let draws = 0;
  d.visit(seedOf(), B, t => {
    draws++; let open = enumerate;
    tests.forEach((s, i) => { if (!tReject[i]) return; if (atLeastAsExtreme(t, o.t, s.direction)) counts[i]!++; if (counts[i]! <= thr[i]!) open = true; });
    return open;
  });
  return { reject: tests.map((s, i) => tReject[i]! && (enumerate ? counts[i]! / draws <= s.alpha : counts[i]! <= thr[i]!)), tReject, refused: false };
}

export interface BrunnerMunzelInput { a: readonly (number | string)[]; b: readonly (number | string)[]; decimals: number; nullValue?: number; direction?: Direction; alpha?: number; B?: number; seed?: string;
  /** Compute the interval by inverting the decision rule (default true). */
  interval?: boolean }

export function brunnerMunzelPermutation(input: BrunnerMunzelInput): ProcedureResult {
  const id = BM_ID, direction = input.direction ?? 'two-sided', alpha = input.alpha ?? 0.05, B = input.B ?? 9999, p0 = input.nullValue ?? 0.5;
  const ai = scaleColumn(input.a, input.decimals), pooled = reduceByGcd(shiftToZero([...ai, ...scaleColumn(input.b, input.decimals)])).values;
  const a = sortedAsc(pooled.slice(0, ai.length)), b = sortedAsc(pooled.slice(ai.length));
  const envelope = { nA: a.length, nB: b.length, nMin: Math.min(a.length, b.length), imbalance: Math.max(a.length, b.length) / Math.min(a.length, b.length) };
  if (a.length < 2 || b.length < 2) return refused(id, 'fewer than two units in an arm', direction, alpha, p0, envelope);
  // The studentized permutation reference is exchangeability under p = 1/2; other nulls are unsupported (audit 3).
  if (p0 !== 0.5) return refused(id, 'only the null relative effect 1/2 is supported (permutation null)', direction, alpha, p0, envelope);
  const d = new BmDesign(a, b), o = d.stat(p0);
  // Complete separation (p-hat 0 or 1) or a zero variance estimate: the studentized statistic and its interval are
  // degenerate (audit 3). Refuse; Fisher-type exact tests on the ranks would be a separate registered procedure.
  if (o.phat <= 0 || o.phat >= 1 || !(o.se > 0) || !Number.isFinite(o.df)) return refused(id, 'complete separation or zero rank variance (degenerate studentization)', direction, alpha, p0, envelope);
  const seed = input.seed ?? contentSeed(id, a, b, B);
  const pT = bmTP(o, direction);
  // Studentized permutation reference: the permutation law of T(1/2) approximates that of T(p0).
  const pPerm = d.permP(o.t, direction, seed, B);
  const perm: number[] = []; d.visit(seed, B, t => { perm.push(t); });
  const qPerm = (lvl: number) => { const s = perm.map(Math.abs).sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.ceil(lvl * s.length) - 1)]!; };
  const qT = o.se > 0 ? tQuantileUpper(direction === 'two-sided' ? alpha / 2 : alpha, o.df) : 0;
  const permQ = direction === 'two-sided' ? qPerm(1 - alpha) : (() => { const s = perm.map(t => (direction === 'greater' ? t : -t)).sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.ceil((1 - alpha) * s.length) - 1)]!; })();
  const half = Math.max(qT, permQ) * o.se;
  const lo = direction === 'less' ? 0 : Math.max(0, o.phat - half), hi = direction === 'greater' ? 1 : Math.min(1, o.phat + half);
  return { procedure: id, status: 'ok', estimate: o.phat, nullValue: p0, direction, alpha, p: Math.max(pT, pPerm), ci: [lo, hi],
    components: { t: o.t, df: o.df, se: o.se, pT, pPerm }, envelope };
}
