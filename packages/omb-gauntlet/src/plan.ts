// plan.json: the lead's decision rule, parsed leniently ("fail soft on format") and locked by hash
// (G2). Case, whitespace, hyphen/underscore/camelCase and alias variants are accepted with warnings;
// software defaults fill gaps with warnings; only inputs that make a claim's decision rule
// unevaluable are refused. Software-owned values (alpha, tolerance caps) can only be tightened.

import { canonicalSha256 } from "../../bio-core/src/index.ts";
import { IssueLog, type Issue } from "./issues.ts";
import {
  compactEnum, finite, foldKey, isRecord, parseLenientJson, pickField, readNumber, toJson, unknownKeys, type Json,
} from "./json.ts";
import { POLICY } from "./policy.ts";

export const CLAIM_KINDS = [
  "data-integrity", "reproduction", "effect-exists", "effect-size", "null", "out-of-sample", "citation",
] as const;
export type ClaimKind = (typeof CLAIM_KINDS)[number];
/** Kinds decided by a p-value against a null value, with multiplicity families and MEI. */
export const STATISTICAL_KINDS: readonly ClaimKind[] = ["effect-exists", "effect-size", "null", "out-of-sample"];
export function isStatistical(kind: ClaimKind): boolean {
  return STATISTICAL_KINDS.includes(kind);
}

export type Direction = "two-sided" | "greater" | "less";
export type FamilyMethod = "holm" | "bh" | "bonferroni";

export interface CovariateRole {
  readonly covariate: string;
  readonly role: string;
  /** A strong covariate is handled by a role only when a reason is given. */
  readonly reason: string | null;
}

export interface ReproductionTarget {
  readonly value: number;
  /** null: the claim is decided by "target inside the recomputed CI". */
  readonly tolerance: { readonly abs: number; readonly rel: number } | null;
}

export interface PlanClaim {
  /** Case-folded claim ID (any metrics key). */
  readonly id: string;
  readonly kind: ClaimKind;
  /** Case-folded key of the claim's block in primary.json (default: the claim ID). */
  readonly metric: string;
  /** Data-integrity: software staging fact compared with the claim (default: metric). */
  readonly fact: string | null;
  /** Data-integrity: value asserted in the plan (else read from recomputed metrics). */
  readonly assertedValue: number | null;
  /** Descriptive prose; not part of the lock. */
  readonly statement: string | null;
  readonly estimand: string | null;
  readonly test: string | null;
  readonly direction: Direction;
  readonly alpha: number;
  /** Multiplicity family (statistical kinds only). */
  readonly family: string | null;
  /** Minimum effect of interest, a distance from nullValue on the estimate's scale. */
  readonly mei: number | null;
  /** Host-only original MEI for materiality; never populated by the plan parser. */
  readonly materialMei?: number | null;
  readonly unit: string | null;
  readonly exposure: string | null;
  readonly outcome: string | null;
  readonly adjustment: readonly string[];
  readonly strata: readonly string[];
  readonly roles: readonly CovariateRole[];
  readonly nullValue: number;
  readonly target: ReproductionTarget | null;
  /** "unit": the locked test is itself a unit-level permutation test (G5a waiver). */
  readonly permutationLevel: "unit" | "row" | null;
  readonly exploratory: boolean;
  /** Any other analysis settings, locked verbatim (unknown fields land here). */
  readonly knobs: Readonly<Record<string, Json>>;
}

export interface PlanFamily {
  readonly name: string;
  readonly method: FamilyMethod;
  /** Number of tests in the family (>= locked members; unlisted members count as p = 1). */
  readonly size: number;
  readonly screen: boolean;
}

export interface Plan {
  readonly schema: "omb/plan@1";
  readonly plainStatement?: string | null;
  readonly paperSet?: Json | null;
  /** Descriptive context, hash-locked but never interpreted as analysis instructions. */
  readonly sharedKnobs?: Readonly<Record<string, Json>>;
  readonly staging?: Readonly<Record<string, Json>>;
  readonly claims: readonly PlanClaim[];
  readonly families: readonly PlanFamily[];
  readonly knobs: Readonly<Record<string, Json>>;
}

export interface PlanParseResult {
  /** "refused" when any claim's decision rule is unevaluable or the file has no usable claim. */
  readonly status: "accepted" | "refused";
  /** The evaluable claims (also present when refused, so a caller may lock a partial plan after
   * its repair rounds; refused claims are then exploratory). null when nothing is evaluable. */
  readonly plan: Plan | null;
  readonly issues: readonly Issue[];
  readonly refusedClaims: readonly string[];
}

// ------------------------------------------------------------------ aliases

