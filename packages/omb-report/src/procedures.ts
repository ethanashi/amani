import { canonicalSha256 } from '../../bio-core/src/index.ts';
import type { ReportContext,ResolvedFact } from './context.ts';
import { record,requireThat } from './common.ts';
import { planFragment } from './prose.ts';
import { validLock } from './lock.ts';
/** These statements describe the locked plan, not evidence that it was executed.
 * Execution/archiving statements require their own explicit provenance predicate. */
export function procedure(ctx:ReportContext,key:string):ResolvedFact {
 const c=ctx.claims.find(c=>key.startsWith(c.id+'.'));requireThat(c,'unknown procedure claim');
 const kind=key.slice(c.id.length+1);let display:string;let source:unknown=c.plan;
 switch(kind){
 case 'interpretation': {
  const outcome:Record<string,string>={confirmed:'supports the registered association with all required checks passed',replicated:'supports the registered association again in independent data',tentative:'supports the registered association, but required checks remain incomplete',refuted:'rules out the smallest effect of interest specified in the plan; smaller effects remain possible','insufficient-evidence':'does not settle the registered question; the interval permits materially different answers','non-identifiable':'cannot identify the proposed effect',voided:'was voided and is not evidence',exploratory:'is exploratory and cannot serve as a confirmatory test'};
  const scope=c.rung<3?'This observational contrast does not establish that changing the exposure would change the outcome.':'The causal interpretation remains conditional on the recorded assumptions.';
  display=`For ${c.plan.exposure} in relation to ${c.plan.outcome}, the evidence ${outcome[c.status]}.${c.status==='non-identifiable'?' '+c.reason.trim().replace(/[.!?]+$/u,'')+'.':''} ${scope} ${c.evidenceType==='validation not established'?'The result has no established validation for use outside the analysed setting.':'The recorded validation scope is '+c.evidenceType+'.'}`;
  source=c;break;
 }
 case 'sidedness':requireThat(['two-sided','greater','less'].includes(String(c.plan.direction)),'test sidedness unavailable');display=`The locked plan specifies a ${c.plan.direction==='two-sided'?'two-sided':'one-sided'} test`;break;
 case 'registration':display=validLock(ctx,c.id)?'The plan was locked before the confirming look':'The analysis was post hoc';source={lock:ctx.input.lock,looks:ctx.input.looks};break;
 case 'measurement':requireThat(typeof c.plan.outcome==='string','planned outcome unavailable');display=`The locked plan names ${c.plan.outcome} as the outcome`;break;
 case 'adjustment':requireThat(Array.isArray(c.plan.adjustment),'planned adjustment unavailable');display=c.plan.adjustment.length?`The locked plan specifies adjustment for ${c.plan.adjustment.join(' and ')}`:'The locked plan specifies no covariate adjustment';break;
 case 'exclusions':requireThat(Array.isArray(c.plan.exclusions)&&c.plan.exclusions.length,'planned exclusions unavailable');display=`The locked plan specifies exclusion criteria: ${c.plan.exclusions.join('; ')}`;break;
 case 'controls-source':requireThat(typeof c.plan.controls_source==='string','planned control source unavailable');display=`The planned control source is ${c.plan.controls_source}`;break;
 case 'validation':display=c.evidenceType==='validation not established'?'The certification provides no completed validation result':`The certification records ${c.evidenceType}`;source=c.requirements;break;
 case 'archiving':{const a=record(record(ctx.input.runMetadata).archive);requireThat(a.status==='archived'&&typeof a.sha256==='string'&&/^[a-f0-9]{64}$/u.test(a.sha256),'archive provenance unavailable');display='The provenance record certifies that the files were archived';source=a;break;}
 default:throw new Error('unknown procedure slot');
 }
 return {key,claimId:c.id,display,raw:source,grade:'input',producerGate:'paper-input-procedure',factIds:[canonicalSha256(source)],certHash:c.certHash};
}
