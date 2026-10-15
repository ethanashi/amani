import {renderFunnel,renderSurrogacyScatter} from './figures/tierc.ts';
/**
 * renderFigure: spec + verified store -> byte-deterministic SVG, placeholder-bound alt text and
 * caption, binding table, datum provenance and a source-data CSV. The figure is linted and
 * closed-world checked before it is returned; any issue refuses the build.
 */
import { renderKaplanMeier } from "./figures/survival.ts";
import type { NumericMark } from "./roundtrip.ts";
import { lintFigureSpec } from "./spec-lint.ts";
import { figureProvenance, provenanceText, SOURCE_LINE, type FigureProvenance } from "./provenance.ts";
import { el, serialize } from "./xml.ts";
import { createHash } from "node:crypto";
import { VALUE_COLUMNS, dictionaryCsv, toCsv, type CsvColumn, type CsvCell } from "./csv.ts";
import type { BindingTable, Datum } from "./draw.ts";
import type { FigureDraft } from "./figures/common.ts";
import { renderConsort, renderClaimFlow, renderDataFlow } from "./figures/flow.ts";
import { renderForest, renderMrForest } from "./figures/forest.ts";
import { renderColoc, renderMrScatter, renderVolcano } from "./figures/genetics.ts";
import { renderCalibration, renderDecisionCurve, renderRoc } from "./figures/performance.ts";
import { checkFigure } from "./lint.ts";
import { refuse } from "./refusal.ts";
import { FIGURE_KINDS, type FigureKind, type FigureSpec } from "./spec.ts";
import type { FactStore, Placement } from "./store.ts";
import { segmentsTemplate, segmentsText, type Segment } from "./text.ts";

export interface ResolvedText {
  /** Placeholder form: static template text plus [m:], [e:] and [lvl:] placeholders. */
  readonly template: string;
  /** What readers see. */
  readonly text: string;
}

export interface RenderedFigure {
  readonly id: string;
  readonly kind: FigureKind;
  readonly placement: Placement;
  readonly svg: string;
  readonly sha256: string;
  readonly alt: ResolvedText;
  readonly caption: ResolvedText;
  readonly bindings: BindingTable;
  readonly data: readonly Datum[];
  readonly sourceCsv: string;
  readonly provenance: FigureProvenance;
  readonly numericMarks: readonly NumericMark[];
  readonly sourceDictionary: string;
}

type Renderers = { [K in FigureKind]: (spec: Extract<FigureSpec, { kind: K }>, store: FactStore) => FigureDraft };
const RENDERERS: Renderers = {
  funnel:renderFunnel, 'surrogacy-scatter':renderSurrogacyScatter,
  consort: renderConsort, "kaplan-meier": renderKaplanMeier, forest: renderForest, "mr-forest": renderMrForest, roc: renderRoc, calibration: renderCalibration,
  "decision-curve": renderDecisionCurve, volcano: renderVolcano, "mr-scatter": renderMrScatter, coloc: renderColoc,
  "data-flow": renderDataFlow, "claim-flow": renderClaimFlow,
};

export const SOURCE_COLUMNS: readonly CsvColumn[] = [
  { name: "role", type: "string", unit: "", source: "template: what the value encodes in the figure" },
  { name: "record_type", type: "string", unit: "", source: "fact, series, entity or claim" },
  { name: "index", type: "integer", unit: "", source: "position within a series record (empty for facts)" },
  ...VALUE_COLUMNS.filter((c) => c.name !== "display" && c.name !== "statistic"),
  {name:"text",type:"string",unit:"",source:"certified entity text or claim status"},
  {name:"certificate_hash",type:"string",unit:"",source:"authenticated certificate hash"},
];

const resolved = (segments: readonly Segment[]): ResolvedText => ({ template: segmentsTemplate(segments), text: segmentsText(segments) });

