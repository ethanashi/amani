import { postTurnSweepWarning } from "./cleanup-warning.ts";
// Merged from Amani L/packages/harness/src/claude-worker.ts (7a72c0ad: session resume, ClaudeResumeUnavailableError)
// and the network-policy changes in A/packages/harness/src/claude-worker.ts (ea326c85: secretPaths, allowlist and
// egress-proxy settings). Bio changes: two network modes (explore, confirm) instead of open/allowlist/offline; secrets
// are denied in both modes; web tools are always denied; the report carries artifacts and claims; resource limits,
// nice and a cleanup check pass through to the bounded runner; Amani-only host tool sockets and Codex routing are
// dropped. See PROVENANCE.md.
import { createHash } from "node:crypto";
import path from "node:path";
import { readdirSync } from "node:fs";

import { BoundedProcessRunner, canonicalSha256, cleanupEvidence, type CleanupEvidence, type BoundedCommandResult, type CommandRunner, type ResourceLimitKill, type ResourceLimits, type TokenUsage } from "./core.ts";
import { claudeBin } from "./claude-bin.ts";
import { RunnerExecutionTimeoutError } from "./errors.ts";
import { validateNetworkPolicy, type NetworkMode, type NetworkPolicy } from "./network-policy.ts";
import { runnerEnvironment } from "./runner-environment.ts";
import { parseRunnerReport, RUNNER_REPORT_SCHEMA, type ReportArtifact, type ReportClaim, type RunnerStatus } from "./runner-result.ts";

/**
 * Research worker on headless Claude Code: one bounded turn in the investigation's working directory, a structured
 * {status, summary, artifacts, claims} report, usage, and a session id that can be resumed.
 *
 * Containment: Bash runs in Claude Code's OS sandbox (writes confined to the working directory and its own temp
 * directory; unsandboxed commands disabled; the worker fails rather than run unsandboxed); file edits are
 * auto-accepted only inside the working directory; secrets on disk are unreadable to Read and to sandboxed Bash; no
 * MCP servers, no slash commands, no web tools. The network is `confirm` (none) or `explore` (only through the host's
 * logging egress proxy, which enforces the allowlist). Software, not this report, decides what counts.
 */
export interface WorkerEvent { type: string; [key: string]: unknown }

export interface WorkerTurnInput {
  cwd: string;
  prompt: string;
  model: string;
  effort?: string;
  /** Required: there is no default network. */
  network: NetworkPolicy;
  /** Absolute host paths the worker must not read (sealed partitions, hidden checks). A trailing "/" means a directory. */
  denyReadPaths?: string[];
  /** Home directory whose secret paths are denied; defaults to the worker environment's HOME. */
  home?: string;
  timeoutMs?: number;
  resumeThreadId?: string;
  signal?: AbortSignal;
  onEvent?: (event: WorkerEvent) => void;
  /** Private host archive sink, called before parsing, including failed streams. */
  onRawOutput?: (stream: "stdout" | "stderr", chunk: string) => void;
  sandboxMode?: "read-only" | "workspace-write";
  /** Caps on the worker's whole process tree (Claude Code plus every analysis it runs in Bash). */
  resourceLimits?: ResourceLimits;
  nice?: number;
}

export interface WorkerTurnResult {
  status: RunnerStatus;
  summary: string;
  artifacts: ReportArtifact[];
  claims: ReportClaim[];
  /** From Claude Code's own stream (init/result lines), never from model output. */
  sessionId: string;
  usage: TokenUsage;
  events: WorkerEvent[];
  durationMs: number;
  model: string | null;
  requestedModel: string;
  requestedEffort: string | null;
  sandboxMode: "read-only" | "workspace-write";
  networkMode: NetworkMode;
  resumedFrom: string | null;
  /** canonicalSha256 of what the host asked for (model, effort, mode, network, deny rules, tools, prompt hash). */
  turnSpecSha256: string;
  processTreeReaped: boolean;
  cleanupStatus: CleanupEvidence;
  cleanupWarning?: string;
  resourceUsage: BoundedCommandResult["resourceUsage"] | null;
  /** Stream settings are observations, not pre-turn enforcement proof. */
  runtimeAttested: false;
}

export interface RunnerClient {
  execute(input: WorkerTurnInput): Promise<WorkerTurnResult>;
  withRunner(runner: CommandRunner): RunnerClient;
}

