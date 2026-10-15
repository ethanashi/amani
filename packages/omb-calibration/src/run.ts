// One certification of one deliverable, in the CLI's two modes:
// - adopt:  lock null, adopt true (plain-arm deliverables certified after the fact);
// - locked: the plan hash locked before the look (lockedAt 1 < firstLookAt 2), an explicit raw
//           directory disjoint from the worker, and the host input-hash pin, exactly as
//           `omb certify` requires for locked certification.
// The executor mirrors cli.ts (60 s deadline, node runtime) plus the bio-baseline pixi Python
// runtime, which the shipped CLI cannot grant (CALIBRATION-FINDINGS F-CLI).
//
// Records carry labels, decision outcomes, gate outcomes/codes and timings only. No estimate,
// interval, p-value or gate summary text is recorded, so no record can carry a task answer.

import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { canonicalSha256 } from "../../bio-core/src/index.ts";
import { certifyDirectory, freezeCode, GateAuthority, OfflineExecutor, Stager, treeManifest, type CertifiedReport, type Execution, type FrozenCode, type StagedInputs } from "../../omb-certify/src/index.ts";
import type { SimulationRunner, ClaimData } from "../../omb-certify/src/producers.ts";
import type { StageDeclarations } from "../../omb-certify/src/declared-stage.ts";
import type { DeclarationResult } from "./declarations.ts";
import { normalizeRunInputs } from "../../omb-certify/src/run-inputs.ts";
import { GATE_IDS, GateBoard, parsePlan, planLockHash, type GateId, type Plan } from "../../omb-gauntlet/src/index.ts";
import { buildPlan, readJson } from "./deliverable.ts";
import type { TaskSpec } from "./specs.ts";

export type Mode = "adopt" | "locked";

export interface Toolchain { readonly pixiEnv: string; readonly nodeRoot: string; readonly gradingRoot: string; }

/** Private arm/grading operation root for every V3 child process. The locked pilot needs the
 * default root's operations.lock; V3 must never take it. An explicit BIO_GRADING_ROOT is honoured
 * unless it is the default root, which is refused. */
export function usePrivateGradingRoot(): string {
  const fallback = path.join(os.homedir(), ".omerta-bio", "grading-v3-calibration");
  const chosen = path.resolve(process.env.BIO_GRADING_ROOT || fallback);
  if (chosen === path.resolve(os.homedir(), ".omerta-bio", "grading")) throw new Error("refusing the default grading root: the locked pilot needs its operation lease");
  mkdirSync(chosen, { recursive: true, mode: 0o700 });
  process.env.BIO_GRADING_ROOT = chosen;
  return chosen;
}

export function toolchain(repoRoot: string): Toolchain {
  const pixiEnv = path.join(repoRoot, "packages", "bio-baseline", ".pixi", "envs", "default");
  if (!existsSync(path.join(pixiEnv, "bin", "python"))) throw new Error("pixi environment missing: run pixi install --frozen --manifest-path packages/bio-baseline/pixi.toml");
  return { pixiEnv: realpathSync(pixiEnv), nodeRoot: path.dirname(realpathSync(process.execPath)), gradingRoot: usePrivateGradingRoot() };
}

/** Executor with per-run timings. Options mirror omb certify's CLI plus the Python runtime. */
export class TimedExecutor extends OfflineExecutor {
  readonly runs: { ms: number; status: Execution["status"]; reason: string }[] = [];
  constructor(scratchRoot: string, tc: Toolchain, timeoutMs = 60_000) {
    super({ scratchRoot, toolPath: `${tc.pixiEnv}/bin:${tc.nodeRoot}:/usr/bin:/bin`, runtimeRoots: [tc.pixiEnv, tc.nodeRoot], timeoutMs });
  }
  override async run(frozen: FrozenCode, staged: StagedInputs, mode: "all" | "primary" = "all", transform?: (data: string) => void): Promise<Execution> {
    const t0 = performance.now();
    const r = await super.run(frozen, staged, mode, transform);
    this.runs.push({ ms: performance.now() - t0, status: r.status, reason: r.status === "ok" ? "" : sanitize(r.reason) });
    return r;
  }
}

/** Replace multi-digit numbers and decimals so no message can carry a task value. */
export function sanitize(text: string): string {
  return text.replace(/\/(?:Users|private|var|tmp)\/\S*/g, "<path>").replace(/\(exit (\d+)\)/g, "(exit-code $1)")
    .replace(/-?\b\d+\.\d+(?:e-?\d+)?\b|\b\d{2,}\b/g, (m, offset: number, all: string) => all.slice(Math.max(0, offset - 10), offset).endsWith("exit-code ") ? m : "#");
}

