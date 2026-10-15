/** Directed source mutations. Restore the exact original bytes after each run.
 * Only assertion failures count as kills; transform errors/timeouts are invalid.
 * No process-name matching or pattern kills. */
import {readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const pkg=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),root=path.resolve(pkg,'../..');
interface Mutation {id:string;file:string;from:string;to:string;test:string}
const mutations:Mutation[]=JSON.parse(readFileSync(path.join(pkg,'scripts/mutants.json'),'utf8'));
function run(test?:string) {
 const out=spawnSync(process.execPath,[path.join(root,'node_modules/vitest/vitest.mjs'),'run',test?`packages/omb-drafter/test/${test}.test.ts`:'packages/omb-drafter','--maxWorkers=1','--no-file-parallelism','--reporter=json'],{cwd:root,encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024,env:{...process.env,PW7_WRITE_SAMPLE:'0'}});
 try {const report=JSON.parse(out.stdout);const failed=(report.testResults??[]).flatMap((r:any)=>(r.assertionResults??[]).filter((t:any)=>t.status==='failed').map((t:any)=>t.fullName));return {ok:out.status===0&&report.numPassedTests>0,failed,invalid:!!out.error||!report.numTotalTests||out.status!==0&&!failed.length};}catch{return {ok:false,failed:[],invalid:true};}
}
const baseline=run();if(!baseline.ok)throw new Error('mutation baseline failed');
const results:{id:string;status:string;tests:string[]}[]=[];
for(const m of mutations){
 const file=path.join(pkg,'src',m.file),original=readFileSync(file,'utf8');
 if(original.split(m.from).length!==2)throw new Error(`mutation ${m.id} must identify exactly one source site`);
 try{writeFileSync(file,original.replace(m.from,m.to));const r=run(m.test);const status=r.invalid?'invalid':r.failed.length?'killed':'survived';results.push({id:m.id,status,tests:r.failed});process.stdout.write(`${m.id}: ${status}\n`);}
 finally{writeFileSync(file,original);}
}
const killed=results.filter(r=>r.status==='killed').length;
writeFileSync(path.join(pkg,'mutation-results.json'),JSON.stringify({schema:'omb-drafter/mutations@1',baselinePassed:true,total:results.length,killed,rate:killed/results.length,results},null,2)+'\n');
writeFileSync(path.join(pkg,'MUTATION-KILL-TABLE.md'),`# Directed mutation results\n\n${killed}/${results.length} killed. Invalid runs count against the denominator. Source restored after every run.\n\n| Mutation | Outcome | Killing tests |\n| --- | --- | --- |\n`+results.map(r=>`| ${r.id} | ${r.status} | ${r.tests.join('; ').replace(/\|/g,'/')} |`).join('\n')+'\n');
if(killed!==results.length)process.exitCode=1;
