// Adapters from toolpack documents (omb-check / omb-sim, packages/bio-toolpack on
// build/block10-toolpack) to gate results, plus the interfaces V2, V5 and V8 implement.
// Translators are pure: document in, GateResult out. An unreadable document, a usage error (exit 2)
// or a runner failure is "not-run" - never passed, and never an exception that ends a run.

import { EVIDENCE_RULES, gateResult, type GateResult } from "./gates.ts";
import type { Json } from "./json.ts";
import { finite, foldKey, isRecord } from "./json.ts";
import type { PlanClaim } from "./plan.ts";
import { POLICY } from "./policy.ts";
import { decideG5a } from "./gates.ts";
import { G5B_COVERAGE_METHOD, coverageMeetsNominal } from "./calibration.ts";

// ------------------------------------------------------------------ runner (V2 implements)

export interface ToolInvocation {
  readonly tool: "omb-check" | "omb-sim";
  readonly args: readonly string[];
  /** Working directory of the analysis copy the tool operates on. */
  readonly cwd: string;
}

/** V2 implements: spawn the pinned toolpack binary (no network, process group, scratch deleted) and
 * return its parsed JSON document. Throw (or return null) on infrastructure failure. */
export interface ToolRunner {
  run(invocation: ToolInvocation): Promise<unknown>;
}

function usable(doc: unknown): doc is Record<string, unknown> {
  return isRecord(doc) && doc.exitCode !== 2 && typeof doc.status === "string";
}

const notRun = (gate: GateResult["gate"], claimId: string | undefined, summary: string, code = "tool-unavailable") =>
  gateResult(gate, "not-run", summary, { claimId, code });

/** Run one invocation and translate it; any runner failure becomes not-run. */
export async function runTool<T extends GateResult | GateResult[]>(runner: ToolRunner, invocation: ToolInvocation,
  translate: (doc: unknown) => T, onFailure: () => T): Promise<T> {
  let doc: unknown;
  try {
    doc = await runner.run(invocation);
  } catch {
    return onFailure();
  }
  if (doc === null || doc === undefined) return onFailure();
  return translate(doc);
}

// ------------------------------------------------------------------ G1 (staging validity)

export interface StagingFacts {
  readonly gate: GateResult;
  /** Effective unit groups (member IDs per unit) of the unit dataset; feeds the stager, never printed. */
  readonly unitGroups: readonly (readonly string[])[] | null;
}

/** `omb-check gates DATA_DIR --handling collapse`: G1 passes when every dataset was checked, is
 * allowed and has an established effective n. Facts (counts only) feed data-integrity claims. */
