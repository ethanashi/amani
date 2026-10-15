// Block 4d: content-duplicate / pseudo-replication detector (CONTRACT.md "Block 4d").
//
// Records with different IDs but identical content are one biological unit counted twice.
// `detectContentDuplicates` finds them by hashing canonical (exact or rounded) content and
// then verifying every candidate exactly, so a hash collision can never create a duplicate.
// `detectNearDuplicates` flags suspected technical replicates (Pearson r above a threshold)
// separately. `effectiveUnits` collapses both kinds of evidence before any n is reported.
// Every function is deterministic and fails closed: unreadable input yields `status: "invalid"`,
// never "no duplicates". See NOTES.md "Block 4d" for the method, tolerance and limits.

import { createHash } from "node:crypto";
import { types } from "node:util";
import { isName, isRecord, snapshot } from "../evidence.ts";

// ---------------------------------------------------------------- public types

/** A field name holding the vector, or a function called exactly once per row. */
export type VectorSource = string | ((row: Readonly<Record<string, unknown>>, index: number) => unknown);

export type MissingValuePolicy = { policy: "refuse" } | { policy: "token"; tokens: string[] };

export interface ContentDuplicateInput {
  /** Defaults: 50% and min(3, compared width); narrow complete records stay usable. */
  minimumInformative?: { fields: number; share: number };
  /** Numeric vectors only; named gaps are compared by position, never imputed. */
  missingValues?: MissingValuePolicy;
  rows: readonly unknown[];
  /** Field holding a unique, non-blank string ID. */
  idField: string;
  /** Scalar fields compared as content (finite number, string or boolean values). */
  compareFields?: readonly string[];
  /** Numeric vector compared as content (plain number array or numeric typed array). */
  vectorOf?: VectorSource;
  /**
   * Required. 0 = exact equality (with -0 equal to +0). t > 0 = every numeric value is
   * quantized as Math.round(x / t) and records are duplicates iff all quantized values agree.
   */
  tolerance: number;
}

export interface NearDuplicateInput {
  missingValues?: MissingValuePolicy;
  rows: readonly unknown[];
  idField: string;
  vectorOf: VectorSource;
  /** Flag pairs whose Pearson correlation is strictly greater than this. Default 0.999. */
  threshold?: number;
  /** Candidate pairs allowed past the provable filter before the search is inconclusive. Default 50,000. */
  maxCandidatePairs?: number;
}

/** Default handling for both detectors; exact numeric vectors can explicitly name missing tokens. */
export const DUPLICATE_POLICY = Object.freeze({
  nonFinite: "reject",
  missing: "reject",
  signedZero: "equal",
  rounding: "Math.round(x / tolerance), halves toward +Infinity",
} as const);
export type DuplicatePolicy = Omit<typeof DUPLICATE_POLICY, "missing"> & {
  missing: "reject" | "token"; tokens?: string[]; encoding?: string; nearComparison?: "not run";
};

export interface VectorBasis {
  /** `field:<name>` or `function`. */
  source: string;
  length: number;
}

export interface ContentDuplicateGroup {
  /** Sorted IDs of records whose content is identical under the declared tolerance. */
  ids: string[];
  /** Input row indices, ascending. */
  rowIndices: number[];
  /** Largest raw coordinate spread inside the group (0 for exact mode; at most ~tolerance otherwise). */
  maxAbsDifference: number;
}

export interface ContentDuplicateCounts {
  records: number;
  uniqueUnits: number;
  duplicateGroups: number;
  recordsInGroups: number;
  redundantRecords: number;
  hashBuckets: number;
  verifiedComparisons: number;
  /** Candidates sharing a bucket whose exact verification failed. */
  hashCollisions: number;
}

interface ContentChecked {
  information: { minimumFields: number; minimumShare: number; comparedFields: number;
    insufficient: { id: string; rowIndex: number; informativeFields: number; reason: string }[] };
  kind: "content-duplicates";
  checked: true;
  reason: string;
  method: "exact" | "rounded";
  tolerance: number;
  policy: DuplicatePolicy;
  basis: { idField: string; compareFields: string[]; vector: VectorBasis | null };
  /** Every ID that was checked, in input order. */
  checkedIds: string[];
  groups: ContentDuplicateGroup[];
  counts: ContentDuplicateCounts;
}

/**
 * `valid` is true only for a completed check that found no duplicates. Invalid input carries
 * no `groups` or `counts`, so it can never be read as "no duplicates".
 */
export type ContentDuplicateReport =
  | (ContentChecked & { status: "no-duplicates"; valid: true })
  | (ContentChecked & { status: "duplicates-found"; valid: false })
  | (ContentChecked & { status: "insufficient-information"; valid: false })
  | { kind: "content-duplicates"; status: "invalid"; valid: false; checked: false; reason: string };

export interface NearDuplicatePair {
  /** Two distinct-content representatives, ids[0] < ids[1]. */
  ids: [string, string];
  rowIndices: [number, number];
  correlation: number;
}

export interface NearDuplicateCounts {
  records: number;
  distinctVectors: number;
  sketchDimensions: number;
  candidatePairs: number;
  nearPairs: number;
}

interface NearChecked {
  kind: "near-duplicates";
  checked: true;
  reason: string;
  method: "pearson";
  threshold: number;
  policy: DuplicatePolicy;
  basis: { idField: string; vector: VectorBasis };
  checkedIds: string[];
  /** Pairs with r > threshold whose vectors are NOT numerically identical. */
  pairs: NearDuplicatePair[];
  /** Connected components of `pairs` (representative IDs only). */
  groups: string[][];
  /** Numerically identical vectors collapsed before the search (exact duplicates, reported apart). */
  identicalGroups: string[][];
  counts: NearDuplicateCounts;
}

/** `valid` is true only when no near pair and no identical copy was found. */
export type NearDuplicateReport =
  | (NearChecked & { status: "no-near-duplicates"; valid: boolean })
  | (NearChecked & { status: "near-duplicates-found"; valid: false })
  | { kind: "near-duplicates"; status: "invalid"; valid: false; checked: false; reason: string };

export type DuplicateEvidence = ContentDuplicateReport | NearDuplicateReport;

export interface EffectiveUnitsOptions {
  /** Records whose n is being reported (default: the first report's checkedIds). */
  ids?: readonly string[];
}

export type EffectiveUnitsResult =
  | {
      valid: true;
      inputN: number;
      effectiveN: number;
      collapsedRecords: number;
      /** Every unit, members in `ids` order; units ordered by first member. */
      units: string[][];
      /** First member of each unit. */
      representatives: string[];
      reason: string;
    }
  | { valid: false; effectiveN: null; reason: string };

/** Test seam: maps canonical content to a bucket key. The buffer is reused; do not retain it. */
export type BucketHasher = (canonical: Float64Array | null, fieldsKey: string) => string;

// ---------------------------------------------------------------- intrinsics

// Captured at load so an instance cannot shadow `length`, its tag, or its buffer.
const TypedArrayPrototype = Object.getPrototypeOf(Int8Array.prototype) as object;
function intrinsicGetter(key: PropertyKey): (this: unknown) => unknown {
  const getter = Object.getOwnPropertyDescriptor(TypedArrayPrototype, key)?.get;
  if (typeof getter !== "function") throw new Error("typed array intrinsics unavailable");
  return getter as (this: unknown) => unknown;
}
const typedArrayTag = intrinsicGetter(Symbol.toStringTag);
const typedArrayLength = intrinsicGetter("length");
const typedArrayBuffer = intrinsicGetter("buffer");
const sharedByteLength = typeof SharedArrayBuffer === "function"
  ? Object.getOwnPropertyDescriptor(SharedArrayBuffer.prototype, "byteLength")?.get
  : undefined;
