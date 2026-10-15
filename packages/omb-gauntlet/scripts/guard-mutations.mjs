#!/usr/bin/env node
// Guard mutations for packages/omb-gauntlet: weaken one guard at a time in src/, run the tests and
// record whether they fail (the mutation is "killed"). Every file is restored after each mutation,
// and the script refuses to start when src/ has uncommitted changes (so `git checkout` can always
// restore it). Usage, from the repo root:
//   node packages/omb-gauntlet/scripts/guard-mutations.mjs          # each mutation vs its targeted test file
//   node packages/omb-gauntlet/scripts/guard-mutations.mjs --full   # each mutation vs the whole package suite
// Writes packages/omb-gauntlet/GUARD-MUTATIONS.json.

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.resolve(pkgDir, "../..");
const rel = path.relative(root, pkgDir);
const full = process.argv.includes("--full");

const mutations = [
  { id: "deep-lock-truncation-allowed", file: "plan.ts", test: "review.test.ts",
    find: "if (!withinLockDepth(value)) {", replace: "if (false) {" },
  { id: "not-run-counts-as-passed", file: "gates.ts", test: "labels.test.ts",
    find: "if (first.outcome !== \"passed\") return { gate, outcome: first.outcome, result: first, passed: false, reason: null };",
    replace: "if (first.outcome !== \"passed\") return { gate, outcome: first.outcome, result: first, passed: first.outcome === \"not-run\", reason: null };" },
  { id: "effect-confirm-without-look", file: "labels.ts", test: "labels.test.ts",
    find: "const EFFECT: readonly GateId[] = [\"G1a\", \"G1c\", \"G2\", \"G3\", \"G4\", \"G5a\", \"G6\", \"G7\", \"G8\"];",
    replace: "const EFFECT: readonly GateId[] = [\"G1a\", \"G1c\", \"G2\", \"G3\", \"G4\", \"G5a\", \"G6\", \"G7\"];" },
  { id: "refuted-without-power", file: "labels.ts", test: "labels.test.ts",
    find: "const REFUTE: readonly GateId[] = [\"G1a\", \"G2\", \"G3\", \"G4\", \"G5b-power\", \"G7\", \"G8\"];",
    replace: "const REFUTE: readonly GateId[] = [\"G1a\", \"G2\", \"G3\", \"G4\", \"G7\", \"G8\"];" },
  { id: "power-evidence-rule-dropped", file: "gates.ts", test: "labels.test.ts",
    find: "e.power >= POLICY.powerThreshold", replace: "e.power >= 0" },
  { id: "same-family-replication-counts", file: "gates.ts", test: "gates.test.ts",
    find: "if (families[0] === families[1]) return \"same-family agreement counts as zero\";", replace: "" },
  { id: "exploratory-claims-confirmable", file: "labels.ts", test: "labels.test.ts",
    find: "if (claim.exploratory) return done(\"exploratory\", [\"declared exploratory in the plan\"]);", replace: "" },
  { id: "unverified-numbers-tentative", file: "labels.ts", test: "labels.test.ts",
    find: "if (failing.length > 0) return done(\"insufficient-evidence\"", replace: "if (failing.length < 0) return done(\"insufficient-evidence\"" },
  { id: "alpha-loosening-accepted", file: "plan.ts", test: "plan.test.ts",
    find: "if (n > POLICY.alphaMax) {", replace: "if (false) {" },
  { id: "bh-without-screen", file: "plan.ts", test: "plan.test.ts",
    find: "if (method === \"bh\" && !(screen && size >= POLICY.bhMinScreen)) {", replace: "if (false) {" },
  { id: "repeated-units-accepted", file: "units.ts", test: "units.test.ts",
    find: "if (repeatedIds.length > 0) {", replace: "if (false) {" },
  { id: "non-effective-units-accepted", file: "units.ts", test: "units.test.ts",
    find: "if (outside > 0) findings.push({ code: \"non-effective-units\", count: outside, detail: `${outside} listed unit(s) are not software effective units` });", replace: "" },
  { id: "n-units-count-mismatch-accepted", file: "units.ts", test: "units.test.ts",
    find: "else if (input.unitsTsv !== null && nUnits !== rows)", replace: "else if (false)" },
  { id: "one-sided-sign-ignored", file: "decision.ts", test: "decision.test.ts",
    find: "const sideOk = claim.direction === \"two-sided\" || observedDirection === claim.direction;", replace: "const sideOk = true;" },
  { id: "multiplicity-bypassed", file: "decision.ts", test: "decision.test.ts",
    find: "const pAdjusted = claim.exploratory ? entry.p : adjusted.get(claim.id) ?? null;", replace: "const pAdjusted = entry.p;" },
  { id: "g5a-pass-threshold-loosened", file: "policy.ts", test: "adapters.test.ts",
    find: "passMax: 14", replace: "passMax: 19" },
  { id: "g4-tolerance-cap-removed", file: "gates-pure.ts", test: "gates.test.ts",
    find: "const rel = Math.min(Math.max(requested, 0), POLICY.g4RelativeTolerance);", replace: "const rel = Math.max(requested, 0);" },
  { id: "g3-display-precision-cap-removed", file: "gates-pure.ts", test: "gates.test.ts",
    find: "return diff <= half * (1 + 1e-9) && half <= precisionCap * Math.abs(recomputed);", replace: "return diff <= half * (1 + 1e-9);" },
  { id: "g2-hash-not-compared", file: "gates-pure.ts", test: "gates.test.ts",
    find: "if (current !== input.lock.planHash)", replace: "if (false)" },
  { id: "denied-canary-is-hard-stop", file: "routing.ts", test: "routing.test.ts",
    find: "if (event.denied === true || event.insideDenial === true)", replace: "if (false)" },
  { id: "strong-confounder-unhandled-ignored", file: "adapters.ts", test: "adapters.test.ts",
    find: "const unhandled = strong.filter((c) => !handled.has(foldKey(c)));", replace: "const unhandled: string[] = [];" },
  { id: "typed-number-after-symbol-allowed", file: "prose.ts", test: "prose.test.ts",
    find: "if (/\\p{L}$/u.test(before) || /\\p{L}[-_]$/u.test(before)) return true;", replace: "if (/\\S$/u.test(before)) return true;" },
];

