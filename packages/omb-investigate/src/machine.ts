import {InvestigationPaused} from "./pause.ts";
import { isHardStopKind } from "../../omb-gauntlet/src/index.ts";
// The scientific-method state machine and phase memoization.
//
// Every phase and every memoized step inside a phase is keyed by (phase, step, input hash). Its
// output is journaled once; a restart replays completed work from the journal instead of redoing
// it (this replaces v1's crash-resume and fault points). Phase outputs are hash-chained: each
// phase's input hash includes the previous phase's output hash, and each output hash includes it
// too, so no phase can run on outputs that were not recorded, and a tampered or truncated journal
// refuses every further transition.
//
// Transitions are enforced from the journal, never from the caller: the only phase allowed to run
// is the `next` the last completed phase recorded, and `next` itself must be the phase's normal
// successor or, with a terminal reason, the deliverable.

import { canonicalJson, sha256Canonical } from "../../bio-core/src/index.ts";
import { JournalConflict, type Journal, type JournalEvent } from "./journal.ts";
import { isPhase, PHASES, TERMINAL_KINDS, type Json, type JsonObject, type PhaseId, type PhaseOutputBase, type Terminal } from "./types.ts";

/** Positive evidence only, including violations by a standby reviewer. */
export class HardStopObserved extends Error {
  constructor(readonly stop:string){super(`Trusted hard stop observed: ${stop}`);if(!isHardStopKind(stop))throw new Error("Unknown hard stop");}
}
export class TransitionRefused extends Error {
  constructor(readonly phase: string, readonly reason: string) {
    super(`omb-investigate: transition to ${phase} refused: ${reason}`);
    this.name = "TransitionRefused";
  }
}
export class PhaseInputChanged extends Error {
  constructor(readonly phase: string, readonly step: string | null) {
    super(`omb-investigate: ${phase}${step ? `/${step}` : ""} already completed with different inputs; refusing to redo it`);
    this.name = "PhaseInputChanged";
  }
}

/** Normal successor of each phase. The deliverable may also follow any phase that recorded a terminal reason. */
export const NEXT: Readonly<Record<PhaseId, PhaseId | null>> = Object.freeze({
  question: "stage", stage: "plan", plan: "plan-lock", "plan-lock": "code", code: "dry-run", "dry-run": "freeze",
  freeze: "look", look: "certify", certify: "replicate", replicate: "interpret", interpret: "deliverable", deliverable: null,
});

/** Phases that may jump to the deliverable (with a recorded terminal reason). */
export const MAY_TERMINATE: ReadonlySet<PhaseId> = new Set<PhaseId>(["stage", "plan", "plan-lock", "code", "dry-run", "freeze", "look", "replicate", "interpret"]);

export function allowedNext(phase: PhaseId, output: PhaseOutputBase): string | null {
  if (phase === "deliverable") return output.next === null ? null : "the deliverable is final";
  if (output.next === "deliverable" && output.terminal !== null && (MAY_TERMINATE.has(phase)||output.terminal.kind==="hard-stop"&&isHardStopKind(output.terminal.stop??""))) {
    const t = output.terminal;
    if (!(TERMINAL_KINDS as readonly string[]).includes(t.kind) || t.phase !== phase || typeof t.reason !== "string") return "malformed terminal reason";
    return null;
  }
  if (output.next === NEXT[phase]) return output.terminal === null ? null : "a terminal reason must jump to the deliverable";
  return `${phase} may not be followed by ${String(output.next)}`;
}

export const hashOf = (value: unknown): string => sha256Canonical(value);
export const toJson = <T>(value: T): Json => JSON.parse(canonicalJson(value)) as Json;

export type Fault = (point: string) => void;

interface PhaseRecord { phase: PhaseId; inputHash: string; output: JsonObject; outputHash: string; prevOutputHash: string | null; seq: number }

export interface StepContext {
  /** Memoized unit of work inside the current phase, keyed by (phase, name, input hash). */
  step<T>(name: string, input: unknown, fn: () => Promise<T>): Promise<T>;
  /** Already-completed step output, if any (no side effects). */
  peek<T>(name: string, input: unknown): T | undefined;
  /** Record a durable note (warning, routing decision, dispatch record). */
  note(type: string, payload: unknown): void;
  /** Notes of a type recorded so far in this stream (any phase). */
  notes(type: string): JsonObject[];
}

