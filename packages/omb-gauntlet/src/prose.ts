// Numbers in prose (design section 3, omb-report): every number a model writes must be a reference
// [m:key] to a software-recomputed metric; the renderer inserts the value. A number typed into prose
// is flagged and stripped (a repair turn, never a run-ending error). Identifiers that contain digits
// (ESR1, IL-6, G5a, log2_fc, code/01_prepare.py), DOIs/PMIDs, ISO dates, citation years, list and
// heading numbering, integer citation markers and the phrase "95% CI" are not result numbers.

import { foldKey } from "./json.ts";
import type { MetricTable, MetricValue } from "./primary.ts";

export interface TypedNumber {
  readonly text: string;
  readonly index: number;
  /** 1-based line and column. */
  readonly line: number;
  readonly column: number;
}

export interface ProseIssue {
  readonly kind: "typed-number" | "unknown-metric" | "ambiguous-metric";
  readonly text: string;
  readonly line: number;
  readonly column: number;
  readonly key?: string;
}

export interface RenderedProse {
  readonly text: string;
  readonly issues: readonly ProseIssue[];
  /** Case-folded metric keys referenced and rendered. */
  readonly references: readonly string[];
}

export const REFERENCE = /\[m:([A-Za-z0-9_.\-]+)\]/gi;

const ALLOWED_SPANS: readonly RegExp[] = [
  /\[m:[^\]\s]*\]/gi,
  /\bhttps?:\/\/[^\s)>\]]+/gi,
  /\b(?:doi:\s*)?10\.\d{4,9}\/[^\s"'<>)\]]+/gi,
  /\bPMID:?\s*\d+/gi,
  /\b(?:19|20)\d{2}-\d{2}-\d{2}\b/g,
  /\bet al\.?,?\s*\(?(?:19|20)\d{2}[a-z]?\)?/gi,
  /\((?:[A-Z][\p{L}'’-]+(?:\s+et al\.?|\s+(?:and|&)\s+[A-Z][\p{L}'’-]+)?,?\s+)?(?:19|20)\d{2}[a-z]?\)/gu,
  /\b(?:90|95|99)\s?%\s*(?:CI|confidence|credible)\b/gi,
  /^[ \t]*\d{1,3}[.)](?=\s)/gm,
  /^#{1,6}[ \t]*[1-9]\d*(?:\.[1-9])*\.?(?=\s+[A-Z][a-z]{2})/gm,
  /\[\d{1,3}(?:\s*[,–-]\s*\d{1,3})*\]/g,
];

const NUMBER = /(?<![A-Za-z0-9_.])[-+−]?(?:\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+)(?:[eE][-+]?\d+)?%?/g;

function lineAndColumn(text: string, index: number): { line: number; column: number } {
  let line = 1;
  let last = -1;
  for (let i = 0; i < index; i += 1) if (text.charCodeAt(i) === 10) { line += 1; last = i; }
  return { line, column: index - last };
}

function isIdentifier(text: string, start: number, end: number): boolean {
  const body = text.slice(start, end).replace(/^[-+−]/, "");
  const offset = end - start - body.length;
  const s = start + offset;
  const before = text.slice(Math.max(0, s - 2), s);
  if (/\p{L}$/u.test(before) || /\p{L}[-_]$/u.test(before)) return true;
  if (/^_\p{L}/u.test(text.slice(end, end + 2))) return true;
  if (/^(?:[1-9]|10)$/.test(body) && /^(?:st|nd|rd|th)\b/.test(text.slice(end, end + 3))) return true;
  // path-like word containing a letter and a slash (code/01/step.py)
  let a = s;
  let b = end;
  while (a > 0 && !/\s/.test(text[a - 1]!)) a -= 1;
  while (b < text.length && !/\s/.test(text[b]!)) b += 1;
  const word = text.slice(a, b).replace(/^[("'`[{<]+|[)"'`\]}>,;:.!?]+$/g, "");
  return !/^[+−-]?(?:\d|\.\d)/.test(word) && /[/\\]/.test(word) && /\p{L}/u.test(word);
}

export function findTypedNumbers(text: string): TypedNumber[] {
  const masked = new Array<boolean>(text.length).fill(false);
  for (const pattern of ALLOWED_SPANS) {
    for (const m of text.matchAll(new RegExp(pattern.source, pattern.flags))) {
      for (let i = m.index; i < m.index + m[0].length; i += 1) masked[i] = true;
    }
  }
  const out: TypedNumber[] = [];
  for (const m of text.matchAll(new RegExp(NUMBER.source, NUMBER.flags))) {
    const start = m.index;
    const end = start + m[0].length;
    let anyMasked = false;
    for (let i = start; i < end; i += 1) if (masked[i]) { anyMasked = true; break; }
    if (anyMasked || isIdentifier(text, start, end)) continue;
    out.push({ text: m[0], index: start, ...lineAndColumn(text, start) });
  }
  return out;
}

function trimMantissa(s: string): string {
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
}

/** Deterministic software formatting: integers verbatim, otherwise four significant digits. */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "NA";
  const v = Object.is(value, -0) ? 0 : value;
  if (Number.isInteger(v) && Math.abs(v) < 1e15) return String(v);
  const a = Math.abs(v);
  if (a >= 1e3 && a < 1e15) return String(Math.round(v));
  if (a >= 1e-3) return trimMantissa(v.toPrecision(4));
  const [mantissa, exponent] = v.toExponential(3).split("e");
  return `${trimMantissa(mantissa!)}e${Number(exponent)}`;
}

export function formatMetric(value: MetricValue): string {
  return typeof value === "number" ? formatNumber(value) : `[${formatNumber(value[0])}, ${formatNumber(value[1])}]`;
}

/** Replace [m:key] references with software values; strip and flag typed numbers. */
export function renderProse(text: string, metrics: MetricTable): RenderedProse {
  const issues: ProseIssue[] = [];
  const references: string[] = [];
  const edits: { start: number; end: number; replacement: string }[] = [];
  for (const m of text.matchAll(new RegExp(REFERENCE.source, REFERENCE.flags))) {
    const key = foldKey(m[1]!);
    const at = lineAndColumn(text, m.index);
    const value = metrics.values.get(key);
    if (value !== undefined) {
      edits.push({ start: m.index, end: m.index + m[0].length, replacement: formatMetric(value) });
      if (!references.includes(key)) references.push(key);
    } else if (metrics.ambiguous.has(key)) {
      edits.push({ start: m.index, end: m.index + m[0].length, replacement: `[ambiguous metric: ${key}]` });
      issues.push({ kind: "ambiguous-metric", text: m[0], key, ...at });
    } else {
      edits.push({ start: m.index, end: m.index + m[0].length, replacement: `[unavailable metric: ${key}]` });
      issues.push({ kind: "unknown-metric", text: m[0], key, ...at });
    }
  }
  for (const t of findTypedNumbers(text)) {
    edits.push({ start: t.index, end: t.index + t.text.length, replacement: "[unverified number]" });
    issues.push({ kind: "typed-number", text: t.text, line: t.line, column: t.column });
  }
  edits.sort((a, b) => a.start - b.start);
  let out = "";
  let cursor = 0;
  for (const e of edits) {
    if (e.start < cursor) continue;
    out += text.slice(cursor, e.start) + e.replacement;
    cursor = e.end;
  }
  out += text.slice(cursor);
  issues.sort((a, b) => a.line - b.line || a.column - b.column);
  return { text: out, issues, references };
}
