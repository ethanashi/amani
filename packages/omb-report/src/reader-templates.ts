/** Reader-facing sentences, computed only from the authenticated report context. */
import {assertContext,type ReportContext} from './context.ts';
import {honestNullReason} from './templates.ts';
import {validLock} from './lock.ts';
import {requireThat} from './common.ts';

const small=['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve'];
export const countWord=(n:number):string=>small[n]??n.toLocaleString('en-US');
const capital=(s:string)=>s[0]!.toUpperCase()+s.slice(1);
export function claimCountSentence(ctx:ReportContext):string {
 assertContext(ctx);
 const planned=ctx.claims.filter(c=>ctx.input.plannedFound.plannedClaimIds.includes(c.id));
 const passed=planned.filter(c=>['confirmed','replicated'].includes(c.status)).length;
 const tentative=planned.filter(c=>c.status==='tentative').length;
 const refuted=planned.filter(c=>c.status==='refuted').length;
 const undecided=planned.length-passed-tentative-refuted;
 const extra=ctx.claims.length-planned.length;
 const clauses:string[]=[];
 if(planned.length&&tentative===planned.length)clauses.push(planned.length===1?'The pre-registered claim was supported, but it did not pass every required check.':`${planned.length===2?'Both':'All '+countWord(planned.length)} pre-registered claims were supported, but none passed every required check.`);
 else {
  if(passed)clauses.push(`${capital(countWord(passed))} of the ${countWord(planned.length)} pre-registered claims passed every required check.`);
  if(tentative)clauses.push(`${capital(countWord(tentative))} ${tentative===1?'was':'were'} supported, but required checks remain incomplete.`);
  if(refuted)clauses.push(`${capital(countWord(refuted))} ${refuted===1?'was':'were'} ruled out at the smallest effect of interest.`);
  if(undecided)clauses.push(`${capital(countWord(undecided))} ${undecided===1?'claim could':'claims could'} not be decided.`);
 }
 if(extra)clauses.push(`${capital(countWord(extra))} further ${extra===1?'result is':'results are'} exploratory.`);
 return clauses.join(' ');
}

/** Rounding is an explicitly labelled reading aid, never a decision or a replacement
 * for the complete technical bundle. No odds-to-risk conversion is made. */
export function plainClaimSentence(ctx:ReportContext):string {
 assertContext(ctx);const c=ctx.claims.find(c=>c.id===ctx.input.plannedFound.primaryClaimId);requireThat(c&&validLock(ctx,c.id),'primary claim must lead and have a valid lock');
 const reason=honestNullReason(c);
 if(reason)return `There is no reportable result because ${reason}.`;
 const b=c.bundle;requireThat(b,'plain result needs the complete certified bundle');
 const rounded=(v:number)=>Number(v.toPrecision(2)).toLocaleString('en-US',{maximumSignificantDigits:2});
 const estimate=rounded(b.estimate),lo=rounded(b.ci[0]),hi=rounded(b.ci[1]);
 const odds=/^(?:OR|odds ratio)$/iu.test(b.measure);
 const result=odds?`The estimated odds ratio was about ${estimate}, with an uncertainty range from about ${lo} to ${hi}. An odds ratio compares the odds in the groups; it is not a change in a person's probability of illness.`:`The estimated ${b.measure} was about ${estimate}, with an uncertainty range from about ${lo} to ${hi}.`;
 const status=c.status==='tentative'?'The finding is tentative.':c.status==='refuted'?'The study ruled out the effect size set in the plan; smaller effects remain possible.':c.status==='insufficient-evidence'?'The data could not settle the question.':c.status==='exploratory'?'This is an exploratory finding, not a test on held-out data.':'The prediction passed the required checks.';
 const checking=`${capital(countWord(c.requirements.filter(r=>r.passed).length))} of ${countWord(c.requirements.length)} required checks passed.`;
 return `${c.plan.exposure} and ${c.plan.outcome} were the focus of the question set before looking at the results. ${result} ${status} ${checking}`;
}
