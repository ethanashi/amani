// Leak scan: proves no private row appears in plaintext in the repository.
//
// Keyless mode (always runs, no key needed): the build commits salted 53-bit fingerprints of
// every 10-token shingle of each private row's manuscript sentence and plant (text this builder
// wrote, so the fingerprints are no oracle for guessable text). Verbatim source quotes are NOT
// fingerprinted: a public fingerprint of a paper's sentence would let anyone test candidate
// papers against the hold-out. Keyed mode (runs when the sealing key is present): decrypts the
// private split in memory and scans for every private id, DOI, sentence, quote and evidence text.

import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { decodeEscapes, normalizeDoi, tokens } from "./normalize.ts";
import type { SuiteRow } from "./types.ts";

export const SHINGLE = 10;
/** The keyed scan holds plaintext needles in memory only, so it can afford the 8-word anchor minimum. */
export const KEYED_SHINGLE = 8;

function fnv(token: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

function seeds(salt: string): [number, number] {
  return [fnv(salt, 0x811c9dc5), fnv(salt + "\u0001", 0x9747b28c)];
}

// Tokenising the repository is the dominant cost and every scan needs the same tokens, so they are
// cached per text for the life of the process (bounded).
const tokenCache = new Map<string, string[]>();
function cachedTokens(text: string): string[] {
  let t = tokenCache.get(text);
  if (!t) {
    if (tokenCache.size > 4096) tokenCache.clear();
    t = tokens(text);
    tokenCache.set(text, t);
  }
  return t;
}

const BASE_A = 0x01000193;
const BASE_B = 0x5bd1e995;

function powMod32(base: number, e: number): number {
  let r = 1;
  for (let i = 0; i < e; i++) r = Math.imul(r, base) >>> 0;
  return r;
}

/**
 * 53-bit fingerprints of all SHINGLE-token windows (or the whole text when shorter): two 32-bit
 * polynomial rolling hashes over salted per-token FNV hashes, so a scan is linear in the text.
 */
export function shingleFingerprints(text: string, salt: string, size = SHINGLE): Set<number> {
  const toks = cachedTokens(text);
  const out = new Set<number>();
  if (toks.length === 0) return out;
  const [s1, s2] = seeds(salt);
  const n = toks.length;
  const h1 = new Uint32Array(n);
  const h2 = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    h1[i] = fnv(toks[i]!, s1);
    h2[i] = fnv(toks[i]!, s2);
  }
  const width = Math.min(size, n);
  const topA = powMod32(BASE_A, width - 1);
  const topB = powMod32(BASE_B, width - 1);
  let a = 0;
  let b = 0;
  for (let j = 0; j < width; j++) {
    a = (Math.imul(a, BASE_A) + h1[j]!) >>> 0;
    b = (Math.imul(b, BASE_B) + h2[j]!) >>> 0;
  }
  const emit = () => {
    const mixA = Math.imul(a ^ s1, 0x85ebca6b) >>> 0;
    let mixB = Math.imul(b ^ s2, 0xc2b2ae35) >>> 0;
    mixB ^= mixB >>> 13;
    out.add(mixA * 2 ** 21 + (mixB >>> 11));
  };
  emit();
  for (let i = width; i < n; i++) {
    a = (Math.imul((a - Math.imul(h1[i - width]!, topA)) >>> 0, BASE_A) + h1[i]!) >>> 0;
    b = (Math.imul((b - Math.imul(h2[i - width]!, topB)) >>> 0, BASE_B) + h2[i]!) >>> 0;
    emit();
  }
  return out;
}

export interface FingerprintFile {
  version: 1;
  salt: string;
  shingle: number;
  fields: string[];
  fingerprints: number[];
}

export const KEYLESS_FIELDS = ["input.sentence", "plant"] as const;

export function keylessTexts(row: SuiteRow): string[] {
  return [row.input.sentence, row.plant].filter((t) => t.trim() !== "");
}

/**
 * Build the committed fingerprint file. Shingles shared with public text are dropped (not secret).
 * Texts shorter than one shingle are skipped: a window scan can never match them.
 */
export function buildFingerprints(privateRows: SuiteRow[], publicText: string, salt: string): FingerprintFile {
  const pub = shingleFingerprints(publicText, salt);
  const all = new Set<number>();
  for (const r of privateRows) {
    for (const t of keylessTexts(r)) {
      if (tokens(t).length < SHINGLE) continue;
      for (const f of shingleFingerprints(t, salt)) if (!pub.has(f)) all.add(f);
    }
  }
  return { version: 1, salt, shingle: SHINGLE, fields: [...KEYLESS_FIELDS], fingerprints: [...all].sort((x, y) => x - y) };
}

export interface ScanFile {
  path: string;
  text: string;
}

export interface LeakHit {
  path: string;
  kind: "fingerprint" | "id" | "doi" | "text";
  detail: string;
}

