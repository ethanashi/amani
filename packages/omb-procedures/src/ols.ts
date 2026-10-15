import { Rng } from './rng.ts';
import { tPValue, tQuantileUpper, type Direction } from './special.ts';
import { contentSeed, parseDecimal, reduceByGcd, scaleColumn, shiftToZero } from './scale.ts';
import { atLeastAsExtreme, mcThreshold, refused, type ProcedureResult, type TestSpec } from './types.ts';
import { invertBoundary } from './twogroup.ts';
import { DEFAULT_DIAGNOSTICS, diagnose, type DiagnosticsConfig } from './diagnostics.ts';

/** Wild bootstrap enumerates all 2^n sign patterns when n is at most this. */
export const WILD_ENUM_MAX_N = 12;

function dot(a: ArrayLike<number>, b: ArrayLike<number>): number { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!; return s; }

/** Reorthogonalized modified Gram-Schmidt. Returns unit columns and the last column's raw residual. */
function gramSchmidt(columns: readonly Float64Array[]): { q: Float64Array[]; lastResidual: Float64Array; lastNorm2: number; rankDeficient: boolean } {
  const q: Float64Array[] = [];
  let lastResidual = new Float64Array(0), lastNorm2 = 0, rankDeficient = false;
  columns.forEach((col, ci) => {
    const scale = Math.sqrt(dot(col, col));
    if (!(scale > 0)) { rankDeficient = true; return; }
    const r = Float64Array.from(col, v => v / scale);
    for (let pass = 0; pass < 2; pass++) for (const b of q) { const c = dot(r, b); for (let i = 0; i < r.length; i++) r[i]! -= c * b[i]!; }
    const len = Math.sqrt(dot(r, r));
    if (ci === columns.length - 1) { lastResidual = Float64Array.from(r, v => v * scale); lastNorm2 = len * len * scale * scale; }
    if (len < 1e-9) { rankDeficient = true; return; }
    q.push(Float64Array.from(r, v => v / len));
  });
  return { q, lastResidual, lastNorm2, rankDeficient };
}

/**
 * Fixed OLS design for the coefficient of the last column x, with intercept and nuisance Z.
 * Everything that depends only on X (never on y) is computed once: leverages, the FWL weight
 * vector r (beta = r . y), HC2 weights a_i^2 = r_i^2 / (1 - h_ii), and the Bell-McCaffrey df.
 */
