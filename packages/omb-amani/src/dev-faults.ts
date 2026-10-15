import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { InvestigationDeps } from '../../omb-investigate/src/investigation.ts';
import { InvestigationPaused } from '../../omb-investigate/src/pause.ts';
import type { WorkerAdapter } from '../../omb-adapters/src/index.ts';
import { treeHash } from '../../omb-investigate/src/bundle.ts';

export const FAULTS=['practice:structure','executor:crash','worker:provider-refusal','worker:stall','worker:malformed','worker:claude-signin','worker:quota','write:disk-full'] as const;
export type Fault=typeof FAULTS[number];
export interface FaultEvidence {point:string;fault:string;cause:'system'|'provider';detail:string}
export type OutcomeClass='system-fault'|'infra'|'scientific-abstention'|'recovered';
/** Gauntlet precedence: current host/practice failures beat provider failures. Completion
 * can recover a historical fault; scientific abstention requires affirmative reasons. */
export function classifyDevOutcome(r:{status:string;issues?:readonly unknown[];warnings?:readonly unknown[];parks?:readonly unknown[];phases?:readonly string[];claims?:{taskStatus:string;reasons?:string[]}[]},evidence:FaultEvidence[]=[]):OutcomeClass {
 const text=JSON.stringify([r.warnings??[],r.parks??[]]);
 if(r.status==='complete'&&!(r.issues?.length)){
  const claims=r.claims??[];
  if(claims.length&&r.phases?.includes('certify')&&claims.every(c=>['insufficient-evidence','non-identifiable'].includes(c.taskStatus)&&c.reasons?.some(x=>/assumption|identifiab|scientific|evidence/i.test(x)))&&!evidence.length)return 'scientific-abstention';
  return 'recovered';
 }
 if(evidence.some(e=>e.cause==='system')||/practice data violates|ENOSPC|trusted-path-changed|cleanup.*fail/i.test(text))return 'system-fault';
 if(evidence.some(e=>e.cause==='provider')||/provider refusal|sign.in.*lost|authentication.*fail|quota.*refus|network.down/i.test(text))return 'infra';
 return 'system-fault';
}
/** Bounded boundary faults. Provider/stall injections emulate the adapter's terminal
 * watchdog/refusal boundary, not an unbounded sleep or a real sign-out/quota spend. */
export class FaultInjector {
 readonly evidence:FaultEvidence[]=[];private fired=false;
 constructor(readonly injection?:string){if(injection&&!FAULTS.includes(injection as Fault))throw new Error(`unknown injection ${injection}; expected ${FAULTS.join(', ')}`);}
 private hit(detail:string,cause:'system'|'provider'='system'):void {
  const [point,fault]=this.injection!.split(':');this.evidence.push({point:point!,fault:fault!,cause,detail});this.fired=true;
 }
 worker(inner:WorkerAdapter):WorkerAdapter{return{run:async s=>{
  const fault=this.injection;
  if(fault?.startsWith('worker:')&&(fault!=='worker:claude-signin'||s.family==='claude')){
   if(fault==='worker:malformed'){
    this.hit('Worker returned malformed JSON instead of its required output');
    for(const e of s.expect)writeFileSync(path.join(s.workdir,e.file),'{ invalid output',{mode:0o600});
    return {status:'agent_error',resetAt:null,sessionToken:null,files:Object.fromEntries(s.expect.map(e=>[e.file,'invalid' as const])),warnings:['Injected malformed worker output'],usage:null,usageComplete:false,containment:'reaped',supervisor:null,eventsPath:'',quota:null,rateLimit:{terminal:false,signals:[],resetHint:null},provenance:{cliVersion:null,cliSha256:null,initInventory:[],observedModels:[],observedEfforts:[],identitySource:'unavailable',profileSha256:null,configSha256:null,canary:'denied'}};
   }
   const provider=fault!=='worker:stall';
   const detail=fault==='worker:provider-refusal'?'Provider refusal before work':fault==='worker:claude-signin'?'Claude sign-in lost: authentication failed':fault==='worker:quota'?'Provider quota refusal before work':'Worker watchdog: stall, no file or token progress';
   this.hit(detail,provider?'provider':'system');
   throw new InvestigationPaused(fault==='worker:quota'?'quota':provider?'provider':'system-bug',detail,'plan',0);
  }
  return inner.run(s);
 }};}
 checkpoint(point:string):void {
  if(this.injection==='write:disk-full'&&!this.fired&&point.endsWith(':started')){this.hit('Host checkpoint write failed with ENOSPC');throw Object.assign(new Error('ENOSPC: injected disk-full write error'),{code:'ENOSPC'});}
 }
 configure(d:InvestigationDeps):void {
  if(this.injection==='executor:crash'){
   const original=d.executor;
   d.executor={...original,health:()=>original.health?.()??Promise.resolve(),run:async r=>{
    if(!this.fired){this.hit('Injected executor crash before result: host census fault');return {status:'crash',category:'infra',kind:'census-fault',errorText:'Injected executor crash',outputsHash:null,files:[]};}return original.run(r);
   }};
  }
  if(this.injection==='practice:structure'){
   const original=d.stager;
   d.stager={stage:r=>original.stage(r),scramble:r=>original.scramble(r),...(original.verifyPractice?{verifyPractice:r=>original.verifyPractice!(r)}:{}),synthesize:async r=>{
    const data=await original.synthesize(r),file=readdirSync(data.dir).find(n=>/\.(tsv|csv)$/.test(n));
    if(!file)throw new Error('practice injection requires a tabular practice file');
    const p=path.join(data.dir,file);writeFileSync(p,'INVALID_SERVED_STRUCTURE\n'+readFileSync(p,'utf8'));
    this.hit('Practice header violates the served schema; real host verifier must reject it');return{...data,hash:treeHash(data.dir)};
   }};
  }
  if(this.injection==='write:disk-full'){
   const original=d.faultAt;
   d.faultAt=point=>{original?.(point);this.checkpoint(point);};
  }
 }
}
