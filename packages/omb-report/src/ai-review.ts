import {assessMethodsNarrative} from './methods-narrative.ts';
import {canonicalText} from './normalise.ts';
import {canonicalSha256} from '../../bio-core/src/index.ts';
import {assertContext,type ReportContext} from './context.ts';
import {requireThat} from './common.ts';
import {assessAIProse,type AIReviewFlag} from './ai-prose.ts';
import {assertOwnerActor,exactKeys,readPW5Receipt,type PW5Authority,type PW5Receipt} from './pw5-evidence.ts';
export const AI_REVIEW_DOMAIN='omb-report/ai-prose-acknowledgment@1';
export interface AIProseReview {paperHash:string;draftHash:string;flags:AIReviewFlag[]}
const reviews=new WeakMap<AIProseReview,string>();
/** PW9 must build this over every drafter region of the final package, then call
 * requireAIReviewAcknowledged before setting its endorsed lock. */
export function buildAIProseReview(ctx:ReportContext,regions:readonly {id:string;prose:string}[]):AIProseReview {
 requireThat(regions.length>0&&new Set(regions.map(r=>r.id)).size===regions.length,'missing or duplicate AI review regions');
 const assessment=assessAIProse(ctx,regions.map(r=>r.prose).join('\n'));
 const methodsFlags=regions.flatMap(r=>{
  const quote=canonicalText(r.prose).replace(/[.!?]+$/u,'').trim();
  if(ctx.quotes.some(q=>q.status==='fulltext-verified'&&canonicalText(q.quote).replace(/[.!?]+$/u,'').trim()===quote))return [];
  return assessMethodsNarrative(ctx,r.prose).flags;
 });
 const review={paperHash:ctx.input.sha256,draftHash:canonicalSha256(regions),flags:[...assessment.flags,...methodsFlags]};reviews.set(review,canonicalSha256(review));return review;
}
/** Authenticate review metadata without implying acknowledgment or endorsement. */
export function assertAIProseReview(ctx:ReportContext,review:AIProseReview):void {
 assertContext(ctx);requireThat(review.paperHash===ctx.input.sha256&&reviews.get(review)===canonicalSha256(review),'AI review not authenticated for this paper');
}
export interface AIReviewAcknowledgment {draftHash:string;actor:string;action:'acknowledge-ai-prose-flags';flagIds:string[]}
export function requireAIReviewAcknowledged(ctx:ReportContext,review:AIProseReview,envelope?:PW5Receipt<AIReviewAcknowledgment>,verify?:PW5Authority):void {
 assertAIProseReview(ctx,review);
 if(!review.flags.length)return;
 requireThat(envelope&&verify,'AI prose owner review is required before endorsement');
 const ack=readPW5Receipt(ctx,envelope,AI_REVIEW_DOMAIN,verify);exactKeys(ack,['draftHash','actor','action','flagIds'],'AI acknowledgment field');
 assertOwnerActor(ack.actor);const owner=ctx.input.ownerConfiguration;
 requireThat(owner&&ack.actor===owner.ownerActor&&ack.draftHash===review.draftHash&&ack.action==='acknowledge-ai-prose-flags','AI acknowledgment owner/draft mismatch');
 requireThat(Array.isArray(ack.flagIds)&&canonicalSha256([...ack.flagIds].sort())===canonicalSha256(review.flags.map(f=>f.id).sort()),'every AI review flag must be acknowledged exactly once');
}
export function aiReviewNotice(review:AIProseReview):string {
 return review.flags.length?`Owner review required before endorsement: artificial intelligence use/Methods prose flags ${review.flags.map(f=>f.id).join(', ')} (PaperInput ${review.paperHash}; draft ${review.draftHash}).`:'';
}
