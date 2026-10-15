import { spawnSync } from "node:child_process";
import path from "node:path";

export interface CensusCommandOptions {
  now?: () => number;
  commandTimeoutMs?: number;
  maxAttempts?: number;
  input?: string;
}
export class CensusUnavailable extends Error {}

/** Retry command availability, never a parsed verdict. Each invocation is kill-bounded;
 * successful output is not invalidated by scheduler latency or an elapsed deadline.
 * The default timeout ladder is 5/15/45 seconds, with no retry sleeps. */
export function censusCommand(executable: string, args: string[], options: CensusCommandOptions = {}): string {
  const now = options.now ?? (() => performance.now());
  const timeout = options.commandTimeoutMs ?? 5000, attempts = options.maxAttempts ?? 3;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || !Number.isSafeInteger(attempts) || attempts < 1 || attempts > 10) throw new Error("invalid census command budget");
  let last = now();
  const started = last;
  if (!Number.isFinite(last)) throw new Error("invalid census clock");
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const result = spawnSync(executable, args, { encoding: "utf8", timeout: Math.min(timeout * 3 ** (attempt - 1), 2_147_483_647),
      killSignal: "SIGKILL", maxBuffer: 8 * 1024 * 1024,
      ...(options.input === undefined ? {} : { input: options.input }),
      env: { ...process.env, LC_ALL: "C", LANG: "C", TZ: "UTC0" } });
    const current = now();
    if (!Number.isFinite(current) || current < last) throw new Error("invalid census clock");
    last = current;
    if (!result.error && result.status === 0 && typeof result.stdout === "string" && typeof result.stderr === "string" && !result.stderr.trim()) return result.stdout;
    if (attempt === attempts) {
      // Classify stderr without disclosing process arguments, paths or environment.
      const stderrReason = /permission denied|operation not permitted/i.test(result.stderr ?? '') ? 'permission-denied'
        : /no such process|process not found/i.test(result.stderr ?? '') ? 'process-exited'
        : /illegal option|invalid option|unrecognized option/i.test(result.stderr ?? '') ? 'unsupported-option'
        : result.stderr?.trim() ? 'command-diagnostic' : 'none';
      throw new CensusUnavailable(`process census unavailable: ${path.basename(executable)} exhausted ${attempts} command attempts; elapsedMs=${current - started}; status=${result.status} code=${(result.error as NodeJS.ErrnoException | undefined)?.code ?? "none"} stderr=${Boolean(result.stderr?.trim())} stderrReason=${stderrReason}`);
    }
  }
  throw new CensusUnavailable("process census unavailable");
}
