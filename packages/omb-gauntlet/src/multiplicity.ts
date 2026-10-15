// Family-wise adjustment (G6, design section 5): Holm within the locked family, Benjamini-Hochberg
// only for declared screens of >= 20 tests, Bonferroni allowed (stricter). Family members that the
// plan counts but whose p-value is unknown are treated as p = 1, which is conservative for Holm,
// Bonferroni and BH (it can only raise the adjusted p of the listed members).

import type { FamilyMethod } from "./plan.ts";

/** Adjusted p-values in input order. `size` >= ps.length counts unlisted members as p = 1. */
export function adjustPValues(ps: readonly number[], method: FamilyMethod, size = ps.length): number[] {
  if (ps.some((p) => !(p >= 0 && p <= 1))) throw new Error("p-values must lie in [0, 1]");
  const m = Math.max(size, ps.length);
  if (ps.length === 0) return [];
  if (!Number.isSafeInteger(m) || m < 1) throw new Error("invalid family size");
  const order = ps.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p || a.i - b.i);
  const adjusted = new Array<number>(ps.length).fill(1);
  if (method === "bonferroni") {
    for (const { p, i } of order) adjusted[i] = Math.min(1, m * p);
  } else if (method === "holm") {
    let running = 0;
    order.forEach(({ p, i }, rank) => {
      running = Math.max(running, Math.min(1, (m - rank) * p));
      adjusted[i] = running;
    });
  } else {
    let running = 1;
    for (let rank = ps.length - 1; rank >= 0; rank -= 1) {
      const { p, i } = order[rank]!;
      running = Math.min(running, Math.min(1, (m * p) / (rank + 1)));
      adjusted[i] = running;
    }
  }
  return adjusted.slice(0, ps.length);
}