const BIGINT_TAGS: ReadonlySet<string> = new Set(["BigInt64Array", "BigUint64Array"]);

function typedTag(value: unknown): string | undefined {
  const tag = typedArrayTag.call(value);
  return typeof tag === "string" ? tag : undefined;
}

function isSharedBuffer(buffer: unknown): boolean {
  if (sharedByteLength === undefined) return false;
  try {
    sharedByteLength.call(buffer);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- input parsing

const MISSING: unique symbol = Symbol("missing");
const ACCESSOR: unique symbol = Symbol("accessor");

function readOwn(obj: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(obj, key);
  if (descriptor === undefined) return MISSING;
  if (!("value" in descriptor)) return ACCESSOR;
  return descriptor.value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || types.isProxy(value) || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

type Scalar = number | string | boolean;
type Vector = ArrayLike<number>;

interface Parsed {
  n: number;
  ids: string[];
  idField: string;
  compareFields: string[];
  /** Per row, raw scalar values in compareFields order. */
  fieldValues: Scalar[][];
  vectorSource: string | null;
  vectors: Vector[] | null;
  d: number;
  options: Record<string, unknown>;
  missingValues: MissingValuePolicy;
  missingPositions: number[][];
}

const CONTENT_KEYS: ReadonlySet<string> = new Set(["rows", "idField", "compareFields", "vectorOf", "tolerance", "missingValues", "minimumInformative"]);
const NEAR_KEYS: ReadonlySet<string> = new Set(["rows", "idField", "vectorOf", "threshold", "maxCandidatePairs", "missingValues"]);

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/** Reject proxies before reflective reads (even revoked proxies must not execute traps). */
function inertSnapshot(value: unknown): unknown {
  const seen = new Set<object>();
  const visit = (v: unknown): void => {
    if ((typeof v !== "object" || v === null) && typeof v !== "function") return;
    if (types.isProxy(v)) throw new Error("proxy evidence");
    const obj = v as object;
    if (seen.has(obj)) return;
    seen.add(obj);
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(obj))) {
      if ("value" in descriptor) visit(descriptor.value);
    }
  };
  visit(value);
  return snapshot(value);
}

/** Strict declaration shared with the pipeline; finite numeric values cannot become gaps. */
export function parseMissingValues(value: unknown): MissingValuePolicy {
  if (value === undefined) return { policy: "refuse" };
  const p = inertSnapshot(value);
  if (!isPlainObject(p)) throw new Error("invalid missingValues policy");
  if (p.policy === "refuse" && Object.keys(p).join() === "policy") return { policy: "refuse" };
  if (p.policy !== "token" || Object.keys(p).sort().join() !== "policy,tokens" ||
    !Array.isArray(p.tokens) || !p.tokens.length || p.tokens.length > 64 ||
    p.tokens.some(t => typeof t !== "string" || t.length > 1024 || (t !== "" && Number.isFinite(Number(t)))) ||
    new Set(p.tokens).size !== p.tokens.length) throw new Error("invalid missingValues token declaration");
  return { policy: "token", tokens: [...p.tokens] as string[] };
}

/** Copy arrays and callback-returned views; field views stay borrowed while no caller code runs. */
function readVector(raw: unknown, id: string, copyView: boolean, missing: MissingValuePolicy, positions: number[]): Vector | string {
  if (types.isProxy(raw)) return `vector for ${id} is a proxy`;
  const tag = typedTag(raw);
  if (tag !== undefined) {
    if (BIGINT_TAGS.has(tag)) return `vector for ${id} is a ${tag}; only number-valued vectors are supported`;
    const view = raw as Float64Array;
    if (isSharedBuffer(typedArrayBuffer.call(view))) {
      return `vector for ${id} uses shared memory; provide a synchronized private snapshot`;
    }
    if (copyView) {
      // A later callback may overwrite a reused scratch buffer without changing its length.
      const copy = new Float64Array(typedArrayLength.call(view) as number);
      copy.set(view);
      return copy;
    }
    return view;
  }
  if (!Array.isArray(raw)) return `vector for ${id} is ${describe(raw)}, not a number array or numeric typed array`;
  const length: unknown = raw.length;
  if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0) return `vector for ${id} has an invalid length`;
  let copy: Float64Array;
  try {
    copy = new Float64Array(length);
  } catch {
    return `vector for ${id} is too long to read`;
  }
  for (let i = 0; i < length; i += 1) {
    const value = readOwn(raw, String(i));
    if (value === ACCESSOR) return `vector for ${id} element ${i} must be a data property`;
    if (missing.policy === "token" && typeof value === "string" && missing.tokens.includes(value)) {
      // The separate position mask participates in both hashing and collision verification.
      // Zero is only an internal placeholder, never a replacement observation.
      positions.push(i); copy[i] = 0; continue;
    }
    if (typeof value !== "number") {
      return `vector for ${id} element ${i} is ${value === undefined || value === MISSING ? "missing" : describe(value)}, not a number`;
    }
    copy[i] = value;
  }
  return copy;
}

function vectorLength(vector: Vector): number {
  return typedTag(vector) !== undefined ? (typedArrayLength.call(vector) as number) : vector.length;
}

