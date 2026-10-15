// The stage-0 calibration loop: stage each task with its own stage.py, build every reference and
// naive deliverable, run the worker, write the plan, certify in adopt and locked modes.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { buildCode, listAnalyses } from "./deliverable.ts";
import { certifyAnalysis, toolchain, workerRun, writePlan, type CertRecord, type Mode, type Toolchain } from "./run.ts";
import { TASK_SPECS, type TaskSpec } from "./specs.ts";
import { generateDeclarations } from "./declarations.ts";
import type { StageDeclarations } from "../../omb-certify/src/declared-stage.ts";

export const REPO = path.resolve(new URL("../../../", import.meta.url).pathname);
export const TASKS_DIR = path.join(REPO, "packages", "bio-tasks", "tasks");

export interface StageResult { readonly task: string; readonly ok: boolean; readonly raw: string; readonly ms: number; readonly reason: string }

/** Stage a task with its own stage.py (no truth) and verify the manifest pin from card.json. */
export function stageTask(task: string, dest: string, tc: Toolchain): StageResult {
  const t0 = performance.now();
  const r = spawnSync(path.join(tc.pixiEnv, "bin", "python"), [path.join(TASKS_DIR, task, "stage.py"), "--out", dest],
    { encoding: "utf8", timeout: 600_000, env: { ...process.env, BIO_GRADING_ROOT: tc.gradingRoot } });
  const ms = Math.round(performance.now() - t0);
  if (r.status !== 0) return { task, ok: false, raw: path.join(dest, "data"), ms, reason: `stage.py exit ${r.status}` };
  const card = JSON.parse(readFileSync(path.join(TASKS_DIR, task, "card.json"), "utf8")) as { datasetManifestHash: string };
  const pin = createHash("sha256").update(readFileSync(path.join(dest, "manifest.json"))).digest("hex");
  if (pin !== card.datasetManifestHash) return { task, ok: false, raw: path.join(dest, "data"), ms, reason: "staged manifest differs from the card pin" };
  return { task, ok: true, raw: path.join(dest, "data"), ms, reason: "" };
}

export interface CalibrationOptions {
  readonly scratch: string;
  readonly tasks?: readonly string[];
  readonly modes?: readonly Mode[];
  readonly analyses?: (task: string) => readonly string[];
  readonly onRecord?: (r: CertRecord) => void;
  /** Reuse staged task directories from an earlier pass (load invariance reuses the quiet pass's). */
  readonly staged?: ReadonlyMap<string, StageResult>;
  /** Ablation: build deliverables with the omit-p wrapper and tag records with this variant. */
  readonly variant?: { readonly name: string; readonly omitP: boolean; readonly noDeclarations?: boolean };
  /** Skip certification of analyses whose staging the kernel refuses (ablations only). */
  readonly stagedOnly?: boolean;
  /** Records from an interrupted run of the same commit: those certifications are not repeated. */
  readonly done?: readonly CertRecord[];
}

export interface CalibrationRun { readonly stages: StageResult[]; readonly records: CertRecord[]; readonly wallMs: number }

export async function runCalibration(o: CalibrationOptions): Promise<CalibrationRun> {
  const tc = toolchain(REPO);
  const t0 = performance.now();
  const specs: TaskSpec[] = TASK_SPECS.filter((s) => !o.tasks || o.tasks.includes(s.id));
  const stages: StageResult[] = [];
  const records: CertRecord[] = [];
  for (const spec of specs) {
    const stage = o.staged?.get(spec.id) ?? stageTask(spec.id, path.join(o.scratch, "stage", spec.id), tc);
    stages.push(stage);
    if (!stage.ok) continue;
    const declarations = spec.declareStaging && !o.variant?.noDeclarations ? generateDeclarations(readFileSync(path.join(TASKS_DIR, spec.id, "TASK.md"), "utf8"), stage.raw) : undefined;
    const staging = declarations && Object.keys(declarations.staging).length ? declarations.staging : undefined;
    const analyses = o.analyses?.(spec.id) ?? listAnalyses(TASKS_DIR, spec.id);
    for (const analysis of analyses) {
      for (const mode of o.modes ?? (["adopt", "locked"] as const)) {
        const prior = o.done?.find((r) => r.task === spec.id && r.analysis === analysis && r.mode === mode);
        if (prior) { records.push(prior); continue; }
        const base = path.join(o.scratch, "runs", `${Date.now().toString(36)}-${records.length}`);
        mkdirSync(base, { recursive: true });
        const work = path.join(base, "work");
        buildCode(TASKS_DIR, spec, analysis, work, o.variant ? { omitP: o.variant.omitP } : {});
        const worker = await workerRun(work, stage.raw, mode, base, tc, undefined, staging as StageDeclarations | undefined);
        writePlan(work, spec, staging as StageDeclarations | undefined);
        const { record } = await certifyAnalysis({ spec, analysis, mode, work, raw: stage.raw, scratch: base, tc, worker,
          ...(declarations ? { declarations } : {}), ...(o.variant ? { variant: o.variant.name } : {}) });
        rmSync(base, { recursive: true, force: true });
        if (o.stagedOnly && !record.stagingAvailable) continue;
        records.push(record);
        o.onRecord?.(record);
      }
    }
  }
  return { stages, records, wallMs: Math.round(performance.now() - t0) };
}

export function gitHead(): string {
  const r = spawnSync("git", ["-C", REPO, "rev-parse", "HEAD"], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : "unknown";
}

/** The commit among `heads` that descends from all of them, after checking that they differ only
 * in calibration records and Markdown (identical code), so parts started on either may be merged. */
export function mergeHead(heads: readonly string[]): string {
  const unique = [...new Set(heads)];
  for (const h of unique.slice(1)) {
    const r = spawnSync("git", ["-C", REPO, "diff", "--name-only", unique[0]!, h], { encoding: "utf8" });
    if (r.status !== 0 || !r.stdout.split("\n").filter(Boolean).every((f) => f.startsWith("packages/omb-calibration/records/") || f.endsWith(".md")))
      throw new Error(`parts come from commits with different code (${unique[0]!.slice(0, 7)}, ${h.slice(0, 7)})`);
  }
  const newest = unique.find((h) => unique.every((o) => o === h || spawnSync("git", ["-C", REPO, "merge-base", "--is-ancestor", o, h]).status === 0));
  if (!newest) throw new Error("parts come from unrelated commits");
  return newest;
}

/** Refuse to write a record tree that carries an answer-bearing field name. */
export function assertAnswerFree(value: unknown, at = "$"): void {
  if (Array.isArray(value)) { value.forEach((v, i) => assertAnswerFree(v, `${at}[${i}]`)); return; }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (["estimate", "ci", "ci95", "p", "p_value", "pvalue", "n_units", "se", "value", "auc"].includes(k.toLowerCase())) throw new Error(`answer-bearing field ${at}.${k} in a record`);
      assertAnswerFree(v, `${at}.${k}`);
    }
  }
}

