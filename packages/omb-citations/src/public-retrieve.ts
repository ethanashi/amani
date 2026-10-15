// Development utility: reads ONLY the public split; strips labels before retrieval.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { HttpClient, FileCache, sha256 } from './http.ts';
import { pacedFetch } from './runtime.ts';
import { ScholarlyResolver } from './sources.ts';
import type { CitationInput } from './types.ts';
const root = new URL('../', import.meta.url);
const rows = (await readFile(new URL('../../omb-citation-suite/suite/public.jsonl', import.meta.url), 'utf8')).trim().split('\n').map(line => {
  const r = JSON.parse(line) as { id: string; split: string; input: Omit<CitationInput, 'id'> };
  if (r.split !== 'public') throw new Error('public-only'); return { id: r.id, ...r.input };
});
const { fileURLToPath } = await import('node:url');
const now = () => Date.now();
const resolver = new ScholarlyResolver(new HttpClient({ now, resumeCache: true, fetch: pacedFetch({ now, wait: ms => new Promise(resolve => setTimeout(resolve, ms)) }), cache: new FileCache(fileURLToPath(new URL('.cache/http', root))) }), now);
await mkdir(new URL('.cache/resolutions', root), { recursive: true });
const seen = new Set<string>();
for (const r of rows) {
  const key = sha256(JSON.stringify([r.citation.doi, r.citation.doi ? null : r.citation.pmid]));
  if (seen.has(key)) continue; seen.add(key);
  const path = new URL(`.cache/resolutions/${key}.json`, root);
  let old; try { old = JSON.parse(await readFile(path, 'utf8')); } catch {}
  if (!process.argv.includes('--fresh') && !process.argv.includes('--reparse') && old && old.state !== 'unavailable' && now() - old.savedAt < 86400000) { process.stdout.write(`cached ${seen.size} ${r.id}\n`); continue; }
  const result = await resolver.resolve(r.citation, { fresh: process.argv.includes('--fresh') });
  await writeFile(path, JSON.stringify({ ...result, savedAt: now() }));
  process.stdout.write(`${seen.size} ${r.id} ${result.state}${result.state === 'found' ? '' : ' ' + result.reason}\n`);
}
