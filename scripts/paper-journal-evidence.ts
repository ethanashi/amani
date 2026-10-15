/** Publish deterministic journal-format replays; never invokes a model or loads private keys. */
import {readFileSync,writeFileSync,copyFileSync,readdirSync,unlinkSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {extractPdf} from '../packages/omb-report/src/reverify/pdf.ts';
const output=path.resolve('../_logs'),root=path.resolve('.bio-scratch/journal');
const renderSuffix=process.env.PAPER_JOURNAL_SUFFIX??'inline';
const rows=[...['confirmed','tentative','refuted','insufficient','abstention'].map(name=>({name,stem:name==='tentative'?'paper-layout-sample-live':'paper-layout-live-'+name,dir:path.join(root,'live',name,'release-'+renderSuffix),accepted:path.join(root,'live',name,'manuscript.json'),render:'pw8-pw9'})),{name:'fixture',stem:'paper-layout-sample',dir:path.join(root,'sample-'+renderSuffix),accepted:null,render:'pw8-pw9'},{name:'gallery',stem:'paper-layout-figures',dir:path.join(root,'gallery-'+renderSuffix),accepted:null,render:'render'}];
const frozen: {case:string;draftSha256:string}[]=JSON.parse(readFileSync(path.join(root,'accepted-drafts.json'),'utf8'));
const hash=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex'),logs:string[]=[];
function findLogs(dir:string){for(const e of readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,e.name);if(e.isDirectory()&&!e.name.startsWith('chromium'))findLogs(f);else if(e.name==='paper.log')logs.push(f);}}
const releases=rows.map(row=>{
 if(row.accepted&&hash(readFileSync(row.accepted))!==frozen.find(r=>r.case===row.name)?.draftSha256)throw Error('accepted model draft changed: '+row.name);
 const source=path.join(row.dir,'release');let verification:unknown={ok:true,scope:'in-process trusted release (gallery)'};
 if(row.name!=='gallery'){
  const recordPath=path.join(row.dir,'release-record.json'),publicPath=path.join(row.dir,'release-public.pem'),record=JSON.parse(readFileSync(recordPath,'utf8'));
  verification=JSON.parse(execFileSync(process.execPath,['--experimental-transform-types','packages/omb-report/scripts/verify-release.ts',source,recordPath,publicPath,record.record.paperInputHash,record.record.buildId],{encoding:'utf8'}));if(!(verification as any).ok)throw Error('fresh-process verification failed: '+row.name);
  copyFileSync(recordPath,path.join(output,row.stem+'-release.json'));copyFileSync(publicPath,path.join(output,row.stem+'-public.pem'));
 }
 const file=path.join(output,row.stem+'.pdf');copyFileSync(path.join(source,'paper.pdf'),file);
 const pdf=extractPdf(readFileSync(file));if(pdf.runs.some(r=>r.invisible||r.offPage||r.text.trim()&&r.size<8))throw Error('text quality: '+row.name);
 for(const name of readdirSync(output))if(name.startsWith(row.stem+'-')&&/^\d+\.png$/u.test(name.slice(row.stem.length+1)))unlinkSync(path.join(output,name));
 execFileSync('pdftoppm',['-r','150','-png',file,path.join(output,row.stem)]);
 writeFileSync(path.join(output,row.stem+'-arxiv-listing.txt'),execFileSync('tar',['-tzf',path.join(source,'paper-arxiv.tar.gz')]));
 findLogs(path.join(row.dir,row.render));const text=execFileSync('pdftotext',['-layout',file,'-'],{encoding:'utf8'}),pages=text.split('\f');
 const resultsAt=text.search(/^\s*Results\s*$/mu),discussionAt=text.search(/^\s*Discussion\s*$/mu),findingsAt=text.indexOf('Findings in pre-registered');
 if(findingsAt>=0&&!(resultsAt>=0&&findingsAt>resultsAt&&discussionAt>findingsAt))throw Error('findings table escaped Results: '+row.name);
 const tablePage=pages.findIndex(t=>t.includes('Findings in pre-registered'))+1;
 return {name:row.name,file,pages:pdf.pages.length,tablePage,words:text.match(/\S+/gu)?.length??0,pdfSha256:hash(readFileSync(file)),minimumTextPt:Math.min(...pdf.runs.filter(r=>r.text.trim()).map(r=>r.size)),acceptedDraft:row.accepted,acceptedDraftSha256:row.accepted?hash(readFileSync(row.accepted)):null,additionalLiveCalls:0,verification,deterministicPdf:hash(readFileSync(path.join(row.dir,row.render,'preparation/paper.pdf')))===hash(readFileSync(path.join(row.dir,row.render,'render-0/paper.pdf')))};
});
const overfull=logs.flatMap(file=>(readFileSync(file,'utf8').match(/^.*Overfull \\[hv]box.*$/gmu)??[]).map(message=>({file,message})));if(overfull.length)throw Error(JSON.stringify(overfull));
const report={releases,additionalLiveCalls:0,acceptedModelTextChanged:false,overfullWarnings:0,texLogs:logs,review:'Synthetic previews: independent-family review, human review and endorsement remain pending.'};
writeFileSync(path.join(output,'paper-journal-results.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
