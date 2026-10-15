import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

export interface HostAdapterIdentity { path: string; sha256: string }

/** Validate before importing any executable host configuration. */
export function inspectHostAdapter(directory: string, file: string): HostAdapterIdentity {
  const resolved = path.resolve(file), root = path.resolve(directory);
  if (resolved === root || resolved.startsWith(`${root}${path.sep}`)) throw new Error("host adapter must be outside the investigation");
  for (let p = resolved; ; p = path.dirname(p)) {
    if (lstatSync(p).isSymbolicLink()) throw new Error("host adapter symlink refused");
    if (p === path.dirname(p)) break;
  }
  const stat = lstatSync(resolved);
  if (!stat.isFile() || (stat.mode & 0o022) !== 0 || (process.getuid && stat.uid !== process.getuid())) throw new Error("host adapter must be an owner-controlled regular file, not group/world writable");
  return { path: resolved, sha256: createHash("sha256").update(readFileSync(resolved)).digest("hex") };
}
