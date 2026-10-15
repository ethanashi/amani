// The units contract (G1a) and the split contract (G1b), design section 5:
// - outputs/units.tsv lists only software effective units, none repeated, row count = n_units, and
//   run_all.sh reads the software effective inputs (prepare.sh).
// - splits.tsv (held-out estimands) assigns every unit to exactly one fold.
// Evidence holds counts and row numbers only: unit IDs are never printed.

import { gateResult, type GateResult } from "./gates.ts";
import { IssueLog } from "./issues.ts";
import { normKey } from "./json.ts";
import type { PrimaryOutputs } from "./primary.ts";

export interface Table {
  readonly header: readonly string[] | null;
  readonly rows: readonly (readonly string[])[];
  /** 1-based source line of each row. */
  readonly lines: readonly number[];
}

const UNIT_HEADERS = new Set(["unitid", "unit", "id", "subjectid", "subject", "patientid", "patient", "donorid", "donor",
  "participantid", "participant", "individualid", "individual", "unitidentifier"]);
const FOLD_HEADERS = new Set(["fold", "split", "set", "partition", "group", "subset", "foldid", "splitid", "role"]);

function cell(value: string): string {
  const t = value.trim();
  return t.length >= 2 && t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1).replaceAll('""', '"').trim() : t;
}

/** Lenient TSV: BOM, CRLF, blank lines and comma-separated files are accepted with warnings. */
export function parseDelimited(text: string, log: IssueLog, path: string, headerNames: ReadonlySet<string>): Table {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const all = source.split(/\r?\n/);
  while (all.length > 0 && all.at(-1)!.trim() === "") all.pop();
  const tab = all.some((line) => line.includes("\t"));
  const comma = !tab && all.some((line) => line.includes(","));
  if (comma) log.warn("lenient-format", path, "comma-separated file read as TSV");
  const rows: string[][] = [];
  const lines: number[] = [];
  let blanks = 0;
  all.forEach((line, index) => {
    if (line.trim() === "") { blanks += 1; return; }
    rows.push((tab ? line.split("\t") : comma ? line.split(",") : [line]).map(cell));
    lines.push(index + 1);
  });
  if (blanks > 0) log.warn("blank-lines", path, `${blanks} blank line(s) skipped`);
  let header: string[] | null = null;
  if (rows.length > 0 && rows[0]!.some((c) => headerNames.has(normKey(c)))) {
    header = rows.shift()!;
    lines.shift();
  }
  return { header, rows, lines };
}

