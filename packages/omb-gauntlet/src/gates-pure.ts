// Pure gates (no toolpack, no store): G2 lock, G3 recompute, G4 one re-run, G6 multiplicity.
// Tolerances are software-owned caps: a caller may pass a tighter tolerance, never a looser one.

import { createHash } from "node:crypto";
import { canonicalJson } from "../../bio-core/src/index.ts";
import { compareReexecution, type OutputMap } from "../../bio-checks/src/index.ts";
import { gateResult, type GateResult } from "./gates.ts";
import { IssueLog } from "./issues.ts";
import { finite, foldKey, isRecord } from "./json.ts";
import { adjustPValues } from "./multiplicity.ts";
import { isStatistical, planLockHash, type Plan } from "./plan.ts";
import { POLICY } from "./policy.ts";
import { findEntry, readClaimEntry, type PrimaryEntry, type PrimaryOutputs } from "./primary.ts";

// ------------------------------------------------------------------ G2

export interface PlanLock {
  /** planLockHash of the plan recorded by the store when it was locked. */
  readonly planHash: string;
  /** Store sequence (or monotonic clock) at which the lock was recorded. */
  readonly lockedAt: number;
}

export interface G2Input {
  /** The normalized plan now on disk (parsePlan). */
  readonly plan: Plan | null;
  /** null: no lock was ever recorded; undefined: the store could not be read. */
  readonly lock: PlanLock | null | undefined;
  /** Sequence of the first software execution on confirming data (the look). null (none yet) and
   * undefined (unknown) are both not-run: lock-before-look is established only against a look. */
  readonly firstLookAt: number | null | undefined;
}

export function evaluateG2(input: G2Input): GateResult {
  if (input.lock === undefined) return gateResult("G2", "not-run", "the lock record is unavailable", { code: "store-unavailable" });
  if (input.lock === null) return gateResult("G2", "failed", "the decision rule was never locked", { code: "not-locked" });
  if (input.plan === null) return gateResult("G2", "failed", "no evaluable plan to compare with the lock", { code: "no-plan" });
  const current = planLockHash(input.plan);
  const evidence = { lockedHash: input.lock.planHash, currentHash: current, lockedAt: input.lock.lockedAt, firstLookAt: input.firstLookAt ?? null };
  if (current !== input.lock.planHash) return gateResult("G2", "failed", "plan.json differs from the locked decision rule", { code: "hash-mismatch", evidence });
  if (input.firstLookAt === undefined) return gateResult("G2", "not-run", "the look sequence is unknown", { code: "look-unknown", evidence });
  if (input.firstLookAt === null) return gateResult("G2", "not-run", "no software execution on confirming data yet", { code: "no-look-yet", evidence });
  if (!finite(input.lock.lockedAt) || !finite(input.firstLookAt) || !(input.lock.lockedAt < input.firstLookAt)) {
    return gateResult("G2", "failed", "the plan was locked (or amended) after the confirming data were seen", { code: "locked-after-look", evidence });
  }
  return gateResult("G2", "passed", "decision rule locked before the look; plan.json matches the lock", { evidence });
}

// ------------------------------------------------------------------ G3

export interface ClaimedNumber {
  readonly value: number;
  /** Source text as written (e.g. "0.500"); defaults to the shortest representation. */
  readonly raw?: string;
}

export interface G3Input {
  readonly claimId: string;
  /** Numbers the worker reported for this claim, by field ("estimate", "ci.0", "ci.1", "n_units", ...). */
  readonly claimed: Readonly<Record<string, ClaimedNumber | number>>;
  /** The same fields from the software execution; null when software has not executed the code. */
  readonly recomputed: Readonly<Record<string, number>> | null;
  /** Optional tighter tolerance. Looser values are clamped to the software caps. */
  readonly tolerance?: { readonly rel?: number; readonly displayPrecision?: number };
}

