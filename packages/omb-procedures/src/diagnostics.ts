import { tQuantileUpper } from './special.ts';

/**
 * Refusal-only data-validity diagnostics (amendment 1: outcome-dependent checks may only refuse, never reroute).
 * They are evaluated on the deciding data, per vector (an arm, an arm within a stratum, the unit contrasts, or a
 * residual vector), and depend only on within-vector deviations, so they are invariant under the metamorphic
 * transformations and independent of the tested null value.
 *
 * 1. Influence (Lindeberg) concentration: the largest single-observation share of the vector's centred sum of
 *    squares, d_(1)^2 / sum d^2 = G^2/(n-1) with G the Grubbs statistic. Generalised to the top-k shares by Rosner's
 *    generalised ESD (k = max(1, floor(n/10))): refuse when any extreme observation exceeds its ESD critical value at
 *    level alpha / m for a claim with m vectors (Bonferroni), so under normal data the claim-level refusal rate is
 *    about alpha.
 * 2. Ties / degeneracy: refuse when a vector has fewer than `minDistinct` distinct values or its modal value holds
 *    more than `maxModalShare` of the observations (lattice-dominated data; binary outcomes belong to the RD procedure).
 *
 * What these cannot do: they see only the sample. Contamination that is absent from the sample (rare mass far from
 * the bulk) leaves no trace, and Bahadur-Savage means no data-only rule can bound size against it. See
 * FEASIBILITY.md section 2.
 */
export interface DiagnosticsConfig { alpha: number; minDistinct: number; maxModalShare: number }
export const DEFAULT_DIAGNOSTICS: DiagnosticsConfig = { alpha: 0.01, minDistinct: 3, maxModalShare: 0.5 };

export interface VectorStats {
  n: number;
  /** Rosner R_i statistics for i = 1..k (most extreme first). */
  esdR: number[];
  lindeberg: number;
  /** (sum d^2)^2 / sum d^4: effective number of observations carrying the variance. */
  ess: number;
  distinct: number;
  modalShare: number;
}

export function vectorStats(values: ArrayLike<number>): VectorStats {
  const n = values.length, xs = Array.from(values);
  const counts = new Map<number, number>(); for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
  let modal = 0; for (const c of counts.values()) modal = Math.max(modal, c);
  let mean = 0; for (const x of xs) mean += x; mean /= n || 1;
  let s2 = 0, s4 = 0, maxd2 = 0; for (const x of xs) { const d2 = (x - mean) ** 2; s2 += d2; s4 += d2 * d2; maxd2 = Math.max(maxd2, d2); }
  const k = Math.max(1, Math.floor(n / 10)), esdR: number[] = [];
  if (n >= 3) {
    const rest = [...xs];
    for (let i = 0; i < k && rest.length >= 3; i++) {
      let m = 0; for (const x of rest) m += x; m /= rest.length;
      let ss = 0; for (const x of rest) ss += (x - m) ** 2;
      const sd = Math.sqrt(ss / (rest.length - 1));
      let j = 0, dev = -1; rest.forEach((x, idx) => { const dd = Math.abs(x - m); if (dd > dev) { dev = dd; j = idx; } });
      esdR.push(sd > 0 ? dev / sd : 0);
      rest.splice(j, 1);
    }
  }
  return { n, esdR, lindeberg: s2 > 0 ? maxd2 / s2 : 0, ess: s4 > 0 ? s2 * s2 / s4 : 0, distinct: counts.size, modalShare: n ? modal / n : 1 };
}

const lambdaCache = new Map<string, number>();
/** Rosner's critical value lambda_i for a vector of size n at overall level alpha (two-sided). */
export function esdLambda(n: number, i: number, alpha: number): number {
  const key = `${n}:${i}:${alpha}`, hit = lambdaCache.get(key); if (hit !== undefined) return hit;
  const m = n - i + 1, p = alpha / (2 * m), df = m - 2;
  let lam = Infinity;
  if (df >= 1) { const t = tQuantileUpper(p, df); lam = (m - 1) * t / Math.sqrt((df + t * t) * m); }
  lambdaCache.set(key, lam); return lam;
}

/** Number of ESD outliers at level alpha (0 = none). */
export function esdOutliers(st: VectorStats, alpha: number): number {
  let count = 0;
  st.esdR.forEach((r, idx) => { if (r > esdLambda(st.n, idx + 1, alpha)) count = idx + 1; });
  return count;
}

export interface DiagnosticOutcome { refused: boolean; reason?: string }

/** Apply the diagnostics to precomputed vector statistics. `tieVectors` get the ties rule, `outlierVectors` the ESD. */
export function judge(outlierStats: readonly VectorStats[], tieStats: readonly VectorStats[], cfg: DiagnosticsConfig): DiagnosticOutcome {
  for (const st of tieStats) {
    if (st.n >= 3 && st.distinct < cfg.minDistinct) return { refused: true, reason: `degenerate: ${st.distinct} distinct values in a vector of ${st.n}` };
    if (st.n >= 3 && st.modalShare > cfg.maxModalShare) return { refused: true, reason: `lattice-dominated: modal value holds ${(100 * st.modalShare).toFixed(0)}% of a vector of ${st.n}` };
  }
  // Bonferroni across the claim's vectors: under normal data the claim-level refusal rate is about cfg.alpha.
  const perVector = cfg.alpha / Math.max(1, outlierStats.length);
  for (const st of outlierStats) {
    const k = esdOutliers(st, perVector);
    if (k > 0) return { refused: true, reason: `influence concentration: ${k} ESD outlier(s) at level ${perVector.toPrecision(2)} per vector (largest Lindeberg share ${st.lindeberg.toFixed(3)}, n = ${st.n})` };
  }
  return { refused: false };
}

export function diagnose(outlierVectors: readonly ArrayLike<number>[], tieVectors: readonly ArrayLike<number>[], cfg: DiagnosticsConfig = DEFAULT_DIAGNOSTICS): DiagnosticOutcome {
  return judge(outlierVectors.map(vectorStats), tieVectors.map(vectorStats), cfg);
}

/** Diagnostic levels recorded by the simulator (0 = diagnostics off). */
export const DIAG_LEVELS = [0, 0.01, 0.05, 0.1] as const;
/** Refusal outcome at every level from one set of statistics. */
export function refusalsByLevel(outlierStats: readonly VectorStats[], tieStats: readonly VectorStats[]): boolean[] {
  return DIAG_LEVELS.map(level => (level === 0 ? false : judge(outlierStats, tieStats, { ...DEFAULT_DIAGNOSTICS, alpha: level }).refused));
}