const CLAIM_CONTAINER = ["hypotheses", "decisionrules", "rules", "primaryclaims", "tests", "claimlist"];
const F = {
  id: ["claimid", "name", "hypothesisid", "claimname"],
  kind: ["claimkind", "type", "claimtype", "category"],
  metric: ["primarymetric", "metrickey", "primarymetrickey", "key", "primarykey", "resultkey"],
  fact: ["softwarefact", "integrityfact"],
  value: ["assertedvalue", "claimedvalue"],
  statement: ["description", "hypothesis", "text", "label", "claimtext"],
  estimand: ["quantity", "parameter", "targetestimand"],
  test: ["statisticaltest", "testname", "method", "statistic", "model", "analysis"],
  direction: ["sides", "sided", "sidedness", "alternative", "tail", "tails", "hypothesisdirection", "effectdirection"],
  alpha: ["significance", "significancelevel", "siglevel", "alphalevel", "typeierror", "typeierrorrate"],
  family: ["multiplicityfamily", "familyname", "testfamily", "hypothesisfamily", "multiplicity"],
  mei: [
    "minimumeffectofinterest", "minimumeffect", "minimaleffect", "minimumeffectsize", "smallesteffectofinterest",
    "sesoi", "mcid", "minimumimportantdifference", "minimumclinicallyimportantdifference", "minimuminterestingeffect",
    "delta", "margin", "minimumeffectofinterestmei",
  ],
  unit: ["unitofanalysis", "analysisunit", "units", "experimentalunit"],
  exposure: ["treatment", "predictor", "groupvariable", "independentvariable", "grouping"],
  outcome: ["response", "dependentvariable", "endpoint"],
  adjustment: ["adjustmentset", "covariates", "adjustfor", "adjustedfor", "confounders", "controls"],
  strata: ["stratum", "stratify", "stratifiedby", "within", "blocks", "blocking"],
  roles: ["covariateroles", "covariaterole", "declaredroles"],
  nullValue: ["null", "h0", "nullhypothesisvalue", "nullhypothesis", "chancelevel", "chance"],
  target: ["publishedvalue", "published", "targetvalue", "expectedvalue", "reportedvalue"],
  tolerance: ["tol", "reproductiontolerance", "targettolerance"],
  permutationLevel: ["permutationunit", "permute", "permutes", "permuteat", "permutationscheme"],
  exploratory: ["isexploratory"],
  knobs: ["settings", "parameters", "options", "analysisknobs", "analysissettings"],
} as const;
const PLAN_LEVEL = ["schema", "version", "families", "sharedKnobs", "staging", "notes", "comment", "comments", "title", "question", "extra", "rationale", "plain_statement", "plainStatement", "paper_set", "paperSet"];
const DESCRIPTIVE = new Set(["notes", "comment", "comments", "title", "question", "extra", "rationale", "schema", "version"]);

const KIND_MAP: Record<string, ClaimKind> = {};
for (const [kind, words] of Object.entries({
  "data-integrity": ["dataintegrity", "integrity", "dataquality", "quality", "duplicates", "duplicate", "qc", "validity", "dataintegrityfinding"],
  reproduction: ["reproduction", "reproduce", "reproducepublished", "reproducepublishedvalue", "publishedvalue", "replicationofpublished", "anchor", "reproductionofapublishedvalue"],
  "effect-exists": ["effectexists", "effect", "association", "difference", "superiority", "positive", "existence", "hypothesistest", "test"],
  "effect-size": ["effectsize", "estimate", "estimation", "ci", "confidenceinterval", "effectestimate", "effectsizeorci"],
  null: ["null", "noeffect", "negative", "refutation", "refuted", "nullresult", "absence", "equivalence", "nullorrefuted"],
  "out-of-sample": ["outofsample", "prediction", "predictive", "performance", "heldout", "heldoutperformance", "generalization", "generalisation", "classifier", "outofsampleperformance"],
  citation: ["citation", "reference", "literature", "cite"],
} as Record<ClaimKind, string[]>)) for (const word of words) KIND_MAP[word] = kind as ClaimKind;

/** Exact compact match first, then ordered substring cues for free-text kinds. */
function kindFromText(value: string): ClaimKind | null {
  const c = compactEnum(value);
  if (Object.hasOwn(KIND_MAP, c)) return KIND_MAP[c]!;
  return null;
}

const DIRECTION_MAP: Record<string, Direction | "ambiguous"> = {};
for (const [dir, words] of Object.entries({
  "two-sided": ["twosided", "two", "2sided", "both", "bothsides", "bidirectional", "nondirectional", "twotailed", "2tailed", "≠", "!=", "<>", "neq", "ne", "different"],
  greater: ["greater", "greaterthan", "higher", "larger", "increase", "increased", "positive", "upper", "right", "onesidedgreater", "greateronesided", "onesidedupper", "uppertailed", "righttailed", "gt", ">", "up", "above"],
  less: ["less", "lessthan", "lower", "smaller", "decrease", "decreased", "negative", "left", "onesidedless", "lessonesided", "onesidedlower", "lowertailed", "lefttailed", "lt", "<", "down", "below"],
  ambiguous: ["onesided", "one", "1sided", "onetailed", "1tailed", "directional"],
} as Record<Direction | "ambiguous", string[]>)) for (const word of words) DIRECTION_MAP[word] = dir as Direction | "ambiguous";

const METHOD_MAP: Record<string, FamilyMethod | "none"> = {
  holm: "holm", holmbonferroni: "holm", stepdown: "holm", bonferroniholm: "holm",
  bh: "bh", fdr: "bh", benjaminihochberg: "bh", benjamini: "bh", bhfdr: "bh",
  bonferroni: "bonferroni", bonf: "bonferroni",
  none: "none", no: "none", unadjusted: "none", raw: "none",
};

// ------------------------------------------------------------------ small readers

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.normalize("NFKC").trim().replace(/\s+/g, " ");
  return t.length > 0 ? t : null;
}

// Column references are opaque identifiers, not prose or enums. Keep their bytes,
// including case, whitespace and Unicode normalization form, through the lock.
function columnName(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function stringList(value: unknown, log: IssueLog, path: string): string[] {
  const items = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[,;]/) : value === undefined || value === null ? [] : [value];
  const out: string[] = [];
  items.forEach((item, index) => {
    const t = columnName(item);
    if (t === null) {
      if (item !== "" && item !== null) log.warn("ignored-value", `${path}[${index}]`, "non-text list entry ignored");
      return;
    }
    if (!out.includes(t)) out.push(t);
  });
  return out.sort();
}