/** Does run_all.sh invoke the software prepare.sh (effective inputs)? Comments are ignored. */
export function invokesPrepare(script: string): boolean {
  return script.split(/\r?\n/).some((line) => {
    const code = line.replace(/(^|\s)#.*$/, "$1");
    return /(^|[\s;&|(`'"=])(?:\.\/|\$\{?\w+\}?\/|[\w.\-]+\/)*prepare\.sh(?=$|[\s;&|)`'"])/.test(code);
  });
}

export function readUnitIds(text: string, log: IssueLog): { ids: string[]; blanks: number[] } {
  const table = parseDelimited(text, log, "units.tsv", UNIT_HEADERS);
  let column = 0;
  if (table.header) column = table.header.findIndex((c) => UNIT_HEADERS.has(normKey(c)));
  else log.warn("no-header", "units.tsv", "no header row; the first column is read as unit IDs");
  const ids: string[] = [];
  const blanks: number[] = [];
  table.rows.forEach((row, index) => {
    const id = row[column] ?? "";
    if (id === "") blanks.push(table.lines[index]!);
    else ids.push(id);
  });
  return { ids, blanks };
}

export interface G1aInput {
  /** Trusted executor verified use of the software effective inputs; script text alone is not evidence. */
  readonly effectiveInputsVerified?: boolean;
  /** Software effective unit IDs from staging (G1); null when staging is unavailable. */
  readonly effectiveUnits: ReadonlySet<string> | null;
  /** outputs/units.tsv text; null when the file is missing. */
  readonly unitsTsv: string | null;
  readonly primary: PrimaryOutputs | null;
  /** run_all.sh text; null when missing. */
  readonly runAllScript: string | null;
}

interface Finding { readonly code: string; readonly count?: number; readonly detail: string }

export function evaluateG1a(input: G1aInput): GateResult {
  if (input.effectiveUnits === null) {
    return gateResult("G1a", "not-run", "software effective units are unavailable (G1 staging has not run)", { code: "staging-unavailable" });
  }
  const findings: Finding[] = [];
  if (input.runAllScript === null) findings.push({ code: "run-all-missing", detail: "run_all.sh is missing" });
  else if (!invokesPrepare(input.runAllScript)) findings.push({ code: "effective-inputs-not-used", detail: "run_all.sh does not run the software prepare.sh" });
  const log = new IssueLog();
  let rows = 0;
  if (input.unitsTsv === null) findings.push({ code: "units-missing", detail: "outputs/units.tsv is missing" });
  else {
    const { ids, blanks } = readUnitIds(input.unitsTsv, log);
    rows = ids.length + blanks.length;
    if (rows === 0) findings.push({ code: "units-empty", detail: "outputs/units.tsv lists no units" });
    if (blanks.length > 0) findings.push({ code: "blank-unit-ids", count: blanks.length, detail: `${blanks.length} row(s) without a unit ID` });
    const seen = new Map<string, number>();
    for (const id of ids) seen.set(id, (seen.get(id) ?? 0) + 1);
    const repeatedIds = [...seen.values()].filter((n) => n > 1);
    if (repeatedIds.length > 0) {
      const extra = repeatedIds.reduce((s, n) => s + n - 1, 0);
      findings.push({ code: "repeated-units", count: extra, detail: `${repeatedIds.length} unit(s) listed more than once (${extra} extra row(s))` });
    }
    const outside = [...seen.keys()].filter((id) => !input.effectiveUnits!.has(id)).length;
    const omitted=[...input.effectiveUnits].filter(id=>!seen.has(id)).length;
    if(omitted>0)findings.push({code:'effective-units-omitted',count:omitted,detail:'software effective units silently omitted'});
    if (outside > 0) findings.push({ code: "non-effective-units", count: outside, detail: `${outside} listed unit(s) are not software effective units` });
  }
  const nUnits = input.primary?.nUnits ?? null;
  if (nUnits === null) findings.push({ code: "n-units-missing", detail: "primary.json reports no n_units" });
  else if (input.unitsTsv !== null && nUnits !== rows) findings.push({ code: "count-mismatch", detail: `primary.json n_units ${nUnits} differs from the ${rows} row(s) of units.tsv` });
  if (input.primary && input.unitsTsv !== null) {
    const over = [...input.primary.entries.values()].filter((e) => e.nUnits !== null && e.nUnits > rows).length;
    const under=[...input.primary.entries.values()].filter(e=>e.nUnits!==null&&e.nUnits<rows).length;
    if(under>0)findings.push({code:'claim-n-omits-units',count:under,detail:'claim blocks omit effective units'});
    if (over > 0) findings.push({ code: "claim-n-exceeds-units", count: over, detail: `${over} block(s) report more units than units.tsv lists` });
  }
  if (input.effectiveInputsVerified !== true) findings.push({ code: "effective-inputs-unverified", detail: "executor has not verified effective-input use" });
  const evidence = {
    effectiveInputsVerified: input.effectiveInputsVerified === true,
    rows, nUnits, effectiveN: input.effectiveUnits.size,
    findings: findings.map((f) => ({ code: f.code, ...(f.count === undefined ? {} : { count: f.count }) })),
    warnings: log.warnings.map((w) => w.code),
  };
  if (findings.length > 0) {
    return gateResult("G1a", "failed", `units not verified (n may be inflated): ${findings.map((f) => f.detail).join("; ")}`, { code: findings[0]!.code, evidence });
  }
  return gateResult("G1a", "passed", `${rows} software effective unit(s), none repeated, matching n_units`, { evidence });
}

export interface G1bInput {
  readonly effectiveUnits: ReadonlySet<string> | null;
  /** splits.tsv text; null when the file is missing. */
  readonly splitsTsv: string | null;
}

export function evaluateG1b(input: G1bInput): GateResult {
  if (input.effectiveUnits === null) return gateResult("G1b", "not-run", "software effective units are unavailable", { code: "staging-unavailable" });
  if (input.splitsTsv === null) return gateResult("G1b", "failed", "a held-out estimand requires splits.tsv", { code: "splits-missing" });
  const log = new IssueLog();
  const table = parseDelimited(input.splitsTsv, log, "splits.tsv", new Set([...UNIT_HEADERS, ...FOLD_HEADERS]));
  let unitCol: number;
  let foldCol: number;
  if (table.header) {
    unitCol = table.header.findIndex((c) => UNIT_HEADERS.has(normKey(c)) && normKey(c) !== "id");
    if (unitCol < 0) unitCol = table.header.findIndex((c) => UNIT_HEADERS.has(normKey(c)));
    foldCol = table.header.findIndex((c) => FOLD_HEADERS.has(normKey(c)));
  } else if (table.rows.every((r) => r.length === 2)) {
    log.warn("no-header", "splits.tsv", "no header row; columns read as unit, fold");
    unitCol = 0;
    foldCol = 1;
  } else {
    return gateResult("G1b", "failed", "splits.tsv needs a header naming the unit and fold columns", { code: "splits-header-missing" });
  }
  if (unitCol < 0 || foldCol < 0) return gateResult("G1b", "failed", "splits.tsv header lacks a unit or fold column", { code: "splits-header-missing" });
  const folds = new Map<string, Set<string>>();
  let blank = 0;
  for (const row of table.rows) {
    const unit = row[unitCol] ?? "";
    const fold = row[foldCol] ?? "";
    if (!unit || !fold) { blank += 1; continue; }
    const set = folds.get(unit) ?? new Set<string>();
    set.add(fold);
    folds.set(unit, set);
  }
  const allFolds = new Set([...folds.values()].flatMap((s) => [...s]));
  const leaked = [...folds.values()].filter((s) => s.size > 1).length;
  const outside = [...folds.keys()].filter((u) => !input.effectiveUnits!.has(u)).length;
  const findings: Finding[] = [];
  if (table.rows.length === 0) findings.push({ code: "splits-empty", detail: "splits.tsv has no rows" });
  if (blank > 0) findings.push({ code: "blank-split-cells", count: blank, detail: `${blank} row(s) without a unit or fold` });
  if (leaked > 0) findings.push({ code: "unit-in-multiple-folds", count: leaked, detail: `${leaked} unit(s) appear in more than one fold (leakage)` });
  if (outside > 0) findings.push({ code: "non-effective-units", count: outside, detail: `${outside} unit(s) are not software effective units` });
  if (table.rows.length > 0 && allFolds.size < 2) findings.push({ code: "single-fold", detail: "fewer than two folds" });
  const evidence = { rows: table.rows.length, units: folds.size, folds: allFolds.size, findings: findings.map((f) => f.code) };
  if (findings.length > 0) return gateResult("G1b", "failed", `splits not unit-disjoint: ${findings.map((f) => f.detail).join("; ")}`, { code: findings[0]!.code, evidence });
  return gateResult("G1b", "passed", `${folds.size} unit(s) in ${allFolds.size} unit-disjoint folds`, { evidence });
}
