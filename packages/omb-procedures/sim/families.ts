/**
 * Calibration families (v2). Each family runs the registered @2 procedure exactly as published: the procedure's
 * canonicalisation, null-free default seed, decision rule (directional tests include the bootstrap-t branch where
 * registered) and refusal-only diagnostics, evaluated at every diagnostic level in DIAG_LEVELS. Results are
 * END-TO-END Confirmed rates: procedure rejection and no refusal.
 *
 * Values are integers on a 1e-4 grid ("ties" rounds to a coarser grid that is a multiple of it), exactly as the
 * procedures see integer-scaled data. Regression size cells use a FIXED design per cell (X drawn once from the cell
 * id), so each design is certified at its own Bell-McCaffrey df (audit: no averaging over designs).
 */
import { Rng } from '../src/rng.ts';
import { tPValue } from '../src/special.ts';
import { canonicalTwoGroupInts, twoGroupDecide, twoGroupSeed, pooledT, welchOf } from '../src/twogroup.ts';
import { OlsDesign, olsWildDecide, canonicalRegressionInts, regressionSeed } from '../src/ols.ts';
import { pairedDecide, canonicalContrastInts, pairedSeed, oneSampleT } from '../src/paired.ts';
import { canonicalStrataInts, Cr2Design, cr2Decide, WeightedWelchDesign, weightedWelchDecide, strataSeed, WW_ID, CR2_ID } from '../src/stratified.ts';
import { BmDesign, bmDecide, BM_ID } from '../src/rank.ts';
import { ratioSeed } from '../src/ratio.ts';
import { reduceByGcd, shiftToZero, contentSeed, gcdAll } from '../src/scale.ts';
import { vectorStats, refusalsByLevel, DIAG_LEVELS } from '../src/diagnostics.ts';
import { lawSampler, type AnyLaw, type Law, type Tails, type MixLaw } from './laws.ts';
import { coveringArray } from './covering.ts';
import { TESTS, add, emptyCounts, summarize, type Counts } from './common.ts';

const UNIT = 1e-4;
export type Ties = 'none' | 'mod' | 'heavy' | 'coarse' | 'dp2' | 'dp3';
export const TIE_MULT: Record<Ties, number> = { none: 1, dp3: 10, dp2: 100, mod: 1000, heavy: 5000, coarse: 10000 };
function q(x: number, ties: Ties): number { const m = TIE_MULT[ties]; return m * Math.round(x / (m * UNIT)); }

export interface Cell { family: string; id: string; kind: 'size' | 'power'; group: string; params: Record<string, unknown>; tier?: 'primary' | 'wide'; B?: number }
export type Runner = (rng: Rng, reps: number, B: number) => Counts;
export interface Family { name: string; procedure: string; cells: () => Cell[]; runner: (cell: Cell) => Runner }

const lawOf = (skew: number, tails: Tails, sign: 1 | -1 = 1): Law => ({ skew, tails, sign });
const isMix = (l?: AnyLaw): boolean => !!l && 'kind' in l && l.kind === 'mix';
const tSignOf = (t: number) => (t < 0 ? -1 : 1);
const none = DIAG_LEVELS.map(() => false);

/** Calibration families of the decided configuration: |skew| <= 1, variance ratio <= 9, tails <= t3. */
export const CAL_LAWS: { skew: number; pat: 'same' | 'opposite'; tails: Tails }[] = [
  { skew: 0, pat: 'same', tails: 'normal' }, { skew: 0, pat: 'same', tails: 't3' },
  { skew: 1, pat: 'same', tails: 'normal' }, { skew: 1, pat: 'opposite', tails: 'normal' },
  { skew: 1, pat: 'same', tails: 't3' }, { skew: 1, pat: 'opposite', tails: 't3' },
];

// =============================================================================================
// Two-group
// =============================================================================================
interface TgParams { gen: 'iid' | 'bf-sites' | 'lnshape'; nA: number; nB: number; sdA: number; sdB: number; lawA?: AnyLaw; lawB?: AnyLaw; ties: Ties; d0: number; effect: number; oracle?: boolean }

function tgRunner(p: TgParams): Runner {
  const sa = p.lawA ? lawSampler(p.lawA) : null, sb = p.lawB ? lawSampler(p.lawB) : null, mixture = isMix(p.lawA) || isMix(p.lawB);
  const d0Int = Math.round(p.d0 / UNIT);
  return (rng, reps, B) => {
    const c = emptyCounts(!!p.oracle, mixture), a = new Array<number>(p.nA), b = new Array<number>(p.nB);
    for (let r = 0; r < reps; r++) {
      let anyOut = false;
      if (p.gen === 'iid') {
        for (let i = 0; i < p.nA; i++) { a[i] = q(p.sdA * sa!.draw(rng), p.ties); anyOut ||= !!sa!.lastOutlier; }
        for (let i = 0; i < p.nB; i++) { b[i] = q(p.d0 + p.effect + p.sdB * sb!.draw(rng), p.ties); anyOut ||= !!sb!.lastOutlier; }
      } else if (p.gen === 'bf-sites') {
        const s1 = 3 * rng.normal(), s2 = 3 * rng.normal();
        for (let i = 0; i < p.nA; i++) a[i] = q((i < p.nA / 2 ? s1 : s2) + p.sdA * rng.normal(), p.ties);
        for (let i = 0; i < p.nB; i++) b[i] = q((i < p.nB / 2 ? s1 : s2) + p.d0 + p.sdB * rng.normal(), p.ties);
      } else {
        for (let i = 0; i < p.nA; i++) a[i] = q(Math.exp(rng.normal()) - Math.exp(0.5), p.ties);
        for (let i = 0; i < p.nB; i++) b[i] = q(p.d0 + rng.normal(), p.ties);
      }
      const can = canonicalTwoGroupInts(a, b, d0Int);
      const d = twoGroupDecide(can.v, can.na, () => twoGroupSeed(d0Int === 0 ? can : canonicalTwoGroupInts(a, b, 0), B), B, TESTS);
      const st = [vectorStats(a), vectorStats(b)], diag = refusalsByLevel(st, st);
      let oracle: boolean[] | undefined;
      if (p.oracle) { const o = pooledT(can.v, can.na); oracle = TESTS.map(s => tPValue(o.t, o.df, s.direction) <= s.alpha); }
      add(c, { reject: d.reject, tReject: d.welchReject, refused: d.refused }, diag, tSignOf(welchOf(can.v, can.na).t), oracle, mixture ? !anyOut : undefined);
    }
    return c;
  };
}
const tgCell = (group: string, id: string, kind: Cell['kind'], p: TgParams, tier?: Cell['tier']): Cell => ({ family: 'two-group', id: `tg/${group}/${id}`, kind, group, params: p as unknown as Record<string, unknown>, ...(tier ? { tier } : {}) });
function tgIid(nS: number, k: number, r: number, on: 'small' | 'large', skew: number, pattern: 'same' | 'opposite' | 'small-only' | 'large-only', tails: Tails, ties: Ties, nul: '0' | 'small'): TgParams {
  const nL = Math.round(k * nS), sdS = on === 'small' ? Math.sqrt(r) : 1, sdL = on === 'large' ? Math.sqrt(r) : 1;
  const lawS = lawOf(pattern === 'large-only' ? 0 : skew, tails, 1), lawL = lawOf(pattern === 'small-only' ? 0 : skew, tails, pattern === 'opposite' ? -1 : 1);
  return { gen: 'iid', nA: nS, nB: nL, sdA: sdS, sdB: sdL, lawA: lawS, lawB: lawL, ties, d0: nul === 'small' ? 0.3 : 0, effect: 0 };
}
const tgId = (nS: number, k: number, r: number, on: string, skew: number, pat: string, tails: string, ties: string, nul: string) => `n${nS}-k${k}-r${r}${r > 1 ? on[0] : ''}-s${skew}${skew > 0 ? pat : ''}-${tails}-${ties}-null${nul}`;
export const N_LEVELS = [5, 8, 10, 15, 20, 30, 50];
export const K_LEVELS = [1, 1.5, 2, 3, 4];
const mixLaw = (type: MixLaw['type'], p: number, L: number, sign: 1 | -1 = 1, core: MixLaw['core'] = 'uniform'): MixLaw => ({ kind: 'mix', core, type, p, L, sign });

