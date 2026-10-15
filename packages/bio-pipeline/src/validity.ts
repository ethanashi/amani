import { readFileSync } from "node:fs";
import path from "node:path";
import { validateArtifactPath } from "../../bio-core/src/index.ts";
import { parseMissingValues, isUninformative, type MissingValuePolicy } from "../../bio-checks/src/validity/duplicates.ts";
import { validity } from "../../bio-checks/src/index.ts";

/** Column-axis tables declare their leading feature annotation headers separately
 * from sample IDs. Each subsequent row names a feature/metadata field. */
export interface TabularDeclaration {
  file: string;
  format: "csv" | "tsv" | "json";
  sampleAxis: "rows" | "columns";
  idField: string;
  featureFields?: string[];
  missingValues?: MissingValuePolicy;
  compareFields?: string[];
  vectorFields?: string[];
  subsetJustification?: string;
  unitOfAnalysis: "sample" | "donor" | "cellLine";
  donorField?: string;
  cellLineField?: string;
  declaredN: number;
  handling: "reject" | "collapse" | "exact";
  nearDuplicates?: { threshold: number };
  split?: { field: string; train: string; test: string };
}
export interface GateFinding { name: string; passed: boolean; evidence: unknown }
export interface DatasetGate {
  file: string;
  allowed: boolean;
  decision: string;
  effectiveN: number | null;
  rowCount: number | null;
  units: string[][];
  findings: GateFinding[];
}
export interface DatasetExclusion { file: string; reason: string }
export const validityPolicy = "full-content-v6-cross-table-classes";
export interface ValidityEvidence { declarationOverrides?: import("./inference.ts").DeclarationOverride[]; policy?: typeof validityPolicy; allowed: boolean; datasets: DatasetGate[]; exclusions?: DatasetExclusion[] }

export function datasetExclusions(value: unknown): DatasetExclusion[] {
  if (!Array.isArray(value) || value.length > 64) throw new Error("invalid dataset exclusions");
  return value.map(item => {
    const d = obj(item);
    if (Object.keys(d).sort().join() !== "file,reason") throw new Error("exclusion requires exactly file and reason");
    name(d.file); validateArtifactPath(d.file); name(d.reason);
    return { file: d.file, reason: d.reason };
  });
}

export function requireDatasetCoverage(staged: readonly string[], declarations: TabularDeclaration[], exclusions: DatasetExclusion[] = []): void {
  const files = [...declarations, ...exclusions].map(d => d.file);
  if (new Set(staged).size !== staged.length || new Set(files).size !== files.length ||
    files.length !== staged.length || files.some(file => !staged.includes(file))) {
    throw new Error("every staged file requires exactly one tabular declaration or explicit exclusion with a reason");
  }
}

