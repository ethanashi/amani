import { readFileSync } from "node:fs";
import path from "node:path";
import { canonicalJson, validateArtifactPath } from "../../bio-core/src/index.ts";
import { isUninformative } from "../../bio-checks/src/validity/duplicates.ts";
import { delimited, datasetExclusions, isAttributeDictionary, type TabularDeclaration } from "./validity.ts";

export interface DeclarationProposal {
  file: string;
  declaration: TabularDeclaration | null;
  reason: string;
}
export interface DeclarationOverride { file: string; field: string; value: unknown; justification: string }
export interface DeclarationReview { confirm: true; handling?: "collapse" | "stop"; overrides?: DeclarationOverride[] }
const numeric = (v: unknown) => typeof v === "number" && Number.isFinite(v) || typeof v === "string" && /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(v) && Number.isFinite(Number(v));
const idLike = (value: unknown): value is string => typeof value === "string" && value.length <= 1024 && !isUninformative(value) && /^[\p{L}\p{N}][\p{L}\p{N}_.:@/-]*$/u.test(value);
const identityName = (name: string) => /^(?:id|sample|patient|donor|cellline)$|(?:_id|ID)$/i.test(name);
const sampleName = (name: string) => /^(?:MB-\d|(?:sample|patient)[_.-]|(?:sample|patient|tumou?r|s)[_.-]?\d)/i.test(name);
const subjectName = (name: string) => /^(?:id|sample|patient|donor)(?:_?id)?$/i.test(name);
function rank(name: string): number {
  if (/^(?:sample_?id|sample|id)$/i.test(name)) return 3;
  if (/^(?:patient_?id|patient)$/i.test(name)) return 2;
  return identityName(name) ? 1 : 0;
}

/** Data values never enter the CLI prompt. A null proposal is a refusal to guess,
 * carried to the draft as structured evidence so the reason remains inspectable. */
export function inferDeclarations(dataDir: string, files: readonly string[]): DeclarationProposal[] {
  const tables = files.map(file => {
    try {
      validateArtifactPath(file);
      const format = path.extname(file).slice(1).toLowerCase();
      const text = readFileSync(path.join(dataDir, file), "utf8");
      if (format === "csv" || format === "tsv") {
        const [header, ...body] = delimited(text, format === "csv" ? "," : "\t");
        return { file, format, header: header!, body };
      }
      if (format !== "json") throw new Error("unsupported tabular format; explicit exclusion required");
      const rows: unknown = JSON.parse(text);
      if (!Array.isArray(rows) || !rows.length || rows.some(r => !r || typeof r !== "object" || Array.isArray(r))) throw new Error("invalid JSON table");
      const header = Object.keys(rows[0]);
      if (!header.length || rows.some(r => canonicalJson(Object.keys(r).sort()) !== canonicalJson([...header].sort()))) throw new Error("inconsistent record schema");
      return { file, format, header, body: rows.map(r => header.map(k => r[k])) };
    } catch (error) { return { file, error: error instanceof Error ? error.message : "inference unavailable" }; }
  });
  const knownIds = new Set<string>();
  for (const table of tables) if (table.header && !isAttributeDictionary(table.header)) for (const [i, key] of table.header.entries()) {
    if (subjectName(key)) for (const row of table.body!) if (idLike(row[i])) knownIds.add(row[i]);
  }
  return tables.map(table => {
    const { file } = table;
    try {
      if (!table.header || !table.body || !table.format) throw new Error(table.error);
      const { header, body, format } = table;
      const detected = new Set<string>();
      for (const row of body) for (const value of row) if (typeof value === "string" && isUninformative(value)) detected.add(value);
      const tokens = [...detected].sort();
      const missingValues = tokens.length ? { policy: "token" as const, tokens } : { policy: "refuse" as const };
      // Known annotations include numeric identifier columns: Entrez IDs are not samples.
      let leading = 0;
      while (leading < header.length && (/^(?:hugo_symbol|entrez_gene_id|gene(?:_?id)?|symbol|feature)$/i.test(header[leading]!) ||
        body.some(row => !numeric(row[leading]) && !isUninformative(row[leading])))) leading++;
      const samples = header.slice(leading);
      const subjectRows = subjectName(header[0]!) && body.every(row => idLike(row[0])) && new Set(body.map(row => row[0])).size === body.length;
      const matrix = !subjectRows && format !== "json" && leading > 0 && samples.length > 0 &&
        body.every(row => row.slice(leading).every(v => numeric(v) || isUninformative(v))) &&
        (samples.every(key => knownIds.has(key)) || samples.filter(sampleName).length > samples.length / 2);
      if (matrix) {
        const declaration: TabularDeclaration = { file, format: format as "csv" | "tsv", sampleAxis: "columns", idField: header[0]!, featureFields: header.slice(0, leading),
          donorField: header[0]!, unitOfAnalysis: "sample", declaredN: samples.length, handling: "reject", missingValues };
        return { file, declaration, reason: "numeric sample columns; leading annotations excluded; full sample vectors" };
      }
      const candidates = header.filter((key, i) => rank(key) > 0 && body.every(row => idLike(row[i])) &&
        new Set(body.map(row => row[i])).size === body.length);
      const best = candidates.filter(key => rank(key) === Math.max(...candidates.map(rank)));
      if (best.length !== 1) throw new Error(`ambiguous id inference: ${best.length ? best.join(", ") : "no unique, non-empty id-like column"}; refusing to guess`);
      const idField = best[0]!;
      const donors = header.filter(key => key !== idField && /^(?:donor|patient)(?:_?id)?$/i.test(key));
      if (donors.length > 1) throw new Error("ambiguous donor inference; refusing to guess");
      const donorField = donors[0] ?? idField;
      const declaration: TabularDeclaration = { file, format: format as TabularDeclaration["format"], sampleAxis: "rows", idField, donorField,
        unitOfAnalysis: isAttributeDictionary(header) ? "sample" : "donor", declaredN: body.length, handling: "reject", missingValues };
      return { file, declaration, reason: isAttributeDictionary(header) ? "annotation dictionary records, not sample identities; all non-identity content" : "unique non-empty identity; all non-identity content; block for review on duplicates" };
    } catch (error) { return { file, declaration: null, reason: error instanceof Error ? error.message : "inference unavailable" }; }
  });
}

