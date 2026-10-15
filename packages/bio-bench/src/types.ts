import type { validity } from "../../bio-checks/src/index.ts";
import type { BootstrapSettings } from "./statistics.ts";

export interface TaskCard {
  id: string;
  family: string;
  datasetManifestHash: string;
  prompt: string;
  sealedAnswerKeyRef: string;
  tolerance: { absolute: number; relative: number };
  plantedFlaws: readonly string[];
  negativeControl: boolean;
  positiveControl: boolean;
  heldOut: boolean;
}

export type ArmKind = "plain-codex" | "codex-tools" | "omerta-bio" | "deterministic-reference" | "plain-claude";
export interface ArmConfig {
  id: string;
  kind: ArmKind;
  modelId: string;
  cliVersion: string;
  effort: string;
  networkMode: "confirm" | "explore";
  /** Canonically sorted; all arms must have exactly the same policy. */
  allowedHosts: readonly string[];
}

export interface BenchmarkSettings {
  /** Stable study identity used by the trusted registration store across runs. */
  studyId: string;
  tasks: readonly TaskCard[];
  arms: readonly ArmConfig[];
  /** Fixed number for EVERY task/arm, including after success or failure. No best-of selection. */
  attemptsPerTask: number;
  timeoutMs: number;
  calibrationTimeoutMs: number;
  gradingTimeoutMs: number;
  statistics: BootstrapSettings & {
    equivalenceMargin: number;
    /** Required, hash-locked minimum of independent paired tasks; at least two. */
    minPairedTasks: number;
    /** One binary unit per task; every attempt must succeed. Negative controls may
     * succeed with accepted refutations rather than a confirmed claim. */
    endpoint: "all-attempts-correct-confirmed";
    population: "all-valid" | "held-out";
  };
}

/** Explicit allowlist: hidden key references, planted flaws and control flags never reach arms. */
export type PublicTask = Pick<TaskCard, "id" | "family" | "datasetManifestHash" | "prompt">;
export interface Claim { id: string; label: "confirmed" | "tentative" | "refuted" | "insufficient" | "contradicted" }
export interface Usage { inputTokens: number; outputTokens: number; costUsd: number }
/** Supplied by the trusted execution adapter, never copied from the AI's JSON.
 * The attestation covers enforcement of the observed mode and allowed hosts.
 */
export interface ObservedProvenance {
  modelId: string;
  cliVersion: string;
  effort: string;
  networkMode: ArmConfig["networkMode"];
  allowedHosts: readonly string[];
  networkEnforced: true;
}
export interface ArmOutput {
  observed: ObservedProvenance;
  status: "completed" | "timeout" | "crashed" | "failed" | "skipped" | "unavailable";
  claims: readonly Claim[];
  /** JSON payload passed to the trusted answer-key grader, never interpreted as a verdict. */
  output: unknown;
  usage: Usage | null;
  reason?: string;
}
export interface Grade {
  outcome: "accepted" | "rejected" | "unavailable";
  claims: readonly { id: string; verdict: "accepted" | "rejected" | "unavailable" }[];
}
export interface RunContext {
  task: PublicTask;
  arm: ArmConfig;
  attempt: number;
  settingsHash: string;
  signal: AbortSignal;
}
export interface BenchmarkDependencies {
  /** Atomically persist the first hash for this study, or compare the existing hash.
   * Return true only after durable registration succeeds. Never overwrite a different
   * hash. The trusted integrator owns storage outside the generator's write scope.
   */
  register: (studyId: string, settingsHash: string) => boolean;
  now: () => number;
  /** Returns a cancellation function. Tests can advance this scheduler exactly. */
  schedule?: (callback: () => void, delayMs: number) => () => void;
  calibration: (task: TaskCard, signal: AbortSignal) => validity.CalibrationInput;
  runArm: (context: RunContext) => unknown | Promise<unknown>;
  grade: (task: TaskCard, output: ArmOutput, signal: AbortSignal) => unknown | Promise<unknown>;
}
export interface AttemptRecord {
  taskId: string;
  /** Locked declaration; observed execution is recorded separately. */
  arm: ArmConfig;
  observed: ObservedProvenance | null;
  attempt: number;
  retries: number;
  settingsHash: string;
  status: ArmOutput["status"] | "invalid-output";
  wallClockMs: number | null;
  usage: Usage | null;
  failures: readonly string[];
  /** Immutable submitted JSON retained for audit; null when no parseable output exists. */
  output: unknown;
  grade: Grade;
  claims: readonly Claim[];
  falseVerified: number;
  correctConfirmed: number;
  unverifiedConfirmed: number;
  success: boolean;
}
export interface TaskCalibration {
  taskId: string;
  status: "valid" | "invalid";
  calibration: validity.CalibrationResult;
}
export interface ArmSummary {
  armId: string;
  denominator: number;
  successes: number;
  successRate: number | null;
  falseVerified: number;
  correctConfirmed: number;
  unverifiedConfirmed: number;
  retries: number;
  failedAttempts: number;
  failures: number;
  timeouts: number;
  crashes: number;
  wallClockMs: number | null;
  usage: Usage | null;
}
