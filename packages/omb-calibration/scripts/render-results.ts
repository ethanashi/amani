// Renders RESULTS.md from the V2d records (node packages/omb-calibration/scripts/render-results.ts).
import { readFileSync, writeFileSync } from "node:fs";
import { renderResults } from "../src/index.ts";
const load = (n: string) => JSON.parse(readFileSync(new URL(`../records/${n}`, import.meta.url), "utf8"));
writeFileSync(new URL("../RESULTS.md", import.meta.url), renderResults({ cal: load("calibration.json"), prior: load("calibration-v2r2.json"), v2c: load("v2c/calibration.json"),
  nul: load("null-calibration.json"), a2: load("null-calibration-a2.json"), a9: load("null-calibration-a9.json"), v2cA9: load("v2c/null-calibration-a9.json"), v2bA2: load("v2b/null-calibration-a2-p1-p2.json"),
  load: load("load-invariance.json"), ablation: load("ablation-omit-p.json"), rawStaging: load("raw-staging.json"), synthetic: load("synthetic-null.json") }));
