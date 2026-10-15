import { censusCommand, type CensusCommandOptions } from "../../bio-core/src/index.ts";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { GroupRef, PreparedWorker, ProcessHost, WorkerSpec } from "./types.ts";

export function processAlive(pid: number): boolean | "unknown" {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "ESRCH" ? false : "unknown"; }
}
interface ProcessRow { pid: number; parent: number; group: number; session: number }
function census(options: CensusCommandOptions): ProcessRow[] {
  const linux = process.platform === "linux";
  if (!linux && process.platform !== "darwin") throw new Error("session census unsupported");
  const raw = censusCommand("ps", ["-axo", linux ? "pid=,ppid=,pgid=,sid=" : "pid=,ppid=,pgid="], options);
  let rows = raw.trim().split("\n").filter(Boolean).map(line => {
    const values = line.trim().split(/\s+/).map(Number);
    if (values.length !== (linux ? 4 : 3) || !values.every(v => Number.isSafeInteger(v) && v >= 0) || !values[0]) throw new Error("unparseable process census");
    return { pid: values[0]!, parent: values[1]!, group: values[2]!, session: values[3] ?? 0 };
  });
  if (!linux) rows = JSON.parse(censusCommand("/usr/bin/python3", [fileURLToPath(new URL("./session-census.py", import.meta.url))], {
    ...options, input: JSON.stringify(rows),
  })) as ProcessRow[];
  if (!Array.isArray(rows) || !rows.every(row => [row.pid, row.parent, row.group, row.session].every(n => Number.isSafeInteger(n) && n >= 0)) ||
      !rows.some(row => row.pid === process.pid)) throw new Error("incomplete process census");
  return rows;
}
function identity(pid: number, options: CensusCommandOptions): string {
  const value = censusCommand("ps", ["-p", String(pid), "-o", "lstart="], options).trim();
  if (!value) throw new Error("missing process identity");
  return value;
}

/** Sessions contain ordinary job-control groups; sandbox enforcement must still forbid setsid. */
export class PosixProcessHost implements ProcessHost {
  private readonly censusOptions: CensusCommandOptions;
  constructor(censusOptions: CensusCommandOptions = {}) { this.censusOptions = censusOptions; }
  private children = new Map<number, ReturnType<typeof fork>>();
  async prepare(spec: WorkerSpec): Promise<PreparedWorker> {
    if (!/^[a-f0-9-]{36}$/.test(spec.launchId)) throw new Error("invalid launch identifier");
    const child = fork(fileURLToPath(new URL("./worker-gate.ts", import.meta.url)), [`--omerta-bio-launch=${spec.launchId}`], {
      detached: true, stdio: ["ignore", "ignore", "ignore", "ipc"], execArgv: [],
    });
    let settle!: (value: { code: number | null; signal: string | null }) => void;
    const completion = new Promise<{ code: number | null; signal: string | null }>(resolve => { settle = resolve; });
    child.on("message", message => {
      const result = message as { code?: unknown; signal?: unknown };
      if ((result.code === null || Number.isInteger(result.code)) && (result.signal === null || typeof result.signal === "string")) {
        settle({ code: result.code as number | null, signal: result.signal as string | null });
      }
    });
    child.once("exit", (code, signal) => settle({ code, signal: signal ?? "gate-exited" }));
    child.once("error", () => settle({ code: null, signal: "spawn-error" }));
    await new Promise<void>((resolve, reject) => {
      const ready = (message: unknown) => {
        if ((message as { ready?: unknown })?.ready === true) { clearTimeout(timer); resolve(); }
      };
      const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("worker gate unavailable")); }, 8000);
      child.once("message", ready);
      child.once("error", error => { clearTimeout(timer); reject(error); });
      child.once("exit", () => { clearTimeout(timer); reject(new Error("worker gate exited before ready")); });
    });
    const pid = child.pid!;
    this.children.set(pid, child);
    try {
      const group = { id: pid, identity: identity(pid, this.censusOptions) };
      return { group, completion, start: () => { child.send(spec); } };
    } catch (error) { child.kill("SIGKILL"); throw error; }
  }
  async reapLaunch(launchId: string): Promise<boolean> {
    try {
      if (!/^[a-f0-9-]{36}$/.test(launchId)) return false;
      const marker = `--omerta-bio-launch=${launchId}`;
      const raw = censusCommand("ps", ["-ww", "-axo", "pid=,pgid=,command="], this.censusOptions);
      let sawSelf = false;
      for (const line of raw.trim().split("\n").filter(Boolean)) {
        const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
        if (!match) return false;
        if (Number(match[1]) === process.pid) sawSelf = true;
        if (!match[3]!.split(/\s+/).includes(marker)) continue;
        const pid = Number(match[1]), group = Number(match[2]);
        if (pid !== group) return false;
        try {
          if (!await this.reap({ id: group, identity: identity(pid, this.censusOptions) })) return false;
        } catch {
          // A disconnecting gate may have exited between census and identity lookup.
          if (census(this.censusOptions).some(p => p.group === group || p.session === group)) return false;
        }
      }
      return sawSelf;
    } catch { return false; }
  }
  async reap(group: GroupRef): Promise<boolean> {
    try {
      if (!Number.isSafeInteger(group.id) || group.id <= 1 || !group.identity) return false;
      const before = census(this.censusOptions);
      if (before.some(p => p.pid === process.pid && p.group === group.id)) return false;
      const members = before.filter(p => p.group === group.id || p.session === group.id);
      if (members.length === 0) return true;
      const leader = before.find(p => p.pid === group.id);
      if (leader && (identity(group.id, this.censusOptions) !== group.identity || leader.session !== group.id)) return false;
      const child = this.children.get(group.id);
      const exited = child && child.exitCode === null && child.signalCode === null
        ? new Promise<void>(resolve => child.once("exit", () => resolve())) : Promise.resolve();
      let escaped = false;
      const trackedGroups = new Set([group.id]);
      let current = members;
      // Census the entire session, including reparented orphans in new groups. An observed
      // escape remains a cleanup failure even when we successfully kill the escaped group.
      for (let i = 0; i < 20; i++) {
        if (!current.length) { this.children.delete(group.id); return !escaped; }
        escaped ||= current.some(p => p.group !== group.id);
        for (const member of current) trackedGroups.add(member.group);
        for (const pgid of trackedGroups) {
          if (pgid <= 1 || before.some(p => p.pid === process.pid && p.group === pgid)) return false;
          try { process.kill(-pgid, "SIGKILL"); }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") return false; }
        }
        if (i === 0) await exited;
        current = census(this.censusOptions).filter(p => trackedGroups.has(p.group) || p.session === group.id);
        if (current.length) await new Promise<void>(resolve => setTimeout(resolve, 1));
      }
      return false;
    } catch { return false; }
  }
}
