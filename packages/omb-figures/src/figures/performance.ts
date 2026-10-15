/**
 * ROC curve (chance diagonal), calibration plot (identity diagonal) and decision curve
 * (treat-all and treat-none references). Axes for probabilities are fixed at 0 to 1.
 */
import { Canvas, FONT, STROKE, clipPolyline, drawAxis, group, legendEntry, line, marker, polyline, truncMarker, templateFragments } from "../draw.ts";
import { coord } from "../format.ts";
import { NEUTRAL, OKABE_ITO, SERIES_COLOURS, SERIES_DASHES } from "../palette.ts";
import type { CertifiedFact, CertifiedSeries } from "../port.ts";
import { refuse } from "../refusal.ts";
import { UNIT_AXIS, extendLinear, makeScale, niceLinear } from "../scale.ts";
import type { CalibrationSpec, DecisionCurveSpec, RocSpec } from "../spec.ts";
import type { FactStore } from "../store.ts";
import { T } from "../templates.ts";
import { resolveTemplate, stat, type Segment } from "../text.ts";
import { el } from "../xml.ts";
import {
  SERIES_LETTERS, captionSegs, joinSegs, nonDecreasing, nonEmptyArray, requireClaim, sameLength, scalarSegs, trimTrailing, useContext, type FigureDraft,
} from "./common.ts";

const PROB: ["probability", "proportion"] = ["probability", "proportion"];
const inUnit = (s: CertifiedSeries) => s.values.every((v) => v >= 0 && v <= 1);

export function renderRoc(spec: RocSpec, store: FactStore): FigureDraft {
  const ctx = useContext(spec, [spec.claimId]);
  requireClaim(store, spec.claimId, ctx.where);
  const series = nonEmptyArray(spec.series, `${ctx.where} series`, 4);
  const canvas = new Canvas("roc", spec.id, 252, templateFragments([...series.map((s) => s.label), spec.caption?.message, spec.caption?.shortLabel]));
  const x0 = 46, x1 = 226, yTop = 10, yBottom = 190;
  const sx = makeScale("linear", UNIT_AXIS.domain, [x0, x1], UNIT_AXIS.ticks);
  const sy = makeScale("linear", UNIT_AXIS.domain, [yBottom, yTop], UNIT_AXIS.ticks);
  canvas.nodes.push(line(x0, yBottom, x1, yTop, { stroke: NEUTRAL.grey, width: STROKE.ref, dash: "3 2", cls: "ref-chance" }));
  const legend: Segment[][] = [];
  const altParts: Segment[][] = [];
  series.forEach((s, i) => {
    const fpr = canvas.useSeries(store.series(s.fpr, ctx, PROB), "fpr");
    const tpr = canvas.useSeries(store.series(s.tpr, ctx, PROB), "tpr");
    const n = sameLength(ctx.where, fpr, tpr);
    if (n < 2 || !inUnit(fpr) || !inUnit(tpr) || !nonDecreasing(fpr.values) || !nonDecreasing(tpr.values)) {
      refuse("inconsistent-data", `${ctx.where}: ROC points must be non-decreasing rates in [0, 1]`);
    }
    const auc = canvas.useFact(store.fact(s.auc, ctx, ["auc"]), "auc");
    const colour = SERIES_COLOURS[i]!, dash = SERIES_DASHES[i]!, letter = SERIES_LETTERS[i]!;
    const hasBand = s.bandLower !== undefined || s.bandUpper !== undefined;
    if (hasBand) {
      if (s.bandLower === undefined || s.bandUpper === undefined) refuse("invalid-spec", `${ctx.where}: a band needs both bounds`);
      const lo = canvas.useSeries(store.series(s.bandLower, ctx, PROB), "band-lower");
      const hi = canvas.useSeries(store.series(s.bandUpper, ctx, PROB), "band-upper");
      sameLength(ctx.where, fpr, lo, hi);
      if (!inUnit(lo) || !inUnit(hi) || lo.values.some((v, k) => v > hi.values[k]!)) refuse("inconsistent-data", `${ctx.where}: band bounds out of order`);
      const pts = [...fpr.values.map((f, k) => `${coord(sx.map(f))},${coord(sy.map(hi.values[k]!))}`), ...fpr.values.map((f, k) => `${coord(sx.map(f))},${coord(sy.map(lo.values[k]!))}`).reverse()];
      canvas.nodes.push(el("polygon", [["class", `band ${letter}`], ["points", pts.join(" ")], ["fill", colour], ["fill-opacity", "0.15"], ["stroke", "none"]]));
    }
    canvas.nodes.push(canvas.bindMark(polyline(fpr.values.map((f, k) => [sx.map(f), sy.map(tpr.values[k]!)] as const), { stroke: colour, dash, width: 1.4, cls: `mark series-line ${letter}` }), fpr.values.flatMap((_,k) => [{factId:fpr.id,index:k,axis:"x" as const,scale:sx,vertex:k},{factId:tpr.id,index:k,axis:"y" as const,scale:sy,vertex:k}])));
    const label = resolveTemplate(s.label, store, ctx);
    const aucSegs = scalarSegs(store, auc);
    legend.push([...label, stat(T.aucOpen), ...aucSegs, stat(T.closeParen)]);
    altParts.push([...label, ...(hasBand ? [stat(T.altBand)] : []), stat(T.aucOpen), ...aucSegs, stat(T.closeParen)]);
  });
  canvas.nodes.push(drawAxis(canvas, { orient: "x", scale: sx, at: yBottom, title: [stat(T.rocX)] }));
  canvas.nodes.push(drawAxis(canvas, { orient: "y", scale: sy, at: x0, title: [stat(T.rocY)] }));
  const legendTop = yBottom + 38;
  legend.forEach((segs, i) => canvas.nodes.push(legendEntry(canvas, x0, legendTop + i * 11, { line: { stroke: SERIES_COLOURS[i]!, dash: SERIES_DASHES[i]! } }, segs)));
  const alt = [stat(T.titleRoc), stat(T.periodSpace), stat(T.altRocSeries), ...joinSegs(altParts, T.semicolon), stat(T.periodSpace), stat(T.altChance.trimEnd())];
  return { canvas, height: legendTop + legend.length * 11, title: [stat(T.titleRoc)], alt, caption: captionSegs(store, ctx, spec.caption, [stat(T.capRoc)]) };
}

