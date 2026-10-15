import {autoIntegrity,type IntegrityContext,type IntegrityBinding} from './integrity-binding.ts';
import {integrityValue} from './integrity-result.ts';
import {integrityQuestion} from './integrity-question.ts';
import {procedureFactField} from './integrity-procedure.ts';
import {integrityReferenceIssue,ABSENCE_UNCERTIFIED} from './integrity-scope.ts';
import type {IntegrityEvidence} from './integrity.ts';
import {object,type Json} from './results.ts';

/** Explicit selection is not authority to change a question's check, count unit or namespace. */
export function explicitIntegrity(at:string,template:Json,ref:Record<string,Json>,evidence:IntegrityEvidence|undefined,context:IntegrityContext):IntegrityBinding {
 // Procedure-certified facts are bound by the host from the certifier; no inventory path answers them.
 if(procedureFactField(at))return {issue:'procedure-certified integrity fact; leave null for host binding from the certified procedure'};
 const issue=integrityReferenceIssue(at,ref,evidence,context);
 if(issue)return {issue};
 const raw=integrityValue(ref,evidence,context);
 if(!raw)return {issue:'trusted integrity fact unavailable or incompatible'};
 const q=integrityQuestion(at,context),p=String(ref.$integrity);
 if(q.issue)return {issue:q.issue};
 const check=q.check;
 if(check==='quality-problems'){
  if(!p.startsWith('/problems'))return {issue:'problem question requires typed positive problem facts'};
  if(raw.value===0||raw.value===''||Array.isArray(raw.value)&&!raw.value.length)return {issue:'trusted checks cannot certify absence of other problems'};
  return raw;
 }
 if(check==='analysis-units'){
  if(!p.startsWith('/unitsOfAnalysis'))return {issue:'analysis units require verified analysis facts'};
  if(raw.value===0||Array.isArray(raw.value)&&(!raw.value.length||raw.value.some(v=>v===0)))return {issue:ABSENCE_UNCERTIFIED};
  return raw;
 }
 const bound=autoIntegrity(at,template,evidence,context);
 if('issue' in bound)return bound;
 const leaf=typeof ref.select==='string'?ref.select.slice(1):p.split('/').at(-1);
 const count=typeof bound.value==='number';
 let allowed=false;
 if(check==='duplicate-or-overlap-union'){
  const data=evidence?.value,empty=object(data)&&object(data.linkage)&&data.linkage.pairCount===0;
  allowed=empty?p===(count?'/linkage/pairCount':'/linkage/observations'):
   /^\/problems(?:\/\d+\/[^/]+)?$/.test(p)&&(count?leaf==='count':leaf==='units'||leaf==='tables');
 }else if(check==='explicit-overlap'){
  allowed=/^\/problems(?:\/\d+\/[^/]+)?$/.test(p)&&(count?leaf==='count':leaf==='units'||leaf==='tables');
 }else{
  const countLeaf=check==='matrix-backed'?'matrixBackedPairCount':check==='tabular-only'?'tabularOnlyPairCount':'pairCount';
  allowed=count?p==='/duplicates/'+countLeaf:p==='/duplicates/groups'&&(leaf==='units'||leaf==='tables');
 }
 // Match the canonical projection's namespace too; equal numeric values are not equal semantics.
 if(!count){
  const dataset=bound.source.includes(' namespace=dataset');
  if(!p.startsWith('/linkage'))allowed=allowed&&(dataset?leaf==='tables'&&ref.format==='dataset'||check==='duplicate-or-overlap-union'&&leaf==='units'&&ref.format===undefined:leaf==='units'&&ref.format===undefined);
 }
 if(!allowed)return {issue:'explicit integrity reference does not match the question check or projection'};
 return bound;
}
