// Amendment A8: repeated-measures null designs (kernel level and full certify path).
//   node packages/omb-calibration/scripts/synthetic-null.ts [--level kernel|path|all] [--designs S1,S3] [--out FILE]
// Records counts, rates and Wilson intervals only (no data values).
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { kernelDecision } from "../../omb-certify/src/producers.ts";
import { randomStream } from "../../omb-certify/src/monte-carlo.ts";
import { parsePlan } from "../../omb-gauntlet/src/index.ts";
import {
  ASSETS, assertAnswerFree, certifyAnalysis, CONSTANT_SHAPES, constantTable, gitHead, inProcessReference, primarySpecPy, readJson, REPO, RUN_ALL, standInGates,
  SYNTHETIC_ANALYSIS_PY, SYNTHETIC_DESIGNS, syntheticPlan, tableTsv, toolchain, workerRun, type RepeatedTable, type TaskSpec,
} from "../src/index.ts";

const args = process.argv.slice(2);
const flag = (name: string, d?: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : d; };
const level = flag("--level", "all")!;
const only = flag("--designs")?.split(",");
const out = path.resolve(flag("--out", new URL("../records/synthetic-null.json", import.meta.url).pathname)!);
const head = gitHead();
const wilson = (k: number, n: number): [number, number] => {
  if (n === 0) return [0, 1];
  const p = k / n, z = 1.959963984540054, den = 1 + z * z / n, c = (p + z * z / (2 * n)) / den, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den;
  return [Math.max(0, c - h), Math.min(1, c + h)];
};
const claimFor = (direction: "greater" | "two-sided") => parsePlan(JSON.stringify(syntheticPlan(direction))).plan!.claims[0]!;
const dataOf = (t: RepeatedTable) => ({ file: "table.tsv", units: t.units, x: t.x, y: t.y, strata: t.x.map(() => "[]"), nuisance: [], covariates: {}, header: ["id", "donor_id", "x", "y", "unit_id"], rows: [] as string[][] });

