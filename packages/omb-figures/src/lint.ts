/**
 * Figure lint (section 5). It reads the SVG itself, so it also applies to figures produced by
 * other tools later (the pinned matplotlib path). Each rule fails closed: an axis, font or kind
 * it cannot read is an issue, never a pass.
 */
import { checkSvgClosedWorld, checkTextClosedWorld, rootKind, type ClosedWorldIssue } from "./closed-world.ts";
import type { BindingTable } from "./draw.ts";
import { validatePalette } from "./palette.ts";
import type { FigureKind } from "./spec.ts";
import { attr, classes, isElement, ownText, parseSvg, walk, type ParsedElement } from "./xml.ts";

export const MIN_FONT_PT = 6;

export type LintCode =
  | "palette-red-green" | "palette-cvd-collision" | "palette-unparseable"
  | "missing-risk-table" | "missing-survival-band"
  | "font-too-small" | "font-unknown"
  | "missing-reference-line" | "reference-line-invalid" | "axis-origin" | "axis-unreadable" | "axis-title-missing"
  | "ci-truncated-unmarked" | "ci-overflow" | "series-encoding" | "unknown-kind" | "malformed-svg";

export interface LintIssue { readonly code: LintCode; readonly detail: string }

type AxisRule = "unit" | "start-zero" | "start-non-negative" | "contains-zero" | "contains-null-line";

/**
 * Required reference geometry. A matching class is not enough: the element must be a visible stroke
 * (line, polyline or path; non-zero width; not hidden, transparent or white) with the right shape,
 * position and extent.
 *  vertical:       x1 = x2, inside the x axis, at least minLength long, optionally at a data value;
 *  horizontal:     y1 = y2, spanning at least `span` of the x axis, optionally at a data value on y;
 *  unit-diagonal:  from data (0, 0) to (1, 1);
 *  through-origin: a line whose extension passes through data (0, 0), at least minLength long;
 *  polyline:       at least two points and some length (a clipped reference curve).
 */
export type RefRule =
  | { readonly cls: string; readonly shape: "vertical"; readonly minLength: number; readonly at?: number }
  | { readonly cls: string; readonly shape: "horizontal"; readonly span: number; readonly at?: number }
  | { readonly cls: string; readonly shape: "unit-diagonal" }
  | { readonly cls: string; readonly shape: "through-origin"; readonly minLength: number }
  | { readonly cls: string; readonly shape: "polyline" };

interface KindRule {
  readonly refs: readonly RefRule[];
  readonly axes: readonly { readonly axis: "x" | "y"; readonly rule: AxisRule }[];
  /** Kinds whose intervals may be clipped at the axis (and must then carry a marker). */
  readonly truncatable: boolean;
}

