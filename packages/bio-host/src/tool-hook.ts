import { createHash } from "node:crypto";
import { appendFileSync, lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { runnerReportViolation } from "../../bio-runner/src/runner-result.ts";
import { noLinks, privateFile, shellQuote } from "./paths.ts";

export interface ToolBoundary {
  cwd: string;
  bash?: { data: string; output: string; toolPath: string };
  reads: string[];
  writes: string[];
  auditFile: string;
  nonce: string;
}

export interface ToolReceipt {
  nonce: string;
  event: string;
  tool: string | null;
  id: string | null;
  decision: "allow" | "deny";
  reason: string | null;
  command?: { sha256: string; preview: string; updatedSha256: string | null };
}

/** Distinguishes a recorded policy denial from an unavailable/broken hook. */
export class ToolPolicyDenied extends Error {}

/** Sanitized reason for the worker-visible JSON hook decision. */
export function hookFailureText(error: unknown): string {
  return `Host boundary refused: ${workerVisible(error instanceof Error ? error.message : "unavailable")}\n`;
}

/** Every denial/error text a worker can see: paths inside its own scratch become relative,
 * and every other absolute host path (repository, home, hook, authority) is withheld. */
export function workerVisible(message: string, cwd?: string): string {
  return message.replace(/(^|[\s'"`(\[{<=:,])(\/[^\s'"`)\]}>,;]*)/g, (_match, lead: string, file: string) =>
    lead + (cwd && cwd.length > 1 && (file === cwd || file.startsWith(`${cwd}/`)) ? path.relative(cwd, file) || "." : "<host path withheld>"));
}

/** Refuse all @ syntax before Claude can expand attachments, including inside JSON.
 * The conservative rule also refuses email addresses; prompts need plain text. */
export function assertSafePrompt(prompt: unknown): asserts prompt is string {
  if (typeof prompt !== "string" || prompt.includes("@")) throw new Error("file-mention syntax is forbidden in worker prompts");
}

/** Native file tools have no shell sandbox. Authorize exact files, with no links,
 * special files, hardlinks, directory traversal, or executable tools. */
export function authorizeTool(boundary: ToolBoundary, event: Record<string, unknown>): void {
  if (event.cwd !== boundary.cwd) throw new Error("worker cwd changed");
  if (event.hook_event_name === "UserPromptSubmit") {
    assertSafePrompt(event.prompt);
    return;
  }
  if (event.hook_event_name !== "PreToolUse") throw new Error("unknown hook event");
  if (event.tool_name === "StructuredOutput") {
    const violation = runnerReportViolation(event.tool_input);
    if (violation) throw new Error(`invalid StructuredOutput: ${violation}`);
    return;
  }
  if (event.tool_name === "Bash" && boundary.bash) {
    const input = event.tool_input as Record<string, unknown>;
    if (!input || typeof input.command !== "string" || !input.command.trim() || input.command.includes("\0") ||
      input.dangerouslyDisableSandbox === true || input.run_in_background === true) throw new Error("sandboxed foreground Bash required");
    return;
  }
  if (!["Read", "Write", "Edit"].includes(String(event.tool_name))) throw new Error("tool is outside the host capability set");
  const input = event.tool_input as Record<string, unknown>;
  if (!input || typeof input.file_path !== "string" || input.file_path.includes("\0")) throw new Error("file_path required");
  const file = path.resolve(boundary.cwd, input.file_path);
  const allowed = event.tool_name === "Read" ? [...boundary.reads, ...boundary.writes] : boundary.writes;
  if (!allowed.includes(file)) throw new Error("file is outside worker scope");
  noLinks(file);
  try {
    const st = lstatSync(file);
    if (!st.isFile() || st.nlink !== 1) throw new Error("non-regular or hardlinked file refused");
  } catch (error) {
    if (event.tool_name !== "Write" || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export function runHook(configFile: string, event: Record<string, unknown>): Record<string, unknown> {
  privateFile(configFile);
  const boundary = JSON.parse(readFileSync(configFile, "utf8")) as ToolBoundary;
  if (event.hook_event_name === "PreToolUse" &&
    (typeof event.tool_use_id !== "string" || !event.tool_use_id || typeof event.tool_name !== "string" || !event.tool_name)) {
    throw new Error("tool identity required");
  }
  let reason: string | null = null;
  try { authorizeTool(boundary, event); }
  catch (error) { reason = error instanceof Error ? error.message : "unavailable policy decision"; }
  const original = event.tool_name === "Bash" && typeof (event.tool_input as { command?: unknown })?.command === "string"
    ? (event.tool_input as { command: string }).command : null;
  const updated = reason === null && original !== null && boundary.bash
    ? ["/usr/bin/env", "-i", `PATH=${boundary.bash.toolPath}`, `HOME=${boundary.cwd}`,
      `TMPDIR=${boundary.cwd}`, `BIO_DATA_DIR=${boundary.bash.data}`, `BIO_OUTPUT_DIR=${boundary.bash.output}`,
      "PYTHONDONTWRITEBYTECODE=1", "OPENBLAS_NUM_THREADS=1", "OMP_NUM_THREADS=1",
      "/bin/bash", "--noprofile", "--norc", "-c", original].map(shellQuote).join(" ") : null;
  const hash = (command: string) => createHash("sha256").update(command).digest("hex");
  privateFile(boundary.auditFile);
  // Record before releasing the tool. Original commands are bounded previews plus
  // hashes; the rewritten command hash binds the environment-reset wrapper too.
  appendFileSync(boundary.auditFile, JSON.stringify({ nonce: boundary.nonce, event: event.hook_event_name,
    tool: event.tool_name ?? null, id: event.tool_use_id ?? null,
    decision: reason === null ? "allow" : "deny", reason,
    ...(original !== null ? { command: { sha256: hash(original), preview: original.slice(0, 1024), updatedSha256: updated === null ? null : hash(updated) } } : {}) }) + "\n", { mode: 0o600 });
  // The receipt keeps the exact reason for the host; the worker sees a path-free one.
  if (reason !== null) throw new ToolPolicyDenied(workerVisible(reason, boundary.cwd));
  return event.hook_event_name === "PreToolUse"
    ? { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow",
        ...(updated !== null ? { updatedInput: { ...(event.tool_input as Record<string, unknown>), command: updated } } : {}) } } : {};

}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  let event: Record<string, unknown> | undefined;
  try {
    // A bounded input prevents a model from turning the policy hook into an allocator.
    const chunks: Buffer[] = []; let bytes = 0;
    for await (const chunk of process.stdin) {
      bytes += Buffer.byteLength(chunk);
      if (bytes > 4 * 1024 * 1024) throw new Error("hook input exceeds bound");
      chunks.push(Buffer.from(chunk));
    }
    event = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    process.stdout.write(JSON.stringify(runHook(process.argv[2]!, event!)) + "\n");
  } catch (error) {
    const reason = hookFailureText(error).trim();
    const denial = event?.hook_event_name === "PreToolUse"
      ? { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } }
      : { continue: false, stopReason: reason };
    process.stdout.write(JSON.stringify(denial) + "\n");
  }
}
