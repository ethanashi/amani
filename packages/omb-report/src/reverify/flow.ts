/**
 * PW8 extracted-text check shared by the PDF and DOCX read-backs. The expected flow is the
 * verified manuscript's visible text in reading order. Extracted text must contain every unit,
 * in order, exactly after prose-ligature and layout whitespace normalization. All whitespace boundaries and numeric typography survive; only whitespace runs collapse.
 * Nothing else may appear except a vector figure's own SVG text, in its own SVG order, right
 * before its caption, and declared page numbers. Every extracted character is therefore
 * accounted for by a verified unit, so every number in the output traces to a signed value.
 */
import { NUMERIC_EXPRESSION } from '../../../omb-figures/src/closed-world.ts';
import { visibleSectionHeading, allUnits, type Manuscript } from './manuscript.ts';

export type FlowItem =
  | { readonly kind: 'unit'; readonly uid: string; readonly where: string; readonly text: string }
  | { readonly kind: 'figure'; readonly where: string; readonly svgTexts: readonly string[] };
export interface FlowOptions {
  /** 'vector': the figure's SVG text is printed as text (Chrome PDF); 'raster': figures carry no text (DOCX, PNG). */
  readonly figures: 'vector' | 'raster';
  /** Each page ends with its own 1-based page number (declared page furniture). */
  readonly pageNumbers?: boolean;
}
export type FlowIssueCode = 'missing-unit' | 'unexpected-text' | 'unbound-number' | 'format-char' | 'page-number';
export interface FlowIssue { readonly code: FlowIssueCode; readonly where: string; readonly detail: string }

/** Visible reading order of the verified manuscript (alt text and metadata are checked separately). */
export function expectedFlow(m: Manuscript): FlowItem[] {
  const out: FlowItem[] = [];
  const unit = (u: { uid: string; block: string; index: number; text: string }) => out.push({ kind: 'unit', uid: u.uid, where: `${u.block}#${u.index}`, text: u.text });
  unit(m.title);
  for (const s of m.sections) {
    if(visibleSectionHeading(s))unit(s.heading);
    for (const b of s.blocks) {
      if (b.kind === 'figure') { out.push({ kind: 'figure', where: b.id, svgTexts: b.svgTexts }); unit(b.caption); }
      else if (b.kind === 'table') { unit(b.caption); for (const u of [...b.header, ...b.rows.flat(), ...b.notes]) unit(u); }
      else for (const u of b.units) unit(u);
    }
  }
  return out;
}

/** Compatibility ligatures are prose glyphs; numeric typography is never NFKC-folded. */
export const normaliseExtracted = (text: string): string => text.normalize('NFC')
  .replace(/[ﬀﬁﬂﬃﬄﬅﬆ]/gu, c => ({'ﬀ':'ff','ﬁ':'fi','ﬂ':'fl','ﬃ':'ffi','ﬄ':'ffl','ﬅ':'st','ﬆ':'st'}[c]!))
  .replace(/(?<=\p{L})­(?=\p{L})/gu, '');
const compactMap = (text: string): { compact: string; origin: number[] } => {
  let compact = '';
  const origin: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (/\s/u.test(text[i]!)) {
      if (compact.endsWith(' ')) continue;
      compact += ' ';
    } else compact += text[i];
    origin.push(i);
  }
  return { compact, origin };
};
const compact = (text: string): string => compactMap(normaliseExtracted(text)).compact.trim();
const numbers = (text: string): string[] => [...text.matchAll(new RegExp(NUMERIC_EXPRESSION.source, 'gu'))].map((m) => m[0]);

