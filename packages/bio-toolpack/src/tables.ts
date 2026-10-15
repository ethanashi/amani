// Table loading for the single-table tools. Parsing is Omerta Bio's own: bio-pipeline's strict
// delimited/JSON reader (`readRows`) with a declaration built from the flags, and bio-pipeline's
// software inference (`inferDeclarations`) for any identity field the user did not name.

import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { delimited, readRows, type TabularDeclaration } from "../../bio-pipeline/src/validity.ts";
import { inferDeclarations } from "../../bio-pipeline/src/inference.ts";
import { isUninformative, parseMissingValues, type MissingValuePolicy } from "../../bio-checks/src/validity/duplicates.ts";
import { InputError, UsageError } from "./args.ts";

export type Format = "csv" | "tsv" | "json";
export type Axis = "rows" | "columns";

export interface TableOptions {
  file: string;
  format?: string | undefined;
  axis?: string | undefined;
  idField?: string | undefined;
  featureFields?: string[] | undefined;
  /** Explicit identity metadata. When `inferIdentity` is true and no donor field is given,
   * the software-inferred donor field (row axis) is used, as in Omerta Bio's gates. */
  donorField?: string | undefined;
  cellLineField?: string | undefined;
  inferIdentity: boolean;
  vectorFields?: string[] | undefined;
  split?: { field: string; train: string; test: string } | undefined;
  /** "auto" (default): the standard missing markers present in the table; "none": refuse; or a list. */
  missing?: string | undefined;
}

export interface LoadedTable {
  file: string;
  format: Format;
  axis: Axis;
  idField: string;
  featureFields: string[] | null;
  donorField: string | null;
  cellLineField: string | null;
  vectorFields: string[] | null;
  split: { field: string; train: string; test: string } | null;
  missingValues: MissingValuePolicy;
  rows: Record<string, unknown>[];
  /** All non-identity fields (identity = id, donor, cell line, split assignment). */
  contentFields: string[];
  inference: { ran: boolean; declared: boolean; sampleAxis: string | null; idField: string | null; reason: string };
}

function parseFormat(value: string | undefined, file: string): Format {
  const ext = path.extname(file).slice(1).toLowerCase();
  const format = value ?? ext;
  if (format !== "csv" && format !== "tsv" && format !== "json") {
    throw new UsageError(`cannot tell the table format of ${file}; pass --format csv|tsv|json`);
  }
  return format;
}

function parseAxis(value: string | undefined): Axis | undefined {
  if (value === undefined) return undefined;
  if (value !== "rows" && value !== "columns") throw new UsageError("--axis must be rows or columns");
  return value;
}

/** The standard missing markers that occur in the table (the same detection Omerta Bio's
 * inference performs), as an explicit token policy. */
function detectMissing(text: string, format: Format): MissingValuePolicy {
  const found = new Set<string>();
  if (format === "json") {
    const json: unknown = JSON.parse(text);
    if (!Array.isArray(json)) throw new Error("JSON table must be an array of records");
    for (const row of json) if (row && typeof row === "object") for (const value of Object.values(row as object)) if (typeof value === "string" && isUninformative(value)) found.add(value);
  } else {
    for (const row of delimited(text, format === "csv" ? "," : "\t").slice(1)) for (const value of row) if (isUninformative(value)) found.add(value);
  }
  const tokens = [...found].sort();
  return tokens.length ? { policy: "token", tokens } : { policy: "refuse" };
}

function missingPolicy(value: string | undefined, detected: () => MissingValuePolicy): MissingValuePolicy {
  if (value === undefined || value === "auto") return detected();
  if (value === "none") return { policy: "refuse" };
  try {
    return parseMissingValues({ policy: "token", tokens: value.split(",") });
  } catch (error) {
    throw new UsageError(`--missing: ${error instanceof Error ? error.message : "invalid token list"} (use auto, none, or a comma-separated list of non-numeric tokens)`);
  }
}

