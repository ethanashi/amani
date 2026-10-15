import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { HttpClient, FileCache, sha256 } from './http.ts';
import { ScholarlyResolver } from './sources.ts';
import { citationKey, freezeIndex, verify, suiteResult } from './verifier.ts';
import { verifierIdentity } from './identity.ts';
import { pacedFetch } from './runtime.ts';
import { infrastructureSummary } from './run-status.ts';
import { paperBundle } from './bundle.ts';
import type { CitationInput, Resolution } from './types.ts';
const root = new URL('../', import.meta.url);
const now = () => Date.now();
const args = process.argv.slice(2);
const command = args[0];
const value = (key: string) => { const i = args.indexOf(key); if (i < 0 || !args[i + 1]) throw new Error(`missing ${key}`); return args[i + 1]!; };
/** Only these four fields enter the verifier; no expected labels, classes or gold evidence. */
export function parseInputs(text: string, publicRows = false): CitationInput[] {
  const seen = new Set<string>();
  return text.trim().split('\n').filter(Boolean).map(line => {
    const raw = JSON.parse(line);
    if (publicRows && raw.split !== 'public') throw new Error('not a public row');
    const x = publicRows ? raw.input : raw;
    if (typeof raw.id !== 'string' || !raw.id || seen.has(raw.id) || typeof x?.sentence !== 'string' || typeof x?.quote !== 'string' || typeof x?.citation !== 'object' || !x.citation) throw new Error('invalid or duplicate input');
    const c = x.citation;
    for (const k of ['authors', 'title', 'journal']) if (typeof c[k] !== 'string') throw new Error('invalid citation metadata');
    if (typeof c.year !== 'number' || !Number.isInteger(c.year)) throw new Error('invalid year');
    for (const k of ['doi', 'pmid']) if (c[k] !== null && typeof c[k] !== 'string') throw new Error('invalid identifier');
    for (const k of ['volume', 'issue', 'pages']) if (c[k] !== undefined && c[k] !== null && typeof c[k] !== 'string') throw new Error('invalid optional metadata');
    seen.add(raw.id);
    return { id: raw.id, sentence: x.sentence, quote: x.quote, citation: { doi: c.doi, pmid: c.pmid, authors: c.authors, year: c.year, title: c.title, journal: c.journal, volume: c.volume ?? null, issue: c.issue ?? null, pages: c.pages ?? null } };
  });
}
async function main() {
  if (command === 'identity') { process.stdout.write(JSON.stringify(await verifierIdentity(), null, 2) + '\n'); return; }
  const currentId = (await verifierIdentity()).id;
  if (args.includes('--verifier-id') && value('--verifier-id') !== currentId) throw new Error('verifier-id does not match code/config');
  let frozen: { id: string } | null = null;
  try { frozen = JSON.parse(await readFile(new URL('FREEZE.json', root), 'utf8')); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  if (frozen && frozen.id !== currentId) throw new Error('frozen verifier changed; new build identity required');
  if (command !== 'public' && command !== 'verify') throw new Error('usage: cli.ts public [--offline] [--fresh] | verify --inputs INPUT.jsonl --out OUTPUT.jsonl [--fresh] | identity');
  if (args.includes('--offline') && args.includes('--fresh')) throw new Error('--offline and --fresh conflict');
  const inputs = parseInputs(await readFile(command === 'public' ? new URL('../../omb-citation-suite/suite/public.jsonl', import.meta.url) : value('--inputs'), 'utf8'), command === 'public');
  const resolver = new ScholarlyResolver(new HttpClient({ now, resumeCache: true, cache: new FileCache(fileURLToPath(new URL('.cache/http', root))), fetch: pacedFetch({ now, wait: ms => new Promise(resolve => setTimeout(resolve, ms)) }) }), now);
  const records = new Map<string, Resolution>();
  for (const i of inputs) {
    const key = citationKey(i.citation); if (records.has(key)) continue;
    let resolution: Resolution;
    if (command === 'public' && args.includes('--offline')) {
      const hash = sha256(JSON.stringify([i.citation.doi, i.citation.doi ? null : i.citation.pmid]));
      try {
        const saved = JSON.parse(await readFile(new URL(`.cache/resolutions/${hash}.json`, root), 'utf8'));
        if (now() < saved.savedAt || now() - saved.savedAt >= 86400000) throw new Error('expired');
        const { savedAt: _, ...result } = saved; resolution = result;
      } catch { resolution = { state: 'unavailable', reason: 'offline public snapshot absent/expired', receipts: [] }; }
    } else resolution = await resolver.resolve(i.citation, { fresh: args.includes('--fresh') });
    records.set(key, resolution);
  }
  const index = freezeIndex([...records].map(([key, resolution]) => ({ key, resolution })));
  const rows = inputs.map(input => verify(input, index));
  const infrastructure = infrastructureSummary(rows);
  const output = rows.map(row => JSON.stringify(suiteResult(row))).join('\n') + '\n';
  const out = command === 'public' ? new URL('reports/public-results.jsonl', root) : value('--out');
  if (command === 'public') {
    await mkdir(new URL('reports', root), { recursive: true });
    await writeFile(new URL('reports/public-bundle.json', root), JSON.stringify(paperBundle(rows, null), null, 2) + '\n');
    await writeFile(new URL('reports/public-run.json', root), JSON.stringify({ verifier: await verifierIdentity(), indexId: index.id, rows: rows.length, sourceRecords: records.size, ...infrastructure, publicInputSha256: sha256(JSON.stringify(inputs)), inputsOnly: true }, null, 2) + '\n');
  }
  await writeFile(out, output);
  if (command === 'verify') await writeFile(value('--out') + '.run.json', JSON.stringify({ verifierId: currentId, rows: rows.length, ...infrastructure }, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ ...infrastructure, rows: rows.length, statuses: Object.fromEntries([...new Set(rows.map(r => r.status))].map(s => [s, rows.filter(r => r.status === s).length])), verifierId: (await verifierIdentity()).id }) + '\n');
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch(e => { process.stderr.write(String(e) + '\n'); process.exitCode = 1; });
