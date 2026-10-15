import { mayRetryLook as mayRetryRecordedLook } from '../../../omb-investigate/src/look-retry.ts';
/** Host classifications, never report prose or a model's self-assigned label. */
export type MedicClass = 'system-fault' | 'infra';
const SCIENCE = new Set(['scientific-abstention', 'assumption-failed', 'insufficient-evidence', 'non-identifiable', 'non-estimable', 'refuted', 'null-result', 'complete-correct', 'complete-wrong']);
const SYSTEM = new Set(['preflight-failed', 'no-plan', 'no-code', 'look-withheld', 'look-failed', 'blocked-by-system-bug', 'refusal-loop', 'appeal-budget-exhausted', 'system-bug', 'error', 'cap-reached']);
/** Hard stops and ledger refusals require the owner, even when gauntlet calls them system-fault.
 * A scientific terminal always wins over a generic incomplete/infra wrapper. */
export function medicClass(input: { outcome?: string; terminal?: string; status: string; pauseKind?: string }): MedicClass | null {
  if ([input.outcome, input.terminal, input.status].some(x => x !== undefined && SCIENCE.has(x))) return null;
  if (['hard-stop', 'look-refused', 'look-crash-channel'].some(x => x === input.terminal || x === input.status)) return null;
  if (input.outcome === 'system-fault' || input.outcome === 'infra') return input.outcome;
  const pauseKind = input.status === 'paused' ? input.pauseKind : undefined;
  if (['provider', 'quota', 'family-unavailable'].includes(pauseKind ?? '') || input.status === 'reviewer-unavailable') return 'infra';
  if (['infra', 'system-bug'].includes(pauseKind ?? '') || input.status === 'infrastructure' || input.terminal === 'infrastructure') return 'system-fault';
  return SYSTEM.has(input.terminal ?? input.status) ? 'system-fault' : null;
}
export function healLimit(phases: readonly string[], phase: string): string | null {
  if (phases.length >= 2) return 'two heals already attempted';
  if (phases.includes(phase)) return 'one heal already attempted in this phase';
  return null;
}
/** Absence of files is NOT proof of no exposure. Only the host's positive execution receipt
 * authorizes reuse. Reuse means the same ledger receipt, never decrement/reset its count. */
export function mayRetryLook(r: { workerStarted: boolean | null; cleanReceipt: boolean; kind: string | null; outputFiles: number; outputsHash: string | null }): boolean {
  return mayRetryRecordedLook({status:'crash',category:'infra',...r});
}