function bool(value: unknown, log: IssueLog, path: string): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const c = compactEnum(value);
    if (["true", "yes", "y", "1"].includes(c)) { log.warn("normalized-value", path, "text read as true"); return true; }
    if (["false", "no", "n", "0"].includes(c)) { log.warn("normalized-value", path, "text read as false"); return false; }
  }
  if (value === 1 || value === 0) return value === 1;
  return null;
}

function parseAlpha(value: unknown, log: IssueLog, path: string): number {
  if (value === undefined) {
    log.warn("default-applied", path, `alpha defaulted to the software value ${POLICY.alphaDefault}`);
    return POLICY.alphaDefault;
  }
  let n: number | null = finite(value) ? value : null;
  if (typeof value === "string") {
    const m = /^\s*(?:p\s*(?:<|<=|≤)\s*)?([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*(%)?\s*$/i.exec(value);
    if (m) {
      n = Number(m[1]) / (m[2] ? 100 : 1);
      log.warn("normalized-value", path, "alpha text read as a number");
    }
  }
  if (n === null || !Number.isFinite(n) || !(n > 0) || n >= 1) {
    log.error("invalid-alpha", path, "explicit alpha is not a finite probability");
    return POLICY.alphaDefault;
  }
  if (n > POLICY.alphaMax) {
    log.warn("clamped", path, `alpha is software-owned and may only be tightened; ${POLICY.alphaMax} is used`);
    return POLICY.alphaMax;
  }
  return n;
}

function parseDirection(value: unknown): Direction | "ambiguous" | "unknown" {
  if (typeof value !== "string") return "unknown";
  const key = compactEnum(value);
  return Object.hasOwn(DIRECTION_MAP, key) ? DIRECTION_MAP[key]! : "unknown";
}

function parseTolerance(value: unknown, log: IssueLog, path: string): { abs: number; rel: number } | null | "invalid" {
  if (value === undefined || value === null) return null;
  if (finite(value)) return value >= 0 ? { abs: value, rel: 0 } : "invalid";
  if (typeof value === "string") {
    const m = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*(%)?\s*$/i.exec(value);
    if (!m) return "invalid";
    const n = Number(m[1]);
    if (!Number.isFinite(n) || !(n >= 0)) return "invalid";
    log.warn("normalized-value", path, "tolerance text read as a number");
    return m[2] ? { abs: 0, rel: n / 100 } : { abs: n, rel: 0 };
  }
  if (isRecord(value)) {
    const abs = pickField(value, "abs", ["absolute", "atol"], log, path);
    const rel = pickField(value, "rel", ["relative", "rtol"], log, path);
    const a = abs ? readNumber(abs.value, log, `${path}.abs`) : 0;
    const r = rel ? readNumber(rel.value, log, `${path}.rel`) : 0;
    if (a === null || r === null || a < 0 || r < 0 || (!abs && !rel)) return "invalid";
    return { abs: a, rel: r };
  }
  return "invalid";
}

function parseRoles(value: unknown, log: IssueLog, path: string): CovariateRole[] {
  if (value === undefined || value === null) return [];
  const out: CovariateRole[] = [];
  const add = (covariate: unknown, role: unknown, reason: unknown, at: string) => {
    const c = columnName(covariate);
    if (c === null) { log.warn("ignored-value", at, "covariate role without a covariate name ignored"); return; }
    const r = text(reason);
    if (r === null) log.warn("role-without-reason", at, "a declared role without a reason does not handle a strong covariate");
    out.push({ covariate: c, role: foldKey(text(role) ?? "declared"), reason: r });
  };
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      const at = `${path}[${index}]`;
      if (!isRecord(item)) { log.warn("ignored-value", at, "covariate role must be an object"); return; }
      const c = pickField(item, "covariate", ["column", "variable", "name"], log, at);
      const r = pickField(item, "role", ["kind", "type"], log, at);
      const why = pickField(item, "reason", ["justification", "why", "rationale"], log, at);
      add(c?.value, r?.value, why?.value, at);
    });
  } else if (isRecord(value)) {
    for (const [covariate, spec] of Object.entries(value)) {
      const at = `${path}.${covariate}`;
      if (typeof spec === "string") add(covariate, "declared", spec, at);
      else if (isRecord(spec)) {
        const r = pickField(spec, "role", ["kind", "type"], log, at);
        const why = pickField(spec, "reason", ["justification", "why", "rationale"], log, at);
        add(covariate, r?.value, why?.value, at);
      } else log.warn("ignored-value", at, "covariate role must be text or an object");
    }
  } else log.warn("ignored-value", path, "covariate roles must be a list or an object");
  return out.sort((a, b) => (a.covariate < b.covariate ? -1 : a.covariate > b.covariate ? 1 : 0));
}

// ------------------------------------------------------------------ families

interface FamilyDecl { method?: FamilyMethod | "none"; size?: number; screen?: boolean }