/** Keyless scan of files against committed fingerprints. */
export function scanFingerprints(files: ScanFile[], fp: FingerprintFile): LeakHit[] {
  const set = new Set(fp.fingerprints);
  const hits: LeakHit[] = [];
  for (const f of files) {
    let n = 0;
    for (const h of shingleFingerprints(f.text, fp.salt, fp.shingle)) if (set.has(h)) n++;
    if (n > 0) hits.push({ path: f.path, kind: "fingerprint", detail: `${n} private shingle(s)` });
  }
  return hits;
}

const ID_RX = /pw4s-[0-9a-f]{6}/g;
const DOI_RX = /10\.\d{4,9}\/[^\s"'<>\\,;]+/g;

/**
 * Keyed scan: the decrypted private rows are needles. Hits name the field, never the content.
 * Shingles that also occur in `publicText` (the public split) are not secret and are not needles.
 */
export function scanPlaintext(files: ScanFile[], privateRows: SuiteRow[], publicText = ""): LeakHit[] {
  const ids = new Set(privateRows.map((r) => r.id));
  const dois = new Set<string>();
  for (const r of privateRows) {
    for (const d of [r.input.citation.doi, r.truth?.doi, ...r.relatedIds.filter((x) => !x.startsWith("pmid:"))]) if (d) dois.add(normalizeDoi(d));
  }
  const salt = "keyed-scan";
  const notSecret = shingleFingerprints(publicText, salt, KEYED_SHINGLE);
  const needles = new Map<number, string>();
  for (const r of privateRows) {
    const fields: Array<[string, string]> = [
      ["sentence", r.input.sentence],
      ["quote", r.input.quote],
      ["evidence", r.evidence.quote],
      ["plant", r.plant],
      ["evidenceText", r.evidenceText?.quote ?? ""],
    ];
    for (const [name, text] of fields) {
      if (tokens(text).length < KEYED_SHINGLE) continue;
      for (const h of shingleFingerprints(text, salt, KEYED_SHINGLE)) if (!notSecret.has(h)) needles.set(h, `${r.id}.${name}`);
    }
  }
  const hits: LeakHit[] = [];
  for (const f of files) {
    const decoded = decodeEscapes(f.text);
    for (const m of decoded.matchAll(ID_RX)) if (ids.has(m[0])) hits.push({ path: f.path, kind: "id", detail: m[0] });
    for (const m of decoded.matchAll(DOI_RX)) {
      const d = normalizeDoi(m[0].replace(/[.)\]]+$/, ""));
      if (dois.has(d)) hits.push({ path: f.path, kind: "doi", detail: "private DOI" });
    }
    const seen = new Set<string>();
    for (const h of shingleFingerprints(f.text, salt, KEYED_SHINGLE)) {
      const which = needles.get(h);
      if (which && !seen.has(which)) {
        seen.add(which);
        hits.push({ path: f.path, kind: "text", detail: which });
      }
    }
  }
  return hits;
}

/** Tracked plus untracked-but-not-ignored text files of the repository containing `dir`. */
export function repoFiles(dir: string, exclude: (relPath: string) => boolean): ScanFile[] {
  const top = execFileSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const list = execFileSync("git", ["-C", top, "ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const out: ScanFile[] = [];
  for (const rel of list.split("\0")) {
    if (rel === "" || exclude(rel)) continue;
    const abs = join(top, rel);
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue; // deleted in the working tree
    }
    if (!st.isFile()) continue;
    const buf = readFileSync(abs);
    if (buf.subarray(0, 8192).includes(0)) continue; // binary
    out.push({ path: rel, text: buf.toString("utf8") });
  }
  return out;
}

/** Full patch history of the given repo-relative paths across all refs, as one scan file. */
export function historyText(dir: string, paths: string[]): ScanFile {
  const top = execFileSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const text = execFileSync("git", ["-C", top, "log", "-p", "--all", "--format=commit %H", "--", ...paths], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  return { path: `git-history:${paths.join(",")}`, text };
}

/**
 * The production scan set, used by `build`, `leak-scan` and the tests alike: every tracked and
 * untracked-but-not-ignored text file of the repository (minus the sealed envelope), plus the full
 * `git log -p --all` history of this package.
 */
export function repoScanSet(pkgDir: string): { files: ScanFile[]; history: ScanFile; pkgRel: string } {
  const top = execFileSync("git", ["-C", pkgDir, "rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const pkgRel = relative(realpathSync(top), realpathSync(pkgDir));
  const sealed = new Set([`${pkgRel}/suite/private.jsonl.enc`, `${pkgRel}/suite/private.jsonl.enc.sha256`]);
  return { files: repoFiles(pkgDir, (rel) => sealed.has(rel)), history: historyText(pkgDir, [pkgRel]), pkgRel };
}