export function g1FromGatesDocument(doc: unknown, unitDataset?: string): StagingFacts {
  if (!usable(doc)) return { gate: notRun("G1", undefined, "staging validity document unusable", "tool-usage"), unitGroups: null };
  const evidence = isRecord(doc.evidence) ? doc.evidence : null;
  const datasets = evidence && Array.isArray(evidence.datasets) ? evidence.datasets.filter(isRecord) : [];
  if (datasets.length === 0) return { gate: gateResult("G1", "failed", `staging validity ${String(doc.status)}: no dataset was checked`, { code: "refused" }), unitGroups: null };
  if (!Array.isArray(evidence?.datasets) || !evidence.datasets.every(isRecord)) return { gate: notRun("G1", undefined, "malformed dataset result"), unitGroups: null };
  const facts: Record<string, number> = {};
  const summaries: Json[] = [];
  let unitGroups: string[][] | null = null;
  let established = true;
  let allowed = true;
  for (const d of datasets) {
    const file = typeof d.file === "string" ? d.file : "dataset";
    const groups = Array.isArray(d.units) ? d.units.filter((u): u is unknown[] => Array.isArray(u)).map((u) => u.filter((x): x is string => typeof x === "string")) : [];
    const effectiveN = finite(d.effectiveN) ? d.effectiveN : null;
    const rowCount = finite(d.rowCount) ? d.rowCount : null;
    if (effectiveN === null || rowCount === null || !Number.isSafeInteger(effectiveN) || !Number.isSafeInteger(rowCount) || effectiveN <= 0 || rowCount < effectiveN) established = false;
    if (d.allowed === true && (!Array.isArray(d.units) || d.units.length !== effectiveN || !d.units.every((g) => Array.isArray(g) && g.length > 0 && g.every((id) => typeof id === "string" && id.trim())) || groups.flat().length !== rowCount || new Set(groups.flat()).size !== rowCount)) established = false;
    if (d.allowed !== true) allowed = false;
    const duplicateGroups = groups.filter((g) => g.length > 1).length;
    const duplicateRecords = groups.reduce((s, g) => s + Math.max(0, g.length - 1), 0);
    const prefix = foldKey(file);
    if (effectiveN !== null) facts[`${prefix}.effective_n`] = effectiveN;
    if (rowCount !== null) facts[`${prefix}.input_n`] = rowCount;
    facts[`${prefix}.duplicate_groups`] = duplicateGroups;
    facts[`${prefix}.duplicate_records`] = duplicateRecords;
    const findings = Array.isArray(d.findings) ? d.findings.filter(isRecord).map((f) => ({ name: typeof f.name === "string" ? f.name : "?", passed: f.passed === true })) : [];
    summaries.push({ file, allowed: d.allowed === true, effectiveN, rowCount, duplicateGroups, findings });
    if ((unitDataset !== undefined && file === unitDataset) || (unitDataset === undefined && datasets.length === 1)) {
      unitGroups = groups;
      if (effectiveN !== null) facts.effective_n = effectiveN;
      if (rowCount !== null) facts.input_n = rowCount;
      facts.duplicate_groups = duplicateGroups;
      facts.duplicate_records = duplicateRecords;
    }
  }
  const ev = { facts, datasets: summaries, status: String(doc.status) };
  if (!established) return { gate: gateResult("G1", "failed", "staging could not establish the effective n of every dataset", { code: "unestablished", evidence: ev }), unitGroups };
  if (!allowed) return { gate: gateResult("G1", "failed", "staging blocked a dataset (suspected matches, cross-table identity or leakage need review)", { code: "blocked", evidence: ev }), unitGroups };
  return { gate: gateResult("G1", "passed", `staging validity established for ${datasets.length} dataset(s)`, { evidence: ev }), unitGroups };
}

// ------------------------------------------------------------------ G1c (confounding)

/** `omb-sim confound-check --table T --exposure E ...`, run before lock. Aligned covariates make the
 * claim non-identifiable; strong ones must be adjusted for, stratified on, or given a role with a reason. */
