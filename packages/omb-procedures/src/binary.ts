import { lchoose, type Direction } from './special.ts';
import type { ProcedureResult } from './types.ts';

/**
 * Exact binary risk difference, RD = p_b - p_a.
 * - At RD = 0 the decision includes Fisher's exact test, the randomization test of the sharp null
 *   with fixed margins (RD is monotone in the b-arm count given the margins). Two-sided uses
 *   |RD| >= |RD_obs|, compared in exact integers.
 * - For RD = delta (any value, used for the interval) the unconditional exact score test
 *   (Farrington-Manning score statistic, p maximised over the nuisance probability on a grid,
 *   Chan-Zhang style) applies. The decision p(delta) = max(Fisher at 0, unconditional(delta)).
 * Validated by exact enumeration (no Monte Carlo) in the simulator.
 */


function logBinomPmf(n: number, p: number): Float64Array {
  const out = new Float64Array(n + 1);
  for (let k = 0; k <= n; k++) {
    if (p === 0) out[k] = k === 0 ? 0 : -Infinity;
    else if (p === 1) out[k] = k === n ? 0 : -Infinity;
    else out[k] = lchoose(n, k) + k * Math.log(p) + (n - k) * Math.log1p(-p);
  }
  return out;
}

/** Restricted MLE of p_a under p_b - p_a = delta (Farrington-Manning / Miettinen-Nurminen cubic). */
export function restrictedMle(xa: number, na: number, xb: number, nb: number, delta: number): [number, number] {
  if (delta === 0) { const p = (xa + xb) / (na + nb); return [p, p]; }
  // Parameterise by p_a = p, p_b = p + delta; maximise the log-likelihood on the feasible interval.
  const lo = Math.max(0, -delta), hi = Math.min(1, 1 - delta);
  const ll = (p: number) => {
    const pb = p + delta; let v = 0;
    if (xa > 0) v += xa * Math.log(Math.max(p, 1e-300)); if (na - xa > 0) v += (na - xa) * Math.log(Math.max(1 - p, 1e-300));
    if (xb > 0) v += xb * Math.log(Math.max(pb, 1e-300)); if (nb - xb > 0) v += (nb - xb) * Math.log(Math.max(1 - pb, 1e-300));
    return v;
  };
  // The log-likelihood is concave in p on the feasible interval: golden-section search.
  let a = lo, b = hi; const g = (Math.sqrt(5) - 1) / 2;
  let c = b - g * (b - a), d = a + g * (b - a), fc = ll(c), fd = ll(d);
  for (let i = 0; i < 200 && b - a > 1e-15; i++) {
    if (fc >= fd) { b = d; d = c; fd = fc; c = b - g * (b - a); fc = ll(c); }
    else { a = c; c = d; fc = fd; d = a + g * (b - a); fd = ll(d); }
  }
  const p = (a + b) / 2; return [p, p + delta];
}

/** Farrington-Manning score statistic for H0: p_b - p_a = delta. */
export function scoreZ(xa: number, na: number, xb: number, nb: number, delta: number): number {
  const [pa, pb] = restrictedMle(xa, na, xb, nb, delta);
  const v = pa * (1 - pa) / na + pb * (1 - pb) / nb;
  const num = xb / nb - xa / na - delta;
  if (Math.abs(num) <= 1e-12) return 0;
  return v > 0 ? num / Math.sqrt(v) : Math.sign(num) * Infinity;
}

/** Binomial pmf by recurrence from the mode (three lgamma calls, then O(n) ratios). */
function binomPmf(n: number, p: number): Float64Array {
  const out = new Float64Array(n + 1);
  if (p <= 0) { out[0] = 1; return out; }
  if (p >= 1) { out[n] = 1; return out; }
  const m = Math.min(n, Math.floor((n + 1) * p)), r = p / (1 - p);
  out[m] = Math.exp(lchoose(n, m) + m * Math.log(p) + (n - m) * Math.log1p(-p));
  for (let k = m; k < n; k++) out[k + 1] = out[k]! * ((n - k) / (k + 1)) * r;
  for (let k = m; k > 0; k--) out[k - 1] = out[k]! * (k / (n - k + 1)) / r;
  return out;
}
/** Exact total variation distance between Binomial(n, p) and Binomial(n, q). */
function tvBinom(n: number, p: number, q: number): number {
  const a = binomPmf(n, p), b = binomPmf(n, q); let s = 0;
  for (let k = 0; k <= n; k++) s += Math.abs(a[k]! - b[k]!);
  return Math.min(1, s / 2);
}

