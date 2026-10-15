/**
 * PW8 PDF text extraction: a small, pinned, dependency-free reader (node:zlib only) for the
 * PDFs the PW9 chain produces (headless Chrome / Skia) and for simple hand-built PDFs.
 *
 * It returns every shown string in paint order with its page, position, size and visibility,
 * plus the document Info dictionary, XMP presence, structure-tree strings (/Alt, /ActualText,
 * /E, /T), marked-content strings, annotation URIs and contents, and outline titles: every
 * place a PDF can carry a number. Anything it cannot decode (an unknown filter, a font with no
 * Unicode mapping, an encrypted file) is a refusal, never a silent skip.
 *
 * Integration point (PW9): implement PdfTextExtractor with another engine if needed; the
 * closed-world check (verifyPdf) only consumes ExtractedPdf.
 */
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { refuse, requireThat } from '../common.ts';

export interface PdfTextRun { readonly page: number; readonly text: string; readonly x: number; readonly y: number; readonly size: number; readonly rotation?:number; readonly invisible: boolean; readonly offPage: boolean }
export interface PdfString { readonly key: string; readonly value: string }
export interface ExtractedPdf {
  readonly visualSha256: readonly string[];
  readonly fontSha256: readonly string[];
  readonly engine: string;
  readonly pages: readonly string[];
  readonly runs: readonly PdfTextRun[];
  readonly info: Readonly<Record<string, string>>;
  readonly xmp: boolean;
  readonly structure: readonly PdfString[];
  readonly markedContent: readonly PdfString[];
  readonly annotations: readonly PdfString[];
  readonly outlines: readonly string[];
}
export interface PdfTextExtractor { readonly name: string; extract(bytes: Uint8Array): ExtractedPdf }

export const PDF_ENGINE = 'omb-pw8-pdf@1';

// ------------------------------------------------------------------------------------------
// Objects and lexer

class Ref { readonly num: number; readonly gen: number; constructor(num: number, gen: number) { this.num = num; this.gen = gen; } }
class Name { readonly name: string; constructor(name: string) { this.name = name; } }
class Op { readonly op: string; constructor(op: string) { this.op = op; } }
class PStr { readonly bytes: Uint8Array; constructor(bytes: Uint8Array) { this.bytes = bytes; } }
type PdfDict = Map<string, PdfValue>;
interface PdfStream { readonly dict: PdfDict; readonly raw: Uint8Array }
type PdfValue = null | boolean | number | Ref | Name | PStr | PdfValue[] | PdfDict | PdfStream | Op;
const isDict = (v: unknown): v is PdfDict => v instanceof Map;
const isStream = (v: unknown): v is PdfStream => !!v && typeof v === 'object' && 'raw' in v && 'dict' in v;

const WS = new Set([0, 9, 10, 12, 13, 32]);
const DELIM = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);

/** PDF ASCIIHex grammar; only the six PDF whitespace bytes are ignorable. */
export function decodeAsciiHex(data: Uint8Array): Uint8Array {
  let hex = '';
  let ended = false;
  for (const byte of data) {
    if (byte === 62) { ended = true; break; }
    if (WS.has(byte)) continue;
    requireThat((byte >= 48 && byte <= 57) || (byte >= 65 && byte <= 70) || (byte >= 97 && byte <= 102), 'PDF: invalid ASCIIHex byte');
    hex += String.fromCharCode(byte);
  }
  requireThat(ended, 'PDF: missing ASCIIHex end marker');
  if (hex.length % 2) hex += '0';
  return Buffer.from(hex, 'hex');
}

