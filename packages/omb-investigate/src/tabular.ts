import {columnInventory} from './practice-independent.ts';
import {validateDictionaryTargets,checkDictionaryRows,dictionaryTextColumn} from './measurement-dictionary.ts';
import {compilePractice,renderPractice,auditRebuild,auditSchemaProjection,type AllowedPractice} from './practice-provenance.ts';
import {blindCorrelation,checkCorrelation,correlationAxis} from './practice-matrix.ts';
import {summaryDomain} from './practice-summary.ts';
import {independentRecords,checkIndependentInventory} from './practice-independent.ts';
import { auditPracticeDraws, auditPracticeLeakage, repeatedAuditCohort } from './practice-audit.ts';
import { reassignExposure, aliasPracticeKeys, reorderPractice, opaqueKey, resolvePracticeKeys, allocationDeclaration } from './practice-exposure.ts';
import { auditPhysicalMetadata, readPhysical, writePhysical, physicalPath, formatSignature, encodeText, type TextFormat, type PhysicalFormat } from './physical-format.ts';
import { physicalRecords, samplePhysical } from './physical-stream.ts';
import { practiceReferences, referenceDeclarations, preserveReferences, checkPracticeReferences } from './practice-references.ts';
import {gunzipSync,gzipSync,createGunzip,createGzip} from 'node:zlib';
import {createInterface} from 'node:readline';
import {StringDecoder} from 'node:string_decoder';
import {StagerRefusal} from "./pause.ts";
// A real, LLM-free stager for delimited tables (TSV/CSV), used by the live smoke and as the
// reference behaviour of the StagerPort until V5's sealer and K1b's contract verifier merge.
// - stage: copy the raw files into host-only state, hash them (manifest), write a schema view
//   (headers, types, missingness, marginal counts of low-cardinality columns; never joint
//   summaries, never row values) and pick data canaries (row values absent from the view);
// - scramble: the real layout with outcome columns permuted at the unit level within strata;
// - synthesize: the same schema filled with synthetic values, for the pre-look dry run.
// Duplicate merging before the split/scramble belongs to the K1b contract and V5 sealer; without a
// contract this stager permutes the declared unit column as given (BUILD-NOTES gap).

import { createReadStream, createWriteStream, writeSync, closeSync, copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { sha256Canonical } from "../../bio-core/src/index.ts";
import type { PublicLayer } from "../../omb-contract/src/index.ts";
import { removeTree, treeHash, treeHashes } from "./bundle.ts";
import { pipeline } from "node:stream/promises";
import { syntheticNumber, categoricalSchedule } from "./synthesis-values.ts";
import { synthesisSchema, syntheticIdentifier } from "./synthesis-schema.ts";
import { checkPracticeStructure, nonDataRowColumns, generationOrder, missingValue, practiceStructure, rowCap, unitBlocks, PRACTICE_RULE, type PracticeViolation, type StructureDeclaration } from "./practice-structure.ts";
import { loadPinnedContract } from "./contracts.ts";
import type { DerivedData, PracticeCheck, ScrambleRequest, StagedData, StageRequest, StagerPort } from "./ports.ts";
import type { SynthesisColumn } from "./synthesis-schema.ts";

const MISSING = new Set(["", "na", "nan", "null", "none", ".", "n/a", "-"]);
const TABLE = /\.(?:(?:tsv|csv|txt)(?:\.gz)?|json|xlsx|zip|xpt|sav|dta|parquet)$/i;
const MAX_PARSE_BYTES = 64_000_000;
const SAMPLE_BYTES = 50_000_000;
const LEVELS_MAX = 20;

export interface Table { file: string; delimiter: string; header: string[]; rows: string[][]; physical?: PhysicalFormat }

export function splitLine(line: string, delimiter: string): string[] {
  if (delimiter === "\t" || !line.includes('"')) return line.split(delimiter);
  const out: string[] = [];
  let field = "", quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === delimiter) { out.push(field); field = ""; }
    else field += ch;
  }
  out.push(field);
  return out;
}

