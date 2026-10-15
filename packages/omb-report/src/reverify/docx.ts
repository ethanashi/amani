/**
 * PW8 DOCX read-back: a dependency-free ZIP reader (node:zlib) and a direct OOXML scan.
 *
 * Visible text is read from word/document.xml in body order (paragraphs, then table cells
 * row by row). Every other place a DOCX can carry text is scanned: hidden, white or tiny runs,
 * tracked insertions, deletions and moves, comments, headers, footers, footnotes, endnotes,
 * fields, text boxes, drawing alt text, table captions, hyperlinks, embedded media and the
 * core, app and custom document properties.
 *
 * The rendered DOCX must match the verified manuscript exactly (verifyDocx). An owner-edited
 * DOCX is read back with tracked changes resolved (insertions kept, deletions dropped), mapped
 * onto the verified units by their software anchors, turned into drafter requests and
 * re-verified (readBackDocxEdit). The edited DOCX itself is never shipped.
 */
import { posix } from 'node:path';
import { createHash } from 'node:crypto';
import { crc32, inflateRawSync } from 'node:zlib';
import { parseSvg, isElement, type ParsedElement } from '../../../omb-figures/src/xml.ts';
import { ReportRefusal, refuse, requireThat } from '../common.ts';
import { checkDocumentGrammar } from './ooxml.ts';
import { reverifyEdit, type EditResult } from './edit.ts';
import { checkFlow, expectedAltTexts, expectedFlow, normaliseExtracted, type FlowItem } from './flow.ts';
import { visibleSectionHeading, allUnits, type BlockPlan, type Manuscript, type ManuscriptPlan, type Unit } from './manuscript.ts';
import type { OutputIssue, OutputVerification } from './outputs.ts';
import type { EditMode, MustAppearOptions } from './skeleton.ts';

// ------------------------------------------------------------------------------------------
// ZIP

export function readZip(bytes: Uint8Array): Map<string, Uint8Array> {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65_535); i--) if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  requireThat(eocd >= 0, 'DOCX: not a ZIP archive');
  const count = b.readUInt16LE(eocd + 10), cdOffset = b.readUInt32LE(eocd + 16);
  requireThat(count !== 0xffff && cdOffset !== 0xffffffff, 'DOCX: ZIP64 archives are refused');
  const out = new Map<string, Uint8Array>();
  let p = cdOffset;
  for (let k = 0; k < count; k++) {
    requireThat(p + 46 <= b.length && b.readUInt32LE(p) === 0x02014b50, 'DOCX: bad central directory');
    const flags = b.readUInt16LE(p + 8), method = b.readUInt16LE(p + 10), crc = b.readUInt32LE(p + 16);
    const csize = b.readUInt32LE(p + 20), usize = b.readUInt32LE(p + 24);
    const nlen = b.readUInt16LE(p + 28), xlen = b.readUInt16LE(p + 30), clen = b.readUInt16LE(p + 32), local = b.readUInt32LE(p + 42);
    const name = b.subarray(p + 46, p + 46 + nlen).toString('utf8');
    p += 46 + nlen + xlen + clen;
    requireThat(!(flags & 1), 'DOCX: encrypted entries are refused');
    requireThat(!out.has(name), `DOCX: duplicate entry ${name}`);
    requireThat(local + 30 <= b.length && b.readUInt32LE(local) === 0x04034b50, 'DOCX: bad local header');
    const start = local + 30 + b.readUInt16LE(local + 26) + b.readUInt16LE(local + 28);
    const raw = b.subarray(start, start + csize);
    let data: Uint8Array;
    try { data = method === 0 ? Uint8Array.from(raw) : method === 8 ? Uint8Array.from(inflateRawSync(raw)) : refuse(`DOCX: unsupported compression ${method}`); }
    catch (error) { if (error instanceof ReportRefusal) throw error; refuse(`DOCX: ${name} is corrupt`); }
    requireThat(data.length === usize && crc32(data) === crc, `DOCX: ${name} fails its CRC`);
    out.set(name, data);
  }
  return out;
}

