/** Delete real output guards; a kill requires baseline refusal and mutant acceptance. */
import { readFileSync,writeFileSync,rmSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from '../src/toolchain.ts';
import { fixture } from '../test/fixture.ts';
import { outputProfile } from '../src/output-profiles.ts';
import { venueProfile } from '../src/profiles.ts';
const s=fixture().submission,venue=venueProfile(s.venue),profile=outputProfile(s,venue);
const tex=readFileSync(path.join(ROOT,'latex/article.tex'),'utf8').replace('$fontsize$','10').replace('$margin$','1');
const pdf={text:'Selectable paper text. '.repeat(10),pages:1,fonts:[{name:'LMRoman10-Regular',embedded:true}],imageCount:0};
const cases:{id:string;file:string;message:string;test:(m:any)=>void}[]=[];
const add=(id:string,file:string,message:string,test:(m:any)=>void)=>cases.push({id,file,message,test});
add('source-margins','latex.ts','LaTeX pinned page geometry required',m=>m.checkTexSource(tex.replace('margin=1in','margin=0.5in'),profile));
add('source-font-size','latex.ts','LaTeX article/font policy',m=>m.checkTexSource(tex.replace('10pt,letterpaper','9pt,letterpaper'),profile));
add('source-columns','latex.ts','two-column title/abstract missing',m=>m.checkTexSource(tex.replace('\\twocolumn[','\\onecolumn['),profile));
add('source-line-numbers','latex.ts','forbidden TeX review/active features',m=>m.checkTexSource(tex+'\\linenumbers',profile));
add('source-font','latex.ts','pinned Latin Modern required',m=>m.checkTexSource(tex.replace('lmroman10-regular.otf','Arial'),profile));
add('source-clock','latex.ts','nondeterministic date macro',m=>m.checkTexSource(tex+'\\today',profile));
add('pdf-text-layer','latex-checks.ts','LaTeX PDF text layer missing',m=>m.checkLatexPdf({...pdf,text:''}));
add('embedded-font','latex-checks.ts','LaTeX PDF font missing/not embedded',m=>m.checkLatexPdf({...pdf,fonts:[{name:'LMRoman10',embedded:false}]}));
add('vector-figure','latex-checks.ts','figure conversion must preserve one vector PDF page',m=>m.checkLatexPdf({...pdf,imageCount:1},true));
add('profile-margins','output-profiles.ts','output font/margin/column policy',m=>m.validateOutputProfile({...profile,marginInches:.9},venue));
add('profile-review','output-profiles.ts','review format requires a journal review venue',m=>m.validateOutputProfile({...profile,id:'journal-review',engine:'chromium',columns:1,lineNumbers:true,doubleSpacing:true},venue));
add('profile-arxiv-source','output-profiles.ts','arXiv source archive required',m=>m.validateOutputProfile({...profile,id:'arxiv-source',sourceArchive:false},venue));
add('profile-two-column','output-profiles.ts','reading preprint requires two columns',m=>m.validateOutputProfile({...profile,columns:1},venue));
add('float-order','latex-checks.ts','PDF float precedes first citation or caption missing',m=>m.checkFloatOrder('Introduction. Figure 1. Reproduction pipeline. Table 1. Summary of findings. Later citations: Figure 1 and Table 1.',s,venue));
function erase(source:string,message:string){const at=source.indexOf(message);if(at<0)throw Error(message);const start=source.lastIndexOf('assert(',at);let i=start+6,depth=0,quote='';for(;i<source.length;i++){const c=source[i]!;if(quote){if(c==='\\'){i++;continue;}if(c===quote)quote='';continue;}if(['"',"'",'`'].includes(c)){quote=c;continue;}if(c==='(')depth++;if(c===')'&&--depth===0){i++;break;}}return source.slice(0,start)+'void 0'+source.slice(i);}
const results=[];
for(const [i,t] of cases.entries()){
 const source=path.join(ROOT,'src',t.file),module=await import(pathToFileURL(source).href);let baselineRejected=false;try{t.test(module);}catch{baselineRejected=true;}
 const file=path.join(ROOT,'src',`.latex-mutant-${i}.ts`);writeFileSync(file,erase(readFileSync(source,'utf8'),t.message));
 try{const mutant=await import(pathToFileURL(file).href);let mutantAccepted=false;try{t.test(mutant);mutantAccepted=true;}catch{}results.push({id:t.id,baselineRejected,mutantAccepted,killed:baselineRejected&&mutantAccepted});}finally{rmSync(file);}
}
const report={total:results.length,killed:results.filter(x=>x.killed).length,results};writeFileSync(path.join(ROOT,'reports/latex-mutations-round3.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));if(report.total!==report.killed)process.exitCode=1;
