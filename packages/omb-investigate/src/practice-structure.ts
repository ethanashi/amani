import {independentRecords,checkIndependentInventory} from './practice-independent.ts';
import {aliasPracticeKeys,reassignExposure,allocationDeclaration} from './practice-exposure.ts';
// Structure-preserving practice data (rule practice-structure/v1).
//
// Practice data (the scrambled development copy and the synthetic dry-run twin) must let the
// frozen code run unchanged on the real data later, while carrying no information about the
// confirmatory answer. The answer lives in how measurements line up with design labels, so:
//   key          declared identity/coordinate columns           kept (scramble) / pseudonymised (synthesis)
//   design       categorical columns that define structure       kept: real labels, row-aligned with the keys
//   attribute    every other categorical (may be an outcome)     permuted without breaking per-unit structure
//   measurement  integer/decimal and ambiguous numeric columns   regenerated independently of design labels
//   text         free text                                       permuted / redacted (unchanged policy)
// A categorical column is design only when the real table proves it structural: it completes
// the row key (trial + arm, stratum + arm, subject + visit), or it is a slot inside a repeated
// unit (one value per row of the unit, e.g. muscle within donor). A served contract declares no
// design/outcome distinction, and c3's `response` is a categorical outcome, so a categorical that
// is merely a unit attribute is never kept as-is. Integer measurement pairs with A <= B in every
// real row (events <= patients, start <= end day) stay ordered; missingness masks stay in place.
// This classification checks runnable shape only; it is not evidence of secrecy.
// Exposure assignment and independent leakage diagnostics live in separate modules.
import type { Table } from './tabular.ts';
import { summaryDomain } from './practice-summary.ts';

export const PRACTICE_RULE = 'practice-independent/v3';
const MISSING = new Set(['', 'na', 'nan', 'null', 'none', '.', 'n/a', '-']);
/** A categorical column with at most this many levels can be inferred when its role is unknown. */
export const LOW_CARDINALITY = 20;
/** A composite row key (and a within-unit slot) must identify at least this share of rows. */
export const STRUCTURE_THRESHOLD = 0.9;
/** Wider integer tables are feature matrices (genotype dosages, counts per sample), not
 * count/total designs; pairwise bounds are detected only up to this many integer columns. */
export const MAX_BOUND_COLUMNS = 64;
const CATEGORICAL_ROLES = ['categorical', 'category'];
export const MEASUREMENT_ROLES = ['integer', 'decimal', 'number', 'float', 'count', 'measurement', 'outcome'];
export const hasOutcomeRole = (d: StructureDeclaration, name: string): boolean => !!d.outcomes?.includes(name) || MEASUREMENT_ROLES.includes(d.roles?.[name] ?? '');