function obj(x: unknown): Record<string, unknown> {
  if (!x || typeof x !== "object" || Array.isArray(x)) throw new Error("validity declaration must be an object");
  return x as Record<string, unknown>;
}
function name(x: unknown): asserts x is string {
  if (typeof x !== "string" || !x.trim() || x.length > 1024) throw new Error("missing or invalid validity field name");
}
function fields(x: unknown): asserts x is string[] {
  if (!Array.isArray(x) || !x.length || x.length > 100000) throw new Error("missing comparison fields or sample vectors");
  x.forEach(name);
  if (new Set(x).size !== x.length) throw new Error("duplicate validity field");
}
export function tabularDeclarations(value: unknown): TabularDeclaration[] {
  if (!Array.isArray(value) || !value.length || value.length > 64) throw new Error("missing tabular dataset declarations (including sampleAxis)");
  const declarations = value.map(item => {
    const d = obj(item);
    const permitted = ["file", "format", "sampleAxis", "idField", "compareFields", "vectorFields", "subsetJustification", "unitOfAnalysis", "donorField", "cellLineField", "declaredN", "handling", "nearDuplicates", "split", "featureFields", "missingValues"];
    if (Object.keys(d).some(k => !permitted.includes(k))) throw new Error("unknown validity declaration field");
    name(d.file); validateArtifactPath(d.file); name(d.idField);
    if (!["csv", "tsv", "json"].includes(d.format as string)) throw new Error("missing or unsupported tabular format");
    if (!["rows", "columns"].includes(d.sampleAxis as string)) throw new Error("missing or unsupported sampleAxis declaration");
    if (d.sampleAxis === "columns" && d.format === "json") throw new Error("column-axis JSON is unsupported");
    if (!["sample", "donor", "cellLine"].includes(d.unitOfAnalysis as string)) throw new Error("missing unitOfAnalysis declaration");
    if (!["reject", "collapse", "exact"].includes(d.handling as string)) throw new Error("missing duplicate handling declaration");
    if (!Number.isSafeInteger(d.declaredN) || (d.declaredN as number) < 1) throw new Error("missing or invalid declaredN");
    if (d.subsetJustification !== undefined && (typeof d.subsetJustification !== "string" || !d.subsetJustification.trim() || d.subsetJustification.length > 1024)) throw new Error("subset comparison requires an explicit subsetJustification");
    if (d.featureFields !== undefined) {
      fields(d.featureFields);
      if (d.sampleAxis !== "columns" || d.featureFields[0] !== d.idField) throw new Error("featureFields must be leading column-axis annotations starting with idField");
    }
    parseMissingValues(d.missingValues);
    if (d.compareFields !== undefined) fields(d.compareFields);
    if (d.vectorFields !== undefined) fields(d.vectorFields);
    const compared = [...(d.compareFields as string[] ?? []), ...(d.vectorFields as string[] ?? [])];
    if (compared.includes(d.idField) || new Set(compared).size !== compared.length) throw new Error("ID or repeated field in duplicate comparison");
    if (d.donorField !== undefined || d.unitOfAnalysis !== "cellLine" || d.split !== undefined) name(d.donorField);
    if (d.cellLineField !== undefined || d.unitOfAnalysis === "cellLine") name(d.cellLineField);
    for (const key of [d.donorField, d.cellLineField]) if (key !== undefined && compared.includes(key as string)) throw new Error("identity metadata cannot be duplicate content");
    if (d.nearDuplicates !== undefined) {
      const near = obj(d.nearDuplicates);
      if (Object.keys(near).join() !== "threshold" || typeof near.threshold !== "number" || !Number.isFinite(near.threshold) || near.threshold <= 0 || near.threshold >= 1 || !d.vectorFields) throw new Error("nearDuplicates requires numeric vectorFields and a threshold in (0,1)");
    }
    if (d.split !== undefined) {
      const split = obj(d.split);
      if (Object.keys(split).sort().join() !== "field,test,train") throw new Error("invalid split declaration");
      name(split.field); name(split.train); name(split.test);
      if (compared.includes(split.field)) throw new Error("split assignment cannot be duplicate content");
      if ([d.idField, d.donorField, d.cellLineField].includes(split.field)) throw new Error("split field aliases identity metadata");
      if (split.train === split.test || isUninformative(split.train) || isUninformative(split.test)) throw new Error("ambiguous or missing split assignment declaration");
    }
    return structuredClone(d) as unknown as TabularDeclaration;
  });
  if (new Set(declarations.map(d => d.file)).size !== declarations.length) throw new Error("repeated dataset declaration");
  return declarations;
}

/** Strict RFC-style delimited reader: quoted separators/newlines and escaped
 * quotes are supported; malformed quotes, blank/duplicate headers and ragged rows refuse. */
