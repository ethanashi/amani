/**
 * Distribution class D for the simulator. Every law is standardized to mean 0, variance 1.
 *
 * Axes and how each level is realised:
 * - tails: 'normal' | 't5' | 't3'. Symmetric members are the Gaussian and Student t_nu (scaled to
 *   unit variance). "Tails no heavier than t_nu" = tail index >= nu.
 * - skew level s in {0, 1, 2}. It is a BODY-SKEW level (the Tukey g of the generator), which equals the MOMENT
 *   skewness only where the third moment exists (v2 audit 4; see lawDescription):
 *   - normal tails: lognormal (Tukey g, h = 0) with g chosen so the moment skewness is exactly s;
 *   - t5 tails: Tukey g-and-h with h = 1/5 (tail index 5, like t5) and g chosen so the moment
 *     skewness is exactly s;
 *   - t3 tails: g-and-h with h = 1/3 (tail index 3, like t3). Its third moment is infinite, so its moment
 *     skewness is undefined (the sampler reports Infinity). It uses the t5-calibrated g (same body skew, heavier
 *     tail). These laws do NOT validate a moment-skewness bound; they validate the body-skew level.
 * - sign: +1 right skew, -1 mirrored.
 */

export type Tails = 'normal' | 't5' | 't3';
export interface Law { skew: number; tails: Tails; sign: 1 | -1 }

/** Lognormal moment skewness for sigma. */
function lognormalSkew(s: number): number { const w = Math.exp(s * s); return (w + 2) * Math.sqrt(w - 1); }
function solveSkew(target: number): number { let lo = 1e-6, hi = 2; for (let i = 0; i < 200; i++) { const m = (lo + hi) / 2; if (lognormalSkew(m) < target) lo = m; else hi = m; } return (lo + hi) / 2; }
/** Key 6.18 is the lognormal with sigma = 1 (moment skewness 6.18), used only by re-probe designs. */
export const G_FOR_SKEW: Record<number, number> = { 0: 0, 0.5: solveSkew(0.5), 1: solveSkew(1), 1.5: solveSkew(1.5), 2: solveSkew(2), 3: solveSkew(3), 6.18: 1 };
/** g giving moment skewness s for g-and-h with h = 1/5. */
function ghSkew(g: number, h: number): number {
  const m1 = ghMoment(g, h, 1), m2 = ghMoment(g, h, 2), m3 = ghMoment(g, h, 3), sd = Math.sqrt(m2 - m1 * m1);
  return (m3 - 3 * m1 * m2 + 2 * m1 ** 3) / sd ** 3;
}
function solveGhSkew(target: number, h: number): number { let lo = 1e-6, hi = 1; for (let i = 0; i < 200; i++) { const m = (lo + hi) / 2; if (ghSkew(m, h) < target) lo = m; else hi = m; } return (lo + hi) / 2; }
export const G_FOR_SKEW_T5: Record<number, number> = { 0: 0, 0.5: solveGhSkew(0.5, 0.2), 1: solveGhSkew(1, 0.2), 1.5: solveGhSkew(1.5, 0.2), 2: solveGhSkew(2, 0.2), 3: solveGhSkew(3, 0.2) };

/** Raw moments E[X^n] of Tukey g-and-h, X = (e^{gZ}-1)/g * e^{hZ^2/2}; valid for n h < 1. */
export function ghMoment(g: number, h: number, n: number): number {
  if (n * h >= 1) return Infinity;
  if (g === 0) {
    // X = Z e^{hZ^2/2}: odd moments 0, E[Z^n e^{n h Z^2 / 2}] = (n-1)!! (1 - n h)^{-(n+1)/2}
    if (n % 2 === 1) return 0;
    let df = 1; for (let k = n - 1; k > 1; k -= 2) df *= k;
    return df * (1 - n * h) ** (-(n + 1) / 2);
  }
  let s = 0;
  for (let i = 0; i <= n; i++) s += (i % 2 ? -1 : 1) * binom(n, i) * Math.exp(((n - i) * g) ** 2 / (2 * (1 - n * h)));
  return s / (g ** n * Math.sqrt(1 - n * h));
}
function binom(n: number, k: number): number { let r = 1; for (let i = 1; i <= k; i++) r = r * (n - k + i) / i; return r; }

/** Rare-outlier mixture (adversarial family). Core: unit-variance uniform or normal. Outliers at distance L core-SDs:
 * 'one-point' = +L w.p. p; 'one-exp' = +L(1 + Exp(1)) w.p. p (unbounded); 'two-zeroskew' = +L w.p. p and -2L w.p. q,
 * with q solved so the mixture's skewness is exactly 0 (the audit's counterexample shape). Standardized exactly. */
export interface MixLaw { kind: 'mix'; core: 'uniform' | 'normal'; type: 'one-point' | 'one-exp' | 'two-zeroskew'; p: number; L: number; sign: 1 | -1 }
/** Discrete (lattice) outcome laws, standardized exactly. */
export interface LatticeLaw { kind: 'lattice'; name: 'poisson0.5' | 'poisson2' | 'ordinal5' | 'zero-heavy'; sign: 1 | -1 }
export type AnyLaw = Law | MixLaw | LatticeLaw;