export function loadTable(options: TableOptions, cwd: string): LoadedTable {
  const absolute = path.resolve(cwd, options.file);
  let stat;
  try { stat = lstatSync(absolute); } catch { throw new InputError(`cannot read ${options.file}`); }
  if (!stat.isFile()) throw new InputError(`${options.file} is not a regular file`);
  const dir = path.dirname(absolute);
  const base = path.basename(absolute);
  const format = parseFormat(options.format, base);
  const axisFlag = parseAxis(options.axis);

  // What Omerta Bio's software would declare for this file on its own. Inference parses the
  // whole table, so it runs only when a flag the user omitted must be inferred.
  const needsInference = axisFlag === undefined || options.idField === undefined ||
    (axisFlag === "columns" && options.featureFields === undefined) ||
    (options.inferIdentity && axisFlag !== "columns" && options.donorField === undefined) ||
    options.missing === undefined || options.missing === "auto";
  const proposal = needsInference ? inferDeclarations(dir, [base])[0] : undefined;
  const inferred = proposal?.declaration && proposal.declaration.format === format ? proposal.declaration : null;
  const axis: Axis = axisFlag ?? inferred?.sampleAxis ?? "rows";
  const fromInference = inferred !== null && inferred.sampleAxis === axis ? inferred : null;

  let text: string | null = null;
  const readText = (): string => {
    if (text === null) {
      try { text = readFileSync(absolute, "utf8"); } catch { throw new InputError(`cannot read ${options.file}`); }
    }
    return text;
  };

  let idField = options.idField ?? fromInference?.idField;
  if (idField === undefined && axis === "columns" && format !== "json") {
    try {
      idField = delimited(readText(), format === "csv" ? "," : "\t")[0]![0];
    } catch (error) {
      throw new InputError(`${options.file}: ${error instanceof Error ? error.message : "unreadable table"}`);
    }
  }
  if (idField === undefined) {
    throw new UsageError(`could not infer the ID field of ${options.file} (${proposal?.reason ?? "no inference"}); pass --id-field`);
  }
  const featureFields = axis === "columns" ? options.featureFields ?? fromInference?.featureFields ?? null : null;
  if (axis !== "columns" && options.featureFields !== undefined) throw new UsageError("--feature-fields applies only to --axis columns");
  const donorField = options.donorField ?? (options.inferIdentity && axis === "rows" ? fromInference?.donorField ?? null : null);
  const cellLineField = options.cellLineField ?? null;

  let missingValues: MissingValuePolicy;
  try {
    missingValues = missingPolicy(options.missing, () => fromInference?.missingValues ?? detectMissing(readText(), format));
  } catch (error) {
    if (error instanceof UsageError || error instanceof InputError) throw error;
    throw new InputError(`${options.file}: ${error instanceof Error ? error.message : "unreadable table"}`);
  }

  const declaration: TabularDeclaration = {
    file: base, format, sampleAxis: axis, idField, unitOfAnalysis: "sample", declaredN: 1, handling: "reject", missingValues,
    ...(featureFields ? { featureFields } : {}),
    ...(donorField ? { donorField } : {}),
    ...(cellLineField ? { cellLineField } : {}),
    ...(options.vectorFields ? { vectorFields: options.vectorFields } : {}),
    ...(options.split ? { split: options.split } : {}),
  };
  if (axis === "columns" && format === "json") throw new UsageError("column-axis JSON is unsupported");
  let rows: Record<string, unknown>[];
  try {
    rows = readRows(dir, declaration);
  } catch (error) {
    throw new InputError(`${options.file}: ${error instanceof Error ? error.message : "unreadable table"}`);
  }
  const identity = new Set([idField, donorField, cellLineField, options.split?.field].filter((x): x is string => typeof x === "string"));
  const contentFields = Object.keys(rows[0]!).filter((key) => !identity.has(key));
  for (const field of options.vectorFields ?? []) {
    if (!contentFields.includes(field)) throw new UsageError(`--vector-fields names ${field}, which is not a non-identity field of ${options.file}`);
  }
  return {
    file: options.file, format, axis, idField, featureFields, donorField, cellLineField,
    vectorFields: options.vectorFields ?? null, split: options.split ?? null, missingValues, rows, contentFields,
    inference: proposal === undefined ? { ran: false, declared: false, sampleAxis: null, idField: null, reason: "not needed: every identity flag was given" }
      : { ran: true, declared: proposal.declaration != null, sampleAxis: proposal.declaration?.sampleAxis ?? null,
        idField: proposal.declaration?.idField ?? null, reason: proposal.reason },
  };
}

/** Header fields of the table description, for JSON output. */
export function describeTable(table: LoadedTable): Record<string, unknown> {
  return {
    file: table.file, format: table.format, axis: table.axis, idField: table.idField,
    ...(table.featureFields ? { featureFields: table.featureFields } : {}),
    donorField: table.donorField, cellLineField: table.cellLineField,
    ...(table.vectorFields ? { vectorFields: table.vectorFields } : {}),
    ...(table.split ? { split: table.split } : {}),
    missingValues: table.missingValues, records: table.rows.length, inference: table.inference,
  };
}
