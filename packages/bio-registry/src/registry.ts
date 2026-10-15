import { DatabaseSync } from "node:sqlite";
import { canonicalSha256, SqliteEventStore } from "../../bio-core/src/index.ts";
import { MERKLE_SCHEME, merkleRoot, type RegistryCommitment } from "./commitment.ts";
import { copy, definition, fail, freeze, hash, object, text, timestamp, validatePrediction, validateResolution,
  type PredictionInput, type PredictionPayload, type PredictionRecord, type RegistryRecord,
  type ResolutionInput, type ResolutionPayload, type ResolutionRecord } from "./records.ts";
import { brierScore, calibrationTable, logScore, type CalibrationBin } from "./scoring.ts";

export interface RegistryOptions {
  readonly now: () => number;
  /** Exact persistence boundaries for deterministic fault/concurrency tests. */
  readonly faultAt?: (point: "before-append" | "after-append") => void;
}
export interface ScoredPrediction {
  readonly prediction: PredictionRecord;
  readonly resolution: ResolutionRecord;
  readonly brierScore: number;
  readonly logScore: number;
}
export interface RegistryReport {
  readonly asOf: number;
  readonly scored: readonly ScoredPrediction[];
  readonly unresolved: readonly PredictionRecord[];
  readonly pastDue: readonly PredictionRecord[];
  /** Retained for audit, but ineligible once a recorded resolution establishes they were late. */
  readonly refusedPostResolution: readonly PredictionRecord[];
  readonly calibration: readonly CalibrationBin[];
}
interface State {
  records: RegistryRecord[];
  predictions: PredictionRecord[];
  resolutions: ResolutionRecord[];
  sequence: number;
  lastAt: number;
  chainHead: string | null;
}
function initial(): State {
  return { records: [], predictions: [], resolutions: [], sequence: 0, lastAt: -1, chainHead: null };
}

/** Replay validates semantic history as well as cryptographic identity. */
function apply(state: State, record: RegistryRecord, at: number): void {
  object(record, ["id", "payload"]); hash(record.id);
  if (canonicalSha256(record.payload) !== record.id) fail("record hash mismatch");
  timestamp(at);
  if (at < state.lastAt) fail("backwards chain timestamp");
  if (state.records.some(old => old.id === record.id)) fail("duplicate record in chain");
  if (record.payload?.kind === "prediction") {
    const p = record.payload;
    validatePrediction(p, true);
    if (p.createdAt !== at) fail("prediction timestamp differs from chain timestamp");
    if (p.createdAt >= p.expectedResolutionDate) fail("prediction must precede expected resolution date");
    if (state.resolutions.some(r => r.payload.eventId === p.eventId)) fail("event already resolved");
    const first = state.predictions.find(r => r.payload.eventId === p.eventId);
    if (first && canonicalSha256(definition(first.payload)) !== canonicalSha256(definition(p))) {
      fail("event definition cannot change");
    }
    if (p.supersedes !== undefined) {
      const previous = state.predictions.find(r => r.id === p.supersedes);
      if (!previous || previous.payload.eventId !== p.eventId) fail("supersedes must reference a prior prediction of this event");
    }
    state.predictions.push(record as PredictionRecord);
  } else if (record.payload?.kind === "resolution") {
    const r = record.payload;
    validateResolution(r, true);
    if (r.recordedAt !== at) fail("resolution timestamp differs from chain timestamp");
    if (r.resolvedAt > r.recordedAt) fail("resolution cannot be in the future");
    const predictions = state.predictions.filter(p => p.payload.eventId === r.eventId);
    if (!predictions.length) fail("resolution requires a registered event");
    if (state.resolutions.some(old => old.payload.eventId === r.eventId)) fail("event already resolved");
    // A late forecast cannot veto reality or prevent earlier forecasts from being scored.
    // Queries classify it as refused once this resolution is known at their cutoff.
    if (predictions[0]!.payload.resolutionSource !== r.source) fail("resolution source differs from registered source");
    state.resolutions.push(record as ResolutionRecord);
  } else fail("unknown registry record kind");
  state.records.push(record);
  state.lastAt = at;
}

/** Trusted host API: keep the database and clock outside the generator's write scope. */
export class PredictionRegistry {
  readonly streamId: string;
  private readonly db: DatabaseSync;
  private readonly events: SqliteEventStore;
  private closed = false;

