import type { Canvas } from "../draw.ts";
import type { CertifiedClaim, CertifiedFact, CertifiedSeries, FactKind } from "../port.ts";
import { refuse } from "../refusal.ts";
import type { CaptionSpec, FigureSpec } from "../spec.ts";
import type { FactStore, UseContext } from "../store.ts";
import { T } from "../templates.ts";
import { resolveTemplate, stat, type Segment } from "../text.ts";

export interface FigureDraft {
  readonly canvas: Canvas;
  readonly height: number;
  readonly title: readonly Segment[];
  readonly alt: readonly Segment[];
  readonly caption: readonly Segment[];
}

export const RATIO_KINDS: readonly FactKind[] = ["or", "hr", "rr", "ratio"];
export const ESTIMATE_KINDS: readonly FactKind[] = ["effect", "difference", "beta", "or", "hr", "rr", "ratio", "auc", "proportion", "probability", "mean", "median", "slope"];
export const SERIES_LETTERS = ["sa", "sb", "sc", "sd"] as const;

export function useContext(spec: FigureSpec, claims: readonly string[]): UseContext {
  return { placement: spec.placement, claims: new Set(claims), where: `figure ${spec.id}` };
}

export function bound(fact: CertifiedFact, text: string): Segment[] {
  const seg: Segment = { kind: "bound", text, source: { type: "fact", id: fact.id, sourceRecordId: fact.sourceRecordId, grade: fact.grade } };
  return fact.grade === "exec" ? [seg, stat(T.dagger)] : [seg];
}

export function scalarSegs(store: FactStore, fact: CertifiedFact): Segment[] {
  return bound(fact, store.formatter.scalar(fact));
}

export function lvlSeg(store: FactStore, fact: CertifiedFact): Segment {
  if (fact.ciLevel === null) return refuse("invalid-spec", `${fact.id} has no interval level`);
  return { kind: "bound", text: store.formatter.ciLevel(fact.ciLevel), source: { type: "ci-level", id: fact.id, sourceRecordId: fact.sourceRecordId, grade: fact.grade } };
}

export function unitSeg(record: CertifiedFact | CertifiedSeries): Segment | null {
  return record.unit === null ? null : { kind: "bound", text: record.unit, source: { type: "unit", id: record.id, sourceRecordId: record.sourceRecordId, grade: null } };
}

export function intervalSegs(store: FactStore, est: CertifiedFact, lo: CertifiedFact, hi: CertifiedFact): { estimate: Segment[]; lower: Segment[]; upper: Segment[]; all: Segment[] } {
  const [e, l, u] = store.formatter.interval(est, lo, hi);
  const exec = [est, lo, hi].some((f) => f.grade === "exec");
  const plain = (f: CertifiedFact, text: string): Segment => ({ kind: "bound", text, source: { type: "fact", id: f.id, sourceRecordId: f.sourceRecordId, grade: f.grade } });
  const estimate = [plain(est, e)], lower = [plain(lo, l)], upper = [plain(hi, u)];
  const all = [...estimate, stat(T.openParen), ...lower, stat(T.to), ...upper, stat(T.closeParen), ...(exec ? [stat(T.dagger)] : [])];
  return { estimate, lower, upper, all };
}

export function captionSegs(store: FactStore, ctx: UseContext, caption: CaptionSpec, encoding: readonly Segment[]): Segment[] {
  if (!caption || typeof caption.message !== "string") refuse("invalid-spec", `${ctx.where}: caption message required`);
  const out = [...resolveTemplate(caption.message, store, ctx)];
  if (caption.shortLabel !== undefined) out.push(stat(T.space), ...resolveTemplate(caption.shortLabel, store, ctx));
  out.push(stat(T.space), ...encoding);
  return out;
}

export function measureName(kind: FactKind): string {
  const names: Partial<Record<FactKind, string>> = {
    or: T.measureOr, hr: T.measureHr, rr: T.measureRr, ratio: T.measureRatio, effect: T.measureEffect,
    difference: T.measureDifference, beta: T.measureBeta, auc: T.measureAuc, proportion: T.measureProportion,
    probability: T.measureProbability, mean: T.measureMean, median: T.measureMedian, slope: T.measureSlope,
  };
  return names[kind] ?? refuse("kind-mismatch", `no measure name for ${kind}`);
}

export function requireClaim(store: FactStore, id: string, where: string): CertifiedClaim {
  if (typeof id !== "string") refuse("invalid-spec", `${where}: claimId required`);
  return store.claim(id, where);
}

export function sameLength(where: string, ...series: readonly CertifiedSeries[]): number {
  const n = series[0]!.values.length;
  if (series.some((s) => s.values.length !== n)) refuse("inconsistent-data", `${where}: series ${series.map((s) => s.id).join(", ")} differ in length`);
  return n;
}

export function nonDecreasing(values: readonly number[]): boolean {
  return values.every((v, i) => i === 0 || v >= values[i - 1]!);
}

export function joinSegs(parts: readonly (readonly Segment[])[], sep: string): Segment[] {
  return parts.flatMap((p, i) => (i === 0 ? [...p] : [stat(sep), ...p]));
}

export function nonEmptyArray<T>(value: readonly T[] | undefined, where: string, max = 200): readonly T[] {
  if (!Array.isArray(value) || value.length === 0) refuse("invalid-spec", `${where} must be a non-empty list`);
  if (value.length > max) refuse("invalid-spec", `${where} has more than ${max} entries`);
  return value;
}

/** Alt text ends without trailing whitespace: a final library string is swapped for its trimmed twin (also in the library). */
export function trimTrailing(segs: readonly Segment[]): Segment[] {
  const last = segs.at(-1);
  if (last && last.kind === "static" && last.text.endsWith(" ")) return [...segs.slice(0, -1), stat(last.text.trimEnd())];
  return [...segs];
}
