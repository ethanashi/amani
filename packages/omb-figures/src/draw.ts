/**
 * Drawing canvas shared by the renderers. It records every static and bound text segment (the
 * binding table the closed-world check uses), the provenance of every datum, and whether any
 * exec-grade value appears (which adds the dagger footnote). Fonts, sizes and colours are fixed.
 */
import { tagMark, type NumericMark, type MarkEncoding } from "./roundtrip.ts";
import { createHash } from "node:crypto";
import { coord, tickText } from "./format.ts";
import { NEUTRAL } from "./palette.ts";
import type { CertifiedFact, CertifiedSeries, NumberGrade } from "./port.ts";
import { refuse } from "./refusal.ts";
import type { Scale } from "./scale.ts";
import type { FigureKind } from "./spec.ts";
import { LIBRARY, T } from "./templates.ts";
import { parseTemplate, stat, type BindingSource, type Segment } from "./text.ts";
import { el, serialize, type SvgNode } from "./xml.ts";

export const FONT_STACK = "Helvetica, Arial, sans-serif";
/** Point sizes at final width (1 user unit = 1 pt). The smallest is above the 6 pt lint floor. */
export const FONT = { tick: 7, label: 7, title: 8, note: 6.5 } as const;
export const STROKE = { axis: 0.6, ref: 0.75, mark: 1, thin: 0.5 } as const;

export interface Datum {
  readonly role: string;
  readonly recordType: "fact" | "series";
  readonly id: string;
  readonly index: number | null;
  readonly value: number;
  readonly unit: string | null;
  readonly ciLevel: number | null;
  readonly sourceRecordId: string;
  readonly grade: NumberGrade;
}

export interface BoundValue { readonly text: string; readonly sources: readonly BindingSource[] }
export interface BindingTable {
  /** Fixed template text: the library plus the static fragments of this figure's label templates. */
  readonly vocabulary: readonly string[];
  /** Strings bound to certified values, axis rules or registered template constants. */
  readonly values: readonly BoundValue[];
}

