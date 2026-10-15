/**
 * Bounded-contamination search (v2 audit 2): does a stated contamination bound certify at EVERY released envelope
 * boundary corner?
 *
 * Law = (1 - p - q) x population core + contamination. The population core is a unit-variance uniform (screen and
 * confirmations) or normal (confirmation twin) law with mean 0. The contamination is point mass at +L (one-point) or
 * at +L and -2L with q solved so the law's skewness is 0 (two-zeroskew). Its distance is the farthest contaminating
 * point from the core mean, in core SDs (contaminationDistance: L, or 2L). One-exp contamination is unbounded and is
 * not in any bounded class. A law is in class K when its contamination distance is <= K AND its moment skewness is
 * within the calibration families' |skew| <= 1.
 *
 * Corners: every released boundary design (the smallest design of each envelope row, per objective, at the variance
 * ratios released there); for regression, the lowest-df continuous-exposure designs and the binary designs of the
 * smaller-exposure-group ladder m = 9-12. Revision 3: every corner carries a role, 'inside' the REVISED envelope (must
 * pass for a bound K to certify) or 'outside' it (kept as evidence of why the envelope moved).
 *
 * Phases (cache-keyed 2-worker pool):
 *   1. screen: every class-3 law x sign pattern x variance ratio at every corner, 1,000 nulls;
 *   2. confirm: per corner, objective and K in {1, 2, 3}, the 3 worst screen laws in class K with 20,000 fresh nulls
 *      (uniform core), and the worst one again with a normal core.
 *   nice -n 15 node sim/adversarial-bound.ts
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { adversarialCell, fixedDesign, type AdvSpec, type Cell, type RegParams } from './families.ts';
import { contaminationDistance, lawSampler, solveZeroSkewQ, type MixLaw } from './laws.ts';
import { runPool, loadLines, OUT_DIR } from './pool.ts';
import { cellKey, codeHash } from './cache.ts';
import { PRIMARY_LEVEL } from './common.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const BOUND_KS = [1, 2, 3] as const;
const PS = [0.003, 0.01, 0.03, 0.1, 0.2, 0.3];
const ONE_POINT_L = [0.5, 1, 1.5, 2, 2.5, 3], ZERO_SKEW_L = [0.5, 0.75, 1, 1.25, 1.5];

/** Every screened law (uniform core) in bounded class K: contamination distance <= K and |moment skewness| <= 1. */
export function boundedLaws(K: number, core: MixLaw['core'] = 'uniform'): MixLaw[] {
  const out: MixLaw[] = [];
  const push = (type: MixLaw['type'], p: number, L: number) => {
    const law: MixLaw = { kind: 'mix', core, type, p, L, sign: 1 };
    if (contaminationDistance(law) > K + 1e-12) return;
    if (type === 'two-zeroskew' && Number.isNaN(solveZeroSkewQ(core, p, L))) return;
    if (!(Math.abs(lawSampler(law).skewness) <= 1)) return;
    out.push(law);
  };
  for (const p of PS) { for (const L of ONE_POINT_L) push('one-point', p, L); for (const L of ZERO_SKEW_L) push('two-zeroskew', p, L); }
  return out;
}

export interface BoundCorner { name: string; family: AdvSpec['family']; design: Record<string, number | string>; twoArm: boolean;
  /** Variance ratios at which each objective is checked at this design ([] = not checked). */
  two: number[]; one: number[]; largeArm?: boolean;
  /** Inside the REVISED envelope (must pass for a bound to certify) or outside it (shown as evidence). Default inside. */
  role?: 'inside' | 'outside'; note?: string }
