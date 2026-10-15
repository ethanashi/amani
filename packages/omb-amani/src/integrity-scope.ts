import {integrityQuestion} from './integrity-question.ts';
import { object, type Json } from './results.ts';
import type { IntegrityEvidence } from './integrity.ts';

export const ABSENCE_UNCERTIFIED = 'trusted check cannot certify absence of duplicates/overlap for this question';
/** Host-only extension point for future detector coverage. Observed is never complete coverage.
 * Legacy duplicate groups cover exact linked profiles only. Overlap counts need pair units. */
export interface IntegrityFindingScope { countUnit?: 'units' | 'pairs'; coverage?: 'linked-profile-exact' | 'explicit-overlap' | 'duplicate-or-overlap-union' }
export const typedOverlap = (finding: Json): boolean => object(finding) && finding.admission === 'observed' &&
  ['unit-overlap', 'sample-overlap', 'cohort-overlap', 'overlap-pairs'].includes(String(finding.kind)) &&
  typeof finding.count === 'number' && finding.count > 0;
export const overlapPairFact = (f: Json): boolean => typedOverlap(f) && object(f) && (f.kind === 'overlap-pairs' || object(f.scope) && f.scope.countUnit === 'pairs');
export const qualityProblem = (finding: Json): boolean => object(finding) && finding.admission === 'observed' &&
  ['missing-cells', 'sparse-record', 'unit-nesting'].includes(String(finding.kind)) &&
  typeof finding.count === 'number' && Number.isSafeInteger(finding.count) && finding.count > 0;
export function problemIndices(data: Record<string, Json>, overlap: boolean): number[] {
  return Array.isArray(data.problems) ? data.problems.flatMap((f, i) => (overlap ? typedOverlap(f) : qualityProblem(f)) ? [i] : []) : [];
}
export function positiveDuplicates(data: Record<string, Json>): boolean {
  return object(data.duplicates) && data.duplicates.status === 'observed' && Array.isArray(data.duplicates.groups) &&
    data.duplicates.groups.length > 0 && data.duplicates.groups.every(f => object(f) && f.admission === 'observed' && Array.isArray(f.units) && new Set(f.units).size >= 2);
}
/** Explicit selectors must not relabel generic linkage notes or duplicate facts as overlap. */
export function integrityReferenceIssue(at: string, ref: Record<string, Json>, evidence: IntegrityEvidence | undefined, context: {publicContract?: Json; prompt?: string} = {}): string | undefined {
  const field = at.split('/').at(-1)!.toLowerCase(), check = integrityQuestion(at, context).check, overlap = check === 'explicit-overlap' || check === 'duplicate-or-overlap-union', duplicate = check === 'duplicate-or-overlap-union', problems = check === 'quality-problems';
  if (!overlap && !problems && !(typeof ref.$integrity === 'string' && ref.$integrity.startsWith('/problems'))) return;
  const p = typeof ref.$integrity === 'string' ? ref.$integrity : '';
  const data = evidence?.value;
  if (duplicate && object(data) && object(data.linkage) && data.linkage.pairCount === 0 && ['/linkage/pairCount', '/linkage/observations'].includes(p)) return;
  if (overlap && !p.startsWith('/problems')) return 'overlap requires explicitly typed observed overlap facts under /problems';
  if (!p.startsWith('/problems')) return;
  if (!object(data) || !Array.isArray(data.problems)) return;
  const index = /^\/problems\/(\d+)(?:\/|$)/.exec(p)?.[1];
  const selected = index === undefined ? data.problems : [data.problems[Number(index)] ?? null];
  if (overlap && !duplicate && selected.some(unionFinding)) return 'overlap-only question; union fact covers duplicates too';
  if (overlap && duplicate && (selected.length !== 1 || !unionFinding(selected[0]!))) return 'duplicate-or-overlap requires the single union finding';
  if (overlap && (!selected.length || selected.some(f => !typedOverlap(f)))) return ABSENCE_UNCERTIFIED;
  if (overlap && /pair/.test(field) && /(^n_|count|number)/.test(field) && selected.some(f => !overlapPairFact(f))) return 'overlap facts do not declare pair counts';
  if (!overlap && (!selected.length || selected.some(f => !qualityProblem(f)))) return 'problem reference includes generic linkage or advisory findings';
}

/** Only host-served wording for this exact pointer contributes to scope. */
export function integrityWording(at: string, context: {publicContract?: Json; prompt?: string}): string {
 const c=context.publicContract;
 const criteria=object(c)&&Array.isArray(c.report)?c.report.filter(object).filter(x=>x.report===at):[];
 const lines=(context.prompt??'').split('\n').filter(line=>line.trim().replace(/^[-*]\s*/, '').startsWith('`'+at+'`'));
 return [at.split('/').at(-1), ...criteria.map(x=>typeof x.description==='string'?x.description:''), ...lines].join(' ');
}
export const unionFinding = (f: Json): boolean => typedOverlap(f) && object(f) && object(f.scope) && f.scope.coverage === 'duplicate-or-overlap-union';
