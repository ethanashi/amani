import { canonicalJson } from "../../bio-core/src/index.ts";
import {
  admitResources, DEFAULT_DEMAND, resolveDemand, validSample, type ActiveLoad, type ResourceProbe, type ResourceSample,
} from "./admission.ts";
import {
  allowedFamilies, assertFamilyAllowed, describeRequirement, placementFamilies, sortFamilies, validRequirement,
} from "./families.ts";
import { normalizeStatus, type DispatchOutcome, type OutcomeStatus } from "./outcome.ts";
import { resolvePolicy, type PolicyOverrides, type PoolConfig, type SchedPolicy } from "./policy.ts";
import {
  derivedPark, estimateCost, FIVE_HOUR_MS, knownUsed, newProvider, observeReading, quotaAdmits, rateLimitUntil, recordCostSample,
  validReading, type QuotaReader,
} from "./quota.ts";
import type { SchedStore } from "./store.ts";
import {
  compareJobs, FAMILIES, isFamily, isJobKind, isLlmKind, isTerminal, type EventValue, type Family, type FamilyRequirement,
  type JobKind, type JobRecord, type JobSpec, type JobState, type ParkReason, type ProviderRecord, type QuotaReading,
  type SchedEvent, type SchedEventType, type SchedMeta, type StoredSpec,
} from "./types.ts";

export type FaultPoint = `${"submit" | "tick" | "complete" | "recover" | "control"}:${"decided" | "committed"}`;

export interface SchedulerDeps {
  /** Epoch ms. The only source of time. */
  readonly now: () => number;
  readonly quota: QuotaReader;
  readonly resources: ResourceProbe;
  readonly store: SchedStore;
  readonly policy?: PolicyOverrides;
  /** Test hook: throw here to simulate a crash at an exact boundary ("decided" = before commit). */
  readonly faultAt?: (point: FaultPoint) => void;
}

/** One placement decision. Committed to the store before it is returned, so a launch is never untracked. */
export interface Dispatch {
  dispatchId: string;
  jobId: string;
  kind: JobKind;
  investigation: string | null;
  partition: string | null;
  family: Family | null;
  harness: PoolConfig["harness"] | null;
  model: string | null;
  effort: string | null;
  resume: { sessionToken: string } | null;
  /** True when an earlier dispatch of this job was refused by some family. */
  rerouted: boolean;
  attempt: number;
}

export interface TickResult {
  at: number;
  dispatches: Dispatch[];
  /** Why each still-queued job did not dispatch (not persisted; deterministic). */
  waiting: { jobId: string; reason: string }[];
}

export interface CompletionResult {
  jobId: string | null;
  ignored: boolean;
  state: JobState | null;
  action: "ignored" | "succeeded" | "parked" | "rerouted" | "retry" | "resume" | "exhausted" | "stopped";
}

interface State { jobs: Map<string, JobRecord>; providers: Map<Family, ProviderRecord>; meta: SchedMeta }
const LIVE_ONCE: readonly JobState[] = ["queued", "running", "parked", "succeeded"];

/** Working copy of the state for one operation; committed atomically or discarded. */
class Tx {
  readonly jobs: Map<string, JobRecord>;
  readonly providers: Map<Family, ProviderRecord>;
  readonly meta: SchedMeta;
  readonly dirtyJobs = new Set<string>();
  readonly dirtyProviders = new Set<Family>();
  readonly events: SchedEvent[] = [];
  metaDirty = false;

  constructor(state: State, readonly now: number) {
    const copy = structuredClone(state);
    this.jobs = copy.jobs;
    this.providers = copy.providers;
    this.meta = copy.meta;
  }
  provider(f: Family): ProviderRecord { return this.providers.get(f)!; }
  touch(job: JobRecord): void { this.dirtyJobs.add(job.spec.id); }
  touchProvider(f: Family): void { this.dirtyProviders.add(f); }
  touchMeta(): void { this.metaDirty = true; }
  emit(type: SchedEventType, jobId: string | null, family: Family | null, detail: Record<string, EventValue> = {}): void {
    this.meta.eventSeq += 1;
    this.metaDirty = true;
    this.events.push({ seq: this.meta.eventSeq, at: this.now, type, jobId, family, detail });
  }
  ordered(): JobRecord[] { return [...this.jobs.values()].sort(compareJobs); }
  running(family?: Family): JobRecord[] {
    return this.ordered().filter((j) => j.state === "running" && (family === undefined || j.running?.family === family));
  }
  get changed(): boolean {
    return this.dirtyJobs.size > 0 || this.dirtyProviders.size > 0 || this.metaDirty || this.events.length > 0;
  }
}

