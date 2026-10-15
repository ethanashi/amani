import { isStatistical, type Plan, type PlanClaim } from '../../omb-gauntlet/src/index.ts';
import { assertKernelClaim } from './producers.ts';
import { FACT_PRODUCERS } from './facts.ts';
export interface Admission { claimId:string; status:'admitted-shape'|'refused'; reasons:string[]; }
/** Shape admission is not a gate pass: staged data, rank, provenance and every required
 * executed gate must still succeed. Useful before locking an irreversible rule. */
export function inspectClaimShape(claim:PlanClaim,plan?:Plan):Admission {
  const reasons:string[]=[];
  if(plan&&Object.keys(plan.knobs).length)reasons.push('unsupported plan-level analysis knobs; descriptive context belongs in sharedKnobs');
  if(claim.kind==='data-integrity') {
    if(claim.assertedValue===null)reasons.push('integrity hypothesis has no asserted value');
    const spec=claim.knobs.producer;
    if(spec) {
      if(typeof spec!=='object'||Array.isArray(spec)||!FACT_PRODUCERS.includes((spec as Record<string,unknown>).producer as never))reasons.push('unregistered trusted fact producer');
    }else if(!/^(?:.*\.)?(effective_n|input_n|duplicate_groups|duplicate_records)$/.test(claim.fact??claim.metric))reasons.push('fact has no registered producer; unknown facts are unevaluable');
  }else if(isStatistical(claim.kind)||claim.kind==='reproduction') {
    const unknown=Object.keys(claim.knobs).filter(k=>!['table','monteCarlo','permutationMode','material','interval','performance','producer'].includes(k));
    if(unknown.length)reasons.push(`unsupported analysis knobs: ${unknown.sort().join(', ')}; move descriptive settings to sharedKnobs`);
    if(typeof claim.knobs.table!=='string'||!/^[^/\\]+\.(tsv|csv|json)$/.test(claim.knobs.table))reasons.push('declared staged analysis table required');
    if(claim.unit!=='unit_id')reasons.push('unit must be stager-owned unit_id; declare identity in plan.staging');
    if(claim.kind==='out-of-sample') {
      if(claim.strata.length||claim.adjustment.length)reasons.push('performance strata and adjustment are not implemented');
      if(claim.test!=='paired prediction permutation')reasons.push('only frozen held-out paired prediction permutation is admitted; training/CV pipelines need a reviewed producer');
      if(!claim.knobs.performance)reasons.push('locked performance pack and baselines required');
    }else if(claim.estimand==='deterministic fact'&&claim.kind==='reproduction') {
      if(!claim.knobs.producer)reasons.push('registered deterministic fact producer required');
    }else {try{assertKernelClaim(claim);}catch(e){reasons.push(e instanceof Error?e.message:'unsupported kernel');}}
  }else reasons.push('citation resolution is provided by the external CIT authority');
  return {claimId:claim.id,status:reasons.length?'refused':'admitted-shape',reasons};
}
export const inspectPlanShapes=(plan:Plan):Admission[]=>plan.claims.map(c=>inspectClaimShape(c,plan));
