import { factLeaf, verifyProcedureIntegrityFact, type ProcedureIntegrityFact } from '../../omb-certify/src/procedure-integrity.ts';
import { PROCEDURE_FACT_FIELDS, fieldCheck, integrityQuestion, normalizedIntegrityField, servedScopeLabels } from './integrity-question.ts';
import type { IntegrityBinding, IntegrityContext } from './integrity-binding.ts';
import { object, type Json } from './results.ts';

/** Certified procedure integrity facts with copies of the certified outputs they point into, kept apart
 * from Evidence.outputs (which also holds frozen worker files). Captured from the certifier port only. */
export interface ProcedureIntegrityEvidence { facts: Json[]; outputs: Record<string, Json> }
export const NO_PROCEDURE = 'no certified procedure computed this integrity fact';

/** Fields in the closed procedure-fact vocabulary never fall back to the integrity inventory. */
export const procedureFactField = (at: string): boolean => PROCEDURE_FACT_FIELDS.some(p => p.check === fieldCheck(normalizedIntegrityField(at)));

/** The field and every served description must name exactly one scope for the fact. */
export function procedureFactQuestion(at: string, context: IntegrityContext): { fact: string; scope: string } | { issue: string } {
  const q = integrityQuestion(at, context);
  if (q.issue) return { issue: q.issue };
  const entry = PROCEDURE_FACT_FIELDS.find(p => p.check === q.check);
  if (!entry) return { issue: 'unrecognized integrity field semantics; ambiguous check scope' };
  const suffix = entry.field.exec(normalizedIntegrityField(at))?.[1];
  const scopes = new Set([...(suffix ? [suffix] : []), ...servedScopeLabels(at, context)]);
  if (scopes.size === 0) return { issue: 'integrity fact scope is not named by the field or served wording' };
  if (scopes.size > 1) return { issue: 'integrity fact scope mismatch between field and served wording' };
  return { fact: entry.fact, scope: [...scopes][0]! };
}

/** Binds only a verified record whose scope is the field's outcome column, declared by the served
 * contract, with certified input covering every served row. Worker output is never consulted. */
export function procedureIntegrity(at: string, template: Json, evidence: ProcedureIntegrityEvidence | undefined, context: IntegrityContext): IntegrityBinding {
  const q = procedureFactQuestion(at, context);
  if ('issue' in q) return q;
  if (template !== null && typeof template !== 'number') return { issue: 'integrity count requires a numeric or unspecified template' };
  const facts = (evidence?.facts ?? []).filter(f => object(f) && f.fact === q.fact);
  if (!facts.length) return { issue: NO_PROCEDURE };
  for (const f of facts) { const bad = verifyProcedureIntegrityFact(f); if (bad) return { issue: `certified integrity fact refused: ${bad}` }; }
  const verified = facts as unknown as ProcedureIntegrityFact[];
  const scoped = verified.filter(f => f.scope.column === q.scope || f.scope.column === `${q.scope}_events`);
  if (!scoped.length) return { issue: `${NO_PROCEDURE} for scope ${q.scope}` };
  // A blocked or altered certified output withholds its own scope only.
  if (scoped.some(f => factLeaf(evidence!.outputs[f.output], f.pointer) !== f.value)) return { issue: 'certified integrity fact differs from its certified output' };
  const contract = object(context.publicContract) ? context.publicContract : {};
  const tables = Array.isArray(contract.tables) ? contract.tables.filter(object) : [];
  for (const f of scoped) {
    const matches = tables.filter(t => typeof t.path === 'string' && t.path.replace(/^data\//, '') === f.scope.table.replace(/^data\//, ''));
    const columns = matches.length === 1 && Array.isArray(matches[0]!.columns) ? matches[0]!.columns.filter(object) : [];
    if (columns.filter(c => c.name === f.scope.column && c.role === 'integer').length !== 1) return { issue: 'certified integrity fact scope is not declared by the served contract' };
    // Absence and counts are claims about the whole served table, not the procedure's own report.
    if (matches[0]!.rows !== f.coverage.rows) return { issue: 'certified input does not cover every served row' };
  }
  if (new Set(scoped.map(f => f.value)).size !== 1) return { issue: 'conflicting certified integrity facts for one scope' };
  const f = scoped[0]!;
  return { value: f.value, source: `procedure:${f.procedure}#${f.output}${f.pointer} fact=${f.fact} scope=${f.scope.table}:${f.scope.column} certificate=${f.certificate} record=${f.sha256}` };
}
