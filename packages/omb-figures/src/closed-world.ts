/**
 * Closed-world check (section 8). Every text node must decompose exactly into fixed template text
 * (the library plus this figure's template fragments, all digit-free) and strings bound to a
 * certified value, an axis rule or a registered constant. Every element and attribute must be on
 * the allowlist, and every attribute value must match its strict grammar or enumerated values.
 * No heuristics: anything unknown is an issue. Geometry attributes are numeric by nature; that
 * they trace to the input is proven by byte-identical regeneration (verify.ts).
 */
import { FONT_STACK, type BindingTable } from "./draw.ts";
import { ALLOWED_COLOURS } from "./palette.ts";
import { FIGURE_KINDS } from "./spec.ts";
import { attr, isElement, parseSvg, type ParsedElement } from "./xml.ts";

export type ClosedWorldCode =
  | "unbound-number" | "unknown-text" | "format-char" | "char-reference" | "forbidden-markup" | "malformed-svg"
  | "forbidden-element" | "forbidden-attribute" | "attribute-value" | "stray-text" | "vocabulary-number";

export interface ClosedWorldIssue { readonly code: ClosedWorldCode; readonly where: string; readonly detail: string }

const NUM = String.raw`-?\d+(?:\.\d{1,2})?`;
const GRAMMAR = {
  markRef: /^mark-\d+$/u,
  geometry: new RegExp(`^${NUM}$`, "u"),
  lengthPt: /^\d+(?:\.\d{1,2})?pt$/u,
  viewBox: /^0 0 \d+(?:\.\d{1,2})? \d+(?:\.\d{1,2})?$/u,
  points: new RegExp(`^${NUM},${NUM}(?: ${NUM},${NUM})*$`, "u"),
  path: new RegExp(`^M${NUM} ${NUM}(?:L${NUM} ${NUM})*Z?$`, "u"),
  dash: /^\d+(?:\.\d{1,2})?(?: \d+(?:\.\d{1,2})?)*$/u,
  rotate: new RegExp(`^rotate\\(-90 ${NUM} ${NUM}\\)$`, "u"),
  opacity: /^(?:0(?:\.\d{1,2})?|1)$/u,
  id: /^omb[a-p]{12}-(?:title|desc)$/u,
  idrefs: /^omb[a-p]{12}-title omb[a-p]{12}-desc$/u,
} as const;

type Rule = keyof typeof GRAMMAR | "colour" | "class" | { readonly oneOf: readonly string[] };

const COMMON_SHAPE = { "data-fact": "markRef", class: "class", fill: "colour", stroke: "colour", "stroke-width": "geometry" } as const;
const ALLOWED: Record<string, Record<string, Rule>> = {
  svg: { xmlns: { oneOf: ["http://www.w3.org/2000/svg"] }, class: "class", width: "lengthPt", height: "lengthPt", viewBox: "viewBox", role: { oneOf: ["img"] }, "aria-labelledby": "idrefs", "font-family": { oneOf: [FONT_STACK] } },
  metadata: {},
  title: { id: "id" },
  desc: { id: "id" },
  g: { class: "class" },
  rect: { ...COMMON_SHAPE, x: "geometry", y: "geometry", width: "geometry", height: "geometry" },
  line: { ...COMMON_SHAPE, x1: "geometry", y1: "geometry", x2: "geometry", y2: "geometry", "stroke-dasharray": "dash" },
  polyline: { ...COMMON_SHAPE, points: "points", "stroke-dasharray": "dash", "stroke-linejoin": { oneOf: ["round"] } },
  polygon: { ...COMMON_SHAPE, points: "points", "fill-opacity": "opacity" },
  circle: { ...COMMON_SHAPE, cx: "geometry", cy: "geometry", r: "geometry" },
  path: { ...COMMON_SHAPE, d: "path" },
  text: { class: "class", x: "geometry", y: "geometry", "font-size": "geometry", "text-anchor": { oneOf: ["start", "middle", "end"] }, fill: "colour", "font-weight": { oneOf: ["bold"] }, transform: "rotate" },
};
const TEXT_PARENTS = new Set(["text", "title", "desc", "metadata"]);