export function g1cFromConfoundDocument(claim: PlanClaim, doc: unknown): GateResult {
  const claimId = claim.id;
  if (!usable(doc) || !Array.isArray(doc.columns)) return notRun("G1c", claimId, "confound-check document unusable", "tool-usage");
  if (claim.exposure !== null && typeof doc.exposure === "string" && doc.exposure !== claim.exposure) {
    return notRun("G1c", claimId, "confound-check ran on a different exposure than the locked plan", "exposure-mismatch");
  }
  if (claim.exposure === null || typeof doc.exposure !== "string") return notRun("G1c", claimId, "exposure missing");
  if (!doc.columns.every((r) => isRecord(r) && typeof r.column === "string" && ["aligned", "strong", "weak", "constant", "insufficient"].includes(String(r.status)))) return notRun("G1c", claimId, "unknown covariate result");
  const jointStatus = isRecord(doc.jointDesign) ? doc.jointDesign.status : null;
  const rows = doc.columns.filter(isRecord).map((r) => ({ column: typeof r.column === "string" ? r.column : "?", status: typeof r.status === "string" ? r.status : "?" }));
  const handled = new Set([...claim.adjustment, ...claim.strata, ...claim.roles.filter((r) => r.reason !== null).map((r) => r.covariate)]);
  const aligned = rows.filter((r) => r.status === "aligned").map((r) => r.column);
  if (jointStatus === "aligned" || doc.status === "aligned") aligned.push("joint design");
  const strong = rows.filter((r) => r.status === "strong").map((r) => r.column);
  const unhandled = strong.filter((c) => !handled.has(foldKey(c)));
  const insufficient = rows.filter((r) => r.status === "insufficient").map((r) => r.column);
  const evidence = { aligned, strong, unhandled, insufficient, jointStatus, threshold: finite(doc.strongThreshold) ? doc.strongThreshold : null };
  if (aligned.length > 0) return gateResult("G1c", "failed", `exposure aligned with ${aligned.join(", ")}: non-identifiable`, { claimId, code: "aligned", evidence });
  if (unhandled.length > 0) return gateResult("G1c", "failed", `strong covariate(s) not handled: ${unhandled.join(", ")}`, { claimId, code: "strong-unhandled", evidence });
  if (insufficient.length > 0) return gateResult("G1c", "failed", `too few usable rows to assess: ${insufficient.join(", ")}`, { claimId, code: "insufficient", evidence });
  if (!finite(doc.strongThreshold) || doc.strongThreshold <= 0 || doc.strongThreshold > 0.5) return notRun("G1c", claimId, "confounding threshold missing or loosened");
  if (jointStatus !== "estimable") return notRun("G1c", claimId, "joint design unavailable");
  return gateResult("G1c", "passed", strong.length > 0 ? `strong covariate(s) handled: ${strong.join(", ")}` : "no strong or aligned covariate", { claimId, evidence });
}

// ------------------------------------------------------------------ G5a (null calibration)

/** Is the locked test itself a unit-level permutation test (the design's G5a waiver)? */
export function g5aWaived(claim: PlanClaim): boolean {
  return claim.test !== null && ["permutation test", "unit-level permutation test", "randomization test", "randomisation test"].includes(claim.test) && claim.permutationLevel === "unit";
}

function rejections(doc: Record<string, unknown>): { rejections: number; trials: number } | null {
  const alpha = POLICY.g5a.alpha;
  if (Array.isArray(doc.permutationPValues) && doc.permutationPValues.every((p) => finite(p) && p >= 0 && p <= 1)) {
    const ps = doc.permutationPValues as number[];
    return { rejections: ps.filter((p) => p <= alpha).length, trials: ps.length };
  }
  return null;
}

export interface G5aOptions {
  /** Which permutation scheme produced the documents. Covariate-adjusted claims need Freedman-Lane. */
  readonly scheme?: "exposure-permutation" | "freedman-lane";
}

/** Sequential rule: 200 permutations; <=14 rejections at alpha 0.05 pass, >=20 fail; 15-19 extend
 * with 400 more (new seeds) and fail at >=42 of 600. Rejections are recounted from the reported
 * permutation p-values with the evaluator's own comparator (p <= alpha). */