export class OlsDesign {
  readonly n: number; readonly k: number;
  readonly q: Float64Array[]; readonly qz: Float64Array[];
  readonly h: Float64Array; readonly r: Float64Array; readonly a2: Float64Array; readonly xt: Float64Array;
  readonly bmDf: number; readonly maxLeverage: number; readonly ok: boolean; readonly problem: string;
  /** Row-major copy of Q (n x k) for the wild inner loop. */
  private readonly qFlat: Float64Array;
  constructor(x: Float64Array, nuisance: readonly Float64Array[]) {
    const n = x.length; this.n = n;
    const one = new Float64Array(n).fill(1);
    const gz = gramSchmidt([one, ...nuisance]);
    const g = gramSchmidt([one, ...nuisance, x]);
    this.qz = gz.q; this.q = g.q; this.k = g.q.length;
    let problem = '';
    if (gz.rankDeficient) problem = 'nuisance columns are rank deficient';
    if (g.rankDeficient && !problem) problem = 'exposure is collinear with intercept and covariates';
    if (n - this.k < 1 && !problem) problem = 'no residual degrees of freedom';
    // x residualised on [1, Z]; r = xt / |xt|^2.
    const xt = Float64Array.from(x); for (const b of this.qz) { const c = dot(xt, b); for (let i = 0; i < n; i++) xt[i]! -= c * b[i]!; }
    for (const b of this.qz) { const c = dot(xt, b); for (let i = 0; i < n; i++) xt[i]! -= c * b[i]!; }
    this.xt = xt;
    const sxx = dot(xt, xt);
    if (!(sxx > 1e-18 * Math.max(1, dot(x, x))) && !problem) problem = 'exposure is collinear with intercept and covariates';
    this.r = Float64Array.from(xt, v => v / sxx);
    this.h = new Float64Array(n);
    for (const b of this.q) for (let i = 0; i < n; i++) this.h[i]! += b[i]! * b[i]!;
    let maxH = 0; for (let i = 0; i < n; i++) maxH = Math.max(maxH, this.h[i]!);
    this.maxLeverage = maxH;
    if (maxH >= 1 - 1e-10 && !problem) problem = 'a unit has leverage 1 (HC2 undefined)';
    this.a2 = Float64Array.from(this.r, (ri, i) => ri * ri / (1 - this.h[i]!));
    // BM df = (sum a2 (1-h))^2 / (sum a2^2 - 2 sum a2^2 h + ||Q' A Q||_F^2)
    let num = 0, s4 = 0, s4h = 0;
    for (let i = 0; i < n; i++) { const a = this.a2[i]!; num += a * (1 - this.h[i]!); s4 += a * a; s4h += a * a * this.h[i]!; }
    let frob = 0;
    for (let p = 0; p < this.k; p++) for (let s = 0; s < this.k; s++) {
      let m = 0; const qp = this.q[p]!, qs = this.q[s]!;
      for (let i = 0; i < n; i++) m += this.a2[i]! * qp[i]! * qs[i]!;
      frob += m * m;
    }
    this.bmDf = num * num / (s4 - 2 * s4h + frob);
    this.ok = problem === ''; this.problem = problem;
    this.qFlat = new Float64Array(n * this.k);
    for (let p = 0; p < this.k; p++) { const qp = this.q[p]!; for (let i = 0; i < n; i++) this.qFlat[i * this.k + p] = qp[i]!; }
  }
  /** Residuals of w on the full design. */
  residuals(w: ArrayLike<number>): Float64Array {
    const e = Float64Array.from(w);
    for (const b of this.q) { const c = dot(e, b); for (let i = 0; i < this.n; i++) e[i]! -= c * b[i]!; }
    return e;
  }
  /** Residuals on the restricted (null-imposed) design [1, Z]. */
  restrictedResiduals(w: ArrayLike<number>): Float64Array {
    const e = Float64Array.from(w);
    for (const b of this.qz) { const c = dot(e, b); for (let i = 0; i < this.n; i++) e[i]! -= c * b[i]!; }
    return e;
  }
  /** Internally studentized residuals e_i / sqrt(1 - h_ii) of w on the full design (null-independent). */
  standardizedResiduals(w: ArrayLike<number>): Float64Array {
    const e = this.residuals(w), out: number[] = [];
    for (let i = 0; i < this.n; i++) if (1 - this.h[i]! > 1e-12) out.push(e[i]! / Math.sqrt(1 - this.h[i]!));
    return Float64Array.from(out);
  }
  /** Slope, HC2 SE and t for testing slope = 0 on outcome w. Cancellation snapped to zero. */
  fit(w: ArrayLike<number>): { beta: number; se: number; t: number } {
    let beta = 0, mag = 0;
    for (let i = 0; i < this.n; i++) { const c = this.r[i]! * w[i]!; beta += c; mag += Math.abs(c); }
    if (Math.abs(beta) <= 1e-12 * mag) beta = 0;
    const e = this.residuals(w);
    let v = 0, qn = 0; for (let i = 0; i < this.n; i++) { v += this.a2[i]! * e[i]! * e[i]!; qn += e[i]! * e[i]!; }
    let wn = 0; for (let i = 0; i < this.n; i++) wn += w[i]! * w[i]!;
    if (qn <= 1e-24 * wn) v = 0;
    const se = Math.sqrt(v);
    return { beta, se, t: se > 0 ? beta / se : beta === 0 ? 0 : Math.sign(beta) * Infinity };
  }
  /** Studentized wild statistic for a sign pattern applied to restricted residuals et. */
  private wildT(et: Float64Array, signs: Int8Array, buf: Float64Array, c: Float64Array): number {
    const n = this.n;
    let num = 0, mag = 0;
    for (let i = 0; i < n; i++) { const wi = signs[i]! * et[i]!; buf[i] = wi; const ri = this.r[i]! * wi; num += ri; mag += Math.abs(ri); }
    if (Math.abs(num) <= 1e-12 * mag) num = 0;
    const k = this.k, Q = this.qFlat, a2 = this.a2;
    c.fill(0);
    for (let i = 0; i < n; i++) { const b = buf[i]!, o = i * k; for (let p = 0; p < k; p++) c[p]! += Q[o + p]! * b; }
    let v = 0;
    for (let i = 0; i < n; i++) { let e = buf[i]!; const o = i * k; for (let p = 0; p < k; p++) e -= Q[o + p]! * c[p]!; v += a2[i]! * e * e; }
    const se = Math.sqrt(v);
    return se > 0 ? num / se : num === 0 ? 0 : Math.sign(num) * Infinity;
  }
  /** Visit wild-bootstrap t statistics: all 2^n patterns when n <= WILD_ENUM_MAX_N, else B seeded draws. */
  wild(et: Float64Array, seed: string, B: number, visit: (t: number) => boolean | void): { exhaustive: boolean } {
    const n = this.n, signs = new Int8Array(n), buf = new Float64Array(n), c = new Float64Array(this.k);
    if (n <= WILD_ENUM_MAX_N) {
      const total = 2 ** n;
      for (let mask = 0; mask < total; mask++) {
        for (let i = 0; i < n; i++) signs[i] = (mask >> i) & 1 ? 1 : -1;
        if (visit(this.wildT(et, signs, buf, c)) === false) break;
      }
      return { exhaustive: true };
    }
    const rng = new Rng(seed);
    for (let b = 0; b < B; b++) {
      let word = 0;
      for (let i = 0; i < n; i++) { if ((i & 31) === 0) word = rng.word(); signs[i] = (word >>> (i & 31)) & 1 ? 1 : -1; }
      if (visit(this.wildT(et, signs, buf, c)) === false) break;
    }
    return { exhaustive: false };
  }
  /** Wild p-value for the observed t of outcome w (slope 0 null imposed). */
  wildP(w: ArrayLike<number>, tObs: number, direction: Direction, seed: string, B: number): { p: number; draws: number; exhaustive: boolean } {
    const et = this.restrictedResiduals(w);
    let extreme = 0, draws = 0;
    const { exhaustive } = this.wild(et, seed, B, t => { draws++; if (atLeastAsExtreme(t, tObs, direction)) extreme++; });
    return { p: exhaustive ? extreme / draws : (1 + extreme) / (1 + B), draws, exhaustive };
  }
}

