/**
 * Exact, certified calibration of the binary risk-difference procedure (audit 5). For each design and null value
 * the decision table (every possible outcome table) is computed, and the size bound is the CERTIFIED maximum over
 * the nuisance probability: grid maxima plus the exact total-variation interval slack (certifiedMaxRejection), so it
 * is a provable upper bound, not a grid estimate. Validity also holds by construction, because the reported p is a
 * certified upper bound on the supremum p-value.
 *   nice -n 15 node sim/binary-exact.ts      (single process)
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { binaryDecisionTable, certifiedMaxRejection, exactRejectionRate, fisherPTable } from '../src/binary.ts';
import type { Direction } from '../src/special.ts';
import { cellKey, codeHash } from './cache.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..'), outDir = join(root, 'results', 'v2'); mkdirSync(outDir, { recursive: true });
const out = join(outDir, 'binary.jsonl'), code = codeHash(root);
const done = new Set(existsSync(out) ? readFileSync(out, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l).key as string) : []);
const tests: { direction: Direction; alpha: number }[] = [{ direction: 'two-sided', alpha: 0.05 }, { direction: 'greater', alpha: 0.025 }, { direction: 'less', alpha: 0.025 }];

for (const na of [5, 8, 10, 15, 20, 30, 50]) for (const k of [1, 2, 4]) for (const delta of [0, 0.1, -0.2]) {
  const nb = k * na, id = `rd/na${na}-nb${nb}-null${delta}`, key = cellKey({ id, params: { na, nb, delta } }, 1, 0, 0, code);
  if (done.has(key)) continue;
  const t = Date.now(), res: Record<string, unknown> = {};
  tests.forEach((s, ti) => {
    const dec = binaryDecisionTable(na, nb, delta, s.direction), c = certifiedMaxRejection(dec, na, nb, delta, s.alpha);
    const f = delta === 0 ? certifiedMaxRejection(fisherPTable(na, nb, s.direction), na, nb, 0, s.alpha) : null;
    res[['two05', 'g025', 'l025'][ti]!] = { certifiedMax: c.bound, gridMax: c.gridMax, argmaxPa: c.argmax, ...(f ? { fisherCertifiedMax: f.bound } : {}) };
  });
  appendFileSync(out, JSON.stringify({ id, key, na, nb, delta, ...res, ms: Date.now() - t }) + '\n');
  console.log(id, JSON.stringify(res));
}
for (const [na, nb, pa, pb] of [[40, 40, 0.3, 0.6], [20, 20, 0.25, 0.6], [30, 30, 0.2, 0.5]] as const) {
  const id = `rd/live-na${na}-nb${nb}-pa${pa}-pb${pb}`, key = cellKey({ id, params: { na, nb, pa, pb } }, 1, 0, 0, code);
  if (done.has(key)) continue;
  const power: Record<string, number> = {};
  tests.forEach((s, ti) => {
    power[['two05', 'g025', 'l025'][ti]!] = exactRejectionRate(binaryDecisionTable(na, nb, 0, s.direction), na, nb, pa, pb, s.alpha);
    power[`fisher_${['two05', 'g025', 'l025'][ti]}`] = exactRejectionRate(fisherPTable(na, nb, s.direction), na, nb, pa, pb, s.alpha);
  });
  power.g05 = exactRejectionRate(binaryDecisionTable(na, nb, 0, 'greater'), na, nb, pa, pb, 0.05);
  appendFileSync(out, JSON.stringify({ id, key, na, nb, pa, pb, power }) + '\n');
  console.log(id, JSON.stringify(power));
}
