import {isHardStopKind} from './routing.ts';
// The claim-kind labeller (design section 5, "Gates per claim kind" and "Labels"). Software alone
// assigns statuses, from the decision outcome and which gates passed. Requirements vary by kind so
// positive controls are not over-gated; "refuted" always needs power evidence (G5b) for statistical
// claims; "confirmed" is unreachable unless every gate its kind requires passed.

import type { GateBoard, GateId, GateOutcome } from "./gates.ts";
import type { DecisionOutcome, DecisionResult } from "./decision.ts";
import { foldKey } from "./json.ts";
import { POLICY } from "./policy.ts";
import { isStatistical, type ClaimKind, type PlanClaim } from "./plan.ts";

export const SOFTWARE_STATUSES = [
  "confirmed", "replicated", "tentative", "refuted", "insufficient-evidence", "non-identifiable", "exploratory",
] as const;
export type SoftwareStatus = (typeof SOFTWARE_STATUSES)[number];
/** The four statuses of the task results.json contract (bio-tasks checks.py). */
export type TaskStatus = "confirmed" | "tentative" | "refuted" | "insufficient-evidence";

const EFFECT: readonly GateId[] = ["G1a", "G1c", "G2", "G3", "G4", "G5a", "G5c", "G6", "G7", "G8"];
const PERFORMANCE_EFFECT: readonly GateId[] = EFFECT.filter(g => g !== "G5c");
const REFUTE: readonly GateId[] = ["G1a", "G1c", "G2", "G3", "G4", "G5a", "G5b-power", "G5b-recovery", "G5c", "G6", "G7", "G8"];
const PERFORMANCE_REFUTE: readonly GateId[] = REFUTE.filter(g => g !== "G5c");

/** Gates required for the top positive label. null: the kind has no positive top label. */
export const CONFIRM_REQUIREMENTS: Readonly<Record<ClaimKind, readonly GateId[] | null>> = Object.freeze({
  "data-integrity": ["G1", "G2"],
  reproduction: ["G1a", "G2", "G3", "G4", "G5b-recovery", "G7"],
  "effect-exists": EFFECT,
  "effect-size": [...EFFECT, "G5b-recovery"],
  // Design: a null claim's top label is refuted; "otherwise insufficient-evidence".
  null: null,
  // Out-of-sample performance: the estimate requirements plus unit-disjoint splits.
  "out-of-sample": [...PERFORMANCE_EFFECT, "G5b-recovery", "G1b", "G9"],
  citation: ["CIT"],
});

/** Gates required for "refuted". null: the kind cannot be refuted (a failed reproduction is
 * "not reproduced", i.e. insufficient-evidence). Statistical kinds always include G5b-power. */
export const REFUTE_REQUIREMENTS: Readonly<Record<ClaimKind, readonly GateId[] | null>> = Object.freeze({
  // A software-verified deterministic fact: no sampling, so no power question.
  "data-integrity": ["G1", "G2"],
  reproduction: null,
  "effect-exists": REFUTE,
  "effect-size": REFUTE,
  null: REFUTE,
  "out-of-sample": [...PERFORMANCE_REFUTE, "G1b"],
  // The CIT gate's own failure (fabricated / quote-not-found) is the evidence; see decision.ts.
  citation: [],
});

/** Kinds whose label needs the rule fixed before the look (G2) and verified numbers (G3, G4). */
export function needsLockAndNumbers(kind: ClaimKind): boolean {
  return kind === "reproduction" || isStatistical(kind);
}

export interface Requirement {
  readonly gate: GateId;
  readonly outcome: GateOutcome | "absent";
  readonly passed: boolean;
  readonly reason: string | null;
}

export interface LabelInput {
  readonly claimId: string;
  /** The claim in the locked plan; null when the claim is not part of it. */
  readonly claim: PlanClaim | null;
  readonly decision: DecisionResult | null;
  readonly board: GateBoard;
  /** Kinds of hard stops observed for this job (routing.ts). Any one voids every claim. */
  readonly hardStops?: readonly string[];
}

