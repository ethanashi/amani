import { INDETERMINATE, toolCapable, modelFamily, type ModelEntry, type ProviderConfig, type Role } from './providers.ts';
import type { ProviderOutcome } from './provider-error.ts';
export interface ModelAttempt {role:Role;provider:string;model:string;outcome:ProviderOutcome['type'];durationMs:number;tokens:{input:number;output:number}|null;decision:'complete'|'retry'|'failover'|'repair'|'handoff'|'triage';text:string|null;attempt:number;providerKind?:string;resetAt?:number}
export class ProvidersExhausted extends Error {
 constructor(readonly attempts:ModelAttempt[],reason='All eligible model providers failed. Owner attention is required; no partial result was accepted.'){super(reason);this.name='ProvidersExhausted';}
}
export class ProviderDisagreement extends Error {constructor(readonly outcome:ProviderOutcome){super('Model disagreement requires triage');}}
export interface PolicyCall<T> {outcome:ProviderOutcome;value:T}
export interface PolicyRequest {request:string;role:Role;againstModel?:string;handoff?:string;requiresTools?:boolean;requireCrossFamily?:boolean}
export interface PolicyHooks<T> {
 call:(entry:ModelEntry,input:{request:string;fresh:boolean;handoff:string|null})=>Promise<PolicyCall<T>>;
 record:(attempt:ModelAttempt)=>void;
 needsYou:(reason:string,attempts:ModelAttempt[])=>void;
 triage:(outcome:ProviderOutcome)=>Promise<void>;
 now?:()=>number;sleep?:(ms:number)=>Promise<void>;random?:()=>number;
}
/** Per-provider state shared by all roles in one engine run; never persisted as credentials. */
export class ProviderPolicy {
 readonly disabled=new Set<string>();
 readonly circuits=new Map<string,{failures:number;until:number}>();
 constructor(readonly config:ProviderConfig){}
 async run<T>(input:PolicyRequest,h:PolicyHooks<T>):Promise<T>{
  const now=h.now??Date.now,sleep=h.sleep??(ms=>new Promise(r=>setTimeout(r,ms))),random=h.random??Math.random,p=this.config.policy;
  const attempts:ModelAttempt[]=[];
  let chain=this.config.roles[input.role].chain.filter(e=>!input.requiresTools||toolCapable(this.config.providers[e.provider]!.kind));
  if(input.requiresTools&&!chain.length){const error=new ProvidersExhausted([],`no tool-capable provider for role ${input.role}`);h.needsYou(error.message,[]);throw error;}
  if(input.requireCrossFamily||['reviewer','referee'].includes(input.role)&&p.crossFamily==='require'){
   if(!input.againstModel)throw new Error('Cross-family review requires the actual source model');
   if(modelFamily(input.againstModel)===INDETERMINATE){const error=new ProvidersExhausted([], 'Cross-family review refused: INDETERMINATE source model family');h.needsYou(error.message,[]);throw error;}
   chain=chain.filter(e=>modelFamily(e.model)!==INDETERMINATE&&modelFamily(e.model)!==modelFamily(input.againstModel!));
  }
  if(input.againstModel&&['reviewer','referee'].includes(input.role)&&p.crossFamily==='prefer')chain=[...chain.filter(e=>modelFamily(e.model)!==modelFamily(input.againstModel!)),...chain.filter(e=>modelFamily(e.model)===modelFamily(input.againstModel!))];
  for(const entry of chain){
   if(this.disabled.has(entry.provider))continue;
   let circuit=this.circuits.get(entry.provider);
   if(circuit&&circuit.until>now())continue;
   if(circuit?.until){this.circuits.delete(entry.provider);circuit=undefined;}
   let request=input.request,repairs=0,restarts=0,retries=0,fresh=false;
   for(;;){
    const active=this.circuits.get(entry.provider);if(active&&active.until>now())break;
    if(active?.until)this.circuits.delete(entry.provider);
    const started=now();
    // Backends must sanitize errors at their secret boundary. Unknown throws are not logged.
    let call:PolicyCall<T>;
    try{call=await h.call(entry,{request,fresh,handoff:fresh?(input.handoff??'Continue from the original request; re-check required artifacts. No prior output is certified.'):null});}
    catch{call={outcome:{type:'transport',text:'Provider call unavailable'},value:undefined as T};}
    const o=call.outcome;let decision:ModelAttempt['decision']='failover',delay=0;
    if(o.type==='ok'){decision='complete';this.circuits.delete(entry.provider);}
    else if(o.type==='disagreement')decision='triage';
    else if(o.type==='auth'){this.disabled.add(entry.provider);}
    else if(o.type==='refusal'){
     // Refusal is terminal for this provider. The next call uses input.request byte-for-byte.
     decision='failover';
    }else if(o.type==='non-compliance'&&repairs++<p.repairNudges){
     decision='repair';request=input.request+'\n\n'+JSON.stringify({type:'repair',missing:o.missing??['required nonempty output'],instruction:'Produce only the missing or invalid required artifacts; all original rules remain in force.'});
    }else if(['stall','loop','context-overflow'].includes(o.type)&&restarts++<1){decision='handoff';fresh=true;request=input.request;}
    else if(['transport','server','rate-limit'].includes(o.type)){
     const failures=(this.circuits.get(entry.provider)?.failures??0)+1;
     const trip=o.type==='rate-limit'||failures>=p.circuitBreaker.failures;
     const reset=o.resetAt===undefined?null:Math.max(0,o.resetAt-now());
     const shortReset=o.type==='rate-limit'&&reset!==null&&reset<=p.retry.maxDelayMs;
     this.circuits.set(entry.provider,{failures,until:shortReset?now()+reset!:trip?now()+p.circuitBreaker.cooldownMinutes*60_000:0});
     if(++retries<p.retry.maxAttempts&&(!trip||shortReset)){
      decision='retry';delay=o.type==='rate-limit'?reset!:Math.min(p.retry.maxDelayMs,p.retry.baseDelayMs*2**(retries-1))*(0.5+Math.max(0,Math.min(1,random()))*0.5);
     }
    }
    const attempt:ModelAttempt={role:input.role,provider:entry.provider,model:entry.model,outcome:o.type,durationMs:Math.max(0,now()-started),tokens:o.tokens??null,decision,text:o.text??null,attempt:attempts.length+1,providerKind:this.config.providers[entry.provider]!.kind,...(Number.isFinite(o.resetAt)?{resetAt:o.resetAt}:{})};
    attempts.push(attempt);h.record(attempt);
    if(o.type==='auth')h.needsYou(`Provider ${entry.provider} authentication is unavailable; ${this.config.providers[entry.provider]!.kind.endsWith("-cli")?"repair its CLI sign-in":"repair its API credentials in Settings → Models (Keychain)"}, then explicitly Resume.`,[attempt]);
    if(decision==='complete')return call.value;
    if(decision==='triage'){await h.triage(o);throw new ProviderDisagreement(o);}
    if(decision==='failover')break;
    if(delay)await sleep(delay);
   }
  }
  const exhausted=new ProvidersExhausted(attempts, "All eligible model providers failed. Investigation paused; no partial result was accepted. Review provider details and retry/reset times, repair sign-in or credentials, or configure an eligible model in Settings → Models, then explicitly Resume.");h.needsYou(exhausted.message,attempts);throw exhausted;
 }
}
/** Structured progress only. Repeated events cannot postpone a stall forever. */
export class ProgressWatchdog {
 last:number;lastAction='';repeats=0;readonly recent:string[]=[];
 constructor(readonly now:()=>number,readonly stallMs:number,readonly repeatLimit=4){this.last=now();}
 event(action:string):'loop'|null{this.recent.push(action);if(this.recent.length>this.repeatLimit*4)this.recent.shift();this.repeats=this.recent.filter(a=>a===action).length;if(action!==this.lastAction){this.lastAction=action;this.last=this.now();}return this.repeats>=this.repeatLimit?'loop':null;}
 stalled():boolean{return this.now()-this.last>=this.stallMs;}
}

export function progressFingerprint(e:Record<string,any>):string {
 const action=e.item?.command??(e.part?.type==='tool'?{tool:e.part.tool,input:e.part.state?.input}:undefined)??e.error??e.message?.content??e.part??e.item??e;
 return JSON.stringify({type:e.type,action});
}
