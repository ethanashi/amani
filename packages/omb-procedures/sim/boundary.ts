/**
 * Production-B calibration of envelope-boundary cells: every admitted size cell whose final end-to-end CP upper bound
 * lies within 0.6 percentage points of a release limit (two-sided 6.25%, directional 5%) is re-run at B = 9,999 with
 * fresh nulls (new id, so new seeds; stage 1 + stage 2 as usual). At most 160 cells, closest to a limit first.
 *   nice -n 15 node sim/boundary.ts [--only <family>]
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { clopperPearsonUpper } from '../src/special.ts';
import { FAMILIES, type Cell } from './families.ts';
import { PRIMARY_LEVEL } from './common.ts';
import { cellKey, codeHash } from './cache.ts';
import { loadLines, runPool, STAGE1, STAGE2 } from './pool.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..'), code = codeHash(root), all = loadLines();
const cand: { cell: Cell; dist: number }[] = [];
for (const F of Object.values(FAMILIES)) for (const cell of F.cells()) {
  if (cell.kind !== 'size') continue;
  const B = cell.B ?? 999, l = all.get(cellKey(cell, 2, STAGE2, B, code)) ?? all.get(cellKey(cell, 1, STAGE1, B, code)); if (!l) continue;
  const c = l.counts, two = clopperPearsonUpper(c.rej[PRIMARY_LEVEL]![0]!, c.reps), one = Math.max(clopperPearsonUpper(c.rej[PRIMARY_LEVEL]![1]!, c.reps), clopperPearsonUpper(c.rej[PRIMARY_LEVEL]![2]!, c.reps));
  const dist = Math.min(Math.abs(two - 0.0625), Math.abs(one - 0.05));
  // '@B9999' id suffix: fresh nulls. Regression fixed designs are identified by the design (v2 audit 1), not the cell
  // id, so the regression re-run uses the same X.
  if (dist <= 0.006) cand.push({ cell: { ...cell, id: `${cell.id}@B9999`, B: 9999 }, dist });
}
cand.sort((a, b) => a.dist - b.dist);
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : undefined;
const cells = cand.slice(0, 160).map(c => c.cell).filter(c => !only || c.family === only);
console.log(`[boundary] ${cand.length} cells within 0.6pp of a limit; running ${cells.length} at B = 9,999`);
void runPool(cells, { tag: 'B9999' });
