/**
 * Shared types for the deterministic scheduler. Everything persisted is plain JSON
 * (no undefined, no Infinity, no Map/Set) so a SQLite store can hold it verbatim.
 * Times are epoch milliseconds from the injected clock; quota percents are 0-100.
 */

/** Model family. A family is also the quota provider (Codex = ChatGPT plan, Claude = Claude plan). */
export type Family = "codex" | "claude";
/** Fixed iteration order. Placement preference comes from policy.familyOrder, not from here. */
export const FAMILIES: readonly Family[] = ["codex", "claude"];
export const isFamily = (value: unknown): value is Family => value === "codex" || value === "claude";

/** LLM work (WorkerSpec kinds in omb-adapters). Needs a family and quota. */
export const LLM_KINDS = ["plan", "code", "repair", "replicate", "explore", "select", "boss"] as const;
export type LlmKind = (typeof LLM_KINDS)[number];
/** LLM-free work run by trusted software: staging/G1 + sealer, G4 re-run, G8 look, G5 simulation. */
export const COMPUTE_KINDS = ["stage", "rerun", "look", "sim"] as const;
export type ComputeKind = (typeof COMPUTE_KINDS)[number];
export type JobKind = LlmKind | ComputeKind;
export const isLlmKind = (kind: string): kind is LlmKind => (LLM_KINDS as readonly string[]).includes(kind);
export const isJobKind = (kind: unknown): kind is JobKind =>
  typeof kind === "string" && (isLlmKind(kind) || (COMPUTE_KINDS as readonly string[]).includes(kind));

/**
 * Which family may run an LLM job.
 * - any: default pool first (Codex), secondary pool (Claude) as overflow.
 * - exactly: only that family.
 * - cross-family: any family except the producer's (G7 replicator, cross-family reviewer).
 */
export type FamilyRequirement =
  | { readonly mode: "any" }
  | { readonly mode: "exactly"; readonly family: Family }
  | { readonly mode: "cross-family"; readonly producer: Family };

export type ResourceClass = "session" | "sim" | "heavy";
export interface Demand { readonly class: ResourceClass; readonly cpu: number; readonly memBytes: number }

/** What a caller (omb-investigate) submits. */
export interface JobSpec {
  readonly id: string;
  readonly kind: JobKind;
  /** LLM kinds only. Default { mode: "any" }. */
  readonly family?: FamilyRequirement;
  /** Continue an earlier phase's session (plan -> code -> interpret in one resumed session). */
  readonly resumeFrom?: { readonly family: Family; readonly sessionToken: string };
  readonly investigation?: string;
  /** Required for kind "look" (G8): the sealed partition this look reads. */
  readonly partition?: string;
  /** Official benchmark arm-run id. Jobs of a quiet group run with nothing else admitted. */
  readonly quietGroup?: string;
  /** Run-once key (e.g. "g1:<manifest sha256>"): a second submission coalesces onto the first live job. */
  readonly onceKey?: string;
  readonly demand?: { readonly cpu?: number; readonly memBytes?: number };
  /** Key for the measured peak-RSS cache (heavy jobs). Unmeasured heavy jobs run alone among heavy jobs. */
  readonly rssKey?: string;
  readonly maxAttempts?: number;
  /** Enqueue time override for deterministic replay; default is the clock at submit. */
  readonly submittedAt?: number;
}

/** Normalized, JSON-only spec as persisted. */
export interface StoredSpec {
  id: string;
  kind: JobKind;
  family: FamilyRequirement | null;
  resumeFrom: { family: Family; sessionToken: string } | null;
  investigation: string | null;
  partition: string | null;
  quietGroup: string | null;
  onceKey: string | null;
  demand: Demand;
  rssKey: string | null;
  maxAttempts: number;
}

export type JobState = "queued" | "running" | "parked" | "succeeded" | "exhausted" | "stopped" | "cancelled";
export const TERMINAL_STATES: readonly JobState[] = ["succeeded", "exhausted", "stopped", "cancelled"];
export const isTerminal = (state: JobState): boolean => TERMINAL_STATES.includes(state);

/**
 * rate-limited: waits for the provider window reset (wakes automatically).
 * family-unavailable: every family the requirement allows refused it; never auto-run on another family.
 * look-interrupted: a G8 look was in flight at a crash; the fleet look ledger decides (operator release).
 * interrupt-loop: the orchestrator crashed under this job too often.
 */
export type ParkReason = "rate-limited" | "family-unavailable" | "look-interrupted" | "interrupt-loop" | "infra-retry";

export interface Running {
  dispatchId: string;
  family: Family | null;
  startedAt: number;
  demand: Demand;
  rssMeasured: boolean;
  /** Quota cost estimate (percent of the 5-hour window) reserved for this job while it runs. */
  cost: number;
  quotaAtStart: number | null;
  /** observedAt of the 5-hour measurement quotaAtStart came from. */
  quotaObservedAt: number | null;
  windowAtStart: number | null;
  epochAtStart: number;
  soloAtStart: boolean;
}

