import { canonicalClone } from "../../bio-core/src/index.ts";
import type { ArmOutput, BenchmarkSettings, Grade } from "./types.ts";
import { validateBootstrap } from "./statistics.ts";

/** Reject accessor/non-JSON evidence before canonicalClone can normalize it away. */
export function snapshot<T>(input: T): T {
  const ancestors = new Set<object>();
  function visit(value: unknown): void {
    if (value === null || typeof value === "string" || typeof value === "boolean") return;
    if (typeof value === "number" && Number.isFinite(value)) return;
    if (typeof value !== "object" || value === null || ancestors.has(value)) throw new Error("plain JSON required");
    const array = Array.isArray(value);
    if (!array && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new Error("plain JSON required");
    ancestors.add(value);
    const keys = Reflect.ownKeys(value);
    if (array && keys.length !== value.length + 1) throw new Error("dense JSON arrays required");
    for (const key of keys) {
      if (array && key === "length") continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (typeof key !== "string" || !descriptor.enumerable || !("value" in descriptor)) throw new Error("plain JSON fields required");
      visit(descriptor.value);
    }
    ancestors.delete(value);
  }
  visit(input);
  return canonicalClone(input);
}

export function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
}

const text = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const nonnegative = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;
const integer = (v: unknown): v is number => nonnegative(v) && Number.isSafeInteger(v);
const unique = (values: readonly string[]): boolean => new Set(values).size === values.length;
function requireValid(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function validateSettings(input: BenchmarkSettings): BenchmarkSettings {
  const s = snapshot(input);
  requireValid(s && Array.isArray(s.tasks) && s.tasks.length > 0, "tasks required");
  requireValid(text(s.studyId), "study id required");
  for (const t of s.tasks) {
    requireValid(t && [t.id, t.family, t.prompt, t.sealedAnswerKeyRef].every(text) && /^[a-f0-9]{64}$/.test(t.datasetManifestHash), "invalid task card");
    requireValid(t.tolerance && nonnegative(t.tolerance.absolute) && nonnegative(t.tolerance.relative), "invalid tolerance");
    requireValid(Array.isArray(t.plantedFlaws) && t.plantedFlaws.every(text) && unique(t.plantedFlaws), "invalid planted flaws");
    requireValid([t.negativeControl, t.positiveControl, t.heldOut].every(v => typeof v === "boolean") && !(t.negativeControl && t.positiveControl), "invalid control flags");
  }
  requireValid(unique(s.tasks.map(t => t.id)), "duplicate task id");
  requireValid(Array.isArray(s.arms) && s.arms.length >= 4, "arms A, B, C, D required");
  const required = { A: "plain-codex", B: "codex-tools", C: "omerta-bio", D: "deterministic-reference" };
  for (const [id, kind] of Object.entries(required)) requireValid(s.arms.some(a => a.id === id && a.kind === kind), `required arm ${id} missing`);
  for (const a of s.arms) {
    requireValid(a && [a.id, a.modelId, a.cliVersion, a.effort].every(text), "arm provenance required");
    requireValid(Object.hasOwn(required, a.id) || a.kind === "plain-claude", "optional arms must be plain Claude");
    requireValid(a.networkMode === "confirm" || a.networkMode === "explore", "unknown network mode");
    requireValid(Array.isArray(a.allowedHosts) && a.allowedHosts.every((h: unknown) => text(h) && /^[a-z0-9.-]+$/.test(h)) && unique(a.allowedHosts), "invalid allowed hosts");
    requireValid(a.allowedHosts.join("\n") === [...a.allowedHosts].sort().join("\n"), "allowed hosts must be sorted");
    requireValid(a.networkMode !== "confirm" || a.allowedHosts.length === 0, "confirm mode cannot allow hosts");
    requireValid(a.networkMode === s.arms[0]!.networkMode && a.allowedHosts.join("\n") === s.arms[0]!.allowedHosts.join("\n"), "unequal network policies");
  }
  requireValid(unique(s.arms.map(a => a.id)), "duplicate arm id");
  requireValid(integer(s.attemptsPerTask) && s.attemptsPerTask > 0, "invalid attemptsPerTask");
  for (const ms of [s.timeoutMs, s.calibrationTimeoutMs, s.gradingTimeoutMs]) requireValid(integer(ms) && ms > 0 && ms <= 2_147_483_647, "invalid timeout");
  validateBootstrap(s.statistics);
  requireValid(nonnegative(s.statistics.equivalenceMargin) && s.statistics.equivalenceMargin > 0 && s.statistics.equivalenceMargin <= 1, "invalid equivalence margin");
  requireValid(integer(s.statistics.minPairedTasks) && s.statistics.minPairedTasks >= 2, "invalid minimum paired tasks");
  requireValid(s.statistics.endpoint === "all-attempts-correct-confirmed", "unsupported endpoint");
  requireValid(["all-valid", "held-out"].includes(s.statistics.population), "invalid statistics population");
  return freeze(s);
}

export function parseOutput(input: unknown): ArmOutput {
  const value = snapshot(input) as ArmOutput;
  requireValid(value && ["completed", "timeout", "crashed", "failed", "skipped", "unavailable"].includes(value.status), "unknown arm status");
  const observed = value.observed;
  requireValid(observed && [observed.modelId, observed.cliVersion, observed.effort].every(text) &&
    ["confirm", "explore"].includes(observed.networkMode) && Array.isArray(observed.allowedHosts) &&
    observed.allowedHosts.every(text) && unique(observed.allowedHosts) && observed.networkEnforced === true,
  "observed provenance and enforced network attestation required");
  requireValid(Array.isArray(value.claims), "claims missing");
  requireValid(value.claims.every(c => c && text(c.id) && ["confirmed", "tentative", "refuted", "insufficient", "contradicted"].includes(c.label)), "invalid claim");
  requireValid(unique(value.claims.map(c => c.id)), "duplicate claim id");
  requireValid(Object.hasOwn(value, "output"), "output missing");
  requireValid(value.usage === null || value.usage && integer(value.usage.inputTokens) && integer(value.usage.outputTokens) && nonnegative(value.usage.costUsd), "invalid usage; unknown usage must be null");
  requireValid(value.reason === undefined || text(value.reason), "invalid failure reason");
  return freeze(value);
}

export function parseGrade(input: unknown, output: ArmOutput): Grade {
  const value = snapshot(input) as Grade;
  const verdicts = ["accepted", "rejected", "unavailable"];
  requireValid(value && verdicts.includes(value.outcome) && Array.isArray(value.claims), "invalid answer-key grade");
  requireValid(value.claims.every(c => c && text(c.id) && verdicts.includes(c.verdict)), "invalid claim grade");
  requireValid(unique(value.claims.map(c => c.id)) && value.claims.length === output.claims.length && output.claims.every(c => value.claims.some(g => g.id === c.id)), "missing, extra or duplicate claim grade");
  return freeze(value);
}