export const CLASS_TOKENS: ReadonlySet<string> = new Set([
  "risk-table", "censor", "mr-excluded", "omb-figure", ...FIGURE_KINDS.map((k) => `omb-kind-${k}`), "background", "axis", "axis-x", "axis-y", "scale-linear", "scale-log",
  "domain", "tick", "tick-label", "axis-title", "null-line", "ref-chance", "ref-identity", "ref-treat-all", "ref-treat-none",
  "ref-threshold", "ref-locked", "mark", "series-line", "sa", "sb", "sc", "sd", "shape-circle", "shape-square", "shape-diamond",
  "shape-up", "shape-down", "ci", "trunc", "band", "fit-ivw", "fit-egger", "fit-wm", "fit-wmode", "label", "row", "header", "value",
  "legend-entry", "legend-key", "legend-label", "annotation", "footnote", "points", "labels", "leader", "arrow", "flow-box", "flow-text", "box", "bar",
]);

function checkAttribute(value: string, rule: Rule): boolean {
  if (typeof rule === "object") return rule.oneOf.includes(value);
  if (rule === "colour") return ALLOWED_COLOURS.has(value);
  if (rule === "class") { const tokens = value.split(" "); return tokens.length > 0 && tokens.every((t) => CLASS_TOKENS.has(t)); }
  return GRAMMAR[rule].test(value);
}

/**
 * A complete numeric expression: an alphanumeric run holding a digit (with inner . or , separators and an
 * optional sign), joined to further runs by exponent or operator marks (e, x, *, /, ^, superscript signs),
 * plus a trailing percent or per-mille sign. "0.80e2", "0.80%", "0.80 x 2", "AUC0.80" and "-0.12" are each
 * ONE expression, so two bindings (or a binding plus static text) can never assemble a new number.
 */
const ATOM = String.raw`[−+\-]?[\p{L}\p{N}]*\p{N}[\p{L}\p{N}]*(?:[.,][\p{L}\p{N}]+)*`;
const JOIN = String.raw`\s*[×xX*/^eE⁺⁻]\s*`;
export const NUMERIC_EXPRESSION = new RegExp(`${ATOM}(?:${JOIN}${ATOM})*[%‰]?`, "gu");

