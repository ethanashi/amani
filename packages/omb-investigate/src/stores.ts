import { BriefLedger } from '../../omb-literature/src/brief.ts';
// Journal-backed stand-ins for the V5 store ports, so V7 runs end to end before V5 merges:
// - JournalRegistry: the program-wide hypothesis registry (G6 "kth hypothesis on this manifest");
// - JournalLedger: plan locks, code freezes and the look ledger, each recorded durably before it
//   returns; a sealed (route H) partition burns after its first look.
// Both live in the orchestrator's single-writer journal, which a worker sharing the UID could roll
// back, so they are degraded-mode stores: Confirmed still REQUIRES V5's _ombcert-owned store and
// OS-user separation (the investigation caps every label at Tentative without it).

import { createHmac } from "node:crypto";
import { canonicalJson } from "../../bio-core/src/index.ts";
import { JournalConflict, type Journal, type JournalEvent } from "./journal.ts";
import type {
  ContentTuple, HypothesisRegistryPort, LockLedgerPort, LockReceipt, LookRecord, LookRequest, LordSettings, PlanLockRequest, RegistryDecision, RegistryEntry,
} from "./ports.ts";
import { toJson } from "./machine.ts";
import type { Json, JsonObject } from "./types.ts";

/**
 * Read, decide and append under one view of the stream: the append pins the length that was read,
 * and a JournalConflict (a foreign writer appended meanwhile) re-runs the whole decision on the
 * fresh head. A registration or look another writer made in between is found, never duplicated.
 */
type Decision<T> =
  | { kind: "done"; result: T }
  | { kind: "append"; type: string; payload: Json; result: (event: JournalEvent) => T };

function decideAndAppend<T>(journal: Journal, stream: string, decide: (events: JournalEvent[]) => Decision<T>): T {
  for (let attempt = 0; ; attempt++) {
    const check = journal.verify(stream);
    if (!check.valid) throw new Error(`${stream} chain is broken`);
    const events = journal.read(stream);
    const d = decide(events);
    if (d.kind === "done") return d.result;
    try {
      return d.result(journal.append(stream, d.type, d.payload, events.length));
    } catch (e) {
      if (!(e instanceof JournalConflict) || attempt >= 8) throw e;
    }
  }
}

/** Validates a software LORD++ decision before it can earn wealth. */
export function checkDecision(d: RegistryDecision): RegistryDecision {
  const prob = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;
  const prior = d.priorRejectionOrdinals;
  if (!d.manifest || !Number.isSafeInteger(d.ordinal) || d.ordinal < 1 || typeof d.rejected !== "boolean" || !prob(d.p) || !prob(d.threshold) || d.rejected !== (d.p <= d.threshold) || !d.investigationId || !d.claimId
    || !Array.isArray(prior) || prior.some((o, i) => !Number.isSafeInteger(o) || o < 1 || o >= d.ordinal || (i > 0 && o <= prior[i - 1]!))) {
    throw new TypeError("invalid LORD++ decision");
  }
  return { manifest: d.manifest, ordinal: d.ordinal, rejected: d.rejected, p: d.p, threshold: d.threshold, priorRejectionOrdinals: [...prior], investigationId: d.investigationId, claimId: d.claimId };
}

export class JournalRegistry implements HypothesisRegistryPort {
  readonly #lord: LordSettings;
  constructor(private readonly journal: Journal, readonly stream = "registry", lord: LordSettings = { alpha: 0.05, w0: 0.025 }) {
    if (!(lord.alpha > 0 && lord.alpha <= 0.05) || !(lord.w0 > 0 && lord.w0 <= lord.alpha)) throw new TypeError("LORD++ settings need 0 < w0 <= alpha <= 0.05");
    this.#lord = { ...lord };
  }

