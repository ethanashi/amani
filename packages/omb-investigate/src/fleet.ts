// The dispatch loop over omb-sched (the V9 integration contract):
//   submit -> tick -> launch each Dispatch (adapter or trusted compute) -> complete -> tick ...
// Every worker, LLM or compute, runs only when the scheduler places it, so family constraints,
// refusal reroute (refused Claude -> Codex, never counted as a science failure), quota bands,
// CPU/RAM admission, the G8 look lane and quiet mode all apply. Many investigations share one
// Fleet; each awaits its own jobs while one pump drives the scheduler.

import type { WorkerAdapter, WorkerResult, WorkerSpec } from "../../omb-adapters/src/index.ts";
import {
  fromAdapterResult, isTerminal, normalizeStatus, type Dispatch, type DispatchOutcome, type Family, type JobRecord, type JobSpec, type Scheduler,
} from "../../omb-sched/src/index.ts";

import { adapterNetworkFailure, networkEvidence, NetworkDown, type Connectivity } from "./network.ts";

export interface LaunchResult { outcome: DispatchOutcome; payload?: unknown }
export type Launcher = (dispatch: Dispatch) => Promise<LaunchResult>;

export interface FleetResult {
  job: JobRecord;
  /** Payload of the dispatches launched by this process, in order (empty after a restart). */
  payloads: unknown[];
  dispatches: Dispatch[];
}

export interface FleetOptions {
  sched: Scheduler;
  network?: Connectivity;
  now: () => number;
  /** Resolve at (or after) the given epoch ms. Production: a timer; tests: advance a fake clock. */
  waitUntil: (epochMs: number) => Promise<void>;
  /** Wait used when nothing is running and nothing is parked with a known wake time. Default 30 s. */
  idleWaitMs?: number;
  /** Fail every waiter after this many consecutive waits without progress (tests). Default unlimited. */
  maxIdleWaits?: number;
  /** Errors that mean "this orchestrator process is dead" (fault injection): they are not turned into an
   * infra_error outcome; the fleet stops touching the scheduler and every waiter rejects. */
  fatal?: (error: unknown) => boolean;
}

/** Parks the scheduler resolves by itself (the fleet keeps waiting); every other park is an operator decision. */
const SELF_WAKING = new Set(["rate-limited","family-unavailable","interrupt-loop","infra-retry"]);

export function jobSettled(job: JobRecord): boolean {
  return isTerminal(job.state) || (job.state === "parked" && (!SELF_WAKING.has(job.park?.reason ?? "")||job.park?.until==null));
}

interface Waiter { launch: Launcher; resolvers: { resolve: (r: FleetResult) => void; reject: (e: unknown) => void }[]; payloads: unknown[]; dispatches: Dispatch[] }

export class Fleet {
  readonly #o: FleetOptions;
  readonly #waiters = new Map<string, Waiter>();
  readonly #inflight = new Map<string, Promise<void>>();
  /** Dispatches placed for a job nobody awaits yet (e.g. requeued after a restart). Claimed by run(). */
  readonly #orphans = new Map<string, Dispatch>();
  #pumping: Promise<void> | null = null;
  #newWork: (()=>void) | null = null;
  #dead: unknown = null;