class Lexer {
  pos: number;
  readonly b: Uint8Array;
  constructor(b: Uint8Array, pos = 0) { this.b = b; this.pos = pos; }
  skip(): void {
    for (;;) {
      while (this.pos < this.b.length && WS.has(this.b[this.pos]!)) this.pos++;
      if (this.b[this.pos] === 0x25) { while (this.pos < this.b.length && this.b[this.pos] !== 10 && this.b[this.pos] !== 13) this.pos++; continue; }
      return;
    }
  }
  /** Next value (with operators as Op). Undefined at end of input. */
  value(allowRefs = true): PdfValue | undefined {
    this.skip();
    if (this.pos >= this.b.length) return undefined;
    const c = this.b[this.pos]!;
    if (c === 0x2f) return this.name();
    if (c === 0x28) return this.literal();
    if (c === 0x3c) { if (this.b[this.pos + 1] === 0x3c) { this.pos += 2; return this.dict(); } return this.hex(); }
    if (c === 0x5b) { this.pos++; const out: PdfValue[] = []; for (;;) { this.skip(); if (this.b[this.pos] === 0x5d) { this.pos++; return out; } const v = this.value(allowRefs); requireThat(v !== undefined, 'PDF: unterminated array'); out.push(v); } }
    if (c === 0x3e || c === 0x5d || c === 0x29 || c === 0x7b || c === 0x7d) { this.pos++; return new Op(String.fromCharCode(c)); }
    const start = this.pos;
    while (this.pos < this.b.length && !WS.has(this.b[this.pos]!) && !DELIM.has(this.b[this.pos]!)) this.pos++;
    const word = latin1(this.b.subarray(start, this.pos));
    if (/^[+-]?(?:\d+\.?\d*|\.\d+)$/u.test(word)) {
      const num = Number(word);
      if (allowRefs && /^\d+$/u.test(word)) {
        const save = this.pos;
        const g = this.peekWord(), r = g !== null && /^\d+$/u.test(g.word) ? this.peekWordAt(g.end) : null;
        if (g && r && r.word === 'R') { this.pos = r.end; return new Ref(num, Number(g.word)); }
        this.pos = save;
      }
      return num;
    }
    if (word === 'true') return true;
    if (word === 'false') return false;
    if (word === 'null') return null;
    requireThat(word.length > 0, 'PDF: unexpected byte');
    return new Op(word);
  }
  private peekWord(): { word: string; end: number } | null { return this.peekWordAt(this.pos); }
  private peekWordAt(p: number): { word: string; end: number } | null {
    while (p < this.b.length && WS.has(this.b[p]!)) p++;
    const s = p;
    while (p < this.b.length && !WS.has(this.b[p]!) && !DELIM.has(this.b[p]!)) p++;
    return p > s ? { word: latin1(this.b.subarray(s, p)), end: p } : null;
  }
  private name(): Name {
    this.pos++;
    const start = this.pos;
    while (this.pos < this.b.length && !WS.has(this.b[this.pos]!) && !DELIM.has(this.b[this.pos]!)) this.pos++;
    return new Name(latin1(this.b.subarray(start, this.pos)).replace(/#([0-9A-Fa-f]{2})/gu, (_, h: string) => String.fromCharCode(parseInt(h, 16))));
  }
  private literal(): PStr {
    this.pos++;
    const out: number[] = [];
    let depth = 1;
    while (this.pos < this.b.length) {
      const c = this.b[this.pos++]!;
      if (c === 0x5c) {
        const e = this.b[this.pos++]!;
        const map: Record<number, number> = { 0x6e: 10, 0x72: 13, 0x74: 9, 0x62: 8, 0x66: 12, 0x28: 0x28, 0x29: 0x29, 0x5c: 0x5c };
        if (map[e] !== undefined) out.push(map[e]!);
        else if (e >= 0x30 && e <= 0x37) { let v = e - 0x30; for (let k = 0; k < 2 && this.b[this.pos]! >= 0x30 && this.b[this.pos]! <= 0x37; k++) v = v * 8 + this.b[this.pos++]! - 0x30; out.push(v & 0xff); }
        else if (e === 13) { if (this.b[this.pos] === 10) this.pos++; }
        else if (e !== 10) out.push(e);
        continue;
      }
      if (c === 0x28) depth++;
      if (c === 0x29 && --depth === 0) return new PStr(Uint8Array.from(out));
      out.push(c);
    }
    return refuse('PDF: unterminated string');
  }
  private hex(): PStr {
    this.pos++;
    let digits = '';
    while (this.pos < this.b.length && this.b[this.pos] !== 0x3e) { const ch = String.fromCharCode(this.b[this.pos++]!); if (/[0-9A-Fa-f]/u.test(ch)) digits += ch; else requireThat(/\s/u.test(ch), 'PDF: bad hex string'); }
    this.pos++;
    if (digits.length % 2) digits += '0';
    return new PStr(Uint8Array.from(digits.match(/../gu) ?? [], (h) => parseInt(h, 16)));
  }
  private dict(): PdfDict {
    const d: PdfDict = new Map();
    for (;;) {
      this.skip();
      if (this.b[this.pos] === 0x3e && this.b[this.pos + 1] === 0x3e) { this.pos += 2; return d; }
      const k = this.value();
      requireThat(k instanceof Name, 'PDF: dictionary key is not a name');
      const v = this.value();
      requireThat(v !== undefined, 'PDF: unterminated dictionary');
      d.set(k.name, v);
    }
  }
}

const latin1 = (b: Uint8Array): string => Buffer.from(b).toString('latin1');

// ------------------------------------------------------------------------------------------
// Document

class PdfDoc {
  readonly inlineImages: string[] = [];
  readonly usedFonts = new Set<string>();
  readonly objects = new Map<number, PdfValue>();
  readonly trailers: PdfDict[] = [];
  readonly b: Uint8Array;
  constructor(b: Uint8Array) {
    this.b = b;
    requireThat(latin1(b.subarray(0, 5)) === '%PDF-', 'PDF: missing header');
    const text = latin1(b);
    // Sequential scan: stream bodies are skipped, so bytes inside them never look like objects.
    // Later definitions override earlier ones, as incremental updates do.
    const header = /(?<![0-9])(\d+)\s+(\d+)\s+obj\b|\btrailer\b/gu;
    for (let m = header.exec(text); m; m = header.exec(text)) {
      if (m[0] === 'trailer') {
        const lx = new Lexer(b, m.index + 7);
        const t = lx.value();
        if (isDict(t)) this.trailers.push(t);
        header.lastIndex = lx.pos;
        continue;
      }
      const { value, end } = this.parseAt(m.index + m[0].length);
      this.objects.set(Number(m[1]), value);
      header.lastIndex = end;
    }
    for (const [, v] of [...this.objects]) {
      if (isStream(v) && this.name(v.dict.get('Type')) === 'ObjStm') this.expandObjectStream(v);
      if (isStream(v) && this.name(v.dict.get('Type')) === 'XRef') this.trailers.push(v.dict);
    }
    requireThat(!this.trailers.some((t) => t.has('Encrypt')), 'PDF: encrypted documents are refused');
  }
  private parseAt(at: number): { value: PdfValue; end: number } {
    const lx = new Lexer(this.b, at);
    const v = lx.value();
    requireThat(v !== undefined, 'PDF: empty object');
    lx.skip();
    if (isDict(v) && latin1(this.b.subarray(lx.pos, lx.pos + 6)) === 'stream') {
      let start = lx.pos + 6;
      if (this.b[start] === 13) start++;
      if (this.b[start] === 10) start++;
      const lenValue = v.get('Length');
      let length = typeof lenValue === 'number' ? lenValue : undefined;
      const after = typeof length === 'number' ? latin1(this.b.subarray(start + length, start + length + 12)) : '';
      if (typeof length !== 'number' || length < 0 || !/^\s*endstream/u.test(after)) {
        const end = latin1(this.b).indexOf('endstream', start);
        requireThat(end >= 0, 'PDF: unterminated stream');
        let stop = end;
        while (stop > start && (this.b[stop - 1] === 10 || this.b[stop - 1] === 13)) stop--;
        length = stop - start;
      }
      const tail = latin1(this.b).indexOf('endstream', start + length) + 'endstream'.length;
      return { value: { dict: v, raw: this.b.subarray(start, start + length) }, end: tail };
    }
    return { value: v, end: lx.pos };
  }
  private expandObjectStream(s: PdfStream): void {
    const data = this.decode(s);
    const n = this.num(s.dict.get('N')), first = this.num(s.dict.get('First'));
    const head = new Lexer(data, 0);
    const pairs: [number, number][] = [];
    for (let i = 0; i < n; i++) pairs.push([head.value(false) as number, head.value(false) as number]);
    for (const [num, off] of pairs) if (!this.objects.has(num)) { const v = new Lexer(data, first + off).value(); if (v !== undefined) this.objects.set(num, v); }
  }
  get(v: PdfValue | undefined, depth = 0): PdfValue | undefined {
    requireThat(depth < 64, 'PDF: reference cycle');
    return v instanceof Ref ? this.get(this.objects.get(v.num), depth + 1) : v;
  }
  dict(v: PdfValue | undefined): PdfDict | undefined { const r = this.get(v); return isDict(r) ? r : isStream(r) ? r.dict : undefined; }
  name(v: PdfValue | undefined): string | undefined { const r = this.get(v); return r instanceof Name ? r.name : undefined; }
  num(v: PdfValue | undefined): number { const r = this.get(v); requireThat(typeof r === 'number', 'PDF: expected a number'); return r; }
  fingerprint(value: PdfValue | undefined, seen = new Set<number>()): string {
    const encode = (v: PdfValue | undefined): unknown => {
      if (v instanceof Ref) {
        requireThat(!seen.has(v.num), 'PDF: cyclic profile resource');
        const next = new Set(seen); next.add(v.num);
        return this.fingerprint(this.get(v), next);
      }
      if (isStream(v)) return {dict: encode(v.dict), raw: Buffer.from(v.raw).toString('hex')};
      if (isDict(v)) return [...v].sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, encode(x)]);
      if (Array.isArray(v)) return v.map(encode);
      if (v instanceof PStr) return {bytes: Buffer.from(v.bytes).toString('hex')};
      return v;
    };
    return createHash('sha256').update(JSON.stringify(encode(value)) ?? 'null').digest('hex');
  }
  decode(s: PdfStream): Uint8Array {
    const filters = this.get(s.dict.get('Filter'));
    const list = filters === undefined || filters === null ? [] : Array.isArray(filters) ? filters.map((f) => this.name(f)) : [this.name(filters)];
    const parms = this.get(s.dict.get('DecodeParms'));
    let data = s.raw;
    list.forEach((f, i) => {
      const p = this.dict(Array.isArray(parms) ? parms[i] : parms);
      if (f === 'FlateDecode' || f === 'Fl') {
        try { data = inflateSync(data); } catch { refuse('PDF: corrupt compressed stream'); }
        const predictor = p ? this.get(p.get('Predictor')) : undefined;
        requireThat(predictor === undefined || predictor === 1, 'PDF: predictors are not supported for text-bearing streams');
      } else if (f === 'ASCIIHexDecode' || f === 'AHx') data = decodeAsciiHex(data);
      else refuse(`PDF: unsupported filter ${f}`);
    });
    return data;
  }
  private trailerRef(key: string): PdfValue | undefined {
    for (const t of [...this.trailers].reverse()) if (t.has(key)) return t.get(key);
    return undefined;
  }
  catalog(): PdfDict {
    const root = this.dict(this.trailerRef('Root'));
    requireThat(root && this.name(root.get('Type')) === 'Catalog', 'PDF: no catalog');
    return root;
  }
  trailerInfo(): PdfDict | undefined { return this.dict(this.trailerRef('Info')); }
}

