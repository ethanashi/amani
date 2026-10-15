/** Opt-in real-prefix benchmark, excluded from the fast deterministic test suite.
 * Run from the repo root with Node 24. All scratch/state stays in bio-guard.
 */
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { buildReexecutionRequest, investigationLayout, stageDataset } from "../src/index.ts";

const root = mkdtempSync(path.resolve("packages/bio-guard/.fixture-profile-"));
try {
  const layout = investigationLayout(root), home = path.join(root, "home"), stateRoot = path.join(root, "state");
  for (const dir of [layout.sealed, layout.work, layout.results, layout.report, home, stateRoot]) mkdirSync(dir, { mode: 0o700 });
  const sourcePath = path.join(root, "source.csv"), content = "x\n1\n";
  writeFileSync(sourcePath, content);
  const staged = stageDataset({ destination: layout.data, now: () => 1_700_000_000_000, files: [{
    sourcePath, path: "data.csv", source: "GEO", accession: "GSE123", url: "https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GSE123",
    terms: { access: "public", license: "GEO-public" }, retrievedAt: "2023-11-13T22:13:20.000Z",
    sha256: createHash("sha256").update(content).digest("hex"), bytes: Buffer.byteLength(content),
  }] });
  const prefix = path.resolve("packages/bio-baseline/.pixi/envs/default"), lockfile = path.resolve("packages/bio-baseline/pixi.lock");
  const output = path.join(layout.work, "out"); mkdirSync(output);
  const input = { layout, home, environmentRoots: [prefix], command: path.join(prefix, "bin/python"), args: ["--version"],
    toolPath: path.join(prefix, "bin"), timeoutMs: 1000, manifestSha256: staged.manifestSha256,
    environmentCache: { stateRoot, prefix, lockfile } };
  for (let trial = 0; trial < 6; trial++) {
    const start = performance.now();
    buildReexecutionRequest(input, output);
    console.log(JSON.stringify({ phase: trial === 0 ? "first" : "cached", trial, ms: performance.now() - start }));
  }
} finally { rmSync(root, { recursive: true, force: true }); }
