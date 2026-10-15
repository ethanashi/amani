/** PW6 mutation audit (repo practice: mutate.ts, PW5's AST guard inventory).
 * Operators, applied one at a time to the PW6 sources:
 *  1. guard site: every requireThat / assertContext / assertTermRegistry /
 *     assertPlainEasierThanAbstract call replaced by `void 0` (AST inventory);
 *  2. conjunct/disjunct: each operand of a top-level && (|| ) chain inside a
 *     requireThat condition replaced by true (false);
 *  3. directed edits of boundaries, constants and non-guard branches (pw6-mutants.ts).
 * Each mutant runs the PW6 test files. An assertion failure is a kill; a load error,
 * a timeout or a run with no tests is invalid, never a kill. Every source is restored
 * in finally; a write-ahead journal restores an interrupted run on the next start. */
import ts from 'typescript';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { directed } from './pw6-mutants.ts';

const pkg=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),root=path.resolve(pkg,'../..');
const FILES=['glossary.ts','acronyms.ts','readability.ts','boxes.ts','comprehension.ts','human-check.ts'];
const GUARDS=new Set(['requireThat','assertContext','assertTermRegistry','assertPlainEasierThanAbstract']);
const journal=path.join(pkg,'.pw6-mutation-journal.json');
if(existsSync(journal)){
 const saved=JSON.parse(readFileSync(journal,'utf8'));const target=path.join(pkg,'src',saved.file);
 if(![...FILES,'render.ts','prose.ts','limitations.ts','templates.ts'].includes(saved.file))throw new Error('unexpected mutation recovery path');
 const current=readFileSync(target,'utf8');if(current!==saved.original&&current!==saved.mutated)throw new Error('mutated source changed externally; inspect before recovery');
 writeFileSync(target,saved.original,{flush:true});unlinkSync(journal);process.stdout.write(`recovered interrupted mutation ${saved.id}\n`);
}
// Refresh is conservative: repeat every non-kill, every changed-source mutant and
// every new mutant. Retain kills only with identical sources and append-only tests.
const refresh=process.argv.includes('--refresh');
const previous=refresh?JSON.parse(readFileSync(path.join(pkg,'pw6-mutation-results.json'),'utf8')):null;
const digest=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const sourceHashes=Object.fromEntries([...new Set([...FILES,...directed.map(d=>d.file)])].map(file=>[file,digest(readFileSync(path.join(pkg,'src',file)))]));
const testPrefixes=Object.fromEntries(readdirSync(path.join(pkg,'test')).filter(f=>f.startsWith('pw6-')&&f.endsWith('.ts')).map(file=>{
 const target=path.join(pkg,'test',file),bytes=readFileSync(target);return [path.relative(root,target),{bytes:bytes.length,sha256:digest(bytes)}];
}));
if(refresh){
 if(!previous.sourceHashes||!previous.testPrefixes)throw new Error('refresh needs a fingerprinted full audit');
 for(const [file,prefix] of Object.entries(previous.testPrefixes) as [string,{bytes:number;sha256:string}][]){
  if(digest(readFileSync(path.join(root,file)).subarray(0,prefix.bytes))!==prefix.sha256)throw new Error(`existing tests changed: run a full audit (${file})`);
 }
}
interface Mutant {id:string;file:string;start:number;end:number;to:string;from:string}
const mutants:Mutant[]=[];
for(const file of FILES){
 const text=readFileSync(path.join(pkg,'src',file),'utf8');const source=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true);
 const line=(pos:number)=>source.getLineAndCharacterOfPosition(pos).line+1;
 const visit=(node:ts.Node):void=>{
  if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&GUARDS.has(node.expression.text)){
   const start=node.getStart(source),end=node.getEnd();
   mutants.push({id:`${file}:${line(start)}:site:${node.expression.text}`,file,start,end,to:'void 0',from:text.slice(start,end)});
   const condition=node.arguments[0];
   if(node.expression.text==='requireThat'&&condition&&ts.isBinaryExpression(condition)){
    const op=condition.operatorToken.kind;
    if(op===ts.SyntaxKind.AmpersandAmpersandToken||op===ts.SyntaxKind.BarBarToken){
     const operands:ts.Expression[]=[];const flatten=(e:ts.Expression):void=>{if(ts.isBinaryExpression(e)&&e.operatorToken.kind===op){flatten(e.left);flatten(e.right);}else operands.push(e);};flatten(condition);
     operands.forEach((o,i)=>{const s=o.getStart(source),e=o.getEnd();mutants.push({id:`${file}:${line(s)}:${op===ts.SyntaxKind.AmpersandAmpersandToken?'and':'or'}:${i}`,file,start:s,end:e,to:op===ts.SyntaxKind.AmpersandAmpersandToken?'true':'false',from:text.slice(s,e)});});
    }
   }
  }
  ts.forEachChild(node,visit);
 };
 visit(source);
}
for(const d of directed){
 const text=readFileSync(path.join(pkg,'src',d.file),'utf8');const at=text.indexOf(d.from);
 if(at<0||text.indexOf(d.from,at+1)>=0)throw new Error(`directed mutant ${d.id} does not identify exactly one source site`);
 mutants.push({id:`directed:${d.id}`,file:d.file,start:at,end:at+d.from.length,to:d.to,from:d.from});
}
interface Run {ok:boolean;failed:string[];invalid:boolean;ms:number}
function run():Run{
 const started=performance.now();
 const out=spawnSync('nice',['-n','10',process.execPath,path.join(root,'node_modules/vitest/vitest.mjs'),'run','packages/omb-report/test/pw6-','--reporter=json','--maxWorkers=1','--no-file-parallelism','--no-isolate'],{cwd:root,encoding:'utf8',timeout:120000,maxBuffer:32*1024*1024});
 try{const report=JSON.parse(out.stdout);const failed=(report.testResults??[]).flatMap((s:any)=>(s.assertionResults??[]).filter((a:any)=>a.status==='failed').map((a:any)=>a.fullName));
  const loadErrors=(report.testResults??[]).some((s:any)=>s.status==='failed'&&!(s.assertionResults??[]).length);
  return {ok:out.status===0&&report.numPassedTests>0&&!report.numPendingTests&&!report.numTodoTests,failed,invalid:!!out.error||!report.numTotalTests||loadErrors||out.status!==0&&!failed.length,ms:Math.round(performance.now()-started)};}
 catch{return {ok:false,failed:[],invalid:true,ms:Math.round(performance.now()-started)};}
}
const baseline=run();if(!baseline.ok)throw new Error('PW6 mutation baseline did not pass');
const selected=process.argv.slice(2).filter(arg=>arg!=='--refresh');
if(refresh&&selected.length)throw new Error('refresh cannot be combined with filters');
const results:{id:string;status:'killed'|'survived'|'invalid';from:string;to:string;tests:string[];ms:number}[]=[];
const priorKey=(r:{id:string;from:string;to:string})=>JSON.stringify([r.id,r.from.slice(0,160),r.to]);
const priorBuckets=new Map<string,typeof results>();let retainedKills=0;
for(const r of previous?.results??[]){const k=priorKey(r);priorBuckets.set(k,[...priorBuckets.get(k)??[],r]);}
for(const m of mutants.filter(m=>!selected.length||selected.some(s=>m.id.includes(s)))){
 const prior=priorBuckets.get(priorKey(m))?.shift();
 if(refresh&&prior?.status==='killed'&&previous.sourceHashes[m.file]===sourceHashes[m.file]){results.push(prior);retainedKills++;continue;}

 const file=path.join(pkg,'src',m.file);const original=readFileSync(file,'utf8');
 if(original.slice(m.start,m.end)!==m.from)throw new Error(`mutant ${m.id} no longer matches its source`);
 const mutated=original.slice(0,m.start)+m.to+original.slice(m.end);
 writeFileSync(journal,JSON.stringify({id:m.id,file:m.file,original,mutated}),{flush:true});
 try{writeFileSync(file,mutated,{flush:true});const r=run();const status=r.invalid?'invalid':r.failed.length?'killed':'survived';results.push({id:m.id,status,from:m.from.slice(0,160),to:m.to,tests:r.failed.slice(0,3),ms:r.ms});process.stdout.write(`${m.id}: ${status}\n`);}
 finally{writeFileSync(file,original,{flush:true});unlinkSync(journal);}
}
const equivalents:Record<string,string>=JSON.parse(readFileSync(path.join(pkg,'scripts/pw6-equivalent-mutants.json'),'utf8'));
const survived=results.filter(r=>r.status==='survived');const unexplained=survived.filter(r=>!equivalents[r.id]);
const invalid=results.filter(r=>r.status==='invalid');const killed=results.filter(r=>r.status==='killed').length;
const summary={schema:'omb-report/pw6-mutations@1',baselineTestsPassed:true,retainedKills,executed:results.length-retainedKills,total:results.length,killed,survived:survived.length,equivalent:survived.length-unexplained.length,unexplained:unexplained.length,invalid:invalid.length,
 killRate:results.length?killed/results.length:0,killRateExcludingEquivalent:results.length?killed/(results.length-(survived.length-unexplained.length)):0};
if(!selected.length){
 writeFileSync(path.join(pkg,'pw6-mutation-results.json'),JSON.stringify({...summary,sourceHashes,testPrefixes,results},null,1)+'\n');
 const cell=(t:string)=>t.replace(/\|/gu,'\\|').replace(/\n/gu,' ');
 writeFileSync(path.join(pkg,'PW6-MUTATION-KILL-TABLE.md'),`# PW6 mutation results\n\n${killed}/${results.length} killed; ${summary.equivalent} documented equivalent survivors; ${summary.unexplained} unexplained survivors; ${summary.invalid} invalid. Invalid runs count against the denominator. Source restored after every run.\n\n| Mutant | Outcome | Edit | First killing tests or equivalence reason |\n| --- | --- | --- | --- |\n`+results.map(r=>`| ${cell(r.id)} | ${r.status} | \`${cell(r.from.slice(0,70))}\` → \`${cell(r.to)}\` | ${cell(r.status==='survived'?`equivalent: ${equivalents[r.id]??'UNEXPLAINED'}`:r.tests.join('; '))} |`).join('\n')+'\n');
}
process.stdout.write(JSON.stringify(summary)+'\n');
if(unexplained.length||invalid.length)process.exitCode=1;
