import { canonicalJson, canonicalSha256 } from "../../bio-core/src/index.ts";

export type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };
export interface Plan {
  readonly hypothesisId: string;
  readonly analysis: { readonly [key: string]: Json };
  readonly partitionIds: readonly string[];
}
export interface RecordData {
  question: { text: string; successCriterion: string };
  observation: { value: Json; unit: string; codeHash: string; inputHashes: readonly string[]; runId: string };
  assumption: { text: string; status: "untested" | "held" | "violated" };
  hypothesis: { text: string };
  prediction: { experimentId: string; text: string };
  experiment: { experimentKey: string; status: "planned" | "locked"; plan: Plan; planHash: string };
  check: { name: string; status: "passed" | "failed" | "skipped" | "unknown" | "unavailable";
    kind: "reexecution" | "replication" | "blind-reimplementation" | "other"; dataHashes: readonly string[] };
  interpretation: { text: string; status: "tentative" | "confirmed" | "refuted" | "insufficient" };
  decision: { action: "continue" | "stop" | "amend" | "promote"; reason: string };
  citation: { doi: string; quotedSpan: string; resolution: "resolved" | "unavailable" | "invalid" };
  amendment: { supersedes: string; replacementId: string; reason: string; post_unblinding: boolean };
  probe: { experimentId: string; planHash: string; prediction: string };
  idea: { text: string; sourceDataHashes: readonly string[]; status: "new" | "triaged" | "tested" | "dead" | "promoted";
    confirmation: "tentative" | "confirmed"; confirmationDataHash: string | null };
}
export type RecordKind = keyof RecordData;
export interface ParentLink {
  readonly id: string;
  readonly type: RecordKind;
  readonly relation: "derived_from" | "supports" | "refutes" | "contradicts" | "supersedes";
}
export interface Actor { readonly kind: "model" | "human" | "software"; readonly id: string }
export type RecordInput<K extends RecordKind = RecordKind> = {
  [T in K]: { readonly kind: T; readonly data: Readonly<RecordData[T]>; readonly parents: readonly ParentLink[] }
}[K];
export type NotebookRecord<K extends RecordKind = RecordKind> = {
  [T in K]: { readonly id: string; readonly payload: RecordInput<T> & { readonly at: number; readonly actor: Actor } }
}[K];
export const recordKinds: readonly RecordKind[] = ["question", "observation", "assumption", "hypothesis", "prediction",
  "experiment", "check", "interpretation", "decision", "citation", "amendment", "probe", "idea"];

export function fail(message: string): never { throw new Error(message); }
export function text(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value.length > 16384) fail("invalid nonblank text");
}
export function hash(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) fail("invalid sha256");
}
export function choice(value: unknown, choices: readonly string[]): void {
  if (typeof value !== "string" || !choices.includes(value)) fail("unknown or missing enum value");
}
export function shape(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join(",") !== [...keys].sort().join(",")) fail("invalid object fields");
  return value as Record<string, unknown>;
}
export function integer(value: unknown, min = 0): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min) fail("invalid integer");
}
export function strings(value: unknown, min = 0, hashes = false): asserts value is string[] {
  if (!Array.isArray(value) || value.length < min || value.length > 256) fail("invalid list");
  for (const item of value) hashes ? hash(item) : text(item);
  if (new Set(value).size !== value.length) fail("duplicate list entry");
}