// ------------------------------------------------------------------------------------------
// Strings and fonts

const PDFDOC_HIGH: Record<number, string> = { 0x80: '•', 0x81: '†', 0x82: '‡', 0x83: '…', 0x84: '—', 0x85: '–', 0x86: 'ƒ', 0x87: '⁄', 0x88: '‹', 0x89: '›', 0x8a: '−', 0x8b: '‰', 0x8c: '„', 0x8d: '“', 0x8e: '”', 0x8f: '‘', 0x90: '’', 0x91: '‚', 0x92: '™', 0x93: 'ﬁ', 0x94: 'ﬂ', 0x95: 'Ł', 0x96: 'Œ', 0x97: 'Š', 0x98: 'Ÿ', 0x99: 'Ž', 0x9a: 'ı', 0x9b: 'ł', 0x9c: 'œ', 0x9d: 'š', 0x9e: 'ž', 0xa0: '€' };
/** Text strings in dictionaries: UTF-16BE with BOM, UTF-8 with BOM (PDF 2.0) or PDFDocEncoding. */
export function pdfTextString(bytes: Uint8Array): string {
  if (bytes[0] === 0xfe && bytes[1] === 0xff) { let s = ''; for (let i = 2; i + 1 < bytes.length; i += 2) s += String.fromCharCode((bytes[i]! << 8) | bytes[i + 1]!); return s; }
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return Buffer.from(bytes.subarray(3)).toString('utf8');
  return [...bytes].map((c) => PDFDOC_HIGH[c] ?? String.fromCharCode(c)).join('');
}