// ------------------------------------------------------------------------------------------
// OOXML

function parseXml(bytes: Uint8Array, where: string, issues: OutputIssue[]): ParsedElement {
  const text = Buffer.from(bytes).toString('utf8').replace(/^﻿?<\?xml[^?]*\?>\s*/u, '');
  const parsed = parseSvg(text);
  for (const i of parsed.issues) if (i.code !== 'char-reference') issues.push({ code: 'hidden-text', where, detail: `${i.code}: ${i.detail}` });
  requireThat(parsed.root, `DOCX: ${where} is not well-formed XML`);
  return parsed.root;
}
const local = (tag: string) => tag.slice(tag.indexOf(':') + 1);
const at = (e: ParsedElement, name: string) => e.attrs.find(([k]) => k === name || local(k) === name)?.[1];
const kids = (e: ParsedElement) => e.children.filter(isElement);
const textContent = (e: ParsedElement): string => e.children.map((c) => (isElement(c) ? textContent(c) : c.text)).join('');
const on = (e: ParsedElement | undefined) => !!e && !['0', 'false', 'off'].includes(at(e, 'val') ?? 'true');

export interface DocxParagraph { readonly text: string; readonly cell: boolean }
export interface ExtractedDocx {
  readonly paragraphs: readonly DocxParagraph[];
  /** Hidden-channel findings (each one blocks a rendered DOCX). */
  readonly findings: readonly OutputIssue[];
  /** Tracked changes were present (allowed only in an owner read-back). */
  readonly trackedChanges: number;
  readonly altTexts: readonly string[];
  readonly imagePaths: readonly string[];
  readonly tableCaptions: readonly string[];
  readonly properties: Readonly<Record<string, string>>;
  readonly media: ReadonlyMap<string, string>;
  readonly styleParts: Readonly<Record<string,string>>;
  readonly styleReferences: readonly string[];
  readonly referencedMedia: readonly string[];
}

