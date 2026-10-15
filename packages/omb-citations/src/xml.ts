import { fold } from './policy.ts';
import type { Passage, Section } from './types.ts';
export interface Xml { name: string; attrs: Record<string, string>; children: Array<Xml | string> }
export function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
    if (e.startsWith('#')) { const n = e[1]?.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1)); if (n > 0x10ffff || n < 0) throw new Error('bad XML entity'); return String.fromCodePoint(n); }
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[e] ?? _;
  });
}
/** Small non-validating XML reader: never loads DTDs or expands declared entities. */
export function parseXml(source: string): Xml {
  if (/<!ENTITY|<!DOCTYPE[^>]*\[/i.test(source)) throw new Error('XML entity declaration refused');
  const root: Xml = { name: '#document', attrs: {}, children: [] }, stack = [root];
  const tokens = source.match(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<[^>]+>|[^<]+/g) ?? [];
  if (tokens.join('') !== source) throw new Error('malformed XML');
  for (const t of tokens) {
    const parent = stack.at(-1)!;
    if (t.startsWith('<!--') || t.startsWith('<?') || t.startsWith('<!DOCTYPE')) continue;
    if (t.startsWith('<![CDATA[')) { parent.children.push(t.slice(9, -3)); continue; }
    if (t.startsWith('</')) { if (stack.length < 2 || stack.pop()!.name !== t.slice(2, -1).trim()) throw new Error('unbalanced XML'); continue; }
    if (t.startsWith('<')) {
      const name = /^<([\w:.-]+)/.exec(t)?.[1]; if (!name) throw new Error('malformed XML tag');
      const attrs: Record<string, string> = {};
      for (const m of t.matchAll(/([\w:.-]+)\s*=\s*(['"])(.*?)\2/gs)) attrs[m[1]!] = decode(m[3]!);
      const node: Xml = { name, attrs, children: [] }; parent.children.push(node);
      if (!t.endsWith('/>')) stack.push(node);
      if (stack.length > 128) throw new Error('XML depth cap');
    } else { if (/&(?!(?:#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);)/i.test(t)) throw new Error('unknown XML entity'); parent.children.push(decode(t)); }
  }
  if (stack.length !== 1) throw new Error('truncated XML');
  return root;
}
export function nodes(x: Xml, name: string): Xml[] { return x.children.flatMap(c => typeof c === 'string' ? [] : [...(c.name === name ? [c] : []), ...nodes(c, name)]); }
export function textOf(x: Xml): string { return x.children.map(c => typeof c === 'string' ? c : textOf(c)).join(''); }
export function firstText(x: Xml, name: string): string { const n = nodes(x, name)[0]; return n ? fold(textOf(n)) : ''; }
function kind(s: string, inherited: Section): Section {
  const t = s.toLowerCase();
  if (/intro|background/.test(t)) return 'introduction';
  if (/method|material|patient|subject/.test(t)) return 'methods';
  if (/discussion|conclusion/.test(t)) return 'discussion';
  if (/result|finding/.test(t)) return 'results';
  return inherited;
}
function passage(x: Xml, section: Section): Passage {
  // Sentinels survive whitespace/Unicode folding; then remove them and record exact ranges.
  function render(n: Xml): string {
    if (n.name === 'xref' && n.attrs['ref-type'] === 'bibr') return '\uE000' + textOf(n) + '\uE001';
    return n.children.map(c => typeof c === 'string' ? c : render(c)).join('');
  }
  const marked = fold(render(x)); let text = '', start = -1; const citationRanges: Array<[number, number]> = [];
  for (const c of marked) { if (c === '\uE000') start = text.length; else if (c === '\uE001') { if (start >= 0) citationRanges.push([start, text.length]); start = -1; } else text += c; }
  return { section, text, citationRanges };
}
export function jatsPassages(xml: string): Passage[] {
  const root = parseXml(xml); if (!nodes(root, 'article').length) throw new Error('not a JATS article');
  const out: Passage[] = [];
  function visit(n: Xml, section: Section) {
    if (['ref-list', 'table-wrap', 'fig', 'supplementary-material', 'sub-article'].includes(n.name)) return;
    if (n.name === 'sec') { const title = n.children.find(c => typeof c !== 'string' && c.name === 'title'); section = kind(`${n.attrs['sec-type'] ?? ''} ${typeof title === 'object' ? textOf(title) : ''}`, section); }
    if (n.name === 'p') { const p = passage(n, section); if (p.text) out.push(p); return; }
    for (const c of n.children) if (typeof c !== 'string') visit(c, section);
  }
  const article = nodes(root, 'article')[0]!;
  for (const a of nodes(article, 'abstract')) visit(a, 'abstract');
  for (const b of article.children) if (typeof b !== 'string' && b.name === 'body') visit(b, 'other');
  return out;
}
export function abstractPassages(s: string): Passage[] {
  if (!s.trim()) return [];
  try { const safe = s.replace(/&nbsp;/g, " ").replace(/&(?!(?:#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);)/gi, "&amp;").replace(/<(?!\/?[A-Za-z][\w:.-]*(?:\s[^<>]*)?\/?>)/g, "&lt;");
    const root = parseXml(`<abstract>${safe}</abstract>`); return [{ section: 'abstract', text: fold(textOf(root)), citationRanges: [] }]; }
  catch { throw new Error('malformed abstract XML'); }
}
