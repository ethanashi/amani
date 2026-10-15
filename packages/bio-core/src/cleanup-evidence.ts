import { censusCommand, CensusUnavailable } from "./census-command.ts";
import { existsSync } from "node:fs";
import path from "node:path";
import { canonicalPath, foldPathSpelling, sameFile, within } from "./path-identity.ts";
import type { ProcessRow } from "./resource-guard.ts";

/** Legacy workspace-sweep candidate inspection failed; this is NOT survivor evidence. */
export class SurvivorUninspectable extends Error {
  constructor(cause: unknown) {
    super(`process candidate inspection failed: ${inspectionReason(cause)}`, { cause });
  }
}

export interface CleanupObservation {
  event: "candidate" | "unattributed" | "survivor" | "exited" | "unrelated" | "inspection-failure";
  process: ProcessRow & { startedAt: number; args: string };
  reason: string;
}
export function inspectionReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return error instanceof Error && error.cause ? `${message}: ${inspectionReason(error.cause)}` : message;
}

export type CleanupEvidence = "proven" | "observed-clean" | "unproven";
export interface CleanupSweepInput {
  cwd: string;
  startedAt: number;
  /** Identities ever attributed to a turn, including processes that change groups. */
  observed: readonly ProcessRow[];
  /** Every observed group, including groups retired from signaling authority. */
  processGroupIds: readonly number[];
  /** Observed before spawn: disambiguates the coarse starting second. */
  preexisting?: readonly ProcessRow[];
  onObservation?: (observation: CleanupObservation) => void;
}
export interface SweepProcess extends ProcessRow {
  startedAt: number;
  args: string;
  /** cwd and every named open file, collected by the host. */
  paths: readonly string[];
}

/** A completed sweep is observational evidence, never containment attestation. */
export function sweepIsClean(input: CleanupSweepInput, rows: readonly SweepProcess[]): boolean {
  if (!Array.isArray(input.processGroupIds)) return false;
  const root = canonicalPath(input.cwd);
  for (const row of rows) {
    if (!Number.isFinite(row.startedAt) || !Array.isArray(row.paths) || typeof row.args !== "string") return false;
    const attributed = input.observed.some(old => old.pid === row.pid && old.startTime === row.startTime);
    if (attributed) return false; // Includes launchd/PID 1 reparenting, even after cwd/args change.
    if (row.startTime !== undefined && input.preexisting?.some(old => old.pid === row.pid && old.startTime === row.startTime)) continue;
    // ps start times have second resolution: include the entire starting second.
    if (row.startedAt < Math.floor(input.startedAt / 1000) * 1000) continue;
    if (input.processGroupIds.includes(row.pgid)) return false;
    if (row.paths.some(file => path.isAbsolute(file) && kernelPathReferences(root, input.cwd, file))) return false;
    // Argument strings are not shell-parsed: conservative substring matching also
    // catches --option=/path and embedded scripts. Normalize APFS spelling aliases.
    const folded = foldPathSpelling(row.args);
    if ([root, input.cwd].some(dir => folded.includes(foldPathSpelling(dir)))) return false;
    // Absolute paths can be quoted or embedded in --option= / config: tokens.
    // Unlike lsof names, arguments are not kernel-resolved: errors stay unavailable.
    for (const match of row.args.matchAll(/(?:^|[\s=:"'])(\/[^\s"']*)/g)) {
      const file = match[1]!;
      if (sameFile(root, file) || within(root, file)) return false;
    }
  }
  return true;
}

const permissionDenied = (error: unknown): boolean => ["EPERM", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? "");
const atOrBelow = (root: string, file: string): boolean => {
  const a = foldPathSpelling(root), b = foldPathSpelling(file);
  return a === b || b.startsWith(a.endsWith(path.sep) ? a : `${a}${path.sep}`);
};

/** lsof names are kernel-resolved. A protected unrelated file is not an
 * incomplete process inspection; resolve its accessible ancestors individually.
 * Never apply this permission fallback to user-supplied argument paths. */
function kernelPathReferences(root: string, cwd: string, file: string): boolean {
  if ([root, cwd].some(dir => atOrBelow(dir, file))) return true;
  try { return sameFile(root, file) || within(root, file); }
  catch (error) { if (!permissionDenied(error)) throw error; }
  for (let ancestor = path.dirname(file); ; ancestor = path.dirname(ancestor)) {
    try {
      const resolved = canonicalPath(ancestor);
      const candidate = path.join(resolved, path.relative(ancestor, file));
      return atOrBelow(root, candidate) || atOrBelow(candidate, root);
    } catch (error) {
      if (!permissionDenied(error) || ancestor === path.dirname(ancestor)) throw error;
    }
  }
}

/** Attempt-count budget, independent of host load. Commands still have bounded retries. */
export interface CleanupSweepOptions {
  now?: () => number;
  commandTimeoutMs?: number;
  maxAttempts?: number;
  /** Includes initial, per-process and exit-reconciliation inspections. */
  maxInspections?: number;
}

function sweepBudget(options: CleanupSweepOptions) {
  const maxAttempts = options.maxAttempts ?? 3;
  const maxInspections = options.maxInspections ?? 4096;
  for (const value of [maxAttempts, maxInspections]) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error("invalid process sweep budget");
  }
  let inspections = 0;
  return {
    retry<T>(inspect: () => T): T {
      for (let attempt = 1; ; attempt++) {
        if (++inspections > maxInspections) throw new Error(`post-turn process sweep unavailable: exhausted ${maxInspections} inspections`);
        try { return inspect(); }
        catch (error) {
          if (error instanceof CensusUnavailable) throw error;
          if (attempt >= maxAttempts) throw new Error(`post-turn process sweep unavailable: exhausted ${maxAttempts} inspection attempts: ${error instanceof Error ? error.message : "unknown inspection failure"}`);
        }
      }
    },
    command: (executable: string, args: string[]) => censusCommand(executable, args, options),
  };
}

export interface UserProcess extends ProcessRow { startedAt: number; args: string }
export function userProcesses(command: (executable: string, args: string[]) => string): UserProcess[] {
  if (!process.getuid || process.platform === "win32") throw new Error("user process sweep unsupported");
  const ps = ["/bin/ps", "/usr/bin/ps"].find(existsSync);
  if (!ps) throw new CensusUnavailable("ps unavailable");
  const rows = command(ps, ["-ww", "-axo", "uid=,pid=,ppid=,pgid=,lstart=,args="]).split(/\r?\n/).filter(line => line.trim()).flatMap(line => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\S+\s+\S+\s+\d+\s+\d+:\d+:\d+\s+\d+)\s+(.*)$/.exec(line);
    if (!match) throw new Error("malformed post-turn process census");
    if (Number(match[1]) !== process.getuid!()) return [];
    const startedAt = Date.parse(`${match[5]!} GMT`);
    if (!Number.isFinite(startedAt)) throw new Error("unknown process start time");
    return [{ pid: Number(match[2]), ppid: Number(match[3]), pgid: Number(match[4]), startTime: match[5]!.replace(/\s+/g, " "), startedAt, args: match[6]! }];
  });
  if (!rows.some(row => row.pid === process.pid)) throw new Error("incomplete post-turn process census");
  return rows;
}

