// Append-only, hash-chained journal of everything an investigation (or a boss program) records.
// One stream per investigation / program / registry / ledger. The orchestrator is the single writer;
// workers never see the journal. Two backends: MemoryJournal (tests, same chain rule) and
// SqliteJournal on bio-core's SqliteEventStore (production, node:sqlite WAL, durable on return).

import { canonicalJson, sha256Canonical, SqliteEventStore } from "../../bio-core/src/index.ts";
import type { Json } from "./types.ts";

export interface JournalEvent {
  readonly stream: string;
  /** 1-based, per stream. */
  readonly seq: number;
  /** Epoch ms from the injected clock. */
  readonly at: number;
  readonly type: string;
  readonly payload: Json;
  readonly prevHash: string | null;
  readonly hash: string;
}

export interface ChainCheck { valid: boolean; events: number; brokenAt: number | null }

/**
 * Optimistic concurrency on one stream: the writer's view of the stream (its length) no longer
 * matches the stream. Nothing was written. The caller must re-read the head and re-validate whatever
 * it decided on the old view; it must never blindly re-apply the same record.
 */
export class JournalConflict extends Error {
  constructor(readonly stream: string, readonly expected: number, readonly actual: number | null) {
    super(`omb-investigate journal: ${stream} moved (expected ${expected} events, found ${actual ?? "more"}); re-read and re-validate`);
    this.name = "JournalConflict";
  }
}

export interface Journal {
  /**
   * Durable before it returns. Throws on a non-canonical payload. With `expect` (the number of
   * events the caller saw in this stream), the append is refused with JournalConflict unless the
   * stream still has exactly that many events.
   */
  append(stream: string, type: string, payload: Json, expect?: number): JournalEvent;
  read(stream: string): JournalEvent[];
  verify(stream: string): ChainCheck;
}

const STREAM = /^[A-Za-z0-9._:/@-]{1,200}$/;
export function assertStream(stream: string): void {
  if (typeof stream !== "string" || !STREAM.test(stream)) throw new TypeError(`omb-investigate journal: invalid stream id ${JSON.stringify(stream)}`);
}

export function eventHash(e: Omit<JournalEvent, "hash">): string {
  return sha256Canonical({ stream: e.stream, seq: e.seq, at: e.at, type: e.type, payload: e.payload, prevHash: e.prevHash });
}

/** Chain rule shared by both backends: consecutive seq from 1, prevHash links, recomputed hash. */
export function verifyChain(events: readonly JournalEvent[]): ChainCheck {
  let prev: string | null = null;
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    if (e.seq !== i + 1 || e.prevHash !== prev || eventHash(e) !== e.hash) return { valid: false, events: events.length, brokenAt: i + 1 };
    prev = e.hash;
  }
  return { valid: true, events: events.length, brokenAt: null };
}

/**
 * In-memory journal. Events are stored as canonical JSON text, so a payload that a SQLite journal
 * could not hold fails at append and callers cannot mutate stored records through references.
 */
export class MemoryJournal implements Journal {
  readonly #streams = new Map<string, { events: JournalEvent[]; verified: number }>();
  appends = 0;
  constructor(private readonly now: () => number, private readonly hooks: { beforeAppend?: (stream: string, type: string) => void } = {}) {}

  #stream(stream: string): { events: JournalEvent[]; verified: number } {
    let s = this.#streams.get(stream);
    if (!s) { s = { events: [], verified: 0 }; this.#streams.set(stream, s); }
    return s;
  }

  append(stream: string, type: string, payload: Json, expect?: number): JournalEvent {
    assertStream(stream);
    if (typeof type !== "string" || !type) throw new TypeError("omb-investigate journal: event type required");
    this.hooks.beforeAppend?.(stream, type);
    const s = this.#stream(stream);
    if (expect !== undefined && s.events.length !== expect) throw new JournalConflict(stream, expect, s.events.length);
    const last = s.events.at(-1) ?? null;
    // Canonical round trip: a payload a SQLite journal could not hold fails here, and stored records
    // are deep-frozen copies callers cannot mutate.
    const base = { stream, seq: s.events.length + 1, at: this.now(), type, payload: JSON.parse(canonicalJson(payload)) as Json, prevHash: last?.hash ?? null };
    const event = deepFreeze({ ...base, hash: eventHash(base) });
    s.events.push(event);
    this.appends += 1;
    return event;
  }