export type PracticeRole = 'key' | 'design' | 'attribute' | 'measurement' | 'text' | 'reference';
export type PracticeScope = { kind: 'row' } | { kind: 'unit'; unit: string } | { kind: 'within'; unit: string };
export interface PracticeColumn {
  name: string; index: number; role: PracticeRole; rule: string; scope?: PracticeScope;
  distinct?: number; nullSummary?: boolean; integer?: boolean; nonNegative?: boolean; observedMin?: number; observedMax?: number; declaredMin?: number; declaredMax?: number; levels?: string[];
  /** Constant apart from missing values; tokens still stay in place. */
  degenerate?: boolean;
}
export interface PracticeStructure {
  declaration?: StructureDeclaration;
  file: string; rule: typeof PRACTICE_RULE; columns: PracticeColumn[]; exposures?: readonly string[];
  /** Keys plus the design columns that complete them; non-unique real rows on it. */
  rowKey: string[]; rowKeyDuplicates: number;
  /** Entity identifiers plus completing design columns: checked in every practice copy
   * (coordinates and alleles are regenerated in synthetic GWAS twins, so never checked). */
  checkKey: string[]; checkKeyDuplicates: number;
  /** Identifier columns whose values repeat (multi-row units). */
  units: string[];
  /** Columns whose per-row missing positions practice data must keep. */
  maskColumns: number[];
  /** Integer measurement pairs with lower <= upper in every real row where both are present. */
  bounds: { lower: string; upper: string }[];
  nonDataRows: number[];
  missing: readonly string[] | null;
}
export interface StructureDeclaration {
  /** Closed trusted constants, populated only from an explicit served dictionary block. */
  measurementDictionary?: import('./measurement-dictionary.ts').MeasurementDictionary;
  matrix?: boolean;
  matrixNamespace?: string | undefined;
  keyNamespaces?: Readonly<Record<string,string>>;
  keySeparators?: Readonly<Record<string,string>>;
  formats?: Readonly<Record<string,import('./synthesis-schema.ts').SynthesisColumn>>;
  matrixCells?: import('./synthesis-schema.ts').SynthesisColumn | undefined;
  /** Host-only served allocation metadata. Never populated from the worker plan. */
  headerReferences?: readonly number[];
  randomization?: { mode?: 'unit' | 'summary'; unit?: string; strata?: readonly string[]; orderRequired?: boolean; columns?: readonly string[]; visit?: string; dateFormats?: Readonly<Record<string,string>>; inequalities?: readonly {lower:string;upper:string}[]; increasing?: readonly {column:string;unit?:string;index?:string}[] };
  /** Plan outcomes override every structural hint and role. */
  outcomes?: readonly string[];
  /** Plan exposures never participate in inferred outcome bounds. */
  exposures?: readonly string[];
  /** Host-inferred cross-file reference/metadata column indices. */
  structural?: readonly number[];
  /** Identity/coordinate columns kept or pseudonymised by the caller. */
  keys: readonly string[];
  /** Identifier keys that name entities (trial, subject, donor); never coordinates or alleles. */
  units: readonly string[];
  /** Declared contract roles; absent means unknown. */
  roles?: Readonly<Record<string, string | undefined>>;
  levels?: Readonly<Record<string, readonly string[] | undefined>>;
  bounds?: Readonly<Record<string, { min?: number; max?: number } | undefined>>;
  missing?: readonly string[] | null;
}
export class PracticeStructureError extends Error {}
export interface PracticeViolation { file: string; check: string; detail: string }

export const missingValue = (v: string, missing: readonly string[] | null | undefined): boolean => missing ? missing.includes(v) : MISSING.has(v.trim().toLowerCase());
const INTEGER = /^[+-]?\d+$/;
/** Explicit row-kind markers, never a guess based on a numeric outlier. */
export function nonDataRowColumns(table: Table): number[] {
  return table.header.flatMap((h, j) => /^(row|record)[_ -]?(kind|type)$/i.test(h) && table.rows.some(r => /^(record|data|observation)$/i.test((r[j] ?? '').trim())) && table.rows.some(r => /^(grand[ _-]?)?totals?$|^subtotal$|^summary$/i.test((r[j] ?? '').trim())) ? [j] : []);
}
export function nonDataRows(table: Table): number[] {
  const markers = nonDataRowColumns(table);
  return table.rows.flatMap((r, i) => markers.some(j => /^(grand[ _-]?)?totals?$|^subtotal$|^summary$/i.test((r[j] ?? '').trim())) ? [i] : []);
}
const MISSING_TOKEN = '\u0000missing';

