// G7 (cross-family replication) and G8 (the recorded look) as gate results the gauntlet board
// re-checks. The comparison is software only (design section 5, G7 row): same evaluator decision on
// both software-run primary.json files, and |delta estimate| <= min(sqrt(SE1^2 + SE2^2), MEI/2).
// Same-family agreement counts as zero. V8 owns the calibrated tolerance; this is the design
// formula, kept behind a function so V8 can replace it.

import {
  buildMetricTable, decideClaim, findEntry, GateBoard, gateResult, parsePrimary, type GateResult, type Plan, type PlanClaim, type PrimaryOutputs,
} from "../../omb-gauntlet/src/index.ts";
import type { Family, Route } from "./types.ts";

export function readPrimary(text: string | null): PrimaryOutputs | null {
  return text === null ? null : parsePrimary(text).primary;
}

function decision(plan: Plan, claim: PlanClaim, primary: PrimaryOutputs | null): string {
  if (primary === null) return "unevaluable";
  return decideClaim(claim, { plan, primary, metrics: buildMetricTable({ primary }), board: new GateBoard([]) }).outcome;
}

export interface G7Input {
  plan: Plan;
  claim: PlanClaim;
  lead: PrimaryOutputs | null;
  replicator: PrimaryOutputs | null;
  families: [string, string];
  /** Software executed the replicator's frozen code and its two runs agree (G3/G4 on the replicator). */
  replicatorVerified: boolean;
}

export function compareReplication(input: G7Input): GateResult {
  const { plan, claim } = input;
  const single = plan.claims.length === 1;
  const a = findEntry(input.lead, claim.metric, single), b = findEntry(input.replicator, claim.metric, single);
  const decisions = [decision(plan, claim, input.lead), decision(plan, claim, input.replicator)] as const;
  const sameDecision = decisions[0] === decisions[1] && decisions[0] !== "unevaluable";
  const seLead = a?.se ?? null, seRepl = b?.se ?? null;
  const delta = a?.estimate != null && b?.estimate != null ? b.estimate - a.estimate : null;
  const bound = seLead !== null && seRepl !== null ? Math.hypot(seLead, seRepl) : null;
  const tolerance = bound === null ? null : claim.mei === null ? bound : Math.min(bound, claim.mei / 2);
  const withinTolerance = delta !== null && tolerance !== null && Math.abs(delta) <= tolerance;
  const sameFamily = input.families[0] === input.families[1];
  const evidence = {
    scope: "implementation-agreement", methodsCorroboration: false,
    families: [input.families[0], input.families[1]], sameDecision, withinTolerance, deltaEstimate: delta,
    seLead: seLead ?? -1, seReplicator: seRepl ?? -1, tolerance, replicatorVerified: input.replicatorVerified,
    decisions: [decisions[0], decisions[1]],
  };
  const passed = !sameFamily && sameDecision && withinTolerance && input.replicatorVerified && seLead !== null && seRepl !== null;
  const why = sameFamily ? "same-family agreement counts as zero"
    : !input.replicatorVerified ? "the replicator's code was not verified by software"
      : !sameDecision ? `decisions differ (${decisions[0]} vs ${decisions[1]})`
        : !withinTolerance ? "replicated estimate outside min(sqrt(SE1^2+SE2^2), MEI/2) or SE missing"
          : "cross-family implementation agreement; not methods corroboration";
  return gateResult("G7", passed ? "passed" : "failed", why, { claimId: claim.id, code: passed ? undefined : sameFamily ? "same-family" : "disagreement", evidence });
}

/** G7 not run (no other family available, replicator refused, exhausted): absent evidence, never passed. */
export function g7NotRun(claimId: string, reason: string): GateResult {
  return gateResult("G7", "not-run", reason, { claimId, code: "not-run" });
}

/** G8: one recorded look, made by software with no LLM present, recorded before execution. */
export function lookGate(claimId: string, look: { route: Route; partitionId: string; number: number; recordedBeforeExecution: boolean }): GateResult {
  const first = look.number === 1;
  return gateResult("G8", first && look.recordedBeforeExecution ? "passed" : "failed", first ? "one software look recorded before execution" : `look ${look.number} on this partition`, {
    claimId, code: first ? undefined : "repeat-look",
    evidence: { route: look.route, partitionId: look.partitionId, lookNumber: look.number, recordedBeforeExecution: look.recordedBeforeExecution, llmPresent: false },
  });
}
