import { createHmac } from 'node:crypto';
import {validateMeasurementDictionary,type MeasurementDictionary} from './measurement-dictionary.ts';
import path from 'node:path';
export interface SynthesisColumn {
  name: string; encoding?: 'decimal'; namespace?: string; separator?: string; storage?: 'string' | 'integer' | 'number';
  precision?: 'exact' | { decimals: number } | { significant: number };
  resolution?: number; min?: number; max?: number; levels?: string[]; missing?: string[];
}
export interface SynthesisTable {
  measurementDictionary?: MeasurementDictionary;
  file: string; identifiers: string[]; matrix: boolean; fixedHeaders: string[];
  columns?: SynthesisColumn[]; headerNamespace?: string; cells?: SynthesisColumn; missing?: string[];
}
const obj = (v: unknown): v is Record<string, any> => v !== null && typeof v === 'object' && !Array.isArray(v);
const strings = (v: unknown): string[] => Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
/** Public metadata only. This projection never asserts K1 authentication. */
export function synthesisSchema(content: unknown): SynthesisTable[] {
  if (!obj(content)) return [];
  const k1 = obj(content.structure), tables = k1 ? content.structure.tables : [...(content.tables??[]),...(content.attachments??[]).filter((t:any)=>Array.isArray(t.columns))];
  if (!Array.isArray(tables)) return [];
  return tables.map((t): SynthesisTable => {
    if (!obj(t)) throw new Error('Invalid synthesis table declaration');
    const file = typeof t.path === 'string' ? t.path : typeof t.file === 'string' ? t.file : t.file?.path;
    if (typeof file !== 'string' || path.isAbsolute(file) || file.split('/').includes('..')) throw new Error('Invalid synthesis table path');
    const columns = (Array.isArray(t.columns) ? t.columns : []).map((c: unknown) => column(c));
    const raw = Array.isArray(t.columns) ? t.columns : [];
    const keys = [...new Set([...strings(t.identity_columns ?? t.identifiers ?? t.primary_key), ...strings(t.row_key),
      ...raw.filter((c: any) => c.namespace || ['id','identifier','unit','key'].includes(c.role ?? c.structural_kind)).map((c: any) => c.name),
      ...strings(t.unit_derivation?.kind === 'column-tuple' ? t.unit_derivation.columns : [])])];
    const matrix = t.layout === 'matrix' || t.unit_axis === 'columns' || t.orientation?.unit_axis === 'columns';
    const headerNamespace = t.matrix?.header_namespace ?? t.orientation?.header_namespace ?? t.header_namespace;
    const dictionary=Object.hasOwn(t,'measurement_dictionary')?validateMeasurementDictionary(t.measurement_dictionary):undefined;
    if(dictionary&&!k1)dictionary.target=dictionary.target.replace(/^data\//,'');
    return { file: k1 ? file : file.replace(/^data\//, ''), identifiers: keys, matrix,
      ...(dictionary?{measurementDictionary:dictionary}:{}),
      fixedHeaders: matrix && Array.isArray(t.row_key) ? strings(t.row_key) : columns.map(c => c.name), columns,
      ...(typeof headerNamespace === 'string' ? { headerNamespace } : {}),
      ...(obj(t.matrix?.cells ?? t.cells) ? { cells: column({ name: '*', ...(t.matrix?.cells ?? t.cells) }) } : {}),
      ...(Array.isArray(t.missing) ? { missing: strings(t.missing) } : {}) };
  });
}
function column(v: unknown): SynthesisColumn {
  if (!obj(v) || typeof v.name !== 'string') throw new Error('Invalid synthesis column');
  const c: SynthesisColumn = { name: v.name };
  if(v.encoding!==undefined){if(v.encoding!=='decimal'||!v.namespace)throw new Error('Invalid declared identifier encoding');c.encoding='decimal';}
  if (typeof v.namespace === 'string') c.namespace = v.namespace;
  if (typeof v.separator === 'string') c.separator = v.separator;
  const type = v.storage ?? v.role;
  if (type === 'integer' || type === 'position' || v.measurement?.type === 'count') c.storage = 'integer';
  else if (['number','float','decimal'].includes(type)) c.storage = 'number';
  else if (['string','id','categorical'].includes(type)) c.storage = 'string';
  const precision = v.precision ?? (v.decimals !== undefined ? { decimals: v.decimals } : undefined);
  if (precision !== undefined) {
    if (precision === 'exact') c.precision = precision;
    else if (obj(precision) && Number.isInteger(precision.decimals) && precision.decimals >= 0 && precision.decimals <= 15) c.precision = { decimals: precision.decimals };
    else if (obj(precision) && Number.isInteger(precision.significant) && precision.significant >= 1 && precision.significant <= 17) c.precision = { significant: precision.significant };
    else throw new Error('Invalid declared numeric precision');
  }
  if (v.decimal_resolution != null) { const n = Number(v.decimal_resolution); if (!(n > 0) || !Number.isFinite(n)) throw new Error('Invalid decimal resolution'); c.resolution = n; }
  const bounds = v.measurement?.bounds ?? v.bounds ?? v.range ?? v.domain;
  const lo = v.min ?? v.minimum ?? (Array.isArray(bounds) ? bounds[0] : bounds?.lower ?? bounds?.min);
  const hi = v.max ?? v.maximum ?? (Array.isArray(bounds) ? bounds[1] : bounds?.upper ?? bounds?.max);
  if (lo != null) { c.min = Number(lo); if (!Number.isFinite(c.min)) throw new Error('Invalid numeric lower bound'); }
  if (hi != null) { c.max = Number(hi); if (!Number.isFinite(c.max)) throw new Error('Invalid numeric upper bound'); }
  if (c.min !== undefined && c.max !== undefined && c.min > c.max) throw new Error('Empty numeric domain');
  const levels = v.levels ?? v.measurement?.categories;
  if (Array.isArray(levels) && levels.length) c.levels = strings(levels);
  if (Array.isArray(v.missingness_codes ?? v.missing)) c.missing = strings(v.missingness_codes ?? v.missing);
  return c;
}
/** A single mapping for a namespace, independent of table, axis, row order or storage inference. */
export function syntheticIdentifier(seed: string, value: string, namespace = '', integer = false): string {
  const h = createHmac('sha256', seed).update(JSON.stringify([namespace, value])).digest('hex');
  return integer ? String(Number.parseInt(h.slice(0, 13), 16)) : `syn_${h.slice(0, 24)}`;
}
