import { cleanupEvidence, type BoundedCommandResult } from "../../bio-core/src/index.ts";

/** Availability failure of the optional post-turn sweep, after known groups were
 * observed gone. Keep the original unproven evidence; this only permits progress.
 * Only genuine ps/lsof unavailability with no unclassified live candidate may
 * carry sweep-unavailable. Monitoring gaps and observed/uninspectable survivors block. */
export function postTurnSweepWarning(result: Pick<BoundedCommandResult,
  "processTreeReaped" | "cleanupStatus" | "cleanupReason" | "cleanupDiagnostic" | "observedGroupsReaped">): string | undefined {
  if (cleanupEvidence(result) !== "unproven" || result.cleanupStatus !== "unproven" ||
      result.processTreeReaped !== false || result.cleanupReason !== "sweep-unavailable" || result.observedGroupsReaped !== true) return undefined;
  return result.cleanupDiagnostic ?? "post-turn process sweep unavailable; known process groups observed gone";
}