/** Classify every column of one record table from its declaration and the REAL rows (host only). */
export function practiceStructure(table: Table, d: StructureDeclaration): PracticeStructure {
  const n = table.rows.length, missing = d.missing ?? null;
  const excluded = new Set(nonDataRows(table)), markers = new Set(nonDataRowColumns(table));
  const cell = (i: number, j: number) => table.rows[i]![j] ?? '';
  const present = (j: number) => table.rows.flatMap((_, i) => excluded.has(i) ? [] : [cell(i, j)]).filter(v => !missingValue(v, missing));
  const keys = new Set(d.keys.filter(k => table.header.includes(k) && !hasOutcomeRole(d, k)));
  const columns: PracticeColumn[] = table.header.map((name, index) => {
    const outcome = hasOutcomeRole(d, name);
    if (!outcome && keys.has(name)) return { name, index, role: 'key', rule: 'declared key' };
    if (!outcome && d.structural?.includes(index)) return { name, index, role: 'reference', rule: 'cross-file schema reference' };
    if (!outcome && markers.has(index)) return { name, index, role: 'design', rule: 'explicit non-data row marker' };
    const role = d.roles?.[name], values = present(index), distinct = new Set(values).size;
    const numeric = values.length > 0 && values.every(v => v.trim() !== '' && Number.isFinite(Number(v)));
    const declared = d.levels?.[name];
    if (outcome) return numeric && !declared?.length ? measurement(name, index, values, role, d.bounds?.[name], d.outcomes?.includes(name) ? undefined : summaryDomain(table.header, name, d.bounds)) : { name, index, role: 'attribute', rule: 'outcome', levels: [...(declared ?? new Set(values))] };
    if (role === 'text' && !numeric && !(distinct <= LOW_CARDINALITY && distinct > 1 && distinct < values.length)) return { name, index, role: 'text', rule: 'declared text' };
    if (role && CATEGORICAL_ROLES.includes(role)) return { name, index, role: 'attribute', rule: 'declared categorical', ...(declared ? { levels: [...declared] } : {}) };
    if ((role && MEASUREMENT_ROLES.includes(role)) || (!role || role === 'unknown' || !['id', 'chromosome'].includes(role)) && numeric) return measurement(name, index, values, role, d.bounds?.[name], summaryDomain(table.header, name, d.bounds));
    if (role === 'id' || role === 'chromosome') return { name, index, role: 'key', rule: `declared ${role}` };
    if (distinct <= LOW_CARDINALITY && distinct < values.length) return { name, index, role: 'attribute', rule: 'unknown low-cardinality categorical' };
    return { name, index, role: 'text', rule: 'unknown high-cardinality text' };
  });
  const tuple = (cols: readonly number[]) => {
    const counts = new Map<string, number>();
    for (let i = 0; i < n; i++) { const k = JSON.stringify(cols.map(j => cell(i, j))); counts.set(k, (counts.get(k) ?? 0) + 1); }
    let duplicates = 0; for (const c of counts.values()) if (c > 1) duplicates += c;
    return { distinct: counts.size, duplicates };
  };
  // 1. Row-key completion: the fewest eligible non-outcome categorical columns that,
  // with the declared keys, identify >= 90% of rows. Nothing is added when the keys already do.
  const keyIdx = columns.filter(c => c.role === 'key' || c.role === 'reference').map(c => c.index);
  let current = tuple(keyIdx), chosen: number[] = [];
  const unique = (s: { duplicates: number }) => n === 0 || (n - s.duplicates) / n >= STRUCTURE_THRESHOLD;
  if (!unique(current)) {
    const pools = [columns.filter(c => c.role === 'attribute' && !hasOutcomeRole(d, c.name) && d.roles?.[c.name] !== 'text')];
    for (const pool of pools) {
      while (!unique(current)) {
        let best: { column: PracticeColumn; stats: ReturnType<typeof tuple> } | null = null;
        for (const c of pool) if (!chosen.includes(c.index)) { const stats = tuple([...keyIdx, ...chosen, c.index]); if (stats.distinct > current.distinct && (!best || stats.distinct > best.stats.distinct)) best = { column: c, stats }; }
        if (!best) break;
        chosen.push(best.column.index); current = best.stats;
      }
      if (unique(current)) break;
    }
    if (!unique(current)) { chosen = []; current = tuple(keyIdx); }
    for (const j of chosen) Object.assign(columns[j]!, { role: 'design', rule: 'completes the row key', scope: undefined });
  }
  // 2. Repeated units: unit attributes, within-unit slots and within-unit attributes.
  const units = d.units.filter(u => keys.has(u)).filter(u => {
    const j = table.header.indexOf(u), seen = new Set<string>();
    for (let i = 0; i < n; i++) { const v = cell(i, j); if (missingValue(v, missing)) continue; if (seen.has(v)) return true; seen.add(v); }
    return false;
  });
  const groups = new Map(units.map(u => {
    const j = table.header.indexOf(u), g = new Map<string, number[]>();
    for (let i = 0; i < n; i++) { const v = cell(i, j); if (!missingValue(v, missing)) g.set(v, [...(g.get(v) ?? []), i]); }
    return [u, [...g.values()].filter(rows => rows.length > 1)] as const;
  }));
  for (const c of columns.filter(c => c.role === 'attribute')) {
    if (hasOutcomeRole(d, c.name)) { c.scope = { kind: 'row' }; continue; }
    const token = (i: number) => missingValue(cell(i, c.index), missing) ? MISSING_TOKEN : cell(i, c.index);
    const constant = units.find(u => groups.get(u)!.every(rows => new Set(rows.map(token)).size === 1));
    if (constant) { c.scope = { kind: 'unit', unit: constant }; continue; }
    const unit = units[0];
    if (!unit) { c.scope = { kind: 'row' }; continue; }
    let slots = 0, total = 0;
    for (const rows of groups.get(unit)!) {
      const values = rows.map(i => cell(i, c.index)).filter(v => !missingValue(v, missing)), counts = new Map<string, number>();
      for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
      total += values.length; slots += values.filter(v => counts.get(v) === 1).length;
    }
    if (!hasOutcomeRole(d, c.name) && d.roles?.[c.name] !== 'text' && total > 0 && slots / total >= STRUCTURE_THRESHOLD) Object.assign(c, { role: 'design', rule: `slot within ${unit}`, scope: undefined });
    else c.scope = { kind: 'within', unit };
  }
  for (const c of columns) if (c.role === 'attribute' || c.role === 'measurement' || c.role === 'text') {
    const values = present(c.index);
    if (values.length < n && new Set(values).size <= 1) c.degenerate = true;
  }
  // 3. Logical order between integer measurements (counts within totals, ordered days).
  const ints = columns.filter(c => c.role === 'measurement' && c.integer && !d.exposures?.includes(c.name));
  const bounds: PracticeStructure['bounds'] = [];
  if (ints.length <= MAX_BOUND_COLUMNS) for (const a of ints) for (const b of ints) {
    if (a === b) continue;
    let both = 0, strict = false, holds = true;
    for (let i = 0; i < n && holds; i++) {
      if (excluded.has(i)) continue;
      const x = cell(i, a.index), y = cell(i, b.index);
      if (missingValue(x, missing) || missingValue(y, missing)) continue;
      both++; const p = Number(x), q = Number(y);
      if (p > q) holds = false; else if (p < q) strict = true;
    }
    if (holds && strict && both >= 2) bounds.push({ lower: a.name, upper: b.name });
  }
  const identity = d.units.filter(u => keys.has(u)).map(u => table.header.indexOf(u));
  const check = [...identity, ...chosen];
  return { declaration:d, file: table.file, rule: PRACTICE_RULE, exposures: d.exposures ?? [], columns, rowKey: [...keyIdx, ...chosen].map(j => table.header[j]!), rowKeyDuplicates: current.duplicates,
    checkKey: check.map(j => table.header[j]!), checkKeyDuplicates: check.length ? tuple(check).duplicates : 0, units, bounds, missing, nonDataRows: [...excluded],
    maskColumns: columns.map(c => c.index) };
}
function measurement(name: string, index: number, values: string[], role: string | undefined, declared?: { min?: number; max?: number }, summary?: { min: number; max: number }): PracticeColumn {
  if (summary) {
    const lo = Math.max(summary.min, declared?.min ?? -Infinity), hi = Math.min(summary.max, declared?.max ?? Infinity);
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo >= hi || summary.min >= 0 && lo <= 0) throw new PracticeStructureError(`${name}: declared bounds leave no blinded null-summary domain`);
    return { name, index, role: 'measurement', rule: 'paired summary null domain', nullSummary: true, integer: false, nonNegative: lo >= 0, observedMin: lo, observedMax: hi, declaredMin: lo, declaredMax: hi };
  }
  const rule = role && MEASUREMENT_ROLES.includes(role) ? `declared ${role}` : 'ambiguous numeric (outcome)';
  const numeric = values.filter(v => v.trim() !== '' && Number.isFinite(Number(v)));
  const integer = numeric.length > 0 && numeric.every(v => Number.isInteger(Number(v)));
  const nonNegative = numeric.length > 0 && numeric.every(v => Number(v) >= 0);
  const observedMin = numeric.length ? numeric.reduce((m, v) => Math.min(m, Number(v)), Infinity) : undefined;
  const observedMax = numeric.length ? numeric.reduce((m, v) => Math.max(m, Number(v)), -Infinity) : undefined;
  return { name, index, role: 'measurement', rule, distinct: new Set(numeric).size, integer, nonNegative, ...(observedMin !== undefined ? { observedMin } : {}), ...(observedMax !== undefined ? { observedMax } : {}), ...(declared?.min !== undefined ? { declaredMin: declared.min } : {}), ...(declared?.max !== undefined ? { declaredMax: declared.max } : {}) };
}

