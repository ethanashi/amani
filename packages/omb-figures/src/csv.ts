/**
 * Tidy CSV (UTF-8, "\n", full precision) and its data dictionary (column, type, unit, source).
 * Numbers are written with ECMAScript's shortest round-trip form, so every cell parses back to
 * the exact certified value. All cells are text in the file; nothing is spreadsheet-typed.
 */
export interface CsvColumn {
  readonly name: string;
  readonly type: "string" | "number" | "integer";
  readonly unit: string;
  readonly source: string;
}

export type CsvCell = string | number | null;

function cell(value: CsvCell): string {
  if (value === null) return "";
  let text = typeof value === "number" ? (Number.isFinite(value) ? String(value) : "") : value;
  if(typeof value === "string" && (/^\s*[=+\-@]/u.test(text) || /^[\t\r]/u.test(text))) text = "'" + text;
  return /[",\n\r]/u.test(text) || /^\s|\s$/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv(columns: readonly CsvColumn[], rows: readonly (readonly CsvCell[])[]): string {
  for (const r of rows) if (r.length !== columns.length) throw new Error("CSV row width differs from its columns");
  return [columns.map((c) => cell(c.name)), ...rows.map((r) => r.map(cell))].map((r) => r.join(",")).join("\n") + "\n";
}

export const DICTIONARY_COLUMNS: readonly CsvColumn[] = [
  { name: "column", type: "string", unit: "", source: "data dictionary" },
  { name: "type", type: "string", unit: "", source: "data dictionary" },
  { name: "unit", type: "string", unit: "", source: "data dictionary" },
  { name: "source", type: "string", unit: "", source: "data dictionary" },
];

export function dictionaryCsv(columns: readonly CsvColumn[]): string {
  return toCsv(DICTIONARY_COLUMNS, columns.map((c) => [c.name, c.type, c.unit, c.source + (c.type === "string" ? "; formula-leading text is prefixed with an apostrophe for spreadsheet safety" : "")]));
}

/** RFC 4180 reader (quoted fields, doubled quotes, embedded newlines). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false, i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i += 2; continue; }
      if (ch === '"') { quoted = false; i++; continue; }
      field += ch; i++; continue;
    }
    if (ch === '"' && field === "") { quoted = true; i++; continue; }
    if (ch === ",") { row.push(field); field = ""; i++; continue; }
    if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
    if (ch === "\r") { i++; continue; }
    field += ch; i++;
  }
  if (quoted) throw new Error("unterminated quoted CSV field");
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** Shared columns for every numeric row: the value, how it printed, and where it came from. */
export const VALUE_COLUMNS: readonly CsvColumn[] = [
  { name: "statistic", type: "string", unit: "", source: "template: statistic name" },
  { name: "value", type: "number", unit: "see unit column", source: "CertifiedFact.value (full precision)" },
  { name: "unit", type: "string", unit: "", source: "CertifiedFact.unit" },
  { name: "ci_level", type: "number", unit: "proportion", source: "CertifiedFact.ciLevel (interval level; empty when not an interval bound)" },
  { name: "display", type: "string", unit: "", source: "decision-preserving formatter output, as printed" },
  { name: "grade", type: "string", unit: "", source: "CertifiedFact.grade (kernel, exec, unverified, published)" },
  { name: "fact_id", type: "string", unit: "", source: "CertifiedFact.id" },
  { name: "source_record_id", type: "string", unit: "", source: "CertifiedFact.sourceRecordId" },
];