/** Decision-only path for the simulator; identical decisions to the procedure with the same seed. */
export function olsWildDecide(design: OlsDesign, w: ArrayLike<number>, seedIn: string | (() => string), B: number, tests: readonly TestSpec[]): { reject: boolean[]; tReject: boolean[]; refused: boolean } {
  const seedOf = (): string => (typeof seedIn === 'string' ? seedIn : seedIn());
  const f = design.fit(w);
  if (!design.ok || (f.se === 0 && f.beta !== 0)) return { reject: tests.map(() => false), tReject: tests.map(() => false), refused: true };
  const pT = tests.map(s => f.se === 0 ? 1 : tPValue(f.t, design.bmDf, s.direction));
  const tReject = tests.map((s, i) => pT[i]! <= s.alpha);
  if (!tReject.some(Boolean)) return { reject: tReject, tReject, refused: false };
  const et = design.restrictedResiduals(w), counts = tests.map(() => 0), thresholds = tests.map(s => mcThreshold(s.alpha, B));
  const enumerate = design.n <= WILD_ENUM_MAX_N;
  let draws = 0;
  design.wild(et, seedOf(), B, t => {
    draws++; let open = enumerate;
    tests.forEach((s, i) => {
      if (!tReject[i]) return;
      if (atLeastAsExtreme(t, f.t, s.direction)) counts[i]!++;
      if (counts[i]! <= thresholds[i]!) open = true;
    });
    return open;
  });
  return { reject: tests.map((s, i) => tReject[i]! && (enumerate ? counts[i]! / draws <= s.alpha : counts[i]! <= thresholds[i]!)), tReject, refused: false };
}

export interface Column { values: readonly (number | string)[]; decimals: number }
export interface RegressionInput {
  y: Column;
  /** Exposure: binary or continuous. */
  x: Column;
  covariates?: readonly Column[];
  /** Categorical covariates, one dummy per non-reference level (reference = first level in sorted order). */
  factors?: readonly (readonly string[])[];
  /** H0: slope of y on x = nullValue (units of y per unit of x). */
  nullValue?: number | string;
  /** Refusal-only data-validity diagnostics on residuals and the outcome (default on). */
  diagnostics?: DiagnosticsConfig | false;
  direction?: Direction; alpha?: number; B?: number; seed?: string;
  /** Compute the interval by inverting the decision rule (default true). */
  interval?: boolean;
}