/**
 * Nuisance grid with a certified slack. Points are spaced uniformly in arcsin(sqrt(pa)) (equal Fisher
 * information). For any event A, P_pa(A) on [pa_i, pa_i+1] is at most
 *   max(P_pa_i(A) + TV(pa_i, m_i), P_pa_i+1(A) + TV(pa_i+1, m_i)),
 * with m_i the midpoint. This holds because TV between binomials grows monotonically as q moves away from
 * p (monotone likelihood ratio), and TV of the product of arms is at most the sum over arms (pb = pa + delta
 * moves with pa). The grid is doubled until the worst interval slack is <= maxSlack (audit 5).
 */
const gridCache = new Map<string, { pa: Float64Array; slack: Float64Array }>();
export function certifiedNuisanceGrid(na: number, nb: number, delta: number, maxSlack = 1e-3): { pa: Float64Array; slack: Float64Array } {
  const key = `${na}:${nb}:${delta}:${maxSlack}`, hit = gridCache.get(key); if (hit) return hit;
  const res = buildGrid(na, nb, delta, maxSlack);
  if (gridCache.size > 64) gridCache.clear();
  gridCache.set(key, res); return res;
}
function intervalSlack(na: number, nb: number, delta: number, a: number, b: number): number {
  const m = (a + b) / 2, clamp = (x: number) => Math.min(1, Math.max(0, x));
  const left = tvBinom(na, a, m) + tvBinom(nb, clamp(a + delta), clamp(m + delta));
  const right = tvBinom(na, b, m) + tvBinom(nb, clamp(b + delta), clamp(m + delta));
  return Math.max(left, right);
}
function buildGrid(na: number, nb: number, delta: number, maxSlack: number): { pa: Float64Array; slack: Float64Array } {
  const lo = Math.max(0, -delta), hi = Math.min(1, 1 - delta);
  if (!(hi > lo)) return { pa: Float64Array.of(lo), slack: new Float64Array(0) };
  const t0 = Math.asin(Math.sqrt(lo)), t1 = Math.asin(Math.sqrt(hi));
  for (let M = 500; ; M *= 2) {
    const pa = Float64Array.from({ length: M + 1 }, (_, i) => { const t = t0 + (t1 - t0) * i / M; return i === 0 ? lo : i === M ? hi : Math.sin(t) ** 2; });
    const slack = new Float64Array(M); let worst = 0;
    for (let i = 0; i < M; i++) { slack[i] = intervalSlack(na, nb, delta, pa[i]!, pa[i + 1]!); worst = Math.max(worst, slack[i]!); }
    if (worst <= maxSlack || M >= 64000) return { pa, slack };
  }
}

/** Two statistic keys tie when equal (infinite keys) or within 1e-9 relative (finite keys). */
function tieWith(k: number, k0: number): boolean {
  if (!Number.isFinite(k0) || !Number.isFinite(k)) return k === k0;
  return k >= k0 - 1e-9 * Math.max(1, Math.abs(k0));
}

/**
 * p-values of the unconditional exact score test for every table (i, j): a certified upper bound on the
 * supremum over the nuisance probability (grid maxima plus the interval slack above). Endpoint nulls
 * (|delta| >= 1) are degenerate and handled explicitly (audit 4).
 */
