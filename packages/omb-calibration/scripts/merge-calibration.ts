// Merge calibration parts run as parallel processes (disjoint task lists) into one record:
//   node packages/omb-calibration/scripts/merge-calibration.ts --out records/calibration.json a.json b.json
// Records are ordered by the spec order; mismatches are re-derived from the merged records.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { assertAnswerFree, mergeHead, evaluateAblation, evaluateRecords, readCards, TASK_SPECS, TASKS_DIR, type CertRecord } from "../src/index.ts";

const args = process.argv.slice(2);
const i = args.indexOf("--out");
if (i < 0 || !args[i + 1]) throw new Error("--out required");
const out = path.resolve(args[i + 1]!);
const files = args.filter((_, j) => j !== i && j !== i + 1);
interface Part { schema: string; gitHead: string; startedAt: string; finishedAt: string; machine: { cpus: number; loadBefore: number[]; loadAfter: number[] }; wallMs: number; stages: { task: string; ok: boolean; ms: number; reason: string }[]; records: CertRecord[] }
const parts = files.map((f) => JSON.parse(readFileSync(f, "utf8")) as Part);
const head = mergeHead(parts.map((p) => p.gitHead)); // parts may start on commits that differ only in records
const order = (task: string) => TASK_SPECS.findIndex((s) => s.id === task);
const records = parts.flatMap((p) => p.records).sort((a, b) => order(a.task) - order(b.task));
const keys = records.map((r) => `${r.task} ${r.analysis} ${r.mode}`);
if (new Set(keys).size !== keys.length) throw new Error("overlapping parts");
const variant = records.some((r) => r.variant === "omit-p");
const doc = {
  schema: parts[0]!.schema, gitHead: head, partHeads: [...new Set(parts.map((p) => p.gitHead))],
  startedAt: parts.map((p) => p.startedAt).sort()[0], finishedAt: parts.map((p) => p.finishedAt).sort().at(-1),
  machine: { cpus: parts[0]!.machine.cpus, loadBefore: parts[0]!.machine.loadBefore, loadAfter: parts.at(-1)!.machine.loadAfter, parallelParts: parts.length },
  wallMs: Math.max(...parts.map((p) => p.wallMs)),
  stages: parts.flatMap((p) => p.stages).sort((a, b) => order(a.task) - order(b.task)),
  records, mismatches: variant ? evaluateAblation(records) : evaluateRecords(records, readCards(TASKS_DIR)),
  mergedFrom: files.map((f) => path.basename(f)),
};
assertAnswerFree(doc);
writeFileSync(out, JSON.stringify(doc, null, 2) + "\n");
console.log(`${records.length} records, ${doc.mismatches.length} mismatches -> ${out}`);
