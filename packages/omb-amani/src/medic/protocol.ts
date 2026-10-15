import { assertDevelopmentAuthorization } from '../medic-authorization.ts';
import { checkoutIdentity, assertCheckout, installGateRuntime, type ExecutableIdentity } from './checkout.ts';
import { record } from './stats.ts';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { hashOf, type PhaseMachine } from '../../../omb-investigate/src/machine.ts';
import { atomicJson, assertArtifacts, assertCheckpoint, escalate, medicPacket, type EnvironmentManifest, type MedicCheckpoint } from './checkpoint.ts';
import { collectPatch, git } from './guards.ts';
import { healLimit } from './boundary.ts';

export interface GateReceipt { name:string; passed:boolean; command:string[]; logHash:string; detail:string }
export interface ReviewVerdict { verdict:'approve'|'refuse'; explanation:string; diffHash:string }
export interface MedicPorts {
  repair(worktree:string,packet:object):Promise<void>;
  replay(worktree:string,cp:MedicCheckpoint):Promise<GateReceipt>;
  regressions(worktree:string,base:string):Promise<GateReceipt>;
  suites(worktree:string,packages:string[],base:string):Promise<GateReceipt>;
  gauntlet(worktree:string,base:string):Promise<GateReceipt>;
  review(worktree:string,diff:string,diffHash:string):Promise<ReviewVerdict>;
  /** Must re-read current environment at the acceptance boundary. */
  environment():EnvironmentManifest;
}
export interface HealResult { worktree:string; commit:string; diffHash:string; identity:ExecutableIdentity }
/** Host-owned protocol. No port receives official artifacts except the host replay gate;
 * production replay must project onto a registered synthetic reproduction, never raw dev-fork. */
