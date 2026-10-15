import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { canonicalSha256, SqliteEventStore } from "../../bio-core/src/index.ts";
import { fail, freeze, integer, jsonCopy, makeRecord, parent, text, validateActor, validateInput, validatePlan,
  type Actor, type NotebookRecord, type Plan, type RecordInput, type RecordKind } from "./records.ts";
import { apply, attemptCount, claimStatus, current, getRecord, initial, type LedgerSnapshot, type State } from "./state.ts";

export interface LedgerOptions {
  readonly now: () => number;
  /** Test seam. Production defaults to this process and kill(pid, 0). Unknown never permits takeover. */
  readonly pid?: number;
  readonly processState?: (pid: number) => "alive" | "dead" | "unknown";
  readonly faultAt?: (point: string) => void;
}
const SOFTWARE: Actor = { kind: "software", id: "bio-ledger" };
export function processState(pid: number): "alive" | "dead" | "unknown" {
  if (!Number.isSafeInteger(pid) || pid < 1 || pid > 2147483647) return "unknown";
  try { process.kill(pid, 0); return "alive"; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "ESRCH" ? "dead" : "unknown"; }
}

/** Trusted host API. Keep this object, owner tokens, and its database outside the agent's sandbox.
 * Unseal records a one-shot admission; the caller must gate actual data access on its return.
 */
export class InvestigationLedger {
  readonly streamId: string;
  private readonly db: DatabaseSync;
  private readonly events: SqliteEventStore;
  private readonly options: LedgerOptions;
  private closed = false;

