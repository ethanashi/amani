// Diagnostic for the A2 null rate: the trusted kernel decision alone (no sandbox, no other gate)
// on many synthetic null re-stagings built by the same restage() as the certify-path calibration.
//   node packages/omb-calibration/scripts/kernel-null-diagnostic.ts --task p1-esr1 --n 16 --reps 2000
// Prints only counts and rates (no data values).
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { kernelDecision } from "../../omb-certify/src/producers.ts";
import { parsePlan } from "../../omb-gauntlet/src/index.ts";
import { buildPlan, clopperPearson, exceedsAlphaP, restage, stageTask, taskSpec, toolchain, REPO } from "../src/index.ts";

const args = process.argv.slice(2);
const flag = (name: string, d: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1]! : d; };
const task = flag("--task", "p1-esr1"), n = Number(flag("--n", "16")), reps = Number(flag("--reps", "2000")), adjust = flag("--adjust", "");
const tc = toolchain(REPO), scratch = mkdtempSync(path.join(process.env.OMB_V3_SCRATCH ?? os.tmpdir(), "omb-v3-diag-"));
try {
  const st = stageTask(task, path.join(scratch, "stage"), tc);
  const source = readFileSync(path.join(st.raw, "observations.tsv"), "utf8");
  const claim = parsePlan(JSON.stringify(buildPlan(taskSpec(task), { analysis: { covariates: adjust ? adjust.split(",") : [] } }))).plan!.claims[0]!;
  let rejects = 0, mc = 0;
  const t0 = performance.now();
  for (let k = 0; k < reps; k++) {
    const text = restage(source, { task, n, outcome: "expression" }, "null", 100_000 + k);
    const lines = text.trim().split("\n"), header = lines[0]!.split("\t"), rows = lines.slice(1).map((l) => l.split("\t"));
    const col = (c: string) => rows.map((r) => r[header.indexOf(c)]!);
    const covariates = adjust ? Object.fromEntries(adjust.split(",").map((c) => [c, [col(c).map(Number)]])) : {};
    const data = { file: "observations.tsv", units: col("sample_id"), x: col("exposure").map(Number), y: col("expression").map(Number), strata: rows.map(() => "[]"),
      nuisance: adjust ? adjust.split(",").map((c) => col(c).map(Number)) : [], covariates, header, rows };
    const r = kernelDecision(claim, data as never, `diag:${task}:${n}:${k}`);
    if (r.status === "reject") rejects++;
    if (r.stopping.startsWith("monte-carlo")) mc++;
  }
  const [lo, hi] = clopperPearson(rejects, reps);
  console.log(JSON.stringify({ task, n, reps, adjust: adjust || null, monteCarloDecisions: mc, kernelRejects: rejects, rate: rejects / reps,
    ci95: [lo, hi], pExceedsAlpha: exceedsAlphaP(rejects, reps, 0.05), seconds: Math.round((performance.now() - t0) / 1000) }));
} finally { rmSync(scratch, { recursive: true, force: true }); }
