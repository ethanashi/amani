import { labelClaim, type LabelInput, type ClaimLabel } from "../../bio-checks/src/index.ts";

/** Exploration cannot become confirmation, even if a future reviewer agrees. */
export function executionLabel(input: LabelInput, exploratory: boolean): ClaimLabel {
  const label = labelClaim(input);
  return exploratory && label === "confirmed" ? "tentative" : label;
}
