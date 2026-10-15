// E7 load invariance: node packages/omb-calibration/scripts/load-invariance.ts
//   [--workers 8] [--quiet packages/omb-calibration/records/calibration.json] [--tasks a,b]
// Re-runs the calibration while `--workers` equal-priority busy loops run, then compares outcome
// fingerprints with the quiet run's records. Writes records/load-invariance.json.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { assertAnswerFree, compareOutcomes, gitHead, runCalibration, startBusyWorkers, type CertRecord } from "../src/index.ts";

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const workers = Number(flag("--workers") ?? 8);
const quietFile = path.resolve(flag("--quiet") ?? new URL("../records/calibration.json", import.meta.url).pathname);
const tasks = flag("--tasks")?.split(",");
const quiet = JSON.parse(readFileSync(quietFile, "utf8")) as { records: CertRecord[]; gitHead: string; machine: unknown; wallMs: number };
const scratch = mkdtempSync(path.join(process.env.OMB_V3_SCRATCH ?? os.tmpdir(), "omb-v3-load-"));
const head = gitHead(); // the commit whose code this process loaded
const busy = startBusyWorkers(workers, 90 * 60_000);
try {
  const startedAt = new Date().toISOString();
  const loadStart = os.loadavg();
  const run = await runCalibration({ scratch, ...(tasks ? { tasks } : {}), onRecord: (r) => console.log(`${r.task} ${r.analysis} ${r.mode}: ${r.claims.map((c) => `${c.id}=${c.status}`).join(" ")} exec=[${r.executions.map((e) => e.status).join(",")}] (${r.timing.certifyMs} ms)`) });
  const loadEnd = os.loadavg();
  busy.stop();
  const quietRecords = quiet.records.filter((r) => !tasks || tasks.includes(r.task));
  const diffs = compareOutcomes(quietRecords, run.records);
  const timing = run.records.map((r) => {
    const q = quietRecords.find((x) => x.task === r.task && x.analysis === r.analysis && x.mode === r.mode);
    return { task: r.task, analysis: r.analysis, mode: r.mode, quietMs: q?.timing.certifyMs ?? null, loadedMs: r.timing.certifyMs,
      quietExecutionMs: q?.timing.executionMs ?? [], loadedExecutionMs: r.timing.executionMs };
  });
  const doc = {
    schema: "omb-calibration/load-invariance@1", gitHead: head, quietGitHead: quiet.gitHead, startedAt, finishedAt: new Date().toISOString(),
    workers, machine: { cpus: os.cpus().length, loadStart: loadStart.map((v) => Math.round(v * 100) / 100), loadEnd: loadEnd.map((v) => Math.round(v * 100) / 100) },
    compared: run.records.length, identical: run.records.length - diffs.length, verdict: diffs.length === 0 ? "pass" : "fail",
    quietWallMs: quiet.wallMs, loadedWallMs: run.wallMs, diffs, timing, loadedRecords: run.records,
  };
  assertAnswerFree(doc);
  writeFileSync(new URL("../records/load-invariance.json", import.meta.url), JSON.stringify(doc, null, 2) + "\n");
  console.log(`\nE7 ${doc.verdict}: ${doc.identical}/${doc.compared} identical; quiet ${quiet.wallMs} ms, loaded ${run.wallMs} ms`);
  for (const d of diffs) console.log(`  DIFF ${d.key}\n    quiet:  ${d.quiet}\n    loaded: ${d.loaded}`);
} finally { busy.stop(); rmSync(scratch, { recursive: true, force: true }); }
