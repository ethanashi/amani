import {editionFields,articleFields,authorFields,type ArticleEdition} from './article.ts';
import {formatNumber,formatExactColumn} from '../format.ts';
import {reportingChecklist,type ChecklistName} from '../checklists.ts';
import {sentencePositionValue,statementStop} from '../sentence-style.ts';
import {assertFinalText,assertNoRepeatedSentences} from '../text-quality.ts';
import {honestNullReason} from '../templates.ts';
/**
 * PW8 manuscript model. The trusted assembler turns a ManuscriptPlan (drafter sources
 * per region, software blocks, protected regions, PW3 figures and tables, notes and
 * metadata) into units: one unit per drafted sentence, one per software paragraph,
 * protected line, caption, alt text, table cell, note and metadata field.
 *
 * Every unit is a list of inlines. A value inline is a software-resolved string with a
 * key that names where it came from. The assembler refuses any unit whose digits are
 * not inside a value inline, so the closed world holds by construction before any
 * output is written; the HTML, PDF and DOCX checks then prove the outputs still match.
 */
import { canonicalJson, canonicalSha256 } from '../../../bio-core/src/index.ts';
import {renderPublicationFigure,type PublicationSpec,type FactStore,type RenderedFigure,type RenderedTable} from '../../../omb-figures/src/index.ts';
import { parseSvg, walk, ownText } from '../../../omb-figures/src/xml.ts';
import { NUMERIC_EXPRESSION } from '../../../omb-figures/src/closed-world.ts';
import { record, refuse, requireThat } from '../common.ts';
import { assertContext, displayFact, type Region, type ReportContext } from '../context.ts';
import type { EntityRegistry } from '../entities.ts';
import { parseDraft } from '../grammar.ts';
import { threePartLabel, tableEvidenceLabel, outcomeText, registrationValues } from '../labels.ts';
import { validLock } from '../lock.ts';
import {plainify} from '../acronyms.ts';
import {assertTermRegistry,type TermRegistry} from '../glossary.ts';
import { limitationsPartA, limitationsPartB, limitationsPartBDocument,type LimitationEntry, type ProtectedRegion } from '../limitations.ts';
import {aiReviewNotice} from '../ai-review.ts';
import {assertSoftwareBox,type PlainSummary,type IdeaInBrief,type GlossaryBox} from '../boxes.ts';
import {assertMethods,methodCompleteness} from '../methods.ts';
import {assertMatter,type MatterDocument} from '../matter.ts';
import { renderDraft, type RenderOptions, type RenderedSentence } from '../render.ts';
import { renderTitle } from '../report.ts';
import { CONNECTIVES } from '../templates.ts';
import { buildIdFor, sha256Letters } from './sign.ts';

export type Container = 'title' | 'heading' | 'body' | 'protected' | 'caption' | 'alt' | 'table-cell' | 'table-note' | 'footnote' | 'metadata';
export type Origin = 'drafter' | 'software';
export interface TextInline { readonly t: 'text'; readonly text: string; readonly style: 'em' | 'strong' | null }
export interface ValueInline { readonly t: 'value'; readonly key: string; readonly text: string }
export type Inline = TextInline | ValueInline;

export interface Unit {
  readonly uid: string;
  readonly block: string;
  readonly index: number;
  readonly section: string;
  readonly container: Container;
  readonly origin: Origin;
  /** A software claim sentence requested by the drafter with a closed connective. */
  readonly template: boolean;
  readonly claimIds: readonly string[];
  readonly citationKeys: readonly string[];
  readonly provides: readonly string[];
  readonly inlines: readonly Inline[];
  readonly text: string;
  /** The drafter request for this sentence (draft blocks only). */
  readonly source: string | null;
  readonly paragraph: number;
  readonly protectedId: string | null;
  readonly protectedSha256: string | null;
}

export interface ParagraphsBlock { readonly kind: 'paragraphs'; readonly id: string; readonly region: Region | null; readonly units: readonly Unit[]; readonly presentation?:'description'|'subheading' }
export interface ProtectedBlock { readonly kind: 'protected'; readonly id: string; readonly units: readonly Unit[] }
export interface FigureBlock {
  readonly kind: 'figure'; readonly id: string; readonly figureId: string; readonly number: number; readonly src: string;
  readonly sourceCsv?:string; readonly svg: string; readonly svgSha256: string; readonly csvSha256: string; readonly svgTexts: readonly string[];
  readonly alt: Unit; readonly caption: Unit; readonly sourceCaption:string;
}
export interface TableBlock {
  readonly kind: 'table'; readonly id: string; readonly tableId: string; readonly number: number;
  readonly sha256: RenderedTable['sha256']; readonly csvSha256: string;
  readonly caption: Unit; readonly header: readonly Unit[]; readonly rows: readonly (readonly Unit[])[]; readonly notes: readonly Unit[];
}
export interface NotesBlock { readonly kind: 'notes'; readonly id: string; readonly units: readonly Unit[] }
export type Block = ParagraphsBlock | ProtectedBlock | FigureBlock | TableBlock | NotesBlock;
export interface Section { readonly id: string; readonly heading: Unit; readonly blocks: readonly Block[] }
/** The fixed Authors label is metadata; authenticated names are the visible byline. */
export const visibleSectionHeading=(s:Section):boolean=>!(s.id==='authors'&&s.heading.text==='Authors'&&s.blocks.length>0&&s.blocks.every(b=>b.kind==='paragraphs'&&b.units.every(u=>u.origin==='software'&&u.inlines.every(i=>i.t==='value'&&i.key.startsWith('author:')))));

export interface SkeletonUnit {
  readonly block: string; readonly sec: string; readonly c: Container; readonly o: Origin; readonly tpl: boolean;
  readonly claims: readonly string[]; readonly cites: readonly string[]; readonly provides: readonly string[];
  readonly values: readonly (readonly [string, string])[];
  /** sha256 of software text (claim templates: without the drafter's connective); null for drafter prose. */
  readonly text: string | null;
  readonly prot: string | null;
}
export interface SkeletonContext {
  readonly paperInput: string;
  readonly claims: readonly { readonly id: string; readonly label: string; readonly scope: string; readonly status: string }[];
  readonly protectedRegions: readonly { readonly id: string; readonly sha256: string }[];
  readonly citations: readonly { readonly key: string; readonly status: string }[];
  readonly figures: readonly { readonly id: string; readonly number: number; readonly svg: string; readonly csv: string }[];
  readonly tables: readonly { readonly id: string; readonly number: number; readonly markdown: string; readonly csv: string; readonly dictionary: string }[];
  readonly checklist: Readonly<Record<string, string>>;
}
export interface Skeleton { readonly schema: 'omb/pw8/skeleton@1'; readonly context: SkeletonContext; readonly units: readonly SkeletonUnit[] }

export interface Manuscript {
  readonly schema: 'omb/pw8/manuscript@1';
  readonly buildId: string;
  readonly paperInputHash: string;
  readonly meta: { readonly title: Unit; readonly description: Unit | null; readonly keywords: Unit | null };
  readonly title: Unit;
  readonly sections: readonly Section[];
  readonly skeleton: Skeleton;
  readonly contextSha256: string;
  readonly skeletonSha256: string;
}

// ------------------------------------------------------------------------------------------
// Plan