export function delimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], field = "", quoted = false, closed = false;
  const push = () => { row.push(field); field = ""; closed = false; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c !== '"') field += c;
      else if (text[i + 1] === '"') { field += '"'; i++; }
      else { quoted = false; closed = true; }
    } else if (c === delimiter) push();
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      push(); rows.push(row); row = [];
    } else if (c === '"' && !field && !closed) quoted = true;
    else { if (closed || c === '"') throw new Error("malformed quoted table"); field += c; }
  }
  if (quoted) throw new Error("unterminated quoted table");
  if (field || closed || row.length) { push(); rows.push(row); }
  if (rows.length < 2 || rows.some(r => r.length !== rows[0]!.length)) throw new Error("empty or ragged table");
  fields(rows[0]); return rows;
}
function readTable(dataDir: string, d: TabularDeclaration): Record<string, unknown>[] {
  const text = readFileSync(path.join(dataDir, d.file), "utf8");
  let rows: Record<string, unknown>[];
  if (d.format === "json") {
    const json: unknown = JSON.parse(text);
    if (!Array.isArray(json) || !json.length) throw new Error("JSON table must be a nonempty array of records");
    rows = json.map(obj);
  } else {
    const [header, ...body] = delimited(text, d.format === "csv" ? "," : "\t");
    if (d.sampleAxis === "rows") rows = body.map(values => Object.fromEntries(header!.map((key, i) => [key, values[i]!])));
    else {
      if (header![0] !== d.idField) throw new Error("column-axis first header must equal idField");
      const annotations = d.featureFields ?? [d.idField];
      if (annotations.length >= header!.length || annotations.some((key, i) => key !== header![i])) throw new Error("featureFields must match leading annotation headers and leave sample columns");
      if (header!.includes("Entrez_Gene_Id") && !annotations.includes("Entrez_Gene_Id")) throw new Error("declare Entrez_Gene_Id in featureFields; annotation is not a sample");
      for (const row of body) for (let i = 0; i < annotations.length; i++) name(row[i]);
      const keys = body.map(r => r[0]!); fields(keys);
      if (keys.includes(d.idField)) throw new Error("column-axis field aliases sample ID");
      rows = header!.slice(annotations.length).map((id, i) => Object.fromEntries([[d.idField, id], ...body.map(r => [r[0]!, r[i + annotations.length]!])]));
    }
  }
  return rows;
}

/** preserveText validates numeric fields but keeps the original cell text, so the
 * materialized analysis input is a pure selection/transposition of the raw cells. */
export function readRows(dataDir: string, d: TabularDeclaration, preserveText = false): Record<string, unknown>[] {
  const rows = readTable(dataDir, d);
  const missing = parseMissingValues(d.missingValues);
  const required = [d.idField, ...(d.compareFields ?? []), ...(d.vectorFields ?? []), ...(d.donorField ? [d.donorField] : []), ...(d.cellLineField ? [d.cellLineField] : []), ...(d.split ? [d.split.field] : [])];
  const schema = Object.keys(rows[0]!);
  const numericFields = d.sampleAxis === "columns"
    ? schema.filter(k => ![d.idField, d.donorField, d.cellLineField, d.split?.field].includes(k)) : d.vectorFields ?? [];
  for (const row of rows) {
    if (Object.keys(row).length !== schema.length || schema.some(key => !Object.hasOwn(row, key))) throw new Error("inconsistent record schema");
    for (const key of required) if (!Object.hasOwn(row, key) || row[key] === null || row[key] === undefined) throw new Error(`missing value for ${key}`);
    for (const key of numericFields) {
      const value = row[key];
      if (missing.policy === "token" && typeof value === "string" && missing.tokens.includes(value)) continue;
      if (typeof value !== "number" && (typeof value !== "string" || !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value))) throw new Error(`nonnumeric vector field ${key}`);
      if (!Number.isFinite(Number(value))) throw new Error(`nonfinite vector field ${key}`);
      if (!preserveText) row[key] = Number(value);
    }
    for (const key of [d.idField, d.donorField, d.cellLineField].filter((k): k is string => !!k)) name(row[key]);
    if (d.split && row[d.split.field] !== d.split.train && row[d.split.field] !== d.split.test) throw new Error("unknown split assignment");
  }
  return rows;
}

function contentFields(rows: Record<string, unknown>[], d: TabularDeclaration): string[] {
  return Object.keys(rows[0]!).filter(k => ![d.idField, d.donorField, d.cellLineField, d.split?.field].includes(k));
}
function requireSubsetJustification(rows: Record<string, unknown>[], d: TabularDeclaration): boolean {
  const selected = [...(d.compareFields ?? []), ...(d.vectorFields ?? [])];
  const subset = selected.length > 0 && contentFields(rows, d).some(k => !selected.includes(k));
  if (subset && !d.subsetJustification?.trim()) throw new Error("subset comparison requires an explicit subsetJustification");
  return subset;
}
/** Inspect the staged schema before approval, without requiring numeric missing-value
 * handling yet: that may be supplied by the bounded gate amendment. */
export function validateComparisonDeclarations(dataDir: string, declarations: TabularDeclaration[]): void {
  for (const d of declarations) requireSubsetJustification(readTable(dataDir, d), d);
}