export function g5aFromDocuments(claim: PlanClaim, stage1: unknown, stage2?: unknown, options: G5aOptions = {}): GateResult {
  const claimId = claim.id;
  if (g5aWaived(claim)) {
    return gateResult("G5a", "passed", "waived: the locked test is itself a unit-level permutation test", { claimId, code: "waived", evidence: { waived: true, waiver: "unit-level-permutation-test" } });
  }
  if (claim.adjustment.length > 0 && options.scheme !== "freedman-lane") {
    return notRun("G5a", claimId, "covariate-adjusted tests need Freedman-Lane residual permutation", "freedman-lane-required");
  }
  if (!usable(stage1)) return notRun("G5a", claimId, "null-calibration document unusable", "tool-usage");
  if (stage1.status === "incomplete") return gateResult("G5a", "failed", "some permuted runs failed or reported invalid p-values", { claimId, code: "incomplete" });
  const within = isRecord(stage1.scheme) ? stage1.scheme.within : undefined;
  if (claim.strata.length > 0 && !(typeof within === "string" && claim.strata.length === 1 && within === claim.strata[0])) {
    return notRun("G5a", claimId, "permutations did not respect the declared strata", "strata-ignored");
  }
  const schemeOk = (d: Record<string, unknown>) => isRecord(d.scheme) && d.scheme.unit === "unit_id"
    && claim.exposure !== null && typeof d.scheme.label === "string" && d.scheme.label === claim.exposure
    && (claim.strata.length === 0 ? d.scheme.within === null : claim.strata.length === 1 && typeof d.scheme.within === "string" && d.scheme.within === claim.strata[0]);
  if (!schemeOk(stage1)) return notRun("G5a", claimId, "permutation unit, exposure or strata mismatch", "scheme-mismatch");
  const s1 = rejections(stage1);
  if (s1 === null) return notRun("G5a", claimId, "permutation p-values not reported", "no-p-values");
  if (s1.trials !== POLICY.g5a.stage1) return notRun("G5a", claimId, `null calibration needs exactly ${POLICY.g5a.stage1} permutations first`, "wrong-k");
  let s2: { rejections: number; trials: number } | null = null;
  if (stage2 !== undefined && stage2 !== null) {
    if (!usable(stage2)) return notRun("G5a", claimId, "extension document unusable", "tool-usage");
    if (stage2.status === "incomplete") return gateResult("G5a", "failed", "some permuted runs of the extension failed", { claimId, code: "incomplete" });
    if (!schemeOk(stage2) || !Number.isSafeInteger(stage1.seed) || !Number.isSafeInteger(stage2.seed) || stage1.seed === stage2.seed) return notRun("G5a", claimId, "extension needs matching scheme and distinct seed streams", "extension-provenance");
    s2 = rejections(stage2);
    if (s2 === null) return notRun("G5a", claimId, "extension p-values not reported", "no-p-values");
  }
  const verdict = decideG5a(s1, s2);
  const evidence = { stage1: s1, ...(s2 ? { stage2: s2 } : {}), alpha: POLICY.g5a.alpha };
  if (verdict === "pass") return gateResult("G5a", "passed", `${s1.rejections + (s2?.rejections ?? 0)} of ${s1.trials + (s2?.trials ?? 0)} permuted runs rejected at alpha ${POLICY.g5a.alpha}`, { claimId, evidence });
  if (verdict === "fail") return gateResult("G5a", "failed", "the test rejects too often under the null (anti-conservative)", { claimId, code: "anti-conservative", evidence });
  if (verdict === "extend") return gateResult("G5a", "not-run", `${s1.rejections} of 200 rejected: extend with ${POLICY.g5a.total - POLICY.g5a.stage1} more permutations`, { claimId, code: "extension-required", evidence: { ...evidence, next: { permutations: POLICY.g5a.total - POLICY.g5a.stage1 } } });
  return notRun("G5a", claimId, `the extension must bring the total to ${POLICY.g5a.total} permutations`, "wrong-k");
}

// ------------------------------------------------------------------ G5b (planted effect)

/** `omb-sim planted-effect --effect MEI --seeds 100 --p-key P --ci-keys LO,HI`: two gate results,
 * G5b-power (power >= 0.8 at the MEI, needed for refuted) and G5b-recovery (bias <= 2 SE and CI
 * coverage, needed for effect-size claims). */
