/** Closed TeX dialect: every content value is bound and every layout construct is
 * generated from verified fragments. Exact regeneration remains a second boundary. */
import { canonicalSha256 } from '../../../bio-core/src/index.ts';
import { requireThat } from '../common.ts';
import { visibleSectionHeading, type Manuscript, type Unit } from './manuscript.ts';
export interface TexProfile { readonly schema:'omb/pw8/tex-profile@1'; readonly columns:1|2; readonly figureWidthMm?:178; readonly preamble:string; readonly trailer:string }
export const texEscape=(s:string):string=>s.replace(/[\\{}%&#_$^~]/gu,c=>({'\\':'\\textbackslash{}','{':'\\{','}':'\\}','%':'\\%','&':'\\&','#':'\\#','_':'\\_','$':'\\$','^':'\\textasciicircum{}','~':'\\textasciitilde{}'}[c]!));
const valueText=(text:string):string=>texEscape(text).replace(/\b10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+/gu,doi=>[...doi].join('\\allowbreak{}')).replace(/\b[a-f0-9]{32,64}\b/gu,digest=>[...digest].join('\\allowbreak{}'));
export function texValueId(u:Unit,index:number):string{return u.uid+'-'+String.fromCharCode(97+Math.floor(index/26))+String.fromCharCode(97+index%26);}
export function texUnit(u:Unit):string {return u.inlines.map((i,n)=>i.t==='value'?`\\ombval{${texValueId(u,n)}}{${valueText(i.text)}}`:i.style?`\\${i.style==='em'?'emph':'textbf'}{${valueText(i.text)}}`:texEscape(i.text)).join('');}
/** Footer content is derived exclusively from the verified title and article metadata. */
export function runningFooterText(m:Manuscript):string {
 const title=m.title.text.length>36?m.title.text.slice(0,33).replace(/\s+\S*$/u,'')+'…':m.title.text;
 const edition=m.sections.find(s=>s.id==='article-information')?.blocks.flatMap(b=>b.kind==='paragraphs'?b.units:[]).find(u=>u.inlines.some(i=>i.t==='value'&&i.key==='article:edition'))?.text??'Version not recorded';
 return [title, 'Preprint, not peer reviewed', edition].map(v=>v.replace(/^[\s|]+|[\s|]+$/gu,'')).filter(Boolean).join(' | ');
}
const boxes=new Set(['plain-summary','idea-in-brief','key-points','author-summary']);
const glossaries=new Set(['glossary','label-crosswalk']);
const subsections=new Set(['limitations','limitations-part-b','data-availability','code-availability','registration','ai-use-disclosure','funding','competing-interests','author-contributions','ethics','acknowledgments']);
/** No arbitrary raw source or dynamic package options enter this writer. */
function document(m:Manuscript,p:TexProfile):{tex:string;bound:string[];constructs:string[]} {
 requireThat(p.schema==='omb/pw8/tex-profile@1'&&[1,2].includes(p.columns),'TeX: invalid pinned profile');
 const bound:string[]=[],constructs:string[]=[];
 const unit=(u:Unit,style:'plain'|'term'|'caption'='plain')=>u.inlines.map((i,n)=>{
  let text=valueText(i.text).replace(/\bp(?=\s*[=<]|$|[,;]|-values?\b|\s+(?:at|is|was|values?)\b)/gu,'\\textnormal{\\textit{p}}');
  if(style==='plain'&&u.section==='abstract'&&n===0&&/^(Background|Methods|Conclusions)\. /u.test(i.text)){const cut=text.indexOf('. ')+1;text=`\\textbf{${text.slice(0,cut)}}${text.slice(cut)}`;}
  if(style==='term'&&n===0&&i.text.includes(':')){const cut=text.indexOf(':')+1;text=`\\textbf{${text.slice(0,cut)}}${text.slice(cut)}`;}
  if(style==='caption'&&n===0)text=`\\textbf{${text}}`;
  if(style==='caption'&&n===1&&i.text.startsWith('. ')){const cut=text.indexOf('. ',2);if(cut>0)text=`\\textbf{${text.slice(0,cut+1)}}${text.slice(cut+1)}`;}
  if(i.t==='value'&&i.key.startsWith('author:')&&i.key.endsWith(':name'))text=`\\textbf{${text}}`;
  if(i.t==='value'&&i.key.startsWith('author:')&&i.key.endsWith(':marker'))text=`\\ombsup{${text}}`;
  if(i.t==='value'){const macro=`\\ombval{${texValueId(u,n)}}{${text}}`;bound.push(macro);return macro;}
  return i.style?`\\${i.style==='em'?'emph':'textbf'}{${text}}`:text;
 }).join('');
 const blocks=(s:Manuscript['sections'][number]):string[]=>{
  const lines:string[]=[];
  for(const b of s.blocks){
   if(b.kind==='figure'){
    const env=p.columns===2?'figure*':'figure';
    const graphic=p.figureWidthMm===178?`\\makebox[\\linewidth][c]{\\includegraphics[width=178mm]{${b.src.replace(/\.svg$/u,'.pdf')}}}`:`\\includegraphics[width=\\${p.columns===2?'textwidth':'linewidth'}]{${b.src.replace(/\.svg$/u,'.pdf')}}`;
    constructs.push(graphic);
    lines.push(`\\begin{${env}}[${p.columns===1?'hbp':'tp'}]`,'\\centering',graphic,`\\caption{${unit(b.caption,'caption')}}`,`\\end{${env}}`);
   } else if(b.kind==='table'){
    requireThat(b.header.length>0&&b.header.length<=12,'TeX: table has unsupported column count');
    const env=p.columns===2?'table*':'ombtableblock';
    lines.push(`\\begin{${env}}${p.columns===2?'[tp]':''}`,`\\caption{${unit(b.caption,'caption')}}`,'\\ombcaptionfont',`\\begin{tabularx}{\\linewidth}{@{}${b.header.map((_,col)=>b.rows.every(row=>/^[<>=−\-+\d.,\s]+$/u.test(row[col]!.text))?'r':b.header.length===3&&b.header[0]?.text==='Finding'?['F','R','E'][col]:'L').join('')}@{}}`,'\\ombtabletop',b.header.map(u=>`\\textbf{${unit(u)}}`).join(' & '),'\\ombtablemid',b.rows.map(row=>row.map(u=>unit(u)).join(' & ')).join(' \\\\\n'),'\\ombtablebottom','\\end{tabularx}');
    for(const u of b.notes)lines.push(unit(u),'\\par');
    lines.push(`\\end{${env}}`);
   } else if(b.kind==='paragraphs'&&b.presentation==='subheading'){lines.push(...b.units.map(u=>`\\subsection*{${unit(u)}}`));
   } else if(b.kind==='paragraphs'&&b.presentation==='description'){
    for(const row of new Set(b.units.map(u=>u.paragraph))){const us=b.units.filter(u=>u.paragraph===row);lines.push(us[1]?`\\item[] \\textbf{${unit(us[0]!)}} ${unit(us[1])}`:`\\item[] ${unit(us[0]!)}`);}
   } else {
    const paragraphs=new Map<number,Unit[]>();for(const u of b.units)paragraphs.set(u.paragraph,[...paragraphs.get(u.paragraph)??[],u]);
    for(const us of paragraphs.values()){
     const content=us.map(u=>unit(u,glossaries.has(s.id)?'term':'plain')).join(' ');
     if(glossaries.has(s.id))lines.push(`\\ombterm{${content}}`);
     else if(s.id==='abstract')lines.push(`\\ombabstract{${content}}`);
     else lines.push(content,'\\par');
    }
   }
  }
  return lines;
 };
 const section=(s:Manuscript['sections'][number]):string[]=>{
  if(s.id==='article-information')return ['\\begin{ombbox}',`\\ombboxtitle{${unit(s.heading)}}`,...blocks(s),'\\end{ombbox}'];
  if(boxes.has(s.id))return ['\\begin{ombbox}',`\\ombboxtitle{${unit(s.heading)}}`,...blocks(s),'\\end{ombbox}'];
  if(!visibleSectionHeading(s))return blocks(s);
  if(s.id==='keywords')return [`\\noindent\\textbf{${unit(s.heading)}} `,...blocks(s)];
  if(s.id==='preview-status')return ['{\\small\\itshape',`\\ombnotice{${unit(s.heading)}}`,...blocks(s),'}'];
  if(glossaries.has(s.id))return [`\\subsection*{${unit(s.heading)}}`,'\\begin{ombglossary}',...blocks(s),'\\end{ombglossary}'];
  return [...['results','discussion','supplement'].includes(s.id)?['\\FloatBarrier']:s.id==='references'?['\\ombdisplayboundary']:[],`\\${subsections.has(s.id)?'subsection':'section'}*{${unit(s.heading)}}`,...blocks(s)];
 };
 const footer=`\\ombval{footer-${m.buildId}}{${valueText(runningFooterText(m))}}`;bound.push(footer);
 const lines=[p.preamble,'\\begin{document}',`\\def\\ombfooterprefix{${footer}}`];
 // The host assembles the logical front matter first; TeX preserves this order.
 const firstBody=m.sections.findIndex(s=>s.id==='introduction');
 const frontEnd=firstBody>0?firstBody:m.sections[0]?.id==='abstract'?1:0;
 if(p.columns===2&&frontEnd){
  lines.push('\\twocolumn[\\begin{@twocolumnfalse}',`\\ombtitle{${unit(m.title)}}`);
  for(const s of m.sections.slice(0,frontEnd))lines.push(...section(s));
  lines.push('\\par\\vspace{\\baselineskip}\\end{@twocolumnfalse}]');
 }else lines.push(`\\ombtitle{${unit(m.title)}}`);
 for(const s of m.sections.slice(p.columns===2?frontEnd:0))lines.push(...section(s));
 lines.push(p.trailer,'\\end{document}');return {tex:lines.join('\n')+'\n',bound,constructs};
}
export function renderVerifiedTex(m:Manuscript,p:TexProfile):string{return document(m,p).tex;}
export function verifyTex(tex:string,m:Manuscript,p:TexProfile):void {
 const expected=document(m,p);let scanned=tex;
 for(const layout of [p.preamble,p.trailer]){const at=scanned.indexOf(layout);if(at>=0)scanned=scanned.slice(0,at)+scanned.slice(at+layout.length);}
 for(const token of [...expected.bound,...expected.constructs])scanned=scanned.replace(token,'');
 requireThat(!/\p{N}/u.test(scanned),'TeX: digit outside a bound value or pinned layout token');
 requireThat(tex===expected.tex,'TeX: source differs from verified fragments (value, order, or construct changed)');
}
export const texProfileHash=(p:TexProfile):string=>canonicalSha256(p);
