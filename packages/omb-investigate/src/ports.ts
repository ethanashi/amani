// Thin port interfaces V7 codes against. Each names the branch that will satisfy it in production;
// until those merge, BUILD-NOTES lists the stand-ins. Ports are host-side and trusted: no worker
// ever receives a port object, a host path behind it, or anything it returns that is marked
// host-only.

import type { GateResult, PlanClaim } from "../../omb-gauntlet/src/index.ts";
import type { ClaimRecord, ErrorCategory, Json, Route } from "./types.ts";

// ------------------------------------------------------------------ staging (V5 sealer + K1a/K1b + omb-certify Stager)

export interface ContractPin {
  /** K1a public contract hash (analyst-visible layer). */
  publicHash: string;
  /** Host pin passed to the certifier (amendment 7): the host index's pin, never read from worker files. */
  expectedContractHash: string;
  /** Structural facts of the public layer: { floor, unitLevels, tables, unit, blindingStrata }. */
  design: Json;
  /** HOST-ONLY: the pinned public layer envelope on host disk. Never mounted. */
  publicPath: string | null;
  /** HOST-ONLY: public contract source assets (alias registries), staged at contract-assets/<name>. */
  assetsDir: string | null;
  /** Recorded approval for host-authority authentication (null: pinned and verified, never authenticated). */
  approval: { actor: "owner" | "policy"; status: string; reason: string } | null;
}

export interface StageRequest {
  investigationId: string;
  datasetId: string;
  /** Host path of the raw data. */
  dataRoot: string;
  expectedManifestHash: string | null;
  contract: ContractPin | null;
  route: "P" | "H" | "N";
  /** Strings that must not count as data canaries (task prompt text, headers). */
  publicText: string;
}

export interface StagedData {
  realOnlyFiles?:string[];
  datasetId: string;
  manifestHash: string;
  contractHash: string | null;
  /** Worker-readable schema view (shapes, headers, types, missingness, marginal counts; no joint summaries, no values). */
  schemaViewDir: string;
  schemaViewHash: string;
  /** HOST-ONLY: the real (effective) data. Never mounted into a worker. */
  realDataDir: string;
  /** Effective units after duplicate merging, when the contract establishes the unit (else null). */
  effectiveUnits: number | null;
  /** HOST-ONLY: values present in the real data but absent from the schema view (plan-turn canaries). */
  canaries: string[];
  /** Sealed dev/held-out partition (route H), null when none was sealed. Each side has its own pinned
   * manifest: certification binds to the exact confirming input (the held-out manifest for route H). */
  partition: { id: string; hash: string; devDir: string; heldOutDir: string; devManifestHash: string; heldOutManifestHash: string } | null;
  /** G5b-predicted confirm-partition power at the MEI, when known (route H offer). */
  predictedConfirmPower: number | null;
  /** HOST-ONLY certification input under a pinned contract: the real data plus contract-assets/
   * (the contract's public source files). Null without a contract. */
  contractInput?: { dir: string; manifestHash: string } | null;
  /** Host-pinned identity declarations used only to preserve synthetic joins and matrix axes. */
  synthesisSchema?: import("./synthesis-schema.ts").SynthesisTable[];
  /** HOST-ONLY practice declarations per file (served contract roles, keys, entity units); the
   * stager derives them from the schema when absent. Generation and self-check share them. */
  practiceDeclarations?: Record<string, import("./practice-structure.ts").StructureDeclaration>;
  warnings: string[];
}

export interface DerivedData { dir: string; hash: string; warnings: string[]; /** Host-only inventory receipt, never mounted. */ provenance?: string }

/** Host self-check of practice data against the real structure (practice-structure.ts). */
export interface PracticeCheck {
  ok: boolean; rule: string; kind: "scramble" | "synthetic"; tables: number;
  violations: import("./practice-structure.ts").PracticeViolation[];
}

export interface ScrambleRequest {
  staged: StagedData;
  /** Outcome columns to blind (from the locked plan). */
  outcomes: string[];
  /** Exposures of the locked claims: blinding strata must vary them (else refused). */
  exposures: string[];
  /** TRUSTED unit column from the data contract (never the lead's plan); null = row-level. */
  unit: string | null;
  /** TRUSTED blinding strata from the data contract (never the lead's plan); re-checked by the stager. */
  strata: string[];
  /** Content-derived seed (ledger.seed), never a clock or execution id. */
  seed: string;
  investigationId: string;
}

