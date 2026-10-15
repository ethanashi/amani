/** Host-only pipe. Never invoke with analyst-controlled paths or expose stdout to a worker. */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { buildContract, validateDataContract, IdentityResolver, contentHash, canonicalJson, parseStrictJson,
  type PublicLayer, type PrivateLayer } from '../../omb-contract/src/index.ts';

export function sealableContract(input: { publicLayer: PublicLayer; privateLayer?: PrivateLayer }) {
  // Producer/evidence declarations are checked by the full K1a semantic validator.
  const privateLayer = input.privateLayer && { ...input.privateLayer, public_hash: contentHash(input.publicLayer) };
  const contract = buildContract(input.publicLayer, privateLayer);
  const checked = validateDataContract(contract);
  if (!checked.ok) throw new Error('host contract validation refused');
  // One resolver owns equality and partition closure across both layers. Never repair
  // an invalid identity commitment or invent a successful partition allocation here.
  const identity = new IdentityResolver(contract.public.content.structure, contract.sealed_private?.content.structure);
  if (identity.errors.length) throw new Error('host identity validation refused');
  for (const layer of ['public', 'private'] as const) {
    const structure = layer === 'public' ? contract.public.content.structure : contract.sealed_private?.content.structure;
    for (const node of structure?.graph.nodes ?? []) {
      if (!identity.floorCovered(layer, node.id)) throw new Error('unit has no floor identity');
    }
  }
  return contract;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const input = parseStrictJson(readFileSync(0, 'utf8')) as Parameters<typeof sealableContract>[0];
    process.stdout.write(canonicalJson(sealableContract(input)));
  } catch {
    // Never serialize private validation errors into an analyst-visible error channel.
    process.stderr.write('host contract validation refused\n');
    process.exitCode = 1;
  }
}