function parseInput(input: unknown, mode: "content" | "near", checkOptions: (options: Record<string, unknown>) => string | null): Parsed | string {
  if (!isPlainObject(input)) return "input must be a plain object";
  const allowed = mode === "content" ? CONTENT_KEYS : NEAR_KEYS;
  const options: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== "string") return "input has a symbol-keyed property";
    if (!allowed.has(key)) return `unknown input property "${key}"`;
    const value = readOwn(input, key);
    if (value === ACCESSOR) return `input property "${key}" must be a data property`;
    if (value !== undefined) options[key] = value;
  }

  let missingValues: MissingValuePolicy;
  try { missingValues = parseMissingValues(options.missingValues); } catch (error) { return error instanceof Error ? error.message : "invalid missingValues policy"; }
  const missingPositions: number[][] = [];
  const optionProblem = checkOptions(options);
  if (optionProblem !== null) return optionProblem;
  const idField = options.idField;
  if (!isName(idField)) return "idField must be a non-blank string";

  let compareFields: string[] = [];
  if (options.compareFields !== undefined) {
    let fields: unknown;
    try {
      fields = inertSnapshot(options.compareFields);
    } catch {
      return "compareFields must be a plain array of field names";
    }
    if (!Array.isArray(fields) || fields.length === 0) return "compareFields must be a non-empty array of field names";
    if (!fields.every(isName)) return "compareFields must contain only non-blank strings";
    if (new Set(fields).size !== fields.length) return "compareFields contains a repeated field";
    if (fields.includes(idField)) return "compareFields includes the idField; unique IDs would make every record distinct";
    compareFields = fields as string[];
  }

  const vectorOf = options.vectorOf;
  if (types.isProxy(vectorOf)) return "vectorOf must not be a proxy";
  let vectorSource: string | null = null;
  if (vectorOf !== undefined) {
    if (typeof vectorOf === "function") vectorSource = "function";
    else if (isName(vectorOf)) {
      if (vectorOf === idField) return "vectorOf names the idField";
      if (compareFields.includes(vectorOf)) return "vectorOf names a field that is also in compareFields";
      vectorSource = `field:${vectorOf}`;
    } else return "vectorOf must be a non-blank field name or a function";
  }
  if (mode === "near" && vectorSource === null) return "vectorOf is required for near-duplicate detection";
  if (vectorSource === null && compareFields.length === 0) return "declare what content to compare: compareFields and/or vectorOf";

  const rows = options.rows;
  if (types.isProxy(rows) || !Array.isArray(rows)) return "rows must be an array, not a proxy";
  const n: unknown = rows.length;
  if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 0) return "rows has an invalid length";
  if (n === 0) return "no rows: an empty input cannot establish the absence of duplicates";

  const ids: string[] = new Array<string>(n);
  const fieldValues: Scalar[][] = new Array<Scalar[]>(n);
  const vectors: Vector[] | null = vectorSource === null ? null : new Array<Vector>(n);
  const firstIndex = new Map<string, number>();
  const repeated: string[] = [];
  const sourceViews: Vector[] = [];
  let d = -1;

  for (let i = 0; i < n; i += 1) {
    const row = readOwn(rows, String(i));
    if (row === MISSING) return `row ${i} is missing (sparse rows array)`;
    if (row === ACCESSOR) return `row ${i} must be a data property`;
    if (!isPlainObject(row)) return `row ${i} must be a plain object, got ${describe(row)}`;

    const id = readOwn(row, idField);
    if (id === MISSING) return `row ${i} has no "${idField}" field`;
    if (id === ACCESSOR) return `row ${i}: "${idField}" must be a data property`;
    if (!isName(id)) return `row ${i}: "${idField}" must be a non-blank string, got ${describe(id)}`;
    if (firstIndex.has(id)) {
      if (repeated.length < 5) repeated.push(id);
    } else firstIndex.set(id, i);
    ids[i] = id;

    const values: Scalar[] = new Array<Scalar>(compareFields.length);
    for (let f = 0; f < compareFields.length; f += 1) {
      const field = compareFields[f]!;
      const value = readOwn(row, field);
      if (value === MISSING || value === undefined || value === null) {
        return `record ${id}: missing value for "${field}" (policy: missing values are rejected; encode missingness explicitly)`;
      }
      if (value === ACCESSOR) return `record ${id}: "${field}" must be a data property`;
      if (typeof value === "number") {
        if (!Number.isFinite(value)) return `record ${id}: "${field}" is ${value} (policy: NaN and Infinity are rejected)`;
      } else if (typeof value !== "string" && typeof value !== "boolean") {
        return `record ${id}: "${field}" has unsupported type ${describe(value)}`;
      }
      values[f] = value;
    }
    fieldValues[i] = values;

    if (vectors !== null) {
      let raw: unknown;
      if (typeof vectorOf === "function") {
        try {
          raw = (vectorOf as (row: Readonly<Record<string, unknown>>, index: number) => unknown)(row, i);
        } catch {
          return `vectorOf threw for record ${id}`;
        }
      } else {
        raw = readOwn(row, vectorOf as string);
        if (raw === MISSING) return `record ${id} has no "${vectorOf as string}" vector`;
        if (raw === ACCESSOR) return `record ${id}: "${vectorOf as string}" must be a data property`;
      }
      const positions: number[] = []; missingPositions.push(positions);
      const vector = readVector(raw, id, typeof vectorOf === "function", missingValues, positions);
      if (typeof vector === "string") return vector;
      if (typedTag(raw) !== undefined) sourceViews.push(raw as Vector);
      const length = vectorLength(vector);
      if (d < 0) d = length;
      if (length !== d) return `ragged vectors: record ${id} has ${length} values, expected ${d}`;
      vectors[i] = vector;
    }
  }
  if (repeated.length > 0) return `duplicate IDs: ${repeated.join(", ")}`;
  if (vectors !== null) {
    if (d === 0) return "vectors are empty; zero-length content cannot distinguish records";
    // No caller code runs after this point. Re-read lengths so a later vectorOf call that
    // resized an earlier row's buffer cannot leave stale or out-of-range elements in play.
    for (let i = 0; i < n; i += 1) {
      if (vectorLength(vectors[i]!) !== d) return `ragged vectors: record ${ids[i]!} changed length while rows were read`;
    }
    for (const source of sourceViews) {
      if (vectorLength(source) !== d) return "ragged vectors: a source changed length while rows were read";
    }
  }
  return { n, ids, idField, compareFields, fieldValues, vectorSource, vectors, d: Math.max(d, 0), options, missingValues, missingPositions };
}

// ---------------------------------------------------------------- canonical content

function quantize(x: number, tolerance: number): number {
  const q = Math.round(x / tolerance);
  return q === 0 ? 0 : q;
}

/** Injective JSON encoding of the (quantized) scalar fields; -0 and +0 encode alike. */
function fieldsKeyOf(values: readonly Scalar[], tolerance: number): string | null {
  if (values.length === 0) return "";
  const canonical: Scalar[] = new Array<Scalar>(values.length);
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i]!;
    if (typeof value === "number" && tolerance > 0) {
      const q = quantize(value, tolerance);
      if (!Number.isSafeInteger(q)) return null;
      canonical[i] = q;
    } else canonical[i] = value;
  }
  return JSON.stringify(canonical);
}

interface BadElement {
  index: number;
  kind: "non-finite" | "unrepresentable";
  value: number;
}

/** Copies a vector into `buf` as canonical doubles: +0 for zero, or quantized integers. */
function canonicalize(vector: Vector, buf: Float64Array, d: number, tolerance: number): BadElement | null {
  buf.set(vector);
  if (tolerance === 0) {
    for (let i = 0; i < d; i += 1) {
      const x = buf[i]!;
      if (x - x !== 0) return { index: i, kind: "non-finite", value: x };
      if (x === 0) buf[i] = 0;
    }
    return null;
  }
  for (let i = 0; i < d; i += 1) {
    const x = buf[i]!;
    if (x - x !== 0) return { index: i, kind: "non-finite", value: x };
    const q = Math.round(x / tolerance);
    if (!(q <= Number.MAX_SAFE_INTEGER && q >= -Number.MAX_SAFE_INTEGER)) return { index: i, kind: "unrepresentable", value: x };
    buf[i] = q === 0 ? 0 : q;
  }
  return null;
}

function sameVector(a: Vector, b: Vector, d: number, tolerance: number): boolean {
  if (a === b) return true;
  if (tolerance === 0) {
    for (let i = 0; i < d; i += 1) if (a[i] !== b[i]) return false; // -0 === +0
    return true;
  }
  for (let i = 0; i < d; i += 1) if (Math.round(a[i]! / tolerance) !== Math.round(b[i]! / tolerance)) return false;
  return true;
}

export const sha256Bucket: BucketHasher = (canonical, fieldsKey) => {
  const hash = createHash("sha256");
  if (canonical !== null) {
    hash.update(`v${canonical.length}:`);
    hash.update(new Uint8Array(canonical.buffer, canonical.byteOffset, canonical.byteLength));
  }
  hash.update(`|f:${fieldsKey}`);
  return hash.digest("base64");
};

interface Classes {
  /** Row index of the class representative (first row with that content) for every row. */
  classOf: Int32Array;
  fieldKeys: string[];
  buckets: number;
  verified: number;
  collisions: number;
}

/**
 * Buckets rows by hashed canonical content, then verifies each row against the class
 * representatives in its bucket. Equality (exact or of quantized values) is transitive, so
 * matching the representative verifies the row against every member of its class.
 */
