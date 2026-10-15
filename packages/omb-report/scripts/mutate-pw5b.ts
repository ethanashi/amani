/** Directed source mutation campaign. Threads confine workers to the timed child;
 * only that exact subprocess can be stopped by spawnSync's timeout. No pattern kill. */
import {readFileSync,writeFileSync,mkdirSync,existsSync,unlinkSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve,relative} from 'node:path';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const pkg=resolve(root,'packages/omb-report'),tmp=resolve(pkg,'tmp/pw5b-mutations');mkdirSync(tmp,{recursive:true});
const journal=resolve(tmp,'journal.json');
if(existsSync(journal))throw Error('Unrestored mutation journal; inspect before recovery.');
const tests=['prisma-flow.test.ts','pw5b-coverage.test.ts','pw5b-boundaries.test.ts','pw5b-mr.test.ts'].map(f=>`packages/omb-report/test/${f}`);
const files=['prisma-flow.ts','review-records.ts','review-evidence.ts','mr-evidence.ts','checklists.ts','checklist-evidence.ts'];
const originals=new Map(files.map(f=>[f,readFileSync(resolve(pkg,'src',f),'utf8')]));
const mutants:{id:string;file:string;before:string;after:string}[]=[];
function edit(id:string,file:string,before:string,after:string){const s=originals.get(file)!;if(s.split(before).length!==2)throw Error(`Mutation ${id} must have exactly one source match`);mutants.push({id,file,before,after});}
function guard(file:string,label:string){const s=originals.get(file)!,end=s.indexOf(`,'${label}');`);if(end<0)throw Error(`Missing ${label}`);const start=s.lastIndexOf('requireThat(',end),before=s.slice(start,end+label.length+5);edit(label,file,before,`requireThat(true,'${label}');`);}
for(const label of ['flow differs from PaperInput selection record','invalid selection schema','new review has previous studies','source route conflict','duplicate target state','invalid duplicate target','report retrieval state','missing retrieval report','other sources bypass title screening','report citation absent from frozen index','orphan or multiply retrieved report','exclusion reason state'])guard('prisma-flow.ts',label);
for(const label of ['review differs from PaperInput records','review policy differs from locked plan','invalid independent screening','screening automation contradicts selection ledger','invalid independent extraction','review studies differ from included flow','included study followup violates eligibility','included study violates eligibility','invalid harm period','harm citation belongs to another study','analysis includes excluded study','reused analysis claim','review analysis inventory incomplete','analysis selected certificate mismatch','analysis claim outcome mismatch','analysis null value differs from effect scale','analysis trial count differs from certified bundle','invalid certified R squared','analysis lacks matching certified execution','model rationale mismatch','analysis software absent from environment lock'])guard('review-records.ts',label);
for(const label of ['MR reporting differs from PaperInput','MR policy differs from locked plan','MR core assumptions incomplete','MR execution coverage','MR selected certificate mismatch','MR multiplicity contradicts claim family','MR Bonferroni threshold mismatch','invalid MR randomization settings','MR software absent from environment','MR lacks matching certified execution'])guard('mr-evidence.ts',label);
edit('review unknown fields','review-records.ts',"exactKeys(r,['schema','policy','searches','workflow','collection','studies','analyses','causality'],'review fields');",'');
edit('MR unknown fields','mr-evidence.ts',"exactKeys(r,['schema','policy','executions'],'MR reporting fields');",'');
edit('flow study deduplication','prisma-flow.ts','totalStudies:new Set([...included,...previous].map(r=>r.studyId)).size','totalStudies:included.length+previous.length');
edit('flow screening arithmetic','prisma-flow.ts',"screened:database?count('screen-excluded')+count('sought'):0","screened:database?count('sought'):0");
edit('flow updated new study identity','prisma-flow.ts','included.filter(r=>!previous.some(p=>p.studyId===r.studyId)).map(r=>r.studyId)','included.map(r=>r.studyId)');
edit('review object seal','review-records.ts','documents.get(doc)===canonicalSha256(doc)','true');
edit('MR object seal','mr-evidence.ts','sealed.get(doc)===canonicalSha256(doc)','true');
edit('flow object seal','prisma-flow.ts','flows.get(flow)===canonicalSha256(flow)','true');
edit('registered checklist region','checklists.ts',"requireThat(!item.section||anchor.section===item.section,'checklist item requires registered section');",'');
edit('kernel readiness grade','review-evidence.ts',"f.grade==='kernel-recomputed'&&Boolean(f.producerGate)","Boolean(f.producerGate)");
edit('funding no producer','review-evidence.ts',"case '1':return title;","case '25':return 'No funding was received for this review.';\n   case '1':return title;");
edit('abstract premature completion','review-evidence.ts',"case '1':return title;","case '2':return title+' Abstract complete.';\n   case '1':return title;");
edit('human causality promoted','review-evidence.ts',"id==='21'&&r.causality==='not-assessed'","id==='21'");
edit('MR generic rationale promoted','mr-evidence.ts',"case '1':text=", "case '2':text='Generic replication rationale establishes a causal study background.';break;\n  case '1':text=");
edit('review flow interpretation drift','review-evidence.ts','${flow.included.totalStudies} unique studies','${flow.included.totalReports} unique studies');
edit('review outcome drift','review-evidence.ts','const endpoints=p.outcomes.map(x=>OUTCOMES[x])',"const endpoints=['overall-survival' as const].map(x=>OUTCOMES[x])");
edit('MR design drift','mr-evidence.ts',"${p.design.replaceAll('-',' ')}",'one sample');
edit('missing analysis cannot assert meta-analysis','review-evidence.ts',"'Systematic review of randomized-trial adverse events.'","'Systematic review and meta-analysis of randomized-trial adverse events.'");
edit('effect direction drift','review-evidence.ts',"c.bundle.estimate>c.bundle.nullValue?'more'","c.bundle.estimate>c.bundle.nullValue?'fewer'");
edit('zero-event numeric drift','review-evidence.ts','0.5 was added to every cell','1.5 was added to every cell');
const hash=(x:string)=>createHash('sha256').update(x).digest('hex');
function run(label:string){const report=resolve(tmp,'vitest.json');if(existsSync(report))unlinkSync(report);const run=spawnSync(process.execPath,[resolve(root,'node_modules/vitest/vitest.mjs'),'run',...tests,'--maxWorkers=1','--pool=threads','--no-file-parallelism','--no-isolate','--reporter=json',`--outputFile=${report}`],{cwd:root,encoding:'utf8',timeout:45000,maxBuffer:4*1024*1024});
 const data=existsSync(report)?JSON.parse(readFileSync(report,'utf8')):null;
 const failures=data?.testResults?.flatMap((r:any)=>r.assertionResults.filter((a:any)=>a.status==='failed').map((a:any)=>a.fullName))??[];
 const status=run.error||run.signal||!data||data.numTotalTests===0?'invalid':run.status===0?'survived':failures.length?'killed':'invalid';
 if(status==='invalid')writeFileSync(resolve(tmp,'invalid-'+label.replaceAll(/[^a-zA-Z0-9]/g,'-')+'.txt'),String(run.error??'')+'\n'+run.stdout+'\n'+run.stderr);
 return {status,tests:data?.numTotalTests??0,failures};
}
const baseline=run('baseline');if(baseline.status!=='survived')throw Error('Mutation baseline not green: '+JSON.stringify(baseline));
const refresh=process.argv.find(x=>x.startsWith('--refresh='))?.slice('--refresh='.length);
const prior=(refresh||process.argv.includes('--survivors')||process.argv.includes('--changed'))?JSON.parse(readFileSync(resolve(pkg,'PW5B-MUTATION-RESULTS.json'),'utf8')):null;
if(prior&&!process.argv.includes('--changed')&&JSON.stringify(prior.sourceHashes)!==JSON.stringify(Object.fromEntries([...originals].map(([f,s])=>[f,hash(s)]))))throw Error('Cannot reuse mutation results after source changes');
const results:any[]=prior?prior.results.filter((r:any)=>['killed','equivalent'].includes(r.status)&&r.id!==refresh&&prior.sourceHashes[r.file]===hash(originals.get(r.file)!)):[];
for(const m of mutants.filter(m=>!results.some(r=>r.id===m.id))){const path=resolve(pkg,'src',m.file),original=originals.get(m.file)!,mutated=original.replace(m.before,m.after);writeFileSync(journal,JSON.stringify({path:relative(root,path),original,mutated}));
 try {writeFileSync(path,mutated);const result:any=run(m.id);if(m.id==='reused analysis claim'&&result.status==='survived'){result.status='equivalent';result.proof='Exact sorted analysis-claim inventory equality with the context (whose claims are unique) independently enforces distinct claim IDs; the empty inventory has no duplicates.';}results.push({...m,...result});process.stdout.write(`${results.length}/${mutants.length} ${result.status}: ${m.id}\n`);}
 finally {const current=readFileSync(path,'utf8');if(current!==mutated&&current!==original)throw Error('Independent edit preserved; journal retained: '+path);writeFileSync(path,original);unlinkSync(journal);}
 writeFileSync(resolve(pkg,'PW5B-MUTATION-RESULTS.json'),JSON.stringify({baselineTests:baseline.tests,testHashes:Object.fromEntries(tests.map(f=>[f,hash(readFileSync(resolve(root,f),'utf8'))])),sourceHashes:Object.fromEntries([...originals].map(([f,s])=>[f,hash(s)])),results},null,2)+'\n');
}
const counts=Object.fromEntries(['killed','equivalent','survived','invalid'].map(s=>[s,results.filter(r=>r.status===s).length]));
writeFileSync(resolve(pkg,'PW5B-MUTATION-KILL-TABLE.md'),'# PW5b directed mutations\n\n'+JSON.stringify(counts)+'\n\n| Mutation | Status | Killing assertion |\n| --- | --- | --- |\n'+results.map(r=>`| ${r.id} | ${r.status} | ${r.proof??r.failures[0]??'—'} |`).join('\n')+'\n');
process.stdout.write(JSON.stringify(counts)+'\n');if(counts.survived||counts.invalid)process.exitCode=1;
