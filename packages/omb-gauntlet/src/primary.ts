// outputs/primary.json and outputs/metrics.json: the numbers a software-run execution of the frozen
// code produced. Parsed leniently (aliases, numeric strings, a few shapes) with warnings. The
// MetricTable built here is the only source of numbers for decisions and for [m:key] prose.

import { IssueLog, type Issue } from "./issues.ts";
import { finite, foldKey, isRecord, normKey, parseLenientJson, pickField, readNumber } from "./json.ts";

export type Interval = readonly [number, number];

export interface PrimaryEntry {
  /** Case-folded block key (a claim's metric key). "*" for a single unkeyed block. */
  readonly key: string;
  readonly estimate: number | null;
  readonly ci: Interval | null;
  readonly p: number | null;
  readonly se: number | null;
  readonly nUnits: number | null;
  /** Source text of each number (for G3 display rounding), by field name. */
  readonly raw: Readonly<Record<string, string>>;
}

export interface PrimaryOutputs {
  readonly nUnits: number | null;
  readonly unit: string | null;
  readonly entries: ReadonlyMap<string, PrimaryEntry>;
}

export interface PrimaryParseResult {
  readonly primary: PrimaryOutputs | null;
  readonly issues: readonly Issue[];
}

const ENTRY_FIELDS = {
  estimate: ["est", "effect", "coef", "coefficient", "difference", "diff", "beta", "value", "pointestimate", "auc", "hr", "or"],
  ci: ["ci95", "confint", "confidenceinterval", "interval", "ci95pct"],
  ciLow: ["cilow", "cilower", "lower", "lo", "lcl", "ci95low", "ci95lower", "lowerci", "cil"],
  ciHigh: ["cihigh", "ciupper", "upper", "hi", "ucl", "ci95high", "ci95upper", "upperci", "ciu"],
  p: ["pvalue", "pval", "pvalueraw", "praw", "pvalue2sided"],
  se: ["stderr", "standarderror", "sem"],
  nUnits: ["n", "nanalysed", "nanalyzed", "nsubjects", "nunit", "samplesize", "nused"],
} as const;
const ENTRY_KEYS = new Set(["estimate", "ci", "p", "se", "nunits", ...Object.values(ENTRY_FIELDS).flat()].map(normKey));
const CONTAINERS = ["claims", "results", "primary", "tests", "estimates", "blocks"];

function looksLikeEntry(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && Object.keys(value).some((k) => ENTRY_KEYS.has(normKey(k)) && !isRecord(value[k]));
}

/** File-level unit count aliases (read from the top level of the file, never from a claim block). */
const FILE_COUNT_ALIASES = ["nunits", "n", "nanalysed", "nanalyzed", "samplesize", "neffective", "nunitstotal"] as const;
const FILE_COUNT_KEYS = new Set(["n_units", ...FILE_COUNT_ALIASES].map(normKey));

/** Keys whose value may legitimately be an object inside one entry: a CI given as {low, high}. */
const CI_KEYS = new Set(["ci", ...ENTRY_FIELDS.ci].map(normKey));

/** Nested claim blocks of an entry-looking container: records under any key but a CI field (a claim
 * id may collide with an alias such as "effect"). In results.json every record is a claim. */
function nestedBlocks(container: Record<string, unknown>, strict: boolean): string[] {
  return Object.keys(container).filter((k) => isRecord(container[k]) && !CI_KEYS.has(normKey(k)) && (strict || looksLikeEntry(container[k])));
}

function mixed(log: IssueLog, path: string, blocks: readonly string[]): void {
  log.error("mixed-container", path, `entry fields beside nested claim block(s) ${blocks.map((k) => JSON.stringify(k)).join(", ")}: it cannot be read as one block or as a map of claims without dropping numbers; none was used`);
}