function groupByContent(p: Parsed, tolerance: number, hasher: BucketHasher, ineligible = new Set<number>()): Classes | string {
  const fieldKeys: string[] = new Array<string>(p.n);
  for (let r = 0; r < p.n; r += 1) {
    const key = fieldsKeyOf(p.fieldValues[r]!, tolerance);
    if (key === null) return `record ${p.ids[r]!}: a compareFields value is too large for tolerance ${tolerance}`;
    fieldKeys[r] = p.missingValues.policy === "token" ? JSON.stringify([key, p.missingPositions[r] ?? []]) : key;
  }
  const buf = p.vectors === null ? null : new Float64Array(p.d);
  const keys: string[] = new Array<string>(p.n);
  for (let r = 0; r < p.n; r += 1) {
    if (buf !== null) {
      const bad = canonicalize(p.vectors![r]!, buf, p.d, tolerance);
      if (bad !== null) {
        return bad.kind === "non-finite"
          ? `record ${p.ids[r]!}: vector element ${bad.index} is ${bad.value} (policy: NaN and Infinity are rejected)`
          : `record ${p.ids[r]!}: vector element ${bad.index} (${bad.value}) is too large for tolerance ${tolerance}`;
      }
    }
    let key: unknown;
    try {
      key = hasher(buf, fieldKeys[r]!);
    } catch {
      return "bucket hash failed";
    }
    if (typeof key !== "string") return "bucket hash returned a non-string key";
    keys[r] = key;
  }

  const representatives = new Map<string, number[]>();
  const classOf = new Int32Array(p.n);
  let verified = 0;
  let collisions = 0;
  for (let r = 0; r < p.n; r += 1) {
    if (ineligible.has(r)) { classOf[r] = r; continue; }
    const key = keys[r]!;
    const list = representatives.get(key);
    if (list === undefined) {
      representatives.set(key, [r]);
      classOf[r] = r;
      continue;
    }
    let match = -1;
    for (const c of list) {
      verified += 1;
      if (fieldKeys[c] === fieldKeys[r] && (p.vectors === null || sameVector(p.vectors[c]!, p.vectors[r]!, p.d, tolerance))) {
        match = c;
        break;
      }
      collisions += 1;
    }
    if (match < 0) {
      list.push(r);
      classOf[r] = r;
    } else classOf[r] = match;
  }
  return { classOf, fieldKeys, buckets: representatives.size + ineligible.size, verified, collisions };
}

function membersByClass(classOf: Int32Array): number[][] {
  const members = new Map<number, number[]>();
  for (let r = 0; r < classOf.length; r += 1) {
    const c = classOf[r]!;
    const list = members.get(c);
    if (list === undefined) members.set(c, [r]);
    else list.push(r);
  }
  return [...members.values()];
}

const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const byFirstId = (a: readonly string[], b: readonly string[]): number => byString(a[0]!, b[0]!);

function maxSpread(p: Parsed, rows: readonly number[]): number {
  let spread = 0;
  if (p.vectors !== null) {
    for (let i = 0; i < p.d; i += 1) {
      let lo = Infinity;
      let hi = -Infinity;
      for (const r of rows) {
        const x = p.vectors[r]![i]!;
        if (x < lo) lo = x;
        if (x > hi) hi = x;
      }
      if (hi - lo > spread) spread = hi - lo;
    }
  }
  for (let f = 0; f < p.compareFields.length; f += 1) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const r of rows) {
      const x = p.fieldValues[r]![f];
      if (typeof x !== "number") break;
      if (x < lo) lo = x;
      if (x > hi) hi = x;
    }
    if (hi - lo > spread) spread = hi - lo;
  }
  return spread;
}

// ---------------------------------------------------------------- exact / rounded duplicates

function invalidContent(reason: string): ContentDuplicateReport {
  return { kind: "content-duplicates", status: "invalid", valid: false, checked: false, reason };
}

/**
 * Finds records with different IDs but identical (or identical-after-rounding) content.
 * Cost: one hashing pass over all values plus exact verification of bucket mates; never an
 * all-pairs comparison.
 */
export function detectContentDuplicates(input: ContentDuplicateInput): ContentDuplicateReport {
  return detectContentDuplicatesWithBucketHash(input, sha256Bucket);
}

/** Test seam (not exported from the package): a deterministic content hasher changes speed, never the groups. */
/** Software-owned eligibility floor, independent of model declarations. */
export const standardMissingMarkers = ["", "NA", "N/A", "NaN", "null", "[Not Available]", "[Unknown]", "[Not Applicable]"] as const;
const missingMarkerKeys = new Set(standardMissingMarkers.map(value => value.toLowerCase()));
export function isUninformative(value: unknown, tokens: readonly string[] = []): boolean {
  return typeof value === "string" && (missingMarkerKeys.has(value.trim().toLowerCase()) ||
    tokens.some(token => token.trim().toLowerCase() === value.trim().toLowerCase()));
}

export function detectContentDuplicatesWithBucketHash(input: ContentDuplicateInput, hasher: BucketHasher): ContentDuplicateReport {
  try {
    const parsed = parseInput(input, "content", (options) => {
      const t = options.tolerance;
      return typeof t === "number" && Number.isFinite(t) && t >= 0 ? null : "tolerance must be declared as a finite number >= 0 (0 = exact)";
    });
    if (typeof parsed === "string") return invalidContent(parsed);
    const tolerance = parsed.options.tolerance as number;
    const width = parsed.d + parsed.compareFields.length;
    const requested = parsed.options.minimumInformative;
    const threshold = requested === undefined ? { fields: Math.min(3, width), share: 0.5 } : requested;
    if (!isRecord(threshold) || Object.keys(threshold).sort().join() !== "fields,share" ||
      !Number.isSafeInteger(threshold.fields) || (threshold.fields as number) < 1 ||
      typeof threshold.share !== "number" || !Number.isFinite(threshold.share) || threshold.share <= 0 || threshold.share > 1)
      return invalidContent("invalid minimumInformative threshold");
    const information: ContentChecked["information"] = { minimumFields: threshold.fields as number,
      minimumShare: threshold.share, comparedFields: width, insufficient: [] };
    const ineligible = new Set<number>();
    for (let r = 0; r < parsed.n; r++) {
      const scalar = parsed.fieldValues[r]!.filter(value => !isUninformative(value, parsed.missingValues.policy === "token" ? parsed.missingValues.tokens : [])).length;
      const count = scalar + parsed.d - (parsed.missingPositions[r]?.length ?? 0);
      if (count < information.minimumFields || count / width < information.minimumShare) {
        ineligible.add(r);
        information.insufficient.push({ id: parsed.ids[r]!, rowIndex: r, informativeFields: count,
          reason: "insufficient information to establish duplication" });
      }
    }
    const classes = groupByContent(parsed, tolerance, hasher, ineligible);
    if (typeof classes === "string") return invalidContent(classes);

    const units = membersByClass(classes.classOf);
    const groups: ContentDuplicateGroup[] = units
      .filter((rows) => rows.length > 1)
      .map((rows) => ({
        ids: rows.map((r) => parsed.ids[r]!).sort(byString),
        rowIndices: rows,
        maxAbsDifference: tolerance === 0 ? 0 : maxSpread(parsed, rows),
      }))
      .sort((a, b) => byFirstId(a.ids, b.ids));
    const recordsInGroups = groups.reduce((sum, g) => sum + g.ids.length, 0);
    const counts: ContentDuplicateCounts = {
      records: parsed.n,
      uniqueUnits: units.length,
      duplicateGroups: groups.length,
      recordsInGroups,
      redundantRecords: parsed.n - units.length,
      hashBuckets: classes.buckets,
      verifiedComparisons: classes.verified,
      hashCollisions: classes.collisions,
    };
    const method = tolerance === 0 ? "exact" : "rounded";
    const basisText = [
      parsed.vectors !== null ? `vector ${parsed.vectorSource} (${parsed.d} values)` : "",
      parsed.compareFields.length > 0 ? `fields ${parsed.compareFields.join(", ")}` : "",
    ].filter(Boolean).join(" + ");
    const how = method === "exact" ? "exact match" : `match after rounding to ${tolerance}`;
    const base: ContentChecked = {
      information,
      kind: "content-duplicates",
      checked: true,
      reason: "",
      method,
      tolerance,
      policy: parsed.missingValues.policy === "token" ? { ...DUPLICATE_POLICY, missing: "token", tokens: parsed.missingValues.tokens, nearComparison: "not run", encoding: "canonical missing token at each vector position; no imputation" } : DUPLICATE_POLICY,
      basis: {
        idField: parsed.idField,
        compareFields: [...parsed.compareFields],
        vector: parsed.vectors === null ? null : { source: parsed.vectorSource!, length: parsed.d },
      },
      checkedIds: [...parsed.ids],
      groups,
      counts,
    };
    if (information.insufficient.length) return { ...base, status: "insufficient-information", valid: false,
      reason: `${information.insufficient.length} record(s): insufficient information to establish duplication; retained separately; ${groups.length} informative duplicate group(s)` };
    if (groups.length === 0) {
      return { ...base, status: "no-duplicates", valid: true, reason: `no content duplicates among ${parsed.n} records (${how} on ${basisText})` };
    }
    return {
      ...base,
      status: "duplicates-found",
      valid: false,
      reason: `${groups.length} duplicate group(s) under different IDs (${counts.redundantRecords} redundant of ${parsed.n} records; ${units.length} unique units) by ${how} on ${basisText}`,
    };
  } catch {
    return invalidContent("malformed input: reading it raised an exception");
  }
}