const WIN_ANSI_HIGH: Record<number, string> = { 0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡', 0x88: 'ˆ', 0x89: '‰', 0x8a: 'Š', 0x8b: '‹', 0x8c: 'Œ', 0x8e: 'Ž', 0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—', 0x98: '˜', 0x99: '™', 0x9a: 'š', 0x9b: '›', 0x9c: 'œ', 0x9e: 'ž', 0x9f: 'Ÿ' };
// Adobe PDF Reference, Appendix D: StandardEncoding (undefined positions stay undefined).
const STANDARD_HIGH: Record<number, string> = {
  39:'’', 96:'‘', 161:'¡',162:'¢',163:'£',164:'⁄',165:'¥',166:'ƒ',167:'§',168:'¤',169:"'",170:'“',171:'«',172:'‹',173:'›',174:'fi',175:'fl',
  177:'–',178:'†',179:'‡',180:'·',182:'¶',183:'•',184:'‚',185:'„',186:'”',187:'»',188:'…',189:'‰',191:'¿',
  193:'`',194:'´',195:'ˆ',196:'˜',197:'¯',198:'˘',199:'˙',200:'¨',202:'˚',203:'¸',205:'˝',206:'˛',207:'ˇ',208:'—',
  225:'Æ',227:'ª',232:'Ł',233:'Ø',234:'Œ',235:'º',241:'æ',245:'ı',248:'ł',249:'ø',250:'œ',251:'ß',
};
export const standardEncodingCharacter = (code: number): string | undefined => STANDARD_HIGH[code] ?? (code >= 32 && code <= 126 ? String.fromCharCode(code) : undefined);
const GLYPHS: Record<string, string> = {
  space: ' ', exclam: '!', quotedbl: '"', numbersign: '#', dollar: '$', percent: '%', ampersand: '&', quotesingle: "'", parenleft: '(', parenright: ')', asterisk: '*', plus: '+', comma: ',', hyphen: '-', period: '.', slash: '/',
  zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', colon: ':', semicolon: ';', less: '<', equal: '=', greater: '>', question: '?', at: '@',
  bracketleft: '[', backslash: '\\', bracketright: ']', underscore: '_', braceleft: '{', bar: '|', braceright: '}', endash: '–', emdash: '—', quoteright: '’', quoteleft: '‘', quotedblleft: '“', quotedblright: '”',
  bullet: '•', dagger: '†', daggerdbl: '‡', minus: '−', multiply: '×', plusminus: '±', degree: '°', fi: 'fi', fl: 'fl', ellipsis: '…', periodcentered: '·',
};
const glyphName = (n: string): string | undefined => GLYPHS[n] ?? (/^[A-Za-z]$/u.test(n) ? n : /^uni([0-9A-F]{4})$/u.test(n) ? String.fromCharCode(parseInt(n.slice(3), 16)) : undefined);

interface Font { readonly bytesPerCode: number; advance(bytes: Uint8Array): number; decode(bytes: Uint8Array): string }

function utf16(hex: Uint8Array): string { let s = ''; for (let i = 0; i + 1 < hex.length; i += 2) s += String.fromCharCode((hex[i]! << 8) | hex[i + 1]!); return s; }