const quote = (v: string, d: string): string => (d !== "\t" && /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function parseTable(file: string, text: string): Table | null {
  if(file.toLowerCase().endsWith('.json')){
    let records:unknown;try{records=JSON.parse(text);}catch{return null;}
    if(!Array.isArray(records)||!records.length||records.some(r=>!r||typeof r!=='object'||Array.isArray(r)))return null;
    const header=[...new Set(records.flatMap(r=>Object.keys(r)))];
    return {file,delimiter:'json',header,rows:records.map(r=>header.map(k=>r[k]===null||r[k]===undefined?'':typeof r[k]==='object'?JSON.stringify(r[k]):String(r[k])))};
  }
  const lines = text.split(/\r?\n/);
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  if (lines.length === 0) return null;
  const first = lines[0]!;
  const delimiter = /\.csv(?:\.gz)?$/i.test(file) ? "," : first.includes("\t") ? "\t" : first.includes(",") ? "," : "\t";
  const header = splitLine(first, delimiter);
  const rows = lines.slice(1).map((l) => splitLine(l, delimiter));
  return { file, delimiter, header, rows };
}

export function formatTable(t: Table): string {
  if(t.delimiter==='json')return JSON.stringify(t.rows.map(r=>Object.fromEntries(t.header.map((k,j)=>[k,r[j]??'']))))+'\n';
  return [t.header, ...t.rows].map((r) => r.map((v) => quote(v, t.delimiter)).join(t.delimiter)).join("\n") + "\n";
}

type ColType = "integer" | "number" | "string" | "empty";
export interface ColumnView { name: string; type: ColType; missing: number; distinct: number; levels: Record<string, number> | null; min?:number;max?:number }
export interface TableView { file: string; rows: number; columns: ColumnView[]; parsed: boolean }

function columnType(values: string[]): ColType {
  const present = values.filter((v) => !MISSING.has(v.trim().toLowerCase()));
  if (present.length === 0) return "empty";
  if (present.every((v) => /^[+-]?\d+$/.test(v.trim()))) return "integer";
  if (present.every((v) => v.trim() !== "" && Number.isFinite(Number(v)))) return "number";
  return "string";
}

export function viewTable(t: Table): TableView {
  const columns = t.header.map((name, j): ColumnView => {
    const values = t.rows.map((r) => r[j] ?? "");
    const type = columnType(values);
    const present = values.filter((v) => !MISSING.has(v.trim().toLowerCase()));
    const counts = new Map<string, number>();
    for (const v of present) counts.set(v, (counts.get(v) ?? 0) + 1);
    const levels = counts.size <= LEVELS_MAX && (type !== "number" || counts.size <= 5) && counts.size < Math.max(2, present.length)
      ? Object.fromEntries([...counts].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : null;
    return { name, type, missing: values.length - present.length, distinct: counts.size, levels,...(type==="integer"||type==="number"?{min:present.reduce((m,v)=>Math.min(m,Number(v)),Infinity),max:present.reduce((m,v)=>Math.max(m,Number(v)),-Infinity)}:{}) };
  });
  return { file: t.file, rows: t.rows.length, columns, parsed: true };
}

/** Deterministic PRNG (mulberry32) seeded from a hex seed. */
export function prng(seed: string): () => number {
  let a = parseInt(createHash("sha256").update(seed).digest("hex").slice(0, 8), 16) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Sattolo's algorithm: a uniformly random cyclic permutation, so no element maps to itself. */
function derangement(n: number, rand: () => number): number[] {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(rand() * i); [a[i], a[j]] = [a[j]!, a[i]!]; }
  return a;
}

/** A value of the column's published type, generated independently of every observed value. */
function syntheticValue(type: ColType, levels: readonly string[], rand: () => number, label: string, i: number): string {
  if (levels.length) return levels[Math.floor(rand() * levels.length)]!;
  if (type === "integer") return String(Math.floor(rand() * 100));
  if (type === "number") return (rand() * 4 - 2).toFixed(4);
  if (type === "empty") return "";
  return `syn_${label.replace(/[^A-Za-z0-9]/g, "")}_${i}`;
}

export interface ScrambleOptions {
  declaration?: StructureDeclaration;
  outcomes: readonly string[];
  /** Exposures of the locked claims: strata that do not vary them would keep group means. */
  exposures: readonly string[];
  /** TRUSTED unit column (data contract), or null: permutation is then row-level. */
  unit: string | null;
  /** TRUSTED blinding strata (data contract). Never the lead's plan. Re-checked here anyway. */
  strata: readonly string[];
  seed: string;
}

export interface ScrambleResult { table: Table; permuted: string[]; synthetic: string[]; warnings: string[] }

/** Why strata cannot safely block the permutation, or null. Blocks are over units. */
function strataProblem(t: Table, o: ScrambleOptions, unitRows: Map<string, number[]>): string | null {
  if (o.strata.length === 0) return null;
  const idx = o.strata.map((c) => t.header.indexOf(c));
  if (idx.some((j) => j < 0)) return "a stratum column is missing from the table";
  const forbidden = new Set([...o.outcomes, ...o.exposures, ...(o.unit ? [o.unit] : [])]);
  const bad = o.strata.find((c) => forbidden.has(c));
  if (bad) return `stratum ${bad} is an outcome, exposure or unit column`;
  const blocks = new Map<string, string[]>();
  for (const [u, rows] of unitRows) { const k = JSON.stringify(idx.map((j) => t.rows[rows[0]!]![j] ?? "")); blocks.set(k, [...(blocks.get(k) ?? []), u]); }
  if ([...blocks.values()].some((b) => b.length < 2)) return blocks.size === unitRows.size ? "the strata identify units (identity permutation)" : "a stratum holds a single unit (singleton block)";
  const ex = o.exposures.map((c) => t.header.indexOf(c)).filter((j) => j >= 0);
  for (const j of ex) {
    for (const units of blocks.values()) {
      const values = new Set(units.flatMap((u) => unitRows.get(u)!.map((r) => t.rows[r]![j] ?? "")));
      if (values.size < 2) return `exposure ${t.header[j]} is constant within a stratum (blocks would keep exposure-group outcomes)`;
    }
  }
  return null;
}

/**
 * Blind the outcomes of one table. Each unit (trusted unit column, else each row) receives another
 * unit's outcome rows, through a derangement, within trusted strata that pass strataProblem;
 * unsafe strata are dropped. Where no permutation is possible (fewer than two units), the outcome
 * values are synthetic. Every other column keeps its real values and order.
 */
export function scrambleTable(t: Table, o: ScrambleOptions): ScrambleResult {
  const declaration=o.declaration??genericPracticeDeclaration([viewTable(t)],t,o);
  const table=synthesizeTables([viewTable(t)],[t],{seed:o.seed,outcomes:o.outcomes,exposures:o.exposures,declarations:{[t.file]:declaration}})[0]!;
  return {table,permuted:[],synthetic:t.header.filter(n=>!declaration.keys.includes(n)),warnings:o.strata.length||o.unit?['Worker unit/strata hints do not authorize preservation; only served declarations do.']:[]};
}

export interface SynthesisOptions {
  seed: string;
  /** Outcome columns: always generated independently (published levels or type only). */
  outcomes: readonly string[];
  exposures?: readonly string[];
  maxRows?: number;
  schema?: StagedData["synthesisSchema"];
  /** Host practice declarations per file (served contract roles); else derived from the schema. */
  declarations?: StagedData["practiceDeclarations"];
}

/** Only strings without published levels may be inferred as keys; numeric keys need declarations. */
function isKey(c: ColumnView, outcomes: readonly string[], rows: number): boolean {
  if (outcomes.includes(c.name) || c.levels) return false;
  if (c.type === "string") return true;
  return false; // Cardinality never proves that a numeric measurement is an identifier.
}

/**
 * Synthesise every table together from the PUBLISHED schema views. Values never come from the real
 * data: each non-key column is generated from its published type and levels; key-like columns are
 * replaced by keyed pseudonyms of their values, the same pseudonym in every table (and in matrix
 * headers), so joins, unit groups and row counts per unit survive while no real identifier does.
 */
export function synthesizeTables(views: readonly TableView[], tables: readonly Table[], o: SynthesisOptions): Table[] {
  if (o.maxRows !== undefined && tables.some(t => t.rows.length > o.maxRows!)) throw new StagerRefusal("Independent synthetic row caps would break identifier memberships");
  const declarations=Object.fromEntries(tables.map(t=>[t.file,{...(o.declarations?.[t.file]??genericPracticeDeclaration(views,t,o)),outcomes:o.outcomes,exposures:o.exposures??[]}]));
  const generated=renderPractice(compilePractice(tables,declarations,o.schema??[],o.seed));
  // Keep the host helper's positional API. Provenance and serialized container
  // order remain canonical and never use this presentation order.
  const byFile=new Map(generated.map(t=>[t.file,t]));
  return tables.map(t=>byFile.get(t.file)!);
}

/** Columns the synthetic twin pseudonymises: declared namespaces/identifiers, else key-like columns. */
function synthesisKeys(views: readonly TableView[], t: Table, o: Pick<SynthesisOptions, "outcomes" | "exposures" | "schema">): { cols: ColumnView[]; declared: (SynthesisColumn | undefined)[]; keys: boolean[] } {
  const declaration = o.schema?.find(d => d.file === t.file), view = views.find(v => v.file === t.file);
  const cols = t.header.map(name => view?.columns.find(c => c.name === name) ?? { name, type: "string" as ColType, missing: 0, distinct: -1, levels: null });
  const declared = cols.map(c => declaration?.columns?.find(d => d.name === c.name) ?? (declaration?.matrix && !declaration.fixedHeaders.includes(c.name) ? declaration.cells : undefined));
  const keys = cols.map((c,j) => {
    const servedKey=!!declared[j]?.namespace || !!declaration?.identifiers.includes(c.name);
    const matrixIdentity=!!declaration?.matrix && declaration.fixedHeaders.includes(c.name) && servedKey;
    return (!o.outcomes.includes(c.name) || matrixIdentity) && (servedKey || (!(declaration?.matrix && !declaration.fixedHeaders.includes(c.name)) && !declared[j] && isKey(c, o.outcomes, view?.rows ?? t.rows.length)));
  });
  return { cols, declared, keys };
}

/** Practice declaration without a served contract: the synthetic twin's keys and declared storage. */
export function genericPracticeDeclaration(views: readonly TableView[], t: Table, o: Pick<SynthesisOptions, "outcomes" | "exposures" | "schema">): StructureDeclaration {
  const declaration = o.schema?.find(d => d.file === t.file), { declared, keys } = synthesisKeys(views, t, o);
  const roles: Record<string, string | undefined> = {}, levels: Record<string, string[]> = {}, bounds: Record<string, { min?: number; max?: number }> = {};
  t.header.forEach((name, j) => {
    const d = declared[j]; if (!d || keys[j]) return;
    roles[name] = d.levels?.length ? "categorical" : d.storage === "integer" ? "integer" : d.storage === "number" ? "decimal" : undefined;
    if (d.levels?.length) levels[name] = d.levels;
    if (d.min !== undefined || d.max !== undefined) bounds[name] = { ...(d.min !== undefined ? { min: d.min } : {}), ...(d.max !== undefined ? { max: d.max } : {}) };
  });
  const keyNames = t.header.filter((_, j) => keys[j]);
  return { ...(declaration?.measurementDictionary?{measurementDictionary:declaration.measurementDictionary}:{}),matrix:declaration?.matrix??false, ...(declaration?.headerNamespace?{matrixNamespace:declaration.headerNamespace}:{}), ...(declaration?.cells?{matrixCells:declaration.cells}:{}), formats:Object.fromEntries((declaration?.columns??[]).map(c=>[c.name,c])), keyNamespaces:Object.fromEntries((declaration?.columns??[]).filter(c=>c.namespace).map(c=>[c.name,c.namespace!])), keySeparators:Object.fromEntries((declaration?.columns??[]).filter(c=>c.separator).map(c=>[c.name,c.separator!])), keys: keyNames, units: (declaration?.columns??[]).filter(c=>c.namespace==='unit').map(c=>c.name), roles, levels, bounds, outcomes: o.outcomes, exposures: o.exposures ?? [], missing: declaration?.missing ?? null };
}

/** Outcomes plus every measurement linked to one by a detected bound (transitively). */
function boundPartners(t: Table, outcomes: readonly string[], declaration: StructureDeclaration): string[] {
  const present = outcomes.filter(o => t.header.includes(o));
  if (!present.length) return [...outcomes];
  const s = practiceStructure(t, declaration), linked = new Set(present);
  for (let grew = true; grew;) { grew = false; for (const b of s.bounds) if (linked.has(b.lower) !== linked.has(b.upper)) { linked.add(b.lower); linked.add(b.upper); grew = true; } }
  return [...new Set([...outcomes, ...linked])];
}

/** HOST self-check of every parsed practice table against the real table's structure. */
export function verifyPracticeTables(real: readonly Table[], practice: (file: string) => Table | "empty" | null, views: readonly TableView[], o: Pick<SynthesisOptions, "outcomes" | "exposures" | "schema" | "declarations">, emptyAllowed = false): { violations: PracticeViolation[]; tables: number } {
  const declarations = Object.fromEntries(real.map(t => [t.file, allocationDeclaration(t,{ ...(o.declarations?.[t.file] ?? genericPracticeDeclaration(views, t, o)), outcomes: o.outcomes, exposures: o.exposures ?? [] })]));
  const refs = practiceReferences(real, declarations);
  const resolved = resolvePracticeKeys(real,declarations);
  const violations: PracticeViolation[] = checkPracticeReferences(real, practice, refs); let tables = 0;
  for (const t of real) {
    const p = practice(t.file);
    if (!p) { violations.push({ file: t.file, check: "shape", detail: "practice copy of the served table is missing or unreadable" }); continue; }
    // A fail-closed scramble mounts headers only (an empty JSON record array has no header).
    if (emptyAllowed && (p === "empty" || p.rows.length === 0 && JSON.stringify(p.header) === JSON.stringify(t.header))) continue;
    if (p === "empty") { violations.push({ file: t.file, check: "shape", detail: "practice copy of the served table is empty" }); continue; }
    for (const name of resolved[t.file]!.outcomes ?? []) {
      const j = t.header.indexOf(name); if (j < 0) continue;
      if (new Set(t.rows.map(r=>r[j])).size>1 && (t.rows.every((r, i) => r[j] === p.rows[i]?.[j]) || outcomeUnchangedByKey(t, p, j, resolved[t.file]!))) violations.push({ file: t.file, check: 'outcome-blinding', detail: `${name} is identical to the real outcome` });
      const c = views.find(v => v.file === t.file)?.columns.find(c => c.name === name);
      const values = p.rows.map(r => r[j] ?? '').filter(v => !missingValue(v, resolved[t.file]?.missing));
      if (!summaryDomain(t.header,name,resolved[t.file]?.bounds) && c && (c.type === 'integer' || c.type === 'number') && values.some(v => !Number.isFinite(Number(v)) || c.type === 'integer' && !Number.isInteger(Number(v)) || c.min !== undefined && Number(v) < c.min || c.max !== undefined && Number(v) > c.max)) violations.push({ file: t.file, check: 'outcome-domain', detail: `${name} violates its published numeric domain` });
    }
    const schema=o.schema?.find(d=>d.file===t.file);
    if(schema?.matrix&&correlationAxis(t,schema)){const detail=checkCorrelation(t,p,schema);if(detail)violations.push({file:t.file,check:'correlation',detail});}
    else violations.push(...checkIndependentInventory(t,schema?.matrix?{...p,header:t.header}:p,resolved[t.file]!));
    if(schema?.matrix&&p.header.some(h=>!schema.fixedHeaders.includes(h)&&t.header.includes(h)))violations.push({file:t.file,check:'key-leakage',detail:'original matrix axis identities remain'});
    tables++;
  }
  violations.push(...auditPracticeLeakage(real,real.flatMap(t=>{const p=practice(t.file);return p && p!=="empty"?[p]:[];}),resolved));
  return { violations, tables };
}

/** Row reordering is not blinding: compare outcome multisets inside unchanged identity groups. */
function outcomeUnchangedByKey(real: Table, practice: Table, outcome: number, declaration: StructureDeclaration): boolean {
  const keys = declaration.keys.filter(k => k !== real.header[outcome] && !declaration.outcomes?.includes(k)).map(k => real.header.indexOf(k)).filter(j => j >= 0);
  if (!keys.length || real.rows.length !== practice.rows.length) return false;
  const signature = (table: Table) => table.rows.map(row => JSON.stringify([...keys.map(j => row[j]), row[outcome]])).sort();
  return JSON.stringify(signature(real)) === JSON.stringify(signature(practice));
}

/** Stream every outcome cell: a reservoir cannot certify the unsampled tail. */
async function checkStreamOutcomes(realFile: string, practiceFile: string, table: Table, view: TableView | undefined, declaration: StructureDeclaration, outcomes: readonly string[]): Promise<PracticeViolation[]> {
  const selected = outcomes.flatMap(name => { const j = table.header.indexOf(name); return j < 0 ? [] : [{ name, j, column: view?.columns.find(c => c.name === name) }]; });
  if (!selected.length) return [];
  const violations: PracticeViolation[] = [], invalid = new Set<string>();
  const keys = declaration.keys.filter(k => !outcomes.includes(k)).map(k => table.header.indexOf(k)).filter(j => j >= 0);
  const fingerprint = async (file: string, check: boolean) => {
    const hashes = selected.map(() => createHash('sha256')), keyed = selected.map(() => 0n); let rows = 0;
    const visit = (row: string[]) => {
      rows++;
      selected.forEach(({name,j,column}, k) => {
        const value = row[j] ?? '';
        hashes[k]!.update(JSON.stringify(value)+'\n');
        if (keys.length) keyed[k] = (keyed[k]! + BigInt('0x'+createHash('sha256').update(JSON.stringify([...keys.map(i => row[i]), value])).digest('hex'))) % (1n << 256n);
        if (!check || missingValue(value, declaration.missing)) return;
        const bounds = declaration.bounds?.[name], numeric = column?.type === 'integer' || column?.type === 'number';
        if (numeric && (!Number.isFinite(Number(value)) || column?.type === 'integer' && !Number.isInteger(Number(value)) || column?.min !== undefined && Number(value) < column.min || column?.max !== undefined && Number(value) > column.max) || bounds?.min !== undefined && Number(value) < bounds.min || bounds?.max !== undefined && Number(value) > bounds.max || declaration.levels?.[name] && !declaration.levels[name]!.includes(value)) invalid.add(name);
      });
    };
    if (table.delimiter === 'json') sampleJsonTable(file, table.file, record => visit(table.header.map(h => record[h] == null ? '' : typeof record[h] === 'object' ? JSON.stringify(record[h]) : String(record[h]))));
    else { let header = true; for await (const record of physicalRecords(file,table.file)) { if (header) { header = false; continue; } visit(record.table.rows[0]!); } }
    return { rows, hashes: hashes.map(h => h.digest('hex')), keyed };
  };
  const real = await fingerprint(realFile,false), practice = await fingerprint(practiceFile,true);
  selected.forEach(({name},k) => {
    if (invalid.has(name)) violations.push({ file:table.file, check:'outcome-domain', detail:`${name} violates its published domain in a streamed record` });
    if (real.rows === practice.rows && (real.hashes[k] === practice.hashes[k] || keys.length && real.keyed[k] === practice.keyed[k])) violations.push({ file:table.file, check:'outcome-blinding', detail:`${name} is identical to the real streamed outcome` });
  });
  return violations;
}

/** Stateful per-table value PRNG; identity is a namespace PRF shared by every table/axis. */
function synthesisGenerator(views: readonly TableView[], t: Table, o: SynthesisOptions) {
  const declaration = o.schema?.find(d => d.file === t.file), view = views.find(v => v.file === t.file);
  const { cols, declared, keys } = synthesisKeys(views, t, o);
  const integerNamespace = (ns: string) => { const members = o.schema?.flatMap(d => d.columns ?? []).filter(c => c.namespace === ns) ?? []; return members.some(c => c.storage === 'integer') && !members.some(c => c.storage === 'string'); };
  const rand = prng(`${o.seed}:${t.file}`);
  const header = t.header.map(h => declaration?.matrix && !declaration.fixedHeaders.includes(h) ? syntheticIdentifier(o.seed,h,declaration.headerNamespace,declaration.headerNamespace ? integerNamespace(declaration.headerNamespace) : false) : h);
  const schedules = cols.map((c,j) => keys[j] ? null : categoricalSchedule(c,declared[j],view?.rows ?? t.rows.length,prng(`${o.seed}:${t.file}:${c.name}:levels`)));
  const positions = cols.map(()=>0);
  const offsets = cols.map(c=>prng(`${o.seed}:${t.file}:${c.name}:missing`)());
  const row = (r: string[], i: number) => cols.map((c,j) => {
    if (!keys[j] && o.declarations?.[t.file]?.structural?.includes(j)) return r[j] ?? '';
    const d = declared[j], missing = d?.missing ?? declaration?.missing;
    const v = r[j] ?? '';
    if (keys[j]) {
      if (missing ? missing.includes(v) : MISSING.has(v.trim().toLowerCase())) return v;
      const integer = d?.namespace ? integerNamespace(d.namespace) : d?.storage === 'integer' || (d?.storage === undefined && c.type === 'integer');
      return (d?.separator ? v.split(d.separator) : [v]).map(x => syntheticIdentifier(o.seed,x,d?.namespace,integer)).join(d?.separator ?? '');
    }
    const total = view?.rows ?? t.rows.length, count = Math.max(0,c.missing);
    const isMissing = declaration?.matrix ? total > 0 && Math.floor((i+1)*count/total+offsets[j]!) > Math.floor(i*count/total+offsets[j]!) : missingValue(v, missing);
    if (isMissing) {
      if (missing && !missing.length) throw new StagerRefusal(`Missing observations contradict the declared missing-token set for ${t.file}:${c.name}`);
      return declaration?.matrix ? missing?.[0] ?? 'NA' : v;
    }
    const category = schedules[j]?.[positions[j]!]; positions[j] = positions[j]! + 1;
    if(category !== undefined) return category;
    const type = d?.storage ?? c.type;
    if(type==='integer'||type==='number')return syntheticNumber(c,d,rand);
    return syntheticValue(type,[],rand,c.name,i);

  });
  return { header, row };
}

/** Values present in the real data, absent from the schema view and from everything shown (task, headers). */
export function pickCanaries(tables: readonly Table[], views: readonly TableView[], publicText: string, k = 8): string[] {
  const shown = new Set<string>();
  for (const v of views) for (const c of v.columns) { shown.add(c.name); for (const l of Object.keys(c.levels ?? {})) shown.add(l); }
  const candidates = new Set<string>();
  for (const t of tables) for (const r of t.rows) for (const v of r) {
    const s = v.trim();
    if (s.length >= 6 && s.length <= 64 && /[A-Za-z]/.test(s) && /\d/.test(s) && !shown.has(s) && !publicText.includes(s)) candidates.add(s);
  }
  return [...candidates].sort((a, b) => {
    const ha = createHash("sha256").update(a).digest("hex"), hb = createHash("sha256").update(b).digest("hex");
    return ha < hb ? -1 : ha > hb ? 1 : 0;
  }).slice(0, k);
}

const SAFE = (s: string): string => s.replace(/[^A-Za-z0-9._-]/g, "_");

function listFiles(dir: string, rel = ""): string[] {
  const out: string[] = [];
  for (const name of readdirSync(path.join(dir, rel)).sort()) {
    const r = rel ? `${rel}/${name}` : name, st = lstatSync(path.join(dir, r));
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) out.push(...listFiles(dir, r));
    else if (st.isFile()) out.push(r);
  }
  return out;
}

/** A table too large to parse whole: header, streamed row count and the first rows as a type sample. */
export function sampleTable(file:string,rel:string):{table:Table;rows:number}|null{
  const fd=openSync(file,'r'),rand=prng(rel),sample:string[]=[],decoder=new StringDecoder('utf8');let header:string|undefined,rows=0,pending='';
  const line=(text:string)=>{text=text.replace(/\r$/,'');if(header===undefined){header=text;return;}if(!text)return;rows++;if(sample.length<2000)sample.push(text);else{const j=Math.floor(rand()*rows);if(j<2000)sample[j]=text;}};
  try{const buf=Buffer.alloc(1<<20);let n:number;while((n=readSync(fd,buf,0,buf.length,null))>0){pending+=decoder.write(buf.subarray(0,n));let i:number;while((i=pending.indexOf('\n'))>=0){line(pending.slice(0,i));pending=pending.slice(i+1);}}pending+=decoder.end();if(pending)line(pending);const table=header===undefined?null:parseTable(rel,[header,...sample].join('\n'));return table?{table,rows}:null;}finally{closeSync(fd);}
}
/** Stream a JSON record array, retaining at most 2000 sampled records and one bounded record. */
export function sampleJsonTable(file:string,rel:string,visit?:(record:Record<string,unknown>)=>void):{table:Table;rows:number}|null {
 const fd=openSync(file,'r'),decoder=new StringDecoder('utf8'),rand=prng(rel),sample:Record<string,unknown>[]=[],headers=new Set<string>();
 let state:'start'|'first'|'record'|'separator'|'next'|'end'='start',record='',depth=0,quoted=false,escaped=false,rows=0;
 const consume=(text:string)=>{for(const c of text){
  if(state==='record'){
   record+=c;if(record.length>8_000_000)throw new Error('JSON table record exceeds 8 MB parser cap');
   if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;}
   else if(c==='"')quoted=true;else if(c==='{'||c==='[')depth++;else if(c==='}'||c===']')depth--;
   if(depth===0){const value=JSON.parse(record) as Record<string,unknown>;if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('JSON table requires records');visit?.(value);for(const k of Object.keys(value))headers.add(k);rows++;if(sample.length<2000)sample.push(value);else{const j=Math.floor(rand()*rows);if(j<2000)sample[j]=value;}record='';state='separator';}
   continue;
  }
  if(/\s/.test(c))continue;
  if(state==='start'&&c==='['){state='first';continue;}
  if((state==='first'||state==='next')&&c==='{'){record=c;depth=1;quoted=false;escaped=false;state='record';continue;}
  if((state==='first'||state==='separator')&&c===']'){state='end';continue;}
  if(state==='separator'&&c===','){state='next';continue;}
  throw new Error('Invalid JSON record-array syntax');
 }};
 try{const buf=Buffer.alloc(1<<20);let n:number;while((n=readSync(fd,buf,0,buf.length,null))>0)consume(decoder.write(buf.subarray(0,n)));consume(decoder.end());if((state as string)!=='end')throw new Error('Incomplete JSON record array');if(!rows)return null;const header=[...headers];return {rows,table:{file:rel,delimiter:'json',header,rows:sample.map(r=>header.map(k=>r[k]===null||r[k]===undefined?'':typeof r[k]==='object'?JSON.stringify(r[k]):String(r[k])))}};}finally{closeSync(fd);}
}
async function sampleGzip(file:string,rel:string):Promise<{table:Table;rows:number}|null>{
  const stream=createReadStream(file).pipe(createGunzip()),lines=createInterface({input:stream,crlfDelay:Infinity}),rand=prng(rel),sample:string[]=[];let header:string|undefined,rows=0;
  for await(const text of lines){if(header===undefined){header=text;continue;}if(!text)continue;rows++;if(sample.length<2000)sample.push(text);else{const j=Math.floor(rand()*rows);if(j<2000)sample[j]=text;}}
  const table=header===undefined?null:parseTable(rel,[header,...sample].join('\n'));return table?{table,rows}:null;
}

