import {integrityQuestion} from './integrity-question.ts';
import {canonicalSha256} from '../../bio-core/src/index.ts';
import {object,type Json} from './results.ts';
import {ABSENCE_UNCERTIFIED,integrityWording,qualityProblem,problemIndices,unionFinding} from './integrity-scope.ts';
import type {IntegrityEvidence} from './integrity.ts';
import type {IntegrityBinding,IntegrityContext} from './integrity-binding.ts';
/** Approved P1 default. Runtime override supports P0 replay and acceptance without source edits. */
export const SCOPED_NEGATIVES = process.env.SCOPED_NEGATIVES !== 'false';
export const unionQuestion=(at:string,context:IntegrityContext)=>integrityQuestion(at,context).check==='duplicate-or-overlap-union';
export const completeUnionCoverage=(data:Record<string,Json>)=>object(data.linkage)&&data.linkage.status==='observed'&&Array.isArray(data.linkage.coverage)&&data.linkage.coverage.includes('exact-profile:matrix')&&(data.linkage.recordSets==='single'||data.linkage.coverage.includes('repeated-observation'))&&data.linkage.coverage.some(x=>typeof x==='string'&&x.startsWith('declared-unit:'));
export const comparableIntegrity=(v:Json):Json=>Array.isArray(v)?[...new Set(v.map(x=>canonicalSha256(x)))].sort():v;
export const equalIntegrity=(a:Json,b:Json)=>canonicalSha256(comparableIntegrity(a))===canonicalSha256(comparableIntegrity(b));
export function workerRelation(trusted:Json,worker:Json|undefined):'absent'|'equal'|'less'|'more-or-incomparable' {
 if(worker===undefined)return 'absent';if(equalIntegrity(trusted,worker))return 'equal';
 if(typeof trusted==='number'&&typeof worker==='number'&&Number.isFinite(worker)&&worker>=0&&worker<trusted)return 'less';
 if(Array.isArray(trusted)&&Array.isArray(worker)){const set=new Set(trusted.map(x=>canonicalSha256(x)));if(worker.every(x=>set.has(canonicalSha256(x))))return 'less';}
 return 'more-or-incomparable';
}
/** Returns undefined for legacy fields; union fields have one closed projection path. */
export function bindUnion(at:string,template:Json,evidence:IntegrityEvidence,context:IntegrityContext):IntegrityBinding|undefined {
 const data=evidence.value;if(!object(data))return;
 const wording=integrityWording(at,context),union=unionQuestion(at,context),indices=problemIndices(data,true);
 if(!union){if(/overlap/i.test(wording)&&indices.some(i=>unionFinding((data.problems as Json[])[i]!)))return {issue:'overlap-only question; union fact covers duplicates too'};return;}

 const lines=(context.prompt??'').split('\n').filter(line=>line.trim().replace(/^[-*]\s*/, '').startsWith('`'+at+'`'));
 if(lines.some(line=>(line.match(/`\/[^`]+`/g)??[]).length!==1))return {issue:'ambiguous TASK report line contains multiple field pointers'};
 if(!completeUnionCoverage(data))return {issue:ABSENCE_UNCERTIFIED+'; incomplete declared linkage coverage'};
 const linkage=data.linkage as Record<string,Json>,count=linkage.pairCount;
 if(typeof count!=='number'||!Number.isSafeInteger(count)||count<0)return {issue:'trusted union count unavailable'};
 if(count>0&&(indices.length!==1||!unionFinding((data.problems as Json[])[indices[0]!]!)||!object((data.problems as Json[])[indices[0]!]!)||((data.problems as Record<string,Json>[])[indices[0]!]!.count!==count)))return {issue:'single union finding unavailable'};
 const p1=context.scopedNegatives??SCOPED_NEGATIVES,field=at.split('/').at(-1)!;
 let value:Json, namespace:string|undefined;
 if(/pair/i.test(field)&&/(^n_|count|number)/i.test(field)){
  if(typeof template!=='number')return {issue:'duplicate pair count requires a numeric template'};value=count;
 }else{
  if(/pair/i.test(field)||!Array.isArray(template))return {issue:'ambiguous duplicate field mapping'};
  const c=object(context.publicContract)?context.publicContract:{},criteria=Array.isArray(c.report)?c.report.filter(object).filter(x=>x.report===at):[];
  const namespaces=new Set(criteria.flatMap(x=>typeof x.namespace==='string'?[x.namespace]:[]));
  for(const match of wording.matchAll(/namespace\s+`([^`]+)`/g))namespaces.add(match[1]!);
  if(/dataset (?:letter|name)s?/i.test(wording))namespaces.add('dataset');
  if(/sample identifiers/i.test(wording))namespaces.add('sample');
  if(namespaces.size!==1)return {issue:'ambiguous or missing duplicate identifier namespace'};
  const ns=[...namespaces][0]!;namespace=ns;
  if(ns!=='dataset'&&(!Array.isArray(c.namespaces)||!c.namespaces.some(n=>object(n)&&n.id===ns)))return {issue:'duplicate namespace is not declared by served contract'};
  const tokens=linkage.observations;
  if(!Array.isArray(tokens)||!tokens.every(t=>typeof t==='string'))return {issue:'union observations unavailable'};
  if(count>0&&!tokens.length||count===0&&tokens.length)return {issue:'inconsistent union observations'};
  const identities=evidence.identities?.value.observations,ids:string[]=[];
  if(identities){
   for(const token of tokens){const entry=identities[token as string];if(!entry||!entry.tables.length||!entry.recordSet||ns!=='dataset'&&(entry.namespace!==ns||!entry.identifiers.length))return {issue:`trusted duplicate tokens have no mapping to namespace ${ns}`};ids.push(...(ns==='dataset'?[entry.recordSet]:entry.identifiers));}
  }else if(count>0){
   if(ns!=='dataset')return {issue:`trusted duplicate tokens have no mapping to namespace ${ns}`};
   const f=(data.problems as Record<string,Json>[])[indices[0]!]!,tables=Array.isArray(c.tables)?c.tables.filter(object):[];
   if(!Array.isArray(f.tables)||!f.tables.length)return {issue:'ambiguous or missing table-to-dataset mapping'};
   for(const file of f.tables){const matches=tables.filter(t=>typeof t.path==='string'&&typeof file==='string'&&t.path.replace(/^data\//,'')===file.replace(/^data\//,''));if(matches.length!==1||typeof matches[0]!.dataset!=='string')return {issue:'ambiguous or missing table-to-dataset mapping'};ids.push(matches[0]!.dataset);}
  }
  if(ids.some(id=>/^[uo]_[a-f0-9]{64}$/.test(id)))return {issue:'opaque host tokens cannot be published as identifiers'};
  value=[...new Set(ids)].sort();
 }
 const relation=workerRelation(value,context.frozenValue);
 if(count===0&&(!p1||relation!=='equal'))return {issue:ABSENCE_UNCERTIFIED};
 if(count>0&&p1&&relation==='more-or-incomparable')return {issue:'worker reports findings outside certified scope'};
 return {value,source:`integrity:${evidence.fileSha256}#${count?'/problems/'+indices[0]:'/linkage'} union projection contract=${canonicalSha256(context.publicContract??null)}${namespace?` namespace=${namespace}`:''}`};
}
export function scopeRecord(at:string,evidence:IntegrityEvidence|undefined,context:IntegrityContext,value:Json|undefined,source:string) {
 const data=evidence?.value,l=object(data)&&object(data.linkage)?data.linkage:{};
 const check=integrityQuestion(at,context).check,union=check==='duplicate-or-overlap-union';
 if(check==='double-zero-trials')return {class:check,coverage:['every trial of the certified input table'],notCovered:['tables or outcome columns outside the certified scope'],
  corroboration:value===undefined?'withheld':workerRelation(value,context.frozenValue),source,
  wording:'Counted by the registered procedure over every trial of the served table; the value is bound to its certificate.',
  ...(value===0?{negativeWording:'No trial in the served table had zero events of this outcome in both arms. Use this scoped wording in any derived paper or deliverable.'}:{})};
 const quality=object(data)&&Array.isArray(data.problems)?data.problems.filter(qualityProblem).filter(object).map(f=>String(f.kind)):[];
 const coverage=union&&Array.isArray(l.coverage)?l.coverage:check==='quality-problems'?[...new Set(quality)]:check?[check]:[];
 const notCovered=union&&Array.isArray(l.notCovered)?l.notCovered:check==='quality-problems'?['problem kinds outside the selected checks']:['checks outside the selected scope', 'undeclared identity links', 'near-duplicates'];
 return {class:check??'unmapped',coverage,notCovered,
  corroboration:value===undefined?'withheld':workerRelation(value,context.frozenValue),source,
  wording:union?'Checks cover byte-identical aligned matrix profiles, shared declared units and repeated observation identifiers across declared record sets; near-duplicates and undeclared identity links are not covered.':'Only the selected trusted check is covered.',
  ...(union&&value!==undefined&&(value===0||Array.isArray(value)&&!value.length)?{negativeWording:'No exact-profile, declared-unit or repeated-observation duplicates found within the declared coverage. Use this scoped wording in any derived paper or deliverable.'}:{})};
}
