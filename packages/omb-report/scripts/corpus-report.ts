/** Reproducible corpus evidence; fixtures are synthetic and independent of templates. */
import { readFileSync,writeFileSync } from 'node:fs';
import { canonicalSha256 } from '../../bio-core/src/index.ts';
import { buildFactExtensions } from '../../omb-paper/src/index.ts';
import * as api from '../src/index.ts';
import { fixture,registry,changeStatus } from '../test/fixtures.ts';
interface Row {id?:string;text:string;region:api.Region;citation?:boolean;refusal?:string;status?:string;kind?:string;field?:string;value?:unknown}
const read=(name:string)=>JSON.parse(readFileSync(new URL(`../test/corpus/${name}.json`,import.meta.url),'utf8')) as Row[];
const honest=read('honest'),attacks=[...read('adversarial'),...read('adversarial-round3'),...read('adversarial-round4')];
export function evaluate(row:Row):string {
 const input=fixture(i=>{
  if(row.status)changeStatus(i,row.status);
  if(row.citation)i.frozenLiteratureIndex={entries:[{key:'source',quote:row.text.replace(' [c:source]',''),status:'fulltext-verified',approvedSentenceHashes:[canonicalSha256(row.text)]}]};
  if(row.kind==='plan')(i.lockedPlan.claims as Record<string,unknown>[])[0]![row.field!]=row.value;
  if(row.kind==='data-string'){i.stagerManifests=[{name:String(row.value)}];i.factExtensions=buildFactExtensions(i.lockedPlan,i.stagerManifests,i.certifications[0]!.metricGrades);}
 });
 const ctx=api.createReportContext(input);
 if(row.kind==='partB'){
  const entries=ctx.claims.flatMap(c=>api.checklist(c.kind).map(item=>({claimId:c.id,item,bias:row.text,settlingData:'Additional observations are needed',direction:'unknown' as const,couldOverturn:'unknown' as const})));
  return api.limitationsPartB(ctx,entries,registry);
 }
 return api.renderDraft(ctx,row.kind==='data-string'?'The source is [d:manifest.0.name].':row.kind==='plan'?'[claim:c1].':row.text,row.kind==='data-string'?'introduction':row.kind==='plan'?'results':row.region,registry).text;
}
const measure=(rows:Row[])=>rows.map((r,i)=>{try{return {id:r.id??String(i+1),text:r.text,region:r.region,rendered:true,output:evaluate(r),reason:null};}catch(error){return {id:r.id??String(i+1),text:r.text,region:r.region,rendered:false,output:null,reason: String(error)};}});
const h=measure(honest),a=measure(attacks);
const result={schema:'omb-report/corpora@4',honest:{total:h.length,passed:h.filter(r=>r.rendered).length,rate:h.filter(r=>r.rendered).length/h.length,refusals:h.filter(r=>!r.rendered)},adversarial:{total:a.length,refused:a.filter(r=>!r.rendered).length,accepted:a.filter(r=>r.rendered)},honestResults:h,adversarialResults:a};
writeFileSync(new URL('../corpus-results.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({honest:result.honest,adversarial:result.adversarial},null,2));
if(result.honest.rate<0.95||result.adversarial.refused/result.adversarial.total<0.95)process.exitCode=1;
