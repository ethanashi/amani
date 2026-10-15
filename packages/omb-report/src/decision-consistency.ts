/** Presentation cannot contradict the certified decision. This is a refusal gate,
 * never a new statistical decision or an override of the referee. */
import {assertContext,type ReportContext} from './context.ts';
import {record,requireThat} from './common.ts';
export function assertDecisionConsistency(ctx:ReportContext):void {
 assertContext(ctx);
 for(const c of ctx.claims){
  if(['voided','non-identifiable'].includes(c.status)||c.kind==='data-integrity')continue;
  const b=c.bundle;if(!b)continue; // Existing mandatory-presence guards still require reportable bundles.
  requireThat(b.ci[0]<=b.estimate&&b.estimate<=b.ci[1],`decision consistency: ${c.id}: estimate lies outside displayed interval`);
  const supported=['confirmed','replicated','tentative'].includes(c.status);
  if(!supported&&c.status!=='refuted')continue;
  const rule=record(c.plan.decisionRule);
  requireThat(!c.plan.decisionRule||rule.kind==='p-and-ci',`decision consistency: ${c.id}: unsupported locked decision rule; an authenticated explanation adapter is required before release`);
  requireThat(typeof c.plan.alpha==='number'&&b.effectiveAlpha<=c.plan.alpha,`decision consistency: ${c.id}: displayed alpha exceeds the locked level`);
  if(rule.alpha!==undefined)requireThat(rule.alpha===b.effectiveAlpha,`decision consistency: ${c.id}: displayed alpha differs from locked decision rule`);
  if(supported){
   requireThat(b.p!==null&&b.p<=b.effectiveAlpha,`decision consistency: ${c.id}: ${c.status} conflicts with displayed p-value and effective alpha`);
   const excludes=c.plan.direction==='greater'?b.ci[0]>b.nullValue:c.plan.direction==='less'?b.ci[1]<b.nullValue:c.plan.direction==='two-sided'&&(b.ci[0]>b.nullValue||b.ci[1]<b.nullValue);
   requireThat(excludes,`decision consistency: ${c.id}: ${c.status} conflicts with displayed confidence interval and locked direction`);
  }else requireThat(b.mei!==null&&b.ci[0]>=b.nullValue-b.mei&&b.ci[1]<=b.nullValue+b.mei,`decision consistency: ${c.id}: refuted label lacks an interval inside the locked equivalence bounds`);
 }
}