const numericText = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;
/** An independent opposite-axis audit. Equal numeric columns are ambiguous even if
 * the model calls them features. Refuse and require an explicit column-axis plan. */
function checkSampleAxis(rows: Record<string, unknown>[], d: TabularDeclaration, otherIds: Set<string>, findings: GateFinding[]): void {
  if (d.sampleAxis !== "rows") return;
  const content = contentFields(rows, d);
  const matches = content.filter(k => otherIds.has(k));
  if (matches.length) {
    findings.push({ name: "sample-axis", passed: false, evidence: { matches, reason: "row-axis headers match sample identities in another declared table" } });
    throw new Error("ambiguous sampleAxis: headers match sample identities in another declared table");
  }
  const declared = parseMissingValues(d.missingValues);
  const tokens = [...new Set(["NA", "", ...rows.flatMap(row => Object.values(row).filter((v): v is string => isUninformative(v))), ...(declared.policy === "token" ? declared.tokens : [])])];
  const numericColumns = content.filter(k => rows.every(r => typeof r[k] === "number" && Number.isFinite(r[k]) ||
    typeof r[k] === "string" && (tokens.includes(r[k]) || numericText.test(r[k]) && Number.isFinite(Number(r[k])))) &&
    rows.some(r => !tokens.includes(String(r[k]))));
  if (numericColumns.length < 2) return;
  const columns = numericColumns.map(id => ({ id, vector: rows.map(r => typeof r[id] === "string" && tokens.includes(r[id]) ? r[id] : Number(r[id])) }));
  const audit = validity.detectContentDuplicates({ rows: columns, idField: "id", vectorOf: "vector", tolerance: 0, missingValues: { policy: "token", tokens } });
  if (!audit.checked || audit.groups.length > 0) {
    findings.push({ name: "sample-axis", passed: false, evidence: audit });
    throw new Error("ambiguous sampleAxis: duplicate numeric columns require a column-axis declaration; no sample verification");
  }
}

/** cBioPortal's schema dictionary describes attributes, not study subjects.
 * Its ATTRIBUTE_ID values naturally equal clinical column headers. */
export function isAttributeDictionary(headers: readonly string[]): boolean {
  const keys = new Set(headers.map(key => key.toUpperCase()));
  return ["ATTRIBUTE_ID", "LEVEL", "DATATYPE", "DISPLAY_NAME", "DESCRIPTION"].every(key => keys.has(key));
}

