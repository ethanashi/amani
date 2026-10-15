export interface BoundedCommandSpec {
  command: string;
  args: string[];
  cwd: string;
  /** Exclusive run workspace for orphan-reference evidence when cwd is shared host code.
   * Tracked birth identities remain in scope regardless of workspace. Defaults to cwd. */
  cleanupCwd?: string;
  timeoutMs: number;
  env?: NodeJS.ProcessEnv;
  maxOutputBytes?: number;
  onStdoutChunk?: (chunk: string) => void;
  onStderrChunk?: (chunk: string) => void;
  /** Host broker may transfer accepted loopback connections, never its listener. */
  onSocketChannel?: (send: (socket: import("node:net").Socket) => Promise<void>) => void;
  /** Caps measured by the host's `ps` census of the whole process family; a hog is killed with a recorded reason. */
  resourceLimits?: ResourceLimits;
  /** Scheduling niceness (1-19) set by `nice` before the target executes, so every descendant inherits it. */
  nice?: number;
  /** Bound on the cooperative wait for retained groups after the root exits normally (default 2000 ms). */
  settleMs?: number;
  /** Written to the command's standard input, which is then closed. Without it stdin is /dev/null. */
  stdin?: string;
}

/** Niceness for analysis jobs: they yield the CPU to the host's own supervisor and checker. */
export const ANALYSIS_JOB_NICE = 10;

export interface ResourceLimits {
  /** Summed resident set size of every live process in the family, in bytes. */
  maxRssBytes?: number;
  /** Summed CPU time (user + system) of every process ever observed in the family, in milliseconds. */
  maxCpuMs?: number;
}

/**
 * Why the guard killed a process family. `limit-census-unavailable`: limits were requested but the census could not
 * measure the family, so the caps could not be enforced; the guard fails closed and stops the job.
 */
export type ResourceLimitReason = "memory-limit" | "cpu-limit" | "limit-census-unavailable";

export interface ResourceLimitKill {
  reason: ResourceLimitReason;
  /** The cap that was crossed (bytes for memory, ms for CPU); null for a census gap. */
  limit: number | null;
  /** The measurement that crossed it; null for a census gap. */
  observed: number | null;
  /** Processes in the family at the observation. */
  pids: number[];
}

export interface ResourceUsage {
  peakRssBytes: number;
  cpuMs: number;
}

export interface BoundedCommandResult {
  pid: number;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  /** True only with complete containment evidence; a sampled ps census always returns false. */
  processTreeReaped: boolean;
  /** Explicit graded evidence; missing status is unproven for worker/LLM consumers. */
  cleanupStatus?: import("./cleanup-evidence.ts").CleanupEvidence;
  cleanupReason?: "sampling-gap" | "census-unavailable" | "sweep-unavailable" | "unattributed" | "survivor" | "groups-alive" | "inspection-failed";
  /** Host inspection failure, including the underlying command/error reason. */
  cleanupDiagnostic?: string;
  cleanupObservations?: import("./cleanup-evidence.ts").CleanupObservation[];
  /** Whether the groups that were actually attributed disappeared; never proof of the whole tree. */
  observedGroupsReaped?: boolean;
  /** At least one output stream exceeded its byte cap; retained output is only a tail. */
  outputTruncated?: boolean;
  processGroupIds: number[];
  stdout: string;
  stderr: string;
  durationMs: number;
  /** Present only when the resource guard stopped the family. */
  resourceKill?: ResourceLimitKill;
  /** Present only when resource limits were requested. */
  resourceUsage?: ResourceUsage;
}

export interface CommandRunner {
  run(spec: BoundedCommandSpec): Promise<BoundedCommandResult>;
  stopAll?(): Promise<void>;
}

export interface ProofCommandDefinition {
  id: string;
  /** Absolute host-owned executable. Candidate PATH resolution is forbidden. */
  command: string;
  args: string[];
  timeoutMs: number;
  expectedExitCode?: number;
  /** Explicit host-checker convention for missing prerequisites, never a candidate report. */
  inconclusiveExitCodes?: number[];
  /** Exact relative output paths declared by the host; never discovered from candidate JSON. */
  artifacts?: Array<{ path: string; label: string; mediaType: string; required?: boolean }>;
  /** Host-declared: this check may listen and connect on 127.0.0.1 (for example to start the app and drive it with a browser). Never any other network. */
  loopback?: boolean;
  /** Host-declared: this check drives headless Chromium (implies loopback). */
  browser?: boolean;
}

export interface CommandProofTrace {
  commandId: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  processTreeReaped: boolean;
  durationMs: number;
  stdoutSha256: string;
  stderrSha256: string;
  sandboxClass?: "seatbelt" | "bwrap" | "refuse";
}