const upperIndex = new WeakMap<PracticeStructure, Map<string, number[]>>();
function uppers(s: PracticeStructure, column: string): number[] {
  let m = upperIndex.get(s);
  if (!m) { m = new Map(); for (const b of s.bounds) m.set(b.lower, [...(m.get(b.lower) ?? []), s.columns.find(c => c.name === b.upper)!.index]); upperIndex.set(s, m); }
  return m.get(column) ?? [];
}
/** Row blocks of one unit column; a row whose unit key is missing is its own block. */
export function unitBlocks(table: Table, unit: string, missing: readonly string[] | null): number[][] {
  const j = table.header.indexOf(unit), g = new Map<string, number[]>(), alone: number[][] = [];
  table.rows.forEach((r, i) => { const v = r[j] ?? ''; if (missingValue(v, missing)) alone.push([i]); else g.set(v, [...(g.get(v) ?? []), i]); });
  return [...g.values(), ...alone];
}
/** Upper-bound columns are generated before the columns they bound (Kahn order, stable). */
export function generationOrder(s: PracticeStructure): PracticeColumn[] {
  const measurements = s.columns.filter(c => c.role === 'measurement'), waiting = new Map(measurements.map(c => [c.name, 0]));
  const lowers = new Map<string, string[]>();
  for (const b of s.bounds) { waiting.set(b.lower, (waiting.get(b.lower) ?? 0) + 1); lowers.set(b.upper, [...(lowers.get(b.upper) ?? []), b.lower]); }
  const out: PracticeColumn[] = [], ready = measurements.filter(c => waiting.get(c.name) === 0);
  while (ready.length) {
    const next = ready.shift()!; out.push(next);
    for (const lower of lowers.get(next.name) ?? []) { const left = waiting.get(lower)! - 1; waiting.set(lower, left); if (left === 0) ready.push(measurements.find(c => c.name === lower)!); }
  }
  if (out.length < measurements.length) throw new PracticeStructureError(`${s.file}: cyclic measurement bounds`);
  return out;
}

