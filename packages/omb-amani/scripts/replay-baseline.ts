import {canonicalSha256} from '../../bio-core/src/index.ts';
import {object,type Json} from '../src/results.ts';

/** Historical comparisons only: review3 corrected numeric criteria to real arrays.
 * Preserve all values and keys; permit only an exact dense indexed-object migration.
 * Never use this normalization to admit evidence or change a produced report.
 */
export function normalizeLegacyReportArrays(old:Json,current:Json):Json {
  if(Array.isArray(current)) {
    const indices=Array.from({length:current.length},(_,i)=>String(i));
    const indexed=current.length>0&&object(old)&&Object.keys(old).length===current.length&&indices.every(k=>Object.hasOwn(old,k));
    const values=Array.isArray(old)?old:indexed?indices.map(k=>(old as Record<string,Json>)[k]!):null;
    return values?values.map((v,i)=>normalizeLegacyReportArrays(v,current[i]??null)):old;
  }
  if(object(old)&&object(current))return Object.fromEntries(Object.entries(old).map(([k,v])=>[k,normalizeLegacyReportArrays(v,current[k]??null)]));
  return old;
}

/** The historical C1 checkpoint has no locked coloc procedure. Its three old
 * worker fields must now be withheld; all other fields stay exactly comparable. */
export function diagnosticReplayBaseline(card:string, old:{report:Json;issues:string[];sources:Record<string,Json>;warnings:Json}) {
  const expected=structuredClone(old);
  if(card!=='c1')return expected;
  if(!object(expected.report)||!object(expected.report.coloc))throw new Error('missing historical C1 coloc');
  const paths=['/coloc/c1/verdict','/coloc/c1/pp_h4','/coloc/c2/pp_h4'];
  for(const at of paths){
    const [, ,locus,field]=at.split('/');
    const target=expected.report.coloc[locus!];if(!object(target))throw new Error('missing historical C1 locus');
    target[field!]=null;
    expected.sources[at]={source:'diagnostic:withheld',sha256:canonicalSha256(null)};
  }
  expected.report.incomplete=true;
  expected.issues.push(...paths.map(at=>`${at}: coloc field requires a locked trusted procedure binding`));
  return expected;
}
