/**
 * Tables: Table 1 (population characteristics with missingness), claim results and comparison
 * with previous studies. Each emits Markdown (display rounding), a tidy CSV at full precision with
 * provenance per cell, and a data dictionary. Every Markdown cell passes the closed-world check.
 */
import { canonicalSha256 } from "../../bio-core/src/index.ts";
import { createHash } from "node:crypto";
import { checkTextClosedWorld, type ClosedWorldIssue } from "./closed-world.ts";
import { VALUE_COLUMNS, dictionaryCsv, toCsv, type CsvCell, type CsvColumn } from "./csv.ts";
import { Collector, templateFragments, type BindingTable, type Datum } from "./draw.ts";
import { ESTIMATE_KINDS, intervalSegs, measureName, nonEmptyArray, scalarSegs } from "./figures/common.ts";
import type { CertifiedFact, ClaimStatus } from "./port.ts";
import { refuse } from "./refusal.ts";
import type { ClaimResultsTableSpec, ComparisonTableSpec, IntervalRef, PopulationTableSpec, TableSpec, UnverifiedNumbersTableSpec } from "./spec.ts";
import type { FactStore, UseContext } from "./store.ts";
import { T } from "./templates.ts";
import { resolveTemplate, segmentsText, stat, type Segment } from "./text.ts";

export interface RenderedTable {
  readonly id: string;
  readonly kind: TableSpec["kind"];
  readonly markdown: string;
  readonly csv: string;
  readonly dictionary: string;
  readonly columns: readonly CsvColumn[];
  readonly bindings: BindingTable;
  readonly data: readonly Datum[];
  readonly provenance: { readonly specSha256: string; readonly csvSha256: string; readonly provenanceSha256: string };
  readonly sha256: { readonly markdown: string; readonly csv: string; readonly dictionary: string };
}

const STATUS_TEXT: Record<ClaimStatus, readonly [string, string]> = {
  confirmed: [T.statusConfirmedA, T.statusConfirmedB], replicated: [T.statusReplicatedA, T.statusReplicatedB],
  tentative: [T.statusTentativeA, T.statusTentativeB], refuted: [T.statusRefutedA, T.statusRefutedB],
  "insufficient-evidence": [T.statusInsufficientA, T.statusInsufficientB], "non-identifiable": [T.statusNonIdentifiableA, T.statusNonIdentifiableB],
  exploratory: [T.statusExploratoryA, T.statusExploratoryB], voided: [T.statusVoidedA, T.statusVoidedB],
};
export const statusSegments = (s: ClaimStatus): Segment[] => [stat(STATUS_TEXT[s][0]), stat(T.space), stat(STATUS_TEXT[s][1])];

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

class TableBuilder extends Collector {
  readonly header: Segment[][] = [];
  readonly body: Segment[][][] = [];
  readonly notes: Segment[][] = [];
  readonly csvRows: CsvCell[][] = [];
  readonly store: FactStore;
  constructor(spec: TableSpec, templates: readonly (string | undefined)[], store: FactStore) {
    super(templateFragments(templates));
    this.store = store;
    if (typeof spec.id !== "string" || !/^[a-z][a-z0-9-]{0,63}$/u.test(spec.id)) refuse("invalid-spec", "table id must be a short lowercase slug");
    if (spec.placement !== "results" && spec.placement !== "supplement") refuse("invalid-spec", `table ${spec.id}: unknown placement`);
  }

  /** One CSV row per printed fact; the key cells come first. */
  row(keys: readonly CsvCell[], statistic: string, fact: CertifiedFact, display: string): void {
    this.csvRows.push([...keys, statistic, fact.value, fact.unit, fact.ciLevel, display, fact.grade, fact.id, fact.sourceRecordId]);
  }

