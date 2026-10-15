import { assert } from './common.ts';
import { locateDisplays } from './displays.ts';
import type { Submission,VenueProfile } from './types.ts';
export interface PdfInfo {text:string;pages:number;fonts:{name:string;embedded:boolean}[];imageCount:number}
export function checkLatexPdf(info:PdfInfo,vector=false):void {
 if(vector)assert(info.pages===1&&info.imageCount===0,'figure conversion must preserve one vector PDF page');
 else assert(info.text?.trim().length>100,'LaTeX PDF text layer missing');
 assert(info.fonts.length>0&&info.fonts.every(f=>f.embedded&&/AmaniJournalSerif|SourceSerif4|LiberationSans|LMRoman|LMSans|LMMono|LatinModern|CMSY|CMR|CMEX|CMMI/.test(f.name)),'LaTeX PDF font missing/not embedded');
}
export function checkFloatOrder(text:string,s:Submission,p:VenueProfile):void {
 const clean=(v:string)=>v.normalize('NFKC').replace(/([a-z])-\n([a-z])/g,'$1$2').replace(/\s+/g,''); // Pypdf may omit word-space glyphs in embedded OpenType fonts; order and caption characters remain exact.
 const t=clean(text),intro=t.indexOf('Introduction');assert(intro>=0,'PDF Introduction missing');
 for(const l of locateDisplays(s.manuscript).filter(l=>l.display.placement==='main')){
  const caption=t.indexOf(clean(`${l.label}. ${l.display.title}`));
  const citation=t.indexOf(clean(l.label),intro);
  assert(citation>=intro&&caption>citation,`PDF float precedes first citation or caption missing: ${l.display.id}`);
  if(p.displayPlacement==='after-references')assert(t.lastIndexOf('References')>=0&&caption>t.lastIndexOf('References'),'PDF float precedes references');
 }
}