function readFamilyDecl(spec: unknown, log: IssueLog, path: string): FamilyDecl {
  const decl: FamilyDecl = {};
  if (typeof spec === "string") {
    const key = compactEnum(spec);
    const m = Object.hasOwn(METHOD_MAP, key) ? METHOD_MAP[key] : undefined;
    if (m) decl.method = m;
    else log.warn("unknown-method", path, "unrecognised multiplicity method; Holm is used");
    return decl;
  }
  if (!isRecord(spec)) return decl;
  const method = pickField(spec, "method", ["correction", "adjustment", "procedure"], log, path);
  if (method && typeof method.value === "string") {
    const key = compactEnum(method.value);
    const m = Object.hasOwn(METHOD_MAP, key) ? METHOD_MAP[key] : undefined;
    if (m) decl.method = m;
    else log.warn("unknown-method", `${path}.method`, "unrecognised multiplicity method; Holm is used");
  }
  const size = pickField(spec, "size", ["tests", "ntests", "m", "count", "numberoftests"], log, path);
  if (size) {
    const n = readNumber(size.value, log, `${path}.size`);
    if (n !== null && Number.isSafeInteger(n) && n >= 1) decl.size = n;
    else log.warn("ignored-value", `${path}.size`, "family size must be a positive integer");
  }
  const screen = pickField(spec, "screen", ["isscreen", "declaredscreen"], log, path);
  if (screen) {
    const b = bool(screen.value, log, `${path}.screen`);
    if (b !== null) decl.screen = b;
  }
  return decl;
}

function mergeDecl(into: Map<string, FamilyDecl>, name: string, decl: FamilyDecl, log: IssueLog, path: string): void {
  const prior = into.get(name);
  if (!prior) { into.set(name, decl); return; }
  for (const key of ["method", "size", "screen"] as const) {
    if (decl[key] === undefined) continue;
    if (prior[key] !== undefined && prior[key] !== decl[key]) {
      log.warn("family-conflict", path, `family ${JSON.stringify(name)} declares ${key} twice; the stricter reading is used`);
      if (key === "size") prior.size = Math.max(prior.size ?? 0, decl.size ?? 0);
      if (key === "screen") prior.screen = false;
      if (key === "method") prior.method = prior.method === "bonferroni" || decl.method === "bonferroni" ? "bonferroni" : "holm";
    } else (prior as Record<string, unknown>)[key] = decl[key];
  }
}

// ------------------------------------------------------------------ claims

interface Defaults {
  alpha?: unknown;
  direction?: unknown;
  unit: string | null;
  family: string | null;
  exploratory: boolean;
}

const CLAIM_FIELD_NAMES = ["id", ...Object.keys(F)];
// Plan-level names are never claim knobs (a single-claim plan mixes both levels in one object).
const CLAIM_ALIASES = [...CLAIM_FIELD_NAMES, ...Object.values(F).flat(), ...PLAN_LEVEL, ...CLAIM_CONTAINER, "claims",
  "multiplicityfamilies", "familydefinitions"];

function looksLikeClaim(obj: Record<string, unknown>): boolean {
  return unknownKeys(obj, ["metric", "kind", "test", "direction", "mei", "target", "estimand", ...F.metric, ...F.kind, ...F.mei, ...F.test]).length < Object.keys(obj).length;
}

