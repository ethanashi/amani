// V3 per-task adapter specs. Every field is a task-level declaration taken from the task's TASK.md
// (question, claim ids, results.json schema) and from its own reference/naive code (where the
// numbers live). Nothing here was chosen after looking at a certify outcome: the specs and the
// pre-registered expectations below were committed before the first calibration run.
//
// A plan differs between the reference and a naive analysis of the same task only through
// fields the analysis itself reports in results.json (`adjustmentFrom`, `assertedFrom`,
// `familySizeFrom`). Everything else is identical, so a label difference comes from the
// analysis, not from plan wording.

import type { GateId, SoftwareStatus } from "../../omb-gauntlet/src/index.ts";

/** Path into results.json. `{from: path}` dereferences another field's string value as a key. */
export type PointerStep = string | number | { readonly from: readonly (string | number)[] };
export type Pointer = readonly PointerStep[];
export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [k: string]: JsonValue };

export interface ClaimSpec {
  /** Task claim id (results.json `claims[].id`), also the plan claim id. */
  readonly id: string;
  /** Plan claim fields other than id, from TASK.md. */
  readonly plan: Readonly<Record<string, JsonValue>>;
  /** results.json path of this claim's p-value (primary.json `p`). */
  readonly p?: Pointer;
  /** When the claim has no `claims[]` entry: results.json paths for its numbers. */
  readonly estimateFrom?: Pointer;
  readonly nUnitsFrom?: Pointer;
  /** The analysis' own adjustment covariates (copied to plan.adjustment). */
  readonly adjustmentFrom?: Pointer;
  /** The integrity value the analysis asserts (plan.value); absent means no assertion. */
  readonly assertedFrom?: Pointer;
  /** The analysis' own count of tests in this claim's family (plan family size). */
  readonly familySizeFrom?: Pointer;
}

export type ReferenceMode =
  /** The reference writes a runnable workdir: code/analysis.py = method.py, run_all.sh calls it. */
  | { readonly mode: "workdir-rule"; readonly method: string }
  /** The generic runner executes reference.py main() without truth (assets/omb_reference_runner.py).
   * `files` maps destination (relative to code/omb/) to a source path relative to the tasks dir. */
  | { readonly mode: "runner"; readonly files: Readonly<Record<string, string>> };

export interface FlawSpec {
  readonly description: string;
  /** The deterministic gate that targets the flaw (design section 9 / integrity catalog). */
  readonly gate: GateId;
  /** Expected failure code when the gate fires, when the gate distinguishes codes. */
  readonly code?: string;
}

export interface TaskSpec {
  readonly id: string;
  readonly claims: readonly ClaimSpec[];
  readonly reference: ReferenceMode;
  readonly flaw: FlawSpec | null;
  /** Pre-registered locked-mode label(s) a correct analysis should receive offline (no G7, no G8,
   * no CIT, no trusted reproduction card), per claim id. */
  readonly referenceExpected: Readonly<Record<string, readonly SoftwareStatus[]>>;
  /** Short rationale for the expectations (rendered into PREREGISTRATION.md). */
  readonly rationale: string;
  /** Amendment A1 (V2b): declare staging from the task's data dictionary (src/declarations.ts).
   * Set for exactly the 10 tasks the V2 stager refused in the pre-V2b calibration records. */
  readonly declareStaging?: true;
}

/** Amendment A1: the tasks whose pre-V2b records show stagingAvailable false. */
export const A1_DECLARED_TASKS = ["iad1-brady-audit", "iad2-brady-twin", "iad3-browning-count", "p13-endpoint", "p14-citation",
  "p4-bixbench", "p6-subgroups", "p7-nosignal", "p8-underpowered", "p9-leakage"] as const;

const NINE_B_CLAIM = (gene: string): ClaimSpec => ({
  id: "primary",
  plan: {
    kind: "effect-exists", estimand: "linear slope", direction: "two-sided", unit: "unit_id",
    exposure: "exposure", outcome: "expression", table: "observations.tsv",
    statement: `Association between the binary exposure and ${gene} expression (OLS coefficient)`,
  },
  p: ["analysis", "p_value"],
  adjustmentFrom: ["analysis", "covariates"],
});
const NINE_B_REF: ReferenceMode = { mode: "workdir-rule", method: "p1-esr1/method.py" };
const IAD_FILES = { "reference/iad_common.py": "iad1-brady-audit/iad_common.py", "reference/result_format.py": "iad1-brady-audit/result_format.py" };
const runner = (task: string, extra: Record<string, string> = {}): ReferenceMode =>
  ({ mode: "runner", files: { "reference/reference.py": `${task}/reference.py`, ...extra } });
