import path from "node:path";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { canonicalSha256, SqliteEventStore } from "../../bio-core/src/index.ts";
import { InvestigationLedger, validateInput, type NotebookRecord } from "../../bio-ledger/src/index.ts";
import type { PipelineDependencies, PriorRecord } from "../../bio-pipeline/src/index.ts";
import { privateDirectory, privateFile } from "./paths.ts";

export const normalizeKey = (value: string): string => value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
export interface NotebookKeys { manifestHash: string; accessions: string[]; hypothesisKeys: string[]; entityKeys?: string[] }
interface Entry { investigationId: string; sourceFile: string; keys: NotebookKeys; records: PriorRecord[]; sourceSequence: number }
const stream = "bio-host:shared-notebook";

/** The immutable event payload IS the index. No mutable secondary table can hide a negative. */
export class NotebookIndex {
  private db: DatabaseSync;
  private events: SqliteEventStore;
  private now: () => number;
  constructor(file: string, now: () => number) {
    privateDirectory(path.dirname(file)); privateFile(file);
    this.db = new DatabaseSync(file);
    this.events = new SqliteEventStore(this.db);
    this.db.exec("PRAGMA synchronous=FULL; PRAGMA busy_timeout=25");
    this.now = now;
    try { this.entries(); } catch (e) { this.close(); throw e; }
  }
  private entries(): Entry[] {
    if (!this.events.verifyStream(stream).valid) throw new Error("shared notebook hash chain invalid");
    return this.events.readStream(stream).flatMap(event => {
      if (event.type === "notebook-pending") {
        const pending = event.payload as { investigationId: string; sourceFile: string };
        if (typeof pending.investigationId !== "string" || typeof pending.sourceFile !== "string" || !path.isAbsolute(pending.sourceFile)) throw new Error("invalid pending notebook");
        return [];
      }
      const entry = event.payload as Entry;
      if (event.type !== "notebook-snapshot" || !entry.investigationId || typeof entry.sourceFile !== "string" || !path.isAbsolute(entry.sourceFile) || !Number.isSafeInteger(entry.sourceSequence)) throw new Error("invalid notebook entry");
      checkedKeys(entry.keys);
      for (const item of entry.records) {
        const r = item.record;
        validateInput({ kind: r.payload.kind, data: r.payload.data, parents: r.payload.parents } as Parameters<typeof validateInput>[0]);
        if (item.investigationId !== entry.investigationId || canonicalSha256(r.payload) !== r.id || !["refuted", "contradicted", "other"].includes(item.status)) throw new Error("invalid indexed record");
      }
      return [entry];
    });
  }
  /** Register before execution. A host crash before publication blocks complete
   * queries until this investigation is reopened and its notebook is published. */
  begin(investigationId: string, sourceFile: string): void {
    const expectedSequence = this.events.readStream(stream).at(-1)?.sequence ?? 0;
    this.entries();
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(investigationId)) throw new Error("invalid investigation id");
    privateFile(sourceFile);
    this.checkIdentity(investigationId, sourceFile);
    this.events.append({ eventId: randomUUID(), streamId: stream, type: "notebook-pending", schemaVersion: 1,
      occurredAt: new Date(this.now()).toISOString(), producerPlaneId: "bio-host", payload: { investigationId, sourceFile } }, expectedSequence);
  }
  private checkIdentity(investigationId: string, sourceFile: string): void {
    if (this.events.readStream(stream).some(e => {
      const p = e.payload as { investigationId: string; sourceFile: string };
      return p.investigationId === investigationId && p.sourceFile !== sourceFile;
    })) throw new Error("investigation id already belongs to another source notebook");
  }
  /** Read a verified source notebook, never model-supplied status or a caller's snapshot. */
  publish(input: { ledgerFile: string; investigationId: string; keys: NotebookKeys }): void {
    privateFile(input.ledgerFile);
    if (!existsSync(input.ledgerFile)) throw new Error("source notebook missing");
    const source = new InvestigationLedger(input.ledgerFile, input.investigationId, { now: this.now });
    try {
      if (!source.verify().valid) throw new Error("source notebook invalid");
      const snapshot = source.snapshot();
      if (!snapshot.sequence) throw new Error("source notebook missing");
      const records = snapshot.records.map(record => {
        const status = record.payload.kind === "interpretation" ? source.claimStatus(record.id) : "other";
        return { investigationId: input.investigationId, record, status: status === "contradicted" || status === "refuted" ? status : "other" } satisfies PriorRecord;
      });
      if (source.snapshot().sequence !== snapshot.sequence) throw new Error("source notebook changed during publication; retry a coherent snapshot");
      const entry: Entry = { investigationId: input.investigationId, sourceFile: input.ledgerFile, keys: checkedKeys(input.keys), records, sourceSequence: snapshot.sequence };
      const expectedSequence = this.events.readStream(stream).at(-1)?.sequence ?? 0;
      const old = this.entries().filter(e => e.investigationId === input.investigationId).at(-1);
      this.checkIdentity(input.investigationId, input.ledgerFile);
      if (old && (old.sourceSequence > entry.sourceSequence || old.records.some(r => !records.some(n => n.record.id === r.record.id)))) throw new Error("notebook history rollback refused");
      const lastForSource = this.events.readStream(stream).filter(e => (e.payload as { investigationId: string }).investigationId === input.investigationId).at(-1);
      if (old && canonicalSha256(old) === canonicalSha256(entry) && lastForSource?.type === "notebook-snapshot") return;
      this.events.append({ eventId: canonicalSha256({ entry, after: expectedSequence }), streamId: stream, type: "notebook-snapshot", schemaVersion: 1,
        occurredAt: new Date(this.now()).toISOString(), producerPlaneId: "bio-host", payload: entry }, expectedSequence);
    } finally { source.close(); }
  }
  /** Retryable admission check, made under the shared host lock before any work. */
  assertAvailable(excludeInvestigation?: string): void {
    this.entries();
    const pending = new Map<string, boolean>();
    for (const event of this.events.readStream(stream)) pending.set((event.payload as { investigationId: string }).investigationId, event.type === "notebook-pending");
    if ([...pending].some(([id, incomplete]) => id !== excludeInvestigation && incomplete)) throw new Error("shared notebook incomplete: investigation awaiting publication");
  }
  query(keys: NotebookKeys, excludeInvestigation?: string): ReturnType<PipelineDependencies["priorRecords"]> {
    const wanted = checkedKeys(keys);
    const latest = new Map<string, Entry>();
    for (const entry of this.entries()) latest.set(entry.investigationId, entry);
    this.assertAvailable(excludeInvestigation);
    const match = (a: string[], b: string[]) => a.some(key => b.includes(key));
    const records = new Map<string, PriorRecord>();
    for (const entry of latest.values()) {
      if (entry.investigationId === excludeInvestigation) continue;
      if (entry.keys.manifestHash !== wanted.manifestHash && !match(entry.keys.accessions, wanted.accessions) &&
        !match([...entry.keys.hypothesisKeys, ...entry.keys.entityKeys ?? []], [...wanted.hypothesisKeys, ...wanted.entityKeys ?? []])) continue;
      for (const item of entry.records) {
        const old = records.get(item.record.id);
        if (old && old.investigationId !== item.investigationId) throw new Error("ambiguous cross-notebook record identity");
        records.set(item.record.id, item);
      }
    }
    return { complete: true, records: [...records.values()].sort((a, b) => a.record.id.localeCompare(b.record.id)) };
  }
  close(): void { this.db.close(); }
}

function checkedKeys(keys: NotebookKeys): NotebookKeys {
  if (!keys || !/^[a-f0-9]{64}$/.test(keys.manifestHash)) throw new Error("invalid notebook manifest key");
  const list = (values: string[]) => {
    if (!Array.isArray(values) || values.some(s => typeof s !== "string" || !s.trim())) throw new Error("invalid notebook keys");
    return [...new Set(values.map(normalizeKey))].sort();
  };
  return { manifestHash: keys.manifestHash, accessions: list(keys.accessions), hypothesisKeys: list(keys.hypothesisKeys), entityKeys: list(keys.entityKeys ?? []) };
}

export function hypothesisKeys(records: readonly NotebookRecord[]): string[] {
  return records.flatMap(r => r.payload.kind === "hypothesis" ? [normalizeKey(r.payload.data.text)] : []);
}
