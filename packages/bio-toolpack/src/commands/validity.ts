// Single-table validity tools. Every verdict comes from @omerta-bio/checks (`validity.*`) on rows
// parsed by bio-pipeline's reader; the comparison basis mirrors bio-pipeline's automatic gate.

import { validity } from "../../../bio-checks/src/index.ts";
import { nameList, noRest, numberFlag, onePositional, optional, parseArgs, required, UsageError, type FlagSpec } from "../args.ts";
import { result, type ToolResult } from "../io.ts";
import { describeTable, loadTable, type LoadedTable } from "../tables.ts";

const TABLE_FLAGS = {
  format: "string", axis: "string", "id-field": "string", "feature-fields": "string",
  "donor-field": "string", "cell-line-field": "string", missing: "string", "json-out": "string",
} as const satisfies FlagSpec;

type Row = Readonly<Record<string, unknown>>;

function tableOptions(args: ReturnType<typeof parseArgs>, file: string, inferIdentity: boolean, extra: { vectorFields?: string[] | undefined; split?: { field: string; train: string; test: string } } = {}) {
  return {
    file, inferIdentity, format: optional(args, "format"), axis: optional(args, "axis"), idField: optional(args, "id-field"),
    featureFields: nameList(args, "feature-fields"), donorField: optional(args, "donor-field"),
    cellLineField: optional(args, "cell-line-field"), missing: optional(args, "missing"), ...extra,
  };
}

interface Basis {
  kind: "all non-identity content" | "subset";
  compareFields: string[];
  vectorFields: string[];
  vectorOf: ((row: Row) => unknown[]) | undefined;
}

/** The same basis as bio-pipeline's gate: every non-identity field; column-axis tables and
 * declared vector fields are numeric vectors, everything else is compared as exact scalars. */
function contentBasis(table: LoadedTable, subset: string[] | undefined): Basis {
  if (subset !== undefined) {
    for (const field of subset) if (!table.contentFields.includes(field)) throw new UsageError(`--fields names ${field}, which is not a non-identity field`);
    return { kind: "subset", compareFields: subset, vectorFields: [], vectorOf: undefined };
  }
  if (table.contentFields.length === 0) throw new UsageError("the table has no non-identity content to compare");
  const numeric = table.axis === "columns" ? table.contentFields : table.vectorFields ?? [];
  const numericSet = new Set(numeric);
  return {
    kind: "all non-identity content",
    compareFields: table.contentFields.filter((field) => !numericSet.has(field)),
    vectorFields: numeric,
    vectorOf: numeric.length ? (row: Row) => numeric.map((key) => row[key]) : undefined,
  };
}

function basisInput(basis: Basis): { compareFields?: string[]; vectorOf?: (row: Row) => unknown[] } {
  return { ...(basis.compareFields.length ? { compareFields: basis.compareFields } : {}), ...(basis.vectorOf ? { vectorOf: basis.vectorOf } : {}) };
}

function describeBasis(basis: Basis): Record<string, unknown> {
  return { kind: basis.kind, scalarFields: basis.compareFields, vectorFields: basis.vectorFields.length };
}

function exactReport(table: LoadedTable, basis: Basis, tolerance: number) {
  return validity.detectContentDuplicates({ rows: table.rows, idField: table.idField, tolerance, missingValues: table.missingValues, ...basisInput(basis) });
}

function nearReport(table: LoadedTable, threshold: number | undefined, maxCandidatePairs: number | undefined) {
  const numeric = table.axis === "columns" ? table.contentFields : table.vectorFields ?? [];
  if (numeric.length === 0) throw new UsageError("near-duplicate detection needs numeric vectors: use --axis columns or --vector-fields");
  return validity.detectNearDuplicates({
    rows: table.rows, idField: table.idField, vectorOf: (row: Row) => numeric.map((key) => row[key]), missingValues: table.missingValues,
    ...(threshold !== undefined ? { threshold } : {}), ...(maxCandidatePairs !== undefined ? { maxCandidatePairs } : {}),
  });
}

export async function duplicates(argv: readonly string[], cwd: string): Promise<ToolResult> {
  const args = parseArgs(argv, { ...TABLE_FLAGS, "vector-fields": "string", fields: "string", tolerance: "string" });
  noRest(args);
  const file = onePositional(args, "table file");
  const table = loadTable(tableOptions(args, file, true, { vectorFields: nameList(args, "vector-fields") }), cwd);
  const tolerance = numberFlag(args, "tolerance", { min: 0 }) ?? 0;
  const basis = contentBasis(table, nameList(args, "fields"));
  const report = exactReport(table, basis, tolerance);
  const payload = { table: describeTable(table), basis: describeBasis(basis), report };
  if (report.status === "invalid") return result(2, "invalid-input", report.reason, payload);
  return result(report.status === "no-duplicates" ? 0 : 1, report.status, report.reason, payload);
}