export interface TabularStagerOptions {
  hostRoot: string; shareRoot: string; canaryCount?: number;
  /** Tables above this size are described from a sample (default 64 MB). */
  maxParseBytes?: number;
}

export class TabularStager implements StagerPort {
  constructor(private readonly o: TabularStagerOptions) {}

  async tables(dir: string): Promise<{ tables: Table[]; big: { table: Table; rows: number; formatHash?:string }[]; skipped: string[] }> {
    const tables: Table[] = [], big: { table: Table; rows: number; formatHash?:string }[] = [], skipped: string[] = [];
    for (const rel of listFiles(dir)) {
      const file = path.join(dir, rel);
      if (!TABLE.test(rel)) { skipped.push(rel); continue; }
      if (!/\.(xlsx|zip)$/i.test(rel) && lstatSync(file).size > (this.o.maxParseBytes ?? MAX_PARSE_BYTES)) {
        const sampled = rel.endsWith('.json')?sampleJsonTable(file,rel):await samplePhysical(file,rel,prng(rel));
        if (sampled) big.push(sampled); else skipped.push(rel);
        continue;
      }
      const parsed = readPhysical(file, rel);
      if (parsed.length) tables.push(...parsed); else skipped.push(rel);
    }
    return { tables, big, skipped };
  }