/**
 * Deterministic scheduler. Every decision is a pure function of persisted state, the injected clock,
 * quota readings and resource samples. Operations: submit, tick (place work), complete (route an outcome),
 * and operator controls. Each operation commits once, atomically, before returning.
 */
export class Scheduler {
  readonly policy: SchedPolicy;
  readonly #deps: SchedulerDeps;
  #state: State;

  private constructor(deps: SchedulerDeps) {
    this.#deps = deps;
    this.policy = resolvePolicy(deps.policy);
    this.#state = Scheduler.#load(deps.store);
  }

  /** Load durable state and recover from a crash: jobs that were running are marked interrupted. */
  static open(deps: SchedulerDeps): Scheduler {
    const scheduler = new Scheduler(deps);
    scheduler.#recover();
    return scheduler;
  }

  static #load(store: SchedStore): State {
    const meta = store.loadMeta() ?? { version: 1, eventSeq: 0, quiet: null, rss: {} };
    if (meta.version !== 1) throw new Error(`omb-sched: unsupported store version ${String(meta.version)}`);
    const jobs = new Map(store.loadJobs().map((j) => [j.spec.id, j] as const));
    const providers = new Map<Family, ProviderRecord>();
    for (const p of store.loadProviders()) if (isFamily(p.family)) providers.set(p.family, p);
    for (const f of FAMILIES) if (!providers.has(f)) providers.set(f, newProvider(f));
    return { jobs, providers, meta };
  }

  #now(): number {
    const t = this.#deps.now();
    if (typeof t !== "number" || !Number.isFinite(t)) throw new Error("omb-sched: clock returned a non-finite time");
    return t;
  }
  #fault(point: FaultPoint): void { this.#deps.faultAt?.(point); }
  #finish(tx: Tx, op: "submit" | "tick" | "complete" | "recover" | "control"): void {
    if (!tx.changed) return;
    this.#fault(`${op}:decided`);
    this.#deps.store.commit({
      jobs: [...tx.dirtyJobs].sort().map((id) => tx.jobs.get(id)!),
      providers: sortFamilies([...tx.dirtyProviders]).map((f) => tx.provider(f)),
      meta: tx.metaDirty ? tx.meta : null,
      events: tx.events,
    });
    this.#state = { jobs: tx.jobs, providers: tx.providers, meta: tx.meta };
    this.#fault(`${op}:committed`);
  }

  // ---------------------------------------------------------------- submit

  submit(spec: JobSpec): { job: JobRecord; coalesced: boolean } {
    const now = this.#now();
    const stored = this.#normalize(spec);
    const tx = new Tx(this.#state, now);
    const existing = tx.jobs.get(stored.id);
    if (existing) {
      if (canonicalJson(existing.spec) !== canonicalJson(stored)) throw new Error(`omb-sched: job ${stored.id} already exists with a different spec`);
      return { job: structuredClone(existing), coalesced: false };
    }
    if (stored.onceKey !== null) {
      const twin = tx.ordered().find((j) => j.spec.onceKey === stored.onceKey && LIVE_ONCE.includes(j.state));
      if (twin) {
        tx.emit("coalesced", stored.id, null, { onto: twin.spec.id, onceKey: stored.onceKey });
        this.#finish(tx, "submit");
        return { job: structuredClone(twin), coalesced: true };
      }
    }
    const job: JobRecord = {
      spec: stored, state: "queued", enqueuedAt: spec.submittedAt ?? now, carryOver: false, attemptsUsed: 0, resumes: 0,
      interruptions: 0, dispatchCount: 0, excluded: [], preferred: null, pinned: stored.resumeFrom?.family ?? null,
      sessionToken: stored.resumeFrom?.sessionToken ?? null, park: null, running: null, refusals: [], lastStatus: null,
      endedAt: null, endReason: null,
    };
    tx.jobs.set(stored.id, job);
    tx.touch(job);
    tx.emit("submitted", stored.id, null, { kind: stored.kind, requirement: describeRequirement(stored.family), enqueuedAt: job.enqueuedAt });
    this.#finish(tx, "submit");
    return { job: structuredClone(job), coalesced: false };
  }

  #normalize(spec: JobSpec): StoredSpec {
    const bad = (m: string): never => { throw new TypeError(`omb-sched submit: ${m}`); };
    if (!spec || typeof spec.id !== "string" || !spec.id.trim()) bad("id must be a non-empty string");
    if (!isJobKind(spec.kind)) bad(`unknown kind ${String(spec.kind)}`);
    const llm = isLlmKind(spec.kind);
    let family: FamilyRequirement | null = null;
    if (llm) {
      const req = spec.family ?? { mode: "any" };
      if (!validRequirement(req)) bad("invalid family requirement");
      family = req.mode === "any" ? { mode: "any" } : req.mode === "exactly" ? { mode: "exactly", family: req.family } : { mode: "cross-family", producer: req.producer };
    } else if (spec.family !== undefined) bad("compute jobs take no family requirement");
    let resumeFrom: StoredSpec["resumeFrom"] = null;
    if (spec.resumeFrom !== undefined) {
      const r = spec.resumeFrom;
      if (!llm) bad("compute jobs cannot resume a session");
      if (!isFamily(r.family) || typeof r.sessionToken !== "string" || !r.sessionToken) bad("resumeFrom needs a family and a session token");
      if (!allowedFamilies(family, [], this.policy.familyOrder).includes(r.family)) {
        bad(`resumeFrom family ${r.family} violates requirement ${describeRequirement(family)}`);
      }
      resumeFrom = { family: r.family, sessionToken: r.sessionToken };
    }
    const str = (v: unknown, name: string): string | null => {
      if (v === undefined) return null;
      if (typeof v !== "string" || !v.trim()) bad(`${name} must be a non-empty string`);
      return v as string;
    };
    const partition = str(spec.partition, "partition");
    if (spec.kind === "look" && partition === null) bad("a G8 look needs a partition");
    const base = DEFAULT_DEMAND[spec.kind];
    const cpu = spec.demand?.cpu ?? base.cpu;
    const memBytes = spec.demand?.memBytes ?? base.memBytes;
    if (!(Number.isFinite(cpu) && cpu >= 0 && Number.isFinite(memBytes) && memBytes >= 0)) bad("demand must be finite and non-negative");
    const maxAttempts = spec.maxAttempts ?? this.policy.attempts.maxAttempts;
    if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) bad("maxAttempts must be an integer in [1, 10]");
    if (spec.submittedAt !== undefined && !Number.isFinite(spec.submittedAt)) bad("submittedAt must be finite");
    return {
      id: spec.id, kind: spec.kind, family, resumeFrom, investigation: str(spec.investigation, "investigation"), partition,
      quietGroup: str(spec.quietGroup, "quietGroup"), onceKey: str(spec.onceKey, "onceKey"),
      demand: { class: base.class, cpu, memBytes }, rssKey: str(spec.rssKey, "rssKey"), maxAttempts,
    };
  }

  // ---------------------------------------------------------------- tick

  tick(): TickResult {
    const now = this.#now();
    const tx = new Tx(this.#state, now);

    for (const job of tx.ordered()) {
      if (job.state === "parked" && job.park?.until != null && job.park.until <= now) {
        const reason = job.park.reason;
        if(reason==="family-unavailable"){job.excluded=[];job.preferred=null;}
        if(reason==="interrupt-loop")job.interruptions=0;
        this.#requeue(tx, job);
        tx.emit("woke", job.spec.id, job.pinned, { reason, resume: job.sessionToken !== null });
      }
    }
    for (const f of FAMILIES) {
      const p = tx.provider(f);
      if (p.parkedUntil !== null && p.parkedUntil <= now) {
        tx.emit("provider-resumed", null, f, { reason: p.parkReason });
        p.parkedUntil = null;
        p.parkReason = null;
        tx.touchProvider(f);
      }
    }
    for (const f of FAMILIES) {
      const inflight = tx.running(f).length > 0;
      this.#pollQuota(tx, f, inflight, inflight);
      this.#applyDerivedPark(tx, f);
    }
    let sample: ResourceSample | null = null;
    try {
      const s = this.#deps.resources.sample();
      sample = validSample(s) ? s : null;
    } catch { sample = null; }
    this.#quietStep(tx);

    const active: ActiveLoad[] = tx.running().map((j) => ({
      kind: j.spec.kind, demand: j.running!.demand, startedAt: j.running!.startedAt, rssMeasured: j.running!.rssMeasured, fresh: false,
    }));
    const dispatches: Dispatch[] = [];
    const waiting: TickResult["waiting"] = [];
    let reservedMem = 0;
    let lookWaiting = false;
    for (const job of tx.ordered().filter((j) => j.state === "queued")) {
      const blocked = this.#tryPlace(tx, job, sample, active, reservedMem, lookWaiting, dispatches);
      if (!blocked) continue;
      if (job.state === "queued") waiting.push({ jobId: job.spec.id, reason: blocked.reason });
      // The G8 FIFO barrier is held only by a look that quiet mode admits; an outsider blocked by quiet mode
      // must not stall the quiet group's looks (they would wait for each other forever).
      if (job.spec.kind === "look" && blocked.reason !== "quiet") lookWaiting = true;
      // A memory-blocked compute job holds its (measured) demand against lower-priority work, if it could ever fit.
      const a = this.policy.admission;
      if (blocked.reserveMem > 0 && blocked.reserveMem <= a.memBytes - a.memFloorBytes) reservedMem += blocked.reserveMem;
    }
    this.#finish(tx, "tick");
    return { at: now, dispatches, waiting };
  }

  /**
   * Fold a reading if it is valid and newer. busyNow: Amani has work in flight at this observation;
   * busyAfter: it still will afterwards. Returns false for an invalid reading.
   */
  #observe(tx: Tx, f: Family, reading: unknown, busyNow: boolean, busyAfter: boolean): boolean {
    if (!validReading(reading, f, tx.now)) {
      tx.emit("quota-reading-rejected", null, f, {});
      return false;
    }
    const p = tx.provider(f);
    if (p.reading && reading.observedAt <= p.reading.observedAt) return true;
    const busy = p.busySinceReading || busyNow;
    const measured = observeReading(p, reading as QuotaReading, busy);
    // The busy flag spans gaps in 5-hour telemetry: it resets only when a 5-hour measurement is folded.
    p.busySinceReading = measured ? busyAfter : busy || busyAfter;
    tx.touchProvider(f);
    return true;
  }

  /** One reader attempt. A throw, null or malformed reading means telemetry is unknown (probe concurrency). */
  #pollQuota(tx: Tx, f: Family, busyNow: boolean, busyAfter: boolean): void {
    let reading: unknown = null;
    try { reading = this.#deps.quota.read(f); } catch { reading = null; }
    const ok = reading !== null && reading !== undefined && this.#observe(tx, f, reading, busyNow, busyAfter);
    const p = tx.provider(f);
    if (p.telemetryOk !== ok) {
      p.telemetryOk = ok;
      tx.touchProvider(f);
    }
  }

  #applyDerivedPark(tx: Tx, f: Family): void {
    const p = tx.provider(f);
    const d = derivedPark(p, tx.now, this.policy.quota);
    if (d && (p.parkedUntil === null || p.parkedUntil < d.until)) {
      p.parkedUntil = d.until;
      p.parkReason = d.reason;
      tx.touchProvider(f);
      tx.emit("provider-parked", null, f, { reason: d.reason, until: d.until });
    }
  }

  #quietStep(tx: Tx): void {
    const q = tx.meta.quiet;
    if (q?.auto && !tx.ordered().some((j) => !isTerminal(j.state) && j.state!=="parked" && j.spec.quietGroup === q.group)) {
      tx.meta.quiet = null;
      tx.touchMeta();
      tx.emit("quiet-cleared", null, null, { group: q.group });
    }
    if (!tx.meta.quiet) {
      const first = tx.ordered().find((j) => !isTerminal(j.state) && j.state!=="parked" && j.spec.quietGroup !== null);
      if (first) {
        tx.meta.quiet = { group: first.spec.quietGroup!, reason: "benchmark arm", since: tx.now, auto: true };
        tx.touchMeta();
        tx.emit("quiet-entered", null, null, { group: first.spec.quietGroup!, auto: true });
      }
    }
  }

  #quietBlock(tx: Tx, job: JobRecord): string | null {
    const q = tx.meta.quiet;
    if (!q) return null;
    if (job.spec.quietGroup !== q.group) return "quiet";
    if (tx.running().some((j) => j.spec.quietGroup !== q.group)) return "quiet-draining";
    return null;
  }

  #tryPlace(
    tx: Tx, job: JobRecord, sample: ResourceSample | null, active: ActiveLoad[], reservedMem: number, lookWaiting: boolean,
    out: Dispatch[],
  ): { reason: string; reserveMem: number } | null {
    const quiet = this.#quietBlock(tx, job);
    if (quiet) return { reason: quiet, reserveMem: 0 };
    if (job.spec.kind === "look" && lookWaiting) return { reason: "g8-lane-fifo", reserveMem: 0 };
    const { demand, measured } = resolveDemand(job.spec, tx.meta.rss);
    const admit = () => admitResources(demand, job.spec.kind, measured, sample, active, reservedMem, tx.now, this.policy);
    if (!isLlmKind(job.spec.kind)) {
      const r = admit();
      if (!r.ok) return { reason: r.reason, reserveMem: r.reason === "memory-floor" ? demand.memBytes : 0 };
      this.#dispatch(tx, job, null, demand, measured, active, out);
      return null;
    }
    const placement = placementFamilies(job, this.policy);
    if (placement.unavailable) {
      this.#park(tx, job, "family-unavailable", null, placement.unavailable, null);
      return { reason: "family-unavailable", reserveMem: 0 };
    }
    const reasons: string[] = [];
    const totalSessions = tx.running().filter((j) => j.running!.family !== null).length;
    for (const f of placement.list) {
      const onFamily = tx.running(f);
      const load = { inflight: onFamily.length, inflightCost: onFamily.reduce((s, j) => s + j.running!.cost, 0), totalSessions };
      const qv = quotaAdmits(tx.provider(f), job.spec.kind, job.carryOver, load, tx.now, this.policy);
      if (!qv.ok) { reasons.push(`${f}:${qv.reason}`); continue; }
      const r = admit();
      if (!r.ok) { reasons.push(r.reason); return { reason: reasons.join(","), reserveMem: 0 }; }
      this.#dispatch(tx, job, f, demand, measured, active, out);
      return null;
    }
    return { reason: reasons.join(","), reserveMem: 0 };
  }

  #dispatch(
    tx: Tx, job: JobRecord, family: Family | null, demand: StoredSpec["demand"], measured: boolean, active: ActiveLoad[], out: Dispatch[],
  ): void {
    if (family) assertFamilyAllowed(job, family, this.policy);
    const p = family ? tx.provider(family) : null;
    const soloAtStart = family ? tx.running(family).length === 0 : false;
    job.dispatchCount += 1;
    const dispatchId = `${job.spec.id}#${job.dispatchCount}`;
    const resume = family && job.sessionToken && job.pinned === family ? { sessionToken: job.sessionToken } : null;
    if (p) {
      p.dispatchEpoch += 1;
      p.busySinceReading = true;
      tx.touchProvider(p.family);
    }
    job.running = {
      dispatchId, family, startedAt: tx.now, demand, rssMeasured: measured,
      cost: p ? estimateCost(p, job.spec.kind, this.policy.quota) : 0,
      quotaAtStart: p ? knownUsed(p.fiveHour, tx.now, FIVE_HOUR_MS) : null,
      quotaObservedAt: p?.fiveHour?.observedAt ?? null,
      windowAtStart: p?.windowKey ?? null, epochAtStart: p?.dispatchEpoch ?? 0, soloAtStart,
    };
    job.state = "running";
    job.carryOver = false;
    job.park = null;
    tx.touch(job);
    active.push({ kind: job.spec.kind, demand, startedAt: tx.now, rssMeasured: measured, fresh: true });
    const rerouted = job.refusals.length > 0;
    tx.emit("dispatched", job.spec.id, family, { dispatchId, kind: job.spec.kind, resume: resume !== null, rerouted });
    const pool = family ? this.policy.pools[family] : null;
    out.push({
      dispatchId, jobId: job.spec.id, kind: job.spec.kind, investigation: job.spec.investigation, partition: job.spec.partition,
      family, harness: pool?.harness ?? null, model: pool?.model ?? null, effort: pool?.effort ?? null, resume, rerouted,
      attempt: job.attemptsUsed + 1,
    });
  }

  // ---------------------------------------------------------------- complete

  /** Route the outcome of a dispatch. An outcome for a dispatch that is no longer running is ignored and logged. */
  complete(dispatchId: string, outcome: DispatchOutcome): CompletionResult {
    const now = this.#now();
    const tx = new Tx(this.#state, now);
    const job = tx.ordered().find((j) => j.state === "running" && j.running?.dispatchId === dispatchId);
    if (!job) {
      tx.emit("stale-outcome", null, null, { dispatchId, status: typeof outcome?.status === "string" ? outcome.status : null });
      this.#finish(tx, "complete");
      return { jobId: null, ignored: true, state: null, action: "ignored" };
    }
    const run = job.running!;
    const fam = run.family;
    const status = normalizeStatus(outcome.status);
    if (status === "unknown") tx.emit("unknown-status", job.spec.id, fam, { raw: typeof outcome.status === "string" ? outcome.status.slice(0, 200) : null });

    if (fam) {
      const p = tx.provider(fam);
      // The adapter's end-of-run snapshot when it has one, otherwise the reader's current value.
      const othersInflight = tx.running(fam).some((j) => j !== job);
      if (outcome.quota != null) this.#observe(tx, fam, outcome.quota, true, othersInflight);
      else this.#pollQuota(tx, fam, true, othersInflight);
      // A pre-work refusal did no work: it neither seeds the cost average nor counts as a run.
      if (status !== "refused-prework") {
        p.completedRuns += 1;
        // A sample needs a fresh 5-hour measurement covering this run: newer than the start measurement,
        // taken after the run started and within the freshness window of its end. Missing is not zero.
        const end = p.fiveHour;
        const five = knownUsed(end, now, FIVE_HOUR_MS);
        const fresh = end !== null && run.quotaObservedAt !== null && end.observedAt > run.quotaObservedAt
          && end.observedAt >= run.startedAt && end.observedAt >= now - this.policy.quota.sampleFreshnessMs;
        const solo = run.soloAtStart && p.dispatchEpoch === run.epochAtStart;
        if (fresh && solo && run.quotaAtStart !== null && five !== null && p.windowKey === run.windowAtStart && five >= run.quotaAtStart) {
          recordCostSample(p, job.spec.kind, five - run.quotaAtStart);
        }
      }
      tx.touchProvider(fam);
      if (typeof outcome.sessionToken === "string" && outcome.sessionToken) {
        job.sessionToken = outcome.sessionToken;
        job.pinned = fam;
      }
    }
    const rss = outcome.peakRssBytes;
    if (job.spec.rssKey !== null && typeof rss === "number" && Number.isFinite(rss) && rss > 0) {
      tx.meta.rss[job.spec.rssKey] = Math.max(tx.meta.rss[job.spec.rssKey] ?? 0, rss);
      tx.touchMeta();
    }
    job.running = null;
    job.lastStatus = status;
    if(status!=="ok")job.lastError=(outcome.detail??status).slice(-8192);
    tx.touch(job);

    const result = (action: CompletionResult["action"]): CompletionResult => {
      this.#finish(tx, "complete");
      return { jobId: job.spec.id, ignored: false, state: job.state, action };
    };
    switch (status) {
      case "ok":
        this.#end(tx, job, "succeeded", "ok", fam);
        return result("succeeded");
      case "violation":
        this.#end(tx, job, "stopped", "hard stop reported by the adapter; claims void, record kept, never retried", fam);
        return result("stopped");
      case "rate-limited":
        if (fam) return result(this.#rateLimited(tx, job, fam, outcome));
        break;
      case "provider-error":
        if(fam){const provider=tx.provider(fam);provider.parkedUntil=tx.now+60_000;provider.parkReason="rate-limited";tx.touchProvider(fam);return result(this.#refused(tx,job,fam,"refused-midtask",outcome));}
        break;
      case "refused-prework":
      case "refused-midtask":
        if (fam) return result(this.#refused(tx, job, fam, status, outcome));
        break;
      case "needs-resume":
        if (fam && job.sessionToken !== null && job.pinned === fam) {
          job.resumes += 1;
          if (job.resumes > this.policy.attempts.maxResumes) {
            this.#end(tx, job, "exhausted", `policy-limited: ${job.resumes - 1} resumes used`, fam);
            return result("exhausted");
          }
          this.#requeue(tx, job);
          tx.emit("retry", job.spec.id, fam, { cause: status, attemptConsumed: false, resumes: job.resumes });
          return result("resume");
        }
        break;
      default:
        break;
    }
    return result(this.#retry(tx, job, status, fam));
  }

  #rateLimited(tx: Tx, job: JobRecord, fam: Family, outcome: DispatchOutcome): CompletionResult["action"] {
    const p = tx.provider(fam);
    const until = rateLimitUntil(p, typeof outcome.resetAtMs === "number" ? outcome.resetAtMs : null, tx.now, this.policy.quota);
    if (p.parkedUntil === null || p.parkedUntil < until) {
      p.parkedUntil = until;
      p.parkReason = "rate-limited";
      tx.touchProvider(fam);
      tx.emit("provider-parked", null, fam, { reason: "rate-limited", until });
    }
    // A job holding a session waits for its own provider; an unpinned job may move to another allowed pool now.
    const others = job.pinned === fam ? [] : placementFamilies(job, this.policy).list.filter((f) => f !== fam);
    if (others.length === 0) {
      this.#park(tx, job, "rate-limited", until, `${fam} limit; wakes at reset + slack`, fam);
      return "parked";
    }
    this.#requeue(tx, job);
    tx.emit("retry", job.spec.id, fam, { cause: "rate-limited", attemptConsumed: false, attemptsUsed: job.attemptsUsed });
    return "retry";
  }

  #refused(tx: Tx, job: JobRecord, fam: Family, status: "refused-prework" | "refused-midtask", outcome: DispatchOutcome): CompletionResult["action"] {
    const dispatchId = `${job.spec.id}#${job.dispatchCount}`;
    const hintTo = outcome.reroute?.to;
    const reason = String(outcome.reroute?.reason ?? outcome.detail ?? status).slice(0, 500);
    job.refusals.push({ family: fam, status, at: tx.now, reason, dispatchId });
    job.excluded = sortFamilies([...job.excluded, fam]);
    job.sessionToken = null;
    job.pinned = null;
    const p = tx.provider(fam);
    p.refusals += 1;
    tx.touchProvider(fam);
    // Refusals are counted in job.refusals and never consume an ordinary attempt: the reroute always happens.
    // They are bounded anyway, since each refusal excludes its family for this job.
    tx.emit("refused", job.spec.id, fam, {
      status, reason, hint: typeof hintTo === "string" ? hintTo : null, attemptConsumed: false, refusalsOnFamily: p.refusals,
    });
    job.preferred = isFamily(hintTo) && hintTo !== fam ? hintTo : null;
    const placement = placementFamilies(job, this.policy);
    if (placement.unavailable) {
      this.#park(tx, job, "family-unavailable", null, placement.unavailable, fam);
      return "parked";
    }
    this.#requeue(tx, job);
    tx.emit("rerouted", job.spec.id, fam, { from: fam, to: placement.list[0]!, hintHonored: job.preferred !== null && placement.list[0] === job.preferred });
    return "rerouted";
  }

  #retry(tx: Tx, job: JobRecord, status: OutcomeStatus | "unknown", fam: Family | null): CompletionResult["action"] {
    if(job.spec.kind==='look'){
      this.#end(tx,job,'exhausted',`look execution requires host ledger reconciliation (${status})`,fam);return 'exhausted';
    }
    if(status==='infra-error'||status==='containment-failure'){
      job.infraAttempts=(job.infraAttempts??0)+1;
      this.#park(tx,job,'infra-retry',job.infraAttempts<this.policy.attempts.maxInfraAttempts?tx.now+Math.min(60_000*2**(job.infraAttempts-1),30*60_000):null,job.lastError??status,fam);
      tx.emit('retry',job.spec.id,fam,{cause:status,attemptConsumed:false,infraAttempts:job.infraAttempts});return 'parked';
    }
    job.attemptsUsed += 1;
    if (job.attemptsUsed >= job.spec.maxAttempts) {
      this.#end(tx, job, "exhausted", `policy-limited: ${job.attemptsUsed} attempts used (last ${status})`, fam);
      return "exhausted";
    }
    this.#requeue(tx, job);
    tx.emit("retry", job.spec.id, fam, { cause: status, attemptConsumed: true, attemptsUsed: job.attemptsUsed });
    return "retry";
  }

  #requeue(tx: Tx, job: JobRecord): void {
    job.state = "queued";
    job.carryOver = true;
    job.park = null;
    job.running = null;
    tx.touch(job);
  }

  #park(tx: Tx, job: JobRecord, reason: ParkReason, until: number | null, detail: string, family: Family | null): void {
    job.state = "parked";
    if((reason==='family-unavailable'||reason==='interrupt-loop')&&until===null&&(job.parkWakes??0)<1){until=tx.now+60_000;job.parkWakes=(job.parkWakes??0)+1;}
    job.park = { reason, until, detail };
    job.running = null;
    tx.touch(job);
    tx.emit("parked", job.spec.id, family, { reason, until, detail });
  }

  #end(tx: Tx, job: JobRecord, state: "succeeded" | "exhausted" | "stopped" | "cancelled", reason: string, family: Family | null): void {
    job.state = state;
    job.endedAt = tx.now;
    job.endReason = reason;
    job.park = null;
    job.running = null;
    job.carryOver = false;
    tx.touch(job);
    tx.emit(state, job.spec.id, family, { reason });
  }

  // ---------------------------------------------------------------- recovery and controls

  #recover(): void {
    const tx = new Tx(this.#state, this.#now());
    for (const job of tx.ordered()) {
      if (job.state !== "running" || !job.running) continue;
      const { dispatchId, family } = job.running;
      job.running = null;
      job.interruptions += 1;
      tx.emit("interrupted", job.spec.id, family, { dispatchId, interruptions: job.interruptions, resume: job.sessionToken !== null });
      if (job.spec.kind === "look") {
        this.#park(tx, job, "look-interrupted", null, "a G8 look was in flight at a crash; the fleet look ledger decides whether it was spent", family);
      } else if (job.interruptions > this.policy.attempts.maxInterruptions) {
        this.#park(tx, job, "interrupt-loop", null, `${job.interruptions} orchestrator crashes under this job`, family);
      } else {
        this.#requeue(tx, job);
      }
    }
    this.#finish(tx, "recover");
  }

  /** Record a session token as soon as the adapter learns it, so a crash can resume instead of restarting. */
  noteSession(dispatchId: string, sessionToken: string): boolean {
    const tx = new Tx(this.#state, this.#now());
    const job = tx.ordered().find((j) => j.state === "running" && j.running?.dispatchId === dispatchId);
    const family = job?.running?.family ?? null;
    if (!job || !family || typeof sessionToken !== "string" || !sessionToken) return false;
    job.sessionToken = sessionToken;
    job.pinned = family;
    tx.touch(job);
    tx.emit("session-noted", job.spec.id, family, { dispatchId });
    this.#finish(tx, "control");
    return true;
  }

  cancel(jobId: string, reason = "operator cancel"): boolean {
    const tx = new Tx(this.#state, this.#now());
    const job = tx.jobs.get(jobId);
    if (!job || isTerminal(job.state)) return false;
    this.#end(tx, job, "cancelled", reason, job.running?.family ?? null);
    this.#finish(tx, "control");
    return true;
  }

  /** Operator release of a parked job. Releasing family-unavailable clears refusals (e.g. after a model change). */
  release(jobId: string): boolean {
    const tx = new Tx(this.#state, this.#now());
    const job = tx.jobs.get(jobId);
    if (!job || job.state !== "parked" || !job.park) return false;
    const reason = job.park.reason;
    if (reason === "family-unavailable") {
      job.excluded = [];
      job.preferred = null;
      if (job.pinned !== null && this.policy.pools[job.pinned].sessions === 0) {
        job.pinned = null;
        job.sessionToken = null;
      }
    }
    if (reason === "interrupt-loop") job.interruptions = 0;
    this.#requeue(tx, job);
    tx.emit("released", job.spec.id, null, { reason });
    this.#finish(tx, "control");
    return true;
  }

  /** Manual quiet mode (e.g. an external official arm). Only jobs of `group` are admitted until exitQuiet. */
  enterQuiet(group: string, reason: string): void {
    if (typeof group !== "string" || !group) throw new TypeError("omb-sched: quiet group must be a non-empty string");
    const tx = new Tx(this.#state, this.#now());
    const current = tx.meta.quiet;
    if (current && current.group !== group) throw new Error(`omb-sched: quiet mode already held by ${current.group}`);
    tx.meta.quiet = { group, reason, since: tx.now, auto: false };
    tx.touchMeta();
    tx.emit("quiet-entered", null, null, { group, auto: false, reason });
    this.#finish(tx, "control");
  }

  exitQuiet(): void {
    const tx = new Tx(this.#state, this.#now());
    const current = tx.meta.quiet;
    if (!current) return;
    tx.meta.quiet = null;
    tx.touchMeta();
    tx.emit("quiet-cleared", null, null, { group: current.group });
    this.#finish(tx, "control");
  }

  // ---------------------------------------------------------------- views

  job(id: string): JobRecord | null {
    const job = this.#state.jobs.get(id);
    return job ? structuredClone(job) : null;
  }
  jobs(): JobRecord[] { return [...this.#state.jobs.values()].sort(compareJobs).map((j) => structuredClone(j)); }
  provider(family: Family): ProviderRecord { return structuredClone(this.#state.providers.get(family)!); }
  meta(): SchedMeta { return structuredClone(this.#state.meta); }
  /** Canonical JSON of the whole state, for determinism checks. */
  snapshot(): string {
    const jobs = [...this.#state.jobs.values()].sort((a, b) => (a.spec.id < b.spec.id ? -1 : a.spec.id > b.spec.id ? 1 : 0));
    return canonicalJson({ jobs, providers: FAMILIES.map((f) => this.#state.providers.get(f)!), meta: this.#state.meta });
  }
}
