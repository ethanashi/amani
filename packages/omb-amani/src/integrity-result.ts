import {fieldCheck,normalizedIntegrityField} from './integrity-question.ts';
import { canonicalSha256 } from '../../bio-core/src/index.ts';
import { object, pointer, type Json } from './results.ts';
import type { IntegrityEvidence } from './integrity.ts';

/** One vocabulary for detection, auto-binding and frozen-output protection, independent of shape. */
export const integrityKey = (key: string): boolean => /^(data[_-]?)?integrity$/i.test(key) || /^n_?(?:data_?)?integrity/i.test(key.replace(/([a-z])([A-Z])/g, '$1_$2').replaceAll('-', '_')) || fieldCheck(normalizedIntegrityField(escapePointer(key))) !== undefined;
/** Optional served report[].integrity is a trust-boundary marker, never evidence or scope. */
export function markedIntegrityRoots(contract: Json | undefined): string[] {
  if (!object(contract) || !Array.isArray(contract.report)) return [];
  return contract.report.filter(object).flatMap(c => {
    if (c.integrity === undefined) return [];
    if (typeof c.integrity !== 'boolean') throw new Error('report criterion integrity marker must be a boolean');
    if (!c.integrity) return [];
    if (typeof c.report !== 'string' || !c.report.startsWith('/') || /~(?![01])/.test(c.report) || c.report.slice(1).split('/').some(s => ['__proto__', 'constructor', 'prototype'].includes(s.replace(/~1/g, '/').replace(/~0/g, '~')))) throw new Error('invalid integrity report pointer');
    return [c.report];
  });
}
export function integritySections(template: Json, at = '', context: {publicContract?: Json} = {}): string[] {
  const marked = at === '' ? markedIntegrityRoots(context.publicContract) : [];
  return [...new Set([...marked, ...namedIntegritySections(template, at)])];
}
function namedIntegritySections(template: Json, at: string): string[] {
  if (Array.isArray(template)) return template.flatMap((v, i) => integritySections(v, `${at}/${i}`));
  if (!object(template)) return [];
  return Object.entries(template).flatMap(([key, value]) => {
    const child = at + '/' + escapePointer(key);
    return integrityKey(key) ? [child] : integritySections(value, child);
  });
}
export const escapePointer = (s: string) => s.replace(/~/g, '~0').replace(/\//g, '~1');

/** Explicit references admit only software-owned leaf paths, for both pointers and projections.
 * levelSource is a reserved host provenance extension: legacy plan-derived levels are withheld. */
export function integrityValue(ref: Record<string, Json>, evidence: IntegrityEvidence | undefined, context: { publicContract?: Json } = {}): { value: Json; source: string } | undefined {
  if (!evidence || !object(evidence.value) || evidence.value.status !== 'observed' || typeof ref.$integrity !== 'string') return;
  if (Object.keys(ref).some(k => !['$integrity', 'select', 'format'].includes(k))) return;
  const p = ref.$integrity;
  const collection = /^(\/duplicates\/groups|\/problems|\/unitsOfAnalysis)(?:\/(0|[1-9]\d*)\/(.+))?$/.exec(p);
  const count = /^\/duplicates\/(pairCount|matrixBackedPairCount|tabularOnlyPairCount|excessUnits)$/.test(p);
  const linkage = /^\/linkage\/(pairCount|exactProfilePairCount|sharedUnitPairCount|repeatedObservationPairCount|observations)$/.test(p);
  if (!collection && !count && !linkage) return;
  let leaf: string | undefined;
  if (collection) {
    if (collection[2] !== undefined) {
      if (ref.select !== undefined) return;
      leaf = collection[3];
    } else {
      if (typeof ref.select !== 'string' || !ref.select.startsWith('/')) return;
      leaf = ref.select.slice(1);
    }
    const allowed = collection[1] === '/unitsOfAnalysis' ? /^(usedTokens(?:\/(?:0|[1-9]\d*))?|usedCount|level)$/ : collection[1] === '/problems' ? /^(units(?:\/(?:0|[1-9]\d*))?|tables(?:\/(?:0|[1-9]\d*))?|count|detail|kind)$/ : /^(units(?:\/(?:0|[1-9]\d*))?|tables(?:\/(?:0|[1-9]\d*))?|count|detail)$/;
    if (!leaf || !allowed.test(leaf)) return;
  } else if (ref.select !== undefined) return;
  const data = evidence.value;
  if (linkage && (!object(data.linkage) || data.linkage.status !== 'observed')) return;
  if (p.startsWith('/duplicates/') && (!object(data.duplicates) || data.duplicates.status !== 'observed')) return;
  if (collection?.[1] === '/unitsOfAnalysis') {
    const units = data.unitsOfAnalysis;
    const selected = Array.isArray(units) ? collection[2] === undefined ? units : [units[Number(collection[2])]] : [];
    if (!selected.length || selected.some(u => !object(u) || u.status !== 'observed' || typeof u.usedCount !== 'number' || !Number.isInteger(u.usedCount) || u.usedCount < 0)) return;
    if (leaf === 'level' && selected.some(u => !object(u) || u.levelSource !== 'software-derived' || typeof u.level !== 'string' || !u.level.trim() || u.level === 'unit_id')) return;
  }
  let value = pointer(data, p);
  if (value === undefined || value === null) return;
  if (ref.select !== undefined) {
    if (!Array.isArray(value) || typeof ref.select !== 'string') return;
    const projection = value.map(v => pointer(v, ref.select as string));
    if (projection.some(v => v === undefined || v === null)) return;
    value = (projection as Json[]).flatMap(v => Array.isArray(v) ? v : [v]);
  }
  if (collection?.[1] === '/unitsOfAnalysis' && leaf === 'level' && Array.isArray(value)) value = distinctIntegrityValues(value);
  if (ref.format !== undefined) {
    if (ref.format !== 'dataset' || leaf !== 'tables' || !Array.isArray(value)) return;
    const projected = datasetIdentifiers(value, context.publicContract);
    if (!projected) return;
    value = projected;
  }
  if (!scalarTree(value)) return;
  return { value, source: `integrity:${evidence.fileSha256}#${p}${ref.select === undefined ? '' : ` select=${ref.select}`}${ref.format === undefined ? '' : ` format=dataset contract=${canonicalSha256(context.publicContract ?? null)}`}` };
}
export function datasetIdentifiers(files: Json[], contract: Json | undefined): string[] | undefined {
  const tables = object(contract) && Array.isArray(contract.tables) ? contract.tables.filter(object) : [];
  const identifiers: string[] = [];
  for (const file of files) {
    const matches = tables.filter(t => typeof t.path === 'string' && typeof file === 'string' && t.path.replace(/^data\//, '') === file.replace(/^data\//, ''));
    if (typeof file !== 'string' || matches.length !== 1 || typeof matches[0]!.dataset !== 'string') return;
    identifiers.push(matches[0]!.dataset as string);
  }
  return [...new Set(identifiers)];
}
function scalarTree(v: Json): boolean {
  return typeof v === 'string' || typeof v === 'boolean' || typeof v === 'number' && Number.isFinite(v) || Array.isArray(v) && v.every(scalarTree);
}

export const distinctIntegrityValues = (value: Json[]): Json[] => [...new Set(value)];
