// `reproduce -- <command>`: run a command twice, each time in a fresh copy of the directory, and
// compare every file it wrote byte-for-byte (sha256) with bio-checks `compareReexecution`: the
// files currently in the directory are the recorded outputs, the two fresh runs are re-runs.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, constants, copyFileSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, utimesSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { compareReexecution } from "../../../bio-checks/src/index.ts";
import { InputError, nameList, numberFlag, optional, parseArgs, UsageError } from "../args.ts";
import { result, type ToolResult } from "../io.ts";

/** Top-level entries linked (not copied) into each fresh copy: the installed analysis environment. */
const LINKED = new Set(["env", ".pixi"]);
const TAIL_BYTES = 4096;

interface Entry { sha256: string; mtimeMs: number }
type Snapshot = Map<string, Entry>;

function sha256File(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

/** Regular files under ROOT (relative POSIX paths), skipping the linked top-level entries. */
function snapshot(root: string): Snapshot {
  const out: Snapshot = new Map();
  const walk = (dir: string, rel: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!rel && LINKED.has(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(abs, relPath);
      else if (entry.isFile()) out.set(relPath, { sha256: sha256File(abs), mtimeMs: lstatSync(abs).mtimeMs });
    }
  };
  walk(root, "");
  return out;
}

/** Copy SRC to DST: directories, regular files (APFS clone when possible, mtimes preserved) and
 * symlinks as symlinks. The linked top-level entries become symlinks to the originals. */
function copyTree(src: string, dst: string): void {
  mkdirSync(dst, { recursive: true });
  const walk = (from: string, to: string, top: boolean): void => {
    for (const entry of readdirSync(from, { withFileTypes: true })) {
      const a = path.join(from, entry.name);
      const b = path.join(to, entry.name);
      if (top && LINKED.has(entry.name)) { symlinkSync(a, b); continue; }
      if (entry.isSymbolicLink()) symlinkSync(readlinkSync(a), b);
      else if (entry.isDirectory()) { mkdirSync(b); walk(a, b, false); }
      else if (entry.isFile()) {
        copyFileSync(a, b, constants.COPYFILE_FICLONE);
        const stat = lstatSync(a);
        chmodSync(b, stat.mode & 0o777);
        utimesSync(b, stat.atime, stat.mtime);
      }
    }
  };
  walk(src, dst, true);
}

function safeRelative(value: string, flag: string): string {
  const normalized = path.posix.normalize(value);
  if (path.isAbsolute(value) || normalized.startsWith("..") || normalized === "." || value.includes("\0")) {
    throw new UsageError(`--${flag} paths must be relative paths inside the directory`);
  }
  return normalized.replace(/\/$/, "");
}

interface RunOutcome { exitCode: number | null; signal: string | null; timedOut: boolean; stdoutTail: string; stderrTail: string }

function run(command: readonly string[], cwd: string, env: Readonly<Record<string, string | undefined>>, timeoutMs: number): Promise<RunOutcome> {
  return new Promise((resolve) => {
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    const keep = (buffer: Buffer, chunk: Buffer) => { const joined = Buffer.concat([buffer, chunk]); return joined.length > TAIL_BYTES ? joined.subarray(joined.length - TAIL_BYTES) : joined; };
    let child;
    try {
      child = spawn(command[0]!, command.slice(1), { cwd, env: env as NodeJS.ProcessEnv, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      resolve({ exitCode: null, signal: null, timedOut: false, stdoutTail: "", stderrTail: error instanceof Error ? error.message : "spawn failed" });
      return;
    }
    let timedOut = false;
    const killGroup = () => { try { if (child.pid) process.kill(-child.pid, "SIGKILL"); } catch { /* already gone */ } };
    const timer = setTimeout(() => { timedOut = true; killGroup(); }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => { stdout = keep(stdout, chunk); });
    child.stderr.on("data", (chunk: Buffer) => { stderr = keep(stderr, chunk); });
    child.on("error", (error) => { stderr = keep(stderr, Buffer.from(error.message)); });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      killGroup(); // background processes left by the command must not keep writing
      resolve({ exitCode: code, signal, timedOut, stdoutTail: stdout.toString("utf8"), stderrTail: stderr.toString("utf8") });
    });
  });
}

function removeTree(dir: string): boolean {
  const unlock = (p: string): void => {
    try {
      const stat = lstatSync(p);
      if (stat.isDirectory()) { chmodSync(p, 0o700); for (const name of readdirSync(p)) unlock(path.join(p, name)); }
    } catch { /* best effort */ }
  };
  unlock(dir);
  rmSync(dir, { recursive: true, force: true });
  try { lstatSync(dir); return false; } catch { return true; }
}

function written(before: Snapshot, after: Snapshot): string[] {
  const paths = new Set<string>();
  for (const [p, entry] of after) {
    const prior = before.get(p);
    if (!prior || prior.sha256 !== entry.sha256 || prior.mtimeMs !== entry.mtimeMs) paths.add(p);
  }
  for (const p of before.keys()) if (!after.has(p)) paths.add(p);
  return [...paths];
}

const hashes = (snap: Snapshot, paths: readonly string[]): Record<string, string> =>
  Object.fromEntries(paths.filter((p) => snap.has(p)).map((p) => [p, snap.get(p)!.sha256]));

export async function reproduce(argv: readonly string[], cwd: string, env: Readonly<Record<string, string | undefined>>): Promise<ToolResult> {
  const args = parseArgs(argv, { dir: "string", clean: "string", only: "string", "timeout-sec": "string", "json-out": "string" });
  if (args.positionals.length) throw new UsageError("put the command after `--`");
  const command = args.rest;
  if (!command || command.length === 0) throw new UsageError("missing command: omb-check reproduce [options] -- <command> [args...]");
  const dirFlag = optional(args, "dir") ?? ".";
  const source = path.resolve(cwd, dirFlag);
  try { if (!lstatSync(source).isDirectory()) throw new Error(); } catch { throw new InputError(`${dirFlag} is not a directory`); }
  const clean = (nameList(args, "clean") ?? []).map((p) => safeRelative(p, "clean"));
  const only = nameList(args, "only")?.map((p) => safeRelative(p, "only"));
  const reset = [...new Set([...clean, ...(only ?? [])])];
  for (const rel of reset) {
    if (LINKED.has(rel.split("/")[0]!)) throw new UsageError("--clean/--only cannot target the linked runtime");
    let target = source;
    for (const part of rel.split("/")) {
      target = path.join(target, part);
      try { if (lstatSync(target).isSymbolicLink()) throw new InputError("--clean/--only cannot traverse symlinks"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
  }
  const timeoutMs = Math.round((numberFlag(args, "timeout-sec", { min: 0, minExclusive: true }) ?? 3600) * 1000);

  const recordedSnapshot = snapshot(source);
  const scratch = mkdtempSync(path.join(os.tmpdir(), "omb-reproduce-"));
  const runs: (RunOutcome & { written: string[] })[] = [];
  const after: Snapshot[] = [];
  let scratchDeleted = false;
  try {
    for (let r = 1; r <= 2; r += 1) {
      const copy = path.join(scratch, `run${r}`);
      copyTree(source, copy);
      for (const p of reset) rmSync(path.join(copy, p), { recursive: true, force: true });
      const before = snapshot(copy);
      const outcome = await run(command, copy, env, timeoutMs);
      const post = snapshot(copy);
      runs.push({ ...outcome, written: written(before, post).sort() });
      after.push(post);
    }
  } finally {
    scratchDeleted = removeTree(scratch);
  }
  const runInfo = runs.map(({ exitCode, signal, timedOut, stdoutTail, stderrTail, written: w }) => ({ exitCode, signal, timedOut, written: w, stdoutTail, stderrTail }));
  const base = { command, dir: dirFlag, clean, ...(only ? { only } : {}), runs: runInfo, scratchDeleted };
  const failed = runs.findIndex((r) => r.exitCode !== 0 || r.timedOut);
  if (failed >= 0) {
    const r = runs[failed]!;
    return result(1, "command-failed", `run ${failed + 1} ${r.timedOut ? "timed out" : `exited with ${r.exitCode ?? `signal ${r.signal}`}`}; nothing was compared`, base);
  }
  const outputs = only ?? [...new Set([...runs[0]!.written, ...runs[1]!.written])].sort();
  if (outputs.length === 0) return result(1, "no-outputs", "the command wrote no files inside the directory; nothing to compare", base);
  const absent = outputs.filter((p) => !recordedSnapshot.has(p) || after.some((snap) => !snap.has(p)));
  if (absent.length) return result(1, "missing", "requested outputs missing from recorded or fresh runs", { ...base, outputs, missing: absent });
  const recorded = hashes(recordedSnapshot, outputs);
  const reruns = [hashes(after[0]!, outputs), hashes(after[1]!, outputs)];
  const comparison = compareReexecution({ recorded, rerun: reruns });
  const runToRun = compareReexecution({ recorded: reruns[0]!, rerun: [reruns[1]!] });
  const payload = { ...base, outputs, recorded, rerun1: reruns[0], rerun2: reruns[1], comparison, runToRun };
  const summary = comparison.status === "reproduced"
    ? `${outputs.length} output file(s) identical in both fresh runs and in the directory`
    : `${comparison.status}: ${comparison.details.slice(0, 5).join("; ")}${comparison.details.length > 5 ? `; ... (${comparison.details.length} findings)` : ""}; run-to-run: ${runToRun.status}`;
  return result(comparison.status === "reproduced" ? 0 : 1, comparison.status, summary, payload);
}
