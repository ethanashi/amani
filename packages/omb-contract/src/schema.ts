import { array, bool, enumeration as en, integer, literal as lit, nullable as nil, object as obj, str, token, union, type Infer, type Shape } from './schema-kit.ts';

export const DECIMAL_PATTERN = '^-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?(?:[eE][+-]?(?:0|[1-9][0-9]*))?$';
export const MAX_DECIMAL_LENGTH = 1024;
const decimal: Shape<string> = { json: { ...str(DECIMAL_PATTERN).json, maxLength: MAX_DECIMAL_LENGTH } };
const id = str('^[A-Za-z][A-Za-z0-9_.:-]*$');
const hash = str('^[0-9a-f]{64}$');
const ids = array(id, 1, true);
const strings = array(str(), 1, true);
const file = obj({ path: str(), sha256: hash });
const ref = obj({ table: id, column: str() });
const row = obj({ table: id, key: array(token, 1) });
export const citationShape = obj({ file_sha256: hash, byte_start: integer(), byte_end: integer(1), quote: str() });
export const producerShape = obj({ id, kind: en('task-author', 'curator', 'owner', 'stager', 'software'), name: str(), version: str(), model_family: nil(str()), source_bundle_hash: hash, outcome_blind: bool });
export const evidenceShape = obj({ pointer: str('^/'), status: en('author', 'cited', 'assumed', 'contested'), producer_ids: ids, citations: array(citationShape), note: nil(str()) });
export const nodeShape = obj({ id, kind: en('specimen/sample', 'donor/subject', 'randomization-unit', 'dependence-cluster', 'target-population'), level: id, namespace: id, original_id: str() });
export const levelShape = obj({ id, coarser_level: nil(id), minimum_independent: bool });
export const namespaceShape = obj({
  id, entity_kind: en('unit', 'feature', 'variant'), level: nil(id), preserve_originals: lit(true), collision_policy: lit('merge-with-limitation'),
  rules: array(en('nfkc', 'trim-ascii', 'remove-zero-width', 'ascii-case-fold', 'canonical-decimal'), 0, true),
});
export const aliasShape = obj({ namespace: id, encoding: en('token', 'canonical-json-array'), original: str(), canonical: str(), node: id });
export const aliasRegistryShape = obj({ namespace: id, file, format: lit('omb-alias-registry-tsv/v1'), entry_count: integer(1), coverage: lit('verify-against-data') });

