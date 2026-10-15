// Adapted from Amani L/packages/harness/src/mission-repair-session.ts (7a72c0ad). Amani continued a worker's session
// across repair rounds of one requirement; Bio continues an analyst's session across turns on one investigation or
// hypothesis, caps how many times one session is resumed, and falls back to a fresh session seeded with the
// caller's digest of the notebook when the cap is reached or the session is gone. See PROVENANCE.md.
import { createHash } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from "node:fs";
import path from "node:path";

import { canonicalJson, cleanupEvidence } from "./core.ts";
import { ClaudeResumeUnavailableError, type RunnerClient, type WorkerTurnInput, type WorkerTurnResult } from "./claude-worker.ts";

/** Sessions are keyed by investigation and, optionally, hypothesis. */
export interface SessionKey { investigationId: string; hypothesisId: string | null }

/**
 * Host-only: the session id comes from the host's own runner observation (Claude Code's stream), never from model
 * output. `resumes` counts how many turns continued this session after the one that created it.
 */
export interface SessionRecord {
  key: SessionKey;
  sessionId: string;
  model: string;
  resumes: number;
  createdAt: number;
  updatedAt: number;
}

export interface SessionStore {
  get(key: SessionKey): SessionRecord | undefined;
  put(record: SessionRecord): void;
}

export type FreshReason = "no-session" | "resume-cap" | "resume-unavailable" | "model-changed";

export interface SessionTurnInput extends Omit<WorkerTurnInput, "resumeThreadId"> {
  key: SessionKey;
  /** Resumes allowed per session before the next turn starts fresh. 0 = every turn is fresh. */
  maxResumes: number;
  /**
   * The caller's compiled notebook digest (question, live hypotheses, decisions, every negative result). Required and
   * non-blank: every fresh session is seeded with it, so a lost or capped session never loses what was learned.
   */
  digest: string;
}

export interface SessionTurnResult {
  result: WorkerTurnResult;
  start: "resumed" | "fresh";
  freshReason: FreshReason | null;
  /** The session that could not be resumed, when the fallback ran. */
  abandonedSessionId: string | null;
  sessionId: string;
  resumes: number;
  digestSha256: string;
}

export const MAX_DIGEST_CHARS = 64 * 1024;

export function sessionKeyId(key: SessionKey): string {
  assertSessionKey(key);
  return canonicalJson([key.investigationId, key.hypothesisId]);
}

export function assertSessionKey(key: SessionKey): void {
  const ok = (value: unknown) => typeof value === "string" && value.trim().length > 0 && value.length <= 200 && !value.includes("\0");
  if (typeof key !== "object" || key === null || !ok(key.investigationId) || !(key.hypothesisId === null || ok(key.hypothesisId))
    || Object.keys(key).sort().join(",") !== "hypothesisId,investigationId") {
    throw new Error("session key needs an investigation id and a hypothesis id or null");
  }
}

/** One analyst turn on a keyed session: resume within the cap, otherwise (or when the session is gone) start fresh
 * from the digest. A resumed turn that ran and then failed is rethrown: the host must not quietly start over. */
export async function runSessionTurn(client: RunnerClient, store: SessionStore, input: SessionTurnInput, now: () => number): Promise<SessionTurnResult> {
  assertSessionKey(input.key);
  if (!Number.isSafeInteger(input.maxResumes) || input.maxResumes < 0) throw new Error("resume cap must be a non-negative integer");
  if (typeof input.digest !== "string" || !input.digest.trim()) throw new Error("a session turn needs the investigation digest to seed a fresh session");
  if (input.digest.length > MAX_DIGEST_CHARS) throw new Error(`digest exceeds ${MAX_DIGEST_CHARS} characters; split it rather than truncate`);
  const digestSha256 = createHash("sha256").update(input.digest).digest("hex");
  const { key, maxResumes, digest, ...turn } = input;
  const record = store.get(key);
  let freshReason: FreshReason = "no-session";
  let abandonedSessionId: string | null = null;
  if (record) {
    if (record.model !== input.model) freshReason = "model-changed";
    else if (record.resumes >= maxResumes) freshReason = "resume-cap";
    else {
      try {
        const result = await client.execute({ ...turn, prompt: resumePrompt(input.prompt), resumeThreadId: record.sessionId });
        const resumes = record.resumes + 1;
        store.put({ ...record, sessionId: result.sessionId, resumes, updatedAt: now() });
        return { result, start: "resumed", freshReason: null, abandonedSessionId: null, sessionId: result.sessionId, resumes, digestSha256 };
      } catch (error) {
        if (!(error instanceof ClaudeResumeUnavailableError) || cleanupEvidence(error) === "unproven") throw error;
        freshReason = "resume-unavailable";
        abandonedSessionId = record.sessionId;
      }
    }
    if (abandonedSessionId === null) abandonedSessionId = record.sessionId;
  }
  const result = await client.execute({ ...turn, prompt: freshPrompt(digest, input.prompt) });
  const at = now();
  store.put({ key, sessionId: result.sessionId, model: input.model, resumes: 0, createdAt: at, updatedAt: at });
  return { result, start: "fresh", freshReason, abandonedSessionId, sessionId: result.sessionId, resumes: 0, digestSha256 };
}

