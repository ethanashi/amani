/** Read-only reproduction of the saved 2026-10-12 failures. Scratch is always deleted. */
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import { KernelExecutor } from '../src/kernel.ts';
import { snapshotBundle, removeTree } from '../src/bundle.ts';
const source=process.argv[2]??path.join(homedir(),'.omerta-bio/v7-smoke/20261012163915');
const root=mkdtempSync(path.resolve('packages/omb-investigate/.replay-fix3-'));
const before=process.env.BIO_GRADING_ROOT;process.env.BIO_GRADING_ROOT=path.join(root,'grading');
const pixi=realpathSync('packages/bio-baseline/.pixi/envs/default'),node=path.dirname(realpathSync(process.execPath));
const results=[];
try{
  const executor=new KernelExecutor({scratchRoot:path.join(root,'exec'),toolPath:`${pixi}/bin:${node}:/usr/bin:/bin`,runtimeRoots:[pixi,node],timeoutMs:30_000,now:()=>0});
  for(const [task,candidates] of [['p1-esr1',[0,1]],['w0-venet',[0]],['p10-pseudorep',[0,2]]] as const){
    const host=path.join(source,'host',`smoke-${task}-20261012163915`),stageRoot=path.join(source,'share/staged');
    const staged=path.join(stageRoot,readdirSync(stageRoot).find(n=>n.startsWith(task+'-'))!);
    const data=path.join(staged,readdirSync(staged).find(n=>n.startsWith('synthetic-'))!);
    for(const candidate of candidates){
      const id=`${task}-candidate-${candidate}`,start=performance.now();
      const bundle=snapshotBundle(path.join(host,'bundles',`candidate-${candidate}`),path.join(root,id),path.join(host,'locked/plan.json'));
      const result=await executor.run({bundleDir:bundle.dir,dataDir:data,outDir:path.join(root,'outputs',id),mode:'dry-run',seed:'replay-fix3'});
      const row={id,discarded:bundle.discarded,...result,wallMs:Math.round(performance.now()-start)};results.push(row);console.log(JSON.stringify(row));
    }
  }
  mkdirSync('packages/omb-investigate/integration',{recursive:true});
  writeFileSync('packages/omb-investigate/integration/fix3-replay-results.json',JSON.stringify(results,null,2)+'\n');
  if(results.some(r=>r.category==='infra'))process.exitCode=1;
}finally{removeTree(root);if(before===undefined)delete process.env.BIO_GRADING_ROOT;else process.env.BIO_GRADING_ROOT=before;}