/** Where secrets live under a home directory. Denied to Read and sandboxed Bash in every network mode. */
export function secretPaths(home: string | undefined): string[] {
  if (!home || !path.isAbsolute(home)) throw new Error("secret paths need an absolute home directory; refusing to run without them");
  const base = home.replace(/\/+$/, "");
  let privateState: string[] = [];
  try { privateState = readdirSync(home, {withFileTypes:true}).filter(e => e.name.startsWith(".") && ![".local", ".cache", ".cargo", ".rustup", ".pixi", ".bun", ".nvm", ".claude"].includes(e.name)).map(e => e.name + (e.isDirectory() ? "/" : "")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  return [...privateState,
    ".ssh/", ".aws/", ".gnupg/", ".config/gh/", ".config/gcloud/", ".azure/", ".docker/", ".kube/",
    ".omerta/", ".omerta-bio/", ".codex/",
    ".netrc", ".npmrc", ".git-credentials", ".pypirc", ".claude/.credentials.json", ".claude.json",
  ].map(entry => `${base}/${entry}`);
}

/** Environment files anywhere the worker looks. */
const SECRET_PATTERN_RULES = ["Read(**/.env)", "Read(**/.env.*)"];
const WEB_TOOLS = ["WebFetch", "WebSearch"];

/** Deny rules block the Read tool AND sandboxed Bash (OS-level, verified live in Amani). A path ending in "/" is a
 * directory; anything else is a single file. */
export function claudeWorkerSettings(input: { network: NetworkPolicy; denyReadPaths?: string[]; home: string | undefined }): string {
  const network = validateNetworkPolicy(input.network);
  for (const entry of input.denyReadPaths ?? []) {
    if (typeof entry !== "string" || !path.isAbsolute(entry) || entry.includes("\0")) throw new Error(`deny-read path must be absolute: ${String(entry)}`);
  }
  const deny = [...new Set([...(input.denyReadPaths ?? []), ...secretPaths(input.home)])]
    .map(p => p.endsWith("/") ? `Read(/${p}**)` : `Read(/${p})`);
  // confirm: the sandbox proxy allows no host and refuses rather than asks; no local binding either.
  // explore: every sandboxed connection goes to the host's logging egress proxy, which enforces the allowlist.
  const sandboxNetwork = network.mode === "confirm"
    ? { allowLocalBinding: false, allowedDomains: [], strictAllowlist: true }
    : { allowLocalBinding: false, httpProxyPort: network.proxyPort, socksProxyPort: network.proxyPort };
  return JSON.stringify({
    sandbox: { enabled: true, autoAllowBashIfSandboxed: true, allowUnsandboxedCommands: false, failIfUnavailable: true, network: sandboxNetwork },
    permissions: { allow: ["Bash"], deny: [...deny, ...SECRET_PATTERN_RULES, ...WEB_TOOLS] },
  });
}

const REPORT_NOTE = "\n\nWhen you finish, your final structured report has `status` (completed, blocked or inconclusive), a short `summary` of what you did and verified, `artifacts` (every output file you produced, as a path relative to your working directory with a one-line description) and `claims` (each finding as {id, statement, value, artifacts}: `value` is the number you claim or null, and `artifacts` lists paths from your artifacts that support it). The host recomputes every claim from your files; report only what they show.";

export function workerTools(sandboxMode: WorkerTurnInput["sandboxMode"]): string[] {
  return sandboxMode === "read-only" ? ["Read", "Grep", "Glob"] : ["Read", "Grep", "Glob", "Bash", "Edit", "Write"];
}

export function buildClaudeWorkerArgs(input: WorkerTurnInput, home: string | undefined = input.home ?? process.env.HOME): string[] {
  if (!input.model?.startsWith("claude-")) throw new Error("Claude worker requires a claude-* model");
  if (typeof input.prompt !== "string" || !input.prompt.trim()) throw new Error("Claude worker requires a prompt");
  const readOnly = input.sandboxMode === "read-only";
  return ["-p", input.prompt + REPORT_NOTE, "--model", input.model, ...(input.effort ? ["--effort", input.effort] : []),
    "--output-format", "stream-json", "--verbose", "--json-schema", JSON.stringify(RUNNER_REPORT_SCHEMA),
    "--permission-mode", readOnly ? "default" : "acceptEdits", "--settings", claudeWorkerSettings({ network: input.network, home, ...(input.denyReadPaths ? { denyReadPaths: input.denyReadPaths } : {}) }),
    "--tools", ...workerTools(input.sandboxMode),
    "--strict-mcp-config", "--disable-slash-commands", ...(input.resumeThreadId ? ["--resume", input.resumeThreadId] : [])];
}

/** Claude Code's keychain login needs the user name; its sandbox chooses its own temp directory. No proxy variables
 * pass (the allowlist above excludes them): in explore mode the sandbox itself points traffic at the egress proxy. */
export function claudeWorkerEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = runnerEnvironment(source);
  for (const k of ["TMPDIR", "TEMP", "TMP"]) delete env[k];
  for (const k of ["USER", "LOGNAME"]) if (typeof source[k] === "string") env[k] = source[k];
  // Never allow silent model substitution (usage limits/overload); the CLI must error instead.
  env.CLAUDE_CODE_NO_MODEL_FALLBACK = "1";
  return env;
}

export interface ParsedClaudeStream {
  sessionId: string | null; model: string | null; events: WorkerEvent[];
  result: { isError: boolean; structured: unknown; text: string; usage: TokenUsage; subtype: string | null; numTurns: number | null } | null; malformedLines: number;
}

/** Translate Claude Code stream-json into the progress events the host records. */
export function parseClaudeStream(text: string): ParsedClaudeStream {
  const out: ParsedClaudeStream = { sessionId: null, model: null, events: [], result: null, malformedLines: 0 };
  const commands = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let j: Record<string, any>;
    try { j = JSON.parse(line); } catch { out.malformedLines++; continue; }
    if (typeof j !== "object" || j === null) { out.malformedLines++; continue; }
    if (j.type === "system" && j.subtype === "init") {
      out.sessionId = typeof j.session_id === "string" ? j.session_id : out.sessionId; out.model = typeof j.model === "string" ? j.model : out.model;
      out.events.push({ type: "thread.started", thread_id: out.sessionId }, { type: "turn.started" });
    } else if (j.type === "assistant") {
      for (const c of Array.isArray(j.message?.content) ? j.message.content : []) {
        if (c?.type === "tool_use") {
          const kind = c.name === "Bash" ? "command_execution" : c.name === "Edit" || c.name === "Write" ? "file_change" : "tool_call";
          commands.set(c.id, kind);
          out.events.push({ type: "item.started", item: { id: c.id, type: kind, status: "in_progress" } });
        } else if (c?.type === "text") out.events.push({ type: "item.completed", item: { id: j.message?.id ?? "msg", type: "agent_message" } });
      }
    } else if (j.type === "user") {
      for (const c of Array.isArray(j.message?.content) ? j.message.content : []) {
        if (c?.type === "tool_result") out.events.push({ type: "item.completed", item: { id: c.tool_use_id, type: commands.get(c.tool_use_id) ?? "tool_call", status: c.is_error ? "failed" : "completed" } });
      }
    } else if (j.type === "result") {
      const u = j.usage ?? {};
      const count = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
      const usage: TokenUsage = { inputTokens: count(u.input_tokens), outputTokens: count(u.output_tokens), cacheReadInputTokens: count(u.cache_read_input_tokens),
        cacheWriteInputTokens: count(u.cache_creation_input_tokens), reasoningTokens: count(u.output_tokens_details?.thinking_tokens) };
      out.sessionId = typeof j.session_id === "string" ? j.session_id : out.sessionId;
      if (out.result || typeof j.is_error !== "boolean") out.malformedLines++;
      out.result = { isError: j.is_error !== false, structured: j.structured_output, text: typeof j.result === "string" ? j.result : "", usage,
        subtype: typeof j.subtype === "string" ? j.subtype : null, numTurns: typeof j.num_turns === "number" ? j.num_turns : null };
      out.events.push({ type: "turn.completed", usage: { input_tokens: usage.inputTokens + usage.cacheReadInputTokens + usage.cacheWriteInputTokens,
        cached_input_tokens: usage.cacheReadInputTokens, output_tokens: usage.outputTokens, reasoning_output_tokens: usage.reasoningTokens } });
    }
  }
  return out;
}

