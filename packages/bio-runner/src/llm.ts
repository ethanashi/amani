// Adapted from Amani L/packages/company/src/llm.ts claudeLlm (e6ca8e2e). Changes: tool-less only; the claude-bin
// import is local; the process runs through the bounded runner (process-tree reaping, transport-only environment)
// instead of a bare spawn with the full parent environment; waiting uses an injected clock and sleep; the caller's
// parser validates the value (schema-invalid output twice is a clear error); usage-limit and transient waits never
// count as failures; the result carries what the host journals (prompt hash, model, attempts). The company-runtime
// reviewer (llmReviewer) is not copied. See PROVENANCE.md.
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";

import { BoundedProcessRunner, CommandStartFailure, cleanupEvidence, type CleanupEvidence, type CommandRunner } from "./core.ts";
import { claudeBin } from "./claude-bin.ts";
import { claudeWorkerEnvironment } from "./claude-worker.ts";

/**
 * Model calls through Claude Code headless with no tools: the prompt goes in, schema-checked JSON comes out. Every
 * call is a fresh session with no persistence, so a critic never shares a context with the agent whose work it reads.
 * A usage limit is waited out (the caller bounds how long); the model defaults to Opus.
 */
export interface LlmJsonInput<T> {
  prompt: string;
  schema: object;
  /** Throws when the value is outside the caller's contract. Required: model output is never trusted as typed. */
  parse: (value: unknown) => T;
  label: string;
  model?: string;
  effort?: string;
  timeoutMs?: number;
}

export interface LlmJsonResult<T> {
  value: T;
  costUsd: number;
  model: string;
  promptSha256: string;
  /** Every invocation of the binary, including usage-limit retries. */
  attempts: number;
  /** Genuine failures retried (malformed output, errors); usage limits and transient errors are not failures. */
  failures: number;
  waitedMs: number;
  processTreeReaped: boolean;
  cleanupStatus: CleanupEvidence;
  /** Cleanup evidence for every completed invocation, including retries. */
  cleanupHistory: CleanupEvidence[];
}

export interface Llm { json<T>(input: LlmJsonInput<T>): Promise<LlmJsonResult<T>> }

export class LlmSchemaError extends Error {
  readonly label: string;
  constructor(label: string, detail: string) {
    super(`model output for ${label} failed its schema twice: ${detail}`);
    this.name = "LlmSchemaError"; this.label = label;
  }
}

// Only a CLI error envelope with a recognized anchored diagnostic permits quota backoff.
const USAGE_LIMIT = /^(?:Claude AI usage limit reached(?:\|\d+)?|(?:API Error: )?(?:429|529)(?:\b.*)|(?:usage limit|rate limit) (?:reached|exceeded)(?:[.: ].*)?)$/i;
class UsageLimitFailure extends Error {}
class CleanupFailure extends Error {
  readonly cleanupStatus = "unproven";
  readonly processTreeReaped = false;
}
const TRANSIENT = /ENOENT|ECONNRESET|EAGAIN|socket hang up/;

export interface ClaudeLlmOptions {
  command?: string;
  runner?: CommandRunner;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  model?: string;
  effort?: string;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Total time a usage limit may be waited out (default 4 h). */
  maxWaitMs?: number;
  /** One usage-limit wait (default 15 min). */
  limitWaitMs?: number;
  /** One transient-error wait (default 30 s), up to 10 minutes in total. */
  transientWaitMs?: number;
}