function parseClaim(
  raw: Record<string, unknown>, path: string, defaults: Defaults, keyId: string | null,
  families: Map<string, FamilyDecl>, log: IssueLog,
): PlanClaim | { refused: string } {
  const before = log.errorCount;
  const field = (name: keyof typeof F | "id") => pickField(raw, name, name === "id" ? F.id : F[name], log, path);

  let id = text(field("id")?.value);
  if (keyId !== null) {
    if (id !== null && foldKey(id) !== foldKey(keyId)) log.error("id-conflict", `${path}.id`, "claim map key differs from its id field; the map key is used");
    id = keyId;
  }
  let metric = text(field("metric")?.value);
  if (id === null && metric !== null) { id = metric; log.warn("default-applied", `${path}.id`, "claim id defaulted to its metric key"); }
  if (metric === null && id !== null) { metric = id; log.warn("default-applied", `${path}.metric`, "metric key defaulted to the claim id"); }
  if (id === null || metric === null) {
    log.error("unevaluable-claim-key", path, "claim has neither an id nor a metric key");
    return { refused: `${path}` };
  }
  id = foldKey(id);
  metric = foldKey(metric);

  // kind (inferred, then defaulted to the most demanding statistical kind)
  const kindHit = field("kind");
  const targetHit = field("target");
  let kind: ClaimKind;
  const textKind = kindHit && typeof kindHit.value === "string" ? kindFromText(kindHit.value) : null;
  if (kindHit && textKind !== null) {
    kind = textKind;
    if (kindHit.value !== kind) log.warn("normalized-value", `${path}.kind`, `kind read as ${JSON.stringify(kind)}`);
  } else if (kindHit) {
    kind = "effect-exists";
    log.error("unknown-kind", `${path}.kind`, "unrecognised claim kind; declare a supported kind");
  } else if (targetHit) {
    kind = "reproduction";
    log.warn("default-applied", `${path}.kind`, "kind inferred as reproduction from the declared target");
  } else {
    kind = "effect-exists";
    log.warn("default-applied", `${path}.kind`, "kind defaulted to effect-exists (the most demanding)");
  }
  const statistical = isStatistical(kind);

  const estimand = text(field("estimand")?.value);
  if (estimand === null && statistical) log.warn("missing-field", `${path}.estimand`, "no estimand: the replicator may implement a different quantity");
  const testRaw = text(field("test")?.value);
  const test = testRaw === null ? null : testRaw.toLowerCase();
  if (test === null && (statistical || kind === "reproduction")) log.warn("missing-field", `${path}.test`, "no test named: the plan is under-specified for replication");

  // direction
  let direction: Direction = "two-sided";
  const dirHit = field("direction");
  const dirValue = dirHit ? dirHit.value : defaults.direction;
  if (statistical) {
    if (dirValue === undefined && kind === "out-of-sample") log.error("unevaluable-direction", `${path}.direction`, "performance claims must declare greater or less (or explicitly two-sided)");
    else if (dirValue === undefined) log.warn("default-applied", `${path}.direction`, "direction defaulted to two-sided");
    else {
      const parsed = parseDirection(dirValue);
      if (parsed === "ambiguous") log.error("unevaluable-direction", `${path}.direction`, "one-sided without a sign; say greater or less");
      else if (parsed === "unknown") log.error("unevaluable-direction", `${path}.direction`, "unrecognised direction; use two-sided, greater or less");
      else {
        direction = parsed;
        if (dirValue !== parsed) log.warn("normalized-value", `${path}.direction`, `direction read as ${JSON.stringify(parsed)}`);
      }
    }
  }

  const alphaHit = field("alpha");
  const alpha = parseAlpha(alphaHit ? alphaHit.value : defaults.alpha, log, `${path}.alpha`);

  // family
  let family: string | null = null;
  if (statistical) {
    const famHit = field("family");
    if (famHit && isRecord(famHit.value)) {
      const name = text(pickField(famHit.value, "name", ["family", "id"], log, `${path}.family`)?.value);
      family = name === null ? null : foldKey(name);
      if (family !== null) mergeDecl(families, family, readFamilyDecl(famHit.value, log, `${path}.family`), log, `${path}.family`);
    } else if (famHit) {
      const name = text(famHit.value);
      family = name === null ? null : foldKey(name);
    }
    if (family === null) {
      family = defaults.family ?? "primary";
      log.warn("default-applied", `${path}.family`, `family defaulted to ${JSON.stringify(family)} (shared Holm family; the conservative default)`);
    }
  }

  // MEI
  let mei: number | null = null;
  const meiHit = field("mei");
  if (meiHit) {
    const n = readNumber(meiHit.value, log, `${path}.mei`);
    if (n === null) {
      if (kind === "null") log.error("unevaluable-mei", `${path}.mei`, "null claims need a numeric minimum effect of interest");
      else log.warn("ignored-value", `${path}.mei`, "minimum effect of interest value ignored because it is not a finite number");
    } else if (n === 0) {
      if (kind === "null") log.error("unevaluable-mei", `${path}.mei`, "a zero minimum effect of interest makes refutation impossible");
      else log.warn("ignored-value", `${path}.mei`, "minimum effect of interest value 0 ignored because a nonzero threshold is required");
    } else {
      if (n < 0) log.warn("normalized-value", `${path}.mei`, "negative minimum effect of interest read as its magnitude");
      mei = Math.abs(n);
    }
  } else if (kind === "null") {
    log.error("unevaluable-mei", `${path}.mei`, "null claims need a minimum effect of interest (refutation is defined against it)");
  } else if (statistical) {
    log.warn("missing-field", `${path}.mei`, kind === "effect-size" || kind === "out-of-sample"
      ? "no minimum effect of interest: G5b cannot run, so this claim cannot be confirmed or refuted"
      : "no minimum effect of interest: this claim cannot be refuted");
  }

  const unitText = columnName(field("unit")?.value) ?? defaults.unit;
  if (unitText === null && statistical) log.warn("missing-field", `${path}.unit`, "no unit of analysis declared");
  const exposure = columnName(field("exposure")?.value);
  const outcome = columnName(field("outcome")?.value);
  if (statistical && (exposure === null || outcome === null)) log.warn("missing-field", path, "exposure or outcome not named: the plan is under-specified for replication");
  const adjHit = field("adjustment");
  const strataHit = field("strata");
  const adjustment = stringList(adjHit?.value, log, `${path}.adjustment`);
  const strata = stringList(strataHit?.value, log, `${path}.strata`);
  const rolesHit = field("roles");
  const roles = parseRoles(rolesHit?.value, log, `${path}.roles`);

  // null value
  let nullValue = 0;
  const nullHit = field("nullValue");
  if (nullHit) {
    const n = readNumber(nullHit.value, log, `${path}.nullValue`);
    if (n === null) {
      if (kind === "out-of-sample") log.error("unevaluable-null-value", `${path}.nullValue`, "out-of-sample claims need a numeric chance level");
      else log.error("invalid-null-value", `${path}.nullValue`, "explicit null value must be finite");
    } else nullValue = n;
  } else if (kind === "out-of-sample") {
    log.error("unevaluable-null-value", `${path}.nullValue`, "out-of-sample claims need the chance level (e.g. 0.5 for AUC)");
  } else if (statistical) {
    log.warn("default-applied", `${path}.nullValue`, "null value defaulted to 0");
  }

  // reproduction target
  let target: ReproductionTarget | null = null;
  if (kind === "reproduction") {
    let valueRaw: unknown = targetHit?.value;
    if (valueRaw === undefined) {
      const plainValue = field("value");
      if (plainValue) {
        log.warn("alias-field", `${path}.target`, "field \"value\" read as the published target");
        valueRaw = plainValue.value;
      }
    }
    let tolRaw: unknown = field("tolerance")?.value;
    if (isRecord(valueRaw)) {
      const inner = valueRaw;
      valueRaw = pickField(inner, "value", ["published", "target", "estimate"], log, `${path}.target`)?.value;
      const innerTol = pickField(inner, "tolerance", ["tol"], log, `${path}.target`);
      if (innerTol) tolRaw = innerTol.value;
    }
    const value = readNumber(valueRaw, log, `${path}.target`);
    if (value === null) {
      log.error("unevaluable-reproduction", `${path}.target`, "reproduction claims need the published target value");
    } else {
      const tol = parseTolerance(tolRaw, log, `${path}.tolerance`);
      if (tol === "invalid") {
        log.error("invalid-tolerance", `${path}.tolerance`, "explicit tolerance is unreadable");
        target = { value, tolerance: null };
      } else if (tol === null) {
        log.warn("default-applied", `${path}.tolerance`, "no tolerance declared; the claim is decided by the target lying inside the recomputed CI");
        target = { value, tolerance: null };
      } else {
        const cap = POLICY.reproductionToleranceCapRel * Math.abs(value);
        if (Math.max(tol.abs, tol.rel * Math.abs(value)) > cap) {
          log.warn("clamped", `${path}.tolerance`, `reproduction tolerance is capped at ${POLICY.reproductionToleranceCapRel * 100}% of the target`);
          target = { value, tolerance: { abs: cap, rel: 0 } };
        } else target = { value, tolerance: tol };
      }
    }
  }

  // data integrity
  const factText = text(field("fact")?.value);
  const valueHit = field("value");
  const assertedValue = kind === "data-integrity" && valueHit ? readNumber(valueHit.value, log, `${path}.value`) : null;

  let permutationLevel: "unit" | "row" | null = null;
  const permHit = field("permutationLevel");
  if (permHit) {
    const c = typeof permHit.value === "string" ? compactEnum(permHit.value) : "";
    if (["unit", "units", "unitlevel", "subject", "patient", "donor", "participant", "individual"].includes(c)) permutationLevel = "unit";
    else if (["row", "rows", "sample", "samples", "observation", "observations", "cell", "cells", "rowlevel"].includes(c)) permutationLevel = "row";
    else log.warn("ignored-value", `${path}.permutationLevel`, "unrecognised permutation level; no G5a waiver");
  }

  const expHit = field("exploratory");
  if (expHit && bool(expHit.value, log, `${path}.exploratory`) === null) log.error("invalid-exploratory", path, "explicit exploratory flag is unreadable");
  const exploratory = (expHit ? bool(expHit.value, log, `${path}.exploratory`) ?? false : false) || defaults.exploratory;

  const knobs: Record<string, Json> = Object.create(null);
  const knobsHit = field("knobs");
  if (knobsHit) {
    if (isRecord(knobsHit.value)) Object.assign(knobs, toJson(knobsHit.value));
    else log.warn("ignored-value", `${path}.knobs`, "knobs must be an object");
  }
  for (const key of unknownKeys(raw, CLAIM_ALIASES)) {
    if (DESCRIPTIVE.has(key.toLowerCase())) continue;
    knobs[key] = toJson(raw[key]);
    log.warn("unknown-field", `${path}.${key}`, "unrecognised field kept as a locked knob");
  }

  if (log.errorCount > before) return { refused: id };
  return {
    id, kind, metric,
    fact: kind === "data-integrity" ? (factText === null ? metric : foldKey(factText)) : null,
    assertedValue,
    statement: text(field("statement")?.value),
    estimand, test, direction, alpha, family, mei,
    unit: unitText,
    exposure,
    outcome,
    adjustment, strata, roles, nullValue, target, permutationLevel, exploratory,
    knobs: toJson(knobs) as Record<string, Json>,
  };
}

