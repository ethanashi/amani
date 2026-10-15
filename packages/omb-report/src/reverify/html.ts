import { verifyCssClosure } from './css.ts';
/**
 * PW8 signed HTML: the canonical verified render (also valid pandoc Markdown as raw HTML).
 *
 * Signed elements:
 * - value spans  <span data-v="KEY" data-sig>: HMAC over (unit, ordinal, key, text);
 * - software units (title, headings, template and software sentences, protected lines,
 *   captions, alt text, table cells, notes, metadata): HMAC over tag, attributes and the
 *   canonical form of everything inside, so any byte change fails;
 * - the article root: HMAC over the context and skeleton hashes.
 * Drafted units are unsigned so their prose can be edited; their values cannot.
 *
 * The closed-world check walks every text node and every attribute. A digit (any \p{N})
 * passes only inside a validly signed element; anything else fails.
 */
import { createHash } from 'node:crypto';
import { canonicalJson } from '../../../bio-core/src/index.ts';
import { parseSvg, isElement, type ParsedElement, type ParsedChild } from '../../../omb-figures/src/xml.ts';
import { requireThat } from '../common.ts';
import { visibleSectionHeading, allUnits, type Container, type Inline, type Manuscript, type Unit } from './manuscript.ts';
import { toLetters, type SpanSigner } from './sign.ts';

interface Node { readonly tag: string; readonly attrs: readonly (readonly [string, string])[]; readonly children: readonly (Node | string)[] }
const n = (tag: string, attrs: readonly (readonly [string, string])[], children: readonly (Node | string)[] = []): Node => ({ tag, attrs, children });

const escText = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const escAttr = (s: string) => escText(s).replaceAll('"', '&quot;');
const VOID = new Set(['meta', 'img', 'link']);
function serialize(node: Node | string): string {
  if (typeof node === 'string') return escText(node);
  const attrs = node.attrs.map(([k, v]) => ` ${k}="${escAttr(v)}"`).join('');
  if (VOID.has(node.tag)) return `<${node.tag}${attrs}/>`;
  return `<${node.tag}${attrs}>${node.children.map(serialize).join('')}</${node.tag}>`;
}

/** Canonical form shared by the signer (from the tree) and the verifier (from the parse). */
type Canon = string | [string, [string, string][], Canon[]];
const canonNode = (node: Node | string): Canon => typeof node === 'string' ? node : [node.tag, [...node.attrs].filter(([k]) => k !== 'data-sig').map(([k, v]) => [k, v] as [string, string]).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)), mergeCanon(node.children.map(canonNode))];
const canonParsed = (c: ParsedChild): Canon => isElement(c) ? [c.tag, c.attrs.filter(([k]) => k !== 'data-sig').map(([k, v]) => [k, v] as [string, string]).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)), mergeCanon(c.children.map(canonParsed))] : c.text;
function mergeCanon(list: Canon[]): Canon[] {
  const out: Canon[] = [];
  for (const c of list) { if (typeof c === 'string' && typeof out.at(-1) === 'string') out[out.length - 1] = (out.at(-1) as string) + c; else if (c !== '') out.push(c); }
  return out;
}

const valuePayload = (u: string, o: number, k: string, t: string) => ({ d: 'omb/pw8/value@1', u, o, k, t });
const unitPayload = (u: string, canon: Canon) => ({ d: 'omb/pw8/unit@1', u, c: canon });
const rootPayload = (context: string, skeleton: string) => ({ d: 'omb/pw8/root@1', context, skeleton });

function inlineNodes(unit: Unit, signer: SpanSigner): (Node | string)[] {
  let ordinal = 0;
  return unit.inlines.map((i: Inline) => {
    if (i.t === 'value') return n('span', [['data-v', i.key], ['data-sig', signer.sign(valuePayload(unit.uid, ordinal++, i.key, i.text))]], [i.key.startsWith('author:')&&i.key.endsWith(':marker')?n('sup',[],[i.text]):i.key.startsWith('author:')&&i.key.endsWith(':name')?n('strong',[],[i.text]):i.text]);
    return i.style ? n(i.style, [], [i.text]) : i.text;
  });
}