export function renderFigure(spec: FigureSpec, store: FactStore): RenderedFigure {
  const specIssues = lintFigureSpec(spec);
  if (specIssues.length) refuse(specIssues.some(i => i.startsWith("template:")) ? "template-lint" : "invalid-spec", "figure spec lint failed", specIssues);
  if (!spec || typeof spec !== "object") refuse("invalid-spec", "figure spec must be an object");
  if (!FIGURE_KINDS.includes(spec.kind)) refuse("invalid-spec", `unknown figure kind ${String((spec as { kind?: unknown }).kind)}`);
  if (typeof spec.id !== "string" || !/^[a-z][a-z0-9-]{0,63}$/u.test(spec.id)) refuse("invalid-spec", "figure id must be a short lowercase slug");
  if (spec.placement !== "results" && spec.placement !== "supplement") refuse("invalid-spec", `figure ${spec.id}: unknown placement`);
  if (!spec.caption || typeof spec.caption.message !== "string") refuse("invalid-spec", `figure ${spec.id}: caption message required`);

  const draft = (RENDERERS[spec.kind] as (s: FigureSpec, st: FactStore) => FigureDraft)(spec, store);
  const data = draft.canvas.data;
  const finished = draft.canvas.finish(draft.height, draft.title, draft.alt, [draft.caption]);
  const ctx = {placement:spec.placement,claims:new Set(store.claimIds()),where:'source provenance'};
  const numeric = data.map(d=>d.recordType==='fact'?store.fact(d.id,ctx):store.series(d.id,ctx));
  const entities = [...new Set(finished.bindings.values.flatMap(v=>v.sources.filter(s=>s.type==='entity').map(s=>s.id.split('#')[0]!)))].sort().map(id=>store.entity(id,ctx.where));
  const claimIds=new Set(numeric.flatMap(r=>r.claimId?[r.claimId]:[]));
  if('claimId' in spec) claimIds.add(spec.claimId);
  const claims=[...claimIds].sort().map(id=>store.claim(id,ctx.where));
  const rows:CsvCell[][]=data.map((d,i)=>[d.role,d.recordType,d.index,d.value,d.unit,d.ciLevel,d.grade,d.id,d.sourceRecordId,'',numeric[i]!.certHash]);
  for(const e of entities) e.texts.forEach((text,index)=>rows.push(['entity-label','entity',index,null,null,null,null,e.id,e.sourceRecordId,text,e.certHash]));
  for(const c of claims) rows.push(['claim-context','claim',null,null,null,null,null,c.id,c.sourceRecordId,c.status,c.certHash]);
  const sourceCsv=toCsv(SOURCE_COLUMNS,rows);
  const provenance = figureProvenance(spec, data, sourceCsv, store, [...entities,...claims]);
  const metadata = provenanceText(provenance);
  finished.svg = finished.svg.replace('</svg>', ` ${serialize(el('metadata', [], [metadata]))}\n</svg>`);
  finished.bindings = { ...finished.bindings, values: [...finished.bindings.values, { text: metadata, sources: [] }], vocabulary: [...finished.bindings.vocabulary, SOURCE_LINE] };
  const alt = resolved(draft.alt), originalCaption = resolved(draft.caption);
  const caption = { template: originalCaption.template + ' ' + SOURCE_LINE, text: originalCaption.text + ' ' + SOURCE_LINE };
  const check = checkFigure(finished.svg, finished.bindings, [{ text: alt.text, where: "alt text" }, { text: caption.text, where: "caption" }]);
  const issues = [...check.lint.map((i) => `${i.code}: ${i.detail}`), ...check.closedWorld.map((i) => `${i.code} ${i.where}: ${i.detail}`)];
  if (issues.length) refuse("figure-lint", `figure ${spec.id} fails its own lint`, issues);

  return {
    id: spec.id, kind: spec.kind, placement: spec.placement, svg: finished.svg,
    sha256: createHash("sha256").update(finished.svg).digest("hex"),
    alt, caption, provenance, numericMarks: draft.canvas.numericMarks, bindings: finished.bindings, data, sourceCsv, sourceDictionary: dictionaryCsv(SOURCE_COLUMNS),
  };
}
