// Program-wide G6 (K2b): the LORD++ state certifyDirectory needs, built from the program-wide
// hypothesis registry. One spending stream per outcome dataset (the staged manifest):
// - hypotheses: EVERY registered hypothesis on the manifest with its mandatory ordinal 1..N,
//   including boss proposals that never ran (claimId null: they hold an ordinal and consume wealth);
//   this plan's locked claims carry their own claim ids at their lock ordinals;
// - priorRejectionOrdinals: software LORD++ rejections already recorded on the manifest at ordinals
//   below every ordinal of this plan (the kernel takes one rejection set per dataset, so rejections
//   inside this plan never raise its own thresholds: conservative);
// - alpha and w0: the registry's (V5 store's) LORD++ policy.
//
// The same decision rule on the same manifest is ONE registered hypothesis, and its first software
// decision is final (the registry keeps the first). A later test of that hypothesis may never get
// more alpha than the first one had:
// - first decision NOT rejected: the re-test gets no alpha at all (claim left unmatched, so the
//   kernel's G6 fails closed); the limitation says why;
// - first decision rejected: the re-test sees at most the rejection set the first one saw;
// - a concurrent re-test that rejects where the recorded first decision did not is capped.
// Nothing here raises a label.

import type { ClaimRecord } from "./types.ts";
import type { HypothesisRegistryPort, MultiplicityDecision, ProgramMultiplicityDataset, RegistryDecision } from "./ports.ts";

export interface ProgramNote { claimId: string; ordinal: number; reason: string; cap: boolean }

export interface ProgramState {
  datasets: ProgramMultiplicityDataset[];
  /** Why a locked claim received less (or no) alpha, or was capped by an earlier final decision. */
  notes: ProgramNote[];
}

export function programState(registry: HypothesisRegistryPort, manifest: string, investigationId: string, ordinals: Readonly<Record<string, number>>): ProgramState {
  const entries = registry.entries(manifest).slice().sort((a, b) => a.ordinal - b.ordinal);
  const decisions = registry.decisions(manifest);
  const { alpha, w0 } = registry.lordSettings();
  const notes: ProgramNote[] = [];
  const byOrdinal = new Map<number, string[]>();
  for (const [claimId, ordinal] of Object.entries(ordinals)) byOrdinal.set(ordinal, [...(byOrdinal.get(ordinal) ?? []), claimId]);
  const own = new Map<number, string>();
  const constraint: { allowed: Set<number> | null } = { allowed: null };
  for (const [ordinal, ids] of [...byOrdinal].sort(([a], [b]) => a - b)) {
    if (ids.length > 1) {
      for (const claimId of ids) notes.push({ claimId, ordinal, cap: false, reason: `claims ${[...ids].sort().join(", ")} lock the same registered hypothesis (${ordinal} on this manifest); none receives alpha (G6 not passed)` });
      continue;
    }
    const claimId = ids[0]!;
    const decided = decisions.find((d) => d.ordinal === ordinal && !(d.investigationId === investigationId && d.claimId === claimId));
    if (decided && !decided.rejected) {
      notes.push({ claimId, ordinal, cap: false, reason: `registered hypothesis ${ordinal} on this manifest was already decided (not rejected) by investigation ${decided.investigationId}; a re-test gets no new alpha (G6 not passed)` });
      continue;
    }
    if (decided) {
      const first = new Set(decided.priorRejectionOrdinals);
      const before = constraint.allowed;
      constraint.allowed = before === null ? first : new Set([...before].filter((o) => first.has(o)));
      notes.push({ claimId, ordinal, cap: false, reason: `registered hypothesis ${ordinal} on this manifest was first decided by investigation ${decided.investigationId}; this re-test sees no more alpha wealth than that decision had` });
    }
    own.set(ordinal, claimId);
  }
  const lowest = Math.min(...Object.values(ordinals));
  const allowed = constraint.allowed;
  const rejectedBelow: number[] = decisions.filter((d) => d.rejected && d.ordinal < lowest && entries.some((e) => e.ordinal === d.ordinal)).map((d) => d.ordinal);
  const prior = [...new Set(rejectedBelow)].filter((o) => allowed === null || allowed.has(o)).sort((a, b) => a - b);
  const contiguous = entries.every((e, i) => e.ordinal === i + 1);
  if (!contiguous || entries.length === 0 || !/^[a-f0-9]{64}$/.test(manifest)) return { datasets: [], notes };
  return {
    datasets: [{ outcomeDatasetHash: manifest, hypotheses: entries.map((e) => ({ claimId: own.get(e.ordinal) ?? null, ordinal: e.ordinal })), priorRejectionOrdinals: prior, alpha, w0 }],
    notes,
  };
}

