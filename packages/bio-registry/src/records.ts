import { canonicalClone } from "../../bio-core/src/index.ts";

/** All dates are integer Unix milliseconds, supplied by the trusted host. */
export interface EventDefinition {
  readonly eventId: string;
  readonly question: string;
  readonly eventDescription: string;
  readonly resolutionCriteria: string;
  readonly resolutionSource: string;
  readonly expectedResolutionDate: number;
}
export interface PredictionInput extends EventDefinition {
  readonly probability: number;
  readonly rationalePointer: string;
  readonly provenance: { readonly modelId: string; readonly agentId: string };
  readonly supersedes?: string;
}
export interface PredictionPayload extends PredictionInput {
  readonly kind: "prediction";
  readonly createdAt: number;
}
export interface ResolutionInput {
  readonly eventId: string;
  readonly outcome: boolean;
  readonly source: string;
  readonly resolvedAt: number;
  readonly resolverActor: string;
}
export interface ResolutionPayload extends ResolutionInput {
  readonly kind: "resolution";
  readonly recordedAt: number;
}
export interface RegistryRecord<P = PredictionPayload | ResolutionPayload> {
  readonly id: string;
  readonly payload: P;
}
export type PredictionRecord = RegistryRecord<PredictionPayload>;
export type ResolutionRecord = RegistryRecord<ResolutionPayload>;

export function fail(message: string): never { throw new Error(message); }
export function text(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value.trim()) fail("nonblank string required");
}
export function timestamp(value: unknown): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 ||
      !Number.isFinite(new Date(value).getTime())) fail("invalid timestamp");
}
export function hash(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) fail("invalid record hash");
}
export function probability(value: unknown): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) fail("invalid probability");
}
export function object(value: unknown, required: readonly string[], optional: readonly string[] = []): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail("plain object required");
  if (required.some(key => !Object.hasOwn(value, key)) ||
      Reflect.ownKeys(value).some(key => typeof key !== "string" || ![...required, ...optional].includes(key))) {
    fail("missing or unknown record fields");
  }
}
const definitionKeys = ["eventId", "question", "eventDescription", "resolutionCriteria", "resolutionSource", "expectedResolutionDate"];
const predictionKeys = [...definitionKeys, "probability", "rationalePointer", "provenance"];
const resolutionKeys = ["eventId", "outcome", "source", "resolvedAt", "resolverActor"];

export function validatePrediction(value: unknown, stored = false): asserts value is PredictionInput {
  object(value, stored ? [...predictionKeys, "kind", "createdAt"] : predictionKeys, ["supersedes"]);
  for (const key of [...definitionKeys.filter(k => k !== "expectedResolutionDate"), "rationalePointer"]) text(value[key]);
  timestamp(value.expectedResolutionDate);
  probability(value.probability);
  object(value.provenance, ["modelId", "agentId"]);
  text(value.provenance.modelId); text(value.provenance.agentId);
  if (Object.hasOwn(value, "supersedes")) hash(value.supersedes);
  if (stored) {
    if (value.kind !== "prediction") fail("unknown prediction kind");
    timestamp(value.createdAt);
  }
}
export function validateResolution(value: unknown, stored = false): asserts value is ResolutionInput {
  object(value, stored ? [...resolutionKeys, "kind", "recordedAt"] : resolutionKeys);
  text(value.eventId); text(value.source); text(value.resolverActor);
  if (typeof value.outcome !== "boolean") fail("resolution requires a known binary outcome");
  timestamp(value.resolvedAt);
  if (stored) {
    if (value.kind !== "resolution") fail("unknown resolution kind");
    timestamp(value.recordedAt);
  }
}
export function definition(value: EventDefinition): EventDefinition {
  const { eventId, question, eventDescription, resolutionCriteria, resolutionSource, expectedResolutionDate } = value;
  return { eventId, question, eventDescription, resolutionCriteria, resolutionSource, expectedResolutionDate };
}
export function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
}
export function copy<T>(value: T): T { return freeze(canonicalClone(value)); }
