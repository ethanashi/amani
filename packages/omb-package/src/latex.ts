import {journalFontAssets} from './journal-fonts.ts';
import path from 'node:path';
import { checkLatexPdf,checkFloatOrder } from './latex-checks.ts';
import { readFileSync,writeFileSync,mkdirSync,cpSync } from 'node:fs';
import { command,ROOT,type Toolchain } from './toolchain.ts';
import { assert,sha256 } from './common.ts';
import { lintText } from './gates.ts';
import { attributes,allNodes } from './genre/ast.ts';
import type { AstNode,Pandoc } from './genre/types.ts';
import type { Submission,VenueProfile,RenderedArtifact } from './types.ts';
import type { OutputProfile } from './output-profiles.ts';
const metaText=(text:string)=>({t:'MetaInlines',c:[{t:'Str',c:text}]});
export function checkTexSource(tex:string,profile:OutputProfile,houseLayout?:'amani-a4@1'):void {
 assert(houseLayout===undefined||houseLayout==='amani-a4@1','unknown pinned house layout');
 assert(houseLayout?tex.includes('\\documentclass[10pt,a4paper]{article}'):/\\documentclass\[(10|11|12)pt,letterpaper\]\{article\}/.test(tex),'LaTeX article/font policy');
 assert(houseLayout?tex.includes('\\usepackage[a4paper,textwidth=160mm,centering,top=20mm,bottom=22mm,footskip=12mm]{geometry}'):/\\usepackage\[margin=1in\]\{geometry\}/.test(tex),'LaTeX pinned page geometry required');
 assert(!/\\(?:linenumbers|marginpar|doublespacing|SetWatermarkText|write18|input\s*\|)\b|\\usepackage(?:\[[^\]]*\])?\{(?:lineno|draftwatermark|shellesc)\}/i.test(tex),'forbidden TeX review/active features');
 assert(profile.columns!==2||tex.includes('\\twocolumn['),'two-column title/abstract missing');
 assert(/\\setmainfont\{AmaniJournalSerif-Regular\.ttf\}/.test(tex),'pinned Source Serif 4 required');
 assert(!/\\today\b/.test(tex),'nondeterministic date macro');
}
export function legacyFooter(s:Submission):string {const title=s.manuscript.title.length>30?s.manuscript.title.slice(0,27).replace(/\s+\S*$/u,'')+'…':s.manuscript.title;return title+' | Preprint, not peer reviewed | Version 1; '+String((s.input.lock as Record<string,unknown>).at??'date not recorded').slice(0,10);}
async function writeFragment(ast:Pandoc,tc:Toolchain,dir:string,name:string):Promise<string>{
 writeFileSync(path.join(dir,`${name}.json`),JSON.stringify(ast));return command(tc.pandoc,['-f','json','-t','latex','--wrap=none',`${name}.json`],dir);
}
export async function latexPdf(s:Submission,p:VenueProfile,profile:OutputProfile,dir:string,tc:Toolchain,stem:'paper'|'supplement'):Promise<{artifacts:RenderedArtifact[];rawHash:string;pages:number}> {
 const fontFiles=await journalFontAssets(tc,dir);
 const ast=JSON.parse(await command(tc.pandoc,['-f','markdown-raw_html-raw_tex','-t','json','--citeproc','--csl',path.join(ROOT,'vendor/csl',p.csl),'--bibliography','references.json',`${stem}.md`],dir)) as Pandoc;
 if(stem==='supplement'&&ast.blocks[0]?.t==='Header'&&attributes(ast.blocks[0]).kv['section-id']==='supplement')ast.blocks.splice(0,2);
 const refs=allNodes(ast.blocks).find(n=>n.t==='Div'&&attributes(n).id==='refs');
 const bbl=refs?await writeFragment({...ast,meta:{},blocks:[refs]},tc,dir,stem+'-references'):'';
 writeFileSync(path.join(dir,`${stem}.bbl`),bbl);
 const ab=ast.blocks.find(n=>n.t==='Div'&&attributes(n).kv['section-id']==='abstract');
 const affiliations=[...new Set(s.owner.record.authors.flatMap(a=>a.affiliations))];
 const authorInlines=s.owner.record.authors.flatMap((a,i)=>[...i?[{t:'Str',c:', ' }]:[],{t:'Strong',c:[{t:'Str',c:a.name}]},{t:'Superscript',c:[{t:'Str',c:a.affiliations.map(f=>affiliations.indexOf(f)+1).join(',')+(a.corresponding?'*':'')}]}]);
 ast.meta={...ast.meta,shorttitle:metaText(s.manuscript.title.length>30?s.manuscript.title.slice(0,27).replace(/\s+\S*$/u,'')+'…':s.manuscript.title),edition:metaText('Version 1; '+String((s.input.lock as Record<string,unknown>).at??'date not recorded').slice(0,10)),supplement:{t:'MetaBool',c:stem==='supplement'},title:metaText(stem==='paper'?s.manuscript.title:'Supplementary materials'),authors:{t:'MetaInlines',c:authorInlines},affiliations:{t:'MetaBlocks',c:affiliations.map((a,i)=>({t:'Para',c:[{t:'Superscript',c:[{t:'Str',c:String(i+1)}]},{t:'Str',c:` ${a}`}]}))},orcid:metaText(s.owner.record.authors.filter(a=>a.orcid).map(a=>`${a.name}: ORCID ${a.orcid}`).join('; ')),articleinfo:metaText(`CC-BY 4.0. Data availability: ${s.reproduction.data.map(d=>d.path).join('; ')}. Code availability: ${s.reproduction.entrypoint}. Funding: ${s.owner.record.funding}. Competing interests: ${s.owner.record.competingInterests}. Amani generation and verification: recorded AI assistance and deterministic artifact checks do not replace peer review or establish scientific validity.`),correspondence:metaText(s.owner.record.authors.filter(a=>a.corresponding).map(a=>`* Correspondence: ${a.name}${a.emailApprovedForSubmission&&a.email?'; '+a.email:'; email withheld pending owner approval'}`).join('; ')),abstract:{t:'MetaBlocks',c:ab?ab.c[1].filter((n:AstNode)=>n.t!=='Header'):[{t:'Para',c:[{t:'Str',c:s.manuscript.title}]}]},fontsize:metaText(String(profile.fontSizePt)),margin:metaText(String(profile.marginInches)),twocolumn:{t:'MetaBool',c:stem==='paper'&&profile.columns===2}};
 writeFileSync(path.join(dir,`${stem}-latex.json`),JSON.stringify(ast));
 const tex=await command(tc.pandoc,['-f','json','-t','latex','--standalone','--number-sections','--wrap=none','--template',path.join(ROOT,'latex/article.tex'),'--lua-filter',path.join(ROOT,'latex/structure.lua'),`${stem}-latex.json`],dir);
 checkTexSource(tex,{...profile,columns:stem==='paper'?profile.columns:1});lintText(tex,s.study.perSampleIdentifiers);writeFileSync(path.join(dir,`${stem}.tex`),tex);
 await command(tc.tectonic,['--bundle',tc.texBundle,'--only-cached','--untrusted','--keep-logs','--keep-intermediates',`${stem}.tex`],dir);
 const raw=readFileSync(path.join(dir,`${stem}.pdf`)),rawHash=sha256(raw);writeFileSync(path.join(dir,`${stem}.raw.pdf`),raw);
 await command(tc.python,[path.join(ROOT,'scripts/normalize.py'),'pdf',path.join(dir,`${stem}.raw.pdf`),path.join(dir,`${stem}.pdf`)]);
 const info=JSON.parse(await command(tc.python,[path.join(ROOT,'scripts/normalize.py'),'inspect-pdf',path.join(dir,`${stem}.pdf`)]));
 checkLatexPdf(info);if(stem==='paper')checkFloatOrder(info.text,s,p);
 lintText(info.text,s.study.perSampleIdentifiers);
 const log=readFileSync(path.join(dir,`${stem}.log`),'utf8');
 assert(!/Missing character:|Undefined control sequence|LaTeX Error:|Overfull \\[hv]box/.test(log),'LaTeX missing glyph/error or overflowing content');
 writeFileSync(path.join(dir,`${stem}.text.txt`),info.text);
 const artifacts:RenderedArtifact[]=[{name:`${stem}.pdf`,bytes:readFileSync(path.join(dir,`${stem}.pdf`)),text:info.text},{name:`${stem}.tex`,bytes:Buffer.from(tex),text:tex}];
 if(stem==='paper'){
  artifacts.push({name:'paper.bbl',bytes:Buffer.from(bbl),text:bbl});
  writeFileSync(path.join(dir,`${stem}.bbl`),bbl);
  if(profile.sourceArchive){
   const archiveDir=path.join(dir,'arxiv-source');mkdirSync(archiveDir);
   writeFileSync(path.join(archiveDir,'00README.json'),JSON.stringify({spec_version:1,process:{compiler:'xelatex'},sources:[{filename:'paper.tex',usage:'toplevel'}],texlive_version:2025,stamp:false},null,2)+'\n');
   for(const [name,bytes] of fontFiles){mkdirSync(path.dirname(path.join(archiveDir,name)),{recursive:true});writeFileSync(path.join(archiveDir,name),bytes);}
   writeFileSync(path.join(archiveDir,'paper.tex'),tex);writeFileSync(path.join(archiveDir,'paper.bbl'),bbl);
   for(const d of s.manuscript.displays.filter(x=>x.kind==='figure'&&x.placement==='main')){mkdirSync(path.join(archiveDir,'figures'),{recursive:true});cpSync(path.join(dir,'figures',d.id+'.pdf'),path.join(archiveDir,'figures',d.id+'.pdf'));}
   // Only standard TeX Live packages and already-converted vector PDFs. No shell escape.
   await command(tc.python,[path.join(ROOT,'scripts/tex-bundle.py'),'archive',archiveDir,path.join(dir,'paper-arxiv.tar.gz')]);
   artifacts.push({name:'paper-arxiv.tar.gz',bytes:readFileSync(path.join(dir,'paper-arxiv.tar.gz'))});
  }
 }
 return {artifacts,rawHash,pages:info.pages};
}
