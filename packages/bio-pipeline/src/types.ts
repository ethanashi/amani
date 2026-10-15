import type { CleanupEvidence, CommandRunner, HostSandbox, ProofArtifactRef } from "../../bio-core/src/index.ts";
import type { AgentSandboxPolicy, StageFile, withReexecutionSandbox } from "../../bio-guard/src/index.ts";
import type { Json, LedgerOptions, LedgerSnapshot, NotebookRecord, Plan } from "../../bio-ledger/src/index.ts";
import type { RunnerClient, WorkerTurnInput } from "../../bio-runner/src/index.ts";
import type { ReconciledClaim, ReexecutionResult } from "../../bio-checks/src/index.ts";

export interface InvestigationConfig {
  id: string;
  question: string;
  successCriterion: string;
  files: StageFile[];
  model: string;
  home: string;
  /** Legacy host-owned Node executable, used when no analysisEnvironment is supplied. */
  node: string;
  toolPath: string;
  timeoutMs: number;
  /** Additional draft attempts, 0..2; default 2. Pinned across restart. */
  planRepairRounds?: number;
}
export type AnalysisRuntime = "node" | "r" | "python";
export type ApprovalActor = "human" | "policy";
export interface AnalysisEnvironment {
  /** Immutable host-owned pixi prefix. Granted reads only to analysis commands. */
  prefix: string;
  /** Absolute host-owned lockfile; its bytes are hashed by the pipeline. */
  lockfile: string;
}
export interface EnvironmentIdentity { prefix: string; lockfileHash: string }
export type PipelineNetwork =
  | { mode: "confirm" }
  | { mode: "explore"; proxyPort: number; allowedHosts: readonly string[];
      /** Complete trusted log in bio-guard TSV format, read after each turn. */
      egressLog(input: { phase: Phase; cwd: string }): Promise<WorkerAudit["egress"]> | WorkerAudit["egress"] };
export interface LaunchRecovery {
  cwd: string; startedAt: number; launchId?: string; handle?: Json;
}
export interface AnalysisPlan {
  declarationOverrides?: import("./inference.ts").DeclarationOverride[];
  /** Omitted means legacy Node. Unknown runtimes are refused. */
  runtime?: AnalysisRuntime;
  /** Omitted means confirmatory; policy approval requires explicit true. */
  exploratory?: boolean;
  datasets: import("./validity.ts").TabularDeclaration[];
  exclusions?: import("./validity.ts").DatasetExclusion[];
  /** Software-evaluated bounds; declared together with requiredChecks "metric-bounds". */
  metricBounds?: import("./metric-bounds.ts").MetricBound[];
  method: string;
  outputs: string[];
  requiredChecks: string[];
  tolerance: { abs: number; rel: number };
}
export interface Proposal {
  hypotheses: string[];
  prediction: string;
  analysis: AnalysisPlan;
}
export type Phase = "draft" | "amend" | "code" | "interpret";
export interface WorkerAudit {
  egress: { lines: string[]; complete: boolean; basis?: "sandbox-deny-all" };
  writes: { status: "complete" | "policy-enforced"; outsideWrites: string[]; basis?: "sandbox-and-reconciled-tool-receipts" };
}
export interface ReportInput {
  snapshot: LedgerSnapshot;
  planHash: string;
  manifestHash: string;
  codeHash: string;
  outputHashes: Record<string, string>;
  claims: ReconciledClaim[];
  reexecution: ReexecutionResult;
  label: "tentative" | "insufficient";
  exploratory: boolean;
  interpretationId: string;
}
export interface PipelineResult {
  status: "completed" | "blocked" | "rejected" | "cleanup-incomplete";
  reason: string;
  label: "tentative" | "insufficient";
  exploratory: boolean;
  claims: ReconciledClaim[];
  reexecution: ReexecutionResult | null;
  report: ProofArtifactRef | null;
  cleanupStatus: CleanupEvidence;
}
export interface PriorRecord {
  investigationId: string;
  record: NotebookRecord;
  /** Status resolved by the trusted source notebook/index, including supersession. */
  status: "refuted" | "contradicted" | "other";
}
export interface PipelineDependencies {
  /** CLI-only trusted adapter binding, checked before import and under the run lock. */
  hostAdapter?: import("./host-adapter.ts").HostAdapterIdentity;
  /** Trusted shared notebook query; complete:false/missing refuses interpretation.
   * Return every record matching any dataset or normalized hypothesis key. */
  priorRecords(input: { manifestHash: string; accessions: string[]; hypothesisKeys: string[] }):
    Promise<{ complete: boolean; records: PriorRecord[] }> | { complete: boolean; records: PriorRecord[] };
  now(): number;
  /** Default confirm; only the trusted host can supply a logging proxy. */
  network?: PipelineNetwork;
  /** Legacy boolean approve callbacks attest human approval by default. */
  approvalActor?: ApprovalActor;
  /** Read before and after each execution; native runtimes require this provider. */
  analysisEnvironment?(): Promise<AnalysisEnvironment> | AnalysisEnvironment;
  /** Must durably register an idempotent launch reservation before returning a JSON
   * handle (a nonblank string or nonempty JSON object; other shapes refuse).
   * The host runner must bind its next dispatch to that reservation. */
  registerLaunch?(launchId: string, cwd: string): Promise<Json> | Json;
  approve(input: { experiment: NotebookRecord<"experiment">; plan: Plan; amendment: boolean }): Promise<boolean> | boolean;
  renderReport(input: ReportInput): Promise<string> | string;
  worker: RunnerClient;
  runner: CommandRunner;
  /** Must enforce guard's read/write policy before launching, including native file tools.
   * The runner's runtimeAttested:false is deliberately NOT treated as attestation. */
  enforceWorkerBoundary(input: { policy: AgentSandboxPolicy; turn: WorkerTurnInput; phase: Phase; developmentInput?: import("./effective-input.ts").EffectiveInput }): Promise<void> | void;
  /** Trusted host telemetry, never model-reported egress or outside-write claims. */
  auditWorker(input: { phase: Phase; cwd: string }): Promise<WorkerAudit> | WorkerAudit;
  sandbox?: HostSandbox;
  /** Trusted sandbox host adapter; defaults to bio-guard's enforcing implementation. */
  reexecutionSandbox?: typeof withReexecutionSandbox;
  signal?: AbortSignal;
  /** Recovery must reap/inspect previously launched jobs before permitting another step. */
  recoverProcesses?(input: LaunchRecovery): Promise<CleanupEvidence> | CleanupEvidence;
  owner?: Pick<LedgerOptions, "pid" | "processState">;
  /** Throw to simulate abrupt orchestrator loss; exact boundaries, no timer races. */
  faultAt?(point: string): void;
  /** Optional task results.json schema (JSON Schema subset). Journaled and hash-pinned
   * before the first draft; when present, results-schema is a mandatory software check. */
  resultsSchema?: unknown;
}