export interface LabelResult {
  readonly claimId: string;
  readonly kind: ClaimKind | null;
  readonly status: SoftwareStatus;
  readonly taskStatus: TaskStatus;
  readonly outcome: DecisionOutcome;
  /** Which top label was examined: confirm for supported outcomes, refute for contradicted ones. */
  readonly path: "confirm" | "refute" | null;
  readonly requirements: readonly Requirement[];
  readonly notPassed: readonly Requirement[];
  readonly reasons: readonly string[];
  readonly voided: boolean;
}

function requirement(board: GateBoard, gate: GateId, claimId: string): Requirement {
  const lookup = board.readonlyLookup(gate, claimId);
  return { gate, outcome: lookup.outcome, passed: lookup.passed, reason: lookup.reason };
}

function describe(r: Requirement): string {
  const state = r.outcome === "passed" ? `reported passed but ${r.reason ?? "did not count"}` : r.outcome === "absent" ? "not run" : r.outcome;
  return `${r.gate} ${state}`;
}

export function taskStatusOf(status: SoftwareStatus, outcome: DecisionOutcome, numbersVerified: boolean): TaskStatus {
  switch (status) {
    case "confirmed":
    case "replicated": return "confirmed";
    case "tentative": return "tentative";
    case "refuted": return "refuted";
    case "exploratory": return outcome === "supported" && numbersVerified ? "tentative" : "insufficient-evidence";
    default: return "insufficient-evidence";
  }
}