// ---------------------------------------------------------------- near duplicates

const SKETCH_DIMENSIONS = 1024;
const SKETCH_SEED = 0x4d0d;
/** Absolute slack on squared unit-vector distances; floating error here is ~1e-13. */
const SKETCH_SLACK = 1e-9;
const DEFAULT_THRESHOLD = 0.999;
const DEFAULT_MAX_CANDIDATES = 50_000;
// Values this close to the decision boundary cannot establish either outcome reliably.
const CORRELATION_SLACK = 1e-12;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function invalidNear(reason: string): NearDuplicateReport {
  return { kind: "near-duplicates", status: "invalid", valid: false, checked: false, reason };
}

function find(parent: Int32Array, x: number): number {
  let root = x;
  while (parent[root] !== root) root = parent[root]!;
  while (parent[x] !== root) {
    const next = parent[x]!;
    parent[x] = root;
    x = next;
  }
  return root;
}

/**
 * Flags pairs of distinct-content records whose Pearson correlation across all features
 * exceeds `threshold` (suspected technical replicates). Numerically identical vectors are
 * collapsed first and reported apart in `identicalGroups`.
 *
 * Search: each standardized vector u (mean 0, norm 1, so r = u·v) is projected with an
 * orthogonal projection P (random signed block sums over a seeded feature partition). Since
 * ||Pu - Pv|| <= ||u - v|| = sqrt(2 - 2r), a pair whose projected squared distance exceeds
 * 2(1 - threshold) provably has r < threshold and is skipped. Every surviving pair is then
 * verified with the full Pearson correlation. The filter has no false negatives; the seed
 * changes speed only.
 */
