import { randomUUID } from "node:crypto";
import { SqliteEventStore, canonicalSha256, type StoredKernelEvent } from "../../bio-core/src/index.ts";

/** Step receipts live outside work. Notebook writes are independently idempotent. */
export class Journal {
  private readonly store: SqliteEventStore;
  private readonly history: StoredKernelEvent[];
  private readonly latestByType = new Map<string, StoredKernelEvent>();
  constructor(file: string, readonly id: string, readonly now: () => number, readonly fault?: (point: string) => void) {
    this.store = new SqliteEventStore(file);
    if (!this.store.verifyStream(id).valid) { this.store.close(); throw new Error("pipeline journal integrity failure"); }
    this.history = this.store.readStream(id);
    for (const event of this.history) this.latestByType.set(event.type, event);
  }
  events() { return structuredClone(this.history); }
  append(type: string, payload: unknown): void {
    const at = this.now();
    const last = this.history.at(-1);
    if (!Number.isSafeInteger(at) || at < 0 || (last && at < Date.parse(last.occurredAt))) throw new Error("invalid or regressing pipeline clock");
    const { event } = this.store.append({ eventId: randomUUID(), streamId: this.id, type, schemaVersion: 1,
      occurredAt: new Date(at).toISOString(), producerPlaneId: "bio-pipeline", payload }, last?.sequence ?? 0);
    this.history.push(event); this.latestByType.set(type, event);
    this.fault?.(`journaled:${type}`);
  }
  latest<T>(type: string): T | undefined { return structuredClone(this.latestByType.get(type)?.payload) as T | undefined; }
  pin(config: unknown, hostAdapter?: import("./host-adapter.ts").HostAdapterIdentity): void {
    const hash = canonicalSha256(config), old = this.latest<{ hash: string; hostAdapter?: import("./host-adapter.ts").HostAdapterIdentity | null }>("configured");
    if (old && old.hash !== hash) throw new Error("investigation configuration changed; use a new investigation directory");
    if (old && canonicalSha256(old.hostAdapter ?? null) !== canonicalSha256(hostAdapter ?? null)) throw new Error("trusted host adapter changed; use a new investigation directory");
    // Config and executable-host binding share one atomic journal append.
    if (!old) this.append("configured", { hash, hostAdapter: hostAdapter ?? null });
  }
  done<T>(step: string): T | undefined { return this.latest<T>(`step.${step}.completed`); }
  close(): void { this.store.close(); }
}
