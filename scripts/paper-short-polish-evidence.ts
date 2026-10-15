/** Re-publish deterministic releases from unchanged, already accepted live drafts. */
import {readFileSync,writeFileSync,copyFileSync,readdirSync,unlinkSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {extractPdf} from '../packages/omb-report/src/reverify/pdf.ts';
const output=path.resolve('../_logs'),config=JSON.parse(readFileSync('.bio-scratch/content/evidence-map.json','utf8'));
const rows=[...['confirmed','tentative','refuted','insufficient','abstention'].map(name=>({name,stem:name==='tentative'?'paper-layout-sample-live':'paper-layout-live-'+name,dir:path.resolve(config.liveRoots[name],'release-short-approved'),accepted:path.resolve(config.liveRoots[name],'manuscript.json')})),{name:'fixture',stem:'paper-layout-sample',dir:path.resolve('.bio-scratch/short-polish/sample-approved'),accepted:null}];
const hash=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
const logs:string[]=[];
function findLogs(dir:string){for(const e of readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,e.name);if(e.isDirectory()&&!e.name.startsWith('chromium'))findLogs(f);else if(e.name==='paper.log')logs.push(f);}}
const releases=rows.map(row=>{
 const source=path.join(row.dir,'release'),recordPath=path.join(row.dir,'release-record.json'),publicPath=path.join(row.dir,'release-public.pem'),record=JSON.parse(readFileSync(recordPath,'utf8'));
 const verification=JSON.parse(execFileSync(process.execPath,['--experimental-transform-types','packages/omb-report/scripts/verify-release.ts',source,recordPath,publicPath,record.record.paperInputHash,record.record.buildId],{encoding:'utf8'}));if(!verification.ok)throw Error('fresh-process release verification failed: '+row.name);
 const file=path.join(output,row.stem+'.pdf');copyFileSync(path.join(source,'paper.pdf'),file);
 const pdf=extractPdf(readFileSync(file));if(pdf.runs.some(r=>r.invisible||r.offPage||r.text.trim()&&r.size<8))throw Error('text quality: '+row.name);
 for(const name of readdirSync(output))if(name.startsWith(row.stem+'-')&&/^\d+\.png$/u.test(name.slice(row.stem.length+1)))unlinkSync(path.join(output,name));
 execFileSync('pdftoppm',['-r','150','-png',file,path.join(output,row.stem)]);
 copyFileSync(recordPath,path.join(output,row.stem+'-release.json'));copyFileSync(publicPath,path.join(output,row.stem+'-public.pem'));
 writeFileSync(path.join(output,row.stem+'-arxiv-listing.txt'),execFileSync('tar',['-tzf',path.join(source,'paper-arxiv.tar.gz')]));
 findLogs(path.join(row.dir,'pw8-pw9'));
 const text=execFileSync('pdftotext',['-layout',file,'-'],{encoding:'utf8'});
 return {name:row.name,file,pages:pdf.pages.length,words:text.match(/\S+/gu)?.length??0,pdfSha256:hash(readFileSync(file)),minimumTextPt:Math.min(...pdf.runs.filter(r=>r.text.trim()).map(r=>r.size)),acceptedDraft:row.accepted,acceptedDraftSha256:row.accepted?hash(readFileSync(row.accepted)):null,additionalLiveCalls:0,freshProcess:verification,deterministicPdf:hash(readFileSync(path.join(row.dir,'pw8-pw9/preparation/paper.pdf')))===hash(readFileSync(path.join(row.dir,'pw8-pw9/render-0/paper.pdf')))};
});
const overfull=logs.flatMap(file=>(readFileSync(file,'utf8').match(/^.*Overfull \\[hv]box.*$/gmu)??[]).map(message=>({file,message})));if(overfull.length)throw Error(JSON.stringify(overfull));
const report={releases,additionalLiveCalls:0,acceptedModelTextChanged:false,overfullWarnings:overfull.length,texLogs:logs,review:'Synthetic previews; independent-family review, human review and endorsement remain pending.'};
writeFileSync(path.join(output,'paper-short-polish-results.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