  /** A sampled schema is insufficient for identity graphs or independence checks.
   * Materialize the bounded complete inventory for both practice paths; refuse
   * larger graphs rather than silently reverting to reservoir/donor generation. */
  async practiceTables(dir:string):Promise<{tables:Table[];skipped:string[]}> {
    const inventory=await this.tables(dir), tables=[...inventory.tables];
    for(const entry of inventory.big){
      if(entry.rows*Math.max(1,entry.table.header.length)>50_000_000)throw new StagerRefusal('Independent practice graph exceeds the complete-inventory cell limit');
      const parsed=readPhysical(path.join(dir,entry.table.file),entry.table.file);
      if(parsed.length!==1||parsed[0]!.rows.length!==entry.rows)throw new StagerRefusal('Complete practice inventory differs from physical record count');
      tables.push(...parsed);
    }
    if(tables.reduce((n,t)=>n+t.rows.length*t.header.length,0)>50_000_000)throw new StagerRefusal('Independent practice graph exceeds the complete-inventory cell limit');
    return {tables,skipped:inventory.skipped};
  }

  async stage(req: StageRequest, servedDeclarations?:Readonly<Record<string,import('./practice-structure.ts').StructureDeclaration>>): Promise<StagedData> {
    if (!existsSync(req.dataRoot)) throw new StagerRefusal("data root does not exist");
    const manifest = sha256Canonical(treeHashes(req.dataRoot));
    if (req.expectedManifestHash && req.expectedManifestHash !== manifest) throw new StagerRefusal("raw manifest differs from the host pin");
    const key = `${SAFE(req.datasetId)}-${manifest.slice(0, 16)}`;
    const realDataDir = path.join(this.o.hostRoot, "staged", key, "real");
    for(let copy=0;copy<2&&(!existsSync(realDataDir)||treeHash(realDataDir)!==manifest);copy++) {
      removeTree(realDataDir);
      mkdirSync(path.dirname(realDataDir), { recursive: true, mode: 0o700 });
      cpSync(req.dataRoot, realDataDir, { recursive: true, dereference: false });
    }
    if (treeHash(realDataDir) !== manifest) throw new StagerRefusal("staged copy does not match the raw manifest after two fresh copies");
    const { tables, big, skipped } = await this.tables(realDataDir);
    // Large tables: types from a stream-wide reservoir, row count streamed; no level counts (a sample is not a marginal).
    const bigViews = big.map(({ table, rows }) => ({ ...viewTable(table), rows, columns: viewTable(table).columns.map((c) => ({ ...c, levels: null, missing: -1, distinct: -1 })) }));
    const views: TableView[] = [...tables.map(viewTable), ...bigViews, ...skipped.map((s) => ({ file: s, rows: -1, columns: [], parsed: false }))];
    const schemaViewDir = path.join(this.o.shareRoot, "staged", key, "schema");
    mkdirSync(schemaViewDir, { recursive: true });
    const contract=req.contract?loadPinnedContract(req.contract):null;
    const declarations=contract?synthesisSchema(contract.public.content):undefined;
    const dictionarySchema=declarations?.some(d=>d.measurementDictionary)?declarations:undefined;
    const rawDeclarations=Object.fromEntries(tables.map(t=>[t.file,servedDeclarations?.[t.file]??genericPracticeDeclaration(views,t,{outcomes:[],...(dictionarySchema?{schema:dictionarySchema}:{})})]));
    validateDictionaryTargets(tables,rawDeclarations);
    for(const t of tables){const d=rawDeclarations[t.file]?.measurementDictionary;if(d)checkDictionaryRows(t,d,true);}
    const schemaDeclarations=resolvePracticeKeys(tables,rawDeclarations);
    const publicViews=views.toSorted((a,b)=>a.file.localeCompare(b.file)).map(v=>{
      const table=tables.find(t=>t.file===v.file),d=schemaDeclarations[v.file];
      return {...v,columns:v.columns.map((c,j)=>{if(table&&d?.measurementDictionary&&!Object.values(d.measurementDictionary.fields).includes(c.name)){const inventory=columnInventory(table,j,d);if(dictionaryTextColumn(table,j,d))return {name:c.name,type:'string' as const,missing:0,distinct:-1,levels:null};if(inventory.kind==='number')return {name:c.name,type:inventory.integer?'integer' as const:'number' as const,missing:inventory.missing.reduce((n,m)=>n+m.count,0),distinct:-1,levels:null,min:inventory.min,max:inventory.max};}const key=d?.keys.includes(c.name),inv=table&&d&&!key&&c.type==='string'?columnInventory(table,j,d):null;
        const levels=!key&&c.type==='string'&&inv?.kind==='levels'?Object.fromEntries(inv.levels.map(level=>[level,1])):null;
        return {...c,distinct:key?c.distinct:levels?Object.keys(levels).length:-1,levels};})};
    });
    const schema = {schema:'omb-investigate/schema-view@1',dataset:req.datasetId,tables:publicViews,note:'Column inventories only. Level sets have no empirical frequencies.'};
    writeFileSync(path.join(schemaViewDir, "schema.json"), JSON.stringify(schema, null, 2) + "\n");
    auditSchemaProjection(schema,schemaViewDir);
    const canaries = pickCanaries([...tables, ...big.map((b) => b.table)], views, `${req.publicText}\n${JSON.stringify(schema)}`, this.o.canaryCount ?? 8);
    const warnings = skipped.length ? [`not parsed as tables (schema shows the file name only): ${skipped.slice(0, 20).join(", ")}`] : [];
    // Under a pinned contract: the host-only certification input is the real data plus the
    // contract's public source assets at contract-assets/ (never part of any worker view).
    let contractInput: StagedData["contractInput"] = null;
    if (req.contract) {
      const dir = path.join(this.o.hostRoot, "staged", key, `contract-input-${req.contract.expectedContractHash.slice(0, 16)}`);
      removeTree(dir);
      cpSync(realDataDir, dir, { recursive: true, dereference: false });
      if (req.contract.assetsDir && existsSync(req.contract.assetsDir) && readdirSync(req.contract.assetsDir).length) cpSync(req.contract.assetsDir, path.join(dir, "contract-assets"), { recursive: true, dereference: false });
      contractInput = { dir, manifestHash: treeHash(dir) };
    }
    if (big.length) warnings.push(`large tables described from a deterministic reservoir sample across all rows: ${big.map((b) => b.table.file).join(", ")}`);
    return {
      datasetId: req.datasetId, manifestHash: manifest, contractHash: req.contract?.publicHash ?? null, schemaViewDir, schemaViewHash: treeHash(schemaViewDir),
      realDataDir, realOnlyFiles:skipped, effectiveUnits: null, canaries, partition: null, predictedConfirmPower: null, contractInput, warnings,
      ...(declarations ? { synthesisSchema: declarations } : {}),
    };
  }