export interface LawSampler {
  draw: (rng: { normal: () => number; studentT: (df: number) => number; uniform: () => number }) => number;
  skewness: number; kurtosis?: number; label: string;
  /** For mixtures: whether the last draw came from an outlier component. */
  lastOutlier?: boolean;
}

function mixMoments(core: 'uniform' | 'normal', type: MixLaw['type'], p: number, L: number, q: number): [number, number, number, number] {
  // raw moments E[X], E[X^2], E[X^3], E[X^4] of the unstandardized mixture; core has mean 0, var 1, m3 0, m4 1.8 or 3.
  const c4 = core === 'uniform' ? 1.8 : 3, w = 1 - p - q;
  let m1 = 0, m2 = w, m3 = 0, m4 = w * c4;
  if (type === 'one-exp') { m1 += p * 2 * L; m2 += p * 5 * L ** 2; m3 += p * 16 * L ** 3; m4 += p * 65 * L ** 4; }
  else { m1 += p * L; m2 += p * L ** 2; m3 += p * L ** 3; m4 += p * L ** 4; }
  if (type === 'two-zeroskew') { m1 += q * -2 * L; m2 += q * 4 * L ** 2; m3 += q * -8 * L ** 3; m4 += q * 16 * L ** 4; }
  return [m1, m2, m3, m4];
}
function central(m: [number, number, number, number]): { mean: number; sd: number; skew: number; kurt: number } {
  const [m1, m2, m3, m4] = m, v = m2 - m1 * m1, mu3 = m3 - 3 * m1 * m2 + 2 * m1 ** 3, mu4 = m4 - 4 * m1 * m3 + 6 * m1 * m1 * m2 - 3 * m1 ** 4;
  return { mean: m1, sd: Math.sqrt(v), skew: mu3 / v ** 1.5, kurt: mu4 / (v * v) };
}
export function solveZeroSkewQ(core: 'uniform' | 'normal', p: number, L: number): number {
  const f = (q: number) => central(mixMoments(core, 'two-zeroskew', p, L, q)).skew;
  let lo = 0, hi = Math.min(p, 1 - p - 1e-9);
  if (f(lo) * f(hi) > 0) return NaN;
  for (let i = 0; i < 200; i++) { const m = (lo + hi) / 2; if (f(lo) * f(m) <= 0) hi = m; else lo = m; }
  return (lo + hi) / 2;
}

const LATTICES: Record<LatticeLaw['name'], { x: number[]; p: number[] }> = (() => {
  const pois = (lam: number, K: number) => { const x: number[] = [], p: number[] = []; let pk = Math.exp(-lam); for (let k = 0; k <= K; k++) { x.push(k); p.push(pk); pk *= lam / (k + 1); } const s = p.reduce((a, b) => a + b, 0); return { x, p: p.map(v => v / s) }; };
  return { 'poisson0.5': pois(0.5, 12), poisson2: pois(2, 20), ordinal5: { x: [1, 2, 3, 4, 5], p: [0.05, 0.1, 0.15, 0.3, 0.4] }, 'zero-heavy': { x: [0, 1, 2, 5], p: [0.6, 0.25, 0.1, 0.05] } };
})();

