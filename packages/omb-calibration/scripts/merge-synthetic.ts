// Merge A8 parts run as separate processes (kernel level; one path design each) into one record:
//   node packages/omb-calibration/scripts/merge-synthetic.ts --out records/synthetic-null.json kernel.json s1.json s3.json
// Kernel rows and S4 shapes come from the kernel part, path runs from the path parts; the path
// summary is re-derived from the merged runs. All parts must come from one commit.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { assertAnswerFree, mergeHead, syntheticPathSummary, type SyntheticPathRun } from "../src/index.ts";

const args = process.argv.slice(2);
const i = args.indexOf("--out");
if (i < 0 || !args[i + 1]) throw new Error("--out required");
const out = path.resolve(args[i + 1]!);
const files = args.filter((_, j) => j !== i && j !== i + 1);
interface Part { schema: string; gitHead: string; startedAt: string; finishedAt: string; wallMs: number; alpha: number; kernel: { design: string }[]; constant: unknown[]; pathRuns: SyntheticPathRun[] }
const parts = files.map((f) => JSON.parse(readFileSync(f, "utf8")) as Part);
const head = mergeHead(parts.map((p) => p.gitHead)); // parts may start on commits that differ only in records
const kernel = parts.flatMap((p) => p.kernel), constant = parts.flatMap((p) => p.constant), pathRuns = parts.flatMap((p) => p.pathRuns);
const designs = kernel.map((k) => k.design);
if (new Set(designs).size !== designs.length) throw new Error("overlapping kernel parts");
if (parts.filter((p) => p.constant.length).length > 1) throw new Error("S4 shapes in more than one part");
const runKeys = pathRuns.map((r) => `${r.design} ${r.k}`);
if (new Set(runKeys).size !== runKeys.length) throw new Error("overlapping path parts");
const doc = {
  schema: parts[0]!.schema, gitHead: head, partHeads: [...new Set(parts.map((p) => p.gitHead))],
  startedAt: parts.map((p) => p.startedAt).sort()[0], finishedAt: parts.map((p) => p.finishedAt).sort().at(-1),
  wallMs: parts.reduce((a, p) => a + p.wallMs, 0), alpha: parts[0]!.alpha,
  kernel, constant, pathSummary: syntheticPathSummary(pathRuns), pathRuns, mergedFrom: files.map((f) => path.basename(f)),
};
assertAnswerFree(doc);
writeFileSync(out, JSON.stringify(doc, null, 2) + "\n");
console.log(`${kernel.length} kernel designs, ${constant.length} S4 shapes, ${pathRuns.length} path runs -> ${out}`);
