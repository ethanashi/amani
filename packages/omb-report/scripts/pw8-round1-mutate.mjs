import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const pkg=root+'packages/omb-report/';
const mutants=JSON.parse(readFileSync(pkg+'scripts/pw8-round1-mutants.json','utf8'));
const digest=file=>createHash('sha256').update(readFileSync(pkg+'src/'+file)).digest('hex');
const before=Object.fromEntries(mutants.map(m=>[m.file,digest(m.file)]));
function run(id){
 const start=Date.now();
 const out=spawnSync(process.execPath,[root+'node_modules/vitest/vitest.mjs','run','--config',pkg+'scripts/pw8-round1-mutation.config.mjs','--reporter=json','--maxWorkers=1','--no-file-parallelism','--no-isolate','--no-cache'],{cwd:root,env:{...process.env,PW8_ROUND1_MUTANT:id??''},encoding:'utf8',maxBuffer:32*1024*1024,timeout:60000});
 try{
  const report=JSON.parse(out.stdout);
  const failures=report.testResults.flatMap(s=>(s.assertionResults??[]).filter(a=>a.status==='failed').map(a=>a.fullName));
  const invalid=!!out.error || !report.numTotalTests || report.numPendingTests !== 0 || report.testResults.some(s=>s.status==='failed'&&!s.assertionResults?.length) || (id&&!out.stderr.includes('APPLIED '+id));
  return {id,status:invalid?'invalid':failures.length?'killed':out.status===0?'survived':'invalid',tests:failures,total:report.numTotalTests,ms:Date.now()-start};
 }catch{return {id,status:'invalid',tests:[],total:0,ms:Date.now()-start,error:out.stderr.slice(-300)}}
}
const baseline=run();if(baseline.status!=='survived')throw Error('baseline failed '+JSON.stringify(baseline));
console.log('baseline',baseline.total);
const results=[];
for(const m of mutants){const r=run(m.id);results.push(r);console.log(m.id,r.status);writeFileSync(pkg+'pw8-round1-mutation-results.json',JSON.stringify({baseline,results},null,2)+'\n');}
for(const [file,hash] of Object.entries(before))if(digest(file)!==hash)throw Error('source changed '+file);
const lines=['\n## Round 1 new-guard campaign\n',`${results.filter(r=>r.status==='killed').length}/${results.length} killed; ${baseline.total} baseline new-guard tests (review + release files). In-memory Vite transforms; source files never modified. The 170-mutant table above is historical, not a rerun claim.\n`,'| Mutant | Outcome | Killing tests (first two) |','| --- | --- | --- |',...results.map(r=>`| ${r.id} | ${r.status} | ${r.tests.slice(0,2).join('; ').replaceAll('|','/')} |`)];
const table=pkg+'PW8-MUTATION-KILL-TABLE.md';writeFileSync(table,readFileSync(table,'utf8').split('\n## Round 1 new-guard campaign')[0]+lines.join('\n')+'\n');
if(results.some(r=>r.status!=='killed'))process.exitCode=1;