export function renderCalibration(spec: CalibrationSpec, store: FactStore): FigureDraft {
  const ctx = useContext(spec, [spec.claimId]);
  requireClaim(store, spec.claimId, ctx.where);
  const canvas = new Canvas("calibration", spec.id, 252, templateFragments([spec.caption?.message, spec.caption?.shortLabel]));
  const predicted = canvas.useSeries(store.series(spec.predicted, ctx, PROB), "predicted");
  const observed = canvas.useSeries(store.series(spec.observed, ctx, PROB), "observed");
  const n = sameLength(ctx.where, predicted, observed);
  if (!inUnit(predicted) || !inUnit(observed) || !nonDecreasing(predicted.values)) refuse("inconsistent-data", `${ctx.where}: calibration bins must be ordered probabilities`);
  let lower: CertifiedSeries | null = null, upper: CertifiedSeries | null = null;
  if (spec.lower !== undefined || spec.upper !== undefined) {
    if (spec.lower === undefined || spec.upper === undefined) refuse("invalid-spec", `${ctx.where}: interval needs both bounds`);
    lower = canvas.useSeries(store.series(spec.lower, ctx, PROB), "ci-lower");
    upper = canvas.useSeries(store.series(spec.upper, ctx, PROB), "ci-upper");
    sameLength(ctx.where, observed, lower, upper);
    if (observed.values.some((v, k) => !(lower!.values[k]! <= v && v <= upper!.values[k]!))) refuse("inconsistent-data", `${ctx.where}: bin intervals must contain the observed proportion`);
  }
  const slope = canvas.useFact(store.fact(spec.slope, ctx, ["slope"]), "slope");
  const intercept = canvas.useFact(store.fact(spec.intercept, ctx, ["intercept"]), "intercept");
  const x0 = 46, x1 = 226, yTop = 10, yBottom = 190;
  const sx = makeScale("linear", UNIT_AXIS.domain, [x0, x1], UNIT_AXIS.ticks);
  const sy = makeScale("linear", UNIT_AXIS.domain, [yBottom, yTop], UNIT_AXIS.ticks);
  canvas.nodes.push(line(x0, yBottom, x1, yTop, { stroke: NEUTRAL.grey, width: STROKE.ref, dash: "3 2", cls: "ref-identity" }));
  for (let k = 0; k < n; k++) {
    const px = sx.map(predicted.values[k]!), py = sy.map(observed.values[k]!);
    const kids = [];
    if (lower && upper) kids.push(line(px, sy.map(lower.values[k]!), px, sy.map(upper.values[k]!), { width: STROKE.mark, cls: "ci" }));
    kids.push(canvas.bindMark(marker("circle", px, py, 2.4, OKABE_ITO.blue, "sa"), [{factId:predicted.id,index:k,axis:"x",scale:sx},{factId:observed.id,index:k,axis:"y",scale:sy}]));
    canvas.nodes.push(group("row", kids));
  }
  const note = [stat(T.calSlope), ...scalarSegs(store, slope), stat(T.calIntercept), ...scalarSegs(store, intercept)];
  canvas.nodes.push(canvas.text(x0 + 6, yTop + 10, note, { size: FONT.label, cls: "annotation" }));
  canvas.nodes.push(drawAxis(canvas, { orient: "x", scale: sx, at: yBottom, title: [stat(T.calX)] }));
  canvas.nodes.push(drawAxis(canvas, { orient: "y", scale: sy, at: x0, title: [stat(T.calY)] }));
  const alt = [stat(T.titleCalibration), stat(T.periodSpace), stat(T.altCalibration), ...note, stat(T.periodSpace), stat(T.altIdentity.trimEnd())];
  return { canvas, height: yBottom + 32, title: [stat(T.titleCalibration)], alt, caption: captionSegs(store, ctx, spec.caption, [stat(T.capCalibration)]) };
}

