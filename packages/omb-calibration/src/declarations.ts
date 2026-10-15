// Amendment A1 (V2b): staging declarations generated from each task's own data dictionary.
//
// Sources, in order: the TASK.md "## Data" table row for the file; else the file's section of the
// staged README.md data dictionary; else, for a task with no dictionary at all, the TASK.md
// sentence "the unit is a <word>". Header names of the staged files are read only to check that a
// dictionary-named column exists. Rules (fixed, identical for every task):
//   idColumn   = the first backticked name in the file's dictionary entry that is a header column;
//                else the idColumn of another file whose entry describes the same "one row per
//                <entity>" and which is a header column here; else the unit-sentence column.
//   unitColumn = the first later backticked header column, different from idColumn, that is
//                another file's idColumn (mode repeated-measures); otherwise analysis-table.
// Non-table files cannot be declared (V2b accepts csv/tsv/json only). Nothing here looks at data
// values; uniqueness is reported afterwards as a diagnostic and never changes a declaration.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";

export interface Declaration { readonly mode: "analysis-table" | "repeated-measures"; readonly idColumn: string; readonly unitColumn?: string }
export interface DeclarationNote { readonly file: string; readonly reason: string }
export interface DeclarationResult {
  readonly staging: Readonly<Record<string, Declaration>>;
  readonly notes: readonly DeclarationNote[];
  /** Per declared file: is the declared idColumn unique in the staged data (diagnostic only). */
  readonly idUnique: Readonly<Record<string, boolean>>;
}

const TABLE = /\.(csv|tsv|json)$/;
const ticks = (s: string): string[] => [...s.matchAll(/`([^`]+)`/g)].map((m) => m[1]!);
const entity = (s: string): string | null => /one row per ([^:(,.;]+)/i.exec(s)?.[1]?.trim().toLowerCase() ?? null;

/** TASK.md "## Data" table: file -> description. */
export function taskDictionary(taskMd: string): Map<string, string> {
  const out = new Map<string, string>();
  const section = /^## Data[^\n]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(taskMd)?.[1] ?? "";
  for (const line of section.split("\n")) {
    const m = /^\|\s*`([^`]+)`\s*\|(.*)\|\s*$/.exec(line);
    if (m) out.set(m[1]!, m[2]!.trim());
  }
  return out;
}

/** README.md data dictionary: "## <file>" sections (text plus their column tables). A README with
 * no file sections describes the single table it names in its first backticks. */
export function readmeDictionary(readme: string): Map<string, string> {
  const out = new Map<string, string>();
  const parts = readme.split(/^## /m).slice(1);
  for (const part of parts) {
    const [head, ...rest] = part.split("\n");
    const file = head!.trim();
    if (TABLE.test(file)) out.set(file, rest.join("\n"));
  }
  if (out.size === 0) {
    const first = ticks(readme).find((t) => TABLE.test(t));
    if (first) out.set(first, readme);
  }
  return out;
}

export function header(file: string): string[] {
  const text = readFileSync(file, "utf8").replace(/^﻿/, "");
  if (file.endsWith(".json")) {
    const rows = JSON.parse(text) as Record<string, unknown>[];
    return Array.isArray(rows) && rows[0] && typeof rows[0] === "object" ? Object.keys(rows[0]) : [];
  }
  const line = text.split(/\r?\n/, 1)[0] ?? "";
  return line.split(file.endsWith(".csv") ? "," : "\t").map((h) => h.trim().replace(/^"|"$/g, ""));
}

function column(file: string, name: string): string[] {
  const text = readFileSync(file, "utf8").replace(/^﻿/, "").replace(/\r?\n$/, "");
  if (file.endsWith(".json")) return (JSON.parse(text) as Record<string, unknown>[]).map((r) => String(r[name]));
  const sep = file.endsWith(".csv") ? "," : "\t", lines = text.split(/\r?\n/), h = lines[0]!.split(sep), i = h.indexOf(name);
  return lines.slice(1).map((l) => l.split(sep)[i] ?? "");
}

export function generateDeclarations(taskMd: string, rawDir: string): DeclarationResult {
  const files = readdirSync(rawDir).filter((f) => f !== "manifest.json").sort();
  const readmeFile = files.find((f) => /^readme\.md$/i.test(f));
  const fromTask = taskDictionary(taskMd);
  const fromReadme = readmeFile ? readmeDictionary(readFileSync(path.join(rawDir, readmeFile), "utf8")) : new Map<string, string>();
  const notes: DeclarationNote[] = [];
  const tables = files.filter((f) => {
    if (TABLE.test(f)) return true;
    notes.push({ file: f, reason: "not a csv/tsv/json table: declared staging cannot declare it, and every file in the batch must be declared" });
    return false;
  });
  const headers = new Map(tables.map((f) => [f, header(path.join(rawDir, f))]));
  const entries = new Map<string, string>();
  for (const f of tables) {
    const a = fromTask.get(f) ?? "", b = fromReadme.get(f) ?? "";
    const h = headers.get(f)!;
    entries.set(f, ticks(a).some((t) => h.includes(t)) || !b ? a : b);
  }
  const ids = new Map<string, string>();
  for (const f of tables) {
    const id = ticks(entries.get(f)!).find((t) => headers.get(f)!.includes(t));
    if (id) ids.set(f, id);
  }
  for (const f of tables) {
    if (ids.has(f)) continue;
    const e = entity(entries.get(f)!);
    const peer = e ? tables.find((g) => g !== f && ids.has(g) && entity(entries.get(g)!) === e && headers.get(f)!.includes(ids.get(g)!)) : undefined;
    if (peer) { ids.set(f, ids.get(peer)!); continue; }
    if (!entries.get(f)) {
      const word = /the unit is an? ([a-z]+)/i.exec(taskMd)?.[1]?.toLowerCase();
      const hits = word ? headers.get(f)!.filter((c) => c.toLowerCase().includes(word)) : [];
      if (hits.length === 1) { ids.set(f, hits[0]!); continue; }
    }
    notes.push({ file: f, reason: entries.get(f) ? "the data dictionary names no identity column present in the table" : "no data dictionary entry and no stated unit column" });
  }
  const staging: Record<string, Declaration> = {};
  const idUnique: Record<string, boolean> = {};
  const otherIds = (f: string) => new Set(tables.filter((g) => g !== f && ids.has(g)).map((g) => ids.get(g)!));
  for (const f of tables) {
    const id = ids.get(f);
    if (!id) continue;
    const others = otherIds(f);
    const toks = ticks(entries.get(f)!);
    const unit = toks.slice(Math.max(0, toks.indexOf(id)) + 1).find((t) => t !== id && headers.get(f)!.includes(t) && others.has(t));
    staging[f] = unit ? { mode: "repeated-measures", idColumn: id, unitColumn: unit } : { mode: "analysis-table", idColumn: id };
    const values = column(path.join(rawDir, f), id);
    idUnique[f] = new Set(values).size === values.length && values.every((v) => v.trim() !== "");
    if (!idUnique[f]) notes.push({ file: f, reason: `declared idColumn ${id} does not identify rows uniquely (the dictionary names no single-column row key)` });
  }
  return { staging, notes, idUnique };
}

export function hasReadme(rawDir: string): boolean { return existsSync(rawDir) && readdirSync(rawDir).some((f) => /^readme\.md$/i.test(f)); }