export type SoftwarePart = string | { readonly key: string } | { readonly opaque: string };
export interface SoftwareParagraph { readonly parts: readonly SoftwarePart[]; readonly provides?: readonly string[]; readonly claimIds?: readonly string[] }
export type BlockPlan =
  | {readonly kind:'subheading';readonly id:string;readonly text:string}
  | {readonly kind:'article-edition';readonly id:string;readonly edition:ArticleEdition}
  | {readonly kind:'article-info';readonly id:string;readonly document:MatterDocument;readonly edition:ArticleEdition}
  | {readonly kind:'article-authors';readonly id:string;readonly document:MatterDocument}
  | {readonly kind:'reporting-checklist';readonly id:string;readonly name:ChecklistName}
  | {readonly kind:'data-source-overview';readonly id:string}
  | {readonly kind:'claim-table';readonly id:string}
  | {readonly kind:'methods-shared'|'methods-specification';readonly id:string;readonly topic?:'population'|'analysis'}
  | {readonly kind:'literature-references';readonly id:string}
  | {readonly kind:'limitations-part-b';readonly id:string;readonly entries:readonly LimitationEntry[]}
  | { readonly kind:'producer'; readonly id:string; readonly producer:'plain-summary'; readonly document:PlainSummary }
  | { readonly kind:'producer'; readonly id:string; readonly producer:'idea-in-brief'; readonly document:IdeaInBrief }
  | { readonly kind:'producer'; readonly id:string; readonly producer:'glossary-box'; readonly document:GlossaryBox }
  | { readonly kind:'producer'; readonly id:string; readonly producer:'matter'; readonly document:MatterDocument; readonly heading?:string; readonly tableColumn?:number; readonly proseOnly?:boolean }
  | { readonly kind: 'draft'; readonly id: string; readonly region: Region; readonly source: string; readonly lead?:'Background'|'Methods'|'Results'|'Conclusions' }
  | { readonly kind: 'software'; readonly id: string; readonly paragraphs: readonly SoftwareParagraph[] }
  | { readonly kind: 'protected'; readonly id: string; readonly regions: readonly ProtectedRegion[] }
  | { readonly kind:'publication-figure'; readonly id:string; readonly spec:PublicationSpec; readonly store:FactStore; readonly caption:string }
  | { readonly kind: 'figure'; readonly id: string; readonly figure: RenderedFigure }
  | { readonly kind: 'table'; readonly id: string; readonly table: RenderedTable; readonly caption: string }
  | { readonly kind: 'notes'; readonly id: string; readonly notes: readonly SoftwareParagraph[] };
export interface SectionPlan { readonly id: string; readonly heading: string; readonly blocks: readonly BlockPlan[] }
export interface ManuscriptPlan {
  readonly presentation?:'preprint';
  readonly plainLanguage?:TermRegistry;
  readonly renderOptions?: RenderOptions;
  readonly ctx: ReportContext;
  readonly registry: EntityRegistry;
  /** Build nonce; with the PaperInput hash it fixes the build ID and therefore every unit ID. */
  readonly nonce: string;
  readonly sections: readonly SectionPlan[];
  readonly metadata?: { readonly description?: readonly SoftwarePart[]; readonly keywords?: readonly string[] };
  readonly checklist?: Readonly<Record<string, string>>;
}

// ------------------------------------------------------------------------------------------
// The trusted value universe for software text

export interface UniverseValue { readonly key: string; readonly text: string }

/** Every software value a software paragraph may reference by key, derived from the sealed context. */
export function contextUniverse(ctx: ReportContext): ReadonlyMap<string, string> {
  assertContext(ctx);
  const out = new Map<string, string>();
  const put = (key: string, text: unknown) => {
    if (typeof text !== 'string' || !text.length) return;
    requireThat(!out.has(key) || out.get(key) === text, `universe key collision: ${key}`);
    out.set(key, text);
  };
  for (const [key, fact] of ctx.slots) {
    try { put(key, displayFact(fact)); } catch { /* unverified or producer-less facts never print */ }
  }
  for (const c of ctx.claims) {
    put(`claim:${c.id}`, c.id);
    const label = threePartLabel(ctx, c.id);
    put(`m:${c.id}.label`, label.short);
    put(`label:${c.id}`, label.short);
    put(`label-full:${c.id}`, label.full);
    if(honestNullReason(c)!==null)put(`m:${c.id}.null_reason`,honestNullReason(c));
    put(`label-table:${c.id}`, tableEvidenceLabel(ctx,c.id));
    put(`outcome:${c.id}`, outcomeText(ctx, c));
    put(`hash:cert:${c.id}`, c.certHash);
    const cert = ctx.input.certifications.find((x) => x.id === c.certificationId);
    if (cert) put(`hash:code:${c.id}`, cert.certificate.binding.frozenCodeHash);
    const fact = ctx.slots.get(`m:${c.id}.result`);
    if (fact) put(`hash:facts:${c.id}`, canonicalSha256(fact.factIds));
  }
  for (const cert of ctx.input.certifications) {
    for (const f of cert.metricGrades) {
      if (f.source === 'kernel' && f.grade === 'kernel-recomputed' && f.producerGate && typeof f.value === 'number' && Number.isFinite(f.value)) put(`fact:${f.key}`, String(f.value));
    }
  }
  for (const [key, value] of Object.entries(registrationValues(ctx))) put(`r:${key}`, value ?? undefined);
  put('hash:paper-input', ctx.input.sha256);
  put('count:claims', String(ctx.claims.length));
  put('count:registered', String(ctx.input.plannedFound.registeredHypotheses));
  for (const status of new Set(ctx.claims.map((c) => c.status))) put(`count:status:${status}`, String(ctx.claims.filter((c) => c.status === status).length));
  return out;
}

const NUMBER = (): RegExp => new RegExp(NUMERIC_EXPRESSION.source, 'gu');
export const hasNumber = (text: string): boolean => /\p{N}/u.test(text);

/**
 * Splits opaque software text into text and value inlines. Every numeric expression must
 * lie inside ONE occurrence of a candidate value; longer occurrences win. Refuses otherwise.
 */
export function decompose(text: string, candidates: readonly UniverseValue[], where: string): Inline[] {
  const occurrences: { start: number; end: number; keys: string[] }[] = [];
  const byText = new Map<string, string[]>();
  for (const c of candidates) if (c.text && hasNumber(c.text)) byText.set(c.text, [...(byText.get(c.text) ?? []), c.key]);
  for (const [value, keys] of byText) for (let at = text.indexOf(value); at >= 0; at = text.indexOf(value, at + 1)) occurrences.push({ start: at, end: at + value.length, keys: [...new Set(keys)].sort() });
  occurrences.sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.start - b.start);
  const tokens = [...text.matchAll(NUMBER())].map((m) => ({ start: m.index, end: m.index + m[0].length }));
  const chosen: typeof occurrences = [];
  for (const o of occurrences) {
    if (chosen.some((c) => o.start < c.end && c.start < o.end)) continue;
    if (tokens.some((t) => o.start <= t.start && t.end <= o.end)) chosen.push(o);
  }
  for (const t of tokens) requireThat(chosen.some((o) => o.start <= t.start && t.end <= o.end), `${where}: number "${text.slice(t.start, t.end)}" does not trace to a signed value`);
  chosen.sort((a, b) => a.start - b.start);
  const inlines: Inline[] = [];
  let cursor = 0;
  for (const o of chosen) {
    if (o.start > cursor) inlines.push({ t: 'text', text: text.slice(cursor, o.start), style: null });
    inlines.push({ t: 'value', key: o.keys.join('|'), text: text.slice(o.start, o.end) });
    cursor = o.end;
  }
  if (cursor < text.length) inlines.push({ t: 'text', text: text.slice(cursor), style: null });
  return inlines;
}

