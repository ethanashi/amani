/**
 * Adversarial search over rare-outlier mixtures at envelope corners, maximising the END-TO-END Confirmed rate
 * (procedure + default diagnostics + refusals). Three phases, each through the cache-keyed 2-worker pool:
 *   1. screen: every (mixture type, p, L, sign pattern, variance ratio) at each corner, 300 nulls;
 *   2. refine: the 3 best screen cells per corner and objective (two-sided; worse one-sided tail), local 3x3 grid in
 *      (p, L) at 1,000 nulls;
 *   3. confirm: the best refined cell per corner and objective with 20,000 fresh nulls (new seed), uniform core and
 *      normal core.
 *   nice -n 15 node sim/adversarial.ts
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { adversarialCell, type AdvSpec, type Cell } from './families.ts';
import { solveZeroSkewQ, type MixLaw } from './laws.ts';
import { runPool, loadLines, OUT_DIR } from './pool.ts';
import { cellKey, codeHash } from './cache.ts';
import { PRIMARY_LEVEL } from './common.ts';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const CORNERS: { name: string; family: AdvSpec['family']; design: Record<string, number | string>; twoArm: boolean }[] = [
  { name: 'tg-5v5', family: 'two-group', design: { nA: 5, nB: 5 }, twoArm: true },
  { name: 'tg-15v15', family: 'two-group', design: { nA: 15, nB: 15 }, twoArm: true },
  { name: 'tg-15v60', family: 'two-group', design: { nA: 15, nB: 60 }, twoArm: true },
  { name: 'tg-30v30', family: 'two-group', design: { nA: 30, nB: 30 }, twoArm: true },
  { name: 'tg-50v200', family: 'two-group', design: { nA: 50, nB: 200 }, twoArm: true },
  { name: 'pair-6', family: 'paired', design: { n: 6 }, twoArm: false },
  { name: 'pair-20', family: 'paired', design: { n: 20 }, twoArm: false },
  { name: 'pair-50', family: 'paired', design: { n: 50 }, twoArm: false },
  { name: 'cr2-S5-4:1', family: 'cr2', design: { S: 5, m: 4, kT: 1 }, twoArm: false },
  { name: 'cr2-S20-4:1', family: 'cr2', design: { S: 20, m: 4, kT: 1 }, twoArm: false },
  { name: 'reg-n30-normalx', family: 'regression', design: { n: 30, xLaw: 'normal', cov: 'none' }, twoArm: false },
  { name: 'reg-n80-binary-adjusted', family: 'regression', design: { n: 80, xLaw: 'binary50', cov: 'ass' }, twoArm: false },
  { name: 'xo-12v12', family: 'crossover', design: { nAB: 12, nBA: 12 }, twoArm: true },
  { name: 'ww-S3-10v10', family: 'weighted-welch', design: { S: 3, nA: 10, nB: 10 }, twoArm: true },
];
const TYPES: MixLaw['type'][] = ['one-point', 'one-exp', 'two-zeroskew'];
const PS = [0.001, 0.003, 0.01, 0.03, 0.1], LS = [3, 10, 30, 100, 300];

function feasible(type: MixLaw['type'], p: number, L: number, core: MixLaw['core']): boolean { return type !== 'two-zeroskew' || !Number.isNaN(solveZeroSkewQ(core, p, L)); }
function spec(corner: typeof CORNERS[number], type: MixLaw['type'], p: number, L: number, pat: 'same' | 'opposite', r: number, core: MixLaw['core'] = 'uniform'): AdvSpec {
  const law: MixLaw = { kind: 'mix', core, type, p, L, sign: 1 };
  return { family: corner.family, design: corner.design, law, partner: { ...law, sign: pat === 'opposite' ? -1 : 1 }, r };
}
const idOf = (phase: string, corner: string, type: string, p: number, L: number, pat: string, r: number, core: string) => `adv/${phase}/${corner}/${type}-p${+p.toPrecision(3)}-L${+L.toPrecision(3)}-${pat}-r${r}-${core}`;

async function main(): Promise<void> {
  const code = codeHash(root);
  const rate = (cell: Cell, reps: number) => { const l = loadLines().get(cellKey(cell, 1, reps, cell.B ?? 999, code)); if (!l) return null; const c = l.counts; return { two: c.rej[PRIMARY_LEVEL]![0]! / c.reps, one: Math.max(c.rej[PRIMARY_LEVEL]![1]!, c.rej[PRIMARY_LEVEL]![2]!) / c.reps, line: l }; };
  // Phase 1: screen.
  const screen: { corner: typeof CORNERS[number]; cell: Cell; type: MixLaw['type']; p: number; L: number; pat: 'same' | 'opposite'; r: number }[] = [];
  for (const corner of CORNERS) for (const type of TYPES) for (const p of PS) for (const L of LS) for (const pat of corner.twoArm ? (['same', 'opposite'] as const) : (['same'] as const)) for (const r of [1, 9]) {
    if (!feasible(type, p, L, 'uniform')) continue;
    screen.push({ corner, type, p, L, pat, r, cell: adversarialCell(idOf('screen', corner.name, type, p, L, pat, r, 'uniform'), spec(corner, type, p, L, pat, r)) });
  }
  await runPool(screen.map(s => s.cell), { stage1: 300, stage2: false, tag: 'adv-screen' });
  // Phase 2: refine.
  const refine: typeof screen = [];
  for (const corner of CORNERS) {
    const mine = screen.filter(s => s.corner === corner).map(s => ({ s, r: rate(s.cell, 300)! }));
    for (const obj of ['two', 'one'] as const) {
      for (const { s } of [...mine].sort((a, b) => b.r[obj] - a.r[obj]).slice(0, 3)) for (const fp of [1 / 1.6, 1, 1.6]) for (const fl of [1 / 1.6, 1, 1.6]) {
        const p = Math.min(0.3, s.p * fp), L = s.L * fl;
        if (!feasible(s.type, p, L, 'uniform')) continue;
        const id = idOf('refine', corner.name, s.type, p, L, s.pat, s.r, 'uniform');
        if (!refine.some(x => x.cell.id === id)) refine.push({ ...s, p, L, cell: adversarialCell(id, spec(corner, s.type, p, L, s.pat, s.r)) });
      }
    }
  }
  await runPool(refine.map(s => s.cell), { stage1: 1000, stage2: false, tag: 'adv-refine' });
  // Phase 3: confirm.
  const confirm: (typeof screen[number] & { objective: string; core: MixLaw['core'] })[] = [];
  for (const corner of CORNERS) {
    const mine = refine.filter(s => s.corner === corner).map(s => ({ s, r: rate(s.cell, 1000)! }));
    for (const obj of ['two', 'one'] as const) {
      const best = [...mine].sort((a, b) => b.r[obj] - a.r[obj])[0]; if (!best) continue;
      for (const core of ['uniform', 'normal'] as const) {
        if (!feasible(best.s.type, best.s.p, best.s.L, core)) continue;
        const id = idOf(`confirm-${obj}`, corner.name, best.s.type, best.s.p, best.s.L, best.s.pat, best.s.r, core);
        confirm.push({ ...best.s, objective: obj, core, cell: adversarialCell(id, spec(corner, best.s.type, best.s.p, best.s.L, best.s.pat, best.s.r, core)) });
      }
    }
  }
  await runPool(confirm.map(s => s.cell), { stage1: 20000, stage2: false, tag: 'adv-confirm' });
  // Index for the report.
  const index = { code, screen: screen.map(s => ({ id: s.cell.id, corner: s.corner.name, type: s.type, p: s.p, L: s.L, pat: s.pat, r: s.r, reps: 300 })),
    refine: refine.map(s => ({ id: s.cell.id, corner: s.corner.name, type: s.type, p: s.p, L: s.L, pat: s.pat, r: s.r, reps: 1000 })),
    confirm: confirm.map(s => ({ id: s.cell.id, corner: s.corner.name, type: s.type, p: s.p, L: s.L, pat: s.pat, r: s.r, reps: 20000, objective: s.objective, core: s.core })) };
  writeFileSync(join(OUT_DIR, 'adversarial-index.json'), JSON.stringify(index, null, 1));
  console.log(`[adv] wrote index: ${screen.length} screen, ${refine.length} refine, ${confirm.length} confirm cells`);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) void main();