interface ApprovedSuperscript {paragraph:string;offset:number;text:string}
function authorSuperscripts(m:Manuscript):ApprovedSuperscript[]{return allUnits(m).flatMap(u=>{let offset=0;return u.inlines.flatMap(i=>{const here=offset;offset+=i.text.length;return i.t==='value'&&i.key.startsWith('author:')&&i.key.endsWith(':marker')?[{paragraph:u.text,offset:here,text:i.text}]:[];});});}
export function extractDocx(bytes: Uint8Array,approvedSuperscripts:readonly ApprovedSuperscript[]=[]): ExtractedDocx {
  const zip = readZip(bytes);
  const findings: OutputIssue[] = [];
  const find = (code: OutputIssue['code'], where: string, detail: string) => findings.push({ code, where, detail });
  const docBytes = zip.get('word/document.xml');
  requireThat(docBytes, 'DOCX: missing word/document.xml');
  const doc = parseXml(docBytes, 'word/document.xml', findings);
  findings.push(...checkDocumentGrammar(doc));
  const body = kids(doc).find((e) => local(e.tag) === 'body');
  requireThat(body, 'DOCX: missing body');
  const paragraphs: DocxParagraph[] = [];
  const altTexts: string[] = [], imagePaths: string[] = [], tableCaptions: string[] = [];
  let tracked = 0,currentParagraph='';const usedSuperscripts=new Set<ApprovedSuperscript>();
  const referencedMedia: string[] = [];
  const rels = new Map<string, string>();
  const relBytes = zip.get('word/_rels/document.xml.rels');
  if (relBytes) for (const r of kids(parseXml(relBytes, 'document relationships', findings))) {
    if (!(at(r, 'Type') ?? '').endsWith('/image')) continue;
    requireThat(at(r, 'TargetMode') !== 'External', 'DOCX: external image');
    const target = at(r, 'Target') ?? '';
    requireThat(/^[A-Za-z0-9_.\/-]+$/u.test(target), 'DOCX: unsupported image target');
    const canonical = posix.normalize(target.startsWith('/') ? target.slice(1) : posix.join('word', target));
    requireThat(!canonical.startsWith('../') && zip.has(canonical), 'DOCX: missing image target');
    const id = at(r, 'Id') ?? '';
    requireThat(!rels.has(id), 'DOCX: duplicate image relationship');
    rels.set(id, canonical);
  }

  const runText = (r: ParsedElement, path: string,offset:number): string => {
    const rPr = kids(r).find((e) => local(e.tag) === 'rPr');
    const props = rPr ? kids(rPr) : [];
    const prop = (n: string) => props.find((e) => local(e.tag) === n);
    let s = '';
    for (const c of kids(r)) {
      const t = local(c.tag);
      if (t === 't') s += textContent(c);
      else if (t === 'tab') s += '\t';
      else if (t === 'br' || t === 'cr') s += '\n';
      else if (t === 'noBreakHyphen') s += '-';
      else if (t === 'softHyphen') s += '';
      else if (t === 'sym') s += String.fromCharCode(parseInt(at(c, 'char') ?? '0', 16) & 0xffff);
      else if (t === 'delText') { tracked++; }
      else if (t === 'instrText' || t === 'fldChar') find('hidden-text', path, 'field code in a run');
      else if (t === 'drawing' || t === 'pict' || t === 'object') drawing(c, path);
    }
    if (s.trim()) {
      const vertical=prop('vertAlign'),approved=vertical&&at(vertical,'val')==='superscript'?approvedSuperscripts.find(a=>!usedSuperscripts.has(a)&&a.paragraph===currentParagraph&&a.offset===offset&&a.text===s):undefined;if(approved)usedSuperscripts.add(approved);
      if (props.some(p => !(p===vertical&&approved)&&!['rStyle','vanish','specVanish','webHidden','sz','szCs','color','b','bCs','i','iCs','u'].includes(local(p.tag)))) find('hidden-text', path, 'unsupported direct run formatting');
      const colour = prop('color');
      if (colour && at(colour, 'themeColor')) find('hidden-text', path, 'unapproved direct theme colour');
      if (props.some(p => ['sz','szCs'].includes(local(p.tag)) && Number(at(p,'val')) > 144)) find('hidden-text', path, 'oversized run');
      if (on(prop('vanish')) || on(prop('specVanish')) || on(prop('webHidden'))) find('hidden-text', path, `hidden run "${s.slice(0, 40)}"`);
      const sz = prop('sz');
      if (sz && Number(at(sz, 'val')) < 8) find('hidden-text', path, `tiny run "${s.slice(0, 40)}"`);
      const color = prop('color');
      if (color && /^(?:FFFFFF|FFF)$/iu.test(at(color, 'val') ?? '')) find('hidden-text', path, `white run "${s.slice(0, 40)}"`);
    }
    return s;
  };
  const drawing = (e: ParsedElement, path: string) => {
    for (const x of walkAll(e)) {
      const t = local(x.tag);
      if (t === 'svgBlip' || (t === 'blip' && (at(x, 'embed') || at(x, 'link')))) {
        const target = rels.get(at(x, 'embed') ?? '');
        requireThat(target && !at(x, 'link'), 'DOCX: unresolved drawing relationship');
        referencedMedia.push(createHash('sha256').update(zip.get(target)!).digest('hex'));
      }
      if (t === 'docPr') { const d = at(x, 'descr'), ti = at(x, 'title'); if (d) altTexts.push(d); if (ti) altTexts.push(ti); }
      else if (t === 'cNvPr') { const d = at(x, 'descr'), ti = at(x, 'title'); if (d) imagePaths.push(d); if (ti) altTexts.push(ti); }
      else if (t === 'txbxContent' || t === 'textbox') find('hidden-text', path, 'text box inside a drawing');
    }
  };
  const inline = (e: ParsedElement, path: string): string => {
    let s = '';
    for (const c of kids(e)) {
      const t = local(c.tag);
      if (t === 'r') s += runText(c, path,s.length);
      else if (t === 'ins' || t === 'moveTo') { tracked++; s += inline(c, path); }
      else if (t === 'del' || t === 'moveFrom') { tracked++; }
      else if (t === 'fldSimple') { find('hidden-text', path, `field "${at(c, 'instr') ?? ''}"`); s += inline(c, path); }
      else if (t === 'hyperlink') { find('annotation', path, 'hyperlink'); s += inline(c, path); }
      else if (t === 'smartTag' || t === 'customXml' || t === 'sdt' || t === 'sdtContent') s += inline(c, path);
      else if (t === 'commentRangeStart' || t === 'commentReference') find('hidden-text', path, 'comment anchor');
      else if (t === 'pPr') { /* paragraph mark properties do not hide visible text */ }
    }
    return s;
  };
  const block = (e: ParsedElement, path: string, cell: boolean) => {
    for (const c of kids(e)) {
      const t = local(c.tag);
      if (t === 'p') {currentParagraph=textContent(c);paragraphs.push({ text: inline(c, `${path}/p`), cell });}
      else if (t === 'tbl') {
        for (const x of kids(c)) {
          if (local(x.tag) === 'tblPr') for (const y of kids(x)) { if (local(y.tag) === 'tblCaption' || local(y.tag) === 'tblDescription') tableCaptions.push(at(y, 'val') ?? ''); }
          if (local(x.tag) === 'tr') for (const tc of kids(x)) if (local(tc.tag) === 'tc') block(tc, `${path}/tc`, true);
        }
      } else if (t === 'sdt' || t === 'sdtContent' || t === 'customXml') block(c, path, cell);
      else if (t === 'ins' || t === 'moveTo') { tracked++; block(c, path, cell); }
      else if (t === 'del' || t === 'moveFrom') tracked++;
    }
  };
  block(body, 'body', false);
  if(usedSuperscripts.size!==approvedSuperscripts.length)find('hidden-text','authors','approved author superscript is missing or changed');

  // Other parts that can carry text.
  for (const [name, data] of zip) {
    if (/^word\/(?:header|footer)\d*\.xml$/u.test(name)) { const t = textContent(parseXml(data, name, findings)).trim(); if (t) find('hidden-text', name, `header or footer text "${t.slice(0, 40)}"`); }
    else if (/^word\/(?:comments|commentsExtended|commentsIds|people)\.xml$/u.test(name)) { const root = parseXml(data, name, findings); if (kids(root).length) find('hidden-text', name, 'comments are present'); }
    else if (/^word\/(?:footnotes|endnotes)\.xml$/u.test(name)) {
      const root = parseXml(data, name, findings);
      for (const n of kids(root)) if (!['separator', 'continuationSeparator', 'continuationNotice'].includes(at(n, 'type') ?? '') && textContent(n).trim()) find('hidden-text', name, `note text "${textContent(n).trim().slice(0, 40)}"`);
    } else if (/^word\/_rels\/document\.xml\.rels$/u.test(name)) {
      for (const r of kids(parseXml(data, name, findings))) if ((at(r, 'TargetMode') ?? '') === 'External' || /hyperlink$/u.test(at(r, 'Type') ?? '')) find('annotation', name, `external relationship ${at(r, 'Target') ?? ''}`);
    } else if (/^word\/(?:glossary\/|vbaProject|embeddings\/|activeX\/)/u.test(name)) find('hidden-text', name, 'embedded content part');
  }
  const properties: Record<string, string> = {};
  for (const name of ['docProps/core.xml', 'docProps/app.xml', 'docProps/custom.xml']) {
    const data = zip.get(name);
    if (!data) continue;
    for (const e of walkAll(parseXml(data, name, findings))) if (!kids(e).length && e !== undefined) { const v = textContent(e); const key = `${name.slice('docProps/'.length, -4)}:${at(e, 'name') ?? local(e.tag)}`; if (v.length) properties[key] = v; }
  }
  const media = new Map<string, string>();
  for (const [name, data] of zip) if (name.startsWith('word/media/')) media.set(name, createHash('sha256').update(data).digest('hex'));
  const styleParts: Record<string,string> = {};
  for (const [name,data] of zip) if (/^word\/(?:styles(?:WithEffects)?\.xml|theme\/.*|fonts\/.*|_rels\/fontTable\.xml\.rels|fontTable\.xml|numbering\.xml|settings\.xml|webSettings\.xml)$/u.test(name)) styleParts[name] = createHash('sha256').update(data).digest('hex');
  const styleReferences = [...walkAll(doc)].filter(e => ['pStyle','rStyle','tblStyle'].includes(local(e.tag))).map(e => `${local(e.tag)}:${at(e, 'val') ?? ''}`);
  return { styleParts, styleReferences, paragraphs, findings, trackedChanges: tracked, altTexts, imagePaths, tableCaptions, properties, media, referencedMedia };
}

