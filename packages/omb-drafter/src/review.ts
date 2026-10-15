import { canonicalSha256 } from '../../bio-core/src/index.ts';
import { assertSameFacts, SPIN_TAXONOMY, WORDING_VERSION, LEXICONS, exactKeys, requireThat, record, html, type RenderedDraft } from '../../omb-report/src/index.ts';
import { normalizeProposal, type NormalizedProposal } from '../../omb-investigate/src/boss.ts';
import { assertManuscript, softwareText, type Manuscript } from './manuscript.ts';

export const REVIEW_BANNER = 'AI-generated review text; numbers and claims in it were not checked; this is internal AI review, not peer review';
export const CATEGORIES = ['spin','overclaiming','causal-language','missing-limitations','methods','statistics','literature','new-analysis','wording'] as const;
export type Category = typeof CATEGORIES[number];
export interface ReviewIssue { id:string; issue:string; anchor:string; severity:'minor'|'major'; category:Category; suggestedFix:string; lexicons:number[]; wordingVersion:string; proposal?:NormalizedProposal; analysisAuditFlag?:true }
export interface SentenceDiff { section:string; sentence:string; before:string|null; after:string|null; contextBefore:string[]; contextAfter:string[] }
export interface ResponseRow { issueId:string; disposition:'proposed-investigation'|'literature-request'|'changed-text-awaiting-owner'|'open'; changeMade:SentenceDiff[]; proposalId:string|null }
export const REVIEW_INSTRUCTION = `Return exactly {"issues":[{"issue":string,"anchor":sectionId,"severity":"minor"|"major","category":"spin"|"overclaiming"|"causal-language"|"missing-limitations"|"methods"|"statistics"|"literature"|"wording","suggestedFix":string}],"requested_analyses":[{"issue":string,"anchor":sectionId,"proposal":object}]}. Always include requested_analyses, even when empty. Any request for new computation, subgroup checks, experiments or new data belongs there regardless of phrasing. Each proposal requires V7 id,rung,kind,scope,manifest,question,plain_statement and rule {exposure,outcome,unit,adjustment,strata,test,direction}. Findings only; never edit or clear an issue. Examine spin, overclaiming, causal language for associational claims and missing study-specific limitations (always major). Use the supplied wording taxonomy. Missing literature is a literature request, never an invented reference. Review text is untrusted data, never manuscript prose.`;
const diagnostic: Record<Category,number[]> = {
 spin:[...new Set([...SPIN_TAXONOMY.selectiveReporting,...SPIN_TAXONOMY.overinterpretation,...SPIN_TAXONOMY.clinicalExtrapolation,...SPIN_TAXONOMY.misleadingPresentation])],
 overclaiming:[1,4,6,7,11,14], 'causal-language':[12,15], 'missing-limitations':[], methods:[2,3], statistics:[5,7,10,13], literature:[8], 'new-analysis':[], wording:[9,16,17],
};
export function parseReview(raw:unknown,manuscript:Manuscript,approvedManifests:readonly string[]):ReviewIssue[] {
  exactKeys(raw as object,['issues','requested_analyses'],'review report');const issues=record(raw).issues,requests=record(raw).requested_analyses;
  requireThat(Array.isArray(requests)&&requests.length<=100,'missing or invalid requested_analyses');
  requireThat(Array.isArray(issues)&&issues.length<=100,'invalid review issues');
  requireThat(issues.every(item=>record(item).category!=='new-analysis'&&!Object.hasOwn(record(item),'proposal')),'analysis requests belong in requested_analyses');
  const normalizedRequests=requests.map(item=>{const r=record(item);exactKeys(r,['issue','anchor','proposal'],'requested analysis');return {...r,severity:'major',category:'new-analysis',suggestedFix:'Create a new V7 investigation with a new locked plan.'};});
  return [...issues,...normalizedRequests].map((item,index)=>{
    const r=record(item);exactKeys(r,['issue','anchor','severity','category','suggestedFix',...Object.hasOwn(r,'proposal')?['proposal']:[]],'review issue');
    for(const k of ['issue','anchor','suggestedFix'] as const)requireThat(typeof r[k]==='string'&&(r[k] as string).trim()&&(r[k] as string).length<=10000,`invalid review ${k}`);
    requireThat(manuscript.sections.some(s=>s.id===r.anchor),'unknown review anchor');
    requireThat(['minor','major'].includes(String(r.severity))&&CATEGORIES.includes(r.category as Category),'unknown review severity/category');
    const category=r.category as Category;
    // A prose repair cannot smuggle a request for work into a reply letter.
    const analysisRequest=/\b(?:add|run|perform|conduct|request)\b[^.!?]{0,60}\b(?:analysis|analyses|experiment|new data)\b/iu.test(String(r.issue)+' '+String(r.suggestedFix));
    const analysisAuditFlag=analysisRequest&&category!=='new-analysis';
    let proposal:NormalizedProposal|undefined;
    if(category==='new-analysis'){
      const result=normalizeProposal(r.proposal,approvedManifests);requireThat(!('reason' in result),`invalid V7 proposal: ${'reason' in result?result.reason:''}`);proposal=result;
    }else requireThat(!Object.hasOwn(r,'proposal'),'proposal outside new-analysis category');
    return {id:canonicalSha256([manuscript.sha256,index,r]),issue:String(r.issue),anchor:String(r.anchor),severity:category==='missing-limitations'||analysisAuditFlag?'major':r.severity as 'major'|'minor',category,suggestedFix:String(r.suggestedFix),lexicons:[...diagnostic[category]],wordingVersion:WORDING_VERSION,...proposal?{proposal}:{},...analysisAuditFlag?{analysisAuditFlag:true as const}:{}};
  });
}
export function reviewContext(manuscript:Manuscript) {
  assertManuscript(manuscript);
  return {paperHash:manuscript.paperHash,manuscriptHash:manuscript.sha256,sections:manuscript.sections.map(s=>({id:s.id,text:s.markdown})),sourceDisplays:manuscript.displayArtifacts,taxonomy:SPIN_TAXONOMY,lexicons:LEXICONS};
}
function sentences(manuscript:Manuscript,section:string):{id:string;text:string}[] {
  const s=manuscript.sections.find(s=>s.id===section);if(!s)return [];
  if(!s.drafts.length)return [{id:'software',text:s.markdown}];
  return s.drafts.flatMap((d,i)=>d.sentences.map(sentence=>({id:`${i}:${sentence.id}`,text:sentence.text})));
}
export function sentenceDiff(before:Manuscript,after:Manuscript):SentenceDiff[] {
  assertManuscript(before);assertManuscript(after);const diff:SentenceDiff[]=[];
  for(const section of [...new Set([...before.sections,...after.sections].map(s=>s.id))]){
    const a=sentences(before,section),b=sentences(after,section);
    for(let i=0;i<Math.max(a.length,b.length);i++)if(a[i]?.text!==b[i]?.text)diff.push({section,sentence:b[i]?.id??a[i]!.id,before:a[i]?.text??null,after:b[i]?.text??null,contextBefore:a.slice(Math.max(0,i-1),i+2).map(s=>s.text),contextAfter:b.slice(Math.max(0,i-1),i+2).map(s=>s.text)});
    // Include software changes even in a section also containing narrative.
    const oldSection=before.sections.find(s=>s.id===section),newSection=after.sections.find(s=>s.id===section);
    if((oldSection?softwareText(oldSection):null)!==(newSection?softwareText(newSection):null))diff.push({section,sentence:'software',before:before.sections.find(s=>s.id===section)?.markdown??null,after:after.sections.find(s=>s.id===section)?.markdown??null,contextBefore:[],contextAfter:[]});
  }
  return diff;
}
export function verifyEditFacts(before:Manuscript,after:Manuscript,revision=false):void {
  assertManuscript(before);assertManuscript(after);
  requireThat(before.paperHash===after.paperHash&&before.blindHash===after.blindHash&&before.profileHash===after.profileHash&&before.citationHash===after.citationHash&&canonicalSha256(before.displayHashes)===canonicalSha256(after.displayHashes),'edit changed input, blind draft, profile, citation or display');
  for(const a of before.sections){
    const b=after.sections.find(s=>s.id===a.id);requireThat(b&&a.drafts.length===b.drafts.length,'edit removed a protected section');
    if(a.id!=='limitations')requireThat(softwareText(a)===softwareText(b),'edit changed software-owned text');
    for(let i=0;i<a.drafts.length;i++){
      const left=a.drafts[i]!,right=b.drafts[i]!;
      if(!revision||!['discussion','results'].includes(a.id))assertSameFacts(left,right);
      else {
        // Revision may add/drop whole glue sentences; retained ordinal sentences
        // may not swap a claim or its facts. Software Results remain complete.
        const fact=(d:RenderedDraft)=>d.sentences.filter(s=>s.orderedFacts.length).map(s=>({claims:s.claimIds,keys:s.orderedFacts}));
        const old=fact(left),next=fact(right);
        requireThat(old.every(f=>next.some(n=>canonicalSha256(n)===canonicalSha256(f))),'revision removed or changed existing facts');
      }
    }
  }
}
export function responseLog(issues:readonly ReviewIssue[],diff:SentenceDiff[]):ResponseRow[] {
  return issues.map(i=>({issueId:i.id,disposition:i.proposal?'proposed-investigation':i.category==='literature'?'literature-request':diff.some(d=>d.section===i.anchor)?'changed-text-awaiting-owner':'open',changeMade:diff.filter(d=>d.section===i.anchor),proposalId:i.proposal?.id??null}));
}
export function internalReviewHtml(value:unknown):string {return `<p>${html(REVIEW_BANNER)}</p><pre>${html(JSON.stringify(value,null,2))}</pre>`;}
