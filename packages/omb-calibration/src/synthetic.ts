// Amendment A8 (V2c baseline for V2d): repeated-measures null designs the coordinator asked for.
//   S1 heteroskedastic, unbalanced repeated measures: per unit 1 treated row (sd 5) and 5 control
//      rows (sd 1) around a random unit intercept; equal condition means (the mean-difference null
//      is exactly true, but the within-unit labels are NOT exchangeable).
//   S2 the same with 30 units, 1 treated : 3 control rows, sd 3 vs 1.
//   S3 large-magnitude integer ties: every row is 1e6 + Bernoulli(0.1), 1 treated : 3 control rows,
//      5 units (orbit 4^5 = 1,024, enumerated) - a sharp null, so labels are exchangeable.
//   S4 constant outcome: every row equals one large value; the true exact p is 1, so any rejection is
//      a failure. Deterministic shapes (value x units x rows x direction).
// Kernel level: the trusted kernelDecision on many datasets (fast). Full path: the same tables
// through certifyDirectory with declared repeated-measures staging, a generic honest analysis and
// G7/G8 stand-ins (records/synthetic-null.json).

import { randomStream } from "../../omb-certify/src/monte-carlo.ts";

export type Rng = ReturnType<typeof randomStream>;
export const gaussian = (rng: Rng): number => Math.sqrt(-2 * Math.log(Math.max(1e-300, rng.uniform()))) * Math.cos(2 * Math.PI * rng.uniform());

export interface RepeatedTable { readonly units: string[]; readonly x: number[]; readonly y: number[]; readonly tokens: string[] }

export interface SyntheticDesign {
  readonly id: string; readonly description: string; readonly direction: "greater" | "two-sided";
  readonly kernelReps: number; readonly pathReps: number;
  readonly make: (rng: Rng) => RepeatedTable;
  /** Every rejection is a failure (constant outcome), rather than a rate to compare with alpha. */
  readonly anyRejectionFails?: boolean;
}

function hetero(units: number, controls: number, sdTreated: number, sdControl: number) {
  return (rng: Rng): RepeatedTable => {
    const t: RepeatedTable = { units: [], x: [], y: [], tokens: [] };
    for (let k = 0; k < units; k++) {
      const b = 2 * gaussian(rng);
      for (let j = 0; j <= controls; j++) {
        const v = b + (j === 0 ? sdTreated : sdControl) * gaussian(rng), token = v.toFixed(4);
        t.units.push(`u${k}`); t.x.push(j === 0 ? 1 : 0); t.tokens.push(token); t.y.push(Number(token));
      }
    }
    return t;
  };
}
function ties(units: number, controls: number, scale: number, pd: number) {
  return (rng: Rng): RepeatedTable => {
    const t: RepeatedTable = { units: [], x: [], y: [], tokens: [] };
    for (let k = 0; k < units; k++) for (let j = 0; j <= controls; j++) {
      const v = scale + (rng.uniform() < pd ? 1 : 0);
      t.units.push(`u${k}`); t.x.push(j === 0 ? 1 : 0); t.tokens.push(String(v)); t.y.push(v);
    }
    return t;
  };
}

export const SYNTHETIC_DESIGNS: readonly SyntheticDesign[] = [
  { id: "S1", description: "heteroskedastic unbalanced repeated measures: 12 units, 1 treated (sd 5) : 5 control (sd 1) rows, equal means", direction: "greater", kernelReps: 2000, pathReps: 200, make: hetero(12, 5, 5, 1) },
  { id: "S2", description: "heteroskedastic unbalanced repeated measures: 30 units, 1 treated (sd 3) : 3 control (sd 1) rows, equal means", direction: "two-sided", kernelReps: 2000, pathReps: 0, make: hetero(30, 3, 3, 1) },
  { id: "S3", description: "large-magnitude integer ties: rows 1e6 + Bernoulli(0.1), 5 units, 1 treated : 3 control rows (sharp null)", direction: "greater", kernelReps: 2000, pathReps: 200, make: ties(5, 3, 1e6, 0.1) },
];

