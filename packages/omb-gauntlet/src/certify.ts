import {isHardStopKind} from './routing.ts';
// The gauntlet core as one call: locked plan + software outputs + gate results -> per-claim decision,
// software status, task status and limitation lines. Also a file-based entry (files are the
// contract) that computes the pure gates (G1a, G1b, G2, G3, G6) from disk and merges the gate
// results other producers supply (G1, G1c, G4, G5, G7, G8, CIT). V2's `omb certify` wraps this.

import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import path from "node:path";
import { decideClaim, decidePlan, type DecisionResult } from "./decision.ts";
import { GateBoard, gateResult, type GateResult } from "./gates.ts";
import { entryNumbers, evaluateG2, evaluateG3, evaluateG6, reportedNumbers, type PlanLock } from "./gates-pure.ts";
import { IssueLog, type Issue } from "./issues.ts";
import { foldKey, isRecord, parseLenientJson } from "./json.ts";
import { labelClaim, type LabelResult, type SoftwareStatus, type TaskStatus } from "./labels.ts";
import { limitationLines, REPORT_LIMITATIONS } from "./limitations.ts";
import { findClaim, parsePlan, type ClaimKind, type Plan, type PlanClaim } from "./plan.ts";
import { POLICY } from "./policy.ts";
import { buildMetricTable, findEntry, parsePrimary, parseReported, type MetricTable, type MetricValue, type PrimaryOutputs } from "./primary.ts";
import { evaluateG1a, evaluateG1b } from "./units.ts";

export interface CertifyInput {
  /** The locked, normalized plan (null: nothing was locked; every claim is exploratory). */
  readonly plan: Plan | null;
  /** primary.json of the software execution of the frozen code. */
  readonly primary: PrimaryOutputs | null;
  /** metrics.json of the same execution (parsed JSON). */
  readonly metricsJson?: unknown;
  readonly gates: readonly GateResult[];
  /** Hard-stop kinds observed for the job (routing.observedHardStops). */
  readonly hardStops?: readonly string[];
  /** Claim IDs present in results.json; those outside the plan are assessed as exploratory. */
  readonly reportedClaimIds?: readonly string[];
  readonly looksAllowed?: number;
  readonly hypothesisOrdinals?: Readonly<Record<string, number>>;
  /** Host-computed LORD++ thresholds, already bound to the registered program family. */
  readonly decisionAlphaByClaim?: Readonly<Record<string, number>>;
}

export interface ClaimAssessment {
  readonly claimId: string;
  readonly kind: ClaimKind | null;
  readonly planned: boolean;
  readonly decision: DecisionResult;
  readonly label: LabelResult;
  readonly status: SoftwareStatus;
  readonly taskStatus: TaskStatus;
  readonly limitations: readonly string[];
}

export interface Certification {
  readonly assessments: readonly ClaimAssessment[];
  readonly plain_statement: string | null;
  readonly paper_set: unknown | null;
  /** Software numbers for [m:key] prose (includes "<claim>.p_adjusted" and "<claim>.alpha"). */
  readonly metrics: MetricTable;
  readonly reportLimitations: readonly string[];
}

/** The default rule an unplanned claim is explored with: effect-exists, two-sided, software alpha. */
export function exploratoryClaim(id: string): PlanClaim {
  const folded = foldKey(id);
  return {
    id: folded, kind: "effect-exists", metric: folded, fact: null, assertedValue: null, statement: null, estimand: null, test: null,
    direction: "two-sided", alpha: POLICY.alphaDefault, family: null, mei: null, unit: null, exposure: null, outcome: null, adjustment: [], strata: [],
    roles: [], nullValue: 0, target: null, permutationLevel: null, exploratory: true, knobs: {},
  };
}