/** Resolve the compact confirmation protocol before the ordinary strict plan parser.
 * Only conservative, explicitly justified additions may change inferred fields. */
export function resolveDeclarationReview(value: unknown, proposals: DeclarationProposal[]): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const proposal = structuredClone(value) as { analysis?: Record<string, unknown> };
  const analysis = proposal.analysis;
  if (!analysis) return value;
  if (Object.hasOwn(analysis, "declarationOverrides")) throw new Error("declarationOverrides are software-owned; use declarationReview");
  if (!Object.hasOwn(analysis, "declarationReview")) return value;
  const review = analysis.declarationReview as DeclarationReview;
  if (!review || review.confirm !== true || Object.keys(review).some(k => !["confirm", "handling", "overrides"].includes(k)) ||
    (review.handling !== undefined && !["collapse", "stop"].includes(review.handling)) || Object.hasOwn(analysis, "datasets")) throw new Error("invalid declaration confirmation");
  const excluded = analysis.exclusions === undefined ? [] : datasetExclusions(analysis.exclusions);
  const datasets = proposals.filter(p => !excluded.some(e => e.file === p.file)).map(p => {
    if (!p.declaration) throw new Error(`${p.file}: ${p.reason}`);
    return { ...p.declaration, handling: review.handling === "collapse" ? "collapse" as const : review.handling === "stop" || analysis.exploratory !== true ? "reject" as const : "exact" as const };
  });
  if (review.overrides !== undefined && !Array.isArray(review.overrides)) throw new Error("invalid declaration overrides");
  const seen = new Set<string>();
  for (const override of review.overrides ?? []) {
    if (!override || Object.keys(override).sort().join() !== "field,file,justification,value" || typeof override.justification !== "string" || !override.justification.trim() || override.justification.length > 1024) throw new Error("override requires a written justification");
    const key = `${override.file}:${override.field}`;
    if (seen.has(key)) throw new Error("repeated declaration override");
    seen.add(key);
    const d = datasets.find(d => d.file === override.file);
    if (!d) throw new Error("unknown override dataset");
    // Identity/axis/content/missingness are software-owned. Splits and near checks
    // add requirements; they cannot remove the mandatory full-content comparison.
    if (!["split", "nearDuplicates", "vectorFields", "compareFields", "subsetJustification"].includes(override.field)) throw new Error(`weakening or unsupported declaration override: ${override.field}`);
    (d as unknown as Record<string, unknown>)[override.field] = override.value;
  }
  delete analysis.declarationReview;
  analysis.datasets = datasets;
  if (review.overrides?.length) analysis.declarationOverrides = review.overrides;
  return proposal;
}

/** Legacy full declarations are confirmations too, never an escape from inference.
 * Optional subset screens retain the existing full-content gate and review guard. */
export function validateInferredDeclarations(proposals: DeclarationProposal[], datasets: TabularDeclaration[], exclusions: { file: string; reason: string }[] = [], overrides: DeclarationOverride[] = []): void {
  for (const p of proposals) {
    if (exclusions.some(e => e.file === p.file)) continue; // unavailable to analysis, explicitly not checked
    if (!p.declaration) throw new Error(`${p.file}: ${p.reason}`);
    const d = datasets.find(d => d.file === p.file);
    if (!d) throw new Error("every staged file requires a declaration or explicit exclusion");
    for (const field of ["format", "sampleAxis", "idField", "donorField", "featureFields", "unitOfAnalysis", "declaredN"] as const) {
      const expected = field === "featureFields" ? p.declaration.featureFields ?? [p.declaration.idField] : p.declaration[field];
      const actual = field === "featureFields" ? d.featureFields ?? [d.idField] : d[field];
      if (canonicalJson(actual ?? null) !== canonicalJson(expected ?? null)) throw new Error(`weakening or unjustified declaration override: ${p.file}.${field}; confirm software inference`);
    }
    if (d.missingValues?.policy === "token" && d.missingValues.tokens.some(t => !isUninformative(t))) throw new Error("weakening missingValues override refused; only software-detected markers are allowed");
    if (d.cellLineField) throw new Error("weakening cellLineField identity override refused");
    if (d.split && [p.declaration.idField, p.declaration.donorField].includes(d.split.field)) throw new Error("weakening identity override refused");
    for (const field of ["split", "nearDuplicates", "vectorFields", "compareFields", "subsetJustification"] as const) {
      if (canonicalJson(d[field] ?? null) !== canonicalJson(p.declaration[field] ?? null) &&
        !overrides.some(o => o.file === d.file && o.field === field && canonicalJson(o.value) === canonicalJson(d[field]))) {
        throw new Error(`unjustified declaration override: ${p.file}.${field}; use declarationReview with a written justification`);
      }
    }
    if (p.declaration.missingValues?.policy === "token") {
      if (!d.missingValues) d.missingValues = structuredClone(p.declaration.missingValues);
      const missing = d.missingValues;
      if (missing.policy !== "token" || p.declaration.missingValues.tokens.some(t => !missing.tokens.includes(t))) throw new Error("weakening missingValues override refused; confirm detected tokens");
    }
  }
}
