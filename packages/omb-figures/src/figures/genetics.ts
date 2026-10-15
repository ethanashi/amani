/**
 * Volcano plot (FDR threshold line, top-k labels by adjusted p), MR scatter (variants oriented
 * to a positive exposure effect, IVW line through the origin) and coloc posterior bars.
 */
import { Canvas, FONT, STROKE, drawAxis, group, legendEntry, line, marker, rect, templateFragments, textWidth, truncMarker, type Shape } from "../draw.ts";
import { NEUTRAL, OKABE_ITO, SERIES_COLOURS, SERIES_DASHES } from "../palette.ts";
import { refuse } from "../refusal.ts";
import { UNIT_AXIS, extendLinear, makeScale, niceLinear } from "../scale.ts";
import type { ColocSpec, MrMethod, MrScatterSpec, VolcanoSpec } from "../spec.ts";
import type { FactStore } from "../store.ts";
import { T, TEMPLATE_CONSTANTS } from "../templates.ts";
import { stat, type Segment } from "../text.ts";
import { SERIES_LETTERS, captionSegs, joinSegs, nonEmptyArray, requireClaim, sameLength, scalarSegs, unitSeg, useContext, type FigureDraft } from "./common.ts";

/** Labelled points in a volcano plot: the top k by adjusted p (template setting). */
export const VOLCANO_LABEL_K = 8;

const constant = (key: keyof typeof TEMPLATE_CONSTANTS): Segment => ({ kind: "bound", text: TEMPLATE_CONSTANTS[key], source: { type: "constant", id: key, sourceRecordId: null, grade: null } });

