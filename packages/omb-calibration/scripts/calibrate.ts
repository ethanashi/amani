// Stage-0 calibration run (no AI arms): node packages/omb-calibration/scripts/calibrate.ts
//   [--tasks a,b] [--out packages/omb-calibration/records/calibration.json]
// Scratch lives under $OMB_V3_SCRATCH (default: the OS temp dir) and is deleted at the end.
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { assertAnswerFree, evaluateAblation, evaluateRecords, gitHead, readCards, runCalibration, TASKS_DIR, type CertRecord } from "../src/index.ts";

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const tasks = flag("--tasks")?.split(",");
const modes = flag("--modes")?.split(",") as ("adopt" | "locked")[] | undefined;
const variantName = flag("--variant");
if (variantName && !["omit-p", "raw-staging"].includes(variantName)) throw new Error("--variant must be omit-p or raw-staging");
const stagedOnly = args.includes("--staged-only");
// Checkpoint: every record is appended to <out>.partial.jsonl as it completes; a restart with the
// same --out resumes from it (same commit only), so an interruption never loses finished work.
const out = path.resolve(flag("--out") ?? new URL("../records/calibration.json", import.meta.url).pathname);
const scratch = mkdtempSync(path.join(process.env.OMB_V3_SCRATCH ?? os.tmpdir(), "omb-v3-cal-"));
const head = gitHead(); // the commit whose code this process loaded
const line = (r: CertRecord) => `${r.task} ${r.analysis} ${r.mode}: worker=${r.worker.status} plan=${r.planStatus} staging=${r.stagingAvailable ? "ok" : "unavailable"} exec=[${r.executions.map((e) => e.status).join(",")}] `
  + r.claims.map((c) => `${c.id}=${c.status}`).join(" ") + ` (${r.timing.certifyMs} ms)`;
try {
  const loadBefore = os.loadavg();
  const startedAt = new Date().toISOString();
  const partial = out + ".partial.jsonl";
  const done = existsSync(partial) ? readFileSync(partial, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as { gitHead: string; record: CertRecord })
    .filter((x) => x.gitHead === head).map((x) => x.record) : [];
  if (done.length) console.log(`resuming: ${done.length} certifications from ${path.basename(partial)}`);
  const run = await runCalibration({ scratch, ...(tasks ? { tasks } : {}), ...(modes ? { modes } : {}), done,
    ...(variantName ? { variant: { name: variantName, omitP: variantName === "omit-p", noDeclarations: variantName === "raw-staging" } } : {}), ...(stagedOnly ? { stagedOnly: true } : {}),
    onRecord: (r) => { console.log(line(r)); appendFileSync(partial, JSON.stringify({ gitHead: head, record: r }) + "\n"); } });
  const mismatches = variantName === "omit-p" ? evaluateAblation(run.records) : evaluateRecords(run.records, readCards(TASKS_DIR));
  const doc = {
    schema: "omb-calibration/records@1", gitHead: head, startedAt, finishedAt: new Date().toISOString(),
    machine: { cpus: os.cpus().length, loadBefore: loadBefore.map((v) => Math.round(v * 100) / 100), loadAfter: os.loadavg().map((v) => Math.round(v * 100) / 100) },
    wallMs: run.wallMs,
    stages: run.stages.map((s) => ({ task: s.task, ok: s.ok, ms: s.ms, reason: s.reason })),
    records: run.records, mismatches,
  };
  assertAnswerFree(doc);
  writeFileSync(out, JSON.stringify(doc, null, 2) + "\n");
  rmSync(partial, { force: true });
  console.log(`\n${run.records.length} certifications, ${mismatches.length} mismatches, ${run.wallMs} ms -> ${path.relative(process.cwd(), out)}`);
  for (const m of mismatches) console.log(`  ${m.rule} ${m.task} ${m.analysis} ${m.mode}${m.claim ? ` ${m.claim}` : ""}: expected ${m.expected}, got ${m.actual}`);
} finally { rmSync(scratch, { recursive: true, force: true }); }
