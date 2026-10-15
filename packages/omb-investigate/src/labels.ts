import {isHardStopKind} from '../../omb-gauntlet/src/routing.ts';
// V7's own label rules. They can only lower a label the certifier assigned, never raise one:
// - degraded single-user mode caps every label at Tentative (kernel v3: Confirmed REQUIRES OS-user
//   separation; a worker sharing the UID could roll back a spent look);
// - a repaired re-run after a crashed look is look 2: never Confirmed;
// - a charter hard stop voids; other terminal paths withhold unverified claims from
//   claim of the plan.
// Route N may promote a confirmed claim to "replicated" only when the independent-data
// certification itself says replicated.

import type { ClaimRecord, Terminal } from "./types.ts";

export const DEGRADED_REASON = "degraded single-user mode: Confirmed requires OS-user separation (_ombcert owns the store and key, worker code runs as _ombrun)";

export interface CapContext { degraded: boolean; lookNumber: number }

export function applyCaps(claims: readonly ClaimRecord[], ctx: CapContext): ClaimRecord[] {
  return claims.map((c) => {
    const top = c.status === "confirmed" || c.status === "replicated";
    const reasons: string[] = [];
    if (ctx.degraded) reasons.push(DEGRADED_REASON);
    if (ctx.lookNumber > 1) reasons.push(`look ${ctx.lookNumber} on this partition: a repaired re-run is never Confirmed`);
    if (reasons.length === 0) return { ...c, reasons: [...c.reasons], limitations: [...c.limitations] };
    return { ...c, ...(top?{status:"tentative" as const,taskStatus:"tentative" as const}:{}), reasons: [...new Set([...c.reasons,...reasons])], limitations: [...new Set([...c.limitations,...reasons])] };
  });
}

export function terminalClaims(claimIds: readonly { id: string; kind: string | null }[], t: Terminal): ClaimRecord[] {
  // Only positive charter hard stops void; crash-channel outcomes are capped separately.
  const voided = t.kind === "hard-stop" && isHardStopKind(t.stop??"");
  const reason = t.kind === "hard-stop" ? `voided by hard stop: ${t.stop ?? "unknown"} (${t.reason})` : `${t.kind}: ${t.reason}`;
  return claimIds.map((c) => ({
    claimId: c.id, kind: c.kind, status: "insufficient-evidence", taskStatus: "insufficient-evidence", reasons: [reason], limitations: [], voided,
  }));
}

export function mergeRouteN(primary: readonly ClaimRecord[], routeN: readonly ClaimRecord[] | null): ClaimRecord[] {
  if (!routeN) return primary.map((c) => ({ ...c }));
  return primary.map((c) => {
    const n = routeN.find((r) => r.claimId === c.claimId);
    if (c.status === "confirmed" && n?.status === "replicated") {
      return { ...c, status: "replicated", reasons: [...c.reasons, "the locked rule also passed every gate on independent data (route N)"] };
    }
    return { ...c, limitations: n ? [...c.limitations, `route N on independent data: ${n.status}`] : [...c.limitations] };
  });
}
