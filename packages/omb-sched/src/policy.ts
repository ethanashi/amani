import { FAMILIES, isFamily, type Family } from "./types.ts";

export const GiB = 1024 ** 3;
/** Design section 4: LLM sessions 4 by default (2 per family), at most 6 on this Mac. */
export const MAX_SESSIONS = 6;

export interface PoolConfig {
  harness: "codex" | "claude-code";
  model: string;
  effort: string;
  /** Concurrent sessions for this family. 0 disables the pool. */
  sessions: number;
}

export interface QuotaPolicy {
  /** Amani's own share of each 5-hour window, so the owner's interactive sessions keep working. */
  maxShare: number;
  /** Total 5-hour use (owner + Amani) must stay below this percent. */
  fiveHourCeiling: number;
  /** Weekly bands: < weeklyAll everything; < weeklyConfirm confirm path + resumes; < weeklyReplication G7 only; else park. */
  weeklyAll: number;
  weeklyConfirm: number;
  weeklyReplication: number;
  /** Wake parked work this long after the provider's reported reset. */
  wakeSlackMs: number;
  /** Retry interval when a limit has no known reset time. */
  unknownResetRetryMs: number;
  /** Concurrent jobs on a provider whose quota is unknown (probe mode). */
  unknownConcurrency: number;
  /** The first N jobs per family run one at a time to seed the cost average. */
  seedJobs: number;
  /** Assumed cost (percent of a 5-hour window) of a job kind with no observations. */
  defaultJobCost: number;
  /** A cost sample needs a 5-hour measurement taken after the run started and at most this long before it ended. */
  sampleFreshnessMs: number;
}

export interface AdmissionPolicy {
  cores: number;
  memBytes: number;
  /** Memory that must stay available after admitting a job (3 GB on the 16 GB Mac). */
  memFloorBytes: number;
  /** load1 + CPU demand of a new job must stay at or below this. */
  loadCeiling: number;
  simSlots: number;
  heavySlots: number;
  /** A newly started job's demand is reserved this long, because load1 and memory lag. */
  warmupMs: number;
}

export interface AttemptPolicy {
  maxInfraAttempts:number;
  /** Consumed attempts allowed per job; the next would be policy-limited. */
  maxAttempts: number;
  maxResumes: number;
  maxInterruptions: number;
}

export interface SchedPolicy {
  pools: Readonly<Record<Family, PoolConfig>>;
  /** Placement preference for "any" jobs: the default pool first. */
  familyOrder: readonly Family[];
  /** "any" jobs may run on the secondary pool when the default pool cannot take them now. */
  overflowToSecondary: boolean;
  maxSessions: number;
  quota: QuotaPolicy;
  admission: AdmissionPolicy;
  attempts: AttemptPolicy;
}

export interface PolicyOverrides {
  pools?: { readonly [F in Family]?: Partial<PoolConfig> };
  familyOrder?: readonly Family[];
  overflowToSecondary?: boolean;
  maxSessions?: number;
  quota?: Partial<QuotaPolicy>;
  admission?: Partial<AdmissionPolicy>;
  attempts?: Partial<AttemptPolicy>;
}

/**
 * Owner's worker-model rule (2026-10-11): Codex at reasoning effort high is the default pool; Claude is
 * secondary. Exact CLI flags are pinned by the adapters (V4 Codex, V6 Claude).
 * Model: gpt-6-luna since 2026-10-12, when Codex stopped serving gpt-6-astra to ChatGPT-account logins
 * ("not supported when using Codex with a ChatGPT account"). OMB_CODEX_MODEL overrides it host-side.
 */
const CODEX_MODEL = process.env.OMB_CODEX_MODEL?.trim() || "gpt-6-luna";
export const DEFAULT_POLICY: SchedPolicy = {
  pools: {
    codex: { harness: "codex", model: CODEX_MODEL, effort: "high", sessions: 2 },
    claude: { harness: "claude-code", model: "opus", effort: "high", sessions: 2 },
  },
  familyOrder: ["codex", "claude"],
  overflowToSecondary: true,
  maxSessions: 4,
  quota: {
    maxShare: 0.5,
    fiveHourCeiling: 90,
    weeklyAll: 70,
    weeklyConfirm: 85,
    weeklyReplication: 95,
    wakeSlackMs: 60_000,
    unknownResetRetryMs: 15 * 60_000,
    unknownConcurrency: 1,
    seedJobs: 5,
    defaultJobCost: 5,
    sampleFreshnessMs: 60_000,
  },
  admission: {
    cores: 10,
    memBytes: 16 * GiB,
    memFloorBytes: 3 * GiB,
    loadCeiling: 9,
    simSlots: 8,
    heavySlots: 2,
    warmupMs: 60_000,
  },
  /** Refusals never consume attempts: each one excludes a family, so they are bounded by the family count. */
  attempts: { maxInfraAttempts:6,maxAttempts: 3, maxResumes: 3, maxInterruptions: 3 },
};