export function renderVolcano(spec: VolcanoSpec, store: FactStore): FigureDraft {
  const ctx = useContext(spec, [spec.claimId]);
  requireClaim(store, spec.claimId, ctx.where);
  const canvas = new Canvas("volcano", spec.id, 360, templateFragments([spec.caption?.message, spec.caption?.shortLabel]));
  const est = canvas.useSeries(store.series(spec.estimate, ctx, ["effect", "difference", "beta"]), "estimate");
  const p = canvas.useSeries(store.series(spec.pAdjusted, ctx, ["p"]), "p-adjusted");
  const n = sameLength(ctx.where, est, p);
  const features = store.entity(spec.features, ctx.where);
  if (features.texts.length !== n) refuse("inconsistent-data", `${ctx.where}: feature names do not align with the series`);
  const threshold = canvas.useFact(store.fact(spec.threshold, ctx, ["threshold", "p"]), "fdr-threshold");
  if (!(threshold.value > 0 && threshold.value < 1)) refuse("inconsistent-data", `${ctx.where}: threshold must lie in (0, 1)`);
  const family = canvas.useFact(store.fact(spec.familySize, ctx, ["count"]), "family-size");
  if (family.value !== n) refuse("inconsistent-data", `${ctx.where}: family size ${family.value} differs from the ${n} plotted features`);

  const ys = p.values.map((v) => -Math.log10(v));
  const thrY = -Math.log10(threshold.value);
  const m = Math.max(...est.values.map(Math.abs)) || 1;
  const xr = niceLinear(-m, m);
  const D = Math.max(Math.abs(xr.domain[0]), Math.abs(xr.domain[1]));
  const xAxis = niceLinear(-D, D);
  const yAxis = niceLinear(0, Math.max(...ys, thrY));
  const x0 = 46, x1 = 340, yTop = 12, yBottom = 210;
  const sx = makeScale("linear", xAxis.domain, [x0, x1], xAxis.ticks);
  const sy = makeScale("linear", yAxis.domain, [yBottom, yTop], yAxis.ticks);
  canvas.nodes.push(line(sx.map(0), yTop, sx.map(0), yBottom, { stroke: NEUTRAL.grey, width: STROKE.thin, dash: "2 2", cls: "null-line" }));
  canvas.nodes.push(line(x0, sy.map(thrY), x1, sy.map(thrY), { stroke: NEUTRAL.grey, width: STROKE.ref, dash: "4 2", cls: "ref-threshold" }));
  canvas.nodes.push(canvas.text(x1, sy.map(thrY) - 3, [stat(T.fdrThreshold)], { size: FONT.note, anchor: "end", cls: "annotation" }));

  const cat = (k: number): "up" | "down" | "ns" => (p.values[k]! <= threshold.value && est.values[k]! !== 0 ? (est.values[k]! > 0 ? "up" : "down") : "ns");
  const style: Record<"up" | "down" | "ns", { shape: Shape; fill: string; cls: string }> = {
    ns: { shape: "circle", fill: NEUTRAL.grey, cls: "sc" }, up: { shape: "up", fill: OKABE_ITO.vermillion, cls: "sa" }, down: { shape: "down", fill: OKABE_ITO.blue, cls: "sb" },
  };
  const points = [];
  for (const which of ["ns", "down", "up"] as const) {
    for (let k = 0; k < n; k++) if (cat(k) === which) points.push(canvas.bindMark(marker(style[which].shape, sx.map(est.values[k]!), sy.map(ys[k]!), 2, style[which].fill, style[which].cls), [{factId:est.id,index:k,axis:"x",scale:sx},{factId:p.id,index:k,axis:"y",scale:sy,transform:"negative-log10"}]));
  }
  canvas.nodes.push(group("points", points));

  const order = [...Array(n).keys()].sort((a, b) => p.values[a]! - p.values[b]! || a - b).slice(0, VOLCANO_LABEL_K);
  const nameSeg = (k: number): Segment => ({ kind: "bound", text: features.texts[k]!, source: { type: "entity", id: `${features.id}#${k}`, sourceRecordId: features.sourceRecordId, grade: null } });
  // Deterministic label placement: nearest free slot (vertical steps, right side first), leader line when moved.
  const placed: [number, number, number, number][] = [];
  const labels = order.flatMap((k) => {
    const px = sx.map(est.values[k]!), py = sy.map(ys[k]!);
    const w = textWidth(features.texts[k]!, FONT.note), h = 7;
    let choice: { x: number; y: number; right: boolean; box: [number, number, number, number] } | null = null;
    for (const dy of [0, -9, 9, -18, 18, -27, 27, -36, 36]) {
      for (const right of [true, false]) {
        const x = right ? px + 4 : px - 4, y = py - 2 + dy;
        const box: [number, number, number, number] = right ? [x, y - h, x + w, y + 2] : [x - w, y - h, x, y + 2];
        const inside = box[0] >= x0 && box[2] <= x1 && box[1] >= yTop && box[3] <= yBottom;
        const free = placed.every((b) => box[2]+3 < b[0] || box[0]-3 > b[2] || box[3]+2 < b[1] || box[1]-2 > b[3]);
        if (inside && free) { choice = { x, y, right, box }; break; }
      }
      if (choice) break;
    }
    if (!choice) { const right = px + 4 + w < x1; const x = right ? px + 4 : px - 4; choice = { x, y: py - 2, right, box: right ? [x, py - 9, x + w, py] : [x - w, py - 9, x, py] }; }
    placed.push(choice.box);
    const nodes = [];
    if (choice.y !== py - 2) nodes.push(line(px, py, choice.x, choice.y - 2.5, { stroke: NEUTRAL.grey, width: STROKE.thin, cls: "leader" }));
    nodes.push(canvas.text(choice.x, choice.y, [nameSeg(k)], { size: FONT.note, anchor: choice.right ? "start" : "end", cls: "label" }));
    return nodes;
  });
  canvas.nodes.push(group("labels", labels));

  const unit = unitSeg(est);
  canvas.nodes.push(drawAxis(canvas, { orient: "x", scale: sx, at: yBottom, title: unit ? [stat(T.volcanoX), stat(T.openParen), unit, stat(T.closeParen)] : [stat(T.volcanoX)] }));
  canvas.nodes.push(drawAxis(canvas, { orient: "y", scale: sy, at: x0, title: [constant("volcanoY")] }));
  const legendTop = yBottom + 38;
  const entries: [Segment[], "up" | "down" | "ns"][] = [[[stat(T.volcanoUp)], "up"], [[stat(T.volcanoDown)], "down"], [[stat(T.volcanoNs)], "ns"]];
  entries.forEach(([segs, which], i) => canvas.nodes.push(legendEntry(canvas, x0, legendTop + i * 11, { shape: { shape: style[which].shape, fill: style[which].fill } }, segs)));
  const alt: Segment[] = [
    stat(T.titleVolcano), stat(T.periodSpace), stat(T.altVolcano), ...scalarSegs(store, family), stat(T.altVolcanoFeatures),
    ...scalarSegs(store, threshold), stat(T.altVolcanoLabelled), ...joinSegs(order.map((k) => [nameSeg(k)]), T.comma), stat(T.period),
  ];
  return { canvas, height: legendTop + entries.length * 11, title: [stat(T.titleVolcano)], alt, caption: captionSegs(store, ctx, spec.caption, [stat(T.capVolcano)]) };
}

