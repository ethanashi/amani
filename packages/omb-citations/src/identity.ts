import { readdir, readFile } from 'node:fs/promises';
import { canonicalSha256 } from '../../bio-core/src/index.ts';
import { sha256 } from './http.ts';
import { POLICY } from './policy.ts';
/** Hash every executable source file plus package metadata/config and core canonical dependency. */
export async function verifierIdentity(): Promise<{ id: string; files: Record<string, string>; config: typeof POLICY }> {
  const files: Record<string, string> = {};
  const dir = new URL('./', import.meta.url);
  for (const name of (await readdir(dir)).filter(n => n.endsWith('.ts')).sort()) files['src/' + name] = sha256(await readFile(new URL(name, dir), 'utf8'));
  files['package.json'] = sha256(await readFile(new URL('../package.json', dir), 'utf8'));
  async function coreFiles(base: URL, prefix: string): Promise<void> {
    for (const entry of (await readdir(base, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : 1)) {
      if (entry.isDirectory()) await coreFiles(new URL(entry.name + '/', base), prefix + entry.name + '/');
      else if (entry.name.endsWith('.ts')) files[prefix + entry.name] = sha256(await readFile(new URL(entry.name, base), 'utf8'));
    }
  }
  await coreFiles(new URL('../../bio-core/src/', dir), 'bio-core/');
  return { id: 'pw4-sha256:' + canonicalSha256({ files, config: POLICY }), files, config: POLICY };
}