export interface StagerPort {
  stage(request: StageRequest): Promise<StagedData>;
  /** Real layout, outcomes permuted at the unit level within strata, after duplicate merging. */
  scramble(request: ScrambleRequest): Promise<DerivedData>;
  /** Same schema, synthetic values generated from the PUBLISHED schema only (no real value; keys
   * pseudonymised consistently so joins survive), for the pre-look dry run. */
  synthesize(request: { staged: StagedData; seed: string; investigationId: string; outcomes?: readonly string[]; exposures?: readonly string[] }): Promise<DerivedData>;
  /** HOST self-check before any worker code sees practice data: keys, per-unit design levels,
   * allowed levels, missingness and count bounds of the real tables. A violation is a host fault. */
  verifyPractice?(request: { staged: StagedData; data: DerivedData; kind: "scramble" | "synthetic"; outcomes?: readonly string[]; exposures?: readonly string[] }): Promise<PracticeCheck>;
}

// ------------------------------------------------------------------ data contracts (K1a / K1b)

export interface ContractPort {
  /** The pinned contract for a dataset, or null when none exists yet (G1a then cannot pass). */
  pin(request: { datasetId: string; dataRoot: string }): Promise<ContractPin | null>;
}

// ------------------------------------------------------------------ procedures (K2a / K2b)

export interface ProcedureResolution {
  assumptions?: readonly import("./assumptions.ts").MethodAssumption[];
  procedureId: string | null;
  registryVersion: string | null;
  /** omb-certify registry hash of the selected entry (null when none matched). */
  registryHash: string | null;
  /** The locked design the selection used (null when none was locked). */
  design: string | null;
  reason: string;
}

export interface ProcedurePort {
  /** Deterministic function of the LOCKED claim: its estimand and locked design knob (K2b; amendment
   * 7). The worker's test name and the observed data never select the procedure. */
  resolve(request: { claim: PlanClaim }): Promise<ProcedureResolution>;
}

// ------------------------------------------------------------------ lock timeline and look ledger (V5 omb-store)

export interface LockReceipt { sequence: number; hash: string }

export interface PlanLockRequest {
  literatureBriefHash?: string;
  /** Local transport source, never included in a remote lock payload. */
  planFile?: string;
  investigationId: string;
  datasetId: string;
  planHash: string;
  planBytesHash: string;
  contractHash: string | null;
  partitionHash: string | null;
  procedures: Record<string, string | null>;
  registryVersion: string | null;
  plainStatement: string;
  paperSet: string[];
  approvalActor: "owner" | "policy";
}

export interface LookRequest {
  investigationId: string;
  datasetId: string;
  partitionId: string;
  route: Route;
  planHash: string;
  frozenCodeHash: string;
  contractHash: string | null;
  /** Manifest of the exact confirming input this look reads (route H: the held-out partition). */
  inputManifestHash: string;
  executionId: string;
}

export interface LookRecord {
  investigationId: string;
  partitionId: string;
  route: Route;
  /** 1 for the first look on the partition; a repaired re-run is look 2 (Tentative at most). */
  number: number;
  /** Whether execution may proceed (a burned sealed partition cannot be unsealed again). */
  executable: boolean;
  /** Trusted store sequence (G2: lockedAt < firstLookAt). */
  sequence: number;
  hash: string;
  /** Echoed from the request, so a restart can find a look recorded just before a crash. */
  executionId: string;
  frozenCodeHash: string;
}

export interface ContentTuple { registryVersion: string; planLockHash: string; contractHash: string; frozenCodeHash: string; dataHash: string }

export interface LockLedgerPort {
  /** Host-only, idempotent pre-look amendment; unsupported ledgers leave the run parked. */
  authorizeReplan?(request: { investigationId: string; id: string; reason: string; scope?: "plan" | "plan-lock" | "code" | "dry-run" }): Promise<LockReceipt>;
  readonly literatureJournal?: import("./journal.ts").Journal | undefined;
  lockPlan(request: PlanLockRequest): Promise<LockReceipt>;
  recordFreeze(request: { investigationId: string; planHash: string; frozenCodeHash: string; attempt: number; bundleDir?: string }): Promise<LockReceipt>;
  /** Durable (fsynced) BEFORE it returns, and before any execution (L6). */
  recordLook(request: LookRequest): Promise<LookRecord>;
  looks(investigationId: string): Promise<LookRecord[]>;
  /** HMAC(host key, canonical content tuple, purpose): content-derived randomness. */
  seed(tuple: Partial<ContentTuple>, purpose: string): string;
}

// ------------------------------------------------------------------ program-wide hypothesis registry (V5 fleet registry; G6)

export interface RegistryEntry {
  manifest: string;
  fingerprint: string;
  ordinal: number;
  source: Json;
}

