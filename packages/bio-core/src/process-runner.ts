import { type ChildProcess, spawn } from "node:child_process";
import { accessSync, constants as fsConstants, existsSync } from "node:fs";
import { Socket } from "node:net";
import path from "node:path";

import type { BoundedCommandResult, BoundedCommandSpec, CommandRunner, ResourceLimitKill } from "./process-contracts.ts";
import { assertResourceLimits, familyRows, parseCpuTime, ResourceGuard, type ProcessRow } from "./resource-guard.ts";

import { censusCommand, CensusUnavailable, type CensusCommandOptions } from "./census-command.ts";
import { inspectionReason, sweepUserProcesses, type CleanupSweepInput, type CleanupObservation } from "./cleanup-evidence.ts";

interface ProcessFamily {
  pid: number;
  processGroupIds: number[];
}

const NICE_CANDIDATES = ["/usr/bin/nice", "/bin/nice"];

/** Only emitted for an observed host spawn error with no target identity. */
export class CommandStartFailure extends Error {
  readonly targetStarted = false;
  readonly code: string;
  constructor(code: string, cause: Error) {
    super(`bounded command failed to start (${code}): ${cause.message}`, { cause });
    this.name = "CommandStartFailure";
    this.code = code;
  }
}

export class BoundedProcessRunner implements CommandRunner {
  readonly #active = new Map<number, ProcessFamily>();
  #stopping = false;
  #cleanupUnproven = false;
  readonly #inspectProcesses: () => ProcessRow[];
  readonly #now: () => number;
  readonly #sweep: (input: CleanupSweepInput) => boolean;

  constructor(input: { inspectProcesses?: () => ProcessRow[]; now?: () => number; sweepProcesses?: (input: CleanupSweepInput) => boolean } = {}) {
    this.#inspectProcesses = input.inspectProcesses ?? processRows;
    this.#now = input.now ?? Date.now;
    this.#sweep = input.sweepProcesses ?? sweepUserProcesses;
  }

  get activeProcessFamilies(): number {
    return this.#active.size;
  }

