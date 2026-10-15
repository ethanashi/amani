// Lenient JSON reading for worker-written files ("fail soft on format"). Accepts a BOM, a fenced
// ```json block, // and /* */ comments, trailing commas and Python's bare NaN/Infinity tokens,
// each with a warning. Captures the source text of every number (JSON.parse source access, Node 24)
// so display-rounding comparisons (G3) can see "0.500" rather than 0.5.

import { IssueLog } from "./issues.ts";

export type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };

export interface ParsedJson {
  /** null when the text could not be parsed even leniently (an error issue is recorded). */
  readonly value: unknown;
  readonly ok: boolean;
  /** Source text of each number, keyed by JSON pointer ("" root, "/claims/0/estimate"). */
  readonly rawNumbers: ReadonlyMap<string, string>;
}

class RawNumber {
  readonly value: number;
  readonly raw: string;
  constructor(value: number, raw: string) { this.value = value; this.raw = raw; }
}

type SourceReviver = (this: unknown, key: string, value: unknown, context?: { source?: string }) => unknown;

function parseWithSource(text: string): unknown {
  // JSON.parse validates grammar; this token walk preserves decoded object-key identity.
  JSON.parse(text);
  const stack: (Set<string> | null)[] = [];
  const tokens = text.match(/"(?:\\.|[^"\\])*"|[{}\[\]:,]|[^\s{}\[\]:,]+/g) ?? [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (token === "{") stack.push(new Set());
    else if (token === "[") stack.push(null);
    else if (token === "}" || token === "]") stack.pop();
    else if (token.startsWith('"') && tokens[i + 1] === ":") {
      const key = JSON.parse(token) as string;
      const keys = stack.at(-1);
      if (keys?.has(key)) throw new Error("duplicate JSON key");
      keys?.add(key);
    }
  }
  const reviver: SourceReviver = (_key, value, context) =>
    typeof value === "number" ? new RawNumber(value, context?.source ?? String(value)) : value;
  return JSON.parse(text, reviver as (this: unknown, key: string, value: unknown) => unknown);
}

function pointerEscape(key: string): string {
  return key.replaceAll("~", "~0").replaceAll("/", "~1");
}

function unwrap(value: unknown, pointer: string, raw: Map<string, string>): unknown {
  if (value instanceof RawNumber) {
    raw.set(pointer, value.raw);
    return value.value;
  }
  if (Array.isArray(value)) return value.map((item, index) => unwrap(item, `${pointer}/${index}`, raw));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = Object.create(null);
    for (const [key, child] of Object.entries(value)) out[key] = unwrap(child, `${pointer}/${pointerEscape(key)}`, raw);
    return out;
  }
  return value;
}

/** Remove comments, trailing commas and bare NaN/Infinity outside strings. */
function sanitize(text: string): { text: string; changes: string[] } {
  const changes = new Set<string>();
  let out = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (ch === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i += 1;
      out += " ";
      changes.add("comments");
      continue;
    }
    if (ch === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? text.length : end + 2;
      out += " ";
      changes.add("comments");
      continue;
    }
    const bare = /^-?(?:NaN|Infinity)\b/.exec(text.slice(i, i + 9));
    if (bare && !/[A-Za-z0-9_]/.test(out.at(-1) ?? "")) {
      out += "null";
      i += bare[0].length;
      changes.add("NaN/Infinity tokens read as null");
      continue;
    }
    if (ch === ",") {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j]!)) j += 1;
      if (text[j] === "}" || text[j] === "]") {
        i += 1;
        changes.add("trailing commas");
        continue;
      }
    }
    out += ch;
    i += 1;
  }
  return { text: out, changes: [...changes] };
}

const FENCE = /^```[a-zA-Z0-9_-]*[ \t]*\r?\n([\s\S]*?)\r?\n```\s*$/;

