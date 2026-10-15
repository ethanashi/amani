// Thin wrapper over packages/bio-baseline/arms/lib/seal.py (seal v2: version marker, HMAC-SHA256
// over marker + ciphertext, OpenSSL AES-256-CTR with PBKDF2; the .sha256 sidecar hashes the
// envelope, never the plaintext). The wrapper never reimplements the crypto: it runs seal.py with
// an explicit key path and grading root so seal.py can never fall back to ~/.omerta-bio.
//
// Key resolution: OMB_CITATION_SUITE_KEY (a key file path), else the package's gitignored
// .private/keys/citation-suite.key. Grading root (seal.py's scratch and plaintext area, which must
// be under $HOME): OMB_CITATION_SUITE_GRADING_ROOT, else the package's gitignored .private/grading.

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const SEAL_PY = resolve(PACKAGE_DIR, "../bio-baseline/arms/lib/seal.py");

export interface SealEnv {
  keyPath: string;
  gradingRoot: string;
  python?: string;
  sealPy?: string;
}

export function defaultSealEnv(env: NodeJS.ProcessEnv = process.env): SealEnv {
  return {
    keyPath: env.OMB_CITATION_SUITE_KEY ?? join(PACKAGE_DIR, ".private", "keys", "citation-suite.key"),
    gradingRoot: env.OMB_CITATION_SUITE_GRADING_ROOT ?? join(PACKAGE_DIR, ".private", "grading"),
  };
}

export function keyAvailable(env: SealEnv): boolean {
  try {
    return statSync(env.keyPath).isFile() && statSync(env.keyPath).size >= 32;
  } catch {
    return false;
  }
}

function run(env: SealEnv, args: string[]): Buffer {
  mkdirSync(env.gradingRoot, { recursive: true, mode: 0o700 });
  const childEnv: NodeJS.ProcessEnv = {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: process.env.HOME ?? "",
    BIO_SEALING_KEY: resolve(env.keyPath),
    BIO_GRADING_ROOT: resolve(env.gradingRoot),
  };
  const r = spawnSync(env.python ?? "python3", [env.sealPy ?? SEAL_PY, ...args], {
    env: childEnv,
    maxBuffer: 64 * 1024 * 1024,
    timeout: 30_000,
  });
  if (r.error) throw new Error(`seal.py could not run: ${r.error.message}`);
  if (r.status !== 0) {
    const msg = (r.stderr?.toString() ?? "").trim().split("\n").pop() ?? "";
    throw new Error(`seal.py ${args[0]} failed (exit ${r.status}): ${msg}`);
  }
  return r.stdout;
}

/** Create the key (48 random bytes, mode 0400) if it does not exist. Never overwrites. */
export function initKey(env: SealEnv): string {
  mkdirSync(dirname(resolve(env.keyPath)), { recursive: true, mode: 0o700 });
  return run(env, ["init"]).toString().trim();
}

/**
 * Seal `plaintext` to `destEnc` (+ `.sha256` sidecar). The plaintext is copied into a staging
 * directory under the grading root, sealed there by seal.py (which deletes the staged plaintext),
 * and the envelope is moved into place. The caller's plaintext file is left untouched.
 */
export function sealTo(env: SealEnv, plaintext: string, destEnc: string): void {
  if (!destEnc.endsWith(".enc")) throw new Error("sealed destination must end in .enc");
  if (!existsSync(env.keyPath)) initKey(env);
  mkdirSync(env.gradingRoot, { recursive: true, mode: 0o700 });
  const stage = mkdtempSync(join(resolve(env.gradingRoot), "stage."));
  try {
    const name = basename(destEnc).replace(/\.enc$/, "");
    const staged = join(stage, name);
    copyFileSync(plaintext, staged);
    run(env, ["seal", staged]);
    if (existsSync(staged)) throw new Error("seal.py left the staged plaintext behind");
    mkdirSync(dirname(destEnc), { recursive: true });
    renameSync(staged + ".enc", destEnc);
    renameSync(staged + ".enc.sha256", destEnc + ".sha256");
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

/** Authenticate (MAC + sidecar) and decrypt; plaintext is returned in memory only. */
export function openSealed(env: SealEnv, encPath: string): Buffer {
  if (!keyAvailable(env)) throw new Error(`sealing key not available at ${env.keyPath}`);
  return run(env, ["open", resolve(encPath)]);
}
