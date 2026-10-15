import {explicitIntegrity} from './integrity-publication.ts';
import {scopeRecord} from './integrity-union.ts';
import { diagnosticField, recoverDiagnosticDraft, type DiagnosticEvidence } from './diagnostic-blocks.ts';
import { autoIntegrity, type IntegrityContext } from './integrity-binding.ts';
import { integritySections, integrityValue, integrityKey, distinctIntegrityValues, escapePointer } from './integrity-result.ts';
import type { IntegrityEvidence } from './integrity.ts';
import { procedureFactField, procedureIntegrity, type ProcedureIntegrityEvidence } from './integrity-procedure.ts';
import { canonicalSha256 } from '../../bio-core/src/index.ts';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export interface Evidence extends DiagnosticEvidence {
  integrity?: IntegrityEvidence;
  /** Registry-declared integrity facts from the certifier port; never read from worker outputs. */
  procedureIntegrity?: ProcedureIntegrityEvidence;
  metrics: Record<string, number>;
  outputs: Record<string, Json>;
  claims: { claimId: string; taskStatus: string; voided: boolean }[];
}
export const object = (v: unknown): v is Record<string, Json> => v !== null && typeof v === 'object' && !Array.isArray(v);

/** JSON Pointer only: no evaluation, path reads, coercion or arithmetic chosen by a model. */
export function pointer(value: Json, p: string): Json | undefined {
  if (p === '') return value;
  if (!p.startsWith('/')) return undefined;
  let current: Json | undefined = value;
  for (const part of p.slice(1).split('/').map(s => s.replace(/~1/g, '/').replace(/~0/g, '~'))) {
    if (part === '__proto__' || part === 'constructor' || part === 'prototype') return undefined;
    if (!current || typeof current !== 'object' || !Object.hasOwn(current, part)) return undefined;
    current = (current as Record<string, Json>)[part];
  }
  return current;
}