// ------------------------------------------------------------------ plan

// Leave ample room for the lock payload wrapper below toJson's depth limit. Never hash a
// truncated rule: two distinct deep knobs would otherwise receive the same commitment.
function withinLockDepth(value: unknown, depth = 0): boolean {
  if (depth > 16) return false;
  if (Array.isArray(value)) return value.every((v) => withinLockDepth(v, depth + 1));
  if (isRecord(value)) return Object.values(value).every((v) => withinLockDepth(v, depth + 1));
  return true;
}

export function parsePlan(input: unknown): PlanParseResult {
  const log = new IssueLog();
  let value = input;
  if (typeof input === "string") {
    const parsed = parseLenientJson(input, log, "$");
    if (!parsed.ok) return { status: "refused", plan: null, issues: log.items, refusedClaims: [] };
    value = parsed.value;
  }
  if (!withinLockDepth(value)) {
    log.error("plan-depth-limit", "$", "plan nesting exceeds the lockable depth; simplify the rule before locking");
    return { status: "refused", plan: null, issues: log.items, refusedClaims: [] };
  }
  let top: Record<string, unknown>;
  if (Array.isArray(value)) {
    log.warn("lenient-shape", "$", "a top-level array is read as the claims list");
    top = { claims: value };
  } else if (isRecord(value)) top = value;
  else {
    log.error("not-an-object", "$", "plan.json must be a JSON object");
    return { status: "refused", plan: null, issues: log.items, refusedClaims: [] };
  }

  const families = new Map<string, FamilyDecl>();
  const famTop = pickField(top, "families", ["multiplicityfamilies", "familydefinitions"], log, "$");
  if (famTop) {
    if (Array.isArray(famTop.value)) {
      famTop.value.forEach((spec, index) => {
        const at = `$.families[${index}]`;
        const name = isRecord(spec) ? text(pickField(spec, "name", ["family", "id"], log, at)?.value) : null;
        if (name === null) log.warn("ignored-value", at, "family without a name ignored");
        else mergeDecl(families, foldKey(name), readFamilyDecl(spec, log, at), log, at);
      });
    } else if (isRecord(famTop.value)) {
      for (const [name, spec] of Object.entries(famTop.value)) mergeDecl(families, foldKey(name), readFamilyDecl(spec, log, `$.families.${name}`), log, `$.families.${name}`);
    } else log.warn("ignored-value", "$.families", "families must be a list or an object");
  }

  const container = pickField(top, "claims", CLAIM_CONTAINER, log, "$");
  const rawClaims: { raw: Record<string, unknown>; path: string; keyId: string | null }[] = [];
  let single = false;
  if (container) {
    if (Array.isArray(container.value)) {
      container.value.forEach((item, index) => {
        if (isRecord(item)) rawClaims.push({ raw: item, path: `$.claims[${index}]`, keyId: null });
        else log.error("claim-not-object", `$.claims[${index}]`, "each claim must be a JSON object");
      });
    } else if (isRecord(container.value)) {
      for (const [key, item] of Object.entries(container.value)) {
        if (isRecord(item)) rawClaims.push({ raw: item, path: `$.claims.${key}`, keyId: key });
        else log.error("claim-not-object", `$.claims.${key}`, "each claim must be a JSON object");
      }
    } else log.error("no-claims", "$.claims", "claims must be a list or an object");
  } else if (looksLikeClaim(top)) {
    single = true;
    log.warn("lenient-shape", "$", "single-claim plan: top-level fields read as one claim");
    rawClaims.push({ raw: top, path: "$", keyId: null });
  }
  if (rawClaims.length === 0 && log.errorCount === 0) log.error("no-claims", "$", "plan.json declares no claims");

  const defaults: Defaults = { unit: null, family: null, exploratory: false };
  if (!single) {
    const alpha = pickField(top, "alpha", F.alpha, log, "$");
    if (alpha) defaults.alpha = alpha.value;
    const dir = pickField(top, "direction", F.direction, log, "$");
    if (dir) defaults.direction = dir.value;
    defaults.unit = columnName(pickField(top, "unit", F.unit, log, "$")?.value);
    const fam = text(pickField(top, "family", F.family, log, "$")?.value);
    defaults.family = fam === null ? null : foldKey(fam);
    const exp = pickField(top, "exploratory", F.exploratory, log, "$");
    if (exp && bool(exp.value, log, "$.exploratory") === null) log.error("invalid-exploratory", "$", "explicit exploratory flag is unreadable");
    defaults.exploratory = exp ? bool(exp.value, log, "$.exploratory") ?? false : false;
  }

  const sharedKnobs=pickField(top,'sharedKnobs',[],log,'$')?.value, staging=pickField(top,'staging',[],log,'$')?.value;
  for (const [field,value] of [['sharedKnobs',sharedKnobs],['staging',staging]] as const) if(value!==undefined&&!isRecord(value)) log.error('invalid-declaration', `$.${field}`, `${field} must be an object`);
  const plainStatementValue=pickField(top,'plain_statement',['plainStatement'],log,'$')?.value;
  const paperSetValue=pickField(top,'paper_set',['paperSet'],log,'$')?.value;
  const plainStatement=typeof plainStatementValue==='string'&&plainStatementValue.trim()?plainStatementValue.trim():null;
  if(plainStatementValue!==undefined&&plainStatement===null)log.error('invalid-plain-statement','$.plain_statement','plain_statement must be non-empty text');
  let paperSet:Json|null=null;
  if(paperSetValue!==undefined){try{paperSet=toJson(paperSetValue);}catch{log.error('invalid-paper-set','$.paper_set','paper_set must be lockable JSON');}}
  const globalErrors = log.errorCount;
  const claims: PlanClaim[] = [];
  const refused: string[] = [];
  for (const { raw, path, keyId } of rawClaims) {
    const result = parseClaim(raw, path, defaults, keyId, families, log);
    if ("refused" in result) refused.push(result.refused);
    else claims.push(result);
  }
  // duplicate IDs (after case folding) make lookups ambiguous: refuse every copy
  const counts = new Map<string, number>();
  for (const c of claims) counts.set(c.id, (counts.get(c.id) ?? 0) + 1);
  const unique = claims.filter((c) => {
    if (refused.includes(c.id)) return false;
    if ((counts.get(c.id) ?? 0) < 2) return true;
    if (!refused.includes(c.id)) {
      refused.push(c.id);
      log.error("duplicate-claim-id", "$.claims", `claim id ${JSON.stringify(c.id)} appears more than once (after case folding)`);
    }
    return false;
  });

  // finalise families
  const used = new Map<string, number>();
  for (const c of unique) if (c.family !== null) used.set(c.family, (used.get(c.family) ?? 0) + 1);
  for (const name of families.keys()) if (!used.has(name)) log.warn("unused-family", `$.families.${name}`, "declared family has no claims");
  const finalFamilies: PlanFamily[] = [...used.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([name, members]) => {
    const decl = families.get(name) ?? {};
    let size = decl.size ?? members;
    if (refused.length > 0) size = Math.max(size, rawClaims.length);
    if (size < members) {
      log.warn("clamped", `$.families.${name}.size`, "family size is smaller than its locked claims; the claim count is used");
      size = members;
    }
    const screen = decl.screen ?? false;
    let method: FamilyMethod = decl.method === undefined || decl.method === "none" ? "holm" : decl.method;
    if (decl.method === "none") log.warn("clamped", `$.families.${name}.method`, "unadjusted families are not allowed; Holm is used");
    if (method === "bh" && !(screen && size >= POLICY.bhMinScreen)) {
      log.warn("clamped", `$.families.${name}.method`, `Benjamini-Hochberg is only for declared screens of at least ${POLICY.bhMinScreen} tests; Holm is used`);
      method = "holm";
    }
    return { name, method, size, screen };
  });

  const knobs: Record<string, Json> = Object.create(null);
  if (!single) {
    const known = [...PLAN_LEVEL, "claims", ...CLAIM_CONTAINER, "alpha", ...F.alpha, "direction", ...F.direction, "unit", ...F.unit,
      "family", ...F.family, "exploratory", ...F.exploratory, "multiplicityfamilies", "familydefinitions"];
    for (const key of unknownKeys(top, known)) {
      knobs[key] = toJson(top[key]);
      log.warn("unknown-field", `$.${key}`, "unrecognised plan field kept as a locked knob");
    }
  }

  const plan: Plan | null = unique.length > 0 && globalErrors === 0
    ? { schema: "omb/plan@1", ...(plainStatement===null?{}:{plainStatement}), ...(paperSet===null?{}:{paperSet}), claims: [...unique].sort((a, b) => (a.id < b.id ? -1 : 1)), families: finalFamilies, ...(sharedKnobs===undefined?{}:{sharedKnobs:toJson(sharedKnobs) as Record<string,Json>}), ...(staging===undefined?{}:{staging:toJson(staging) as Record<string,Json>}), knobs: toJson(knobs) as Record<string, Json> }
    : null;
  const status = log.errorCount > 0 || plan === null ? "refused" : "accepted";
  return { status, plan, issues: log.items, refusedClaims: refused };
}

