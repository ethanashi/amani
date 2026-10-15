/** Build retrospective blind reading papers from the owner's retired run archive.
 * Usage: nice -n 10 node --experimental-transform-types scripts/replications/build-papers.ts SOURCE_ROOT [3|4|1|2|5]
 * SOURCE_ROOT is explicit. Historical absolute paths in records are never opened. */
import path from 'node:path';
import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync,existsSync,readdirSync,lstatSync,copyFileSync,renameSync} from 'node:fs';
import {canonicalSha256} from '../../packages/bio-core/src/index.ts';
import {readInvestigationJournal} from '../../packages/omb-paper/src/sqlite-journal.ts';
import {archivePhaseOutputs} from '../../packages/omb-paper/src/archived-journal.ts';
import {treeHash,treeHashes} from '../../packages/omb-investigate/src/bundle.ts';
import {loadTask} from '../../packages/omb-amani/src/task.ts';
import {archivePaperInput,buildArchivePaper,archivePublicValue} from '../../packages/omb-report/src/archived-paper.ts';
import {renderArchivePaper} from '../../packages/omb-package/src/archived-paper.ts';
import {CodexAdapter} from '../../packages/omb-adapters/src/codex.ts';
import {WORKER_SCHEMAS} from '../../packages/omb-investigate/src/turns.ts';
import {DraftRuntime} from '../../packages/omb-drafter/src/runtime.ts';
import {command} from '../../packages/omb-package/src/toolchain.ts';
import {homedir} from 'node:os';
const src=path.resolve(process.argv[2]!);if(!existsSync(src))throw Error('explicit source archive required');
const selected=process.argv[3]?Number(process.argv[3]):null;
const slugs:Record<number,string>={3:'infliximab-response',4:'factor-xi',1:'gpnmb-parkinsons',2:'muscle-splicing',5:'batch-adjustment'};
const rawSha=(b:Uint8Array|string)=>createHash('sha256').update(b).digest('hex');
const read=(p:string)=>JSON.parse(readFileSync(p,'utf8'));
const logRoot=path.resolve('../_logs/replications');mkdirSync(logRoot,{recursive:true});
for(const i of [3,4,1,2,5].filter(i=>selected===null||selected===i)){
 const run=path.join(src,'runs',({2:'tierb-c2-r2',4:'tierb-c4-r2'} as Record<number,string>)[i]??`tierb-c${i}`);
 const root=path.join(run,'attempt/.amani');
 const journalFile=path.join(root,'journal.sqlite');const events=readInvestigationJournal(journalFile,'amani-investigation');
 const phases=archivePhaseOutputs(events);
 const generation=/\/(replan-\d+)\/frozen\//u.exec(phases.get('freeze')!.frozen.dir)?.[1];
 const host=path.join(root,'host/amani-investigation',generation??'');
 const frozen=path.join(host,'frozen',path.basename(phases.get('freeze')!.frozen.dir));if(treeHash(frozen)!==phases.get('freeze')!.frozen.hash)throw Error('frozen bundle differs');
 const outputs=path.join(host,'outputs/look-1');const outputHashes:Record<string,string>={};
 for(const name of readdirSync(outputs).sort()){const f=path.join(outputs,name);if(!lstatSync(f).isFile())throw Error('non-regular archived output');const b=readFileSync(f);outputHashes[name]=canonicalSha256(name.endsWith('.json')?b.toString('utf8'):[...b]);}
 if(canonicalSha256(outputHashes)!==phases.get('look').final.outputsHash)throw Error('look output snapshot differs');
 for(const [name,hash] of Object.entries(phases.get('deliverable').files)){if(path.basename(name)!==name||rawSha(readFileSync(path.join(host,'deliverable',name)))!==hash)throw Error('deliverable differs');}
 const task=loadTask(path.join(run,'served'),'card');const report=read(path.join(run,'attempt/report.json'));
 const grade=read(path.join(run,'grade.json')),criteria=read(path.join(src,'cards',`tierb-c${i}`,'criteria.json'));
 const passed=new Set(grade.criteria.filter((c:any)=>c.passed).map((c:any)=>c.name));
 // Long identifier sets remain in the evaluated report; prose uses the successful
 // scalar findings and short identifier sets, without a model choosing new facts.
 const paths=criteria.filter((c:any)=>passed.has(c.name)).map((c:any)=>c.report).filter((p:string)=>{
  let v=report;for(const k of p.slice(1).split('/'))v=v?.[k];return v!==null&&v!==undefined&&(!Array.isArray(v)||v.length<=10);
 });
 const plan=archivePublicValue(read(path.join(frozen,'plan.json')));
 const certification=phases.get('replicate')?.certification??phases.get('certify').certification;
 const code=Object.keys(treeHashes(frozen)).filter(n=>/\.(?:py|mjs|js|r|R|sh)$/u.test(n)).map(name=>({name,source:archivePublicValue(readFileSync(path.join(frozen,name),'utf8')) as string}));
 const input=archivePaperInput({question:task.prompt.split('\n## Files')[0]!,plan,execution:{completedLook:true,outputSnapshotHash:phases.get('look').final.outputsHash,code},report,paths,claims:phases.get('deliverable').claims.map((c:any)=>({claimId:c.claimId,status:c.status})),provenance:{journalSha256:rawSha(readFileSync(journalFile)),reportSha256:canonicalSha256(report),planSha256:canonicalSha256(plan),certificationSha256:canonicalSha256(certification)}});
 const out=path.resolve('examples/replications',slugs[i]!);mkdirSync(out,{recursive:true});
 const draftFile=path.join(out,'narrative.json');
 if(existsSync(draftFile)&&existsSync(path.join(out,'paper-input.json'))&&read(path.join(out,'paper-input.json')).sha256!==input.sha256)renameSync(draftFile,path.join(logRoot,`c${i}-superseded-narrative-${Date.now()}.json`));
 writeFileSync(path.join(out,'paper-input.json'),JSON.stringify(input,null,2)+'\n');
 // Publication sidecars contain no historical filesystem paths or worker keys.
 writeFileSync(path.join(out,'grade.json'),JSON.stringify({case:`c${i}`,passed:grade.passed,total:grade.total,criteria:grade.criteria},null,2)+'\n');
 writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
 writeFileSync(path.join(out,'TASK.md'),task.taskText??task.prompt);
 if(!existsSync(draftFile)){
  const work=path.join(logRoot,`c${i}-draft-${Date.now()}`);mkdirSync(work,{recursive:true});
  const codex=new CodexAdapter({stateRoot:path.join(work,'codex-state'),scratchRoot:path.join(work,'codex-scratch'),cliPath:'/opt/homebrew/bin/codex',authFile:path.join(homedir(),'.codex/auth.json'),now:Date.now,schemas:WORKER_SCHEMAS});
  const unavailable={schemas:WORKER_SCHEMAS,async run():Promise<never>{throw Error('cross-family manuscript review pending');}};
  const runtime=new DraftRuntime(path.join(work,'turns'),{codex,claude:unavailable},{maxCalls:5,maxTokens:80000,maxDurationMs:1200000,maxOutputBytes:2000000});
  const instruction='Write a journal-style reading preprint about this archived blind investigation. Return exactly a JSON object with six string fields: title, abstract, introduction, methods, results, discussion. Aim for a substantial concise scientific manuscript, about twelve hundred words in total. Preserve the disguised names and do not identify or guess the real study, diseases, genes, institutions or sources. Use only supplied facts and frozen methods, never invent experiments, checks, uncertainty intervals or successful replication. The task and plan are records of what was asked and planned; distinguish them from reported results. Numeric findings MUST use slots of the form [[/json/pointer]] matching a supplied fact pointer exactly; never type any numbers or number words as measurements. Digit-bearing identifiers such as P7 or C10 are allowed only if present in the task/plan. Do not use markdown, TeX, URLs, square brackets except fact slots, or angle brackets. The title should use words, no fact slots. Explain what the actual findings mean, including design or interpretation issues supported by those facts. Do not give findings absent from the supplied facts. Do not refer to grading or the original identity. Native scientific labels must not be upgraded; a separate software provenance notice preserves them. Manuscript review and endorsement remain pending. Write polished flowing scientific prose, with blank lines between paragraphs. Avoid repeating the same result in every section.';
  try{const result=await runtime.call('archived-blind-manuscript',{family:'codex',model:process.env.OMB_CODEX_MODEL??'gpt-6-astra',effort:'high'},instruction+' The execution record verifies a completed real-data look and supplies the frozen executed analysis code. Describe completed computational methods when supported by that code and the supplied result facts. Write confidently and factually. The abstract must report the principal numerical findings with fact slots. Keep certification status and pending endorsement in the software provenance notice, without repeating caveat paragraphs throughout the paper.',input);if(result.kind!=='output')throw Error('draft refused');buildArchivePaper(input,result.value);writeFileSync(draftFile,JSON.stringify(result.value,null,2)+'\n');}
  finally{writeFileSync(path.join(work,'usage.json'),JSON.stringify({usage:runtime.usage,records:runtime.records},null,2)+'\n');}
  writeFileSync(path.join(out,'drafter-provenance.json'),JSON.stringify({schema:'omb/archive-drafter-provenance@1',inputHash:input.sha256,usage:runtime.usage,calls:runtime.records.map(r=>({phase:r.phase,model:r.model,promptHash:r.promptHash,outputHash:r.outputHash,observedModels:r.result.provenance.observedModels,usage:r.result.usage})),crossFamilyReview:'pending',ownerEndorsement:'pending'},null,2)+'\n');
 }
 const paper=buildArchivePaper(input,read(draftFile));writeFileSync(path.join(out,'manuscript.json'),JSON.stringify(paper,null,2)+'\n');
 writeFileSync(path.join(out,'paper.md'),'# '+paper.title+'\n\n'+paper.sections.map(s=>'## '+s.heading+'\n\n'+s.paragraphs.join('\n\n')).join('\n\n')+'\n');
 const render=path.join(logRoot,`c${i}-render-${Date.now()}`);const result=await renderArchivePaper(paper,render);
 for(const name of ['paper.pdf','paper.tex'])copyFileSync(path.join(render,name),path.join(out,name));
 await command('/opt/homebrew/bin/pdftoppm',['-f','1','-singlefile','-scale-to','1600','-png',path.join(out,'paper.pdf'),path.join(out,'paper-page-1')]);
 writeFileSync(path.join(out,'build.json'),JSON.stringify({schema:'omb/archive-paper-build@1',inputHash:input.sha256,manuscriptHash:paper.sha256,pdfSha256:rawSha(readFileSync(path.join(out,'paper.pdf'))),sourceChecks:{journalChain:true,phaseChain:true,frozenCode:true,lookOutputs:true,deliverableHashes:true,servedManifest:true},...result},null,2)+'\n');
 console.log(JSON.stringify({case:i,out,...result}));
}
