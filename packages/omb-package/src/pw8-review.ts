/** Review profile: fixed twelve point type, double spacing, explicit margin
 * line/page labels. The labels are separately constrained by PW8's profile. */
import path from 'node:path';
import {readFileSync,writeFileSync} from 'node:fs';
import {Chromium} from './chromium.ts';
import {ROOT,command,type Toolchain} from './toolchain.ts';
export async function renderVerifiedReview(html:string,dir:string,tc:Toolchain):Promise<Uint8Array>{
 const faces=[['Regular','normal','normal'],['Bold','bold','normal'],['It','normal','italic']].map(([file,weight,style])=>`@font-face{font-family:'Source Serif 4';font-weight:${weight};font-style:${style};src:url(data:font/ttf;base64,${readFileSync(path.join(ROOT,`vendor/fonts/SourceSerif4-${file}.ttf`)).toString('base64')})}`).join('\n');
 const css=`${faces}\n@page{size:letter;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0;color:black;background:white;font-family:'Source Serif 4';font-size:12pt;line-height:2}.page{position:relative;width:8.5in;height:11in;padding:1in;break-after:page}.page:last-child{break-after:auto}.page-content{width:6.5in;display:flow-root}h1{font-size:18pt;line-height:1.4}h2{font-size:14pt;line-height:1.4}p{margin:0 0 10pt;overflow-wrap:anywhere}figure{margin:12pt 0;break-inside:avoid}img{max-width:100%;max-height:5in}table{width:100%;border-collapse:collapse}th,td{text-align:left;vertical-align:top}.line-number{position:absolute;left:0.48in;font-size:8pt;line-height:1.25}footer{position:absolute;bottom:0.45in;left:1in;right:1in;text-align:center;font-size:10pt;line-height:1.3}`;
 const file=path.join(dir,'review-render.html');writeFileSync(file,html.replace('</head>',`<style>${css}</style></head>`));
 const browser=await Chromium.launch(tc.chromium,path.join(dir,'review-chromium'));
 try {await browser.open(file);await browser.evaluate(`(()=>{for(const img of document.querySelectorAll('img'))img.setAttribute('src',img.getAttribute('src')+'.print.svg');const article=document.querySelector('article'),main=document.createElement('main');for(const e of [...article.children]){if(e.tagName==='SECTION'){for(const b of [...e.children])main.append(b);}else main.append(e);}article.replaceWith(main);for(const dl of [...main.querySelectorAll('dl')]){const frag=document.createDocumentFragment();let p;for(const e of [...dl.children]){if(e.tagName==='DT'){p=document.createElement('p');frag.append(p);const strong=document.createElement('strong');strong.append(...e.childNodes);p.append(strong);}else{p.append(document.createTextNode(' '),...e.childNodes);}}dl.replaceWith(frag);}document.body.dataset.lines='true';})()`);
  await browser.evaluate('Promise.all([...document.images].map(i=>i.decode()))');
  await browser.evaluate(readFileSync(path.join(ROOT,'scripts/paginate.js'),'utf8'));
  writeFileSync(path.join(dir,'review.raw.pdf'),await browser.pdf());
 }finally{await browser.close();}
 await command(tc.python,[path.join(ROOT,'scripts/normalize.py'),'pdf',path.join(dir,'review.raw.pdf'),path.join(dir,'review.pdf')]);return readFileSync(path.join(dir,'review.pdf'));
}
