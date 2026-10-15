import { canonicalJson, canonicalSha256 } from "../../bio-core/src/index.ts";
import type { AnalysisPlan } from "./types.ts";
import type { ValidityEvidence } from "./validity.ts";

/** JSON escapes keep untrusted feedback literal (including file-mention syntax).
 * Decoding the JSON yields the exact checker error, without exposing host paths
 * to the CLI's attachment expansion. */
export function feedbackJson(value: unknown): string {
  return canonicalJson(value).replaceAll("@", "\\u0040").replaceAll("/", "\\u002f");
}

/** Handling may change; the measurement, identity, split and check definitions may not. */
export function validateGateAmendment(old: AnalysisPlan, next: AnalysisPlan, evidence: ValidityEvidence): void {
  const fixed = (p: AnalysisPlan) => ({ ...p, exploratory: true,
    datasets: p.datasets.map(({ handling: _handling, missingValues: _missing, ...d }) => d) });
  if (next.exploratory !== true || canonicalSha256(fixed(old)) !== canonicalSha256(fixed(next))) {
    throw new Error("gate amendment cannot weaken or change locked method, checks, datasets, identities, content fields, splits, outputs or tolerances; exploratory must be true");
  }
  next.datasets.forEach((d, i) => {
    const before = old.datasets[i]!;
    if (canonicalJson(before.missingValues ?? { policy: "refuse" }) !== canonicalJson(d.missingValues ?? { policy: "refuse" }) &&
      ((before.missingValues?.policy ?? "refuse") !== "refuse" || d.missingValues?.policy !== "token")) {
      throw new Error("gate amendment may only add an explicit missingValues token policy to a refusing declaration");
    }
    if ((before.handling === "collapse" && d.handling !== "collapse") ||
      (d.declaredN !== before.declaredN)) {
      throw new Error("gate amendment may only declare collapse; declaredN is software-owned");
    }
  });
}

/** Only staged-data gate evidence is exposed. No observations, priors, sealed
 * partitions, expected outcomes or answer-key sources enter this payload. */
export function gateFeedback(evidence: ValidityEvidence): unknown {
  return evidence.datasets.map(d => ({ file: d.file, allowed: d.allowed, decision: d.decision,
    rowCount: d.rowCount, effectiveN: d.effectiveN, units: d.units,
    findings: d.findings.map(f => ({ name: f.name, passed: f.passed, evidence: f.evidence })) }));
}