  constructor(path: string, investigationId: string, options: LedgerOptions) {
    text(path);
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(investigationId)) fail("invalid investigation id");
    if (typeof options.now !== "function") fail("injected clock required");
    integer(options.pid ?? process.pid, 1);
    this.options = options;
    this.streamId = `bio-ledger:${investigationId}`;
    this.db = new DatabaseSync(path);
    try {
      this.events = new SqliteEventStore(this.db);
      this.db.exec("PRAGMA synchronous = FULL");
      this.db.exec("PRAGMA busy_timeout = 25");
      if (this.events.readStream(this.streamId).length) this.read();
    } catch (error) { this.db.close(); throw error; }
  }

  create(maxAttempts = 2): LedgerSnapshot {
    const s = initial();
    this.write(s, "created", { maxAttempts });
    return this.snapshot();
  }
  snapshot(): LedgerSnapshot { return freeze(this.read()); }
  record<K extends RecordKind>(id: string, kind: K): NotebookRecord<K> { return getRecord(this.snapshot(), id, kind); }
  claimStatus(id: string) { return claimStatus(this.snapshot(), id); }
  verify(): { valid: boolean; eventCount: number; reason?: string } {
    try { this.read(); return { valid: true, eventCount: this.events.readStream(this.streamId).length }; }
    catch (error) { return { valid: false, eventCount: 0, reason: error instanceof Error ? error.message : "unavailable ledger" }; }
  }

  acquire(): string {
    const s = this.read();
    if (s.owner) {
      let state: unknown = "unknown";
      try { state = (this.options.processState ?? processState)(s.owner.pid); } catch { /* unavailable is not dead */ }
      if (state !== "dead") fail("ledger already owned by live or uninspectable process");
    }
    const token = randomUUID();
    this.write(s, "acquired", { owner: { token, pid: this.options.pid ?? process.pid }, previousToken: s.owner?.token ?? null });
    return token;
  }
  release(token: string): void { this.write(this.owned(token, false), "released", { token }); }
  control(action: "pause" | "cancel" | "resume", reason: string): LedgerSnapshot {
    this.write(this.read(), "control", { action, reason }); return this.snapshot();
  }

  /** Model/human proposals cannot mint software observations, checks, or confirmations. */
  appendRecord(token: string, input: RecordInput, actor: { readonly kind: "model" | "human"; readonly id: string }): NotebookRecord {
    const checked = validateActor(jsonCopy(actor));
    if (checked.kind === "software") fail("software records require trusted host API");
    return this.append(token, input, checked);
  }
  /** Only the deterministic checker should receive access to this method. */
  recordSoftware(token: string, input: RecordInput): NotebookRecord { return this.append(token, input, SOFTWARE); }
  private append(token: string, input: RecordInput, actor: Actor): NotebookRecord {
    const s = this.owned(token), at = this.clock(s), r = makeRecord(validateInput(input), at, actor);
    // Retry identity excludes the clock; immutable record IDs still hash the full payload.
    const retryKey = (record: NotebookRecord) => {
      const { at: _at, ...request } = record.payload;
      return canonicalSha256(request);
    };
    const key = retryKey(r), old = s.records.find(old => retryKey(old) === key);
    if (old) return freeze(old); // Acknowledge the original event, including after reopen.
    this.write(s, "recorded", { token, record: r }, at); return r;
  }

  planExperiment(token: string, experimentKey: string, plan: Plan): NotebookRecord<"experiment"> {
    const s = this.owned(token), at = this.clock(s), p = validatePlan(plan);
    const h = getRecord(s, p.hypothesisId, "hypothesis");
    const r = makeRecord({ kind: "experiment", data: { experimentKey, status: "planned", plan: p, planHash: canonicalSha256(p) }, parents: [parent(h)] }, at, SOFTWARE) as NotebookRecord<"experiment">;
    this.write(s, "planned", { token, record: r }, at); return r;
  }

  /** Revisions are one atomic event containing the new lock and its mandatory amendment. */
  lockPlan(token: string, experimentId: string, plan?: Plan, reason?: string): NotebookRecord<"experiment"> {
    const s = this.owned(token), old = current(s, experimentId, "experiment"), p = validatePlan(plan ?? old.payload.data.plan);
    const changed = canonicalSha256(p) !== old.payload.data.planHash;
    if (!changed && old.payload.data.status === "locked") return freeze(old);
    if (changed) text(reason);
    const at = this.clock(s), h = getRecord(s, p.hypothesisId, "hypothesis");
    const r = makeRecord({ kind: "experiment", data: { ...old.payload.data, status: "locked", plan: p, planHash: canonicalSha256(p) },
      parents: [parent(h), parent(old, "supersedes")] }, at, SOFTWARE) as NotebookRecord<"experiment">;
    const amendment = changed ? makeRecord({ kind: "amendment", data: { supersedes: old.id, replacementId: r.id, reason: reason!,
      post_unblinding: s.looks.length > 0 }, parents: [parent(old), parent(r)] }, at, SOFTWARE) : null;
    this.write(s, "locked", { token, previousId: old.id, record: r, amendment }, at); return r;
  }

  commitPartition(token: string, partitionId: string, dataHash: string): void {
    this.write(this.owned(token), "committed", { token, partitionId, dataHash });
  }
  recordProbe(token: string, experimentId: string, prediction: string): NotebookRecord<"probe"> {
    const s = this.owned(token), exp = current(s, experimentId, "experiment"), at = this.clock(s);
    const r = makeRecord({ kind: "probe", data: { experimentId, planHash: exp.payload.data.planHash, prediction }, parents: [parent(exp)] }, at, SOFTWARE) as NotebookRecord<"probe">;
    this.write(s, "probed", { token, record: r }, at); return r;
  }
  unseal(token: string, experimentId: string, partitionId: string): { readonly experimentId: string; readonly partitionId: string; readonly dataHash: string; readonly look: 1 } {
    const s = this.owned(token);
    const probe = s.records.find(r => r.payload.kind === "probe" && r.payload.data.experimentId === experimentId);
    if (!probe) fail("closed-book probe required before unsealing");
    this.write(s, "unsealed", { token, experimentId, partitionId, probeId: probe.id });
    // No file access occurs before this durable admission. A crash now consumes the look anyway.
    const dataHash = s.commitments.find(c => c.partitionId === partitionId)!.dataHash;
    return freeze({ experimentId, partitionId, dataHash, look: 1 });
  }
  startAttempt(token: string, hypothesisId: string, attemptId: string): number {
    const s = this.owned(token), h = getRecord(s, hypothesisId, "hypothesis");
    const number = attemptCount(s, h.id) + 1;
    this.write(s, "attempted", { token, id: attemptId, hypothesisId, number }); return number;
  }
  close(): void { if (!this.closed) { this.db.close(); this.closed = true; } }

  private owned(token: string, active = true): State {
    const s = this.read();
    if (s.owner?.token !== token || s.owner.pid !== (this.options.pid ?? process.pid)) fail("stale ledger owner");
    if (active && s.status !== "ready") fail(`investigation is ${s.status}`);
    return s;
  }
  private clock(s: State): number {
    const at = this.options.now(); integer(at);
    if (!Number.isFinite(new Date(at).getTime()) || at < s.lastAt) fail("invalid or backwards clock");
    return at;
  }
  private write(s: State, type: string, payload: unknown, at = this.clock(s)): void {
    const copy = jsonCopy(payload), sequence = s.sequence;
    apply(s, type, copy, at);
    this.options.faultAt?.(`before-append:${type}`);
    this.events.append({ eventId: `${this.streamId}:${randomUUID()}`, streamId: this.streamId, type: `ledger.${type}`,
      schemaVersion: 1, occurredAt: new Date(at).toISOString(), producerPlaneId: "bio-ledger", payload: copy }, sequence);
    this.options.faultAt?.(`after-append:${type}`);
  }
  private read(): State {
    // Verify and replay a single SQLite snapshot, including the version field core normalizes on read.
    this.db.exec("BEGIN");
    try {
      const rows = this.events.readStream(this.streamId);
      if (!rows.length || rows[0]!.type !== "ledger.created" || !this.events.verifyStream(this.streamId).valid) fail("missing or corrupt ledger chain");
      const invalidVersion = this.db.prepare("SELECT 1 FROM kernel_events WHERE stream_id = ? AND schema_version != 1 LIMIT 1").get(this.streamId);
      if (invalidVersion) fail("unsupported ledger schema version");
      const s = initial();
      for (const event of rows) {
        if (event.producerPlaneId !== "bio-ledger" || !event.type.startsWith("ledger.")) fail("unexpected ledger producer or event");
        const at = Date.parse(event.occurredAt);
        integer(at);
        if (new Date(at).toISOString() !== event.occurredAt) fail("invalid event timestamp");
        apply(s, event.type.slice(7), event.payload, at);
        s.sequence = event.sequence;
      }
      this.db.exec("COMMIT"); return s;
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
}