const dirty = spawnSync("git", ["status", "--porcelain", "--", `${rel}/src`], { cwd: root, encoding: "utf8" });
if (dirty.status !== 0 || dirty.stdout.trim() !== "") {
  console.error("refusing to mutate: commit or stash changes under src/ first");
  process.exit(2);
}

const vitest = path.join(root, "node_modules/.bin/vitest");
const results = [];
for (const m of mutations) {
  const file = path.join(pkgDir, "src", m.file);
  const original = readFileSync(file, "utf8");
  const occurrences = original.split(m.find).length - 1;
  const target = full ? `${rel}/test` : `${rel}/test/${m.test}`;
  if (occurrences !== 1) {
    results.push({ mutation: m.id, file: `src/${m.file}`, test: target, killed: false, error: `find string occurs ${occurrences} times` });
    continue;
  }
  try {
    writeFileSync(file, original.replace(m.find, m.replace));
    const run = spawnSync(vitest, ["run", target], { cwd: root, encoding: "utf8", env: process.env });
    const output = `${run.stdout}\n${run.stderr}`;
    const failedTests = [...new Set(output.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("FAIL ")).map((l) => l.replace(/\s+/g, " ")))];
    results.push({ mutation: m.id, file: `src/${m.file}`, test: target, killed: run.status !== 0 && failedTests.length > 0 && /AssertionError/.test(output), failedTests });
    console.log(`${run.status !== 0 ? "killed  " : "SURVIVED"} ${m.id}`);
  } finally {
    writeFileSync(file, original);
  }
}
const clean = spawnSync("git", ["diff", "--quiet", "--", `${rel}/src`], { cwd: root });
writeFileSync(path.join(pkgDir, "GUARD-MUTATIONS.json"), `${JSON.stringify({ mode: full ? "full package suite" : "targeted test file", sourceRestored: clean.status === 0, mutations: results }, null, 2)}\n`);
const survived = results.filter((r) => !r.killed);
console.log(`${results.length - survived.length}/${results.length} killed; source restored: ${clean.status === 0}`);
process.exit(survived.length === 0 && clean.status === 0 ? 0 : 1);
