import {round5Mutants} from './pw5-round5-mutants.ts';
import {round4Mutants} from './pw5-round4-mutants.ts';
import {round3Mutants} from './pw5-round3-mutants.ts';
/** Exhaustive syntactic guard-site inventory. No-op one call at a time, restore in finally.
 * Assertion failures are kills; compiler/load errors, missing tests and skips are invalid. */
import ts from 'typescript';
import {readFileSync,writeFileSync,existsSync,readdirSync,unlinkSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {canonicalSha256} from '../../bio-core/src/index.ts';
const pkg=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),root=path.resolve(pkg,'../..');
const files=['pw5-records.ts','matter.ts','methods.ts','checklists.ts','checklist-evidence.ts','pw5-names.ts','ai-prose.ts','ai-review.ts','pw5-evidence.ts','methods-narrative.ts'];
const sourceFiles=[...new Set([...files,...[...round3Mutants,...round4Mutants,...round5Mutants].map(m=>m[1])])];
// Write ahead of each mutation so a machine restart cannot silently leave a guard
// disabled. Recovery only overwrites the exact original/mutated bytes we recorded.
const journal=path.join(pkg,'.pw5-mutation-journal.json');
if(existsSync(journal)){
 const saved=JSON.parse(readFileSync(journal,'utf8'));
 if(!sourceFiles.includes(saved.file))throw new Error('Unexpected mutation recovery path');
 const target=path.join(pkg,'src',saved.file),current=readFileSync(target,'utf8');
 if(current!==saved.original&&current!==saved.mutated)throw new Error('Mutation source changed externally; inspect before recovery');
 writeFileSync(target,saved.original,{flush:true});unlinkSync(journal);
 process.stdout.write(`Recovered interrupted mutation ${saved.id}\n`);
}
const guards=new Set(['requireThat','exactKeys','pw5Text','pw5Hash','identifier','count','doi','evidenceInContext','assertContext','assertMethods','assertMatter','verifyProtected','date','assertVisible','checkMatterNarrative','checkPW5Covariates','checkNarrative','siteNoun','assertOwnerActor','assertMethodNarrative']);
const sites: {id:string;file:string;line:number;guard:string;start:number;end:number;source:string;replacement:string}[]=[];
for(const file of files){const source=readFileSync(path.join(pkg,'src',file),'utf8'),ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);let n=0,receipts=0,dates=0;
 const visit=(node:ts.Node)=>{if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&(guards.has(node.expression.text)||node.expression.text==='readPW5Receipt'))sites.push({id:node.expression.text==='readPW5Receipt'?`${file}:receipt${++receipts}`:node.expression.text==='date'?`${file}:date${++dates}`:`${file}:${++n}`,file,line:ast.getLineAndCharacterOfPosition(node.getStart(ast)).line+1,guard:node.expression.text,start:node.getStart(ast),end:node.end,source:node.getText(ast),replacement:node.expression.text==='readPW5Receipt'?`structuredClone(${node.arguments[1]!.getText(ast)}.record.payload)`:'(void 0)'});ts.forEachChild(node,visit);};visit(ast);
}
for(const [id,file,source,replacement] of [...round3Mutants,...round4Mutants,...round5Mutants]){const text=readFileSync(path.join(pkg,'src',file),'utf8'),start=text.indexOf(source);if(start<0||text.indexOf(source,start+source.length)>=0)throw new Error('Ambiguous/stale clause mutant '+id);sites.push({id:`clause:${id}`,file,line:text.slice(0,start).split('\n').length,guard:'clause',start,end:start+source.length,source,replacement});}
const targets=readdirSync(path.join(pkg,'test')).filter(n=>n.endsWith('.test.ts')&&(/^(?:checklists|methods|matter|pw5-round[2345])/u.test(n))).map(n=>`packages/omb-report/test/${n}`);
function run(selectedTargets=targets){const start=performance.now();const c=spawnSync('nice',['-n','10',process.execPath,path.join(root,'node_modules/vitest/vitest.mjs'),'run',...selectedTargets,'--pool=threads','--maxWorkers=1','--no-file-parallelism','--no-isolate','--reporter=json'],{cwd:root,encoding:'utf8',timeout:60000,maxBuffer:16*1024*1024});try{const r=JSON.parse(c.stdout);const assertions=r.testResults.flatMap((s:any)=>s.assertionResults);const failed=assertions.filter((a:any)=>a.status==='failed');const invalid=!!c.error||!!r.numRuntimeErrorTestSuites||!!r.unhandledErrors?.length||!r.numTotalTests||r.numPendingTests||r.numTodoTests||c.status!==0&&!failed.length||failed.some((a:any)=>a.failureMessages.some((m:string)=>/Transform failed|Parse failure|SyntaxError|Failed to load url/u.test(m)));return {status:invalid?'invalid':failed.length?'killed':'survived',count:r.numTotalTests,tests:failed.map((a:any)=>a.fullName),files:r.testResults.map((f:any)=>({path:path.relative(root,f.name),count:f.assertionResults.length,names:f.assertionResults.map((a:any)=>a.fullName)})),ms:Math.round(performance.now()-start)};}catch{return {status:'invalid',count:0,tests:[],ms:Math.round(performance.now()-start)};}}
const baseline=run();if(baseline.status!=='survived')throw new Error('Mutation baseline not green '+JSON.stringify(baseline));
const output=path.join(pkg,'pw5-all-guard-results.json');
const resume=process.argv.includes('--resume'),expression=process.argv.slice(2).find(a=>!a.startsWith('--'));
const filter=expression?new RegExp(expression):null;
const prior=existsSync(output)?JSON.parse(readFileSync(output,'utf8')).results:[];
const historyPath=path.join(pkg,'.round5-initial-guards.json');const historical=[...prior,...existsSync(historyPath)?JSON.parse(readFileSync(historyPath,'utf8')).results:[]];
const results:any[]=[];const equivalentPath=path.join(pkg,'scripts/pw5-equivalent-guards.json');const equivalents=existsSync(equivalentPath)?JSON.parse(readFileSync(equivalentPath,'utf8')):{};
for(const site of sites){const old=prior.find((r:any)=>r.id===site.id&&r.source===site.source&&r.replacement===site.replacement);if(resume&&old&&['killed','equivalent'].includes(old.status)||filter&&!filter.test(site.id)){if(old)results.push(old);continue;}
 const file=path.join(pkg,'src',site.file),original=readFileSync(file,'utf8');try{const mutated=original.slice(0,site.start)+site.replacement+original.slice(site.end);writeFileSync(journal,JSON.stringify({id:site.id,file:site.file,original,mutated})+'\n',{flush:true});writeFileSync(file,mutated);
 const historic=historical.find((r:any)=>r.id===site.id&&r.source===site.source&&r.replacement===site.replacement&&r.status==='killed')??(historical.filter((r:any)=>r.source===site.source).length===1?historical.find((r:any)=>r.source===site.source&&r.replacement===site.replacement&&r.status==='killed'):undefined);
 const killNames=new Set<string>(historic?.tests??[]);
 const matching=baseline.files?.filter((f:any)=>f.names.some((n:string)=>killNames.has(n))).map((f:any)=>f.path)??[];
 const selection=matching.length?matching.slice(0,2):(site.file.startsWith('ai-')||site.file==='methods-narrative.ts')?targets.filter(f=>/pw5-round5-(?:ai|corpus|attribution-extra|real-prose|detail)\.test/u.test(f)):targets;
 const expectedCount=baseline.files?.filter((f:any)=>selection.includes(f.path)).reduce((n:number,f:any)=>n+f.count,0);
 const r=run(selection);const status=r.count!==expectedCount?'invalid':r.status;const {files:_,...evidence}=r;results.push({...site,...evidence,selection,status});process.stdout.write(`${site.id} ${site.guard}: ${status}\n`);}finally{writeFileSync(file,original,{flush:true});if(existsSync(journal))unlinkSync(journal);}
 writeFileSync(output,JSON.stringify({schema:'pw5/all-guards@1',baseline,inventory:sites,results},null,2)+'\n');
}
for(const r of results)if(r.status==='survived'){const e=equivalents[r.id]?.source===r.source?equivalents[r.id]:r.source!=='assertContext(ctx)'?Object.values(equivalents).find((e:any)=>e.source===r.source):undefined;if(e){r.status='equivalent';r.reason=(e as any).reason;}}