/** The closed-world invariant on a unit: no digit outside a value inline. */
export function assertUnitClosed(inlines: readonly Inline[], where: string): void {
  for (const i of inlines) {
    requireThat(!/[\p{Cf}\p{Cc}]/u.test(i.text), `${where}: control or format character`);
    if (i.t === 'text') requireThat(!hasNumber(i.text), `${where}: number outside a signed value: "${i.text.slice(0, 60)}"`);
    else requireThat(i.text.length > 0 && i.key.length > 0, `${where}: empty value`);
  }
}

// ------------------------------------------------------------------------------------------
// Rendered sentences to inlines

const ENTITY: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
const unescape = (s: string): string => s.replace(/&(?:amp|lt|gt|quot|#39);/gu, (e) => ENTITY[e]!);

/** Reads omb-report's sentence HTML: text, emphasis, data-fact and data-entity spans only. */
export function sentenceInlines(s: RenderedSentence): Inline[] {
  const out: Inline[] = [];
  const re = /<span data-(fact|entity)="([^"<>]*)">([^<]*)<\/span>|<(em|strong)>([^<]*)<\/\4>|([^<]+)|(<)/gu;
  for (const m of s.html.matchAll(re)) {
    if (m[7]) refuse('unexpected markup in a rendered sentence');
    if (m[1]) out.push({ t: 'value', key: m[1] === 'fact' ? unescape(m[2]!) : `entity:${unescape(m[2]!)}`, text: unescape(m[3]!) });
    else if (m[4]) out.push({ t: 'text', text: unescape(m[5]!), style: m[4] as 'em' | 'strong' });
    else out.push({ t: 'text', text: unescape(m[6]!).replace(/ +([.!?])/gu, '$1'), style: null });
  }
  const visible = out.map((i) => i.text).join('');
  requireThat(visible === s.text.replace(/\*/gu, ''), 'rendered sentence and its markup disagree');
  return mergeText(out);
}

function mergeText(inlines: readonly Inline[]): Inline[] {
  const out: Inline[] = [];
  for (const i of inlines) {
    const last = out.at(-1);
    if (i.t === 'text' && !i.text) continue;
    if (i.t === 'text' && last?.t === 'text' && last.style === i.style) out[out.length - 1] = { ...last, text: last.text + i.text };
    else out.push(i);
  }
  return out;
}

// ------------------------------------------------------------------------------------------
// Assembly

interface UnitSpec {
  block: string; index: number; section: string; container: Container; origin: Origin; template?: boolean;
  claimIds?: readonly string[]; citationKeys?: readonly string[]; provides?: readonly string[]; inlines: Inline[];
  source?: string | null; paragraph?: number; protectedId?: string | null; protectedSha256?: string | null;
}

function makeUnit(buildId: string, spec: UnitSpec): Unit {
  const inlines = mergeText(spec.inlines);
  const where = `${spec.block}#${spec.index}`;
  assertUnitClosed(inlines, where);
  const text = inlines.map((i) => i.text).join('');
  requireThat(text.trim().length > 0, `${where}: empty unit`);
  return Object.freeze({
    uid: sha256Letters(canonicalJson({ d: 'omb/pw8/uid@1', b: buildId, block: spec.block, index: spec.index })).slice(0, 24),
    block: spec.block, index: spec.index, section: spec.section, container: spec.container, origin: spec.origin,
    template: spec.template ?? false, claimIds: Object.freeze([...spec.claimIds ?? []]), citationKeys: Object.freeze([...spec.citationKeys ?? []]),
    provides: Object.freeze([...spec.provides ?? []].sort()), inlines: Object.freeze(inlines.map((i) => Object.freeze(i))), text,
    source: spec.source ?? null, paragraph: spec.paragraph ?? 0, protectedId: spec.protectedId ?? null, protectedSha256: spec.protectedSha256 ?? null,
  });
}

function softwareInlines(parts: readonly SoftwarePart[], universe: ReadonlyMap<string, string>, candidates: readonly UniverseValue[], where: string): Inline[] {
  const out: Inline[] = [];
  for (const part of parts) {
    if (typeof part === 'string') {
      requireThat(!hasNumber(part), `${where}: software template text contains a number`);
      out.push({ t: 'text', text: part, style: null });
    } else if ('key' in part) {
      const text = universe.get(part.key);
      requireThat(text !== undefined, `${where}: unknown software value ${part.key}`);
      out.push({ t: 'value', key: part.key, text });
    } else out.push(...decompose(part.opaque, candidates, where));
  }
  return out;
}

/** Parses a PW3 pipe table: header, body rows and any note lines around it. */
export function parseMarkdownTable(markdown: string): { header: string[]; rows: string[][]; notes: string[] } {
  const lines = markdown.split('\n');
  const split = (line: string) => line.trim().replace(/^\|/u, '').replace(/\|$/u, '').split(/(?<!\\)\|/u).map((c) => c.trim().replace(/\\\|/gu, '|'));
  const tableLines = lines.filter((l) => l.trim().startsWith('|'));
  requireThat(tableLines.length >= 2 && /^\|(?:\s*:?-{3,}:?\s*\|)+$/u.test(tableLines[1]!.trim()), 'table markdown is not a pipe table');
  const header = split(tableLines[0]!);
  const rows = tableLines.slice(2).map(split);
  requireThat(rows.every((r) => r.length === header.length), 'ragged table row');
  return { header, rows, notes: lines.filter((l) => l.trim() && !l.trim().startsWith('|')).map((l) => l.trim()) };
}

const textElements = (svg: string): string[] => {
  const parsed = parseSvg(svg);
  requireThat(parsed.root && !parsed.issues.length, 'figure SVG does not parse strictly');
  return [...walk(parsed.root)].filter((e) => e.tag === 'text').map(ownText).filter((t) => t.trim().length > 0);
};

const bindingCandidates = (prefix: string, values: readonly { text: string; sources: readonly { type: string; id: string }[] }[]): UniverseValue[] =>
  values.map((v) => ({ key: `bound:${prefix}:${v.sources.map((s) => `${s.type}:${s.id}`).join('+')}`, text: v.text }));

