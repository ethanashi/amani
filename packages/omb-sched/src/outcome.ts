import type { Family, QuotaReading, WindowReading } from "./types.ts";

/**
 * Statuses the scheduler routes. Underscore spellings from omb-adapters' WorkerStatus
 * (`rate_limited`, `needs_resume`, ...) and hyphen spellings from the V6 Claude adapter
 * (`rate-limited`, `refused-prework`, `refused-midtask`) normalize to the same values.
 */
export const OUTCOME_STATUSES = [
  "ok", "rate-limited", "refused-prework", "refused-midtask", "needs-resume", "timeout", "infra-error",
  "provider-error", "agent-error", "violation", "provenance-unverified", "containment-failure",
] as const;
export type OutcomeStatus = (typeof OUTCOME_STATUSES)[number];

export function normalizeStatus(raw: unknown): OutcomeStatus | "unknown" {
  if (typeof raw !== "string") return "unknown";
  const s = raw.trim().toLowerCase().replace(/_/g, "-");
  return (OUTCOME_STATUSES as readonly string[]).includes(s) ? (s as OutcomeStatus) : "unknown";
}

/** What the caller reports when a dispatched job ends. Files are judged elsewhere; this only routes. */
export interface DispatchOutcome {
  readonly status: string;
  /** Epoch ms when the limit resets (rate-limited). */
  readonly resetAtMs?: number | null;
  readonly sessionToken?: string | null;
  /** Adapter hint, e.g. the Claude adapter's { to: "codex", reason } on a refusal. */
  readonly reroute?: { readonly to: string; readonly reason: string } | null;
  /** Quota observed by the adapter at the end of the run (already converted; see fromAdapterQuota). */
  readonly quota?: QuotaReading | null;
  readonly peakRssBytes?: number | null;
  readonly detail?: string;
}

/** Structural subset of omb-adapters' QuotaSnapshot (epoch seconds). */
export interface AdapterQuotaWindow { usedPercent: number; windowMinutes: number; resetsAt: number | null }
export interface AdapterQuotaSnapshot { primary: AdapterQuotaWindow | null; secondary: AdapterQuotaWindow | null }

/**
 * Structural subset of omb-adapters' WorkerResult plus the V6 Claude adapter's additions.
 * Expected: status (WorkerStatus or rate-limited | refused-prework | refused-midtask), resetAt in epoch
 * SECONDS or null, sessionToken, quota (null when unverified), optional reroute { to, reason }.
 */
export interface AdapterResultLike {
  readonly warnings?:readonly string[];
  readonly status: string;
  readonly resetAt?: number | null;
  readonly sessionToken?: string | null;
  readonly quota?: AdapterQuotaSnapshot | null;
  readonly reroute?: { readonly to: string; readonly reason: string } | null;
}

const FIVE_HOUR_MAX_MINUTES = 360;
const WEEKLY_MIN_MINUTES = 6 * 1440;
const seconds = (v: number | null | undefined): number | null =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 1e9 && v < 1e10 ? v * 1000 : null;

/** Classify adapter windows by length (Codex primary = 300 min, secondary = 10080 min); ms timestamps. */
export function fromAdapterQuota(family: Family, snapshot: AdapterQuotaSnapshot | null | undefined, observedAtMs: number): QuotaReading | null {
  if (!snapshot) return null;
  let fiveHour: WindowReading | null = null, weekly: WindowReading | null = null;
  for (const w of [snapshot.primary, snapshot.secondary]) {
    if (!w || typeof w.usedPercent !== "number" || !Number.isFinite(w.usedPercent)) continue;
    const reading = { usedPercent: w.usedPercent, resetsAt: seconds(w.resetsAt) };
    if (w.windowMinutes <= FIVE_HOUR_MAX_MINUTES) fiveHour ??= reading;
    else if (w.windowMinutes >= WEEKLY_MIN_MINUTES) weekly ??= reading;
  }
  if (!fiveHour && !weekly) return null;
  return { family, observedAt: observedAtMs, fiveHour, weekly, rejected: null };
}

export function fromAdapterResult(
  family: Family, result: AdapterResultLike, observedAtMs: number, peakRssBytes: number | null = null,
): DispatchOutcome {
  return {
    status: result.status,
    detail:result.warnings?.slice(-5).join("\n").slice(-8192)??String(result.status),
    resetAtMs: seconds(result.resetAt),
    sessionToken: typeof result.sessionToken === "string" && result.sessionToken ? result.sessionToken : null,
    reroute: result.reroute ?? null,
    quota: fromAdapterQuota(family, result.quota, observedAtMs),
    peakRssBytes,
  };
}