export function certify(input: CertifyInput): Certification {
  const board = new GateBoard(input.gates);
  const base = buildMetricTable({ metrics: input.metricsJson, primary: input.primary });
  const decisions = new Map<string, DecisionResult>();
  const looks = input.looksAllowed;
  if (input.plan) {
    const decisionPlan=input.decisionAlphaByClaim?{...input.plan,claims:input.plan.claims.map(c=>{
      const alpha=input.decisionAlphaByClaim?.[c.id];return alpha!==undefined&&Number.isFinite(alpha)&&alpha>0?{...c,alpha:Math.min(c.alpha,alpha)}:c;
    })}:input.plan;
    for (const [id, d] of decidePlan({ plan: decisionPlan, primary: input.primary, metrics: base, board, ...(looks === undefined ? {} : { looksAllowed: looks }) })) decisions.set(id, d);
  }
  const unplanned = [...new Set((input.reportedClaimIds ?? []).map(foldKey))].filter((id) => findClaim(input.plan, id) === null).sort();
  // An unkeyed primary.json block belongs to the plan, never to an unplanned claim.
  const keyed: PrimaryOutputs | null = input.primary === null ? null
    : { ...input.primary, entries: new Map([...input.primary.entries].filter(([key]) => key !== "*")) };
  for (const id of unplanned) {
    const claim = exploratoryClaim(id);
    const plan: Plan = { schema: "omb/plan@1", claims: [claim], families: [], knobs: {} };
    decisions.set(id, decideClaim(claim, { plan, primary: keyed, metrics: base, board }));
  }
  const derived: Record<string, MetricValue> = {};
  for (const d of decisions.values()) Object.assign(derived, d.derived);
  const metrics = buildMetricTable({ metrics: input.metricsJson, primary: input.primary, derived });

  const ids = [...(input.plan?.claims.map((c) => c.id) ?? []), ...unplanned];
  const assessments = ids.map((claimId): ClaimAssessment => {
    const claim = findClaim(input.plan, claimId);
    const decision = decisions.get(claimId)!;
    const label = labelClaim({ claimId, claim, decision, board, ...(input.hardStops ? { hardStops: input.hardStops.filter(isHardStopKind) } : {}) });
    const ordinal = input.hypothesisOrdinals?.[claimId];
    const limitations = limitationLines({ claim, label, board, ...(ordinal === undefined ? {} : { hypothesisOrdinal: ordinal }), ...(looks === undefined ? {} : { looksAllowed: looks }) });
    return { claimId, kind: claim?.kind ?? null, planned: claim !== null, decision, label, status: label.status, taskStatus: label.taskStatus, limitations };
  });
  return { assessments, metrics, reportLimitations: REPORT_LIMITATIONS,plain_statement:input.plan?.plainStatement??null,paper_set:input.plan?.paperSet??null };
}

/** Overwrite worker-written statuses in a results.json value with the software task statuses. */
export function overwriteStatuses(results: unknown, certification: Certification): { results: unknown; changes: { claimId: string; from: unknown; to: TaskStatus }[] } {
  if (!isRecord(results) || !Array.isArray(results.claims)) return { results, changes: [] };
  const byId = new Map(certification.assessments.map((a) => [a.claimId, a]));
  const changes: { claimId: string; from: unknown; to: TaskStatus }[] = [];
  const claims = results.claims.map((c: unknown) => {
    if (!isRecord(c) || typeof c.id !== "string") return c;
    const a = byId.get(foldKey(c.id));
    const to: TaskStatus = a ? a.taskStatus : "insufficient-evidence";
    if (c.status !== to) changes.push({ claimId: foldKey(c.id), from: c.status, to });
    return { ...c, status: to };
  });
  return { results: { ...results, claims }, changes };
}

// ------------------------------------------------------------------ files

export const FILE_CAPS = Object.freeze({ plan: 1_000_000, results: 5_000_000, primary: 5_000_000, metrics: 5_000_000, units: 50_000_000, splits: 50_000_000, runAll: 1_000_000 });

/** A capped read keeps "missing" apart from "refused": a refused file exists but is a symlink or
 * not a regular file, exceeds the cap, or cannot be read. Callers must never treat it as absent. */
export type CappedRead =
  | { readonly status: "missing" }
  | { readonly status: "refused"; readonly kind: "not-regular" | "size-cap" | "unreadable"; readonly reason: string }
  | { readonly status: "read"; readonly text: string };

/** One descriptor for check and read: O_NOFOLLOW refuses a final symlink, O_NONBLOCK keeps a FIFO
 * from blocking the open, and fstat/read use the same file, so nothing can be swapped in between. */