const METHOD: Record<MrMethod, { name: string; cls: string }> = {
  ivw: { name: T.mrIvw, cls: "fit-ivw" }, egger: { name: T.mrEgger, cls: "fit-egger" },
  "weighted-median": { name: T.mrWeightedMedian, cls: "fit-wm" }, "weighted-mode": { name: T.mrWeightedMode, cls: "fit-wmode" },
};

/** Clips the line y = a + b x over [xa, xb] to the band [ylo, yhi]; null when it misses the band. */
function clipFit(a: number, b: number, xa: number, xb: number, ylo: number, yhi: number): [number, number, number, number] | null {
  let lo = xa, hi = xb;
  if (b === 0) { if (a < ylo || a > yhi) return null; }
  else {
    const xs = [(ylo - a) / b, (yhi - a) / b].sort((u, v) => u - v);
    lo = Math.max(lo, xs[0]!); hi = Math.min(hi, xs[1]!);
    if (hi <= lo) return null;
  }
  return [lo, a + b * lo, hi, a + b * hi];
}

export function renderMrScatter(spec: MrScatterSpec, store: FactStore): FigureDraft {
  const ctx = useContext(spec, [spec.claimId]);
  requireClaim(store, spec.claimId, ctx.where);
  const canvas = new Canvas("mr-scatter", spec.id, 320, templateFragments([spec.caption?.message, spec.caption?.shortLabel]));
  const bx0 = canvas.useSeries(store.series(spec.betaExposure, ctx, ["beta", "effect"]), "beta-exposure");
  const sx0 = canvas.useSeries(store.series(spec.seExposure, ctx, ["se"]), "se-exposure");
  const by0 = canvas.useSeries(store.series(spec.betaOutcome, ctx, ["beta", "effect"]), "beta-outcome");
  const sy0 = canvas.useSeries(store.series(spec.seOutcome, ctx, ["se"]), "se-outcome");
  const n = sameLength(ctx.where, bx0, sx0, by0, sy0);
  const keep = spec.mrKeep === undefined ? null : canvas.useSeries(store.series(spec.mrKeep, ctx, ["count"]), "mr-keep");
  if(keep && (sameLength(ctx.where,bx0,keep)!==n || keep.values.some(v=>v!==0&&v!==1))) refuse("inconsistent-data", "mr_keep must align and contain only zero or one");
  if ([...sx0.values, ...sy0.values].some((v) => v <= 0)) refuse("inconsistent-data", `${ctx.where}: standard errors must be positive`);
  const fitsSpec = nonEmptyArray(spec.fits, `${ctx.where} fits`, 4);
  if (new Set(fitsSpec.map((f) => f.method)).size !== fitsSpec.length || fitsSpec.some((f) => !(f.method in METHOD))) refuse("invalid-spec", `${ctx.where}: fit methods must be distinct known methods`);
  if (!fitsSpec.some((f) => f.method === "ivw")) refuse("invalid-spec", `${ctx.where}: the inverse-variance weighted fit is required`);
  const fits = fitsSpec.map((f) => {
    if ((f.method === "egger") !== (f.intercept !== undefined)) refuse("invalid-spec", `${ctx.where}: only MR-Egger has an intercept, and it needs one`);
    return {
      method: f.method,
      slope: canvas.useFact(store.fact(f.slope, ctx, ["slope", "beta", "effect"]), `slope-${f.method}`),
      intercept: f.intercept === undefined ? null : canvas.useFact(store.fact(f.intercept, ctx, ["intercept"]), "intercept-egger"),
    };
  });
  // Orientation: each variant is flipped so its effect on the exposure is positive.
  const flip = bx0.values.map((v) => (v < 0 ? -1 : 1));
  const bx = bx0.values.map((v, k) => v * flip[k]!), by = by0.values.map((v, k) => v * flip[k]!);
  const se = { x: sx0.values, y: sy0.values };
  let xAxis = niceLinear(0, Math.max(...bx.map((v, k) => v + se.x[k]!)));
  if (bx.some((v, k) => v + se.x[k]! === xAxis.domain[1])) xAxis = extendLinear(xAxis, "hi");
  let yAxis = niceLinear(Math.min(0, ...by.map((v, k) => v - se.y[k]!)), Math.max(0, ...by.map((v, k) => v + se.y[k]!)));
  if (by.some((v, k) => v - se.y[k]! === yAxis.domain[0])) yAxis = extendLinear(yAxis, "lo");
  if (by.some((v, k) => v + se.y[k]! === yAxis.domain[1])) yAxis = extendLinear(yAxis, "hi");
  const x0 = 50, x1 = 306, yTop = 12, yBottom = 200;
  const sx = makeScale("linear", xAxis.domain, [x0, x1], xAxis.ticks);
  const sy = makeScale("linear", yAxis.domain, [yBottom, yTop], yAxis.ticks);
  canvas.nodes.push(line(x0, sy.map(0), x1, sy.map(0), { stroke: NEUTRAL.grey, width: STROKE.ref, dash: "3 2", cls: "null-line" }));
  for (let k = 0; k < n; k++) {
    const px = sx.map(bx[k]!), py = sy.map(by[k]!);
    const leftV = bx[k]! - se.x[k]!;
    const truncLeft = leftV <= xAxis.domain[0];
    const kids = [
      line(sx.map(Math.max(leftV, xAxis.domain[0])), py, sx.map(bx[k]! + se.x[k]!), py, { stroke: NEUTRAL.grey, width: STROKE.thin, cls: "ci" }),
      line(px, sy.map(by[k]! - se.y[k]!), px, sy.map(by[k]! + se.y[k]!), { stroke: NEUTRAL.grey, width: STROKE.thin, cls: "ci" }),
    ];
    if (truncLeft) kids.push(truncMarker(sx.map(xAxis.domain[0]), py, "left"));
    kids.push(canvas.bindMark(marker(keep?.values[k]===0?"square":"circle", px, py, 2.2, NEUTRAL.ink, keep?.values[k]===0?"mr-excluded":""), [{factId:bx0.id,index:k,axis:"x",scale:sx,transform:"absolute"},{factId:by0.id,index:k,axis:"y",scale:sy,transform:flip[k]===-1?"negate":"identity"}]));
    canvas.nodes.push(group("row", kids));
  }
  if(keep?.values.includes(0)) canvas.nodes.push(canvas.text(50,10,[stat(T.mrExcluded)],{size:6.5}));
  const legend: Segment[][] = [];
  fits.forEach((f, i) => {
    const a = f.intercept?.value ?? 0;
    const seg = clipFit(a, f.slope.value, xAxis.domain[0], xAxis.domain[1], yAxis.domain[0], yAxis.domain[1]);
    if (seg) canvas.nodes.push(line(sx.map(seg[0]), sy.map(seg[1]), sx.map(seg[2]), sy.map(seg[3]), { stroke: SERIES_COLOURS[i]!, dash: SERIES_DASHES[i]!, width: 1.3, cls: `mark series-line ${METHOD[f.method].cls} ${SERIES_LETTERS[i]}` }));
    legend.push([stat(METHOD[f.method].name), stat(T.slopeLabel), ...scalarSegs(store, f.slope), ...(f.intercept ? [stat(T.calIntercept), ...scalarSegs(store, f.intercept)] : [])]);
  });
  canvas.nodes.push(drawAxis(canvas, { orient: "x", scale: sx, at: yBottom, title: [stat(T.mrsX)] }));
  canvas.nodes.push(drawAxis(canvas, { orient: "y", scale: sy, at: x0, title: [stat(T.mrsY)], titleGap: 34 }));
  const legendTop = yBottom + 38;
  legend.forEach((segs, i) => canvas.nodes.push(legendEntry(canvas, x0, legendTop + i * 11, { line: { stroke: SERIES_COLOURS[i]!, dash: SERIES_DASHES[i]! } }, segs)));
  const alt = [stat(T.titleMrScatter), stat(T.periodSpace), stat(T.altMrScatter), ...joinSegs(legend, T.semicolon), stat(T.period)];
  return { canvas, height: legendTop + legend.length * 11, title: [stat(T.titleMrScatter)], alt, caption: captionSegs(store, ctx, spec.caption, [stat(T.capMrScatter)]) };
}

