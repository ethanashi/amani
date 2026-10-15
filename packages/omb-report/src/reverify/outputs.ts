/**
 * PW8 output read-back: the rendered PDF and DOCX must carry exactly the verified manuscript.
 * Text is checked against the expected flow (flow.ts); every other channel that can carry a
 * number is checked too: PDF Info, XMP, tags (/Alt, /ActualText), marked content, annotations,
 * outlines and hidden runs; DOCX alt text, document properties, comments, headers, footers,
 * footnotes, fields, text boxes, tracked changes and hidden or tiny runs (docx.ts).
 */
import { requireThat } from '../common.ts';
import { checkFlow, expectedAltTexts, expectedFlow, normaliseExtracted, type FlowIssue } from './flow.ts';
import { visibleSectionHeading, allUnits, type Manuscript } from './manuscript.ts';
import { pinnedPdfExtractor, type ExtractedPdf, type PdfTextExtractor } from './pdf.ts';

export type OutputIssueCode = FlowIssue['code'] | 'layout' | 'extract' | 'hidden-text' | 'metadata' | 'alt-text' | 'marked-content' | 'annotation' | 'outline';
export interface OutputIssue { readonly code: OutputIssueCode; readonly where: string; readonly detail: string }
export interface OutputVerification { readonly ok: boolean; readonly issues: readonly OutputIssue[] }

export type PdfLayoutSlot = readonly [page:number, x:number, y:number, size:number, separatorBefore?:string, rotation?:number, discretionaryHyphenText?:string];
export interface PdfFurniture {readonly kind:'page'|'line'|'running-footer';readonly page:number;readonly x:number;readonly y:number;readonly size:number;readonly text:string}
export interface PdfProfile {
  /** Explicit trusted margin labels; never a general number allowlist. */
  readonly furniture?:readonly PdfFurniture[];
  readonly runningFooter?:string;
  /** Hashes of complete font dictionaries, encodings, CMaps and embedded font programs. */
  /** Run positions in trusted source reading order, emitted by the renderer. */
  readonly layout?: readonly PdfLayoutSlot[];
  readonly visualAssets?: readonly { readonly sha256: string; readonly figureSha256: string }[];
  readonly fontSha256?: readonly string[];
  readonly figures: 'vector' | 'raster';
  readonly pageNumbers?: boolean;
  /** Exact Info values pinned by the trusted PW9 chain (Creator, Producer, dates). Title is always the manuscript title. */
  readonly info?: Readonly<Record<string, string>>;
  /** Text drawn smaller than this (points) is hidden text. Default 3. */
  readonly minFontSize?: number;
  /** Every figure must keep its alt text in the PDF tags. Default true. */
  readonly requireAlt?: boolean;
  readonly extractor?: PdfTextExtractor;
}

const LIGATURES = new Set(['ff', 'fi', 'fl', 'ffi', 'ffl', 'ft', 'st']);

function multisetIssues(actual: readonly string[], expected: readonly string[], requireAll: boolean, where: string): OutputIssue[] {
  const pool = [...expected];
  const issues: OutputIssue[] = [];
  for (const a of actual.map(normaliseExtracted)) {
    const k = pool.indexOf(a);
    if (k >= 0) pool.splice(k, 1);
    else issues.push({ code: 'alt-text', where, detail: `alt text "${a.slice(0, 100)}" is not a verified figure alt text` });
  }
  if (requireAll) for (const p of pool) issues.push({ code: 'alt-text', where, detail: `verified alt text "${p.slice(0, 80)}" is missing` });
  return issues;
}

