/**
 * Forest plot and MR forest plot. Fixed settings: every row in plan order, a dashed null line,
 * ratio measures on a log axis, intervals beyond the template's span truncated with arrowheads.
 */
import { Canvas, FONT, STROKE, drawAxis, group, line, marker, templateFragments, textWidth, truncMarker } from "../draw.ts";
import { NEUTRAL, OKABE_ITO } from "../palette.ts";
import type { CertifiedClaim, CertifiedFact } from "../port.ts";
import { refuse } from "../refusal.ts";
import { extendLinear, makeScale, niceLinear, niceLog } from "../scale.ts";
import type { ForestRow, ForestSpec, MrForestSpec, MrMethod } from "../spec.ts";
import type { FactStore, UseContext } from "../store.ts";
import { T } from "../templates.ts";
import { resolveTemplate, stat, type Segment } from "../text.ts";
import {
  ESTIMATE_KINDS, RATIO_KINDS, captionSegs, intervalSegs, lvlSeg, measureName, nonEmptyArray, requireClaim, useContext, type FigureDraft,
} from "./common.ts";

const WIDTH = 360;
const ROW_H = 13;
const LABEL_MAX = 150;
const METHOD_NAME: Record<MrMethod, string> = { ivw: T.mrIvw, egger: T.mrEgger, "weighted-median": T.mrWeightedMedian, "weighted-mode": T.mrWeightedMode };

interface Row {
  readonly label: readonly Segment[];
  readonly est: CertifiedFact; readonly lo: CertifiedFact; readonly hi: CertifiedFact;
  readonly summary: boolean;
}
type Line = { readonly heading: readonly Segment[] } | { readonly row: Row };

function resolveRow(store: FactStore, ctx: UseContext, row: ForestRow | { estimate: string; lower: string; upper: string }, label: readonly Segment[], summary: boolean, canvas: Canvas): Row {
  const est = canvas.useFact(store.fact(row.estimate, ctx, ESTIMATE_KINDS), "estimate");
  const lo = canvas.useFact(store.fact(row.lower, ctx, ["ci"]), "ci-lower");
  const hi = canvas.useFact(store.fact(row.upper, ctx, ["ci"]), "ci-upper");
  return { label, est, lo, hi, summary };
}