function* walkAll(e: ParsedElement): Generator<ParsedElement> { yield e; for (const c of kids(e)) yield* walkAll(c); }

// ------------------------------------------------------------------------------------------
// Verification of a rendered DOCX

export interface DocxProfile {
  /** Complete pinned defaults, styles, themes, fonts, numbering and settings parts. */
  readonly styleParts?: Readonly<Record<string,string>>;
  readonly styleReferences?: readonly string[];
  /** The converter writes the metadata title as a first paragraph (pandoc does). */
  readonly titleParagraph?: boolean;
  /** Exact document-property values pinned by the trusted PW9 chain (dates, app counters). */
  readonly properties?: Readonly<Record<string, string>>;
  /** sha256 of each embedded image the chain may write (figure SVGs or their PNG rasters). */
  readonly mediaSha256?: readonly string[];
  readonly requireAlt?: boolean;
}

function styleIssues(x: ExtractedDocx, profile: DocxProfile): OutputIssue[] {
  const issues: OutputIssue[] = [];
  const expected = profile.styleParts ?? {};
  for (const name of new Set([...Object.keys(x.styleParts), ...Object.keys(expected)])) if (!expected[name] || expected[name] !== x.styleParts[name]) issues.push({code:'hidden-text', where:name, detail:'unapproved style/theme part'});
  for (const ref of x.styleReferences) if (!profile.styleReferences?.includes(ref)) issues.push({code:'hidden-text', where:'docx style reference', detail:`unapproved style reference ${ref}`});
  return issues;
}