export function verifyPdf(input: Uint8Array | ExtractedPdf, expected: Manuscript, profile: PdfProfile): OutputVerification {
  let x: ExtractedPdf;
  try { x = input instanceof Uint8Array ? (profile.extractor ?? pinnedPdfExtractor).extract(input) : input; }
  catch (error) { return { ok: false, issues: [{ code: 'extract', where: 'pdf', detail: error instanceof Error ? error.message : 'unreadable PDF' }] }; }
  const issues: OutputIssue[] = [];
  let ordered:typeof x.runs[number][];
  try{ordered=withoutFurniture(x,profile.furniture??[],profile.runningFooter);}catch(e){return {ok:false,issues:[{code:'layout',where:'pdf numbering',detail:e instanceof Error?e.message:'invalid numbering'}]};}
  const readback = new Map<typeof ordered[number],string>();
  const separators = new Map<typeof ordered[number], string>();
  if (profile.layout) {
    const slots = new Map<string, number[]>();
    profile.layout.forEach((position, index) => { const key = JSON.stringify([...position.slice(0,4),position[5]??0]); slots.set(key, [...slots.get(key) ?? [], index]); });
    const ranked = ordered.map(run => {
      const index = slots.get(JSON.stringify([run.page, run.x, run.y, run.size,run.rotation??0]))?.shift();
      if (index === undefined) issues.push({code:'layout', where:`page ${run.page}`, detail:'text moved outside the trusted layout'});
      const hyphen=index===undefined?undefined:profile.layout?.[index]?.[6];
      if(hyphen!==undefined){
        if(hyphen!==run.text||!(run.text==='-'||/[\p{L}]-$/u.test(run.text)))issues.push({code:'layout',where:`page ${run.page}`,detail:'discretionary hyphen differs from trusted source layout'});
        else readback.set(run,run.text.slice(0,-1));
      }
      const separator = index === undefined ? undefined : profile.layout?.[index]?.[4];
      if (separator !== undefined) {
        if (!/^[ ]?$/u.test(separator)) issues.push({code:'layout', where:'pdf layout', detail:'unsupported layout separator'});
        separators.set(run,separator);
      }
      return {run, index:index ?? Number.MAX_SAFE_INTEGER};
    });
    if ([...slots.values()].some(indices => indices.length)) issues.push({code:'missing-unit', where:'pdf layout', detail:'trusted text position missing'});
    ordered = ranked.sort((a,b) => a.index - b.index).map(x => x.run);
  } else {
    if(ordered.some(r=>r.rotation))issues.push({code:'layout',where:'pdf layout',detail:'rotated text requires a trusted orientation map'});
    // Best-effort single-column geometry. Complex layouts require a trusted structure map.
    ordered.sort((a,b) => a.page - b.page || (Math.abs(a.y-b.y) > Math.min(a.size,b.size)*0.25 ? b.y-a.y : a.x-b.x));
  }
  const pages = x.pages.map((_, i) => {
    let text = '', last: typeof ordered[number] | undefined;
    for (const run of ordered.filter(r => r.page === i+1)) {
      if (separators.has(run)) text += separators.get(run)!;
      else if (last && Math.abs(run.y-last.y) > Math.max(1, run.size*0.5)) text += '\n';
      text += readback.get(run)??run.text; last = run;
    }
    return text;
  });
  // A complete trusted run map supplies every boundary, including page breaks.
  // Injecting another newline here would change a hash/number split by pagination.
  // Legacy profiles without explicit separators retain the original page gaps.
  const flowPages=profile.layout?.every(slot=>slot[4]!==undefined)&&!profile.pageNumbers?[ordered.map(run=>(separators.get(run)??'')+(readback.get(run)??run.text)).join('')]:pages;
  issues.push(...checkFlow(expectedFlow(expected), flowPages, profile));
  for (const hash of x.fontSha256 ?? []) if (!profile.fontSha256?.includes(hash)) issues.push({code:'extract', where:'pdf font', detail:'unsupported font mapping'});
  const figureHashes = expected.sections.flatMap(s => s.blocks.flatMap(b => b.kind === 'figure' ? [b.svgSha256] : []));
  const assets = [...profile.visualAssets ?? []];
  for (const hash of x.visualSha256 ?? []) {
    const i = assets.findIndex(a => a.sha256 === hash && figureHashes.includes(a.figureSha256));
    if (i < 0) issues.push({code:'extract', where:'pdf visual asset', detail:'undeclared image, form or appearance stream'});
    else assets.splice(i, 1);
  }
  if (assets.length) issues.push({code:'extract', where:'pdf visual asset', detail:'declared visual asset is missing'});
  const min = profile.minFontSize ?? 3;
  for (const r of x.runs) {
    if (!r.text.trim()) continue;
    if (r.invisible) issues.push({ code: 'hidden-text', where: `page ${r.page}`, detail: `invisible text "${r.text.slice(0, 40)}"` });
    if (r.offPage) issues.push({ code: 'hidden-text', where: `page ${r.page}`, detail: `text outside the page "${r.text.slice(0, 40)}"` });
    if (r.size < min) issues.push({ code: 'hidden-text', where: `page ${r.page}`, detail: `text below ${min} pt "${r.text.slice(0, 40)}"` });
  }
  const pinned = profile.info ?? {};
  for (const [k, v] of Object.entries(x.info)) {
    if (k === 'Title') { if (normaliseExtracted(v) !== normaliseExtracted(expected.meta.title.text)) issues.push({ code: 'metadata', where: 'pdf Info Title', detail: `title "${v}" differs from the manuscript title` }); }
    else if (pinned[k] !== v) issues.push({ code: 'metadata', where: `pdf Info ${k}`, detail: `"${v.slice(0, 80)}" is not a value pinned by the chain profile` });
  }
  if (x.xmp) issues.push({ code: 'metadata', where: 'pdf XMP', detail: 'an XMP metadata stream is present' });
  issues.push(...multisetIssues(x.structure.filter((s) => s.key === 'Alt').map((s) => s.value), expectedAltTexts(expected), profile.requireAlt ?? true, 'pdf tags'));
  for (const s of [...x.structure.filter((s) => s.key !== 'Alt'), ...x.markedContent]) {
    if (!(s.key === 'ActualText' && LIGATURES.has(s.value))) issues.push({ code: 'marked-content', where: `pdf ${s.key}`, detail: `"${s.value.slice(0, 60)}" can replace the visible text` });
  }
  for (const a of x.annotations) issues.push({ code: 'annotation', where: `pdf ${a.key}`, detail: `annotation "${a.value.slice(0, 60)}" is not part of the verified manuscript` });
  const headings = new Set(allUnits(expected).filter((u) => u.container === 'heading' || u.container === 'title').map((u) => normaliseExtracted(u.text)));
  for (const o of x.outlines) if (!headings.has(normaliseExtracted(o))) issues.push({ code: 'outline', where: 'pdf outline', detail: `outline entry "${o.slice(0, 60)}" is not a verified heading` });
  return { ok: issues.length === 0, issues };
}