  read(stream: string): JournalEvent[] {
    assertStream(stream);
    return [...(this.#streams.get(stream)?.events ?? [])];
  }

  /** Incremental: events appended through append() are verified once; tamper() resets the check. */
  verify(stream: string): ChainCheck {
    const s = this.#stream(stream);
    const events = s.events;
    let prev = s.verified > 0 ? events[s.verified - 1]!.hash : null;
    for (let i = s.verified; i < events.length; i++) {
      const e = events[i]!;
      if (e.seq !== i + 1 || e.prevHash !== prev || eventHash(e) !== e.hash) return { valid: false, events: events.length, brokenAt: i + 1 };
      prev = e.hash;
      s.verified = i + 1;
    }
    return { valid: true, events: events.length, brokenAt: null };
  }

  streams(): string[] {
    return [...this.#streams.keys()].sort();
  }

  /** Test seam only: rewrite a stream's stored events (tamper and truncation tests). */
  tamper(stream: string, edit: (events: JournalEvent[]) => JournalEvent[]): void {
    const edited = edit(this.read(stream).map((e) => JSON.parse(JSON.stringify(e)) as JournalEvent));
    this.#streams.set(stream, { events: edited.map((e) => deepFreeze(JSON.parse(canonicalJson(e)) as JournalEvent)), verified: 0 });
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

interface Envelope { at: number; data: Json }

/**
 * Production journal on bio-core's hash-chained SqliteEventStore (one SQLite file, WAL mode).
 * Single writer: each append passes the expected stream sequence, so a second writer fails instead
 * of forking the chain. The bio-core chain (previous/event sha256) is the authority for verify().
 */
export class SqliteJournal implements Journal {
  readonly #store: SqliteEventStore;
  constructor(file: string, private readonly now: () => number) {
    this.#store = new SqliteEventStore(file);
  }

  append(stream: string, type: string, payload: Json, expect?: number): JournalEvent {
    assertStream(stream);
    const stored = this.#store.readStream(stream);
    if (expect !== undefined && stored.length !== expect) throw new JournalConflict(stream, expect, stored.length);
    const seq = stored.length + 1;
    const at = this.now();
    const data = JSON.parse(canonicalJson(payload)) as Json;
    // bio-core's optimistic check compares the stream's last GLOBAL sequence (one SQLite file holds
    // every stream), inside BEGIN IMMEDIATE: a writer that appended to this stream since our read
    // makes the insert fail instead of forking the chain.
    const lastGlobal = stored.at(-1)?.sequence ?? 0;
    let result;
    try {
      result = this.#store.append({
        eventId: `${stream}#${seq}`, streamId: stream, type, schemaVersion: 1, occurredAt: new Date(at).toISOString(),
        producerPlaneId: "omb-investigate", payload: { at, data } satisfies Envelope,
      }, lastGlobal);
    } catch (e) {
      const message = String((e as Error)?.message ?? e);
      if (message === "stale event stream sequence" || message.startsWith("event id collision")) throw new JournalConflict(stream, expect ?? stored.length, null);
      throw e;
    }
    if (!result.appended) throw new JournalConflict(stream, expect ?? stored.length, null);
    return { stream, seq, at, type, payload: data, prevHash: result.event.previousEventSha256, hash: result.event.eventSha256 };
  }

  read(stream: string): JournalEvent[] {
    assertStream(stream);
    return this.#store.readStream(stream).map((e, i) => {
      const env = e.payload as Envelope;
      return { stream, seq: i + 1, at: env.at, type: e.type, payload: env.data, prevHash: e.previousEventSha256, hash: e.eventSha256 };
    });
  }

  verify(stream: string): ChainCheck {
    const r = this.#store.verifyStream(stream);
    return { valid: r.valid, events: r.eventCount, brokenAt: r.brokenSequence ?? null };
  }

  close(): void {
    this.#store.close();
  }
}