/** Build a standardized sampler for any law. */
export function lawSampler(law: AnyLaw): LawSampler {
  if ('kind' in law && law.kind === 'mix') {
    const q = law.type === 'two-zeroskew' ? solveZeroSkewQ(law.core, law.p, law.L) : 0;
    if (Number.isNaN(q)) throw new Error('no zero-skew solution');
    const c = central(mixMoments(law.core, law.type, law.p, law.L, q)), sign = law.sign, uniCore = law.core === 'uniform';
    const sampler: LawSampler = { skewness: sign * c.skew, kurtosis: c.kurt, label: `mix/${law.core}/${law.type}/p${law.p}/L${law.L}${sign < 0 ? '-' : ''}`, lastOutlier: false, draw: r => {
      const u = r.uniform(); let x: number;
      if (u < law.p) { x = law.type === 'one-exp' ? law.L * (1 - Math.log(1 - r.uniform())) : law.L; sampler.lastOutlier = true; }
      else if (u < law.p + q) { x = -2 * law.L; sampler.lastOutlier = true; }
      else { x = uniCore ? (r.uniform() * 2 - 1) * Math.sqrt(3) : r.normal(); sampler.lastOutlier = false; }
      return sign * (x - c.mean) / c.sd;
    } };
    return sampler;
  }
  if ('kind' in law && law.kind === 'lattice') {
    const L = LATTICES[law.name], m1 = L.x.reduce((s, x, i) => s + x * L.p[i]!, 0), m2 = L.x.reduce((s, x, i) => s + x * x * L.p[i]!, 0);
    const m3 = L.x.reduce((s, x, i) => s + (x - m1) ** 3 * L.p[i]!, 0), sd = Math.sqrt(m2 - m1 * m1), cum = L.p.map((_, i) => L.p.slice(0, i + 1).reduce((a, b) => a + b, 0));
    return { skewness: law.sign * m3 / sd ** 3, label: `lattice/${law.name}${law.sign < 0 ? '-' : ''}`, draw: r => {
      const u = r.uniform(); let i = 0; while (i < cum.length - 1 && u > cum[i]!) i++; return law.sign * (L.x[i]! - m1) / sd;
    } };
  }
  const gl = law as Law;
  const nu = gl.tails === 't5' ? 5 : gl.tails === 't3' ? 3 : Infinity;
  const g = (nu === Infinity ? G_FOR_SKEW : G_FOR_SKEW_T5)[gl.skew];
  if (g === undefined) throw new Error(`unsupported skew level ${gl.skew}`);
  const label = `${gl.tails}/s${gl.skew}${gl.sign < 0 ? '-' : ''}`;
  if (g === 0 && nu === Infinity) return { draw: r => r.normal(), skewness: 0, label };
  if (g === 0) { const sd = Math.sqrt(nu / (nu - 2)); return { draw: r => r.studentT(nu) / sd, skewness: 0, label }; }
  const h = nu === Infinity ? 0 : 1 / nu;
  const m1 = ghMoment(g, h, 1), m2 = ghMoment(g, h, 2), sd = Math.sqrt(m2 - m1 * m1);
  const m3 = ghMoment(g, h, 3);
  const skewness = Number.isFinite(m3) ? gl.sign * (m3 - 3 * m1 * m2 + 2 * m1 ** 3) / sd ** 3 : gl.sign * Infinity;
  const sign = gl.sign;
  return {
    draw: r => { const z = r.normal(); return sign * (((Math.exp(g * z) - 1) / g) * Math.exp(h * z * z / 2) - m1) / sd; },
    skewness, label,
  };
}

/**
 * Maximum distance, in core SDs, of the CONTAMINATING mass from the core mean (v2 audit 2). A mixture law is
 * (1 - p - q) x core + p x (contamination at +L, or +L(1 + Exp(1))) + q x (contamination at -2L): the population
 * core (unit-variance uniform or normal, mean 0) and the contamination are separate components, and this is the
 * distance of the farthest contaminating point. one-point: L; two-zeroskew: 2L (its -2L mass); one-exp: unbounded.
 */
export function contaminationDistance(law: MixLaw): number {
  return law.type === 'one-exp' ? Infinity : law.type === 'two-zeroskew' ? 2 * law.L : law.L;
}

/** Tukey g-and-h quantile at standard-normal quantile z. */
const ghQ = (g: number, h: number, z: number) => (g === 0 ? z : (Math.exp(g * z) - 1) / g) * Math.exp(h * z * z / 2);
const Z90 = 1.2815515655446004;

/**
 * What a calibration law is, in words (v2 audit 4): the generator, its moment skewness (or why it is undefined) and
 * its body skew, measured by Kelly's quantile skewness (Q90 + Q10 - 2 Q50) / (Q90 - Q10), which exists for every law.
 */
export function lawDescription(law: Law): { generator: string; momentSkewness: string; kellySkew: number; tailIndex: string } {
  const nu = law.tails === 't5' ? 5 : law.tails === 't3' ? 3 : Infinity, tailIndex = nu === Infinity ? 'all moments' : `${nu} (moments of order < ${nu})`;
  const sgn = law.sign < 0 ? ', mirrored' : '';
  if (law.skew === 0) return { generator: nu === Infinity ? 'standard normal' : `Student t${nu}, scaled to unit variance`, momentSkewness: nu === 3 ? 'undefined (infinite third moment); symmetric' : '0', kellySkew: 0, tailIndex };
  const g = (nu === Infinity ? G_FOR_SKEW : G_FOR_SKEW_T5)[law.skew];
  if (g === undefined) throw new Error(`unsupported skew level ${law.skew}`);
  const h = nu === Infinity ? 0 : 1 / nu, hs = nu === Infinity ? '0' : `1/${nu}`;
  const kelly = law.sign * (ghQ(g, h, Z90) + ghQ(g, h, -Z90)) / (ghQ(g, h, Z90) - ghQ(g, h, -Z90));
  const generator = nu === Infinity ? `lognormal (Tukey g-and-h, h = 0), g = ${g.toFixed(4)} gives moment skewness ${law.skew}${sgn}`
    : nu === 5 ? `Tukey g-and-h, h = 1/5, g = ${g.toFixed(4)} gives moment skewness ${law.skew}${sgn}`
    : `Tukey g-and-h, h = ${hs}, g = ${g.toFixed(4)} (the h = 1/5 g for moment skewness ${law.skew}: body-skew convention)${sgn}`;
  return { generator, momentSkewness: nu === 3 ? 'undefined (infinite third moment)' : String(law.sign * law.skew), kellySkew: kelly, tailIndex };
}
