export type TerminalStatus = "success" | "analysis-failed" | "policy-limited" | "canceled" | "worker-killed" | "interrupted" | "cleanup-incomplete";
export type RunStatus = "ready" | "running" | "cleaning" | "paused" | TerminalStatus;
export interface Limits {
  maxAttempts: number;
  deadline: number;
  minFreeBytes: string;
  crashWindowMs: number;
}
export interface RunConfig {
  runId: string;
  authorityDir: string;
  workRoot: string;
  scratchRoots: string[];
  evidenceRoots: string[];
  limits: Limits;
}
export interface GroupRef { id: number; identity: string }
export interface Worktree { repository: string; gitDirectory: string; directory: string }
export interface StepRecord {
  id: string;
  hypothesis: string;
  attempt: number;
  status: "running" | TerminalStatus;
  reason: string;
}
export interface RunState {
  version: 1;
  config: RunConfig;
  status: RunStatus;
  reason: string;
  attempts: Record<string, number>;
  steps: StepRecord[];
  crashes: number[];
  directories: string[];
  groups: GroupRef[];
  launches: string[];
  worktrees: Worktree[];
  cleanupPending: boolean;
  terminalIntent: TerminalStatus | null;
  auditRequired: boolean;
  lastTime: number;
}
export interface WorkerSpec {
  launchId: string;
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}
export interface WorkerExit { code: number | null; signal: string | null }
export interface PreparedWorker {
  group: GroupRef;
  /** The worker must execute no untrusted code until start(), after durable registration. */
  start(): void;
  completion: Promise<WorkerExit>;
}
export interface ProcessHost {
  prepare(spec: WorkerSpec): Promise<PreparedWorker>;
  /** Must return true only after the group/session is absent and no process-group escape was observed. */
  reap(group: GroupRef): Promise<boolean>;
  /** Discover/reap even a gate whose owner died before prepare() returned a group. */
  reapLaunch(launchId: string): Promise<boolean>;
}
export interface WriteAudit {
  status: "complete";
  outsideWrites: string[];
}
export type FaultPoint = "step-recorded" | "workspace-created" | "worktree-recorded" | "worktree-created" | "worker-prepared" | "worker-registered" | "worker-started" | "step-settled" | "cleanup-finished";
export interface Dependencies {
  now(): number;
  /** false means positively dead; unknown/permission errors must not authorize takeover. */
  isAlive?(pid: number): boolean | "unknown";
  ownerPid?: number;
  freeBytes?(directory: string): bigint;
  processes?: ProcessHost;
  /** Trusted sandbox/auditor, never a worker report. Required even after interrupted execution. */
  auditWrites?(state: Readonly<RunState>): WriteAudit | Promise<WriteAudit>;
  schedule?(delayMs: number, callback: () => void): () => void;
  faultAt?(point: FaultPoint): void;
}
export interface StepSpec {
  hypothesis: string;
  command: string;
  args?: string[];
  env?: NodeJS.ProcessEnv;
  worktree?: { repository: string; revision: string };
  signal?: AbortSignal;
}