type Revalidate = () => "retry" | { done: unknown };

/** Memoized steps over one journal stream (used by investigations and boss programs). */
export class Steps {
  /** Length of the stream as of this writer's last read or append: every append pins it. */
  #seen = 0;

  constructor(protected readonly journal: Journal, readonly stream: string, protected readonly fault: Fault = () => {}) {}

  protected events(): JournalEvent[] {
    const check = this.journal.verify(this.stream);
    if (!check.valid) throw new TransitionRefused("*", `journal chain of ${this.stream} is broken at event ${check.brokenAt}`);
    const events = this.journal.read(this.stream);
    this.#seen = events.length;
    return events;
  }

  /**
   * Append against this writer's view of the stream. A foreign append since that view raises
   * JournalConflict in the journal (nothing written); then the head is re-read (chain verified) and
   * `revalidate` decides on the fresh view: retry, or the record is already there (done). Never a
   * blind re-apply.
   */
  protected append(type: string, payload: Json, revalidate: Revalidate = () => "retry"): { event: JournalEvent } | { done: unknown } {
    for (let attempt = 0; ; attempt++) {
      try {
        const event = this.journal.append(this.stream, type, payload, this.#seen);
        this.#seen = event.seq;
        return { event };
      } catch (e) {
        if (!(e instanceof JournalConflict) || attempt >= 8) throw e;
        this.events();
        const decision = revalidate();
        if (decision !== "retry") return decision;
      }
    }
  }

  #key(scope: string, name: string, input: unknown): string {
    return hashOf({ scope, name, input: toJson(input) });
  }

  #completedStep(scope: string, name: string, key: string): { hit: JsonObject | null; otherInput: boolean } {
    let hit: JsonObject | null = null, otherInput = false;
    for (const e of this.events()) {
      const p = e.payload as JsonObject;
      if (e.type !== "step-completed" || p.scope !== scope || p.name !== name) continue;
      if (p.key === key) hit = p;
      else otherInput = true;
    }
    return { hit, otherInput };
  }

  peekStep<T>(scope: string, name: string, input: unknown): T | undefined {
    const key = this.#key(scope, name, input);
    let hit: T | undefined;
    for (const e of this.events()) {
      const p = e.payload as JsonObject;
      if (e.type === "step-completed" && p.key === key) hit = p.output as T;
    }
    return hit;
  }

  async runStep<T>(scope: string, name: string, input: unknown, fn: () => Promise<T>): Promise<T> {
    const key = this.#key(scope, name, input);
    // On a conflict: a step another writer completed with the same key is reused, never redone.
    const revalidate: Revalidate = () => {
      const now = this.#completedStep(scope, name, key);
      if (now.hit) return { done: now.hit.output };
      if (now.otherInput) throw new PhaseInputChanged(scope, name);
      return "retry";
    };
    const before = revalidate();
    if (before !== "retry") return before.done as T;
    const started = this.append("step-started", { scope, name, key }, revalidate);
    if ("done" in started) return started.done as T;
    this.fault(`step:${scope}/${name}:started`);
    const output = await fn();
    const stored = toJson(output ?? null);
    const completed = this.append("step-completed", { scope, name, key, output: stored, outputHash: hashOf(stored) }, revalidate);
    if ("done" in completed) return completed.done as T;
    this.fault(`step:${scope}/${name}:completed`);
    return stored as T;
  }

  /** Audit notes carry no decision; after a conflict they are appended on the re-read head. */
  note(type: string, payload: unknown): void {
    if (["step-started", "step-completed", "phase-started", "phase-resumed", "phase-completed"].includes(type)) throw new TypeError("reserved journal event type");
    this.append(type, toJson(payload));
  }

  notes(type: string): JsonObject[] {
    return this.events().filter((e) => e.type === type).map((e) => e.payload as JsonObject);
  }

  context(scope: string): StepContext {
    const generation = this.notes("plan-replanned").length;
    if (generation && scope !== "question" && scope !== "stage") scope = `${scope}@replan-${generation}`;
    const resumed = this.notes("triage-resumed").filter(n => n.phase === scope).length;
    if (resumed) scope = `${scope}@triage-resume-${resumed}`;
    return {
      step: (name, input, fn) => this.runStep(scope, name, input, fn),
      peek: (name, input) => this.peekStep(scope, name, input),
      note: (type, payload) => this.note(type, { scope, ...((toJson(payload) ?? {}) as JsonObject) }),
      notes: (type) => this.notes(type),
    };
  }
}

