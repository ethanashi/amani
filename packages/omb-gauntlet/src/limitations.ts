// Software-owned limitation lines (design sections 5 and 10). Every report carries the guarantee's
// scope; each claim carries one line per required gate that did not pass and its status reason.
// Nothing here is model text, so these lines may state software-known numbers directly.

import type { GateBoard, GateId } from "./gates.ts";
import { GATE_NAMES } from "./gates.ts";
import type { LabelResult, Requirement } from "./labels.ts";
import { isStatistical, type PlanClaim } from "./plan.ts";
import { POLICY, describeMei } from "./policy.ts";

/** Lines written into every report, whatever the claims. */
export const REPORT_LIMITATIONS: readonly string[] = Object.freeze([
  "Associational, not causal: these results establish associations under the stated design and assumptions.",
  "Unmeasured confounding is not addressed; every result is conditional on the declared adjustment set and permutation model.",
  "Finite null-calibration simulations are a diagnostic, not a proof of valid null p-values or of a false-confirmation bound. Calibration at 0.05 does not validate smaller alpha thresholds.",
  "Program-wide LORD++ alpha wealth is computed per registered outcome dataset, including unrun proposals; no fleet-wide error bound is claimed.",
  "Statuses are assigned by software from the locked plan and recomputed numbers; they say nothing about biological importance.",
]);

const GATE_LINES: Readonly<Record<GateId, string>> = {
  G1: "software staging validity (duplicates, effective units) was not established",
  G1a: "units were not verified against the software effective units; n may be inflated",
  G1b: "held-out folds were not verified unit-disjoint",
  G1c: "confounding of the exposure by measured covariates was not ruled out or handled",
  G2: "the decision rule was not verified as locked before the confirming data were seen",
  G3: "reported numbers were not verified against a software recomputation; software values are shown",
  G4: "the outputs were not reproduced from raw data in a fresh sandbox",
  G5a: "the test's false-positive rate under the null was not calibrated",
  "G5b-power": `power at the minimum effect of interest was not shown to reach ${POLICY.powerThreshold}`,
  "G5b-recovery": "design-matched interval coverage did not calibrate to the nominal level at the signed effect",
  G6: "program-wide LORD++ state, including unrun hypotheses, was not established",
  G7: "the same locked decision was not reproduced across the required independent model families",
  G5c: "no registered procedure covering this design passed its validity checks",
  G8: "no single, recorded, software-run look at confirming data was verified",
  G9: "The required held-out performance pack or declared baseline comparison did not pass.",
  CIT: "the citation was not resolved verbatim against the frozen index",
};

function outcomeWord(r: Requirement): string {
  if (r.outcome === "passed") return `reported passed but did not count (${r.reason ?? "evidence rule"})`;
  if (r.outcome === "absent") return "not run";
  return r.outcome;
}

export interface LimitationContext {
  readonly claim: PlanClaim | null;
  readonly label: LabelResult;
  readonly board: GateBoard;
  /** "kth hypothesis on this manifest" (fleet registry, V5/V9), when known. */
  readonly hypothesisOrdinal?: number;
  readonly looksAllowed?: number;
}

export function limitationLines(ctx: LimitationContext): string[] {
  const { claim, label } = ctx;
  const lines: string[] = [];
  if (label.voided) lines.push(`Voided: ${label.reasons.join("; ")}. The record is kept; no claim from this job counts.`);
  switch (label.status) {
    case "exploratory": lines.push(`Exploratory (${label.reasons.join("; ")}): hypothesis-generating only.`); break;
    case "non-identifiable": lines.push("Non-identifiable: the exposure is aligned with a measured covariate, so its effect cannot be separated."); break;
    case "tentative": lines.push("Tentative: the recomputed result supports the claim, but not every gate its kind requires passed."); break;
    case "insufficient-evidence": if (!label.voided) lines.push(`Insufficient evidence: ${label.reasons.join("; ")}.`); break;
    case "refuted": lines.push(isStatistical(label.kind ?? "effect-exists")
      ? `Refuted at the minimum effect of interest${claim?.mei != null ? ` (${describeMei(claim.estimand, claim.mei)})` : ""}: smaller effects are not excluded.`
      : "Refuted: software verified the claim to be false."); break;
    case "confirmed":
    case "replicated": {
      const alpha = claim ? claim.alpha / Math.max(1, ctx.looksAllowed ?? POLICY.looksAllowedDefault) : POLICY.alphaDefault;
      if (claim && isStatistical(claim.kind)) lines.push(`Required gates passed at nominal alpha ${alpha}. Error control remains conditional on assumptions A1-A4, including genuinely valid null p-values; passing the gates does not establish those assumptions.`);
      else if (claim?.kind === "reproduction") lines.push("Confirmed means the software recomputation, replicated by an independent model family, matches the published value within the declared tolerance; it does not re-test the published hypothesis.");
      else if (claim?.kind === "data-integrity") lines.push("Verified by software staging of the raw data; no statistical inference is involved.");
      else if (claim?.kind === "citation") lines.push("Resolved verbatim against the frozen index; whether the source supports the claim is not judged.");
      break;
    }
  }
  for (const r of label.notPassed) lines.push(`${r.gate} (${GATE_NAMES[r.gate]}) ${outcomeWord(r)}: ${GATE_LINES[r.gate]}.`);
  if (claim && isStatistical(claim.kind)) {
    if(claim.strata.length===0||ctx.board.lookup("G3",claim.id).result?.evidence.strataAdjusted===true)lines.push(`Conditional on the declared adjustment set (${claim.adjustment.length > 0 ? claim.adjustment.join(", ") : "none"}) and strata (${claim.strata.length > 0 ? claim.strata.join(", ") : "none"}).`);
    else lines.push("The declared stratified estimate and interval were not computed by the trusted model.");
    const g1c = ctx.board.lookup("G1c", claim.id);
    if (g1c.outcome === "failed" && g1c.result?.code === "strong-unhandled") lines.push("A strongly associated covariate was neither adjusted for nor given a declared role with a reason.");
  }
  if ((ctx.looksAllowed ?? 1) > 1) lines.push(`Alpha was divided across ${ctx.looksAllowed} looks.`);
  if (ctx.hypothesisOrdinal !== undefined) lines.push(`This is hypothesis ${ctx.hypothesisOrdinal} tested on this manifest.`);
  else lines.push("Hypothesis ordinal not known; program-wide multiplicity position was not supplied to the certifier.");
  return lines;
}