/** The resumed turn's prompt: the brief below supersedes anything earlier in the session. */
export function resumePrompt(brief: string): string {
  return `You are continuing your own earlier session on this investigation. Use what you learned earlier in this session, but follow the brief below, which supersedes any earlier one. The host's notebook, not your memory, is the record: re-read any file before you rely on it.

${brief}`;
}

/** A fresh session's prompt: the host's digest first, then the brief. */
export function freshPrompt(digest: string, brief: string): string {
  return `You are starting a new session on an investigation that is already under way. The host's notebook digest below is the record of what has been done; do not repeat an analysis it lists as refuted, contradicted, aborted or insufficient unless the brief asks you to.

<notebook-digest>
${digest}
</notebook-digest>

${brief}`;
}

export class MemorySessionStore implements SessionStore {
  readonly #records = new Map<string, SessionRecord>();
  get(key: SessionKey): SessionRecord | undefined {
    const record = this.#records.get(sessionKeyId(key));
    return record ? structuredClone(record) : undefined;
  }
  put(record: SessionRecord): void {
    assertRecord(record);
    this.#records.set(sessionKeyId(record.key), structuredClone(record));
  }
}

/**
 * Sessions in one JSON file, replaced atomically (write, fsync, rename). A missing file is an empty store (the digest
 * fallback covers it); a file that does not parse is refused, never silently treated as empty.
 */
export class FileSessionStore implements SessionStore {
  readonly #file: string;
  constructor(file: string) {
    if (!path.isAbsolute(file)) throw new Error("session store path must be absolute");
    this.#file = file;
  }
  get(key: SessionKey): SessionRecord | undefined {
    return this.#load()[sessionKeyId(key)];
  }
  put(record: SessionRecord): void {
    assertRecord(record);
    const records = this.#load();
    records[sessionKeyId(record.key)] = record;
    mkdirSync(path.dirname(this.#file), { recursive: true, mode: 0o700 });
    const temporary = `${this.#file}.${process.pid}.tmp`;
    const fd = openSync(temporary, "w", 0o600);
    try { writeSync(fd, `${JSON.stringify({ schema: 1, records }, null, 2)}\n`); fsyncSync(fd); }
    finally { closeSync(fd); }
    renameSync(temporary, this.#file);
  }
  #load(): Record<string, SessionRecord> {
    if (!existsSync(this.#file)) return {};
    let value: unknown;
    try { value = JSON.parse(readFileSync(this.#file, "utf8")); } catch { throw new Error(`session store is unreadable: ${this.#file}`); }
    const store = value as { schema?: unknown; records?: unknown };
    if (typeof store !== "object" || store === null || store.schema !== 1 || typeof store.records !== "object" || store.records === null || Array.isArray(store.records)) {
      throw new Error(`session store is outside the format: ${this.#file}`);
    }
    const records = store.records as Record<string, SessionRecord>;
    for (const [id, record] of Object.entries(records)) {
      assertRecord(record);
      if (sessionKeyId(record.key) !== id) throw new Error(`session store is outside the format: ${this.#file}`);
    }
    return records;
  }
}

function assertRecord(record: SessionRecord): void {
  assertSessionKey(record.key);
  if (typeof record.sessionId !== "string" || !record.sessionId.trim() || typeof record.model !== "string"
    || !Number.isSafeInteger(record.resumes) || record.resumes < 0
    || !Number.isFinite(record.createdAt) || !Number.isFinite(record.updatedAt)) {
    throw new Error("session record is outside the format");
  }
}