export function claudeLlm(opts: ClaudeLlmOptions = {}): Llm {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const runner = opts.runner ?? new BoundedProcessRunner();
  const env = opts.env ?? process.env;
  const maxWaitMs = opts.maxWaitMs ?? 4 * 3600_000;
  const limitWaitMs = opts.limitWaitMs ?? 15 * 60_000;
  const transientWaitMs = opts.transientWaitMs ?? 30_000;
  for (const [name, value, minimum] of [["maxWaitMs", maxWaitMs, 0], ["limitWaitMs", limitWaitMs, 1], ["transientWaitMs", transientWaitMs, 1]] as const) {
    if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`invalid LLM wait bound ${name}`);
  }
  return {
    async json<T>(input: LlmJsonInput<T>): Promise<LlmJsonResult<T>> {
      if (typeof input.parse !== "function") throw new Error("tool-less model calls need a parser for their output");
      const command = opts.command ?? claudeBin(env);
      const model = input.model ?? opts.model ?? "claude-opus-5-5";
      const argv = ["-p", "--model", model, "--effort", input.effort ?? opts.effort ?? "medium", "--output-format", "json",
        "--json-schema", JSON.stringify(input.schema), "--tools", "", "--strict-mcp-config", "--disable-slash-commands", "--no-session-persistence"];
      const promptSha256 = createHash("sha256").update(input.prompt).digest("hex");
      const started = now();
      let attempts = 0, failures = 0, transientWaited = 0, limitWaited = 0;
      const cleanupHistory: CleanupEvidence[] = [];
      for (;;) {
        attempts++;
        try {
          const result = await runner.run({ command, args: argv, cwd: opts.cwd ?? realpathSync(tmpdir()), env: claudeWorkerEnvironment(env),
            stdin: input.prompt, timeoutMs: input.timeoutMs ?? 10 * 60_000, maxOutputBytes: 4 * 1024 * 1024, settleMs: 0 }).catch(error => {
              if (error instanceof CommandStartFailure) throw error;
              throw new CleanupFailure("Claude LLM runner failed without confirmed cleanup", { cause: error });
            });
          cleanupHistory.push(cleanupEvidence(result));
          if (cleanupEvidence(result) === "unproven") throw new CleanupFailure("Claude LLM ended without confirmed cleanup");
          if (result.outputTruncated) throw new Error("Claude LLM output was truncated");
          let envelope: Record<string, unknown> | undefined;
          try { const parsed: unknown = JSON.parse(result.stdout); if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) envelope = parsed as Record<string, unknown>; } catch { /* ordinary failure */ }
          if (!result.timedOut && result.signal === null && envelope?.type === "result" && envelope.is_error === true
            && typeof envelope.result === "string" && USAGE_LIMIT.test(envelope.result)) throw new UsageLimitFailure(envelope.result);
          if (result.timedOut) throw new Error(`${command} timed out`);
          if (result.exitCode !== 0 || result.signal !== null) throw new Error(`${command} exited ${result.exitCode ?? result.signal}: ${result.stderr.slice(-4000) || result.stdout.slice(-1500)}`);
          const outer = JSON.parse(result.stdout) as Record<string, unknown>;
          if (outer.is_error !== false) throw new Error(String(outer.result ?? "model error"));
          let raw: unknown;
          try { raw = outer.structured_output ?? JSON.parse(String(outer.result).replace(/^```(?:json)?\s*|\s*```$/g, "")); }
          catch (error) { throw new SchemaFailure(`not JSON: ${(error as Error).message}`); }
          let value: T;
          try { value = input.parse(raw); }
          catch (error) { throw new SchemaFailure((error as Error).message); }
          return { value, costUsd: typeof outer.total_cost_usd === "number" ? outer.total_cost_usd : 0, model, promptSha256, attempts, failures, waitedMs: now() - started, processTreeReaped: result.processTreeReaped, cleanupStatus: cleanupEvidence(result), cleanupHistory };
        } catch (e) {
          if (e instanceof CleanupFailure) throw e;
          const text = String((e as Error).message ?? e);
          if (!(e instanceof SchemaFailure)) {
            if (e instanceof UsageLimitFailure && Math.max(now() - started, limitWaited) + limitWaitMs <= maxWaitMs) { limitWaited += limitWaitMs; await sleep(limitWaitMs); continue; }
            // The binary was being replaced by an update, or the connection dropped: wait and retry, up to 10 minutes.
            if (TRANSIENT.test(text) && transientWaited + transientWaitMs <= 10 * 60_000) { await sleep(transientWaitMs); transientWaited += transientWaitMs; continue; }
          }
          failures++;
          if (failures < 2) continue;
          if (e instanceof SchemaFailure) throw new LlmSchemaError(input.label, e.message);
          throw e;
        }
      }
    },
  };
}

class SchemaFailure extends Error {}
