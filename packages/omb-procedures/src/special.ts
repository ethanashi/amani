/**
 * Special functions used by every procedure. Pure and deterministic.
 * References: Numerical Recipes 3rd ed. (gammln, betacf, gcf/gser), checked against R in
 * test/special.test.ts.
 */

const LANCZOS = [
  57.1562356658629235, -59.5979603554754912, 14.1360979747417471, -0.491913816097620199,
  0.339946499848118887e-4, 0.465236289270485756e-4, -0.983744753048795646e-4,
  0.158088703224912494e-3, -0.210264441724104883e-3, 0.217439618115212643e-3,
  -0.164318106536763890e-3, 0.844182239838527433e-4, -0.261908384015814087e-4,
  0.368991826595316234e-5,
];

/** log Γ(x) for x > 0 (Lanczos, NR3 gammln; relative error < 1e-15). */
export function lgamma(x: number): number {
  if (!(x > 0)) throw new Error('lgamma needs x > 0');
  let y = x;
  const tmp0 = x + 5.24218750000000000;
  const tmp = (x + 0.5) * Math.log(tmp0) - tmp0;
  let ser = 0.999999999999997092;
  for (const c of LANCZOS) ser += c / ++y;
  return tmp + Math.log(2.5066282746310005 * ser / x);
}

const FPMIN = 1e-300;
const EPS = 1e-16;

function betacf(a: number, b: number, x: number): number {
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - qab * x / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m < 100000; m++) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) <= EPS) return h;
  }
  throw new Error('incomplete beta did not converge');
}

/** Regularized incomplete beta I_x(a, b). */
export function ibeta(x: number, a: number, b: number): number {
  if (!(a > 0 && b > 0) || !(x >= 0 && x <= 1)) throw new Error('invalid incomplete beta arguments');
  if (x === 0) return 0;
  if (x === 1) return 1;
  const lbt = lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log1p(-x);
  if (x < (a + 1) / (a + b + 2)) return Math.exp(lbt) * betacf(a, b, x) / a;
  return 1 - Math.exp(lbt) * betacf(b, a, 1 - x) / b;
}

/** Upper tail P(T > t) of Student t with real df > 0 (df = Infinity is the normal). */
export function tUpper(t: number, df: number): number {
  if (Number.isNaN(t) || !(df > 0)) throw new Error('invalid Student t arguments');
  if (t === Infinity) return 0;
  if (t === -Infinity) return 1;
  if (df === Infinity) return normalUpper(t);
  if (t === 0) return 0.5;
  const tail = 0.5 * ibeta(df / (df + t * t), df / 2, 0.5);
  return t > 0 ? tail : 1 - tail;
}
export const tCdf = (t: number, df: number): number => 1 - tUpper(t, df);

/** p-value of a t statistic in the stated direction. */
export function tPValue(t: number, df: number, direction: Direction): number {
  if (direction === 'greater') return tUpper(t, df);
  if (direction === 'less') return tUpper(-t, df);
  return Math.min(1, 2 * tUpper(Math.abs(t), df));
}

export type Direction = 'two-sided' | 'greater' | 'less';