const twoGroup: Family = {
  name: 'two-group', procedure: 'two-group.welch-perm@2',
  cells: () => {
    const cells: Cell[] = [];
    const ca = coveringArray({ n: N_LEVELS, k: K_LEVELS, r: [1, 4, 9], on: ['small', 'large'] as const, skew: [0, 1, 2], pat: ['same', 'opposite', 'small-only', 'large-only'] as const,
      tails: ['normal', 't5', 't3'] as const, ties: ['none', 'mod', 'heavy', 'coarse'] as const, nul: ['0', 'small'] as const }, 'tg-covering-v2');
    for (const x of ca) cells.push(tgCell('cover', tgId(x.n, x.k, x.r, x.on, x.skew, x.pat, x.tails, x.ties, x.nul), 'size', tgIid(x.n, x.k, x.r, x.on, x.skew, x.pat, x.tails, x.ties, x.nul)));
    for (const n of [5, 50]) for (const k of [1, 4]) for (const on of ['small', 'large'] as const) for (const [skew, tails] of [[1, 'normal'], [0, 't3'], [1, 't3'], [2, 'normal']] as const)
      cells.push(tgCell('corner', tgId(n, k, 9, on, skew, 'opposite', tails, 'heavy', '0'), 'size', tgIid(n, k, 9, on, skew, 'opposite', tails, 'heavy', '0')));
    const bf = (nT: number, nC: number, sT: number, sC: number): TgParams => ({ gen: 'iid', nA: nT, nB: nC, sdA: sT, sdB: sC, lawA: lawOf(0, 'normal'), lawB: lawOf(0, 'normal'), ties: 'dp3', d0: 0, effect: 0 });
    for (const [nT, nC, sT, sC] of [[2, 10, 5, 1], [2, 6, 5, 1], [3, 12, 5, 1], [3, 6, 5, 1], [4, 16, 5, 1], [3, 3, 5, 1], [2, 4, 5, 1], [6, 6, 5, 1], [10, 10, 5, 1], [8, 32, 3, 1], [4, 4, 5, 1], [3, 12, 1, 1], [6, 30, 5, 1], [4, 20, 5, 1]] as const)
      cells.push(tgCell('reprobe', `welch-${nT}v${nC}-sd${sT}v${sC}`, 'size', bf(nT, nC, sT, sC)));
    cells.push(tgCell('reprobe', 'weaknull-shape-4v20-lognormal', 'size', { gen: 'lnshape', nA: 4, nB: 20, sdA: 1, sdB: 1, ties: 'dp3', d0: 0, effect: 0 }));
    cells.push(tgCell('reprobe', 'bf-sites-60v240-sd3v1-unstratified', 'size', { gen: 'bf-sites', nA: 60, nB: 240, sdA: 3, sdB: 1, ties: 'none', d0: 0, effect: 0 }));
    // Audit counterexample (bounded zero-skew mixture, arms 2Z and -Z at 15/60) and its normal-core twin.
    const L = Math.sqrt(3) / 0.01;
    cells.push(tgCell('adv-fixed', 'audit-15v60-r4-zeroskew-uniformcore', 'size', { gen: 'iid', nA: 15, nB: 60, sdA: 2, sdB: 1, lawA: mixLaw('two-zeroskew', 0.01, L, 1), lawB: mixLaw('two-zeroskew', 0.01, L, -1), ties: 'none', d0: 0, effect: 0 }));
    cells.push(tgCell('adv-fixed', 'audit-15v60-r4-zeroskew-normalcore', 'size', { gen: 'iid', nA: 15, nB: 60, sdA: 2, sdB: 1, lawA: mixLaw('two-zeroskew', 0.01, L, 1, 'normal'), lawB: mixLaw('two-zeroskew', 0.01, L, -1, 'normal'), ties: 'none', d0: 0, effect: 0 }));
    // Lattice outcomes.
    for (const name of ['poisson0.5', 'poisson2', 'ordinal5', 'zero-heavy'] as const) for (const [nA, k] of [[10, 1], [20, 2], [50, 1]] as const) for (const [r, sgn] of [[1, 1], [4, -1]] as const)
      cells.push(tgCell('lattice', `${name}-n${nA}-k${k}-r${r}${sgn < 0 ? '-mirror' : ''}`, 'size', { gen: 'iid', nA, nB: nA * k, sdA: Math.sqrt(r), sdB: 1, lawA: { kind: 'lattice', name, sign: 1 }, lawB: { kind: 'lattice', name, sign: sgn as 1 | -1 }, ties: 'none', d0: 0, effect: 0 }));
    const live = (nA: number, effect: number, ties: Ties, d0 = 0): TgParams => ({ gen: 'iid', nA, nB: nA, sdA: 1, sdB: 1, lawA: lawOf(0, 'normal'), lawB: lawOf(0, 'normal'), ties, d0, effect, oracle: true });
    cells.push(tgCell('live', 'n20v20-d0.8-dp2', 'power', live(20, 0.8, 'dp2')));
    cells.push(tgCell('live', 'n20v20-d0.8-dp3', 'power', live(20, 0.8, 'dp3')));
    cells.push(tgCell('live', 'n40v40-d0.8-dp2', 'power', live(40, 0.8, 'dp2')));
    cells.push(tgCell('live', 'n10v10-d0.8-dp2', 'power', live(10, 0.8, 'dp2')));
    cells.push(tgCell('live', 'n20v20-refute-at-mei0.5', 'size', { ...live(20, 0, 'dp2', 0.5), oracle: false }));
    // Envelope map over the calibration families (|skew| <= 1, ratio <= 9 on either arm, tails normal / t3).
    for (const n of N_LEVELS) for (const k of K_LEVELS) for (const law of CAL_LAWS) for (const [r, on] of [[1, 'small'], [9, 'small'], [9, 'large']] as const)
      cells.push(tgCell('env', tgId(n, k, r, on, law.skew, law.pat, law.tails, 'none', '0'), 'size', tgIid(n, k, r, on, law.skew, law.pat, law.tails, 'none', '0')));
    // Directional envelope beyond n = 50 (worst calibration laws).
    for (const n of [75, 100]) for (const k of [1, 2]) for (const [r, pat] of [[9, 'opposite'], [9, 'same'], [1, 'opposite']] as const)
      cells.push(tgCell('env-large', tgId(n, k, r, 'small', 1, pat, 'normal', 'none', '0'), 'size', tgIid(n, k, r, 'small', 1, pat, 'normal', 'none', '0')));
    return cells;
  },
  runner: cell => tgRunner(cell.params as unknown as TgParams),
};

// =============================================================================================
// Regression: fixed design per size cell.
// =============================================================================================
type XLaw = 'normal' | 'uniform' | 'lognormal' | 'binary50' | 'binary20';
type Het = 'none' | 'abs4' | 'abs9' | 'lin4' | 'lin9' | 'grp9' | 'probe-xe' | 'probe-abs' | 'probe-lnx';
export interface RegParams { gen: 'std' | 'fl-site' | 'live-adjusted' | 'live-p1'; n: number; xLaw: XLaw; cov: 'none' | 'ass' | 'six'; het: Het; law: AnyLaw; ties: Ties; beta0: number; effect: number; oracle?: boolean; design?: string }

const expit = (x: number) => 1 / (1 + Math.exp(-x));
function xDraw(rng: Rng, law: XLaw, shift: number): number {
  switch (law) {
    case 'normal': return rng.normal() + shift;
    case 'uniform': return (rng.uniform() - 0.5) * Math.sqrt(12) + shift;
    case 'lognormal': return Math.exp(rng.normal() + 0.5 * shift);
    case 'binary50': return rng.uniform() < expit(shift) ? 1 : 0;
    case 'binary20': return rng.uniform() < expit(Math.log(0.25) + shift) ? 1 : 0;
  }
}
const X_MOMENTS: Record<XLaw, [number, number]> = { normal: [0, 1], uniform: [0, 1], lognormal: [Math.exp(0.5), Math.sqrt((Math.exp(1) - 1) * Math.exp(1))], binary50: [0.5, 0.5], binary20: [0.2, 0.4] };
function Phi(x: number): number { const t = 1 / (1 + 0.3275911 * Math.abs(x / Math.SQRT2)), y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x / 2); return 0.5 * (1 + (x >= 0 ? y : -y)); }