/** Index of the closed vocabulary: fixed text and bound strings, grouped by first character. */
export class TextWorld {
  readonly #byFirst = new Map<string, { text: string; bound: boolean }[]>();
  readonly #bound: readonly string[];
  readonly issues: ClosedWorldIssue[] = [];
  constructor(bindings: BindingTable) {
    for (const v of bindings.vocabulary) {
      if (/\p{N}/u.test(v)) this.issues.push({ code: "vocabulary-number", where: "vocabulary", detail: `template text contains a number: "${v}"` });
    }
    const entries = [...bindings.vocabulary.map((text) => ({ text, bound: false })), ...bindings.values.map((v) => ({ text: v.text, bound: true }))].filter((e) => e.text.length > 0);
    for (const e of entries) {
      const first = String.fromCodePoint(e.text.codePointAt(0)!);
      const list = this.#byFirst.get(first) ?? [];
      list.push(e);
      this.#byFirst.set(first, list);
    }
    for (const list of this.#byFirst.values()) list.sort((a, b) => b.text.length - a.text.length || (a.text < b.text ? -1 : 1));
    this.#bound = bindings.values.map((v) => v.text).filter(Boolean);
  }

  /** Checks one text node or attribute value; returns issues (empty when it is closed-world). */
  check(text: string, where: string): ClosedWorldIssue[] {
    const issues: ClosedWorldIssue[] = [];
    if (/[\p{Cf}\p{Cc}\p{Zl}\p{Zp}]/u.test(text)) issues.push({ code: "format-char", where, detail: "control, bidi or zero-width character" });
    // Every complete numeric expression must lie inside ONE occurrence of a bound value, so "10" is not
    // excused by the tick labels "1" and "0", nor "-0.12" by a bound "0.12", nor "0.80e2" by "0.80" and "2".
    const occurrences: [number, number][] = [];
    for (const b of this.#bound) {
      for (let at = text.indexOf(b); at >= 0; at = text.indexOf(b, at + 1)) occurrences.push([at, at + b.length]);
    }
    for (const token of text.matchAll(NUMERIC_EXPRESSION)) {
      const start = token.index, end = start + token[0].length;
      const inside = occurrences.some(([a, z]) => a <= start && end <= z);
      if (!inside) {
        issues.push({ code: "unbound-number", where, detail: `"${token[0]}" in "${text.slice(Math.max(0, start - 12), end + 12)}" is not a bound value` });
        break;
      }
    }
    if (!this.#decomposes(text)) issues.push({ code: "unknown-text", where, detail: `"${text.length > 80 ? text.slice(0, 80) + "..." : text}" is not template text plus bound values` });
    return issues;
  }

  #decomposes(text: string): boolean {
    if (text.length === 0) return true;
    const reach = new Uint8Array(text.length + 1);
    reach[0] = 1;
    for (let i = 0; i < text.length; i++) {
      if (!reach[i]) continue;
      const first = String.fromCodePoint(text.codePointAt(i)!);
      for (const e of this.#byFirst.get(first) ?? []) {
        const end = i + e.text.length;
        if (end <= text.length && !reach[end] && text.startsWith(e.text, i)) reach[end] = 1;
      }
      if (reach[text.length]) return true;
    }
    return reach[text.length] === 1;
  }
}

export function checkSvgClosedWorld(svg: string, bindings: BindingTable): ClosedWorldIssue[] {
  const parsed = parseSvg(svg);
  const issues: ClosedWorldIssue[] = parsed.issues.map((i) => ({ code: i.code, where: "svg", detail: i.detail }));
  if (!parsed.root) return issues;
  const world = new TextWorld(bindings);
  issues.push(...world.issues);
  if (parsed.root.tag !== "svg") issues.push({ code: "forbidden-element", where: parsed.root.tag, detail: "root element must be svg" });
  const visit = (e: ParsedElement, path: string) => {
    const here = `${path}/${e.tag}`;
    const allowed = ALLOWED[e.tag];
    if (!allowed) issues.push({ code: "forbidden-element", where: here, detail: `element <${e.tag}> is not allowed` });
    for (const [name, value] of e.attrs) {
      const rule = allowed?.[name];
      if (!rule) {
        issues.push({ code: "forbidden-attribute", where: here, detail: `attribute ${name} is not allowed on <${e.tag}>` });
        if (/\p{N}/u.test(value)) issues.push({ code: "unbound-number", where: `${here}@${name}`, detail: "number in a disallowed attribute" });
        continue;
      }
      if (/[\p{Cf}\p{Cc}]/u.test(value)) issues.push({ code: "format-char", where: `${here}@${name}`, detail: "control, bidi or zero-width character" });
      if (!checkAttribute(value, rule)) {
        issues.push({ code: "attribute-value", where: `${here}@${name}`, detail: `value "${value.slice(0, 60)}" does not match the allowed grammar` });
      }
    }
    e.children.forEach((c, i) => {
      if (isElement(c)) { visit(c, `${here}[${i}]`); return; }
      if (!TEXT_PARENTS.has(e.tag)) {
        if (c.text.trim()) issues.push({ code: "stray-text", where: here, detail: `text outside a text element: "${c.text.trim().slice(0, 40)}"` });
        if (/\p{N}/u.test(c.text)) issues.push({ code: "unbound-number", where: here, detail: "number in stray text" });
        return;
      }
      issues.push(...world.check(c.text, `${here}#text`));
    });
  };
  visit(parsed.root, "");
  return issues;
}

/** Closed-world check of a plain string (caption, alt text, table cell) against a binding table. */
export function checkTextClosedWorld(text: string, bindings: BindingTable, where: string): ClosedWorldIssue[] {
  const world = new TextWorld(bindings);
  return [...world.issues, ...world.check(text, where)];
}

/** Root kind class, used by the figure lint. */
export const rootKind = (root: ParsedElement): string | undefined => (attr(root, "class") ?? "").split(" ").find((c) => c.startsWith("omb-kind-"))?.slice("omb-kind-".length);
