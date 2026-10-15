import type { PublicLayer } from '../../omb-contract/src/index.ts';
import { fail } from './primitives.ts';
/** `simpleRule`: optional locked simple-rule probability column. It is never sent to apply code;
 * the trusted scorer joins it to predictions by token (K2b-fix1 finding 17). */
export interface ApplyPlan { table: string; features: string[]; outcome: string; simpleRule?: string }
/** Identifier status propagates over join tuples, regardless of annotation type. */
export function identifierColumns(c: PublicLayer): Set<string> {
  const ids = new Set<string>(), key = (table: string, column: string) => JSON.stringify([table, column]);
  for (const t of c.structure.tables) {
    const columns = [...t.row_key, ...t.columns.filter(col => ['identifier', 'unit'].includes(col.structural_kind) || c.structure.namespaces.some(ns => ns.id === col.namespace && ns.entity_kind === 'unit')).map(col => col.name), ...(t.unit_derivation.kind === 'column-tuple' ? t.unit_derivation.columns : [])];
    columns.forEach(col => ids.add(key(t.id, col)));
  }
  for (const rule of c.structure.forbidden_uses) if (rule.uses.some(u => ['feature', 'identifier', 'covariate'].includes(u))) ids.add(key(rule.column.table, rule.column.column));
  let changed = true;
  while (changed) {
    changed = false;
    for (const j of c.structure.joins) {
      const columns = [...j.from_columns.map(col => key(j.from_table, col)), ...j.to_columns.map(col => key(j.to_table, col))];
      if (columns.some(col => ids.has(col))) for (const col of columns) if (!ids.has(col)) { ids.add(col); changed = true; }
    }
  }
  return ids;
}
/** Validate at L4 and before any durable look. */
export function planFrom(bytes: Uint8Array, contractBytes: Uint8Array): ApplyPlan {
  const p = JSON.parse(Buffer.from(bytes).toString()) as { apply?: ApplyPlan };
  const a = p.apply;
  if (!a || typeof a.table !== 'string' || typeof a.outcome !== 'string' || !Array.isArray(a.features) || !a.features.length || a.features.some(f => typeof f !== 'string' || !f.length || f === a.outcome || f === 'token') || new Set(a.features).size !== a.features.length) fail('locked plan needs unique apply features and outcome');
  if (a.simpleRule !== undefined && (typeof a.simpleRule !== 'string' || !a.simpleRule.length || a.simpleRule === 'token' || a.simpleRule === a.outcome || a.features.includes(a.simpleRule))) fail('locked simple-rule column must be distinct from features, outcome and token');
  const c = JSON.parse(Buffer.from(contractBytes).toString()) as PublicLayer;
  if (c.schema_version !== 'omb-data-contract/v3.1') fail('v3.1 public contract required');
  const table = c.structure.tables.find(t => t.id === a.table) ?? fail('unknown apply table');
  if (table.orientation.layout !== 'records' || table.orientation.unit_axis !== 'rows') fail('apply requires record-axis table');
  const identifiers = identifierColumns(c);
  const scored = [...a.features, a.outcome, ...(a.simpleRule === undefined ? [] : [a.simpleRule])];
  if (scored.some(f => identifiers.has(JSON.stringify([a.table, f])))) fail('identifier columns cannot be apply features, outcomes or simple rules');
  if (!scored.every(f => table.columns.some(c => c.name === f))) fail('unknown apply column');
  if (table.columns.find(c => c.name === a.outcome)!.structural_kind !== 'measurement') fail('apply outcome must be a measurement');
  for (const rule of c.structure.forbidden_uses) if (rule.column.table === a.table) {
    if (a.features.includes(rule.column.column) && rule.uses.some(u => ['feature', 'identifier', 'covariate'].includes(u))) fail('contract forbids apply feature use');
    if (a.outcome === rule.column.column && rule.uses.includes('outcome')) fail('contract forbids apply outcome use');
  }
  return a;
}