interface Design { x: number[]; xInt: number[]; zInts: number[][]; covMean: number[]; sd: number[] }
function drawDesign(rng: Rng, p: RegParams): Design {
  const n = p.n, x: number[] = [], age: number[] = [], sex: number[] = [], site: number[] = [], z: number[][] = [];
  if (p.cov === 'ass') for (let i = 0; i < n; i++) { age.push(30 + rng.int(40)); sex.push(rng.uniform() < 0.5 ? 1 : 0); site.push(rng.int(3)); }
  if (p.cov === 'six') for (let j = 0; j < 6; j++) z.push(Array.from({ length: n }, () => rng.normal()));
  for (let i = 0; i < n; i++) {
    const conf = p.cov === 'ass' ? (age[i]! - 50) / 11.5 * 0.5 : p.cov === 'six' ? 0.5 * z[0]![i]! : 0;
    let xv = xDraw(rng, p.xLaw, conf); if (!p.xLaw.startsWith('binary')) xv = Math.round(xv * 100) / 100; x.push(xv);
  }
  const [mx, sx] = X_MOMENTS[p.xLaw], med = [...x].sort((a, b) => a - b)[Math.floor(n / 2)]!;
  const sd = x.map(xv => {
    const xs = (xv - mx) / sx;
    if (p.xLaw.startsWith('binary') && p.het !== 'none' && !p.het.startsWith('probe')) { const r = p.het.endsWith('4') ? 4 : 9, onOne = !p.het.startsWith('lin'); return (xv === 1) === onOne ? Math.sqrt(r) : 1; }
    switch (p.het) {
      case 'abs4': return 1 + Math.min(1, Math.abs(xs) / 2);
      case 'abs9': return 1 + 2 * Math.min(1, Math.abs(xs) / 2);
      case 'lin4': return 1 + Phi(xs);
      case 'lin9': return 1 + 2 * Phi(xs);
      case 'grp9': return xv > med ? 3 : 1;
      case 'probe-xe': return Math.abs(xv);
      case 'probe-abs': return 0.2 + Math.abs(xv);
      case 'probe-lnx': return 0.1 + Math.abs(xv - Math.exp(0.5));
      default: return 1;
    }
  });
  const covMean = x.map((_, i) => p.cov === 'ass' ? 0.05 * (age[i]! - 50) + 0.3 * sex[i]! + [-1, 0, 1][site[i]!]! : p.cov === 'six' ? z.reduce((s, col) => s + 0.3 * col[i]!, 0) : 0);
  const binaryX = p.xLaw.startsWith('binary');
  const xInt = binaryX ? x : x.map(v => Math.round(v * 100));
  const zInts = p.cov === 'ass' ? [age, sex, site.map(v => (v === 1 ? 1 : 0)), site.map(v => (v === 2 ? 1 : 0))] : p.cov === 'six' ? z.map(col => col.map(v => Math.round(v * 100))) : [];
  return { x, xInt, zInts, covMean, sd };
}

/**
 * The fixed design of a regression size cell. It is identified by (n, x law, covariates, design label) only, so every
 * law and heteroskedasticity cell of one design runs on the SAME X and has the same Bell-McCaffrey df (v2 audit 1:
 * seeding by cell id gave each law cell its own X). Drawn conditional on being estimable (full rank, no leverage-1 unit).
 */
export function fixedDesign(p: RegParams): ReturnType<typeof drawDesign> {
  for (let a = 0; a < 1000; a++) {
    const d = drawDesign(new Rng(`reg-design|n${p.n}|${p.xLaw}|${p.cov}|${p.design}${a ? `|redraw${a}` : ''}`), p);
    const can = canonicalRegressionInts(d.xInt, d.xInt, d.zInts);
    if (new OlsDesign(can.x, can.z).ok) return d;
  }
  throw new Error(`no estimable fixed design for n${p.n}/${p.xLaw}/${p.cov}`);
}

function regRunner(p: RegParams): Runner {
  const s = lawSampler(p.law), mixture = isMix(p.law);
  return (rng, reps, B) => {
    const c = emptyCounts(!!p.oracle, mixture), dfs: number[] = [];
    const fixed = p.gen === 'std' && !p.oracle ? fixedDesign(p) : null;
    for (let rep = 0; rep < reps; rep++) {
      const n = p.n;
      let yInt: number[], xInt: number[], zInts: number[][], b0PerInt = 0, anyOut = false;
      if (p.gen === 'live-adjusted') {
        const age: number[] = [], sex: number[] = [], site: number[] = [], x: number[] = [], y: number[] = [];
        for (let i = 0; i < n; i++) { age.push(30 + rng.int(40)); sex.push(rng.uniform() < 0.5 ? 1 : 0); site.push(rng.int(3)); }
        for (let i = 0; i < n; i++) { x.push(rng.uniform() < expit((age[i]! - 50) / 6) ? 1 : 0); y.push(5 + p.effect * x[i]! + 0.05 * (age[i]! - 50) + [-1, 0, 1][site[i]!]! + rng.normal()); }
        xInt = x; zInts = [age, sex, site.map(v => (v === 1 ? 1 : 0)), site.map(v => (v === 2 ? 1 : 0))]; yInt = y.map(v => q(v, 'dp3'));
      } else if (p.gen === 'live-p1') {
        const cohort: number[] = [], x: number[] = [], y: number[] = [];
        for (let i = 0; i < n; i++) { const co = 1 + rng.int(5); cohort.push(co); x.push(rng.uniform() < [0, 0.6, 0.7, 0.75, 0.8, 0.85][co]! ? 1 : 0); y.push(8 + 0.3 * co + p.effect * x[i]! + rng.normal()); }
        xInt = x; zInts = [2, 3, 4, 5].map(l => cohort.map(v => (v === l ? 1 : 0))); yInt = y.map(v => q(v, 'none'));
      } else if (p.gen === 'fl-site') {
        const site = Array.from({ length: n }, (_, i) => i % 2), x = Array.from({ length: n }, () => rng.normal());
        xInt = x.map(v => Math.round(v * 1e6)); zInts = [site]; yInt = x.map((xv, i) => q(3 * site[i]! + Math.abs(xv) * rng.normal(), 'dp3'));
      } else {
        const d = fixed ?? drawDesign(rng, p);
        xInt = d.xInt; zInts = d.zInts;
        yInt = d.x.map((xv, i) => { const e = s.draw(rng); anyOut ||= !!s.lastOutlier; return q(p.beta0 * xv + p.effect * xv + d.covMean[i]! + d.sd[i]! * e, p.ties); });
        b0PerInt = p.xLaw.startsWith('binary') ? p.beta0 / UNIT : p.beta0 / UNIT / 100;
      }
      const w = yInt.map((v, i) => v - Math.round(b0PerInt * xInt[i]!));
      const can = canonicalRegressionInts(w, xInt, zInts), design = new OlsDesign(can.x, can.z);
      if (!design.ok) { add(c, { reject: TESTS.map(() => false), tReject: TESTS.map(() => false), refused: true }, none, 1, p.oracle ? TESTS.map(() => false) : undefined, mixture ? !anyOut : undefined); continue; }
      dfs.push(design.bmDf);
      const seedRows = () => regressionSeed(b0PerInt === 0 ? can.rows : canonicalRegressionInts(yInt, xInt, zInts).rows, B);
      const d = olsWildDecide(design, can.w, seedRows, B, TESTS), f = design.fit(can.w);
      // Ties on the null-free outcome, as in the procedure (v2 audit 3).
      const diag = refusalsByLevel([vectorStats(design.standardizedResiduals(can.w))], [vectorStats(yInt)]);
      let oracle: boolean[] | undefined;
      if (p.oracle) {
        const e = design.residuals(can.w); let ss = 0, rr = 0; for (let i = 0; i < e.length; i++) { ss += e[i]! * e[i]!; rr += design.r[i]! * design.r[i]!; }
        const df = can.w.length - design.k, se = Math.sqrt(ss / df * rr), t = se > 0 ? f.beta / se : 0;
        oracle = TESTS.map(sp => tPValue(t, df, sp.direction) <= sp.alpha);
      }
      add(c, { reject: d.reject, tReject: d.tReject, refused: d.refused }, diag, tSignOf(f.t), oracle, mixture ? !anyOut : undefined);
    }
    const sm = summarize(dfs.length ? dfs : [NaN]);
    c.observed = { bmDfMin: sm.min, bmDfP05: sm.p05, bmDfMedian: sm.median, fixedDesign: fixed ? 1 : 0 };
    return c;
  };
}
const regCell = (group: string, id: string, kind: Cell['kind'], p: RegParams, tier?: Cell['tier']): Cell => ({ family: 'regression', id: `reg/${group}/${id}`, kind, group, params: p as unknown as Record<string, unknown>, ...(tier ? { tier } : {}) });
const regStd = (n: number, xLaw: XLaw, cov: RegParams['cov'], het: Het, law: AnyLaw, ties: Ties, nul: '0' | 'small', design = 'd1'): RegParams =>
  ({ gen: 'std', n, xLaw, cov, het, law, ties, beta0: nul === 'small' ? 0.3 : 0, effect: 0, design });
