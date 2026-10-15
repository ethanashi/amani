import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, closeSync, constants, fstatSync, lstatSync, openSync, readSync, readdirSync, realpathSync, rmdirSync, unlinkSync } from "node:fs";
import path from "node:path";
import { canonicalSha256 } from "../../bio-core/src/index.ts";

export function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function keys(value: Record<string, unknown>, expected: string[]): boolean {
  return Object.keys(value).sort().join("\0") === [...expected].sort().join("\0");
}

export function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && !value.includes("\0");
}

export function relativeFile(value: unknown): value is string {
  return nonempty(value) && !value.includes("\\") && !/[\p{Cc}\p{Cf}]/u.test(value) && value.length <= 1024
    && !path.isAbsolute(value) && value.split("/").every(part => part !== "." && part !== ".." && part !== "");
}

export function directory(value: string): string {
  if (!path.isAbsolute(value) || !lstatSync(value).isDirectory() || lstatSync(value).isSymbolicLink()) {
    throw new Error("a real absolute directory is required");
  }
  return realpathSync.native(value);
}

export function contains(root: string, target: string): boolean {
  // Conservative case folding also protects case-insensitive APFS aliases.
  const rel = path.relative(root.normalize("NFC").toLowerCase(), target.normalize("NFC").toLowerCase());
  return rel === "" || (!path.isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${path.sep}`));
}

export function fileHash(file: string, maximumBytes = Infinity): { sha256: string; bytes: number } {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.nlink !== 1) throw new Error("only regular, unlinked files are allowed");
    if (before.size > maximumBytes) throw new Error("artifact byte budget exceeded");
    const hash = createHash("sha256");
    const buffer = Buffer.alloc(64 * 1024);
    let bytes = 0;
    for (;;) {
      const count = readSync(fd, buffer, 0, buffer.length, null);
      if (count === 0) break;
      bytes += count;
      if (bytes > maximumBytes) throw new Error("artifact byte budget exceeded");
      hash.update(buffer.subarray(0, count));
    }
    const after = fstatSync(fd);
    if (before.size !== bytes || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
      throw new Error("file changed during hashing");
    }
    return { sha256: hash.digest("hex"), bytes };
  } finally { closeSync(fd); }
}

export interface TreeEntry { path: string; kind: "directory" | "file"; mode: number; sha256?: string; bytes?: number }

export function inventory(root: string): TreeEntry[] {
  const entries: TreeEntry[] = [];
  const visit = (relative: string, depth: number) => {
    if (depth > 64 || entries.length > 100_000) throw new Error("directory inventory exceeds bound");
    const full = path.join(root, relative);
    const info = lstatSync(full);
    if (info.isSymbolicLink()) throw new Error("symlinks are forbidden");
    if (info.isDirectory()) {
      entries.push({ path: relative, kind: "directory", mode: info.mode & 0o777 });
      for (const name of readdirSync(full).sort()) visit(relative ? `${relative}/${name}` : name, depth + 1);
    } else {
      if (!info.isFile()) throw new Error("special files are forbidden");
      entries.push({ path: relative, kind: "file", mode: info.mode & 0o777, ...fileHash(full) });
    }
  };
  visit("", 0);
  return entries;
}

/** Includes paths, empty directories, permissions, sizes and content hashes. */
export function hashDataDirectory(root: string): string {
  return canonicalSha256(inventory(directory(root)));
}

export function artifactHash(root: string, relative: string, maximumBytes: number): { sha256: string; bytes: number } {
  if (!relativeFile(relative)) throw new Error("invalid artifact path");
  let cursor = root;
  for (const part of relative.split("/")) {
    cursor = path.join(cursor, part);
    if (lstatSync(cursor).isSymbolicLink()) throw new Error("artifact symlink refused");
  }
  if (!contains(root, realpathSync.native(cursor))) throw new Error("artifact escaped workspace");
  return fileHash(cursor, maximumBytes);
}

/** Clear mutable BSD metadata without following links. Called only after permission failure. */
function repairMetadata(file: string): void {
  if (process.platform !== "darwin") return;
  const settings = { timeout: 1000, env: { PATH: "/usr/bin:/bin" }, stdio: "pipe" as const };
  execFileSync("/usr/bin/chflags", ["-h", "nouchg,nouappnd", file], settings);
  execFileSync("/bin/chmod", ["-h", "-N", file], settings);
}

function repairable(error: unknown): boolean {
  return ["EACCES", "EPERM"].includes((error as NodeJS.ErrnoException).code ?? "");
}

/** Only call for our mkdtemp child after process settlement; never follow worker-created links. */
export function removeWorkspace(root: string): void {
  let info;
  try { info = lstatSync(root); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
  if (info.isDirectory() && !info.isSymbolicLink()) {
    try { chmodSync(root, 0o700); }
    catch (error) { if (!repairable(error)) throw error; repairMetadata(root); chmodSync(root, 0o700); }
    const errors: unknown[] = [];
    for (const name of readdirSync(root)) {
      const child = path.join(root, name);
      try { removeWorkspace(child); }
      catch (error) {
        try {
          if (!repairable(error)) throw error;
          repairMetadata(root); repairMetadata(child); removeWorkspace(child);
        } catch (retryError) { errors.push(retryError); }
      }
    }
    if (errors.length) throw new AggregateError(errors, "workspace children could not be removed");
    try { rmdirSync(root); }
    catch (error) { if (!repairable(error)) throw error; repairMetadata(root); rmdirSync(root); }
  } else {
    try { unlinkSync(root); }
    catch (error) { if (!repairable(error)) throw error; repairMetadata(root); unlinkSync(root); }
  }
}
