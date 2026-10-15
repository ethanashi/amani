/**
 * Minimal deterministic SVG writer and a strict reader for the subset the checks accept.
 * The writer keeps attribute order as given and adds no whitespace inside text-bearing elements.
 * The reader refuses comments, processing instructions, CDATA and DOCTYPE, and reports every
 * character reference, so hidden or encoded content cannot slip past the closed-world check.
 */
export interface SvgNode {
  readonly tag: string;
  readonly attrs: readonly (readonly [string, string])[];
  readonly children: readonly (SvgNode | string)[];
}

export function el(tag: string, attrs: readonly (readonly [string, string | null | undefined])[] = [], children: readonly (SvgNode | string)[] = []): SvgNode {
  return { tag, attrs: attrs.filter((a): a is readonly [string, string] => a[1] !== null && a[1] !== undefined), children };
}

const escText = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const escAttr = (s: string) => escText(s).replaceAll('"', "&quot;");

export function serialize(node: SvgNode, depth = 0): string {
  const attrs = node.attrs.map(([k, v]) => ` ${k}="${escAttr(v)}"`).join("");
  if (!node.children.length) return `<${node.tag}${attrs}/>`;
  const inline = node.children.some((c) => typeof c === "string");
  if (inline) return `<${node.tag}${attrs}>${node.children.map((c) => (typeof c === "string" ? escText(c) : serialize(c, depth + 1))).join("")}</${node.tag}>`;
  const pad = "\n" + " ".repeat(depth + 1);
  return `<${node.tag}${attrs}>${node.children.map((c) => pad + serialize(c as SvgNode, depth + 1)).join("")}\n${" ".repeat(depth)}</${node.tag}>`;
}

// ---------------------------------------------------------------------------------------------

export interface ParsedElement {
  readonly tag: string;
  readonly attrs: readonly (readonly [string, string])[];
  readonly children: readonly ParsedChild[];
  readonly parent: ParsedElement | null;
}
export type ParsedChild = ParsedElement | { readonly text: string; readonly parent: ParsedElement };

export interface ParseIssue { readonly code: "malformed-svg" | "forbidden-markup" | "char-reference"; readonly detail: string }
export interface ParseResult { readonly root: ParsedElement | null; readonly issues: readonly ParseIssue[] }

const NAME = /[A-Za-z_][A-Za-z0-9_.:\-]*/y;
const PREDEFINED: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

function decode(raw: string, issues: ParseIssue[]): string {
  return raw.replace(/&(#x[0-9A-Fa-f]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);?/gu, (whole, body: string) => {
    if (body.startsWith("#")) {
      issues.push({ code: "char-reference", detail: `numeric character reference ${whole}` });
      const cp = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(cp) && cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : "�";
    }
    if (whole.endsWith(";") && Object.hasOwn(PREDEFINED, body)) return PREDEFINED[body]!;
    issues.push({ code: "char-reference", detail: `entity reference ${whole}` });
    return whole;
  });
}

