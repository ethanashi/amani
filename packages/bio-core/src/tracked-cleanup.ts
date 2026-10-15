import { existsSync } from 'node:fs';
import { censusCommand } from './census-command.ts';
import { inspectionReason, sweepIsClean, userProcesses, type CleanupSweepInput, type CleanupSweepOptions, type UserProcess } from './cleanup-evidence.ts';
import type { ProcessRow } from './resource-guard.ts';

/** PID alone is never ownership: start identity must be present and agree. */
export function sameProcess(a: ProcessRow, b: ProcessRow): boolean {
  return a.pid === b.pid && typeof a.startTime === 'string' && a.startTime.length > 0 && a.startTime === b.startTime;
}

/** Seed from observed birth identities, then follow the CURRENT parent chain.
 * An old PID/PGID, a shared cwd, or command text confers no signaling authority. */
export function trackedDescendants(observed: readonly ProcessRow[], rows: readonly UserProcess[]): UserProcess[] {
  const owned = new Set(rows.filter(row => observed.some(old => sameProcess(old, row))).map(row => row.pid));
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) if (!owned.has(row.pid) && owned.has(row.ppid)) { owned.add(row.pid); changed = true; }
  }
  return rows.filter(row => owned.has(row.pid));
}

/** Run-level census for engines whose individual workers have their own policy
 * supervisor. This reports observation, not containment attestation. Workspace
 * references by other host sessions do not make those sessions engine children.
 * Returns false even when an observed survivor was killed successfully. */
export function sweepTrackedProcesses(input: CleanupSweepInput, options: CleanupSweepOptions & {
  inspect?: () => UserProcess[];
  signal?: (pid: number) => void;
  inspectPaths?: (row: UserProcess) => readonly string[];
} = {}): boolean {
  if (input.observed.some(row => typeof row.startTime !== 'string' || !row.startTime)) {
    throw new Error('tracked process inspection failed: missing observed birth identity');
  }
  const inspect = options.inspect ?? (() => userProcesses((executable, args) => censusCommand(executable, args, options)));
  const signal = options.signal ?? ((pid: number) => { process.kill(pid, 'SIGKILL'); });
  const inspectPaths = options.inspectPaths ?? (options.inspect ? () => [] : (row: UserProcess) => {
    const lsof = ['/usr/sbin/lsof', '/usr/bin/lsof'].find(existsSync);
    if (!lsof) throw new Error('open-file process inspection unavailable');
    const lines = censusCommand(lsof, ['-nP', '-a', '-p', String(row.pid), '-Fpfn'], options).split('\n');
    const cwd = lines.indexOf('fcwd');
    if (!lines.includes(`p${row.pid}`) || cwd < 0 || !lines[cwd + 1]?.startsWith('n/') || lines.includes('fNOFD')) throw new Error('incomplete open-file process inspection');
    return lines.filter(line => line.startsWith('n')).map(line => line.slice(1));
  });
  const rows = inspect();
  const owned = trackedDescendants(input.observed, rows);
  let clean = true;
  let failure: unknown;
  for (const row of rows) {
    if (owned.includes(row)) continue;
    if (row.startedAt >= Math.floor(input.startedAt / 1000) * 1000 && !input.preexisting?.some(old => sameProcess(old, row))) {
      try {
        const noReference = sweepIsClean({ ...input, observed: [], processGroupIds: [] }, [{ ...row, paths: inspectPaths(row) }]);
        if (!noReference) {
          if (!inspect().some(current => sameProcess(row, current))) { input.onObservation?.({ event: 'exited', process: row, reason: 'unattributed identity gone before confirmation' }); continue; }
          clean = false;
          input.onObservation?.({ event: 'unattributed', process: row, reason: 'post-run workspace reference without tracked ownership; no signal sent' });
        } else input.onObservation?.({ event: 'unrelated', process: row, reason: 'no tracked ownership or workspace reference' });
      } catch (error) {
        if (!inspect().some(current => sameProcess(row, current))) { input.onObservation?.({ event: 'exited', process: row, reason: 'identity gone during path inspection' }); continue; }
        input.onObservation?.({ event: 'inspection-failure', process: row, reason: inspectionReason(error) });
        failure ??= error;
      }
    }
  }
  for (const candidate of owned) {
    try {
      // Reconcile exit/PID reuse immediately before granting signal authority.
      if (!inspect().some(row => sameProcess(candidate, row))) {
        input.onObservation?.({ event: 'exited', process: candidate, reason: 'identity gone before survivor confirmation' });
        continue;
      }
      try { signal(candidate.pid); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
          input.onObservation?.({ event: 'exited', process: candidate, reason: 'ESRCH at exact-PID signal boundary' });
          continue;
        }
        // A confirmed, attributed process with denied cleanup remains a fault.
        clean = false;
        input.onObservation?.({ event: 'survivor', process: candidate, reason: `tracked identity; SIGKILL failed: ${inspectionReason(error)}` });
        throw error;
      }
      clean = false;
      input.onObservation?.({ event: 'survivor', process: candidate, reason: 'tracked identity confirmed after group cleanup; exact-PID SIGKILL sent' });
    } catch (error) {
      input.onObservation?.({ event: 'inspection-failure', process: candidate, reason: inspectionReason(error) });
      failure ??= error;
      // Still clean up other confirmed descendants even if one inspection fails.
    }
  }
  if (failure) throw new Error(`tracked process cleanup inspection failed: ${inspectionReason(failure)}`, { cause: failure });
  return clean;
}
