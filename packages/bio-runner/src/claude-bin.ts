// Adapted from Amani L/packages/harness/src/claude-bin.ts (e6ca8e2e). Changes: Bio's own override variable and state
// directory (never ~/.omerta), an injectable environment, and tests can never fall through to the real CLI.
// See PROVENANCE.md.
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, realpathSync, renameSync, statSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/**
 * The Claude Code binary every Omerta Bio process launches. Claude Code updates itself by replacing its install in
 * place; on 2026-10-06 an update made `spawn claude` fail mid-run (ENOENT) for a moment in Amani. A long run therefore
 * uses a private copy of the binary per version under ~/.omerta-bio/bin, which updates never touch; the next run picks
 * up the new version. OMERTA_BIO_CLAUDE_BIN overrides everything (tests use a fake).
 */
let cached: string | undefined;

export function claudeBin(env: NodeJS.ProcessEnv = process.env): string {
  if (env.OMERTA_BIO_CLAUDE_BIN) return env.OMERTA_BIO_CLAUDE_BIN;
  // Tests always inject a fake binary. Falling through to `claude` on PATH would run the real CLI; refuse instead.
  if (env.VITEST || process.env.VITEST) throw new Error("the real Claude CLI is forbidden in tests: pass a fake binary");
  if (cached && existsSync(cached)) return cached;
  try {
    const found = execFileSync("/bin/sh", ["-c", "command -v claude"], { encoding: "utf8", env: { PATH: env.PATH ?? "/usr/bin:/bin" } }).trim();
    const real = realpathSync(found);
    // A script install (shebang) cannot be copied on its own; only the self-contained binary is pinned.
    if (statSync(real).size < 10 * 1024 ** 2) return (cached = found);
    const version = execFileSync(real, ["--version"], { encoding: "utf8", timeout: 30000 }).trim().split(/\s+/)[0]!.replace(/[^0-9a-zA-Z.-]/g, "");
    if (!version) return (cached = found);
    const dir = path.join(env.OMERTA_BIO_HOME ?? path.join(env.HOME ?? homedir(), ".omerta-bio"), "bin");
    const pinned = path.join(dir, `claude-${version}`);
    if (!existsSync(pinned)) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const tmp = `${pinned}.${process.pid}.tmp`;
      copyFileSync(real, tmp); chmodSync(tmp, 0o755); renameSync(tmp, pinned);
      // Keep the two newest pinned versions; older ones are garbage.
      const all = readdirSync(dir).filter(f => /^claude-\d/.test(f) && !f.endsWith(".tmp")).map(f => path.join(dir, f)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
      for (const old of all.slice(2)) { try { unlinkSync(old); } catch { /* in use */ } }
    }
    return (cached = pinned);
  } catch { return (cached = "claude"); }
}