export function parseSvg(source: string): ParseResult {
  const issues: ParseIssue[] = [];
  let i = 0;
  const fail = (detail: string): ParseResult => ({ root: null, issues: [...issues, { code: "malformed-svg", detail }] });
  const ws = () => { while (i < source.length && /\s/u.test(source[i]!)) i++; };
  const name = (): string | null => { NAME.lastIndex = i; const m = NAME.exec(source); if (!m) return null; i += m[0].length; return m[0]; };

  type Mutable = { tag: string; attrs: [string, string][]; children: ParsedChild[]; parent: ParsedElement | null };
  const stack: Mutable[] = [];
  let root: Mutable | null = null;
  ws();
  while (i < source.length) {
    if (source.startsWith("<!--", i)) { issues.push({ code: "forbidden-markup", detail: "comment" }); const end = source.indexOf("-->", i); if (end < 0) return fail("unterminated comment"); i = end + 3; continue; }
    if (source.startsWith("<![CDATA[", i)) { issues.push({ code: "forbidden-markup", detail: "CDATA section" }); const end = source.indexOf("]]>", i); if (end < 0) return fail("unterminated CDATA"); const top = stack.at(-1); if (top) top.children.push({ text: source.slice(i + 9, end), parent: top as ParsedElement }); i = end + 3; continue; }
    if (source.startsWith("<!", i)) { issues.push({ code: "forbidden-markup", detail: "DOCTYPE or declaration" }); const end = source.indexOf(">", i); if (end < 0) return fail("unterminated declaration"); i = end + 1; continue; }
    if (source.startsWith("<?", i)) { issues.push({ code: "forbidden-markup", detail: "processing instruction" }); const end = source.indexOf("?>", i); if (end < 0) return fail("unterminated processing instruction"); i = end + 2; continue; }
    if (source.startsWith("</", i)) {
      i += 2;
      const tag = name();
      ws();
      if (source[i] !== ">") return fail("malformed closing tag");
      i++;
      const top = stack.pop();
      if (!top || top.tag !== tag) return fail(`mismatched closing tag ${tag ?? ""}`);
      if (!stack.length) { ws(); if (i < source.length) return fail("content after the root element"); break; }
      continue;
    }
    if (source[i] === "<") {
      i++;
      const tag = name();
      if (!tag) return fail("malformed start tag");
      const attrs: [string, string][] = [];
      for (;;) {
        const before = i;
        ws();
        if (source[i] === "/" && source[i + 1] === ">") { i += 2; break; }
        if (source[i] === ">") { i++; break; }
        if (i === before) return fail(`missing whitespace before attribute in <${tag}>`);
        const attr = name();
        if (!attr) return fail(`malformed attribute in <${tag}>`);
        ws();
        if (source[i] !== "=") return fail(`attribute ${attr} without value`);
        i++;
        ws();
        const quote = source[i];
        if (quote !== '"' && quote !== "'") return fail(`unquoted attribute ${attr}`);
        const end = source.indexOf(quote, i + 1);
        if (end < 0) return fail(`unterminated attribute ${attr}`);
        const raw = source.slice(i + 1, end);
        if (raw.includes("<")) return fail(`'<' inside attribute ${attr}`);
        if (attrs.some(([k]) => k === attr)) return fail(`duplicate attribute ${attr}`);
        attrs.push([attr, decode(raw, issues)]);
        i = end + 1;
      }
      const selfClosing = source[i - 2] === "/";
      const parent = stack.at(-1) ?? null;
      const node: Mutable = { tag, attrs, children: [], parent: parent as ParsedElement | null };
      if (parent) parent.children.push(node as ParsedElement);
      else if (root) return fail("more than one root element");
      else root = node;
      if (!selfClosing) stack.push(node);
      else if (!parent) { ws(); if (i < source.length) return fail("content after the root element"); break; }
      continue;
    }
    const next = source.indexOf("<", i);
    const raw = source.slice(i, next < 0 ? source.length : next);
    const top = stack.at(-1);
    if (!top) { if (raw.trim()) return fail("text outside the root element"); }
    else if (raw.length) top.children.push({ text: decode(raw, issues), parent: top as ParsedElement });
    i = next < 0 ? source.length : next;
  }
  if (stack.length) return fail("unclosed element");
  if (!root) return fail("no root element");
  return { root: root as ParsedElement, issues };
}

export const isElement = (c: ParsedChild): c is ParsedElement => "tag" in c;
export const attr = (e: ParsedElement, name: string): string | undefined => e.attrs.find(([k]) => k === name)?.[1];
export const classes = (e: ParsedElement): string[] => (attr(e, "class") ?? "").split(/\s+/u).filter(Boolean);
export function* walk(e: ParsedElement): Generator<ParsedElement> {
  yield e;
  for (const c of e.children) if (isElement(c)) yield* walk(c);
}
/** Direct text content of an element (text children only, joined). */
export const ownText = (e: ParsedElement): string => e.children.filter((c): c is { text: string; parent: ParsedElement } => !isElement(c)).map((c) => c.text).join("");