export function labelClaim(input: LabelInput): LabelResult {
  const claimId = foldKey(input.claimId);
  const board = input.board;
  const outcome: DecisionOutcome = input.decision?.outcome ?? "unevaluable";
  const numbersVerified = board.passed("G3", claimId) && board.passed("G4", claimId);
  const done = (status: SoftwareStatus, reasons: string[], path: "confirm" | "refute" | null = null, requirements: Requirement[] = [], voided = false): LabelResult => ({
    claimId, kind: input.claim?.kind ?? null, status, taskStatus: taskStatusOf(status, outcome, numbersVerified), outcome, path,
    requirements, notPassed: requirements.filter((r) => !r.passed), reasons, voided,
  });

  const hardStops=(input.hardStops??[]).filter(isHardStopKind);
  if (hardStops.length > 0) {
    return done("insufficient-evidence", [`voided by hard stop: ${[...new Set(hardStops)].sort().join(", ")}`], null, [], true);
  }
  const claim = input.claim;
  if (claim === null) return done("exploratory", ["not part of the locked plan"]);
  if (claim.exploratory) return done("exploratory", ["declared exploratory in the plan"]);
  const kind = claim.kind;
  if (input.decision && (foldKey(input.decision.claimId) !== claimId || input.decision.kind !== kind)) return done("insufficient-evidence", ["decision identity mismatch"]);
  if (kind === "citation" && outcome === "contradicted") {
    const cit = board.readonlyLookup("CIT", claimId);
    const statuses = cit.result?.evidence.statuses;
    if (cit.reason !== null || cit.outcome !== "failed" || !["fabricated", "quote-not-found"].includes(cit.result?.code ?? "") || !Array.isArray(statuses) || !statuses.includes(cit.result!.code!)) return done("insufficient-evidence", ["citation refutation evidence missing or conflicting"]);
  }

  if (needsLockAndNumbers(kind) || kind === "data-integrity") {
    const g2 = requirement(board, "G2", claimId);
    if (!g2.passed) return done("exploratory", [`${describe(g2)}: the decision rule was not fixed before the confirming data were seen`], null, [g2]);
  }
  if (outcome === "unevaluable") return done("insufficient-evidence", [input.decision?.reason ?? "no decision was evaluated"]);
  if (needsLockAndNumbers(kind)) {
    const numbers = [requirement(board, "G3", claimId), requirement(board, "G4", claimId)];
    const failing = numbers.filter((r) => !r.passed);
    if (failing.length > 0) return done("insufficient-evidence", [`numbers not verified (${failing.map(describe).join("; ")})`], null, numbers);
  }
  if (isStatistical(kind)) {
    const g1c = board.readonlyLookup("G1c", claimId);
    if (g1c.outcome === "failed" && g1c.result?.code === "aligned") {
      return done("non-identifiable", ["the exposure is aligned with a measured covariate (G1c); the effect cannot be separated"], null, [requirement(board, "G1c", claimId)]);
    }
  }

  const claimRequirement = (gate: GateId): Requirement => {
    const r = requirement(board, gate, claimId);
    if(gate==='G5b-recovery' && kind==='reproduction' && claim.estimand==='deterministic fact') {
      const lookup=board.readonlyLookup(gate,claimId),e=lookup.result?.evidence;
      if(lookup.outcome==='not-applicable'&&lookup.reason===null&&e?.deterministicRecomputation===true&&e.producer==='registered-fact-v1'&&board.passed('G3',claimId)&&board.passed('G4',claimId))return {...r,passed:true};
    }
    if (!r.passed) return r;
    const e = board.readonlyLookup(gate, claimId).result!.evidence;
    if (gate === "G7" && isStatistical(kind) && (claim.mei === null || typeof e.tolerance !== "number" || e.tolerance > claim.mei / 2)) return { ...r, passed: false, reason: "replication tolerance exceeds the locked MEI bound or MEI missing" };
    if (gate === "G5b-power" && (typeof e.alpha !== "number" || e.alpha > (input.decision?.values.alphaEffective ?? claim.alpha))) return { ...r, passed: false, reason: "power measured at a looser alpha than the decision" };
    if(gate==='G5a'&&e.ruleVersion==='prediction-pair-v1'&&(kind!=='out-of-sample'||claim.test!=='paired prediction permutation'||e.alpha!==claim.alpha))return {...r,passed:false,reason:'prediction waiver does not match locked claim'};
    // Calibrated at the level the claim is decided at: the locked alpha, capped at one-sided .025
    // for a directional claim (owner decision; POLICY.directionalAlphaMax).
    if (gate === "G5a" && e.ruleVersion === "alpha-aware-v2" && e.alpha !== (claim.direction === "two-sided" ? claim.alpha : Math.min(claim.alpha, POLICY.directionalAlphaMax))) return { ...r, passed: false, reason: "calibration alpha differs from the locked claim" };
    if (gate === "G5a" && e.waived === true && !(claim.permutationLevel === "unit" && ["permutation test", "unit-level permutation test", "randomization test", "randomisation test"].includes(claim.test ?? ""))) return { ...r, passed: false, reason: "waiver does not match the locked test" };
    return r;
  };
  if (outcome === "supported") {
    const gates = CONFIRM_REQUIREMENTS[kind];
    if (gates === null) return done("insufficient-evidence", ["a null claim has no confirmed label: the data show an effect the plan did not set out to confirm"], "confirm");
    const reqs = gates.map(claimRequirement);
    const missing = reqs.filter((r) => !r.passed);
    if (missing.length === 0) {
      const route = board.readonlyLookup("G8", claimId).result?.evidence.route;
      return gates.includes("G8") && route === "N"
        ? done("replicated", ["every required gate passed; the look was on independent data (route N)"], "confirm", reqs)
        : done("confirmed", ["every gate this claim kind requires passed"], "confirm", reqs);
    }
    const reason = `not confirmable: ${missing.map(describe).join("; ")}`;
    return needsLockAndNumbers(kind) ? done("tentative", [reason], "confirm", reqs) : done("insufficient-evidence", [reason], "confirm", reqs);
  }
  if (outcome === "contradicted") {
    const gates = REFUTE_REQUIREMENTS[kind];
    if (gates === null) return done("insufficient-evidence", ["not reproduced within the declared tolerance"], "refute");
    const reqs = gates.map(claimRequirement);
    const missing = reqs.filter((r) => !r.passed);
    if (missing.length === 0) return done("refuted", [isStatistical(kind) ? "no effect of interest, with power at least 0.8 at the minimum effect of interest" : "software-verified to be false"], "refute", reqs);
    return done("insufficient-evidence", [`not refutable: ${missing.map(describe).join("; ")}`], "refute", reqs);
  }
  return done("insufficient-evidence", [input.decision?.reason ?? "the data cannot decide"]);
}