function parseCMap(data: Uint8Array): { map: Map<number, string>; bytes: number } {
  const lx = new Lexer(data);
  const map = new Map<number, string>();
  let bytes = 1;
  const stack: PdfValue[] = [];
  const codeOf = (s: PdfValue | undefined): number => { requireThat(s instanceof PStr, 'PDF: bad CMap code'); return s.bytes.reduce((a, c) => a * 256 + c, 0); };
  for (let v = lx.value(false); v !== undefined; v = lx.value(false)) {
    if (!(v instanceof Op)) { stack.push(v); continue; }
    if (v.op === 'begincodespacerange' || v.op === 'beginbfchar' || v.op === 'beginbfrange') { stack.length = 0; continue; }
    if (v.op === 'endcodespacerange') { for (let i = 0; i + 1 < stack.length; i += 2) { const s = stack[i]; if (s instanceof PStr) bytes = Math.max(bytes, s.bytes.length); } }
    else if (v.op === 'endbfchar') { for (let i = 0; i + 1 < stack.length; i += 2) { const dst = stack[i + 1]; requireThat(dst instanceof PStr, 'PDF: bad bfchar'); map.set(codeOf(stack[i]), utf16(dst.bytes)); } }
    else if (v.op === 'endbfrange') {
      for (let i = 0; i + 2 < stack.length; i += 3) {
        const lo = codeOf(stack[i]), hi = codeOf(stack[i + 1]), dst = stack[i + 2];
        requireThat(hi >= lo && hi - lo < 65536, 'PDF: bad bfrange');
        if (Array.isArray(dst)) for (let c = lo; c <= hi; c++) { const d = dst[c - lo]; requireThat(d instanceof PStr, 'PDF: bad bfrange array'); map.set(c, utf16(d.bytes)); }
        else { requireThat(dst instanceof PStr, 'PDF: bad bfrange'); const base = utf16(dst.bytes); for (let c = lo; c <= hi; c++) map.set(c, base.slice(0, -1) + String.fromCharCode(base.charCodeAt(base.length - 1) + (c - lo))); }
      }
    }
    stack.length = 0;
  }
  return { map, bytes };
}

function loadFont(doc: PdfDoc, ref: PdfValue | undefined): Font {
  const d = doc.dict(ref);
  requireThat(d && doc.name(d.get('Type')) === 'Font', 'PDF: missing or unsupported font mapping');
  doc.usedFonts.add(doc.fingerprint(d));
  const subtype = doc.name(d.get('Subtype'));
  // Text positions must use the font's declared glyph advances, never Unicode length.
  const descendant = subtype === 'Type0' ? doc.dict((doc.get(d.get('DescendantFonts')) as PdfValue[] | undefined)?.[0]) : undefined;
  const widths = new Map<number, number>();
  let defaultWidth = 500;
  if (descendant) {
    defaultWidth = descendant.has('DW') ? doc.num(descendant.get('DW')) : 1000;
    const w = doc.get(descendant.get('W'));
    if (Array.isArray(w)) for (let i = 0; i < w.length;) {
      const first = doc.num(w[i++]), next = doc.get(w[i++]);
      if (Array.isArray(next)) next.forEach((value, j) => widths.set(first + j, doc.num(value)));
      else { const last = doc.num(next), value = doc.num(w[i++]); requireThat(last >= first && last - first < 65536, 'PDF: invalid CID widths'); for (let c = first; c <= last; c++) widths.set(c, value); }
    }
  } else {
    const w = doc.get(d.get('Widths')), first = d.has('FirstChar') ? doc.num(d.get('FirstChar')) : 0;
    if (Array.isArray(w)) w.forEach((value, j) => widths.set(first + j, doc.num(value)));
    const descriptor = doc.dict(d.get('FontDescriptor'));
    if (descriptor?.has('MissingWidth')) defaultWidth = doc.num(descriptor.get('MissingWidth'));
  }
  const advance = (b: Uint8Array, width: number): number => {
    let total = 0;
    for (let i = 0; i + width <= b.length; i += width) total += widths.get(b.subarray(i, i + width).reduce((a, c) => a * 256 + c, 0)) ?? defaultWidth;
    return total / 1000;
  };
  const tu = doc.get(d.get('ToUnicode'));
  if (isStream(tu)) {
    const { map, bytes } = parseCMap(doc.decode(tu));
    const standard = /^(?:Helvetica|Times|Courier)(?:-|$)/u.test(doc.name(d.get('BaseFont')) ?? '') && subtype === 'Type1' && !d.has('FontDescriptor');
    const plain = new Map(d); plain.delete('ToUnicode');
    const visual = standard ? loadFont(doc, plain) : undefined;
    const width = subtype === 'Type0' ? Math.max(2, bytes) : bytes;
    return {
      bytesPerCode: width,
      advance: b => advance(b, width),
      decode(b) {
        let s = '';
        for (let i = 0; i + width <= b.length; i += width) {
          const code = b.subarray(i, i + width).reduce((a, c) => a * 256 + c, 0);
          const u = map.get(code);
          requireThat(u !== undefined, `PDF: glyph code ${code} has no Unicode mapping`);
          s += u;
        }
        requireThat(!visual || visual.decode(b) === s, 'PDF: unsupported font mapping (glyph/Unicode disagreement)');
        return s;
      },
    };
  }
  requireThat(subtype !== 'Type0', 'PDF: composite font without ToUnicode');
  const enc = doc.get(d.get('Encoding'));
  const base = enc instanceof Name ? enc.name : isDict(enc) ? doc.name(enc.get('BaseEncoding')) : undefined;
  requireThat(base === undefined || base === 'WinAnsiEncoding' || base === 'StandardEncoding', `PDF: unsupported simple-font encoding ${base}`);
  const diffs = new Map<number, string>();
  const list = isDict(enc) ? doc.get(enc.get('Differences')) : undefined;
  if (Array.isArray(list)) { let code = 0; for (const item of list) { if (typeof item === 'number') code = item; else if (item instanceof Name) { const g = glyphName(item.name); requireThat(g !== undefined, `PDF: unknown glyph name ${item.name}`); diffs.set(code++, g); } } }
  return {
    bytesPerCode: 1,
    advance: b => advance(b, 1),
    decode(b) {
      return [...b].map((c) => {
        const g = diffs.get(c) ?? (base !== 'WinAnsiEncoding' ? standardEncodingCharacter(c) : c >= 0x20 && c < 0x7f ? String.fromCharCode(c) : WIN_ANSI_HIGH[c] ?? (c >= 0xa0 ? String.fromCharCode(c) : undefined));
        requireThat(g !== undefined, `PDF: byte ${c} has no Unicode mapping`);
        return g;
      }).join('');
    },
  };
}