  async run(spec: BoundedCommandSpec): Promise<BoundedCommandResult> {
    validateSpec(spec);
    if (this.#stopping) throw new Error("bounded process runner is stopping");
    const inspect = (): ProcessRow[] => {
      const rows = this.#inspectProcesses();
      if (!rows.some(row => row.pid === process.pid)) throw new Error("host process census unavailable; cannot attest cleanup");
      return rows;
    };
    // Refuse before any side effect if process ownership cannot be observed.
    const before = inspect();
    const guard = spec.resourceLimits ? new ResourceGuard(spec.resourceLimits) : null;
    if (guard) {
      // Limits that cannot be measured are not limits: refuse rather than run unguarded.
      const own = before.find(row => row.pid === process.pid);
      if (own?.rssKb === undefined || own.cpuMs === undefined) throw new Error("host resource census unavailable; cannot enforce resource limits");
    }
    const launch = launchCommand(spec);
    let cleanupDiagnostic: string | undefined;
    let censusTrusted = true; // Completeness is separately unproven even when every snapshot succeeds.
    const startedAt = this.#now();
    const child = spawn(launch.command, launch.args, {
      cwd: spec.cwd,
      env: spec.env ?? process.env,
      detached: process.platform !== "win32",
      stdio: [spec.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe", ...(spec.onSocketChannel ? ["ipc" as const] : [])],
    });
    // Register before inspecting pid: failed spawn emits error asynchronously,
    // followed by close. A missing pid alone is not proof of a failed start.
    let spawned = false;
    child.once("spawn", () => { spawned = true; });
    const closed = new Promise<void>(resolve => child.once("close", () => resolve()));
    const exit = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null } | { error: Error }>(resolve => {
      child.once("error", error => resolve({ error }));
      child.once("close", (exitCode, signal) => resolve({ exitCode, signal }));
    });
    if (!child.pid) {
      const terminal = await exit;
      await closed;
      if ("error" in terminal) {
        const error = terminal.error as NodeJS.ErrnoException;
        if (!spawned && !child.pid && error.syscall === `spawn ${launch.command}`
          && ["ENOENT", "EACCES", "ENOTDIR"].includes(error.code ?? "")) {
          throw new CommandStartFailure(error.code!, error);
        }
        throw error;
      }
      throw new Error("bounded command started without a process id");
    }
    const pid = child.pid;

    if (spec.stdin !== undefined && child.stdin) {
      child.stdin.on("error", () => { /* the target may exit without reading; its exit status decides */ });
      child.stdin.end(spec.stdin);
    }
    const groups = new Set<number>([pid]);
    const retired = new Set<number>();
    const retiredGone = new Set<number>();
    const observedGroups = new Set<number>([pid]);
    let priorRows: ProcessRow[] = [];
    const observed = new Map<string, ProcessRow>();
    const retireStaleGroups = (rows: ProcessRow[]) => {
      for (const group of groups) {
        const old = priorRows.filter(row => row.pgid === group);
        const current = rows.filter(row => row.pgid === group);
        const overlap = old.some(a => current.some(b => a.pid === b.pid && a.startTime === b.startTime));
        const gone = !processGroupAlive(group);
        const oldLeader = old.find(row => row.pid === group);
        const newLeader = current.find(row => row.pid === group);
        const reused = oldLeader?.startTime && newLeader?.startTime && oldLeader.startTime !== newLeader.startTime;
        if (gone || reused) retiredGone.add(group);
        if (gone || (old.length > 0 && current.length > 0 && !overlap)) {
          groups.delete(group); retired.add(group);
        }
      }
      priorRows = rows;
    };
    let guardArmed = guard !== null;
    let resourceKill: ResourceLimitKill | undefined;
    let limitHit: () => void = () => {};
    const limitReached = new Promise<"limit">(resolve => { limitHit = () => resolve("limit"); });
    const capture = () => {
      let rows: ProcessRow[] | undefined;
      try {
        rows = inspect();
        retireStaleGroups(rows);
        for (const group of relatedProcessGroups(pid, rows, groups)) if (!retired.has(group)) { groups.add(group); observedGroups.add(group); }
        for (const row of familyRows(retired.has(pid) ? -1 : pid, groups, rows)) {
          observed.set(`${row.pid}:${row.startTime}`, row);
        }
      } catch (error) {
        censusTrusted = false; rows = undefined;
        cleanupDiagnostic ??= inspectionReason(error);
      }
      if (guard && guardArmed && !resourceKill) {
        const kill = guard.observe(rows === undefined ? undefined : familyRows(retired.has(pid) ? -1 : pid, groups, rows).filter(row => !retired.has(row.pgid)));
        if (kill) { resourceKill = kill; limitHit(); }
      }
      this.#active.set(pid, {
        pid,
        processGroupIds: [...groups].sort((left, right) => left - right),
      });
    };
    capture();
    const census = setInterval(capture, 20);
    census.unref();
    const outputLimit = spec.maxOutputBytes ?? 256 * 1024;
    let stdout: Buffer = Buffer.alloc(0);
    let stderr: Buffer = Buffer.alloc(0);
    let outputTruncated = false;
    let observerFailed: (error: Error) => void = () => {};
    const observerFailure = new Promise<{ error: Error }>(resolve => { observerFailed = error => resolve({ error }); });
    const observeChunk = (observer: ((chunk: string) => void) | undefined, chunk: Buffer) => {
      try { observer?.(chunk.toString("utf8")); }
      catch (error) { observerFailed(error instanceof Error ? error : new Error(String(error))); }
    };
    child.stdout?.on("data", (chunk: Buffer) => {
      outputTruncated ||= stdout.length + chunk.length > outputLimit;
      stdout = appendBounded(stdout, chunk, outputLimit);
      observeChunk(spec.onStdoutChunk, chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      outputTruncated ||= stderr.length + chunk.length > outputLimit;
      stderr = appendBounded(stderr, chunk, outputLimit);
      observeChunk(spec.onStderrChunk, chunk);
    });
    let timeoutHandle: NodeJS.Timeout | undefined;
    const timeout = new Promise<"timeout">((resolve) => {
      timeoutHandle = setTimeout(() => resolve("timeout"), spec.timeoutMs);
      timeoutHandle.unref();
    });
    let timedOut = false;
    try {
      spec.onSocketChannel?.(socket => {
        if (!(socket instanceof Socket) || socket.destroyed || socket.connecting
          || !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(socket.localAddress ?? "")
          || !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(socket.remoteAddress ?? "")) {
          return Promise.reject(new Error("handoff requires an accepted loopback connection"));
        }
        return new Promise<void>((resolve, reject) => {
          if (!child.connected || !child.send) { reject(new Error("product socket channel unavailable")); return; }
          const finish = (error?: Error | null) => {
            clearTimeout(deadline); child.off("disconnect", disconnected);
            error ? reject(error) : resolve();
          };
          const disconnected = () => finish(new Error("product socket channel disconnected"));
          const deadline = setTimeout(() => finish(new Error("product socket handoff acknowledgement expired")), 1000);
          child.once("disconnect", disconnected);
          try { child.send({ type: "omerta:accepted-connection-v1" }, socket, { keepOpen: false }, finish); }
          catch (error) { finish(error instanceof Error ? error : new Error("product socket handoff failed")); }
        });
      });
      let terminal = await Promise.race([exit, timeout, limitReached, observerFailure]);
      guardArmed = false;
      if (terminal === "timeout" || terminal === "limit") {
        if (terminal === "timeout") timedOut = true;
        capture();
        // A resource hog gets no graceful interval in which to allocate more: SIGKILL at once. (SIGTERM followed at once
        // by SIGKILL would race Darwin's EPERM for a group that is already exiting.)
        if (terminal === "limit") await killGroups([...groups], child, FORCED_REAP_MS, this.#now);
        else await reapGroups([...groups], child, 300, FORCED_REAP_MS, this.#now);
        terminal = await exit;
      }
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if ("error" in terminal) throw terminal.error;
      capture();
      // A closed root may have independent command owners settling IPC loss.
      // Observe the retained groups before disrupting their cleanup census.
      // This is an opportunity to settle, never evidence of cleanup by itself.
      // Deliberate termination keeps its existing eager signal/deadline path.
      if (!timedOut && !resourceKill && !this.#stopping) {
        await waitForExit(groups, Math.min(spec.settleMs ?? 2_000, Math.max(0, startedAt + spec.timeoutMs - this.#now())), () => this.#stopping, this.#now);
        capture();
      }
      await reapGroups([...groups], child, 300, FORCED_REAP_MS, this.#now);
      // Only a positive ESRCH or changed group-leader birth identity discharges a
      // historical group. Mere loss of sampled membership still fails closed.
      // A reused numeric PGID belongs to another launch, not this turn.
      const knownGroupsReaped = [...observedGroups].every(group => retiredGone.has(group) || !processGroupAlive(group));
      let cleanupReason: BoundedCommandResult["cleanupReason"];
      let swept = false;
      const cleanupObservations: CleanupObservation[] = [];
      try { swept = this.#sweep({ cwd: spec.cleanupCwd ?? spec.cwd, startedAt, observed: [...observed.values()], processGroupIds: [...observedGroups], preexisting: before, onObservation: observation => cleanupObservations.push(observation) }) === true; }
      catch (error) {
        // Only actual command unavailability before any unclassified live
        // candidate can soften a run. Malformed evidence and budget exhaustion block.
        cleanupReason = error instanceof CensusUnavailable ? "sweep-unavailable" : "inspection-failed";
        cleanupDiagnostic = inspectionReason(error);
      }
      if (cleanupObservations.some(observation => observation.event === "unattributed")) cleanupReason ??= "unattributed";
      if (cleanupObservations.some(observation => observation.event === "survivor")) cleanupReason = "survivor";
      if (!censusTrusted) cleanupReason = "census-unavailable";
      else if (!knownGroupsReaped) cleanupReason = "groups-alive";
      else if (!swept) cleanupReason ??= "survivor";
      const cleanupStatus = cleanupReason ? "unproven" : "observed-clean";
      this.#cleanupUnproven ||= cleanupStatus === "unproven";
      const processTreeReaped = false; // No attesting containment backend is installed.
      return {
        pid,
        exitCode: terminal.exitCode,
        signal: terminal.signal,
        timedOut,
        processTreeReaped,
        cleanupStatus,
        cleanupObservations,
        ...(cleanupReason ? { cleanupReason } : {}),
        ...(cleanupDiagnostic ? { cleanupDiagnostic } : {}),
        observedGroupsReaped: knownGroupsReaped,
        processGroupIds: [...observedGroups].sort((left, right) => left - right),
        stdout: decodeOutput(stdout),
        stderr: decodeOutput(stderr),
        outputTruncated,
        durationMs: this.#now() - startedAt,
        ...(resourceKill ? { resourceKill } : {}),
        ...(guard ? { resourceUsage: guard.usage() } : {}),
      };
    } catch (error) {
      this.#cleanupUnproven = true;
      capture();
      await reapGroups([...groups], child, 300, FORCED_REAP_MS, this.#now);
      await closed;
      throw error;
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      clearInterval(census);
      this.#active.delete(pid);
    }
  }

  async stopAll(): Promise<void> {
    this.#stopping = true;
    const families = [...this.#active.values()];
    const reaped = await Promise.all(
      families.map((family) => reapGroups(family.processGroupIds, undefined, 300, FORCED_REAP_MS, this.#now)),
    );
    if (this.#cleanupUnproven || families.length > 0 || reaped.some((value) => !value)) {
      throw new Error("bounded process cleanup unproven: sampled census cannot exclude escaped descendants");
    }
  }
}

function validateSpec(spec: BoundedCommandSpec): void {
  if (spec.maxOutputBytes !== undefined && (!Number.isSafeInteger(spec.maxOutputBytes) || spec.maxOutputBytes < 1)) throw new Error("invalid output byte cap");
  if (spec.onSocketChannel !== undefined && (typeof spec.onSocketChannel !== "function" || process.platform === "win32")) throw new Error("socket handoff unavailable on this platform");
  if (!spec.command.trim() || !path.isAbsolute(spec.cwd) || (spec.cleanupCwd !== undefined && (!path.isAbsolute(spec.cleanupCwd) || spec.cleanupCwd.includes("\0")))) {
    throw new Error("invalid bounded command identity");
  }
  if (!Number.isInteger(spec.timeoutMs) || spec.timeoutMs < 1) {
    throw new Error("invalid bounded command timeout");
  }
  if (spec.args.some((argument) => argument.includes("\0"))) {
    throw new Error("bounded command argument contains NUL");
  }
  if (spec.resourceLimits !== undefined) {
    if (process.platform === "win32") throw new Error("resource limits require a supported host census");
    assertResourceLimits(spec.resourceLimits);
  }
  if (spec.nice !== undefined && (!Number.isInteger(spec.nice) || spec.nice < 1 || spec.nice > 19 || process.platform === "win32")) {
    throw new Error("invalid bounded command niceness (1-19 on a POSIX host)");
  }
  if (spec.settleMs !== undefined && (!Number.isInteger(spec.settleMs) || spec.settleMs < 0)) {
    throw new Error("invalid bounded command settle bound");
  }
  if (spec.stdin !== undefined && typeof spec.stdin !== "string") throw new Error("invalid bounded command stdin");
}

/**
 * `nice -n N target args`: nice sets the priority and then execs the target, so the pid, its process group and every
 * descendant carry the niceness from the first instruction (no window in which an early child escapes it). A target
 * that cannot be executed is refused before spawn, as an observed start failure with no target identity.
 */
function launchCommand(spec: BoundedCommandSpec): { command: string; args: string[] } {
  if (spec.nice === undefined) return { command: spec.command, args: spec.args };
  if (!path.isAbsolute(spec.command)) throw new Error("niced bounded command requires an absolute executable");
  const nice = NICE_CANDIDATES.find(file => existsSync(file));
  if (!nice) throw new Error("host nice utility unavailable");
  try { accessSync(spec.command, fsConstants.X_OK); }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? "EACCES";
    throw new CommandStartFailure(["ENOENT", "EACCES", "ENOTDIR"].includes(code) ? code : "EACCES",
      Object.assign(new Error(`${spec.command}: ${(error as Error).message}`), { code }));
  }
  return { command: nice, args: ["-n", String(spec.nice), spec.command, ...spec.args] };
}

export function processRows(options: CensusCommandOptions = {}): ProcessRow[] {
  if (process.platform === "win32") throw new Error("bounded process-tree proof requires a supported host census");
  const executable = ["/bin/ps", "/usr/bin/ps"].find(file => existsSync(file));
  if (!executable) throw new Error("host process census unavailable: install procps");
  const stdout = censusCommand(executable, ["-axo", "pid=,ppid=,pgid=,rss=,time=,lstart="], options);
  return parseProcessRows(stdout);
}

/** Parse ps identity/resource/start columns. Invalid identity rows reject the census; unavailable resource columns are omitted. */
export function parseProcessRows(text: string): ProcessRow[] {
  return text.split(/\r?\n/).flatMap((line) => {
    if (!line.trim()) return [];
    const parts = line.trim().split(/\s+/);
    const pid = Number(parts[0]);
    const ppid = Number(parts[1]);
    const pgid = Number(parts[2]);
    if (!(Number.isInteger(pid) && pid > 0 && Number.isInteger(ppid) && ppid >= 0 && Number.isInteger(pgid) && pgid > 0)) throw new Error("malformed host process census row");
    const row: ProcessRow = { pid, ppid, pgid };
    if (parts.length > 5) row.startTime = parts.slice(5).join(" ");
    const rssKb = parts[3] !== undefined && /^\d+$/.test(parts[3]) ? Number(parts[3]) : undefined;
    const cpuMs = parseCpuTime(parts[4]);
    if (rssKb !== undefined && Number.isSafeInteger(rssKb)) row.rssKb = rssKb;
    if (cpuMs !== undefined) row.cpuMs = cpuMs;
    return [row];
  });
}

/**
 * Process groups owned by the command rooted at `rootPid`. `knownGroups` are groups already attributed to the family:
 * their live members seed the descendant walk too, so a grandchild that starts its own session is still found after
 * the root itself has died (the root's group lives on in its children). A grandchild whose every ancestor died before
 * any census saw it is reparented to init and cannot be attributed by a `ps` census; that limit is documented.
 */
export function relatedProcessGroups(rootPid: number, rows: ProcessRow[], knownGroups: Iterable<number> = []): number[] {
  if (process.platform === "win32") return [rootPid];
  const ownGroup = rows.find((row) => row.pid === process.pid)?.pgid;
  const known = new Set(knownGroups);
  const root = rows.find((row) => row.pid === rootPid);
  const rootValid = root !== undefined && root.pgid === rootPid;
  const seeds = rows.filter((row) => row.pid !== process.pid && row.pgid !== ownGroup && known.has(row.pgid)).map((row) => row.pid);
  if (!rootValid && seeds.length === 0) return [];
  const descendants = new Set(rootValid ? [rootPid, ...seeds] : seeds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (descendants.has(row.ppid) && !descendants.has(row.pid)) {
        descendants.add(row.pid);
        changed = true;
      }
    }
  }
  const groups = new Set<number>(rootValid ? [rootPid] : []);
  for (const row of rows) {
    if (
      descendants.has(row.pid) &&
      row.pgid !== ownGroup &&
      (row.pgid === rootPid || descendants.has(row.pgid) || known.has(row.pgid))
    ) {
      groups.add(row.pgid);
    }
  }
  return [...groups];
}

export function processGroupAlive(groupId: number): boolean {
  try {
    process.kill(process.platform === "win32" ? groupId : -groupId, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

function signalGroup(groupId: number, signal: NodeJS.Signals, child?: ChildProcess): void {
  try {
    if (process.platform === "win32") {
      if (child?.pid === groupId) child.kill(signal);
      else process.kill(groupId, signal);
    } else {
      process.kill(-groupId, signal);
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return;
    // Darwin can report EPERM while an exiting group loses its last signalable
    // member. Accept only a NEW ESRCH observation, never EPERM itself. A live
    // group, denied observation or unknown syscall error still fails closed.
    if (code === "EPERM" && !processGroupAlive(groupId)) return;
    throw error;
  }
}

// After SIGKILL, a killed tree can take seconds to leave the process table on a loaded host (2026-09-29: a
// Claude worker's shells were still listed 1 s after SIGKILL at load ~25 on 10 cores, and the build was blocked).
// Waiting longer only costs time when groups linger; a group that never dies is still a blocker.
const FORCED_REAP_MS = 5_000;

export async function reapGroups(
  groupIds: number[],
  child: ChildProcess | undefined,
  gracefulMs: number,
  forcedMs: number,
  now: () => number = Date.now,
): Promise<boolean> {
  const unique = [...new Set(groupIds)];
  for (const group of unique.filter(processGroupAlive)) signalGroup(group, "SIGTERM", child);
  if (await waitForExit(unique, gracefulMs, () => false, now)) return true;
  for (const group of unique.filter(processGroupAlive)) signalGroup(group, "SIGKILL", child);
  return waitForExit(unique, forcedMs, () => false, now);
}

/** Immediate forced termination (resource-limit kills). Same EPERM/ESRCH discipline as `reapGroups`. */
export async function killGroups(groupIds: number[], child: ChildProcess | undefined, forcedMs: number, now: () => number = Date.now): Promise<boolean> {
  const unique = [...new Set(groupIds)];
  for (const group of unique.filter(processGroupAlive)) signalGroup(group, "SIGKILL", child);
  return waitForExit(unique, forcedMs, () => false, now);
}

async function waitForExit(groupIds: Iterable<number>, timeoutMs: number, interrupted = () => false, now: () => number = Date.now): Promise<boolean> {
  const deadline = now() + timeoutMs;
  while (now() < deadline && !interrupted()) {
    if ([...groupIds].every((group) => !processGroupAlive(group))) return true;
    await new Promise((resolve) => setTimeout(resolve, Math.min(20, deadline - now())));
  }
  return [...groupIds].every((group) => !processGroupAlive(group));
}

function appendBounded(current: Buffer, chunk: Buffer, limit: number): Buffer {
  if (chunk.length >= limit) return Buffer.from(chunk.subarray(chunk.length - limit));
  const keep = Math.min(current.length, limit - chunk.length);
  return Buffer.concat([current.subarray(current.length - keep), chunk]);
}

function decodeOutput(bytes: Buffer): string {
  // The retained tail may start in the middle of a UTF-8 sequence.
  let start = 0;
  while (start < bytes.length && (bytes[start]! & 0xc0) === 0x80) start++;
  return bytes.subarray(start).toString("utf8");
}
