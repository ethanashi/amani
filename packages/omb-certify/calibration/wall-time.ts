import { mkdtempSync,mkdirSync,writeFileSync,rmSync,realpathSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parsePlan,planLockHash } from '../../omb-gauntlet/src/index.ts';
import { canonicalSha256 } from '../../bio-core/src/index.ts';
// Same fixtures and source for both versions. Real sandboxed look/re-execution;
// fast deterministic trusted simulation callback, never a live arm.
const api=await import(pathToFileURL(path.resolve(process.argv[2]??'packages/omb-certify/src/index.ts')).href) as typeof import('../src/index.ts');
for(const design of ['balanced','offset','repeated']){
 const root=mkdtempSync(path.resolve('packages/omb-certify/.grading-v2d/timing-'));
 try{
  const work=path.join(root,'worker'),raw=path.join(root,'raw'),state=path.join(root,'state');for(const dir of [path.join(work,'code'),raw,state])mkdirSync(dir,{recursive:true});
  const rows=Array.from({length:design==='repeated'?24:8},(_,i)=>{const x=design==='repeated'?Number(i%4===0):Number(i>=4),u=design==='repeated'?'u'+Math.floor(i/4):'u'+i;return ['r'+i,u,String(x),String((design==='offset'?1e6:0)+(design==='repeated'?20*x+Math.floor(i/4)*2+Math.sin(i):i+1))];});
  writeFileSync(path.join(raw,'table.tsv'),'id\tdonor\tx\ty\n'+rows.map(r=>r.join('\t')).join('\n')+'\n');
  const input={claims:[{id:'effect',kind:'effect-exists',table:'table.tsv',estimand:'mean difference',test:'permutation test',unit:'unit_id',permutationLevel:'unit',exposure:'x',outcome:'y',direction:'greater',nullValue:0,mei:.5}],staging:{'table.tsv':{mode:design==='repeated'?'repeated-measures':'analysis-table',idColumn:'id',...(design==='repeated'?{unitColumn:'donor'}:{})}}};
  writeFileSync(path.join(work,'plan.json'),JSON.stringify(input));writeFileSync(path.join(work,'results.json'),'{"claims":[]}');writeFileSync(path.join(work,'run_all.sh'),'#!/bin/sh\nnode code/read.mjs\n');
  writeFileSync(path.join(work,'code/read.mjs'),`import fs from 'node:fs';const rows=fs.readFileSync('data/table.tsv','utf8').trim().split('\\n').slice(1).map(r=>r.split('\\t'));const mean=v=>v.reduce((s,x)=>s+x,0)/v.length;const units=[...new Set(rows.map(r=>r[4]))];const a=rows.filter(r=>r[2]==='0').map(r=>Number(r[3])),b=rows.filter(r=>r[2]==='1').map(r=>Number(r[3]));const estimate=mean(b)-mean(a);fs.writeFileSync('outputs/primary.json',JSON.stringify({claims:{effect:{estimate,n_units:units.length}}}));fs.writeFileSync('outputs/units.tsv','unit_id\\n'+units.join('\\n')+'\\n');`);
  const plan=parsePlan(input).plan!,c=plan.claims[0]!,nodeRoot=path.dirname(realpathSync(process.execPath)),executor=new api.OfflineExecutor({scratchRoot:path.join(state,'scratch'),toolPath:nodeRoot+':/usr/bin:/bin',runtimeRoots:[nodeRoot],timeoutMs:2000});
  const start=performance.now(),r=await api.certifyDirectory({workdir:work,rawDir:raw,stateRoot:state,executionId:'timing',lock:{planHash:planLockHash(plan),lockedAt:1},firstLookAt:2,now:()=>performance.now(),expectedInputHash:canonicalSha256(api.treeManifest(raw)),authority:new api.GateAuthority(Buffer.alloc(32,7)),executor,simulations:true,simulationFactory:(_id,d)=>async s=>api.linearEntry(c,{...d,...s})});
  console.log(JSON.stringify({version:process.argv[3]??'V2d',design,wallMs:performance.now()-start,jobs:r.jobs,status:r.certification.assessments[0]?.status,warnings:r.warnings.filter(w=>/unavailable|failed|deadline/.test(w))}));
 }finally{rmSync(root,{recursive:true,force:true});}
}
