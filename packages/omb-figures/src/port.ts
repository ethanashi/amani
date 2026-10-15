/**
 * The thin port PW0 (the PaperInput adapter) must satisfy. Every number a figure or table
 * prints arrives here as a signed, graded record (internal design notes (not published) section 2.2); nothing
 * else can reach a renderer. PW0 is built later, so this file defines the minimal shape only.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { canonicalJson } from "../../bio-core/src/index.ts";

/**
 * Number grades (kernel v3 item 13). `published` is a port extension for `[l:]` literature
 * values taken from a verified L4 quote; it may print only in previous-study rows.
 */
export const NUMBER_GRADES = ["kernel", "exec", "unverified", "published"] as const;
export type NumberGrade = (typeof NUMBER_GRADES)[number];

export const FACT_KINDS = [
  "effect", "difference", "beta", "or", "hr", "rr", "ratio", "ci", "p", "percent", "count",
  "auc", "proportion", "probability", "net-benefit", "posterior", "slope", "intercept",
  "mean", "sd", "median", "quantile", "se", "threshold",
] as const;
export type FactKind = (typeof FACT_KINDS)[number];

export const CLAIM_STATUSES = [
  "confirmed", "replicated", "tentative", "refuted", "insufficient-evidence",
  "non-identifiable", "exploratory", "voided",
] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export const CLAIM_SCALES = ["ratio", "difference", "probability"] as const;
export type ClaimScale = (typeof CLAIM_SCALES)[number];

export const ENTITY_KINDS = ["gene", "feature", "variant", "accession", "cohort", "dataset", "exposure", "outcome", "tissue", "population", "method", "other"] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

/** Provenance every record carries. Hashes are lowercase sha256 hex. */
export interface SignedProvenance {
  /** The ledger/certification record this value was read from. */
  readonly sourceRecordId: string;
  /** Hash of the certification (or stager manifest) that produced it. */
  readonly certHash: string;
  /** Producer authentication over `recordSigningPayload(record)`; checked by the injected authenticator. */
  readonly signature: string;
}

/** Section 2.2 typed metric record: `{value, kind, unit, ciLevel, method, deciding, claimId, grade, producerGate, certHash}`. */
export interface CertifiedFact extends SignedProvenance {
  readonly recordType: "fact";
  readonly id: string;
  readonly value: number;
  readonly kind: FactKind;
  readonly unit: string | null;
  /** Interval level as a proportion (0.95), required for kind `ci`. */
  readonly ciLevel: number | null;
  readonly method: string | null;
  readonly deciding: "deciding" | "companion";
  /** A claim record in the same input, or null for dataset-level facts (G1 counts). */
  readonly claimId: string | null;
  readonly grade: NumberGrade;
  readonly producerGate: string | null;
}

/** A vector of same-typed values from one record (ROC points, per-variant MR tables, screen results). */
export interface CertifiedSeries extends SignedProvenance {
  readonly recordType: "series";
  readonly id: string;
  readonly values: readonly number[];
  readonly kind: FactKind;
  readonly unit: string | null;
  readonly ciLevel: number | null;
  readonly method: string | null;
  readonly claimId: string | null;
  readonly grade: NumberGrade;
  readonly producerGate: string | null;
}

/** Entity record (section 2.5): digit-bearing names come only from here (`[e:key]`). */
export interface CertifiedEntity extends SignedProvenance {
  readonly recordType: "entity";
  readonly id: string;
  readonly entityKind: EntityKind;
  /** One name for a single entity; many for a feature list aligned with a series. */
  readonly texts: readonly string[];
}

/** The decision context of one claim: where the null line sits and which lines rounding may not cross. */
export interface CertifiedClaim extends SignedProvenance {
  readonly recordType: "claim";
  readonly id: string;
  readonly status: ClaimStatus;
  readonly scale: ClaimScale;
  readonly nullValue: number;
  /** Null value plus smallest-effect-of-interest bounds, on the measure's scale. */
  readonly thresholds: readonly number[];
  /** Effective alpha for this claim's p-values, or null. */
  readonly alpha: number | null;
}

export type CertifiedRecord = CertifiedFact | CertifiedSeries | CertifiedEntity | CertifiedClaim;
export type Unsigned<T> = T extends unknown ? Omit<T, "signature"> : never;

/** Port: verifies a record's producer signature. PW0 supplies the host implementation. */
export interface RecordAuthenticator {
  verify(record: CertifiedRecord): boolean;
}