// ------------------------------------------------------------------------------------------
// Content streams

type Matrix = [number, number, number, number, number, number];
const mul = (a: Matrix, b: Matrix): Matrix => [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3], a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]];
const I: Matrix = [1, 0, 0, 1, 0, 0];

function runContent(doc: PdfDoc, data: Uint8Array, resources: PdfDict | undefined, page: number, box: number[], ctm0: Matrix, out: PdfTextRun[], marked: PdfString[], depth: number, inherited = {white:false, opacity:1}): void {
  requireThat(depth < 16, 'PDF: XObject nesting too deep');
  const fonts = doc.dict(resources?.get('Font'));
  const xobjects = doc.dict(resources?.get('XObject'));
  const cache = new Map<string, Font>();
  const lx = new Lexer(data);
  const stack: PdfValue[] = [];
  let ctm = ctm0;
  const saved: { ctm: Matrix; mode: number; white: boolean; opacity: number }[] = [];
  let {white, opacity} = inherited;
  let tm: Matrix = I, tlm: Matrix = I, font: Font | null = null, size = 0, leading = 0, mode = 0;
  const show = (s: PdfValue | undefined) => {
    requireThat(font && s instanceof PStr, 'PDF: text shown without a font');
    const text = font.decode(s.bytes);
    const m = mul(tm, ctm);
    const upright=Math.abs(m[1])<1e-8&&Math.abs(m[2])<1e-8&&m[0]>0&&m[3]>0;
    const quarterTurn=Math.abs(m[0])<1e-8&&Math.abs(m[3])<1e-8&&m[1]*m[2]<0;
    requireThat(upright||quarterTurn,'PDF: unsupported rotated or reflected text');
    const rotation=quarterTurn?(m[1]>0?90:-90):0;
    const scale = Math.hypot(m[2], m[3]) * size;
    const x = m[4], y = m[5];
    out.push({ page, text, x, y, size: scale, ...rotation?{rotation}:{}, invisible: mode !== 0 || white || opacity < 1, offPage: x < box[0]! - 1 || x > box[2]! + 1 || y < box[1]! - 1 || y > box[3]! + 1 });
    tm = mul([1, 0, 0, 1, font.advance(s.bytes) * size, 0], tm);
  };
  for (let v = lx.value(); v !== undefined; v = lx.value()) {
    if (!(v instanceof Op)) { stack.push(v); continue; }
    const op = v.op;
    const nums = () => stack.map((x) => (typeof x === 'number' ? x : NaN));
    switch (op) {
      case 'q': saved.push({ ctm, mode, white, opacity }); break;
      case 'Q': { const s = saved.pop(); if (s) { ctm = s.ctm; mode = s.mode; white = s.white; opacity = s.opacity; } break; }
      case 'g': white = nums()[0]! >= 0.95; break;
      case 'rg': white = nums().every(n => n >= 0.95); break;
      case 'k': white = nums().every(n => n <= 0.05); break;
      case 'cs': case 'sc': case 'scn': refuse('PDF: unsupported fill colour space');
      case 'gs': {
        const name = stack[0];
        const state = name instanceof Name ? doc.dict(doc.dict(resources?.get('ExtGState'))?.get(name.name)) : undefined;
        requireThat(state, 'PDF: unresolved graphics state');
        requireThat([...state.keys()].every(k => ['Type','ca','CA','BM','SMask','SA','AIS','LW','LC','LJ','ML','D'].includes(k)), 'PDF: unsupported graphics state');
        const alpha = state.get('ca'); if (alpha !== undefined) opacity = doc.num(alpha);
        requireThat(!state.has('SMask') || doc.name(state.get('SMask')) === 'None', 'PDF: unsupported opacity mask');
        requireThat(!state.has('BM') || doc.name(state.get('BM')) === 'Normal', 'PDF: unsupported blend mode');
        break;
      }
      case 'cm': { const n = nums(); requireThat(n.length === 6 && n.every(Number.isFinite), 'PDF: bad cm'); ctm = mul(n as Matrix, ctm); break; }
      case 'BT': tm = I; tlm = I; break;
      case 'ET': break;
      case 'Tf': { const [nm, sz] = stack; requireThat(nm instanceof Name && typeof sz === 'number' && fonts, 'PDF: bad Tf'); font = cache.get(nm.name) ?? loadFont(doc, fonts.get(nm.name)); cache.set(nm.name, font); size = sz; break; }
      case 'Tc': case 'Tw': case 'Ts': requireThat(stack[0] === 0, 'PDF: unsupported text spacing or rise'); break;
      case 'Tz': requireThat(stack[0] === 100, 'PDF: unsupported text horizontal scale'); break;
      case 'Tr': mode = stack[0] as number; break;
      case 'TL': leading = stack[0] as number; break;
      case 'Td': { const [tx, ty] = nums(); tlm = mul([1, 0, 0, 1, tx!, ty!], tlm); tm = tlm; break; }
      case 'TD': { const [tx, ty] = nums(); leading = -ty!; tlm = mul([1, 0, 0, 1, tx!, ty!], tlm); tm = tlm; break; }
      case 'Tm': { const n = nums(); requireThat(n.length === 6, 'PDF: bad Tm'); tlm = n as Matrix; tm = tlm; break; }
      case 'T*': tlm = mul([1, 0, 0, 1, 0, -leading], tlm); tm = tlm; break;
      case 'Tj': show(stack[0]); break;
      case "'": tlm = mul([1, 0, 0, 1, 0, -leading], tlm); tm = tlm; show(stack[0]); break;
      case '"': tlm = mul([1, 0, 0, 1, 0, -leading], tlm); tm = tlm; show(stack[2]); break;
      case 'TJ': { const arr = stack[0]; requireThat(Array.isArray(arr), 'PDF: bad TJ'); for (const item of arr) { if (item instanceof PStr) show(item); else { requireThat(typeof item === 'number' && Number.isFinite(item), 'PDF: bad TJ adjustment'); tm = mul([1,0,0,1,-item * size / 1000,0],tm); } } break; }
      case 'BDC': case 'DP': {
        const props = stack[1] instanceof Name ? doc.dict(doc.dict(resources?.get('Properties'))?.get((stack[1] as Name).name)) : doc.dict(stack[1]);
        for (const key of ['ActualText', 'Alt', 'E', 'T']) { const s = props ? doc.get(props.get(key)) : undefined; if (s instanceof PStr) marked.push({ key, value: pdfTextString(s.bytes) }); }
        break;
      }
      case 'Do': {
        const nm = stack[0];
        requireThat(nm instanceof Name, 'PDF: bad Do');
        const xo = doc.get(xobjects?.get(nm.name));
        requireThat(isStream(xo) && ['Image','Form'].includes(doc.name(xo.dict.get('Subtype')) ?? ''), 'PDF: unsupported XObject');
        if (isStream(xo) && doc.name(xo.dict.get('Subtype')) === 'Form') {
          const m = doc.get(xo.dict.get('Matrix'));
          const fm: Matrix = Array.isArray(m) && m.length === 6 ? (m.map((x) => doc.num(x)) as Matrix) : I;
          runContent(doc, doc.decode(xo), doc.dict(xo.dict.get('Resources')) ?? resources, page, box, mul(fm, ctm), out, marked, depth + 1, {white,opacity});
        }
        break;
      }
      case 'BI': {
        // Skip inline image data up to a whitespace-delimited EI.
        const text = latin1(data);
        const id = text.indexOf('ID', lx.pos);
        requireThat(id >= 0, 'PDF: inline image without data');
        const m = /\sEI(?=[\s]|$)/gu;
        m.lastIndex = id + 3;
        const end = m.exec(text);
        requireThat(end, 'PDF: unterminated inline image');
        doc.inlineImages.push(createHash('sha256').update(data.subarray(lx.pos, end.index + 3)).digest('hex'));
        lx.pos = end.index + 3;
        break;
      }
      default:
        requireThat(['w','J','j','M','d','ri','i','m','l','c','v','y','h','re','S','s','f','F','f*','B','B*','b','b*','n','W','W*','G','RG','K','BMC','EMC','MP'].includes(op), `PDF: unsupported content operator ${op}`);
        break;
    }
    stack.length = 0;
  }
}