  finish(spec: TableSpec, keyColumns: readonly CsvColumn[]): RenderedTable {
    const esc = (segs: readonly Segment[]) => this.register(segs).replaceAll("|", "\\|");
    const lines = [`| ${this.header.map(esc).join(" | ")} |`, `| ${this.header.map(() => "---").join(" | ")} |`];
    for (const r of this.body) {
      if (r.length !== this.header.length) refuse("internal-template", `table ${spec.id}: row width differs from header`);
      lines.push(`| ${r.map(esc).join(" | ")} |`);
    }
    if (this.exec) this.notes.push([stat(T.tableExecNote)]);
    const noteText = [...new Set(this.notes.map((n) => this.register(n)))];
    const markdown = [...(noteText.length ? [...noteText.map((n) => `${n}`), ""] : []), ...lines].join("\n") + "\n";
    const bindings = this.bindings();
    const cells = [...this.header, ...this.body.flat(), ...this.notes].map((segs) => segmentsText(segs));
    const issues: ClosedWorldIssue[] = cells.flatMap((c, i) => checkTextClosedWorld(c, bindings, `table ${spec.id} cell ${i}`));
    if (issues.length) refuse("figure-lint", `table ${spec.id} fails the closed-world check`, issues.map((i) => `${i.code} ${i.where}: ${i.detail}`));
    const columns = [...keyColumns, ...VALUE_COLUMNS];
    const csv = toCsv(columns, this.csvRows);
    const dictionary = dictionaryCsv(columns);
    const provenanceBody = { specSha256: canonicalSha256(spec), csvSha256: sha(csv) };
    const provenance = { ...provenanceBody, provenanceSha256: canonicalSha256({ ...provenanceBody, markdownSha256: sha(markdown), dictionarySha256: sha(dictionary) }) };
    return { provenance, id: spec.id, kind: spec.kind, markdown, csv, dictionary, columns, bindings, data: this.data, sha256: { markdown: sha(markdown), csv: sha(csv), dictionary: sha(dictionary) } };
  }
}

const ctxOf = (spec: TableSpec, claims: readonly string[], published = false): UseContext => ({ placement: spec.placement, claims: new Set(claims), where: `table ${spec.id}`, ...(published ? { published: true } : {}) });

function interval(b: TableBuilder, ctx: UseContext, ref: IntervalRef, keys: readonly CsvCell[]): { segs: Segment[]; parts: ReturnType<typeof intervalSegs>; est: CertifiedFact; lo: CertifiedFact } {
  const est = b.useFact(b.store.fact(ref.estimate, ctx, ESTIMATE_KINDS), "estimate");
  const lo = b.useFact(b.store.fact(ref.lower, ctx, ["ci"]), "ci-lower");
  const hi = b.useFact(b.store.fact(ref.upper, ctx, ["ci"]), "ci-upper");
  if(!lo.method || lo.method!==hi.method) refuse("inconsistent-data",`table ${ctx.where}: interval method missing or inconsistent`);
  b.notes.push([stat(T.tableMethods), {kind:"bound",text:lo.method,source:{type:"fact",id:lo.id,sourceRecordId:lo.sourceRecordId,grade:lo.grade}}]);
  const d = intervalSegs(b.store, est, lo, hi);
  b.row(keys, "estimate", est, d.estimate[0]!.text);
  b.row(keys, "ci_lower", lo, d.lower[0]!.text);
  b.row(keys, "ci_upper", hi, d.upper[0]!.text);
  return { segs: d.all, parts: d, est, lo };
}

function lvl(b: TableBuilder, fact: CertifiedFact): Segment {
  if (fact.ciLevel === null) return refuse("invalid-spec", `${fact.id} has no interval level`);
  return { kind: "bound", text: b.store.formatter.ciLevel(fact.ciLevel), source: { type: "ci-level", id: fact.id, sourceRecordId: fact.sourceRecordId, grade: fact.grade } };
}

