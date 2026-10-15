// Deterministic deliverables for V3: the task's own reference or naive code, wrapped so that
// `omb certify` finds the layout the kernel expects (plan.json, run_all.sh invoking the software
// prepare.sh, outputs/primary.json, outputs/units.tsv). The analysis code itself is copied
// byte-for-byte; the wrapper files are identical for every task.

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ClaimSpec, JsonValue, Pointer, TaskSpec } from "./specs.ts";

export const ASSETS = new URL("../assets/", import.meta.url).pathname;
const HOST_PYTHON = path.resolve(ASSETS, "..", "..", "bio-baseline", ".pixi", "envs", "default", "bin", "python");

/** Host build step: the task's reference.py with truth-dependent main() statements removed
 * (assets/omb_truthfree.py, ast.unparse). The deliverable then needs no dynamic execution. */
export function truthFree(reference: string, out: string): void {
  const r = spawnSync(HOST_PYTHON, ["-I", "-B", path.join(ASSETS, "omb_truthfree.py"), reference, out], { encoding: "utf8", timeout: 60_000 });
  if (r.status !== 0) throw new Error(`truth-free transform failed for ${reference}: ${r.stderr.slice(-300)}`);
}

/** The wrapper every deliverable uses. G1a requires run_all.sh to invoke the software prepare.sh. */
export const RUN_ALL = `#!/bin/sh
# V3 calibration wrapper (generated, identical for every task): software prepare, then the
# analysis exactly as written, then the generic primary wrapper.
set -eu
sh ./prepare.sh
/bin/bash code/omb/original_run_all.sh
python code/omb/omb_primary.py
`;

/** The reference_support.py workdir rule (p1-esr1/reference_support.py writes exactly this). */
export const workdirRuleRunAll = (task: string): string =>
  `#!/usr/bin/env bash\nset -euo pipefail\nsource ./env.sh\npython code/analysis.py ${task}\n`;

export const RUNNER_RUN_ALL = `#!/usr/bin/env bash
# V3 generic reference runner: the task's reference.py main() without generator truth.
set -euo pipefail
source ./env.sh
mkdir -p outputs
python code/omb/omb_reference_runner.py
`;

/** Every analysis of a task: the reference, the naive fixture and each naive variant. */
export function listAnalyses(tasksDir: string, task: string): string[] {
  const out = ["reference", "naive"];
  const variants = path.join(tasksDir, task, "naive", "variants");
  if (existsSync(variants)) for (const name of readdirSync(variants).sort()) if (statSync(path.join(variants, name)).isDirectory()) out.push(`naive/variants/${name}`);
  return out;
}

const ignore = (src: string) => !/(^|\/)(__pycache__|\.DS_Store)(\/|$)/.test(src) && !src.endsWith(".pyc");

export interface CodeOptions {
  /** Amendment A2 / ablation: the V2b worker contract lets a Monte Carlo claim omit p; the wrapper
   * then copies every number except the p-value. Default: copy all numbers (pre-registered). */
  readonly omitP?: boolean;
}

/** Write code/, code/omb/* and run_all.sh for one analysis into `dest` (must not exist). */
export function buildCode(tasksDir: string, spec: TaskSpec, analysis: string, dest: string, options: CodeOptions = {}): void {
  if (existsSync(dest)) throw new Error(`deliverable destination exists: ${dest}`);
  mkdirSync(path.join(dest, "code", "omb"), { recursive: true });
  const omb = path.join(dest, "code", "omb");
  if (analysis === "reference") {
    if (spec.reference.mode === "workdir-rule") {
      cpSync(path.join(tasksDir, spec.reference.method), path.join(dest, "code", "analysis.py"));
      writeFileSync(path.join(omb, "original_run_all.sh"), workdirRuleRunAll(spec.id));
    } else {
      for (const [to, from] of Object.entries(spec.reference.files)) {
        mkdirSync(path.dirname(path.join(omb, to)), { recursive: true });
        if (to === "reference/reference.py") truthFree(path.join(tasksDir, from), path.join(omb, "reference", "reference_truthfree.py"));
        else cpSync(path.join(tasksDir, from), path.join(omb, to));
      }
      cpSync(path.join(ASSETS, "omb_reference_runner.py"), path.join(omb, "omb_reference_runner.py"));
      cpSync(path.join(ASSETS, "stubs"), path.join(omb, "stubs"), { recursive: true, filter: ignore });
      writeFileSync(path.join(omb, "original_run_all.sh"), RUNNER_RUN_ALL);
    }
  } else {
    const src = path.join(tasksDir, spec.id, analysis);
    if (!existsSync(path.join(src, "run_all.sh"))) throw new Error(`${spec.id}/${analysis}: no run_all.sh`);
    if (existsSync(path.join(src, "code"))) cpSync(path.join(src, "code"), path.join(dest, "code"), { recursive: true, filter: ignore });
    cpSync(path.join(src, "run_all.sh"), path.join(omb, "original_run_all.sh"));
    if (existsSync(path.join(src, "REPORT.md"))) cpSync(path.join(src, "REPORT.md"), path.join(dest, "REPORT.md"));
  }
  cpSync(path.join(ASSETS, "omb_primary.py"), path.join(omb, "omb_primary.py"));
  writeFileSync(path.join(omb, "primary_spec.py"), primarySpecPy(spec, options));
  writeFileSync(path.join(dest, "run_all.sh"), RUN_ALL);
}

