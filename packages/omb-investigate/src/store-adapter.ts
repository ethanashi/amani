import { DatabaseSync } from "node:sqlite";
import { canonicalJson, canonicalSha256 } from "../../bio-core/src/index.ts";
import type { SchedStore, SchedTx, JobRecord, ProviderRecord, SchedMeta } from "../../omb-sched/src/index.ts";
import type { OmbStore } from "../../omb-store/src/index.ts";
import { eventHash, verifyChain, assertStream, JournalConflict, type Journal, type JournalEvent } from "./journal.ts";
import { checkDecision, JournalLedger } from "./stores.ts";
import type { ContentTuple, HypothesisRegistryPort, LordSettings, RegistryDecision, RegistryEntry, LookRequest, LookRecord } from "./ports.ts";
import type { Json } from "./types.ts";

/** Single-writer scheduler persistence. Every scheduler mutation is one FULL/WAL transaction. */
export class SqliteSchedStore implements SchedStore {
  readonly #db: DatabaseSync;
  constructor(file: string, private readonly beforeCommit?: () => void) {
    this.#db = new DatabaseSync(file, { timeout: 250 });
    this.#db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS providers (id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS meta (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY, body TEXT NOT NULL);`);
  }
  loadJobs(): JobRecord[] { return this.#db.prepare("SELECT body FROM jobs ORDER BY id").all().map(r => JSON.parse(String(r.body)) as JobRecord); }
  loadProviders(): ProviderRecord[] { return this.#db.prepare("SELECT body FROM providers ORDER BY id").all().map(r => JSON.parse(String(r.body)) as ProviderRecord); }
  loadMeta(): SchedMeta | null { const r = this.#db.prepare("SELECT body FROM meta WHERE id=1").get(); return r ? JSON.parse(String(r.body)) as SchedMeta : null; }
  commit(tx: SchedTx): void {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      for (const j of tx.jobs) this.#db.prepare("INSERT OR REPLACE INTO jobs VALUES (?,?)").run(j.spec.id, canonicalJson(j));
      for (const p of tx.providers) this.#db.prepare("INSERT OR REPLACE INTO providers VALUES (?,?)").run(p.family, canonicalJson(p));
      if (tx.meta) this.#db.prepare("INSERT OR REPLACE INTO meta VALUES (1,?)").run(canonicalJson(tx.meta));
      let seq = Number(this.#db.prepare("SELECT coalesce(max(seq),0) AS seq FROM events").get()!.seq);
      for (const e of tx.events) {
        if (!Number.isSafeInteger(e.seq) || e.seq <= seq) throw new Error("scheduler event sequence regressed");
        this.#db.prepare("INSERT INTO events VALUES (?,?)").run(e.seq, canonicalJson(e)); seq = e.seq;
      }
      this.beforeCommit?.(); this.#db.exec("COMMIT");
    } catch (e) { this.#db.exec("ROLLBACK"); throw e; }
  }
  close(): void { this.#db.close(); }
}

/** Route P compatibility journal inside V5 authenticated, immutable artifacts. This is NOT a
 * synthetic L0-L6 chain: absent contracts/partitions remain absent. One V7 orchestrator owns it.
 */
export class StoreJournal implements Journal {
  constructor(private readonly store: OmbStore, private readonly now: () => number) {}
  read(stream: string): JournalEvent[] {
    assertStream(stream);
    const rows: JournalEvent[] = [];
    for (const event of this.store.events()) {
      if (event.kind !== "artifact") continue;
      const hash = (event.payload as { hash: string }).hash;
      let value: { domain?: string; event?: JournalEvent };
      const bytes = this.store.artifact(hash);
      try { value = JSON.parse(bytes.toString()) as typeof value; } catch { continue; }
      if (value?.domain === "omb-investigate/journal/v1" && value.event?.stream === stream) rows.push(value.event);
    }
    if (!verifyChain(rows).valid) throw new Error("V5 compatibility journal chain invalid");
    return rows;
  }
  verify(stream: string) { return verifyChain(this.read(stream)); }
  append(stream: string, type: string, payload: Json, expected?: number): JournalEvent {
    const rows = this.read(stream);
    if (expected !== undefined && expected !== rows.length) throw new JournalConflict(stream, expected, rows.length);
    const base = { stream, seq: rows.length + 1, at: this.now(), type, payload, prevHash: rows.at(-1)?.hash ?? null };
    const event = { ...base, hash: eventHash(base) };
    this.store.putArtifact(Buffer.from(canonicalJson({ domain: "omb-investigate/journal/v1", event })));
    return event;
  }
}

/** Uses V5's HMAC and durable artifacts for degraded P investigations. Sealed routes require the
 * native runConfirm adapter below; they must never fall through to the compatibility ledger.
 */
export class StoreLedger extends JournalLedger {
  constructor(private readonly store: OmbStore, journal: Journal) {
    super(journal, Buffer.from(store.seed({ registryVersion: "v7-compatibility", planLockHash: "0".repeat(64), contractHash: "0".repeat(64), frozenCodeHash: "0".repeat(64), dataHash: "0".repeat(64) }, "journal-key"), "hex"));
  }
  override seed(tuple: Partial<ContentTuple>, purpose: string): string {
    // Missing pins are domain-separated placeholders for pre-lock blinding only, never evidence.
    return this.store.seed({ registryVersion: tuple.registryVersion ?? "unavailable/v7", planLockHash: tuple.planLockHash ?? "0".repeat(64), contractHash: tuple.contractHash || "0".repeat(64), frozenCodeHash: tuple.frozenCodeHash ?? "0".repeat(64), dataHash: tuple.dataHash || "0".repeat(64) }, purpose);
  }
  override async recordLook(request: LookRequest): Promise<LookRecord> {
    if (request.route !== "P") throw new Error("route H/N requires native runConfirm with OS-user attestation");
    return super.recordLook(request);
  }
}

/** Native V5 registrations; rank is derived from the committed event order within each manifest.
 * Concurrent writers cannot allocate duplicate ordinals by reading a count before committing.
 */
export class StoreRegistry implements HypothesisRegistryPort {
  constructor(private readonly store: OmbStore) {}
  entries(manifest?: string): RegistryEntry[] {
    const counts = new Map<string, number>();
    return this.store.events().flatMap(e => {
      if (e.kind !== "hypothesis") return [];
      const p = (e.payload as { payload: { domain?: string; entry?: Omit<RegistryEntry, "ordinal"> } }).payload;
      if (p.domain !== "omb-investigate/hypothesis/v1" || !p.entry) return [];
      const entry = p.entry, ordinal = (counts.get(entry.manifest) ?? 0) + 1; counts.set(entry.manifest, ordinal);
      return manifest === undefined || entry.manifest === manifest ? [{ ...entry, ordinal }] : [];
    });
  }
  ordinal(manifest: string, fingerprint: string): number | null { return this.entries(manifest).find(e => e.fingerprint === fingerprint)?.ordinal ?? null; }
  count(manifest: string): number { return this.entries(manifest).length; }
  /** The store's own LORD++ policy (its immutable settings event). */
  lordSettings(): LordSettings {
    const settings = this.store.events().filter(e => e.kind === "settings").map(e => e.payload as { alpha?: unknown; w0?: unknown });
    const s = settings.length === 1 ? settings[0]! : null;
    if (!s || typeof s.alpha !== "number" || typeof s.w0 !== "number") throw new Error("V5 store LORD++ settings unavailable");
    return { alpha: s.alpha, w0: s.w0 };
  }
  decisions(manifest: string): RegistryDecision[] {
    const out = new Map<number, RegistryDecision>();
    for (const e of this.store.events()) {
      if (e.kind !== "hypothesis") continue;
      const p = (e.payload as { payload: { domain?: string; decision?: RegistryDecision } }).payload;
      if (p.domain !== "omb-investigate/hypothesis-decision/v1" || !p.decision || p.decision.manifest !== manifest) continue;
      const d = checkDecision(p.decision);
      if (!out.has(d.ordinal)) out.set(d.ordinal, d);
    }
    return [...out.values()].sort((a, b) => a.ordinal - b.ordinal);
  }
  /** One V5 hypothesis event per (manifest, ordinal): the store's fingerprint dedupe makes the first decision final. */
  recordDecision(decision: RegistryDecision): { first: boolean; decision: RegistryDecision } {
    const d = checkDecision(decision);
    if (!this.entries(d.manifest).some(e => e.ordinal === d.ordinal)) throw new Error("decision on an unregistered hypothesis ordinal");
    const { first, hypothesis } = this.store.registerHypothesis({ fingerprint: canonicalSha256(["v7-hypothesis-decision", d.manifest, d.ordinal]), payload: { domain: "omb-investigate/hypothesis-decision/v1", decision: d } });
    return { first, decision: checkDecision((hypothesis.payload as { decision: RegistryDecision }).decision) };
  }
  register(entry: Omit<RegistryEntry, "ordinal">): { ordinal: number; first: boolean } {
    if (!entry.manifest || !/^[a-f0-9]{64}$/.test(entry.fingerprint)) throw new Error("manifest and hypothesis fingerprint required");
    const { first } = this.store.registerHypothesis({ fingerprint: canonicalSha256(["v7-hypothesis", entry.manifest, entry.fingerprint]), payload: { domain: "omb-investigate/hypothesis/v1", entry } });
    const ordinal = this.ordinal(entry.manifest, entry.fingerprint);
    if (ordinal === null) throw new Error("committed hypothesis missing");
    return { first, ordinal };
  }
}
