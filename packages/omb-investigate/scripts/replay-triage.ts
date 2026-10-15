/** Read-only saved-source replay. All execution uses saved SYNTHETIC tables and disposable copies. */
import {copyFileSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,realpathSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {homedir} from 'node:os';
import {MemoryJournal} from '../src/journal.ts';
import {Steps} from '../src/machine.ts';
import {KernelExecutor} from '../src/kernel.ts';
import {snapshotBundle,revalidateDevDrop,treeHashes,treeHash,fileSha256,removeTree} from '../src/bundle.ts';
import {InvestigationParked,resolveAppeal} from '../src/triage.ts';
import {refusalRecord,withBundleContext} from '../../omb-certify/src/source-policy.ts';
const scratch=mkdtempSync(path.resolve('packages/omb-investigate/.replay-triage-'));
const savedGrading=process.env.BIO_GRADING_ROOT;process.env.BIO_GRADING_ROOT=path.join(scratch,'grading');
const pixi=realpathSync('packages/bio-baseline/.pixi/envs/default'),node=path.dirname(realpathSync(process.execPath));
const executor=new KernelExecutor({scratchRoot:path.join(scratch,'exec'),toolPath:`${pixi}/bin:${node}:/usr/bin:/bin`,runtimeRoots:[pixi,node],timeoutMs:3000,now:()=>0});
const cases=[
 {name:'p1-test-primary',task:'p1-esr1',candidate:0,file:'code/test_primary.py'},
 {name:'p1-test-pipeline',task:'p1-esr1',candidate:1,file:'code/test_pipeline.py'},
 {name:'w0-readme',task:'w0-venet',candidate:0,file:'code/README.md'},
 {name:'w0-test-pipeline',task:'w0-venet',candidate:0,file:'code/test_pipeline.py'},
 {name:'w0-test-survival',task:'w0-venet',candidate:0,file:'code/test_survival.py'},
 {name:'p10-pycache',task:'p10-pseudorep',candidate:2,file:'code/__pycache__/rnaseq.cpython-313.pyc'},
 {name:'python-unbound',task:'p10-pseudorep',candidate:0,file:'run_primary.sh'},
 {name:'missing-plan',task:'p1-esr1',candidate:0,file:'code/primary.py'},
 {name:'disguised-headers',task:'w0-venet',candidate:0,file:'code/data.py',stamp:'20261012194702'},
];
const results=[];
try {
 for(const c of cases){
  const started=performance.now(),stamp=c.stamp??'20261012163915',source=path.join(homedir(),'.omerta-bio/v7-smoke',stamp),host=path.join(source,'host',`smoke-${c.task}-${stamp}`),original=path.join(host,'bundles',`candidate-${c.candidate}`),sourceFile=path.join(original,c.file);
  const sourceHash=fileSha256(sourceFile),candidate=snapshotBundle(original,path.join(scratch,c.name),path.join(host,'locked/plan.json'),undefined,{keepDevFiles:true});
  const isDev=!['python-unbound','missing-plan','disguised-headers'].includes(c.name);
  if(isDev){mkdirSync(path.dirname(path.join(candidate.dir,c.file)),{recursive:true});copyFileSync(sourceFile,path.join(candidate.dir,c.file));candidate.hash=treeHash(candidate.dir);}
  const files=Object.keys(treeHashes(candidate.dir)),journal=new MemoryJournal(()=>0),ctx=new Steps(journal,c.name).context('replay');let reviewerCalls=0;
  const guardError=['missing-plan','disguised-headers'].includes(c.name);
  let evidence=c.name==='missing-plan'?'host executor plan.json input missing':c.name==='disguised-headers'?'host table header mapping unavailable':`${c.file}: development-only source refused`;
  let category=isDev?'code-policy':guardError?'infra':'exit-nonzero';
  const stagedRoot=path.join(source,'share/staged'),stage=path.join(stagedRoot,readdirSync(stagedRoot).find(n=>n.startsWith(c.task+'-'))!);
  const synthetic=path.join(stage,readdirSync(stage).find(n=>n.startsWith('synthetic-'))!);
  if(c.name==='python-unbound'){
   const r=await executor.run({bundleDir:candidate.dir,dataDir:synthetic,outDir:path.join(scratch,'out',c.name),mode:'dry-run',seed:'triage-replay'});evidence=r.errorText??'ran, no output';category=r.category??'execution';
   if(!evidence.includes('PYTHON'))throw new Error('Saved PYTHON boundary no longer reproduced');
  }
  const refusal=withBundleContext(refusalRecord(category,evidence,'pre-look',guardError?'guard-error':'denied'),files);
  let outcome='';
  try{const action=await resolveAppeal({id:c.name,ctx,hostDir:path.join(scratch,'ledger',c.name),refusal,appeal:{issueType:isDev?'dev-file-flagged':guardError?'harness-missing-input':'other',evidence:[refusal.id],claim:'Saved failure replay.'},files,hardStop:null,lookSpent:false,timeoutMs:1500,hardTimeoutMs:3000,bundleHash:candidate.hash,investigationId:c.name,
    revalidateDrop:paths=>revalidateDevDrop(candidate,paths,async b=>{const r=await executor.run({bundleDir:b.dir,dataDir:synthetic,outDir:path.join(scratch,'validated',c.name),mode:'dry-run',seed:'triage-replay'});return r.status==='ok'?true:r.category==='infra'||r.hardStop?false:{repair:r.refusal??refusalRecord(r.category??'execution',r.errorText??'analysis failed')};}),
    review:async()=>{reviewerCalls++;return {verdict:'rule-correct',explanation:'Use python directly from the pinned PATH; env.sh does not define PYTHON.'};}});outcome=action.kind==='feedback'?'feedback-and-continue':action.kind;
  }catch(e){if(!(e instanceof InvestigationParked))throw e;outcome=e.status;}
  if(fileSha256(sourceFile)!==sourceHash)throw new Error('Saved source changed');
  const row={name:c.name,stamp,sourceFile:path.relative(source,sourceFile),sourceHash,boundary:guardError?'historical guard-error injection, source-backed':isDev?'saved dev file reinserted into otherwise normalized bundle':'actual saved synthetic execution',outcome,reviewerCalls,workerAppeals:ctx.notes('appeal-filed').length,lookCount:0,wallMs:Math.round(performance.now()-started)};results.push(row);console.log(JSON.stringify(row));
 }
 writeFileSync('packages/omb-investigate/integration/fix5-triage-replay-results.json',JSON.stringify(results,null,2)+'\n');
 if(results.some(r=>!['drop-dev-files','feedback-and-continue','blocked-by-system-bug'].includes(r.outcome)))process.exitCode=1;
}finally{removeTree(scratch);if(savedGrading===undefined)delete process.env.BIO_GRADING_ROOT;else process.env.BIO_GRADING_ROOT=savedGrading;}