  constructor(options: FleetOptions) { this.#o = options; }

  async delay(ms:number):Promise<void>{await this.#o.waitUntil(this.#o.now()+ms);}

  get sched(): Scheduler { return this.#o.sched; }

  async recoverNetwork(jobId: string): Promise<void> {
    if (!this.#o.network) throw new NetworkDown();
    await this.#o.network.park(jobId, "codex");
  }

  /** Connectivity checked before the durable look boundary, never after spending the look. */
  async beforeLook(jobId: string): Promise<void> {
    if (!this.#o.network) return;
    for (const family of ["codex", "claude"] as const) {
      if (!await this.#o.network.reachable(family)) await this.#o.network.park(jobId, family);
    }
  }

  /**
   * Startup hygiene after a restart: cancel every non-terminal job this orchestrator will not resume
   * (e.g. jobs of investigations it is not continuing). An unclaimed dispatch would otherwise hold a
   * slot (a heavy job runs alone among heavy jobs; one look holds the G8 lane). Returns the job ids.
   */
  retireUnowned(owned: (job: JobRecord) => boolean, reason = "not resumed by this orchestrator"): string[] {
    const retired: string[] = [];
    for (const job of this.#o.sched.jobs()) {
      if (isTerminal(job.state) || owned(job) || this.#waiters.has(job.spec.id)) continue;
      this.#o.sched.cancel(job.spec.id, reason);
      for (const [dispatchId, d] of this.#orphans) if (d.jobId === job.spec.id) this.#orphans.delete(dispatchId);
      retired.push(job.spec.id);
    }
    return retired;
  }

  /** Submit (idempotent for an identical spec) and wait until the job settles. */
  run(spec: JobSpec, launch: Launcher): Promise<FleetResult> {
    if (this.#dead !== null) return Promise.reject(this.#dead);
    const { job } = this.#o.sched.submit(spec);
    const id = job.spec.id;
    if (jobSettled(job) && !this.#inflight.has(id)) return Promise.resolve({ job, payloads: [], dispatches: [] });
    return new Promise<FleetResult>((resolve, reject) => {
      const w = this.#waiters.get(id) ?? { launch, resolvers: [], payloads: [], dispatches: [] };
      w.resolvers.push({ resolve, reject });
      this.#waiters.set(id, w);
      const orphan = [...this.#orphans.values()].find((d) => d.jobId === id);
      if (orphan) { this.#orphans.delete(orphan.dispatchId); this.#launch(orphan); }
      this.#kick();
    });
  }

  #kick(): void {
    if (this.#dead !== null) return;
    if (this.#pumping) { this.#newWork?.(); return; }
    this.#pumping = this.#pump().catch((error) => { this.#fail(error); }).finally(() => {
      this.#pumping = null;
      if (this.#waiters.size > 0 && this.#dead === null) this.#kick();
    });
  }

  #fail(error: unknown): void {
    if (this.#o.fatal?.(error)) this.#dead = error;
    for (const w of this.#waiters.values()) for (const r of w.resolvers) r.reject(error);
    this.#waiters.clear();
  }

  #settle(): void {
    for (const [id, w] of [...this.#waiters]) {
      const job = this.#o.sched.job(id);
      if (!job || this.#inflight.has(id) || !jobSettled(job)) continue;
      this.#waiters.delete(id);
      for (const r of w.resolvers) r.resolve({ job, payloads: w.payloads, dispatches: w.dispatches });
    }
  }

  #launch(d: Dispatch): void {
    const w = this.#waiters.get(d.jobId);
    if (!w) { this.#orphans.set(d.dispatchId, d); return; }
    w.dispatches.push(d);
    const run = (async () => {
      let result: LaunchResult;
      let dispatch = d,upLoops=0;
      for (;;) {
        try {
          if (dispatch.family && this.#o.network?.blocked) await this.#o.network.park(d.jobId, dispatch.family);
          result = await w.launch(dispatch);
        } catch (e) {
          if (this.#o.fatal?.(e)) throw e;
          if (e instanceof NetworkDown) { this.#o.sched.cancel(d.jobId, e.message); return; }
          result = { outcome: { status: this.#o.sched.job(d.jobId)?.spec.kind === "look" ? "agent-error" : "infra_error", detail: String((e as Error)?.message ?? e).slice(0, 300) } };
        }
        const payload = dispatch.family ? result.payload as WorkerPayload | undefined : undefined;
        const family = dispatch.family;
        const retryable = !["ok", "violation", "containment-failure", "refused-prework", "refused-midtask", "rate-limited"].includes(normalizeStatus(result.outcome.status));
        const evidence = payload?.result ? adapterNetworkFailure(payload.result) : false;
        const reachable=this.#o.network&&family?await this.#o.network.reachable(family):true;
        if(evidence&&reachable&&++upLoops>=2){result={...result,outcome:{...result.outcome,status:"agent-error",detail:"Provider transport reachable after two network-looking failures; repair the agent turn"}};break;}
        const down = this.#o.network && family && retryable && (evidence || !reachable);
        if (!down) break;
        const token = payload?.result.sessionToken ?? dispatch.resume?.sessionToken;
        if (token) {
          this.#o.sched.noteSession(d.dispatchId, token);
          dispatch = { ...dispatch, resume: { sessionToken: token } };
        }
        try { await this.#o.network!.park(d.jobId, family!); }
        catch (e) { if (!(e instanceof NetworkDown)) throw e; this.#o.sched.cancel(d.jobId, e.message); return; }
      }
      if (this.#dead !== null) return;
      w.payloads.push(result.payload ?? null);
      this.#o.sched.complete(d.dispatchId, result.outcome);
    })().finally(() => { this.#inflight.delete(d.jobId); });
    this.#inflight.set(d.jobId, run);
  }

  #nextWake(): number | null {
    let wake: number | null = null;
    for (const id of this.#waiters.keys()) {
      const job = this.#o.sched.job(id);
      const until = job?.state === "parked" ? job.park?.until ?? null : null;
      if (until !== null && (wake === null || until < wake)) wake = until;
    }
    for (const f of ["codex", "claude"] as const) {
      const p = this.#o.sched.provider(f).parkedUntil;
      if (p !== null && p > this.#o.now() && (wake === null || p < wake)) wake = p;
    }
    return wake;
  }

  async #pump(): Promise<void> {
    let idle = 0;
    while (this.#waiters.size > 0) {
      this.#settle();
      if (this.#waiters.size === 0) break;
      // Conservatively hold new admission while a provider is down; in-flight work continues.
      const { dispatches } = this.#o.network?.blocked ? { dispatches: [] } : this.#o.sched.tick();
      for (const d of dispatches) this.#launch(d);
      this.#settle();
      if (this.#inflight.size > 0) {
        idle = 0;
        // A newly submitted job gets its own admission check even if an unrelated model
        // turn is still running. Admission limits and the serialized look lane still apply.
        let signal!:()=>void;
        const wake=new Promise<void>(resolve=>{signal=resolve;});this.#newWork=signal;
        try{await Promise.race([...this.#inflight.values(),wake]);}
        finally{if(this.#newWork===signal)this.#newWork=null;}
        continue;
      }
      if (dispatches.length > 0) continue;
      if (this.#waiters.size === 0) break;
      idle += 1;
      if (this.#o.maxIdleWaits !== undefined && idle > this.#o.maxIdleWaits) {
        const why = [...this.#waiters.keys()].map((id) => `${id}:${this.#o.sched.job(id)?.state ?? "missing"}`).join(", ");
        throw new Error(`omb-investigate fleet stalled: ${why}`);
      }
      const wake = this.#nextWake();
      await this.#o.waitUntil(wake ?? this.#o.now() + (this.#o.idleWaitMs ?? 30_000));
    }
  }
}

/** Builds the WorkerSpec for one dispatch; may record a durable dispatch note first. */
export type SpecBuilder = (dispatch: Dispatch & { family: Family }) => WorkerSpec;

export interface WorkerPayload { spec: WorkerSpec; result: WorkerResult }

/** Launch an LLM dispatch through the adapter of the family the scheduler chose. */
export function adapterLauncher(workers: Readonly<Record<Family, WorkerAdapter>>, build: SpecBuilder, now: () => number): Launcher {
  return async (d) => {
    if (d.family === null) return { outcome: { status: "infra_error", detail: "LLM dispatch without a family" } };
    const adapter = workers[d.family];
    if (!adapter) return { outcome: { status: "infra_error", detail: `no ${d.family} adapter configured` } };
    const spec = build({ ...d, family: d.family });
    const result = await adapter.run(spec);
    return { outcome: fromAdapterResult(d.family, result, now()), payload: { spec, result } satisfies WorkerPayload };
  };
}

/** Launch trusted, LLM-free compute (stage, rerun, look, sim). A throw is an infrastructure retry. */
export function computeLauncher(run: (d: Dispatch) => Promise<unknown>): Launcher {
  return async (d) => ({ outcome: { status: "ok" }, payload: await run(d) });
}