/** Per-kind requirements: required reference lines, where axes start, and truncation. */
export const KIND_RULES: Record<FigureKind, KindRule> = {
  funnel:{refs:[{cls:'null-line',shape:'vertical',minLength:15}],axes:[],truncatable:false},
  'surrogacy-scatter':{refs:[{cls:'null-line',shape:'horizontal',span:.95,at:0}],axes:[{axis:'y',rule:'contains-zero'}],truncatable:false},
  "kaplan-meier": { refs: [], axes: [{axis:"x",rule:"start-zero"},{axis:"y",rule:"unit"}], truncatable:false },
  forest: { refs: [{ cls: "null-line", shape: "vertical", minLength: 15 }], axes: [{ axis: "x", rule: "contains-null-line" }], truncatable: true },
  "mr-forest": { refs: [{ cls: "null-line", shape: "vertical", minLength: 15 }], axes: [{ axis: "x", rule: "contains-null-line" }], truncatable: true },
  roc: { refs: [{ cls: "ref-chance", shape: "unit-diagonal" }], axes: [{ axis: "x", rule: "unit" }, { axis: "y", rule: "unit" }], truncatable: false },
  calibration: { refs: [{ cls: "ref-identity", shape: "unit-diagonal" }], axes: [{ axis: "x", rule: "unit" }, { axis: "y", rule: "unit" }], truncatable: false },
  "decision-curve": { refs: [{ cls: "ref-treat-all", shape: "polyline" }, { cls: "ref-treat-none", shape: "horizontal", span: 0.95, at: 0 }], axes: [{ axis: "x", rule: "start-non-negative" }, { axis: "y", rule: "contains-zero" }], truncatable: false },
  volcano: { refs: [{ cls: "ref-threshold", shape: "horizontal", span: 0.95 }, { cls: "null-line", shape: "vertical", minLength: 20, at: 0 }], axes: [{ axis: "y", rule: "start-zero" }, { axis: "x", rule: "contains-zero" }], truncatable: false },
  "mr-scatter": { refs: [{ cls: "fit-ivw", shape: "through-origin", minLength: 20 }, { cls: "null-line", shape: "horizontal", span: 0.95, at: 0 }], axes: [{ axis: "x", rule: "start-zero" }, { axis: "y", rule: "contains-zero" }], truncatable: true },
  coloc: { refs: [{ cls: "ref-threshold", shape: "vertical", minLength: 20 }], axes: [{ axis: "x", rule: "unit" }], truncatable: false },
  consort: { refs: [], axes: [], truncatable: false },
  "data-flow": { refs: [], axes: [], truncatable: false },
  "claim-flow": { refs: [], axes: [], truncatable: false },
};

const num = (e: ParsedElement, name: string): number => { const v = attr(e, name); return v === undefined ? NaN : Number(v); };

interface Axis {
  readonly log: boolean;
  readonly extent: readonly [number, number];
  readonly valueAt: (px: number) => number;
  readonly pxAt: (value: number) => number;
  readonly start: number;
  readonly end: number;
  readonly hasTitle: boolean;
}

function parseTick(text: string): number {
  const t = text.trim();
  return /^[−-]?\d[\d,]*(?:\.\d+)?$/u.test(t) ? Number(t.replace("−", "-").replaceAll(",", "")) : NaN;
}

function readAxis(g: ParsedElement, orient: "x" | "y", invertedY = false): Axis | string {
  const domain = g.children.filter(isElement).find((c) => c.tag === "line" && classes(c).includes("domain"));
  if (!domain) return "no domain line";
  const a = orient === "x" ? [num(domain, "x1"), num(domain, "x2")] : [num(domain, "y1"), num(domain, "y2")];
  if (a.some((v) => !Number.isFinite(v))) return "unreadable domain line";
  const extent: [number, number] = [Math.min(a[0]!, a[1]!), Math.max(a[0]!, a[1]!)];
  const ticks: [number, number][] = [];
  for (const t of g.children.filter(isElement).filter((c) => classes(c).includes("tick"))) {
    const l = t.children.filter(isElement).find((c) => c.tag === "line");
    const label = t.children.filter(isElement).find((c) => c.tag === "text");
    if (!l || !label) return "tick without line or label";
    const pos = orient === "x" ? num(l, "x1") : num(l, "y1");
    const value = parseTick(ownText(label));
    if (!Number.isFinite(pos) || !Number.isFinite(value)) return `unreadable tick "${ownText(label)}"`;
    ticks.push([pos, value]);
  }
  if (ticks.length < 2) return "fewer than two readable ticks";
  ticks.sort((p, q) => p[0] - q[0]);
  const log = classes(g).includes("scale-log");
  const [p0, v0] = ticks[0]!, [p1, v1] = ticks.at(-1)!;
  if (p1 === p0 || v1 === v0 || (log && (v0 <= 0 || v1 <= 0))) return "degenerate ticks";
  const f = log ? Math.log10 : (v: number) => v;
  const fi = log ? (v: number) => 10 ** v : (v: number) => v;
  const monotone = ticks.every(([, v], i) => i === 0 || (orient === "x" || invertedY ? v > ticks[i - 1]![1] : v < ticks[i - 1]![1]));
  if (!monotone) return "tick values are not monotone along the axis";
  const valueAt = (px: number) => fi(f(v0) + ((px - p0) / (p1 - p0)) * (f(v1) - f(v0)));
  const pxAt = (value: number) => p0 + ((f(value) - f(v0)) / (f(v1) - f(v0))) * (p1 - p0);
  const hasTitle = g.children.filter(isElement).some((c) => c.tag === "text" && classes(c).includes("axis-title") && ownText(c).trim().length > 0);
  // y pixels grow downward: the axis starts at the bottom.
  const [start, end] = orient === "x" ? [valueAt(extent[0]), valueAt(extent[1])] : [valueAt(extent[1]), valueAt(extent[0])];
  return { log, extent, valueAt, pxAt, start, end, hasTitle };
}

