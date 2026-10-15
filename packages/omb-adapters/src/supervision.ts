import type { ProcessOutcome, WorkerResult } from './contracts.ts';
import type { sandboxReaper } from './reaper.ts';
type Reaper = ReturnType<typeof sandboxReaper>;
/** The K0 supervisor rules of codex.ts, factored for the Claude adapter (codex.ts keeps its reviewed
 * inline copy; test/claude-parity.test.ts runs the same compiled-stub scenarios against both).
 * Only 0/80/90/124 are supervisor reports about the worker. Any other exit or a signal is the
 * supervisor's own infrastructure failure: containment is unproven and a later clean census never
 * upgrades it. Returns the worker outcome (exit/signal from the receipt) and the failure text. */
export function superviseOutcome(reaper: Reaper, outcome: ProcessOutcome, result: WorkerResult): { outcome: ProcessOutcome; supervisorFailure: string | null } {
  const code = outcome.exitCode;
  let supervisorFailure: string | null = null;
  result.supervisor = { exitCode: code, signal: outcome.signal, survivors: null, census: null };
  if (outcome.signal || code === null || ![0, 80, 90, 124].includes(code)) supervisorFailure = code === 18 ? 'infrastructure census budget exhausted; retry'
    : `infrastructure supervisor failure (${code === null ? `signal ${outcome.signal ?? 'unknown'}` : `exit ${code}`}); containment unproven; retry`;
  let receipt: ReturnType<Reaper['outcome']> | null = null;
  try { receipt = reaper.outcome(); result.supervisor = { exitCode: code, signal: outcome.signal, survivors: receipt.survivors, census: receipt.census, ...(receipt.matched ? {matched: receipt.matched.map(v=>({...v})), matchedTruncated: receipt.matchedTruncated} : {}) }; }
  catch { result.warnings.push('sandbox supervisor receipt unavailable'); }
  try {
    if (supervisorFailure) {
      result.containment = 'unavailable';
      // Best-effort cleanup census only: it can report a survivor, never prove containment.
      try { if (!reaper.reap()) result.containment = 'survivor-killed'; } catch { /* stays unavailable */ }
    } else if (receipt === null) result.containment = 'unavailable'; // the caller's finally still runs a cleanup census
    else if (code === 90) {
      result.containment = 'survivor-killed';
      if (receipt.census === 0) reaper.complete(); else try { reaper.reap(); } catch { /* finally retries */ }
    } else if (outcome.timedOut) result.containment = reaper.reap() ? 'reaped' : 'survivor-killed';
    else { reaper.complete(); result.containment = 'reaped'; }
  } catch { result.containment = 'unavailable'; result.warnings.push('sandbox cleanup census unavailable'); }
  return { outcome: receipt ? { ...outcome, exitCode: receipt.exitCode, signal: receipt.signal } : outcome, supervisorFailure };
}
/** codex.ts finally-block census: an observed survivor or an unprovable cleanup is never ok. */
export function finalCensus(reaper: Reaper | undefined, started: boolean, result: WorkerResult): void {
  const fail = (): void => { if (result.status !== 'violation' && result.status !== 'infra_error') result.status = 'containment_failure'; };
  try { if (started && reaper && !reaper.reap()) { result.containment = 'survivor-killed'; fail(); } }
  catch { result.containment = 'unavailable'; fail(); }
  finally { reaper?.close(); }
}
