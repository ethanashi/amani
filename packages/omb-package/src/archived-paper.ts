/** Reading-draft renderer. No packaging certificate or owner receipt is issued. */
import path from 'node:path';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {assertArchivePaper,type ArchivePaper} from '../../omb-report/src/archived-paper.ts';
import {texEscape} from '../../omb-report/src/reverify/tex.ts';
import {verifiedTexProfile} from './pw8-render.ts';
import {checkTexSource} from './latex.ts';
import {checkLatexPdf} from './latex-checks.ts';
import {toolchain,command,ROOT} from './toolchain.ts';
import {assert} from './common.ts';
export function archivePaperTex(paper:ArchivePaper):string {
 assertArchivePaper(paper);const esc=(v:string)=>texEscape(v).replaceAll('−','-');
 const abstract=paper.sections.find(s=>s.heading==='Abstract');assert(abstract,'archive abstract missing');
 return [verifiedTexProfile(2).preamble,'\\begin{document}','\\twocolumn[\\begin{@twocolumnfalse}',
  '\\ombtitle{'+esc(paper.title)+'}',
  '\\ombnotice{Amani | Blind investigation | Reading preprint}',
  ...abstract.paragraphs.map(p=>'\\ombabstract{'+esc(p)+'}'),
  '\\par\\vspace{\\baselineskip}\\end{@twocolumnfalse}]',
  ...paper.sections.filter(s=>s!==abstract).flatMap(s=>['\\section*{'+esc(s.heading)+'}',...s.paragraphs.map(p=>esc(p)+'\n\\par')]),
  '\\end{document}',''].join('\n');
}
export async function renderArchivePaper(paper:ArchivePaper,directory:string):Promise<{pages:number;overfullWarnings:0}> {
 assertArchivePaper(paper);const dir=path.resolve(directory);mkdirSync(dir,{recursive:true});const tc=await toolchain();
 const tex=archivePaperTex(paper);checkTexSource(tex,JSON.parse(readFileSync(path.join(ROOT,'output-profiles/preprint-two-column.json'),'utf8')),'amani-a4@1');
 writeFileSync(path.join(dir,'paper.tex'),tex);
 await command(tc.tectonic,['--bundle',tc.texBundle,'--only-cached','--untrusted','--keep-logs','paper.tex'],dir);
 const log=readFileSync(path.join(dir,'paper.log'),'utf8');assert(!/Missing character:|Undefined control sequence|LaTeX Error:|Overfull \\[hv]box/u.test(log),'archive TeX: missing glyph, error or overflow');
 writeFileSync(path.join(dir,'paper.raw.pdf'),readFileSync(path.join(dir,'paper.pdf')));
 await command(tc.python,[path.join(ROOT,'scripts/normalize.py'),'pdf',path.join(dir,'paper.raw.pdf'),path.join(dir,'paper.pdf')]);
 const info=JSON.parse(await command(tc.python,[path.join(ROOT,'scripts/normalize.py'),'inspect-pdf',path.join(dir,'paper.pdf')]));checkLatexPdf(info);
 // Verify the actual PDF retains every paragraph in two-column reading order.
 const norm=(s:string)=>s.normalize('NFKC').replace(/(?<=[A-Za-z])-\s*(?=[A-Za-z])/gu,'').replace(/\s+/gu,'').replaceAll('−','-');
 const actual=norm(info.text);for(const text of [paper.title,...paper.sections.flatMap(s=>[s.heading==='Abstract'?'':s.heading,...s.paragraphs])])assert(actual.includes(norm(text)),'archive PDF text differs: '+text.slice(0,60));
 writeFileSync(path.join(dir,'paper.text.txt'),info.text);
 return {pages:info.pages,overfullWarnings:0};
}