/** Rough Helvetica advance widths (em), for deterministic layout only. */
export function textWidth(text: string, size: number): number {
  let w = 0;
  for (const ch of text) {
    if (/[ilj.,:;|!'† ]/u.test(ch)) w += 0.28;
    else if (/[ft()\-−]/u.test(ch)) w += 0.34;
    else if (/[mwMW]/u.test(ch)) w += 0.83;
    else if (/[A-Z]/u.test(ch)) w += 0.67;
    else w += 0.56;
  }
  return w * size;
}

export const figureDomId = (kind: string, id: string): string =>
  "omb" + createHash("sha256").update(`${kind}:${id}`).digest("hex").slice(0, 12).replace(/[0-9a-f]/gu, (c) => "abcdefghijklmnop"[parseInt(c, 16)]!);

export function templateFragments(templates: readonly (string | undefined)[]): string[] {
  return templates.flatMap((t) => (t === undefined ? [] : parseTemplate(t).fragments.filter(Boolean)));
}

/** Records template text, bound values and datum provenance for one figure or table. */
export class Collector {
  readonly data: Datum[] = [];
  exec = false;
  readonly #vocab: Set<string>;
  readonly #bound = new Map<string, BindingSource[]>();

  constructor(specFragments: readonly string[], extraVocabulary: readonly string[] = []) {
    this.#vocab = new Set([...LIBRARY, ...extraVocabulary, ...specFragments]);
  }

  /** Registers segments and returns the text they spell. Static text outside the vocabulary is a renderer bug. */
  register(segments: readonly Segment[]): string {
    for (const s of segments) {
      if (s.kind === "static") {
        if (!this.#vocab.has(s.text)) refuse("internal-template", `static text not in the template vocabulary: "${s.text}"`);
      } else {
        const list = this.#bound.get(s.text) ?? [];
        if (!list.some((x) => x.type === s.source.type && x.id === s.source.id)) list.push(s.source);
        this.#bound.set(s.text, list);
      }
    }
    return segments.map((s) => s.text).join("");
  }

  useFact(fact: CertifiedFact, role: string): CertifiedFact {
    this.data.push({ role, recordType: "fact", id: fact.id, index: null, value: fact.value, unit: fact.unit, ciLevel: fact.ciLevel, sourceRecordId: fact.sourceRecordId, grade: fact.grade });
    if (fact.grade === "exec") this.exec = true;
    return fact;
  }

  useSeries(series: CertifiedSeries, role: string): CertifiedSeries {
    series.values.forEach((value, index) => this.data.push({ role, recordType: "series", id: series.id, index, value, unit: series.unit, ciLevel: series.ciLevel, sourceRecordId: series.sourceRecordId, grade: series.grade }));
    if (series.grade === "exec") this.exec = true;
    return series;
  }

  bindings(): BindingTable {
    const values = [...this.#bound.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([text, sources]) => ({ text, sources }));
    return { vocabulary: [...this.#vocab].sort(), values };
  }
}

export class Canvas extends Collector {
  readonly kind: FigureKind;
  readonly id: string;
  readonly width: number;
  readonly nodes: SvgNode[] = [];
  readonly numericMarks: NumericMark[] = [];
  bindMark(node: SvgNode, encodings: readonly MarkEncoding[]): SvgNode {
    const key = `mark-${this.numericMarks.length}`;
    this.numericMarks.push({key, encodings});
    return tagMark(node,key);
  }

  constructor(kind: FigureKind, id: string, width: number, specFragments: readonly string[]) {
    super(specFragments);
    this.kind = kind;
    this.id = id;
    this.width = width;
  }

  text(x: number, y: number, segments: readonly Segment[], o: { size?: number; anchor?: "start" | "middle" | "end"; cls?: string; weight?: "bold"; fill?: string; rotate?: boolean } = {}): SvgNode {
    const content = this.register(segments);
    return el("text", [
      ["class", o.cls], ["x", coord(x)], ["y", coord(y)], ["font-size", coord(o.size ?? FONT.label)],
      ["text-anchor", o.anchor ?? "start"], ["fill", o.fill ?? NEUTRAL.ink], ["font-weight", o.weight],
      ["transform", o.rotate ? `rotate(-90 ${coord(x)} ${coord(y)})` : undefined],
    ], [content]);
  }

  finish(contentHeight: number, title: readonly Segment[], desc: readonly Segment[], extra: readonly (readonly Segment[])[]): { svg: string; bindings: BindingTable; height: number } {
    const footer = this.exec ? 14 : 0;
    const height = Math.ceil(contentHeight + footer);
    const dom = figureDomId(this.kind, this.id);
    const titleText = this.register(title);
    const descText = this.register(desc);
    for (const segs of extra) this.register(segs);
    const children: SvgNode[] = [
      el("title", [["id", `${dom}-title`]], [titleText]),
      el("desc", [["id", `${dom}-desc`]], [descText]),
      el("rect", [["class", "background"], ["x", "0"], ["y", "0"], ["width", coord(this.width)], ["height", coord(height)], ["fill", NEUTRAL.white]]),
      ...this.nodes,
    ];
    if (this.exec) children.push(this.text(8, height - 5, [stat(T.footnoteExec)], { size: FONT.note, cls: "footnote" }));
    const root = el("svg", [
      ["xmlns", "http://www.w3.org/2000/svg"], ["class", `omb-figure omb-kind-${this.kind}`],
      ["width", `${coord(this.width)}pt`], ["height", `${coord(height)}pt`], ["viewBox", `0 0 ${coord(this.width)} ${coord(height)}`],
      ["role", "img"], ["aria-labelledby", `${dom}-title ${dom}-desc`], ["font-family", FONT_STACK],
    ], children);
    return { svg: serialize(root) + "\n", bindings: this.bindings(), height };
  }
}

// ---------------------------------------------------------------------------------------------
// Shared drawing pieces

export const line = (x1: number, y1: number, x2: number, y2: number, o: { stroke?: string; width?: number; dash?: string; cls?: string } = {}): SvgNode =>
  el("line", [["class", o.cls], ["x1", coord(x1)], ["y1", coord(y1)], ["x2", coord(x2)], ["y2", coord(y2)], ["stroke", o.stroke ?? NEUTRAL.ink], ["stroke-width", coord(o.width ?? STROKE.mark)], ["stroke-dasharray", o.dash || undefined]]);

export const polyline = (points: readonly (readonly [number, number])[], o: { stroke: string; width?: number; dash?: string; cls?: string }): SvgNode =>
  el("polyline", [["class", o.cls], ["points", points.map(([x, y]) => `${coord(x)},${coord(y)}`).join(" ")], ["fill", "none"], ["stroke", o.stroke], ["stroke-width", coord(o.width ?? STROKE.mark)], ["stroke-dasharray", o.dash || undefined], ["stroke-linejoin", "round"]]);

export const rect = (x: number, y: number, w: number, h: number, o: { fill?: string; stroke?: string; width?: number; cls?: string } = {}): SvgNode =>
  el("rect", [["class", o.cls], ["x", coord(x)], ["y", coord(y)], ["width", coord(w)], ["height", coord(h)], ["fill", o.fill ?? "none"], ["stroke", o.stroke ?? "none"], ["stroke-width", o.stroke ? coord(o.width ?? STROKE.thin) : undefined]]);

export const group = (cls: string, children: readonly SvgNode[]): SvgNode => el("g", [["class", cls]], children);

export type Shape = "circle" | "square" | "diamond" | "up" | "down";

/** A data mark. Shapes other than circles are paths so every mark has the same attribute set. */
export function marker(shape: Shape, x: number, y: number, size: number, fill: string, cls: string): SvgNode {
  const c = `mark shape-${shape} ${cls}`.trim();
  if (shape === "circle") return el("circle", [["class", c], ["cx", coord(x)], ["cy", coord(y)], ["r", coord(size)], ["fill", fill], ["stroke", "none"]]);
  const s = size;
  const pts: [number, number][] = shape === "square" ? [[x - s, y - s], [x + s, y - s], [x + s, y + s], [x - s, y + s]]
    : shape === "diamond" ? [[x, y - s * 1.3], [x + s * 1.3, y], [x, y + s * 1.3], [x - s * 1.3, y]]
      : shape === "up" ? [[x, y - s * 1.2], [x + s * 1.1, y + s * 0.8], [x - s * 1.1, y + s * 0.8]]
        : [[x, y + s * 1.2], [x + s * 1.1, y - s * 0.8], [x - s * 1.1, y - s * 0.8]];
  return el("path", [["class", c], ["d", `M${pts.map(([px, py]) => `${coord(px)} ${coord(py)}`).join("L")}Z`], ["fill", fill], ["stroke", "none"]]);
}

/** Arrowhead whose tip sits exactly at (x, y), pointing in `dir`. Marks a truncated interval end. */
export function truncMarker(x: number, y: number, dir: "left" | "right" | "up" | "down"): SvgNode {
  const a = 3.2, b = 2.4;
  const pts: [number, number][] = dir === "left" ? [[x, y], [x + a, y - b], [x + a, y + b]]
    : dir === "right" ? [[x, y], [x - a, y - b], [x - a, y + b]]
      : dir === "up" ? [[x, y], [x - b, y + a], [x + b, y + a]] : [[x, y], [x - b, y - a], [x + b, y - a]];
  return el("path", [["class", "trunc"], ["d", `M${pts.map(([px, py]) => `${coord(px)} ${coord(py)}`).join("L")}Z`], ["fill", NEUTRAL.ink], ["stroke", "none"]]);
}

export function axisSegments(value: number, orient: "x" | "y"): Segment {
  return { kind: "bound", text: tickText(value), source: { type: "axis", id: orient, sourceRecordId: null, grade: null } };
}

/** Axis group: domain line, tick groups (line + bound label) and a title. */
export function drawAxis(c: Canvas, o: { orient: "x" | "y"; scale: Scale; at: number; title: readonly Segment[]; titleGap?: number }): SvgNode {
  const { scale, at } = o;
  const [r0, r1] = scale.range;
  const children: SvgNode[] = [];
  if (o.orient === "x") {
    children.push(line(r0, at, r1, at, { width: STROKE.axis, cls: "domain" }));
    for (const t of scale.ticks) {
      const px = scale.map(t);
      children.push(group("tick", [line(px, at, px, at + 3, { width: STROKE.axis }), c.text(px, at + 11, [axisSegments(t, "x")], { size: FONT.tick, anchor: "middle", cls: "tick-label" })]));
    }
    children.push(c.text((r0 + r1) / 2, at + (o.titleGap ?? 23), o.title, { size: FONT.title, anchor: "middle", cls: "axis-title" }));
  } else {
    children.push(line(at, r0, at, r1, { width: STROKE.axis, cls: "domain" }));
    for (const t of scale.ticks) {
      const py = scale.map(t);
      children.push(group("tick", [line(at - 3, py, at, py, { width: STROKE.axis }), c.text(at - 5, py + 2.5, [axisSegments(t, "y")], { size: FONT.tick, anchor: "end", cls: "tick-label" })]));
    }
    const tx = at - (o.titleGap ?? 30), ty = (r0 + r1) / 2;
    children.push(c.text(tx, ty, o.title, { size: FONT.title, anchor: "middle", cls: "axis-title", rotate: true }));
  }
  return group(`axis axis-${o.orient} scale-${scale.type}`, children);
}

/** Legend entry: a line or marker key followed by text. */
export function legendEntry(c: Canvas, x: number, y: number, key: { line?: { stroke: string; dash: string }; shape?: { shape: Shape; fill: string } }, segments: readonly Segment[]): SvgNode {
  const kids: SvgNode[] = [];
  if (key.line) kids.push(line(x, y - 2.5, x + 14, y - 2.5, { stroke: key.line.stroke, dash: key.line.dash, width: 1.2, cls: "legend-key" }));
  if (key.shape) kids.push(marker(key.shape.shape, x + 7, y - 2.5, 2.2, key.shape.fill, "legend-key"));
  kids.push(c.text(x + 18, y, segments, { size: FONT.label, cls: "legend-label" }));
  return group("legend-entry", kids);
}

/** Clips a polyline to a horizontal band [yTop, yBottom] in pixel space by interpolation. */
export function clipPolyline(points: readonly (readonly [number, number])[], yTop: number, yBottom: number): [number, number][][] {
  const runs: [number, number][][] = [];
  let run: [number, number][] = [];
  const inside = (p: readonly [number, number]) => p[1] >= yTop - 1e-9 && p[1] <= yBottom + 1e-9;
  const cross = (a: readonly [number, number], b: readonly [number, number], yEdge: number): [number, number] => [a[0] + ((yEdge - a[1]) / (b[1] - a[1])) * (b[0] - a[0]), yEdge];
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const prev = points[i - 1];
    if (inside(p)) {
      if (prev && !inside(prev)) run.push(cross(prev, p, prev[1] < yTop ? yTop : yBottom));
      run.push([p[0], p[1]]);
    } else if (prev && inside(prev)) {
      run.push(cross(prev, p, p[1] < yTop ? yTop : yBottom));
      runs.push(run);
      run = [];
    }
  }
  if (run.length > 1) runs.push(run);
  return runs.filter((r) => r.length > 1);
}