function pagesOf(doc: PdfDoc, node: PdfDict, inherited: { resources?: PdfDict; box?: number[] }, out: { page: PdfDict; resources: PdfDict | undefined; box: number[] }[], depth = 0): void {
  requireThat(depth < 32, 'PDF: page tree too deep');
  const resources = doc.dict(node.get('Resources')) ?? inherited.resources;
  const boxValue = doc.get(node.get('MediaBox'));
  const box = Array.isArray(boxValue) ? boxValue.map((x) => doc.num(x)) : inherited.box;
  if (doc.name(node.get('Type')) === 'Page' || !node.has('Kids')) { out.push({ page: node, resources, box: box ?? [0, 0, 612, 792] }); return; }
  const kids = doc.get(node.get('Kids'));
  requireThat(Array.isArray(kids), 'PDF: bad page tree');
  for (const k of kids) { const d = doc.dict(k); requireThat(d, 'PDF: bad page'); pagesOf(doc, d, { ...resources ? { resources } : {}, ...box ? { box } : {} }, out, depth + 1); }
}

function structureStrings(doc: PdfDoc, root: PdfValue | undefined, out: PdfString[], seen = new Set<number>(), depth = 0): void {
  if (depth > 256) return;
  if (root instanceof Ref) { if (seen.has(root.num)) return; seen.add(root.num); }
  const v = doc.get(root);
  if (Array.isArray(v)) { for (const x of v) structureStrings(doc, x, out, seen, depth + 1); return; }
  const d = isDict(v) ? v : undefined;
  if (!d) return;
  for (const key of ['Alt', 'ActualText', 'E', 'T']) { const s = doc.get(d.get(key)); if (s instanceof PStr) out.push({ key, value: pdfTextString(s.bytes) }); }
  structureStrings(doc, d.get('K'), out, seen, depth + 1);
}

