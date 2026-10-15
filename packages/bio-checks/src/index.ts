// bio-checks: core verdict logic of the trusted checker (CONTRACT.md "Block 4").
// Every function is pure, deterministic and fails closed on missing or malformed input.

import { isName, isRecord, snapshot } from "./evidence.ts";

export type NumericTable = readonly (readonly number[])[];
export type OutputValue = string | NumericTable;
export type OutputMap = Readonly<Record<string, OutputValue>>;

export interface Tolerance {
  abs?: number;
  rel?: number;
  absolute?: number;
  relative?: number;
  atol?: number;
  rtol?: number;
}

const SHA256 = /^[0-9a-f]{64}$/i;

interface NumericTolerance { abs: number; rel: number }

function normalizeTolerance(tolerance: unknown): NumericTolerance | null {
  if (tolerance === undefined) return { abs: 0, rel: 0 };
  if (!isRecord(tolerance)) return null;
  const allowed = new Set(["abs", "absolute", "atol", "rel", "relative", "rtol"]);
  if (Object.keys(tolerance).some((key) => !allowed.has(key))) return null;
  const result: NumericTolerance = { abs: 0, rel: 0 };
  for (const [kind, aliases] of [["abs", ["abs", "absolute", "atol"]], ["rel", ["rel", "relative", "rtol"]]] as const) {
    let declared: number | undefined;
    for (const alias of aliases) {
      if (!Object.hasOwn(tolerance, alias)) continue;
      const value = tolerance[alias];
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
      if (declared !== undefined && value !== declared) return null;
      declared = value;
    }
    result[kind] = declared ?? 0;
  }
  return result;
}

function numbersMatch(a: unknown, b: unknown, tolerance: NumericTolerance): boolean {
  if (typeof a !== "number" || typeof b !== "number" || !Number.isFinite(a) || !Number.isFinite(b)) return false;
  if (a === b) return true;
  const diff = Math.abs(a - b);
  if (diff <= tolerance.abs) return true;
  const scale = Math.max(Math.abs(a), Math.abs(b));
  // Divide before multiplying to avoid Infinity <= Infinity on finite inputs.
  const relativeDifference = Number.isFinite(diff) ? diff / scale : Math.abs(a) / scale + Math.abs(b) / scale;
  return relativeDifference <= tolerance.rel;
}

