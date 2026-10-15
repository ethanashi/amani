import { assertDevelopmentAuthorization } from '../medic-authorization.ts';
import { record, records } from './stats.ts';
import { loadAcceptedAdapter } from './checkout.ts';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Investigation, InvestigationDeps, DeliverableOut } from '../../../omb-investigate/src/investigation.ts';
import type { Journal } from '../../../omb-investigate/src/journal.ts';
import type { EngineResult } from '../engine.ts';
import { persistCheckpoint } from '../transport/checkpoint-io.ts';
import { FaultInjector } from '../dev-faults.ts';
import { heal } from './protocol.ts';
import { nativePorts } from './native.ts';
import { medicClass } from './boundary.ts';
import { createCheckpoint, environmentManifest, escalate } from './checkpoint.ts';

/** Temporary dev-only orchestration. The engine has one opt-in call site. */
export async function runWithMedic(o:{authorized?:boolean;root:string;repo:string;pixiEnv:string;deps:InvestigationDeps;journal:Journal;result:EngineResult;io:{persist:(write:()=>void)=>void};create:()=>Investigation;execute:(run:()=>Promise<DeliverableOut>)=>Promise<EngineResult>;checkpoint:()=>void}):Promise<EngineResult> {
  assertDevelopmentAuthorization(o.authorized===true);
  record(o.repo,{kind:'run-start',run:o.root});
  let persist=persistCheckpoint, pendingStorageFault=false, parked=false, activeRepo=o.repo;
  o.io.persist=write=>{try{persist(write);}catch(e){if((e as {code?:unknown})?.code==='ENOSPC')pendingStorageFault=true;throw e;}};
  if(process.env.AMANI_MEDIC_INJECT) {
    if(process.env.AMANI_MEDIC_INJECT!=='write:disk-full')throw new Error('only registered checkpoint injection is supported for official medic runs');
    const injection=new FaultInjector(process.env.AMANI_MEDIC_INJECT), original=o.deps.faultAt;
    o.deps.faultAt=point=>{if(point==='phase:dry-run:started')try{persist(()=>injection.checkpoint(point));}catch(e){pendingStorageFault=true;throw e;}original?.(point);};
  }
  const inv=o.create(), env=()=>environmentManifest(o.repo,o.pixiEnv);
  let last:DeliverableOut|undefined;
  const result=await o.execute(async()=>{
    for(;;) {
      last=await inv.run();
      const pause=inv.machine.notes('paused').at(-1);
      if(last.status!=='paused'||!pendingStorageFault)return last;
      const classification=medicClass({status:last.status,...(typeof pause?.kind==='string'?{pauseKind:pause.kind}:{})});
      if(!classification)return last;
      const cp=createCheckpoint({root:o.root,repo:activeRepo,machine:inv.machine,journal:o.journal,environment:env(),classification,code:'host-storage',diagnostic:String(pause?.reason??'')});
      o.result.status='needs-medic';parked=true;o.checkpoint();
      const healed=await heal({root:o.root,repo:activeRepo,statsRepo:o.repo,checkpoint:cp,machine:inv.machine,authorized:o.authorized===true,ports:nativePorts({authorized:o.authorized===true,repo:o.repo,root:o.root,environment:env})});
      if(!healed)return last;
      // Only a stateless adapter changes. Signing key, ledger, sessions and steps stay live.
      persist=loadAcceptedAdapter(healed.worktree,healed.identity);
      activeRepo=healed.worktree;pendingStorageFault=false;parked=false;
    }
  });
  result.medicHeals=inv.machine.notes('code-version-changed');
  const pause=inv.machine.notes('paused').at(-1);
  const classification=medicClass({status:result.status,...(last?.outcome?{terminal:last.outcome.kind}:{}),...(typeof pause?.kind==='string'?{pauseKind:pause.kind}:{})});
  if(classification&&!parked) {
    const cp=createCheckpoint({root:o.root,repo:activeRepo,machine:inv.machine,journal:o.journal,environment:env(),classification,
      code:classification==='infra'?'provider-unavailable':pause?.kind==='infra'?'host-storage':'host-exception',diagnostic:JSON.stringify({pause:pause??null,warnings:result.warnings})});
    record(o.repo,{kind:'invocation',run:o.root,classification,phase:cp.phase,status:'no-safe-reproduction'});
    parked=true;
    if(!existsSync(path.join(o.root,'medic/needs-you.json')))escalate(o.root,cp,'No validated practice-only reproduction has been supplied; automatic repair refused.',{failure:cp.failure});
  }
  if(parked)result.status='needs-medic';
  record(o.repo,{kind:'run-completed',run:o.root,status:result.status});
  if(result.status==='complete'&&!records(o.repo).some(r=>r.run===o.root&&r.kind==='invocation'))record(o.repo,{kind:'no-heal',run:o.root,status:result.status});
  o.checkpoint();return result;
}