/** An untrusted result draft selects evidence; software supplies all numerical values and labels. */
export function materialize(template: Json, draft: Json, evidence: Evidence, context: IntegrityContext = {}) {
  const issues: string[] = [], sources: Record<string, { source: string; sha256: string }> = {};
  const integrityRoots = integritySections(template, '', context);
  const integrityScope: Record<string, ReturnType<typeof scopeRecord>> = {};
  const fieldContext = (at: string): IntegrityContext => { const frozen = evidence.outputs['task-results.json']; const value = frozen === undefined ? undefined : pointer(frozen, at); return {...context, ...(value === undefined ? {} : {frozenValue: value})}; };
  const warnings: { kind: 'integrity-disagreement' | 'integrity-format-mismatch'; path: string; trustedSource: string; trustedSha256: string; workerSource: string; workerSha256: string }[] = [];
  const recordIntegrity = (value: Json, at: string, source: string): Json => {
    if (/\/units_of_analysis$/i.test(at) && Array.isArray(value)) value = distinctIntegrityValues(value);
    const record = (child: Json, target: string): void => {
      sources[target] = { source, sha256: canonicalSha256(child) };
      if (Array.isArray(child)) child.forEach((v, i) => record(v, `${target}/${i}`));
    };
    record(value, at);
    integrityScope[at] = scopeRecord(at, evidence.integrity, fieldContext(at), value, source);
    const frozen = evidence.outputs['task-results.json'];
    const worker = frozen === undefined ? undefined : pointer(frozen, at);
    // Identifier/problem lists are sets for corroboration; order alone is not disagreement.
    const comparable = (v: Json): Json => Array.isArray(v) ? [...new Set(v.map(x => canonicalSha256(x)))].sort() : v;
    if (worker !== undefined && canonicalSha256(comparable(worker)) !== canonicalSha256(comparable(value))) {
      const numericStrings = (v: Json): Json => typeof v === 'string' && /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(v.trim()) && Number.isFinite(Number(v)) ? Number(v) : Array.isArray(v) ? v.map(numericStrings) : v;
      const kind = canonicalSha256(comparable(numericStrings(worker))) === canonicalSha256(comparable(numericStrings(value))) ? 'integrity-format-mismatch' : 'integrity-disagreement';
      warnings.push({ kind, path: at, trustedSource: source, trustedSha256: canonicalSha256(value), workerSource: `output:task-results.json#${at}`, workerSha256: canonicalSha256(worker) });
    }
    return value;
  };
  function resolve(t: Json, v: Json | undefined, at: string, inheritedIntegrity = false): Json {
    const bulkIntegrityReference = object(v) && ('$output' in v || '$metric' in v) && integrityRoots.some(root => root.startsWith(at + '/'));
    const trustedSection = inheritedIntegrity || integrityKey(at.split('/').at(-1) ?? '') || integrityRoots.some(root => at === root || at.startsWith(root + '/')) || bulkIntegrityReference;
    const diagnostic=diagnosticField(at,v,evidence);
    if(diagnostic && (diagnostic.issue || !trustedSection)){if(diagnostic.issue)issues.push(`${at}: ${diagnostic.issue}`);sources[at]={source:diagnostic.source,sha256:canonicalSha256(diagnostic.value)};return diagnostic.value;}
    if (trustedSection && (!object(t) || object(v) && ('$integrity' in v || '$output' in v || '$metric' in v))) integrityScope[at] = scopeRecord(at, evidence.integrity, fieldContext(at), undefined, 'withheld');
    if (trustedSection && !object(t) && containsEnumeration(t)) {
      const mapping = typeof t === 'string' ? context.enumMappings?.[at] : undefined;
      const raw = mapping && integrityValue(mapping.ref, evidence.integrity, context);
      // Categorical labels have no declared scoped-negative semantics. In particular,
      // zero -> 'clean' is never authority to assert absence, even with worker agreement.
      const positive = (x: Json): boolean => typeof x === 'number' ? x > 0 : typeof x === 'string' ? !!x.trim() : Array.isArray(x) && x.length > 0 && x.every(positive);
      const selected = mapping && typeof mapping.question === 'string' && raw && positive(raw.value) ? explicitIntegrity(mapping.question, raw.value, mapping.ref, evidence.integrity, fieldContext(at)) : undefined;
      const bound = selected && !('issue' in selected) ? selected : undefined;
      const choices = bound ? mapping!.cases.filter(c => canonicalSha256(c.when) === canonicalSha256(bound.value)) : [];
      if (bound && choices.length === 1 && typeof t === 'string' && t.split(/\s*\|\s*/).includes(choices[0]!.value)) {
        const value = recordIntegrity(choices[0]!.value, at, bound.source + ' enum-map=' + canonicalSha256(mapping as unknown as Json));
        integrityScope[at] = scopeRecord(mapping!.question, evidence.integrity, fieldContext(at), value, sources[at]!.source);
        return value;
      }
      issues.push(`${at}: integrity enumeration requires an available trusted fact and explicit software mapping`); return null;
    }
    if (object(v) && Object.hasOwn(v, '$integrity')) {
      integrityScope[at] = scopeRecord(at, evidence.integrity, fieldContext(at), undefined, 'withheld');
      const bound = explicitIntegrity(at, t, v, evidence.integrity, fieldContext(at));
      if ('issue' in bound) { issues.push(`${at}: ${bound.issue}`); return null; }
      if (bound && compatible(t, bound.value)) {
        return recordIntegrity(bound.value, at, bound.source);
      }
      issues.push(`${at}: trusted integrity fact unavailable or incompatible`); return null;
    }
    if (trustedSection && !object(t) && (v === null || v === undefined)) {
      const bound = procedureFactField(at) ? procedureIntegrity(at, t, evidence.procedureIntegrity, fieldContext(at)) : autoIntegrity(at, t, evidence.integrity, fieldContext(at));
      if (!('issue' in bound) && compatible(t, bound.value)) return recordIntegrity(bound.value, at, bound.source);
      issues.push(`${at}: ${'issue' in bound ? bound.issue : 'trusted integrity fact incompatible with template'}`); return null;
    }
    if (trustedSection && (!object(t) || object(v) && ('$output' in v || '$metric' in v))) {
      // Empty literals are not evidence of a clean inventory. Frozen worker outputs are
      // not the software-owned integrity section, even if their filenames sound trusted.
      issues.push(`${at}: integrity field requires a trusted integrity reference`); return null;
    }
    if (object(v) && (Object.hasOwn(v, '$metric') || Object.hasOwn(v, '$output'))) {
      if (typeof t === 'string' && t.includes(' | ')) { issues.push(`${at}: enumeration requires interpreted text`); return ''; }
      let value: Json | undefined, source = '';
      if (typeof v.$metric === 'string') {
        source = `metric:${v.$metric}`; value = evidence.metrics[v.$metric];
      } else if (typeof v.$output === 'string' && typeof v.pointer === 'string') {
        source = `output:${v.$output}#${v.pointer}`;
        const file = evidence.outputs[v.$output];
        if (file !== undefined) value = pointer(file, v.pointer);
      }
      if (value !== undefined && scalarTree(value) && compatible(t, value)) {
        sources[at] = { source, sha256: canonicalSha256(value) };
        const children = (v: Json, target: string, origin: string): void => {
          if (Array.isArray(v)) v.forEach((child, i) => children(child, `${target}/${i}`, `${origin}/${i}`));
          else if (typeof v === 'number') sources[target] = { source: origin, sha256: canonicalSha256(v) };
        };
        if (Array.isArray(value)) children(value, at, source);
        return value;
      }
      issues.push(`${at}: unavailable or incompatible evidence reference`); return null;
    }
    if (Array.isArray(t)) {
      if (!Array.isArray(v)) issues.push(`${at}: array unavailable`);
      const values = Array.isArray(v) ? v : t;
      return values.map((x, i) => resolve(t[i] ?? t[0] ?? null, x, `${at}/${i}`, trustedSection));
    }
    if (object(t)) {
      const values = object(v) ? v : {};
      const result: Record<string, Json> = {};
      for (const [key, child] of Object.entries(t)) {
        const childAt = `${at}/${escapePointer(key)}`;
        const childTrusted = trustedSection || integrityKey(key) || integrityRoots.some(root => childAt === root || childAt.startsWith(root + '/'));
        if (!childTrusted && key === 'incomplete') { result[key] = true; continue; }
        if (!childTrusted && key === 'status' && typeof (values.id ?? t.id) === 'string') {
          const id = String(values.id ?? t.id);
          const claim = evidence.claims.find(c => c.claimId === id && !c.voided);
          result[key] = claim?.taskStatus ?? 'insufficient-evidence';
        } else result[key] = resolve(child, values[key], `${at}/${escapePointer(key)}`, trustedSection);
      }
      return result;
    }
    if (typeof t === 'number' || typeof v === 'number') {
      issues.push(`${at}: numerical value requires an evidence reference`); return null;
    }
    if (typeof t === 'boolean') { if (typeof v !== 'boolean') issues.push(`${at}: boolean unavailable`); return typeof v === 'boolean' ? v : false; }
    if (t === null) {
      if (v === undefined || v === null) { issues.push(`${at}: value unavailable`); return null; }
      // An unspecified template slot still cannot admit literal model numbers.
      if (object(v) || Array.isArray(v)) return resolve(v, v, at, trustedSection);
      return typeof v === 'string' || typeof v === 'boolean' ? v : null;
    }
    if (typeof t === 'string') {
      const enums = t.includes(' | ') ? t.split(/\s*\|\s*/) : null;
      const text = typeof v === 'string' ? v : /\/(id|unit)$/.test(at) ? t : '';
      if (!text.trim()) issues.push(`${at}: text unavailable`);
      if (enums) {
        if (enums.includes(text) && !['confirmed', 'replicated', 'passed'].includes(text)) return text;
        const fallback = enums.find(s => /incomplete|insufficient|unknown|unavailable|not.assessed/.test(s));
        if (!fallback) issues.push(`${at}: missing enumeration`);
        return fallback ?? '';
      }
      // IDs and categorical strings may contain digits; prose numeric claims need references.
      if (/\d/.test(text) && !/^[A-Z]\d{8}$/.test(text) && !/\/(id|unit|test|method|doi|file|path)$/.test(at)) {
        issues.push(`${at}: typed number in text`); return '';
      }
      return text;
    }
    return null;
  }
  const report = resolve(template, fillFromFrozen(template, recoverDiagnosticDraft(template,draft,evidence), evidence.outputs['task-results.json'], '', integrityRoots), '');
  return { report, issues, sources, warnings, integrityScope };
}
function scalarTree(v: Json): boolean {
  if (typeof v === 'string' || typeof v === 'boolean') return true;
  return typeof v === 'number' ? Number.isFinite(v) : Array.isArray(v) && v.every(scalarTree);
}
function compatible(t: Json, v: Json): boolean {
  if (t === null) return true;
  if (Array.isArray(t)) return Array.isArray(v) && (t.length < 2 || t.length === v.length) && v.every((x, i) => !t.length || compatible(t[i] ?? t[0]!, x));
  if (object(t)) return object(v) && Object.entries(t).every(([k, child]) => Object.hasOwn(v, k) && compatible(child, v[k]!));
  return !object(v) && !Array.isArray(v) && typeof t === typeof v;
}