function median(values: readonly number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Domain rule: covers estimates and the null; interval ends beyond a fixed span are truncated. */
function domainFor(rows: readonly Row[], claim: CertifiedClaim, log: boolean): { domain: [number, number]; ticks: number[] } {
  const ests = [...rows.map((r) => r.est.value), claim.nullValue];
  const minE = Math.min(...ests), maxE = Math.max(...ests);
  if (log) {
    const loCap = minE / 10, hiCap = maxE * 10;
    const lo = Math.min(minE, ...rows.map((r) => Math.max(r.lo.value, loCap)));
    const hi = Math.max(maxE, ...rows.map((r) => Math.min(r.hi.value, hiCap)));
    let axis = niceLog(lo, hi);
    const pads: ("lo" | "hi")[] = [];
    if (rows.some((r) => r.lo.value === axis.domain[0])) pads.push("lo");
    if (rows.some((r) => r.hi.value === axis.domain[1])) pads.push("hi");
    if (pads.length) axis = niceLog(lo, hi, pads);
    return axis;
  }
  const half = median(rows.map((r) => (r.hi.value - r.lo.value) / 2)) || Math.max(1e-9, Math.abs(maxE - minE)) || 1;
  const loCap = minE - 4 * half, hiCap = maxE + 4 * half;
  const lo = Math.min(minE, ...rows.map((r) => Math.max(r.lo.value, loCap)));
  const hi = Math.max(maxE, ...rows.map((r) => Math.min(r.hi.value, hiCap)));
  let axis = niceLinear(lo, hi);
  if (rows.some((r) => r.lo.value === axis.domain[0])) axis = extendLinear(axis, "lo");
  if (rows.some((r) => r.hi.value === axis.domain[1])) axis = extendLinear(axis, "hi");
  return axis;
}

function intervalPlot(store: FactStore, ctx: UseContext, canvas: Canvas, claim: CertifiedClaim, lines: readonly Line[], titleText: string, captionHead: readonly Segment[], captionSpec: ForestSpec["caption"]): FigureDraft {
  const rows = lines.flatMap((l) => ("row" in l ? [l.row] : []));
  const kinds = new Set(rows.map((r) => r.est.kind));
  if (kinds.size !== 1) refuse("inconsistent-data", `${ctx.where}: rows mix estimate kinds (${[...kinds].join(", ")})`);
  const kind = rows[0]!.est.kind;
  const log = RATIO_KINDS.includes(kind);
  if (log !== (claim.scale === "ratio")) refuse("inconsistent-data", `${ctx.where}: ${kind} estimates do not match the claim's ${claim.scale} scale`);
  const levels = new Set(rows.map((r) => r.lo.ciLevel));
  if (levels.size !== 1) refuse("inconsistent-data", `${ctx.where}: rows mix interval levels`);
  const lvl = lvlSeg(store, rows[0]!.lo);
  const display = new Map(rows.map((r) => [r, intervalSegs(store, r.est, r.lo, r.hi)]));

  const labelW = Math.max(...lines.map((l) => textWidth(("row" in l ? l.row.label : l.heading).map((s) => s.text).join(""), FONT.label)));
  if (labelW > LABEL_MAX) refuse("label-too-long", `${ctx.where}: a row label exceeds the template's label column`);
  const estW = Math.max(...rows.map((r) => textWidth(display.get(r)!.all.map((s) => s.text).join(""), FONT.label)), textWidth(measureName(kind) + " (95% CI)", FONT.label));
  const x0 = 8 + labelW + 8, x1 = WIDTH - 8 - estW - 8;
  if (x1 - x0 < 90) refuse("label-too-long", `${ctx.where}: labels leave no room for the plot`);
  const axis = domainFor(rows, claim, log);
  const scale = makeScale(log ? "log" : "linear", axis.domain, [x0, x1], axis.ticks);
  const top = 26;
  const axisY = top + lines.length * ROW_H + 2;

  canvas.nodes.push(canvas.text(WIDTH - 8, 16, [stat(measureName(kind)), stat(T.openParen), lvl, stat(T.ciClose)], { size: FONT.label, anchor: "end", weight: "bold", cls: "header" }));
  const nx = scale.map(claim.nullValue);
  canvas.nodes.push(line(nx, top - 4, nx, axisY, { stroke: NEUTRAL.grey, width: STROKE.ref, dash: "3 2", cls: "null-line" }));

  const altRows: Segment[][] = [];
  lines.forEach((l, i) => {
    const y = top + i * ROW_H + ROW_H / 2;
    if ("heading" in l) {
      canvas.nodes.push(canvas.text(8, y + 2.5, l.heading, { size: FONT.label, weight: "bold", cls: "label" }));
      return;
    }
    const r = l.row;
    const d = display.get(r)!;
    const [d0, d1] = axis.domain;
    const truncLo = r.lo.value <= d0, truncHi = r.hi.value >= d1;
    const xa = scale.map(Math.max(r.lo.value, d0)), xb = scale.map(Math.min(r.hi.value, d1));
    const kids = [
      canvas.text(8, y + 2.5, r.label, { size: FONT.label, cls: "label" }),
      line(xa, y, xb, y, { stroke: NEUTRAL.ink, width: STROKE.mark, cls: "ci" }),
    ];
    if (truncLo) kids.push(truncMarker(xa, y, "left"));
    if (truncHi) kids.push(truncMarker(xb, y, "right"));
    const ex = scale.map(r.est.value);
    kids.push(canvas.bindMark(r.summary ? marker("diamond", ex, y, 3, OKABE_ITO.vermillion, "sb") : marker("square", ex, y, 2.5, OKABE_ITO.blue, "sa"), [{factId:r.est.id,index:null,axis:"x",scale}]));
    kids.push(canvas.text(WIDTH - 8, y + 2.5, d.all, { size: FONT.label, anchor: "end", cls: "value" }));
    canvas.nodes.push(group("row", kids));
    const dagger = d.all.at(-1)?.text === T.dagger ? [stat(T.dagger)] : [];
    altRows.push([...r.label, stat(T.altEstimate), ...d.estimate, stat(T.altInterval), ...d.lower, stat(T.to), ...d.upper, ...dagger, ...(truncLo || truncHi ? [stat(T.altTruncated)] : [])]);
  });

  const axisTitle = log ? [stat(measureName(kind)), stat(T.logScale)] : [stat(measureName(kind))];
  canvas.nodes.push(drawAxis(canvas, { orient: "x", scale, at: axisY, title: axisTitle }));
  const alt: Segment[] = [stat(titleText), stat(T.periodSpace), stat(T.altRowsInOrder)];
  altRows.forEach((segs, i) => alt.push(...segs, stat(i === altRows.length - 1 ? T.periodSpace : T.semicolon)));
  alt.push(stat(T.altNullLine));
  if (log) alt.push(stat(T.altLogAxis));
  alt.push(stat(T.altIntervalsAre), lvl, stat(T.altConfidence));
  const caption = captionSegs(store, ctx, captionSpec, [...captionHead, lvl, stat(T.capForestTail)]);
  return { canvas, height: axisY + 30, title: [stat(titleText)], alt, caption };
}

export function renderForest(spec: ForestSpec, store: FactStore): FigureDraft {
  const ctx = useContext(spec, [spec.claimId]);
  const claim = requireClaim(store, spec.claimId, ctx.where);
  const rows = nonEmptyArray(spec.rows, `${ctx.where} rows`);
  const canvas = new Canvas("forest", spec.id, WIDTH, templateFragments([...rows.map((r) => r.label), spec.caption?.message, spec.caption?.shortLabel]));
  const lines: Line[] = rows.map((r) => ({ row: resolveRow(store, ctx, r, resolveTemplate(r.label, store, ctx), false, canvas) }));
  return intervalPlot(store, ctx, canvas, claim, lines, T.titleForest, [stat(T.capForest)], spec.caption);
}

export function renderMrForest(spec: MrForestSpec, store: FactStore): FigureDraft {
  const ctx = useContext(spec, [spec.claimId]);
  const claim = requireClaim(store, spec.claimId, ctx.where);
  const variants = nonEmptyArray(spec.variants, `${ctx.where} variants`, 500);
  const summaries = nonEmptyArray(spec.summaries, `${ctx.where} summaries`, 4);
  if (new Set(summaries.map((s) => s.method)).size !== summaries.length || summaries.some((s) => !(s.method in METHOD_NAME))) {
    refuse("invalid-spec", `${ctx.where}: summary methods must be distinct known MR methods`);
  }
  const canvas = new Canvas("mr-forest", spec.id, WIDTH, templateFragments([...variants.map((r) => r.label), spec.caption?.message, spec.caption?.shortLabel]));
  const lines: Line[] = [
    { heading: [stat(T.variantHeading)] },
    ...variants.map((r) => ({ row: resolveRow(store, ctx, r, resolveTemplate(r.label, store, ctx), false, canvas) })),
    { heading: [stat(T.summaryHeading)] },
    ...summaries.map((s) => ({ row: resolveRow(store, ctx, s, [stat(METHOD_NAME[s.method])], true, canvas) })),
  ];
  const draft = intervalPlot(store, ctx, canvas, claim, lines, T.titleMrForest, [stat(T.capMrForest)], spec.caption);
  return { ...draft, alt: [draft.alt[0]!, draft.alt[1]!, stat(T.altMrForest), ...draft.alt.slice(2)] };
}