/** Finite numbers only; malformed or conflicting tolerance declarations never match. */
export function withinTolerance(a: unknown, b: unknown, tolerance?: Tolerance): boolean {
  try {
    const normalized = normalizeTolerance(snapshot(tolerance));
    return normalized !== null && numbersMatch(a, b, normalized);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- re-execution

export type ReexecutionStatus = "reproduced" | "mismatch" | "nondeterministic" | "missing";

export interface ReexecutionResult {
  status: ReexecutionStatus;
  details: string[];
}

export interface CompareReexecutionInput {
  recorded: OutputMap | undefined | null;
  rerun: OutputMap | readonly OutputMap[] | undefined | null;
  tolerance?: Tolerance;
}

function isMissingValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.length === 0;
  return Array.isArray(value) && value.length === 0;
}

/** Returns null when equal, otherwise a reason. */
function compareOutput(name: string, a: unknown, b: unknown, tolerance: NumericTolerance): string | null {
  if (typeof a === "string" || typeof b === "string") {
    if (typeof a !== "string" || typeof b !== "string") return `${name}: hash compared with non-hash`;
    if (!SHA256.test(a) || !SHA256.test(b)) return `${name}: not a sha256 hex digest`;
    return a.toLowerCase() === b.toLowerCase() ? null : `${name}: hash differs`;
  }
  if (!Array.isArray(a) || !Array.isArray(b)) return `${name}: unsupported output type`;
  if (a.length === 0 || b.length === 0) return `${name}: empty table`;
  if (a.length !== b.length) return `${name}: row count ${a.length} vs ${b.length}`;
  for (let i = 0; i < a.length; i += 1) {
    const ra: unknown = a[i];
    const rb: unknown = b[i];
    if (!Array.isArray(ra) || !Array.isArray(rb)) return `${name}: row ${i} is not an array`;
    if (ra.length === 0 || rb.length === 0) return `${name}: row ${i} is empty`;
    if (ra.length !== (a[0] as unknown[]).length || rb.length !== (b[0] as unknown[]).length) return `${name}: ragged table`;
    if (ra.length !== rb.length) return `${name}: row ${i} width ${ra.length} vs ${rb.length}`;
    for (let j = 0; j < ra.length; j += 1) {
      if (!numbersMatch(ra[j], rb[j], tolerance)) {
        return `${name}: cell [${i}][${j}] outside tolerance or non-finite/non-numeric`;
      }
    }
  }
  return null;
}

function missingKeys(reference: Record<string, unknown>, other: Record<string, unknown>, label: string): string[] {
  const details: string[] = [];
  for (const key of Object.keys(reference).sort()) {
    if (!Object.hasOwn(other, key) || isMissingValue(other[key])) details.push(`${key}: missing in ${label}`);
  }
  return details;
}

export function compareReexecution(input: CompareReexecutionInput): ReexecutionResult {
  let data: unknown;
  try { data = snapshot(input); } catch { return { status: "missing", details: ["malformed reexecution evidence"] }; }
  if (!isRecord(data)) return { status: "missing", details: ["reexecution evidence absent"] };
  const { recorded } = data;
  const tolerance = normalizeTolerance(data.tolerance);
  if (tolerance === null) return { status: "mismatch", details: ["invalid tolerance"] };
  const raw = data.rerun;
  const reruns: unknown[] = Array.isArray(raw) ? [...raw] : raw === undefined || raw === null ? [] : [raw];

  if (!isRecord(recorded) || Object.keys(recorded).length === 0) {
    return { status: "missing", details: ["recorded outputs are absent or empty"] };
  }
  if (reruns.length === 0) return { status: "missing", details: ["no rerun outputs"] };

  const missing: string[] = [];
  for (const [key, value] of Object.entries(recorded).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))) {
    if (!isName(key) || isMissingValue(value)) missing.push(`${key}: missing in recorded`);
  }
  reruns.forEach((rerun, index) => {
    const label = `rerun ${index}`;
    if (!isRecord(rerun) || Object.keys(rerun).length === 0) {
      missing.push(`${label}: absent or empty`);
      return;
    }
    missing.push(...missingKeys(recorded, rerun, label), ...missingKeys(rerun, recorded, "recorded"));
  });
  if (missing.length > 0) return { status: "missing", details: [...new Set(missing)] };

  const runs = reruns as Record<string, unknown>[];
  const names = Object.keys(recorded).sort();

  const disagreements: string[] = [];
  for (let i = 0; i < runs.length; i += 1) {
    for (let j = i + 1; j < runs.length; j += 1) {
      for (const name of names) {
        const reason = compareOutput(name, runs[i]![name], runs[j]![name], tolerance);
        if (reason !== null) disagreements.push(`rerun ${i} vs rerun ${j}: ${reason}`);
      }
    }
  }

  const mismatches: string[] = [];
  for (const [index, run] of runs.entries()) {
    for (const name of names) {
      const reason = compareOutput(name, recorded[name], run[name], tolerance);
      if (reason !== null) mismatches.push(`recorded vs rerun ${index}: ${reason}`);
    }
  }
  if (disagreements.length > 0) return { status: "nondeterministic", details: disagreements };
  if (mismatches.length > 0) return { status: "mismatch", details: mismatches };
  return { status: "reproduced", details: names.map((name) => `${name}: matches`) };
}

// ---------------------------------------------------------------- claims

export interface WorkerClaim {
  id: string;
  name: string;
  value: number;
}

export type ReconciledClaim =
  | { id: string; name: string; status: "observation"; value: number; claimed: number; recomputed: number }
  | { id: string; name: string; status: "claimed-unsupported"; claimed: unknown; reason: string };

export function reconcileClaims(
  claims: readonly WorkerClaim[] | undefined | null,
  recomputed: Readonly<Record<string, number>> | undefined | null,
  tolerance?: Tolerance,
): ReconciledClaim[] {
  let copiedClaims: unknown;
  let copiedValues: unknown;
  let normalized: NumericTolerance | null;
  try {
    copiedClaims = snapshot(claims);
    copiedValues = snapshot(recomputed);
    normalized = normalizeTolerance(snapshot(tolerance));
  } catch { return [{ id: "", name: "", status: "claimed-unsupported", claimed: undefined, reason: "malformed claim evidence" }]; }
  if (!Array.isArray(copiedClaims)) return [];
  const values = isRecord(copiedValues) ? copiedValues : {};
  const ids = new Map<string, number>();
  for (const claim of copiedClaims) {
    if (isRecord(claim) && isName(claim.id)) ids.set(claim.id, (ids.get(claim.id) ?? 0) + 1);
  }
  return copiedClaims.map((raw: unknown): ReconciledClaim => {
    const claim = isRecord(raw) ? raw : {};
    const id = isName(claim.id) ? claim.id : "";
    const name = isName(claim.name) ? claim.name : "";
    const claimed = claim.value;
    const unsupported = (reason: string): ReconciledClaim => ({
      id,
      name,
      status: "claimed-unsupported",
      claimed,
      reason,
    });
    if (id.length === 0 || name.length === 0) return unsupported("claim lacks id or name");
    if ((ids.get(id) ?? 0) > 1) return unsupported("duplicate claim id");
    if (normalized === null) return unsupported("invalid tolerance");
    if (!Object.hasOwn(values, name)) return unsupported(`no recomputed value for ${name}`);
    const actual = values[name];
    if (typeof claimed !== "number" || !Number.isFinite(claimed)) {
      return unsupported(`claimed value for ${name} is not a finite number`);
    }
    if (typeof actual !== "number" || !Number.isFinite(actual)) {
      return unsupported(`recomputed value for ${name} is not a finite number`);
    }
    if (!numbersMatch(claimed, actual, normalized)) {
      return unsupported(`claimed ${name} = ${claimed} but recomputation yields ${actual}`);
    }
    return { id, name, status: "observation", value: actual, claimed, recomputed: actual };
  });
}

