/** Independent read-back: invert certified mark encodings; compare lexical nodes in order;
 * compare remaining geometry to the trusted deterministic renderer. Never trust SVG metadata
 * as the expected data. Callers supply a freshly regenerated RenderedFigure. */
import type { Scale } from './scale.ts';
import type { SvgNode, ParsedElement } from './xml.ts';
import { attr, classes, ownText, parseSvg, walk } from './xml.ts';
import { parseCsv } from './csv.ts';
import type { RenderedFigure } from './render.ts';
import { sha256 } from './provenance.ts';
export interface MarkEncoding {
  readonly factId: string; readonly index: number | null;
  readonly axis: 'x' | 'y'; readonly scale: Pick<Scale,'type'|'domain'|'range'>;
  readonly transform?: 'identity' | 'negative-log10' | 'absolute' | 'negate';
  /** Polyline vertex index; omitted for point centres. */
  readonly vertex?: number;
}
export interface NumericMark { readonly key: string; readonly encodings: readonly MarkEncoding[] }
export function tagMark(node: SvgNode, key: string): SvgNode { return {...node, attrs:[...node.attrs,['data-fact',key]]}; }
const numbers = (s: string): number[] => (s.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
function position(e: ParsedElement, encoding: MarkEncoding): number {
  const axis = encoding.axis, offset = axis === 'x' ? 0 : 1;
  if (encoding.vertex !== undefined) return numbers(attr(e,'points') ?? '')[encoding.vertex*2+offset] ?? NaN;
  if (e.tag === 'circle') return Number(attr(e,axis === 'x' ? 'cx':'cy') ?? NaN);
  if (e.tag === 'path') {
    const pairs = numbers(attr(e,'d') ?? '').filter((_,i)=>i%2===offset);
    const lo=Math.min(...pairs),hi=Math.max(...pairs);
    if(axis==='y' && classes(e).includes('shape-up')) return lo*0.4+hi*0.6;
    if(axis==='y' && classes(e).includes('shape-down')) return lo*0.6+hi*0.4;
    return (lo+hi)/2;
  }
  return NaN;
}
const untransform = (v: number, t: MarkEncoding['transform']): number => t === 'negative-log10' ? 10**(-v) : t === 'negate' ? -v : v;
function inverse(px: number, s: MarkEncoding['scale']): number {
  const fraction = (px-s.range[0])/(s.range[1]-s.range[0]);
  return s.type === 'log' ? 10**(Math.log10(s.domain[0])+fraction*Math.log10(s.domain[1]/s.domain[0])) : s.domain[0]+fraction*(s.domain[1]-s.domain[0]);
}
export interface RoundTripResult { readonly ok: boolean; readonly numeric: readonly string[]; readonly lexical: readonly string[]; readonly provenance: readonly string[] }
export function checkFigureRoundTrip(svg: string, sourceCsv: string, expected: RenderedFigure): RoundTripResult {
  const numeric: string[] = [], lexical: string[] = [], provenance: string[] = [];
  const actual = parseSvg(svg), trusted = parseSvg(expected.svg);
  if (!actual.root || actual.issues.length || !trusted.root) return {ok:false,numeric:['unreadable SVG'],lexical:[],provenance:[]};
  const a = [...walk(actual.root)], b = [...walk(trusted.root)];
  if (sha256(sourceCsv) !== expected.provenance.csvSha256) provenance.push('CSV hash mismatch');
  if (sha256(svg) !== expected.sha256) provenance.push('SVG hash mismatch');
  const meta = a.filter(e=>e.tag==='metadata'), expectedMeta=b.filter(e=>e.tag==='metadata');
  if (meta.length !== 1 || ownText(meta[0]!) !== ownText(expectedMeta[0]!)) provenance.push('metadata mismatch');
  const text = (nodes: ParsedElement[]) => nodes.filter(e=>['text','title','desc'].includes(e.tag)).map(ownText);
  if (JSON.stringify(text(a)) !== JSON.stringify(text(b))) lexical.push('ordered label/CSV text mismatch');
  // Parse CSV independently. Data-fact points to a trusted encoding, not a value supplied by SVG.
  const rows = parseCsv(expected.sourceCsv), header = rows[0] ?? [];
  const idAt=header.indexOf('fact_id'), indexAt=header.indexOf('index'), valueAt=header.indexOf('value');
  for (const mark of expected.numericMarks) {
    const matches = a.filter(e=>attr(e,'data-fact')===mark.key);
    if (matches.length !== 1) { numeric.push(`missing/duplicate mark ${mark.key}`); continue; }
    for (const encoding of mark.encodings) {
      const row=rows.slice(1).find(r=>r[idAt]===encoding.factId && r[indexAt]===(encoding.index===null?'':String(encoding.index)));
      const raw = row ? Number(row[valueAt]) : NaN;
      const value=encoding.transform==='absolute' ? Math.abs(raw) : raw;
      const px=position(matches[0]!,encoding), read=untransform(inverse(px,encoding.scale),encoding.transform);
      const endpoints=[px-0.5,px+0.5].map(p=>untransform(inverse(p,encoding.scale),encoding.transform));
      if (!Number.isFinite(value) || !Number.isFinite(read) || value < Math.min(...endpoints)-1e-12 || value > Math.max(...endpoints)+1e-12) numeric.push(`round-trip ${encoding.factId} at ${mark.key}`);
    }
  }
  // Covers CI, reference, band, fit, clipping and flow geometry, including missing/extra marks.
  const geometry = ['x','y','cx','cy','x1','y1','x2','y2','r','width','height','points','d','transform'];
  if (a.length!==b.length) numeric.push('element count mismatch');
  for (let i=0;i<Math.min(a.length,b.length);i++) {
    if (a[i]!.tag!==b[i]!.tag || attr(a[i]!,'data-fact')!==attr(b[i]!,'data-fact')) { numeric.push(`element identity ${i}`); continue; }
    for (const key of geometry) {
      const x=attr(a[i]!,key), y=attr(b[i]!,key);
      if ((x===undefined)!==(y===undefined)) {numeric.push(`missing geometry ${i}/${key}`); continue;}
      if (x===undefined || y===undefined) continue;
      const xs=numbers(x),ys=numbers(y);
      if (xs.length!==ys.length || xs.some((v,k)=>Math.abs(v-ys[k]!)>0.5)) numeric.push(`geometry ${i}/${key}`);
    }
  }
  // Unexpected annotation is not an opportunity to manufacture a new binding.
  const expectedKeys=new Set(expected.numericMarks.map(m=>m.key));
  for(const e of a) if(attr(e,'data-fact') && !expectedKeys.has(attr(e,'data-fact')!)) numeric.push('unknown data-fact');
  return {ok:!numeric.length&&!lexical.length&&!provenance.length,numeric,lexical,provenance};
}
