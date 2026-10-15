import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { accessSync, constants, closeSync, fstatSync, fsyncSync, lstatSync, openSync, readFileSync, renameSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { claudeWorkerEnvironment } from "../../bio-runner/src/index.ts";
import { privateDirectory, privateFile } from "./paths.ts";

/** onFailure:block was introduced in 2.1.295. Earlier hook timeouts fail open. */
export function requireClaudeVersion(version: string): void {
  const match = /^(\d+)\.(\d+)\.(\d+)(?: \(Claude Code\))?$/.exec(version.trim());
  if (!match) throw new Error("unparseable Claude CLI version");
  const [major, minor, patch] = match.slice(1).map(Number) as [number, number, number];
  if (major < 2 || (major === 2 && (minor < 1 || (minor === 1 && patch < 295)))) throw new Error("Claude Code >=2.1.295 is required for fail-closed hook timeouts");
}

const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
export function verifyClaude(executable: { command: string; sha256: string }): void {
  privateFile(executable.command);
  accessSync(executable.command, constants.X_OK);
  if (hash(readFileSync(executable.command)) !== executable.sha256) throw new Error("pinned Claude executable hash mismatch");
}

/** Inspect one source snapshot, execute only its private single-link copy. */
export function inspectClaude(command: string, env: NodeJS.ProcessEnv, stateRoot: string): { command: string; sha256: string; version: string } {
  const candidates = path.isAbsolute(command) ? [command] : (env.PATH ?? "").split(path.delimiter).filter(path.isAbsolute).map(dir => path.join(dir, command));
  const found = candidates.find(file => { try { accessSync(file, constants.X_OK); return true; } catch { return false; } });
  if (!found) throw new Error("Claude executable unavailable");
  const physical = realpathSync(found);
  const bin = privateDirectory(path.join(stateRoot, "bin"));
  if (lstatSync(bin).mode & 0o077) throw new Error("Claude pin directory must be owner-only");
  const temporary = path.join(bin, `.inspect-${randomUUID()}`);
  const source = openSync(physical, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const st = fstatSync(source);
    // Installed package managers may hardlink the source. This exception never
    // applies to a file we execute, and does not relax source owner/mode checks.
    if (!st.isFile() || (st.mode & 0o022) || (process.getuid && st.uid !== process.getuid())) throw new Error("Claude source is not owner-controlled");
    const bytes = readFileSync(source), sha256 = hash(bytes);
    writeFileSync(temporary, bytes, { flag: "wx", mode: 0o700 });
    verifyClaude({ command: temporary, sha256 });
    const fd = openSync(temporary, constants.O_RDONLY);
    try { fsyncSync(fd); } finally { closeSync(fd); }
    const version = execFileSync(temporary, ["--version"], { env: claudeWorkerEnvironment(env), encoding: "utf8", timeout: 30_000, maxBuffer: 4096 }).trim();
    requireClaudeVersion(version);
    if (hash(readFileSync(physical)) !== sha256) throw new Error("Claude executable changed during inspection");
    verifyClaude({ command: temporary, sha256 });
    const pinned = path.join(bin, `claude-${version.split(" ")[0]}-${sha256.slice(0, 16)}`);
    try {
      lstatSync(pinned);
      verifyClaude({ command: pinned, sha256 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      renameSync(temporary, pinned);
      const dir = openSync(bin, constants.O_RDONLY);
      try { fsyncSync(dir); } finally { closeSync(dir); }
    }
    verifyClaude({ command: pinned, sha256 });
    return { command: pinned, sha256, version };
  } finally { closeSync(source); rmSync(temporary, { force: true }); }
}
