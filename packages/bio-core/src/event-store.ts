import { DatabaseSync } from "node:sqlite";
import type { KernelEvent, StoredKernelEvent } from "./protocol/index.ts";
import { canonicalJson, sha256Canonical } from "./canonical.ts";
import { assertIsoDate, assertNonBlank } from "./validation.ts";

interface EventRow {
  sequence: number;
  event_id: string;
  stream_id: string;
  event_type: string;
  schema_version: number;
  occurred_at: string;
  producer_plane_id: string;
  payload_json: string;
  previous_event_sha256: string | null;
  event_sha256: string;
}

export interface AppendResult<T extends KernelEvent = KernelEvent> {
  appended: boolean;
  event: StoredKernelEvent<T["type"], T["payload"]>;
}

export class SqliteEventStore {
  private readonly database: DatabaseSync;
  private readonly ownsDatabase: boolean;

  constructor(source: string | DatabaseSync) {
    if (typeof source === "string") assertNonBlank("event store path", source);
    this.database = typeof source === "string" ? new DatabaseSync(source) : source;
    this.ownsDatabase = typeof source === "string";
    this.database.exec("PRAGMA foreign_keys = ON");
    this.database.exec("PRAGMA busy_timeout = 5000");
    this.database.exec("PRAGMA journal_mode = WAL");
    ensureKernelEventSchema(this.database);
  }

  append<T extends KernelEvent>(event: T, expectedStreamSequence?: number): AppendResult<T> {
    validateEvent(event);
    if (expectedStreamSequence !== undefined && (!Number.isSafeInteger(expectedStreamSequence) || expectedStreamSequence < 0)) {
      throw new Error("expected stream sequence must be a non-negative safe integer");
    }
    this.database.exec("BEGIN IMMEDIATE");
    try {
      // Idempotent retries still validate immutable identity in append below.
      // A new event must compare against the stream, not the global sequence.
      if (expectedStreamSequence !== undefined && !this.findById(event.eventId)) {
        const row = this.database.prepare("SELECT COALESCE(MAX(sequence), 0) AS seq FROM kernel_events WHERE stream_id = ?")
          .get(event.streamId) as { seq: number };
        if (Number(row.seq) !== expectedStreamSequence) throw new Error("stale event stream sequence");
      }
      const result = appendKernelEventInTransaction(this.database, event);
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  readStream(streamId: string, afterSequence = 0): StoredKernelEvent[] {
    assertNonBlank("stream id", streamId);
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
      throw new Error("after sequence must be a non-negative safe integer");
    }
    return readKernelStream(this.database, streamId, afterSequence);
  }

  get(eventId: string): StoredKernelEvent | undefined {
    assertNonBlank("event id", eventId);
    return this.findById(eventId);
  }

  verifyStream(streamId: string): { valid: boolean; eventCount: number; brokenSequence?: number } {
    const events = this.readStream(streamId);
    let previous: string | null = null;
    for (const event of events) {
      if (
        event.previousEventSha256 !== previous ||
        hashEvent(baseEvent(event), previous) !== event.eventSha256
      ) {
        return { valid: false, eventCount: events.length, brokenSequence: event.sequence };
      }
      previous = event.eventSha256;
    }
    return { valid: true, eventCount: events.length };
  }

  close(): void {
    if (this.ownsDatabase) this.database.close();
  }

  private findById(eventId: string): StoredKernelEvent | undefined {
    const row = this.database
      .prepare("SELECT * FROM kernel_events WHERE event_id = ?")
      .get(eventId) as unknown as EventRow | undefined;
    return row ? rowToEvent(row) : undefined;
  }
}

export function ensureKernelEventSchema(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS kernel_events (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL UNIQUE,
      stream_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      schema_version INTEGER NOT NULL,
      occurred_at TEXT NOT NULL,
      producer_plane_id TEXT NOT NULL,
      payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
      previous_event_sha256 TEXT,
      event_sha256 TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS kernel_events_stream_sequence
      ON kernel_events(stream_id, sequence);
  `);
}

export function appendKernelEventInTransaction<T extends KernelEvent>(
  database: DatabaseSync,
  event: T,
): AppendResult<T> {
  validateEvent(event);
  if (!database.isTransaction) {
    throw new Error("kernel event append requires an active authority transaction");
  }
  const existing = findById(database, event.eventId);
  if (existing) {
    if (canonicalJson(eventIdentity(baseEvent(existing))) !== canonicalJson(eventIdentity(event))) {
      throw new Error(`event id collision: ${event.eventId}`);
    }
    return { appended: false, event: existing as StoredKernelEvent<T["type"], T["payload"]> };
  }
  const prior = database
    .prepare(
      `SELECT event_sha256 FROM kernel_events
       WHERE stream_id = ? ORDER BY sequence DESC LIMIT 1`,
    )
    .get(event.streamId) as { event_sha256: string } | undefined;
  const previousEventSha256 = prior?.event_sha256 ?? null;
  const eventSha256 = hashEvent(event, previousEventSha256);
  database
    .prepare(
      `INSERT INTO kernel_events
         (event_id, stream_id, event_type, schema_version, occurred_at,
          producer_plane_id, payload_json, previous_event_sha256, event_sha256)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      event.eventId,
      event.streamId,
      event.type,
      event.schemaVersion,
      event.occurredAt,
      event.producerPlaneId,
      canonicalJson(event.payload),
      previousEventSha256,
      eventSha256,
    );
  const stored = findById(database, event.eventId);
  if (!stored) throw new Error("event disappeared after append");
  return { appended: true, event: stored as StoredKernelEvent<T["type"], T["payload"]> };
}

export function readKernelStream(
  database: DatabaseSync,
  streamId: string,
  afterSequence = 0,
): StoredKernelEvent[] {
  assertNonBlank("stream id", streamId);
  if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
    throw new Error("after sequence must be a non-negative safe integer");
  }
  const rows = database
    .prepare(
      `SELECT * FROM kernel_events
       WHERE stream_id = ? AND sequence > ? ORDER BY sequence ASC`,
    )
    .all(streamId, afterSequence) as unknown as EventRow[];
  return rows.map(rowToEvent);
}