export function runValidityGates(dataDir: string, stagedFiles: readonly string[], declarations: TabularDeclaration[], exclusions: DatasetExclusion[] = [], policy: { exploratory: boolean } = { exploratory: false }): ValidityEvidence {
  declarations = tabularDeclarations(declarations);
  exclusions = datasetExclusions(exclusions);
  requireDatasetCoverage(stagedFiles, declarations, exclusions);
  // Read independently: a failed source still fails its own gate, never supplies identities.
  const tables = declarations.map(d => { try { return readRows(dataDir, d); } catch { return null; } });
  const datasets = declarations.map((d, index): DatasetGate => {
    const findings: GateFinding[] = [];
    try {
      const rows = tables[index] ?? readRows(dataDir, d);
      const otherIds = new Set<string>();
      for (let i = 0; i < declarations.length; i++) if (i !== index) {
        const other = declarations[i]!;
        if (other.sampleAxis === "rows" && isAttributeDictionary(Object.keys(tables[i]?.[0] ?? {}))) continue;
        for (const row of tables[i] ?? []) for (const key of [other.idField, other.donorField]) if (key && typeof row[key] === "string") otherIds.add(row[key]);
      }
      if (d.sampleAxis === "columns" && /^(?:sample|patient|donor)(?:_?id)?$/i.test(d.idField)) {
        findings.push({ name: "sample-axis", passed: false, evidence: { reason: "column-axis leading identity describes subjects, not features" } });
        throw new Error("ambiguous sampleAxis: column-axis leading identity describes subjects, not features");
      }
      checkSampleAxis(rows, d, otherIds, findings);
      // The software owns the comparison basis. A model-selected subset can only
      // add a suspected finding, never weaken the full-content duplicate check.
      const content = contentFields(rows, d);
      fields(content);
      const selected = [...(d.compareFields ?? []), ...(d.vectorFields ?? [])];
      const subset = requireSubsetJustification(rows, d);
      const numeric = d.sampleAxis === "columns" ? content : d.vectorFields;
      const vectorOf = numeric?.length ? (row: Readonly<Record<string, unknown>>) => numeric.map(k => row[k]) : undefined;
      const numericSet = new Set(numeric);
      const scalar = content.filter(k => !numericSet.has(k));
      const exact = validity.detectContentDuplicates({ rows, idField: d.idField, tolerance: 0, missingValues: parseMissingValues(d.missingValues),
        ...(scalar.length ? { compareFields: scalar } : {}), ...(vectorOf ? { vectorOf } : {}),
        // Split assignments are required, informative content. Excluding them from
        // equality must preserve the full-width eligibility floor: count + 1.
        ...(d.split ? { minimumInformative: { fields: Math.max(1, Math.min(3, content.length + 1) - 1),
          share: Math.max(1, Math.ceil((content.length + 1) / 2) - 1) / content.length } } : {}) });
      findings.push({ name: "content-duplicates", passed: exact.valid, evidence: { ...exact, comparison: "all non-identity content", fields: content } });
      if (!exact.checked) throw new Error(exact.reason);
      const fullGroup = new Map(exact.checkedIds.map(id => [id, id]));
      for (const group of exact.groups) for (const id of group.ids) fullGroup.set(id, group.ids[0]!);
      let suspected = false;
      if (subset) {
        const partial = validity.detectContentDuplicates({ rows, idField: d.idField, tolerance: 0, compareFields: selected });
        if (!partial.checked) throw new Error(partial.reason);
        const suspectedGroups = partial.groups.filter(g => new Set(g.ids.map(id => fullGroup.get(id))).size > 1);
        suspected = suspectedGroups.length > 0;
        const insufficient = partial.status === "insufficient-information";
        findings.push({ name: "subset comparison", passed: !suspected && !insufficient, evidence: { ...partial,
          modelStatedJustification: { text: d.subsetJustification, attribution: "model-stated, unverified" }, suspectedGroups, status: suspected ? "suspected" : insufficient ? "insufficient-information" : "full-content verified",
          reason: suspected ? "suspected duplicates differ on full content; human review required" : insufficient ? "insufficient information to establish duplication on the subset; full-content evidence controls merging" : "subset matches verified against all non-identity content" } });
      }
      const duplicateEvidence: validity.DuplicateEvidence[] = [exact];
      if (d.nearDuplicates) {
        const near = validity.detectNearDuplicates({ rows, idField: d.idField, vectorOf: vectorOf!, threshold: d.nearDuplicates.threshold, missingValues: parseMissingValues(d.missingValues) });
        findings.push({ name: "near-duplicates", passed: near.valid, evidence: near }); duplicateEvidence.push(near);
        if (near.checked && (near.groups.length > 0 || near.identicalGroups.some(ids => new Set(ids.map(id => fullGroup.get(id))).size > 1))) suspected = true;
      }
      const collapsed = validity.effectiveUnits(duplicateEvidence);
      if (!collapsed.valid) throw new Error(collapsed.reason);
      const samples = rows.map(row => ({ sampleId: row[d.idField] as string, ...(d.donorField ? { donorId: row[d.donorField] as string } : {}), ...(d.cellLineField ? { cellLineId: row[d.cellLineField] as string } : {}) }));
      const pseudo = validity.checkPseudoReplication({ samples, unit: d.unitOfAnalysis, declaredN: d.declaredN });
      // Union duplicate evidence and biological units, including transitive overlap.
      const owner = new Map(samples.map((s, i) => [s.sampleId, i]));
      const roots = samples.map((_, i) => i);
      const find = (n: number): number => { while (roots[n] !== n) { roots[n] = roots[roots[n]!]!; n = roots[n]!; } return n; };
      const merge = (ids: string[]) => { if (!ids.length) return; const root = find(owner.get(ids[0]!)!); for (const id of ids) roots[find(owner.get(id)!)] = root; };
      // A sample table's low-information clinical content cannot establish that
      // different donors are one person. A donor table must corroborate that merge.
      const parentIndex = d.sampleAxis === "rows" && d.donorField !== d.idField
        ? declarations.findIndex((p, i) => i !== index && p.sampleAxis === "rows" && p.idField === d.donorField && p.donorField === p.idField) : -1;
      let crossTableBlocked = false, crossTableReason = "", crossTableDeviation = "";
      if (parentIndex >= 0) {
        const pd = declarations[parentIndex]!, parentRows = tables[parentIndex];
        if (!parentRows) throw new Error("cross-table donor confirmation unavailable");
        const parentContent = Object.keys(parentRows[0]!).filter(k => ![pd.idField, pd.donorField, pd.cellLineField].includes(k));
        const proof = validity.detectContentDuplicates({ rows: parentRows, idField: pd.idField, compareFields: parentContent, tolerance: 0,
          missingValues: parseMissingValues(pd.missingValues) });
        if (!proof.checked) throw new Error("cross-table donor confirmation unavailable");
        const parentClass = new Map(proof.checkedIds.map(id => [id, id]));
        for (const group of proof.groups) for (const id of group.ids) parentClass.set(id, group.ids[0]!);
        const parentById = new Map(parentRows.map(r => [r[pd.idField], r]));
        const counts = { "confirmed-same-donor": 0, refuted: 0, unverifiable: 0, orphan: 0 };
        const orphanReferences = samples.filter(s => !parentById.has(s.donorId!)).length;
        // Count every unordered sample pair, including pairs inside donor classes.
        // Missing references are checked even outside duplicate-content groups.
        for (const ids of collapsed.units) {
          const partitions = new Map<string, string[]>();
          for (const id of ids) {
            const donor = samples[owner.get(id)!]!.donorId!;
            if (!parentById.has(donor)) continue;
            const key = parentClass.get(donor) ?? donor;
            const members = partitions.get(key) ?? []; members.push(id); partitions.set(key, members);
          }
          for (let a = 0; a < ids.length; a++) for (let b = a + 1; b < ids.length; b++) {
            const leftId = samples[owner.get(ids[a]!)!]!.donorId!;
            const rightId = samples[owner.get(ids[b]!)!]!.donorId!;
            const left = parentById.get(leftId), right = parentById.get(rightId);
            if (!left || !right) counts.orphan++;
            else if ((parentClass.get(leftId) ?? leftId) === (parentClass.get(rightId) ?? rightId)) counts["confirmed-same-donor"]++;
            else if (parentContent.some(k => !isUninformative(left[k]) && !isUninformative(right[k]) && left[k] !== right[k])) counts.refuted++;
            else counts.unverifiable++;
          }
          // Only donor-corroborated partitions merge, in either plan mode.
          partitions.forEach(merge);
        }
        crossTableBlocked = orphanReferences > 0 || (counts.unverifiable > 0 && policy.exploratory !== true);
        crossTableReason = orphanReferences > 0 ? "orphan donor references; referential-integrity failure"
          : counts.unverifiable > 0 ? "donor records lack informative fields; identity remains unverified"
          : "sample matches merged only within confirmed donor units; distinct donor records retained";
        if (counts.unverifiable > 0 && policy.exploratory === true) crossTableDeviation = `Software decision / exploratory deviation: ${counts.unverifiable} unverifiable cross-table matches retained as distinct (donor records lack informative fields). `;
        findings.push({ name: "cross-table donor confirmation", passed: orphanReferences === 0 && counts.unverifiable === 0,
          evidence: { donorFile: pd.file, counts, orphanReferences,
            pairBasis: "unordered sample pairs within full-content duplicate groups",
            empiricalRefutationRate: counts.refuted + counts["confirmed-same-donor"] > 0
              ? counts.refuted / (counts.refuted + counts["confirmed-same-donor"]) : null,
            allowed: !crossTableBlocked, reason: crossTableReason } });
      } else collapsed.units.forEach(merge);
      const keys = d.unitOfAnalysis === "donor" ? ["donorId" as const] : d.unitOfAnalysis === "cellLine" ? ["cellLineId" as const] : ["donorId", "cellLineId"] as const;
      for (const key of keys) {
        const byUnit = new Map<string, string[]>();
        for (const sample of samples) if (sample[key]) { const ids = byUnit.get(sample[key]!) ?? []; ids.push(sample.sampleId); byUnit.set(sample[key]!, ids); }
        byUnit.forEach(merge);
      }
      const unitsByRoot = new Map<number, string[]>();
      for (const s of samples) { const r = find(owner.get(s.sampleId)!); const ids = unitsByRoot.get(r) ?? []; ids.push(s.sampleId); unitsByRoot.set(r, ids); }
      const units = [...unitsByRoot.values()], effectiveN = units.length;
      const unsafeSubsetUnits = subset ? units.filter(ids => new Set(ids.map(id => fullGroup.get(id))).size > 1) : [];
      if (unsafeSubsetUnits.length) {
        suspected = true;
        findings.push({ name: "subset collapse safety", passed: false, evidence: { status: "suspected", groups: unsafeSubsetUnits,
          reason: "subset comparison cannot collapse distinct full content via near-duplicate or biological-unit merging; human review required" } });
      }
      const representatives = units.map(ids => samples[owner.get(ids[0]!)!]!);
      const adjusted = validity.checkPseudoReplication({ samples: representatives, unit: d.unitOfAnalysis, declaredN: effectiveN });
      const decisive = validity.checkPseudoReplication({ samples: representatives, unit: d.unitOfAnalysis, declaredN: d.declaredN });
      findings.push({ name: "pseudo-replication", passed: decisive.valid,
        evidence: { ...decisive, beforeMerge: pseudo } });
      let splitValid = true;
      if (d.split) {
        const split = d.split;
        const donor = validity.checkDonorDisjoint({ train: samples.filter((_, i) => rows[i]![split.field] === split.train), test: samples.filter((_, i) => rows[i]![split.field] === split.test) });
        const leakedUnits = units.filter(ids => new Set(ids.map(id => rows[owner.get(id)!]![split.field])).size > 1);
        splitValid = donor.valid && leakedUnits.length === 0;
        findings.push({ name: "donor-disjoint", passed: splitValid, evidence: { ...donor, leakedUnits } });
      }
      const needsHandling = duplicateEvidence.some(e => !e.checked || (e.kind === "content-duplicates" ? e.groups.length > 0 : !e.valid)) || !pseudo.valid || d.declaredN > effectiveN;
      const biologicalMerge = new Set(samples.map(s => d.unitOfAnalysis === "cellLine" ? s.cellLineId : s.donorId)).size < samples.length;
      const automaticExact = d.handling === "exact" && !biologicalMerge && !d.nearDuplicates;
      const allowed = !crossTableBlocked && !suspected && adjusted.valid && splitValid && (!needsHandling || d.handling === "collapse" || automaticExact);
      const sparseNote = exact.information.insufficient.length ? `; insufficient information to establish duplication; ${exact.information.insufficient.length} sparse rows retained unverified for content duplication (declared biological identity still applies)` : "";
      return { file: d.file, allowed, effectiveN, rowCount: rows.length, units, findings,
        decision: (allowed ? crossTableDeviation : "") + (allowed && automaticExact && rows.length > effectiveN ? "Software decision / exploratory deviation: automatic exact full-content collapse; keep first source row. " : "") + (allowed ? (rows.length > effectiveN ? "collapse to effective units using first row in source order per unit" : exact.information.insufficient.length ? `${rows.length - exact.information.insufficient.length} rows checked for duplication` : crossTableDeviation ? "units retained; cross-table identity remains unverified" : "independent units verified") : crossTableBlocked ? `blocked: ${crossTableReason}; human review required` : suspected ? "blocked: suspected subset comparison or near duplicates; human review required (no automatic collapse)" : "blocked: duplicate/pseudo-replication handling absent or split leakage") + sparseNote };
    } catch (error) {
      const reason = error instanceof Error ? error.message : "validity check unavailable";
      findings.push({ name: "validity-input", passed: false, evidence: { reason } });
      return { file: d.file, allowed: false, decision: `blocked: ${reason}`, effectiveN: null, rowCount: null, units: [], findings };
    }
  });
  return { policy: validityPolicy, allowed: datasets.every(d => d.allowed), datasets, exclusions };
}

