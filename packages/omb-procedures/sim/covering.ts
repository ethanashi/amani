import { Rng } from '../src/rng.ts';

/**
 * Deterministic strength-2 covering array (AETG-style greedy): every pair of levels of every two
 * factors appears in at least one row. Factors are given as name -> levels.
 */
export function coveringArray<T extends Record<string, readonly unknown[]>>(factors: T, seed: string, candidates = 60): { [K in keyof T]: T[K][number] }[] {
  const names = Object.keys(factors) as (keyof T)[], k = names.length, lv = names.map(n => factors[n]!.length);
  const key = (i: number, a: number, j: number, b: number) => `${i}:${a}|${j}:${b}`;
  const uncovered = new Set<string>();
  for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) for (let a = 0; a < lv[i]!; a++) for (let b = 0; b < lv[j]!; b++) uncovered.add(key(i, a, j, b));
  const rng = new Rng(seed), rows: number[][] = [];
  const gain = (row: number[]) => { let g = 0; for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) if (uncovered.has(key(i, row[i]!, j, row[j]!))) g++; return g; };
  while (uncovered.size > 0) {
    // Seed each candidate with one uncovered pair so progress is guaranteed.
    const first = uncovered.values().next().value as string;
    const [[fi, fa], [fj, fb]] = first.split('|').map(p => p.split(':').map(Number)) as [[number, number], [number, number]];
    let best: number[] | null = null, bestGain = -1;
    for (let c = 0; c < candidates; c++) {
      const row = lv.map(n => rng.int(n));
      row[fi] = fa; row[fj] = fb;
      // Greedy improvement factor by factor in a random order.
      const order = Array.from({ length: k }, (_, i) => i).filter(i => i !== fi && i !== fj);
      for (let i = order.length - 1; i > 0; i--) { const j = rng.int(i + 1); [order[i], order[j]] = [order[j]!, order[i]!]; }
      for (const f of order) {
        let bestL = row[f]!, bestG = -1;
        for (let l = 0; l < lv[f]!; l++) { row[f] = l; const g = gain(row); if (g > bestG) { bestG = g; bestL = l; } }
        row[f] = bestL;
      }
      const g = gain(row);
      if (g > bestGain) { bestGain = g; best = [...row]; }
    }
    rows.push(best!);
    for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) uncovered.delete(key(i, best![i]!, j, best![j]!));
  }
  return rows.map(r => Object.fromEntries(names.map((n, i) => [n, factors[n]![r[i]!]])) as { [K in keyof T]: T[K][number] });
}