export function unconditionalPTable(na: number, nb: number, delta: number, direction: Direction): Float64Array {
  const T = (na + 1) * (nb + 1);
  if (!(delta > -1 && delta < 1)) {
    // Degenerate null (RD = +-1): the only possible table is (0, nb) or (na, 0). Exact p = 1 for tables no more
    // extreme than it in the ordering by RD, else 0. RD values compared in exact integers.
    if (Math.abs(delta) !== 1) throw new Error('risk-difference null outside [-1, 1]');
    const d = (i: number, j: number) => j * na - i * nb, dDeg = delta === 1 ? d(0, nb) : d(na, 0);
    return Float64Array.from({ length: T }, (_, t) => {
      const i = Math.floor(t / (nb + 1)), j = t - i * (nb + 1), dt = d(i, j), nullD = Math.round(delta * na * nb);
      const ext = (x: number) => (direction === 'two-sided' ? Math.abs(x - nullD) : direction === 'greater' ? x - nullD : nullD - x);
      return ext(dDeg) >= ext(dt) ? 1 : 0;
    });
  }
  const z = new Float64Array(T);
  for (let i = 0; i <= na; i++) for (let j = 0; j <= nb; j++) z[i * (nb + 1) + j] = scoreZ(i, na, j, nb, delta);
  const key = (v: number) => (Number.isNaN(v) ? 0 : direction === 'two-sided' ? Math.abs(v) : direction === 'greater' ? v : -v);
  const keys = Float64Array.from(z, key);
  const order = Array.from({ length: T }, (_, t) => t).sort((s, t) => keys[t]! - keys[s]!); // most extreme first
  // Tie blocks over the sorted order (each block advances by at least one table).
  const blockEnd = new Int32Array(T);
  for (let t0 = 0; t0 < T;) { let t1 = t0 + 1; while (t1 < T && tieWith(keys[order[t1]!]!, keys[order[t0]!]!)) t1++; for (let u = t0; u < t1; u++) blockEnd[u] = t1; t0 = t1; }
  const { pa, slack } = certifiedNuisanceGrid(na, nb, delta);
  const p = new Float64Array(T), prev = new Float64Array(T), cur = new Float64Array(T);
  for (let g = 0; g < pa.length; g++) {
    const pb = Math.min(1, Math.max(0, pa[g]! + delta));
    const la = binomPmf(na, pa[g]!), lb = binomPmf(nb, pb);
    let cum = 0;
    for (let t0 = 0; t0 < T;) {
      const t1 = blockEnd[t0]!;
      for (let u = t0; u < t1; u++) { const t = order[u]!, i = Math.floor(t / (nb + 1)), j = t - i * (nb + 1); cum += la[i]! * lb[j]!; }
      for (let u = t0; u < t1; u++) cur[order[u]!] = cum;
      t0 = t1;
    }
    for (let t = 0; t < T; t++) {
      if (cur[t]! > p[t]!) p[t] = cur[t]!;
      if (g > 0) { const b = Math.max(prev[t]!, cur[t]!) + slack[g - 1]!; if (b > p[t]!) p[t] = b; }
    }
    prev.set(cur);
  }
  for (let t = 0; t < T; t++) p[t] = Math.min(1, p[t]!);
  return p;
}

/**
 * Certified unconditional exact p for one observed table: branch-and-bound over the nuisance on the arcsine scale.
 * Each interval's sup is bounded by max(endpoint values) + exact TV slack (see certifiedNuisanceGrid); intervals that
 * cannot beat the best certified lower value by more than tol are discarded, the rest bisected. Returns the
 * certified upper bound (>= the true supremum).
 */