function docxFlow(m: Manuscript, profile: DocxProfile): FlowItem[] {
  const flow = expectedFlow(m);
  return profile.titleParagraph ? [{ kind: 'unit', uid: m.meta.title.uid, where: 'meta/title', text: m.meta.title.text }, ...flow] : flow;
}

export function verifyDocx(bytes: Uint8Array, expected: Manuscript, profile: DocxProfile = {}): OutputVerification {
  let x: ExtractedDocx;
  try { x = extractDocx(bytes,authorSuperscripts(expected)); }
  catch (error) { return { ok: false, issues: [{ code: 'extract', where: 'docx', detail: error instanceof Error ? error.message : 'unreadable DOCX' }] }; }
  const issues: OutputIssue[] = [...x.findings, ...styleIssues(x, profile)];
  if (x.trackedChanges) issues.push({ code: 'hidden-text', where: 'docx', detail: `${x.trackedChanges} tracked change(s) in a rendered DOCX` });
  issues.push(...checkFlow(docxFlow(expected, profile), [x.paragraphs.map((p) => p.text).join('\n')], { figures: 'raster' }));
  const alts = expectedAltTexts(expected);
  const pool = [...alts];
  for (const a of x.altTexts.map(normaliseExtracted)) { const k = pool.indexOf(a); if (k >= 0) pool.splice(k, 1); else issues.push({ code: 'alt-text', where: 'docx drawing', detail: `alt text "${a.slice(0, 80)}" is not a verified figure alt text` }); }
  if (profile.requireAlt ?? true) for (const p of pool) issues.push({ code: 'alt-text', where: 'docx drawing', detail: `verified alt text "${p.slice(0, 80)}" is missing` });
  const srcs = new Set(expected.sections.flatMap((s) => s.blocks.flatMap((b) => (b.kind === 'figure' ? [b.src] : []))));
  for (const p of x.imagePaths) if (!srcs.has(p) && !alts.includes(normaliseExtracted(p))) issues.push({ code: 'alt-text', where: 'docx picture', detail: `picture description "${p.slice(0, 60)}" is neither a figure source nor its alt text` });
  const captions = new Set(allUnits(expected).filter((u) => u.container === 'caption' && u.inlines[0]?.t === 'value' && u.inlines[0].key.startsWith('tab:')).map((u) => normaliseExtracted(u.text)));
  for (const c of x.tableCaptions) if (c && !captions.has(normaliseExtracted(c))) issues.push({ code: 'metadata', where: 'docx table caption', detail: `table caption "${c.slice(0, 60)}" differs from the verified caption` });
  const metaExpected: Record<string, string> = { 'core:title': expected.meta.title.text, ...expected.meta.description ? { 'core:description': expected.meta.description.text } : {}, ...expected.meta.keywords ? { 'core:keywords': expected.meta.keywords.text } : {}, ...profile.properties };
  for (const [k, v] of Object.entries(x.properties)) if (normaliseExtracted(metaExpected[k] ?? '\u0000') !== normaliseExtracted(v)) issues.push({ code: 'metadata', where: `docx ${k}`, detail: `"${v.slice(0, 80)}" is neither verified metadata nor pinned by the chain profile` });
  const figures = expected.sections.flatMap((s) => s.blocks.flatMap((b) => b.kind === 'figure' ? [b.svgSha256] : []));
  const expectedMedia = profile.mediaSha256 ?? figures;
  if (expectedMedia.length !== figures.length || JSON.stringify(x.referencedMedia) !== JSON.stringify(expectedMedia)) issues.push({ code: 'hidden-text', where: 'docx drawings', detail: 'referenced figure count or identity differs from regenerated figures' });
  const allowedMedia = new Set(expectedMedia);
  for (const [name, sha] of x.media) if (!allowedMedia.has(sha)) issues.push({ code: 'hidden-text', where: name, detail: 'embedded media differs from every regenerated figure' });
  return { ok: issues.length === 0, issues };
}

