/** Directed source mutation testing. Each child runs deterministic synthetic tests.
 * Only omb-report and the authorized PW0 derivation extension are changed.
 * Originals are restored in finally after EVERY mutant.
 * A load/transform error, timeout or missing test is invalid, never a killed mutant. */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const pkg=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const root=path.resolve(pkg,'../..');
interface Mutation {id:string;file:string;from:string;to:string;test:string}
const mutations:Mutation[]=JSON.parse(readFileSync(path.join(pkg,'scripts/round4-mutants.json'),'utf8'));
interface Run {ok:boolean;failed:string[];invalid:boolean;duration:number}
function run(test?:string):Run{
 const started=performance.now();const args=[path.join(root,'node_modules/vitest/vitest.mjs'),'run',test?`packages/omb-report/test/${test}.test.ts`:'packages/omb-report','--reporter=json','--maxWorkers=1','--no-file-parallelism','--no-isolate'];
 const out=spawnSync('nice',['-n','10',process.execPath,...args],{cwd:root,encoding:'utf8',timeout:15000,maxBuffer:8*1024*1024});
 try{const report=JSON.parse(out.stdout);const failed=(report.testResults??[]).flatMap((s:any)=>(s.assertionResults??[]).filter((a:any)=>a.status==='failed').map((a:any)=>a.fullName));return {ok:out.status===0&&report.numPassedTests>0&&report.numPendingTests===0&&report.numTodoTests===0,failed,invalid:!!out.error||!report.numTotalTests||out.status!==0&&!failed.length,duration:performance.now()-started};}
 catch{return {ok:false,failed:[],invalid:true,duration:performance.now()-started};}
}
const baseline=run();if(!baseline.ok)throw new Error('mutation baseline did not pass');
const results:{id:string;status:string;tests:string[];ms:number}[]=[];
const selected=process.argv.slice(2);
// Do not inflate the denominator with identical edits registered by two review lenses.
const unique=[...new Map(mutations.map(m=>[JSON.stringify([m.file,m.from,m.to]),m])).values()];
for(const m of unique.filter(m=>!selected.length||selected.some(id=>m.id.startsWith(id)))){const file=path.join(pkg,'src',m.file);const original=readFileSync(file,'utf8');if(original.split(m.from).length!==2)throw new Error(`mutation ${m.id} does not identify exactly one source site`);
 try{writeFileSync(file,original.replace(m.from,m.to));const result=run(m.test);const status=result.invalid?'invalid':result.failed.length?'killed':'survived';results.push({id:m.id,status,tests:result.failed,ms:Math.round(result.duration)});process.stdout.write(`${m.id}: ${status}\n`);}
 finally{writeFileSync(file,original);}
}
if(!results.length)throw new Error('no mutations selected');
const killed=results.filter(r=>r.status==='killed').length;const rate=killed/results.length;
const report={schema:'omb-report/mutations@4',baselineTestsPassed:true,total:results.length,killed,rate,results};
if(!selected.length)writeFileSync(path.join(pkg,'mutation-results.json'),JSON.stringify(report,null,2)+'\n');
if(!selected.length)writeFileSync(path.join(pkg,'MUTATION-KILL-TABLE.md'),`# Directed mutation results\n\n${killed}/${results.length} killed (${(rate*100).toFixed(1)}%). Invalid runs count against the denominator. Source restored after every run.\n\n| Mutation | Outcome | Killing tests |\n| --- | --- | --- |\n`+results.map(r=>`| ${r.id} | ${r.status} | ${r.tests.join('; ').replace(/\|/gu,'/')} |`).join('\n')+'\n');
if(rate<0.95||results.some(r=>r.status==='invalid'))process.exitCode=1;