  constructor(path: string, registryId: string, private readonly options: RegistryOptions) {
    text(path);
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(registryId)) fail("invalid registry id");
    if (typeof options.now !== "function") fail("injected clock required");
    this.streamId = `bio-registry:${registryId}`;
    this.db = new DatabaseSync(path);
    try {
      this.events = new SqliteEventStore(this.db);
      this.db.exec("PRAGMA synchronous = FULL");
      this.db.exec("PRAGMA busy_timeout = 25");
      this.read();
    } catch (error) { this.db.close(); throw error; }
  }

  predict(input: PredictionInput): PredictionRecord {
    validatePrediction(input);
    const value = copy(input), state = this.read(), at = this.clock(state);
    const payload: PredictionPayload = { ...value, kind: "prediction", createdAt: at };
    return this.append(state, payload, at) as PredictionRecord;
  }

  resolve(input: ResolutionInput): ResolutionRecord {
    validateResolution(input);
    const value = copy(input), state = this.read(), at = this.clock(state);
    const payload: ResolutionPayload = { ...value, kind: "resolution", recordedAt: at };
    return this.append(state, payload, at) as ResolutionRecord;
  }

  records(): readonly RegistryRecord[] { return copy(this.read().records); }

  /** Includes every eligible revision using resolutions known by the cutoff; verifies the entire chain. */
  asOf(date: number): readonly PredictionRecord[] {
    timestamp(date);
    const state = this.read();
    const resolutions = new Map(state.resolutions.filter(r => r.payload.recordedAt <= date).map(r => [r.payload.eventId, r]));
    return copy(state.predictions.filter(record => {
      const resolution = resolutions.get(record.payload.eventId);
      return record.payload.createdAt <= date && (!resolution || record.payload.createdAt <= resolution.payload.resolvedAt);
    }));
  }

  report(asOf = this.options.now(), bins = 10): RegistryReport {
    timestamp(asOf);
    const state = this.read();
    const resolutions = new Map(state.resolutions.filter(r => r.payload.recordedAt <= asOf).map(r => [r.payload.eventId, r]));
    const scored: ScoredPrediction[] = [], unresolved: PredictionRecord[] = [], refusedPostResolution: PredictionRecord[] = [];
    for (const prediction of state.predictions.filter(p => p.payload.createdAt <= asOf)) {
      const resolution = resolutions.get(prediction.payload.eventId);
      if (!resolution) unresolved.push(prediction);
      else if (prediction.payload.createdAt > resolution.payload.resolvedAt) refusedPostResolution.push(prediction);
      else scored.push({ prediction, resolution,
        brierScore: brierScore(prediction.payload.probability, resolution.payload.outcome),
        logScore: logScore(prediction.payload.probability, resolution.payload.outcome) });
    }
    // Scores may contain Infinity, so freeze directly rather than canonical-JSON cloning.
    return freeze({ asOf, scored, unresolved, refusedPostResolution, pastDue: unresolved.filter(p => p.payload.expectedResolutionDate < asOf),
      calibration: calibrationTable(scored.map(row => ({ probability: row.prediction.payload.probability, outcome: row.resolution.payload.outcome })), bins) });
  }

  /** Both prediction and resolution hashes, in journal order, with no clock-dependent fields. */
  exportCommitment(): RegistryCommitment {
    const state = this.read(), recordHashes = state.records.map(record => record.id);
    return copy({ scheme: MERKLE_SCHEME, streamId: this.streamId, recordCount: recordHashes.length,
      recordHashes, merkleRoot: merkleRoot(recordHashes), chainHead: state.chainHead });
  }

  verify(): { readonly valid: true; readonly recordCount: number } | { readonly valid: false; readonly reason: string } {
    try { return { valid: true, recordCount: this.read().records.length }; }
    catch (error) { return { valid: false, reason: error instanceof Error ? error.message : "registry unavailable" }; }
  }

  close(): void { if (!this.closed) { this.db.close(); this.closed = true; } }

  private clock(state: State): number {
    const at = this.options.now(); timestamp(at);
    if (at < state.lastAt) fail("invalid or backwards clock");
    return at;
  }

  private append(state: State, payload: PredictionPayload | ResolutionPayload, at: number): RegistryRecord {
    const record = copy({ id: canonicalSha256(payload), payload });
    apply(state, record, at);
    this.options.faultAt?.("before-append");
    this.events.append({ eventId: `${this.streamId}:${record.id}`, streamId: this.streamId,
      type: `registry.${payload.kind}`, schemaVersion: 1, occurredAt: new Date(at).toISOString(),
      producerPlaneId: "bio-registry", payload: record }, state.sequence);
    this.options.faultAt?.("after-append");
    return record;
  }

  private read(): State {
    // Pin validation and replay to one SQLite snapshot. Core normalizes schema_version on read,
    // so inspect the raw column as well to avoid blessing an unsupported schema.
    this.db.exec("BEGIN");
    try {
      const rows = this.events.readStream(this.streamId);
      if (!this.events.verifyStream(this.streamId).valid) fail("corrupt registry hash chain");
      if (this.db.prepare("SELECT 1 FROM kernel_events WHERE stream_id = ? AND schema_version != 1 LIMIT 1").get(this.streamId)) {
        fail("unsupported registry schema version");
      }
      const state = initial();
      for (const event of rows) {
        const record = event.payload as RegistryRecord;
        object(record, ["id", "payload"]);
        if (event.producerPlaneId !== "bio-registry" || event.eventId !== `${this.streamId}:${record.id}` ||
            event.type !== `registry.${record.payload?.kind}`) fail("unexpected registry event");
        const at = Date.parse(event.occurredAt); timestamp(at);
        if (new Date(at).toISOString() !== event.occurredAt || event.sequence <= state.sequence) fail("invalid chain order");
        apply(state, record, at);
        state.sequence = event.sequence;
        state.chainHead = event.eventSha256;
      }
      this.db.exec("COMMIT");
      return state;
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
}