function population(spec: PopulationTableSpec, store: FactStore): RenderedTable {
  const datasets = nonEmptyArray(spec.datasets, `table ${spec.id} datasets`, 8);
  const variables = nonEmptyArray(spec.variables, `table ${spec.id} variables`);
  const templates = [...datasets.map((d) => d.label), ...variables.flatMap((v) => [v.label, ...(v.type === "categorical" ? v.levels.map((l) => l.label) : [])])];
  const b = new TableBuilder(spec, templates, store);
  const ctx = ctxOf(spec, []);
  const dsLabels = datasets.map((d) => resolveTemplate(d.label, store, ctx));
  const dsN = datasets.map((d) => b.useFact(store.fact(d.n, ctx, ["count"]), "dataset-n"));
  b.header.push([stat(T.tableCharacteristic)], ...dsLabels.map((l, i) => [...l, stat(T.openParen), stat(T.nEq), ...scalarSegs(store, dsN[i]!), stat(T.closeParen)]));
  dsN.forEach((n, i) => b.row(["", "", segmentsText(dsLabels[i]!)], "n", n, store.formatter.scalar(n)));
  const width = datasets.length;
  const countCell = (cell: { count: string; percent: string }, ds: number, keys: CsvCell[]): Segment[] => {
    const count = b.useFact(store.fact(cell.count, ctx, ["count"]), "count");
    const pct = b.useFact(store.fact(cell.percent, ctx, ["percent"]), "percent");
    const n = dsN[ds]!.value;
    if(n<=0) refuse("inconsistent-data", "population denominator must be positive");
    if (count.value > n || Math.abs(pct.value - (100 * count.value) / n) > 0.1) refuse("inconsistent-data", `table ${spec.id}: ${count.id} and ${pct.id} disagree with the dataset n`);
    const c = scalarSegs(store, count), p = scalarSegs(store, pct);
    b.row(keys, "count", count, c[0]!.text);
    b.row(keys, "percent", pct, p[0]!.text);
    return [...c, stat(T.openParen), ...p, stat(T.closeParen)];
  };
  for (const v of variables) {
    const label = resolveTemplate(v.label, store, ctx);
    const vText = segmentsText(label);
    if (v.type !== "categorical" && v.cells.length !== width) refuse("invalid-spec", `table ${spec.id}: ${vText} needs one cell per dataset`);
    if (v.missing.length !== width || (v.type === "categorical" && v.levels.some((l) => l.cells.length !== width))) refuse("invalid-spec", `table ${spec.id}: ${vText} needs one cell per dataset`);
    if (v.type === "mean-sd") {
      b.body.push([[...label, stat(T.tableMeanSd)], ...v.cells.map((cell, ds) => {
        const keys = [vText, "", segmentsText(dsLabels[ds]!)];
        const mean = b.useFact(store.fact(cell.mean, ctx, ["mean"]), "mean"), sd = b.useFact(store.fact(cell.sd, ctx, ["sd"]), "sd");
        const m = scalarSegs(store, mean), s = scalarSegs(store, sd);
        b.row(keys, "mean", mean, m[0]!.text); b.row(keys, "sd", sd, s[0]!.text);
        return [...m, stat(T.openParen), ...s, stat(T.closeParen)];
      })]);
    } else if (v.type === "median-iqr") {
      b.body.push([[...label, stat(T.tableMedianIqr)], ...v.cells.map((cell, ds) => {
        const keys = [vText, "", segmentsText(dsLabels[ds]!)];
        const med = b.useFact(store.fact(cell.median, ctx, ["median"]), "median");
        const q1 = b.useFact(store.fact(cell.q1, ctx, ["quantile"]), "q1"), q3 = b.useFact(store.fact(cell.q3, ctx, ["quantile"]), "q3");
        if (!(q1.value <= med.value && med.value <= q3.value)) refuse("inconsistent-data", `table ${spec.id}: quartiles out of order for ${vText}`);
        const m = scalarSegs(store, med), a = scalarSegs(store, q1), z = scalarSegs(store, q3);
        b.row(keys, "median", med, m[0]!.text); b.row(keys, "q1", q1, a[0]!.text); b.row(keys, "q3", q3, z[0]!.text);
        return [...m, stat(T.openParen), ...a, stat(T.to), ...z, stat(T.closeParen)];
      })]);
    } else {
      b.body.push([[...label, stat(T.tableCountPct)], ...datasets.map(() => [] as Segment[])]);
      if(v.levels.filter(l=>l.reference===true).length!==1) refuse("invalid-spec",`table ${spec.id}: each categorical variable needs one reference level`);
      datasets.forEach((_,ds)=> {
        const total=v.levels.reduce((n,l)=>n+store.fact(l.cells[ds]!.count,ctx,["count"]).value,0)+store.fact(v.missing[ds]!.count,ctx,["count"]).value;
        if(total!==dsN[ds]!.value) refuse("inconsistent-data",`table ${spec.id}: categorical levels and missingness must sum to n`);
      });
      for (const level of v.levels) {
        const lLabel = resolveTemplate(level.label, store, ctx);
        b.body.push([[stat(T.tableLevelIndent), ...lLabel, ...(level.reference ? [stat(T.tableReference)] : [])], ...level.cells.map((cell, ds) => countCell(cell, ds, [vText, segmentsText(lLabel), segmentsText(dsLabels[ds]!)]))]);
      }
    }
    b.body.push([[stat(T.tableLevelIndent), stat(T.tableMissing)], ...v.missing.map((cell, ds) => countCell(cell, ds, [vText, T.tableMissing, segmentsText(dsLabels[ds]!)]))]);
  }
  return b.finish(spec, [
    { name: "variable", type: "string", unit: "", source: "table spec variable label (template)" },
    { name: "level", type: "string", unit: "", source: "table spec level label, or Missing" },
    { name: "dataset", type: "string", unit: "", source: "table spec dataset label (template)" },
  ]);
}