/** The investigation state machine over its journal stream. */
export class PhaseMachine extends Steps {
  #cache: { length: number; head: string | null; records: PhaseRecord[] } | null = null;

  #records(): PhaseRecord[] {
    const events = this.events();
    const head = events.at(-1)?.hash ?? null;
    if (this.#cache && this.#cache.length === events.length && this.#cache.head === head) return this.#cache.records;
    const records = this.#derive(events);
    this.#cache = { length: events.length, head, records };
    return records;
  }

  #derive(events: JournalEvent[]): PhaseRecord[] {
    const out: PhaseRecord[] = [];
    let prev: string | null = null;
    let expected: PhaseId | null = "question";
    let replans = 0, lookExecuting = false;
    for (const e of events) {
      const p = e.payload as JsonObject;
      if (e.type === "look-executing") lookExecuting = true;
      if (e.type === "plan-replanned") {
        if (lookExecuting || !["plan", "plan-lock", "code", "dry-run"].includes(expected ?? "") || ++replans > 2 || p.generation !== replans || p.previousOutputHash !== prev || p.lookSpent !== false)
          throw new TransitionRefused("plan", "invalid pre-look replan journal transition");
        // All historical output links are verified above/below; only the active projection rewinds.
        out.splice(2);
        prev = out.at(-1)!.outputHash;
        expected = "plan";
        continue;
      }
      if (e.type !== "phase-completed") continue;
      if (!isPhase(p.phase)) throw new TransitionRefused(String(p.phase), "unknown phase in journal");
      const r = { phase: p.phase, inputHash: String(p.inputHash), output: p.output as JsonObject, outputHash: String(p.outputHash), prevOutputHash: (p.prevOutputHash as string | null) ?? null, seq: e.seq };
      if (r.phase !== expected) throw new TransitionRefused(r.phase, `journal records ${r.phase} where ${String(expected)} was due`);
      if (r.prevOutputHash !== prev || hashOf({ output: r.output, prev }) !== r.outputHash) throw new TransitionRefused(r.phase, "phase output chain does not verify");
      const why = allowedNext(r.phase, r.output as unknown as PhaseOutputBase);
      if (why) throw new TransitionRefused(r.phase, why);
      out.push(r);
      prev = r.outputHash;
      expected = (r.output.next as PhaseId | null) ?? null;
    }
    return out;
  }

  /** Host-only transition after the ledger has durably authorized the amendment. */
  replan(id: string, reason: string, receipt: { sequence: number; hash: string }): void {
    if (this.notes("plan-replanned").some(n => n.id === id)) return;
    const records = this.#records();
    if (this.notes("look-executing").length || !["plan", "plan-lock", "code", "dry-run"].includes(this.due() ?? "") || this.notes("plan-replanned").length >= 2 || !reason.trim() || !receipt.hash)
      throw new TransitionRefused("plan", "only two pre-freeze plan/code/dry-run replans are allowed");
    this.note("plan-replanned", { id, reason, receipt, generation: this.notes("plan-replanned").length + 1, lookSpent: false, previousOutputHash: records.at(-1)!.outputHash });
  }

  /** Completed phases in the active plan generation. */
  completed(): { phase: PhaseId; output: JsonObject; outputHash: string }[] {
    return this.#records().map((r) => ({ phase: r.phase, output: r.output, outputHash: r.outputHash }));
  }

  output<T extends PhaseOutputBase>(phase: PhaseId): T | null {
    const r = this.#records().find((x) => x.phase === phase);
    return r ? (r.output as unknown as T) : null;
  }

  /** The phase allowed to run now, or null when the deliverable is done. */
  due(): PhaseId | null {
    const records = this.#records();
    if (records.length === 0) return "question";
    return (records[records.length - 1]!.output.next as PhaseId | null) ?? null;
  }

  /** Refuse unless `phase` is exactly the phase due now (or already completed: a memo hit). */
  assertCanRun(phase: PhaseId): void {
    if (!isPhase(phase)) throw new TransitionRefused(String(phase), "unknown phase");
    const records = this.#records();
    if (records.some((r) => r.phase === phase)) return;
    const due = records.length === 0 ? "question" : ((records[records.length - 1]!.output.next as PhaseId | null) ?? null);
    if (due === null) {
      this.note("transition-refused", { phase, reason: "investigation finished" });
      throw new TransitionRefused(phase, "the investigation is finished");
    }
    if (phase !== due) {
      const skipped = PHASES.slice(PHASES.indexOf(due), PHASES.indexOf(phase));
      const reason = PHASES.indexOf(phase) > PHASES.indexOf(due) ? `skips ${skipped.join(", ")}` : `${due} is due`;
      this.note("transition-refused", { phase, due, reason });
      throw new TransitionRefused(phase, reason);
    }
  }

  /**
   * Run (or replay) one phase. `input` must be the phase's complete external input; together with
   * the previous phase's output hash it forms the memo key. A completed phase with a different key
   * refuses (inputs never change silently after the fact).
   */
  async phase<T extends PhaseOutputBase>(phase: PhaseId, input: unknown, run: (ctx: StepContext) => Promise<T>): Promise<T> {
    this.assertCanRun(phase);
    const records = this.#records();
    const index = PHASES.indexOf(phase);
    const prevRecord = records.filter((r) => PHASES.indexOf(r.phase) < index).at(-1) ?? null;
    const prev = prevRecord?.outputHash ?? null;
    const inputHash = hashOf({ phase, input: toJson(input), prev });
    const done = records.find((r) => r.phase === phase);
    if (done) {
      if (done.inputHash !== inputHash) throw new PhaseInputChanged(phase, null);
      return done.output as unknown as T;
    }
    // On a conflict, re-validate on the fresh head: the phase completed by another writer with the
    // same input is that writer's output (never a second completion); different inputs refuse; and
    // the transition itself must still be legal before retrying.
    const revalidate: Revalidate = () => {
      const now = this.#records().find((r) => r.phase === phase);
      if (now) {
        if (now.inputHash !== inputHash) throw new PhaseInputChanged(phase, null);
        return { done: now.output };
      }
      this.assertCanRun(phase);
      return "retry";
    };
    const started = this.events().some((e) => e.type === "phase-started" && (e.payload as JsonObject).inputHash === inputHash);
    const opened = this.append(started ? "phase-resumed" : "phase-started", { phase, inputHash }, revalidate);
    if ("done" in opened) return opened.done as T;
    this.fault(`phase:${phase}:started`);
    let output:T;
    try{output=await run(this.context(phase));}catch(e){
      if(!(e instanceof HardStopObserved))throw e;
      this.note("routing",{event:e.stop,class:"hard-stop",reason:e.message});
      output={next:"deliverable",terminal:{kind:"hard-stop",phase,reason:e.message,stop:e.stop}} as T;
    }
    const why = allowedNext(phase, output);
    if (why) throw new TransitionRefused(phase, `invalid output: ${why}`);
    const stored = toJson(output) as JsonObject;
    this.fault(`phase:${phase}:before-complete`);
    const completed = this.append("phase-completed", { phase, inputHash, output: stored, outputHash: hashOf({ output: stored, prev }), prevOutputHash: prev }, revalidate);
    if ("done" in completed) return completed.done as T;
    this.fault(`phase:${phase}:completed`);
    return stored as unknown as T;
  }

  /** Head of the journal chain (for the deliverable's "how to check" section). */
  head(): string | null {
    return this.events().at(-1)?.hash ?? null;
  }
}

export function terminal(phase: PhaseId, kind: Terminal["kind"], reason: string, stop: string | null = null): { next: "deliverable"; terminal: Terminal } {
  if(kind==="infrastructure")throw new InvestigationPaused("infra",reason,phase);
  return { next: "deliverable", terminal: { kind, reason, stop, phase } };
}