/** The task-level mapping for omb_primary.py, as Python source (freeze refuses JSON in code/). */
export function primarySpecPy(spec: TaskSpec, options: CodeOptions = {}): string {
  const claims = spec.claims.map((c) => ({ id: c.id, p: options.omitP ? null : c.p ?? null, estimateFrom: c.estimateFrom ?? null, nUnitsFrom: c.nUnitsFrom ?? null }));
  return `"""Generated task mapping for omb_primary.py (${spec.id})."""\nimport json\n\nSPEC = json.loads(${JSON.stringify(JSON.stringify({ task: spec.id, claims }))})\n`;
}

export function resolvePointer(doc: unknown, pointer: Pointer): unknown {
  let cur: unknown = doc;
  for (let step of pointer) {
    if (typeof step === "object") {
      const key = resolvePointer(doc, step.from);
      if (typeof key !== "string") return undefined;
      step = key;
    }
    if (typeof step === "string" && cur !== null && typeof cur === "object" && !Array.isArray(cur) && Object.hasOwn(cur, step)) cur = (cur as Record<string, unknown>)[step];
    else if (typeof step === "number" && Array.isArray(cur) && step >= 0 && step < cur.length) cur = cur[step];
    else return undefined;
  }
  return cur;
}

const finiteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** plan.json for one analysis: task-level claim fields plus only what the analysis itself reports
 * (adjustment covariates, asserted integrity values, family sizes). Deterministic key order. */
export function buildPlan(spec: TaskSpec, results: unknown, staging?: Readonly<Record<string, unknown>>): { staging?: Record<string, JsonValue>; claims: Record<string, JsonValue>[] } {
  const claims = spec.claims.map((c: ClaimSpec) => {
    const plan: Record<string, JsonValue> = { id: c.id, ...structuredClone(c.plan) as Record<string, JsonValue> };
    if (c.adjustmentFrom) {
      const cov = resolvePointer(results, c.adjustmentFrom);
      const adjustment = Array.isArray(cov) ? cov.filter((v): v is string => typeof v === "string") : [];
      plan.adjustment = adjustment;
      // Kernel vocabulary for additive linear coefficients: adjusted claims are Freedman-Lane.
      plan.test = adjustment.length > 0 ? "freedman-lane" : "linear";
    }
    if (c.assertedFrom) {
      const v = resolvePointer(results, c.assertedFrom);
      if (finiteNumber(v)) plan.value = v;
    }
    if (c.familySizeFrom) {
      const n = resolvePointer(results, c.familySizeFrom);
      const family = (plan.family && typeof plan.family === "object" && !Array.isArray(plan.family) ? { ...plan.family } : {}) as Record<string, JsonValue>;
      if (finiteNumber(n) && Number.isSafeInteger(n) && n >= 1) family.size = n;
      plan.family = family;
    }
    return plan;
  });
  // Kernel v3 (K2b, paper design §17 item 11): every locked plan carries a plain-language statement and
  // its paper set; the certifier hard-stops a locked plan without them.
  const context: Record<string, JsonValue> = {
    plain_statement: `Calibration reference analysis for task ${spec.id}: ${spec.rationale}`.slice(0, 2000),
    paper_set: spec.claims.map((c: ClaimSpec) => c.id),
  };
  return staging && Object.keys(staging).length ? { ...context, staging: structuredClone(staging) as Record<string, JsonValue>, claims } : { ...context, claims };
}

export function readJson(file: string): unknown {
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { return null; }
}