const fail = (message: string): never => { throw new RangeError(`omb-sched policy: ${message}`); };
const finite = (v: number, name: string, lo: number, hi: number): void => {
  if (typeof v !== "number" || !Number.isFinite(v) || v < lo || v > hi) fail(`${name} must be in [${lo}, ${hi}]`);
};
const int = (v: number, name: string, lo: number, hi: number): void => {
  if (!Number.isSafeInteger(v) || v < lo || v > hi) fail(`${name} must be an integer in [${lo}, ${hi}]`);
};

/** Merge overrides onto the defaults and validate. Invalid policy is a construction-time error. */
export function resolvePolicy(o: PolicyOverrides = {}): SchedPolicy {
  const policy: SchedPolicy = {
    pools: {
      codex: { ...DEFAULT_POLICY.pools.codex, ...o.pools?.codex },
      claude: { ...DEFAULT_POLICY.pools.claude, ...o.pools?.claude },
    },
    familyOrder: [...(o.familyOrder ?? DEFAULT_POLICY.familyOrder)],
    overflowToSecondary: o.overflowToSecondary ?? DEFAULT_POLICY.overflowToSecondary,
    maxSessions: o.maxSessions ?? DEFAULT_POLICY.maxSessions,
    quota: { ...DEFAULT_POLICY.quota, ...o.quota },
    admission: { ...DEFAULT_POLICY.admission, ...o.admission },
    attempts: { ...DEFAULT_POLICY.attempts, ...o.attempts },
  };
  const order = policy.familyOrder;
  if (order.length !== FAMILIES.length || !order.every(isFamily) || new Set(order).size !== order.length) {
    fail("familyOrder must list each family exactly once");
  }
  for (const f of FAMILIES) {
    const pool = policy.pools[f];
    int(pool.sessions, `pools.${f}.sessions`, 0, MAX_SESSIONS);
    if (!pool.model || !pool.effort) fail(`pools.${f} needs a model and an effort`);
  }
  int(policy.maxSessions, "maxSessions", 0, MAX_SESSIONS);
  const q = policy.quota;
  finite(q.maxShare, "quota.maxShare", 0.01, 1);
  finite(q.fiveHourCeiling, "quota.fiveHourCeiling", 1, 100);
  finite(q.weeklyAll, "quota.weeklyAll", 0, 100);
  finite(q.weeklyConfirm, "quota.weeklyConfirm", 0, 100);
  finite(q.weeklyReplication, "quota.weeklyReplication", 0, 100);
  if (!(q.weeklyAll <= q.weeklyConfirm && q.weeklyConfirm <= q.weeklyReplication)) fail("weekly bands must be ascending");
  int(q.wakeSlackMs, "quota.wakeSlackMs", 0, 3_600_000);
  int(q.unknownResetRetryMs, "quota.unknownResetRetryMs", 1, 86_400_000);
  int(q.unknownConcurrency, "quota.unknownConcurrency", 0, MAX_SESSIONS);
  int(q.seedJobs, "quota.seedJobs", 0, 100);
  finite(q.defaultJobCost, "quota.defaultJobCost", 0, 100);
  int(q.sampleFreshnessMs, "quota.sampleFreshnessMs", 0, 86_400_000);
  const a = policy.admission;
  int(a.cores, "admission.cores", 1, 1024);
  finite(a.memBytes, "admission.memBytes", 1, Number.MAX_SAFE_INTEGER);
  finite(a.memFloorBytes, "admission.memFloorBytes", 0, a.memBytes);
  finite(a.loadCeiling, "admission.loadCeiling", 0, 4 * a.cores);
  int(a.simSlots, "admission.simSlots", 0, 1024);
  int(a.heavySlots, "admission.heavySlots", 0, 64);
  int(a.warmupMs, "admission.warmupMs", 0, 3_600_000);
  const t = policy.attempts;
  int(t.maxInfraAttempts,"attempts.maxInfraAttempts",1,20);
  int(t.maxAttempts, "attempts.maxAttempts", 1, 10);
  int(t.maxResumes, "attempts.maxResumes", 0, 100);
  int(t.maxInterruptions, "attempts.maxInterruptions", 0, 100);
  return policy;
}
