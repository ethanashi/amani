import { canonicalSha256 } from '../../bio-core/src/index.ts';
import { requireThat, plain, extractNumericValues } from '../../omb-report/src/index.ts';
import type { PaperInput } from '../../omb-paper/src/index.ts';
import { assertManuscript, wordCount, visibleText, type Manuscript } from './manuscript.ts';
export interface FactChange { key:string; before:unknown; after:unknown; beforeSource:string|null; afterSource:string|null }
/** A correction is derived from a fresh certified PaperInput, never a prose request. */
export function changedFacts(before:PaperInput,after:PaperInput):FactChange[] {
  requireThat(before.lineageId===after.lineageId,'correction crossed paper lineage');
  requireThat(canonicalSha256(before.paperSet)===canonicalSha256(after.paperSet)&&canonicalSha256(before.lockedPlan)===canonicalSha256(after.lockedPlan),'correction changed claim set or locked plan');
  const rows=(p:PaperInput)=>p.certifications.flatMap(c=>c.metricGrades.map(f=>({key:`${c.id}:${f.source}:${f.key}`,value:f.value,source:f.certHash})));
  const a=rows(before),b=rows(after);const changes:FactChange[]=[];
  requireThat(new Set(a.map(f=>f.key)).size===a.length&&new Set(b.map(f=>f.key)).size===b.length,'ambiguous correction fact');
  for(const key of [...new Set([...a,...b].map(f=>f.key))]){
    const old=a.find(f=>f.key===key),next=b.find(f=>f.key===key);
    if(canonicalSha256(old?.value??null)!==canonicalSha256(next?.value??null))changes.push({key,before:old?.value??null,after:next?.value??null,beforeSource:old?.source??null,afterSource:next?.source??null});
  }
  requireThat(changes.length>0,'correction has no changed facts');return changes;
}
export interface Erratum { previousHash:string; changes:FactChange[]; sourceHashes:string[] }
export function withErratum(manuscript:Manuscript,erratum:Erratum):Manuscript {
  assertManuscript(manuscript);const doc=structuredClone(manuscript);
  const text='Corrected certified facts are listed below. The prior version remains in the version log.\n\n| Fact | Previous | Corrected |\n| --- | --- | --- |\n'+erratum.changes.map(c=>`| ${plain(c.key)} | ${plain(JSON.stringify(c.before))} | ${plain(JSON.stringify(c.after))} |`).join('\n');
  const supplement=doc.sections.find(s=>s.id==='supplement')!;supplement.markdown+='\n\n### Erratum\n\n'+text;supplement.sourceHashes=[...new Set([...supplement.sourceHashes,...erratum.sourceHashes])];supplement.words=wordCount(supplement.markdown);
  doc.markdown=doc.sections.map(s=>`## ${s.heading}\n\n${s.markdown}`).join('\n\n')+'\n';
  doc.numberTrace=doc.sections.map(s=>({section:s.id,values:extractNumericValues(visibleText(s.markdown)),sourceHashes:s.sourceHashes}));
  doc.skeletonHash=canonicalSha256({base:manuscript.skeletonHash,erratum});
  doc.pending=[...new Set([...doc.pending,'owner notification of previously contacted authors'])];
  const {sha256:_,...body}=doc;return {...body,sha256:canonicalSha256(body)};
}