/** Input identity exactly as the Stager computes it (canonical hash of name -> sha256). */
export function inputManifestHash(raw: string): string {
  return canonicalSha256(treeManifest(raw));
}

export interface WorkerRun { readonly status: "ok" | "failed" | "timeout"; readonly exitCode: number | null; readonly ms: number; readonly dataSource: "raw" | "effective"; }

/** Run the analysis as the worker would (host, outside certify) to produce its results.json.
 * adopt: on the raw staged data (plain-arm practice); locked: on the software effective inputs
 * normalized exactly as the executor normalizes them (route-P workers code against those). */
export async function workerRun(work: string, raw: string, mode: Mode, scratch: string, tc: Toolchain, timeoutMs = 600_000, declarations?: StageDeclarations): Promise<WorkerRun> {
  const tmp = mkdtempSync(path.join(scratch, "worker-"));
  let dataSource: "raw" | "effective" = "raw";
  try {
    cpSync(path.join(work, "code"), path.join(tmp, "code"), { recursive: true });
    mkdirSync(path.join(tmp, "data"));
    let staged: StagedInputs | null = null;
    if (mode === "locked") {
      try { staged = new Stager(path.join(tmp, "stage-cache"), () => 0).stage(raw, undefined, declarations); } catch { staged = null; }
    }
    if (staged) {
      for (const name of readdirSync(path.join(staged.directory, "RAW"))) cpSync(path.join(staged.directory, "RAW", name), path.join(tmp, "data", name));
      normalizeRunInputs(path.join(tmp, "data"), staged.declarations);
      dataSource = "effective";
    } else for (const name of readdirSync(raw)) cpSync(path.join(raw, name), path.join(tmp, "data", name));
    writeFileSync(path.join(tmp, "env.sh"), "#!/bin/sh\n# worker environment: PATH carries the pinned python\n");
    mkdirSync(path.join(tmp, "home")); mkdirSync(path.join(tmp, "tmp"));
    const t0 = performance.now();
    const { code, timedOut } = await new Promise<{ code: number | null; timedOut: boolean }>((resolve) => {
      const child = spawn("/bin/bash", ["code/omb/original_run_all.sh"], { cwd: tmp, detached: true, stdio: ["ignore", "ignore", "ignore"],
        env: { PATH: `${tc.pixiEnv}/bin:/usr/bin:/bin`, HOME: path.join(tmp, "home"), TMPDIR: path.join(tmp, "tmp"), LANG: "en_US.UTF-8", BIO_GRADING_ROOT: tc.gradingRoot } });
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; try { process.kill(-child.pid!, "SIGKILL"); } catch { /* gone */ } }, timeoutMs);
      child.on("close", (c) => { clearTimeout(timer); resolve({ code: c, timedOut }); });
      child.on("error", () => { clearTimeout(timer); resolve({ code: null, timedOut }); });
    });
    const ms = performance.now() - t0;
    rmSync(path.join(work, "results.json"), { force: true });
    if (!timedOut && code === 0 && existsSync(path.join(tmp, "results.json"))) {
      cpSync(path.join(tmp, "results.json"), path.join(work, "results.json"));
      return { status: "ok", exitCode: code, ms, dataSource };
    }
    return { status: timedOut ? "timeout" : "failed", exitCode: code, ms, dataSource };
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

/** Write plan.json from the spec and the worker's own results.json. */
export function writePlan(work: string, spec: TaskSpec, staging?: StageDeclarations): { status: "accepted" | "refused"; plan: Plan | null; errors: number } {
  const plan = buildPlan(spec, readJson(path.join(work, "results.json")), staging);
  const text = JSON.stringify(plan, null, 2) + "\n";
  writeFileSync(path.join(work, "plan.json"), text);
  const parsed = parsePlan(text);
  return { status: parsed.status, plan: parsed.plan, errors: parsed.issues.filter((i) => i.severity === "error").length };
}

export interface GateState {
  readonly outcome: string; readonly passed: boolean; readonly code: string | null; readonly reason: string | null;
  /** String-only evidence codes (G3/G4 kernel disagreements such as "look.p", G1a findings); never values. */
  readonly detail?: readonly string[];
}