/** One software LORD++ decision (certifyDirectory G6) on a registered hypothesis. */
export interface RegistryDecision {
  manifest: string;
  ordinal: number;
  /** p <= the LORD++ threshold the kernel computed (adjustedDecision). */
  rejected: boolean;
  p: number;
  threshold: number;
  /** The rejection set the deciding test saw: a later re-test may never see more. */
  priorRejectionOrdinals: number[];
  investigationId: string;
  claimId: string;
}

/** Program alpha and initial wealth of the LORD++ spending rule (one stream per outcome dataset). */
export interface LordSettings { alpha: number; w0: number }

export interface HypothesisRegistryPort {
  /** Idempotent by (manifest, fingerprint). The ordinal is "kth hypothesis on this manifest". */
  register(entry: { manifest: string; fingerprint: string; source: Json }): { ordinal: number; first: boolean };
  ordinal(manifest: string, fingerprint: string): number | null;
  count(manifest: string): number;
  entries(manifest?: string): RegistryEntry[];
  /** Idempotent per (manifest, ordinal): the first software decision is final (no re-test earns wealth). */
  recordDecision(decision: RegistryDecision): { first: boolean; decision: RegistryDecision };
  decisions(manifest: string): RegistryDecision[];
  lordSettings(): LordSettings;
}

/** omb-certify ProgramMultiplicityDataset, JSON-safe: every registered hypothesis on the outcome
 * dataset (ordinals exactly 1..N, unrun ones with claimId null), earlier software rejections at
 * ordinals below this plan's, and the LORD++ alpha wealth. */
export interface ProgramMultiplicityDataset {
  outcomeDatasetHash: string;
  hypotheses: { claimId: string | null; ordinal: number }[];
  priorRejectionOrdinals: number[];
  alpha: number;
  w0: number;
}

/** The kernel's G6 LORD++ decision for one claim (from its signed G6 evidence). */
export interface MultiplicityDecision { claimId: string; outcomeDatasetHash: string; ordinal: number; p: number; threshold: number; rejected: boolean }

// ------------------------------------------------------------------ execution (omb-certify OfflineExecutor; V5 confirm runner)

export type ExecMode = "dry-run" | "scrambled-twin" | "look" | "replicate" | "route-n";

export interface ExecRequest {
  /** Host-selected bounded timeout; never read from worker output. */
  timeoutMs?: number;
  /** Frozen bundle: plan.json, code/, run_all.sh, run_primary.sh. */
  bundleDir: string;
  dataDir: string;
  /** Fresh host directory that receives the contents of the run's outputs/ (primary.json at its top). */
  outDir: string;
  mode: ExecMode;
  seed: string;
}

export interface ExecResult {
  kind?:import("../../omb-certify/src/execution.ts").ExecutionKind;workerStarted?:boolean;exitCode?:number|null;warnings?:string[];cleanReceipt?:boolean;
  refusal?: import("../../omb-certify/src/source-policy.ts").RefusalRecord;
  hardStop?: string;
  status: "ok" | "crash";
  category: ErrorCategory | null;
  /** HOST-ONLY diagnostics. Shown to a model only before any look (dry run on synthetic data). */
  errorText: string | null;
  outputsHash: string | null;
  /** Output files (relative paths) the software run produced. */
  files: string[];
}

export interface ExecutorPort {
  health():Promise<void>;
  readonly timeoutBudget?: { initialMs: number; hardCapMs: number };
  run(request: ExecRequest): Promise<ExecResult>;
}

// ------------------------------------------------------------------ certification (omb-certify certifyDirectory; K2b)

/** Host-owned trusted target for a reproduction claim (the task card; omb-certify ReproductionTarget).
 * Never shown to a worker. V7 forwards it for the locked claim whose estimand matches by content. */
export interface ReproductionTargetSpec {
  value: number;
  tolerance: { abs: number; rel: number };
  table: string; exposure: string; outcome: string;
  adjustment: readonly string[]; strata: readonly string[];
  nullValue: number; estimand: string;
  producer?: Json;
}

export interface CertifyRequest {
  investigationId: string;
  pass: "certify" | "replicate" | "route-n";
  bundleDir: string;
  lookOutputsDir: string;
  /** HOST-ONLY real data the look used. */
  rawDir: string;
  lock: { planHash: string; lockedAt: number };
  firstLookAt: number;
  expectedInputHash: string;
  expectedCodeHash: string;
  expectedContractHash: string | null;
  /** The pinned host contract (stage phase), with rawDir its contract input; null without one. */
  contract: ContractPin | null;
  /** G8 (look record) and, after replication, G7, as plain gate results; the production adapter seals them. */
  externalGates: GateResult[];
  hypothesisOrdinals: Record<string, number>;
  /** Program-wide LORD++ state from the registry (certifyDirectory fails G6 closed without it). */
  programMultiplicity: ProgramMultiplicityDataset[];
  /** Trusted reproduction targets keyed by locked claim id (host-owned; matched by content). */
  reproductionTargets: Record<string, ReproductionTargetSpec>;
  executionId: string;
  /** No OS-user separation: every label is capped at Tentative (kernel v3 decision). */
  degraded: boolean;
  /** Separation established for this investigation (verified attestation AND the host execution
   * path under the launcher); passed to certifyDirectory, which caps Confirmed without it. */
  osUserSeparation: boolean;
}

