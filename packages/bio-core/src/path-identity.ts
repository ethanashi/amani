import { lstatSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

/** Conservative spelling aliases, including expanding case folds and final sigma. */
export function foldPathSpelling(value: string): string {
  return value.normalize("NFD").toUpperCase().toLowerCase().replace(/ς/g, "σ");
}

/** Resolve existing ancestors using the filesystem's spelling, never guessed casing. */
export function canonicalPath(input: string): string {
  if (!path.isAbsolute(input) || input.includes("\0")) throw new Error(`absolute path required: ${input}`);
  const resolved = input;
  try { return realpathSync.native(resolved); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    if (input.split(path.sep).some(part => part === "." || part === "..")) throw new Error(`unresolved traversal: ${input}`);
    try { if (lstatSync(resolved).isSymbolicLink()) throw new Error(`dangling symlink: ${resolved}`); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
    const parent = path.dirname(resolved);
    if (parent === resolved) throw error;
    return path.join(canonicalPath(parent), path.basename(resolved));
  }
}

function identity(input: string): { dev: bigint; ino: bigint; tail: string[] } {
  let current = canonicalPath(input);
  const tail: string[] = [];
  for (;;) {
    try {
      const st = statSync(current, { bigint: true });
      if (tail.length && !st.isDirectory()) throw new Error(`non-directory ancestor: ${current}`);
      return { dev: st.dev, ino: st.ino, tail };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      // A missing suffix has no identity yet. Conservatively regard case and
      // normalization variants as possible aliases (also on case-sensitive hosts).
      tail.unshift(foldPathSpelling(path.basename(current)));
      const parent = path.dirname(current);
      if (parent === current) throw error;
      current = parent;
    }
  }
}

export function sameFile(a: string, b: string): boolean {
  const x = identity(a), y = identity(b);
  return x.dev === y.dev && x.ino === y.ino && x.tail.length === y.tail.length && x.tail.every((part, i) => part === y.tail[i]);
}

/** Strict descendant relation; walk every existing ancestor by (dev, ino). */
export function within(root: string, target: string): boolean {
  const resolved = canonicalPath(target);
  if (sameFile(root, resolved)) return false;
  for (let ancestor = path.dirname(resolved); ; ancestor = path.dirname(ancestor)) {
    if (sameFile(root, ancestor)) return true;
    if (ancestor === path.dirname(ancestor)) return false;
  }
}
export const overlaps = (a: string, b: string): boolean => sameFile(a, b) || within(a, b) || within(b, a);
