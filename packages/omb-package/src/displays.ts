import { assert, safePath } from './common.ts';
import type { Display, Manuscript } from './types.ts';

/** Conservative block reader for placement. Only prose paragraphs can establish a
 * first citation; code, headings, lists, quotes and table cells cannot hide one. */
export function paragraphs(markdown:string):{text:string;prose:boolean}[]{
  const blocks:{text:string;prose:boolean}[]=[];let lines:string[]=[],fence='';
  const flush=()=>{if(lines.length){const text=lines.join('\n');blocks.push({text,prose:!text.split('\n').some(line=>/^(?:\s*(?:#{1,6}\s|>|[-+*]\s|\d+[.)]\s|\||`{3,}|~{3,}|<)| {4}|\t)/.test(line))});lines=[];}};
  for(const line of markdown.split('\n')){
    const mark=line.match(/^\s*(`{3,}|~{3,})/);
    if(mark){if(!fence){flush();fence=mark[1]!;}else if(mark[1]![0]===fence[0]&&mark[1]!.length>=fence.length){lines.push(line);fence='';flush();continue;}}
    if(!line.trim()&&!fence)flush();else lines.push(line);
  }
  flush();return blocks;
}
export interface DisplayLocation { display:Display; label:string; anchor:string; citation:string; document:'main'|'supplement'; section:string; paragraph:number }
/** Explicit Markdown links keep numbering and PW3 display ids unambiguous. */
export function locateDisplays(m:Manuscript):DisplayLocation[]{
  assert(m.sections[0]?.id==='introduction','Introduction must be the first body section');
  assert(new Set(m.displays.map(d=>d.id)).size===m.displays.length,'duplicate display id');
  const sections=[...m.sections.map(s=>({...s,document:'main' as const})),...m.supplement.map(s=>({...s,document:'supplement' as const}))];
  let figures=0,tables=0;
  const locations=[...m.displays.filter(d=>d.placement==='main'),...m.displays.filter(d=>d.placement==='supplement')].map(display=>{
    safePath(display.id);
    const label=display.kind==='figure'?`Figure ${++figures}`:`Table ${++tables}`;
    const anchor=`${display.kind==='figure'?'fig':'tab'}-${display.id}`,citation=`[${label}](#${anchor})`;
    for(const section of sections){
      if(display.placement==='main'&&section.document!=='main')continue;
      const paragraph=paragraphs(section.markdown).findIndex(b=>b.prose&&[...b.text.replace(/`+[^`]*`+/g,'').matchAll(/(?<!!|\\)\[[^\]]+\]\(#[^)]+\)/g)].some(match=>match[0]===citation));
      if(paragraph>=0)return {display,label,anchor,citation,document:section.document,section:section.id,paragraph};
    }
    throw Error(`uncited display: ${display.id}; cite ${citation} in a body paragraph`);
  });
  for(const section of sections)for(const match of section.markdown.matchAll(/\[[^\]]+\]\(#((?:fig|tab)-[^)]+)\)/g))assert(locations.some(l=>l.citation===match[0]),`unknown or misnumbered display citation: ${match[0]}`);
  return locations;
}