interface CanonicalRegression { w: Float64Array; x: Float64Array; z: Float64Array[]; toOriginal: (slopeW: number) => number; nullValue: number; rows: number[][]; seedRows: number[][];
  /** The null-free canonical outcome (y shifted to zero and gcd-reduced): the vector the ties diagnostic reads, so
   * refusal does not depend on the tested null (v2 audit 3). */
  yFree: Float64Array }

/** Integer-scale, impose the null exactly, drop constant shifts, and sort rows canonically. */
export function canonicalRegression(input: RegressionInput): CanonicalRegression {
  const n = input.y.values.length;
  const cols = [input.x, ...(input.covariates ?? [])];
  if (cols.some(c => c.values.length !== n) || (input.factors ?? []).some(f => f.length !== n)) throw new Error('columns differ in length');
  const yi = scaleColumn(input.y.values, input.y.decimals), xi = scaleColumn(input.x.values, input.x.decimals);
  // Null in integer units: b0' = b0 * 10^(dy - dx); scale y by 10^kk so that b0' * 10^kk is an integer.
  const nv = input.nullValue ?? 0, d = parseDecimal(typeof nv === 'string' ? nv : String(nv).replace('e+', 'e'));
  const shiftExp = d.exponent + input.y.decimals - input.x.decimals; // b0' = mantissa * 10^shiftExp
  const kk = Math.max(0, -shiftExp), b0int = d.mantissa * 10n ** BigInt(Math.max(0, shiftExp));
  const wBig = yi.map((y, i) => BigInt(y) * 10n ** BigInt(kk) - b0int * BigInt(xi[i]!));
  const wr = reduceByGcd(shiftToZero(wBig.map(v => { if (v > BigInt(Number.MAX_SAFE_INTEGER) || v < -BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('null-imposed outcome exceeds the safe integer range'); return Number(v); })));
  const w = wr.values;
  const zInts = (input.covariates ?? []).map(c => scaleColumn(c.values, c.decimals));
  for (const f of input.factors ?? []) { const levels = [...new Set(f)].sort(); for (const l of levels.slice(1)) zInts.push(f.map(v => (v === l ? 1 : 0))); }
  const core = canonicalRegressionInts(w, xi, zInts);
  const scaleOut = 10 ** (input.x.decimals - input.y.decimals - kk) * wr.g / core.gx;
  const nullValue = typeof nv === 'string' ? Number(nv) : nv;
  // Null-free rows for the default seed (audit 2). Row order is null-independent: rows are sorted by (x, z, w), and
  // within equal (x, z) the order of w = y - b0 x is the order of y.
  const free = canonicalRegressionInts(yi, xi, zInts);
  return { w: core.w, x: core.x, z: core.z, toOriginal: slopeW => nullValue + slopeW * scaleOut, nullValue, rows: core.rows, seedRows: free.rows, yFree: free.w };
}

/** Canonical regression rows from integer columns (null already imposed on w): every column
 * shifted to zero and gcd-reduced, rows sorted lexicographically by (x, z..., w). */
export function canonicalRegressionInts(w: readonly number[], x: readonly number[], z: readonly (readonly number[])[]): { w: Float64Array; x: Float64Array; z: Float64Array[]; rows: number[][]; gx: number } {
  const n = w.length, wv = reduceByGcd(shiftToZero(w)).values, xr = reduceByGcd(shiftToZero(x)), zs = z.map(c => reduceByGcd(shiftToZero(c)).values);
  const rows = Array.from({ length: n }, (_, i) => [xr.values[i]!, ...zs.map(c => c[i]!), wv[i]!]);
  rows.sort((a, b) => { for (let j = 0; j < a.length; j++) if (a[j] !== b[j]) return a[j]! - b[j]!; return 0; });
  return { w: Float64Array.from(rows, r => r[r.length - 1]!), x: Float64Array.from(rows, r => r[0]!),
    z: Array.from({ length: zs.length }, (_, j) => Float64Array.from(rows, r => r[1 + j]!)), rows, gx: xr.g };
}
export function regressionSeed(rows: readonly (readonly number[])[], B: number): string { return contentSeed('ols.wild-hc2-bm@1', rows, B); }

/** OLS slope with HC2 SE and Bell-McCaffrey df (no resampling). */
export function olsHC2(input: RegressionInput): ProcedureResult {
  const id = 'ols.hc2-bm@1', direction = input.direction ?? 'two-sided', alpha = input.alpha ?? 0.05;
  const c = canonicalRegression(input), design = new OlsDesign(c.x, c.z);
  const envelope = { n: c.x.length, k: design.k, bmDf: design.bmDf, maxLeverage: design.maxLeverage };
  if (!design.ok) return refused(id, design.problem, direction, alpha, c.nullValue, envelope);
  const f = design.fit(c.w);
  if (f.se === 0 && f.beta !== 0) return refused(id, 'zero residual variance (near-zero SE)', direction, alpha, c.nullValue, envelope);
  const p = f.se === 0 ? 1 : tPValue(f.t, design.bmDf, direction);
  const q = tQuantileUpper(direction === 'two-sided' ? alpha / 2 : alpha, design.bmDf);
  const lo = direction === 'less' ? -Infinity : f.beta - q * f.se, hi = direction === 'greater' ? Infinity : f.beta + q * f.se;
  return { procedure: id, status: 'ok', estimate: c.toOriginal(f.beta), nullValue: c.nullValue, direction, alpha, p,
    ci: [c.toOriginal(lo), c.toOriginal(hi)], components: { t: f.t, bmDf: design.bmDf, se: Math.abs(c.toOriginal(f.se) - c.nullValue) }, envelope };
}

/**
 * Adjusted or continuous-exposure coefficient: null-imposed (restricted-residual) studentized
 * wild Rademacher bootstrap with HC2 studentization; decision p = max(p_wild, p_t with BM df).
 * The interval inverts the same rule with fixed sign draws.
 */
export function olsWildBootstrap(input: RegressionInput): ProcedureResult {
  const id = 'ols.wild-hc2-bm@2', direction = input.direction ?? 'two-sided', alpha = input.alpha ?? 0.05, B = input.B ?? 9999;
  const c = canonicalRegression(input), design = new OlsDesign(c.x, c.z);
  const envelope = { n: c.x.length, k: design.k, bmDf: design.bmDf, maxLeverage: design.maxLeverage };
  if (!design.ok) return refused(id, design.problem, direction, alpha, c.nullValue, envelope);
  const f = design.fit(c.w);
  if (input.diagnostics !== false) {
    // Influence on the residuals (identical for every null: b0 x lies in the column space); ties on the null-free
    // outcome y, never on the null-imposed y - b0 x (v2 audit 3).
    const dg = diagnose([design.standardizedResiduals(c.w)], [c.yFree], input.diagnostics ?? DEFAULT_DIAGNOSTICS);
    if (dg.refused) return refused(id, `data-validity diagnostic: ${dg.reason}`, direction, alpha, c.nullValue, envelope, c.toOriginal(f.beta));
  }
  if (f.se === 0 && f.beta !== 0) return refused(id, 'zero residual variance (near-zero SE)', direction, alpha, c.nullValue, envelope);
  const seed = input.seed ?? regressionSeed(c.seedRows, B);
  const pT = f.se === 0 ? 1 : tPValue(f.t, design.bmDf, direction);
  const wild = design.wildP(c.w, f.t, direction, seed, B);
  const p = Math.max(pT, wild.p);
  const accept = (delta: number) => {
    const shifted = Float64Array.from(c.w, (v, i) => v - delta * c.x[i]!);
    const ff = design.fit(shifted);
    const pt = ff.se === 0 ? (ff.beta === 0 ? 1 : 0) : tPValue(ff.t, design.bmDf, direction);
    if (pt > alpha) return true;
    return design.wildP(shifted, ff.t, direction, seed, B).p > alpha;
  };
  const step = f.se > 0 ? f.se : 1;
  const lo = input.interval === false ? NaN : direction === 'less' ? -Infinity : invertBoundary(accept, f.beta, step, -1);
  const hi = input.interval === false ? NaN : direction === 'greater' ? Infinity : invertBoundary(accept, f.beta, step, 1);
  return { procedure: id, status: 'ok', estimate: c.toOriginal(f.beta), nullValue: c.nullValue, direction, alpha, p,
    ci: [c.toOriginal(lo), c.toOriginal(hi)],
    components: { t: f.t, bmDf: design.bmDf, pT, pWild: wild.p, wildDraws: wild.draws, wildExhaustive: wild.exhaustive ? 1 : 0 }, envelope };
}