/** Build source/layout evidence only from a trusted renderer preparation run, never a submission.
 * Internal run whitespace is immutable. A separator may be inserted only at a recorded run
 * boundary and only when the verified source requires it (including SVG text/unit boundaries).
 */
export function withoutFurniture(pdf:ExtractedPdf,furniture:readonly PdfFurniture[],runningFooter?:string):typeof pdf.runs[number][] {
 const remaining=[...pdf.runs],footerPages=new Map<number,PdfFurniture[]>(),groups=new Map<string,PdfFurniture[]>();
 for(const f of furniture){
  if(f.kind==='running-footer'){requireThat(!!runningFooter&&f.y>=0&&f.y<54&&f.size>=7&&f.size<=10,'PDF: invalid running footer region');const index=remaining.findIndex(r=>r.page===f.page&&r.x===f.x&&r.y===f.y&&r.size===f.size&&r.text===f.text);requireThat(index>=0,'PDF: running footer missing or moved');remaining.splice(index,1);footerPages.set(f.page,[...footerPages.get(f.page)??[],f]);continue;}
  requireThat(/^\d+$/u.test(f.text)&&f.size>=3,'PDF: invalid numbering value');
  if(f.kind==='line')requireThat(f.x>=0&&f.x<54&&f.y>54,'PDF: line number outside margin');
  else requireThat(f.kind==='page'&&f.y>=0&&f.y<54,'PDF: invalid page number');
  const index=remaining.findIndex(r=>r.page===f.page&&r.x===f.x&&r.y===f.y&&r.size===f.size&&r.text===f.text);requireThat(index>=0,'PDF: trusted number missing or moved');remaining.splice(index,1);
  const key=[f.kind,f.page,f.y,f.size].join(':');groups.set(key,[...groups.get(key)??[],f]);
 }
 if(runningFooter){requireThat(footerPages.size===pdf.pages.length,'PDF: running footer coverage differs');for(const [page,runs] of footerPages){runs.sort((a,b)=>a.x-b.x);requireThat(runs.every(r=>Math.abs(r.y-runs[0]!.y)<1),'PDF: footer is not a single line');requireThat(normaliseExtracted(runs.map(r=>r.text).join('')).replace(/\s/gu,'')===normaliseExtracted(`${runningFooter} ${page} / ${pdf.pages.length}`).replace(/\s/gu,''),'PDF: running footer text or page total differs');}}
 const lineValues:number[]=[],pages=new Set<number>();
 for(const runs of groups.values()){
  runs.sort((a,b)=>a.x-b.x);const text=runs.map(r=>r.text).join(''),first=runs[0]!;requireThat(/^[1-9]\d*$/u.test(text),'PDF: invalid numbering value');
  if(first.kind==='line')lineValues.push(Number(text));else{requireThat(Number(text)===first.page&&!pages.has(first.page),'PDF: invalid page number');pages.add(first.page);}
 }
 lineValues.sort((a,b)=>a-b);requireThat(lineValues.every((v,i)=>v===i+1),'PDF: line numbers are not consecutive');
 requireThat(!pages.size||pages.size===pdf.pages.length,'PDF: page-number coverage differs');return remaining;
}
export function trustedPdfLayout(pdf: ExtractedPdf, m: Manuscript, furniture:readonly PdfFurniture[]=[],runningFooter?:string): PdfLayoutSlot[] {
  const runs=withoutFurniture(pdf,furniture,runningFooter),assigned=new Map<number,{start:number;end:number;hyphen?:string}>();
  const floats=new Map<string,string>();
  for(const s of m.sections)for(const b of s.blocks){
    if(b.kind==='figure')floats.set(b.caption.block,[...b.svgTexts,b.caption.text].filter(Boolean).map(normaliseExtracted).join(' '));
    if(b.kind==='table')floats.set(b.caption.block,[b.caption,...b.header,...b.rows.flat(),...b.notes].map(u=>normaliseExtracted(u.text)).filter(Boolean).join(' '));
  }
  for(const [block,text] of floats)if(!text)floats.delete(block);
  const items:{text:string;block:string}[]=[];
  const add=(text:string,block:string)=>{if(text)items.push({text:normaliseExtracted(text),block});};
  add(m.title.text,m.title.block);
  for(const s of m.sections){if(visibleSectionHeading(s))add(s.heading.text,s.heading.block);for(const b of s.blocks){
    if(b.kind==='figure'){for(const text of b.svgTexts)add(text,b.caption.block);add(b.caption.text,b.caption.block);}
    else if(b.kind==='table')for(const u of [b.caption,...b.header,...b.rows.flat(),...b.notes])add(u.text,b.caption.block);
    else for(const u of b.units)add(u.text,u.block);
  }}
  // Only a complete figure or table can move. Individual values cannot.
  const starts:number[]=[];let source='';for(const item of items){if(source)source+=' ';starts.push(source.length);source+=item.text;}
  let lastMismatch='';
  const consume=(text:string,indices:number[],start:number,partial=false)=>{
    if(!text)return [];
    const found:{index:number;start:number;end:number;hyphen?:string}[]=[];let cursor=0;
    for(let n=start;n<indices.length;n++){
      const index=indices[n]!,run=runs[index]!;let value=normaliseExtracted(run.text),skip=0,hyphen:string|undefined;
      while(!text.startsWith(value,cursor+skip)&&text[cursor+skip]===' ')skip++;
      if(!text.startsWith(value,cursor+skip)){
        lastMismatch=`page ${run.page}: expected ${JSON.stringify(text.slice(cursor+skip,cursor+skip+100))}, extracted ${JSON.stringify(value)}`;
        const next=runs[indices[n+1]??-1],trimmed=value.slice(0,-1);
        // Only source-proven alphabetic line breaks from the trusted preparation.
        // A minus, digit, lexical hyphen or same-line edit is never normalized.
        const previous=runs[indices[n-1]??-1],standalone=value==='-'&&!!previous&&/\p{L}$/u.test(previous.text)&&/\p{L}$/u.test(text.slice(0,cursor+skip));
        if(!next||!(standalone||/[\p{L}]-$/u.test(value))||!/^\p{L}/u.test(next.text)||!(next.page!==run.page||Math.abs(next.y-run.y)>run.size/2)||!text.startsWith(trimmed,cursor+skip)||!/^\p{L}/u.test(text.slice(cursor+skip+trimmed.length)))return null;
        hyphen=run.text;value=trimmed;
      }
      if(skip>1)return null;
      found.push({index,start:cursor+skip,end:cursor+skip+value.length,...hyphen?{hyphen}:{}});cursor+=skip+value.length;
      if(cursor===text.length)return found;
    }return partial?found:null;
  };
  for(const [block,text] of floats){
    const indices=runs.map((_,i)=>i).filter(i=>!assigned.has(i)),matches=[];
    for(let i=0;i<indices.length;i++){const found=consume(text,indices,i);if(found)matches.push(found);}
    requireThat(matches.length===1,`PDF: movable block ${block} is missing, changed or ambiguous`);
    const offset=starts[items.findIndex(i=>i.block===block)]!;
    for(const hit of matches[0]!)assigned.set(hit.index,{start:offset+hit.start,end:offset+hit.end,...hit.hyphen?{hyphen:hit.hyphen}:{}});
  }
  let body='';const positions:number[]=[];
  items.forEach((item,i)=>{if(floats.has(item.block))return;if(body){body+=' ';positions.push(starts[i]!-1);}for(let c=0;c<item.text.length;c++){body+=item.text[c];positions.push(starts[i]!+c);}});
  const remaining=runs.map((_,i)=>i).filter(i=>!assigned.has(i));
  const matched=consume(body,remaining,0,true);
  requireThat(matched&&matched.length===remaining.length,'PDF: trusted layout does not align to verified source: '+lastMismatch);
  for(const hit of matched)assigned.set(hit.index,{start:positions[hit.start]!,end:positions[hit.end-1]!+1,...hit.hyphen?{hyphen:hit.hyphen}:{}});
  let cursor=0;const layout:PdfLayoutSlot[]=[];
  for(const [index,span] of [...assigned].sort((a,b)=>a[1].start-b[1].start)){
    const separator=source.slice(cursor,span.start);requireThat(separator===''||separator===' ','PDF: trusted layout omits verified source');
    const r=runs[index]!;layout.push(span.hyphen?[r.page,r.x,r.y,r.size,separator,r.rotation??0,span.hyphen]:r.rotation?[r.page,r.x,r.y,r.size,separator,r.rotation]:[r.page,r.x,r.y,r.size,separator]);cursor=span.end;
  }
  requireThat(cursor===source.length&&layout.length===runs.length,'PDF: trusted layout omits verified source');return layout;
}