// ------------------------------------------------------------------------------------------
// Owner DOCX edits: read back as text diffs onto paper sources, then re-verify

interface Para { readonly units: readonly Unit[]; readonly block: string | null }

/** The paragraphs a DOCX holds for the manuscript, in order (empty image paragraphs omitted). */
function expectedParagraphs(m: Manuscript, profile: DocxProfile): Para[] {
  const out: Para[] = [];
  if (profile.titleParagraph) out.push({ units: [m.meta.title], block: null });
  out.push({ units: [m.title], block: null });
  for (const s of m.sections) {
    if(visibleSectionHeading(s))out.push({ units: [s.heading], block: null });
    for (const b of s.blocks) {
      if (b.kind === 'paragraphs') {
        const groups = new Map<number, Unit[]>();
        for (const u of b.units) groups.set(u.paragraph, [...groups.get(u.paragraph) ?? [], u]);
        for (const units of groups.values()) out.push({ units, block: b.region && units.some(u=>u.source!==null) ? `${s.id}/${b.id}` : null });
      } else if (b.kind === 'figure') out.push({ units: [b.caption], block: null });
      else if (b.kind === 'table') for (const u of [b.caption, ...b.header, ...b.rows.flat(), ...b.notes]) out.push({ units: [u], block: null });
      else for (const u of b.units) out.push({ units: [u], block: null });
    }
  }
  return out;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&').replace(/\s+/gu, '\\s+');

/** Match an edited paragraph against its software anchors; returns the rebuilt drafter source. */
function rebuildParagraph(p: Para, text: string): string | null {
  const parts: ({ fixed: string; source: string } | { free: true })[] = [];
  const free = () => { if (!parts.length || !('free' in parts.at(-1)!)) parts.push({ free: true }); };
  p.units.forEach((u, i) => {
    if (i) free();
    if (u.origin === 'software') { parts.push({ fixed: u.text, source: u.source ?? u.text }); return; }
    for (const inl of u.inlines) { if (inl.t === 'value' && !inl.key.startsWith('entity:')) parts.push({ fixed: inl.text, source: `[${inl.key}]` }); else free(); }
  });
  const re = new RegExp(`^\\s*${parts.map((x) => ('free' in x ? '([\\s\\S]*?)' : esc(normaliseExtracted(x.fixed)))).join('')}\\s*$`, 'u');
  const m = re.exec(normaliseExtracted(text));
  if (!m) return null;
  let g = 1;
  return parts.map((x) => ('free' in x ? m[g++]! : x.source)).join('').replace(/\s+/gu, ' ').trim();
}

export interface DocxReadBack extends EditResult { readonly docxIssues: readonly OutputIssue[] }

export function readBackDocxEdit(bytes: Uint8Array, baselinePlan: ManuscriptPlan, baseline: Manuscript, mode: EditMode, profile: DocxProfile = {}, options: MustAppearOptions = {}): DocxReadBack {
  const fail = (docxIssues: OutputIssue[]): DocxReadBack => ({ ok: false, manuscript: null, diff: null, mustAppear: [], refusal: null, htmlIssues: [], docxIssues });
  let x: ExtractedDocx;
  try { x = extractDocx(bytes,authorSuperscripts(baseline)); } catch (error) { return fail([{ code: 'extract', where: 'docx', detail: error instanceof Error ? error.message : 'unreadable DOCX' }]); }
  // Hidden channels still block; tracked changes are resolved, not refused.
  const hidden = [...x.findings, ...styleIssues(x, profile)];
  if (hidden.length) return fail(hidden);
  // Prose and accepted tracked changes may differ; non-text channels may not.
  const channels = verifyDocx(bytes, baseline, profile).issues.filter(i => !['missing-unit','unexpected-text','unbound-number'].includes(i.code) && !(i.where === 'docx' && i.detail.includes('tracked change(s)')));
  if (channels.length) return fail(channels);
  const actual = x.paragraphs.map((p) => p.text).filter((t) => t.trim());
  const expected = expectedParagraphs(baseline, profile);
  if (actual.length !== expected.length) return fail([{ code: 'unexpected-text', where: 'docx', detail: `the edited DOCX has ${actual.length} paragraphs; the verified manuscript has ${expected.length} (paragraphs cannot be added, removed or split in a DOCX edit)` }]);
  const sources = new Map<string, string[]>();
  const issues: OutputIssue[] = [];
  expected.forEach((p, i) => {
    const rebuilt = rebuildParagraph(p, actual[i]!);
    if (rebuilt === null) { issues.push({ code: 'missing-unit', where: p.units[0]!.block, detail: `software text or a signed value changed in "${actual[i]!.slice(0, 100)}"` }); return; }
    if (p.block) sources.set(p.block, [...sources.get(p.block) ?? [], rebuilt]);
  });
  if (issues.length) return fail(issues);
  const edited: ManuscriptPlan = {
    ...baselinePlan,
    sections: baselinePlan.sections.map((sp) => ({ ...sp, blocks: sp.blocks.map((bp): BlockPlan => (bp.kind === 'draft' && sources.has(`${sp.id}/${bp.id}`) ? { ...bp, source: sources.get(`${sp.id}/${bp.id}`)!.join('\n\n') } : bp)) })),
  };
  return { ...reverifyEdit(baseline, edited, mode, options), docxIssues: [] };
}