// ------------------------------------------------------------------ lock (G2)

/** The locked decision rule: every claim field except descriptive prose, in canonical order. */
export function lockPayload(plan: Plan): Json {
  return toJson({
    schema: plan.schema,
    ...(plan.plainStatement===undefined?{}:{plainStatement:plan.plainStatement}),
    ...(plan.paperSet===undefined?{}:{paperSet:plan.paperSet}),
    ...(plan.sharedKnobs===undefined?{}:{sharedKnobs:plan.sharedKnobs}),
    ...(plan.staging===undefined?{}:{staging:plan.staging}),
    claims: plan.claims.map(({ statement: _statement, ...rule }) => rule),
    families: plan.families,
    knobs: plan.knobs,
  });
}

export function planLockHash(plan: Plan): string {
  return canonicalSha256(lockPayload(plan));
}

export function findClaim(plan: Plan | null, id: string): PlanClaim | null {
  if (plan === null) return null;
  const folded = foldKey(id);
  return plan.claims.find((c) => c.id === folded) ?? null;
}

export function familyOf(plan: Plan, claim: PlanClaim): PlanFamily | null {
  return claim.family === null ? null : plan.families.find((f) => f.name === claim.family) ?? null;
}

// ------------------------------------------------------------------ amendments

export interface AmendmentCheck {
  readonly allowed: boolean;
  readonly weakenings: readonly string[];
  readonly tightenings: readonly string[];
}