export function renderDecisionCurve(spec: DecisionCurveSpec, store: FactStore): FigureDraft {
  const ctx = useContext(spec, [spec.claimId]);
  requireClaim(store, spec.claimId, ctx.where);
  const canvas = new Canvas("decision-curve", spec.id, 252, templateFragments([spec.modelLabel, spec.caption?.message, spec.caption?.shortLabel]));
  const thresholds = canvas.useSeries(store.series(spec.thresholds, ctx, ["threshold", "probability"]), "threshold");
  const model = canvas.useSeries(store.series(spec.netBenefit, ctx, ["net-benefit"]), "net-benefit-model");
  const all = canvas.useSeries(store.series(spec.treatAll, ctx, ["net-benefit"]), "net-benefit-treat-all");
  const n = sameLength(ctx.where, thresholds, model, all);
  if (n < 2 || thresholds.values.some((t, k) => t < 0 || t >= 1 || (k > 0 && t <= thresholds.values[k - 1]!))) {
    refuse("inconsistent-data", `${ctx.where}: thresholds must be strictly increasing probabilities in [0, 1)`);
  }
  const locked: CertifiedFact[] = (spec.lockedThresholds ?? []).map((id) => canvas.useFact(store.fact(id, ctx, ["threshold", "probability"]), "locked-threshold"));
  const xAxis = niceLinear(Math.min(...thresholds.values), Math.max(...thresholds.values));
  if (xAxis.domain[0] < 0) refuse("inconsistent-data", `${ctx.where}: threshold axis would start below zero`);
  if (locked.some((f) => f.value < xAxis.domain[0] || f.value > xAxis.domain[1])) refuse("inconsistent-data", `${ctx.where}: locked threshold outside the plotted range`);
  const hi = Math.max(0, ...model.values, ...all.values);
  const top = hi > 0 ? hi : 0.05;
  // Preserve every model value; clip the potentially unbounded negative reference with explicit markers.
  const allPeak = Math.max(...all.values);
  const lo = Math.min(-0.25 * top, ...model.values, allPeak);
  let yAxis = niceLinear(lo, top);
  if (yAxis.domain[0] >= allPeak) yAxis = extendLinear(yAxis, "lo");
  const x0 = 46, x1 = 226, yTop = 10, yBottom = 170;
  const sx = makeScale("linear", xAxis.domain, [x0, x1], xAxis.ticks);
  const sy = makeScale("linear", yAxis.domain, [yBottom, yTop], yAxis.ticks);
  const pts = (s: CertifiedSeries) => thresholds.values.map((t, k) => [sx.map(t), sy.map(s.values[k]!)] as const);
  canvas.nodes.push(line(x0, sy.map(0), x1, sy.map(0), { stroke: NEUTRAL.ink, width: STROKE.ref, cls: "ref-treat-none" }));
  const truncated = all.values.some(v => v < yAxis.domain[0]);
  const runs = clipPolyline(pts(all), yTop, yBottom);
  if (!runs.length) refuse("inconsistent-data", `${ctx.where}: treat-all reference outside the visible range`);
  for (const run of runs) {
    canvas.nodes.push(polyline(run, { stroke: NEUTRAL.grey, width: 1.2, dash: "5 3", cls: "ref-treat-all" }));
    if (truncated) for (const point of [run[0]!, run[run.length - 1]!]) {
      if (Math.abs(point[1] - yBottom) < 1e-9) canvas.nodes.push(truncMarker(point[0], yBottom, "down"));
    }
  }
  canvas.nodes.push(polyline(pts(model), { stroke: OKABE_ITO.blue, width: 1.4, cls: "mark series-line sa" }));
  for (const f of locked) canvas.nodes.push(line(sx.map(f.value), yTop, sx.map(f.value), yBottom, { stroke: NEUTRAL.grey, width: STROKE.ref, dash: "1 2", cls: "ref-locked" }));
  canvas.nodes.push(drawAxis(canvas, { orient: "x", scale: sx, at: yBottom, title: [stat(T.dcX)] }));
  canvas.nodes.push(drawAxis(canvas, { orient: "y", scale: sy, at: x0, title: [stat(T.dcY)] }));
  const modelLabel = resolveTemplate(spec.modelLabel, store, ctx);
  const legendTop = yBottom + 38;
  const entries: [Segment[], { stroke: string; dash: string }][] = [
    [modelLabel, { stroke: OKABE_ITO.blue, dash: "" }], [[stat(T.treatAll)], { stroke: NEUTRAL.grey, dash: "5 3" }], [[stat(T.treatNone)], { stroke: NEUTRAL.ink, dash: "" }],
  ];
  if (locked.length) entries.push([[stat(T.lockedThreshold)], { stroke: NEUTRAL.grey, dash: "1 2" }]);
  entries.forEach(([segs, key], i) => canvas.nodes.push(legendEntry(canvas, x0, legendTop + i * 11, { line: key }, segs)));
  const alt: Segment[] = [stat(T.titleDecision), stat(T.periodSpace), stat(T.altDecision)];
  if (truncated) alt.push(stat(T.dcTruncation));
  if (locked.length) alt.push(stat(T.altLocked), ...joinSegs(locked.map((f) => scalarSegs(store, f)), T.comma), stat(T.period));
  return { canvas, height: legendTop + entries.length * 11, title: [stat(T.titleDecision)], alt: trimTrailing(alt), caption: captionSegs(store, ctx, spec.caption, [stat(T.capDecision), ...(truncated ? [stat(T.space), stat(T.dcTruncation)] : [])]) };
}