/**
 * Record the kernel's passed LORD++ G6 decisions on this manifest (first decision per hypothesis is
 * final). Returns a capping note for a claim whose rejection contradicts an earlier recorded
 * non-rejection of the same hypothesis (a concurrent re-test cannot overturn it).
 */
export function recordDecisions(registry: HypothesisRegistryPort, decisions: readonly MultiplicityDecision[], state: ProgramState, manifest: string, investigationId: string): ProgramNote[] {
  const dataset = state.datasets.find((d) => d.outcomeDatasetHash === manifest);
  const notes: ProgramNote[] = [];
  for (const d of decisions) {
    if (d.outcomeDatasetHash !== manifest || !dataset) continue;
    const decision: RegistryDecision = { manifest, ordinal: d.ordinal, rejected: d.rejected, p: d.p, threshold: d.threshold, priorRejectionOrdinals: [...dataset.priorRejectionOrdinals], investigationId, claimId: d.claimId };
    const r = registry.recordDecision(decision);
    if (!r.first && d.rejected && !r.decision.rejected && !(r.decision.investigationId === investigationId && r.decision.claimId === d.claimId)) {
      notes.push({ claimId: d.claimId, ordinal: d.ordinal, cap: true, reason: `registered hypothesis ${d.ordinal} on this manifest was first decided (not rejected) by investigation ${r.decision.investigationId}; that decision is final, so this re-test cannot Confirm` });
    }
  }
  return notes;
}

/** Read the kernel's G6 LORD++ decisions out of signed gate evidence (passed gates only). */
export function lordDecisions(gates: readonly { gate: string; claimId?: string | null; outcome: string; evidence?: Record<string, unknown> }[]): MultiplicityDecision[] {
  const out: MultiplicityDecision[] = [];
  for (const g of gates) {
    const e = g.evidence ?? {};
    if (g.gate !== "G6" || g.outcome !== "passed" || e.rule !== "LORD++" || !g.claimId) continue;
    const { outcomeDatasetHash: hash, hypothesisOrdinal: ordinal, p, threshold, adjustedDecision } = e as Record<string, unknown>;
    if (typeof hash !== "string" || typeof ordinal !== "number" || typeof p !== "number" || typeof threshold !== "number" || typeof adjustedDecision !== "boolean" || adjustedDecision !== (p <= threshold)) continue;
    out.push({ claimId: g.claimId, outcomeDatasetHash: hash, ordinal, p, threshold, rejected: adjustedDecision });
  }
  return out;
}

/**
 * Program-wide G6 is decided by the kernel (LORD++ over the registry state); V7 applies no second
 * multiplicity cap. Notes only explain reduced alpha; a `cap` note enforces the finality of an
 * earlier recorded decision of the same hypothesis (Confirmed/Replicated become Tentative).
 */
export function programLimitations(claims: readonly ClaimRecord[], notes: readonly ProgramNote[]): ClaimRecord[] {
  return claims.map((c) => {
    const mine = notes.filter((n) => n.claimId === c.claimId);
    if (!mine.length) return { ...c };
    const lines = mine.map((n) => n.reason);
    const top = c.status === "confirmed" || c.status === "replicated";
    return top && mine.some((n) => n.cap)
      ? { ...c, status: "tentative", taskStatus: "tentative", reasons: [...c.reasons, ...lines.filter((_, i) => mine[i]!.cap)], limitations: [...c.limitations, ...lines] }
      : { ...c, limitations: [...c.limitations, ...lines] };
  });
}