function unitNode(unit: Unit, signer: SpanSigner, tag: string, extra: readonly (readonly [string, string])[] = [], asAttribute?: string): Node {
  const attrs: [string, string][] = [];
  if (tag === 'span') attrs.push(['class', 'omb-u']);
  attrs.push(...extra.map(([k, v]) => [k, v] as [string, string]), ['data-u', unit.uid], ['data-o', unit.origin === 'software' ? 's' : 'd']);
  if (unit.origin === 'software' && unit.claimIds.length) attrs.push(['data-claims', unit.claimIds.join(' ')]);
  if (unit.protectedId) attrs.push(['data-protected', unit.protectedId]);
  let children: (Node | string)[];
  if (asAttribute) { attrs.push([asAttribute, unit.text]); children = []; }
  else children = tag === 'title' ? [unit.text] : inlineNodes(unit, signer);
  if (unit.origin === 'software') {
    const unsigned = n(tag, attrs, children);
    attrs.push(['data-sig', signer.sign(unitPayload(unit.uid, canonNode(unsigned)))]);
  }
  return n(tag, attrs, children);
}

export interface HtmlOptions { readonly stylesheet?: string }

export function renderSignedHtml(m: Manuscript, signer: SpanSigner, options: HtmlOptions = {}): string {
  requireThat(signer.buildId === m.buildId, 'signer belongs to another build');
  const head: Node[] = [n('meta', [['charset', 'utf-8']]), unitNode(m.meta.title, signer, 'title')];
  if (m.meta.description) head.push(unitNode(m.meta.description, signer, 'meta', [['name', 'description']], 'content'));
  if (m.meta.keywords) head.push(unitNode(m.meta.keywords, signer, 'meta', [['name', 'keywords']], 'content'));
  if (options.stylesheet) { requireThat(/^[a-z][a-z-]*\.css$/u.test(options.stylesheet), 'stylesheet name must be digit-free'); head.push(n('link', [['rel', 'stylesheet'], ['href', options.stylesheet]])); }
  const body: (Node | string)[] = [unitNode(m.title, signer, 'h1')];
  for (const s of m.sections) {
    const kids: (Node | string)[] = visibleSectionHeading(s)?[unitNode(s.heading, signer, 'h2')]:[];
    for (const b of s.blocks) {
      if (b.kind === 'paragraphs') {
        if(b.presentation==='subheading'){kids.push(...b.units.map(u=>unitNode(u,signer,'h3')));continue;}
        if(b.presentation==='description'){
          const entries:Node[]=[];for(const row of new Set(b.units.map(u=>u.paragraph))){const us=b.units.filter(u=>u.paragraph===row);entries.push(n('dt',[],[unitNode(us[0]!,signer,'span')]));if(us[1])entries.push(n('dd',[],[unitNode(us[1],signer,'span')]));}
          kids.push(n('dl',[],entries));continue;
        }
        const paragraphs = new Map<number, Unit[]>();
        for (const u of b.units) paragraphs.set(u.paragraph, [...paragraphs.get(u.paragraph) ?? [], u]);
        for (const units of paragraphs.values()) kids.push(n('p', [], interleave(units.map((u) => unitNode(u, signer, 'span')), ' ')));
      } else if (b.kind === 'protected') for (const u of b.units) kids.push(unitNode(u, signer, 'div', [['class', 'omb-protected']]));
      else if (b.kind === 'figure') {
        kids.push(n('figure', [['class', 'omb-figure']], [unitNode(b.alt, signer, 'img', [['src', b.src]], 'alt'), n('figcaption', [], [unitNode(b.caption, signer, 'span')])]));
      } else if (b.kind === 'table') {
        const row = (units: readonly Unit[], cell: string) => n('tr', [], units.map((u) => n(cell, [], [unitNode(u, signer, 'span')])));
        kids.push(n('table', [['class', 'omb-table']], [n('caption', [], [unitNode(b.caption, signer, 'span')]), n('thead', [], [row(b.header, 'th')]), n('tbody', [], b.rows.map((r) => row(r, 'td')))]));
        for (const note of b.notes) kids.push(n('p', [['class', 'omb-table-note']], [unitNode(note, signer, 'span')]));
      } else kids.push(n('aside', [['class', 'omb-notes']], b.units.map((u) => n('p', [], [unitNode(u, signer, 'span')]))));
    }
    body.push(n('section', [['data-section', s.id]], interleave(kids, '\n')));
  }
  const context = toLetters(m.contextSha256), skeleton = toLetters(m.skeletonSha256);
  const article = n('article', [['class', 'omb-manuscript'], ['data-build', m.buildId], ['data-context', context], ['data-skeleton', skeleton], ['data-sig', signer.sign(rootPayload(context, skeleton))]], interleave(body, '\n'));
  return `<!doctype html>\n${serialize(n('html', [['lang', 'en']], ['\n', n('head', [], interleave(head, '\n')), '\n', n('body', [], ['\n', article, '\n']), '\n']))}\n`;
}

