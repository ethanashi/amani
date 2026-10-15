/** Opt-in: exactly one real Codex adapter invocation; no task data, grading lease or science claim. */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { homedir, loadavg } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { CodexAdapter } from '../../omb-adapters/src/index.ts';
import { Scheduler, MemorySchedStore, osResourceProbe } from '../../omb-sched/src/index.ts';
import { Fleet } from '../src/fleet.ts';
import { MemoryJournal } from '../src/journal.ts';
import { Steps } from '../src/machine.ts';
import { standbyReview } from '../src/triage.ts';
import { refusalRecord } from '../../omb-certify/src/source-policy.ts';
import { WORKER_SCHEMAS } from '../src/turns.ts';
import { removeTree } from '../src/bundle.ts';
if(process.env.OMB_LIVE_TRIAGE!=='1') throw new Error('Set OMB_LIVE_TRIAGE=1 to spend one reviewer call.');
const now=()=>Date.now(), started=now();
const root=mkdtempSync(path.resolve('packages/omb-investigate/.live-review-'));
let calls=0;
try {
 const sched=Scheduler.open({now,store:new MemorySchedStore(),quota:{read:()=>null},resources:osResourceProbe({loadavg,
  vmStat:()=>{const r=spawnSync('vm_stat',{encoding:'utf8'});return r.status===0?r.stdout:null;},
  pressureLevel:()=>{const r=spawnSync('sysctl',['-n','kern.memorystatus_vm_pressure_level'],{encoding:'utf8'});return r.status===0?r.stdout.trim():null;}}),
  policy:{pools:{codex:{model:'gpt-6-astra'}},attempts:{maxAttempts:1,maxResumes:0,maxInterruptions:0},admission:{loadCeiling:20}}});
 const fleet=new Fleet({sched,now,waitUntil:async()=>{throw new Error('Host too busy for the opt-in reviewer test.');},maxIdleWaits:1});
 const adapter=new CodexAdapter({stateRoot:path.join(root,'state'),scratchRoot:path.join(root,'scratch'),cliPath:'/opt/homebrew/bin/codex',authFile:path.join(homedir(),'.codex/auth.json'),now,schemas:WORKER_SCHEMAS});
 const reviewer={run:async(spec:Parameters<CodexAdapter['run']>[0])=>{if(++calls!==1)throw new Error('Only one live call is authorized by this test.');return adapter.run(spec);}};
 const journal=new MemoryJournal(now),ctx=new Steps(journal,'live-triage').context('review');
 const result=await standbyReview({fleet,workers:{codex:reviewer,claude:reviewer},now,promptDir:path.join(root,'prompts'),investigation:'live-triage',quietGroup:null,timeoutMs:120_000,route:'P',forbidden:[]},
  {ctx,id:'live-triage/review',appeal:{issueType:'other' as const,evidence:['code/test_analysis.py'],claim:'Review the runtime boundary.'},refusal:refusalRecord('code-policy','code/test_analysis.py: imports subprocess'),files:['code/analysis.py','code/test_analysis.py'],evidence:'Synthetic source-policy refusal; no dataset was read.',worker:null,workdir:path.join(root,'reviewer')});
 const summary={calls,wallMs:now()-started,status:result.turn.result?.status??'unavailable',files:result.turn.result?.files??{},warnings:result.turn.result?.warnings??[],verdict:result.verdict,dispatches:result.turn.job.dispatchCount,provenance:result.turn.result?.provenance??null};
 mkdirSync('packages/omb-investigate/integration',{recursive:true});writeFileSync('packages/omb-investigate/integration/fix5-live-review.json',JSON.stringify(summary,null,2)+'\n');
 console.log(JSON.stringify(summary));if(!result.verdict)process.exitCode=1;
} finally {removeTree(root);}