  practiceProvenance(staged:StagedData,tables:readonly Table[],seed:string,outcomes:readonly string[],exposures:readonly string[]):{input:AllowedPractice;file:string}{
    const published=JSON.parse(readFileSync(path.join(staged.schemaViewDir,'schema.json'),'utf8'));
    const declarations=Object.fromEntries(tables.map(t=>[t.file,{...(staged.practiceDeclarations?.[t.file]??genericPracticeDeclaration(tables.map(viewTable),t,{outcomes,exposures,schema:staged.synthesisSchema})),outcomes,exposures}]));
    const input=compilePractice(tables,declarations,staged.synthesisSchema??[],seed);
    input.schema=published;
    const file=path.join(path.dirname(staged.realDataDir),'practice-'+createHash('sha256').update(seed).digest('hex')+'.json');
    writeFileSync(file,JSON.stringify(input));return {input,file};
  }

  /**
   * Development data: built ONLY from the parsed-table inventory (finding 2). Each table holding an
   * outcome is blinded by scrambleTable; tables without one are kept; large tables use permuted sampled rows; unparsed sidecars and unknown formats are left out.
   */
  async scramble(req: ScrambleRequest): Promise<DerivedData> {
    const dir = path.join(path.dirname(req.staged.schemaViewDir), `scrambled-${req.seed.slice(0, 12)}`);
    removeTree(dir);
    mkdirSync(dir, { recursive: true });
    const { tables, skipped } = await this.practiceTables(req.staged.realDataDir);
    const published = (JSON.parse(readFileSync(path.join(req.staged.schemaViewDir, "schema.json"), "utf8")) as { tables: TableView[] }).tables;
    const provenance=this.practiceProvenance(req.staged,tables,req.seed,req.outcomes,req.exposures);
    const output=renderPractice(provenance.input);
    const warnings=skipped.length?[`Non-table attachments omitted: ${skipped.join(', ')}`]:[];
    writePhysical(dir, output);
    return { dir, hash: treeHash(dir), warnings, provenance:provenance.file };
  }

