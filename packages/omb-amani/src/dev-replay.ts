import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { FaultInjector, classifyDevOutcome } from './dev-faults.ts';
import { runEngine, type EngineResult } from './engine.ts';
import { TurnCassette } from './dev-cassette.ts';
import { devFork, type DevManifest, type ForkOptions } from './dev-fork.ts';
import { JournalLedger, JournalRegistry } from '../../omb-investigate/src/stores.ts';
import { loadTask, safePath } from './task.ts';
import { computeCardIntegrity, writeCardIntegrity } from './card-integrity.ts';
import { certifiedEvidence } from './diagnostic-blocks.ts';
import type { CertifyResult } from '../../omb-investigate/src/ports.ts';
import { practiceDeclaration } from './practice.ts';
import { materialize } from './results.ts';
import type { WorkerAdapter } from '../../omb-adapters/src/index.ts';
import type { InvestigationDeps } from '../../omb-investigate/src/investigation.ts';

export interface DevReplayOptions { dir:string; cassette?:string; onDivergence?:'stop'|'live'; inject?:string; capMinutes?:number }
export function checkLiveQuota(repoRoot:string):void {
 for(const key of ['HOME','USER','LOGNAME'])if(!process.env[key])throw new Error(`live fallback requires ${key} from the live environment`);
 const script=[path.join(repoRoot,'_logs/codex-quota.sh'),path.resolve(repoRoot,'../_logs/codex-quota.sh')].find(existsSync);
 if(!script)throw new Error('live fallback refused: _logs/codex-quota.sh unavailable');
 const r=spawnSync('bash',[script],{encoding:'utf8',env:process.env,timeout:10000});
 if(r.status!==0)throw new Error(`live fallback refused: ${r.stdout.trim()||'quota check unavailable'}`);
}
export async function devReplay(options:DevReplayOptions, seams:{workers?:{codex:WorkerAdapter;claude:WorkerAdapter};beforeLive?:()=>void;configure?:(d:InvestigationDeps)=>void}={}) {
 const injector=new FaultInjector(options.inject);
 const started=performance.now(),dir=safePath(options.dir);
 const manifest=JSON.parse(readFileSync(path.join(dir,'dev-fork.json'),'utf8')) as DevManifest;
 if(manifest.offRecord!==true||manifest.gradable!==false||manifest.schema!=='omb-amani/dev-fork@1'||manifest.root!==path.join(dir,'.amani')||!existsSync(path.join(dir,'OFF-RECORD')))throw new Error('not an off-record development fork');
 const reportPath=path.join(dir,'dev-result.json');
 // One continuation per fork keeps comparison and model accounting unambiguous.
 writeFileSync(path.join(dir,'dev-started.json'),JSON.stringify({offRecord:true,gradable:false,startedAt:Date.now()})+'\n',{flag:'wx',mode:0o400});
 const root=manifest.root,repoRoot=fileURLToPath(new URL('../../../',import.meta.url)),task=loadTask(manifest.taskDir,manifest.mode);
 const cassette=new TurnCassette({root:path.join(root,'host/cassette'),source:options.cassette?safePath(options.cassette):path.join(root,'host/source-cassette'),roots:[[root,'$AMANI'],[manifest.taskDir,'$TASK']],mode:options.onDivergence??'stop',seedBefore:manifest.sourceCutoff,beforeLive:seams.beforeLive??(()=>checkLiveQuota(repoRoot))});
 const capMs=(options.capMinutes??20)*60000;if(!Number.isFinite(capMs)||capMs<=0)throw new Error('invalid cap-minutes');
 const envKeys=['BIO_GRADING_ROOT','OMB_LIVE','OMB_CODEX_MODEL','OMB_CLAUDE_MODEL'] as const;
 const saved=Object.fromEntries(envKeys.map(k=>[k,process.env[k]]));
 process.env.BIO_GRADING_ROOT=path.join(root,'grading');mkdirSync(process.env.BIO_GRADING_ROOT,{recursive:true});
 process.env.OMB_LIVE='1';process.env.OMB_CODEX_MODEL='gpt-6-astra';process.env.OMB_CLAUDE_MODEL='claude-sonnet-5-5';
 let result:EngineResult;
 try {
  result=await runEngine({task,root,repoRoot,id:manifest.id,capMs,now:Date.now,live:true,...(seams.workers?{workers:seams.workers}:{}),development:{
   offRecord:true,wrapWorker:w=>injector.worker(cassette.wrap(w)),
   configure:d=>{
    d.ledger=new JournalLedger(d.journal,randomBytes(32));d.registry=new JournalRegistry(d.journal);
    // Old stage records predate practiceDeclarations. Reconstruct host metadata from
    // the public task at the current stager boundary, without rewriting the seeded chain.
    const base=d.stager,hydrate=(staged:Parameters<typeof base.synthesize>[0]['staged'])=>({...staged,practiceDeclarations:Object.fromEntries(task.identity.filter(x=>!x.matrix).map(x=>[x.file,practiceDeclaration(x.file,task)]))});
    d.stager={stage:r=>base.stage(r),synthesize:r=>base.synthesize({...r,staged:hydrate(r.staged)}),scramble:r=>base.scramble({...r,staged:hydrate(r.staged)}),...(base.verifyPractice?{verifyPractice:r=>base.verifyPractice!({...r,staged:hydrate(r.staged)})}:{})};
    // Offline replay must not probe provider authentication before its first miss.
    d.preflight={check:async()=>[]};seams.configure?.(d);injector.configure(d);
   },
   initialize:async(inv,r)=>{
    const genesis=inv.machine.notes('dev-genesis')[0];if(genesis?.sourceHash!==manifest.sourceHash||genesis?.offRecord!==true)throw new Error('development genesis mismatch');
    if(inv.machine.due()!==manifest.at)throw new Error('fork phase changed before continuation');
    const phases=inv.machine.completed();
    const look=phases.find(p=>p.phase==='look')?.output;
    if(look){const final=look.final as {outputsDir?:string}|null,frozen=look.frozen as {dir?:string}|null;
     if(final?.outputsDir){for(const f of readdirSync(final.outputsDir).filter(n=>n.endsWith('.json')))r.evidence.outputs[f]=JSON.parse(readFileSync(path.join(final.outputsDir,f),'utf8'));}
     r.frozen=frozen?.dir??null;
    }
    for(const p of phases.filter(p=>p.phase==='certify'||p.phase==='replicate'))if(p.output.certification)r.evidence=certifiedEvidence(r.evidence,p.output.certification as unknown as CertifyResult);
    if(task.mode==='card'&&phases.some(p=>p.phase==='stage')){const dest=path.join(root,'host/card-integrity');mkdirSync(dest,{recursive:true});r.evidence.integrity=writeCardIntegrity(dest,computeCardIntegrity({publicContract:task.publicContract??null,dataDir:task.dataRoot,key:randomBytes(32)}));}
    if(phases.some(p=>p.phase==='interpret')){const lead=phases.findLast(p=>p.output.lead)?.output.lead as {workdir:string}|undefined;const draft=lead&&path.join(lead.workdir,'amani-result-draft.json');if(draft&&existsSync(draft))r.draft=JSON.parse(readFileSync(draft,'utf8'));}
    r.warnings.push(...manifest.warnings,'OFF-RECORD: development replay, ineligible for official submission.');
   },
  }});
 } finally {for(const k of envKeys){if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];}}
 const resolved=materialize(task.template,result.draft,result.evidence,task);
 const output={offRecord:true,gradable:false,forkId:manifest.forkId,sourceHash:manifest.sourceHash,at:manifest.at,status:cassette.stats.divergences.length&&!cassette.live?'diverged':result.status,outcomeClass:classifyDevOutcome({...result,issues:resolved.issues,claims:result.evidence.claims},injector.evidence),faults:injector.evidence,phases:result.phases??[],wallMs:Math.round(performance.now()-started),cassette:cassette.stats,baselineWallMs:18*60000,completedPhases:manifest.phases.map(p=>p.phase),
  report:resolved.report,issues:resolved.issues,warnings:[...result.warnings,...resolved.warnings],deliverable:result.deliverable,parks:result.parks,reportPath};
 writeFileSync(reportPath,JSON.stringify(output,null,2)+'\n',{flag:'wx',mode:0o600});
 return output;
}
/** Card-factory hook: never grades; returns the off-record report and execution accounting. */
export async function replayFailure(failure:{attemptDir:string;phase:ForkOptions['at']},out:string,options:Omit<DevReplayOptions,'dir'>={}){
 await devFork({from:failure.attemptDir,at:failure.phase,out});return devReplay({dir:out,...options});
}
