import { lstatSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { regular, sha256 } from './files.ts';
/** Independent receipt using the pilot's exact mode/hash/path tree format. */
export function verifyToolpack(bundle: string, lockFile: string): string {
  const lock = JSON.parse(regular(lockFile).toString());
  const entries: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const file = path.join(dir, name), st = lstatSync(file);
      if (st.isSymbolicLink()) throw new Error('linked toolpack');
      if (st.isDirectory()) walk(file);
      else entries[path.relative(bundle, file)] = `${(st.mode & 0o777).toString(8)} ${sha256(regular(file))}`;
    }
  };
  walk(bundle);
  const hash = sha256(Object.keys(entries).sort().map(name => `${entries[name]} ${name}\n`).join(''));
  if (lock.schema !== 'omerta-bio/toolpack-lock@1' || hash !== lock.profiles?.checks?.sha256) throw new Error('toolpack hash mismatch');
  return hash;
}
