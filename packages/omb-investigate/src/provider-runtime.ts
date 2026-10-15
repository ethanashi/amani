import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import {INDETERMINATE,ProviderPolicy,ProvidersExhausted,ProviderDisagreement,classifyProvider,modelFamily,type ModelEntry,type ProviderConfig,type WorkerAdapter,type WorkerResult,type WorkerSpec,type ProviderOutcome,type Role} from '../../omb-adapters/src/index.ts';
import type {StepContext} from './machine.ts';
import {InvestigationPaused} from './pause.ts';
import type {TurnRequest} from './turns.ts';
export interface ProviderRuntime {policy:ProviderPolicy;adapters:Readonly<Record<string,WorkerAdapter>>}
export function providerRuntime(config:ProviderConfig,adapters:Readonly<Record<string,WorkerAdapter>>):ProviderRuntime{return {policy:new ProviderPolicy(config),adapters};}
export function workerOutcome(result:WorkerResult,spec:WorkerSpec):ProviderOutcome {
 if(result.status==='violation')return {type:'ok'}; // Preserve hard-stop routing in runTurn, never fail over a violation.
 if(result.status==='containment_failure'||result.containment==='survivor-killed')return {type:'transport',text:'Containment unavailable'};
 const explicit=(result as WorkerResult&{providerOutcome?:ProviderOutcome}).providerOutcome;if(explicit)return explicit;
 const text=result.refusal?.explanation??result.warnings.join('\n');
 if(result.status.startsWith('refused-'))return {type:'refusal',text};
 if(result.status==='rate_limited')return {type:'rate-limit',text,...(result.resetAt?{resetAt:result.resetAt*1000}:{})};
 if(result.status==='timeout')return {type:'stall',text};
 const missing=spec.expect.filter(e=>e.required&&!['valid','repaired'].includes(result.files[e.file]??'missing')).map(e=>e.file);
 if(result.status==='ok'||result.status==='provenance_unverified')return missing.length?{type:'non-compliance',missing,text}:{type:'ok',text};
 const outcome=classifyProvider({text,...(missing.length?{missing}:{})});
 return outcome.type==='ok'?{type:result.status==='agent_error'?'non-compliance':'transport',text}:outcome;
}
export function turnRole(turn:string):Role{return ['replicate','methods-validity','standby-review','lateral-review'].includes(turn)?'reviewer':turn==='interpret'?'drafter':'worker';}
/** Runs inside an already admitted Fleet dispatch, preserving all scheduler resource/look gates. */
export async function providerTurn(runtime:ProviderRuntime,req:TurnRequest,spec:WorkerSpec,ctx:StepContext,now:()=>number):Promise<{result:WorkerResult;spec:WorkerSpec;entry:ModelEntry}> {
 const role=req.role??turnRole(req.turn),policy=runtime.policy;
 const source=req.againstModel??req.session?.model??ctx.notes('model-attempt').filter(n=>n.role==='worker'&&n.outcome==='ok').at(-1)?.model??ctx.notes('model-attempt').filter(n=>n.role==='worker').at(-1)?.model;
 const original=spec.resume?.message??readFileSync(spec.promptFile,'utf8');let number=0,activeProvider='',activeWorkdir=spec.workdir;
 return policy.run({role,request:original,requireCrossFamily:req.family.mode==='cross-family',requiresTools:role==='worker'||req.turn==='replicate',...(typeof source==='string'?{againstModel:source}:{})},{now,
  record:a=>{ctx.note('model-attempt',{jobId:req.jobId,...a});ctx.note('model-cost',{jobId:req.jobId,provider:a.provider,model:a.model,attempt:a.attempt,durationMs:a.durationMs,tokens:a.tokens,decision:a.decision});},
  needsYou:(reason,attempts)=>ctx.note('needs-you',{jobId:req.jobId,reason,attempts}),
  triage:async outcome=>{ctx.note('model-disagreement',{jobId:req.jobId,outcome});},
  call:async(entry,input)=>{
   const provider=policy.config.providers[entry.provider]!,adapter=runtime.adapters[entry.provider];if(!adapter)throw new Error('Provider adapter unavailable');
   number++;
   const family=provider.kind==='claude-code-cli'?'claude':provider.kind==='codex-cli'?'codex':modelFamily(entry.model)==='anthropic'?'claude':'codex';
   // No prior partial output is accepted across failover. Each attempt has its own auditable scope.
   const same=activeProvider===entry.provider;
   const workdir=number===1&&!input.fresh?spec.workdir:same&&!input.fresh?activeWorkdir:`${spec.workdir}-provider-${number}`;activeProvider=entry.provider;activeWorkdir=workdir;
   mkdirSync(workdir,{recursive:true,mode:0o700});if(workdir!==spec.workdir)req.seed?.(workdir);
   const promptFile=`${spec.promptFile}.provider-${number}`;writeFileSync(promptFile,input.request+(input.fresh&&input.handoff?'\n\nHOST HANDOFF: '+input.handoff:''),{mode:0o600});
   const next:WorkerSpec={...spec,requiresTools:role==='worker'||req.turn==='replicate',jobId:req.session?.provider===entry.provider&&workdir===req.session.workdir?req.session.workerJobId:`${spec.jobId}:provider:${entry.provider}`,workdir,promptFile,model:entry.model,effort:entry.effort??(['codex-cli','claude-code-cli'].includes(provider.kind)?'high':''),harness:provider.kind==='codex-cli'?'codex':provider.kind==='claude-code-cli'?'claude-code':'opencode',family,timeoutMs:Math.min(spec.timeoutMs,policy.config.policy.callTimeoutMinutes*60_000)};
   delete next.resume;
   if(number===1&&!input.fresh&&req.session?.provider===entry.provider&&req.session.model===entry.model&&spec.resume)next.resume={...spec.resume,message:input.request};
   ctx.note('turn-dispatch',{jobId:req.jobId,dispatchId:`${req.jobId}:provider-${number}`,family,provider:entry.provider,model:entry.model,workerJobId:next.jobId,workdir,resumed:!!next.resume,rerouted:number>1,handoff:input.handoff});
   const result=await adapter.run(next);let outcome=workerOutcome(result,next);
   if(result.status!=='violation'&&outcome.type==='ok'&&(req.family.mode==='cross-family'||['reviewer','referee'].includes(role)&&policy.config.policy.crossFamily==='require')&&typeof source==='string'&&result.provenance.observedModels.some(m=>(modelFamily(m)===INDETERMINATE||modelFamily(m)===modelFamily(source))))outcome={type:'family-violation',text:'Observed model violates cross-family review; independent family required'};
   if(result.usage)outcome.tokens={input:result.usage.inputTokens,output:result.usage.outputTokens};
   return {value:{result,spec:next,entry},outcome};
  },
 });
}
export function providerPause(error:unknown):InvestigationPaused|null {
 return error instanceof ProvidersExhausted?new InvestigationPaused('needs-you',error.message,'plan',0):null;
}
export {ProviderDisagreement};

/** PW7 integration hook: the paper writer supplies its drafter model and existing turn context.
 * Final integrate/paper wiring calls this through its scheduler-admitted turn. */
export function providerRefereeTurn(runtime:ProviderRuntime,req:TurnRequest,spec:WorkerSpec,ctx:Parameters<typeof providerTurn>[3],now:()=>number,drafterModel:string){
 return providerTurn(runtime,{...req,role:'referee',againstModel:drafterModel},spec,ctx,now);
}