  /** Synthetic twin from the published schema (findings 3 and 7): see synthesizeTables. */
  async synthesize(req: { staged: StagedData; seed: string; investigationId: string; outcomes?: readonly string[]; exposures?: readonly string[] }): Promise<DerivedData> {
    const dir = path.join(path.dirname(req.staged.schemaViewDir), `synthetic-${req.seed.slice(0, 12)}`);
    removeTree(dir);
    mkdirSync(dir, { recursive: true });
    const published = JSON.parse(readFileSync(path.join(req.staged.schemaViewDir, "schema.json"), "utf8")) as { tables: TableView[] };
    const { tables, skipped } = await this.practiceTables(req.staged.realDataDir);
    const options = { seed: req.seed, outcomes: req.outcomes ?? [], exposures: req.exposures ?? [], schema: req.staged.synthesisSchema, declarations: req.staged.practiceDeclarations };
    const provenance=this.practiceProvenance(req.staged,tables,req.seed,options.outcomes,options.exposures);
    writePhysical(dir, renderPractice(provenance.input));
    return { dir, hash: treeHash(dir), provenance:provenance.file, warnings: skipped.length ? [`no synthetic twin for unparsed files: ${skipped.slice(0, 20).join(", ")}`] : [] };
  }

  /** Host self-check of practice structure and physical formats. Large delimited
   * synthetic files additionally compare every record's format through a streaming digest. */
  async verifyPractice(req: { staged: StagedData; data: DerivedData; kind: "scramble" | "synthetic"; outcomes?: readonly string[]; exposures?: readonly string[]; files?: readonly string[] }): Promise<PracticeCheck> {
    const published = JSON.parse(readFileSync(path.join(req.staged.schemaViewDir, "schema.json"), "utf8")) as { tables: TableView[] };
    const { tables } = await this.practiceTables(req.staged.realDataDir);
    const real = req.files ? tables.filter(t => req.files!.includes(t.file)) : tables;
    const copies = new Map<string, Table | "empty">();
    const formatViolations: PracticeViolation[] = [];
    for (const file of new Set(real.map(physicalPath))) {
      try { if(!auditPhysicalMetadata(path.join(req.data.dir,file)))formatViolations.push({file,check:'container-leakage',detail:'unmodeled physical metadata remains in practice container'});
        const parsed=readPhysical(path.join(req.data.dir,file),file); for (const t of parsed) copies.set(t.file,t);
        if(!parsed.length && file.endsWith('.json') && readFileSync(path.join(req.data.dir,file),'utf8').trim()==='[]')copies.set(file,'empty'); }
      catch { formatViolations.push({file,check:'physical-format',detail:'practice file missing or physical codec cannot read it'}); }
    }
    for (const t of real) { const p=copies.get(t.file); if(p==='empty' && req.kind==='scramble')continue; if(!p || p==='empty' || formatSignature(t)!==formatSignature(p)) formatViolations.push({file:t.file,check:'physical-format',detail:'served and practice physical formats differ'}); }
    const practice = (file:string):Table|"empty"|null => copies.get(file) ?? null;
    const r = verifyPracticeTables(real, practice, published.tables, { outcomes: req.outcomes ?? [], exposures: req.exposures ?? [], schema: req.staged.synthesisSchema, declarations: req.staged.practiceDeclarations }, req.kind === "scramble");
    r.violations.push(...formatViolations);
    try {
      if(!req.data.provenance)throw new Error('Missing host provenance receipt');
      const input=JSON.parse(readFileSync(req.data.provenance,'utf8')) as AllowedPractice;
      for(const detail of auditRebuild(input,req.data.dir,req.staged.schemaViewDir))r.violations.push({file:'*',check:'provenance-rebuild',detail});
    }catch(error){r.violations.push({file:'*',check:'provenance-rebuild',detail:String(error)});}

    if(!r.violations.length && real.length) {
      const options={outcomes:req.outcomes??[],exposures:req.exposures??[],...(req.staged.synthesisSchema?{schema:req.staged.synthesisSchema}:{}),...(req.staged.practiceDeclarations?{declarations:req.staged.practiceDeclarations}:{})};
      const declarations=resolvePracticeKeys(real,Object.fromEntries(real.map(t=>[t.file,allocationDeclaration(t,{...(options.declarations?.[t.file]??genericPracticeDeclaration(published.tables,t,options)),outcomes:options.outcomes,exposures:options.exposures})])));
      try {
        const cohort=repeatedAuditCohort(real,declarations);
        const full=JSON.parse(readFileSync(req.data.provenance!,'utf8')) as AllowedPractice;
        const draws=(function*(){for(let i=0;i<16;i++){
          const input=compilePractice(cohort,declarations,options.schema??[],createHash('sha256').update(`host-audit:${req.data.hash}:${i}`).digest('hex'));
          // A sampled cohort can make a partial real-data relation look universal.
          // Only relations admitted from the complete source may shape audit draws.
          for(const t of input.tables){const orders=full.tables.find(f=>f.file===t.file)?.orders??[];t.orders=(t.orders??[]).filter(o=>orders.some(f=>f.lower===o.lower&&f.upper===o.upper));}
          yield renderPractice(input);
        }})();
        r.violations.push(...auditPracticeDraws(cohort,draws,declarations));
      } catch(error) {r.violations.push({file:'*',check:'repeated-exposure-leakage',detail:`host independence draws unavailable: ${String(error)}`});}
    }
    return { ok: r.violations.length === 0, rule: PRACTICE_RULE, kind: req.kind, tables: r.tables, violations: r.violations };
  }
}
