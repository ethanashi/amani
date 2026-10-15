// Exact binomial tools for the null calibration: Clopper-Pearson intervals and the one-sided
// exact test of H0: rate <= alpha. Probabilities are summed in log space (n up to a few thousand).

function logGamma(x: number): number {
  // Lanczos approximation (g = 7, n = 9); relative error below 1e-13 for x > 0.
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  x -= 1;
  let a = c[0]!;
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += c[i]! / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

export function binomialPmf(n: number, k: number, p: number): number {
  if (!Number.isSafeInteger(n) || !Number.isSafeInteger(k) || n < 0 || k < 0 || k > n || !(p >= 0 && p <= 1)) throw new Error("invalid binomial arguments");
  if (p === 0) return k === 0 ? 1 : 0;
  if (p === 1) return k === n ? 1 : 0;
  return Math.exp(logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1) + k * Math.log(p) + (n - k) * Math.log1p(-p));
}

/** P(X >= k | n, p). */
export function upperTail(n: number, k: number, p: number): number {
  if (k <= 0) return 1;
  if (k > n) return 0;
  let s = 0;
  for (let i = k; i <= n; i++) s += binomialPmf(n, i, p);
  return Math.min(1, s);
}

/** P(X <= k | n, p). */
export function lowerTail(n: number, k: number, p: number): number {
  if (k < 0) return 0;
  if (k >= n) return 1;
  let s = 0;
  for (let i = 0; i <= k; i++) s += binomialPmf(n, i, p);
  return Math.min(1, s);
}

function bisect(f: (p: number) => number, target: number, increasing: boolean): number {
  let lo = 0, hi = 1;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if ((f(mid) < target) === increasing) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Two-sided (1 - level) Clopper-Pearson interval for k successes in n trials. */
export function clopperPearson(k: number, n: number, level = 0.95): [number, number] {
  if (!Number.isSafeInteger(n) || n <= 0 || !Number.isSafeInteger(k) || k < 0 || k > n) throw new Error("invalid interval arguments");
  const a = (1 - level) / 2;
  const lower = k === 0 ? 0 : bisect((p) => upperTail(n, k, p), a, true);
  const upper = k === n ? 1 : bisect((p) => lowerTail(n, k, p), a, false);
  return [lower, upper];
}

/** One-sided exact test of H0: rate <= alpha against rate > alpha; returns the p-value. */
export function exceedsAlphaP(k: number, n: number, alpha: number): number {
  return upperTail(n, k, alpha);
}