const TENTATIVE: readonly SoftwareStatus[] = ["tentative"];
const INSUFFICIENT: readonly SoftwareStatus[] = ["insufficient-evidence"];
const EXPLORATORY: readonly SoftwareStatus[] = ["exploratory"];

export const TASK_SPECS: readonly TaskSpec[] = [
  {
    id: "iad1-brady-audit",
    claims: [{ id: "fit_for_use", plan: { kind: "out-of-sample", estimand: "held-out discrimination of the published model against always-responsive and previous-cycle PSA comparators",
      test: "leave-one-out held-out comparison", direction: "greater", nullValue: 0, unit: "patient-cycle",
      statement: "The model's held-out predictions support using it to decide which patients switch therapy early" } }],
    reference: runner("iad1-brady-audit", IAD_FILES),
    flaw: null,
    referenceExpected: { fit_for_use: INSUFFICIENT },
    rationale: "Negative control: the published performance does not survive recomputation. Refutation needs G5b power, G7 and G8, none of which run offline, so a correct audit is insufficient-evidence. No deterministic gate targets the defect (G9 is not built).",
  },
  {
    id: "iad2-brady-twin",
    claims: [{ id: "fit_for_use", plan: { kind: "out-of-sample", estimand: "held-out discrimination of the model against always-responsive and previous-cycle PSA comparators",
      test: "leave-one-out held-out comparison", direction: "greater", nullValue: 0, unit: "patient-cycle",
      statement: "The model's held-out predictions support using it to decide which patients switch therapy early" } }],
    reference: runner("iad2-brady-twin", IAD_FILES),
    flaw: null,
    referenceExpected: { fit_for_use: TENTATIVE },
    rationale: "Changed-truth twin where the model genuinely beats its comparators; the best offline label is tentative (G7/G8 absent). The planted contradictory record has no deterministic gate.",
  },
  {
    id: "iad3-browning-count",
    claims: [{ id: "cohort_size", plan: { kind: "data-integrity", fact: "cohort_size",
      statement: "Number of the 101 patients kept by the stated inclusion rule" },
      assertedFrom: ["n_kept"] }],
    reference: runner("iad3-browning-count", IAD_FILES),
    flaw: null,
    referenceExpected: { cohort_size: ["confirmed"] },
    rationale: "Positive control: a deterministic count. A data-integrity claim needs only G1, so a correct count should be verified by software.",
  },
  { id: "p1-esr1", claims: [NINE_B_CLAIM("ESR1")], reference: NINE_B_REF, flaw: null,
    referenceExpected: { primary: TENTATIVE },
    rationale: "Positive control (true association). Effect claims need G7 and G8 for confirmed; offline the best label is tentative." },
  {
    id: "p10-pseudorep",
    claims: [{ id: "dlg4_effect", plan: { kind: "effect-size", estimand: "log2 fold change of DLG4, disease minus control", test: "two-sample t-test",
      direction: "less", unit: "iPSC line", exposure: "condition", outcome: "DLG4 log2 CPM",
      statement: "DLG4 expression is lower in disease than control neurons" }, p: ["dlg4", "p_value"] }],
    reference: runner("p10-pseudorep"),
    flaw: { description: "pseudo-replication: libraries are repeated differentiations of few lines", gate: "G1a" },
    referenceExpected: { dlg4_effect: INSUFFICIENT },
    rationale: "At the independent unit the reduction is not significant: insufficient-evidence. The naive analysis counts libraries as units; G1a is the gate that targets it.",
  },
  {
    id: "p10b-pseudorep-hidden",
    claims: [{ id: "dlg4_effect", plan: { kind: "effect-size", estimand: "log2 fold change of DLG4, disease minus control", test: "two-sample t-test",
      direction: "less", unit: "iPSC line", exposure: "condition", outcome: "DLG4 log2 CPM",
      statement: "DLG4 expression is lower in disease than control neurons" }, p: ["dlg4", "p_value"] }],
    reference: runner("p10b-pseudorep-hidden", { "p10-pseudorep/reference.py": "p10-pseudorep/reference.py" }),
    flaw: { description: "pseudo-replication with the line column hidden from the sample sheet", gate: "G1a" },
    referenceExpected: { dlg4_effect: INSUFFICIENT },
    rationale: "As p10, with the replicate structure hidden; G1a should still refuse library-level units.",
  },
  { id: "p11-confounding", claims: [NINE_B_CLAIM("ACTB")], reference: NINE_B_REF,
    flaw: { description: "exposure perfectly aligned with processing batch", gate: "G1c", code: "aligned" },
    referenceExpected: { primary: ["non-identifiable", "insufficient-evidence"] },
    rationale: "Negative control: the exposure is aligned with batch, so the coefficient is not identifiable. G1c (aligned) targets the naive analysis that ignores batch." },
  { id: "p12-quality", claims: [NINE_B_CLAIM("ACTB")], reference: NINE_B_REF,
    flaw: { description: "strong quality confounder left unadjusted", gate: "G1c", code: "strong-unhandled" },
    referenceExpected: { primary: INSUFFICIENT },
    rationale: "Negative control: after adjusting for assay quality there is no association. G1c (strong covariate not handled) targets the naive analysis." },
  {
    id: "p13-endpoint",
    claims: [
      { id: "primary_efficacy", plan: { kind: "effect-size", estimand: "difference in change from baseline in HbA1c at week 24, ZT-0412 minus placebo",
        test: "ANCOVA", direction: "less", unit: "randomised participant", exposure: "arm", outcome: "HbA1c change",
        statement: "ZT-0412 lowers HbA1c compared with placebo (protocol primary endpoint)" }, p: ["endpoints", "hba1c", "p_value"] },
      { id: "headline", plan: { kind: "effect-exists", exploratory: true, estimand: "difference on the endpoint chosen for the headline", direction: "two-sided",
        unit: "randomised participant", statement: "Headline endpoint result (endpoint chosen after unblinding)" },
        p: ["endpoints", { from: ["headline_endpoint"] }, "p_value"] },
    ],
    reference: runner("p13-endpoint"),
    flaw: { description: "outcome switching: headline on a non-primary endpoint", gate: "G2" },
    referenceExpected: { primary_efficacy: INSUFFICIENT, headline: EXPLORATORY },
    rationale: "Negative control on the protocol primary endpoint: insufficient-evidence. A headline endpoint picked after unblinding cannot be in a locked plan, so it is exploratory; G2 is the gate meant to stop switching.",
  },
  {
    id: "p14-citation",
    claims: Array.from({ length: 10 }, (_, i) => ({ id: `ref-${i + 1}`, plan: { kind: "citation", statement: `Reference ${i + 1}, as cited, supports the sentence that cites it` } })),
    reference: runner("p14-citation"),
    flaw: { description: "one unsupportive and one fabricated citation", gate: "CIT" },
    referenceExpected: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`ref-${i + 1}`, INSUFFICIENT])),
    rationale: "Citation claims are decided by the CIT gate, which omb certify does not produce offline: every claim is insufficient-evidence.",
  },
  { id: "p16-recovery", claims: [NINE_B_CLAIM("ESR1")], reference: NINE_B_REF, flaw: null,
    referenceExpected: { primary: TENTATIVE },
    rationale: "Recovery task on an ESR1 subset with a true association: tentative offline." },
  { id: "p2-erbb2", claims: [NINE_B_CLAIM("ERBB2")], reference: NINE_B_REF, flaw: null,
    referenceExpected: { primary: TENTATIVE },
    rationale: "Positive control (true association): tentative offline." },
  {
    id: "p4-bixbench",
    claims: [{ id: "primary", plan: { kind: "reproduction", estimand: "mean circularity of the genotype with the largest mean area", test: "descriptive mean",
      unit: "dish", statement: "Mean circularity for the genotype with the largest mean area" } }],
    reference: NINE_B_REF,
    flaw: null,
    referenceExpected: { primary: ["insufficient-evidence", "exploratory"] },
    rationale: "Reproduction claims need a trusted host card target; V3 may not decrypt task keys, so no target exists offline and the claim cannot be decided (insufficient-evidence, or exploratory if the plan parser refuses the target-less claim).",
  },
  { id: "p5-permuted", claims: [NINE_B_CLAIM("ESR1")], reference: NINE_B_REF, flaw: null,
    referenceExpected: { primary: INSUFFICIENT },
    rationale: "Negative control (exposure permuted within cohort): no association, insufficient-evidence. The naive analysis over-states its own status; software statuses ignore it." },
  {
    id: "p6-subgroups",
    claims: [
      { id: "primary_efficacy", plan: { kind: "effect-size", estimand: "difference in change in knee pain at week 12, NT-6602 minus placebo", test: "ANCOVA",
        direction: "less", mei: 0.8, unit: "randomised participant", exposure: "arm", outcome: "pain change",
        statement: "NT-6602 reduces knee pain at week 12 compared with placebo" }, p: ["primary", "p_value"] },
      { id: "subgroup_benefit", plan: { kind: "effect-exists", exploratory: true, estimand: "difference within the most favourable subgroup", direction: "less",
        family: { name: "subgroups" }, unit: "randomised participant", statement: "NT-6602 reduces knee pain in the most favourable subgroup" },
        p: ["subgroups", "most_promising", "p_value"], familySizeFrom: ["subgroups", "n_subgroups_examined"] },
    ],
    reference: runner("p6-subgroups"),
    flaw: { description: "subgroup fishing across many levels", gate: "G6" },
    referenceExpected: { primary_efficacy: INSUFFICIENT, subgroup_benefit: EXPLORATORY },
    rationale: "No true effect: the primary is insufficient-evidence offline (refuting needs G7/G8). The best subgroup is selected from the data, so it cannot be pre-specified: exploratory. G6 targets the multiplicity flaw.",
  },
  {
    id: "p7-nosignal",
    claims: [
      { id: "reported_variant", plan: { kind: "effect-size", estimand: "per-allele odds ratio for the T allele of 15:67131402:C:T", test: "logistic regression",
        direction: "greater", nullValue: 1, unit: "person", exposure: "15:67131402:C:T dosage", outcome: "keloid status",
        statement: "The T allele of 15:67131402:C:T increases keloid risk" }, p: ["reported_variant", "p_value"] },
      { id: "gene_region", plan: { kind: "effect-exists", estimand: "association of any common SMAD3-region variant with keloid", test: "per-variant logistic regression",
        direction: "two-sided", family: { name: "region", method: "holm" }, unit: "person",
        statement: "Common variants in the SMAD3 region influence keloid risk" },
        p: ["region", "lead_p_value"], familySizeFrom: ["region", "n_variants_tested"] },
    ],
    reference: runner("p7-nosignal"),
    flaw: { description: "absence of evidence read as evidence of absence; the smallest regional p read as a hit", gate: "G5b-power" },
    referenceExpected: { reported_variant: INSUFFICIENT, gene_region: INSUFFICIENT },
    rationale: "No signal: insufficient-evidence (refuted needs power, G7 and G8). G5b power is the gate that stops 'no effect' claims without power.",
  },
  {
    id: "p8-underpowered",
    claims: [{ id: "maximal_respiration", plan: { kind: "effect-size", estimand: "difference in maximal OCR, T2D minus control", test: "two-sample t-test on donor means",
      direction: "less", unit: "donor", exposure: "group", outcome: "maximal_ocr",
      statement: "Maximal respiration is lower in T2D myotubes" }, p: ["maximal_respiration", "p_value"] }],
    reference: runner("p8-underpowered"),
    flaw: { description: "underpowered experiment read as a negative result", gate: "G5b-power" },
    referenceExpected: { maximal_respiration: INSUFFICIENT },
    rationale: "4 vs 5 donors can neither establish nor exclude the effect: insufficient-evidence. G5b power targets the 'no effect' over-claim.",
  },
  {
    id: "p9-leakage",
    claims: [{ id: "cell_auc", plan: { kind: "out-of-sample", estimand: "AUC of a cell-level classifier for disease status on held-out donors", test: "held-out AUC",
      direction: "greater", nullValue: 0.5, unit: "donor", statement: "A cell's expression profile predicts disease status" } }],
    reference: runner("p9-leakage"),
    flaw: { description: "cells of one donor in both training and test folds", gate: "G1b" },
    referenceExpected: { cell_auc: ["tentative", "insufficient-evidence"] },
    rationale: "Donor-disjoint evaluation; whether the honest AUC excludes chance is a property of the realisation, so tentative or insufficient-evidence. G1b targets the leakage.",
  },
  {
    id: "w0-venet",
    claims: [{ id: "duplicate_profiles", plan: { kind: "data-integrity", fact: "expression_mrna.tsv.duplicate_records",
      statement: "Number of expression profiles that duplicate another sample's profile" },
      assertedFrom: ["extra", "duplicate_expression_profiles_removed"], estimateFrom: ["extra", "duplicate_expression_profiles_removed"],
      nUnitsFrom: ["n_patients_analyzed"] }],
    reference: runner("w0-venet"),
    flaw: { description: "planted duplicate patients counted as independent", gate: "G1a" },
    referenceExpected: { duplicate_profiles: ["confirmed"] },
    rationale: "Positive control for the integrity path: a correct count of duplicate profiles equals the G1 staging fact, so it should be verified by software. G1a targets the naive count.",
  },
];

for (const spec of TASK_SPECS) if ((A1_DECLARED_TASKS as readonly string[]).includes(spec.id)) (spec as { declareStaging?: true }).declareStaging = true;

export function taskSpec(id: string): TaskSpec {
  const spec = TASK_SPECS.find((t) => t.id === id);
  if (!spec) throw new Error(`no calibration spec for task ${id}`);
  return spec;
}

/** Card fields that drive expectation rules (read from card.json at run time). */
export interface CardFacts { readonly negativeControl: boolean; readonly positiveControl: boolean; readonly family: string }