export interface Refusal {
  family: Family;
  status: "refused-prework" | "refused-midtask";
  at: number;
  reason: string;
  dispatchId: string;
}

export interface JobRecord {
  spec: StoredSpec;
  state: JobState;
  enqueuedAt: number;
  /** Work already in flight for this job (resume, reroute, retry, interruption): top priority class. */
  carryOver: boolean;
  attemptsUsed: number;
  infraAttempts?:number;
  parkWakes?:number;
  lastError?:string;
  resumes: number;
  interruptions: number;
  dispatchCount: number;
  /** Families that refused this job. Never placed there again. */
  excluded: Family[];
  /** Reroute hint target from the adapter (honored only when the requirement allows it). */
  preferred: Family | null;
  /** Family holding this job's session; a resume must run there. */
  pinned: Family | null;
  sessionToken: string | null;
  park: { reason: ParkReason; until: number | null; detail: string } | null;
  running: Running | null;
  refusals: Refusal[];
  lastStatus: string | null;
  endedAt: number | null;
  endReason: string | null;
}

export interface WindowReading { usedPercent: number; resetsAt: number | null }
/** One provider's quota telemetry. A window is null when unknown; unknown never advertises headroom. */
export interface QuotaReading {
  family: Family;
  observedAt: number;
  fiveHour: WindowReading | null;
  weekly: WindowReading | null;
  /** The provider explicitly rejected requests (Claude rate_limit_event status "rejected"). */
  rejected: { resetsAt: number | null } | null;
}

export interface CostEstimate { mean: number; n: number }
/** A window as last measured. Kept through missing telemetry: usage within a window only grows. */
export interface KnownWindow { usedPercent: number; resetsAt: number | null; observedAt: number }
export interface ProviderRecord {
  family: Family;
  /** Last valid reading (for "rejected"). */
  reading: QuotaReading | null;
  /** Last known 5-hour and weekly windows; the limits they imply hold until their reset. */
  fiveHour: KnownWindow | null;
  weekly: KnownWindow | null;
  /** The latest reader attempt returned a valid reading. False (down, null, malformed) means probe concurrency. */
  telemetryOk: boolean;
  parkedUntil: number | null;
  parkReason: string | null;
  /** resetsAt of the 5-hour window omertaSpent5h belongs to. */
  windowKey: number | null;
  /** Percent of the current 5-hour window attributed to Amani (all growth while Amani had work in flight). */
  omertaSpent5h: number;
  /** Amani had work in flight since the last 5-hour measurement. */
  busySinceReading: boolean;
  dispatchEpoch: number;
  completedRuns: number;
  /** Moving average quota cost per job kind, plus "*" for the family as a whole. */
  costs: Record<string, CostEstimate>;
  refusals: number;
}

export interface QuietState { group: string; reason: string; since: number; auto: boolean }
export interface SchedMeta {
  version: 1;
  eventSeq: number;
  quiet: QuietState | null;
  /** Measured peak RSS (bytes) by rssKey; only ever raised. */
  rss: Record<string, number>;
}

export type SchedEventType =
  | "submitted" | "coalesced" | "dispatched" | "succeeded" | "refused" | "rerouted" | "parked" | "woke" | "retry"
  | "exhausted" | "stopped" | "cancelled" | "released" | "interrupted" | "session-noted" | "stale-outcome"
  | "provider-parked" | "provider-resumed" | "quiet-entered" | "quiet-cleared" | "quota-reading-rejected" | "unknown-status";
export type EventValue = string | number | boolean | null;
export interface SchedEvent {
  seq: number;
  at: number;
  type: SchedEventType;
  jobId: string | null;
  family: Family | null;
  detail: Record<string, EventValue>;
}

/** Priority classes: in-flight resumes, then confirm path, then G7, then explorers, then boss cycles. */
export const KIND_CLASS: Readonly<Record<JobKind, number>> = {
  plan: 1, code: 1, repair: 1, stage: 1, rerun: 1, look: 1,
  replicate: 2, sim: 2,
  explore: 3,
  select: 4, boss: 4,
};
export const priorityClass = (job: JobRecord): number => (job.carryOver ? 0 : KIND_CLASS[job.spec.kind]);

/** Total order: priority class, enqueue time, then id by code units (locale-independent). */
export function compareJobs(a: JobRecord, b: JobRecord): number {
  const ca = priorityClass(a), cb = priorityClass(b);
  if (ca !== cb) return ca - cb;
  if (a.enqueuedAt !== b.enqueuedAt) return a.enqueuedAt - b.enqueuedAt;
  return a.spec.id < b.spec.id ? -1 : a.spec.id > b.spec.id ? 1 : 0;
}