export const validityPrompt = `If returning legacy full declarations, datasets is mandatory: {file, format: "csv"|"tsv"|"json", sampleAxis: "rows"|"columns", idField, featureFields?: string[], missingValues?: {policy: "refuse"}|{policy: "token", tokens: string[]}, compareFields?: string[], vectorFields?: string[], subsetJustification?: string, unitOfAnalysis: "sample"|"donor"|"cellLine", donorField?: string, cellLineField?: string, declaredN: positive integer, handling: "reject"|"collapse", nearDuplicates?: {threshold}, split?: {field, train, test}}. Every staged file requires a declaration or an entry in exclusions: [{file, reason}]; excluded files are not checked and are unavailable to analysis. Software compares ALL non-identity fields by default (only id/donor/cell-line and declared split fields are excluded); matrices use full numeric sample vectors. Omit comparison field lists to use the default. A subset requires subsetJustification, is labeled subset comparison, and only full-content identical matches may collapse; differing matches are suspected and block for human review. sample/donor units and splits require donorField; cellLine requires cellLineField. Column-axis CSV/TSV uses idField as first header, featureFields lists ALL leading annotation headers including idField (e.g. ["Hugo_Symbol","Entrez_Gene_Id"]), remaining headers are sample IDs, and rows are named features/metadata. Row-axis declarations are refused if numeric columns duplicate or headers match identities in another declared table. Missing numeric values default to refuse; missingValues token policy explicitly names missing strings (e.g. ["NA",""]). Exact comparison requires identical gap positions and never imputes; other nonnumeric values refuse. Near correlation with token policy is not run and any declared near check remains unverified and blocks. Duplicate or replicated units block unless handling is collapse. Software supplies the first source row per effective unit; analysis tables always have sampleAxis rows and preserve all representative fields. Splits require donor-disjoint and duplicate-disjoint train/test.`;

