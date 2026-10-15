// Diagnostic for A8 S1: why the full certify path's kernel rejects more nulls than the kernel-level
// run. Regenerates the exact path datasets (same seed stream as scripts/synthetic-null.ts) and runs
// the trusted kernelDecision on them in-process with (a) the kernel-level data shape (units = donor)
// and (b) per-row units (as if repeated structure were lost). Prints counts and guarantees only.
//   node packages/omb-calibration/scripts/synthetic-path-diagnostic.ts [--design S1] [--reps 200]
import { kernelDecision } from "../../omb-certify/src/producers.ts";
import { randomStream } from "../../omb-certify/src/monte-carlo.ts";
import { parsePlan } from "../../omb-gauntlet/src/index.ts";
import { SYNTHETIC_DESIGNS, syntheticPlan, wilson95, type RepeatedTable } from "../src/index.ts";

const args = process.argv.slice(2);
const flag = (name: string, d: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1]! : d; };
const design = SYNTHETIC_DESIGNS.find((d) => d.id === flag("--design", "S1"))!, reps = Number(flag("--reps", String(design.pathReps)));
const claim = parsePlan(JSON.stringify(syntheticPlan(design.direction))).plan!.claims[0]!;
const shape = (t: RepeatedTable, units: string[]) => ({ file: "table.tsv", units, x: t.x, y: t.y, strata: t.x.map(() => "[]"), nuisance: [], covariates: {}, header: ["id", "donor_id", "x", "y", "unit_id"], rows: [] as string[][] });
for (const stream of ["path", "kernel"]) {
  const rng = randomStream(`v3-synthetic:${design.id}:${stream}`);
  const tally = { donor: 0, donorPathSeed: 0, row: 0 }, guarantees = new Set<string>();
  for (let k = 0; k < reps; k++) {
    const t = design.make(rng);
    const a = kernelDecision(claim, shape(t, t.units) as never, `v3-synthetic:${design.id}:decision:${k}`);
    const b = kernelDecision(claim, shape(t, t.units) as never, `v3-synthetic:${design.id}:${k}:software`);
    const c = kernelDecision(claim, shape(t, t.units.map((_, i) => `r${i}`)) as never, `v3-synthetic:${design.id}:row:${k}`);
    tally.donor += a.status === "reject" ? 1 : 0; tally.donorPathSeed += b.status === "reject" ? 1 : 0; tally.row += c.status === "reject" ? 1 : 0;
    guarantees.add(`donor: ${a.guarantee}`); guarantees.add(`row: ${c.guarantee}`);
  }
  console.log(JSON.stringify({ design: design.id, datasets: `${stream} stream`, reps, rejected: tally, wilsonDonor: wilson95(tally.donor, reps).map((v) => +v.toFixed(4)), wilsonRow: wilson95(tally.row, reps).map((v) => +v.toFixed(4)), guarantees: [...guarantees] }));
}
