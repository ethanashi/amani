/** Files carry scientific evidence. All transcript fields below are telemetry only. */
export interface WorkerSpec {
  /** Host role capability: API-only clients cannot execute tools. */
  requiresTools?: boolean;
  jobId: string;
  kind: 'plan' | 'code' | 'explore' | 'replicate' | 'select' | 'boss' | 'repair';
  harness: 'codex' | 'claude-code' | 'opencode';
  family: string;
  model: string;
  effort: string;
  workdir: string;
  mounts: readonly { path: string; mode: 'ro' }[];
  promptFile: string;
  network: 'model-api-only';
  timeoutMs: number;
  resume?: { sessionToken: string; message: string };
  expect: readonly { file: string; schema: string; required: boolean }[];
}
/** `refused-prework` / `refused-midtask` (Claude, V6): the provider's usage classifier ended the turn
 * (CLI-level fields only). Infrastructure, never a science failure: the scheduler reroutes, it never
 * grades. `refused-midtask` keeps the partial workdir for audit. */
export type WorkerStatus = 'ok' | 'timeout' | 'rate_limited' | 'needs_resume' | 'infra_error' | 'provider-error' | 'agent_error' | 'violation' | 'provenance_unverified' | 'containment_failure' | 'refused-prework' | 'refused-midtask';
/** Provider safety-classifier refusal, read from CLI wrapper fields only (never message content). */
export interface RefusalReceipt {
  /** `prework`: terminal refusal with no real assistant message, no tool use and no tool result.
   * `midtask`: terminal refusal after work. null: the CLI moved past every refusal (transient). */
  phase: 'prework' | 'midtask' | null;
  terminal: boolean;
  /** Category of the terminal (else last) refusal, e.g. "cyber"; null when the CLI gave none. */
  category: string | null;
  categories: string[];
  /** Provider/CLI explanation text (bounded, control characters removed). */
  explanation: string | null;
  signals: string[];
  refusals: number;
  /** The CLI fell back to another model after a refusal (should not happen under NO_MODEL_FALLBACK). */
  fallback: boolean;
  realAssistantMessages: number; toolUses: number; toolResults: number;
  outputTokens: number | null; durationMs: number | null; safetyStops: number | null;
  requestId: string | null;
}
/** Scheduler hint (V9): re-dispatch this job to another harness. Set only when the final status is
 * `refused-prework` or `refused-midtask` (owner's worker-model rule: refused Claude work goes to Codex). */
export interface RerouteHint {
  to: 'codex';
  reason: 'refused-prework' | 'refused-midtask';
  category: string | null;
  /** true for refused-midtask: keep this workdir for audit and start the Codex attempt in a fresh one. */
  preservePartialWork: boolean;
}
export interface TokenUsage { inputTokens: number; cachedInputTokens: number; outputTokens: number; totalTokens: number }
export interface QuotaWindow { usedPercent: number; windowMinutes: number; resetsAt: number | null }
export interface QuotaSnapshot { primary: QuotaWindow | null; secondary: QuotaWindow | null }
export interface WorkerResult {
  /** Final answer telemetry; never scientific evidence. */
  text?: string;
  providerOutcome?: import("./provider-error.ts").ProviderOutcome;
  violation?:{kind:'canary-exposed'|'non-model-egress'|'trusted-path-changed'|'benchmark-key-access';evidence:string};
  status: WorkerStatus;
  /** Epoch seconds, or null when unavailable. Never fabricated from requested settings. */
  resetAt: number | null;
  sessionToken: string | null;
  files: Record<string, 'valid' | 'repaired' | 'invalid' | 'missing'>;
  warnings: string[];
  usage: TokenUsage | null;
  usageComplete: boolean;
  containment: 'reaped' | 'survivor-killed' | 'unavailable';
  /** The host supervisor's own exit/signal and receipt (survivors killed, census end code), kept
   * separate from the worker's exit. null when no supervisor ran. */
  supervisor: { exitCode: number | null; signal: NodeJS.Signals | null; survivors: number | null; census: number | null; matched?: {pid:number;startSeconds:number;startMicros:number;executable:string}[]; matchedTruncated?: boolean } | null;
  eventsPath: string;
  provenance: {
    cliVersion: string | null; cliSha256: string | null; initInventory: string[];
    observedModels: string[]; observedEfforts: string[];
    identitySource: 'codex-session' | 'claude-stream' | 'opencode-session' | 'unavailable';
    profileSha256: string | null; configSha256: string | null;
    canary: 'denied' | 'failed' | 'unavailable';
  };
  quota: QuotaSnapshot | null;
  rateLimit: { terminal: boolean; signals: string[]; resetHint: string | null };
  /** Claude only (V6); absent for adapters without a provider classifier. */
  refusal?: RefusalReceipt | null;
  reroute?: RerouteHint | null;
}
export interface WorkerAdapter { readonly schemas?:Readonly<Record<string,(bytes:string)=>boolean>>|undefined; run(spec: WorkerSpec): Promise<WorkerResult> }
export interface Launch {
  command: string; args: readonly string[]; cwd: string; env: NodeJS.ProcessEnv;
  overflow?:'kill'|'drain';
  /** Trusted observation before any console truncation. */
  observeStdout?:(chunk:Buffer)=>void;
  stdin?: string; timeoutSignal?: NodeJS.Signals; timeoutMs: number; maxOutputBytes?: number;
  abortSignal?: AbortSignal;
}
export interface ProcessOutcome {
  interruption?: "stall" | "loop" | "transport";
  exitCode: number | null; signal: NodeJS.Signals | null; timedOut: boolean;
  stdout: string; stderr: string; truncated: boolean; cleanupFailed?: boolean;
}
export interface SandboxBackend {
  readonly name: string;
  wrap(profilePath: string, launch: Launch): Launch;
}
export type ProcessRunner = (launch: Launch) => Promise<ProcessOutcome>;
