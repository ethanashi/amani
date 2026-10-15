import { chmodSync, lstatSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";

import { canonicalPath as physicalPath, sameFile as samePath, within, overlaps } from "../../bio-core/src/index.ts";
export { physicalPath, samePath, within, overlaps };

/** Detect replacement through symlinks without confusing filesystem spelling with identity. */
export function assertNoSymlink(input: string): void {
  for (let current = path.resolve(input); ; current = path.dirname(current)) {
    try { if (lstatSync(current).isSymbolicLink()) throw new Error(`symlink path refused: ${input}`); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (current === path.dirname(current)) return;
  }
}

function ownerWritable(dir: string): void {
  const st = lstatSync(dir);
  if (!st.isDirectory() || st.isSymbolicLink()) return;
  chmodSync(dir, st.mode | 0o700);
  for (const entry of readdirSync(dir)) ownerWritable(path.join(dir, entry));
}

/** Host-owned roots cannot be concurrently mutated. Protected directories are checked again at deletion. */
export function removeWorkspace(target: string, roots: readonly string[], protectedPaths: readonly string[] = []): void {
  if (!path.isAbsolute(target)) throw new Error("relative deletion refused");
  const lexical = path.resolve(target), resolved = physicalPath(lexical);
  for (const root of roots) assertNoSymlink(root);
  if (!roots.some(root => within(root, resolved))) throw new Error(`outside declared roots: ${target}`);
  if (protectedPaths.some(protectedPath => overlaps(resolved, protectedPath))) {
    throw new Error(`protected authority/evidence overlaps deletion: ${target}`);
  }
  try {
    ownerWritable(lexical);
    rmSync(lexical, { recursive: true, force: false, maxRetries: 0 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
