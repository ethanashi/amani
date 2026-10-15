import { readFileSync,writeFileSync } from 'node:fs';
import { spawnSync,execFileSync } from 'node:child_process';
const regression='packages/omb-certify/test/v2d-regressions.test.ts';
const mutations:[string,string,(source:string)=>string,string,string][]=[
 ['R1 value normalization','packages/omb-certify/src/identity.ts',s=>s.replace(/return casefold\([^\n]+;/,'return value;'),regression,'canonical identity'],
 ['R1 content identity','packages/omb-certify/src/identity.ts',s=>s.replace('return t.header.flatMap','return []; return t.header.flatMap'),regression,'arbitrary biological ID|content identity survives'],
 ['R1 cross-table links','packages/omb-certify/src/identity.ts',s=>s.replace('  const index=new Map<string,{table:string;unit:string}[]>();','  return; const index=new Map<string,{table:string;unit:string}[]>();'),regression,'split manifest|TCGA barcode|cross-table values'],
 ['R2 stable permutation','packages/omb-certify/src/paired.ts',()=>execFileSync('git',['show','2a07946:packages/omb-certify/src/paired.ts'],{encoding:'utf8'}),regression,'constant 1000000'],
 ['R2 outcome magnitude','packages/omb-certify/src/permutation.ts',s=>s.replace('const outcomeScale=Math.max(...centeredY.map(Math.abs))||1;', 'const outcomeScale=1;'),regression,'invariant to outcome magnitude'],
 ['R2 numeric tolerance','packages/omb-certify/src/numeric.ts',s=>s.replace('  if(!Number.isFinite(reported)', '  return Math.abs(reported-trusted)<=1e-8*Math.max(1,Math.abs(trusted));\n  if(!Number.isFinite(reported)'),regression,'display precision|tiny-forgery'],
 ['R3 assumption cap','packages/omb-certify/src/certify.ts',s=>s.replace("...(result.guarantee.startsWith('model-based')?[result.guarantee]:[])",'...[]'),regression,'repeated null'],
 ['R3 null stress','packages/omb-certify/src/producers.ts',s=>s.replace('    // Stress the weak mean null',"    return nullData(data,'labels',seed);\n    // Stress the weak mean null"),regression,'G5a twins'],
 ['R4 skill and support','packages/omb-certify/src/performance.ts',()=>execFileSync('git',['show','2a07946:packages/omb-certify/src/performance.ts'],{encoding:'utf8'}),regression,'rare-event|shuffled predictions'],
 ['R4 unavailable randomization','packages/omb-certify/src/certify.ts',s=>s.replace(/const skillRan=Boolean[^\n]+;/,'const skillRan=true;'),regression,'unavailable rare-event randomization'],
 ['R5 duplicate facts','packages/omb-certify/src/stage.ts',s=>s.replace(/const integrityFindings=contentFindings[^\n]+;/,'const integrityFindings: import(\'./identity.ts\').DuplicateFinding[]=[];'),regression,'guard: duplicate|guard: near'],
 ['R6 method verification','packages/omb-certify/src/integrity.ts',()=>execFileSync('git',['show','2a07946:packages/omb-certify/src/integrity.ts'],{encoding:'utf8'}),regression,'honest.*p accepted'],
 ['R7 fresh census','packages/omb-certify/src/native/reap-sandbox.c',()=>execFileSync('git',['show','2a07946:packages/omb-certify/src/native/reap-sandbox.c'],{encoding:'utf8'}),'packages/omb-certify/test/v2d-runtime.test.ts','fresh census'],
 ['R7 cooperative fresh pass','packages/omb-certify/src/native/reap-sandbox.c',s=>s.replace(/    if\(unresolved\)\{double remaining[^\n]+/,'    /* no cooperative pass */'),'packages/omb-certify/test/v2d-runtime.test.ts','fresh census'],
 ['R8 executor deadline dependency','packages/omb-certify/src/execution.ts',s=>s.replace('(this.options.runner??runProcess)','runProcess'),'packages/omb-certify/test/execution.test.ts','R8 executor deadline'],
 ['R8 deadline scheduler','packages/omb-adapters/src/process.ts',s=>s.replace('hooks.scheduleDeadline?hooks.scheduleDeadline','false?hooks.scheduleDeadline!'),'packages/omb-adapters/test/process.test.ts','injected deadline'],
];
const results=[];
for(const [guard,file,mutate,test,pattern] of mutations){
 const original=readFileSync(file,'utf8'),changed=mutate(original);if(original===changed)throw new Error('mutation not applied: '+guard);
 try{writeFileSync(file,changed);const r=spawnSync('node_modules/.bin/vitest',['run',test,'--maxWorkers=1','-t',pattern],{encoding:'utf8',timeout:60_000,maxBuffer:5_000_000});const output=r.stdout+r.stderr;
  const caught=r.status!==0&&/FAIL /.test(output)&&!output.includes('Transform failed');results.push({guard,caught,exit:r.status,failures:output.split('\n').filter(l=>l.startsWith(' FAIL ')||l.startsWith('AssertionError:')||l.startsWith('TypeError:'))});console.log(JSON.stringify(results.at(-1)));if(!caught)throw new Error('guard mutation escaped: '+guard);
 }finally{writeFileSync(file,original);writeFileSync('packages/omb-certify/calibration/mutation-results.json',JSON.stringify(results,null,2)+'\n');}
}