function detailOf(evidence: Readonly<Record<string, unknown>> | undefined): string[] {
  if (!evidence) return [];
  const out: string[] = [];
  if (Array.isArray(evidence.kernelDisagreements)) out.push(...evidence.kernelDisagreements.filter((v): v is string => typeof v === "string"));
  if (Array.isArray(evidence.findings)) for (const f of evidence.findings) {
    if (typeof f === "string") out.push(f);
    else if (f && typeof f === "object" && typeof (f as { code?: unknown }).code === "string") out.push((f as { code: string }).code);
  }
  if (evidence.dataDependence === false) out.push("data-dependence-failed");
  return out;
}
export interface ClaimRecord {
  readonly id: string; readonly kind: string | null; readonly planned: boolean;
  readonly status: string; readonly taskStatus: string; readonly outcome: string;
  readonly gates: Readonly<Partial<Record<GateId, GateState>>>;
  /** Trusted kernel decision status, when the kernel ran (no estimate or p is recorded). */
  readonly kernel: { readonly status: string; readonly stopping: string; readonly guarantee: string } | null;
  /** G1c covariate classification (column names only). */
  readonly confounding: { readonly aligned: readonly string[]; readonly strong: readonly string[]; readonly unhandled: readonly string[] } | null;
}
export interface CertRecord {
  readonly task: string; readonly analysis: string; readonly mode: Mode;
  readonly worker: WorkerRun; readonly planStatus: "accepted" | "refused" | "missing"; readonly planErrors: number;
  readonly locked: boolean; readonly stagingAvailable: boolean;
  /** Amendment A1: generated staging declarations (column names only) and why files could not be declared. */
  readonly declarations?: { readonly staging: DeclarationResult["staging"]; readonly notes: DeclarationResult["notes"]; readonly idUnique: DeclarationResult["idUnique"] };
  /** Ablation variant (omit-p wrapper), absent for the pre-registered deliverables. */
  readonly variant?: string;
  readonly executions: readonly { readonly status: string; readonly reason: string }[];
  readonly claims: readonly ClaimRecord[];
  readonly hardStops: readonly string[];
  readonly warnings: readonly string[];
  readonly timing: { readonly certifyMs: number; readonly executionMs: readonly number[]; readonly workerMs: number };
}

export interface CertifyOptions {
  readonly spec: TaskSpec; readonly analysis: string; readonly mode: Mode;
  readonly work: string; readonly raw: string; readonly scratch: string; readonly tc: Toolchain;
  readonly worker: WorkerRun; readonly timeoutMs?: number;
  readonly simulations?: boolean;
  readonly simulationFactory?: (claimId: string, data: ClaimData) => SimulationRunner;
  /** Trusted external envelopes (null calibration stand-ins only). Built from the binding. */
  readonly externalGates?: (binding: { planHash: string; inputManifestHash: string; frozenCodeHash: string; executionId: string }, authority: GateAuthority) => unknown[];
  readonly executionId?: string;
  readonly declarations?: DeclarationResult;
  readonly variant?: string;
}

