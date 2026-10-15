import { lstatSync, mkdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { canonicalJson, validateArtifactPath } from "../../bio-core/src/index.ts";
import { tabularDeclarations, datasetExclusions } from "./validity.ts";
import { metricBounds } from "./metric-bounds.ts";
import type { AnalysisPlan, AnalysisRuntime, InvestigationConfig, Proposal } from "./types.ts";

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("expected JSON object");
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, expected: string[]): void {
  if (Object.keys(value).sort().join(",") !== expected.sort().join(",")) throw new Error("unknown or missing fields");
}
export function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 16000) throw new Error("expected bounded nonblank text");
  return value;
}
function strings(value: unknown): string[] {
  if (!Array.isArray(value) || !value.length || value.length > 64) throw new Error("expected nonempty bounded list");
  const result = value.map(text);
  if (new Set(result).size !== result.length) throw new Error("duplicate list item");
  return result;
}
/** Every acceptance check name a plan may require. Each one is executed by software;
 * anything else is refused before locking (the bounded plan repair can fix it). */
export const checkCatalog = {
  reexecution: "frozen code re-executed twice offline from the raw data; outputs must match (this covers fixed seeds)",
  claims: "every numeric claim equals a recomputed metrics.json value",
  manifest: "the staged raw data is unchanged",
  "effective-inputs": "the analysis read exactly the software-materialized effective units",
  validity: "every automatic validity finding passed outright; handled or collapsed findings fail it",
  "metric-bounds": "software evaluates analysis.metricBounds on the frozen metrics.json",
  "results-schema": "software validates results.json against the investigation results schema",
} as const;
export const mandatoryChecks = ["reexecution", "claims", "manifest"] as const;
export interface PlanContext { resultsSchema?: boolean }
export function analysisPlan(value: unknown, trustedOverrides: NonNullable<AnalysisPlan["declarationOverrides"]> = [], context: PlanContext = {}): AnalysisPlan {
  const p = object(value); keys(p, ["method", "outputs", "requiredChecks", "tolerance", ...["datasets"].filter(k => Object.hasOwn(p, k)), ...["runtime", "exploratory", "exclusions", "declarationOverrides", "metricBounds"].filter(k => Object.hasOwn(p, k))]);
  if (Object.hasOwn(p, "runtime") && !["node", "r", "python"].includes(p.runtime as string)) throw new Error("unknown analysis runtime");
  if (Object.hasOwn(p, "exploratory") && typeof p.exploratory !== "boolean") throw new Error("invalid exploratory declaration");
  const outputs = strings(p.outputs); outputs.forEach(validateArtifactPath);
  const names = outputs.map(name => name.normalize("NFC").toLowerCase());
  if (new Set(names).size !== names.length) throw new Error("aliased output names");
  if (!outputs.includes("metrics.json") || ["analysis.mjs", "analysis.r", "analysis.py", "proposal.json", "revised-plan.json", "evidence.json"].some(name => names.includes(name))) throw new Error("plan requires metrics.json and disjoint code/output names");
  if (outputs.some(name => !/\.(tsv|json)$/i.test(name))) throw new Error("outputs must be TSV/JSON files");
  const requiredChecks = strings(p.requiredChecks);
  const unknown = requiredChecks.filter(check => !Object.hasOwn(checkCatalog, check));
  if (unknown.length) throw new Error(`requiredChecks outside the software check catalog: ${unknown.join(", ")}; allowed: ${Object.keys(checkCatalog).join(", ")}`);
  for (const check of [...mandatoryChecks, ...(context.resultsSchema ? ["results-schema"] : [])]) if (!requiredChecks.includes(check)) throw new Error(`mandatory check absent: ${check}`);
  if (requiredChecks.includes("results-schema") && !context.resultsSchema) throw new Error("results-schema requires an investigation results schema");
  if (context.resultsSchema && !outputs.includes("results.json")) throw new Error("the investigation results schema requires results.json in outputs");
  const bounds = Object.hasOwn(p, "metricBounds") ? metricBounds(p.metricBounds) : undefined;
  if (requiredChecks.includes("metric-bounds") !== (bounds !== undefined)) throw new Error("metric-bounds in requiredChecks and analysis.metricBounds must be declared together");
  const tolerance = object(p.tolerance); keys(tolerance, ["abs", "rel"]);
  for (const v of Object.values(tolerance)) if (typeof v !== "number" || !Number.isFinite(v) || v < 0) throw new Error("invalid numeric tolerance");
  if (p.declarationOverrides !== undefined) {
    if (!Array.isArray(p.declarationOverrides) || p.declarationOverrides.some(o => !o || Object.keys(o).sort().join() !== "field,file,justification,value" ||
      typeof o.file !== "string" || typeof o.field !== "string" || typeof o.justification !== "string" || !o.justification.trim() || o.justification.length > 1024 ||
      !["split", "nearDuplicates", "vectorFields", "compareFields", "subsetJustification"].includes(o.field))) throw new Error("invalid software declarationOverrides");
    if (canonicalJson(p.declarationOverrides) !== canonicalJson(trustedOverrides)) throw new Error("declarationOverrides are software-owned; use declarationReview");
    for (const o of trustedOverrides) if (canonicalJson((p.datasets as Record<string, unknown>[]).find(d => d.file === o.file)?.[o.field] ?? null) !== canonicalJson(o.value)) throw new Error("declarationOverrides do not match resolved fields");
  }
  if ((p.datasets as Record<string, unknown>[])?.some(d => d.handling === "exact") && p.exploratory !== true) throw new Error("automatic exact collapse is exploratory only");
  return { ...(p.declarationOverrides ? { declarationOverrides: structuredClone(p.declarationOverrides) as NonNullable<AnalysisPlan["declarationOverrides"]> } : {}), ...(Object.hasOwn(p, "runtime") ? { runtime: p.runtime as AnalysisRuntime } : {}),
    ...(Object.hasOwn(p, "exploratory") ? { exploratory: p.exploratory as boolean } : {}),
    ...(Object.hasOwn(p, "exclusions") ? { exclusions: datasetExclusions(p.exclusions) } : {}),
    ...(bounds ? { metricBounds: bounds } : {}),
    datasets: tabularDeclarations(p.datasets), method: text(p.method), outputs, requiredChecks, tolerance: tolerance as unknown as AnalysisPlan["tolerance"] };
}
export function proposal(value: unknown, resolved = false, context: PlanContext = {}): Proposal {
  const p = object(value); keys(p, ["hypotheses", "prediction", "analysis"]);
  return { hypotheses: strings(p.hypotheses), prediction: text(p.prediction), analysis: analysisPlan(p.analysis, resolved ? (p.analysis as AnalysisPlan).declarationOverrides : [], context) };
}
export function validateConfig(value: InvestigationConfig): InvestigationConfig {
  const c = structuredClone(value);
  keys(object(c), ["id", "question", "successCriterion", "files", "model", "home", "node", "toolPath", "timeoutMs", ...("planRepairRounds" in c ? ["planRepairRounds"] : [])]);
  if (c.planRepairRounds !== undefined && (!Number.isSafeInteger(c.planRepairRounds) || c.planRepairRounds < 0 || c.planRepairRounds > 2)) throw new Error("planRepairRounds must be 0..2");
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(c.id)) throw new Error("invalid investigation id");
  text(c.question); text(c.successCriterion);
  if (!c.model.startsWith("claude-") || !Array.isArray(c.files) || !c.files.length) throw new Error("invalid worker or dataset configuration");
  if (!Number.isSafeInteger(c.timeoutMs) || c.timeoutMs < 1) throw new Error("invalid timeout");
  for (const p of [c.home, c.node, ...c.toolPath.split(path.delimiter)]) if (!path.isAbsolute(p)) throw new Error("host paths must be absolute");
  return c;
}
/** Refuse alias substitution of authority, evidence and deletion roots. */
export function safeDirectory(dir: string): string {
  if (!path.isAbsolute(dir)) throw new Error("absolute investigation directory required");
  for (let p = path.resolve(dir); ; p = path.dirname(p)) {
    try { if (lstatSync(p).isSymbolicLink()) throw new Error(`symlink path refused: ${p}`); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
    if (p === path.dirname(p)) break;
  }
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return realpathSync(dir);
}