const HYPOTHESES = [T.colocH0, T.colocH1, T.colocH2, T.colocH3, T.colocH4] as const;

export function renderColoc(spec: ColocSpec, store: FactStore): FigureDraft {
  const ctx = useContext(spec, [spec.claimId]);
  requireClaim(store, spec.claimId, ctx.where);
  if (!Array.isArray(spec.posteriors) || spec.posteriors.length !== 5) refuse("invalid-spec", `${ctx.where}: five posterior probabilities (H0 to H4) are required`);
  const canvas = new Canvas("coloc", spec.id, 300, templateFragments([spec.caption?.message, spec.caption?.shortLabel]));
  const pp = spec.posteriors.map((id, h) => canvas.useFact(store.fact(id, ctx, ["posterior"]), `pp-h${"abcde"[h]}`));
  const sum = pp.reduce((s, f) => s + f.value, 0);
  if (Math.abs(sum - 1) > 1e-3) refuse("inconsistent-data", `${ctx.where}: posterior probabilities sum to ${sum}, not 1`);
  const threshold = canvas.useFact(store.fact(spec.threshold, ctx, ["threshold", "probability"]), "decision-threshold");
  if (!(threshold.value > 0 && threshold.value < 1)) refuse("inconsistent-data", `${ctx.where}: threshold must lie in (0, 1)`);
  const labelW = Math.max(...HYPOTHESES.map((h) => textWidth(h, FONT.label)));
  const x0 = 8 + labelW + 8, x1 = 300 - 34, top = 22, rowH = 15;
  const sx = makeScale("linear", UNIT_AXIS.domain, [x0, x1], UNIT_AXIS.ticks);
  const axisY = top + 5 * rowH + 2;
  const values = pp.map((f) => scalarSegs(store, f));
  pp.forEach((f, h) => {
    const y = top + h * rowH;
    const colour = h === 4 ? OKABE_ITO.orange : OKABE_ITO.blue;
    canvas.nodes.push(group("row", [
      canvas.text(8, y + rowH / 2 + 2.5, [stat(HYPOTHESES[h]!)], { size: FONT.label, cls: "label" }),
      rect(x0, y + 3, Math.max(0, sx.map(f.value) - x0), rowH - 6, { fill: colour, cls: `mark bar ${h === 4 ? "sb" : "sa"}` }),
      canvas.text(sx.map(f.value) + 3, y + rowH / 2 + 2.5, values[h]!, { size: FONT.label, cls: "value" }),
    ]));
  });
  const tx = sx.map(threshold.value);
  canvas.nodes.push(line(tx, top - 2, tx, axisY, { stroke: NEUTRAL.ink, width: STROKE.ref, dash: "3 2", cls: "ref-threshold" }));
  canvas.nodes.push(canvas.text(tx, top - 6, [stat(T.decisionThreshold)], { size: FONT.note, anchor: "middle", cls: "annotation" }));
  canvas.nodes.push(drawAxis(canvas, { orient: "x", scale: sx, at: axisY, title: [stat(T.colocX)] }));
  const alt = [
    stat(T.titleColoc), stat(T.periodSpace), stat(T.altColoc),
    ...joinSegs(pp.map((_, h) => [stat(HYPOTHESES[h]!), stat(T.colon), ...values[h]!]), T.semicolon), stat(T.periodSpace),
    stat(T.altColocThreshold), ...scalarSegs(store, threshold), stat(T.period),
  ];
  return { canvas, height: axisY + 30, title: [stat(T.titleColoc)], alt, caption: captionSegs(store, ctx, spec.caption, [stat(T.capColoc)]) };
}