export async function heal(o:{authorized?:boolean;root:string;repo:string;statsRepo?:string;checkpoint:MedicCheckpoint;machine:PhaseMachine;ports:MedicPorts}):Promise<HealResult|null> {
  assertDevelopmentAuthorization(o.authorized===true);
  const cp=o.checkpoint, machine=o.machine, report:{gates:GateReceipt[];review:ReviewVerdict|null;issues:string[]}={gates:[],review:null,issues:[]};
  const invocation=record(o.statsRepo??o.repo,{kind:'invocation',run:o.root,classification:cp.failure.classification,phase:cp.phase});
  const refuse=(reason:string):null=>{report.issues.push(reason);machine.note('medic-escalated',{checkpointHash:cp.hash,reason});escalate(o.root,cp,reason,report);return null;};
  const limit=healLimit(machine.notes('medic-attempt').map(n=>String(n.phase)),cp.phase);
  if(limit)return refuse(limit);
  try{assertCheckpoint(cp,o.ports.environment());assertArtifacts(cp,o.root,machine);}catch(e){return refuse(String(e));}
  if(machine.due()!==cp.phase)return refuse('failure phase is no longer resumable');
  if(cp.phase==='look'&&cp.failure.postExposure)return refuse('look exposure is ambiguous: automatic resume cannot spend another look');
  const n=machine.notes('medic-attempt').length+1;
  // Unique investigation component across attempts whose legacy public ID is amani-investigation.
  const branch=`medic/${cp.id.replace(/[^a-zA-Z0-9_-]/g,'_')}-${hashOf(o.root).slice(0,8)}/${n}`;
  machine.note('medic-attempt',{phase:cp.phase,n,branch,checkpointHash:cp.hash});
  const worktree=path.join(path.dirname(o.repo),`.medic-${randomUUID()}`);
  try {
    git(o.repo,['worktree','add','-b',branch,worktree,cp.commit]);
    const gitAuthority=readFileSync(path.join(worktree,'.git'),'utf8');
    const verifyAuthority=()=>{if(readFileSync(path.join(worktree,'.git'),'utf8')!==gitAuthority)throw new Error('worktree git authority changed');};
    const modules=path.join(o.repo,'node_modules');
    installGateRuntime(modules,worktree);
    for(const relative of ['packages/bio-baseline/.pixi','packages/omb-investigate/format-runtime/.pixi'])if(existsSync(path.join(o.repo,relative)))symlinkSync(realpathSync(path.join(o.repo,relative)),path.join(worktree,relative),'dir');
    const before=await o.ports.replay(worktree,cp); report.gates.push({...before,name:'reproduce-before'});
    // A reproduction must affirm the expected failure, not merely crash for any reason.
    if(before.passed || before.detail!=='expected-fault')return refuse('expected failure was not reproduced');
    await o.ports.repair(worktree,medicPacket(cp));
    // Agent cannot write git authority. Host stages its complete diff, then verifies all paths.
    verifyAuthority();
    git(worktree,['add','--all']);
    const patch=collectPatch(worktree,cp.commit);
    if(patch.issues.length)return refuse(patch.issues.join('; '));
    git(worktree,['commit','-m',`Medic ${cp.id}: plumbing repair ${n} (pending normal review)`]);
    const commit=git(worktree,['rev-parse','HEAD']).trim();
    // A separate detached checkout contains only committed bytes, never agent scratch.
    const accepted=path.join(path.dirname(o.repo),`.medic-accepted-${randomUUID()}`);
    git(o.repo,['worktree','add','--detach',accepted,commit]);
    installGateRuntime(modules,accepted);
    for(const relative of ['packages/bio-baseline/.pixi','packages/omb-investigate/format-runtime/.pixi'])if(existsSync(path.join(o.repo,relative)))symlinkSync(realpathSync(path.join(o.repo,relative)),path.join(accepted,relative),'dir');
    const identity=checkoutIdentity(accepted,commit);
    const reviewed=patch.diff+'\nExecutable tree identity: '+identity.digest+'\n';
    const diffHash=createHash('sha256').update(reviewed).digest('hex');
    const verify=()=>assertCheckout(accepted,identity);
    verify();report.gates.push(await o.ports.replay(accepted,cp));verify();
    report.gates.push(await o.ports.regressions(accepted,cp.commit));
    report.gates.push(await o.ports.suites(accepted,[...new Set(patch.files.map(f=>f.file.split('/')[1]!))],cp.commit));
    report.gates.push(await o.ports.gauntlet(accepted,cp.commit));
    if(report.gates.slice(1).length!==4||report.gates.slice(1).some(g=>!g.passed))return refuse('required gate failed');
    verify();
    report.review=await o.ports.review(accepted,reviewed,diffHash);
    verify();
    if(report.review.verdict!=='approve'||report.review.diffHash!==diffHash||!report.review.explanation.trim())return refuse('cross-family review refused');
    verifyAuthority();
    const final=collectPatch(worktree,cp.commit);
    if(final.issues.length||final.diff!==patch.diff)return refuse('patch changed during gates or review');
    assertCheckpoint(cp,o.ports.environment());
    assertArtifacts(cp,o.root,machine);
    verify();
    // No phase/step invalidation, look refund or scientific metadata changes here.
    machine.note('code-version-changed',{oldCommit:cp.commit,newCommit:commit,diffHash,failure:cp.failure,gates:report.gates,reviewer:report.review,checkpointHash:cp.hash});
    if(cp.failure.postExposure)machine.note('protocol-deviation',{kind:'mid-run code change after exposure',oldCommit:cp.commit,newCommit:commit,diffHash});
    const learned={schema:'omb-amani/medic-healed@1',failure:medicPacket(cp),signature:cp.failure.signature,branch,commit,diffHash,report,pendingPermanentFix:true};
    atomicJson(path.join(o.root,`medic/healed-${n}.json`),learned);
    const failureFile=path.join(o.root,`medic/failure-${cp.failure.signature}.json`);
    atomicJson(failureFile,{...learned,factory:{command:['python3','factory/loop.py','--from-failure',failureFile],requiresRegisteredRecipe:true}});
    record(o.statsRepo??o.repo,{kind:'healed',run:o.root,invocation:invocation.id,classification:cp.failure.classification,commit});
    return{worktree:accepted,commit,diffHash,identity};
  }catch(e){return refuse(String(e));}
}