function claimResults(spec: ClaimResultsTableSpec, store: FactStore): RenderedTable {
  const rows = nonEmptyArray(spec.rows, `table ${spec.id} rows`);
  const b = new TableBuilder(spec, rows.map((r) => r.label), store);
  let level: Segment | null = null;
  for (const r of rows) {
    const claim = store.claim(r.claimId, `table ${spec.id}`);
    const ctx = ctxOf(spec, [r.claimId]);
    const label = resolveTemplate(r.label, store, ctx);
    const keys: CsvCell[] = [claim.id, segmentsText(label), claim.status];
    const iv = interval(b, ctx, r, keys);
    const rowLevel = lvl(b, iv.lo);
    if (level && level.text !== rowLevel.text) refuse("inconsistent-data", `table ${spec.id}: rows mix interval levels`);
    level ??= rowLevel;
    const pCell: Segment[] = [], nCell: Segment[] = [];
    if (r.p !== undefined) {
      const p = b.useFact(store.fact(r.p, ctx, ["p"]), "p");
      if(!p.method) refuse("inconsistent-data",`table ${spec.id}: p-value test method required`);
      b.notes.push([stat(T.tableMethods), {kind:"bound",text:p.method,source:{type:"fact",id:p.id,sourceRecordId:p.sourceRecordId,grade:p.grade}}]);
      const segs = scalarSegs(store, p);
      b.row(keys, "p", p, segs[0]!.text);
      pCell.push(...segs);
    }
    if (r.n !== undefined) {
      const n = b.useFact(store.fact(r.n, ctx, ["count"]), "n");
      const segs = scalarSegs(store, n);
      b.row(keys, "n", n, segs[0]!.text);
      nCell.push(...segs);
    }
    b.body.push([label, [stat(measureName(iv.est.kind))], iv.segs, pCell, nCell, statusSegments(claim.status)]);
  }
  b.header.push([stat(T.tableClaim)], [stat(T.tableMeasure)], [stat(T.tableEstimateOpen), level!, stat(T.ciClose)], [stat(T.tableP)], [stat(T.tableN)], [stat(T.tableLabel)]);
  return b.finish(spec, [
    { name: "claim_id", type: "string", unit: "", source: "CertifiedClaim.id" },
    { name: "row_label", type: "string", unit: "", source: "table spec row label (template)" },
    { name: "status", type: "string", unit: "", source: "CertifiedClaim.status" },
  ]);
}

type Direction = "above" | "below" | "unclear";
const direction = (estimate: number, nul: number): Direction => (estimate > nul ? "above" : estimate < nul ? "below" : "unclear");