export interface CertifyResult {
  reportBindings?: import("../../omb-certify/src/diagnostic-transport.ts").DiagnosticTransport["reportBindings"];
  dataSummaries?: Record<string, Json>;
  diagnostics?: import("./diagnostics.ts").ProcedureDiagnostic[];
  /** Trusted computed fields and provenance, never read from worker JSON. */
  outputs?: Record<string, Json>;
  fieldSources?: Record<string, string[]>;
  claimSources?: Record<string, string[]>;
  diagnosticIntegrity?: import("./diagnostics.ts").DiagnosticIntegrity;
  /** Software-only, tokenized integrity facts; published only after certification. */
  integrity?: import("./integrity.ts").TrustedIntegrity;
  /** Registry-declared integrity facts certified by a Tier C procedure on host-built input. */
  integrityFacts?: import("../../omb-certify/src/procedure-integrity.ts").ProcedureIntegrityFact[];
  claims: ClaimRecord[];
  /** Software numbers for [m:key] prose. */
  metrics: Record<string, number>;
  report: string;
  warnings: string[];
  gates: { gate: string; claimId: string | null; outcome: string }[];
  /** The kernel's G6 LORD++ decisions (passed G6 gates only); recorded back into the registry. */
  multiplicity: MultiplicityDecision[];
}

export interface CertifyPort {
  certify(request: CertifyRequest): Promise<CertifyResult>;
}

// ------------------------------------------------------------------ smaller host ports

/** Read-only literature and ClinicalTrials.gov snapshot fetched by trusted software for the novelty worker. */
export interface LiteraturePort {
  snapshot(request: { programId: string; proposalId: string; query: string }): Promise<{ dir: string; hash: string; sources: string[] }>;
}

/** Infrastructure checks before the first model turn (omb-gauntlet PREFLIGHT_KINDS). */
export interface PreflightPort {
  check(request: { investigationId: string; datasetId: string }): Promise<string[]>;
}

/** Plan approval at lock. The journal records the actual actor; never claims owner approval that did not happen. */
export interface ApprovalPort {
  approve(request: { investigationId: string; planHash: string; plainStatement: string; paperSet: string[] }): Promise<{ actor: "owner" | "policy" }>;
}

export interface HostCapabilities {
  /** Route P also crosses the authority confirmation bridge. */
  nativeConfirmation?: boolean;
  /** Wiring fact: this host's execution path runs worker code as _ombrun and keeps the store and key
   * under _ombcert. Necessary but never sufficient: separation also needs a verified
   * OSAttestationPort attestation (V7-wire item 5). */
  osUserSeparation: boolean;
  sandboxBackend: string;
}

/** `cert-launch attest` result (omb-launcher src/attest.ts) plus the launcher release hash. */
export interface OSAttestation {
  signingPublicKey?: string; authorityProtocol?: string;
  certUser: "_ombcert"; runUser: "_ombrun"; certUid: number; runUid: number;
  effectiveUid: number; storeOwnerUid: number; storeMode: number; keyOwnerUid: number; keyMode: number;
  releaseHash: string;
}
export type OSAttestationResult = { attested: true; attestation: OSAttestation } | { attested: false; reason: string };

/** OS-user attestation. Production: LauncherAttestation (real cert-launch attest via the launcher
 * client, re-checked against the OS). Missing or failing: degraded. */
export interface OSAttestationPort {
  attest(): Promise<OSAttestationResult>;
}

/** Sealed routes own their atomic look boundary and must certify the returned predictions without
 * re-opening raw held-out data. Production implementation delegates to V5 runConfirm. */
export interface ConfirmationPort {
  run(request: { look: LookRequest; execution: ExecRequest }): Promise<{ record: LookRecord | null; result: ExecResult; reason: string | null }>;
  certify(request: CertifyRequest): Promise<CertifyResult>;
}

/** Dedicated host research service. No raw path, metrics, worker session or data values cross this port. */
export interface PlanLiteraturePort {
  prepare(request: { investigationId: string; question: string; datasetId: string; mode: import('../../omb-literature/src/index.ts').SearchMode }): Promise<import('../../omb-literature/src/index.ts').FrozenBrief>;
  novelty(request: { investigationId: string; question: string; briefHash: string }): Promise<void>;
}