const SIGNING_DOMAIN = "omb/certified-record@1";
export function recordSigningPayload(record: Unsigned<CertifiedRecord> | CertifiedRecord): string {
  const { signature: _ignored, ...rest } = record as CertifiedRecord;
  return canonicalJson({ domain: SIGNING_DOMAIN, record: rest });
}

/**
 * Reference HMAC authority (same construction as omb-certify's GateAuthority). A host
 * capability: the key never enters a drafter or worker context.
 */
export class HmacRecordAuthority implements RecordAuthenticator {
  readonly #key: Buffer;
  constructor(key: Uint8Array) {
    if (key.byteLength < 32) throw new Error("record key must have at least 256 bits");
    this.#key = Buffer.from(key);
  }
  sign<T extends CertifiedRecord>(record: Unsigned<T>): T {
    return { ...(structuredClone(record) as object), signature: this.#mac(record) } as T;
  }
  verify(record: CertifiedRecord): boolean {
    try {
      if (typeof record.signature !== "string" || !/^[a-f0-9]{64}$/u.test(record.signature)) return false;
      return timingSafeEqual(Buffer.from(record.signature, "hex"), Buffer.from(this.#mac(record), "hex"));
    } catch {
      return false;
    }
  }
  #mac(record: Unsigned<CertifiedRecord> | CertifiedRecord): string {
    return createHmac("sha256", this.#key).update(recordSigningPayload(record)).digest("hex");
  }
}

// ---------------------------------------------------------------------------------------------
// Strict schema validation (fail closed: unknown, missing or ill-typed fields refuse the record).

const HASH = /^[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9_.:\-]{1,160}$/u;

const FIELDS: Record<CertifiedRecord["recordType"], readonly string[]> = {
  fact: ["recordType", "id", "value", "kind", "unit", "ciLevel", "method", "deciding", "claimId", "grade", "producerGate", "sourceRecordId", "certHash", "signature"],
  series: ["recordType", "id", "values", "kind", "unit", "ciLevel", "method", "claimId", "grade", "producerGate", "sourceRecordId", "certHash", "signature"],
  entity: ["recordType", "id", "entityKind", "texts", "sourceRecordId", "certHash", "signature"],
  claim: ["recordType", "id", "status", "scale", "nullValue", "thresholds", "alpha", "sourceRecordId", "certHash", "signature"],
};

/** Free text inside a record (units, entity names): may hold digits, never markup or invisible characters. */
export function recordTextIssue(text: unknown): string | null {
  if (typeof text !== "string" || text.length === 0 || text.length > 80) return "must be a non-empty string of at most 80 characters";
  if (text.normalize("NFKC") !== text) return "must be NFKC-normalised";
  if (/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(text)) return "contains control or format characters";
  if (/[<>&"\\[\]`]/u.test(text)) return "contains markup characters";
  if (/^\s|\s$|\s\s/u.test(text)) return "has irregular whitespace";
  return null;
}

const nullable = (v: unknown, test: (x: unknown) => boolean): boolean => v === null || test(v);
const isString = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const isFinite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export interface RecordIssue { readonly index: number; readonly id: string; readonly code: RecordIssueCode; readonly detail: string }
export type RecordIssueCode = "malformed" | "ungraded" | "unsigned" | "non-finite" | "duplicate" | "orphan-claim";

/** Validates shape only (signature and cross-record checks happen in the store). */
export function validateRecordShape(raw: unknown, index: number): RecordIssue[] {
  const issue = (code: RecordIssueCode, detail: string): RecordIssue[] => [{ index, id: typeof (raw as { id?: unknown })?.id === "string" ? (raw as { id: string }).id : "?", code, detail }];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return issue("malformed", "record is not an object");
  const r = raw as Record<string, unknown>;
  const type = r.recordType;
  if (type !== "fact" && type !== "series" && type !== "entity" && type !== "claim") return issue("malformed", "unknown recordType");
  const allowed = FIELDS[type];
  const extra = Object.keys(r).filter((k) => !allowed.includes(k));
  if (extra.length) return issue("malformed", `unknown fields: ${extra.sort().join(", ")}`);
  if (type === "fact" || type === "series") {
    if (!Object.hasOwn(r, "grade") || !(NUMBER_GRADES as readonly unknown[]).includes(r.grade)) return issue("ungraded", "missing or unknown number grade");
  }
  if (!Object.hasOwn(r, "signature") || typeof r.signature !== "string" || r.signature.length === 0) return issue("unsigned", "missing signature");
  const missing = allowed.filter((k) => !Object.hasOwn(r, k));
  if (missing.length) return issue("malformed", `missing fields: ${missing.join(", ")}`);
  if (!isString(r.id) || !ID.test(r.id)) return issue("malformed", "invalid id");
  if (!isString(r.sourceRecordId) || !HASH.test(r.sourceRecordId)) return issue("malformed", "sourceRecordId must be a sha256 hex");
  if (!isString(r.certHash) || !HASH.test(r.certHash)) return issue("malformed", "certHash must be a sha256 hex");
  const textOk = (v: unknown) => recordTextIssue(v) === null;
  if (type === "fact" || type === "series") {
    if (!(FACT_KINDS as readonly unknown[]).includes(r.kind)) return issue("malformed", "unknown kind");
    if (!nullable(r.unit, textOk)) return issue("malformed", "invalid unit text");
    if (!nullable(r.method, isString) || !nullable(r.producerGate, isString) || !nullable(r.claimId, (v) => isString(v) && ID.test(v))) return issue("malformed", "invalid method, producerGate or claimId");
    if (!nullable(r.ciLevel, (v) => isFinite(v) && v > 0 && v < 1)) return issue("malformed", "ciLevel must be a proportion in (0, 1)");
    if (r.kind === "ci" && r.ciLevel === null) return issue("malformed", "a ci record needs its ciLevel");
    const values = type === "fact" ? [r.value] : r.values;
    if (!Array.isArray(values) || values.length === 0 || values.length > 100_000) return issue("malformed", "values must be a non-empty array");
    if (!values.every(isFinite)) return issue("non-finite", "every value must be a finite number");
    if (type === "fact" && r.deciding !== "deciding" && r.deciding !== "companion") return issue("malformed", "deciding must be deciding or companion");
    const vs = values as number[];
    if (r.kind === "count" && !vs.every((v) => Number.isInteger(v) && v >= 0)) return issue("malformed", "counts must be non-negative integers");
    if (r.kind === "p" && !vs.every((v) => v > 0 && v <= 1)) return issue("malformed", "p-values must lie in (0, 1]");
    if (["or", "hr", "rr", "ratio"].includes(r.kind as string) && !vs.every((v) => v > 0)) return issue("malformed", "ratio measures must be positive");
    if (["auc", "proportion", "probability", "posterior"].includes(r.kind as string) && !vs.every((v) => v >= 0 && v <= 1)) return issue("malformed", "probabilities must lie in [0, 1]");
    if (r.kind === "percent" && !vs.every((v) => v >= 0 && v <= 100)) return issue("malformed", "percentages must lie in [0, 100]");
    if (vs.some((v) => Math.abs(v) >= 1e15)) return issue("malformed", "values must be below 1e15 in magnitude");
  } else if (type === "entity") {
    if (!(ENTITY_KINDS as readonly unknown[]).includes(r.entityKind)) return issue("malformed", "unknown entityKind");
    if (!Array.isArray(r.texts) || r.texts.length === 0 || r.texts.length > 100_000) return issue("malformed", "texts must be a non-empty array");
    const bad = r.texts.findIndex((t) => recordTextIssue(t) !== null);
    if (bad >= 0) return issue("malformed", `entity text ${bad} ${recordTextIssue(r.texts[bad])}`);
  } else {
    if (!(CLAIM_STATUSES as readonly unknown[]).includes(r.status)) return issue("malformed", "unknown claim status");
    if (!(CLAIM_SCALES as readonly unknown[]).includes(r.scale)) return issue("malformed", "unknown claim scale");
    if (!isFinite(r.nullValue)) return issue("non-finite", "nullValue must be finite");
    if (r.scale === "ratio" && r.nullValue !== 1) return issue("malformed", "a ratio claim has its null value at 1");
    if (!Array.isArray(r.thresholds) || !r.thresholds.every(isFinite)) return issue("non-finite", "thresholds must be finite numbers");
    if (!(r.thresholds as number[]).includes(r.nullValue)) return issue("malformed", "thresholds must include the null value");
    if (!nullable(r.alpha, (v) => isFinite(v) && v > 0 && v < 1)) return issue("malformed", "alpha must lie in (0, 1)");
  }
  return [];
}
