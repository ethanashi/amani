/** Publish already-verified tutorial artifacts and retain every live attempt in the report. */
import {readFileSync,writeFileSync,copyFileSync,readdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {extractPdf} from '../packages/omb-report/src/reverify/pdf.ts';
const output=path.resolve('../_logs');
const cases=['confirmed','tentative','refuted','insufficient','abstention'];
const root=(name:string)=>path.resolve(name==='tentative'?'.bio-scratch/live-polish':name==='abstention'?'.bio-scratch/live-polish-resumed':'.bio-scratch/live-polish-retry',name);
const hash=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
const allLogs:string[]=[];
function logs(dir:string){for(const row of readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,row.name);if(row.isDirectory()&&!row.name.startsWith('chromium'))logs(file);else if(row.name==='paper.log')allLogs.push(file);}}
const live=cases.map(name=>{
 const directory=root(name),release=path.join(directory,'release-accepted'),source=path.join(release,'release'),run=JSON.parse(readFileSync(path.join(directory,'result.json'),'utf8'));
 if(run.error)throw Error('live draft failed '+name);
 const stem=name==='tentative'?'paper-layout-sample-live':'paper-layout-live-'+name,file=path.join(output,stem+'.pdf');
 const record=JSON.parse(readFileSync(path.join(release,'release-record.json'),'utf8'));
 const verification=JSON.parse(execFileSync(process.execPath,['--experimental-transform-types','packages/omb-report/scripts/verify-release.ts',source,path.join(release,'release-record.json'),path.join(release,'release-public.pem'),record.record.paperInputHash,record.record.buildId],{encoding:'utf8'}));if(!verification.ok)throw Error('fresh-process verification failed');
 copyFileSync(path.join(source,'paper.pdf'),file);
 const text=execFileSync('pdftotext',['-layout',file,'-'],{encoding:'utf8'});if(/Claude/u.test(text))throw Error('live PDF falsely attributes Claude use');
 const pdf=extractPdf(readFileSync(file));if(pdf.runs.some(r=>r.invisible||r.offPage||r.text.trim()&&r.size<8))throw Error('live final-size text quality failed');
 execFileSync('pdftoppm',['-r','150','-png',file,path.join(output,stem)]);
 writeFileSync(path.join(output,stem+'-arxiv-listing.txt'),execFileSync('tar',['-tzf',path.join(source,'paper-arxiv.tar.gz')]));copyFileSync(path.join(release,'release-record.json'),path.join(output,stem+'-release.json'));copyFileSync(path.join(release,'release-public.pem'),path.join(output,stem+'-public.pem'));
 logs(path.join(release,'pw8-pw9'));const acceptance=JSON.parse(readFileSync(path.join(release,'acceptance.json'),'utf8'));
 const phases=Object.fromEntries(['blind','blind-repair','results','results-repair'].map(phase=>[phase,run.records.filter((r:any)=>r.phase===phase).length]));
 const transportRetries=run.records.filter((r:any)=>r.result.status==='needs_resume').length;
 const preparation=readFileSync(path.join(release,'pw8-pw9/preparation/paper.pdf')),rendered=readFileSync(path.join(release,'pw8-pw9/render-0/paper.pdf'));
 return {fixture:name,pdf:file,pages:pdf.pages.length,words:text.match(/\S+/gu)?.length??0,minimumTextPt:Math.min(...pdf.runs.filter(r=>r.text.trim()).map(r=>r.size)),phases,transportRetries,draftElapsedMs:run.elapsedMs,releaseElapsedMs:acceptance.releaseElapsedMs,endToEndExecutionMs:run.elapsedMs+acceptance.releaseElapsedMs,usage:run.usage,freshProcess:verification,deterministicPdf:hash(preparation)===hash(rendered),pdfSha256:hash(readFileSync(file)),releaseDirectory:source,review:'pending-independent-family-and-human-review'};
});
const prior=['confirmed','refuted','insufficient','abstention'].map(name=>JSON.parse(readFileSync(path.resolve('.bio-scratch/live-polish',name,'result.json'),'utf8'))).map(r=>({fixture:r.fixture,error:r.error,usage:r.usage,elapsedMs:r.elapsedMs}));
const samples=[['paper-layout-sample','.bio-scratch/layout/polish-sample-accepted','pw8-pw9'],['paper-layout-figures','.bio-scratch/layout/polish-gallery','render']].map(([stem,dir,render])=>{
 const file=path.join(output,stem!+'.pdf'),source=path.resolve(dir!,'release');copyFileSync(path.join(source,'paper.pdf'),file);execFileSync('pdftoppm',['-r','150','-png',file,path.join(output,stem!)]);writeFileSync(path.join(output,stem+'-arxiv-listing.txt'),execFileSync('tar',['-tzf',path.join(source,'paper-arxiv.tar.gz')]));logs(path.resolve(dir!,render!));return {file,pages:extractPdf(readFileSync(file)).pages.length,pdfSha256:hash(readFileSync(file))};
});
const overfull=allLogs.flatMap(file=>(readFileSync(file,'utf8').match(/^.*Overfull \\[hv]box.*$/gmu)??[]).map(message=>({file,message})));if(overfull.length)throw Error('overfull box in delivered PDF');
const report={live,priorFailedStarts:prior,finalFixturePassRate:'5/5',distinctDraftStarts:9,accepted:5,outputProtocolFailedStarts:4,overallStartPassRate:'5/9 (four pre-fix file-output failures retained)',samples,texLogs:allLogs,overfullWarnings:overfull.length,rootSuite:'skipped: final resource check recorded separately',diagnosis:path.join(output,'paper-layout-live-diagnosis.json')};
writeFileSync(path.join(output,'paper-layout-live-results.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
