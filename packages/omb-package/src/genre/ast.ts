import { readFileSync } from 'node:fs';
import type { AstNode,Pandoc,Profile } from './types.ts';
const NORMALIZATION=JSON.parse(readFileSync(new URL('../../genre-normalization.json',import.meta.url),'utf8'));
const CANON=JSON.parse(readFileSync(new URL('./canon.json',import.meta.url),'utf8')) as [string,string][];
export const MAIN=new Set(['introduction','methods','results','results_discussion','discussion','limitations','conclusions']);
export const EXTENSIONS=new Set(['verification','abandoned']);
const SKIP_CLASSES=new Set(['figure','table','box','glossary','caption','references','protected-part-a','table-wrap','table-wrap-group']);
const SKIP_NODES=new Set(['Figure','Table','CodeBlock','RawBlock','Cite','Note','RawInline','Image','Header']);
export function attributes(n:AstNode):{id:string;classes:string[];kv:Record<string,string>} {
 const a=n.t==='Header'?n.c[1]:['Div','Span','Figure','Table','Image','Link','Code','CodeBlock'].includes(n.t)?n.c[0]:null;
 return a&&Array.isArray(a)?{id:a[0]??'',classes:a[1]??[],kv:Object.fromEntries(a[2]??[])}:{id:'',classes:[],kv:{}};
}
export const wordCount=(s:string)=>(s.match(/[A-Za-z0-9][A-Za-z0-9'.,%/\-]*/g)??[]).length;
export function inlinesText(xs:AstNode[]):string {return xs.map(n=>{
 if(['Cite','Note','RawInline','Image'].includes(n.t))return '';
 if(n.t==='Math')return n.c[0]?.t==='InlineMath'?n.c[1]:'';
 if(n.t==='Str')return n.c;
 if(['Space','SoftBreak','LineBreak'].includes(n.t))return ' ';
 if(n.t==='Span'&&attributes(n).classes.includes('abstract-heading'))return '';
 if(['Span','Link'].includes(n.t))return inlinesText(n.c[1]);
 if(n.t==='Quoted')return inlinesText(n.c[1]);
 return Array.isArray(n.c)?inlinesText(n.c):'';
 }).join('');}
export function proseText(blocks:AstNode[]):string {return blocks.map(n=>{
 if(SKIP_NODES.has(n.t))return '';
 if(n.t==='Para'||n.t==='Plain')return inlinesText(n.c);
 if(n.t==='Div')return attributes(n).classes.some(c=>SKIP_CLASSES.has(c))?'':proseText(n.c[1]);
 if(n.t==='BulletList')return n.c.map((b:AstNode[])=>proseText(b)).join('\n');
 if(n.t==='OrderedList')return n.c[1].map((b:AstNode[])=>proseText(b)).join('\n');
 if(n.t==='BlockQuote')return proseText(n.c);
 if(n.t==='DefinitionList')return n.c.map((x:any)=>x[1].map((bs:AstNode[])=>proseText(bs)).join('\n')).join('\n');
 return '';
 }).join('\n');}
function inlineWords(nodes:AstNode[]):number {return nodes.reduce((sum,n)=>{
 if(n.t==='Str')return sum+wordCount(n.c);
 if(['Cite','Note','RawInline','Image'].includes(n.t)||n.t==='Span'&&attributes(n).classes.includes('abstract-heading'))return sum;
 if(n.t==='Math')return sum+(n.c[0]?.t==='InlineMath'?wordCount(n.c[1]):0);
 if(['Span','Link','Quoted'].includes(n.t))return sum+inlineWords(n.c[1]);
 return sum+(Array.isArray(n.c)?inlineWords(n.c):0);
 },0);}
export function countWords(blocks:AstNode[]):number {return blocks.reduce((sum,n)=>{
 if(SKIP_NODES.has(n.t))return sum;
 if(n.t==='Para'||n.t==='Plain')return sum+inlineWords(n.c);
 if(n.t==='Div')return sum+(attributes(n).classes.some(c=>SKIP_CLASSES.has(c))?0:countWords(n.c[1]));
 if(n.t==='BulletList')return sum+n.c.reduce((v:number,b:AstNode[])=>v+countWords(b),0);
 if(n.t==='OrderedList')return sum+n.c[1].reduce((v:number,b:AstNode[])=>v+countWords(b),0);
 if(n.t==='BlockQuote')return sum+countWords(n.c);
 if(n.t==='DefinitionList')return sum+n.c.reduce((v:number,x:any)=>v+x[1].reduce((w:number,b:AstNode[])=>w+countWords(b),0),0);
 return sum;
 },0);}
export function fullText(v:any):string {if(Array.isArray(v))return v.map(fullText).join(' ').replace(/\s+/g,' ').trim();if(!v||typeof v!=='object')return '';if(v.t==='Str')return v.c;if(v.t==='Code')return v.c[1];return fullText(v.c);}
export function allNodes(value:any):AstNode[]{if(Array.isArray(value))return value.flatMap(allNodes);if(!value||typeof value!=='object')return [];return [...(typeof value.t==='string'?[value]:[]),...allNodes(value.c)];}
export function normalizeHeading(s:string):string {return s.toLowerCase().replace(/^\s*(?:\d+(?:\.\d+)*[.)]?|[ivxlcdm]+[.)])\s+/i,'').replace(/\s+/g,' ').replace(/:\s*$/,'').trim();}
export function headingId(heading:string,p:Profile):string|null {
 const text=normalizeHeading(heading);
 if(text==='main')return 'introduction';
 if(/^conclusions?$/.test(text))return 'conclusions';
 if(p.genre==='ai-research-agent-methods'&&NORMALIZATION.agentResultsHeadingPatterns.some((rx:string)=>new RegExp(rx,'i').test(text)))return 'results';
 if(/^verification and robustness|^verification$/.test(text))return 'verification';
 if(/^analyses abandoned|^abandoned analyses/.test(text))return 'abandoned';
 if(/^code (availability|sharing)|^software availability/.test(text))return 'code_availability';
 if(/^data and code availability/.test(text))return 'data_availability';
 if(/^results and discussion$/.test(text))return 'results_discussion';
 if(/^back matter$/.test(text))return 'back_matter';
 if(/^abstract$/.test(text))return 'abstract';if(/^plain summary|^author summary/.test(text))return 'plain_summary';
 for(const section of p.sections)if(normalizeHeading(section.heading)===text)return section.id;
 for(const section of p.sections)if(section.aliases.some(a=>normalizeHeading(a)===text))return section.id;
 for(const [id,rx] of CANON)if(new RegExp(rx,'i').test(text))return id==='supplementary'?'supplement':id;
 return null;
}
export interface SectionView {id:string;ids:string[];heading:string;level:number;location:string;blocks:AstNode[];subsections:{heading:string;id:string|null;blocks:AstNode[]}[];fallback:boolean;words:number;prose:string}
export interface DisplayView {id:string;kind:string|null;kinds:string[];type:string;caption:string;typed:boolean;blocks:AstNode[]}
export function captionText(n:AstNode):string {
 if(n.t==='Table'||n.t==='Figure')return fullText(n.c[1]);
 if(n.t==='Image')return fullText(n.c[1]);
 if(n.t==='Div')return n.c[1].map((b:AstNode)=>b.t==='Table'||b.t==='Figure'?captionText(b):fullText(b)).join(' ');
 return fullText(n);
}
export function classifyCaption(caption:string,p:Profile,type?:string):string[]{return p.display_items.filter(d=>(!type||d.type===type)&&[...d.detect,...(NORMALIZATION.captionAliases?.[p.genre]?.[d.id]??[])].some(rx=>new RegExp(rx,'i').test(caption))).map(d=>d.id);}
export function displays(blocks:AstNode[],p:Profile):DisplayView[]{
 const out:DisplayView[]=[];
 const visit=(xs:AstNode[])=>{for(const n of xs){const a=attributes(n);let type=['Figure','Image'].includes(n.t)?'figure':n.t==='Table'?'table':n.t==='Div'&&a.classes.some(c=>['figure','table','table-wrap','box','glossary'].includes(c))?(a.classes.some(c=>['table','table-wrap'].includes(c))?'table':a.classes.includes('figure')?'figure':'box'):null;
  if(type){const tagged=n.t==='Figure'?allNodes(n).find(x=>x.t==='Image'&&attributes(x).kv.kind):undefined;let declared=a.kv.kind??(tagged?attributes(tagged).kv.kind:undefined);const caption=captionText(n);let kinds=declared?declared.split(/[ ,]+/).filter(Boolean):classifyCaption(caption,p,type);let kind=kinds[0]??null;
   if(kinds.includes('sof_table')){const table=allNodes(n).find(x=>x.t==='Table');const columns=table?fullText(table.c[3]):'';if(!/GRADE|certainty/i.test(columns)||!/absolute|risk difference|per 1000/i.test(columns)){kinds=kinds.filter(k=>k!=='sof_table');kinds.push('results_table');kind=kinds[0]??null;}}
   out.push({id:a.id||`display-${out.length+1}`,kind,kinds,type,caption,typed:!!declared,blocks:[n]});continue;
  }
  if(n.t==='Div')visit(n.c[1]);else if(n.t==='Para'||n.t==='Plain')visit(n.c);else if(n.t==='BulletList')n.c.forEach(visit);else if(n.t==='OrderedList')n.c[1].forEach(visit);
 }};visit(blocks);return out;
}
export function sections(ast:Pandoc,p:Profile):SectionView[]{
 const result:SectionView[]=[];let current:SectionView|undefined;
 const create=(id:string,heading:string,level:number,location:string,blocks:AstNode[],fallback:boolean)=>{const s:SectionView={id,ids:[id],heading,level,location,blocks,subsections:[],fallback,words:0,prose:''};if(/^data and code availability$/i.test(heading))s.ids.push('code_availability');result.push(s);return s;};
 const visit=(blocks:AstNode[])=>{for(const n of blocks){const a=attributes(n),explicit=a.kv['section-id'];
  if(n.t==='Div'&&(explicit||a.classes.includes('abstract')||a.classes.includes('title-page'))){const saved=current;const id=explicit??(a.classes.includes('abstract')?'abstract':'title');current=create(id,id,1,a.id||id,[],false);visit(n.c[1]);current=saved;continue;}
  if(n.t==='Header'){
   const heading=inlinesText(n.c[2]),id=explicit??headingId(heading,p)??'unknown';
   if(current?.id==='title'){current.blocks.push({t:'Para',c:n.c[2]});continue;}
   if(n.c[0]===1&&current?.id===id&&(current.heading===id||current.heading==='Untitled introduction')){current.heading=heading;current.location=a.id||heading;}
   else if(n.c[0]===1)current=create(id,heading,1,a.id||heading,[],!explicit&&id!=='unknown');
   else if(current){current.subsections.push({heading,id,blocks:[]});current.blocks.push(n);if(['declarations','back_matter'].includes(current.id)&&id!=='unknown')create(id,heading,n.c[0],a.id||heading,[],!explicit);}
   continue;
  }
  if(!current){if(['Para','Plain'].includes(n.t))current=create('introduction','Untitled introduction',1,'untitled-introduction',[],false);else if(n.t==='Div'&&!a.classes.some(c=>SKIP_CLASSES.has(c)))visit(n.c[1]);}
  if(current){current.blocks.push(n);const sub=current.subsections.at(-1);if(sub)sub.blocks.push(n);if(['declarations','back_matter'].includes(current.id)){const alias=result.at(-1);if(alias&&alias!==current)alias.blocks.push(n);}}
 }};
 if(ast.meta.title){const title=ast.meta.title;create('title','Title',1,'title',[{t:'Para',c:title.t==='MetaInlines'?title.c:[{t:'Str',c:fullText(title)}]}],false);}
 if(ast.meta.abstract){const ab=ast.meta.abstract;const view=create('abstract','Abstract',1,'abstract',ab.t==='MetaBlocks'?ab.c:[],false);for(const n of allNodes(view.blocks))if(n.t==='Header')view.subsections.push({heading:inlinesText(n.c[2]),id:null,blocks:[]});}
 visit(ast.blocks);
 if(!result.some(s=>s.id==='results'||s.id==='results_discussion')){
  const intro=result.findIndex(s=>s.id==='introduction'),discussion=result.findIndex(s=>s.id==='discussion');
  if(intro>=0&&discussion>intro&&normalizeHeading(result[intro]!.heading)==='main')for(const s of result.slice(intro+1,discussion))if(s.id==='unknown'&&s.level===1){s.id='results';s.ids=['results'];s.fallback=true;}
 }
 for(const m of ast.meta['jats-statements']?.c??[]){const data=m.c,id=data.id?.c,text=data.text?.c;if(typeof id==='string'&&typeof text==='string'&&text.trim()){
  const statement=id==='contributions'?'author_contributions':id;
  create(id,id,2,'jats-metadata/'+data.source.c,[{t:'Div',c:[['',[],[['statement-id',statement]]],[{t:'Para',c:[{t:'Str',c:text}]}]]}],false);
 }}
 for(const s of result){s.prose=proseText(s.blocks);s.words=countWords(s.blocks);if(s.id==='abstract'&&!s.subsections.length)for(const n of s.blocks){const label=n.t==='Para'?n.c[0]:undefined;if(label?.t==='Span'&&attributes(label).classes.includes('abstract-heading'))s.subsections.push({heading:fullText(label).replace(/[.:]$/,''),id:null,blocks:[]});
 if(n.t==='Para'&&n.c[0]?.t==='Strong'&&inlinesText(n.c[0].c).length<55&&/^(Question|Data|Design|Pre-registration|Primary result|Conclusion|Registration|Background|Methods|Findings|Interpretation|Funding|Importance|Objective|Purpose|Results|Availability|Motivation)/i.test(inlinesText(n.c[0].c)))s.subsections.push({heading:inlinesText(n.c[0].c).replace(/[.:]$/,''),id:null,blocks:[]});}}
 return result;
}
export function protectedWords(blocks:AstNode[]):number {let n=0;for(const b of blocks){if(b.t==='Div'){if(attributes(b).classes.includes('protected-part-a'))n+=countWords(b.c[1]);else n+=protectedWords(b.c[1]);}}return n;}