export function detectNearDuplicates(input: NearDuplicateInput): NearDuplicateReport {
  try {
    // Options hold only properties that were not undefined, so an explicit null is rejected.
    const optionOr = (options: Record<string, unknown>, key: string, fallback: number): unknown =>
      Object.hasOwn(options, key) ? options[key] : fallback;
    const parsed = parseInput(input, "near", (options) => {
      const t = optionOr(options, "threshold", DEFAULT_THRESHOLD);
      if (typeof t !== "number" || !Number.isFinite(t) || t <= 0 || t >= 1) return "threshold must be a finite number strictly between 0 and 1";
      const cap = optionOr(options, "maxCandidatePairs", DEFAULT_MAX_CANDIDATES);
      if (typeof cap !== "number" || !Number.isSafeInteger(cap) || cap < 1) return "maxCandidatePairs must be a positive safe integer";
      return null;
    });
    if (typeof parsed === "string") return invalidNear(parsed);
    if (parsed.missingValues.policy === "token") return invalidNear("not run: Pearson correlation under missingValues token policy is unsupported; exact comparison only");
    const threshold = optionOr(parsed.options, "threshold", DEFAULT_THRESHOLD) as number;
    const maxCandidates = optionOr(parsed.options, "maxCandidatePairs", DEFAULT_MAX_CANDIDATES) as number;
    const d = parsed.d;
    if (d < 3) return invalidNear(`vectors have ${d} values; correlation needs at least 3 features`);
    const vectors = parsed.vectors!;

    // 1. Collapse numerically identical vectors (verified exactly), representative = smallest ID.
    const classes = groupByContent(parsed, 0, sha256Bucket);
    if (typeof classes === "string") return invalidNear(classes);
    const units = membersByClass(classes.classOf);
    const reps: number[] = [];
    const identicalGroups: string[][] = [];
    for (const rows of units) {
      let rep = rows[0]!;
      for (const r of rows) if (byString(parsed.ids[r]!, parsed.ids[rep]!) < 0) rep = r;
      reps.push(rep);
      if (rows.length > 1) identicalGroups.push(rows.map((r) => parsed.ids[r]!).sort(byString));
    }
    reps.sort((a, b) => a - b);
    identicalGroups.sort(byFirstId);
    const m = reps.length;

    // 2. Shift before scaling to preserve small differences on large offsets. All subsequent
    // arithmetic uses bounded coordinates, so tiny squares cannot underflow and huge ones
    // cannot overflow. If the range itself overflows, scaling about zero is safe instead.
    const means = new Float64Array(m);
    const norms = new Float64Array(m);
    const origins = new Float64Array(m);
    const scales = new Float64Array(m);
    const undefinedRows: string[] = [];
    for (let k = 0; k < m; k += 1) {
      const x = vectors[reps[k]!]!;
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 0; i < d; i += 1) {
        if (x[i]! < lo) lo = x[i]!;
        if (x[i]! > hi) hi = x[i]!;
      }
      if (lo === hi) {
        if (undefinedRows.length < 5) undefinedRows.push(parsed.ids[reps[k]!]!);
        continue;
      }
      const range = hi - lo;
      const origin = Number.isFinite(range) ? lo : 0;
      const scale = Number.isFinite(range) ? range : Math.max(Math.abs(lo), Math.abs(hi));
      origins[k] = origin;
      scales[k] = scale;
      let sum = 0;
      let correction = 0;
      for (let i = 0; i < d; i += 1) {
        const value = (x[i]! - origin) / scale - correction;
        const next = sum + value;
        correction = (next - sum) - value;
        sum = next;
      }
      const mean = sum / d;
      let ss = 0;
      let squareCorrection = 0;
      for (let i = 0; i < d; i += 1) {
        const c = (x[i]! - origin) / scale - mean;
        const value = c * c - squareCorrection;
        const next = ss + value;
        squareCorrection = (next - ss) - value;
        ss = next;
      }
      const norm = Math.sqrt(ss);
      if (!(norm > 0) || !Number.isFinite(norm) || !Number.isFinite(mean)) {
        if (undefinedRows.length < 5) undefinedRows.push(parsed.ids[reps[k]!]!);
        continue;
      }
      means[k] = mean;
      norms[k] = norm;
    }
    if (undefinedRows.length > 0) {
      return invalidNear(`zero or unrepresentable variance, correlation undefined for: ${undefinedRows.join(", ")}`);
    }

    // 3. Orthogonal sketch: seeded partition of features into `dims` blocks with random signs.
    const dims = Math.min(d, SKETCH_DIMENSIONS);
    const random = mulberry32(SKETCH_SEED);
    const order = new Int32Array(d);
    for (let i = 0; i < d; i += 1) order[i] = i;
    for (let i = d - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      const t = order[i]!;
      order[i] = order[j]!;
      order[j] = t;
    }
    const blockOf = new Int32Array(d);
    const blockSize = new Int32Array(dims);
    for (let position = 0; position < d; position += 1) {
      const block = Math.floor((position * dims) / d);
      blockOf[order[position]!] = block;
      blockSize[block]! += 1;
    }
    const weight = new Float64Array(d);
    for (let i = 0; i < d; i += 1) weight[i] = (random() < 0.5 ? -1 : 1) / Math.sqrt(blockSize[blockOf[i]!]!);
    const sketch = new Float64Array(m * dims);
    for (let k = 0; k < m; k += 1) {
      const x = vectors[reps[k]!]!;
      const mean = means[k]!;
      const origin = origins[k]!;
      const scale = scales[k]!;
      const base = k * dims;
      for (let i = 0; i < d; i += 1) sketch[base + blockOf[i]!]! += weight[i]! * ((x[i]! - origin) / scale - mean);
      const inv = 1 / norms[k]!;
      for (let b = 0; b < dims; b += 1) sketch[base + b]! *= inv;
    }

    // 4. Provable filter, then exact Pearson verification of every surviving pair.
    const bound = 2 * (1 - threshold) + SKETCH_SLACK;
    const pairs: NearDuplicatePair[] = [];
    const parent = new Int32Array(m);
    for (let k = 0; k < m; k += 1) parent[k] = k;
    let candidates = 0;
    for (let a = 0; a < m; a += 1) {
      const baseA = a * dims;
      for (let b = a + 1; b < m; b += 1) {
        const baseB = b * dims;
        let acc = 0;
        for (let c = 0; c < dims; c += 1) {
          const diff = sketch[baseA + c]! - sketch[baseB + c]!;
          acc += diff * diff;
          if (acc > bound) break;
        }
        if (!Number.isFinite(acc)) return invalidNear("non-finite sketch distance");
        if (acc > bound) continue;
        candidates += 1;
        if (candidates > maxCandidates) {
          return invalidNear(`inconclusive: more than ${maxCandidates} candidate pairs passed the filter; raise maxCandidatePairs or the threshold`);
        }
        const x = vectors[reps[a]!]!;
        const y = vectors[reps[b]!]!;
        const mx = means[a]!;
        const my = means[b]!;
        const ox = origins[a]!;
        const oy = origins[b]!;
        const sx = scales[a]!;
        const sy = scales[b]!;
        let sxy = 0;
        let correction = 0;
        for (let i = 0; i < d; i += 1) {
          const value = ((x[i]! - ox) / sx - mx) * ((y[i]! - oy) / sy - my) - correction;
          const next = sxy + value;
          correction = (next - sxy) - value;
          sxy = next;
        }
        const rawCorrelation = sxy / (norms[a]! * norms[b]!);
        if (!Number.isFinite(rawCorrelation) || Math.abs(rawCorrelation) > 1 + CORRELATION_SLACK) return invalidNear("unrepresentable Pearson correlation");
        const r = Math.max(-1, Math.min(1, rawCorrelation));
        if (Math.abs(r - threshold) <= CORRELATION_SLACK) return invalidNear("inconclusive: Pearson correlation is within 1e-12 of threshold");
        if (!(r > threshold)) continue;
        const idA = parsed.ids[reps[a]!]!;
        const idB = parsed.ids[reps[b]!]!;
        const swap = byString(idB, idA) < 0;
        pairs.push({
          ids: swap ? [idB, idA] : [idA, idB],
          rowIndices: swap ? [reps[b]!, reps[a]!] : [reps[a]!, reps[b]!],
          correlation: r,
        });
        const ra = find(parent, a);
        const rb = find(parent, b);
        if (ra !== rb) parent[ra] = rb;
      }
    }
    pairs.sort((p, q) => byString(p.ids[0], q.ids[0]) || byString(p.ids[1], q.ids[1]));
    const components = new Map<number, string[]>();
    for (let k = 0; k < m; k += 1) {
      const root = find(parent, k);
      const list = components.get(root);
      if (list === undefined) components.set(root, [parsed.ids[reps[k]!]!]);
      else list.push(parsed.ids[reps[k]!]!);
    }
    const groups = [...components.values()].filter((g) => g.length > 1).map((g) => g.sort(byString)).sort(byFirstId);

    const base: NearChecked = {
      kind: "near-duplicates",
      checked: true,
      reason: "",
      method: "pearson",
      threshold,
      policy: DUPLICATE_POLICY,
      basis: { idField: parsed.idField, vector: { source: parsed.vectorSource!, length: d } },
      checkedIds: [...parsed.ids],
      pairs,
      groups,
      identicalGroups,
      counts: { records: parsed.n, distinctVectors: m, sketchDimensions: dims, candidatePairs: candidates, nearPairs: pairs.length },
    };
    const identicalNote = identicalGroups.length > 0
      ? `; ${identicalGroups.length} group(s) of numerically identical vectors were collapsed first (identicalGroups; exact duplicates belong to detectContentDuplicates)`
      : "";
    if (pairs.length === 0) {
      return {
        ...base,
        status: "no-near-duplicates",
        valid: identicalGroups.length === 0,
        reason: `no distinct-content pair with Pearson r > ${threshold} among ${parsed.n} records${identicalNote}`,
      };
    }
    return {
      ...base,
      status: "near-duplicates-found",
      valid: false,
      reason: `${pairs.length} suspected technical-replicate pair(s) with Pearson r > ${threshold} in ${groups.length} group(s)${identicalNote}`,
    };
  } catch {
    return invalidNear("malformed input: reading it raised an exception");
  }
}

// ---------------------------------------------------------------- effective units

function invalidUnits(reason: string): EffectiveUnitsResult {
  return { valid: false, effectiveN: null, reason };
}

function idList(value: unknown, label: string): string[] | string {
  if (!Array.isArray(value) || value.length === 0) return `${label} must be a non-empty array of IDs`;
  if (!value.every(isName)) return `${label} contains a blank or non-string ID`;
  if (new Set(value).size !== value.length) return `${label} contains a repeated ID`;
  return value as string[];
}