function findById(database: DatabaseSync, eventId: string): StoredKernelEvent | undefined {
  const row = database
    .prepare("SELECT * FROM kernel_events WHERE event_id = ?")
    .get(eventId) as unknown as EventRow | undefined;
  return row ? rowToEvent(row) : undefined;
}

function validateEvent(event: KernelEvent): void {
  assertNonBlank("event id", event.eventId);
  assertNonBlank("stream id", event.streamId);
  assertNonBlank("event type", event.type);
  assertNonBlank("producer plane id", event.producerPlaneId);
  assertIsoDate("event occurrence", event.occurredAt);
  if (event.schemaVersion !== 1) throw new Error("unsupported event schema version");
  canonicalJson(event.payload);
}

function hashEvent(event: KernelEvent, previousEventSha256: string | null): string {
  return sha256Canonical({ event, previousEventSha256 });
}

function eventIdentity(event: KernelEvent): Omit<KernelEvent, "occurredAt"> {
  return {
    eventId: event.eventId,
    streamId: event.streamId,
    type: event.type,
    schemaVersion: event.schemaVersion,
    producerPlaneId: event.producerPlaneId,
    payload: event.payload,
  };
}

function baseEvent(event: StoredKernelEvent): KernelEvent {
  return {
    eventId: event.eventId,
    streamId: event.streamId,
    type: event.type,
    schemaVersion: event.schemaVersion,
    occurredAt: event.occurredAt,
    producerPlaneId: event.producerPlaneId,
    payload: event.payload,
  };
}

function rowToEvent(row: EventRow): StoredKernelEvent {
  return {
    sequence: Number(row.sequence),
    eventId: row.event_id,
    streamId: row.stream_id,
    type: row.event_type,
    schemaVersion: 1,
    occurredAt: row.occurred_at,
    producerPlaneId: row.producer_plane_id,
    payload: JSON.parse(row.payload_json) as unknown,
    previousEventSha256: row.previous_event_sha256,
    eventSha256: row.event_sha256,
  };
}
