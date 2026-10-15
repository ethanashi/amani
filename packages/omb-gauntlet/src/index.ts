// @omerta-bio/omb-gauntlet: the trusted, LLM-free claim gauntlet core of Omerta Bio v2 (design
// sections 3 and 5, block V1). Fail closed on claims, fail soft on runs.

export { POLICY, meiCap, meiFloor, meiScale, meiBounds, describeMei, MEI_POLICY } from "./policy.ts";
export { IssueLog, type Issue, type Severity } from "./issues.ts";
export { parseLenientJson, foldKey, normKey, type Json, type ParsedJson } from "./json.ts";

export {
  CLAIM_KINDS, STATISTICAL_KINDS, isStatistical, parsePlan, planLockHash, lockPayload, findClaim, familyOf, checkAmendment,
  type ClaimKind, type Direction, type FamilyMethod, type CovariateRole, type ReproductionTarget, type PlanClaim, type PlanFamily,
  type Plan, type PlanParseResult, type AmendmentCheck,
} from "./plan.ts";

export {
  parsePrimary, parseReported, readClaimEntry, findEntry, buildMetricTable, emptyMetrics,
  type Interval, type PrimaryEntry, type PrimaryOutputs, type PrimaryParseResult, type PrimaryParseOptions, type ReportedParseResult, type ReportedRefusal, type MetricValue, type MetricTable, type MetricSources,
} from "./primary.ts";

export { adjustPValues } from "./multiplicity.ts";

export {
  GATE_IDS, GATE_NAMES, GATE_OUTCOMES, EVIDENCE_RULES, GateBoard, gateResult, readGateResult, decideG5a,
  type GateId, type GateOutcome, type GateResult, type GateLookup,
} from "./gates.ts";

export { evaluateG1a, evaluateG1b, invokesPrepare, readUnitIds, parseDelimited, type G1aInput, type G1bInput, type Table } from "./units.ts";

export {
  evaluateG2, evaluateG3, evaluateG4, evaluateG6, matchesRecomputed, halfDisplayUnit, entryNumbers, claimedNumbers, reportedNumbers, snapshotOutputs,
  type PlanLock, type G2Input, type ClaimedNumber, type G3Input, type OutputSnapshot, type G4Input,
} from "./gates-pure.ts";

export {
  runTool, g1FromGatesDocument, g1cFromConfoundDocument, g5aWaived, g5aFromDocuments, g5bFromDocument, g6CrossCheck, citFromDocument,
  type ToolInvocation, type ToolRunner, type StagingFacts, type G5aOptions, type G7Evidence, type Replicator, type G8Evidence, type LookLedger,
} from "./adapters.ts";

export {
  decideClaim, decidePlan, familyAdjustedP,
  type DecisionOutcome, type DecisionValues, type DecisionResult, type DecisionContext,
} from "./decision.ts";

export {
  SOFTWARE_STATUSES, CONFIRM_REQUIREMENTS, REFUTE_REQUIREMENTS, labelClaim, taskStatusOf, needsLockAndNumbers,
  type SoftwareStatus, type TaskStatus, type Requirement, type LabelInput, type LabelResult,
} from "./labels.ts";

export { REPORT_LIMITATIONS, limitationLines, type LimitationContext } from "./limitations.ts";

export { REFERENCE, findTypedNumbers, formatNumber, formatMetric, renderProse, type TypedNumber, type ProseIssue, type RenderedProse } from "./prose.ts";

export {
  HARD_STOPS, PREFLIGHT_KINDS, SCIENTIFIC_KINDS, REPAIR_KINDS, WARNING_KINDS, routeFailure, observedHardStops, isHardStopKind,
  type HardStopKind, type FailureClass, type ObservedEvent, type Route,
} from "./routing.ts";

export {
  certify, certifyWorkdir, overwriteStatuses, exploratoryClaim, readCapped, readCappedFile, FILE_CAPS,
  type CertifyInput, type ClaimAssessment, type Certification, type WorkdirContext, type WorkdirCertification,
} from "./certify.ts";

export * from "./calibration.ts";