const METHOD_STRICTNESS: Record<FamilyMethod, number> = { bh: 0, holm: 1, bonferroni: 2 };
const FIXED_FIELDS = ["kind", "metric", "fact", "assertedValue", "estimand", "test", "unit", "exposure", "outcome", "adjustment", "strata",
  "roles", "nullValue", "target", "permutationLevel", "knobs"] as const;

/** Amendments may never weaken anything (the repair.ts rule): measurement and identity fields are
 * fixed; alpha may fall, MEI may fall, directions stay fixed, families may grow. */
export function checkAmendment(locked: Plan, proposed: Plan): AmendmentCheck {
  const weakenings: string[] = [];
  const tightenings: string[] = [];
  const j = (v: unknown) => JSON.stringify(toJson(v));
  if(j(locked.sharedKnobs??{})!==j(proposed.sharedKnobs??{})) weakenings.push('sharedKnobs changed');
  if(j(locked.staging??{})!==j(proposed.staging??{})) weakenings.push('staging changed');
  if (j(locked.knobs) !== j(proposed.knobs)) weakenings.push("plan knobs changed");
  for (const old of locked.claims) {
    const next = proposed.claims.find((c) => c.id === old.id);
    if (!next) { weakenings.push(`${old.id}: a locked claim was dropped`); continue; }
    for (const key of FIXED_FIELDS) if (j(old[key]) !== j(next[key])) weakenings.push(`${old.id}: ${key} changed`);
    if (next.alpha > old.alpha) weakenings.push(`${old.id}: alpha raised`);
    else if (next.alpha < old.alpha) tightenings.push(`${old.id}: alpha lowered`);
    if (old.direction !== next.direction) {
      weakenings.push(`${old.id}: direction changed to ${next.direction}`);
    }
    if (j(old.mei) !== j(next.mei)) {
      if (old.mei !== null && next.mei !== null && next.mei < old.mei) tightenings.push(`${old.id}: MEI lowered`);
      else weakenings.push(`${old.id}: MEI changed`);
    }
    if (old.exploratory && !next.exploratory) weakenings.push(`${old.id}: exploratory claim promoted to confirmatory`);
    if (old.family !== next.family) weakenings.push(`${old.id}: moved to another family`);
    else if (old.family !== null) {
      const a = familyOf(locked, old);
      const b = familyOf(proposed, next);
      if (a && b) {
        if (b.size < a.size) weakenings.push(`${old.id}: family shrank`);
        if (METHOD_STRICTNESS[b.method] < METHOD_STRICTNESS[a.method]) weakenings.push(`${old.id}: family method weakened`);
        if (b.size > a.size) tightenings.push(`${old.id}: family grew`);
      }
    }
  }
  for (const next of proposed.claims) if (!locked.claims.some((c) => c.id === next.id)) tightenings.push(`${next.id}: claim added`);
  return { allowed: weakenings.length === 0, weakenings, tightenings };
}
