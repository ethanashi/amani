import {object,type Json} from './results.ts';

export type IntegrityCheck = 'linked-profile-exact' | 'matrix-backed' | 'tabular-only' | 'explicit-overlap' | 'duplicate-or-overlap-union' | 'quality-problems' | 'analysis-units' | 'double-zero-trials';
/** Closed vocabulary of fields answered only by a registry-declared procedure integrity fact
 * (omb-certify procedure-integrity). Group 1 of `field` is the scope the field names. */
export const PROCEDURE_FACT_FIELDS: readonly {check: IntegrityCheck; fact: string; field: RegExp}[] = [
 {check:'double-zero-trials',fact:'double-zero-trials',field:/^(?:n_)?double_zero_trials(?:_([a-z0-9]+(?:_[a-z0-9]+)*))?$/},
];
export const normalizedIntegrityField = (at:string) => at.split('/').at(-1)!.replace(/~1/g,'/').replace(/~0/g,'~').replace(/([a-z])([A-Z])/g,'$1_$2').replaceAll('-','_').toLowerCase();
/** Closed field vocabulary. New questions require a reviewed mapping to an implemented check. */
export function fieldCheck(field:string):IntegrityCheck|undefined {
 if (/^(?:duplicated_or_overlapping(?:_units)?|n_duplicated_or_overlapping_pairs)$/.test(field)) return 'duplicate-or-overlap-union';
 if (/^(?:duplicates|duplicated_(?:units|samples|datasets)|duplicate_(?:units|samples|datasets|pairs)|n_(?:duplicate|duplicated)_(?:pairs|units)|duplicate_pair_count)$/.test(field)) return 'linked-profile-exact';
 if (field === 'matrix_backed_duplicate_pair_count') return 'matrix-backed';
 if (field === 'tabular_only_duplicate_pair_count') return 'tabular-only';
 if (/^(?:overlaps|overlapping_(?:units|samples|datasets)|n_overlapping_pairs)$/.test(field)) return 'explicit-overlap';
 if (['other_problems','other_data_quality_problems','problems','other_findings','other_issues','data_quality_notes','concerns'].includes(field)) return 'quality-problems';
 if (['units_of_analysis','analysis_units'].includes(field)) return 'analysis-units';
 return PROCEDURE_FACT_FIELDS.find(p=>p.field.test(field))?.check;
}
// These are served-contract semantics, not word searches. Every expression is anchored:
// adding a qualifier, negation, clause or unsupported scope makes the mapping ambiguous.
const descriptions: [RegExp,IntegrityCheck][] = [
 [/^sample identifiers of duplicated or overlapping samples$/i,'duplicate-or-overlap-union'],
 [/^duplicated or overlapping samples$/i,'duplicate-or-overlap-union'],
 [/^duplicated or overlapping units\/samples found \(list of sample identifiers; empty list if none\)$/i,'duplicate-or-overlap-union'],
 [/^duplicated or overlapping units\/samples found \(list; empty if none\), given as the dataset letter of every cohort that holds at least one of them$/i,'duplicate-or-overlap-union'],
 [/^number of duplicated or overlapping sample pairs found \(a JSON number; 0 if none\)$/i,'duplicate-or-overlap-union'],
 [/^matrix-backed duplicate pairs$/i,'matrix-backed'],
 [/^tabular-only duplicate pairs$/i,'tabular-only'],
 [/^duplicate pairs$/i,'linked-profile-exact'],
 [/^overlapping samples only$/i,'explicit-overlap'],
 [/^other data-quality problems found \(a list of short strings; empty if none\)$/i,'quality-problems'],
 [/^units of analysis used \(a string\)$/i,'analysis-units'],
 ...scopedWording(),
];
/** Procedure-fact wording names its scope (group 1). "Zero ... in either arm" is ambiguous and absent. */
function scopedWording(): [RegExp,IntegrityCheck][] {
 const label='([a-z0-9]+(?:[ _-][a-z0-9]+)*)',prefix='^(?:step \\d+:\\s+)?(?:(?:the )?number of )?';
 return [[new RegExp(`${prefix}trials with no ${label} events in either arm$`,'i'),'double-zero-trials'],[new RegExp(`${prefix}trials with zero ${label} events in both arms$`,'i'),'double-zero-trials']];
}
const namespaceOnly = /^(?:(?:a list of distinct )?identifiers from namespace `[^`]+`|(?:a list of distinct )?dataset letters|sample identifiers)$/i;
/** Host-served wording for this exact pointer: criterion descriptions and its TASK report line. */
export function servedIntegrityWording(at:string,context:{publicContract?:Json;prompt?:string}):string[] {
 const c=context.publicContract,criteria=object(c)&&Array.isArray(c.report)?c.report.filter(object).filter(x=>x.report===at):[];
 const wording=criteria.flatMap(x=>typeof x.description==='string'&&x.description.trim()?[x.description]:[]);
 for(const line of (context.prompt??'').split('\n')) {
  const text=line.trim().replace(/^[-*]\s*/,'');
  if(!text.startsWith('`'+at+'`'))continue;
  const rest=text.slice(at.length+2).replace(/^\s*(?:\(criterion `[^`]+`\))?\s*:\s*/,'');
  // Generated TASK prefix conveys shape/namespace; the remaining complete sentence conveys scope.
  wording.push(rest.replace(/^(?:a number|one JSON string, number or boolean|a list of distinct dataset letters|a list of distinct identifiers from namespace `[^`]+`)\.\s+/i,''));
 }
 return wording.map(text=>text.trim().replace(/[.;]$/,''));
}
/** Scope labels the served wording names for a procedure-fact check, normalized to field form. */
export function servedScopeLabels(at:string,context:{publicContract?:Json;prompt?:string}):string[] {
 return servedIntegrityWording(at,context).flatMap(text=>{const m=descriptions.find(([p,check])=>PROCEDURE_FACT_FIELDS.some(f=>f.check===check)&&p.test(text))?.[0].exec(text);return m?.[1]?[m[1].toLowerCase().replace(/[\s-]+/g,'_')]:[];});
}
export function integrityQuestion(at:string,context:{publicContract?:Json;prompt?:string}):{check?:IntegrityCheck;issue?:string} {
 const field=normalizedIntegrityField(at),base=fieldCheck(field);
 const checks=new Set<IntegrityCheck>();
 for(const clean of servedIntegrityWording(at,context)){
  if(namespaceOnly.test(clean))continue;
  const matched=descriptions.find(([pattern])=>pattern.test(clean));
  if(!matched)return {issue:'ambiguous integrity question scope; unsupported served wording'};
  checks.add(matched[1]);
 }
 if(checks.size>1)return {issue:'ambiguous integrity question scope; conflicting served semantics'};
 const served=[...checks][0];
 if(served&&base&&served!==base&&!(base==='linked-profile-exact'&&['matrix-backed','tabular-only','duplicate-or-overlap-union'].includes(served)))return {issue:'ambiguous integrity question scope; field and served semantics conflict'};
 return base ? {check:served??base} : {issue:'unrecognized integrity field semantics; ambiguous check scope'};
}