// ---------------------------------------------------------------- acceptance artifacts

export interface AcceptanceInput {
  claimedFiles: readonly string[];
  requiredChecks: readonly string[];
  fileExists: (path: string) => boolean;
  checkResults: Readonly<Record<string, string>>;
}

export interface AcceptanceResult {
  ok: boolean;
  status: "passed" | "failed";
  failures: string[];
}

export function checkAcceptanceArtifacts(input: AcceptanceInput): AcceptanceResult {
  const failures: string[] = [];
  let data: Record<string, unknown>;
  let exists: unknown;
  try {
    // Capture all evidence before calling the injected filesystem reader.
    if (!isRecord(input)) throw new Error("missing acceptance evidence");
    const descriptors = Object.getOwnPropertyDescriptors(input);
    exists = descriptors.fileExists?.value;
    const evidence = Object.create(null) as Record<string, unknown>;
    for (const name of ["claimedFiles", "requiredChecks", "checkResults"]) {
      const descriptor = descriptors[name];
      if (descriptor && !("value" in descriptor)) throw new Error("accessor evidence");
      evidence[name] = descriptor?.value;
    }
    data = snapshot(evidence) as Record<string, unknown>;
  } catch { return { ok: false, status: "failed", failures: ["malformed acceptance evidence"] }; }
  const files = data.claimedFiles;
  const checks = data.requiredChecks;
  const results = isRecord(data.checkResults) ? data.checkResults : {};
  if (Array.isArray(files) && Array.isArray(checks) && files.length === 0 && checks.length === 0) failures.push("no acceptance obligations");

  if (!Array.isArray(files)) failures.push("claimedFiles missing");
  if (!Array.isArray(checks)) failures.push("requiredChecks missing");
  if (typeof exists !== "function") failures.push("fileExists missing");

  if (Array.isArray(files) && typeof exists === "function") {
    for (const file of files) {
      let present = false;
      try {
        present = isName(file) && exists(file) === true;
      } catch {
        present = false;
      }
      if (!present) failures.push(`claimed file does not exist: ${isName(file) ? file : "invalid path"}`);
    }
  }
  if (Array.isArray(checks)) {
    for (const check of checks) {
      if (!isName(check)) {
        failures.push("required check has an invalid name");
        continue;
      }
      const key = check;
      if (!Object.hasOwn(results, key)) {
        failures.push(`required check absent: ${key}`);
        continue;
      }
      const status = results[key];
      if (status !== "passed") failures.push(`required check ${key} did not pass`);
    }
  }
  const ok = failures.length === 0;
  return { ok, status: ok ? "passed" : "failed", failures };
}

// ---------------------------------------------------------------- claim label

export type TopRungKind = "new-data-replication" | "blind-reimplementation-different-family";
export interface TopRungCheck {
  kind: string;
  status: string;
}
export type ClaimLabel = "confirmed" | "tentative" | "refuted";

export interface LabelInput {
  reexecution: ReexecutionStatus | string | undefined | null;
  topRungChecks: readonly TopRungCheck[] | undefined | null;
  reviewer: string | undefined | null;
}

const TOP_RUNG: ReadonlySet<string> = new Set<TopRungKind>([
  "new-data-replication",
  "blind-reimplementation-different-family",
]);

export function labelClaim(input: LabelInput): ClaimLabel {
  let data: unknown;
  try { data = snapshot(input); } catch { return "tentative"; }
  if (!isRecord(data)) return "tentative";
  const checks: unknown[] = Array.isArray(data.topRungChecks) ? data.topRungChecks : [];
  const topRung = checks.filter((check): check is Record<string, unknown> => isRecord(check) && typeof check.kind === "string" && TOP_RUNG.has(check.kind));
  if (topRung.some((check) => check.status === "disagrees")) return "refuted";
  const confirmed =
    data.reexecution === "reproduced" &&
    topRung.some((check) => check.status === "agrees") &&
    data.reviewer === "approved";
  return confirmed ? "confirmed" : "tentative";
}

export { checkCalibration, type CalibrationInput, type CalibrationResult, type CalibrationStatus } from "./calibration.ts";

// Sub-modules are namespaced so their names never collide with the core verdict API.
export * as validity from "./validity/index.ts";
export * as citations from "./citations/index.ts";