/** Sweep the current user's processes; unavailable/incomplete inspection throws.
 * Retry each inspection, never the verdict: a survivor cannot be erased by a
 * later clean snapshot. All reconciliation shares one inspection-count budget;
 * command timeout retries increase their allowance under load. */
export function sweepUserProcesses(input: CleanupSweepInput, options: CleanupSweepOptions = {}): boolean {
  const budget = sweepBudget(options);
  const census = () => budget.retry(() => userProcesses(budget.command));
  const lsof = ["/usr/sbin/lsof", "/usr/bin/lsof"].find(existsSync);
  const candidates = census().filter(row =>
    input.observed.some(old => old.pid === row.pid && old.startTime === row.startTime) ||
    (row.startedAt >= Math.floor(input.startedAt / 1000) * 1000 &&
      !input.preexisting?.some(old => old.pid === row.pid && old.startTime === row.startTime)));
  for (const candidate of candidates) input.onObservation?.({ event: "candidate", process: candidate, reason: "post-turn candidate" });
  // Attribution is already sufficient evidence. Inspect ALL identities before
  // lsof so a failure on an unrelated candidate cannot hide a known survivor.
  const attributed = candidates.filter(row => input.observed.some(old => old.pid === row.pid && old.startTime === row.startTime) || input.processGroupIds.includes(row.pgid));
  if (attributed.length) {
    for (const row of attributed) input.onObservation?.({ event: "survivor", process: row, reason: "observed identity or group" });
    return false;
  }
  for (const candidate of candidates) {
    try {
      const row = budget.retry((): SweepProcess | undefined => {
        try {
          if (!lsof) throw new CensusUnavailable("open-file process sweep unavailable");
          const files = budget.command(lsof, ["-nP", "-a", "-p", String(candidate.pid), "-Fpfn"]);
          const lines = files.split("\n");
          const cwdIndex = lines.indexOf("fcwd");
          if (!lines.includes(`p${candidate.pid}`) || cwdIndex < 0 || !lines[cwdIndex + 1]?.startsWith("n/") ||
              // f/n fields are data, including paths chosen by the worker.
              // stderr diagnostics are rejected separately by censusCommand.
              lines.filter(line => !/^[fn]/.test(line) && line !== `p${candidate.pid}`).some(line => /permission denied|operation not permitted|NOFD|unknown file/i.test(line)) ||
              lines.includes("fNOFD")) {
            throw new Error("incomplete open-file sweep");
          }
          return { ...candidate, paths: lines.filter(line => line.startsWith("n")).map(line => line.slice(1)) };
        } catch (error) {
          // Both failed and incomplete lsof results can race process exit. Only a
          // successful census establishing that this identity is gone excuses it.
          if (!census().some(row => row.pid === candidate.pid && row.startTime === candidate.startTime)) {
            input.onObservation?.({ event: "exited", process: candidate, reason: inspectionReason(error) });
            return undefined;
          }
          throw error;
        }
      });
      if (row) {
        const clean = sweepIsClean(input, [row]);
        input.onObservation?.({ event: clean ? "unrelated" : "survivor", process: candidate, reason: clean ? "no workspace reference" : "workspace path or argument reference" });
        if (!clean) return false;
      }
    } catch (error) {
      // Includes unavailable reconciliation and exhausted budgets: neither
      // establishes that the candidate seen alive has disappeared.
      input.onObservation?.({ event: "inspection-failure", process: candidate, reason: inspectionReason(error) });
      throw new SurvivorUninspectable(error);
    }
  }
  return sweepIsClean(input, []);
}

/** Both the evidence level and proof flag must agree; missing/unknown never passes. */
export function cleanupEvidence(result: { processTreeReaped: boolean; cleanupStatus?: CleanupEvidence }): CleanupEvidence {
  if (result.cleanupStatus === "proven") return result.processTreeReaped === true ? "proven" : "unproven";
  return result.cleanupStatus === "observed-clean" && result.processTreeReaped === false ? "observed-clean" : "unproven";
}
