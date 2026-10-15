import { GiB, type SchedPolicy } from "./policy.ts";
import type { Verdict } from "./quota.ts";
import type { Demand, JobKind, StoredSpec } from "./types.ts";

export type Pressure = "normal" | "warn" | "critical" | "unknown";
/** Measured machine state. load1 is the 1-minute load average; availableMemBytes is reclaimable + free. */
export interface ResourceSample { load1: number; availableMemBytes: number; pressure: Pressure }
/** Injected probe. Return null when unavailable; a throw is treated as unavailable. */
export interface ResourceProbe { sample(): ResourceSample | null }

/** Defaults sized from design section 4: CLIs 0.3-0.5 GB; simulations one core; heavy runs sized by measured RSS. */
const SESSION: Demand = { class: "session", cpu: 0.25, memBytes: 0.5 * GiB };
const SIM: Demand = { class: "sim", cpu: 1, memBytes: 0.25 * GiB };
const HEAVY: Demand = { class: "heavy", cpu: 1, memBytes: 1.5 * GiB };
export const DEFAULT_DEMAND: Readonly<Record<JobKind, Demand>> = {
  plan: SESSION, code: SESSION, repair: SESSION, replicate: SESSION, explore: SESSION, select: SESSION, boss: SESSION,
  sim: SIM, stage: HEAVY, rerun: HEAVY, look: HEAVY,
};

export function validSample(s: unknown): s is ResourceSample {
  if (s === null || typeof s !== "object") return false;
  const o = s as Record<string, unknown>;
  const num = (v: unknown): boolean => typeof v === "number" && Number.isFinite(v) && v >= 0;
  return num(o.load1) && num(o.availableMemBytes) && ["normal", "warn", "critical", "unknown"].includes(o.pressure as string);
}

/** Effective demand at dispatch: never below the measured peak RSS for this job's rssKey. */
export function resolveDemand(spec: StoredSpec, rss: Readonly<Record<string, number>>): { demand: Demand; measured: boolean } {
  const d = spec.demand;
  if (d.class !== "heavy") return { demand: d, measured: true };
  const measured = spec.rssKey !== null ? rss[spec.rssKey] : undefined;
  if (measured === undefined) return { demand: d, measured: false };
  return { demand: { ...d, memBytes: Math.max(d.memBytes, measured) }, measured: true };
}

export interface ActiveLoad { kind: JobKind; demand: Demand; startedAt: number; rssMeasured: boolean; fresh: boolean }

/**
 * Machine admission. Pure. Order of checks is fixed so the reason is deterministic.
 * - critical memory pressure admits nothing; warn or unknown admits LLM sessions only;
 * - one serialized G8 lane; slot caps per class; an unmeasured heavy job runs alone among heavy jobs;
 * - measured availability minus demand reserved for warming jobs (and for a blocked higher-priority job)
 *   must leave the memory floor; load1 plus warming CPU plus this job's CPU must stay under the ceiling.
 */
export function admitResources(
  demand: Demand, kind: JobKind, rssMeasured: boolean, sample: ResourceSample | null,
  active: readonly ActiveLoad[], reservedMem: number, now: number, policy: SchedPolicy,
): Verdict {
  const a = policy.admission;
  const pressure = sample?.pressure ?? "unknown";
  if (pressure === "critical") return { ok: false, reason: "pressure-critical" };
  if (demand.class !== "session" && pressure !== "normal") return { ok: false, reason: `pressure-${pressure}` };
  if (kind === "look" && active.some((x) => x.kind === "look")) return { ok: false, reason: "g8-lane-busy" };
  const count = (c: Demand["class"]): number => active.filter((x) => x.demand.class === c).length;
  if (demand.class === "session" && count("session") >= policy.maxSessions) return { ok: false, reason: "session-slots" };
  if (demand.class === "sim" && count("sim") >= a.simSlots) return { ok: false, reason: "sim-slots" };
  if (demand.class === "heavy") {
    if (count("heavy") >= a.heavySlots) return { ok: false, reason: "heavy-slots" };
    if (!rssMeasured && count("heavy") > 0) return { ok: false, reason: "heavy-unmeasured" };
    if (active.some((x) => x.demand.class === "heavy" && !x.rssMeasured)) return { ok: false, reason: "heavy-measuring" };
  }
  if (sample) {
    const warming = active.filter((x) => x.fresh || now - x.startedAt < a.warmupMs);
    const warmMem = warming.reduce((s, x) => s + x.demand.memBytes, 0);
    const warmCpu = warming.reduce((s, x) => s + x.demand.cpu, 0);
    if (sample.availableMemBytes - warmMem - reservedMem - demand.memBytes < a.memFloorBytes) return { ok: false, reason: "memory-floor" };
    if (sample.load1 + warmCpu + demand.cpu > a.loadCeiling) return { ok: false, reason: "load-ceiling" };
  }
  return { ok: true, reason: "ok" };
}

/** macOS kern.memorystatus_vm_pressure_level: 1 normal, 2 warn, 4 critical. */
export function parsePressureLevel(text: string | null): Pressure {
  const v = text?.trim();
  return v === "1" ? "normal" : v === "2" ? "warn" : v === "4" ? "critical" : "unknown";
}

/** Available memory from `vm_stat`: (free + inactive + speculative) pages. null when unparseable. */
export function parseVmStat(text: string | null): number | null {
  if (!text) return null;
  const page = /page size of (\d+) bytes/.exec(text);
  const pages = (name: string): number | null => {
    const m = new RegExp(`^Pages ${name}:\\s+(\\d+)\\.?\\s*$`, "m").exec(text);
    return m ? Number(m[1]) : null;
  };
  const free = pages("free"), inactive = pages("inactive"), speculative = pages("speculative");
  if (!page || free === null || inactive === null || speculative === null) return null;
  return (free + inactive + speculative) * Number(page[1]);
}

/** Production probe built from injected readers (the host wires os.loadavg, `vm_stat`, `sysctl`). */
export function osResourceProbe(read: {
  loadavg: () => readonly number[];
  vmStat: () => string | null;
  pressureLevel: () => string | null;
}): ResourceProbe {
  return {
    sample(): ResourceSample | null {
      const load1 = read.loadavg()[0];
      const available = parseVmStat(read.vmStat());
      if (load1 === undefined || !Number.isFinite(load1) || available === null) return null;
      return { load1, availableMemBytes: available, pressure: parsePressureLevel(read.pressureLevel()) };
    },
  };
}
