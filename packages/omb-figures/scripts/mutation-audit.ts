/** Bounded source-mutation audit. Run separately from the fast package suites.
 * Mutates only the two assigned package paths, restores every source in finally, and runs
 * complete deterministic package suites under nice. No network, sleep, process-name kill or temp dir. */
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {generateConditionMutants,type SourceMutant} from './condition-mutants.ts';
import {resolve} from 'node:path';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const figures='packages/omb-figures/',citations='packages/omb-citations/';
interface Mutant extends SourceMutant {test?:string}
const selected:Mutant[]=[
  {id:'F01 numeric half-pixel bound widened',file:'src/roundtrip.ts',from:'[px-0.5,px+0.5]',to:'[px-2,px+2]',test:'prior-art.test.ts'},
  {id:'F02 SVG hash gate removed',file:'src/roundtrip.ts',from:'if (sha256(svg) !== expected.sha256)',to:'if (false)',test:'prior-art.test.ts'},
  {id:'F03 CSV hash gate removed',file:'src/roundtrip.ts',from:'if (sha256(sourceCsv) !== expected.provenance.csvSha256)',to:'if (false)',test:'prior-art.test.ts'},
  {id:'F04 lexical read-back disabled',file:'src/roundtrip.ts',from:'if (JSON.stringify(text(a)) !== JSON.stringify(text(b)))',to:'if (false)',test:'prior-art.test.ts'},
  {id:'F05 unused display accepted',file:'src/provenance.ts',from:'if (!references.includes(item.id))',to:'if (false)',test:'prior-art.test.ts'},
  {id:'F06 dangling reference accepted',file:'src/provenance.ts',from:'if (!ids.has(ref))',to:'if (false)',test:'prior-art.test.ts'},
  {id:'F07 duplicate content accepted',file:'src/provenance.ts',from:'if (csv.has(item.csvSha256) || specs.has(item.specSha256))',to:'if (false)',test:'prior-art.test.ts'},
  {id:'F08 greyscale simulation omitted',file:'src/palette.ts',from:'"tritanopia", "greyscale"] as const',to:'"tritanopia"] as const',test:'colour.test.ts'},
  {id:'F09 deuteranopia simulation omitted',file:'src/palette.ts',from:'["protanopia", "deuteranopia", "tritanopia", "greyscale"]',to:'["protanopia", "tritanopia", "greyscale"]',test:'colour.test.ts'},
  {id:'F10 risk-table lint omitted',file:'src/lint.ts',from:"add('missing-risk-table','Kaplan–Meier requires a number-at-risk table')",to:'void 0',test:'survival.test.ts'},
  {id:'F11 confidence-band lint omitted',file:'src/lint.ts',from:"add('missing-survival-band','Kaplan–Meier requires a CI band')",to:'void 0',test:'survival.test.ts'},
  {id:'F12 product-limit arithmetic disabled',file:'src/figures/survival.ts',from:'if(Math.abs(estimate-survival.values[i]!)>1e-10)',to:'if(false)',test:'survival.test.ts'},
  {id:'F13 CONSORT exclusions ignored',file:'src/figures/flow.ts',from:'if(assessed.value-excluded.reduce((s,e)=>s+e.n.value,0)!==enrolled.value)',to:'if(false)',test:'survival.test.ts'},
  {id:'F14 CONSORT losses ignored',file:'src/figures/flow.ts',from:'if(a.allocated.value-a.lost.reduce((s,l)=>s+l.n.value,0)!==a.analysed.value)',to:'if(false)',test:'survival.test.ts'},
  {id:'F15 table reference requirement removed',file:'src/tables.ts',from:'if(v.levels.filter(l=>l.reference===true).length!==1)',to:'if(false)',test:'table-rules.test.ts'},
  {id:'F16 table test-method requirement removed',file:'src/tables.ts',from:'if(!p.method)',to:'if(false)',test:'table-rules.test.ts'},
  {id:'C01 query capability check removed',file:citations+'src/bibliography.ts',from:'!this.#queries.has(query)',to:'false',test:citations+'test/bibliography.test.ts'},
  {id:'C02 selection capability check removed',file:citations+'src/bibliography.ts',from:'!this.#selections.has(selection)',to:'false',test:citations+'test/bibliography.test.ts'},
  {id:'C03 frozen year comparison removed',file:citations+'src/bibliography.ts',from:'m.year!==frozen.year || ',to:'',test:citations+'test/bibliography.test.ts'},
  {id:'C04 post-build exact year gate removed',file:citations+'src/reference-audit.ts',from:'if(year!==m.year)',to:'if(false)',test:citations+'test/reference-audit.test.ts'},
  {id:'C05 post-build author check removed',file:citations+'src/reference-audit.ts',from:'if(JSON.stringify(authors)!==JSON.stringify(m.authors.map(fold)))',to:'if(false)',test:citations+'test/reference-audit.test.ts'},
  {id:'C06 publication cache bypass removed',file:citations+'src/reference-audit.ts',from:'client,key,undefined,true',to:'client,key,undefined,false',test:citations+'test/reference-audit.test.ts'},
];
const review = readdirSync(resolve(root,figures+'test/review-mutants')).filter(f=>f.endsWith('.json')).sort().flatMap(f=>JSON.parse(readFileSync(resolve(root,figures+'test/review-mutants/'+f),'utf8')) as Mutant[]);
const automaticFiles=[...readdirSync(resolve(root,figures+'src/figures')).filter(f=>f.endsWith('.ts')).map(f=>figures+'src/figures/'+f),...['tables.ts','roundtrip.ts','spec-lint.ts'].map(f=>figures+'src/'+f),...['bibliography.ts','api-metadata.ts','reference-audit.ts'].map(f=>citations+'src/'+f)];
const automatic=automaticFiles.flatMap(f=>generateConditionMutants(f,readFileSync(resolve(root,f),'utf8')));
const mutants:Mutant[]=[...selected,...review,...automatic];
if(new Set(mutants.map(m=>m.id)).size!==mutants.length) throw new Error("mutation IDs must be unique");