export function turnSpecSha256(input: WorkerTurnInput, home: string | undefined): string {
  const network = validateNetworkPolicy(input.network);
  const settings = JSON.parse(claudeWorkerSettings({ network, home, ...(input.denyReadPaths ? { denyReadPaths: input.denyReadPaths } : {}) })) as { permissions: { deny: string[] } };
  return canonicalSha256({
    schema: 1,
    model: input.model,
    effort: input.effort ?? null,
    sandboxMode: input.sandboxMode ?? "workspace-write",
    // The proxy port is ephemeral; the allowlist is what was asked for.
    network: network.mode === "explore" ? { mode: "explore", allowedHosts: [...network.allowedHosts].sort() } : { mode: "confirm" },
    deny: [...settings.permissions.deny].sort(),
    tools: workerTools(input.sandboxMode),
    resumeThreadId: input.resumeThreadId ?? null,
    promptSha256: createHash("sha256").update(input.prompt).digest("hex"),
    resourceLimits: input.resourceLimits ?? null,
    nice: input.nice ?? null,
  });
}

export class ClaudeWorkerClient implements RunnerClient {
  readonly #command: string;
  readonly #runner: CommandRunner;
  readonly #env: NodeJS.ProcessEnv;
  readonly #settleMs: number | undefined;
  constructor(input: { command?: string; runner?: CommandRunner; env?: NodeJS.ProcessEnv; settleMs?: number } = {}) {
    this.#env = input.env ?? process.env;
    this.#command = input.command ?? claudeBin(this.#env);
    this.#runner = input.runner ?? new BoundedProcessRunner();
    this.#settleMs = input.settleMs;
  }
  withRunner(runner: CommandRunner): ClaudeWorkerClient {
    return new ClaudeWorkerClient({ command: this.#command, runner, env: this.#env, ...(this.#settleMs === undefined ? {} : { settleMs: this.#settleMs }) });
  }

  async execute(input: WorkerTurnInput): Promise<WorkerTurnResult> {
    if (!path.isAbsolute(input.cwd)) throw new Error("Claude worker requires an absolute working directory");
    const env = claudeWorkerEnvironment(this.#env);
    const home = input.home ?? env.HOME;
    const args = buildClaudeWorkerArgs(input, home);
    const specHash = turnSpecSha256(input, home);
    const sandboxMode = input.sandboxMode ?? "workspace-write";
    let buffered = "";
    const onAbort = () => { void this.#runner.stopAll?.().catch(() => { /* abort stays terminal */ }); };
    input.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      if (input.signal?.aborted) throw Object.assign(new Error("Claude worker aborted"), { name: "AbortError" });
      const result = await this.#runner.run({ command: this.#command, args, cwd: input.cwd, timeoutMs: input.timeoutMs ?? 30 * 60_000,
        maxOutputBytes: 8 * 1024 * 1024, env,
        ...(input.resourceLimits ? { resourceLimits: input.resourceLimits } : {}),
        ...(input.nice === undefined ? {} : { nice: input.nice }),
        ...(this.#settleMs === undefined ? {} : { settleMs: this.#settleMs }),
        onStdoutChunk: chunk => {
          input.onRawOutput?.("stdout", chunk);
          buffered += chunk;
          if (Buffer.byteLength(buffered) > 8 * 1024 * 1024) throw new Error("Claude worker event line exceeds output bound");
          const lines = buffered.split(/\r?\n/); buffered = lines.pop() ?? "";
          for (const e of parseClaudeStream(lines.join("\n")).events) { try { input.onEvent?.(e); } catch { /* observer only */ } }
        },
        onStderrChunk: chunk => input.onRawOutput?.("stderr", chunk) });
      const parsed = parseClaudeStream(result.stdout);
      if (cleanupEvidence(result) === "unproven" && !postTurnSweepWarning(result)) throw new ClaudeWorkerCleanupError(result, parsed);
      if (input.signal?.aborted) throw Object.assign(new Error("Claude worker aborted"), { name: "AbortError" });
      if (result.outputTruncated) throw new Error("Claude worker output was truncated; report withheld");
      if (result.resourceKill) throw new ClaudeWorkerResourceLimitError(result, parsed);
      if (result.timedOut) throw new ClaudeExecutionTimeoutError(result, parsed, sandboxMode);
      if (!parsed.result) throw new ClaudeWorkerNoResultError(result, parsed);
      // A resume request that ran no turn at all found no session to continue (Claude Code 2.1.295: "No conversation found
      // with session ID", a zero-turn error result). The host may start fresh; a session that ran and then failed may not.
      if (input.resumeThreadId && parsed.result.isError && parsed.result.numTurns === 0
        && `${result.stderr}\n${parsed.result.text}`.split(/\r?\n/).some(line =>
          line.trim() === `No conversation found with session ID: ${input.resumeThreadId}`))
        throw new ClaudeResumeUnavailableError(input.resumeThreadId, `${result.stderr} ${parsed.result.text}`.trim().slice(0, 800), result.processTreeReaped, cleanupEvidence(result));
      if (parsed.result.isError) throw new Error(`Claude worker reported an error: ${parsed.result.text.slice(0, 800)}`);
      if (result.exitCode !== 0 || result.signal !== null || parsed.malformedLines > 0)
        throw new Error("Claude worker transport failed or stream was malformed/ambiguous");
      const sessionId = parsed.sessionId ?? input.resumeThreadId;
      if (!sessionId) throw new Error("Claude worker did not report a session id");
      const report = parseRunnerReport(JSON.stringify(parsed.result.structured ?? null));
      return { status: report.status, summary: report.summary, artifacts: report.artifacts, claims: report.claims, sessionId,
        usage: parsed.result.usage, events: parsed.events, durationMs: result.durationMs, model: parsed.model,
        requestedModel: input.model, requestedEffort: input.effort ?? null, sandboxMode, networkMode: input.network.mode,
        ...(postTurnSweepWarning(result) ? { cleanupWarning: postTurnSweepWarning(result)! } : {}),
        resumedFrom: input.resumeThreadId ?? null, turnSpecSha256: specHash, processTreeReaped: result.processTreeReaped, cleanupStatus: cleanupEvidence(result),
        resourceUsage: result.resourceUsage ?? null, runtimeAttested: false };
    } finally { input.signal?.removeEventListener("abort", onAbort); }
  }
}

interface WorkerObservation {
  sessionId: string | null; model: string | null; durationMs: number; usage: TokenUsage | null;
  exitCode: number | null; signal: string | null; timedOut: boolean; processTreeReaped: boolean; cleanupStatus: CleanupEvidence; stderrTail: string;
}

function observe(result: Pick<BoundedCommandResult, "durationMs" | "exitCode" | "signal" | "stderr" | "timedOut" | "processTreeReaped" | "cleanupStatus">, parsed: ParsedClaudeStream): WorkerObservation {
  return { sessionId: parsed.sessionId, model: parsed.model, durationMs: result.durationMs, usage: parsed.result?.usage ?? null,
    exitCode: result.exitCode, signal: result.signal, timedOut: result.timedOut, processTreeReaped: result.processTreeReaped, cleanupStatus: cleanupEvidence(result), stderrTail: result.stderr.slice(-4096) };
}

/**
 * A Claude worker stopped at its deadline, with sufficient host cleanup evidence: the timeout
 * stop (an inconclusive attempt), not a host failure. The host may continue the session.
 */
export class ClaudeExecutionTimeoutError extends RunnerExecutionTimeoutError {
  readonly observation: WorkerObservation & { sandboxMode: string; timedOut: true };
  constructor(result: BoundedCommandResult, parsed: ParsedClaudeStream, sandboxMode: string) {
    super(`Claude worker timed out; cleanup evidence: ${cleanupEvidence(result)}`);
    this.name = "ClaudeExecutionTimeoutError";
    this.observation = { ...observe(result, parsed), sandboxMode, timedOut: true };
  }
}

/** The session a follow-up asked to continue is gone (or never existed on this host); nothing ran. */
export class ClaudeResumeUnavailableError extends Error {
  readonly threadId: string;
  constructor(threadId: string, detail: string, readonly processTreeReaped: boolean = false, readonly cleanupStatus: CleanupEvidence = "unproven") {
    super(`Claude worker could not resume session ${threadId}: ${detail || "no turn ran"}`);
    this.name = "ClaudeResumeUnavailableError"; this.threadId = threadId;
  }
}

/** The worker ended without a result line (killed mid-turn, crashed). The observation says whether its tree is gone. */
export class ClaudeWorkerNoResultError extends Error {
  readonly observation: WorkerObservation;
  constructor(result: BoundedCommandResult, parsed: ParsedClaudeStream) {
    super(`Claude worker produced no result (exit ${result.exitCode}${result.signal ? `, signal ${result.signal}` : ""}; process tree ${result.processTreeReaped ? "reaped" : "NOT proven reaped"}): ${result.stderr.slice(-800)}`);
    this.name = "ClaudeWorkerNoResultError";
    this.observation = observe(result, parsed);
  }
}

/** The resource guard stopped the worker's tree (memory-limit, cpu-limit, or an unmeasurable census). */
export class ClaudeWorkerResourceLimitError extends Error {
  readonly reason: ResourceLimitKill["reason"];
  readonly kill: ResourceLimitKill;
  readonly observation: WorkerObservation;
  constructor(result: BoundedCommandResult, parsed: ParsedClaudeStream) {
    const kill = result.resourceKill!;
    super(`Claude worker stopped by the resource guard: ${kill.reason}`);
    this.name = "ClaudeWorkerResourceLimitError";
    this.reason = kill.reason; this.kill = kill; this.observation = observe(result, parsed);
  }
}

/** The turn finished but the host has insufficient cleanup evidence; its report is withheld. */
export class ClaudeWorkerCleanupError extends Error {
  readonly observation: WorkerObservation;
  constructor(readonly result: BoundedCommandResult, parsed: ParsedClaudeStream) {
    super("Claude worker finished without confirmed process-tree cleanup; report withheld");
    this.name = "ClaudeWorkerCleanupError";
    this.observation = observe(result, parsed);
  }
}