export function validityMarkdown(evidence: ValidityEvidence, evidenceHash: string): string {
  const escape = (value: unknown) => String(value).replace(/\b(?:https?|ftp)(?=:\/\/)|\bwww(?=\.)/gi, "$&\u200b").replace(/[&<>`*_[\]\\|#.:]/g, c => `&#${c.charCodeAt(0)};`).replace(/[\r\n]/g, " ");
  const lines = ["## Automatic validity gates", "", `[Trusted findings](../authority/artifacts/${evidenceHash})`, ""];
  const rationale: string[] = (evidence.declarationOverrides ?? []).map(o => `- ${escape(o.file)}.${escape(o.field)} — Model-stated, unverified override justification: ${escape(o.justification)}`);
  for (const d of evidence.exclusions ?? []) {
    lines.push(`- Excluded (not checked): ${escape(d.file)}; excluded from analysis input.`);
    rationale.push(`- ${escape(d.file)} — Model-stated, unverified reason: ${escape(d.reason)}`);
  }
  for (const d of evidence.datasets) {
    lines.push(`- Dataset: ${escape(d.file)}; decision: ${escape(d.decision)}; effective n: ${d.effectiveN ?? "unverified"}.`);
    for (const f of d.findings) {
      const detail = f.evidence as Record<string, unknown>;
      lines.push(`- ${escape(f.name)}: ${f.passed ? "passed" : "failed"}; ${escape(String(detail.reason ?? "see trusted findings"))}`);
      if (f.name === "cross-table donor confirmation") {
        const counts = detail.counts as Record<string, number>;
        lines.push(`  Cross-table pairs: ${Object.entries(counts).map(([name, count]) => `${name}: ${count}`).join("; ")}; empirical refutation rate (refuted/(refuted+confirmed-same-donor)): ${detail.empiricalRefutationRate ?? "unavailable (no adjudicable pairs)"}; orphan references: ${detail.orphanReferences}.`);
      }
      if (detail.modelStatedJustification) rationale.push(`- ${escape(d.file)} — Model-stated, unverified justification: ${escape(String((detail.modelStatedJustification as { text: string }).text))}`);
      if (detail.information) lines.push(`  Insufficient information rows: ${escape(JSON.stringify((detail.information as { insufficient: unknown }).insufficient))}`);
      for (const key of ["groups", "leakedDonors", "leakedUnits"]) if (Array.isArray(detail[key]) && detail[key].length) lines.push(`  ${key}: ${escape(JSON.stringify(detail[key]))}`);
    }
  }
  if (rationale.length) lines.push("", "## Model-stated rationale (unverified)", "", ...rationale);
  return lines.join("\n") + "\n";
}
