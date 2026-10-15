import type { QuotaPolicy, SchedPolicy } from "./policy.ts";
import {
  isFamily, type Family, type JobKind, type KnownWindow, type LlmKind, type ProviderRecord, type QuotaReading, type WindowReading,
} from "./types.ts";

/** Injected quota telemetry. Return null when unknown; a throw is treated as unknown. */
export interface QuotaReader { read(family: Family): QuotaReading | null }

export type Band = "all" | "confirm-path" | "replication-only" | "parked";
const CONFIRM_PATH: ReadonlySet<JobKind> = new Set<JobKind>(["plan", "code", "repair", "replicate"]);
/** Two readings of one window may report resetsAt a little apart. */
const WINDOW_JITTER_MS = 60_000;

/** Usage of a window as of now: a window whose reset time has passed counts as empty. */
export function effectiveUsed(w: WindowReading | null | undefined, now: number): number | null {
  if (!w) return null;
  if (w.resetsAt !== null && now >= w.resetsAt) return 0;
  return w.usedPercent;
}

export const FIVE_HOUR_MS = 5 * 3_600_000;
export const WEEK_MS = 7 * 24 * 3_600_000;

/** A retained window bounds use from below until it resets; with no known reset, at most one window length. */
export function knownUsed(w: KnownWindow | null, now: number, windowMs: number): number | null {
  if (!w) return null;
  if (w.resetsAt === null && now >= w.observedAt + windowMs) return 0;
  return effectiveUsed(w, now);
}

export function weeklyBand(used: number, q: QuotaPolicy): Band {
  if (used < q.weeklyAll) return "all";
  if (used < q.weeklyConfirm) return "confirm-path";
  if (used < q.weeklyReplication) return "replication-only";
  return "parked";
}

/** 70-85%: confirm path (plan, code, repair, replicate) and in-flight work; 85-95%: G7 replications only. */
export function bandAllows(band: Band, kind: JobKind, carryOver: boolean): boolean {
  if (band === "all") return true;
  if (band === "confirm-path") return carryOver || CONFIRM_PATH.has(kind);
  if (band === "replication-only") return kind === "replicate";
  return false;
}

const percent = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100;
const time = (v: unknown): v is number | null => v === null || (typeof v === "number" && Number.isSafeInteger(v) && v > 0);
const validWindow = (w: unknown): w is WindowReading | null => {
  if (w === null) return true;
  if (typeof w !== "object" || w === undefined) return false;
  const o = w as Record<string, unknown>;
  return percent(o.usedPercent) && time(o.resetsAt);
};

/** A malformed, foreign or future-dated reading is refused (it must never advertise headroom). */
export function validReading(r: unknown, family: Family, now: number): r is QuotaReading {
  if (r === null || typeof r !== "object") return false;
  const o = r as Record<string, unknown>;
  if (!isFamily(o.family) || o.family !== family) return false;
  if (typeof o.observedAt !== "number" || !Number.isSafeInteger(o.observedAt) || o.observedAt > now) return false;
  if (!validWindow(o.fiveHour) || !validWindow(o.weekly)) return false;
  if (o.rejected !== null) {
    if (typeof o.rejected !== "object" || o.rejected === undefined) return false;
    if (!time((o.rejected as Record<string, unknown>).resetsAt)) return false;
  }
  return true;
}

export function newProvider(family: Family): ProviderRecord {
  return {
    family, reading: null, fiveHour: null, weekly: null, telemetryOk: false, parkedUntil: null, parkReason: null, windowKey: null,
    omertaSpent5h: 0, busySinceReading: false, dispatchEpoch: 0, completedRuns: 0, costs: {}, refusals: 0,
  };
}

export function omertaSpentNow(p: ProviderRecord, now: number): number {
  if (p.windowKey !== null) return now >= p.windowKey ? 0 : p.omertaSpent5h;
  return p.fiveHour && now >= p.fiveHour.observedAt + FIVE_HOUR_MS ? 0 : p.omertaSpent5h;
}

function sameWindow(prev: WindowReading, next: WindowReading, observedAt: number): boolean {
  if (next.usedPercent < prev.usedPercent) return false;
  if (prev.resetsAt !== null && observedAt >= prev.resetsAt) return false;
  if (prev.resetsAt !== null && next.resetsAt !== null) return Math.abs(prev.resetsAt - next.resetsAt) <= WINDOW_JITTER_MS;
  return true;
}

/**
 * Fold a newer reading into the provider. Amani's share of the 5-hour window is all growth observed while
 * Amani had work in flight on that provider. This over-attributes the owner's concurrent use to Amani,
 * which is the protective direction: maxShare then leaves the owner more room, never less.
 * A reading without a window keeps the last known window, its identity and the attributed spend; only a
 * measured new window resets them. Returns whether a 5-hour measurement was folded.
 */