function comparison(spec: ComparisonTableSpec, store: FactStore): RenderedTable {
  const studies = nonEmptyArray(spec.studies, `table ${spec.id} studies`, 50);
  const b = new TableBuilder(spec, studies.map((s) => s.label), store);
  const claim = store.claim(spec.claimId, `table ${spec.id}`);
  const ours = interval(b, ctxOf(spec, [spec.claimId]), spec.ours, ["this study", "this-study", ""]);
  const ourDir = direction(ours.est.value, claim.nullValue);
  const published = studies.map((s) => {
    const ctx = ctxOf(spec, [spec.claimId], true);
    const label = resolveTemplate(s.label, store, ctx);
    const pub = interval(b, ctx, s, [segmentsText(label), "published", ""]);
    if (pub.est.kind !== ours.est.kind) refuse("inconsistent-data", `table ${spec.id}: published measure ${pub.est.kind} differs from ours (${ours.est.kind})`);
    const agrees = direction(pub.est.value, claim.nullValue) === ourDir;
    for (let k = 1; k <= 3; k++) b.csvRows[b.csvRows.length - k]![2] = agrees ? "yes" : "no";
    return { label, pub, agrees };
  });
  // Each column states the level its intervals were certified at; mixed published levels print per row.
  const publishedLevels = new Set(published.map((p) => p.pub.lo.ciLevel));
  const uniform = publishedLevels.size === 1;
  for (const { label, pub, agrees } of published) {
    const cell = uniform ? pub.segs : [...pub.parts.estimate, stat(T.openParen), lvl(b, pub.lo), stat(T.ciWord), stat(T.space), ...pub.parts.lower, stat(T.to), ...pub.parts.upper, stat(T.closeParen)];
    b.body.push([label, cell, ours.segs, [stat(agrees ? T.tableYes : T.tableNo)]]);
  }
  const publishedHeader = uniform ? [stat(T.tablePublishedOpen), lvl(b, published[0]!.pub.lo), stat(T.ciClose)] : [stat(T.tablePublishedPerRow)];
  b.header.push([stat(T.tableSource)], publishedHeader, [stat(T.tableThisStudyOpen), lvl(b, ours.lo), stat(T.ciClose)], [stat(T.tableAgrees)]);
  b.notes.unshift([stat(T.tablePublishedNote)]);
  return b.finish(spec, [
    { name: "source", type: "string", unit: "", source: "previous-study label (template) or this study" },
    { name: "role", type: "string", unit: "", source: "published (verified quote, not recomputed) or this-study" },
    { name: "direction_agrees", type: "string", unit: "", source: "software: same side of the claim's null value (yes/no)" },
  ]);
}

function unverifiedNumbers(spec: UnverifiedNumbersTableSpec, store: FactStore): RenderedTable {
  if (spec.placement !== "supplement") refuse("invalid-spec", `table ${spec.id}: unverified numbers belong in the supplement only`);
  const rows = nonEmptyArray(spec.rows, `table ${spec.id} rows`, 500);
  const b = new TableBuilder(spec, rows.map((r) => r.label), store);
  const ctx: UseContext = { placement: "supplement", claims: new Set(store.claimIds()), where: `table ${spec.id}`, unverifiedTable: true };
  for (const r of rows) {
    // Row labels never take the unverified flag: a label placeholder cannot pull an unverified number.
    const label = resolveTemplate(r.label, store, { ...ctx, unverifiedTable: false });
    const f = b.useFact(store.fact(r.fact, ctx), "unverified");
    const segs = scalarSegs(store, f);
    b.row([segmentsText(label), f.claimId], "value", f, segs[0]!.text);
    b.body.push([label, segs]);
  }
  b.header.push([stat(T.tableQuantity)], [stat(T.tableValue)]);
  b.notes.push([stat(T.tableUnverifiedNote)]);
  return b.finish(spec, [
    { name: "row_label", type: "string", unit: "", source: "table spec row label (template)" },
    { name: "claim_id", type: "string", unit: "", source: "CertifiedFact.claimId (empty for dataset-level numbers)" },
  ]);
}

export function renderTable(spec: TableSpec, store: FactStore): RenderedTable {
  if (!spec || typeof spec !== "object") return refuse("invalid-spec", "table spec must be an object");
  switch (spec.kind) {
    case "population": return population(spec, store);
    case "claim-results": return claimResults(spec, store);
    case "comparison": return comparison(spec, store);
    case "unverified-numbers": return unverifiedNumbers(spec, store);
    default: return refuse("invalid-spec", `unknown table kind ${(spec as { kind?: unknown }).kind}`);
  }
}