const R19 = [1, 9];
/** Released envelope boundaries (FEASIBILITY T1): smallest design of every envelope row, per objective. */
export const BOUND_CORNERS: BoundCorner[] = [
  // Two-group: two-sided released from 8 (1:1, 1:1.5, 1:4), 10 (1:2), 15 (1:3) at ratio <= 9, and from 5 at ratio 1;
  // directional from 5 per arm at every imbalance up to 1:4.
  ...[1, 1.5, 2, 3, 4].map(k => ({ name: `tg-5v${Math.round(5 * k)}`, family: 'two-group' as const, design: { nA: 5, nB: Math.round(5 * k) }, twoArm: true, two: [1], one: R19, largeArm: k > 1 })),
  ...([[8, 1], [8, 1.5], [10, 2], [15, 3], [8, 4]] as const).map(([n, k]) => ({ name: `tg-${n}v${Math.round(n * k)}`, family: 'two-group' as const, design: { nA: n, nB: Math.round(n * k) }, twoArm: true, two: R19, one: [], largeArm: k > 1 })),
  { name: 'pair-6', family: 'paired', design: { n: 6 }, twoArm: false, two: R19, one: R19 },
  // CR2: two-sided from 5 strata (2:1, 4:1, 6:1, 6:3); directional from 5 strata (2:1, 6:3; 4:1 and 6:1 at ratio 1) and
  // from 10 strata (4:1, 6:1 at ratio 9).
  { name: 'cr2-S5-2:1', family: 'cr2', design: { S: 5, m: 2, kT: 1 }, twoArm: false, two: R19, one: R19 },
  { name: 'cr2-S5-4:1', family: 'cr2', design: { S: 5, m: 4, kT: 1 }, twoArm: false, two: R19, one: [1] },
  { name: 'cr2-S5-6:1', family: 'cr2', design: { S: 5, m: 6, kT: 1 }, twoArm: false, two: R19, one: [1] },
  { name: 'cr2-S5-6:3', family: 'cr2', design: { S: 5, m: 6, kT: 3 }, twoArm: false, two: R19, one: R19 },
  { name: 'cr2-S10-4:1', family: 'cr2', design: { S: 10, m: 4, kT: 1 }, twoArm: false, two: R19, one: [9] },
  { name: 'cr2-S10-6:1', family: 'cr2', design: { S: 10, m: 6, kT: 1 }, twoArm: false, two: R19, one: [9] },
  // Revision 3 ladder: bounded contamination breaks 1-treated strata at S = 5 with ratio 9 (two-sided), so the
  // two-sided boundary for 4:1 and 6:1 strata is searched at S = 10 and 20, and S = 5 is kept at ratio 1 only.
  { name: 'cr2-S5-4:1-ratio1', family: 'cr2', design: { S: 5, m: 4, kT: 1 }, twoArm: false, two: [1], one: [1] },
  { name: 'cr2-S5-6:1-ratio1', family: 'cr2', design: { S: 5, m: 6, kT: 1 }, twoArm: false, two: [1], one: [1] },
  { name: 'cr2-S20-4:1', family: 'cr2', design: { S: 20, m: 4, kT: 1 }, twoArm: false, two: R19, one: [] },
  { name: 'cr2-S20-6:1', family: 'cr2', design: { S: 20, m: 6, kT: 1 }, twoArm: false, two: R19, one: [] },
  // Crossover: from 5 per sequence, imbalance 1:1 and 1:2, both objectives.
  { name: 'xo-5v5', family: 'crossover', design: { nAB: 5, nBA: 5 }, twoArm: true, two: R19, one: R19 },
  { name: 'xo-5v10', family: 'crossover', design: { nAB: 5, nBA: 10 }, twoArm: true, two: R19, one: R19 },
  // Weighted Welch: from 5 per arm per stratum, 2-4 strata, within-stratum imbalance 1:1 and 1:4, both objectives.
  ...[2, 3, 4].flatMap(S => [1, 4].map(k => ({ name: `ww-S${S}-5v${5 * k}`, family: 'weighted-welch' as const, design: { S, nA: 5, nB: 5 * k }, twoArm: true, two: R19, one: R19 }))),
];

/**
 * Regression corners (revision 3). Binary exposures are released on the smaller exposure group m (the BM df does not
 * order their validity: the audit's failing design had df 9.53 with m = 6), continuous exposures on n.
 * - the corners the first bounded run used (chosen by the df envelope), kept so their evidence stays in the index;
 * - the lowest-df continuous-exposure designs;
 * - every binary design with m = 9-12 (the m ladder).
 */