/** Assemble the manuscript. Every drafted region goes through renderDraft (all lints) again. */
export function buildManuscript(plan: ManuscriptPlan): Manuscript {
  const { ctx, registry } = plan;
  assertContext(ctx);
  const buildId = buildIdFor(ctx.input.sha256, plan.nonce);
  const universe = new Map(contextUniverse(ctx));
  if(universe.has('r:plan_hash'))universe.set('r:plan_hash_short',universe.get('r:plan_hash')!.slice(0,12));
  for(const kind of ['figure','table'] as const){let n=0;for(const section of plan.sections)for(const b of section.blocks)if(b.kind===kind||kind==='figure'&&b.kind==='publication-figure'||kind==='table'&&(b.kind==='claim-table'||b.kind==='methods-specification')){const id=b.kind==='publication-figure'?b.spec.id:b.kind==='figure'?b.figure.id:b.kind==='table'?b.table.id:b.kind==='claim-table'||b.kind==='methods-specification'?b.id:'';universe.set(`${kind==='figure'?'fig':'tab'}:${id}`,`${kind==='figure'?'Figure':'Table'} ${++n}`);}}
  const candidates = [...universe].map(([key, text]) => ({ key, text }));
  requireThat(new Set(plan.sections.map((s) => s.id)).size === plan.sections.length, 'duplicate section ID');
  let figureNumber = 0, tableNumber = 0;
  const figures: SkeletonContext['figures'][number][] = [], tables: SkeletonContext['tables'][number][] = [];
  const protectedRegions: { id: string; sha256: string }[] = [];

  const titleText = renderTitle(ctx);
  const metaTitle = makeUnit(buildId, { block: 'meta/title', index: 0, section: 'meta', container: 'metadata', origin: 'software', inlines: [{ t: 'text', text: titleText, style: null }] });
  const description = plan.metadata?.description ? makeUnit(buildId, { block: 'meta/description', index: 0, section: 'meta', container: 'metadata', origin: 'software', inlines: softwareInlines(plan.metadata.description, universe, candidates, 'meta/description') }) : null;
  const keywords = plan.metadata?.keywords?.length ? makeUnit(buildId, { block: 'meta/keywords', index: 0, section: 'meta', container: 'metadata', origin: 'software', inlines: decompose(plan.metadata.keywords.join('; '), candidates, 'meta/keywords') }) : null;
  const title = makeUnit(buildId, { block: 'front/title', index: 0, section: 'front', container: 'title', origin: 'software', inlines: [{ t: 'text', text: titleText, style: null }] });

  const sections: Section[] = plan.sections.map((sp) => {
    requireThat(/^[a-z][a-z-]{0,39}$/u.test(sp.id), 'section ID must be lowercase letters and hyphens');
    requireThat(new Set(sp.blocks.map((b) => b.id)).size === sp.blocks.length, `duplicate block ID in ${sp.id}`);
    requireThat(typeof sp.heading === 'string' && sp.heading.trim() && !hasNumber(sp.heading), `section ${sp.id}: heading must be digit-free software text`);
    const heading = makeUnit(buildId, { block: `${sp.id}/heading`, index: 0, section: sp.id, container: 'heading', origin: 'software', inlines: [{ t: 'text', text: sp.heading, style: null }] });
    const blocks: Block[] = sp.blocks.map((bp): Block => {
      const block = `${sp.id}/${bp.id}`;
      switch (bp.kind) {
        case 'literature-references': {
          const entries=record(ctx.input.frozenLiteratureIndex).entries;requireThat(Array.isArray(entries),'frozen bibliography absent');
          const units=entries.map((value,index)=>{const entry=record(value),bib=record(entry.bibliography);
           requireThat(typeof bib.title==='string'&&Array.isArray(bib.authors)&&bib.authors.every(a=>typeof a==='string')&&Number.isInteger(bib.year)&&typeof bib.journal==='string'&&typeof bib.doi==='string'&&/^10\.\d{4,9}\/\S+$/u.test(bib.doi),'frozen citation lacks a resolvable bibliography record: '+String(entry.key));
           const text=`[${index+1}] ${bib.authors.join(', ').replace(/\b([A-Z])([A-Z])\b/gu,'$1 $2')}. ${bib.title}${/[.!?]$/u.test(bib.title)?'':'.'} ${bib.journal}. ${bib.year};${bib.volume??''}:${bib.pages??''}. DOI: ${bib.doi}.`;
           return makeUnit(buildId,{block,index,section:sp.id,container:'body',origin:'software',citationKeys:[String(entry.key)],inlines:[{t:'value',key:`bibliography:${entry.key}`,text}],paragraph:index});
          });return {kind:'paragraphs',id:bp.id,region:null,units};
        }
        case 'subheading': return {kind:'paragraphs',id:bp.id,region:null,presentation:'subheading',units:[makeUnit(buildId,{block,index:0,section:sp.id,container:'heading',origin:'software',inlines:[{t:'text',text:bp.text,style:null}]})]};
        case 'article-edition': case 'article-info': case 'article-authors': {
          const rows=bp.kind==='article-edition'?editionFields(bp.edition).map(f=>[f]):bp.kind==='article-info'?articleFields(ctx,bp.document,bp.edition).map(f=>[f]):authorFields(ctx,bp.document);
          return {kind:'paragraphs',id:bp.id,region:null,units:rows.map((fields,index)=>makeUnit(buildId,{block,index,section:sp.id,container:'body',origin:'software',inlines:fields.map(f=>({t:'value',...f})),paragraph:index}))};
        }
        case 'reporting-checklist': {
          const list=reportingChecklist(bp.name);
          // Final anchor approval is not inferred from a successful layout render.
          const texts=[`${list.name} (${list.version}). ${list.attribution}`, ...list.items.map(i=>`${list.name} ${i.id}: ${i.prompt}. Final evidence-anchor review pending.`)];
          return {kind:'paragraphs',id:bp.id,region:null,units:texts.map((text,index)=>makeUnit(buildId,{block,index,section:sp.id,container:'body',origin:'software',inlines:[{t:'value',key:`checklist:${bp.name}:${index}`,text}],paragraph:index}))};
        }
        case 'methods-shared': case 'methods-specification': {
          const doc=plan.renderOptions?.methods;requireThat(doc,'authenticated Methods required');assertMethods(ctx,doc);
          let index=0;const cell=(text:string,container:Container='table-cell',claims:readonly string[]=[],citationKeys:readonly string[]=[])=>makeUnit(buildId,{block,index:index++,section:sp.id,container,origin:'software',claimIds:claims,citationKeys,inlines:[{t:'value',key:`methods:${ctx.input.sha256}:${bp.kind}:${index}`,text}],paragraph:index-1});
          if(bp.kind==='methods-shared')return {kind:'paragraphs',id:bp.id,region:'methods',units:doc.shared.filter(g=>!bp.topic||g.topic===bp.topic).map(g=>cell((g.claimIds.length===ctx.claims.length?'':`For ${g.claimIds.map(id=>ctx.claims.find(c=>c.id===id)!.plan.exposure).join(' and ')}, `)+(g.claimIds.length===ctx.claims.length?g.text:g.text[0]!.toLowerCase()+g.text.slice(1)),'body',g.claimIds,g.citationKeys))};
          const number=++tableNumber,id=bp.id,hash=canonicalSha256(doc.specification),sha256={markdown:hash,csv:hash,dictionary:hash};tables.push({id,number,...sha256});
          const outcomeIndex=doc.specification.header.indexOf('Outcome'),outcomes=new Set(doc.specification.rows.map(row=>row[outcomeIndex])),commonOutcome=outcomeIndex>=0&&outcomes.size===1?[...outcomes][0]:undefined;
          const keep=(_:unknown,col:number)=>!commonOutcome||col!==outcomeIndex;
          return {kind:'table',id,tableId:id,number,sha256,csvSha256:hash,caption:makeUnit(buildId,{block,index:index++,section:sp.id,container:'caption',origin:'software',inlines:[...softwareInlines([{key:`tab:${id}`},'. Claims specified in the locked plan.'],universe,candidates,block),...commonOutcome?[{t:'value' as const,key:`methods:${ctx.input.sha256}:common-outcome`,text:` Outcome: ${commonOutcome}.`}]:[]]}),header:doc.specification.header.filter(keep).map(t=>cell(t)),rows:doc.specification.rows.map((row,i)=>row.filter(keep).map(t=>cell(t,'table-cell',[ctx.claims[i]!.id]))),notes:[]};
        }
        case 'claim-table': {
          const number=++tableNumber,id=bp.id;let index=0;
          const cell=(parts:readonly SoftwarePart[],claimId?:string,provides:readonly string[]=[],container:Container='table-cell')=>makeUnit(buildId,{block,index:index++,section:sp.id,container,origin:'software',claimIds:claimId?[claimId]:[],provides,inlines:softwareInlines(parts,universe,candidates,block)});
          const outcomes=[...new Set(ctx.claims.map(c=>String(c.plan.outcome)))],commonOutcome=outcomes.length===1?outcomes[0]:undefined;
          const outcomeText=commonOutcome?(plan.plainLanguage?plainify(commonOutcome,plan.plainLanguage,registry,false):commonOutcome):null;
          const caption=makeUnit(buildId,{block,index:index++,section:sp.id,container:'caption',origin:'software',inlines:[{t:'value',key:`tab:${id}`,text:`Table ${number}`},{t:'value',key:`claim-table:${ctx.input.sha256}:caption`,text:'. Findings in pre-registered plan order.'+(outcomeText?` Outcome: ${outcomeText}.`:'')+' The confidence interval (CI) accompanies each estimate.'}]});
          const available=ctx.claims.filter(c=>honestNullReason(c)===null&&c.bundle),levels=[...new Set(available.map(c=>c.bundle!.ciLevel))],measures=[...new Set(available.map(c=>c.bundle!.measure))];
          const resultHeading=(measures.length===1?sentencePositionValue(plan.plainLanguage?plainify(measures[0]!,plan.plainLanguage,registry):measures[0]!,'start'):'Estimate')+` (${levels.length===1?formatNumber(levels[0]!*100,'percent')+' ':''}CI)`;
          const boundCell=(claimId:string,key:string,text:string,container:Container='table-cell',provides:readonly string[]=[])=>makeUnit(buildId,{block,index:index++,section:sp.id,container,origin:'software',claimIds:claimId?[claimId]:[],provides,inlines:[{t:'value',key:`claim-table:${ctx.input.sha256}:${claimId}:${key}`,text}]});
          const header=['Exposure',...commonOutcome?[]:['Outcome'],resultHeading,'Adjusted p','n','Status'].map(text=>boundCell('','heading',text));
          const notes:Unit[]=[];
          const exactEffects=formatExactColumn(available.flatMap(c=>[c.bundle!.estimate,...c.bundle!.ci])),pBundles=available.filter(c=>c.bundle!.p!==null),exactPs=formatExactColumn(pBundles.map(c=>c.bundle!.p!));
          const effects=new Map(available.map((c,i)=>[c.id,exactEffects.slice(i*3,i*3+3)])),ps=new Map(pBundles.map((c,i)=>[c.id,exactPs[i]!]));
          const rows=resultsBlockPlans(ctx).map(b=>{
            requireThat(b.kind==='software'&&b.paragraphs[0]?.claimIds?.length===1,'invalid claim table ancestry');
            const claimId=b.paragraphs[0]!.claimIds![0]!,c=ctx.claims.find(c=>c.id===claimId)!,bundle=honestNullReason(c)===null?c.bundle:null;
            const effect=effects.get(claimId);
            const values=bundle?[`${effect![0]} (${effect![1]}–${effect![2]})`,bundle.p===null?'—':ps.get(claimId)!,formatNumber(bundle.n,'count')]:['—','—','—'];
            requireThat(values.every(v=>/^[\d.,()<>+=−–—eE\s-]+$/u.test(v)),'finding table numeric cell contains prose');
            const status=sentencePositionValue(c.status.replaceAll('-',' '),'start');
            notes.push(cell([`${c.plan.exposure}: `,{key:`label-table:${claimId}`},'.'],claimId,[],'table-note'));
            if(honestNullReason(c)!==null)notes.push(cell([`${c.plan.exposure}: no reportable result. `,{key:`m:${claimId}.null_reason`}],claimId,[],'table-note'));
            return [boundCell(claimId,'exposure',String(c.plan.exposure),'table-cell',[`block:results:${claimId}`]),...commonOutcome?[]:[boundCell(claimId,'outcome',String(c.plan.outcome))],...values.map((text,i)=>boundCell(claimId,['interval','p','n'][i]!,text)),boundCell(claimId,'status',status)];
          });
          const adjustment=[...new Set(available.map(c=>`${c.bundle!.adjustment}; effective alpha = ${formatNumber(c.bundle!.effectiveAlpha,'parameter')}; ${formatNumber(c.bundle!.familySize,'count')} tests`))];
          if(adjustment.length)notes.unshift(boundCell('','adjustments','Adjustment: '+adjustment.join('; ')+'.','table-note'));
          notes.push(boundCell('','precision','Decimal padding aligns each numeric column; it does not imply additional measurement precision. Every displayed value equals its certified value.','table-note'));
          notes.push(boundCell('','decision','Decision rule: support requires p at or below the effective alpha and the interval on the registered side of the null; refutation requires the interval within the equivalence bounds. The locked calibration rule takes precedence where explicitly stated in Methods.','table-note'));
          notes.push(boundCell('','abbreviations','Abbreviations: CI, confidence interval; n, analysis units; p, multiplicity-adjusted p-value. A dash means no reportable certified value.','table-note'));
          const hash=canonicalSha256({paper:ctx.input.sha256,header:header.map(u=>u.text),rows:rows.map(row=>row.map(u=>u.text)),notes:notes.map(u=>u.text)}),sha256={markdown:hash,csv:hash,dictionary:hash};
          tables.push({id,number,...sha256});return {kind:'table',id,tableId:id,number,sha256,csvSha256:hash,caption,header,rows,notes};
        }
        case 'data-source-overview': {
          const value=methodCompleteness(ctx,'data-sources');
          return {kind:'paragraphs',id:bp.id,region:null,units:[makeUnit(buildId,{block,index:0,section:sp.id,container:'body',origin:'software',inlines:[{t:'value',key:`data-source-overview:${value.evidenceHash}`,text:value.text}],paragraph:0})]};
        }
        case 'limitations-part-b': {
          const doc=limitationsPartBDocument(ctx,bp.entries,registry);
          const units=doc.text.split('\n').map((text,index)=>makeUnit(buildId,{block,index,section:sp.id,container:'body',origin:'software',inlines:[{t:'value',key:`limitations-part-b:${canonicalSha256(bp.entries)}:${index}`,text:text.replace(/&#(\d+);/gu,(_,n)=>String.fromCodePoint(Number(n))).replaceAll('&amp;','&')}],paragraph:index}));
          for(const review of doc.reviews)units.push(makeUnit(buildId,{block,index:units.length,section:sp.id,container:'body',origin:'software',inlines:[{t:'value',key:`ai-review:${canonicalSha256(review)}`,text:aiReviewNotice(review)}],paragraph:units.length}));
          return {kind:'paragraphs',id:bp.id,region:null,units};
        }
        case 'producer': {
          const doc=bp.document;
          if(bp.producer==='matter')assertMatter(ctx,doc as MatterDocument);else assertSoftwareBox(ctx,doc,{'plain-summary':'plain summary','idea-in-brief':'idea-in-brief box','glossary-box':'glossary box'}[bp.producer]);
          if(bp.producer==='matter'&&bp.heading)requireThat((doc as MatterDocument).regions.some(r=>r.heading===bp.heading),'unknown authenticated matter region');
          const text=bp.producer==='matter'?(doc as MatterDocument).regions.filter(r=>!bp.heading||r.heading===bp.heading).map(r=>r.text.replace(/&#(\d+);/gu,(_,n)=>String.fromCodePoint(Number(n))).replaceAll('&amp;','&')).join('\n'):(doc as PlainSummary).text.replace(bp.producer==='idea-in-brief'?/^The idea in brief\n/u:bp.producer==='glossary-box'?/^Glossary\n/u:/$^/u,'');
          if(bp.producer==='matter'&&bp.tableColumn!==undefined){
            const parsed=parseMarkdownTable(text),col=bp.tableColumn;
            requireThat(Number.isInteger(col)&&col>0&&col<parsed.header.length,'invalid authenticated matter table column');
            const number=++tableNumber,id=bp.id,hash=canonicalSha256({document:doc.sha256,column:col});let index=0;
            const cell=(text:string,container:Container='table-cell')=>makeUnit(buildId,{block,index:index++,section:sp.id,container,origin:'software',inlines:[{t:'value',key:container==='caption'?`tab:${id}`:`producer:matter-table:${hash}:${index}`,text}]});
            const caption=cell(`Table ${number}. Artificial intelligence use: ${parsed.header[col]}.`,'caption');
            const header=[cell(parsed.header[0]!),cell(parsed.header[col]!)],rows=parsed.rows.map(row=>[cell(row[0]!),cell(row[col]!)]);
            const sha256={markdown:hash,csv:hash,dictionary:hash};tables.push({id,number,...sha256});
            return {kind:'table',id,tableId:id,number,sha256,csvSha256:hash,caption,header,rows,notes:[]};
          }
          if(bp.producer==='glossary-box'){
            const units=text.split(/\n+/u).filter(t=>t.trim()).flatMap((text,row)=>{
              const colon=text.indexOf(':');const pair=colon<0?[text]:[text.slice(0,colon+1),text.slice(colon+1).trimStart()];
              return pair.map((text,col)=>makeUnit(buildId,{block,index:row*2+col,section:sp.id,container:'body',origin:'software',inlines:text?[{t:'value',key:`producer:glossary-box:${doc.sha256}:${row}:${col}`,text}]:[],paragraph:row}));
            });
            return {kind:'paragraphs',id:bp.id,region:null,presentation:'description',units};
          }
          const units=text.split(/\n+/u).filter(t=>t.trim()&&!(bp.producer==='matter'&&bp.proseOnly&&t.trim().startsWith('|'))).map((text,index)=>makeUnit(buildId,{block,index,section:sp.id,container:'body',origin:'software',inlines:[{t:'value',key:`producer:${bp.producer}:${doc.sha256}:${index}`,text}],paragraph:index}));
          return {kind:'paragraphs',id:bp.id,region:null,units};
        }
        case 'draft': {
          requireThat(!bp.lead||sp.id==='abstract'&&['Background','Methods','Results','Conclusions'].includes(bp.lead),'structured abstract lead is not allowed here');
          const rendered = renderDraft(ctx, bp.source, bp.region, registry,plan.renderOptions);
          const requests = parseDraft(bp.source, registry);
          requireThat(requests.length === rendered.sentences.length, 'draft re-parse disagrees with the renderer');
          const units = rendered.sentences.map((s, index) => {
            const template = s.claimIds.length > 0 && s.citationKeys.length === 0;
            return makeUnit(buildId, {
              block, index, section: sp.id, container: 'body', origin: template ? 'software' : 'drafter', template,
              claimIds: s.claimIds, citationKeys: s.citationKeys, inlines: [...index===0&&bp.lead?[{t:'text' as const,text:bp.lead+'. ',style:'strong' as const}]:[],...sentenceInlines(s)], source: requests[index]!.text, paragraph: bp.region==='results'?index+1:requests[index]!.paragraph,
            });
          });
          if(rendered.sharedResults)units.unshift(makeUnit(buildId,{block:block+'/shared-evidence',index:0,section:sp.id,container:'body',origin:'software',claimIds:rendered.sharedResults.claimIds,provides:rendered.sharedResults.provides,inlines:[{t:'value',key:`results-evidence:${canonicalSha256(rendered.sharedResults)}`,text:rendered.sharedResults.text}],paragraph:0}));
          const notice=aiReviewNotice(rendered.aiReview);
          if(notice)units.push(makeUnit(buildId,{block,index:units.length,section:sp.id,container:'body',origin:'software',inlines:[{t:'value',key:`ai-review:${canonicalSha256(rendered.aiReview)}`,text:notice}],paragraph:units.length}));
          return { kind: 'paragraphs', id: bp.id, region: bp.region, units };
        }
        case 'software': {
          requireThat(bp.paragraphs.length > 0, `${block}: empty software block`);
          const units = bp.paragraphs.map((p, index) => makeUnit(buildId, {
            block, index, section: sp.id, container: 'body', origin: 'software', claimIds: p.claimIds ?? [], provides: p.provides ?? [],
            inlines: softwareInlines(p.parts, universe, candidates, `${block}#${index}`), paragraph: index,
          }));
          return { kind: 'paragraphs', id: bp.id, region: null, units };
        }
        case 'protected': {
          requireThat(bp.regions.length > 0, `${block}: empty protected block`);
          const units = bp.regions.map((r, index) => {
            requireThat(/^[A-Za-z0-9_.-]+$/u.test(r.id) && canonicalSha256({ id: r.id, text: r.text }) === r.sha256, `${block}: protected region hash mismatch`);
            requireThat(!protectedRegions.some((p) => p.id === r.id), `${block}: duplicate protected region ${r.id}`);
            protectedRegions.push({ id: r.id, sha256: r.sha256 });
            return makeUnit(buildId, { block, index, section: sp.id, container: 'protected', origin: 'software', protectedId: r.id, protectedSha256: r.sha256, provides: [`protected:${r.id}#${r.sha256}`], inlines: decompose(r.text, candidates, `${block}#${index}`), paragraph: index });
          });
          return { kind: 'protected', id: bp.id, units };
        }
        case 'publication-figure': {
          // Render only from a checked reference-only spec and authenticated FactStore.
          // Callers cannot provide SVG bytes, numbers or a fabricated binding table.
          const f=renderPublicationFigure(bp.spec,bp.store),number=++figureNumber;
          requireThat(bp.caption.trim().length>0&&!hasNumber(bp.caption),'publication caption must be digit-free host prose');
          const csvSha256=f.sourceCsvSha256;
          const caption=makeUnit(buildId,{block,index:1,section:sp.id,container:'caption',origin:'software',inlines:[{t:'value',key:`fig:${f.id}`,text:`Figure ${number}`},{t:'text',text:'. '+bp.caption,style:null}]});
          const alt=makeUnit(buildId,{block,index:0,section:sp.id,container:'alt',origin:'software',inlines:[{t:'value',key:`publication-alt:${f.sha256}:${csvSha256}`,text:f.alt}]});
          figures.push({id:f.id,number,svg:f.sha256,csv:csvSha256});
          return {kind:'figure',id:bp.id,figureId:f.id,number,src:`figures/${f.id}.svg`,svg:f.svg,sourceCsv:f.sourceCsv,svgSha256:f.sha256,csvSha256,svgTexts:textElements(f.svg),alt,caption,sourceCaption:bp.caption};
        }
        case 'figure': {
          const f = bp.figure;
          const number = ++figureNumber;
          const local = bindingCandidates(f.id, f.bindings.values);
          const label = `Figure ${number}`;
          const caption = makeUnit(buildId, { block, index: 1, section: sp.id, container: 'caption', origin: 'software', inlines: [{ t: 'value', key: `fig:${f.id}`, text: label }, { t: 'text', text: '. ', style: null }, ...decompose(f.caption.text, local, `${block} caption`)] });
          const alt = makeUnit(buildId, { block, index: 0, section: sp.id, container: 'alt', origin: 'software', inlines: decompose(f.alt.text, local, `${block} alt`) });
          requireThat(/^[a-z][a-z0-9-]{0,63}$/u.test(f.id), 'figure ID is not a slug');
          figures.push({ id: f.id, number, svg: f.sha256, csv: f.provenance.csvSha256 });
          return { kind: 'figure', id: bp.id, figureId: f.id, number, src: `figures/${f.id}.svg`, svg: f.svg, sourceCsv:f.sourceCsv, svgSha256: f.sha256, csvSha256: f.provenance.csvSha256, svgTexts: textElements(f.svg), alt, caption, sourceCaption:f.caption.text };
        }
        case 'table': {
          const t = bp.table;
          const number = ++tableNumber;
          requireThat(typeof bp.caption === 'string' && bp.caption.trim() && !hasNumber(bp.caption), `${block}: table caption must be digit-free software text`);
          const local = bindingCandidates(t.id, t.bindings.values);
          const parsed = parseMarkdownTable(t.markdown);
          let index = 0;
          const caption = makeUnit(buildId, { block, index: index++, section: sp.id, container: 'caption', origin: 'software', inlines: [{ t: 'value', key: `tab:${t.id}`, text: `Table ${number}` }, { t: 'text', text: `. ${bp.caption.trim()}`, style: null }] });
          const cell = (text: string, where: string) => makeUnit(buildId, { block, index: index++, section: sp.id, container: 'table-cell', origin: 'software', inlines: decompose(text, local, where) });
          const header = parsed.header.map((h, c) => cell(h, `${block} header ${c}`));
          const rows = parsed.rows.map((r, ri) => r.map((v, c) => cell(v, `${block} row ${ri} cell ${c}`)));
          const notes = parsed.notes.map((n, ni) => makeUnit(buildId, { block, index: index++, section: sp.id, container: 'table-note', origin: 'software', inlines: decompose(n, local, `${block} note ${ni}`) }));
          tables.push({ id: t.id, number, markdown: t.sha256.markdown, csv: t.sha256.csv, dictionary: t.sha256.dictionary });
          return { kind: 'table', id: bp.id, tableId: t.id, number, sha256: t.sha256, csvSha256: t.provenance.csvSha256, caption, header, rows, notes };
        }
        case 'notes': {
          requireThat(bp.notes.length > 0, `${block}: empty notes block`);
          const units = bp.notes.map((p, index) => makeUnit(buildId, { block, index, section: sp.id, container: 'footnote', origin: 'software', provides: p.provides ?? [], inlines: softwareInlines(p.parts, universe, candidates, `${block}#${index}`), paragraph: index }));
          return { kind: 'notes', id: bp.id, units };
        }
      }
    });
    return { id: sp.id, heading, blocks };
  });
  requireThat(new Set(figures.map((f) => f.id)).size === figures.length && new Set(tables.map((t) => t.id)).size === tables.length, 'figure or table placed twice');

  if(plan.presentation==='preprint'){
    const notices:Unit[]=[];
    for(let i=0;i<sections.length;i++)sections[i]={...sections[i]!,blocks:sections[i]!.blocks.map(b=>{
      if(b.kind!=='paragraphs')return b;
      const isNotice=(u:Unit)=>u.inlines.some(v=>v.t==='value'&&v.key.startsWith('ai-review:'));
      notices.push(...b.units.filter(isNotice).map(u=>({...u,section:'review-records'})));
      return {...b,units:b.units.filter(u=>!isNotice(u))};
    })};
    if(notices.length){requireThat(!sections.some(s=>s.id==='review-records'),'duplicate review records section');sections.push({id:'review-records',heading:makeUnit(buildId,{block:'review-records/heading',index:0,section:'review-records',container:'heading',origin:'software',inlines:[{t:'text',text:'Review and verification records',style:null}]}),blocks:[{kind:'paragraphs',id:'notices',region:null,units:notices}]});}
  }

  const context: SkeletonContext = {
    paperInput: ctx.input.sha256,
    claims: ctx.claims.map((c) => ({ id: c.id, label: threePartLabel(ctx, c.id).full, scope: c.scope, status: c.status })),
    protectedRegions,
    citations: ctx.quotes.map((q) => ({ key: q.key, status: q.status })),
    figures, tables,
    checklist: { ...plan.checklist ?? {} },
  };
  const reader=(u:Unit,header=false):Unit=>{
    if(!plan.plainLanguage)return u;
    assertTermRegistry(plan.plainLanguage);
    if(u.inlines.some(i=>i.t==='value'&&(/^(?:article:|author:)/u.test(i.key)||i.key.startsWith('claim-table:')&&!/:(?:exposure|outcome)$/u.test(i.key))))return u;
    // Reader boxes are already authenticated plain-language producers.
    if(u.inlines.some(i=>i.t==='value'&&/^producer:(?:plain-summary|idea-in-brief|glossary-box):/u.test(i.key)))return u;
    let prefix='';const inlines=u.inlines.map(i=>{const initial=!prefix.trim()||/[.!?]\s*$/u.test(prefix);const text=plainify(i.text.replace(/\bDOI\b/gu,'digital object identifier').replace(/\bSHA\b/gu,'secure hash algorithm').replace(/\bGAMER\b/gu,'generative artificial intelligence reporting checklist'),plan.plainLanguage!,registry,initial);prefix+=text;return {...i,text};});
    for(let n=0;n<inlines.length;n++){const i=inlines[n]!;if(i.t==='value'&&i.key.includes('.result'))inlines[n]={...i,text:i.text.replace(/(\d)-(\d)/gu,'$1–$2')};}
    if((u.container==='heading'||header)&&inlines[0]?.text)inlines[0]={...inlines[0],text:sentencePositionValue(inlines[0].text,'start',registry.entries.map(e=>e.entry.label))};
    if(u.container==='body'&&u.inlines.some(i=>i.t==='value'&&i.key.startsWith('producer:matter:'))){const stop=statementStop(inlines.map(i=>i.text).join(''));if(stop)inlines.push({t:'text',text:stop,style:null});}
    return {...u,inlines,text:inlines.map(i=>i.text).join('')};
  };
  const readableSections=sections.map(s=>({...s,heading:reader(s.heading),blocks:s.blocks.map((b):Block=>b.kind==='figure'?{...b,caption:reader(b.caption),alt:reader(b.alt)}:b.kind==='table'?{...b,caption:reader(b.caption),header:b.header.map(u=>reader(u,true)),rows:b.rows.map(row=>row.map((u,index)=>reader(u,index===0&&u.inlines.some(i=>i.t==='value'&&i.key.startsWith('producer:matter-table:'))))),notes:b.notes.map(u=>reader(u))}:{...b,units:b.units.map(u=>reader(u))})}));
  const draft = { schema: 'omb/pw8/manuscript@1' as const, buildId, paperInputHash: ctx.input.sha256, meta: { title: reader(metaTitle), description:description?reader(description):null, keywords:keywords?reader(keywords):null }, title:reader(title), sections:readableSections };
  const running=new Set(['abstract','introduction','methods','results','discussion','conclusions','plain-summary','idea-in-brief']);
  for(const unit of allUnits(draft)){
    // Heading, cell, glossary, bibliography and structured record labels are not sentences.
    // Placeholder detection still applies to every visible unit.
    const panelLabel=unit.section==='idea-in-brief'&&unit.inlines.some(i=>i.t==='value'&&i.key.startsWith('producer:idea-in-brief:'))&&/^The (?:question|design):/u.test(unit.text);
    const prose=unit.container==='body'&&running.has(unit.section)&&!panelLabel&&!unit.inlines.some(i=>i.t==='value'&&i.key.startsWith('ai-review:'));
    const text=unit.text.replace(/^(?:Background|Methods|Results|Conclusions)\.\s*/u,'');
    assertFinalText(text,registry.entries.map(e=>e.entry.label),prose);
  }
  for(const section of readableSections){if(section.id!=='results')continue;const prose=allUnits(draft).filter(u=>u.section===section.id&&u.container==='body'&&(u.origin==='drafter'||u.template||u.inlines.some(i=>i.t==='value'&&i.key.startsWith('results-evidence:'))));assertNoRepeatedSentences(prose.map(u=>u.text).join(' '));}
  const skeleton: Skeleton = { schema: 'omb/pw8/skeleton@1', context, units: allUnits(draft).map(skeletonUnit) };
  const contextSha256 = canonicalSha256(context);
  return deepFreeze({ ...draft, skeleton, contextSha256, skeletonSha256: skeletonHash(contextSha256, skeleton.units) });
}

export function skeletonHash(contextSha256: string, units: readonly SkeletonUnit[]): string {
  return canonicalSha256({ schema: 'omb/pw8/skeleton@1', context: contextSha256, units });
}

/** Strip a closed-list connective so a connective change is a prose change. */
export function templateCore(text: string): string {
  for (const c of [...CONNECTIVES].filter(Boolean).sort((a, b) => b.length - a.length)) if (text.startsWith(c + ' ')) return text.slice(c.length + 1);
  return text;
}

export function skeletonUnit(u: Unit): SkeletonUnit {
  return {
    block: u.block, sec: u.section, c: u.container, o: u.origin, tpl: u.template, claims: [...u.claimIds], cites: [...u.citationKeys], provides: [...u.provides],
    values: u.inlines.filter((i): i is ValueInline => i.t === 'value').map((i) => [i.key, i.text] as const),
    text: u.origin === 'software' ? canonicalSha256(u.template ? templateCore(u.text) : u.text) : null,
    prot: u.protectedId ? `${u.protectedId}#${u.protectedSha256}` : null,
  };
}

/** Every unit in canonical order: metadata, title, then each section in reading order (alt text after its figure image). */
export function allUnits(m: Pick<Manuscript, 'meta' | 'title' | 'sections'>): Unit[] {
  const out: Unit[] = [m.meta.title, ...m.meta.description ? [m.meta.description] : [], ...m.meta.keywords ? [m.meta.keywords] : [], m.title];
  for (const s of m.sections) {
    if(visibleSectionHeading(s))out.push(s.heading);
    for (const b of s.blocks) {
      if (b.kind === 'figure') out.push(b.alt, b.caption);
      else if (b.kind === 'table') out.push(b.caption, ...b.header, ...b.rows.flat(), ...b.notes);
      else out.push(...b.units);
    }
  }
  return out;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); for (const v of Object.values(value)) deepFreeze(v); }
  return value;
}

// ------------------------------------------------------------------------------------------
// Software producers that the must-appear set expects (thin, trusted, from the sealed context)

/** One Results block per claim, in the plan order bio-report used: primary, planned, then the rest. */
export function resultsBlockPlans(ctx: ReportContext): BlockPlan[] {
  assertContext(ctx);
  const pf = ctx.input.plannedFound;
  const ids = [...pf.primaryClaimId ? [pf.primaryClaimId] : [], ...pf.plannedClaimIds.filter((id) => id !== pf.primaryClaimId), ...ctx.claims.filter((c) => !pf.plannedClaimIds.includes(c.id)).map((c) => c.id)];
  requireThat(new Set(ids).size === ctx.claims.length, 'missing Results claim');
  return ids.map((id) => {
    const c = ctx.claims.find((x) => x.id === id);
    requireThat(c, 'missing Results block');
    requireThat(validLock(ctx, id) || c.status === 'exploratory' || c.status === 'voided', 'outcome has no locked ancestry');
    const hasResult = honestNullReason(c)===null&&ctx.slots.has(`m:${id}.result`);
    const evidence: SoftwarePart[] = hasResult
      ? ['The ',{ key: `m:${id}.result` }, '. Provenance: facts hash ', { key: `hash:facts:${id}` }, '; code hash ', { key: `hash:code:${id}` }, '; certificate hash ', { key: `hash:cert:${id}` }, '.']
      : honestNullReason(c)!==null?['No reportable result: ',{key:`m:${id}.null_reason`},'. Certificate hash ',{key:`hash:cert:${id}`},'.']: ['Result bundle unavailable; no unchecked number is shown. Certificate hash ', { key: `hash:cert:${id}` }, '.'];
    return {
      kind: 'software', id: `results-${id}`,
      paragraphs: [
        { parts: ['Claim ', { key: `claim:${id}` }, ' ', { key: `label:${id}` }], provides: [`block:results:${id}`], claimIds: [id] },
        { parts: evidence, claimIds: [id] },
        { parts: ['Outcome: ', { opaque: outcomeText(ctx, c) }, '.'], claimIds: [id] },
      ],
    };
  });
}

/** The claim-count sentence: every registered claim is reported, held or not. */
export function claimCountBlockPlan(ctx: ReportContext): BlockPlan {
  assertContext(ctx);
  return { kind: 'software', id: 'claim-count', paragraphs: [{ parts: ['The locked plan registered ', { key: 'count:registered' }, ' hypotheses; this paper reports all ', { key: 'count:claims' }, ' claims in plan order, whether or not they held.'], provides: ['block:claim-count'] }] };
}

/** Limitations Part A as a protected block (software lines, hashed). */
export function limitationsBlockPlan(ctx: ReportContext): BlockPlan {
  return { kind: 'protected', id: 'part-a', regions: limitationsPartA(ctx) };
}

/** Figure-only PDF readback: visible text and accessibility text both derive
 * from the regenerated SVG, including its software title and description. */
export function figureReadbackManuscript(m:Manuscript,f:FigureBlock):Manuscript {
 const parsed=parseSvg(f.svg);requireThat(parsed.root&&!parsed.issues.length,'figure PDF: invalid source SVG');
 const alt=[...walk(parsed.root)].filter(e=>e.tag==='title'||e.tag==='desc').map(ownText).join(' ');
 const title={...m.title,text:f.svgTexts.join(' ')};
 return {...m,title,meta:{title:{...title,container:'metadata'},description:null,keywords:null},sections:[{id:'figure',heading:{...m.title,text:''},blocks:[{...f,svgTexts:[],alt:{...f.alt,text:alt},caption:{...f.caption,text:''}}]}]};
}