/** Half of the last displayed digit of a number's source text (0.5 for "480", 5e-4 for "0.500"). */
export function halfDisplayUnit(raw: string): number | null {
  const m = /^[+-]?(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(raw.trim());
  if (!m || (m[1] === "" && (m[2] ?? "") === "")) return null;
  const decimals = (m[2] ?? "").length;
  const exponent = m[3] === undefined ? 0 : Number(m[3]);
  return 0.5 * 10 ** (exponent - decimals);
}

/** Exact apart from display rounding: equal, within the relative float cap, or the claimed text is
 * the recomputed value rounded to a display precision of at most `precision` of its magnitude. */
export function matchesRecomputed(claimed: ClaimedNumber, recomputed: number, rel: number = POLICY.g3RelativeTolerance, precision: number = POLICY.g3DisplayPrecisionCap): boolean {
  const c = claimed.value;
  if (claimed.raw !== undefined && Number(claimed.raw) !== c) return false;
  if (!finite(c) || !finite(recomputed)) return false;
  if (c === recomputed) return true;
  const relCap = Math.min(Math.max(rel, 0), POLICY.g3RelativeTolerance);
  const precisionCap = Math.min(Math.max(precision, 0), POLICY.g3DisplayPrecisionCap);
  const diff = Math.abs(c - recomputed);
  if (diff <= relCap * Math.max(Math.abs(c), Math.abs(recomputed))) return true;
  const half = halfDisplayUnit(claimed.raw ?? String(c));
  if (half === null) return false;
  return diff <= half * (1 + 1e-9) && half <= precisionCap * Math.abs(recomputed);
}

export function evaluateG3(input: G3Input): GateResult {
  const claimId = foldKey(input.claimId);
  if (input.recomputed === null) return gateResult("G3", "not-run", "software has not executed the frozen code", { claimId, code: "not-executed" });
  const requested = input.tolerance ?? {};
  const clamped = (requested.rel ?? 0) > POLICY.g3RelativeTolerance || (requested.displayPrecision ?? 0) > POLICY.g3DisplayPrecisionCap;
  const mismatches: string[] = [];
  const missing: string[] = [];
  let compared = 0;
  for (const [field, raw] of Object.entries(input.claimed).sort(([a], [b]) => (a < b ? -1 : 1))) {
    const claimed: ClaimedNumber = typeof raw === "number" ? { value: raw } : raw;
    const actual = input.recomputed[field];
    if (actual === undefined || !finite(actual)) { missing.push(field); continue; }
    compared += 1;
    if (field === "n_units" ? claimed.value !== actual : !matchesRecomputed(claimed, actual, requested.rel, requested.displayPrecision)) mismatches.push(field);
  }
  const evidence = { compared, mismatched: mismatches, missingRecomputed: missing, toleranceClamped: clamped,
    relCap: POLICY.g3RelativeTolerance, displayPrecisionCap: POLICY.g3DisplayPrecisionCap };
  if (Object.keys(input.recomputed).length === 0) return gateResult("G3", "failed", "software execution produced no numbers for this claim", { claimId, code: "missing-recomputed", evidence });
  if (mismatches.length > 0) return gateResult("G3", "failed", `reported ${mismatches.join(", ")} differ from the software recomputation`, { claimId, code: "mismatch", evidence });
  if (missing.length > 0) return gateResult("G3", "failed", `no software value for reported ${missing.join(", ")}`, { claimId, code: "missing-recomputed", evidence });
  // G3 never passes vacuously: a check that compared nothing verified nothing.
  if (compared === 0) return gateResult("G3", "failed", "no reported numbers were compared with the software recomputation", { claimId, code: "nothing-compared", evidence });
  return gateResult("G3", "passed", `${compared} reported number(s) equal the software recomputation`, { claimId, evidence });
}

/** Recomputed fields of a primary.json block, in G3's field vocabulary. */
export function entryNumbers(entry: PrimaryEntry | null): Record<string, number> | null {
  if (entry === null) return null;
  const out: Record<string, number> = {};
  if (entry.estimate !== null) out.estimate = entry.estimate;
  if (entry.ci !== null) { out["ci.0"] = entry.ci[0]; out["ci.1"] = entry.ci[1]; }
  if (entry.p !== null) out.p = entry.p;
  if (entry.se !== null) out.se = entry.se;
  if (entry.nUnits !== null) out.n_units = entry.nUnits;
  return out;
}

/** Every number of a parsed claim block in G3's field vocabulary, with source text when known.
 * A field that is present but unreadable becomes NaN, so it can never be compared as equal. */
export function reportedNumbers(entry: PrimaryEntry): Record<string, ClaimedNumber> {
  const out: Record<string, ClaimedNumber> = {};
  const put = (field: string, value: number) => { const raw = entry.raw[field]; out[field] = raw === undefined ? { value } : { value, raw }; };
  if (entry.estimate !== null) put("estimate", entry.estimate);
  if (entry.ci !== null) { put("ci.0", entry.ci[0]); put("ci.1", entry.ci[1]); }
  if (entry.p !== null) put("p", entry.p);
  if (entry.se !== null) put("se", entry.se);
  if (entry.nUnits !== null) put("n_units", entry.nUnits);
  for (const field of (entry.raw.invalidNumbers ?? "").split(",").filter(Boolean)) out[field === "ci" ? "ci.0" : field] = { value: NaN };
  return out;
}

/** Claimed numbers of a results.json claim, read with the same alias table as primary.json
 * (estimate, ci or lower/upper, p, se, n_units and their aliases). An ambiguous field poisons the
 * estimate, so the claim cannot pass G3. */
export function claimedNumbers(claim: unknown, rawNumbers?: ReadonlyMap<string, string>, pointer = ""): Record<string, ClaimedNumber> {
  if (!isRecord(claim)) return {};
  const log = new IssueLog();
  const out = reportedNumbers(readClaimEntry(claim, log, rawNumbers, pointer));
  if (log.errorCount > 0) out.estimate = { value: NaN };
  return out;
}

// ------------------------------------------------------------------ G4

export interface OutputSnapshot {
  readonly invalid?: boolean;
  /** Numeric leaves of the JSON outputs (dotted keys). */
  readonly numbers: Readonly<Record<string, number>>;
  /** sha256 of every other output (files, and non-numeric JSON leaves). */
  readonly hashes: Readonly<Record<string, string>>;
}

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/** Flatten JSON outputs (e.g. {"outputs/metrics.json": {...}}) plus file hashes into a snapshot. */
export function snapshotOutputs(jsonOutputs: Readonly<Record<string, unknown>>, fileHashes: Readonly<Record<string, string>> = {}): OutputSnapshot {
  let invalid = false;
  const numbers: Record<string, number> = {};
  const hashes: Record<string, string> = { ...fileHashes };
  const walk = (value: unknown, key: string, depth: number) => {
    if (depth > 32) { invalid = true; return; }
    if (typeof value === "number") { if (Number.isFinite(value)) numbers[key] = value; else invalid = true; return; }
    if (Array.isArray(value)) { if (value.length === 0) hashes[key] = sha256("[]"); value.forEach((v, i) => walk(v, `${key}/a:${i}`, depth + 1)); return; }
    if (isRecord(value)) { if (Object.keys(value).length === 0) hashes[key] = sha256("{}"); for (const [k, v] of Object.entries(value)) walk(v, `${key}/o:${JSON.stringify(k)}`, depth + 1); return; }
    hashes[key] = sha256(canonicalJson(value ?? null));
  };
  for (const [name, value] of Object.entries(jsonOutputs)) walk(value, `json:${JSON.stringify(name)}`, 0);
  return { numbers, hashes, ...(invalid ? { invalid: true } : {}) };
}

function toOutputMap(s: OutputSnapshot): OutputMap {
  const map: Record<string, string | number[][]> = {};
  for (const [k, v] of Object.entries(s.numbers)) map[`n:${k}`] = [[v]];
  for (const [k, v] of Object.entries(s.hashes)) map[`h:${k}`] = v;
  return map;
}

export interface G4Input {
  /** Outputs of the look run (the first software execution). */
  readonly recorded: OutputSnapshot | null;
  /** One re-run from raw data in a fresh no-network sandbox; a second only after a mismatch.
   * Crashed or killed re-runs are infrastructure failures and must not be passed here. */
  readonly reruns: readonly OutputSnapshot[];
  readonly tolerance?: { readonly rel?: number };
}

export function evaluateG4(input: G4Input): GateResult {
  if (input.recorded === null) return gateResult("G4", "not-run", "no recorded outputs of the look run", { code: "no-recorded-outputs" });
  if (input.reruns.length === 0) return gateResult("G4", "not-run", "the re-run has not executed yet", { code: "no-rerun" });
  if (Object.keys(input.recorded.numbers).length + Object.keys(input.recorded.hashes).length === 0) return gateResult("G4", "failed", "empty output snapshot");
  if (input.recorded.invalid || input.reruns.some((s) => s.invalid)) return gateResult("G4", "failed", "invalid output snapshot");
  const requested = input.tolerance?.rel ?? POLICY.g4RelativeTolerance;
  const rel = Math.min(Math.max(requested, 0), POLICY.g4RelativeTolerance);
  const comparison = compareReexecution({ recorded: toOutputMap(input.recorded), rerun: input.reruns.slice(0, 2).map(toOutputMap), tolerance: { abs: 0, rel } });
  const secondRunRequested = input.reruns.length === 1 && comparison.status !== "reproduced" && comparison.status !== "nondeterministic";
  const evidence = { classification: comparison.status, reruns: Math.min(input.reruns.length, 2), rel, toleranceClamped: requested > POLICY.g4RelativeTolerance,
    secondRunRequested, details: comparison.details.slice(0, 20) };
  if (comparison.status === "reproduced") return gateResult("G4", "passed", "outputs reproduced from raw data", { evidence });
  return gateResult("G4", "failed", secondRunRequested
    ? `re-run ${comparison.status}; a second run is requested to classify it (it cannot rescue a pass)`
    : `re-run ${comparison.status}`, { code: comparison.status, evidence });
}

// ------------------------------------------------------------------ G6

/** Per statistical claim: passed when its locked family is complete (every member has a software
 * p-value) and its method is allowed for the family (the parser already restricts BH to screens). */
export function evaluateG6(plan: Plan, primary: PrimaryOutputs | null): GateResult[] {
  const all = plan.claims.filter((c) => isStatistical(c.kind));
  const statistical = all.filter((c) => !c.exploratory);
  return statistical.map((claim) => {
    if (primary === null) return gateResult("G6", "not-run", "no software outputs", { claimId: claim.id, code: "not-executed" });
    const family = plan.families.find((f) => f.name === claim.family);
    if (!family) return gateResult("G6", "failed", "claim has no locked family", { claimId: claim.id, code: "no-family" });
    const members = statistical.filter((c) => c.family === family.name);
    const ps = members.map((c) => findEntry(primary, c.metric, plan.claims.length === 1)?.p ?? null);
    const missing = ps.filter((p) => p === null).length;
    const adjusted = adjustPValues(ps.map((p) => p ?? 1), family.method, family.size);
    const index = members.findIndex((c) => c.id === claim.id);
    const evidence = { family: family.name, method: family.method, size: family.size, members: members.length, missingP: ps[index]===null?1:0, missingFamilyP: missing, screen: family.screen, pAdjusted: adjusted[index] ?? null };
    if (family.method === "bh" && !(family.screen && family.size >= POLICY.bhMinScreen)) {
      return gateResult("G6", "failed", "BH is only allowed for declared screens of at least 20 tests", { claimId: claim.id, code: "method-not-allowed", evidence });
    }
    if (ps[index]===null) return gateResult("G6", "failed", `${missing} family member(s) have no software p-value`, { claimId: claim.id, code: "incomplete-family", evidence });
    return gateResult("G6", "passed", `${family.method} across ${family.size} test(s) in family ${JSON.stringify(family.name)}`, { claimId: claim.id, evidence });
  });
}