function effectiveFontSize(e: ParsedElement): number {
  for (let cur: ParsedElement | null = e; cur; cur = cur.parent) {
    const v = attr(cur, "font-size");
    if (v !== undefined) return /^\d+(?:\.\d+)?(?:pt|px)?$/u.test(v) ? Number.parseFloat(v) * (v.endsWith("pt") ? 1 / 0.75 : 1) : NaN;
  }
  return NaN;
}

/** Points per user unit at final size, from the root width and viewBox. */
function ptPerUnit(root: ParsedElement): number {
  const w = attr(root, "width"), vb = attr(root, "viewBox");
  if (!w || !vb) return NaN;
  const vbw = Number(vb.trim().split(/[\s,]+/u)[2]);
  const m = /^(\d+(?:\.\d+)?)(pt|px)?$/u.exec(w);
  if (!m || !(vbw > 0)) return NaN;
  const widthPt = Number(m[1]) * (m[2] === "pt" ? 1 : 0.75);
  return widthPt / vbw;
}

const STROKED = new Set(["line", "polyline", "path"]);

function points(e: ParsedElement): [number, number][] {
  if (e.tag === "line") return [[num(e, "x1"), num(e, "y1")], [num(e, "x2"), num(e, "y2")]];
  const raw = e.tag === "polyline" ? attr(e, "points") ?? "" : (attr(e, "d") ?? "").replace(/[MLZ]/giu, " ");
  const n = raw.trim().split(/[\s,]+/u).filter(Boolean).map(Number);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < n.length; i += 2) out.push([n[i]!, n[i + 1]!]);
  return out;
}

/** Why a stroke would not be seen, or null. Checks the element and its ancestors. */
function invisibility(e: ParsedElement): string | null {
  const stroke = (attr(e, "stroke") ?? "").trim().toUpperCase();
  if (!stroke || stroke === "NONE" || stroke === "TRANSPARENT" || stroke === "#FFFFFF" || stroke === "#FFF" || stroke === "WHITE") return "no visible stroke colour";
  const width = attr(e, "stroke-width");
  if (width !== undefined && !(Number.parseFloat(width) >= 0.25)) return `stroke width ${width}`;
  const dash = attr(e, "stroke-dasharray");
  if (dash !== undefined && dash !== "none") {
    const d = dash.split(/[\s,]+/u).map(Number);
    if (d.some((v) => !Number.isFinite(v) || v < 0) || d.filter((_, i) => i % 2 === 0).every((v) => v === 0)) return `dash pattern "${dash}" draws nothing`;
  }
  for (let cur: ParsedElement | null = e; cur; cur = cur.parent) {
    for (const name of ["opacity", "stroke-opacity"]) {
      const v = attr(cur, name);
      if (v !== undefined && !(Number(v) >= 0.2)) return `${name} ${v}`;
    }
    if (attr(cur, "style") !== undefined) return "inline style (cannot be verified)";
    if (["hidden", "collapse"].includes(attr(cur, "visibility") ?? "") || attr(cur, "display") === "none") return "hidden";
  }
  return null;
}

