// ProcedurePort over the K2b procedure registry (omb-certify resolveRegisteredProcedure). The
// registered procedure is a deterministic function of the LOCKED claim: its estimand and its locked
// design knob (`design` / `procedureDesign`). The worker's test name and the observed data never
// select it. At plan lock no data is consulted: the resolver is given zero rows, so it returns the
// procedure the locked design and estimand select (its envelope and validity diagnostics are judged
// by certifyDirectory at certification, on the confirming data). A design that matches no
// registered procedure resolves to null: the certifier then fails G5c and the claim stays Tentative
// at most, by design.

import { resolveRegisteredProcedure, type ClaimData } from "../../omb-certify/src/index.ts";
import { canonicalClaim } from "../../omb-certify/src/procedure-registry.ts";
import { isStatistical, type PlanClaim } from "../../omb-gauntlet/src/index.ts";
import type { ProcedurePort, ProcedureResolution } from "./ports.ts";

/** Zero rows: selection by locked design and estimand only (no data at plan lock). */
const DESIGN_ONLY: ClaimData = Object.freeze({ file: "", units: [], x: [], y: [], strata: [], nuisance: [], covariates: {}, header: [], rows: [] }) as unknown as ClaimData;

/** Registered designs and the estimands each accepts (omb-certify K2b registry), for the plan prompt. */
export const REGISTERED_DESIGNS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "two-group": ["mean difference", "linear difference", "additive difference"],
  paired: ["mean difference", "linear difference", "additive difference"],
  repeated: ["mean difference", "linear difference", "additive difference"],
  crossover: ["mean difference", "linear difference", "additive difference"],
  "stratified-weighted": ["mean difference", "linear difference", "additive difference"],
  "stratified-cr2": ["mean difference", "linear difference", "additive difference"],
  regression: ["linear slope", "linear difference", "mean difference", "additive difference"],
  binary: ["risk difference", "binary risk difference"],
  "brunner-munzel": ["probability superiority", "relative effect", "common language effect"],
  ratio: ["geometric mean ratio", "ratio of geometric means"],
});

export const NO_PROCEDURE_NOTE = "Tentative at most by design (G5c cannot pass without a registered procedure)";

/** Claims the certifier routes through G5c: statistical kinds and non-deterministic reproductions. */
export function needsProcedure(claim: Pick<PlanClaim, "kind" | "estimand">): boolean {
  return isStatistical(claim.kind) || (claim.kind === "reproduction" && claim.estimand !== "deterministic fact");
}

export function lockedDesignOf(claim: PlanClaim): string | null {
  const a = claim.knobs.procedureDesign, b = claim.knobs.design;
  if (a !== undefined && b !== undefined && a !== b) return null;
  const v = a ?? b;
  return typeof v === "string" ? v : null;
}

export function selectRegisteredProcedure(claim: PlanClaim): ProcedureResolution {
  if (!needsProcedure(claim)) return { procedureId: null, registryVersion: null, registryHash: null, design: null, reason: `not a statistical claim (${claim.kind}): no registered procedure applies` };
  const design = lockedDesignOf(claim);
  const registered = resolveRegisteredProcedure(canonicalClaim(claim), DESIGN_ONLY);
  if (registered === null) {
    return {
      procedureId: null, registryVersion: null, registryHash: null, design,
      reason: `no registered procedure matches the locked estimand ${JSON.stringify(claim.estimand)} and design ${design === null ? "(none locked)" : JSON.stringify(design)}: ${NO_PROCEDURE_NOTE}`,
    };
  }
  return {
    assumptions: (registered as typeof registered & { assumptions?: import("./assumptions.ts").MethodAssumption[] }).assumptions ?? [],
    procedureId: registered.procedureId, registryVersion: registered.registryVersion, registryHash: registered.registryHash, design: registered.design,
    reason: `selected by the locked design ${registered.design} and estimand ${JSON.stringify(claim.estimand)}; its envelope and validity diagnostics are judged at certification`,
  };
}

/** Production ProcedurePort: the K2b registry, pure and host-side. */
export class RegistryProcedures implements ProcedurePort {
  async resolve(request: { claim: PlanClaim }): Promise<ProcedureResolution> { return selectRegisteredProcedure(request.claim); }
}
