import { checkLatexPdf } from './latex-checks.ts';
import { legacyFooter,latexPdf } from './latex.ts';
import { outputProfile } from './output-profiles.ts';
import path from 'node:path';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { lintRenderedGenre } from './genre/packaging.ts';
import type { Report } from './genre/types.ts';
import { Chromium } from './chromium.ts';
import { command, commandBytes, ROOT, type Toolchain } from './toolchain.ts';
import { assert, html, sha256 } from './common.ts';
import { checkRenderedCaps, lintText } from './gates.ts';
import { locateDisplays } from './displays.ts';
import { checkCslPdfText } from './adapters.ts';
import type { Submission, VenueProfile, RenderedArtifact } from './types.ts';

function css(p:VenueProfile):string{
  const faces=[['Regular','normal','normal'],['Bold','bold','normal'],['It','normal','italic']].map(([file,weight,style])=>`@font-face{font-family:'Source Serif 4';font-weight:${weight};font-style:${style};src:url(data:font/ttf;base64,${readFileSync(path.join(ROOT,`vendor/fonts/SourceSerif4-${file}.ttf`)).toString('base64')}) format('truetype');}`).join('\n');
  return `${faces}\n@page{size:letter;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0;color:#111;background:white;font-family:'Source Serif 4';font-size:12pt;line-height:${p.doubleSpacing?2:1.3}}.page{position:relative;width:8.5in;height:11in;padding:1in;break-after:page;overflow:hidden}.page:last-child{break-after:auto}.page-content{width:6.5in;display:flow-root}.title-page{padding-top:1.2in}.title-page h1{font-size:22pt;line-height:1.35}.title-page p{margin:1em 0}h1{font-size:16pt;line-height:1.4;margin:12pt 0 8pt}h2{font-size:13pt;line-height:1.4;margin:10pt 0 6pt}p{margin:0 0 10pt}table{width:100%;border-collapse:collapse;font-size:10pt;line-height:1.45;margin:8pt 0 12pt;table-layout:fixed}th,td{text-align:left;vertical-align:top;padding:6pt;border-bottom:0.5pt solid #bbb;overflow-wrap:anywhere}thead{display:table-header-group}tr{break-inside:avoid}figure{margin:12pt 0;break-inside:avoid}figure img{max-width:100%;max-height:5.5in}figcaption{font-size:10pt;line-height:1.5;margin:5pt 0 10pt}a{color:inherit;text-decoration:none}code{font-family:'Source Serif 4';overflow-wrap:anywhere}.csl-entry{font-size:11pt;line-height:1.5;margin-bottom:8pt}.csl-left-margin{float:left;padding-right:8pt}.csl-right-inline{margin-left:20pt}.line-number{position:absolute;left:0.48in;width:0.3in;text-align:right;font-size:8pt;line-height:1.25;color:#555}footer{position:absolute;bottom:0.45in;left:1in;right:1in;text-align:center;font-size:10pt;line-height:1.3}`;
}
export interface RenderRun { genre:Report; artifacts:RenderedArtifact[]; rawHashes:Record<string,string>; layout:Record<string,unknown> }
export async function render(s:Submission,p:VenueProfile,sources:Record<string,string>,dir:string,tc:Toolchain,options:{asOf?:string;expectedGenreProfiles?:Record<string,string>}={}):Promise<RenderRun>{
  checkRenderedCaps(s,p,sources['paper.md']!);locateDisplays(s.manuscript);
  const format=outputProfile(s,p);let referenceTexts:string[]=[];
  mkdirSync(dir,{recursive:true});mkdirSync(path.join(dir,'figures'),{recursive:true});
  for(const name of ['paper.md','supplement.md'])writeFileSync(path.join(dir,name),sources[name]!);
  writeFileSync(path.join(dir,'references.json'),JSON.stringify(s.manuscript.references.map(x=>x.cslJson)));
  const genre=await lintRenderedGenre(s,p,dir,tc,options.asOf??new Date().toISOString().slice(0,10),options.expectedGenreProfiles);
  const embeddedSvgs=new Map<string,string>();
  for(const d of s.manuscript.displays.filter(x=>x.kind==='figure')){
    const font=readFileSync(path.join(ROOT,format.engine==='tectonic'?'vendor/fonts/PW9LatinModernRoman-Regular.ttf':'vendor/fonts/SourceSerif4-Regular.ttf')).toString('base64');
    const fontFamily=format.engine==='tectonic'?'Latin Modern':'Source Serif 4';
    const derivative=d.svg!.replace(/(<svg[^>]*>)/,`$1<style>@font-face{font-family:'${fontFamily}';src:url(data:font/otf;base64,${font})}text{font-family:'${fontFamily}' !important}</style>`);
    embeddedSvgs.set(d.id,derivative);writeFileSync(path.join(dir,'figures',`${d.id}.svg`),derivative);
  }
  const args=['--from','markdown-raw_html-raw_tex','--citeproc','--csl',path.join(ROOT,'vendor/csl',p.csl),'--bibliography',path.join(dir,'references.json'),'--wrap=none'];
  const browser=await Chromium.launch(tc.chromium,path.join(dir,'chromium-profile'));
  const artifacts:RenderedArtifact[]=[...genre.artifacts],rawHashes:Record<string,string>={},layout:Record<string,unknown>={};
  try{
    for(const stem of ['paper','supplement']){
      const fragment=(await command(tc.pandoc,[...args,`${stem}.md`,'--to','html5'],dir)).replace(/src="figures\/([A-Za-z0-9_-]+)\.svg"/g,(_m,id:string)=>`src="data:image/svg+xml;base64,${Buffer.from(embeddedSvgs.get(id)!).toString('base64')}"`);
      const page=`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: file:; font-src data:; style-src 'unsafe-inline'"><title>${html(stem==='paper'?s.manuscript.title:'Supplementary materials')}</title><style>${css(p)}</style></head><body data-lines="${p.lineNumbers}"><main>${fragment}</main></body></html>`;
      writeFileSync(path.join(dir,`${stem}.html`),page);await browser.open(path.join(dir,`${stem}.html`));
      const paginated=await browser.evaluate(readFileSync(path.join(ROOT,'scripts/paginate.js'),'utf8')) as {html:string;pages:number;lines:number};
      writeFileSync(path.join(dir,`${stem}.html`),paginated.html);layout[stem]={pages:paginated.pages,lines:paginated.lines};
      if(stem==='paper'){
        const anchors=await browser.evaluate(`(()=>{const blocks=[...document.querySelectorAll('.page-content')].flatMap(e=>[...e.children]);const out={};for(let i=0;i<blocks.length;i++){const b=blocks[i];if(!b.id)continue;const level=/^H[1-6]$/.test(b.tagName)?Number(b.tagName[1]):7;let text=b.innerText;for(let j=i+1;j<blocks.length;j++){const n=blocks[j];if(/^H[1-6]$/.test(n.tagName)&&Number(n.tagName[1])<=level)break;text+=' '+n.innerText;}out[b.id]=text;}return out;})()`) as Record<string,string>;
        const norm=(v:string)=>v.normalize('NFKC').replace(/\s+/g,' ').trim();
        for(const checklist of s.manuscript.checklists)for(const item of checklist.items)if(item.status==='software'||item.status==='llm')assert(anchors[item.anchor]&&norm(anchors[item.anchor]!).includes(norm(item.excerpt)),`final checklist excerpt/anchor missing: ${checklist.name}/${item.id}`);
      }
      artifacts.push({name:`${stem}.html`,bytes:Buffer.from(paginated.html),text:await browser.evaluate('document.body.innerText')});
      if(stem==='paper')referenceTexts=await browser.evaluate(`[...document.querySelectorAll('.csl-entry')].map(e=>(e.querySelector('.csl-right-inline')??e).innerText)`);
      if(format.engine==='chromium'){
      const raw=await browser.pdf();rawHashes[`${stem}.pdf`]=sha256(raw);writeFileSync(path.join(dir,`${stem}.raw.pdf`),raw);
      await command(tc.python,[path.join(ROOT,'scripts/normalize.py'),'pdf',path.join(dir,`${stem}.raw.pdf`),path.join(dir,`${stem}.pdf`)]);
      const inspected=JSON.parse(await command(tc.python,[path.join(ROOT,'scripts/normalize.py'),'inspect-pdf',path.join(dir,`${stem}.pdf`)])) as {text:string;pages:number;fonts:{name:string;embedded:boolean}[]};
      assert(inspected.pages===paginated.pages,`${stem} pagination mismatch`);
      assert(inspected.fonts.length>0&&inspected.fonts.every(f=>f.embedded&&/SourceSerif4/.test(f.name)),`${stem} fonts not embedded or unexpected fallback: ${JSON.stringify(inspected.fonts)}`);
      lintText(inspected.text,s.study.perSampleIdentifiers);
      if(stem==='paper')checkCslPdfText(inspected.text,await browser.evaluate(`[...document.querySelectorAll('.csl-entry')].map(e=>(e.querySelector('.csl-right-inline')??e).innerText)`),p.displayPlacement==='after-references');
      artifacts.push({name:`${stem}.pdf`,bytes:readFileSync(path.join(dir,`${stem}.pdf`)),text:inspected.text});
      writeFileSync(path.join(dir,`${stem}.text.txt`),inspected.text);
      }
    }
    // DOCX uses PNGs rasterised from exactly the checked SVGs using the same Chromium.
    for(const d of s.manuscript.displays.filter(x=>x.kind==='figure')){
      const imagePage=`<!doctype html><html><head><style>${css(p)} body{width:600px;line-height:1}img{display:block;width:600px;height:auto}</style></head><body><img src="${d.id}.svg"></body></html>`;
      const file=path.join(dir,'figures',`${d.id}.html`);writeFileSync(file,imagePage);await browser.open(file);
      const size=await browser.evaluate('({w:document.images[0].width,h:document.images[0].height})');
      writeFileSync(path.join(dir,'figures',`${d.id}.png`),await browser.png(size.w,size.h));
      if(format.engine==='tectonic'){
        await browser.evaluate(`(()=>{const s=document.createElement('style');s.textContent='@page{size:${size.w}px ${size.h}px;margin:0}html,body{width:${size.w}px;height:${size.h}px;margin:0;padding:0;line-height:0}';document.head.append(s);})()`);
        const raw=await browser.pdf(),figure=path.join(dir,'figures',d.id);writeFileSync(figure+'.raw.pdf',raw);
        await command(tc.python,[path.join(ROOT,'scripts/normalize.py'),'pdf',figure+'.raw.pdf',figure+'.pdf']);
        const info=JSON.parse(await command(tc.python,[path.join(ROOT,'scripts/normalize.py'),'inspect-pdf',figure+'.pdf']));
        checkLatexPdf(info,true);lintText(info.text,s.study.perSampleIdentifiers);
        artifacts.push({name:`figures/${d.id}.pdf`,bytes:readFileSync(figure+'.pdf'),text:info.text});rawHashes[`figures/${d.id}.pdf`]=sha256(raw);
      }
    }
  }finally{await browser.close();}
  const reference=path.join(dir,'reference.docx');
  writeFileSync(reference,await commandBytes(tc.pandoc,['--print-default-data-file=reference.docx']));
  const docSource=sources['paper.md']!.replace(/\]\(figures\/([A-Za-z0-9_-]+)\.svg\)/g,'](figures/$1.png)');writeFileSync(path.join(dir,'paper-docx.md'),docSource);
  await command(tc.pandoc,[...args,'paper-docx.md','--reference-doc',reference,'--output','paper.raw.docx'],dir);
  rawHashes['paper.docx']=sha256(readFileSync(path.join(dir,'paper.raw.docx')));
  await command(tc.python,[path.join(ROOT,'scripts/normalize.py'),'docx',path.join(dir,'paper.raw.docx'),path.join(dir,'paper.docx'),path.join(ROOT,'vendor/fonts'),String(p.doubleSpacing),String(p.lineNumbers)]);
  const docx=JSON.parse(await command(tc.python,[path.join(ROOT,'scripts/normalize.py'),'inspect-docx',path.join(dir,'paper.docx')])) as {text:string;xml:string;fonts:string[]};
  assert(docx.fonts.length===3,'DOCX fonts not embedded');lintText(docx.xml,s.study.perSampleIdentifiers);
  artifacts.push({name:'paper.docx',bytes:readFileSync(path.join(dir,'paper.docx')),text:docx.xml});
  if(format.engine==='tectonic'){
    for(const stem of ['paper','supplement'] as const){const result=await latexPdf(s,p,format,dir,tc,stem);artifacts.push(...result.artifacts);rawHashes[stem+'.pdf']=result.rawHash;layout[stem]={pages:result.pages,lines:0,engine:'tectonic',columns:stem==='paper'?format.columns:1};
      if(stem==='paper')checkCslPdfText(result.artifacts.find(a=>a.name==='paper.pdf')!.text!,referenceTexts,p.displayPlacement==='after-references',true,legacyFooter(s));
    }
  }else{
    await command(tc.pandoc,[...args,'paper.md','--to','latex','--output','paper.tex'],dir);
    artifacts.push({name:'paper.tex',bytes:readFileSync(path.join(dir,'paper.tex'))});
  }
  return {genre:genre.report,artifacts,rawHashes,layout};
}
export function compareRenders(a:RenderRun,b:RenderRun):Record<string,unknown>{
  const comparison=a.artifacts.map(x=>{const other=b.artifacts.find(y=>y.name===x.name);assert(other,`regenerated artifact missing: ${x.name}`);const first=sha256(x.bytes),second=sha256(other.bytes);assert(first===second,`regenerated output hash mismatch: ${x.name}`);return {name:x.name,sha256:first,identical:true,rawFirst:a.rawHashes[x.name]??first,rawSecond:b.rawHashes[x.name]??second};});
  return {schema:'omb/regenerate-hash@1',comparison,normalization:'PDF: Tectonic SOURCE_DATE_EPOCH=946684800 with pinned offline bundle; fixed CreationDate/ModDate, producer/creator, trailer ID, allocation-dependent accessibility IDs and pinned pypdf serialization. DOCX: fixed ZIP member order/timestamps/permissions, core dates, local bibliography/CSL paths, embedded OFL fonts. Other differences are blocking.'};
}