export function unconditionalP(xa: number, na: number, xb: number, nb: number, delta: number, direction: Direction, tol = 2e-4): number {
  if (!(delta > -1 && delta < 1)) return unconditionalPTable(na, nb, delta, direction)[xa * (nb + 1) + xb]!;
  const key = (v: number) => (Number.isNaN(v) ? 0 : direction === 'two-sided' ? Math.abs(v) : direction === 'greater' ? v : -v);
  const kObs = key(scoreZ(xa, na, xb, nb, delta)), region: number[] = [];
  for (let i = 0; i <= na; i++) for (let j = 0; j <= nb; j++) { const k = key(scoreZ(i, na, j, nb, delta)); if (tieWith(k, kObs) || k > kObs) region.push(i, j); }
  const f = (pa: number) => {
    const la = binomPmf(na, pa), lb = binomPmf(nb, Math.min(1, Math.max(0, pa + delta)));
    let sum = 0; for (let r = 0; r < region.length; r += 2) sum += la[region[r]!]! * lb[region[r + 1]!]!; return sum;
  };
  const lo = Math.max(0, -delta), hi = Math.min(1, 1 - delta), t0 = Math.asin(Math.sqrt(lo)), t1 = Math.asin(Math.sqrt(hi));
  const pt = (t: number) => (t <= t0 ? lo : t >= t1 ? hi : Math.sin(t) ** 2);
  const M0 = 128;
  let ivs: { a: number; b: number; fa: number; fb: number; ub: number }[] = [];
  let best = 0, prevT = t0, prevF = f(lo);
  best = prevF;
  for (let i = 1; i <= M0; i++) {
    const t = t0 + (t1 - t0) * i / M0, fv = f(pt(t)); best = Math.max(best, fv);
    ivs.push({ a: prevT, b: t, fa: prevF, fb: fv, ub: Math.max(prevF, fv) + intervalSlack(na, nb, delta, pt(prevT), pt(t)) });
    prevT = t; prevF = fv;
  }
  for (let iter = 0; iter < 60 && ivs.length; iter++) {
    ivs = ivs.filter(v => v.ub > best + tol);
    if (!ivs.length) break;
    const next: typeof ivs = [];
    for (const v of ivs) {
      if (v.b - v.a < 1e-12) { next.push(v); continue; }
      const m = (v.a + v.b) / 2, fm = f(pt(m)); best = Math.max(best, fm);
      next.push({ a: v.a, b: m, fa: v.fa, fb: fm, ub: Math.max(v.fa, fm) + intervalSlack(na, nb, delta, pt(v.a), pt(m)) });
      next.push({ a: m, b: v.b, fa: fm, fb: v.fb, ub: Math.max(fm, v.fb) + intervalSlack(na, nb, delta, pt(m), pt(v.b)) });
    }
    ivs = next;
    if (ivs.length > 20000) break;
  }
  const ub = ivs.reduce((u, v) => Math.max(u, v.ub), best);
  return Math.min(1, Math.max(best, ub));
}

/** Fisher exact p for every table (i, j), conditional on the margin i + j. */
export function fisherPTable(na: number, nb: number, direction: Direction): Float64Array {
  const T = (na + 1) * (nb + 1), p = new Float64Array(T), N = na + nb;
  for (let K = 0; K <= N; K++) {
    const jmin = Math.max(0, K - na), jmax = Math.min(nb, K);
    const lp: number[] = [];
    for (let j = jmin; j <= jmax; j++) lp.push(lchoose(nb, j) + lchoose(na, K - j) - lchoose(N, K));
    for (let j = jmin; j <= jmax; j++) {
      const dObs = j * na - (K - j) * nb; // integer form of RD * na * nb
      let s = 0;
      for (let jj = jmin; jj <= jmax; jj++) {
        const d = jj * na - (K - jj) * nb;
        const extreme = direction === 'two-sided' ? Math.abs(d) >= Math.abs(dObs) : direction === 'greater' ? d >= dObs : d <= dObs;
        if (extreme) s += Math.exp(lp[jj - jmin]!);
      }
      p[(K - j) * (nb + 1) + j] = Math.min(1, s);
    }
  }
  return p;
}

export interface BinaryInput { xa: number; na: number; xb: number; nb: number; nullValue?: number; direction?: Direction; alpha?: number }

/** Decision p for the procedure at null delta for every table. */
export function binaryDecisionTable(na: number, nb: number, delta: number, direction: Direction): Float64Array {
  const u = unconditionalPTable(na, nb, delta, direction);
  if (delta !== 0 || Math.abs(delta) >= 1) return u;
  const f = fisherPTable(na, nb, direction);
  return Float64Array.from(u, (v, t) => Math.max(v, f[t]!));
}

