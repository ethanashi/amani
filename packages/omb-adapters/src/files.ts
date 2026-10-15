import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync, readdirSync, chmodSync, rmSync } from 'node:fs';
import path from 'node:path';
export const sha256 = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');
export const inside = (child: string, root: string): boolean => child === root || child.startsWith(root + path.sep);
export function regular(file: string, cap = 8_000_000): Buffer {
  const st = lstatSync(file);
  if (!st.isFile() || st.isSymbolicLink() || st.nlink !== 1 || st.size > cap || realpathSync(file) !== path.resolve(file)) throw new Error('unsafe or oversized file');
  return readFileSync(file);
}
export function fileUnder(root: string, relative: string): string {
  const file = path.resolve(root, relative);
  if (!relative || path.isAbsolute(relative) || !inside(file, root) || file === root) throw new Error('file outside workdir');
  return file;
}
export function removeScratch(dir: string): void {
  // Never follow a worker symlink while unlocking directories for deletion.
  const unlock = (p: string): void => {
    const st = lstatSync(p);
    if (st.isDirectory() && !st.isSymbolicLink()) {
      chmodSync(p, 0o700);
      for (const n of readdirSync(p)) unlock(path.join(p, n));
    }
  };
  unlock(dir); rmSync(dir, { recursive: true, force: true });
}
