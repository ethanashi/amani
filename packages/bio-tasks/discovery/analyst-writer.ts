/** Public-only process protocol. The sealer, host paths, keys and truth are never inputs. */
import { mkdirSync, readFileSync, writeFileSync, chmodSync, utimesSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { canonicalJson, contentHash, parseStrictJson } from './public-json.ts';
import type { PublicLayer } from '../../omb-contract/src/schema.ts';

type Input = { publicLayer: PublicLayer; files?: Record<string, string>; prompt: string;
  pairs?: string; features?: string[]; registries?: Record<string,string>; synthetic?: boolean };
try {
  // Large public upstream bundles are streamed one file per child, before sealing.
  // This branch receives bytes and a public hash, never a source path or private layer.
  if (process.argv[3] === '--public-file') {
    const out = process.argv[2], name = process.argv[4], expected = process.argv[5];
    if (!out || !name || !/^(?:data|src)\/[a-zA-Z0-9_./-]+$/.test(name) || name.split('/').some(p => !p || p === '.' || p === '..')) throw Error('public file path');
    const raw = readFileSync(0);
    if (createHash('sha256').update(raw).digest('hex') !== expected) throw Error('public file hash');
    mkdirSync(dirname(join(out, name)), { recursive: true });
    writeFileSync(join(out, name), raw, { flag: 'wx' });
    process.exit(0);
  }
  const input = parseStrictJson(readFileSync(0, 'utf8')) as Input;
  const bt = Object.hasOwn(input, 'pairs');
  let publicFiles: Record<string, string>;
  if (bt) {
    if (Object.keys(input).sort().join() !== 'features,pairs,prompt,publicLayer,registries,synthetic' ||
        typeof input.pairs !== 'string' || typeof input.synthetic !== 'boolean' || !Array.isArray(input.features) ||
        input.features.some(x => typeof x !== 'string' || !/^[a-zA-Z0-9_]+$/.test(x))) throw Error('protocol');
    const allowed = new Set(['data/pair-aliases.tsv', 'data/target-aliases.tsv', 'data/drug-aliases.tsv', 'data/indication-aliases.tsv']);
    if (!input.registries || Object.entries(input.registries).some(([name, raw]) => !allowed.has(name) || typeof raw !== 'string')) throw Error('registry protocol');
    publicFiles = { 'data/pairs.tsv': input.pairs, ...input.registries,
      'FEATURES.json': canonicalJson(input.features.map(name => ({ name, storage: 'numeric', provenance: 'unverified candidate; audit use empirically' }))) + '\n' };
  } else {
    if (Object.keys(input).sort().join() !== 'files,prompt,publicLayer' || !input.files ||
        Object.keys(input.files).sort().join() !== 'gene-aliases.tsv,ld.tsv,summary.tsv,variant-aliases.tsv') throw Error('protocol');
    publicFiles = Object.fromEntries(Object.entries(input.files).map(([name, raw]) => [`data/${name}`, raw]));
  }
  if (typeof input.prompt !== 'string') throw Error('prompt');
  const registries = input.publicLayer.structure.alias_registries;
  if (registries.length !== (bt ? Object.keys(input.registries!).length : 2) || registries.some(d => {
    const raw = publicFiles[d.file.path];
    return typeof raw !== 'string' || createHash('sha256').update(raw).digest('hex') !== d.file.sha256;
  })) throw Error('registry binding');
  const contract = { public: { content: input.publicLayer, hash: contentHash(input.publicLayer) } };
  const out = process.argv[2];
  if (!out) throw Error('destination');
  mkdirSync(out);
  mkdirSync(join(out, 'data'));
  const payloads: Record<string, string> = {
    'DATA-CONTRACT.json': canonicalJson(contract) + '\n', 'TASK.md': input.prompt,
    ...publicFiles,
  };
  const files: Record<string, string> = {};
  for (const [name, raw] of Object.entries(payloads)) {
    writeFileSync(join(out, name), raw, { flag: 'wx' });
    files[name] = createHash('sha256').update(raw).digest('hex');
  }
  writeFileSync(join(out, 'manifest.json'), canonicalJson({ synthetic: bt ? input.synthetic : true, files, publicContractHash: contract.public.hash }) + '\n', { flag: 'wx' });
  for (const name of [...Object.keys(payloads), 'manifest.json', 'data', '.']) {
    const path = join(out, name);
    chmodSync(path, name === 'data' || name === '.' ? 0o755 : 0o644);
    utimesSync(path, 946684800, 946684800);
  }
} catch {
  process.stderr.write('public projection refused\n');
  process.exitCode = 1;
}
