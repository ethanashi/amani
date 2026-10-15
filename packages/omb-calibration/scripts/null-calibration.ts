// E8/E9: node packages/omb-calibration/scripts/null-calibration.ts [--tasks p1-esr1,...] [--counts null=200,mei=40,large=20]
// Writes records/null-calibration.json (labels, kernel statuses, gate outcomes and timings only).
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  assertAnswerFree, buildCode, mergeHead, certifyRestaging, gitHead, NULL_DESIGN, NULL_DESIGN_A2, REPO, restageFingerprint, stageTask, summarize, TASKS_DIR, taskSpec, toolchain,
  type RestageRecord, type Variant,
} from "../src/index.ts";

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const only = flag("--tasks")?.split(",");
const counts: Record<Variant, number> = { ...NULL_DESIGN.counts };
for (const part of flag("--counts")?.split(",") ?? []) { const [k, v] = part.split("="); if (k && v && k in counts) counts[k as Variant] = Number(v); }
const out = path.resolve(flag("--out") ?? new URL("../records/null-calibration.json", import.meta.url).pathname);
const merge = flag("--merge")?.split(",");
const designName = flag("--design") ?? "preregistered";
if (!["preregistered", "a2"].includes(designName)) throw new Error("--design must be preregistered or a2");
const planMeiFlag = flag("--plan-mei");
const planMei = planMeiFlag === undefined ? undefined : Number(planMeiFlag);
if (planMei !== undefined && !(planMei > 0)) throw new Error("--plan-mei must be positive");
const DESIGN = designName === "a2" ? NULL_DESIGN_A2 : { ...NULL_DESIGN, omitP: false };
const tc = toolchain(REPO);
const headAtStart = gitHead();
const scratch = mkdtempSync(path.join(process.env.OMB_V3_SCRATCH ?? os.tmpdir(), "omb-v3-null-"));
const records: RestageRecord[] = [];
let startedAt = new Date().toISOString();
const t0 = performance.now();
let mergedWallMs = 0;
let partHead: string | null = null;
const partHeads: string[] = [];
try {
  // --merge a.json,b.json: combine partial runs (one process per task) into one record set.
  for (const file of merge ?? []) {
    const part = JSON.parse(readFileSync(file, "utf8")) as { records: RestageRecord[]; startedAt: string; wallMs: number; gitHead: string; design: { counts: Record<Variant, number> } };
    partHeads.push(part.gitHead);
    partHead = mergeHead(partHeads); // parts may start on commits that differ only in records
    records.push(...part.records);
    if (part.startedAt < startedAt) startedAt = part.startedAt;
    mergedWallMs = Math.max(mergedWallMs, part.wallMs);
    Object.assign(counts, part.design.counts);
  }
  for (const task of merge ? [] : DESIGN.tasks.filter((t) => !only || only.includes(t.task))) {
    const spec = taskSpec(task.task);
    const stage = stageTask(task.task, path.join(scratch, "stage", task.task), tc);
    if (!stage.ok) throw new Error(`${task.task}: ${stage.reason}`);
    const sourceTsv = readFileSync(path.join(stage.raw, "observations.tsv"), "utf8");
    const skeleton = path.join(scratch, "skeleton", task.task);
    buildCode(TASKS_DIR, spec, "reference", skeleton, { omitP: DESIGN.omitP });
    for (const variant of ["null", "mei", "large"] as const) {
      for (let k = 0; k < counts[variant]; k++) {
        const r = await certifyRestaging({ spec, task, variant, k, skeleton, sourceTsv, scratch, tc, sandboxSimulations: false, ...(planMei === undefined ? {} : { planMei }) });
        records.push(r);
        // Progress: every 20th re-staging and every confirmation, always with the running denominator
        // (printed lines alone are not a fair sample: confirmations are always printed).
        const done = records.filter((x) => x.task === task.task && x.variant === variant && !x.sandboxSimulations);
        if (k % 20 === 0 || r.status === "confirmed") console.log(`${task.task} ${variant} ${k}: ${r.status} kernel=${r.kernel} G5a=${r.gates.G5a ?? "-"} (${r.certifyMs} ms); running total ${done.filter((x) => x.status === "confirmed").length}/${done.length} confirmed`);
      }
    }
    for (let k = 0; k < Math.min(NULL_DESIGN.sandboxValidation, counts.null); k++) {
      const r = await certifyRestaging({ spec, task, variant: "null", k, skeleton, sourceTsv, scratch, tc, sandboxSimulations: true, ...(planMei === undefined ? {} : { planMei }) });
      records.push(r);
      console.log(`${task.task} null ${k} sandbox validation: ${r.status} (${r.certifyMs} ms, ${r.executions} executions)`);
    }
  }
  const tasks = [...new Set(records.map((r) => r.task))];
  const summaries = [...tasks.flatMap((t) => (["null", "mei", "large"] as const).map((v) => summarize(records, t, v))), summarize(records, "pooled", "null")];
  const validation = records.filter((r) => r.sandboxSimulations).map((v) => {
    const twin = records.find((r) => !r.sandboxSimulations && r.task === v.task && r.variant === v.variant && r.k === v.k);
    return { task: v.task, k: v.k, identical: !!twin && restageFingerprint(twin) === restageFingerprint(v), sandboxMs: v.certifyMs, inProcessMs: twin?.certifyMs ?? null };
  });
  const nulls = summaries.filter((s) => s.variant === "null");
  const verdicts = {
    E8: nulls.every((s) => s.pExceedsAlpha !== null && s.pExceedsAlpha > NULL_DESIGN.alpha && s.n >= 200) ? "pass" : "fail",
    E9_mei: summaries.filter((s) => s.variant === "mei").every((s) => s.n > 0 && s.rate >= 0.8) ? "pass" : "fail",
    E9_liveness: summaries.filter((s) => s.variant === "large").every((s) => s.n > 0 && s.rate >= 0.8) ? "pass" : "fail",
    sandboxValidation: validation.every((v) => v.identical) ? "pass" : "fail",
  };
  const doc = { schema: "omb-calibration/null-calibration@1", gitHead: partHead ?? headAtStart, startedAt, finishedAt: new Date().toISOString(),
    wallMs: merge ? mergedWallMs : Math.round(performance.now() - t0), ...(merge ? { mergedFrom: merge.map((f) => path.basename(f)), partHeads: [...new Set(partHeads)] } : {}), machine: { cpus: os.cpus().length, loadAfter: os.loadavg().map((v) => Math.round(v * 100) / 100) },
    design: { name: designName, omitP: DESIGN.omitP, planMei: planMei ?? null, tasks: merge ? [...new Map(records.map((r) => [r.task, { task: r.task, n: r.n ?? null }])).values()] : DESIGN.tasks, counts, alpha: NULL_DESIGN.alpha, meiShift: NULL_DESIGN.meiShift, largeShiftSd: NULL_DESIGN.largeShiftSd },
    verdicts, summaries, validation, records };
  assertAnswerFree(doc);
  writeFileSync(out, JSON.stringify(doc, null, 2) + "\n");
  console.log("\n" + JSON.stringify(verdicts));
  for (const s of summaries) console.log(`${s.task} ${s.variant}: ${s.confirmed}/${s.n} confirmed (${(100 * s.rate).toFixed(1)}%, 95% CI ${s.rateInterval.map((v) => (100 * v).toFixed(1)).join("-")}%), decided ${s.decided}${s.pExceedsAlpha === null ? "" : `, P(X>=k | alpha) = ${s.pExceedsAlpha.toFixed(3)}`}`);
} finally { rmSync(scratch, { recursive: true, force: true }); }