function interleave<T>(items: readonly T[], sep: string): (T | string)[] {
  return items.flatMap((x, i) => (i ? [sep, x] : [x]));
}

// ------------------------------------------------------------------------------------------
// Verification

export type HtmlIssueCode =
  | 'parse' | 'forbidden-element' | 'forbidden-attribute' | 'attribute-value' | 'format-char' | 'unbound-number' | 'text-outside-unit'
  | 'bad-signature' | 'unit-order' | 'unit-unknown' | 'unit-duplicate' | 'unit-missing' | 'unit-placement' | 'software-changed' | 'value-changed' | 'root' | 'asset';
export interface HtmlIssue { readonly code: HtmlIssueCode; readonly where: string; readonly detail: string }
export interface ProseEdit { readonly uid: string; readonly block: string; readonly index: number; readonly text: string; readonly source: string; readonly paragraphKey: number }
export interface HtmlVerification { readonly ok: boolean; readonly issues: readonly HtmlIssue[]; readonly prose: readonly ProseEdit[] }
export interface HtmlVerifyOptions extends HtmlOptions { readonly cssSha256?: Readonly<Record<string,string>>; readonly assets?: ReadonlyMap<string, string | Uint8Array> }

const ALLOWED: Record<string, readonly string[]> = {
  html: ['lang'], head: [], body: [], meta: ['charset', 'name', 'content', 'data-u', 'data-o', 'data-sig'], title: ['data-u', 'data-o', 'data-sig'], link: ['rel', 'href'],
  article: ['class', 'data-build', 'data-context', 'data-skeleton', 'data-sig'], section: ['data-section'], h1: ['data-u', 'data-o', 'data-sig'], h2: ['data-u', 'data-o', 'data-sig'], h3: ['data-u','data-o','data-sig'], sup:[],
  p: ['class'], span: ['class', 'data-u', 'data-o', 'data-claims', 'data-sig', 'data-v'], em: [], strong: [], div: ['class', 'data-u', 'data-o', 'data-protected', 'data-sig'],
  figure: ['class'], img: ['src', 'alt', 'data-u', 'data-o', 'data-sig'], figcaption: [], table: ['class'], caption: [], thead: [], tbody: [], tr: [], th: [], td: [], aside: ['class'], dl:[],dt:[],dd:[],
};
const CLASSES = new Set(['omb-u', 'omb-protected', 'omb-figure', 'omb-table', 'omb-table-note', 'omb-notes', 'omb-manuscript']);
const attr = (e: ParsedElement, k: string) => e.attrs.find(([a]) => a === k)?.[1];
const isUnitEl = (e: ParsedElement) => attr(e, 'data-u') !== undefined;
const isValueEl = (e: ParsedElement) => e.tag === 'span' && attr(e, 'data-v') !== undefined;
const textOf = (e: ParsedElement): string => e.children.map((c) => (isElement(c) ? textOf(c) : c.text)).join('');