/** Quantile q with P(T > q) = upper, for 0 < upper < 1. */
export function tQuantileUpper(upper: number, df: number): number {
  if (!(upper > 0 && upper < 1)) throw new Error('invalid t quantile probability');
  if (upper === 0.5) return 0;
  if (upper > 0.5) return -tQuantileUpper(1 - upper, df);
  let lo = 0, hi = 1;
  while (tUpper(hi, df) > upper) { lo = hi; hi *= 2; if (hi > 1e300) return Infinity; }
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (mid === lo || mid === hi) break;
    if (tUpper(mid, df) > upper) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Regularized lower incomplete gamma P(a, x). */
export function gammaP(a: number, x: number): number {
  if (!(a > 0) || !(x >= 0)) throw new Error('invalid incomplete gamma arguments');
  if (x === 0) return 0;
  const gln = lgamma(a);
  if (x < a + 1) {
    let ap = a, sum = 1 / a, del = sum;
    for (let n = 0; n < 100000; n++) { ap++; del *= x / ap; sum += del; if (Math.abs(del) < Math.abs(sum) * EPS) break; }
    return sum * Math.exp(-x + a * Math.log(x) - gln);
  }
  return 1 - gammaQcf(a, x, gln);
}
function gammaQcf(a: number, x: number, gln: number): number {
  let b = x + 1 - a, c = 1 / FPMIN, d = 1 / b, h = d;
  for (let i = 1; i < 100000; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c; h *= del;
    if (Math.abs(del - 1) <= EPS) break;
  }
  return Math.exp(-x + a * Math.log(x) - gln) * h;
}
export function gammaQ(a: number, x: number): number {
  if (!(a > 0) || !(x >= 0)) throw new Error('invalid incomplete gamma arguments');
  if (x === 0) return 1;
  if (x < a + 1) return 1 - gammaP(a, x);
  return gammaQcf(a, x, lgamma(a));
}

/** Upper tail of the standard normal, accurate in both tails. */
export function normalUpper(z: number): number {
  if (Number.isNaN(z)) throw new Error('invalid normal argument');
  if (z === Infinity) return 0;
  if (z === -Infinity) return 1;
  const half = 0.5 * gammaQ(0.5, z * z / 2);
  return z >= 0 ? half : 1 - half;
}
export const normalCdf = (z: number): number => 1 - normalUpper(z);

export function normalQuantile(p: number): number {
  if (!(p > 0 && p < 1)) throw new Error('invalid normal quantile probability');
  let lo = -40, hi = 40;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (mid === lo || mid === hi) break;
    if (normalCdf(mid) < p) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Beta quantile by bisection on ibeta. */
export function betaQuantile(p: number, a: number, b: number): number {
  if (!(p >= 0 && p <= 1)) throw new Error('invalid beta quantile probability');
  if (p === 0) return 0;
  if (p === 1) return 1;
  let lo = 0, hi = 1;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (mid === lo || mid === hi) break;
    if (ibeta(mid, a, b) < p) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/** One-sided (1 - level) Clopper-Pearson upper bound for k successes in n trials. */
export function clopperPearsonUpper(k: number, n: number, level = 0.95): number {
  if (!Number.isSafeInteger(k) || !Number.isSafeInteger(n) || k < 0 || n < 1 || k > n) throw new Error('invalid binomial count');
  if (k === n) return 1;
  return betaQuantile(level, k + 1, n - k);
}
export function clopperPearsonLower(k: number, n: number, level = 0.95): number {
  if (!Number.isSafeInteger(k) || !Number.isSafeInteger(n) || k < 0 || n < 1 || k > n) throw new Error('invalid binomial count');
  if (k === 0) return 0;
  return betaQuantile(1 - level, k, n - k + 1);
}
/** Wilson score interval (two-sided, level). */
export function wilson(k: number, n: number, level = 0.95): [number, number] {
  const z = normalQuantile(1 - (1 - level) / 2), p = k / n, z2 = z * z;
  const centre = (p + z2 / (2 * n)) / (1 + z2 / n);
  const half = z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n)) / (1 + z2 / n);
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

/** log of n choose k. */
export function lchoose(n: number, k: number): number {
  if (k < 0 || k > n) return -Infinity;
  return lgamma(n + 1) - lgamma(k + 1) - lgamma(n - k + 1);
}
/** Exact n choose k as a number when it is below 2^53, else Infinity. */
export function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  k = Math.min(k, n - k);
  let r = 1;
  for (let i = 1; i <= k; i++) {
    r = r * (n - k + i) / i;
    if (r > 9.007199254740991e15) return Infinity;
  }
  return Math.round(r);
}