const REG_LABELS: [string, number[], number[]][] = [
  ['binary20/none/n30/d1', R19, []], ['binary50/ass/n20/d4', R19, R19], ['normal/none/n20/d1', R19, []], ['lognormal/none/n50/d1', R19, []],
  ['binary50/ass/n20/d8', R19, R19], ['binary20/none/n40/d3', [], R19], ['normal/none/n30/d1', [], R19],
  ['normal/none/n10/d1', R19, R19], ['normal/none/n10/d2', R19, R19], ['lognormal/none/n10/d1', R19, R19], ['lognormal/none/n30/d2', R19, R19],
  ...['binary50/ass/n20/d3', 'binary20/none/n50/d3', 'binary20/none/n30/d5', 'binary50/ass/n20/d2', 'binary20/none/n50/d5', 'binary50/ass/n30/d8', 'binary20/none/n50/d8',
    'binary20/none/n40/d5', 'binary20/none/n40/d7', 'binary20/none/n30/d4', 'binary50/ass/n30/d1', 'binary50/ass/n30/d6'].map(l => [l, R19, R19] as [string, number[], number[]]),
];
/** Smaller exposure group of a binary fixed design (NaN for continuous exposures). */
export function exposureMinGroup(xLaw: string, cov: string, n: number, design: string): number {
  if (!xLaw.startsWith('binary')) return NaN;
  const d = fixedDesign({ gen: 'std', n, xLaw, cov, het: 'none', law: { skew: 0, tails: 'normal', sign: 1 }, ties: 'none', beta0: 0, effect: 0, design } as RegParams);
  const n1 = d.x.reduce((a, b) => a + b, 0); return Math.min(n1, n - n1);
}
/** Revised release thresholds (set from the ladder results in TABLES §6d; FEASIBILITY T1). */
export const REVISED = { binaryMinGroup: 9, cr2OneTreatedStrataTwoSided: 10 };
export function regressionCorners(): BoundCorner[] {
  return REG_LABELS.map(([label, two, one]) => {
    const [xLaw, cov, nS, design] = label.split('/') as [string, string, string, string], n = Number(nS.slice(1)), m = exposureMinGroup(xLaw, cov, n, design);
    const inside = !(m < REVISED.binaryMinGroup);
    return { name: `reg-${xLaw}-${cov}-${nS}-${design}`, family: 'regression' as const, design: { n, xLaw, cov, design }, twoArm: false, two, one,
      role: inside ? 'inside' as const : 'outside' as const, note: Number.isNaN(m) ? 'continuous exposure' : `smaller exposure group m = ${m}` };
  });
}
/** Roles of the fixed corners under the revised envelope. */
function withRoles(c: BoundCorner): BoundCorner {
  if (c.family === 'cr2' && Number(c.design.kT) === 1 && Number(c.design.m) >= 4 && c.two.includes(9) && Number(c.design.S) < REVISED.cr2OneTreatedStrataTwoSided)
    return { ...c, role: 'outside', note: '1 treated per stratum, two-sided at ratio 9: below the revised strata minimum' };
  return { role: 'inside', ...c };
}

const lawId = (l: MixLaw) => `${l.type}-p${l.p}-L${l.L}`;
interface Entry { id: string; corner: string; type: MixLaw['type']; p: number; L: number; dist: number; skew: number; pat: 'same' | 'opposite'; r: number; on: 'small' | 'large'; core: MixLaw['core']; reps: number }
function cellOf(phase: string, corner: BoundCorner, law: MixLaw, pat: 'same' | 'opposite', r: number, on: 'small' | 'large'): { cell: Cell; entry: Entry } {
  const id = `adv/${phase}/${corner.name}/${lawId(law)}-${pat}-r${r}${on === 'large' ? 'L' : ''}-${law.core}`;
  const cell = adversarialCell(id, { family: corner.family, design: corner.design, law, partner: { ...law, sign: pat === 'opposite' ? -1 : 1 }, r, on });
  return { cell, entry: { id, corner: corner.name, type: law.type, p: law.p, L: law.L, dist: contaminationDistance(law), skew: lawSampler(law).skewness, pat, r, on, core: law.core, reps: 0 } };
}