/** Where each container must sit: [unit tag, parent tag, grandparent tag or null]. */
const PLACEMENT: Record<Container, readonly (readonly [string, string, string | null])[]> = {
  metadata: [['title', 'head', null], ['meta', 'head', null]], title: [['h1', 'article', null]], heading: [['h2', 'section', null],['h3','section',null]],
  body: [['span', 'p', 'section'],['span','dt','dl'],['span','dd','dl']], protected: [['div', 'section', null]], caption: [['span', 'figcaption', 'figure'], ['span', 'caption', 'table']],
  alt: [['img', 'figure', null]], 'table-cell': [['span', 'th', 'tr'], ['span', 'td', 'tr']], 'table-note': [['span', 'p', 'section']], footnote: [['span', 'p', 'aside']],
};

export function verifySignedHtml(html: string, expected: Manuscript, signer: SpanSigner, options: HtmlVerifyOptions = {}): HtmlVerification {
  const issues: HtmlIssue[] = [];
  const add = (code: HtmlIssueCode, where: string, detail: string) => issues.push({ code, where, detail });
  requireThat(signer.buildId === expected.buildId, 'signer belongs to another build');
  const prefix = '<!doctype html>\n';
  if (!html.startsWith(prefix)) { add('parse', 'document', 'missing the exact doctype line'); return { ok: false, issues, prose: [] }; }
  const parsed = parseSvg(html.slice(prefix.length));
  for (const i of parsed.issues) add('parse', 'document', `${i.code}: ${i.detail}`);
  if (!parsed.root) return { ok: false, issues, prose: [] };
  const root = parsed.root;
  if (root.tag !== 'html') add('parse', 'document', 'root element must be html');

  const expectedUnits = allUnits(expected);
  const byUid = new Map(expectedUnits.map((u) => [u.uid, u]));
  const seen: Unit[] = [];
  const verifiedSigned = new Set<ParsedElement>();
  const prose: ProseEdit[] = [];
  const paragraphIds = new Map<ParsedElement, number>();

  // Pass 1: element and attribute grammar, signatures, unit identity.
  const visit = (e: ParsedElement, path: string, unit: Unit | null, unitEl: ParsedElement | null, ordinal: { n: number }) => {
    const here = `${path}/${e.tag}`;
    const allowed = ALLOWED[e.tag];
    if (!allowed) add('forbidden-element', here, `<${e.tag}> is not allowed`);
    for (const [k, v] of e.attrs) {
      if (!allowed?.includes(k)) add('forbidden-attribute', here, `${k} is not allowed on <${e.tag}>`);
      if (/[\p{Cf}\p{Cc}]/u.test(v)) add('format-char', `${here}@${k}`, 'control, bidi or zero-width character');
      if (k === 'class' && !CLASSES.has(v)) add('attribute-value', `${here}@${k}`, `unknown class ${v}`);
    }
    let nextUnit = unit, nextUnitEl = unitEl, nextOrdinal = ordinal;
    if (isUnitEl(e)) {
      const uid = attr(e, 'data-u')!;
      const u = byUid.get(uid);
      if (unit) add('unit-placement', here, 'unit nested inside another unit');
      if (!u) add('unit-unknown', here, `unknown unit ${uid}`);
      else if (seen.includes(u)) add('unit-duplicate', here, `unit ${u.block}#${u.index} appears twice`);
      else {
        seen.push(u);
        const placement = PLACEMENT[u.container].some(([tag, parent, grand]) => e.tag === tag && e.parent?.tag === parent && (grand === null || e.parent?.parent?.tag === grand));
        if (!placement) add('unit-placement', here, `${u.container} unit ${u.block}#${u.index} is not in its place`);
        const section = sectionOf(e);
        if (u.container !== 'metadata' && u.container !== 'title' && section !== u.section) add('unit-placement', here, `unit ${u.block}#${u.index} belongs in section ${u.section}`);
        if ((attr(e, 'data-o') === 's') !== (u.origin === 'software')) add('unit-placement', here, `unit ${u.block}#${u.index} origin changed`);
        if (u.origin === 'software') {
          if (!signer.verify(unitPayload(uid, canonParsed(e)), attr(e, 'data-sig'))) add('bad-signature', here, `software unit ${u.block}#${u.index} changed or unsigned`);
          else verifiedSigned.add(e);
          const observed = e.tag === 'img' ? attr(e, 'alt') : e.tag === 'meta' ? attr(e, 'content') : textOf(e);
          if (observed !== u.text) add('software-changed', here, `software text of ${u.block}#${u.index} differs`);
        } else if (attr(e, 'data-sig') !== undefined || attr(e, 'data-claims') !== undefined) add('forbidden-attribute', here, 'drafted unit carries software attributes');
        if (e.parent?.tag === 'p' && u.container === 'body') { if (!paragraphIds.has(e.parent)) paragraphIds.set(e.parent, paragraphIds.size); }
      }
      nextUnit = u ?? null; nextUnitEl = e; nextOrdinal = { n: 0 };
    }
    if (isValueEl(e)) {
      const key = attr(e, 'data-v')!;
      const o = ordinal.n++;
      if (!unit || !unitEl) add('unbound-number', here, `value span ${key} outside a unit`);
      else if (e.children.some(isElement) && !(key.startsWith('author:') && (key.endsWith(':marker')||key.endsWith(':name')) && unit.origin === 'software' && e.children.length === 1 && isElement(e.children[0]!) && e.children[0]!.tag === (key.endsWith(':marker')?'sup':'strong') && e.children[0]!.attrs.length === 0 && e.children[0]!.children.every(c=>!isElement(c)))) add('forbidden-element', here, 'markup inside a value span');
      else if (!signer.verify(valuePayload(unit.uid, o, key, textOf(e)), attr(e, 'data-sig'))) add('bad-signature', here, `value span ${key} in ${unit.block}#${unit.index} changed, moved or hand-typed`);
      else verifiedSigned.add(e);
      if (e.attrs.some(([k]) => !['data-v', 'data-sig'].includes(k))) add('forbidden-attribute', here, 'value span carries extra attributes');
    }
    if (e.tag === 'article') {
      const context = toLetters(expected.contextSha256), skeleton = toLetters(expected.skeletonSha256);
      if (attr(e, 'data-build') !== expected.buildId || attr(e, 'data-context') !== context || attr(e, 'data-skeleton') !== skeleton) add('root', here, 'build, context or skeleton hash differs');
      if (!signer.verify(rootPayload(attr(e, 'data-context') ?? '', attr(e, 'data-skeleton') ?? ''), attr(e, 'data-sig'))) add('bad-signature', here, 'article root signature invalid');
    }
    if (e.tag === 'link' && (attr(e, 'rel') !== 'stylesheet' || attr(e, 'href') !== options.stylesheet)) add('attribute-value', here, 'only the configured stylesheet may be linked');
    if (e.tag === 'meta' && !isUnitEl(e)) {
      // The one fixed structural exception: the exact charset declaration (its "8" is not a fact).
      if (e.attrs.length === 1 && attr(e, 'charset') === 'utf-8' && e.parent?.tag === 'head') verifiedSigned.add(e);
      else add('attribute-value', here, 'unsigned meta must be the charset declaration');
    }
    if (e.tag === 'img' && !isUnitEl(e)) add('unit-placement', here, 'image without a signed alt-text unit');
    e.children.forEach((c, i) => { if (isElement(c)) visit(c, `${here}[${i}]`, nextUnit, nextUnitEl, nextOrdinal); });
  };
  visit(root, '', null, null, { n: 0 });

  // Pass 2: closed world over every text node and attribute.
  const signedAncestor = (e: ParsedElement | null): boolean => { for (let x = e; x; x = x.parent) if (verifiedSigned.has(x)) return true; return false; };
  const unitAncestor = (e: ParsedElement | null): ParsedElement | null => { for (let x = e; x; x = x.parent) if (isUnitEl(x)) return x; return null; };
  const sweep = (e: ParsedElement, path: string) => {
    const here = `${path}/${e.tag}`;
    for (const [k, v] of e.attrs) if (/\p{N}/u.test(v) && !verifiedSigned.has(e)) add('unbound-number', `${here}@${k}`, `"${v.slice(0, 40)}" holds a number outside a signed element`);
    e.children.forEach((c, i) => {
      if (isElement(c)) { sweep(c, `${here}[${i}]`); return; }
      if (/[\p{Cf}]|[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(c.text)) add('format-char', here, 'control, bidi or zero-width character in text');
      if (/\p{N}/u.test(c.text) && !signedAncestor(e)) add('unbound-number', here, `"${excerpt(c.text)}" holds a number outside a signed span`);
      if (c.text.trim() && !unitAncestor(e)) add('text-outside-unit', here, `"${excerpt(c.text)}" is outside every unit`);
    });
  };
  sweep(root, '');

  // Pass 3: the expected unit sequence and drafted values (the spine).
  const order = seen.map((u) => u.uid).join(' ');
  const expectedOrder = expectedUnits.filter((u) => seen.includes(u)).map((u) => u.uid).join(' ');
  if (order !== expectedOrder) add('unit-order', 'document', 'units are out of order');
  for (const u of expectedUnits) if (!seen.includes(u)) add('unit-missing', u.block, `unit ${u.block}#${u.index} (${u.container}) is missing`);
  const findUnitEl = (uid: string, e: ParsedElement): ParsedElement | null => { if (attr(e, 'data-u') === uid) return e; for (const c of e.children) if (isElement(c)) { const f = findUnitEl(uid, c); if (f) return f; } return null; };
  for (const u of seen.filter((x) => x.origin === 'drafter')) {
    const el = findUnitEl(u.uid, root)!;
    const values = valueSpans(el).map((v) => [attr(v, 'data-v')!, textOf(v)] as const);
    const expectedValues = u.inlines.filter((i) => i.t === 'value').map((i) => [i.key, i.text] as const);
    if (canonicalJson(values) !== canonicalJson(expectedValues)) add('value-changed', u.block, `values of ${u.block}#${u.index} changed`);
    const text = textOf(el);
    if (text !== u.text) prose.push({ uid: u.uid, block: u.block, index: u.index, text, source: sourceOf(el), paragraphKey: el.parent ? paragraphIds.get(el.parent) ?? -1 : -1 });
  }

  if (options.stylesheet) {
    try { verifyCssClosure(options.stylesheet, options.assets ?? new Map(), options.cssSha256 ?? {}); }
    catch (error) { add('asset', options.stylesheet, error instanceof Error ? error.message : 'CSS closure failed'); }
  }
  // Figure assets, when supplied, must be the exact regenerated SVG bytes.
  if (options.assets) for (const s of expected.sections) for (const b of s.blocks) if (b.kind === 'figure') {
    const bytes = options.assets.get(b.src);
    if (bytes === undefined || createHash('sha256').update(bytes).digest('hex') !== b.svgSha256) add('asset', b.src, `figure asset ${b.src} is missing or differs from the regenerated SVG`);
  }
  return { ok: issues.length === 0, issues, prose };
}

function sectionOf(e: ParsedElement): string | null { for (let x: ParsedElement | null = e; x; x = x.parent) if (x.tag === 'section') return attr(x, 'data-section') ?? null; return null; }
function valueSpans(e: ParsedElement): ParsedElement[] { const out: ParsedElement[] = []; for (const c of e.children) if (isElement(c)) { if (isValueEl(c)) out.push(c); else out.push(...valueSpans(c)); } return out; }
const excerpt = (t: string) => (t.length > 60 ? t.slice(0, 60) + '...' : t);

/** Rebuild a drafter request from an edited unit: values become placeholders again, entities stay words. */
export function sourceOf(e: ParsedElement): string {
  return e.children.map((c) => {
    if (!isElement(c)) return c.text;
    if (isValueEl(c)) { const key = attr(c, 'data-v')!; return key.startsWith('entity:') ? textOf(c) : `[${key}]`; }
    if (c.tag === 'em') return `*${textOf(c)}*`;
    if (c.tag === 'strong') return `**${textOf(c)}**`;
    return textOf(c);
  }).join('').replace(/\s+/gu, ' ').trim();
}