export async function certifyAnalysis(o: CertifyOptions): Promise<{ record: CertRecord; report: CertifiedReport | null }> {
  const state = mkdtempSync(path.join(o.scratch, "state-"));
  try {
    const parsed = parsePlan(readFileSafe(path.join(o.work, "plan.json")));
    const planStatus = parsed.plan === null && parsed.issues.length === 0 ? "missing" : parsed.status;
    const lock = o.mode === "locked" && parsed.plan ? { planHash: planLockHash(parsed.plan), lockedAt: 1 } : null;
    const executionId = o.executionId ?? `v3:${o.spec.id}:${o.analysis}:${o.mode}`;
    // Calibration host key derived from the execution id: the HMAC-derived simulation seeds
    // (dependence shift) then repeat exactly across the quiet and loaded runs. Never a task secret.
    const keyFile = path.join(state, "host.key");
    writeFileSync(keyFile, createHash("sha256").update(`omb-v3-calibration-host-key:${executionId}`).digest(), { mode: 0o600 });
    const authority = GateAuthority.fromFile(keyFile, [o.work]);
    const executor = new TimedExecutor(path.join(state, "scratch"), o.tc, o.timeoutMs);
    const expectedInputHash = o.mode === "locked" ? inputManifestHash(o.raw) : undefined;
    let external: unknown[] | undefined;
    if (o.externalGates && parsed.plan) {
      const frozenProbe = mkdtempSync(path.join(o.scratch, "frozen-probe-"));
      try {
        const frozen = freezeCode(o.work, path.join(frozenProbe, "f"));
        external = o.externalGates({ planHash: planLockHash(parsed.plan), inputManifestHash: inputManifestHash(o.raw), frozenCodeHash: frozen.hash, executionId }, authority);
      } catch { external = undefined; } finally { rmSync(frozenProbe, { recursive: true, force: true }); }
    }
    const t0 = performance.now();
    const report = await certifyDirectory({
      workdir: o.work, rawDir: o.raw, stateRoot: state, executionId, lock, firstLookAt: lock ? 2 : null, adopt: o.mode === "adopt",
      now: () => performance.now(), authority, executor,
      ...(expectedInputHash ? { expectedInputHash } : {}),
      ...(o.simulations === false ? { simulations: false } : {}),
      ...(o.simulationFactory ? { simulationFactory: o.simulationFactory } : {}),
      ...(external ? { externalGates: external } : {}),
    });
    const certifyMs = performance.now() - t0;
    const board = new GateBoard(report.gates.map((g) => g.result));
    const claims: ClaimRecord[] = report.certification.assessments.map((a) => {
      const gates: Partial<Record<GateId, GateState>> = {};
      for (const gate of GATE_IDS) {
        const l = board.lookup(gate, a.claimId);
        if (l.outcome === "absent") continue;
        const detail = detailOf(l.result?.evidence as Record<string, unknown> | undefined);
        gates[gate] = { outcome: l.outcome, passed: l.passed, code: l.result?.code ?? null, reason: l.reason === null ? null : sanitize(l.reason), ...(detail.length ? { detail } : {}) };
      }
      const k = report.kernel[a.claimId];
      const ev = board.lookup("G1c", a.claimId).result?.evidence;
      const list = (v: unknown) => Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
      return { id: a.claimId, kind: a.kind, planned: a.planned, status: a.status, taskStatus: a.taskStatus, outcome: a.decision.outcome, gates,
        kernel: k ? { status: k.status, stopping: k.stopping, guarantee: k.guarantee } : null,
        confounding: ev && Array.isArray(ev.strong) ? { aligned: list(ev.aligned), strong: list(ev.strong), unhandled: list(ev.unhandled) } : null };
    });
    const stagingAvailable = !report.warnings.some((w) => w.startsWith("staging unavailable"));
    const record: CertRecord = {
      task: o.spec.id, analysis: o.analysis, mode: o.mode, worker: o.worker, planStatus, planErrors: parsed.issues.filter((i) => i.severity === "error").length,
      locked: lock !== null, stagingAvailable,
      ...(o.declarations ? { declarations: { staging: o.declarations.staging, notes: o.declarations.notes, idUnique: o.declarations.idUnique } } : {}),
      ...(o.variant ? { variant: o.variant } : {}),
      executions: executor.runs.map((r) => ({ status: r.status, reason: r.reason })),
      claims, hardStops: [...new Set(report.certification.assessments.flatMap((a) => a.label.voided ? ["voided"] : []))],
      warnings: [...new Set(report.warnings.map(sanitize))].sort(),
      timing: { certifyMs: round(certifyMs), executionMs: executor.runs.map((r) => round(r.ms)), workerMs: round(o.worker.ms) },
    };
    return { record, report };
  } finally { rmSync(state, { recursive: true, force: true }); }
}

const round = (ms: number) => Math.round(ms);
function readFileSafe(file: string): string | null {
  try { return readFileSync(file, "utf8"); } catch { return null; }
}

/** Outcome-only fingerprint of a record (labels, decisions, gate outcomes and codes, execution
 * statuses). Timings and warnings text are excluded: load invariance compares exactly this. */
export function outcomeFingerprint(r: CertRecord): string {
  return JSON.stringify({
    task: r.task, analysis: r.analysis, mode: r.mode, ...(r.variant ? { variant: r.variant } : {}), plan: r.planStatus, locked: r.locked, staging: r.stagingAvailable,
    executions: r.executions.map((e) => e.status),
    claims: r.claims.map((c) => ({ id: c.id, status: c.status, taskStatus: c.taskStatus, outcome: c.outcome, kernel: c.kernel?.status ?? null,
      gates: Object.fromEntries(Object.entries(c.gates).sort(([a], [b]) => a < b ? -1 : 1).map(([g, s]) => [g, [s!.outcome, s!.passed, s!.code]])) })),
  });
}