export function binaryRiskDifference(input: BinaryInput): ProcedureResult {
  const id = "binary.exact-rd@1", { xa, na, xb, nb } = input, direction = input.direction ?? 'two-sided', alpha = input.alpha ?? 0.05, delta0 = input.nullValue ?? 0;
  if (![xa, na, xb, nb].every(Number.isSafeInteger) || na < 1 || nb < 1 || xa < 0 || xb < 0 || xa > na || xb > nb) throw new Error('invalid binary counts');
  if (!(delta0 > -1 && delta0 < 1)) return { procedure: id, status: 'refused', refusal: 'risk-difference null on or outside the boundary of (-1, 1)', estimate: xb / nb - xa / na, nullValue: delta0, direction, alpha, p: 1, ci: [-1, 1], components: {}, envelope: { nA: na, nB: nb } };
  const idx = xa * (nb + 1) + xb, fisherAt0 = fisherPTable(na, nb, direction)[idx]!;
  const pAt = (d: number) => (d === 0 ? Math.max(fisherAt0, unconditionalP(xa, na, xb, nb, 0, direction)) : unconditionalP(xa, na, xb, nb, d, direction));
  const p = pAt(delta0), est = xb / nb - xa / na;
  const accept = (d: number) => d > -1 + 1e-9 && d < 1 - 1e-9 && pAt(d) > alpha;
  const boundary = (sign: 1 | -1) => {
    // Grid walk then bisection on [-1, 1].
    let inside = est, outside: number = sign;
    for (let s = 1; s <= 20; s++) { const d = est + sign * s * 0.05; if (sign * d >= 1) break; if (!accept(d)) { outside = d; break; } inside = d; }
    for (let i = 0; i < 24; i++) { const mid = (inside + outside) / 2; if (accept(mid)) inside = mid; else outside = mid; } // 0.05 / 2^24 < 3e-9
    return inside;
  };
  let lo: number = direction === 'less' ? -1 : boundary(-1), hi: number = direction === 'greater' ? 1 : boundary(1);
  // Fisher's acceptance of RD = 0 joins the interval (hull) when it accepts.
  if (fisherAt0 > alpha) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
  return { procedure: id, status: 'ok', estimate: est, nullValue: delta0, direction, alpha, p, ci: [lo, hi],
    components: { pFisher: delta0 === 0 ? fisherAt0 : NaN, pUnconditional: unconditionalP(xa, na, xb, nb, delta0, direction) },
    envelope: { nA: na, nB: nb, events: xa + xb, nonEvents: na + nb - xa - xb } };
}

/** Exact rejection probability of the decision rule at (pa, pb), by full enumeration. */
export function exactRejectionRate(decision: Float64Array, na: number, nb: number, pa: number, pb: number, alpha: number): number {
  const la = logBinomPmf(na, pa), lb = logBinomPmf(nb, pb);
  let r = 0;
  for (let i = 0; i <= na; i++) for (let j = 0; j <= nb; j++) if (decision[i * (nb + 1) + j]! <= alpha) r += Math.exp(la[i]! + lb[j]!);
  return r;
}

/** Certified maximum over the nuisance of the exact rejection probability of a decision table (grid maxima
 * plus the same total-variation interval slack as the p-values): a provable size bound, not a grid estimate. */
export function certifiedMaxRejection(decision: Float64Array, na: number, nb: number, delta: number, alpha: number): { bound: number; gridMax: number; argmax: number } {
  const { pa, slack } = certifiedNuisanceGrid(na, nb, delta, 2e-4);
  let bound = 0, gridMax = 0, argmax = 0, prev = 0;
  for (let g = 0; g < pa.length; g++) {
    const pb = Math.min(1, Math.max(0, pa[g]! + delta)), r = exactRejectionRate(decision, na, nb, pa[g]!, pb, alpha);
    if (r > gridMax) { gridMax = r; argmax = pa[g]!; }
    bound = Math.max(bound, r, g > 0 ? Math.max(prev, r) + slack[g - 1]! : 0);
    prev = r;
  }
  return { bound: Math.min(1, bound), gridMax, argmax };
}