/** Preserve finished frozen work when a later interpretation turn parks or the provider is down. */
function fillFromFrozen(template: Json, draft: Json | undefined, frozen: Json | undefined, at = '', integrityRoots: string[] = []): Json {
  if (integrityKey(at.split('/').at(-1) ?? '') || integrityRoots.some(root => at === root || at.startsWith(root + '/'))) return draft ?? null;
  // Historical criteria templates used numeric-key objects for arrays. Accept only
  // their exact dense index shape, then resolve every child through the normal gates.
  // This also fills missing evidence in modern array drafts without trusting numbers
  // or interpreted enums merely because they occur inside a frozen array.
  const legacyArray = Array.isArray(template) && template.length > 0 && object(draft)
    && Object.keys(draft).length === template.length
    && Array.from({length: template.length}, (_, i) => String(i)).every(k => Object.hasOwn(draft, k));
  if (Array.isArray(template) && (Array.isArray(draft) || legacyArray)) {
    const values = Array.isArray(draft) ? draft : Array.from({length: template.length}, (_, i) => (draft as Record<string, Json>)[String(i)]!);
    return values.map((v, i) => fillFromFrozen(template[i] ?? template[0] ?? null, v,
      Array.isArray(frozen) ? frozen[i] : undefined, at + '/' + i, integrityRoots));
  }
  if (draft !== undefined && draft !== null && (!object(template) || !object(draft))) return draft;
  if (object(template)) return Object.fromEntries(Object.entries(template).map(([key, t]) => [key,
    fillFromFrozen(t, object(draft) ? draft[key] : undefined, object(frozen) ? frozen[key] : undefined, at + '/' + key.replace(/~/g, '~0').replace(/\//g, '~1'), integrityRoots)]));
  if (Array.isArray(template) && Array.isArray(frozen) && frozen.some(object)) return frozen.map((v, i) => fillFromFrozen(template[i] ?? template[0] ?? null, undefined, v, at + '/' + i, integrityRoots));
  if (typeof template === 'string' && template.includes(' | ')) return draft ?? null;
  if (/\/(id|status)$/.test(at) && typeof frozen === 'string') return frozen;
  if (frozen !== undefined && scalarTree(frozen)) return { $output: 'task-results.json', pointer: at };
  return draft ?? (Array.isArray(template) ? template : null);
}

function containsEnumeration(t: Json): boolean {
  return typeof t === 'string' && t.includes(' | ') || Array.isArray(t) && t.some(containsEnumeration);
}