export function readCappedFile(file: string, cap: number): CappedRead {
  const refused = (kind: "not-regular" | "size-cap" | "unreadable"): CappedRead => ({ status: "refused", kind,
    reason: kind === "size-cap" ? `exceeds the ${cap}-byte size cap` : kind === "not-regular" ? "not a regular file" : "unreadable" });
  let fd: number;
  try { fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
  catch (e) { const code = (e as NodeJS.ErrnoException).code; return code === "ENOENT" ? { status: "missing" } : refused(code === "ELOOP" ? "not-regular" : "unreadable"); }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) return refused("not-regular");
    if (stat.size > cap) return refused("size-cap");
    // One byte of headroom detects growth after fstat; a file that grew past its size is refused.
    const buffer = Buffer.alloc(stat.size + 1);
    let read = 0, chunk: number;
    while (read < buffer.length && (chunk = readSync(fd, buffer, read, buffer.length - read, null)) > 0) read += chunk;
    if (read > stat.size) return refused(read > cap ? "size-cap" : "unreadable");
    return { status: "read", text: buffer.subarray(0, read).toString("utf8") };
  } catch { return refused("unreadable"); } finally { closeSync(fd); }
}

/** Read a worker or software file: regular files only (symlinks refused), size-capped. A refusal is
 * an issue for a repair turn, never an exception. */
export function readCapped(file: string, cap: number, log: IssueLog, label: string): string | null {
  return loggedRead(readCappedFile(file, cap), cap, log, label);
}

function loggedRead(read: CappedRead, cap: number, log: IssueLog, label: string): string | null {
  if (read.status === "read") return read.text;
  if (read.status === "missing") log.warn("missing-file", label, `${label} is missing`);
  else if (read.kind === "size-cap") log.error("size-cap", label, `${label} exceeds ${cap} bytes`);
  else log.error("invalid-file", label, `${label} is ${read.kind === "not-regular" ? "not a regular file" : "unreadable"}`);
  return null;
}

export interface WorkdirContext {
  readonly effectiveInputsVerified?: boolean;
  /** The lead's workdir: plan.json, results.json, run_all.sh. */
  readonly workdir: string;
  /** Outputs of the software execution (primary.json, metrics.json, units.tsv, splits.tsv);
   * default <workdir>/outputs. */
  readonly outputsDir?: string;
  /** Store lock record (G2): null = never locked, undefined = store unavailable. */
  readonly lock: PlanLock | null | undefined;
  readonly firstLookAt: number | null | undefined;
  /** Software effective unit IDs from staging (null when G1 did not pass). */
  readonly effectiveUnits: ReadonlySet<string> | null;
  /** Results from other producers: G1, G1c, G4, G5a, G5b-*, G7, G8, CIT. */
  readonly gates?: readonly GateResult[];
  readonly hardStops?: readonly string[];
  readonly looksAllowed?: number;
}

export interface WorkdirCertification extends Certification {
  readonly issues: readonly Issue[];
  readonly planStatus: "accepted" | "refused" | "missing";
  readonly gates: readonly GateResult[];
  /** results.json with software statuses, or null when results.json is unusable. */
  readonly results: unknown;
}