const kernel: unknown[] = [];
const constant: unknown[] = [];
const pathRuns: { design: string; k: number; status: string; outcome: string; kernel: string | null; gates: Record<string, string>; worker: string; certifyMs: number }[] = [];
const startedAt = new Date().toISOString(), t0 = performance.now();
if (level === "kernel" || level === "all") {
  for (const d of SYNTHETIC_DESIGNS.filter((x) => !only || only.includes(x.id))) {
    const claim = claimFor(d.direction), rng = randomStream(`v3-synthetic:${d.id}:kernel`), stops = new Set<string>(), guarantees = new Set<string>();
    let rejects = 0;
    const t1 = performance.now();
    for (let i = 0; i < d.kernelReps; i++) {
      const r = kernelDecision(claim, dataOf(d.make(rng)) as never, `v3-synthetic:${d.id}:decision:${i}`);
      if (r.status === "reject") rejects++;
      stops.add(r.stopping); guarantees.add(r.guarantee);
    }
    const row = { design: d.id, description: d.description, direction: d.direction, nulls: d.kernelReps, rejected: rejects, rate: rejects / d.kernelReps, wilson95: wilson(rejects, d.kernelReps),
      stopping: [...stops].sort(), guarantee: [...guarantees].sort(), seconds: Math.round((performance.now() - t1) / 1000) };
    kernel.push(row); console.log(JSON.stringify(row));
  }
  for (const s of CONSTANT_SHAPES) {
    const r = kernelDecision(claimFor(s.direction), dataOf(constantTable(s)) as never, "v3-synthetic:S4");
    // "level" (the synthetic constant), not "value": assertAnswerFree refuses any field named value.
    constant.push({ level: s.value, units: s.units, controls: s.controls, direction: s.direction, rejected: r.status === "reject", status: r.status, stopping: r.stopping });
  }
  const bad = (constant as { rejected: boolean }[]).filter((c) => c.rejected).length;
  console.log(JSON.stringify({ design: "S4", shapes: constant.length, rejected: bad }));
}
if (level === "path" || level === "all") {
  const tc = toolchain(REPO), scratch = mkdtempSync(path.join(process.env.OMB_V3_SCRATCH ?? os.tmpdir(), "omb-v3-syn-"));
  const spec: TaskSpec = { id: "synthetic", claims: [{ id: "effect", plan: {} }], reference: { mode: "workdir-rule", method: "" }, flaw: null, referenceExpected: { effect: ["tentative"] }, rationale: "A8" };
  try {
    const skeleton = path.join(scratch, "skeleton");
    mkdirSync(path.join(skeleton, "code", "omb"), { recursive: true });
    writeFileSync(path.join(skeleton, "code", "analysis.py"), SYNTHETIC_ANALYSIS_PY);
    writeFileSync(path.join(skeleton, "code", "omb", "original_run_all.sh"), "#!/usr/bin/env bash\nset -euo pipefail\nsource ./env.sh\npython code/analysis.py\n");
    cpSync(path.join(ASSETS, "omb_primary.py"), path.join(skeleton, "code", "omb", "omb_primary.py"));
    writeFileSync(path.join(skeleton, "code", "omb", "primary_spec.py"), primarySpecPy(spec, { omitP: true }));
    writeFileSync(path.join(skeleton, "run_all.sh"), RUN_ALL);
    for (const d of SYNTHETIC_DESIGNS.filter((x) => (!only || only.includes(x.id)) && x.pathReps > 0)) {
      const rng = randomStream(`v3-synthetic:${d.id}:path`), planJson = syntheticPlan(d.direction);
      for (let k = 0; k < d.pathReps; k++) {
        const base = mkdtempSync(path.join(scratch, "re-")), raw = path.join(base, "raw"), work = path.join(base, "work");
        try {
          mkdirSync(raw); writeFileSync(path.join(raw, "table.tsv"), tableTsv(d.make(rng)));
          cpSync(skeleton, work, { recursive: true });
          const staging = planJson.staging as never;
          const worker = await workerRun(work, raw, "locked", base, tc, undefined, staging);
          writeFileSync(path.join(work, "plan.json"), JSON.stringify(planJson, null, 2) + "\n");
          const plan = parsePlan(readJson(path.join(work, "plan.json"))).plan!;
          const id = `v3-synthetic:${d.id}:${k}`;
          const { record } = await certifyAnalysis({ spec, analysis: "reference", mode: "locked", work, raw, scratch: base, tc, worker, executionId: id,
            simulationFactory: inProcessReference(plan.claims), externalGates: standInGates(["effect"], id) });
          const c = record.claims.find((x) => x.id === "effect");
          pathRuns.push({ design: d.id, k, status: c?.status ?? "missing", outcome: c?.outcome ?? "missing", kernel: c?.kernel?.status ?? null,
            gates: Object.fromEntries(Object.entries(c?.gates ?? {}).map(([g, s]) => [g, `${s!.outcome}${s!.passed ? "+" : ""}${s!.code ? `(${s!.code})` : ""}`])), worker: worker.status, certifyMs: record.timing.certifyMs });
          const done = pathRuns.filter((r) => r.design === d.id);
          if (k % 20 === 0 || c?.status === "confirmed") console.log(`${d.id} ${k}: ${c?.status} kernel=${c?.kernel?.status ?? "-"} (${record.timing.certifyMs} ms); running ${done.filter((r) => r.status === "confirmed").length}/${done.length} confirmed`);
        } finally { rmSync(base, { recursive: true, force: true }); }
      }
    }
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}
const pathSummary = SYNTHETIC_DESIGNS.filter((d) => d.pathReps > 0).map((d) => {
  const rs = pathRuns.filter((r) => r.design === d.id), confirmed = rs.filter((r) => r.status === "confirmed" || r.status === "replicated").length;
  const rejects = rs.filter((r) => r.kernel === "reject").length;
  return { design: d.id, reStagings: rs.length, confirmed, rate: rs.length ? confirmed / rs.length : 0, wilson95: wilson(confirmed, rs.length), kernelRejected: rejects, kernelWilson95: wilson(rejects, rs.length) };
}).filter((s) => s.reStagings > 0);
const doc = { schema: "omb-calibration/synthetic-null@1", gitHead: head, startedAt, finishedAt: new Date().toISOString(), wallMs: Math.round(performance.now() - t0), alpha: 0.05,
  kernel, constant, pathSummary, pathRuns };
assertAnswerFree(doc);
writeFileSync(out, JSON.stringify(doc, null, 2) + "\n");
console.log(JSON.stringify(pathSummary));

