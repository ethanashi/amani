import { lstatSync, mkdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export function inside(root: string, file: string): boolean {
  return file === root || file.startsWith(root + path.sep);
}

/** Reject links in every existing component, including dangling final links. */
export function noLinks(file: string): void {
  if (!path.isAbsolute(file)) throw new Error("absolute host path required");
  for (let p = path.resolve(file); ; p = path.dirname(p)) {
    try { if (lstatSync(p).isSymbolicLink()) throw new Error(`symlink refused: ${p}`); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
    if (p === path.dirname(p)) break;
  }
}

export function privateDirectory(file: string): string {
  noLinks(file);
  mkdirSync(file, { recursive: true, mode: 0o700 });
  const st = lstatSync(file);
  if (!st.isDirectory() || (st.mode & 0o022) || (process.getuid && st.uid !== process.getuid())) throw new Error("host directory is not owner-controlled");
  return realpathSync(file);
}

export function privateFile(file: string): void {
  noLinks(file);
  try {
    const st = lstatSync(file);
    if (!st.isFile() || st.nlink !== 1 || (st.mode & 0o022) || (process.getuid && st.uid !== process.getuid())) throw new Error("host file is not owner-controlled");
  } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
}

export const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

/** Pure location resolution; home injection keeps tests away from user state. */
export function hostLocations(options: { stateRoot?: string; workRoot?: string; indexFile?: string }, env: NodeJS.ProcessEnv, home = homedir()) {
  const stateRoot = path.resolve(options.stateRoot ?? env.OMERTA_BIO_HOME ?? path.join(home, ".omerta-bio"));
  return { stateRoot, workRoot: path.resolve(options.workRoot ?? `${stateRoot}-work`),
    indexFile: path.resolve(options.indexFile ?? path.join(stateRoot, "notebook/index.sqlite")) };
}
