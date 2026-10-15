// Work clusters: rows that touch the same work (by DOI, PMID or a related identifier) are not
// independent trials. Union-find over every identity key a row carries gives one cluster per group
// of connected works; the split never cuts a cluster and the scorer reports cluster-level rates.

import { rowWorkKeys } from "./schema.ts";
import type { SuiteRow } from "./types.ts";

export type ClusterRow = Pick<SuiteRow, "id" | "input" | "truth" | "relatedIds">;

/** Map row id -> cluster id (the smallest identity key in the cluster; the row id if it has none). */
export function clusterOf(rows: readonly ClusterRow[], extraKeys: (r: ClusterRow) => string[] = () => []): Map<string, string> {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let cur = x;
    while (parent.get(cur) !== root) {
      const next = parent.get(cur)!;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  const add = (x: string) => {
    if (!parent.has(x)) parent.set(x, x);
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) {
      if (ra < rb) parent.set(rb, ra);
      else parent.set(ra, rb);
    }
  };
  const keysOf = (r: ClusterRow) => {
    const ks = [...new Set([...rowWorkKeys(r), ...extraKeys(r)])];
    return ks.length ? ks : [`row:${r.id}`];
  };
  for (const r of rows) {
    const ks = keysOf(r);
    for (const k of ks) add(k);
    for (const k of ks.slice(1)) union(ks[0]!, k);
  }
  return new Map(rows.map((r) => [r.id, find(keysOf(r)[0]!)]));
}
