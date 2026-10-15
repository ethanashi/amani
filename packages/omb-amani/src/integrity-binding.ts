import {integrityQuestion} from './integrity-question.ts';
import {bindUnion} from './integrity-union.ts';
import { canonicalSha256 } from '../../bio-core/src/index.ts';
import { ABSENCE_UNCERTIFIED, positiveDuplicates, problemIndices, overlapPairFact } from './integrity-scope.ts';
import { integrityValue } from './integrity-result.ts';
import type { IntegrityEvidence } from './integrity.ts';
import { object, type Json } from './results.ts';

export interface IntegrityContext { scopedNegatives?: boolean; frozenValue?: Json; publicContract?: Json; prompt?: string; enumMappings?: Record<string, { question: string; ref: Record<string, Json>; cases: { when: Json; value: string }[] }> }
export type IntegrityBinding = { value: Json; source: string } | { issue: string };

/** Only served metadata describes the requested namespace; worker output is never consulted. */
export function autoIntegrity(at: string, template: Json, evidence: IntegrityEvidence | undefined, context: IntegrityContext): IntegrityBinding {
  if (!evidence || !object(evidence.value) || evidence.value.status !== 'observed') return { issue: 'trusted integrity inventory unavailable' };
  const data = evidence.value;
  const question = integrityQuestion(at, context);
  if (question.issue) return { issue: question.issue };
  const union = bindUnion(at, template, evidence, context);
  if (union) return union;
  const field = at.split('/').at(-1)!.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
  const contract = object(context.publicContract) ? context.publicContract : {};
  const criteria = Array.isArray(contract.report) ? contract.report.filter(object).filter(c => c.report === at) : [];
  // Restrict prose to the exact field's report line, never unrelated task instructions.
  const lines = (context.prompt ?? '').split('\n').filter(line => line.trim().replace(/^[-*]\s*/, '').startsWith('`' + at + '`'));
  const description = [...criteria.map(c => typeof c.description === 'string' ? c.description : ''), ...lines].join(' ');
  const bind = (ref: Record<string, Json>): IntegrityBinding => integrityValue(ref, evidence, context) ?? { issue: 'trusted integrity fact unavailable or incompatible' };
  function projectProblems(indices: number[], leaf: string): IntegrityBinding {
    if (!indices.length) return { issue: 'trusted checks cannot certify absence of other problems' };
    if (!Array.isArray(data.problems)) return { issue: 'trusted problem facts unavailable' };
    const values: Json[] = [];
    for (const i of indices) {
      const resolved = bind({ $integrity: `/problems/${i}/${leaf}` });
      if ('issue' in resolved) return resolved;
      values.push(...(Array.isArray(resolved.value) ? resolved.value : [resolved.value]));
    }
    return { value: values, source: `integrity:${evidence!.fileSha256}#/problems indices=${indices.join(',')} select=/${leaf}` };
  }
  if (['linked-profile-exact', 'matrix-backed', 'tabular-only', 'explicit-overlap'].includes(question.check!)) {
    if (lines.some(line => (line.match(/`\/[^`]+`/g) ?? []).length !== 1)) return { issue: 'ambiguous TASK report line contains multiple field pointers' };

    const overlap = question.check === 'explicit-overlap';
    const indices = overlap ? problemIndices(data, true) : [];
    if (overlap ? !indices.length : !positiveDuplicates(data)) return { issue: ABSENCE_UNCERTIFIED };
    if (/pair/.test(field) && /(^n_|count|number)/.test(field)) {
      if (typeof template !== 'number') return { issue: 'duplicate pair count requires a numeric template' };
      if (overlap) {
        const facts = indices.map(i => (data.problems as Json[])[i]!);
        if (facts.some(f => !overlapPairFact(f))) return { issue: 'overlap facts do not declare pair counts' };
        // Multiple findings may overlap with one another: summing could double-count.
        if (indices.length !== 1) return { issue: 'ambiguous overlap pair count aggregation' };
        return bind({ $integrity: `/problems/${indices[0]}/count` });
      }
      const matrix = question.check === 'matrix-backed', tabular = question.check === 'tabular-only';
      const count = bind({ $integrity: '/duplicates/' + (matrix ? 'matrixBackedPairCount' : tabular ? 'tabularOnlyPairCount' : 'pairCount') });
      if ('issue' in count) return count;
      return typeof count.value === 'number' && count.value > 0 ? count : { issue: ABSENCE_UNCERTIFIED };
    }
    if (/pair/.test(field)) return { issue: 'pair-list requires explicitly typed pair facts; flat identifiers are incompatible' };
    if (!Array.isArray(template)) return { issue: 'ambiguous duplicate field mapping' };
    const namespaces = new Set(criteria.flatMap(c => typeof c.namespace === 'string' ? [c.namespace] : []));
    for (const match of description.matchAll(/namespace\s+`([^`]+)`/g)) namespaces.add(match[1]!);
    if (/dataset (?:letter|name)s?/i.test(description)) namespaces.add('dataset');
    if (/sample identifiers/i.test(description)) namespaces.add('sample');
    if (namespaces.size !== 1) return { issue: 'ambiguous or missing duplicate identifier namespace' };
    const namespace = [...namespaces][0]!;
    const groups = overlap ? projectProblems(indices, namespace === 'dataset' ? 'tables' : 'units') : bind({ $integrity: '/duplicates/groups', select: namespace === 'dataset' ? '/tables' : '/units' });
    if ('issue' in groups) return groups;
    if (!Array.isArray(groups.value) || !groups.value.every(v => typeof v === 'string')) return { issue: 'duplicate identifiers are not strings' };
    const tables = Array.isArray(contract.tables) ? contract.tables.filter(object) : [];
    let identifiers: string[];
    if (namespace === 'dataset') {
      identifiers = [];
      for (const file of groups.value) {
        const datasets = new Set(tables.filter(t => typeof t.path === 'string' && typeof file === 'string' && t.path.replace(/^data\//, '') === file.replace(/^data\//, '')).map(t => t.dataset));
        if (datasets.size !== 1 || typeof [...datasets][0] !== 'string') return { issue: 'ambiguous or missing table-to-dataset mapping' };
        identifiers.push([...datasets][0] as string);
      }
    } else {
      if (!Array.isArray(contract.namespaces) || !contract.namespaces.some(n => object(n) && n.id === namespace)) return { issue: 'duplicate namespace is not declared by served contract' };
      // Current host inventories use HMAC unit tokens. Never translate those using worker aliases.
      if (groups.value.some(v => /^[uo]_[a-f0-9]{64}$/.test(v as string))) return { issue: `trusted duplicate tokens have no mapping to namespace ${namespace}` };
      const findings = overlap ? indices.map(i => (data.problems as Json[])[i]!) : object(data.duplicates) && Array.isArray(data.duplicates.groups) ? data.duplicates.groups : [];
      for (const finding of findings) {
        if (!object(finding) || !Array.isArray(finding.tables) || !finding.tables.length) return { issue: 'duplicate identifier namespace cannot be verified' };
        for (const file of finding.tables) {
          const matches = tables.filter(t => typeof t.path === 'string' && typeof file === 'string' && t.path.replace(/^data\//, '') === file.replace(/^data\//, ''));
          const axes = Array.isArray(data.tables) ? data.tables.filter(object).filter(t => t.table === file) : [];
          if (matches.length !== 1 || axes.length !== 1) return { issue: 'duplicate identifier namespace cannot be verified' };
          const table = matches[0]!, axis = axes[0]!.axis;
          const declared = axis === 'columns' && object(table.matrix) ? [table.matrix.header_namespace] : axis === 'rows' && Array.isArray(table.columns) ? table.columns.filter(object).filter(c => c.role === 'id').map(c => c.namespace) : [];
          if (!declared.length || declared.some(n => n !== namespace)) return { issue: 'ambiguous duplicate identifier axis namespace' };
        }
      }
      identifiers = groups.value as string[];
    }
    if (!identifiers.length) return { issue: ABSENCE_UNCERTIFIED };
    return { value: [...new Set(identifiers)], source: groups.source + ` namespace=${namespace} contract=${canonicalSha256(contract)}` };
  }
  if (question.check === 'quality-problems' && Array.isArray(template)) return projectProblems(problemIndices(data, false), 'detail');
  if (field === 'units_of_analysis') {
    const levels = bind({ $integrity: '/unitsOfAnalysis', select: '/level' });
    if ('issue' in levels) return levels;
    if (!Array.isArray(levels.value) || !levels.value.length || !levels.value.every(v => typeof v === 'string' && v.trim())) return { issue: 'units of analysis level unavailable' };
    const unique = levels.value;
    if (Array.isArray(template)) return { ...levels, value: unique };
    if (typeof template !== 'string' || unique.length !== 1) return { issue: 'ambiguous units of analysis; select a claim explicitly' };
    return { value: unique[0]!, source: levels.source };
  }
  return { issue: 'unrecognized integrity field semantics; use an explicit $integrity reference' };
}