export function certifyWorkdir(ctx: WorkdirContext): WorkdirCertification {
  const log = new IssueLog();
  const out = ctx.outputsDir ?? path.join(ctx.workdir, "outputs");
  const planText = readCapped(path.join(ctx.workdir, "plan.json"), FILE_CAPS.plan, log, "plan.json");
  const parsed = planText === null ? null : parsePlan(planText);
  if (parsed) for (const i of parsed.issues) log.items.push({ ...i, path: `plan.json:${i.path}` });
  const plan = parsed?.plan ?? null;

  const primaryText = readCapped(path.join(out, "primary.json"), FILE_CAPS.primary, log, "outputs/primary.json");
  const primaryParsed = primaryText === null ? null : parsePrimary(primaryText);
  if (primaryParsed) log.items.push(...primaryParsed.issues);
  const primary = primaryParsed?.primary ?? null;
  const metricsText = readCapped(path.join(out, "metrics.json"), FILE_CAPS.metrics, log, "outputs/metrics.json");
  const metricsJson = metricsText === null ? undefined : parseLenientJson(metricsText, log, "outputs/metrics.json").value;
  const resultsRead = readCappedFile(path.join(ctx.workdir, "results.json"), FILE_CAPS.results);
  loggedRead(resultsRead, FILE_CAPS.results, log, "results.json");
  // One parser, alias table and key folding for primary.json and results.json. A refused file is
  // invalid (G3 fails closed), never absent.
  const resultsParsed = parseReported(resultsRead.status === "read" ? resultsRead.text : resultsRead.status === "refused" ? { refused: resultsRead.reason } : null);
  log.items.push(...resultsParsed.issues);
  const results = resultsParsed.value ?? null;

  const owned = new Set(["G1a", "G1b", "G2", "G3", "G6"]);
  const gates: GateResult[] = (ctx.gates ?? []).filter((g) => !owned.has(g.gate));
  gates.push(evaluateG2({ plan, lock: ctx.lock, firstLookAt: ctx.firstLookAt }));
  gates.push(evaluateG1a({
    effectiveUnits: ctx.effectiveUnits, primary, effectiveInputsVerified: ctx.effectiveInputsVerified === true,
    unitsTsv: readCapped(path.join(out, "units.tsv"), FILE_CAPS.units, log, "outputs/units.tsv"),
    runAllScript: readCapped(path.join(ctx.workdir, "run_all.sh"), FILE_CAPS.runAll, log, "run_all.sh"),
  }));
  if (plan?.claims.some((c) => c.kind === "out-of-sample")) {
    gates.push(evaluateG1b({ effectiveUnits: ctx.effectiveUnits, splitsTsv: readCapped(path.join(out, "splits.tsv"), FILE_CAPS.splits, log, "outputs/splits.tsv") }));
  }
  if (plan) gates.push(...evaluateG6(plan, primary));

  // G3 per reported claim: results.json numbers against the software block of the same metric.
  // Unreadable, ambiguous, duplicated or unbindable results.json fails G3 closed for every claim.
  const reported: string[] = [];
  const blocks = resultsParsed.reported?.entries ?? new Map();
  const unbound = blocks.has("*") && (plan?.claims.length ?? 0) !== 1;
  if (resultsParsed.status === "invalid" || unbound) {
    for (const claim of plan?.claims ?? []) gates.push(gateResult("G3", "failed", "results.json is unreadable, ambiguous or has a claim that cannot be bound; claimed numbers cannot be compared", { claimId: claim.id, code: "reported-unreadable" }));
  } else {
    for (const [key, block] of blocks) {
      const id = key === "*" ? plan!.claims[0]!.id : key;
      reported.push(id);
      const claim = findClaim(plan, id);
      const entry = findEntry(primary, claim?.metric ?? id, claim !== null && plan!.claims.length === 1);
      gates.push(evaluateG3({ claimId: id, claimed: reportedNumbers(block), recomputed: primary === null ? null : entryNumbers(entry) ?? {} }));
    }
    // Planned claims the worker did not report still get G3; with nothing compared it does not pass.
    for (const claim of plan?.claims ?? []) {
      if (reported.includes(claim.id)) continue;
      const entry = findEntry(primary, claim.metric, plan!.claims.length === 1);
      gates.push(evaluateG3({ claimId: claim.id, claimed: {}, recomputed: primary === null ? null : entryNumbers(entry) ?? {} }));
    }
  }

  const certification = certify({
    plan: ctx.lock == null && plan ? { ...plan, claims: plan.claims.map((c) => ({ ...c, exploratory: true })) } : plan,
    primary, metricsJson, gates, reportedClaimIds: reported,
    ...(ctx.hardStops ? { hardStops: ctx.hardStops.filter(isHardStopKind) } : {}), ...(ctx.looksAllowed === undefined ? {} : { looksAllowed: ctx.looksAllowed }),
  });
  return {
    ...certification, issues: log.items, gates,
    planStatus: parsed === null ? "missing" : parsed.status,
    results: results === null ? null : overwriteStatuses(results, certification).results,
  };
}
