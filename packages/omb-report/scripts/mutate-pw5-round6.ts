/** Focused round-six mutations. Run serially in contained Vitest worker threads;
 * assertion failures alone count as kills. Journal recovery is byte-checked. */
import {readFileSync,writeFileSync,existsSync,unlinkSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {canonicalSha256} from '../../bio-core/src/index.ts';
const pkg=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),root=path.resolve(pkg,'../..');
const files=['ai-fuzzy.ts','ai-prose.ts','methods-narrative.ts'];
const journal=path.join(pkg,'.pw5-round6-mutation-journal.json');
if(existsSync(journal)){
 const saved=JSON.parse(readFileSync(journal,'utf8'));
 if(!files.includes(saved.file))throw Error('Unexpected recovery path');
 const file=path.join(pkg,'src',saved.file),now=readFileSync(file,'utf8');
 if(now!==saved.original&&now!==saved.mutated)throw Error('Source changed externally');
 writeFileSync(file,saved.original,{flush:true});unlinkSync(journal);
}
const mutants: [string,string,string,string][]=[
 ['fuzzy-catalog-normalization','ai-prose.ts','fuzzyNameHits(key,names.map(aiComparisonKey))','fuzzyNameHits(key,names)'],
 ['methods-reset-clause-proof','methods-narrative.ts','const priorMethodFact:boolean=methodFact;methodFact=false','const priorMethodFact:boolean=methodFact'],
 ['repeat-collapse','ai-fuzzy.ts',"s.replace(/(\\p{L})\\1+/gu,'$1')",'s'],
 ['distance-equality','ai-fuzzy.ts','if(a===b)return true','if(a===b)return false'],
 ['distance-length','ai-fuzzy.ts','if(Math.abs(a.length-b.length)>1)return false','if(false)return false'],
 ['distance-substitution','ai-fuzzy.ts','a.slice(i+1)===b.slice(i+1)','false'],
 ['distance-transposition','ai-fuzzy.ts','a[i]===b[i+1]&&a[i+1]===b[i]&&a.slice(i+2)===b.slice(i+2)','false'],
 ['distance-insertion','ai-fuzzy.ts','a.slice(i+1)===b.slice(i)','false'],
 ['distance-deletion','ai-fuzzy.ts','a.slice(i)===b.slice(i+1)','false'],
 ['distance-too-broad','ai-fuzzy.ts','if(a===b)return true','if(true)return true'],
 ['short-catalog-names','ai-fuzzy.ts','for(const target of targets){','for(const target of targets.filter(t=>t.raw.length>=5)){'],
 ['candidate-min-length','ai-fuzzy.ts','if(candidate.length<5)continue','if(false)continue'],
 ['candidate-collapse','ai-fuzzy.ts','withinOneEdit(repeated(candidate),target.folded)','withinOneEdit(candidate,target.folded)'],
 ['catalog-collapse','ai-fuzzy.ts','folded:repeated(compact(name))','folded:compact(name)'],
 ['exact-name-exception','ai-fuzzy.ts','if(candidate===target.raw)continue','if(false)continue'],
 ['word-boundaries','ai-fuzzy.ts',"/[\\p{L}\\p{N}]+/gu","/[\\p{L}\\p{N}]/gu"],
 ['separator-windows','ai-fuzzy.ts','j<tokens.length&&j<i+64','j<tokens.length&&j<i+1'],
 ['long-padding','ai-fuzzy.ts','if(repeated(candidate).length>maxLength)break','if(candidate.length>maxLength)break'],
 ['fuzzy-match-gate','ai-fuzzy.ts','if(withinOneEdit(repeated(candidate),target.folded))','if(false)'],
 ['fuzzy-attribution','ai-prose.ts','!attribution.test(sentence)&&!passive','!passive'],
 ['fuzzy-passive','ai-prose.ts','!attribution.test(sentence)&&!passive','!attribution.test(sentence)'],
 ['fuzzy-flag','ai-prose.ts',"reasons.add('possible-ai-name:'+aiComparisonKey(hit.name))",'(void 0)'],
 ['fuzzy-homonym','ai-prose.ts','if(scientific(hit.name,repaired,key))continue','if(false)continue'],
 ['fuzzy-homonym-repair','ai-prose.ts','scientific(hit.name,repaired,key)','scientific(hit.name,sentence,key)'],
 ['fuzzy-restores-work-list','ai-prose.ts','!attribution.test(sentence)&&!passive','!(attribution.test(sentence)&&work.test(sentence))&&!passive'],
 ['methods-verb-gate','methods-narrative.ts','for(const text of aiComparisonKey(canonicalText(prose)).split','if(factual.test(text))for(const text of aiComparisonKey(canonicalText(prose)).split'],
 ['methods-negation','methods-narrative.ts',"negative=/\\b(?:not|never|without)\\b|\\bno (?:missing values|imputation)\\b/u.test(text)",'negative=false'],
 ['methods-clause-negation','methods-narrative.ts',"/[.!?;]|\\b(?:but|whereas|and)\\b/u",'/[.!?;]/u'],
 ['methods-uncertainty','methods-narrative.ts','if((technique||impliedImputation)&&uncertain)','if(false)'],
 ['methods-uncertainty-flag','methods-narrative.ts',"reasons.add('methods-unrecorded:uncertain-technique')",'(void 0)'],
 ['methods-implied-missing','methods-narrative.ts',"/\\bmissing\\b/u.test(text)&&/\\bestimated values\\b/u.test(text)",'false'],
 ['methods-implied-incomplete','methods-narrative.ts',"/\\bincomplete\\b/u.test(text)&&/\\bfilled in\\b/u.test(text)",'false'],
 ['methods-imputation','methods-narrative.ts',"if(/\\b(?:imput\\w*|chained equations|mice)\\b/u.test(text)||impliedImputation)",'if(false)'],
 ['methods-complete-records','methods-narrative.ts','complete.cases?|complete.records?|complete.case analysis','complete.cases?|complete.case analysis'],
 ['methods-comparison','methods-narrative.ts','negated?observed!==expected:observed===expected','true'],
 ['methods-unknown-flag','methods-narrative.ts',"reasons.add('methods-unrecorded:'+category)",'(void 0)'],
 ['methods-unknown-technique','methods-narrative.ts','technique||impliedImputation||factual.test(text)','false||impliedImputation||factual.test(text)'],
 ['methods-unknown-detail','methods-narrative.ts',"reasons.add('methods-unrecorded:detail')",'(void 0)'],
 ['methods-no-missing-policy','methods-narrative.ts',"compare('missing-data','no-missing-values',policy['missing-data'],false)","compare('missing-data','no-missing-values',policy['missing-data'])"],
 ['methods-negative-feature','methods-narrative.ts',"negative||/\\bno\\b/u.test(text)?'none'","/\\bno\\b/u.test(text)?'none'"],
 ['methods-preserve-earlier-proof','methods-narrative.ts','methodFact=methodFact||priorMethodFact','methodFact=methodFact'],
];
const targets=['pw5-round6-ai.test.ts','pw5-round6-methods.test.ts'].map(n=>'packages/omb-report/test/'+n);
function run(){const started=performance.now();const c=spawnSync('nice',['-n','10',process.execPath,path.join(root,'node_modules/vitest/vitest.mjs'),'run',...targets,'--pool=threads','--maxWorkers=1','--no-file-parallelism','--no-isolate','--reporter=json'],{cwd:root,encoding:'utf8',timeout:60000,maxBuffer:16*1024*1024});try{
 const r=JSON.parse(c.stdout),assertions=r.testResults.flatMap((f:any)=>f.assertionResults),failed=assertions.filter((a:any)=>a.status==='failed');
 const invalid=c.error||r.numRuntimeErrorTestSuites||r.unhandledErrors?.length||!r.numTotalTests||r.numPendingTests||r.numTodoTests||c.status!==0&&!failed.length||failed.some((a:any)=>a.failureMessages.some((m:string)=>/Transform failed|Parse failure|SyntaxError|Failed to load url/u.test(m)));
 return {status:invalid?'invalid':failed.length?'killed':'survived',count:r.numTotalTests,tests:failed.map((a:any)=>a.fullName),ms:Math.round(performance.now()-started)};
 }catch{return {status:'invalid',count:0,tests:[],ms:Math.round(performance.now()-started)};}}
