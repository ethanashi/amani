// Text folding shared by schema checks and the leak scan. Mirrors tools/scholarly.py `norm`:
// NFKC, dash and quote folding, invisible-character removal, whitespace collapse.

const DASHES = /[‐‑‒–—―−⁃﹣－]/g;
const SINGLE_QUOTES = /[‘’‚‛′]/g;
const DOUBLE_QUOTES = /[“”„]/g;
const SPACES = /[    ]/g;
const INVISIBLE = /[​-‏⁠﻿]/g;

export function foldText(s: string): string {
  return s
    .normalize("NFKC")
    .replace(DASHES, "-")
    .replace(SINGLE_QUOTES, "'")
    .replace(DOUBLE_QUOTES, '"')
    .replace(SPACES, " ")
    .replace(INVISIBLE, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:)\]])/g, "$1")
    .replace(/([(\[])\s+/g, "$1")
    .trim();
}

export function wordCount(s: string): number {
  const t = foldText(s);
  return t === "" ? 0 : t.split(" ").length;
}

const SIMPLE_ESCAPES: Record<string, string> = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", '"': '"', "'": "'", "/": "/", "\\": "\\" };

/**
 * Decode the escapes a leaked string can hide behind: JSON/JS `\uXXXX` (surrogate pairs included),
 * `\u{...}`, `\xHH`, simple backslash escapes, and HTML numeric/named-quote entities. Applied
 * repeatedly (up to 3 rounds) so double-escaped text (`\\u0065`) is decoded too.
 */
export function decodeEscapes(s: string): string {
  let out = s;
  for (let round = 0; round < 3; round++) {
    const next = out
      .replace(/\\+u\{([0-9a-fA-F]{1,6})\}/g, (_, h: string) => safeCodePoint(parseInt(h, 16)))
      .replace(/\\+u([0-9a-fA-F]{4})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
      .replace(/\\+x([0-9a-fA-F]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
      .replace(/&#x([0-9a-fA-F]{1,6});?/g, (_, h: string) => safeCodePoint(parseInt(h, 16)))
      .replace(/&#([0-9]{1,7});?/g, (_, d: string) => safeCodePoint(parseInt(d, 10)))
      .replace(/&(quot|apos|amp|lt|gt|nbsp);/g, (_, n: string) => ({ quot: '"', apos: "'", amp: "&", lt: "<", gt: ">", nbsp: " " })[n as "quot"])
      .replace(/\\([ntrbf"'\/\\])/g, (_, c: string) => SIMPLE_ESCAPES[c] ?? c);
    if (next === out) break;
    out = next;
  }
  return out;
}

function safeCodePoint(cp: number): string {
  return Number.isInteger(cp) && cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : " ";
}

/** Lower-case alphanumeric tokens after decoding escapes: the unit of the leak scan. */
export function tokens(s: string): string[] {
  const lower = decodeEscapes(s).normalize("NFKC").toLowerCase();
  // Same result as splitting on /[^\p{L}\p{N}]+/u, much faster: ASCII punctuation and spaces are
  // never letters or digits, so split on them first, then re-split only the runs that contain
  // non-ASCII characters with the Unicode-aware pattern.
  const out: string[] = [];
  for (const run of lower.split(/[^a-z0-9\u0080-\uffff]+/)) {
    if (run === "") continue;
    if (/[^\x00-\x7f]/.test(run)) {
      for (const t of run.split(/[^\p{L}\p{N}]+/u)) if (t !== "") out.push(t);
    } else out.push(run);
  }
  return out;
}

export function normalizeDoi(doi: string): string {
  return doi.trim().toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, "").replace(/^doi:\s*/, "");
}

/** Identity keys of a work: its normalised DOI and/or "pmid:N". */
export function workKeys(doi: string | null | undefined, pmid: string | null | undefined): string[] {
  const out: string[] = [];
  if (doi) out.push(normalizeDoi(doi));
  if (pmid) out.push(`pmid:${pmid.trim()}`);
  return out;
}

/** A related identifier as stored in rows: a DOI or "pmid:N". */
export function normalizeId(id: string): string {
  return id.startsWith("pmid:") ? `pmid:${id.slice(5).trim()}` : normalizeDoi(id);
}

/** Publishers retitle retracted works ("RETRACTED: ..."); a citation carries the original title. */
export function stripRetractionMarks(title: string): string {
  return title.replace(/^\s*(retracted(\s+article)?|withdrawn|retraction)\s*[:.\-]\s*/i, "").replace(/\s*\[(retracted|withdrawn)\]\s*$/i, "");
}