/** Check extracted page texts against the expected flow. */
export function checkFlow(flow: readonly FlowItem[], pages: readonly string[], options: FlowOptions): FlowIssue[] {
  const issues: FlowIssue[] = [];
  const cleaned = pages.map((p, i) => {
    let text = normaliseExtracted(p);
    if (options.pageNumbers) {
      const m = text.match(/(?:^|\n)\s*(\d+)\s*$/u);
      if (!m || Number(m[1]) !== i + 1) issues.push({ code: 'page-number', where: `page ${i + 1}`, detail: 'declared page number missing or wrong' });
      else text = text.slice(0, m.index);
    }
    return text;
  });
  const all = cleaned.join('\n');
  if (/[\p{Cf}]|[\u0000-\u0008\u000b\u000e-\u001f\u007f-\u009f]/u.test(all)) issues.push({ code: 'format-char', where: 'extracted text', detail: 'control, bidi or zero-width character' });
  const { compact: E, origin } = compactMap(all);
  const show = (from: number, to: number) => { const a = origin[from] ?? all.length, z = to > 0 ? (origin[Math.min(to, origin.length) - 1] ?? all.length - 1) + 1 : a; return all.slice(a, Math.max(a, z)).replace(/\s+/gu, ' ').slice(0, 160); };
  let cursor = 0;
  let pendingFigure: string[] | null = null, pendingWhere = '';
  for (const item of flow) {
    if (item.kind === 'figure') {
      if (options.figures === 'vector') { pendingFigure = item.svgTexts.map(compact); pendingWhere = item.where; }
      continue;
    }
    while (E[cursor] === ' ') cursor++; // verified unit boundary
    const c = compact(item.text);
    if (!c) continue;
    const figure = pendingFigure;
    pendingFigure = null;
    if (E.startsWith(c, cursor)) { cursor += c.length; continue; }
    let figureEnd = cursor;
    if (figure !== null) for (const part of figure) {
      while (E[figureEnd] === ' ') figureEnd++;
      if (!E.startsWith(part, figureEnd)) { figureEnd = -1; break; }
      figureEnd += part.length;
    }
    if (figureEnd >= 0) while (E[figureEnd] === ' ') figureEnd++;
    if (figure !== null && figureEnd >= 0 && E.startsWith(c, figureEnd)) { cursor = figureEnd + c.length; continue; }
    // Not where it must be: report, then resynchronise on the next exact occurrence.
    const found = E.indexOf(c, cursor);
    const window = E.slice(cursor, cursor + c.length);
    const planted = numbers(show(cursor, cursor + Math.max(c.length, 1))).filter((n) => !numbers(item.text).includes(n));
    if (found < 0) {
      issues.push({ code: 'missing-unit', where: item.where, detail: `expected "${item.text.slice(0, 120)}" but the output has "${show(cursor, cursor + c.length)}"` });
      if (planted.length) issues.push({ code: 'unbound-number', where: item.where, detail: `number(s) ${planted.join(', ')} in the output do not belong to this unit` });
      cursor += Math.min(window.length, E.length - cursor);
      continue;
    }
    const gap = E.slice(cursor, found);
    const explained = figure !== null && figureEnd === found;
    if (!explained) {
      issues.push({ code: 'unexpected-text', where: item.where, detail: `unexpected output before ${item.where}${figure !== null ? ` (after figure ${pendingWhere})` : ''}: "${show(cursor, found)}"` });
      const extra = numbers(show(cursor, found));
      if (extra.length) issues.push({ code: 'unbound-number', where: item.where, detail: `number(s) ${extra.slice(0, 5).join(', ')} do not trace to the verified manuscript` });
    }
    cursor = found + c.length;
  }
  if (cursor < E.length) {
    issues.push({ code: 'unexpected-text', where: 'end', detail: `unexpected trailing output: "${show(cursor, E.length)}"` });
    const extra = numbers(show(cursor, E.length));
    if (extra.length) issues.push({ code: 'unbound-number', where: 'end', detail: `number(s) ${extra.slice(0, 5).join(', ')} do not trace to the verified manuscript` });
  }
  return issues;
}

/** Alt texts the manuscript expects (one per figure), for PDF tags and DOCX drawing properties. */
export function expectedAltTexts(m: Manuscript): string[] {
  return allUnits(m).filter((u) => u.container === 'alt').map((u) => normaliseExtracted(u.text));
}
