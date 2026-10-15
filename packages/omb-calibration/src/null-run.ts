// E8/E9 runner: certify the task's reference analysis on synthetic re-stagings (null-design.ts)
// through the full certify path, with G7/G8 stand-ins and the trusted simulationFactory seam.

import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { linearEntry } from "../../omb-certify/src/linear.ts";
import type { ClaimData, SimulationRunner } from "../../omb-certify/src/producers.ts";
import { parsePlan, type PlanClaim } from "../../omb-gauntlet/src/index.ts";
import { clopperPearson, exceedsAlphaP } from "./binomial.ts";
import { readJson } from "./deliverable.ts";
import { NULL_DESIGN, restage, standInGates, type NullTask, type Variant } from "./null-design.ts";
import { certifyAnalysis, workerRun, writePlan, type ClaimRecord, type Toolchain } from "./run.ts";
import type { TaskSpec } from "./specs.ts";

export interface RestageRecord {
  readonly task: string; readonly variant: Variant; readonly k: number; readonly sandboxSimulations: boolean; readonly n?: number;
  readonly worker: string; readonly status: string; readonly outcome: string; readonly kernel: string | null;
  readonly gates: Readonly<Record<string, string>>;
  readonly executions: number; readonly certifyMs: number; readonly workerMs: number;
}

/** In-process transcription of the workdir-rule reference (OLS with the plan's adjustment, classical
 * t interval and p): the trusted host callback V2 exposes for V3's controlled executor. */
export function inProcessReference(plan: readonly PlanClaim[]): (claimId: string, data: ClaimData) => SimulationRunner {
  return (claimId, data) => {
    const claim = plan.find((c) => c.id === claimId);
    if (!claim) throw new Error(`no locked claim ${claimId}`);
    return async (request) => linearEntry(claim, { ...data, x: request.x, y: request.y });
  };
}

const gateText = (c: ClaimRecord | undefined): Record<string, string> =>
  Object.fromEntries(Object.entries(c?.gates ?? {}).map(([g, s]) => [g, `${s!.outcome}${s!.passed ? "+" : ""}${s!.code ? `(${s!.code})` : ""}`]));

export async function certifyRestaging(o: {
  readonly spec: TaskSpec; readonly task: NullTask; readonly variant: Variant; readonly k: number;
  readonly skeleton: string; readonly sourceTsv: string; readonly scratch: string; readonly tc: Toolchain; readonly sandboxSimulations: boolean;
  /** Amendment A9: lock this MEI in every plan claim (the task specs state none). */
  readonly planMei?: number;
}): Promise<RestageRecord> {
  const base = mkdtempSync(path.join(o.scratch, "re-"));
  try {
    const raw = path.join(base, "raw");
    mkdirSync(raw);
    writeFileSync(path.join(raw, "observations.tsv"), restage(o.sourceTsv, o.task, o.variant, o.k));
    const work = path.join(base, "work");
    cpSync(o.skeleton, work, { recursive: true });
    const worker = await workerRun(work, raw, "locked", base, o.tc);
    writePlan(work, o.spec);
    if (o.planMei !== undefined) {
      const doc = readJson(path.join(work, "plan.json")) as { claims: Record<string, unknown>[] };
      for (const c of doc.claims) c.mei = o.planMei;
      writeFileSync(path.join(work, "plan.json"), JSON.stringify(doc, null, 2) + "\n");
    }
    const plan = parsePlan(readJson(path.join(work, "plan.json"))).plan;
    const id = `v3-restage:${o.task.task}:${o.variant}:${o.k}`;
    const { record } = await certifyAnalysis({
      spec: o.spec, analysis: "reference", mode: "locked", work, raw, scratch: base, tc: o.tc, worker, executionId: id,
      ...(o.sandboxSimulations || !plan ? {} : { simulationFactory: inProcessReference(plan.claims) }),
      externalGates: standInGates(o.spec.claims.map((c) => c.id), id),
    });
    const c = record.claims.find((x) => x.id === o.spec.claims[0]!.id);
    return { task: o.task.task, n: o.task.n, variant: o.variant, k: o.k, sandboxSimulations: o.sandboxSimulations, worker: worker.status,
      status: c?.status ?? "missing", outcome: c?.outcome ?? "missing", kernel: c?.kernel?.status ?? null, gates: gateText(c),
      executions: record.executions.length, certifyMs: record.timing.certifyMs, workerMs: Math.round(worker.ms) };
  } finally { rmSync(base, { recursive: true, force: true }); }
}

export interface RateSummary {
  readonly task: string; readonly variant: Variant; readonly n: number; readonly confirmed: number; readonly decided: number;
  readonly rate: number; readonly rateInterval: [number, number]; readonly pExceedsAlpha: number | null;
  /** Descriptive (not pre-registered): kernel rejections, and kernel rejections with G5a passing. */
  readonly kernelRejects: number; readonly kernelRejectsWithG5a: number;
}

export function summarize(records: readonly RestageRecord[], task: string, variant: Variant): RateSummary {
  const rs = records.filter((r) => (task === "pooled" || r.task === task) && r.variant === variant && !r.sandboxSimulations);
  const confirmed = rs.filter((r) => r.status === "confirmed" || r.status === "replicated").length;
  const decided = rs.filter((r) => r.kernel === "reject" || r.kernel === "retain").length;
  const kernelRejects = rs.filter((r) => r.kernel === "reject").length;
  const kernelRejectsWithG5a = rs.filter((r) => r.kernel === "reject" && r.gates.G5a === "passed+").length;
  return { task, variant, n: rs.length, confirmed, decided, kernelRejects, kernelRejectsWithG5a, rate: rs.length ? confirmed / rs.length : 0,
    rateInterval: rs.length ? clopperPearson(confirmed, rs.length) : [0, 1], pExceedsAlpha: variant === "null" && rs.length ? exceedsAlphaP(confirmed, rs.length, NULL_DESIGN.alpha) : null };
}

/** Outcome-only comparison for the sandbox validation (execution counts legitimately differ). */
export function restageFingerprint(r: RestageRecord): string {
  return JSON.stringify({ status: r.status, outcome: r.outcome, kernel: r.kernel, gates: Object.fromEntries(Object.entries(r.gates).sort()) });
}