/** Validates merge sets against the report's checked IDs; `disjoint` sets may not share an ID. */
function mergeSets(value: unknown, label: string, checked: ReadonlySet<string>, size: "pair" | "group", disjoint: boolean): string[][] | string {
  if (!Array.isArray(value)) return `${label} must be an array`;
  const seen = new Set<string>();
  const sets: string[][] = [];
  for (const [index, entry] of value.entries()) {
    const ids: unknown = size === "pair" ? (isRecord(entry) ? entry.ids : undefined) : isRecord(entry) ? entry.ids : entry;
    const list = idList(ids, `${label}[${index}]`);
    if (typeof list === "string") return list;
    if (size === "pair" ? list.length !== 2 : list.length < 2) return `${label}[${index}] has the wrong number of IDs`;
    for (const id of list) {
      if (!checked.has(id)) return `${label}[${index}] names ${id}, which the report did not check`;
      if (disjoint) {
        if (seen.has(id)) return `${label} lists ${id} in more than one group`;
        seen.add(id);
      }
    }
    sets.push(list);
  }
  return sets;
}

const nonnegativeInteger = (x: unknown): x is number => typeof x === "number" && Number.isSafeInteger(x) && x >= 0;
const finiteNonnegative = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x) && x >= 0;
function sortedIds(ids: string[]): boolean {
  return ids.every((id, i) => i === 0 || byString(ids[i - 1]!, id) < 0);
}

/** Validate redundant report fields as well as the merge sets. This is consistency checking,
 * not authentication: callers still must obtain reports from the trusted checker. */
function reportProblem(report: Record<string, unknown>): string | null {
  const checkedIds = report.checkedIds as string[]; // checked by idList before this function
  const n = checkedIds.length;
  if (!isName(report.reason)) return "missing reason";
  const policy = report.policy;
  if (!isRecord(policy) || Object.entries(DUPLICATE_POLICY).some(([key, value]) => key !== "missing" && policy[key] !== value)) return "missing or unsupported policy";
  if (policy.missing === "token" && report.kind === "content-duplicates") {
    try { parseMissingValues({ policy: "token", tokens: policy.tokens }); } catch { return "missing or unsupported policy"; }
    if (policy.nearComparison !== "not run" || policy.encoding !== "canonical missing token at each vector position; no imputation") return "missing or unsupported policy";
  } else if (policy.missing !== "reject") return "missing or unsupported policy";
  const basis = report.basis;
  if (!isRecord(basis) || !isName(basis.idField)) return "missing or invalid basis";
  const vector = basis.vector;
  if (vector !== null && (!isRecord(vector) || !isName(vector.source) ||
      !(vector.source === "function" || (vector.source.startsWith("field:") && isName(vector.source.slice(6)) && vector.source.slice(6) !== basis.idField)) ||
      !nonnegativeInteger(vector.length) || vector.length === 0)) return "invalid vector basis";
  const counts = report.counts;
  if (!isRecord(counts) || counts.records !== n || Object.values(counts).some((x) => !nonnegativeInteger(x))) return "missing or invalid counts";
  const indicesMatch = (indices: unknown, ids: string[], ordered: boolean): boolean => {
    if (!Array.isArray(indices) || indices.length !== ids.length || new Set(indices).size !== indices.length ||
        indices.some((x) => !nonnegativeInteger(x) || x >= n)) return false;
    if (ordered) return indices.every((r, i) => checkedIds[r as number] === ids[i]);
    return indices.every((r, i) => i === 0 || (indices[i - 1] as number) < (r as number)) &&
      JSON.stringify(indices.map((r) => checkedIds[r as number]!).sort(byString)) === JSON.stringify(ids);
  };
  if (report.kind === "content-duplicates") {
    const info = report.information;
    if (!isRecord(info) || !nonnegativeInteger(info.minimumFields) || info.minimumFields < 1 ||
      typeof info.minimumShare !== "number" || !Number.isFinite(info.minimumShare) || info.minimumShare <= 0 || info.minimumShare > 1 ||
      !nonnegativeInteger(info.comparedFields) || info.comparedFields < 1 || !Array.isArray(info.insufficient)) return "missing or invalid information policy";
    const sparse = new Set<string>();
    for (const entry of info.insufficient) {
      if (!isRecord(entry) || typeof entry.id !== "string" || sparse.has(entry.id) ||
        !nonnegativeInteger(entry.rowIndex) || checkedIds[entry.rowIndex] !== entry.id ||
        !nonnegativeInteger(entry.informativeFields) || entry.informativeFields > info.comparedFields ||
        (entry.informativeFields >= info.minimumFields && entry.informativeFields / info.comparedFields >= info.minimumShare) ||
        entry.reason !== "insufficient information to establish duplication") return "invalid insufficient information entry";
      sparse.add(entry.id);
    }
    if ((report.status === "insufficient-information") !== (sparse.size > 0) || (sparse.size > 0 && report.valid !== false)) return "information status disagrees";
    if ((report.groups as { ids: string[] }[]).some(g => g.ids.some(id => sparse.has(id)))) return "insufficient information row cannot be merged";
    const t = report.tolerance;
    if (!finiteNonnegative(t) || report.method !== (t === 0 ? "exact" : "rounded")) return "missing or invalid tolerance/method";
    const fields = basis.compareFields;
    if (!Array.isArray(fields) || fields.some((f) => !isName(f) || f === basis.idField) || new Set(fields).size !== fields.length ||
        (vector === null && fields.length === 0) || (isRecord(vector) && fields.some((f) => `field:${f}` === vector.source))) return "invalid compareFields basis";
    if (info.comparedFields !== fields.length + (isRecord(vector) ? vector.length as number : 0)) return "information width disagrees with basis";
    const groups = report.groups as unknown[];
    let grouped = 0;
    for (const entry of groups) {
      if (!isRecord(entry)) return "content group must include IDs, row indices and spread";
      const ids = entry.ids as string[];
      if (!sortedIds(ids) || !indicesMatch(entry.rowIndices, ids, false)) return "content group IDs and row indices disagree";
      if (!finiteNonnegative(entry.maxAbsDifference) || (t === 0 ? entry.maxAbsDifference !== 0 : entry.maxAbsDifference / t > 1 + 8 * Number.EPSILON)) return "invalid content group spread";
      grouped += ids.length;
    }
    const redundant = grouped - groups.length;
    if (counts.uniqueUnits !== n - redundant || counts.duplicateGroups !== groups.length || counts.recordsInGroups !== grouped ||
        counts.redundantRecords !== redundant || !nonnegativeInteger(counts.hashBuckets) || counts.hashBuckets < 1 || counts.hashBuckets > n - redundant ||
        !nonnegativeInteger(counts.verifiedComparisons) || !nonnegativeInteger(counts.hashCollisions) ||
        counts.verifiedComparisons !== counts.hashCollisions + redundant || counts.verifiedComparisons > n * (n - 1) / 2) return "content counts disagree with groups";
    return null;
  }
  const threshold = report.threshold;
  if (report.method !== "pearson" || typeof threshold !== "number" || !Number.isFinite(threshold) || threshold <= 0 || threshold >= 1) return "invalid Pearson threshold/method";
  if (!isRecord(vector) || (vector.length as number) < 3) return "invalid Pearson vector basis";
  const identical = report.identicalGroups as string[][];
  const representative = new Map(checkedIds.map((id) => [id, id]));
  let redundant = 0;
  for (const ids of identical) {
    if (!Array.isArray(ids) || !sortedIds(ids)) return "identical group IDs must be a sorted array";
    for (const id of ids) representative.set(id, ids[0]!);
    redundant += ids.length - 1;
  }
  const pairs = report.pairs as Record<string, unknown>[];
  const pairKeys = new Set<string>();
  const positions = new Map(checkedIds.map((id, i) => [id, i]));
  const parent = Int32Array.from(checkedIds, (_, i) => i);
  const participating = new Set<string>();
  for (const pair of pairs) {
    const ids = pair.ids as [string, string];
    if (!sortedIds(ids) || ids.some((id) => representative.get(id) !== id) || !indicesMatch(pair.rowIndices, ids, true)) return "near pair IDs, representatives and row indices disagree";
    const key = JSON.stringify(ids);
    if (pairKeys.has(key)) return "repeated near pair";
    pairKeys.add(key);
    const r = pair.correlation;
    if (typeof r !== "number" || !Number.isFinite(r) || r > 1 || r - threshold <= CORRELATION_SLACK) return "invalid near pair correlation";
    const a = find(parent, positions.get(ids[0])!);
    const b = find(parent, positions.get(ids[1])!);
    parent[a] = b;
    for (const id of ids) participating.add(id);
  }
  const components = new Map<number, string[]>();
  for (const id of participating) {
    const root = find(parent, positions.get(id)!);
    const group = components.get(root);
    if (group === undefined) components.set(root, [id]);
    else group.push(id);
  }
  const expectedGroups = [...components.values()].map((g) => g.sort(byString)).sort(byFirstId);
  if (JSON.stringify(report.groups) !== JSON.stringify(expectedGroups)) return "near groups disagree with pair components";
  const m = n - redundant;
  if (counts.distinctVectors !== m || counts.nearPairs !== pairs.length || counts.sketchDimensions !== Math.min(vector.length as number, SKETCH_DIMENSIONS) ||
      !nonnegativeInteger(counts.candidatePairs) || counts.candidatePairs < pairs.length || counts.candidatePairs > m * (m - 1) / 2) return "near counts disagree with pairs/identical groups";
  return null;
}

