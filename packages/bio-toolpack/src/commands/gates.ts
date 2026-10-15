// `infer` and `gates`: Omerta Bio's own software-inferred validity declarations and automatic
// validity gates (bio-pipeline `inferDeclarations`, `resolveDeclarationReview`,
// `validateInferredDeclarations`, `runValidityGates`), run on a data directory.

import { lstatSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { inferDeclarations, resolveDeclarationReview, validateInferredDeclarations, type DeclarationOverride } from "../../../bio-pipeline/src/inference.ts";
import { requireDatasetCoverage, runValidityGates, validateComparisonDeclarations, validityPolicy, type DatasetExclusion, type TabularDeclaration } from "../../../bio-pipeline/src/validity.ts";
import { InputError, noRest, onePositional, optional, parseArgs, UsageError } from "../args.ts";
import { singleParseGates } from "../single-parse.ts";
import { result, type ToolResult } from "../io.ts";

/** Every regular file directly inside DIR, sorted. Omerta Bio stages flat data directories;
 * a nested directory is refused rather than silently skipped. */
export function dataFiles(dir: string): string[] {
  let entries;
  try {
    if (!lstatSync(dir).isDirectory()) throw new Error("not a directory");
    entries = readdirSync(dir, { withFileTypes: true });
  } catch { throw new InputError(`cannot read data directory ${dir}`); }
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.isFile()) files.push(entry.name);
    else throw new InputError(`${path.join(dir, entry.name)} is not a regular file; the data directory must be flat`);
  }
  if (files.length === 0) throw new InputError(`data directory ${dir} has no files`);
  return files.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export async function infer(argv: readonly string[], cwd: string): Promise<ToolResult> {
  const args = parseArgs(argv, { "json-out": "string" });
  noRest(args);
  const dir = path.resolve(cwd, onePositional(args, "data directory"));
  const files = dataFiles(dir);
  const proposals = inferDeclarations(dir, files);
  const refused = proposals.filter((p) => p.declaration === null);
  const summary = refused.length
    ? `${refused.length} of ${files.length} file(s) refused inference: ${refused.map((p) => `${p.file} (${p.reason})`).join("; ")}`
    : `declarations inferred for all ${files.length} file(s)`;
  return result(refused.length ? 1 : 0, refused.length ? "refused" : "inferred", summary, { dataDir: dir, files, proposals });
}

interface Review {
  handling?: "collapse" | "stop";
  overrides?: DeclarationOverride[];
  exclusions?: DatasetExclusion[];
  exploratory?: boolean;
}

function readReview(file: string | undefined, cwd: string): Review {
  if (file === undefined) return {};
  let value: unknown;
  try { value = JSON.parse(readFileSync(path.resolve(cwd, file), "utf8")); } catch { throw new InputError(`cannot read review JSON ${file}`); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new InputError("review must be a JSON object");
  const allowed = ["handling", "overrides", "exclusions", "exploratory"];
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new InputError(`unknown review field(s): ${unknown.join(", ")}`);
  const review = value as Record<string, unknown>;
  if (review.exploratory !== undefined && typeof review.exploratory !== "boolean") throw new InputError("review.exploratory must be a boolean");
  return review as Review;
}

export async function gates(argv: readonly string[], cwd: string): Promise<ToolResult> {
  const args = parseArgs(argv, { review: "string", handling: "string", "single-parse": "boolean", exploratory: "boolean", "json-out": "string" });
  noRest(args);
  const dir = path.resolve(cwd, onePositional(args, "data directory"));
  if (args.booleans.has("single-parse")) {
    if (optional(args, "handling") !== "collapse" || optional(args, "review") !== undefined) throw new UsageError("--single-parse requires --handling collapse and no review override");
    const stage = singleParseGates(dir);
    return result(stage.document.exitCode as 0 | 1, String(stage.document.status), "single-parse staging complete", stage.document);
  }
  const files = dataFiles(dir);
  const review = readReview(optional(args, "review"), cwd);
  const handlingFlag = optional(args, "handling");
  if (handlingFlag !== undefined && handlingFlag !== "collapse" && handlingFlag !== "stop") throw new UsageError("--handling must be collapse or stop");
  if (handlingFlag !== undefined && review.handling !== undefined && handlingFlag !== review.handling) throw new UsageError("--handling conflicts with the review file");
  const exploratory = args.booleans.has("exploratory") || review.exploratory === true;
  const handling = handlingFlag ?? review.handling;
  const proposals = inferDeclarations(dir, files);
  // Exactly the confirmation protocol Omerta Bio's draft uses (declarationReview).
  const analysis: Record<string, unknown> = {
    exploratory,
    declarationReview: { confirm: true, ...(handling !== undefined ? { handling } : {}), ...(review.overrides !== undefined ? { overrides: review.overrides } : {}) },
    ...(review.exclusions !== undefined ? { exclusions: review.exclusions } : {}),
  };
  let datasets: TabularDeclaration[];
  let exclusions: DatasetExclusion[];
  let overrides: DeclarationOverride[];
  try {
    const resolved = resolveDeclarationReview({ analysis }, proposals) as { analysis: { datasets: TabularDeclaration[]; exclusions?: DatasetExclusion[]; declarationOverrides?: DeclarationOverride[] } };
    datasets = resolved.analysis.datasets;
    exclusions = resolved.analysis.exclusions ?? [];
    overrides = resolved.analysis.declarationOverrides ?? [];
    requireDatasetCoverage(files, datasets, exclusions);
    validateComparisonDeclarations(dir, datasets);
    validateInferredDeclarations(proposals, datasets, exclusions, overrides);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "declaration review refused";
    return result(1, "refused", `declarations refused: ${reason}`, { dataDir: dir, files, policy: validityPolicy, proposals, refused: reason });
  }
  let evidence;
  try {
    evidence = runValidityGates(dir, files, datasets, exclusions, { exploratory });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "validity gates unavailable";
    return result(1, "refused", `validity gates refused: ${reason}`, { dataDir: dir, files, policy: validityPolicy, declarations: datasets, refused: reason });
  }
  const blocked = evidence.datasets.filter((d) => !d.allowed);
  const summary = evidence.allowed
    ? `all ${evidence.datasets.length} declared dataset(s) allowed: ${evidence.datasets.map((d) => `${d.file} effective n ${d.effectiveN} of ${d.rowCount}`).join("; ")}${exclusions.length ? `; excluded (not checked): ${exclusions.map((e) => e.file).join(", ")}` : ""}`
    : `${blocked.length} dataset(s) blocked: ${blocked.map((d) => `${d.file}: ${d.decision}`).join("; ")}`;
  return result(evidence.allowed ? 0 : 1, evidence.allowed ? "allowed" : "blocked", summary,
    { dataDir: dir, files, exploratory, declarations: datasets, ...(overrides.length ? { overrides } : {}), evidence });
}