export function extractPdf(bytes: Uint8Array): ExtractedPdf {
  const doc = new PdfDoc(bytes);
  const catalog = doc.catalog();
  const pagesRoot = doc.dict(catalog.get('Pages'));
  requireThat(pagesRoot, 'PDF: no page tree');
  const pages: { page: PdfDict; resources: PdfDict | undefined; box: number[] }[] = [];
  pagesOf(doc, pagesRoot, {}, pages);
  const runs: PdfTextRun[] = [], marked: PdfString[] = [], annotations: PdfString[] = [];
  pages.forEach((p, index) => {
    const contents = doc.get(p.page.get('Contents'));
    const parts = Array.isArray(contents) ? contents.map((c) => doc.get(c)) : contents === undefined ? [] : [contents];
    const data = Buffer.concat(parts.map((s) => { requireThat(isStream(s), 'PDF: page content is not a stream'); return Buffer.concat([Buffer.from(doc.decode(s)), Buffer.from('\n')]); }));
    runContent(doc, data, p.resources, index + 1, p.box, I, runs, marked, 0);
    const annots = doc.get(p.page.get('Annots'));
    if (annots !== undefined && !Array.isArray(annots)) annotations.push({key:'annotation',value:'unsupported annotation container'});
    if (Array.isArray(annots)) for (const a of annots) {
      const d = doc.dict(a);
      annotations.push({key:'annotation', value:'undeclared annotation'});
      if (!d) continue;
      for (const key of ['Contents', 'T', 'TU']) { const s = doc.get(d.get(key)); if (s instanceof PStr) annotations.push({ key, value: pdfTextString(s.bytes) }); }
      const action = doc.dict(d.get('A'));
      const uri = action ? doc.get(action.get('URI')) : undefined;
      if (uri instanceof PStr) annotations.push({ key: 'URI', value: latin1(uri.bytes) });
    }
  });
  const info: Record<string, string> = {};
  const infoDict = doc.trailerInfo();
  if (infoDict) for (const [k, v] of infoDict) { const s = doc.get(v); if (s instanceof PStr) info[k] = pdfTextString(s.bytes); else if (s instanceof Name) info[k] = s.name; }
  const structure: PdfString[] = [];
  const tree = doc.dict(catalog.get('StructTreeRoot'));
  if (tree) structureStrings(doc, tree.get('K'), structure);
  const outlines: string[] = [];
  const outlineRoot = doc.dict(catalog.get('Outlines'));
  const walkOutline = (item: PdfValue | undefined, depth: number) => {
    for (let node = doc.dict(item), guard = 0; node && guard < 10_000 && depth < 32; node = doc.dict(node.get('Next')), guard++) {
      const t = doc.get(node.get('Title'));
      if (t instanceof PStr) outlines.push(pdfTextString(t.bytes));
      walkOutline(node.get('First'), depth + 1);
    }
  };
  if (outlineRoot) walkOutline(outlineRoot.get('First'), 0);
  const pageText = pages.map((_, i) => {
    let s = '', last: PdfTextRun | null = null;
    for (const r of runs.filter((x) => x.page === i + 1)) { if (last && Math.abs(r.y - last.y) > Math.max(1, 0.5 * r.size)) s += '\n'; s += r.text; last = r; }
    return s;
  });
  const fontSha256 = [...new Set([...doc.usedFonts, ...[...doc.objects.values()].filter(v => doc.name(doc.dict(v)?.get('Type')) === 'Font').map(v => doc.fingerprint(v))])];
  const visualSha256 = [...doc.objects.values()].filter(v => isStream(v) && ['Image', 'Form'].includes(doc.name(v.dict.get('Subtype')) ?? '')).map(v => doc.fingerprint(v));
  visualSha256.push(...doc.inlineImages);
  return { visualSha256, fontSha256, engine: PDF_ENGINE, pages: pageText, runs, info, xmp: doc.dict(catalog.get('Metadata')) !== undefined, structure, markedContent: marked, annotations, outlines };
}

export const pinnedPdfExtractor: PdfTextExtractor = { name: PDF_ENGINE, extract: extractPdf };
