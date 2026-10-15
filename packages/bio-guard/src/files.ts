import { constants, closeSync, fstatSync, lstatSync, openSync, readSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

import { canonicalPath as physicalPath, sameFile, within as strictlyWithin } from "../../bio-core/src/index.ts";

// Guard scopes include the root itself; supervisor deletion scopes are strict.
export const within = (root: string, target: string): boolean => sameFile(root, target) || strictlyWithin(root, target);

/** Seatbelt resolves Data-volume firmlinks differently from realpath. Refuse
 * this namespace instead of emitting ineffective allow/deny path literals. */
export function rejectFirmlinkAlias(input: string): void {
  if (/^\/System\/Volumes\/Data(?:\/|$)/i.test(path.resolve(input))) throw new Error(`firmlink alias refused: ${input}`);
}

/** Native realpath preserves on-disk case on case-insensitive APFS. */
export function canonicalPath(input: string): string {
  rejectFirmlinkAlias(input);
  const resolved = physicalPath(input);
  rejectFirmlinkAlias(resolved);
  return resolved;
}

export function directory(input: string): string {
  if (!path.isAbsolute(input) || !lstatSync(input).isDirectory()) throw new Error(`not an absolute, real directory: ${input}`);
  return canonicalPath(input);
}

export function safeRelative(input: unknown): input is string {
  return typeof input === "string" && input.length > 0 && !/[\\\x00-\x1f\x7f]/.test(input) &&
    !path.posix.isAbsolute(input) && input.split("/").every(part => part !== "" && part !== "." && part !== "..");
}

/** No symlinks, devices, sockets or hardlinked files in a staged data tree. */
export function inventory(root: string): { files: string[]; directories: string[] } {
  const files: string[] = [], directories: string[] = [];
  function visit(relative: string): void {
    for (const name of readdirSync(path.join(root, relative)).sort()) {
      const entry = relative ? `${relative}/${name}` : name;
      if (!safeRelative(entry)) throw new Error(`unsafe path: ${entry}`);
      const stat = lstatSync(path.join(root, entry));
      if (stat.isDirectory()) { directories.push(entry); visit(entry); }
      else if (stat.isFile() && stat.nlink === 1) files.push(entry);
      else throw new Error(`non-regular, linked or unavailable file: ${entry}`);
    }
  }
  visit("");
  return { files, directories };
}

/** Bounded memory even for multi-GB data; reject an in-place mutation during hashing. */
export function hashFile(file: string): { sha256: string; bytes: number } {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd, { bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.size > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`unsafe file: ${file}`);
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let bytes = 0, length: number;
    while ((length = readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, length)); bytes += length;
    }
    const after = fstatSync(fd, { bigint: true });
    if (before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs || BigInt(bytes) !== before.size) {
      throw new Error(`file changed during hashing: ${file}`);
    }
    return { sha256: hash.digest("hex"), bytes };
  } finally { closeSync(fd); }
}