function refProblem(e: ParsedElement, ref: RefRule, axes: ReadonlyMap<"x" | "y", Axis>): string | null {
  const hidden = invisibility(e);
  if (hidden) return hidden;
  const pts = points(e);
  if (pts.length < 2 || pts.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y))) return "unreadable geometry";
  const length = pts.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - pts[i]![0], p[1] - pts[i]![1]), 0);
  if (!(length >= 1)) return "degenerate (no length)";
  const ax = axes.get("x"), ay = axes.get("y");
  const [a, b] = [pts[0]!, pts.at(-1)!];
  const near = (axis: Axis, px: number, value: number) => Math.abs(axis.valueAt(px) - value) <= 0.002 * Math.abs(axis.end - axis.start || 1);
  switch (ref.shape) {
    case "polyline": return null;
    case "vertical": {
      if (pts.some(([x]) => Math.abs(x - a[0]) > 0.01)) return "not vertical";
      if (length < ref.minLength) return `too short (${length.toFixed(1)})`;
      if (ax && (a[0] < ax.extent[0] - 0.01 || a[0] > ax.extent[1] + 0.01)) return "outside the x axis";
      if (ref.at !== undefined && (!ax || !near(ax, a[0], ref.at))) return `not at x = ${ref.at}`;
      return null;
    }
    case "horizontal": {
      if (pts.some(([, y]) => Math.abs(y - a[1]) > 0.01)) return "not horizontal";
      if (!ax) return "no x axis to measure against";
      if (Math.abs(b[0] - a[0]) < ref.span * (ax.extent[1] - ax.extent[0])) return "does not span the plot";
      if (ay && (a[1] < ay.extent[0] - 0.01 || a[1] > ay.extent[1] + 0.01)) return "outside the y axis";
      if (ref.at !== undefined && (!ay || !near(ay, a[1], ref.at))) return `not at y = ${ref.at}`;
      return null;
    }
    case "unit-diagonal": {
      if (!ax || !ay) return "needs both axes";
      const ends = [a, b].map(([x, y]) => [ax.valueAt(x), ay.valueAt(y)] as const).sort((p, q) => p[0] - q[0]);
      const ok = ends[0]!.every((v) => Math.abs(v) <= 0.005) && ends[1]!.every((v) => Math.abs(v - 1) <= 0.005);
      return ok ? null : "not the diagonal from (0, 0) to (1, 1)";
    }
    case "through-origin": {
      if (!ax || !ay) return "needs both axes";
      if (length < ref.minLength) return `too short (${length.toFixed(1)})`;
      const ox = ax.pxAt(0), oy = ay.pxAt(0);
      const distance = Math.abs((b[0] - a[0]) * (a[1] - oy) - (a[0] - ox) * (b[1] - a[1])) / Math.hypot(b[0] - a[0], b[1] - a[1]);
      return distance <= 1 ? null : "does not pass through the origin";
    }
  }
}

function firstPoint(e: ParsedElement): [number, number] | null {
  const d = attr(e, "d") ?? attr(e, "points");
  const m = d ? /^M?\s*(-?[\d.]+)[ ,](-?[\d.]+)/u.exec(d) : null;
  return m ? [Number(m[1]), Number(m[2])] : null;
}

