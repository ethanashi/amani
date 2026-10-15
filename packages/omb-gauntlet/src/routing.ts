// The strictness charter (CONTRACT.md "v2", design sections 2-3 and 5): fail closed on claims,
// fail soft on runs. Exactly four hard stops exist, and each fires only on positive evidence of an
// event that invalidates evidence; a denied attempt or an unavailable audit is a warning. Preflight
// failures stop a job only before its first model turn. Scientific problems lower labels. Everything
// else, including any kind this table has never seen, is a bounded repair turn or a warning. No
// route ever discards a finished analysis.

export const HARD_STOPS = Object.freeze([
  "canary-exposed",
  "non-model-egress",
  "trusted-path-changed",
  "benchmark-key-access",
] as const);
export type HardStopKind = (typeof HARD_STOPS)[number];

export const PREFLIGHT_KINDS = Object.freeze(["analysis-env-missing", "cli-unauthenticated", "disk-floor", "data-terms-refused", "cli-missing"]);
export const SCIENTIFIC_KINDS = Object.freeze([
  "aligned-confounder", "strong-confounder-unhandled", "split-leakage", "unpowered-null", "g7-disagreement",
  "null-miscalibrated", "multiplicity-incomplete", "units-inflated", "not-reproduced",
]);
export const REPAIR_KINDS = Object.freeze([
  "path-shape", "missing-file", "invalid-file", "nan-metric", "size-cap", "resume-failure", "timeout-partial-files",
  "plan-refused", "primary-invalid", "units-invalid", "typed-number", "unknown-metric-reference", "crash-on-real-data",
  "g3-mismatch",
]);
export const WARNING_KINDS = Object.freeze([
  "cleanup-level", "sweep-survivor", "audit-unavailable", "egress-log-unavailable", "cli-hash-drift", "env-hash-drift",
  "startup-inventory", "tool-receipts", "structured-output-missing", "metric-bounds", "probe-departure",
  "canary-denied", "near-duplicate", "cross-table-unverifiable", "axis-heuristic", "sparse-rows", "lenient-parse",
]);

export type FailureClass = "preflight" | "hard-stop" | "scientific" | "repair" | "warning";

export interface ObservedEvent {
  readonly kind: string;
  /** true only when the event was positively observed (proxy log line, canary bytes in output, a
   * changed hash). false/undefined: not observed, or the audit was unavailable. */
  readonly positiveEvidence?: boolean | undefined;
  /** The attempt was denied by containment (e.g. a sealed read refused). Denial = containment worked. */
  readonly denied?: boolean | undefined;
  /** Canary seen only inside a denial message (attempt 25's false flag). */
  readonly insideDenial?: boolean | undefined;
  readonly mode?: "benchmark" | "research" | undefined;
  /** Whether the first model turn of the job has started. */
  readonly afterFirstModelTurn?: boolean | undefined;
}

export interface Route {
  readonly class: FailureClass;
  /** Stop the job (preflight before any LLM turn, or a hard stop). */
  readonly stopsJob: boolean;
  /** Void every claim of the job (hard stops only); the record is always kept. */
  readonly voidsClaims: boolean;
  /** Always false: a finished analysis on disk is never thrown away. */
  readonly discardsAnalysis: false;
  readonly reason: string;
}

const route = (cls: FailureClass, reason: string): Route => ({
  class: cls, stopsJob: cls === "hard-stop" || cls === "preflight", voidsClaims: cls === "hard-stop", discardsAnalysis: false, reason,
});

export function isHardStopKind(kind: string): kind is HardStopKind {
  return (HARD_STOPS as readonly string[]).includes(kind);
}

export function routeFailure(event: ObservedEvent): Route {
  const kind = event.kind;
  if (isHardStopKind(kind)) {
    if (event.positiveEvidence !== true) return route("warning", `${kind} not positively observed (audit unavailable or inconclusive): warning`);
    if (event.denied === true || event.insideDenial === true) return route("warning", `${kind} attempt was denied: containment worked, warning`);
    if (kind === "benchmark-key-access" && event.mode !== "benchmark") return route("warning", "grader or key access outside benchmark mode: warning");
    return route("hard-stop", `${kind} positively observed: stop the job, void its claims, keep the record`);
  }
  if (PREFLIGHT_KINDS.includes(kind)) {
    return event.afterFirstModelTurn === true
      ? route("repair", `${kind} after the first model turn: bounded repair turn, then proceed with a warning`)
      : route("preflight", `${kind} before any model turn: fail now, nothing is lost`);
  }
  if (SCIENTIFIC_KINDS.includes(kind)) return route("scientific", `${kind}: continue; the label drops and the report is still written`);
  if (WARNING_KINDS.includes(kind)) return route("warning", `${kind}: proceed with a warning`);
  if (REPAIR_KINDS.includes(kind)) return route("repair", `${kind}: bounded repair turn with the error shown, then proceed with a warning`);
  return route("repair", `${kind} (unclassified): bounded repair turn, then proceed with a warning; the gauntlet runs on the files on disk`);
}

/** Hard-stop kinds positively observed among the events (for labelClaim's hardStops input). */
export function observedHardStops(events: readonly ObservedEvent[]): HardStopKind[] {
  return [...new Set(events.filter((e) => routeFailure(e).class === "hard-stop").map((e) => e.kind as HardStopKind))].sort();
}
