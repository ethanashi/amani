/** Re-run the original 170 guard probes against merged PW8, without modifying
 * source files. Three renamed/strengthened guard sites are reconciled in config. */
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {mutants} from './pw8-merged-mutation.config.mjs';
const root=fileURLToPath(new URL('../../../',import.meta.url)),pkg=root+'packages/omb-report/';
const digest=file=>createHash('sha256').update(readFileSync(pkg+'src/'+file)).digest('hex');
const before=Object.fromEntries(mutants.map(m=>[m.file,digest(m.file)]));
async function run(id){
 const start=Date.now();
 const p=await new Promise(resolve=>execFile('nice',['-n','15',process.execPath,root+'node_modules/vitest/vitest.mjs','run','--config',pkg+'scripts/pw8-merged-mutation.config.mjs','--reporter=json','--maxWorkers=1','--no-file-parallelism','--no-isolate','--no-cache'],{cwd:root,env:{...process.env,PW8_MERGED_MUTANT:id??''},encoding:'utf8',maxBuffer:32*1024*1024,timeout:60000},(error,stdout,stderr)=>resolve({error,stdout,stderr})));
 try{const r=JSON.parse(p.stdout),tests=r.testResults.flatMap(s=>(s.assertionResults??[]).filter(a=>a.status==='failed').map(a=>a.fullName));const invalid=!!p.error?.killed||!r.numTotalTests||r.numPendingTests!==0||r.testResults.some(s=>s.status==='failed'&&!s.assertionResults?.length)||(id&&!p.stderr.includes('APPLIED '+id));return {id,status:invalid?'invalid':tests.length?'killed':!p.error?'survived':'invalid',tests,total:r.numTotalTests,ms:Date.now()-start};}catch{return {id,status:'invalid',tests:[],total:0,ms:Date.now()-start,error:p.stderr.slice(-500)}}
}
const output=pkg+'pw8-merged-mutation-results.json',prior=process.argv.includes('--resume')?JSON.parse(readFileSync(output,'utf8')):null;
if(prior&&JSON.stringify(prior.sourceHashes)!==JSON.stringify(before))throw Error('cannot resume: product source hashes differ');
const baseline=prior?.baseline??await run();if(baseline.status!=='survived')throw Error('baseline failed '+JSON.stringify(baseline));console.log('baseline',baseline.total);
const results=prior?.results??[],done=new Set(results.map(r=>r.id)),queue=mutants.filter(m=>!done.has(m.id));let at=0;
const worker=async()=>{while(at<queue.length){const m=queue[at++],r=await run(m.id);results.push({...r,file:m.file});console.log(m.id,r.status,r.ms);results.sort((a,b)=>mutants.findIndex(m=>m.id===a.id)-mutants.findIndex(m=>m.id===b.id));writeFileSync(output,JSON.stringify({baseline,sourceHashes:before,workers:2,results},null,2)+'\n');}};
await Promise.all([worker(),worker()]);
for(const [file,hash] of Object.entries(before))if(digest(file)!==hash)throw Error('source changed '+file);
if(results.length!==mutants.length||results.some(r=>r.status!=='killed'))process.exitCode=1;