export function parseLenientJson(input: string, log: IssueLog, path = "$"): ParsedJson {
  let text = input;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  text = text.trim();
  const fenced = FENCE.exec(text);
  if (fenced) {
    text = fenced[1]!.trim();
    log.warn("lenient-json", path, "read JSON from a fenced code block");
  }
  const raw = new Map<string, string>();
  try {
    return { value: unwrap(parseWithSource(text), "", raw), ok: true, rawNumbers: raw };
  } catch {
    // fall through to the lenient pass
  }
  const cleaned = sanitize(text);
  try {
    const value = unwrap(parseWithSource(cleaned.text), "", raw);
    log.warn("lenient-json", path, `accepted non-standard JSON (${cleaned.changes.join(", ") || "whitespace"})`);
    return { value, ok: true, rawNumbers: raw };
  } catch {
    log.error("unparseable-json", path, "not parseable as JSON, even leniently");
    return { value: null, ok: false, rawNumbers: new Map() };
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Alias-matching form of a key: NFKC, lower case, letters and digits only. */
export function normKey(key: string): string {
  return key.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Claim IDs and metric keys are case-folded and trimmed (CONTRACT v2: files are the contract).
 * Invisible format characters (zero-width space/joiners, word joiner, BOM, soft hyphen: Unicode Cf)
 * are removed and whitespace runs collapse, so one key cannot hide behind an invisible variant. */
export function foldKey(key: string): string {
  return key.normalize("NFKC").replace(/\p{Cf}/gu, "").trim().replace(/\s+/g, " ").toLowerCase();
}

/** Compact enum form: lower case without whitespace, hyphens, underscores or dots. */
export function compactEnum(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[\s_.\-]+/g, "");
}

export function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Read a number leniently: finite numbers, or numeric strings (with a warning). */
export function readNumber(value: unknown, log: IssueLog, path: string): number | null {
  if (finite(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(trimmed)) {
      log.warn("numeric-string", path, "numeric string read as a number");
      return Number.isFinite(Number(trimmed)) ? Number(trimmed) : null;
    }
  }
  return null;
}

export interface FieldHit {
  readonly key: string;
  readonly value: unknown;
}

/**
 * Find a field by alias. Case, whitespace, hyphen/underscore and camelCase variants match; a
 * non-canonical spelling is accepted with a warning. Conflicting canonical names or
 * aliases are rejected. Two spellings with different values
 * are an ambiguity error, and the field is then treated as absent.
 */
export function pickField(
  obj: Record<string, unknown>,
  canonical: string,
  aliases: readonly string[],
  log: IssueLog,
  path: string,
): FieldHit | null {
  const canonicalForm = normKey(canonical);
  const aliasForms = new Set(aliases.map(normKey));
  aliasForms.delete(canonicalForm);
  const primary = Object.keys(obj).filter((key) => normKey(key) === canonicalForm);
  const secondary = Object.keys(obj).filter((key) => aliasForms.has(normKey(key)));
  const hits = [...primary, ...secondary];
  if (hits.length === 0) return null;
  const values = new Set(hits.map((key) => stableText(obj[key])));
  if (values.size > 1) {
    log.error("ambiguous-field", `${path}.${canonical}`, `fields ${hits.map((k) => JSON.stringify(k)).join(", ")} disagree; none was used`);
    return null;
  }
  const key = hits.includes(canonical) ? canonical : hits[0]!;
  if (key !== canonical) log.warn("alias-field", `${path}.${canonical}`, `field ${JSON.stringify(key)} read as ${JSON.stringify(canonical)}`);
  return { key, value: obj[key] };
}

function stableText(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableText).join(",")}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableText(value[k])}`).join(",")}}`;
  return JSON.stringify(value) ?? "undefined";
}

/** Recognised keys of an object (normalised) so callers can report the rest as unknown. */
export function unknownKeys(obj: Record<string, unknown>, known: readonly string[]): string[] {
  const set = new Set(known.map(normKey));
  return Object.keys(obj).filter((key) => !set.has(normKey(key)));
}

/** Convert unknown model JSON into a canonical-JSON-safe value (non-finite numbers become null). */
export function toJson(value: unknown, depth = 0): Json {
  if (depth > 32) return null;
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map((item) => toJson(item, depth + 1));
  if (isRecord(value)) {
    const out: Record<string, Json> = Object.create(null);
    for (const key of Object.keys(value).sort()) {
      const child = value[key];
      if (child !== undefined) out[key] = toJson(child, depth + 1);
    }
    return out;
  }
  return null;
}
