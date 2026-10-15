import { stage1LiteratureInput } from '../../omb-paper/src/literature.ts';
import { validLock } from './lock.ts';
/** Ports bio-report's lock ancestry, mandatory negative history, bounded digest and
 * escaped report structure over the PW0 lineage, without importing the v1 ledger. */
import { canonicalJson, canonicalSha256 } from '../../bio-core/src/index.ts';
import { assertContext, type ReportContext } from './context.ts';
import { type EntityRegistry } from './entities.ts';
import { type LimitationEntry, limitationsPartA, limitationsPlainTwins, limitationsPartB, lintAtMostOnce, protect, renderProtected, verifyProtectedText } from './limitations.ts';
import { threePartLabel, outcomeText } from './labels.ts';
import { renderDraft, derivationsTable } from './render.ts';
import { record, requireThat, plain } from './common.ts';
export { validLock } from './lock.ts';
export function lockedAncestors(ctx:ReportContext,id:string):string[]{return validLock(ctx,id)?[canonicalSha256(ctx.input.lockedPlan)]:[];}
export interface NegativePointer {id:string;label:string}
export function negativePointers(ctx:ReportContext):NegativePointer[]{
 assertContext(ctx);const result:NegativePointer[]=[];
 for(const cert of ctx.input.certifications)for(const assessment of cert.certificate.certification.assessments){const a=record(assessment),label=record(a.label);if(!['confirmed','replicated'].includes(String(a.status))||label.voided===true)result.push({id:`${cert.id}:${String(a.claimId)}`,label:label.voided?'voided':String(a.status)});}
 for(const [i,a]of ctx.input.plannedFound.abandonedAnalyses.entries())result.push({id:`abandoned:${canonicalSha256(a)}:${i}`,label:'abandoned'});
 return result;
}
export interface DigestOptions {byteBudget:number;mode:'blind'|'results'}
export function compileDigest(ctx:ReportContext,options:DigestOptions):{markdown:string;bytes:number;negativeIds:string[];omittedContextLines:number}{
 assertContext(ctx);requireThat(Number.isSafeInteger(options.byteBudget)&&options.byteBudget>0,'invalid digest budget');requireThat(['blind','results'].includes(options.mode),'unknown digest mode');
 const negatives=options.mode==='results'?negativePointers(ctx):[];
 const required=options.mode==='blind'?`# Blind drafting context\nPlan: ${canonicalSha256(ctx.input.lockedPlan)}\nIntroduction: ${plain(ctx.input.introductionRequirement)}\n`:`# Results drafting context\nPaperInput: ${ctx.input.sha256}\n\n## Negative and undecided history (complete)\n${negatives.map(n=>`- ${plain(n.label)}: ${plain(n.id)}`).join('\n')}\n`;
 let markdown=required;requireThat(Buffer.byteLength(required)<=options.byteBudget,'negative history cannot be truncated; split by sub-question');let omittedContextLines=0;
 const context=options.mode==='blind'?[`Locked plan: ${plain(canonicalJson(ctx.input.lockedPlan))}`,ctx.input.literatureBrief ? `Frozen literature brief: ${plain(canonicalJson(stage1LiteratureInput(ctx.input.lockedPlan, ctx.input.literatureBrief)))}` : `Frozen index: ${plain(canonicalJson(ctx.input.frozenLiteratureIndex))}`]:ctx.claims.map(c=>`${plain(c.id)}: ${plain(threePartLabel(ctx,c.id).full)}; ${plain(ctx.slots.get(`m:${c.id}.result`)?.display??'Result unavailable')}`);
 for(const line of context){if(Buffer.byteLength(markdown+line+'\n')<=options.byteBudget)markdown+=line+'\n';else omittedContextLines++;}
 if(options.mode==='blind' && ctx.input.literatureBrief && omittedContextLines) throw new Error('Stage-1 budget cannot truncate the frozen plan/brief');
 return {markdown,bytes:Buffer.byteLength(markdown),negativeIds:negatives.map(n=>n.id),omittedContextLines};
}
export function deviationsTable(ctx:ReportContext):string{
 assertContext(ctx);return '| Amendment | Reason | After unblinding |\n| --- | --- | --- |\n'+ctx.input.plannedFound.deviations.map((value,i)=>{const a=record(value);return `| ${i+1} | ${plain(typeof a.reason==='string'&&a.reason.trim()?a.reason:'No reason was recorded at the time of the change')} | ${a.postFirstLook===true||a.post_unblinding===true?'yes':'no'} |`;}).join('\n');
}
export function renderResults(ctx:ReportContext):string{
 assertContext(ctx);const ids=[...ctx.input.plannedFound.primaryClaimId?[ctx.input.plannedFound.primaryClaimId]:[],...ctx.input.plannedFound.plannedClaimIds.filter(id=>id!==ctx.input.plannedFound.primaryClaimId),...ctx.claims.filter(c=>!ctx.input.plannedFound.plannedClaimIds.includes(c.id)).map(c=>c.id)];
 requireThat(new Set(ids).size===ctx.claims.length,'missing Results claim');
 return ids.map(id=>{const c=ctx.claims.find(c=>c.id===id);requireThat(c,'missing Results block');requireThat(validLock(ctx,id)||c.status==='exploratory'||c.status==='voided','outcome has no locked ancestry');
  const fact=ctx.slots.get(`m:${id}.result`);const cert=ctx.input.certifications.find(cert=>cert.id===c.certificationId)!;
  const provenance=fact?` [facts](sha256:${canonicalSha256(fact.factIds)}), [code](sha256:${cert.certificate.binding.frozenCodeHash}), [certificate](sha256:${c.certHash})`:'';
  return `### ${plain(id)} ${plain(threePartLabel(ctx,id).short)}\n${plain(fact?.display??'Result bundle unavailable; no unchecked number is shown.')}${provenance}\n${plain(outcomeText(ctx,c))}.`;
 }).join('\n\n');
}
export interface ReportOptions {summary:string;methods:string;discussion:string;partB:readonly LimitationEntry[]}
export function renderReport(ctx:ReportContext,options:ReportOptions,registry:EntityRegistry):string{
 assertContext(ctx);const partA=limitationsPartA(ctx),twins=limitationsPlainTwins(ctx);const summary=renderDraft(ctx,options.summary,'plain-summary',registry).text;const methods=renderDraft(ctx,options.methods,'methods',registry).text;const discussion=renderDraft(ctx,options.discussion,'discussion',registry).text;
 const markdown=`# Research report\n\n## Plain summary\n${plain(summary)}\n${renderProtected(twins)}\n\n## Locked plan\n${plain(canonicalJson(ctx.input.lock))}\n\n## Deviations\n${deviationsTable(ctx)}\n\n## Methods\n${plain(methods)}\n\n${ctx.input.priorKnowledge ? `Prior-knowledge box: ${plain(canonicalJson(ctx.input.priorKnowledge))}` : ""}\n\n## Results\n${renderResults(ctx)}\n\n## Analyses abandoned, and why\n${ctx.input.plannedFound.abandonedAnalyses.map(a=>plain(canonicalJson(a))).join('\n')||'None recorded.'}\n\n## Negative history\n${negativePointers(ctx).map(n=>`- ${plain(n.id)}: ${plain(n.label)}`).join('\n')}\n\n## Discussion\n${plain(discussion)}\n\n## Limitations\n${renderProtected(partA)}\n\n${limitationsPartB(ctx,options.partB,registry)}\n\n## Derivations\n${derivationsTable(ctx)}\n\n## How to check this yourself\nPaperInput sha256: ${ctx.input.sha256}. Re-run the frozen code against the manifest and compare each fact with its certification.\n`;
 verifyProtectedText([...partA,...twins],markdown);
 lintAtMostOnce(markdown,[...partA,...ctx.claims.map(c=>protect(`label-${c.id}`,threePartLabel(ctx,c.id).full))]);return markdown;
}

/** Titles are software-owned and always follow the pre-specified primary outcome. */
export function renderTitle(ctx:ReportContext):string {
 assertContext(ctx);const c=ctx.claims.find(c=>c.id===ctx.input.plannedFound.primaryClaimId);requireThat(c&&validLock(ctx,c.id),'title requires a pre-specified primary claim');
 const exposure=typeof c.plan.exposure==='string'?c.plan.exposure:'The exposure';const outcome=typeof c.plan.outcome==='string'?c.plan.outcome:'the outcome';
 requireThat(!/\p{N}/u.test(exposure+outcome),'title needs digit-free plain entity labels from the locked plan');
 const result=c.status==='refuted'?'finding no association larger than the smallest effect of interest':c.status==='insufficient-evidence'?'that could not decide':['non-identifiable','voided'].includes(c.status)?'that could not be completed':'';
 return `${exposure} and ${outcome}: a pre-registered analysis${result?' '+result:''}`;
}