/** Reject lossy JSON (accessors, prototypes, sparse arrays, cycles, undefined) before hashing. */
export function jsonCopy<T>(value: T): T {
  const seen = new Set<object>();
  function visit(v: unknown, depth: number): void {
    if (depth > 64) fail("JSON nesting exceeds bound");
    if (v === null || typeof v === "string" || typeof v === "boolean") return;
    if (typeof v === "number" && Number.isFinite(v)) return;
    if (typeof v !== "object" || v === null) fail("invalid JSON value");
    if (seen.has(v)) fail("cyclic JSON");
    seen.add(v);
    const array = Array.isArray(v);
    if (!array && Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) fail("non-JSON prototype");
    const keys = Reflect.ownKeys(v);
    if (array && (keys.length !== v.length + 1 || !Array.from({ length: v.length }, (_, i) => Object.hasOwn(v, i)).every(Boolean))) fail("sparse or decorated array");
    for (const key of keys) {
      if (array && key === "length") continue;
      const d = Object.getOwnPropertyDescriptor(v, key)!;
      if (typeof key !== "string" || !d.enumerable || !("value" in d)) fail("non-JSON property");
      visit(d.value, depth + 1);
    }
    seen.delete(v);
  }
  visit(value, 0);
  const json = canonicalJson(value);
  if (Buffer.byteLength(json) > 262144) fail("JSON exceeds byte bound");
  return JSON.parse(json) as T;
}
export function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
export function validatePlan(value: unknown): Plan {
  const p = shape(jsonCopy(value), ["hypothesisId", "analysis", "partitionIds"]);
  hash(p.hypothesisId); strings(p.partitionIds, 1);
  if (!p.analysis || typeof p.analysis !== "object" || Array.isArray(p.analysis) || !Object.keys(p.analysis).length) fail("analysis must be a nonempty JSON object");
  return p as unknown as Plan;
}
export function validateActor(value: unknown): Actor {
  const a = shape(value, ["kind", "id"]); choice(a.kind, ["model", "human", "software"]); text(a.id);
  return a as unknown as Actor;
}
export function validateInput(value: unknown): RecordInput {
  const p = shape(jsonCopy(value), ["kind", "data", "parents"]);
  choice(p.kind, recordKinds);
  if (!Array.isArray(p.parents) || p.parents.length > 256) fail("invalid parent links");
  for (const link of p.parents) {
    const l = shape(link, ["id", "type", "relation"]); hash(l.id); choice(l.type, recordKinds);
    choice(l.relation, ["derived_from", "supports", "refutes", "contradicts", "supersedes"]);
  }
  if (new Set(p.parents.map(canonicalJson)).size !== p.parents.length) fail("duplicate parent link");
  const r = p as unknown as RecordInput;
  switch (r.kind) {
    case "question": shape(r.data, ["text", "successCriterion"]); text(r.data.text); text(r.data.successCriterion); break;
    case "observation":
      shape(r.data, ["value", "unit", "codeHash", "inputHashes", "runId"]);
      text(r.data.unit); text(r.data.runId); hash(r.data.codeHash); strings(r.data.inputHashes, 1, true); break;
    case "assumption": shape(r.data, ["text", "status"]); text(r.data.text); choice(r.data.status, ["untested", "held", "violated"]); break;
    case "hypothesis": shape(r.data, ["text"]); text(r.data.text); break;
    case "prediction": shape(r.data, ["text", "experimentId"]); text(r.data.text); hash(r.data.experimentId); break;
    case "experiment":
      shape(r.data, ["experimentKey", "status", "plan", "planHash"]); text(r.data.experimentKey);
      choice(r.data.status, ["planned", "locked"]); validatePlan(r.data.plan); hash(r.data.planHash);
      if (r.data.planHash !== canonicalSha256(r.data.plan)) fail("plan hash mismatch"); break;
    case "check":
      shape(r.data, ["name", "status", "kind", "dataHashes"]); text(r.data.name);
      choice(r.data.status, ["passed", "failed", "skipped", "unknown", "unavailable"]);
      choice(r.data.kind, ["reexecution", "replication", "blind-reimplementation", "other"]); strings(r.data.dataHashes, 1, true); break;
    case "interpretation": shape(r.data, ["text", "status"]); text(r.data.text); choice(r.data.status, ["tentative", "confirmed", "refuted", "insufficient"]); break;
    case "decision": shape(r.data, ["action", "reason"]); text(r.data.reason); choice(r.data.action, ["continue", "stop", "amend", "promote"]); break;
    case "citation":
      shape(r.data, ["doi", "quotedSpan", "resolution"]); text(r.data.doi); text(r.data.quotedSpan);
      choice(r.data.resolution, ["resolved", "unavailable", "invalid"]); break;
    case "amendment":
      shape(r.data, ["supersedes", "replacementId", "reason", "post_unblinding"]);
      hash(r.data.supersedes); hash(r.data.replacementId); text(r.data.reason);
      if (typeof r.data.post_unblinding !== "boolean") fail("invalid unblinding flag"); break;
    case "probe": shape(r.data, ["experimentId", "planHash", "prediction"]); hash(r.data.experimentId); hash(r.data.planHash); text(r.data.prediction); break;
    case "idea":
      shape(r.data, ["text", "sourceDataHashes", "status", "confirmation", "confirmationDataHash"]);
      text(r.data.text); strings(r.data.sourceDataHashes, 1, true); choice(r.data.status, ["new", "triaged", "tested", "dead", "promoted"]);
      choice(r.data.confirmation, ["tentative", "confirmed"]);
      if (r.data.confirmationDataHash !== null) hash(r.data.confirmationDataHash);
      if (r.data.confirmation === "confirmed" && (r.data.confirmationDataHash === null || r.data.sourceDataHashes.includes(r.data.confirmationDataHash))) fail("idea confirmation requires fresh data");
      break;
  }
  return r;
}
export function makeRecord(input: RecordInput, at: number, actor: Actor): NotebookRecord {
  const payload = { ...validateInput(input), at, actor: validateActor(jsonCopy(actor)) };
  integer(at); if (!Number.isFinite(new Date(at).getTime())) fail("invalid clock");
  return freeze({ id: canonicalSha256(payload), payload }) as NotebookRecord;
}
export function validateRecord(value: unknown): NotebookRecord {
  const r = shape(jsonCopy(value), ["id", "payload"]);
  const p = shape(r.payload, ["kind", "data", "parents", "at", "actor"]);
  integer(p.at);
  const expected = makeRecord({ kind: p.kind, data: p.data, parents: p.parents } as RecordInput, p.at, validateActor(p.actor));
  if (r.id !== expected.id) fail("record hash mismatch");
  return expected;
}
export function parent(record: NotebookRecord, relation: ParentLink["relation"] = "derived_from"): ParentLink {
  return { id: record.id, type: record.payload.kind, relation };
}