export async function nearDuplicates(argv: readonly string[], cwd: string): Promise<ToolResult> {
  const args = parseArgs(argv, { ...TABLE_FLAGS, "vector-fields": "string", threshold: "string", "max-candidate-pairs": "string" });
  noRest(args);
  const file = onePositional(args, "table file");
  const table = loadTable(tableOptions(args, file, true, { vectorFields: nameList(args, "vector-fields") }), cwd);
  const threshold = numberFlag(args, "threshold", { min: 0, max: 1, minExclusive: true, maxExclusive: true });
  const cap = numberFlag(args, "max-candidate-pairs", { min: 1, integer: true });
  const report = nearReport(table, threshold, cap);
  const payload = { table: describeTable(table), report };
  if (report.status === "invalid") return result(2, "invalid-input", report.reason, payload);
  return result(report.valid ? 0 : 1, report.status, report.reason, payload);
}

export async function effectiveUnitsCommand(argv: readonly string[], cwd: string): Promise<ToolResult> {
  const args = parseArgs(argv, { ...TABLE_FLAGS, "vector-fields": "string", tolerance: "string", "near-threshold": "string" });
  noRest(args);
  const file = onePositional(args, "table file");
  const table = loadTable(tableOptions(args, file, true, { vectorFields: nameList(args, "vector-fields") }), cwd);
  const tolerance = numberFlag(args, "tolerance", { min: 0 }) ?? 0;
  const nearThreshold = numberFlag(args, "near-threshold", { min: 0, max: 1, minExclusive: true, maxExclusive: true });
  const basis = contentBasis(table, undefined);
  const exact = exactReport(table, basis, tolerance);
  const evidence: validity.DuplicateEvidence[] = [exact];
  if (nearThreshold !== undefined) evidence.push(nearReport(table, nearThreshold, undefined));
  const units = validity.effectiveUnits(evidence);
  const payload = { table: describeTable(table), basis: describeBasis(basis), evidence: evidence.map((e) => ({ kind: e.kind, status: e.status, reason: e.reason })), effectiveUnits: units };
  const invalid = evidence.find((e) => e.status === "invalid");
  if (invalid) return result(2, "invalid-input", invalid.reason, payload);
  if (!units.valid) return result(1, "not-established", units.reason, payload);
  if (exact.status === "insufficient-information") return result(1, "insufficient-information", `${exact.reason}; ${units.reason}`, payload);
  return result(units.effectiveN === units.inputN ? 0 : 1, units.effectiveN === units.inputN ? "no-redundancy" : "redundant-records", units.reason, payload);
}

export async function pseudorep(argv: readonly string[], cwd: string): Promise<ToolResult> {
  const args = parseArgs(argv, { ...TABLE_FLAGS, unit: "string", "declared-n": "string" });
  noRest(args);
  const file = onePositional(args, "table file");
  const unit = required(args, "unit", "(donor, cellLine or sample)");
  if (unit !== "donor" && unit !== "cellLine" && unit !== "sample") throw new UsageError("--unit must be donor, cellLine or sample");
  if ((unit === "donor" || unit === "sample") && optional(args, "donor-field") === undefined) throw new UsageError(`--unit ${unit} requires --donor-field`);
  if (unit === "cellLine" && optional(args, "cell-line-field") === undefined) throw new UsageError("--unit cellLine requires --cell-line-field");
  if (optional(args, "axis") === "columns") throw new UsageError("pseudorep reads a row-axis sample table");
  const table = loadTable(tableOptions(args, file, false), cwd);
  const declaredN = numberFlag(args, "declared-n", { min: 1, integer: true }) ?? table.rows.length;
  // Same sample construction as bio-pipeline's gate.
  const samples = table.rows.map((row) => ({ sampleId: row[table.idField] as string,
    ...(table.donorField ? { donorId: row[table.donorField] as string } : {}),
    ...(table.cellLineField ? { cellLineId: row[table.cellLineField] as string } : {}) }));
  const check = validity.checkPseudoReplication({ samples, unit, declaredN });
  return result(check.valid ? 0 : 1, check.valid ? "independent" : "pseudo-replicated-or-unverified", check.reason,
    { table: describeTable(table), unit, check });
}

export async function donorSplit(argv: readonly string[], cwd: string): Promise<ToolResult> {
  const args = parseArgs(argv, { ...TABLE_FLAGS, "split-field": "string", train: "string", test: "string" });
  noRest(args);
  const file = onePositional(args, "table file");
  const split = { field: required(args, "split-field"), train: required(args, "train"), test: required(args, "test") };
  if (split.train === split.test) throw new UsageError("--train and --test must differ");
  required(args, "donor-field");
  if (optional(args, "axis") === "columns") throw new UsageError("donor-split reads a row-axis sample table");
  const table = loadTable(tableOptions(args, file, false, { split }), cwd);
  const samples = table.rows.map((row) => ({ sampleId: row[table.idField] as string, donorId: row[table.donorField!] as string }));
  const check = validity.checkDonorDisjoint({
    train: samples.filter((_, i) => table.rows[i]![split.field] === split.train),
    test: samples.filter((_, i) => table.rows[i]![split.field] === split.test),
  });
  return result(check.valid ? 0 : 1, check.valid ? "donor-disjoint" : "leak-or-unverified", check.reason, { table: describeTable(table), split, check });
}