  lordSettings(): LordSettings { return { ...this.#lord }; }

  decisions(manifest: string): RegistryDecision[] {
    return this.journal.read(this.stream).filter((e) => e.type === "hypothesis-decided" && (e.payload as JsonObject).manifest === manifest)
      .map((e) => checkDecision(e.payload as unknown as RegistryDecision));
  }

  recordDecision(decision: RegistryDecision): { first: boolean; decision: RegistryDecision } {
    const d = checkDecision(decision);
    return decideAndAppend<{ first: boolean; decision: RegistryDecision }>(this.journal, this.stream, (events) => {
      if (!events.some((e) => e.type === "hypothesis-registered" && (e.payload as JsonObject).manifest === d.manifest && Number((e.payload as JsonObject).ordinal) === d.ordinal)) throw new Error("decision on an unregistered hypothesis ordinal");
      const prior = events.find((e) => e.type === "hypothesis-decided" && (e.payload as JsonObject).manifest === d.manifest && Number((e.payload as JsonObject).ordinal) === d.ordinal);
      if (prior) return { kind: "done", result: { first: false, decision: checkDecision(prior.payload as unknown as RegistryDecision) } };
      return { kind: "append", type: "hypothesis-decided", payload: toJson(d), result: () => ({ first: true, decision: d }) };
    });
  }

  entries(manifest?: string): RegistryEntry[] {
    const out: RegistryEntry[] = [];
    for (const e of this.journal.read(this.stream)) {
      if (e.type !== "hypothesis-registered") continue;
      const p = e.payload as JsonObject;
      const entry = { manifest: String(p.manifest), fingerprint: String(p.fingerprint), ordinal: Number(p.ordinal), source: p.source ?? null };
      if (manifest === undefined || entry.manifest === manifest) out.push(entry);
    }
    return out;
  }

  ordinal(manifest: string, fingerprint: string): number | null {
    return this.entries(manifest).find((e) => e.fingerprint === fingerprint)?.ordinal ?? null;
  }

  count(manifest: string): number {
    return this.entries(manifest).length;
  }

  register(entry: { manifest: string; fingerprint: string; source: Json }): { ordinal: number; first: boolean } {
    if (!/^[a-f0-9]{64}$/.test(entry.fingerprint) || !entry.manifest) throw new TypeError("registry entries need a manifest and a sha256 fingerprint");
    return decideAndAppend<{ ordinal: number; first: boolean }>(this.journal, this.stream, (events) => {
      const onManifest = events.filter((e) => e.type === "hypothesis-registered" && (e.payload as JsonObject).manifest === entry.manifest);
      const existing = onManifest.find((e) => (e.payload as JsonObject).fingerprint === entry.fingerprint);
      if (existing) return { kind: "done", result: { ordinal: Number((existing.payload as JsonObject).ordinal), first: false } };
      const ordinal = onManifest.length + 1;
      return { kind: "append", type: "hypothesis-registered", payload: { manifest: entry.manifest, fingerprint: entry.fingerprint, ordinal, source: toJson(entry.source) }, result: () => ({ ordinal, first: true }) };
    });
  }
}

export class JournalLedger implements LockLedgerPort {
  readonly #key: Buffer;
  constructor(private readonly journal: Journal, hostKey: Uint8Array, readonly stream = "ledger") {
    if (hostKey.byteLength < 32) throw new Error("ledger host key must have at least 256 bits");
    this.#key = Buffer.from(hostKey);
  }

  async authorizeReplan(request: { investigationId: string; id: string; reason: string; scope?: "plan" | "plan-lock" | "code" | "dry-run" }): Promise<LockReceipt> {
    if (!request.reason.trim()) throw new Error("Replanning requires an infeasibility reason");
    return decideAndAppend(this.journal, this.stream, events => {
      const own = events.filter(e => (e.payload as JsonObject).investigationId === request.investigationId);
      if (own.some(e => e.type === "look-recorded" || e.type === "literature-look-started" || e.type === "code-frozen")) throw new Error("Cannot replan after freeze or look");
      const prior = own.find(e => e.type === "plan-replan-authorized" && (e.payload as JsonObject).id === request.id);
      if (prior) return { kind: "done", result: { sequence: prior.seq, hash: prior.hash } };
      if (request.scope !== "plan" && !own.some(e => e.type === "plan-locked")) throw new Error("No locked plan to amend");
      if (own.filter(e => e.type === "plan-replan-authorized").length >= 2) throw new Error("Pre-look replan budget exhausted");
      return { kind: "append", type: "plan-replan-authorized", payload: toJson(request), result: e => ({ sequence: e.seq, hash: e.hash }) };
    });
  }

  get literatureJournal(): Journal { return this.journal; }
  async lockPlan(request: PlanLockRequest): Promise<LockReceipt> {
    const literature = new BriefLedger(this.journal, request.investigationId, this.stream), brief = literature.frozen();
    if (brief || request.literatureBriefHash) {
      if (!brief || brief.sha256 !== request.literatureBriefHash) throw new Error('plan literature hash mismatch');
      literature.assertLook(request.planHash);
    }
    return decideAndAppend(this.journal, this.stream, (events) => {
      const amendment = events.filter(e => e.type === "plan-replan-authorized" && (e.payload as JsonObject).investigationId === request.investigationId).at(-1)?.seq ?? 0;
      const prior = events.find((e) => e.seq > amendment && e.type === "plan-locked" && (e.payload as JsonObject).investigationId === request.investigationId);
      if (prior) {
        if ((prior.payload as JsonObject).planHash !== request.planHash) throw new Error("a different plan is already locked for this investigation (amendments go through the amendment path)");
        return { kind: "done", result: { sequence: prior.seq, hash: prior.hash } };
      }
      return { kind: "append", type: "plan-locked", payload: toJson(request) as JsonObject, result: (e) => ({ sequence: e.seq, hash: e.hash }) };
    });
  }

  async recordFreeze(request: { investigationId: string; planHash: string; frozenCodeHash: string; attempt: number }): Promise<LockReceipt> {
    return decideAndAppend(this.journal, this.stream, (events) => {
      const prior = events.find((e) => e.type === "code-frozen" && canonicalJson(e.payload) === canonicalJson(toJson(request)));
      return prior ? { kind: "done", result: { sequence: prior.seq, hash: prior.hash } } : { kind: "append", type: "code-frozen", payload: toJson(request) as JsonObject, result: (e) => ({ sequence: e.seq, hash: e.hash }) };
    });
  }

  async looks(investigationId: string): Promise<LookRecord[]> {
    return this.journal.read(this.stream).filter((e) => e.type === "look-recorded" && (e.payload as JsonObject).investigationId === investigationId)
      .map((e) => {
        const p = e.payload as JsonObject;
        return { investigationId: String(p.investigationId), partitionId: String(p.partitionId), route: p.route as LookRecord["route"], number: Number(p.number),
          executable: p.executable === true, sequence: e.seq, hash: e.hash, executionId: String(p.executionId), frozenCodeHash: String(p.frozenCodeHash) };
      });
  }

  /** The look number is decided on the head it is appended to: two writers can never both get look 1. */
  async recordLook(request: LookRequest): Promise<LookRecord> {
    const literature = new BriefLedger(this.journal, request.investigationId, this.stream);
    if (literature.frozen()) literature.assertLook(request.planHash);
    return decideAndAppend(this.journal, this.stream, (events) => {
      const number = events.filter((e) => e.type === "look-recorded" && (e.payload as JsonObject).partitionId === request.partitionId).length + 1;
      // A sealed partition is burned by its first look; route P and N partitions belong to one lineage
      // and a repaired re-run is allowed to execute, as look 2 (never Confirmed).
      const executable = number === 1 || request.route !== "H";
      const record = { investigationId: request.investigationId, partitionId: request.partitionId, route: request.route, number, executable,
        planHash: request.planHash, frozenCodeHash: request.frozenCodeHash, contractHash: request.contractHash, executionId: request.executionId, recordedBeforeExecution: true };
      return {
        kind: "append", type: "look-recorded", payload: toJson(record) as JsonObject,
        result: (e): LookRecord => ({ investigationId: request.investigationId, partitionId: request.partitionId, route: request.route, number, executable, sequence: e.seq, hash: e.hash, executionId: request.executionId, frozenCodeHash: request.frozenCodeHash }),
      };
    });
  }

  seed(tuple: Partial<ContentTuple>, purpose: string): string {
    return createHmac("sha256", this.#key).update(canonicalJson({ domain: "omb-investigate/seed@1", tuple: toJson(tuple), purpose })).digest("hex");
  }
}
