import { requireThat } from './common.ts';
import type { Status, ClaimView } from './context.ts';

/** These are requests, not author-written predicates. No entity/number fits a free slot. */
export const CONNECTIVES = Object.freeze(['', 'For this analysis,', 'In this analysis,', 'Regarding this result,']);
export const CLAIM_TEMPLATES: Readonly<Record<Status,string>> = Object.freeze({
 confirmed: 'The pre-registered prediction held',
 replicated: 'The prediction held again in independent data',
 tentative: 'The finding is tentative; required checks remain incomplete',
 refuted: 'The pre-registered prediction did not hold at the smallest effect of interest',
 'insufficient-evidence': 'The data could not decide the pre-registered prediction',
 'non-identifiable': 'The proposed effect is not identifiable from these data',
 voided: 'The analysis was voided and is not counted as evidence',
 exploratory: 'The observation is exploratory and was not tested on held-out data',
});
export function claimTemplate(c:ClaimView, connective:string, registered=c.registered,style:'standard'|'abstract'|'results'='standard'):string {
 requireThat(CONNECTIVES.includes(connective), 'connective is outside the closed allow-list');
 const subject=`${String(c.plan.exposure??'The exposure')} and ${String(c.plan.outcome??'the outcome')}`;
 const nullReason=honestNullReason(c);
 const bundle=nullReason===null?` [m:${c.id}.result]`:'';
 if(nullReason!==null)return `${connective?connective+' ':''}For ${subject}, there is no reportable result, because [m:${c.id}.null_reason]. [m:${c.id}.label]`;
 const equivalence=c.status==='refuted'?` The equivalence margin around the null${style==='results'?' for '+String(c.plan.exposure):''} was [m:${c.id}.mei].`:'';
 let status=registered?CLAIM_TEMPLATES[c.status]:CLAIM_TEMPLATES[c.status].replace(/pre-registered/gu,'post hoc');
 if(style==='results')status=status.replace(/^(The (?:pre-registered |post hoc )?(?:prediction|finding|data|analysis|observation|proposed effect))/u,`$1 for ${String(c.plan.exposure)}`);
 if(style==='abstract')return `For ${String(c.plan.exposure)} in relation to ${String(c.plan.outcome)}, the [m:${c.id}.result]. ${status}.${equivalence} [m:${c.id}.label]`;
 return `${connective?connective+' for':'For'} ${String(c.plan.exposure)} in relation to ${String(c.plan.outcome)}, the${bundle}. ${status}.${equivalence} [m:${c.id}.label]`;
}

/** Retained as empty exports for API migration. Free narrative is not a template list. */
export const PROCEDURE_TEMPLATES:readonly string[]=Object.freeze([]);
export const LITERATURE_TEMPLATES:readonly string[]=Object.freeze([]);
export const BLIND_INPUT_TEMPLATES:readonly string[]=Object.freeze([]);

/** The null explanation is owned by software and bound to the certified status/reason. */
export function honestNullReason(c:ClaimView):string|null {
 if(c.status!=='voided'&&c.status!=='non-identifiable')return null;
 return `${c.status==='voided'?'the analysis was voided':'the proposed effect is not identifiable from these data'}; recorded reason: ${c.reason.trim().replace(/[.!?]+$/u,'')}`;
}