export function lintFigureSvg(svg: string): LintIssue[] {
  const parsed = parseSvg(svg);
  if (!parsed.root) return parsed.issues.map((i) => ({ code: "malformed-svg", detail: i.detail }));
  const root = parsed.root;
  const issues: LintIssue[] = [];
  const add = (code: LintCode, detail: string) => issues.push({ code, detail });
  const kind = rootKind(root) as FigureKind | undefined;
  const rule = kind ? KIND_RULES[kind] : undefined;
  if (!kind || !rule) { add("unknown-kind", `unknown figure kind ${kind ?? "(none)"}`); return issues; }
  const all = [...walk(root)];

  if(kind === "kaplan-meier") {
    if(!all.some(e=>e.tag==='g' && classes(e).includes('risk-table') && [...walk(e)].filter(x=>x.tag==='text').length>=3)) add('missing-risk-table','Kaplan–Meier requires a number-at-risk table');
    if(!all.some(e=>e.tag==='polygon' && classes(e).includes('band'))) add('missing-survival-band','Kaplan–Meier requires a CI band');
  }
  // Fonts at final size.
  const scale = ptPerUnit(root);
  for (const t of all.filter((e) => e.tag === "text" || e.tag === "tspan")) {
    const size = effectiveFontSize(t) * scale;
    if (!Number.isFinite(size)) add("font-unknown", `cannot determine the font size of "${ownText(t).slice(0, 30)}"`);
    else if (size < MIN_FONT_PT - 1e-9) add("font-too-small", `"${ownText(t).slice(0, 30)}" is ${size.toFixed(2)} pt (minimum ${MIN_FONT_PT} pt)`);
  }

  // Palette: distinct colours on data marks.
  const markColours = all.filter((e) => classes(e).includes("mark") || classes(e).includes("band"))
    .flatMap((e) => [attr(e, "fill"), attr(e, "stroke")]).filter((c): c is string => !!c && c !== "none");
  for (const p of validatePalette(markColours)) add(p.code, p.detail);

  // Series encoding: line series need distinct dash patterns; point categories need distinct shapes.
  const dashBySeries = new Map<string, string>();
  for (const e of all.filter((x) => classes(x).includes("series-line"))) {
    const s = classes(e).find((c) => /^s[a-d]$/u.test(c)) ?? "?";
    dashBySeries.set(s, attr(e, "stroke-dasharray") ?? "");
  }
  const dashes = [...dashBySeries.values()];
  if (new Set(dashes).size !== dashes.length) add("series-encoding", "two line series share a dash pattern (colour alone distinguishes them)");
  const shapesByColour = new Map<string, Set<string>>();
  for (const e of all.filter((x) => classes(x).includes("mark") && !classes(x).includes("legend-key"))) {
    const shape = classes(e).find((c) => c.startsWith("shape-"));
    if (!shape) continue;
    const fill = attr(e, "fill") ?? "";
    const set = shapesByColour.get(fill) ?? new Set<string>();
    set.add(shape);
    shapesByColour.set(fill, set);
  }
  const shapeOwners = new Map<string, string>();
  for (const [colour, shapes] of shapesByColour) for (const s of shapes) {
    const owner = shapeOwners.get(s);
    if (owner && owner !== colour) add("series-encoding", `${s} marks appear in ${owner} and ${colour} (colour alone distinguishes them)`);
    shapeOwners.set(s, colour);
  }

  // Axes.
  const axes = new Map<"x" | "y", Axis>();
  for (const g of all.filter((e) => e.tag === "g" && classes(e).includes("axis"))) {
    const orient = classes(g).includes("axis-x") ? "x" : classes(g).includes("axis-y") ? "y" : null;
    if (!orient) { add("axis-unreadable", "axis group without orientation"); continue; }
    const a = readAxis(g, orient, kind === "funnel" && orient === "y");
    if (typeof a === "string") { add("axis-unreadable", `${orient} axis: ${a}`); continue; }
    if (!a.hasTitle) add("axis-title-missing", `${orient} axis has no title`);
    axes.set(orient, a);
  }
  // Required reference lines: visible, non-degenerate, in place.
  for (const ref of rule.refs) {
    const drawn = all.filter((e) => classes(e).includes(ref.cls) && STROKED.has(e.tag));
    if (!drawn.length) { add("missing-reference-line", `${kind} requires a drawn ${ref.cls} line`); continue; }
    const reasons = drawn.map((e) => refProblem(e, ref, axes));
    if (!reasons.includes(null)) add("reference-line-invalid", `${ref.cls}: ${reasons.join("; ")}`);
  }

  for (const req of rule.axes) {
    const a = axes.get(req.axis);
    if (!a) { add("axis-unreadable", `${kind} requires a readable ${req.axis} axis`); continue; }
    const tol = 0.002 * Math.abs(a.end - a.start || 1);
    const near = (v: number, target: number) => Math.abs(v - target) <= tol;
    let ok = true;
    if (req.rule === "unit") ok = near(a.start, 0) && near(a.end, 1);
    else if (req.rule === "start-zero") ok = near(a.start, 0);
    else if (req.rule === "start-non-negative") ok = a.start >= -tol;
    else if (req.rule === "contains-zero") ok = a.start <= tol && a.end >= -tol;
    else {
      const nl = all.find((e) => classes(e).includes("null-line"));
      const x = nl ? num(nl, "x1") : NaN;
      ok = Number.isFinite(x) && x >= a.extent[0] - 0.01 && x <= a.extent[1] + 0.01 && (!nl || num(nl, "x1") === num(nl, "x2"));
      // Ratio measures (log axes) have their null at 1.
      if (ok && a.log) ok = Math.abs(Math.log10(a.valueAt(x))) <= 0.002 * Math.abs(Math.log10(a.end / a.start));
    }
    if (!ok) add("axis-origin", `${kind} ${req.axis} axis violates "${req.rule}" (starts at ${a.start.toPrecision(4)}, ends at ${a.end.toPrecision(4)})`);
  }

  // Interval truncation and overflow.
  for (const ci of all.filter((e) => e.tag === "line" && classes(e).includes("ci"))) {
    const [x1, y1, x2, y2] = ["x1", "y1", "x2", "y2"].map((n) => num(ci, n)) as [number, number, number, number];
    const horizontal = y1 === y2, vertical = x1 === x2;
    if (!horizontal && !vertical) { add("ci-overflow", "interval line is neither horizontal nor vertical"); continue; }
    const a = axes.get(horizontal ? "x" : "y");
    if (!a) { add("axis-unreadable", "interval line without the matching axis"); continue; }
    const ends: [number, number][] = horizontal ? [[x1, y1], [x2, y2]] : [[x1, y1], [x2, y2]];
    for (const [px, py] of ends) {
      const pos = horizontal ? px : py;
      if (pos < a.extent[0] - 0.01 || pos > a.extent[1] + 0.01) { add("ci-overflow", "interval drawn beyond the axis"); continue; }
      const atEdge = Math.abs(pos - a.extent[0]) <= 0.01 || Math.abs(pos - a.extent[1]) <= 0.01;
      if (!atEdge || !rule.truncatable) continue;
      const siblings = ci.parent ? ci.parent.children.filter(isElement) : [];
      const marked = siblings.some((s) => classes(s).includes("trunc") && (() => { const p = firstPoint(s); return !!p && Math.abs(p[0] - px) <= 0.6 && Math.abs(p[1] - py) <= 0.6; })());
      if (!marked) add("ci-truncated-unmarked", `interval clipped at the axis edge (${px}, ${py}) without a truncation marker`);
    }
  }
  return issues;
}

export interface FigureCheck { readonly lint: readonly LintIssue[]; readonly closedWorld: readonly ClosedWorldIssue[] }

/** The full gate on one SVG and its captions: figure lint plus the closed-world check. */
export function checkFigure(svg: string, bindings: BindingTable, texts: readonly { readonly text: string; readonly where: string }[] = []): FigureCheck {
  return {
    lint: lintFigureSvg(svg),
    closedWorld: [...checkSvgClosedWorld(svg, bindings), ...texts.flatMap((t) => checkTextClosedWorld(t.text, bindings, t.where))],
  };
}