const measurement = obj({ type: en('continuous', 'positive-concentration', 'bounded-score', 'count', 'binary', 'ordinal', 'time-to-event'), unit: str(), bounds: nil(obj({ lower: decimal, upper: decimal })), categories: array(str(), 0, true) });
export const columnShape = obj({ name: str(), storage: en('string', 'decimal', 'boolean'), structural_kind: en('identifier', 'unit', 'batch', 'time', 'feature', 'measurement', 'annotation'), namespace: nil(id), decimal_resolution: nil(decimal), measurement: nil(measurement), missingness_codes: array(token, 0, true) });
export const unitDerivationShape = union(
  obj({ kind: lit('column-tuple'), columns: strings, encoding: lit('canonical-json-array'), namespace: id, level: id }),
  obj({ kind: lit('row-key-regex'), pattern: str(), capture_group: integer(1), namespace: id, level: id }),
  obj({ kind: lit('sidecar'), map: file, key_encoding: lit('canonical-json-array'), namespace: id, level: id }),
);
export const tableShape = obj({ id, file, row_key: strings, columns: array(columnShape, 1), unit_derivation: unitDerivationShape,
  orientation: obj({ layout: en('records', 'matrix'), unit_axis: en('rows', 'columns'), row_entity: en('units', 'samples', 'features', 'variants'), header_namespace: nil(id) }),
  alias_coverage: obj({ rows: lit('all'), matrix_headers: lit('all'), unresolved: lit('refuse'), ambiguous_axis: lit('refuse') }),
});
const assignment = union(
  obj({ kind: lit('observational'), exposure: ref, assignment_unit: id }),
  obj({ kind: lit('randomized-unit'), exposure: ref, assignment_unit: id, mechanism: str(), allocation: file }),
  obj({ kind: lit('randomized-within-unit-order'), exposure: ref, assignment_unit: id, order_column: ref, sequence_allocation: file, carryover: en('excluded-by-design', 'modeled', 'unknown') }),
  obj({ kind: lit('blocked/stratified'), exposure: ref, assignment_unit: id, blocks: array(ref, 1), randomized: bool, allocation: nil(file) }),
);
export const replicateShape = obj({ id, kind: en('technical', 'biological'), members: ids, grouping_node: id, handling: en('collapse', 'model-dependence', 'retain-distinct'), rationale: str() });
export const partitionShape = obj({ id, unit_level: id, seed_provenance: obj({ method: lit('hmac-sha256'), producer_id: id, key_id: str(), contract_hash: hash, seed_commitment: hash }),
  units: array(obj({ node: id, identity_scope: str(), identity_key: str(), allocation: en('dev', 'held-out', 'excluded'), burn: union(obj({ status: lit('unseen') }), obj({ status: lit('burned'), look_record_hashes: array(hash, 1, true) })) })),
});
export const survivalShape = obj({ id, time: ref, event: ref, event_codes: array(obj({ code: token, meaning: str(), status: en('event', 'censored', 'competing-event') }), 2),
  time_origin: obj({ index_event: str(), column: nil(ref) }), entry_time: nil(ref), event_type: union(obj({ kind: lit('single'), name: str() }), obj({ kind: lit('composite'), components: strings })), censoring_reason: nil(ref),
});
const cohort = union(obj({ id, accession: str(), trait_type: lit('binary'), cases: integer(), controls: integer(), ancestry: str() }), obj({ id, accession: str(), trait_type: lit('quantitative'), sample_size: integer(1), ancestry: str() }));
const summary = obj({ cohorts: array(cohort, 1), genome_build: str(), per_snp_n: ref, variant_id: ref, effect_allele: ref, other_allele: ref, ld_reference: obj({ accession: str(), file, ancestry: str(), genome_build: str() }) });
export const structureShape = obj({
  dataset_id: id, dataset_type: en('subject-level', 'feature-level', 'summary-statistic'), source_files: array(file, 1),
  namespaces: array(namespaceShape, 1),
  graph: obj({ nodes: array(nodeShape, 1), edges: array(obj({ from: id, to: id, relation: en('sample-of', 'assigned-with', 'dependent-with', 'member-of-population', 'derived-from') })) }),
  unit_hierarchy: array(levelShape, 1), tables: array(tableShape, 1), aliases: array(aliasShape), alias_registries: array(aliasRegistryShape),
  collision_merges: array(obj({ namespace: id, encoding: en('token', 'canonical-json-array'), canonical: str(), originals: strings, merged_node: id, limitation: str() })),
  joins: array(obj({ id, from_table: id, from_columns: strings, to_table: id, to_columns: strings, cardinality: en('one-to-one', 'many-to-one', 'one-to-many', 'many-to-many'), unmatched: en('refuse', 'exclude-with-lineage') })),
  batch: array(ref), time: array(obj({ column: ref, index_event: str(), relation: en('pre-index', 'at-index', 'post-index', 'mixed', 'unknown'), unit: str() })),
  dependence: array(obj({ id, kind: en('independent', 'nested', 'repeated', 'crossed', 'unknown'), unit_level: id, cluster_nodes: array(id, 0, true), description: str() })),
  assignments: array(assignment), replicate_groups: array(replicateShape), partitions: array(partitionShape),
  forbidden_uses: array(obj({ column: ref, uses: array(en('outcome', 'exposure', 'covariate', 'identifier', 'split', 'feature'), 1, true), reason: str() })),
  survival: array(survivalShape),
  row_exclusions: array(obj({ row, reason: str(), producer_id: id, outcome_blind: lit(true), lineage_id: id })),
  transformations: array(obj({ id, operation: en('join', 'outcome-blind-filter', 'complete-case', 'registered-missing-data', 'change-score', 'log1p', 'cpm', 'z-score', 'aggregate', 'event-time'), producer_id: id, registry_version: str(), row_lineage_format: lit('omb-row-lineage/v1'), implementation_hash: hash, output_files: array(file), input_tables: ids, output_table: id, parent_transformations: array(id, 0, true), row_lineage: file, outcome_blind: lit(true) })),
  summary_statistics: nil(summary), limitations: array(str(), 0, true),
});
export const publicLayerShape = obj({ schema_version: lit('omb-data-contract/v3.1'), structure: structureShape, producers: array(producerShape, 1), evidence: array(evidenceShape, 1) });
export const privateLayerShape = obj({ schema_version: lit('omb-data-contract-private/v3.1'), public_hash: hash, structure: structureShape, producers: array(producerShape, 1), evidence: array(evidenceShape, 1), planted_defects: array(obj({ id, description: str(), affected_nodes: ids })) });
export const publicEnvelopeShape = obj({ content: publicLayerShape, hash });
export const dataContractShape = obj({ public: publicEnvelopeShape }, { sealed_private: obj({ content: privateLayerShape, hash }) });
export type Citation = Infer<typeof citationShape>;
export type Producer = Infer<typeof producerShape>;
export type FieldEvidence = Infer<typeof evidenceShape>;
export type ProvenanceNode = Infer<typeof nodeShape>;
export type UnitDerivation = Infer<typeof unitDerivationShape>;
export type ContractStructure = Infer<typeof structureShape>;
export type PublicLayer = Infer<typeof publicLayerShape>;
export type PrivateLayer = Infer<typeof privateLayerShape>;
export type PublicEnvelope = Infer<typeof publicEnvelopeShape>;
export type DataContract = Infer<typeof dataContractShape>;
export type Table = Infer<typeof tableShape>;
export type Column = Infer<typeof columnShape>;
export type Assignment = Infer<typeof assignment>;
export type Partition = Infer<typeof partitionShape>;
export type ReplicateGroup = Infer<typeof replicateShape>;
export const dataContractJsonSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'urn:omerta-bio:data-contract:v3.1',
  title: 'Omerta Bio data contract v3.1',
  $comment: 'Structural schema. Also call validateDataContract for reference, evidence coverage, graph, normalization, and hash constraints. No data verification or trust grant.',
  ...dataContractShape.json,
} as const;