export function g5bFromDocument(claim: PlanClaim, doc: unknown): [GateResult, GateResult] {
  const claimId = claim.id;
  const both = (outcome: "not-run" | "failed", summary: string, code: string): [GateResult, GateResult] =>
    [gateResult("G5b-power", outcome, summary, { claimId, code }), gateResult("G5b-recovery", outcome, summary, { claimId, code })];
  if (claim.mei === null) return both("not-run", "no minimum effect of interest to plant", "no-mei");
  if (!usable(doc)) return both("not-run", "planted-effect document unusable", "tool-usage");
  if (doc.status === "incomplete") return both("failed", "some planted runs failed", "incomplete");
  const effect = finite(doc.effect) ? doc.effect : null;
  const signOk = claim.direction === "two-sided" || (effect !== null && (claim.direction === "greater" ? effect > 0 : effect < 0));
  if (effect === null || Math.abs(Math.abs(effect) - claim.mei) > 1e-12 * Math.max(1, claim.mei) || !signOk) {
    return both("failed", "the effect was not planted at the minimum effect of interest", "effect-not-at-mei");
  }
  const seeds = finite(doc.seeds) ? doc.seeds : 0;
  if (!Number.isSafeInteger(seeds) || seeds < POLICY.plantedSeeds) return both("not-run", `planted-effect needs at least ${POLICY.plantedSeeds} seeds`, "too-few-seeds");
  const recovery = isRecord(doc.recovery) ? doc.recovery : {};
  const powerRate = isRecord(recovery.power) && finite(recovery.power.rate) ? recovery.power.rate : null;
  const docAlpha = finite(doc.alpha) ? doc.alpha : null;
  let power: GateResult;
  if (powerRate === null || powerRate < 0 || powerRate > 1) power = gateResult("G5b-power", "not-run", "power not reported (no p-value key)", { claimId, code: "no-power" });
  else if (docAlpha === null || docAlpha <= 0 || docAlpha > claim.alpha) power = gateResult("G5b-power", "not-run", "power was computed at a looser alpha than the locked plan", { claimId, code: "alpha-mismatch" });
  else if (powerRate >= POLICY.powerThreshold) power = gateResult("G5b-power", "passed", `power ${powerRate} at the minimum effect of interest`, { claimId, evidence: { power: powerRate, seeds, alpha: docAlpha } });
  else power = gateResult("G5b-power", "failed", `power ${powerRate} below ${POLICY.powerThreshold}`, { claimId, code: "underpowered", evidence: { power: powerRate, seeds, alpha: docAlpha } });
  const coverage = isRecord(recovery.coverage) && finite(recovery.coverage.rate) ? recovery.coverage.rate : null;
  const coverageCI=isRecord(recovery.coverage)?recovery.coverage.ci95:null,ciLevel=doc.ciLevel,coverageCalibrated=coverage!==null&&finite(ciLevel)&&coverageMeetsNominal(coverage,ciLevel,POLICY.g5bCoverageTolerance);
  const recEvidence = { calibrationMethod:G5B_COVERAGE_METHOD,bias: finite(recovery.bias) ? recovery.bias : null, seMean: finite(recovery.seMean) ? recovery.seMean : null, coverage, seeds, coverageCI, ciLevel,coverageTolerance:POLICY.g5bCoverageTolerance,coverageCalibrated };
  let rec: GateResult;
  if (coverage === null) rec = gateResult("G5b-recovery", "not-run", "CI coverage not reported (no CI keys)", { claimId, code: "no-coverage", evidence: recEvidence });
  else if (doc.status === "recovered" && EVIDENCE_RULES["G5b-recovery"](gateResult("G5b-recovery", "passed", "", { evidence: recEvidence }).evidence) === null) rec = gateResult("G5b-recovery", "passed", "planted effect recovered without bias, with nominal CI coverage", { claimId, evidence: recEvidence });
  else rec = gateResult("G5b-recovery", "failed", `planted effect ${String(doc.status)}`, { claimId, code: String(doc.status), evidence: recEvidence });
  return [power, rec];
}

// ------------------------------------------------------------------ G6 cross-check