const baseline=run();if(baseline.status!=='survived')throw Error('Baseline not green: '+JSON.stringify(baseline));
const output=path.join(pkg,'PW5-FIX6-MUTATIONS.json');const prior=process.argv.includes('--resume')&&existsSync(output)?JSON.parse(readFileSync(output,'utf8')).results:[];
const results:any[]=[];
for(const [id,name,source,replacement] of mutants){
 const file=path.join(pkg,'src',name),original=readFileSync(file,'utf8'),start=original.indexOf(source);
 if(start<0||original.indexOf(source,start+source.length)>=0)throw Error('Stale/ambiguous mutant '+id);
 const old=prior.find((r:any)=>r.id===id&&r.source===source&&r.replacement===replacement&&r.status==='killed');if(old){results.push(old);continue;}
 try{const mutated=original.slice(0,start)+replacement+original.slice(start+source.length);writeFileSync(journal,JSON.stringify({id,file:name,original,mutated}),{flush:true});writeFileSync(file,mutated);const result=run();if(result.count!==baseline.count)result.status='invalid';results.push({id,file:name,source,replacement,...result});process.stdout.write(`${id}: ${result.status}\n`);}
 finally{writeFileSync(file,original,{flush:true});unlinkSync(journal);}
 writeFileSync(output,JSON.stringify({baseline,results},null,2)+'\n');
}
const equivalent:Record<string,string>={
 'distance-length':'The subsequent one-edit suffix comparisons cannot return true when lengths differ by more than one. This early return only avoids work.',
 'exact-name-exception':'The production caller already checks every exact name before fuzzy matching. An exact name either refused there or satisfies the same sentence-local scientific exception in the fuzzy path; skipping it avoids duplicate work.',
};
for(const r of results)if(r.status==='survived'&&equivalent[r.id]){r.status='equivalent';r.reason=equivalent[r.id];}
const counts=Object.fromEntries(['killed','equivalent','survived','invalid'].map(s=>[s,results.filter(r=>r.status===s).length]));
writeFileSync(output,JSON.stringify({baseline,counts,sourceHashes:Object.fromEntries(files.map(f=>[f,canonicalSha256(readFileSync(path.join(pkg,'src',f),'utf8'))])),results},null,2)+'\n');
writeFileSync(path.join(pkg,'PW5-FIX6-KILL-TABLE.md'),`# Round 6 targeted mutation table\n\n${counts.killed}/${results.length} killed; ${counts.equivalent} equivalent; ${counts.survived} survivors; ${counts.invalid} invalid. This supplements, rather than re-labels, the historical round-5 audit.\n\n| Mutation | Status | Failing tests |\n| --- | --- | --- |\n`+results.map(r=>`| ${r.id} | ${r.status} | ${(r.reason??r.tests.join('; ')).replaceAll('|','/')} |`).join('\n')+'\n');
if(counts.survived||counts.invalid)process.exitCode=1;