function readP(value: unknown, log: IssueLog, path: string): number | null {
  if (typeof value === "string") {
    const m = /^\s*(<|<=|≤)\s*((?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*$/i.exec(value);
    if (m) {
      log.warn("p-bound", path, "a p-value bound is read as its upper bound (conservative)");
      const bound = Number(m[2]);
      return finite(bound) && bound >= 0 && bound <= 1 ? bound : null;
    }
  }
  const n = readNumber(value, log, path);
  if (n === null) return null;
  if (n < 0 || n > 1) {
    log.warn("invalid-p", path, "p-value outside [0, 1] treated as missing");
    return null;
  }
  return n;
}

function readInterval(value: unknown, log: IssueLog, path: string): Interval | null {
  let pair: unknown = value;
  if (typeof value === "string") {
    const m = /^\s*[[(]?\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*(?:,|;|to|–|—)\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*[\])]?\s*$/i.exec(value);
    if (!m) return null;
    log.warn("numeric-string", path, "interval text read as two numbers");
    pair = [Number(m[1]), Number(m[2])];
  }
  if (isRecord(pair)) {
    const lo = pickField(pair, "low", ["lower", "lo", "l"], log, path);
    const hi = pickField(pair, "high", ["upper", "hi", "u"], log, path);
    pair = [lo?.value, hi?.value];
  }
  if (!Array.isArray(pair) || pair.length !== 2) return null;
  const lo = readNumber(pair[0], log, `${path}[0]`);
  const hi = readNumber(pair[1], log, `${path}[1]`);
  if (lo === null || hi === null) return null;
  if (lo > hi) {
    log.warn("invalid-interval", path, "interval lower bound above upper bound; treated as missing");
    return null;
  }
  return [lo, hi];
}

function readEntry(key: string, obj: Record<string, unknown>, pointer: string, rawNumbers: ReadonlyMap<string, string>, log: IssueLog, path: string): PrimaryEntry {
  const raw: Record<string, string> = {};
  if(typeof obj.intervalMethod==='string')raw.intervalMethod=obj.intervalMethod;
  if(obj.pMethod!==undefined)raw.pMethod=typeof obj.pMethod==='string'?obj.pMethod:'invalid';
  const take = (name: string, hitKey: string | undefined, sub = "", value?: unknown) => {
    if (hitKey === undefined) return;
    const text = rawNumbers.get(`${pointer}/${hitKey.replaceAll("~", "~0").replaceAll("/", "~1")}${sub}`);
    if (text !== undefined) raw[name] = text;
    else if (typeof value === "string") raw[name] = value.trim();
  };
  const est = pickField(obj, "estimate", ENTRY_FIELDS.estimate, log, path);
  const ci = pickField(obj, "ci", ENTRY_FIELDS.ci, log, path);
  const lo = pickField(obj, "ci_low", ENTRY_FIELDS.ciLow, log, path);
  const hi = pickField(obj, "ci_high", ENTRY_FIELDS.ciHigh, log, path);
  const p = pickField(obj, "p", ENTRY_FIELDS.p, log, path);
  const se = pickField(obj, "se", ENTRY_FIELDS.se, log, path);
  const n = pickField(obj, "n_units", ENTRY_FIELDS.nUnits, log, path);
  let interval: Interval | null = null;
  if (ci) {
    interval = readInterval(ci.value, log, `${path}.ci`);
    const pair = Array.isArray(ci.value) ? ci.value : [];
    take("ci.0", ci.key, "/0", pair[0]);
    take("ci.1", ci.key, "/1", pair[1]);
    // Every CI representation is normalised and must say the same thing: a lone, malformed or
    // conflicting lower/upper bound next to a ci field is refused, never silently ignored.
    if (lo || hi) {
      const bounds = lo && hi ? readInterval([lo.value, hi.value], log, `${path}.ci_bounds`) : null;
      if (interval === null || bounds === null || bounds[0] !== interval[0] || bounds[1] !== interval[1]) {
        log.error("conflicting-interval", `${path}.ci`, `CI field ${JSON.stringify(ci.key)} and bound field(s) ${[lo?.key, hi?.key].filter((k) => k !== undefined).map((k) => JSON.stringify(k)).join(", ")} are lone, malformed or disagree; none was used`);
        interval = null;
      }
    }
  } else if (lo && hi) {
    interval = readInterval([lo.value, hi.value], log, `${path}.ci`);
    take("ci.0", lo.key, "", lo.value);
    take("ci.1", hi.key, "", hi.value);
  }
  take("estimate", est?.key, "", est?.value);
  take("p", p?.key, "", p?.value);
  take("se", se?.key, "", se?.value);
  take("n_units", n?.key, "", n?.value);
  let nUnits = n ? readNumber(n.value, log, `${path}.n_units`) : null;
  const countInvalid = n !== null && (nUnits === null || !Number.isInteger(nUnits) || nUnits < 0);
  if (nUnits !== null && (!Number.isInteger(nUnits) || nUnits < 0)) {
    log.warn("invalid-count", `${path}.n_units`, "n_units must be a non-negative integer; treated as missing");
    nUnits = null;
  }
  const estimate = est ? readNumber(est.value, log, `${path}.estimate`) : null;
  const seValue = se ? readNumber(se.value, log, `${path}.se`) : null;
  const pValue=p?readP(p.value,log,`${path}.p`):null;
  // A field that is present but unreadable is recorded, never silently dropped (a lone CI bound included).
  const invalid=[...(est&&estimate===null?['estimate']:[]),...((ci||lo||hi)&&interval===null?['ci']:[]),...(p&&pValue===null?['p']:[]),...(se&&(seValue===null||seValue<0)?['se']:[]),...(countInvalid?['n_units']:[])];
  if(invalid.length)raw.invalidNumbers=invalid.join(',');
  return {
    key, estimate, ci: interval, p: pValue,
    se: seValue !== null && seValue >= 0 ? seValue : null, nUnits, raw,
  };
}

export interface PrimaryParseOptions {
  /** results.json: the same parser, aliases and key folding, but every claim must bind. A claim
   * item without an id, or a claim that is not an object, is an error rather than a skipped block,
   * and every block of a claims map is a claim (with or without statistics). */
  readonly reported?: boolean;
}

/** Parse primary.json text or value. Accepted shapes: {claims|results: {id: block} | [{id, ...}]},
 * a top-level map of blocks, or a single unkeyed block (key "*"). */
export function parsePrimary(input: unknown, options: PrimaryParseOptions = {}): PrimaryParseResult {
  return parseBlocks(input, options).result;
}

function parseBlocks(input: unknown, options: PrimaryParseOptions): { result: PrimaryParseResult; value: unknown } {
  const log = new IssueLog();
  const file = options.reported ? "results" : "primary";
  let value = input;
  let rawNumbers: ReadonlyMap<string, string> = new Map();
  if (typeof input === "string") {
    const parsed = parseLenientJson(input, log, file);
    if (!parsed.ok) return { result: { primary: null, issues: log.items }, value: null };
    value = parsed.value;
    rawNumbers = parsed.rawNumbers;
  }
  if (!isRecord(value)) {
    log.error("not-an-object", file, `${file}.json must be a JSON object`);
    return { result: { primary: null, issues: log.items }, value };
  }
  const entries = new Map<string, PrimaryEntry>();
  const seen = new Set<string>();
  const add = (key: string, obj: Record<string, unknown>, pointer: string, path: string) => {
    const folded = foldKey(key);
    if (seen.has(folded)) {
      log.error("duplicate-block", path, `block ${JSON.stringify(folded)} appears twice (after case folding); neither is used`);
      entries.delete(folded);
      return;
    }
    seen.add(folded);
    entries.set(folded, readEntry(folded, obj, pointer, rawNumbers, log, path));
  };
  const strict = options.reported === true;
  const skip = (path: string, message: string) => strict ? log.error("unbound-claim", path, `${message}; its numbers cannot be compared`) : log.warn("ignored-value", path, `${message} ignored`);
  const container = pickField(value, "claims", CONTAINERS, log, file);
  if (container && Array.isArray(container.value)) {
    container.value.forEach((item, index) => {
      const path = `${file}.claims[${index}]`;
      if (!isRecord(item)) { skip(path, "block is not an object"); return; }
      const id = pickField(item, "id", ["claim", "claimid", "metric", "key", "name"], log, path);
      if (typeof id?.value !== "string" || !foldKey(id.value)) { skip(path, "block without an id"); return; }
      add(id.value, item, `/${container.key}/${index}`, path);
    });
  } else if (container && isRecord(container.value) && !looksLikeEntry(container.value)) {
    for (const [key, item] of Object.entries(container.value)) {
      if (looksLikeEntry(item) || strict && isRecord(item)) add(key, item as Record<string, unknown>, `/${container.key}/${key}`, `${file}.claims.${key}`);
      else if (strict) skip(`${file}.claims.${key}`, "claim is not an object");
      else log.warn("ignored-value", `primary.claims.${key}`, "block has no statistics");
    }
  } else if (container && looksLikeEntry(container.value)) {
    // Entry fields beside nested claim blocks: neither "one unkeyed block" nor "a map of claims" can
    // be read without dropping recognised numbers, so the container is refused.
    const nested = nestedBlocks(container.value, strict);
    if (nested.length > 0) mixed(log, `${file}.claims`, nested);
    else add("*", container.value, `/${container.key}`, file);
  } else if (container && strict) {
    skip(`${file}.claims`, "claims container is neither a list nor a map of claims");
  } else {
    const blocks = Object.entries(value).filter(([, item]) => looksLikeEntry(item));
    // results.json without a container: claim blocks beside top-level entry fields (other than the
    // file-level unit count, read below) are refused the same way.
    const topLevel = strict && blocks.length > 0 ? Object.keys(value).filter((k) => ENTRY_KEYS.has(normKey(k)) && !FILE_COUNT_KEYS.has(normKey(k)) && !isRecord(value[k])) : [];
    if (topLevel.length > 0) mixed(log, file, blocks.map(([k]) => k));
    else if (blocks.length > 0) for (const [key, item] of blocks) add(key, item as Record<string, unknown>, `/${key}`, `${file}.${key}`);
    else if (looksLikeEntry(value)) add("*", value, "", file);
  }
  const nHit = pickField(value, "n_units", FILE_COUNT_ALIASES, log, "primary");
  let nUnits = nHit ? readNumber(nHit.value, log, "primary.n_units") : null;
  if (nUnits !== null && (!Number.isInteger(nUnits) || nUnits < 0)) {
    log.warn("invalid-count", "primary.n_units", "n_units must be a non-negative integer; treated as missing");
    nUnits = null;
  }
  if (nUnits === null) {
    const counts = new Set([...entries.values()].map((e) => e.nUnits).filter((n): n is number => n !== null));
    const entry = entries.get("*");
    if (entry?.nUnits != null) nUnits = entry.nUnits;
    else if (counts.size === 1 && entries.size > 0 && [...entries.values()].every((e) => e.nUnits !== null)) {
      nUnits = [...counts][0]!;
      log.warn("default-applied", "primary.n_units", "top-level n_units taken from the blocks, which all agree");
    }
  }
  const unitHit = pickField(value, "unit", ["unitofanalysis", "units"], log, "primary");
  const unit = typeof unitHit?.value === "string" && unitHit.value.length ? unitHit.value : null;
  if (entries.size === 0) log.warn("no-blocks", file, `${file}.json has no statistics blocks`);
  return { result: { primary: log.errorCount > 0 ? null : { nUnits, unit, entries }, issues: log.items }, value };
}

export interface ReportedParseResult {
  /** absent: no results.json. invalid: unparseable even leniently, ambiguous, a duplicate claim id
   * after key folding, or a claim that cannot be bound. Invalid fails G3 closed for every claim. */
  readonly status: "absent" | "ok" | "invalid";
  /** Worker-reported claim blocks, keyed by folded claim id ("*" for one unkeyed block). */
  readonly reported: PrimaryOutputs | null;
  /** The leniently parsed JSON value (for overwriting worker statuses), or null. */
  readonly value: unknown;
  readonly issues: readonly Issue[];
}

/** A results.json that exists but was refused before parsing (symlink or not a regular file, over
 * the size cap, unreadable). It is invalid, never absent. */
export interface ReportedRefusal { readonly refused: string }

/** results.json through the primary.json parser: one alias table, one key folding, lenient format
 * (BOM, fences, comments, trailing commas, NaN tokens as null) and strict binding. null means the
 * file does not exist; a refusal fails G3 closed exactly like an unparseable file. */
export function parseReported(input: string | null | ReportedRefusal): ReportedParseResult {
  if (input === null) return { status: "absent", reported: null, value: null, issues: [] };
  if (typeof input !== "string") return { status: "invalid", reported: null, value: null, issues: [{ severity: "error", code: "refused-file", path: "results", message: `results.json refused: ${input.refused}` }] };
  const { result, value } = parseBlocks(input, { reported: true });
  return result.primary === null ? { status: "invalid", reported: null, value, issues: result.issues }
    : { status: "ok", reported: result.primary, value, issues: result.issues };
}

/** One claim object read with the primary.json alias table (estimate, ci, p, se, n_units). */
export function readClaimEntry(obj: Record<string, unknown>, log: IssueLog, rawNumbers: ReadonlyMap<string, string> = new Map(), pointer = ""): PrimaryEntry {
  return readEntry("*", obj, pointer, rawNumbers, log, "claim");
}

/** Resolve a claim's block: exact case-folded key, then the
 * single unkeyed block when the plan has exactly one claim that needs it. */
export function findEntry(primary: PrimaryOutputs | null, metric: string, allowSingle: boolean): PrimaryEntry | null {
  if (primary === null) return null;
  const exact = primary.entries.get(foldKey(metric));
  if (exact) return exact;
  if (allowSingle && primary.entries.size === 1) return primary.entries.get("*") ?? null;
  return null;
}

// ------------------------------------------------------------------ metric table

export type MetricValue = number | Interval;

export interface MetricTable {
  readonly values: ReadonlyMap<string, MetricValue>;
  /** Keys reported with two different values by different sources; never rendered. */
  readonly ambiguous: ReadonlySet<string>;
}

export function emptyMetrics(): MetricTable {
  return { values: new Map(), ambiguous: new Set() };
}

function flatten(value: unknown, prefix: string, out: [string, MetricValue][], depth: number): void {
  if (depth > 16) return;
  if (finite(value)) { if (prefix) out.push([prefix, value]); return; }
  if (Array.isArray(value)) {
    if (value.length === 2 && finite(value[0]) && finite(value[1]) && value[0] <= value[1] && prefix) out.push([prefix, [value[0], value[1]]]);
    value.forEach((item, index) => flatten(item, prefix ? `${prefix}.${index}` : String(index), out, depth + 1));
    return;
  }
  if (isRecord(value)) for (const [key, child] of Object.entries(value)) flatten(child, prefix ? `${prefix}.${foldKey(key)}` : foldKey(key), out, depth + 1);
}

export interface MetricSources {
  /** Parsed metrics.json (software-run). */
  readonly metrics?: unknown;
  readonly primary?: PrimaryOutputs | null;
  /** Software-derived values (adjusted p, effective alpha), keyed "<claim>.p_adjusted" etc. */
  readonly derived?: Readonly<Record<string, MetricValue>>;
}

/** Build the table of software numbers. Keys are case-folded dotted paths. */
export function buildMetricTable(sources: MetricSources): MetricTable {
  const values = new Map<string, MetricValue>();
  const ambiguous = new Set<string>();
  const put = (key: string, value: MetricValue) => {
    const k = foldKey(key);
    const prior = values.get(k);
    if (prior !== undefined && JSON.stringify(prior) !== JSON.stringify(value)) ambiguous.add(k);
    else values.set(k, value);
  };
  const fromMetrics: [string, MetricValue][] = [];
  flatten(sources.metrics, "", fromMetrics, 0);
  for (const [k, v] of fromMetrics) put(k, v);
  if (sources.primary) {
    if (sources.primary.nUnits !== null) put("n_units", sources.primary.nUnits);
    for (const e of sources.primary.entries.values()) {
      const base = e.key === "*" ? "primary" : e.key;
      if (e.estimate !== null) put(`${base}.estimate`, e.estimate);
      if (e.ci !== null) { put(`${base}.ci`, e.ci); put(`${base}.ci.0`, e.ci[0]); put(`${base}.ci.1`, e.ci[1]); }
      if (e.p !== null) put(`${base}.p`, e.p);
      if (e.se !== null) put(`${base}.se`, e.se);
      if (e.nUnits !== null) put(`${base}.n_units`, e.nUnits);
    }
  }
  for (const [k, v] of Object.entries(sources.derived ?? {})) put(k, v);
  for (const k of ambiguous) values.delete(k);
  return { values, ambiguous };
}
