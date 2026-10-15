// Output contract shared by every omb-check command: one JSON document (stdout, or the file
// named by --json-out) and a short human summary (stderr, or stdout with --json-out).
//
// Exit codes: 0 = the check ran to completion and found no problem;
//             1 = the check ran and found a problem, or could not establish the property;
//             2 = usage error or unreadable/malformed input, nothing was checked.
// Only 0 means "verified". 1 and 2 both mean "not verified".

import { writeFileSync } from "node:fs";
import path from "node:path";

export const TOOL_VERSION = "1.0.0";

export interface Io {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  cwd: string;
  env: Readonly<Record<string, string | undefined>>;
}

export type ExitCode = 0 | 1 | 2;

export interface ToolResult {
  exitCode: ExitCode;
  /** One-line verdict, also stored as `summary` in the JSON document. */
  summary: string;
  /** Command-specific payload; merged after the fixed header fields. */
  payload: Record<string, unknown>;
  status: string;
}

export function result(exitCode: ExitCode, status: string, summary: string, payload: Record<string, unknown>): ToolResult {
  return { exitCode, status, summary, payload };
}

export function document(command: string, r: ToolResult): Record<string, unknown> {
  return { tool: "omb-check", version: TOOL_VERSION, command, status: r.status, exitCode: r.exitCode,
    verified: r.exitCode === 0, summary: r.summary, ...r.payload };
}

export function emit(command: string, r: ToolResult, io: Io, jsonOut: string | undefined): void {
  const text = JSON.stringify(document(command, r), null, 2) + "\n";
  const line = `omb-check ${command}: ${r.status} - ${r.summary}\n`;
  if (jsonOut !== undefined) {
    writeFileSync(path.resolve(io.cwd, jsonOut), text);
    io.stdout(line);
  } else {
    io.stdout(text);
    io.stderr(line);
  }
}
