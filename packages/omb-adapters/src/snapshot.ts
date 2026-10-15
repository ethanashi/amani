import { chmodSync, lstatSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { canonicalSha256 } from '../../bio-core/src/index.ts';
import { regular, sha256 } from './files.ts';

/** Called only after sandbox reaping. Worker env, symlinks, caches and output data
 * never become executable inputs. Every byte the certifier reads comes from this copy. */
export function snapshotDeliverables(work: string, destination: string): { hash: string; warnings: string[] } {
  mkdirSync(destination, { recursive: false, mode: 0o700 });
  const hashes: Record<string, string> = {}, warnings: string[] = [];
  const copy = (relative: string, depth: number): void => {
    if (depth > 32) throw new Error('deliverable depth cap');
    const source = path.join(work, relative), target = path.join(destination, relative), st = lstatSync(source);
    if (st.isSymbolicLink()) throw new Error('linked deliverable refused');
    if (st.isDirectory()) {
      mkdirSync(target, { mode: 0o700 });
      for (const name of readdirSync(source).sort()) copy(path.join(relative, name), depth + 1);
      chmodSync(target, 0o500);
    } else {
      const bytes = regular(source, 16_000_000);
      writeFileSync(target, bytes, { flag: 'wx', mode: 0o400 }); hashes[relative] = sha256(bytes);
    }
  };
  for (const entry of ['code', 'run_all.sh', 'run_primary.sh', 'plan.json', 'results.json', 'REPORT.md']) {
    try { copy(entry, 0); } catch (e) { warnings.push(`snapshot ${entry}: ${e instanceof Error ? e.message : String(e)}`); }
  }
  chmodSync(destination, 0o500);
  return { hash: canonicalSha256(hashes), warnings };
}