export function observeReading(p: ProviderRecord, r: QuotaReading, busy: boolean): boolean {
  const prev = p.fiveHour;
  const next = r.fiveHour;
  if (next) {
    if (prev && sameWindow(prev, next, r.observedAt)) {
      if (busy) p.omertaSpent5h += next.usedPercent - prev.usedPercent;
    } else if (prev) {
      // A new window began between measurements: everything in it so far is Amani's if Amani was busy.
      p.omertaSpent5h = busy ? next.usedPercent : 0;
    } else {
      // First measurement ever: there is no baseline to attribute from.
      p.omertaSpent5h = 0;
    }
    p.fiveHour = { usedPercent: next.usedPercent, resetsAt: next.resetsAt, observedAt: r.observedAt };
    p.windowKey = next.resetsAt;
  }
  if (r.weekly) p.weekly = { usedPercent: r.weekly.usedPercent, resetsAt: r.weekly.resetsAt, observedAt: r.observedAt };
  p.reading = r;
  return next !== null;
}

/** Telemetry is unknown when the reader failed or the current reading lacks a window. */
export function quotaUnknown(p: ProviderRecord): boolean {
  return !p.telemetryOk || !p.reading?.fiveHour || !p.reading.weekly;
}

/** Provider-level pause implied by the latest reading, or null. Unknown reset times retry later. */
export function derivedPark(p: ProviderRecord, now: number, q: QuotaPolicy): { until: number; reason: string } | null {
  const until = (resetsAt: number | null, observedAt: number): number => (resetsAt === null ? observedAt + q.unknownResetRetryMs : resetsAt + q.wakeSlackMs);
  const candidates: { until: number; reason: string }[] = [];
  const r = p.reading;
  if (r?.rejected && (r.rejected.resetsAt === null || now < r.rejected.resetsAt)) candidates.push({ until: until(r.rejected.resetsAt, r.observedAt), reason: "rejected" });
  const limit = (w: KnownWindow | null, at: number, reason: string, windowMs: number): void => {
    const used = knownUsed(w, now, windowMs);
    if (w && used !== null && used >= at) candidates.push({ until: until(w.resetsAt, w.observedAt), reason });
  };
  limit(p.weekly, q.weeklyReplication, "weekly-exhausted", WEEK_MS);
  limit(p.fiveHour, q.fiveHourCeiling, "five-hour-ceiling", FIVE_HOUR_MS);
  const live = candidates.filter((c) => c.until > now);
  if (live.length === 0) return null;
  // The latest reset governs: a provider is usable only when every limiting window has reset.
  return live.reduce((a, b) => (b.until > a.until ? b : a));
}

/** Until when a provider pauses after an adapter reported rate-limited. */
export function rateLimitUntil(p: ProviderRecord, resetAtMs: number | null, now: number, q: QuotaPolicy): number {
  if (resetAtMs !== null && Number.isFinite(resetAtMs) && resetAtMs > now) return resetAtMs + q.wakeSlackMs;
  return derivedPark(p, now, q)?.until ?? now + q.unknownResetRetryMs;
}

export function estimateCost(p: ProviderRecord, kind: JobKind, q: QuotaPolicy): number {
  return p.costs[kind]?.mean ?? p.costs["*"]?.mean ?? q.defaultJobCost;
}

/** Moving average: running mean for the first five samples, then exponential with alpha 0.2. */
export function recordCostSample(p: ProviderRecord, kind: JobKind, sample: number): void {
  for (const key of [kind, "*"]) {
    const prev = p.costs[key] ?? { mean: 0, n: 0 };
    const n = prev.n + 1;
    const alpha = Math.max(1 / n, 0.2);
    p.costs[key] = { mean: prev.mean + alpha * (sample - prev.mean), n };
  }
}

export interface FamilyLoad { inflight: number; inflightCost: number; totalSessions: number }
export interface Verdict { ok: boolean; reason: string }
const OK: Verdict = { ok: true, reason: "ok" };
const no = (reason: string): Verdict => ({ ok: false, reason });

/** Whether this provider can take one more LLM job of this kind now. Pure. */
export function quotaAdmits(
  p: ProviderRecord, kind: LlmKind, carryOver: boolean, load: FamilyLoad, now: number, policy: SchedPolicy,
): Verdict {
  const q = policy.quota;
  if (p.parkedUntil !== null && now < p.parkedUntil) return no(`provider-parked:${p.parkReason ?? "limit"}`);
  if (load.inflight >= policy.pools[p.family].sessions) return no("pool-full");
  if (load.totalSessions >= policy.maxSessions) return no("sessions-full");
  // Last known windows bound current use from below until they reset, even while telemetry is missing.
  const five = knownUsed(p.fiveHour, now, FIVE_HOUR_MS);
  const week = knownUsed(p.weekly, now, WEEK_MS);
  if (week !== null) {
    const band = weeklyBand(week, q);
    if (!bandAllows(band, kind, carryOver)) return no(`band:${band}`);
  }
  const cost = estimateCost(p, kind, q);
  if (five !== null && (five >= q.fiveHourCeiling || five + load.inflightCost + cost > q.fiveHourCeiling)) return no("five-hour-headroom");
  // Retained attributed spend is enforced in probe mode too; it resets only with a new or expired window.
  if (omertaSpentNow(p, now) + load.inflightCost + cost > q.maxShare * 100) return no("max-share");
  if (quotaUnknown(p) && load.inflight >= q.unknownConcurrency) return no("quota-unknown");
  if ((p.costs["*"]?.n ?? 0) < q.seedJobs && load.inflight >= 1) return no("seeding");
  return OK;
}