function run(test:string) {
  const result=spawnSync('nice',['-n','10',process.execPath,resolve(root,'node_modules/vitest/vitest.mjs'),'run',test,'--reporter=json'],{cwd:root,encoding:'utf8',timeout:8000,maxBuffer:4_000_000});
  if(result.error) throw result.error;
  let json:{numTotalTests:number;numFailedTests:number;testResults:{assertionResults:{status:string;failureMessages:string[]}[]}[]};
  try{json=JSON.parse(result.stdout);}catch{throw new Error('test runner did not return JSON: '+result.stderr.slice(0,400));}
  if(!json.numTotalTests) throw new Error('collection failure is not a killed mutant');
  return {result,json};
}
for(const folder of [figures,citations]) {
  const baseline=run(folder+'test');
  if(baseline.result.status!==0) throw new Error('positive baseline failed: '+folder);
}
const previous=process.argv.includes('--retest-survivors')?JSON.parse(readFileSync(resolve(root,figures+'reports/mutation-results.json'),'utf8')):null;
const requiredRanges=previous?JSON.parse(readFileSync(resolve(root,figures+'reports/round2-required-retests.json'),'utf8')).ranges as [number,number][]:[];
const mustRetest=new Set<string>(previous?previous.results.filter((r:{id:string;killed:boolean},i:number)=>!r.killed||requiredRanges.some(([lo,hi])=>i>=lo&&i<hi)).map((r:{id:string})=>r.id):[]);
const checkpoint=process.argv.includes('--resume')?JSON.parse(readFileSync(resolve(root,figures+'reports/mutation-progress.json'),'utf8')):null;
if(checkpoint && (previous || checkpoint.complete!==false || checkpoint.planned!==mutants.length || !Array.isArray(checkpoint.results) || checkpoint.results.length>mutants.length || checkpoint.results.some((r:{id:string},i:number)=>r.id!==mutants[i]!.id))) throw new Error('checkpoint must be the exact current campaign prefix');
const results:{id:string;killed:boolean;test:string;failedAssertions:number;retested?:boolean}[]=checkpoint?checkpoint.results:previous?previous.results.filter((r:{id:string})=>!mustRetest.has(r.id)):[];
const resumed=results.length, completed=new Set(results.map(r=>r.id));
for(const mutant of mutants.filter(m=>checkpoint?!completed.has(m.id):!previous || mustRetest.has(m.id))) {
  const relative=mutant.file.startsWith('packages/')?mutant.file:figures+mutant.file;
  if(!relative.startsWith(figures)&&!relative.startsWith(citations)) throw new Error('write outside assignment');
  const path=resolve(root,relative),original=readFileSync(path,'utf8');
  if(mutant.start===undefined && original.split(mutant.from).length!==2) throw new Error('mutation anchor not unique: '+mutant.id);
  const folder=relative.startsWith(figures)?figures:citations;
  const test=folder+'test';
  try {
    writeFileSync(path,mutant.start===undefined?original.replace(mutant.from,mutant.to):original.slice(0,mutant.start)+mutant.to+original.slice(mutant.end));
    const {result,json}=run(folder+'test');
    const killed=result.status!==0&&json.numFailedTests>0;
    results.push({id:mutant.id,killed,test,failedAssertions:json.numFailedTests,...(previous?{retested:true}:{})});
    process.stdout.write(`${mutant.id}: ${killed?'killed':'SURVIVED'}\n`);
  } finally {writeFileSync(path,original);}
  writeFileSync(resolve(root,figures+'reports/mutation-progress.json'),JSON.stringify({complete:false,planned:mutants.length,results},null,2)+'\n');
}
results.sort((a,b)=>mutants.findIndex(m=>m.id===a.id)-mutants.findIndex(m=>m.id===b.id));
const killed=results.filter(r=>r.killed).length,report={kind:'selected regressions plus exhaustive AST if negation, logical operand removal and ternary branches (not code coverage)',selected:selected.length,review:review.length,automatic:automatic.length,automaticFiles,initial:previous?{total:previous.total,killed:previous.killed,rate:previous.rate}:null,resumed:checkpoint?resumed:0,total:results.length,killed,rate:killed/results.length,operators:Object.fromEntries([...new Set(mutants.map(m=>m.operator??'selected'))].map(op=>{const ids=new Set(mutants.filter(m=>(m.operator??'selected')===op).map(m=>m.id));const rs=results.filter(r=>ids.has(r.id));return [op,{total:rs.length,killed:rs.filter(r=>r.killed).length}];})),mutants,results};
writeFileSync(resolve(root,figures+'reports/mutation-results.json'),JSON.stringify(report,null,2)+'\n');
writeFileSync(resolve(root,figures+'reports/MUTATION-KILL-TABLE.md'),`# Source mutation kill table\n\n${killed}/${results.length} killed (${(report.rate*100).toFixed(1)}%). Positive package baselines passed. ${selected.length} legacy selected mutants, ${review.length} review guard mutants, ${automatic.length} automatically enumerated condition, clause and ternary mutants. This is mutation evidence, not a code-coverage percentage. No generated sites filtered by results. Collection failures and timeouts are not kills. ${previous?`Previous checkpoint: ${previous.killed}/${previous.total}; all survivors and the conservatively flagged test-edit windows retested after clean package baselines.`:""}\n\n| Mutant | Outcome | Failed assertions | Test |\n| --- | --- | ---: | --- |\n`+results.map(r=>`| ${r.id} | ${r.killed?'killed':'survived'} | ${r.failedAssertions} | ${r.test} |`).join('\n')+'\n');
if(report.rate<0.95) process.exitCode=1;