/** S4: constant-outcome shapes (value, units, controls, direction). */
export const CONSTANT_SHAPES: readonly { value: number; units: number; controls: number; direction: "greater" | "two-sided" }[] =
  [1e6 + 0.1, 1234567.89, 98765.4321, 1e9 + 7, 3e6].flatMap((value) => ([[5, 3], [6, 2], [3, 4]] as const).flatMap(([units, controls]) =>
    (["greater", "two-sided"] as const).map((direction) => ({ value, units, controls, direction }))));

export function constantTable(s: { value: number; units: number; controls: number }): RepeatedTable {
  const t: RepeatedTable = { units: [], x: [], y: [], tokens: [] };
  for (let k = 0; k < s.units; k++) for (let j = 0; j <= s.controls; j++) { t.units.push(`u${k}`); t.x.push(j === 0 ? 1 : 0); t.y.push(s.value); t.tokens.push(String(s.value)); }
  return t;
}

export function tableTsv(t: RepeatedTable): string {
  return "id\tdonor_id\tx\ty\n" + t.units.map((u, i) => `r${i}\t${u}\t${t.x[i]}\t${t.tokens[i]}`).join("\n") + "\n";
}

/** Locked plan for a synthetic repeated-measures claim (declared staging; identical content under
 * distinct units is acknowledged because tie and constant designs repeat values by construction). */
export function syntheticPlan(direction: "greater" | "two-sided"): Record<string, unknown> {
  return {
    staging: { "table.tsv": { mode: "repeated-measures", idColumn: "id", unitColumn: "donor_id", acknowledgeContentDuplicates: true } },
    claims: [{ id: "effect", kind: "effect-exists", estimand: "mean difference", test: "permutation test", permutationLevel: "unit", unit: "unit_id",
      exposure: "x", outcome: "y", mei: 1, direction, table: "table.tsv", statement: "Treated rows exceed control rows within units" }],
  };
}

/** Generic honest analysis for the synthetic tables: equal-weight mean of within-unit (treated mean
 * minus control mean) differences, as the V2b/V2c repeated kernel defines the estimand. No p-value. */
export const SYNTHETIC_ANALYSIS_PY = `"""Synthetic repeated-measures analysis (V3 calibration A8): equal-weight mean of within-unit
treated-minus-control differences. Reports the estimate and the unit count; no p-value."""
import json
from pathlib import Path

rows = Path("data/table.tsv").read_text().splitlines()
head = rows[0].split("\\t")
ix, iu, iy = head.index("x"), head.index("donor_id"), head.index("y")
by = {}
for line in rows[1:]:
    f = line.split("\\t")
    by.setdefault(f[iu], {0: [], 1: []})[int(float(f[ix]))].append(float(f[iy]))
diffs = [sum(g[1]) / len(g[1]) - sum(g[0]) / len(g[0]) for g in by.values()]
est = sum(diffs) / len(diffs)
res = {"claims": [{"id": "effect", "estimate": est, "n_units": len(diffs), "unit": "unit"}]}
Path("results.json").write_text(json.dumps(res))
Path("outputs").mkdir(exist_ok=True)
`;

/** Wilson 95% score interval (the A8 report interval; identical to the one in scripts/synthetic-null.ts). */
export function wilson95(k: number, n: number): [number, number] {
  if (n === 0) return [0, 1];
  const p = k / n, z = 1.959963984540054, den = 1 + z * z / n, c = (p + z * z / (2 * n)) / den, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}

export interface SyntheticPathRun { design: string; k: number; status: string; outcome: string; kernel: string | null; gates: Record<string, string>; worker: string; certifyMs: number }

/** Full-path summary per design (confirmed or replicated counts as a false confirmation). */
export function syntheticPathSummary(pathRuns: readonly SyntheticPathRun[]) {
  return SYNTHETIC_DESIGNS.filter((d) => d.pathReps > 0).map((d) => {
    const rs = pathRuns.filter((r) => r.design === d.id), confirmed = rs.filter((r) => r.status === "confirmed" || r.status === "replicated").length;
    const rejects = rs.filter((r) => r.kernel === "reject").length;
    return { design: d.id, reStagings: rs.length, confirmed, rate: rs.length ? confirmed / rs.length : 0, wilson95: wilson95(confirmed, rs.length), kernelRejected: rejects, kernelWilson95: wilson95(rejects, rs.length) };
  }).filter((s) => s.reStagings > 0);
}
