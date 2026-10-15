import { canonicalJson } from "../../bio-core/src/index.ts";
import type { JobRecord, ProviderRecord, SchedEvent, SchedMeta } from "./types.ts";

/** One atomic write: upsert jobs (by spec.id) and providers (by family), replace meta, append events. */
export interface SchedTx {
  readonly jobs: readonly JobRecord[];
  readonly providers: readonly ProviderRecord[];
  readonly meta: SchedMeta | null;
  readonly events: readonly SchedEvent[];
}

/**
 * Minimal durable-state interface the scheduler needs. omb-store (V5) maps it onto its jobs, events,
 * quota-snapshot and meta tables in one short SQLite transaction; commit must be all-or-nothing.
 * Synchronous on purpose: node:sqlite is synchronous and the scheduler is a single writer.
 */
export interface SchedStore {
  loadJobs(): JobRecord[];
  loadProviders(): ProviderRecord[];
  loadMeta(): SchedMeta | null;
  commit(tx: SchedTx): void;
}

/**
 * In-memory implementation. Records are kept as canonical JSON text, so anything not representable in a
 * SQLite JSON column (undefined, Infinity, class instances) fails at commit, and callers cannot mutate
 * stored state through shared references. `beforeCommit` lets tests fail a commit at the exact boundary.
 */
export class MemorySchedStore implements SchedStore {
  #jobs = new Map<string, string>();
  #providers = new Map<string, string>();
  #meta: string | null = null;
  #events: string[] = [];
  #lastSeq = 0;
  commits = 0;

  constructor(private readonly hooks: { beforeCommit?: (tx: SchedTx) => void } = {}) {}

  loadJobs(): JobRecord[] {
    return [...this.#jobs.values()].map((s) => JSON.parse(s) as JobRecord);
  }
  loadProviders(): ProviderRecord[] {
    return [...this.#providers.values()].map((s) => JSON.parse(s) as ProviderRecord);
  }
  loadMeta(): SchedMeta | null {
    return this.#meta === null ? null : (JSON.parse(this.#meta) as SchedMeta);
  }
  events(): SchedEvent[] {
    return this.#events.map((s) => JSON.parse(s) as SchedEvent);
  }

  commit(tx: SchedTx): void {
    this.hooks.beforeCommit?.(tx);
    // Stage everything first; swap only when every record serialized and every event is in order.
    const jobs = new Map(this.#jobs);
    for (const j of tx.jobs) jobs.set(j.spec.id, canonicalJson(j));
    const providers = new Map(this.#providers);
    for (const p of tx.providers) providers.set(p.family, canonicalJson(p));
    const meta = tx.meta === null ? this.#meta : canonicalJson(tx.meta);
    let seq = this.#lastSeq;
    const events = tx.events.map((e) => {
      if (!(Number.isSafeInteger(e.seq) && e.seq > seq)) throw new Error(`omb-sched store: event seq ${e.seq} not after ${seq}`);
      seq = e.seq;
      return canonicalJson(e);
    });
    this.#jobs = jobs;
    this.#providers = providers;
    this.#meta = meta;
    this.#events.push(...events);
    this.#lastSeq = seq;
    this.commits += 1;
  }
}