const regId = (n: number, xLaw: string, cov: string, het: string, lawLabel: string, ties: string, nul: string, design = 'd1') => `n${n}-x${xLaw}-c${cov}-h${het}-${lawLabel}-${ties}-null${nul}-${design}`;
export const REG_N = [10, 15, 20, 30, 50, 100, 200];

const regression: Family = {
  name: 'regression', procedure: 'ols.wild-hc2-bm@2',
  cells: () => {
    const cells: Cell[] = [];
    const ca = coveringArray({ n: REG_N, xLaw: ['normal', 'uniform', 'lognormal', 'binary50', 'binary20'] as const, cov: ['none', 'ass', 'six'] as const,
      het: ['none', 'abs4', 'abs9', 'lin4', 'lin9', 'grp9'] as const, skew: [0, 1, 2], tails: ['normal', 't5', 't3'] as const, ties: ['none', 'mod', 'heavy'] as const, nul: ['0', 'small'] as const }, 'reg-covering-v2');
    for (const x of ca) cells.push(regCell('cover', regId(x.n, x.xLaw, x.cov, x.het, `s${x.skew}-${x.tails}`, x.ties, x.nul), 'size', regStd(x.n, x.xLaw, x.cov, x.het, lawOf(x.skew, x.tails), x.ties, x.nul)));
    for (const n of [8, 12, 30, 100]) cells.push(regCell('reprobe', `cont-hetero-xe-n${n}`, 'size', regStd(n, 'normal', 'none', 'probe-xe', lawOf(0, 'normal'), 'dp3', '0')));
    cells.push(regCell('reprobe', 'cont-hetero-abs-n30', 'size', regStd(30, 'normal', 'none', 'probe-abs', lawOf(0, 'normal'), 'dp3', '0')));
    cells.push(regCell('reprobe', 'cont-hetero-lognormal-x-n30', 'size', regStd(30, 'lognormal', 'none', 'probe-lnx', lawOf(0, 'normal'), 'dp3', '0')));
    for (const n of [30, 60]) cells.push(regCell('reprobe', `fl-stable-site-n${n}`, 'size', { ...regStd(n, 'normal', 'none', 'none', lawOf(0, 'normal'), 'dp3', '0'), gen: 'fl-site' }));
    cells.push(regCell('reprobe', 'cont-control-n30', 'size', regStd(30, 'normal', 'none', 'none', lawOf(0, 'normal'), 'dp3', '0')));
    for (const name of ['poisson0.5', 'ordinal5', 'zero-heavy'] as const) for (const [n, xLaw] of [[30, 'normal'], [80, 'binary50']] as const)
      cells.push(regCell('lattice', `${name}-n${n}-x${xLaw}`, 'size', regStd(n, xLaw, xLaw === 'binary50' ? 'ass' : 'none', 'none', { kind: 'lattice', name, sign: 1 }, 'none', '0')));
    cells.push(regCell('live', 'adjusted-age-sex-site-n80-b0.6', 'power', { ...regStd(80, 'binary50', 'ass', 'none', lawOf(0, 'normal'), 'dp3', '0'), gen: 'live-adjusted', effect: 0.6, oracle: true }));
    cells.push(regCell('live', 'adjusted-age-sex-site-n200-b0.6', 'power', { ...regStd(200, 'binary50', 'ass', 'none', lawOf(0, 'normal'), 'dp3', '0'), gen: 'live-adjusted', effect: 0.6, oracle: true }));
    cells.push(regCell('live', 'adjusted-age-sex-site-n80-null', 'size', { ...regStd(80, 'binary50', 'ass', 'none', lawOf(0, 'normal'), 'dp3', '0'), gen: 'live-adjusted', effect: 0 }));
    cells.push(regCell('live', 'p1-cohort-fe-n400-b0.3', 'power', { ...regStd(400, 'binary50', 'none', 'none', lawOf(0, 'normal'), 'none', '0'), gen: 'live-p1', effect: 0.3, oracle: true }));
    cells.push(regCell('live', 'cont-normal-n30-b0.5', 'power', { ...regStd(30, 'normal', 'none', 'none', lawOf(0, 'normal'), 'dp3', '0'), effect: 0.5, oracle: true }));
    // Envelope: fixed designs x calibration laws (|skew| <= 1, ratio 9 on either side, t3). Two designs per (type, n);
    // binary exposures (the hardest designs) get eight at n = 20-50, to resolve the BM-df envelope near its threshold
    // (v2 audit 1).
    const envDesigns = (n: number, xLaw: string) => (xLaw.startsWith('binary') && n >= 20 && n <= 50 ? ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8'] : n === 40 ? [] : ['d1', 'd2']);
    for (const n of [10, 20, 30, 40, 50, 100, 200]) for (const [xLaw, cov] of [['normal', 'none'], ['lognormal', 'none'], ['binary50', 'ass'], ['binary20', 'none']] as const)
      for (const design of envDesigns(n, xLaw)) for (const skew of [0, 1]) for (const tails of ['normal', 't3'] as const) for (const het of ['none', 'abs9', 'lin9'] as const)
        cells.push(regCell('env', regId(n, xLaw, cov, het, `s${skew}-${tails}`, 'none', '0', design), 'size', regStd(n, xLaw, cov, het, lawOf(skew, tails), 'none', '0', design)));
    return cells;
  },
  runner: cell => regRunner(cell.params as unknown as RegParams),
};

// =============================================================================================
// Paired
// =============================================================================================
interface PairParams { gen: 'std' | 'shape-pairs' | 'live-prepost' | 'live-xo3'; n: number; law: AnyLaw; r: number; ties: Ties; d0: number; effect: number; oracle?: boolean }

function pairRunner(p: PairParams): Runner {
  const s = lawSampler(p.law), d0Int = Math.round(p.d0 / UNIT), mixture = isMix(p.law);
  return (rng, reps, B) => {
    const c = emptyCounts(!!p.oracle, mixture), con = new Array<number>(p.n), free = new Array<number>(p.n);
    for (let rep = 0; rep < reps; rep++) {
      let anyOut = false;
      for (let i = 0; i < p.n; i++) {
        let raw: number, mult = 1;
        if (p.gen === 'shape-pairs') {
          const b = 3 * rng.normal(), ctl = b + 0.3 * rng.normal(), trt = b + Math.exp(1.2 * rng.normal()) - Math.exp(0.72); raw = q(trt, p.ties) - q(ctl, p.ties);
        } else if (p.gen === 'live-prepost' || p.gen === 'live-xo3') {
          const b = 3 * rng.normal(), off = p.gen === 'live-xo3' ? rng.int(3) : 0; let on = 0, offV = 0;
          for (let v = 0; v < 3; v++) { const y = q(50 + b + (v === off ? 0 : p.effect) + rng.normal(), 'dp2'); if (v === off) offV = y; else on += y; }
          raw = on - 2 * offV; mult = 2;
        } else {
          const sd = i % 2 === 0 ? 1 : Math.sqrt(p.r), base = 50 + 3 * rng.normal(), e = s.draw(rng); anyOut ||= !!s.lastOutlier;
          raw = q(base + p.d0 + p.effect + sd * e, p.ties) - q(base, p.ties);
        }
        free[i] = raw; con[i] = raw - mult * d0Int;
      }
      const cc = canonicalContrastInts(con);
      const d = pairedDecide(cc, () => pairedSeed(d0Int === 0 ? cc : canonicalContrastInts(free), B), B, TESTS);
      const st = vectorStats(cc), diag = refusalsByLevel([st], [st]);
      add(c, d, diag, tSignOf(oneSampleT(cc).t), p.oracle ? d.tReject : undefined, mixture ? !anyOut : undefined);
    }
    return c;
  };
}
const pairCell = (group: string, id: string, kind: Cell['kind'], p: PairParams): Cell => ({ family: 'paired', id: `pair/${group}/${id}`, kind, group, params: p as unknown as Record<string, unknown> });
const pairStd = (n: number, skew: number, tails: Tails, r: number, ties: Ties, nul: '0' | 'small'): PairParams => ({ gen: 'std', n, law: lawOf(skew, tails), r, ties, d0: nul === 'small' ? 0.3 : 0, effect: 0 });

const paired: Family = {
  name: 'paired', procedure: 'paired.signflip-t@2',
  cells: () => {
    const cells: Cell[] = [];
    const ca = coveringArray({ n: [6, 8, 10, 15, 20, 30, 50], skew: [0, 1, 2], tails: ['normal', 't5', 't3'] as const, r: [1, 4, 9], ties: ['none', 'mod', 'heavy', 'coarse'] as const, nul: ['0', 'small'] as const }, 'pair-covering-v2');
    for (const x of ca) cells.push(pairCell('cover', `n${x.n}-s${x.skew}-${x.tails}-r${x.r}-${x.ties}-null${x.nul}`, 'size', pairStd(x.n, x.skew, x.tails, x.r, x.ties, x.nul)));
    cells.push(pairCell('reprobe', 'shape-pairs-10-lognormal1.2', 'size', { gen: 'shape-pairs', n: 10, law: lawOf(0, 'normal'), r: 1, ties: 'dp3', d0: 0, effect: 0 }));
    for (const name of ['poisson0.5', 'ordinal5', 'zero-heavy'] as const) for (const n of [10, 30])
      cells.push(pairCell('lattice', `${name}-n${n}`, 'size', { gen: 'std', n, law: { kind: 'lattice', name, sign: 1 }, r: 1, ties: 'none', d0: 0, effect: 0 }));
    cells.push(pairCell('live', 'prepost-10x3-effect1.5', 'power', { gen: 'live-prepost', n: 10, law: lawOf(0, 'normal'), r: 1, ties: 'dp2', d0: 0, effect: 1.5, oracle: true }));
    cells.push(pairCell('live', 'prepost-10x3-effect1.0', 'power', { gen: 'live-prepost', n: 10, law: lawOf(0, 'normal'), r: 1, ties: 'dp2', d0: 0, effect: 1.0, oracle: true }));
    cells.push(pairCell('live', 'xo3-randomized-off-10x3-effect1.5', 'power', { gen: 'live-xo3', n: 10, law: lawOf(0, 'normal'), r: 1, ties: 'dp2', d0: 0, effect: 1.5, oracle: true }));
    cells.push(pairCell('live', 'prepost-10x3-null', 'size', { gen: 'live-prepost', n: 10, law: lawOf(0, 'normal'), r: 1, ties: 'dp2', d0: 0, effect: 0 }));
    for (const n of [6, 8, 10, 15, 20, 30, 50, 100]) for (const skew of [0, 1]) for (const tails of ['normal', 't3'] as const) for (const r of [1, 9])
      cells.push(pairCell('env', `n${n}-s${skew}-${tails}-r${r}-none-null0`, 'size', pairStd(n, skew, tails, r, 'none', '0')));
    return cells;
  },
  runner: cell => pairRunner(cell.params as unknown as PairParams),
};

// =============================================================================================
// Stratified (b): CR2 + relabel (many small strata, repeated measures)
// =============================================================================================
interface Cr2Params { gen: 'std' | 'ar1-blocked' | 'nonzero-skew' | 'tie-counts'; S: number; m: number; kT: number; sdT: number; sdC: number; law: AnyLaw; ties: Ties; d0: number; effect: number; scale?: number; pd?: number; oracle?: boolean }

function cr2Runner(p: Cr2Params): Runner {
  const s = lawSampler(p.law), d0Int = Math.round(p.d0 / UNIT), mixture = isMix(p.law);
  return (rng, reps, B) => {
    const c = emptyCounts(!!p.oracle, mixture);
    for (let rep = 0; rep < reps; rep++) {
      const strata: { a: number[]; b: number[] }[] = []; let anyOut = false;
      for (let k = 0; k < p.S; k++) {
        const a: number[] = [], b: number[] = [], base = 2 * rng.normal();
        if (p.gen === 'ar1-blocked') { let e = rng.normal(); for (let j = 0; j < 6; j++) { if (j) e = 0.9 * e + Math.sqrt(1 - 0.81) * rng.normal(); (j < 3 ? a : b).push(q(base + e, p.ties)); } }
        else if (p.gen === 'tie-counts') { for (let j = 0; j < p.m; j++) (j < p.kT ? b : a).push(Math.round((p.scale! + (rng.uniform() < p.pd! ? 1 : 0)) / UNIT)); }
        else if (p.gen === 'nonzero-skew') { for (let j = 0; j < p.m; j++) { const t = j < p.kT ? 1 : 0; (t ? b : a).push(q(base + Math.exp(rng.normal()) + 0.5 * t, p.ties)); } }
        else { for (let j = 0; j < p.m; j++) { const t = j < p.kT, e = s.draw(rng); anyOut ||= !!s.lastOutlier; (t ? b : a).push(q(base + (t ? p.d0 + p.effect : 0) + (t ? p.sdT : p.sdC) * e, p.ties)); } }
        strata.push({ a, b });
      }
      const can = canonicalStrataInts(strata, d0Int), d = new Cr2Design(can.data);
      const r = cr2Decide(d, () => strataSeed(CR2_ID, can.seedData, B), B, TESTS);
      const diag = d.ok ? refusalsByLevel([vectorStats(d.standardizedResiduals())], [vectorStats(d.strata.flatMap(st => Array.from(st.v.slice(0, st.na)))), vectorStats(d.strata.flatMap(st => Array.from(st.v.slice(st.na))))]) : none;
      let oracle: boolean[] | undefined;
      if (p.oracle && d.ok) {
        let ssw = 0, n = 0; for (const st of d.strata) { let sm = 0; for (const v of st.v) sm += v; const mu = sm / st.v.length; for (const v of st.v) ssw += (v - mu) ** 2; n += st.v.length; }
        const fit = d.stat(), df = n - d.strata.length - 1, s2 = (ssw - fit.beta * fit.beta * d.sxx) / df, se = Math.sqrt(Math.max(0, s2) / d.sxx);
        const t = se > 0 ? fit.beta / se : 0; oracle = TESTS.map(sp => tPValue(t, df, sp.direction) <= sp.alpha);
      }
      add(c, r, diag, tSignOf(d.ok ? d.stat().t : 0), oracle, mixture ? !anyOut : undefined);
    }
    return c;
  };
}
const cr2Cell = (group: string, id: string, kind: Cell['kind'], p: Cr2Params): Cell => ({ family: 'cr2', id: `cr2/${group}/${id}`, kind, group, params: p as unknown as Record<string, unknown> });
const cr2Std = (S: number, m: number, kT: number, r: number, law: AnyLaw, ties: Ties, nul: '0' | 'small'): Cr2Params => ({ gen: 'std', S, m, kT, sdT: Math.sqrt(r), sdC: 1, law, ties, d0: nul === 'small' ? 0.3 : 0, effect: 0 });
const CR2_DESIGNS: readonly [number, number][] = [[2, 1], [3, 1], [4, 1], [6, 1], [4, 2], [6, 3]];

const cr2: Family = {
  name: 'cr2', procedure: 'stratified.cr2-bm-relabel@2',
  cells: () => {
    const cells: Cell[] = [];
    const ca = coveringArray({ S: [5, 8, 10, 15, 20, 40], design: CR2_DESIGNS.map(d => `${d[0]}:${d[1]}`), r: [1, 4, 9], skew: [0, 1, 2], tails: ['normal', 't5', 't3'] as const, ties: ['none', 'mod', 'heavy'] as const, nul: ['0', 'small'] as const }, 'cr2-covering-v2');
    for (const x of ca) { const [m, kT] = x.design.split(':').map(Number) as [number, number]; cells.push(cr2Cell('cover', `S${x.S}-m${m}k${kT}-r${x.r}-s${x.skew}-${x.tails}-${x.ties}-null${x.nul}`, 'size', cr2Std(x.S, m, kT, x.r, lawOf(x.skew, x.tails), x.ties, x.nul))); }
    const het = (S: number, m: number, sT: number) => cr2Std(S, m, 1, sT * sT, lawOf(0, 'normal'), 'dp3', '0');
    cells.push(cr2Cell('reprobe', 'rm-hetero-12x1:5-sd5v1', 'size', het(12, 6, 5)));
    cells.push(cr2Cell('reprobe', 'rm-hetero-30x1:3-sd3v1', 'size', het(30, 4, 3)));
    cells.push(cr2Cell('reprobe', 'rm-hetero-5x1:3-sd5v1', 'size', het(5, 4, 5)));
    cells.push(cr2Cell('reprobe', 'dodgeA-40x1:3-sd5v1', 'size', het(40, 4, 5)));
    cells.push(cr2Cell('reprobe', 'rm-hetero-reversed-5x1:3-sd1v5', 'size', { ...het(5, 4, 1), sdC: 5 }));
    cells.push(cr2Cell('reprobe', 'sharp-control-12x1:5-lognormal', 'size', cr2Std(12, 6, 1, 1, lawOf(6.18, 'normal'), 'dp3', '0')));
    cells.push(cr2Cell('reprobe', 'blocked-ar1-10x6', 'size', { ...cr2Std(10, 6, 3, 1, lawOf(0, 'normal'), 'dp3', '0'), gen: 'ar1-blocked' }));
    for (const [m, kT] of [[3, 1], [5, 1]] as const) cells.push(cr2Cell('reprobe', `nonzero-skew-10x1:${m - 1}-null0.5`, 'size', { ...cr2Std(10, m, kT, 1, lawOf(0, 'normal'), 'dp3', '0'), gen: 'nonzero-skew', d0: 0.5 }));
    for (const [S, pd, scale] of [[5, 0.1, 1e6], [8, 0.1, 1e6], [5, 0.2, 1e6], [5, 0.1, 1e9], [5, 0.05, 1234567.89], [20, 0.05, 1e6]] as const)
      cells.push(cr2Cell('reprobe', `tie-counts-${S}x1:3-pd${pd}-scale${scale}`, 'size', { ...cr2Std(S, 4, 1, 1, lawOf(0, 'normal'), 'none', '0'), gen: 'tie-counts', scale, pd }));
    cells.push(cr2Cell('live', 'repeated-10x3-effect1.5', 'power', { ...cr2Std(10, 3, 2, 1, lawOf(0, 'normal'), 'dp2', '0'), effect: 1.5, oracle: true }));
    cells.push(cr2Cell('live', 'repeated-10x3-effect1.0', 'power', { ...cr2Std(10, 3, 2, 1, lawOf(0, 'normal'), 'dp2', '0'), effect: 1.0, oracle: true }));
    for (const S of [5, 10, 20, 40]) for (const [m, kT] of [[2, 1], [4, 1], [6, 1], [6, 3]] as const) for (const skew of [0, 1]) for (const tails of ['normal', 't3'] as const) for (const r of [1, 9])
      cells.push(cr2Cell('env', `S${S}-m${m}k${kT}-r${r}-s${skew}-${tails}-none-null0`, 'size', cr2Std(S, m, kT, r, lawOf(skew, tails), 'none', '0')));
    return cells;
  },
  runner: cell => cr2Runner(cell.params as unknown as Cr2Params),
};

// =============================================================================================
// Stratified (a): weighted Welch
// =============================================================================================
interface WwParams { gen: 'std' | 'bf-strat' | 'live-p1'; S: number; nA: number; nB: number; sdA: number; sdB: number; lawA: AnyLaw; lawB: AnyLaw; ties: Ties; d0: number; effect: number; oracle?: boolean; N?: number }

function wwRunner(p: WwParams): Runner {
  const sa = lawSampler(p.lawA), sb = lawSampler(p.lawB), d0Int = Math.round(p.d0 / UNIT), mixture = isMix(p.lawA) || isMix(p.lawB);
  return (rng, reps, B) => {
    const c = emptyCounts(!!p.oracle, mixture);
    for (let rep = 0; rep < reps; rep++) {
      const strata: { a: number[]; b: number[] }[] = []; let anyOut = false;
      if (p.gen === 'live-p1') {
        const st = Array.from({ length: 5 }, () => ({ a: [] as number[], b: [] as number[] }));
        for (let i = 0; i < p.N!; i++) { const co = 1 + rng.int(5), x = rng.uniform() < [0, 0.6, 0.7, 0.75, 0.8, 0.85][co]!; (x ? st[co - 1]!.b : st[co - 1]!.a).push(q(8 + 0.3 * co + (x ? p.effect : 0) + rng.normal(), 'none')); }
        if (st.some(s => s.a.length < 2 || s.b.length < 2)) { add(c, { reject: TESTS.map(() => false), tReject: TESTS.map(() => false), refused: true }, none, 1, p.oracle ? TESTS.map(() => false) : undefined); continue; }
        strata.push(...st);
      } else {
        for (let k = 0; k < p.S; k++) {
          const shift = 3 * rng.normal(), a: number[] = [], b: number[] = [];
          for (let i = 0; i < p.nA; i++) { a.push(q(shift + p.sdA * sa.draw(rng), p.ties)); anyOut ||= !!sa.lastOutlier; }
          for (let i = 0; i < p.nB; i++) { b.push(q(shift + p.d0 + p.effect + p.sdB * sb.draw(rng), p.ties)); anyOut ||= !!sb.lastOutlier; }
          strata.push({ a, b });
        }
      }
      const can = canonicalStrataInts(strata, d0Int), d = new WeightedWelchDesign(can.data, can.weights);
      const r = weightedWelchDecide(d, () => strataSeed(WW_ID, can.seedData, B, d.w), B, TESTS);
      const diag = refusalsByLevel(can.data.flatMap(st => [vectorStats(st.v.slice(0, st.na)), vectorStats(st.v.slice(st.na))]),
        [vectorStats(can.data.flatMap(st => Array.from(st.v.slice(0, st.na)))), vectorStats(can.data.flatMap(st => Array.from(st.v.slice(st.na))))]);
      let oracle: boolean[] | undefined;
      if (p.oracle) {
        const cd = new Cr2Design(can.data);
        let ssw = 0, n = 0; for (const st of cd.strata) { let sm = 0; for (const v of st.v) sm += v; const mu = sm / st.v.length; for (const v of st.v) ssw += (v - mu) ** 2; n += st.v.length; }
        const fit = cd.stat(), df = n - cd.strata.length - 1, se = Math.sqrt(Math.max(0, (ssw - fit.beta ** 2 * cd.sxx) / df) / cd.sxx), t = se > 0 ? fit.beta / se : 0;
        oracle = TESTS.map(sp => tPValue(t, df, sp.direction) <= sp.alpha);
      }
      add(c, r, diag, tSignOf(d.stat().t), oracle, mixture ? !anyOut : undefined);
    }
    return c;
  };
}
const wwCell = (group: string, id: string, kind: Cell['kind'], p: WwParams): Cell => ({ family: 'weighted-welch', id: `ww/${group}/${id}`, kind, group, params: p as unknown as Record<string, unknown> });

const weightedWelch: Family = {
  name: 'weighted-welch', procedure: 'stratified.weighted-welch@2',
  cells: () => {
    const cells: Cell[] = [];
    const ca = coveringArray({ S: [2, 3, 4], n: [5, 10, 20, 30], k: [1, 2, 4], r: [1, 4, 9], on: ['small', 'large'] as const, skew: [0, 1, 2], pat: ['same', 'opposite'] as const, tails: ['normal', 't5', 't3'] as const, ties: ['none', 'mod', 'heavy'] as const, nul: ['0', 'small'] as const }, 'ww-covering-v2');
    for (const x of ca) {
      const nB = Math.round(x.k * x.n), sdA = x.on === 'small' ? Math.sqrt(x.r) : 1, sdB = x.on === 'large' ? Math.sqrt(x.r) : 1;
      cells.push(wwCell('cover', `S${x.S}-n${x.n}-k${x.k}-r${x.r}${x.on[0]}-s${x.skew}${x.pat}-${x.tails}-${x.ties}-null${x.nul}`, 'size',
        { gen: 'std', S: x.S, nA: x.n, nB, sdA, sdB, lawA: lawOf(x.skew, x.tails), lawB: lawOf(x.skew, x.tails, x.pat === 'opposite' ? -1 : 1), ties: x.ties, d0: x.nul === 'small' ? 0.3 : 0, effect: 0 }));
    }
    const n = lawOf(0, 'normal');
    cells.push(wwCell('reprobe', 'bf-strat-2x(3:12)-sd5v1', 'size', { gen: 'bf-strat', S: 2, nA: 3, nB: 12, sdA: 5, sdB: 1, lawA: n, lawB: n, ties: 'dp3', d0: 0, effect: 0 }));
    cells.push(wwCell('reprobe', 'bf-strat-4x(3:12)-sd5v1', 'size', { gen: 'bf-strat', S: 4, nA: 3, nB: 12, sdA: 5, sdB: 1, lawA: n, lawB: n, ties: 'dp3', d0: 0, effect: 0 }));
    cells.push(wwCell('reprobe', 'bf-strat-2x(30:120)-sd3v1', 'size', { gen: 'bf-strat', S: 2, nA: 30, nB: 120, sdA: 3, sdB: 1, lawA: n, lawB: n, ties: 'none', d0: 0, effect: 0 }));
    cells.push(wwCell('live', 'p1-cohort-n400-effect0.3', 'power', { gen: 'live-p1', S: 5, nA: 0, nB: 0, sdA: 1, sdB: 1, lawA: n, lawB: n, ties: 'none', d0: 0, effect: 0.3, oracle: true, N: 400 }));
    cells.push(wwCell('live', 'p1-cohort-n400-null', 'size', { gen: 'live-p1', S: 5, nA: 0, nB: 0, sdA: 1, sdB: 1, lawA: n, lawB: n, ties: 'none', d0: 0, effect: 0, N: 400 }));
    for (const S of [2, 3, 4]) for (const nn of [5, 10, 20, 30]) for (const k of [1, 4]) for (const law of CAL_LAWS) for (const [r, on] of [[1, 'small'], [9, 'small']] as const) {
      const nB = Math.round(k * nn), sdA = on === 'small' ? Math.sqrt(r) : 1;
      cells.push(wwCell('env', `S${S}-n${nn}-k${k}-r${r}${on[0]}-s${law.skew}${law.pat}-${law.tails}-none-null0`, 'size',
        { gen: 'std', S, nA: nn, nB, sdA, sdB: 1, lawA: lawOf(law.skew, law.tails), lawB: lawOf(law.skew, law.tails, law.pat === 'opposite' ? -1 : 1), ties: 'none', d0: 0, effect: 0 }));
    }
    return cells;
  },
  runner: cell => wwRunner(cell.params as unknown as WwParams),
};

// =============================================================================================
// Crossover (Hills-Armitage): registered two-group procedure on period differences.
// =============================================================================================
interface XoParams { nAB: number; nBA: number; lawP1: AnyLaw; lawP2: AnyLaw; sdAB: number; sdBA: number; ties: Ties; d0: number; effect: number; oracle?: boolean }

function xoRunner(p: XoParams): Runner {
  const s1 = lawSampler(p.lawP1), s2 = lawSampler(p.lawP2), d0Int = Math.round(p.d0 / UNIT), mixture = isMix(p.lawP1) || isMix(p.lawP2);
  return (rng, reps, B) => {
    const c = emptyCounts(!!p.oracle, mixture);
    for (let rep = 0; rep < reps; rep++) {
      const dAB: number[] = [], dBA: number[] = []; let anyOut = false;
      for (let i = 0; i < p.nAB + p.nBA; i++) {
        const ab = i < p.nAB, sd = ab ? p.sdAB : p.sdBA, subj = 50 + 3 * rng.normal(), tau = p.d0 + p.effect;
        const e1 = s1.draw(rng); anyOut ||= !!s1.lastOutlier; const e2 = s2.draw(rng); anyOut ||= !!s2.lastOutlier;
        const y1 = q(subj + (ab ? tau : 0) + sd * e1, p.ties), y2 = q(subj + 0.5 + (ab ? 0 : tau) + sd * e2, p.ties);
        (ab ? dAB : dBA).push(y1 - y2);
      }
      const can = canonicalTwoGroupInts(dBA, dAB, 2 * d0Int);
      const d = twoGroupDecide(can.v, can.na, () => twoGroupSeed(d0Int === 0 ? can : canonicalTwoGroupInts(dBA, dAB, 0), B), B, TESTS);
      const st = [vectorStats(dBA), vectorStats(dAB)], diag = refusalsByLevel(st, st);
      let oracle: boolean[] | undefined;
      if (p.oracle) { const o = pooledT(can.v, can.na); oracle = TESTS.map(s => tPValue(o.t, o.df, s.direction) <= s.alpha); }
      add(c, { reject: d.reject, tReject: d.welchReject, refused: d.refused }, diag, tSignOf(welchOf(can.v, can.na).t), oracle, mixture ? !anyOut : undefined);
    }
    return c;
  };
}
const xoCell = (group: string, id: string, kind: Cell['kind'], p: XoParams): Cell => ({ family: 'crossover', id: `xo/${group}/${id}`, kind, group, params: p as unknown as Record<string, unknown> });

const crossover: Family = {
  name: 'crossover', procedure: 'crossover.hills-armitage@2',
  cells: () => {
    const cells: Cell[] = [];
    const ca = coveringArray({ n: [5, 8, 10, 15, 20, 30], k: [1, 1.5, 2], periods: ['iid', 'p1-skew'] as const, r: [1, 4, 9], skew: [0, 1, 2], tails: ['normal', 't5', 't3'] as const, ties: ['none', 'mod', 'heavy'] as const, nul: ['0', 'small'] as const }, 'xo-covering-v2');
    for (const x of ca) cells.push(xoCell('cover', `n${x.n}-k${x.k}-${x.periods}-r${x.r}-s${x.skew}-${x.tails}-${x.ties}-null${x.nul}`, 'size',
      { nAB: x.n, nBA: Math.round(x.k * x.n), lawP1: lawOf(x.skew, x.tails), lawP2: lawOf(x.periods === 'iid' ? x.skew : 0, x.tails), sdAB: Math.sqrt(x.r), sdBA: 1, ties: x.ties, d0: x.nul === 'small' ? 0.3 : 0, effect: 0 }));
    const n = lawOf(0, 'normal');
    cells.push(xoCell('live', 'ab-ba-12x12-tau1.0', 'power', { nAB: 12, nBA: 12, lawP1: n, lawP2: n, sdAB: 1, sdBA: 1, ties: 'dp2', d0: 0, effect: 1.0, oracle: true }));
    cells.push(xoCell('live', 'ab-ba-6x6-tau1.5', 'power', { nAB: 6, nBA: 6, lawP1: n, lawP2: n, sdAB: 1, sdBA: 1, ties: 'dp2', d0: 0, effect: 1.5, oracle: true }));
    for (const nn of [5, 10, 20, 30]) for (const k of [1, 2]) for (const skew of [0, 1]) for (const tails of ['normal', 't3'] as const) for (const r of [1, 9])
      cells.push(xoCell('env', `n${nn}-k${k}-p1-skew-r${r}-s${skew}-${tails}-none-null0`, 'size', { nAB: nn, nBA: Math.round(k * nn), lawP1: lawOf(skew, tails), lawP2: lawOf(0, tails), sdAB: Math.sqrt(r), sdBA: 1, ties: 'none', d0: 0, effect: 0 }));
    return cells;
  },
  runner: cell => xoRunner(cell.params as unknown as XoParams),
};

// =============================================================================================
// Brunner-Munzel (rank; diagnostics are not applied: ranks bound every observation's influence)
// =============================================================================================
interface BmParams { gen: 'symmetric' | 'sharp' | 'shift'; nA: number; nB: number; sdA: number; sdB: number; tails: Tails; skew: number; ties: Ties; effect: number; oracle?: boolean }

function bmRunner(p: BmParams): Runner {
  const sym = lawSampler(lawOf(0, p.tails)), sk = lawSampler(lawOf(p.skew, p.tails));
  return (rng, reps, B) => {
    const c = emptyCounts(!!p.oracle);
    for (let rep = 0; rep < reps; rep++) {
      const a: number[] = [], b: number[] = [], law = p.gen === 'sharp' ? sk : sym;
      for (let i = 0; i < p.nA; i++) a.push(q(p.sdA * law.draw(rng), p.ties));
      for (let i = 0; i < p.nB; i++) b.push(q(p.effect + p.sdB * law.draw(rng), p.ties));
      const pooled = reduceByGcd(shiftToZero([...a, ...b])).values;
      const aa = pooled.slice(0, p.nA).sort((x, y) => x - y), bb = pooled.slice(p.nA).sort((x, y) => x - y);
      const d = new BmDesign(aa, bb), o = d.stat();
      const r = bmDecide(d, () => contentSeed(BM_ID, aa, bb, B), B, TESTS);
      let oracle: boolean[] | undefined;
      if (p.oracle) { const can = canonicalTwoGroupInts(a, b, 0), t = pooledT(can.v, can.na); oracle = TESTS.map(s => tPValue(t.t, t.df, s.direction) <= s.alpha); }
      add(c, r, none, tSignOf(o.t), oracle);
    }
    return c;
  };
}
const bmCell = (group: string, id: string, kind: Cell['kind'], p: BmParams): Cell => ({ family: 'brunner-munzel', id: `bm/${group}/${id}`, kind, group, params: p as unknown as Record<string, unknown> });

const brunnerMunzel: Family = {
  name: 'brunner-munzel', procedure: 'rank.brunner-munzel-perm@2',
  cells: () => {
    const cells: Cell[] = [];
    const ca = coveringArray({ n: N_LEVELS, k: K_LEVELS, r: [1, 4, 9], on: ['small', 'large'] as const, tails: ['normal', 't5', 't3'] as const, ties: ['none', 'mod', 'heavy'] as const }, 'bm-covering-v2');
    for (const x of ca) cells.push(bmCell('cover', `n${x.n}-k${x.k}-r${x.r}${x.on[0]}-${x.tails}-${x.ties}`, 'size',
      { gen: 'symmetric', nA: x.n, nB: Math.round(x.k * x.n), sdA: x.on === 'small' ? Math.sqrt(x.r) : 1, sdB: x.on === 'large' ? Math.sqrt(x.r) : 1, tails: x.tails, skew: 0, ties: x.ties, effect: 0 }));
    for (const nn of [5, 10, 20]) for (const k of [1, 4]) cells.push(bmCell('sharp', `n${nn}-k${k}-skew2-identical`, 'size', { gen: 'sharp', nA: nn, nB: k * nn, sdA: 1, sdB: 1, tails: 'normal', skew: 2, ties: 'mod', effect: 0 }));
    cells.push(bmCell('live', 'n20v20-shift0.8', 'power', { gen: 'shift', nA: 20, nB: 20, sdA: 1, sdB: 1, tails: 'normal', skew: 0, ties: 'dp2', effect: 0.8, oracle: true }));
    return cells;
  },
  runner: cell => bmRunner(cell.params as unknown as BmParams),
};

// =============================================================================================
// Ratio of geometric means
// =============================================================================================
interface RgmParams { nA: number; nB: number; sdA: number; sdB: number; lawA: AnyLaw; lawB: AnyLaw; mu: number; dec: number; ratio0: number; effect: number; oracle?: boolean }

function rgmRunner(p: RgmParams): Runner {
  const sa = lawSampler(p.lawA), sb = lawSampler(p.lawB), grid = 10 ** -p.dec, l0 = Math.log(p.ratio0);
  return (rng, reps, B) => {
    const c = emptyCounts(!!p.oracle);
    for (let rep = 0; rep < reps; rep++) {
      const a: number[] = [], b: number[] = [], dev = (x: number) => Math.max(-25, Math.min(25, x));
      for (let i = 0; i < p.nA; i++) a.push(Math.max(1, Math.round(Math.exp(p.mu + dev(p.sdA * sa.draw(rng))) / grid)));
      for (let i = 0; i < p.nB; i++) b.push(Math.max(1, Math.round(Math.exp(p.mu + l0 + p.effect + dev(p.sdB * sb.draw(rng))) / grid)));
      const g = gcdAll([...a, ...b]) || 1;
      const la = a.map(v => Math.log(v / g)).sort((x, y) => x - y), lb0 = b.map(v => Math.log(v / g)).sort((x, y) => x - y), lb = lb0.map(x => x - l0);
      const v = Float64Array.from([...la, ...lb]), v0 = Float64Array.from([...la, ...lb0]);
      const d = twoGroupDecide(v, p.nA, () => ratioSeed(p.nA, v0, B), B, TESTS);
      const diag = refusalsByLevel([vectorStats(la), vectorStats(lb)], [vectorStats(a), vectorStats(b)]);
      let oracle: boolean[] | undefined;
      if (p.oracle) { const o = pooledT(v, p.nA); oracle = TESTS.map(s => tPValue(o.t, o.df, s.direction) <= s.alpha); }
      add(c, { reject: d.reject, tReject: d.welchReject, refused: d.refused }, diag, tSignOf(welchOf(v, p.nA).t), oracle);
    }
    return c;
  };
}
const rgmCell = (group: string, id: string, kind: Cell['kind'], p: RgmParams): Cell => ({ family: 'ratio', id: `rgm/${group}/${id}`, kind, group, params: p as unknown as Record<string, unknown> });

const ratio: Family = {
  name: 'ratio', procedure: 'ratio.log-gm-welch-perm@2',
  cells: () => {
    const cells: Cell[] = [];
    const ca = coveringArray({ n: N_LEVELS, k: K_LEVELS, r: [1, 4, 9], on: ['small', 'large'] as const, skew: [0, 1, 2], tails: ['normal', 't5', 't3'] as const, round: ['fine', 'coarse'] as const, ratio0: [1, 1.5] }, 'rgm-covering-v2');
    for (const x of ca) cells.push(rgmCell('cover', `n${x.n}-k${x.k}-r${x.r}${x.on[0]}-s${x.skew}-${x.tails}-${x.round}-ratio${x.ratio0}`, 'size',
      { nA: x.n, nB: Math.round(x.k * x.n), sdA: x.on === 'small' ? Math.sqrt(x.r) * 0.5 : 0.5, sdB: x.on === 'large' ? Math.sqrt(x.r) * 0.5 : 0.5, lawA: lawOf(x.skew, x.tails), lawB: lawOf(x.skew, x.tails), mu: x.round === 'coarse' ? 0 : 3, dec: x.round === 'coarse' ? 1 : 3, ratio0: x.ratio0, effect: 0 }));
    const n = lawOf(0, 'normal');
    cells.push(rgmCell('live', 'n20v20-lognormal-sd1-ratio2', 'power', { nA: 20, nB: 20, sdA: 1, sdB: 1, lawA: n, lawB: n, mu: 2, dec: 2, ratio0: 1, effect: Math.log(2), oracle: true }));
    return cells;
  },
  runner: cell => rgmRunner(cell.params as unknown as RgmParams),
};

// =============================================================================================
// Generic mixture-cell constructor (used by the adversarial search).
// =============================================================================================
export interface AdvSpec { family: 'two-group' | 'paired' | 'cr2' | 'regression' | 'crossover' | 'weighted-welch'; design: Record<string, number | string>; law: MixLaw; partner?: MixLaw; r: number;
  /** Two-group only: which arm carries the variance ratio (default the smaller arm). */
  on?: 'small' | 'large' }
export function adversarialCell(id: string, s: AdvSpec): Cell {
  const L = s.law, P = s.partner ?? s.law;
  switch (s.family) {
    case 'two-group': { const nA = Number(s.design.nA), nB = Number(s.design.nB);
      const big = s.on === 'large';
      return { family: 'two-group', id, kind: 'size', group: 'adv', params: { gen: 'iid', nA, nB, sdA: big ? 1 : Math.sqrt(s.r), sdB: big ? Math.sqrt(s.r) : 1, lawA: L, lawB: P, ties: 'none', d0: 0, effect: 0 } }; }
    case 'paired': return { family: 'paired', id, kind: 'size', group: 'adv', params: { gen: 'std', n: Number(s.design.n), law: L, r: s.r, ties: 'none', d0: 0, effect: 0 } };
    case 'cr2': return { family: 'cr2', id, kind: 'size', group: 'adv', params: { gen: 'std', S: Number(s.design.S), m: Number(s.design.m), kT: Number(s.design.kT), sdT: Math.sqrt(s.r), sdC: 1, law: L, ties: 'none', d0: 0, effect: 0 } };
    case 'regression': return { family: 'regression', id, kind: 'size', group: 'adv', params: { gen: 'std', n: Number(s.design.n), xLaw: s.design.xLaw, cov: s.design.cov, het: s.r > 1 ? 'abs9' : 'none', law: L, ties: 'none', beta0: 0, effect: 0, design: String(s.design.design ?? 'd1') } };
    case 'crossover': return { family: 'crossover', id, kind: 'size', group: 'adv', params: { nAB: Number(s.design.nAB), nBA: Number(s.design.nBA), lawP1: L, lawP2: P, sdAB: Math.sqrt(s.r), sdBA: 1, ties: 'none', d0: 0, effect: 0 } };
    case 'weighted-welch': return { family: 'weighted-welch', id, kind: 'size', group: 'adv', params: { gen: 'std', S: Number(s.design.S), nA: Number(s.design.nA), nB: Number(s.design.nB), sdA: Math.sqrt(s.r), sdB: 1, lawA: L, lawB: P, ties: 'none', d0: 0, effect: 0 } };
  }
}

export const FAMILIES: Record<string, Family> = { 'two-group': twoGroup, regression, paired, cr2, 'weighted-welch': weightedWelch, crossover, 'brunner-munzel': brunnerMunzel, ratio };
