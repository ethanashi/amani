import { IdentityResolver } from './identity.ts';
import { array, literal as lit, object as obj, str, type Infer, shapeErrors } from './schema-kit.ts';
import { partitionShape, producerShape, evidenceShape, type ContractStructure, type Producer, type Partition, type DataContract } from './schema.ts';
import { assertJson, contentHash } from './json.ts';
import { evidencePointers, validateDataContract, type Validation, type ValidationContext } from './validate.ts';

/** Metadata checks delegate every identity decision to the shared resolver. */
export function partitionErrors(s: ContractStructure, producers: Producer[], partitions: Partition[], antecedent?: string, resolver = new IdentityResolver(s)): string[] {
  return [...resolver.errors, ...resolver.partitionErrors(partitions.map(partition => ({layer: 'public', partition}))), ...partitionMetadataErrors(producers, partitions, antecedent)];
}
/** IDs here identify partition records, never scientific units. */
export function partitionMetadataErrors(producers: Producer[], partitions: Partition[], antecedent?: string): string[] {
  const errors: string[] = [];
  const stagers = new Set(producers.filter(p => p.kind === 'stager' && p.outcome_blind).map(p => p.id));
  if (new Set(partitions.map(p => p.id)).size !== partitions.length) errors.push('duplicate partition');
  for (const p of partitions) {
    if (!stagers.has(p.seed_provenance.producer_id)) errors.push('partition seed requires trusted stager record');
    if (antecedent !== undefined && p.seed_provenance.contract_hash !== antecedent) errors.push('partition seed contract hash mismatch');
  }
  return errors;
}
const hash = str('^[0-9a-f]{64}$');
export const partitionArtifactContentShape = obj({
  schema_version: lit('omb-partition-artifact/v3.1'), dataset_id: str('^[A-Za-z][A-Za-z0-9_.:-]*$'),
  antecedent_public_contract_hash: hash, partitions: array(partitionShape, 1), producers: array(producerShape, 1), evidence: array(evidenceShape, 1),
});
export const partitionArtifactShape = obj({ content: partitionArtifactContentShape, hash });
export type PartitionArtifact = Infer<typeof partitionArtifactShape>;
export const partitionArtifactJsonSchema = { $schema: 'https://json-schema.org/draft/2020-12/schema', ...partitionArtifactShape.json } as const;
export function validatePartitionArtifact(l1: DataContract, value: unknown, context: ValidationContext = {}): Validation<PartitionArtifact> {
  try {
    if (context.expectedPrivateContractHash !== undefined ? context.expectedPrivateContractHash !== (l1.sealed_private?.hash ?? null) : !l1.sealed_private) return {ok:false,errors:['L2 requires the trusted L1 private hash (explicit null for a public-only contract) and its sealed private layer']};
    const base = validateDataContract(l1, context); if (!base.ok) return base;
    assertJson(value); const errors = shapeErrors(partitionArtifactShape.json, value);
    if (errors.length) return { ok: false, errors };
    const a = value as PartitionArtifact, c = a.content;
    if (a.hash !== contentHash(c)) errors.push('partition artifact hash mismatch');
    if (c.dataset_id !== l1.public.content.structure.dataset_id || c.antecedent_public_contract_hash !== l1.public.hash) errors.push('partition artifact L1 binding mismatch');
    const expected = new Set(evidencePointers(c.partitions, '/partitions'));
    if (c.evidence.length !== expected.size || new Set(c.evidence.map(e => e.pointer)).size !== expected.size || c.evidence.some(e => !expected.has(e.pointer))) errors.push('partition evidence coverage mismatch');
    const producers = new Map(c.producers.map(p => [p.id, p]));
    if (producers.size !== c.producers.length) errors.push('duplicate partition producer');
    const sourceHashes = new Set(l1.public.content.structure.source_files.map(f => f.sha256));
    const bundleHash = contentHash(l1.public.content.structure.source_files);
    for (const p of c.producers) if (p.source_bundle_hash !== bundleHash) errors.push('partition producer source bundle hash mismatch');
    for (const p of c.producers) if (p.kind === 'curator' && (!p.model_family || !p.outcome_blind)) errors.push('invalid curator producer');
    for (const e of c.evidence) {
      if (e.producer_ids.some(id => !producers.has(id)) || (e.status === 'author' && !e.producer_ids.some(id => producers.get(id)?.kind === 'task-author')) || (e.status === 'cited' && !e.citations.length) || (['assumed', 'contested'].includes(e.status) && e.note === null)) errors.push('invalid partition evidence');
      for (const citation of e.citations) if (citation.byte_end <= citation.byte_start || Buffer.byteLength(citation.quote) !== citation.byte_end - citation.byte_start || !sourceHashes.has(citation.file_sha256)) errors.push('invalid partition citation');
    }
    errors.push(...partitionErrors(l1.public.content.structure, c.producers, c.partitions, l1.public.hash));
    // Historical embedded burns and new L2 burns must agree on the same floor identities.
    if (l1.public.content.structure.partitions.length) {
      const snapshots = [...l1.public.content.structure.partitions, ...c.partitions].map((p, i) => ({ ...p, id: `snapshot${i}` }));
      errors.push(...partitionErrors(l1.public.content.structure, [...l1.public.content.producers, ...c.producers], snapshots));
    }
    if (l1.sealed_private) {
      try {
        const resolver = new IdentityResolver(l1.public.content.structure, l1.sealed_private.content.structure);
        const snapshots = [
          ...l1.public.content.structure.partitions.map(partition => ({layer: 'public' as const, partition})),
          ...l1.sealed_private.content.structure.partitions.map(partition => ({layer: 'private' as const, partition})),
          ...c.partitions.map(partition => ({layer: 'public' as const, partition})),
        ];
        if (resolver.errors.length || resolver.partitionErrors(snapshots).length) errors.push('private layer reconciliation failed');
      } catch { errors.push('private layer reconciliation failed'); }
    }
    return errors.length ? { ok: false, errors } : { ok: true, value: a, verification: 'structure-only' };
  } catch (e) { return { ok: false, errors: [String(e)] }; }
}