/** Optional: compare `omb-sim multiplicity --out` adjusted p-values with the software adjustment. */
export function g6CrossCheck(doc: unknown, expected: Readonly<Record<string, number>>): GateResult {
  if (!usable(doc) || !Array.isArray(doc.tests)) return notRun("G6", undefined, "multiplicity document unusable", "tool-usage");
  const reported = new Map<string, number>();
  if (Object.keys(expected).length === 0) return notRun("G6", undefined, "empty cross-check");
  for (const t of doc.tests.filter(isRecord)) {
    const id = typeof t.id === "string" ? foldKey(t.id) : null;
    const p = finite(t.p_adjusted) ? t.p_adjusted : finite(t.pAdjusted) ? t.pAdjusted : null;
    if (id === null || p === null || p < 0 || p > 1 || reported.has(id)) return notRun("G6", undefined, "malformed or duplicate adjusted p-value");
    reported.set(id, p);
  }
  const off = Object.entries(expected).filter(([id, p]) => {
    const r = reported.get(foldKey(id));
    return r === undefined || Math.abs(r - p) > 1e-9 * Math.max(1, Math.abs(p));
  }).map(([id]) => id);
  return off.length === 0
    ? gateResult("G6", "passed", "toolpack adjustment agrees with the software adjustment", { evidence: { tests: reported.size } })
    : gateResult("G6", "failed", `adjusted p-values disagree for ${off.length} test(s)`, { code: "cross-check-mismatch", evidence: { disagreeing: off } });
}

// ------------------------------------------------------------------ CIT

const CIT_PRECEDENCE = ["fabricated", "quote-not-found", "retracted", "abstract-only", "unverified"];

/** `omb-check citations REFS --index INDEX --index-complete`: one CIT result per citation claim. */
export function citFromDocument(doc: unknown): GateResult[] {
  if (!usable(doc) || !isRecord(doc.check) || !Array.isArray(doc.check.claims)) return [];
  return doc.check.claims.filter(isRecord).flatMap((c) => {
    if (typeof c.claimId !== "string" || !c.claimId.trim()) return [];
    const statuses = Array.isArray(c.citations) ? c.citations.filter(isRecord).map((f) => (typeof f.status === "string" ? f.status : "unverified")) : [];
    if (c.passed === true && Array.isArray(c.citations) && c.citations.every(isRecord) && statuses.length > 0 && statuses.every((s) => s === "verified")) {
      return [gateResult("CIT", "passed", "every cited item verified in full text", { claimId: c.claimId, code: "verified", evidence: { citations: statuses.length, statuses } })];
    }
    const worst = statuses.length === 0 ? "uncited" : CIT_PRECEDENCE.find((s) => statuses.includes(s)) ?? "unverified";
    return [gateResult("CIT", "failed", `citation check: ${worst}`, { claimId: c.claimId, code: worst, evidence: { statuses } })];
  });
}

// ------------------------------------------------------------------ G7 / G8 interfaces

/** V8 implements: a replicator from another model family implements the locked plan; software runs
 * its code (G3/G4 apply to it) and compares decisions. The result must be a GateResult "G7" whose
 * evidence carries these fields (the board re-checks them: same family counts as zero). */
export interface G7Evidence {
  /** Lead family and replicator family; equal (case-folded) means zero replications. */
  readonly families: readonly [string, string];
  /** The evaluator reached the same decision outcome on both primary.json files. */
  readonly sameDecision: boolean;
  /** |delta estimate| <= tolerance. */
  readonly withinTolerance: boolean;
  readonly deltaEstimate: number | null;
  readonly seLead: number;
  readonly seReplicator: number;
  /** min(sqrt(SE1^2 + SE2^2), MEI / 2), calibrated by V8. */
  readonly tolerance: number | null;
  /** Software executed the replicator's code and G3 and G4 passed on it. */
  readonly replicatorVerified: boolean;
}
export interface Replicator {
  replicate(input: { readonly claim: PlanClaim; readonly planHash: string }): Promise<GateResult>;
}

/** V5 implements: the fleet look ledger. A G8 "passed" result's evidence must carry these fields;
 * route N (independent data) yields the "replicated" tier. */
export interface G8Evidence {
  readonly route: "P" | "H" | "N";
  readonly partitionId: string | null;
  readonly lookNumber: 1;
  readonly recordedBeforeExecution: true;
  readonly llmPresent: false;
}
export interface LookLedger {
  /** Record the look before execution; refuses a second look on a burned partition. */
  recordLook(input: { readonly planHash: string; readonly route: "P" | "H" | "N"; readonly partitionId: string | null }): Promise<GateResult>;
}