const counts=Object.fromEntries(['killed','equivalent','survived','invalid'].map(s=>[s,results.filter(r=>r.status===s).length]));
const report={schema:'pw5/all-guards@1',baseline,sourceHashes:Object.fromEntries(sourceFiles.map(f=>[f,canonicalSha256(readFileSync(path.join(pkg,'src',f),'utf8'))])),inventory:sites,total:sites.length,killed:counts.killed,rate:counts.killed!/sites.length,effectiveRate:counts.killed!/(sites.length-counts.equivalent!),counts,results};writeFileSync(output,JSON.stringify(report,null,2)+'\n');
writeFileSync(path.join(pkg,'PW5-ALL-GUARDS-KILL-TABLE.md'),`# PW5 all guard-site mutations\n\n${counts.killed}/${sites.length} killed (${(100*counts.killed!/sites.length).toFixed(1)}%); ${counts.equivalent} equivalent, ${counts.survived} non-equivalent survivors, ${counts.invalid} invalid. Inventory generated from TypeScript AST, including validation helper calls. Assertion calls are replaced by void 0; receipt calls are replaced by an unchecked payload clone. Source restored in finally.\n\n| Site | Guard | Outcome | Evidence |\n| --- | --- | --- | --- |\n`+results.map(r=>`| ${r.id} (line ${r.line}) | ${r.guard} | ${r.status} | ${(r.reason??r.tests.join('; ')).replaceAll('|','/')} |`).join('\n')+'\n');
writeFileSync(path.join(pkg,'pw5-mutation-results.json'),JSON.stringify(report,null,2)+'\n');
writeFileSync(path.join(pkg,'PW5-MUTATION-KILL-TABLE.md'),readFileSync(path.join(pkg,'PW5-ALL-GUARDS-KILL-TABLE.md'),'utf8'));
if(results.length!==sites.length||counts.survived||counts.invalid)process.exitCode=1;