/**
 * Collapses duplicate evidence into independent units before any n is reported. Exact groups,
 * identical-vector groups and near-duplicate pairs are merged transitively over every checked
 * record, then restricted to `ids`. Any invalid, inconsistent or non-covering evidence yields
 * `valid: false` and no n.
 */
export function effectiveUnits(
  evidence: DuplicateEvidence | readonly DuplicateEvidence[],
  options: EffectiveUnitsOptions = {},
): EffectiveUnitsResult {
  let reports: unknown;
  let opts: unknown;
  try {
    reports = inertSnapshot(evidence);
    opts = inertSnapshot(options);
  } catch {
    return invalidUnits("duplicate evidence must be plain data");
  }
  const list: unknown[] = Array.isArray(reports) ? reports : [reports];
  if (list.length === 0) return invalidUnits("no duplicate evidence supplied; effective n cannot be established");
  if (opts !== undefined && !isRecord(opts)) return invalidUnits("options must be an object");
  if (isRecord(opts) && Object.keys(opts).some((key) => key !== "ids")) return invalidUnits("unknown effectiveUnits option");

  const checkedSets: Set<string>[] = [];
  const merges: string[][] = [];
  let firstChecked: string[] = [];
  for (const [index, report] of list.entries()) {
    const label = `evidence[${index}]`;
    if (!isRecord(report)) return invalidUnits(`${label} is not a duplicate report`);
    const kind = report.kind;
    if (kind !== "content-duplicates" && kind !== "near-duplicates") return invalidUnits(`${label} has unknown kind`);
    if (report.status === "invalid" || report.checked !== true) {
      return invalidUnits(`${label} (${kind}) did not complete: ${typeof report.reason === "string" ? report.reason : "no reason given"}`);
    }
    const checkedIds = idList(report.checkedIds, `${label}.checkedIds`);
    if (typeof checkedIds === "string") return invalidUnits(checkedIds);
    const checked = new Set(checkedIds);
    if (index === 0) firstChecked = checkedIds;
    checkedSets.push(checked);

    if (kind === "content-duplicates") {
      if (report.status !== "no-duplicates" && report.status !== "duplicates-found" && report.status !== "insufficient-information") return invalidUnits(`${label} has unknown status`);
      const groups = mergeSets(report.groups, `${label}.groups`, checked, "group", true);
      if (typeof groups === "string") return invalidUnits(groups);
      if (report.status !== "insufficient-information" && ((report.status === "no-duplicates") !== (groups.length === 0) || report.valid !== (groups.length === 0))) {
        return invalidUnits(`${label} status, valid flag and groups disagree`);
      }
      merges.push(...groups);
    } else {
      if (report.status !== "no-near-duplicates" && report.status !== "near-duplicates-found") return invalidUnits(`${label} has unknown status`);
      const pairs = mergeSets(report.pairs, `${label}.pairs`, checked, "pair", false);
      if (typeof pairs === "string") return invalidUnits(pairs);
      const groups = mergeSets(report.groups, `${label}.groups`, checked, "group", true);
      if (typeof groups === "string") return invalidUnits(groups);
      const identical = mergeSets(report.identicalGroups, `${label}.identicalGroups`, checked, "group", true);
      if (typeof identical === "string") return invalidUnits(identical);
      if ((report.status === "no-near-duplicates") !== (pairs.length === 0) ||
          report.valid !== (pairs.length === 0 && identical.length === 0)) {
        return invalidUnits(`${label} status, valid flag and pairs disagree`);
      }
      merges.push(...pairs, ...groups, ...identical);
    }
  }

  let ids = firstChecked;
  if (isRecord(opts) && opts.ids !== undefined) {
    const requested = idList(opts.ids, "ids");
    if (typeof requested === "string") return invalidUnits(requested);
    ids = requested;
  }
  for (const [index, checked] of checkedSets.entries()) {
    const uncovered = ids.filter((id) => !checked.has(id));
    if (uncovered.length > 0) {
      return invalidUnits(`evidence[${index}] did not check ${uncovered.length} record(s), e.g. ${uncovered.slice(0, 5).join(", ")}`);
    }
  }
  for (const [index, report] of list.entries()) {
    const problem = reportProblem(report as Record<string, unknown>);
    if (problem !== null) return invalidUnits(`evidence[${index}]: ${problem}`);
  }

  const insufficient = new Set((list as ContentDuplicateReport[]).flatMap(report =>
    report.kind === "content-duplicates" && report.checked ? report.information.insufficient.map(row => row.id) : []));
  if (merges.some(group => group.some(id => insufficient.has(id)))) return invalidUnits("insufficient information row cannot be merged");

  // Merge over every checked record so transitivity through records outside `ids` holds.
  const universe = new Map<string, number>();
  for (const checked of checkedSets) for (const id of checked) if (!universe.has(id)) universe.set(id, universe.size);
  const parent = new Int32Array(universe.size);
  for (let i = 0; i < parent.length; i += 1) parent[i] = i;
  for (const set of merges) {
    const first = find(parent, universe.get(set[0]!)!);
    for (const id of set) {
      const root = find(parent, universe.get(id)!);
      if (root !== first) parent[root] = first;
    }
  }
  const unitsByRoot = new Map<number, string[]>();
  for (const id of ids) {
    const root = find(parent, universe.get(id)!);
    const unit = unitsByRoot.get(root);
    if (unit === undefined) unitsByRoot.set(root, [id]);
    else unit.push(id);
  }
  const units = [...unitsByRoot.values()];
  const merged = units.filter((u) => u.length > 1).length;
  return {
    valid: true,
    inputN: ids.length,
    effectiveN: units.length,
    collapsedRecords: ids.length - units.length,
    units,
    representatives: units.map((u) => u[0]!),
    reason: `effective n = ${units.length} of ${ids.length} records (${ids.length - units.length} redundant record(s) collapsed into ${merged} unit(s))`,
  };
}
