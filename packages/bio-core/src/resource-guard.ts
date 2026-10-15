import type { ResourceLimitKill, ResourceLimits, ResourceUsage } from "./process-contracts.ts";

/** One row of the host's `ps` census. Resource columns are present only when the census reports them. */
export interface ProcessRow {
  pid: number;
  ppid: number;
  pgid: number;
  /** ps start identity; used to reject reuse across observations, not a kernel handle. */
  startTime?: string;
  /** Resident set size in KiB. */
  rssKb?: number;
  /** Cumulative CPU time (user + system) in milliseconds. */
  cpuMs?: number;
}

/**
 * Memory and CPU caps for a bounded command, measured from the same `ps` census the runner already takes every
 * 20 ms (no limits existed in Amani's kernel). Memory is the summed RSS of the family's live processes. CPU is
 * monotone: the last observation of every process ever seen in the family is kept, so observed CPU does not disappear when a child exits. Work done entirely between
 * samples is invisible; these are sampled measurements, not hard OS limits or complete accounting.
 *
 * Fail closed: when limits were requested and the census cannot measure the family (census failure, or a family
 * row without resource columns), `observe` returns `limit-census-unavailable` and the runner stops the job.
 */
export class ResourceGuard {
  readonly #limits: ResourceLimits;
  readonly #cpuByPid = new Map<number, number>();
  #retiredCpuMs = 0;
  #peakRssBytes = 0;

  constructor(limits: ResourceLimits) {
    assertResourceLimits(limits);
    this.#limits = { ...limits };
  }

  /** Feed one census of the family; returns the kill decision the first time a cap is crossed, else null. */
  observe(family: ProcessRow[] | undefined): ResourceLimitKill | null {
    if (family === undefined) return { reason: "limit-census-unavailable", limit: null, observed: null, pids: [] };
    const pids = family.map((row) => row.pid).sort((a, b) => a - b);
    if (family.some((row) => !isMeasurement(row.rssKb) || !isMeasurement(row.cpuMs))) {
      return { reason: "limit-census-unavailable", limit: null, observed: null, pids };
    }
    let rssBytes = 0;
    for (const row of family) {
      rssBytes += row.rssKb! * 1024;
      const previous = this.#cpuByPid.get(row.pid);
      // A smaller cumulative time under the same pid is a new process (pid reuse): bank the old one.
      if (previous !== undefined && row.cpuMs! < previous) this.#retiredCpuMs += previous;
      this.#cpuByPid.set(row.pid, row.cpuMs!);
    }
    this.#peakRssBytes = Math.max(this.#peakRssBytes, rssBytes);
    const cpuMs = this.cpuMs();
    if (this.#limits.maxRssBytes !== undefined && rssBytes > this.#limits.maxRssBytes) {
      return { reason: "memory-limit", limit: this.#limits.maxRssBytes, observed: rssBytes, pids };
    }
    if (this.#limits.maxCpuMs !== undefined && cpuMs > this.#limits.maxCpuMs) {
      return { reason: "cpu-limit", limit: this.#limits.maxCpuMs, observed: cpuMs, pids };
    }
    return null;
  }

  cpuMs(): number {
    let total = this.#retiredCpuMs;
    for (const value of this.#cpuByPid.values()) total += value;
    return total;
  }

  usage(): ResourceUsage {
    return { peakRssBytes: this.#peakRssBytes, cpuMs: this.cpuMs() };
  }
}

export function assertResourceLimits(limits: ResourceLimits): void {
  if (typeof limits !== "object" || limits === null) throw new Error("invalid resource limits");
  const keys = Object.keys(limits);
  if (keys.length === 0 || keys.some((key) => key !== "maxRssBytes" && key !== "maxCpuMs")) {
    throw new Error("invalid resource limits: name maxRssBytes and/or maxCpuMs");
  }
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || (value as number) < 1) throw new Error(`invalid resource limit ${name}`);
  }
}

/** Rows of the family: members of its retained process groups plus every descendant of those members. */
export function familyRows(rootPid: number, groups: ReadonlySet<number>, rows: ProcessRow[]): ProcessRow[] {
  const own = process.pid;
  const ownGroup = rows.find((row) => row.pid === own)?.pgid;
  const members = new Set<number>();
  for (const row of rows) {
    if (row.pid !== own && row.pgid !== ownGroup && (groups.has(row.pgid) || row.pid === rootPid)) members.add(row.pid);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (row.pid !== own && !members.has(row.pid) && members.has(row.ppid)) {
        members.add(row.pid);
        changed = true;
      }
    }
  }
  return rows.filter((row) => members.has(row.pid));
}

/** `ps -o time=`: macOS prints `MMM:SS.ss`, procps prints `[DD-]HH:MM:SS`. Returns ms, or undefined if unparseable. */
export function parseCpuTime(text: string | undefined): number | undefined {
  if (typeof text !== "string") return undefined;
  const match = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/.exec(text.trim());
  if (!match) return undefined;
  const [, days = "0", hours = "0", minutes = "0", seconds = "0"] = match;
  const ms = ((Number(days) * 24 + Number(hours)) * 60 + Number(minutes)) * 60_000 + Number(seconds) * 1000;
  return Number.isFinite(ms) ? Math.round(ms) : undefined;
}

function isMeasurement(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
