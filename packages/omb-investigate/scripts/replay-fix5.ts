/** Saved-source boundary replay: copies journals/bundles, executes only saved synthetic data. */
import {cpSync,copyFileSync,existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,realpathSync,writeFileSync} from 'node:fs';
import path from 'node:path';import {homedir} from 'node:os';import {DatabaseSync} from 'node:sqlite';
import {KernelExecutor} from '../src/kernel.ts';import {snapshotBundle,treeHash,removeTree,fileSha256} from '../src/bundle.ts';
import {CodePolicyError} from '../../omb-certify/src/source-policy.ts';
const base=path.join(homedir(),'.omerta-bio/v7-smoke'),scratch=mkdtempSync(path.resolve('packages/omb-investigate/.replay-fix5-'));
const saved=process.env.BIO_GRADING_ROOT;process.env.BIO_GRADING_ROOT=path.join(scratch,'grading');
const pixi=realpathSync('packages/bio-baseline/.pixi/envs/default'),node=path.dirname(realpathSync(process.execPath));
const exec=new KernelExecutor({scratchRoot:path.join(scratch,'executor'),toolPath:`${pixi}/bin:${node}:/usr/bin:/bin`,runtimeRoots:[pixi,node],timeoutMs:3000,now:()=>performance.now()});
const roots:unknown[]=[],failures:unknown[]=[];
try{for(const stamp of readdirSync(base).sort()){
 const root=path.join(base,stamp),journal=path.join(root,'journal.sqlite');if(!existsSync(journal))continue;
 const copy=path.join(scratch,stamp);mkdirSync(copy);for(const suffix of ['','-wal','-shm'])if(existsSync(journal+suffix))copyFileSync(journal+suffix,path.join(copy,'journal.sqlite'+suffix));
 const db=new DatabaseSync(path.join(copy,'journal.sqlite'));const events=db.prepare("select sequence,stream_id,event_type,payload_json from kernel_events where stream_id like 'inv:%' order by sequence").all().map(r=>({seq:Number(r.sequence),stream:String(r.stream_id),type:String(r.event_type),p:JSON.parse(String(r.payload_json)).data}));db.close();
 const failuresHere=events.filter(e=>e.type==='phase-completed'&&e.p.output?.terminal||e.type==='compute-result'&&e.p.payload?.status==='crash'||e.type==='turn-result'&&e.p.status&&!['ok','succeeded'].includes(e.p.status));
 for(const e of failuresHere){const t=e.p.output?.terminal;failures.push({stamp,stream:e.stream,sequence:e.seq,boundary:e.type,phase:e.p.phase??e.p.scope??'turn',kind:t?.kind??e.p.payload?.category??e.p.status,diagnostic:e.p.phase==='look'||e.p.scope==='look'?'post-look redacted':String(t?.reason??e.p.payload?.errorText??'').slice(0,1000)});}
 const bundles:unknown[]=[];const hosts=path.join(root,'host');
 for(const name of existsSync(hosts)?readdirSync(hosts):[]){const host=path.join(hosts,name),source=path.join(host,'bundles');if(!existsSync(source))continue;
  const task=name.replace(/^smoke-/,'').replace('-'+stamp,'');const staged=path.join(root,'share/staged');const stage=existsSync(staged)?readdirSync(staged).find(s=>s.startsWith(task+'-')):undefined;
  const synthParent=stage?path.join(staged,stage):'';const synth=stage?readdirSync(synthParent).find(s=>s.startsWith('synthetic-')):undefined;
  for(const candidate of readdirSync(source).filter(n=>n.startsWith('candidate-'))){const original=path.join(source,candidate),before=treeHash(original),dest=path.join(copy,name,candidate);mkdirSync(path.dirname(dest),{recursive:true});cpSync(original,dest,{recursive:true});
   let outcome='feedback-and-continue',detail='',category='code-policy';
   try{const plan=path.join(host,'locked/plan.json');if(!existsSync(plan)||!synth){outcome='blocked-by-system-bug';detail='saved replay input unavailable';category='guard-error';}
    else{const bundle=snapshotBundle(dest,dest+'-normalized',plan);const data=path.join(copy,name,'synthetic');if(!existsSync(data))cpSync(path.join(synthParent,synth),data,{recursive:true});
     const result=await exec.run({bundleDir:bundle.dir,dataDir:data,outDir:dest+'-outputs',mode:'dry-run',seed:'fix5-replay'});
     category=result.category??'ok';outcome=result.status==='ok'?'freeze-ready':result.hardStop?'hard-stop':result.category==='infra'||result.category==='data-unreadable'?'paused':'feedback-and-continue';detail=result.refusal?.trigger??result.errorText??'';}
   }catch(e){if(!(e instanceof CodePolicyError))throw e;category=e.refusal.decision;outcome=e.refusal.decision==='guard-error'?'blocked-by-system-bug':'feedback-and-continue';detail=e.refusal.trigger;}
   if(treeHash(original)!==before)throw new Error('saved bundle changed');bundles.push({investigation:name,candidate,sourceHash:before,outcome,category,diagnostic:detail.slice(0,1000)});
  }
 }
 const row={stamp,journalHash:fileSha256(journal),historicalFailures:failuresHere.length,bundles};roots.push(row);console.log(JSON.stringify({stamp,historicalFailures:failuresHere.length,bundles:(bundles as {outcome:string}[]).map(b=>b.outcome)}));
}
const priorFile='packages/omb-investigate/integration/fix5-saved-replay.json';
const prior=existsSync(priorFile)?JSON.parse(readFileSync(priorFile,'utf8')) as {roots:{stamp:string}[]}:{roots:[]};
const available=new Set((roots as {stamp:string}[]).map(r=>r.stamp));
const unavailableHistoricalRoots=prior.roots.filter(r=>!available.has(r.stamp)).map(r=>({stamp:r.stamp,status:'source-unavailable' as const}));
writeFileSync('packages/omb-investigate/integration/fix5-saved-replay-latest.json',JSON.stringify({scope:'Boundary replay of currently available candidate bundles on synthetic data; no model/science rerun. Missing historical sources are unavailable, not re-executed or counted as passed.',priorReplayArtifact:'fix5-saved-replay.json',unavailableHistoricalRoots,roots,failures},null,2)+'\n');
}finally{removeTree(scratch);if(saved===undefined)delete process.env.BIO_GRADING_ROOT;else process.env.BIO_GRADING_ROOT=saved;}