/** Per-row cap for a bounded column from already generated uppers (Infinity when unbounded). */
export function rowCap(s: PracticeStructure, column: string, row: readonly string[], _header?: readonly string[]): number {
  let cap = Infinity;
  for (const j of uppers(s, column)) { const v = row[j] ?? ''; if (!missingValue(v, s.missing)) cap = Math.min(cap, Number(v)); }
  return cap;
}

function shuffle<T>(values: T[], rand: () => number): T[] {
  for (let i = values.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [values[i], values[j]] = [values[j]!, values[i]!]; }
  return values;
}

/** Random draw without replacement among pool values <= cap (Fenwick tree over sorted values). */
class BoundedPool {
  readonly #values: number[]; readonly #labels: string[]; readonly #tree: number[]; #size: number;
  constructor(labels: readonly string[]) {
    const counts = new Map<string, number>(); for (const v of labels) counts.set(v, (counts.get(v) ?? 0) + 1);
    const distinct = [...counts.keys()].sort((a, b) => Number(a) - Number(b));
    this.#labels = distinct; this.#values = distinct.map(Number); this.#tree = Array(distinct.length + 1).fill(0); this.#size = labels.length;
    distinct.forEach((v, i) => this.#add(i, counts.get(v)!));
  }
  #add(i: number, delta: number) { for (let k = i + 1; k < this.#tree.length; k += k & -k) this.#tree[k]! += delta; }
  #prefix(i: number) { let s = 0; for (let k = i; k > 0; k -= k & -k) s += this.#tree[k]!; return s; }
  /** Throws when no remaining value fits under the cap. */
  take(cap: number, rand: () => number): string {
    let hi = 0; while (hi < this.#values.length && this.#values[hi]! <= cap) hi++;
    const feasible = this.#prefix(hi);
    if (feasible === 0) throw new PracticeStructureError('no remaining value fits the row bound');
    let target = Math.floor(rand() * feasible), pos = 0;
    for (let step = 1 << Math.floor(Math.log2(this.#tree.length)); step > 0; step >>= 1) if (pos + step < this.#tree.length && this.#tree[pos + step]! <= target) { pos += step; target -= this.#tree[pos]!; }
    this.#add(pos, -1); this.#size--; return this.#labels[pos]!;
  }
  get size() { return this.#size; }
}

/**
 * Scrambled development copy of one record table from its real rows: keys and design columns
 * unchanged; attributes permuted within their scope; measurements permuted with fixed missing
 * positions and bounded columns matched under their per-row caps. Every distribution is
 * subject to the retained constraints; these permutations alone do not establish secrecy. Text keeps the
 * caller's policy (`text`), with missing tokens retained. Constant columns may cause the
 * caller's blinding guard to refuse; their missing syntax is never moved to disguise a no-op.
 */
export function blindRecordTable(table: Table, s: PracticeStructure, random: (context: string) => () => number, text: (j: number, rows: string[][]) => void): string[][] {
  const d=allocationDeclaration(table,s.declaration??{keys:s.columns.filter(c=>c.role==='key').map(c=>c.name),units:s.units,missing:s.missing});
  const seed=String(random('independent-v3-seed')());
  const p=independentRecords(table,d,seed);
  reassignExposure(table,p,d,seed);
  aliasPracticeKeys([table],[p],{[table.file]:d},seed);
  return p.rows;
}

/** A swap of one measurement cell between rows i and k keeps every bound in both rows. */
export function swapKeepsBounds(s: PracticeStructure, header: readonly string[], rows: string[][], i: number, k: number, j: number): boolean {
  const column = header[j]!;
  for (const r of [i, k]) for (const b of s.bounds) {
    if (b.lower !== column && b.upper !== column) continue;
    const lo = rows[r]![header.indexOf(b.lower)] ?? '', hi = rows[r]![header.indexOf(b.upper)] ?? '';
    if (!missingValue(lo, s.missing) && !missingValue(hi, s.missing) && Number(lo) > Number(hi)) return false;
  }
  return true;
}

/** Plain-language summary for journals, BUILD-NOTES and worker feedback. */
export function describeStructure(s: PracticeStructure): string {
  const by = (role: PracticeRole) => s.columns.filter(c => c.role === role).map(c => c.name);
  return `${s.file}: keys [${by('key').join(', ')}], design [${by('design').join(', ')}], attributes [${by('attribute').join(', ')}], measurements [${by('measurement').join(', ')}]${s.bounds.length ? `, bounds [${s.bounds.map(b => `${b.lower}<=${b.upper}`).join(', ')}]` : ''}`;
}

/**
 * HOST self-check of one practice table against the real table's structure. Order-invariant:
 * synthetic rows are shuffled and keys pseudonymised, so units are compared as multisets of
 * signatures. When the practice keys equal the real keys, each unit is also compared exactly.
 * Practice data that fails this check is a host fault, never the worker's.
 */
export function checkPracticeStructure(real: Table, practice: Table, s: PracticeStructure): PracticeViolation[] {
  const d=s.declaration??{keys:s.columns.filter(c=>c.role==='key').map(c=>c.name),units:s.units,missing:s.missing};
  return checkIndependentInventory(real,practice,d);
}

/** A binary measurement may encode exposure. A binding inequality inferred from its
 * real alignment can encode the effect itself; cardinality is not structural proof.
 * Nonbinding marginal bounds remain safe (every independently drawn pair satisfies them). */
export function ambiguousPracticeBound(s: PracticeStructure): boolean {
  return s.bounds.some(b => {
    const lower=s.columns.find(c=>c.name===b.lower)!, upper=s.columns.find(c=>c.name===b.upper)!;
    return lower.distinct === 2 && lower.observedMax !== undefined && upper.observedMin !== undefined && lower.observedMax > upper.observedMin;
  });
}

/**
 * Worker or reviewer text that blames the practice INPUT (not the code): malformed, duplicated,
 * missing or contract-violating data. Only a trigger for the host self-check, which decides.
 */
export function practiceDataClaim(text: string): boolean {
  const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const subject = new Set(['input', 'inputs', 'data', 'synthetic', 'practice', 'fixture', 'dataset', 'table', 'rows', 'contract', 'schema']);
  const defect = /^(violat|invalid|malformed|inconsistent|duplicat|missing|corrupt|broken)/;
  for (let i = 0; i < words.length; i++) if (subject.has(words[i]!) && words.slice(Math.max(0, i - 12), i + 13).some(w => defect.test(w))) return true;
  return false;
}