async function main(): Promise<void> {
  const code = codeHash(root), corners = [...BOUND_CORNERS.map(withRoles), ...regressionCorners()];
  const rate = (cell: Cell, reps: number) => { const l = loadLines().get(cellKey(cell, 1, reps, cell.B ?? 999, code)); if (!l) return null; const c = l.counts; return { two: c.rej[PRIMARY_LEVEL]![0]! / c.reps, one: Math.max(c.rej[PRIMARY_LEVEL]![1]!, c.rej[PRIMARY_LEVEL]![2]!) / c.reps }; };
  // Phase 1: screen.
  const laws = boundedLaws(3), screen: { corner: BoundCorner; cell: Cell; entry: Entry; law: MixLaw }[] = [];
  for (const corner of corners) {
    const rs = [...new Set([...corner.two, ...corner.one])], arms: ('small' | 'large')[] = corner.largeArm ? ['small', 'large'] : ['small'];
    for (const law of laws) for (const pat of corner.twoArm ? (['same', 'opposite'] as const) : (['same'] as const)) for (const r of rs) for (const on of r > 1 ? arms : (['small'] as const)) {
      const x = cellOf('bound-screen', corner, law, pat, r, on); screen.push({ corner, law, ...x, entry: { ...x.entry, reps: 1000 } });
    }
  }
  await runPool(screen.map(s => s.cell), { stage1: 1000, stage2: false, tag: 'bound-screen' });
  // Phase 2: confirm.
  const confirm = new Map<string, { cell: Cell; entry: Entry }>(), picks: { corner: string; objective: 'two' | 'one'; K: number; ids: string[] }[] = [];
  for (const corner of corners) {
    const mine = screen.filter(s => s.corner === corner).map(s => ({ s, r: rate(s.cell, 1000)! })).filter(x => x.r);
    for (const obj of ['two', 'one'] as const) {
      const allowed = corner[obj]; if (!allowed.length) continue;
      for (const K of BOUND_KS) {
        const top = mine.filter(x => x.s.entry.dist <= K + 1e-12 && allowed.includes(x.s.entry.r)).sort((a, b) => b.r[obj] - a.r[obj]).slice(0, 3);
        const ids: string[] = [];
        top.forEach(({ s }, i) => {
          for (const core of i === 0 ? (['uniform', 'normal'] as const) : (['uniform'] as const)) {
            const law: MixLaw = { ...s.law, core };
            if (law.type === 'two-zeroskew' && Number.isNaN(solveZeroSkewQ(core, law.p, law.L))) continue;
            if (!(Math.abs(lawSampler(law).skewness) <= 1)) continue;
            const x = cellOf('bound-confirm', corner, law, s.entry.pat, s.entry.r, s.entry.on);
            if (!confirm.has(x.cell.id)) confirm.set(x.cell.id, { cell: x.cell, entry: { ...x.entry, reps: 20000 } });
            ids.push(x.cell.id);
          }
        });
        picks.push({ corner: corner.name, objective: obj, K, ids });
      }
    }
  }
  console.log(`[bound] ${corners.length} corners, ${screen.length} screen cells, ${confirm.size} confirmation cells`);
  await runPool([...confirm.values()].map(c => c.cell), { stage1: 20000, stage2: false, tag: 'bound-confirm' });
  writeFileSync(join(OUT_DIR, 'adversarial-bound-index.json'), JSON.stringify({ code, corners, screen: screen.map(s => s.entry), confirm: [...confirm.values()].map(c => c.entry), picks }, null, 1));
  console.log('[bound] wrote adversarial-bound-index.json');
}
if (process.argv[1] === fileURLToPath(import.meta.url)) void main();
