import { IdentityResolver } from './identity.ts';
import { canonicalSha256 } from '../../bio-core/src/index.ts';
import { partitionMetadataErrors } from './partitions.ts';
import { safeUnitRegex } from './regex.ts';
import { dataContractShape, publicLayerShape, privateLayerShape, type DataContract, type PublicLayer, type PrivateLayer } from './schema.ts';
import { shapeErrors } from './schema-kit.ts';
import { assertJson, canonicalJson, parseStrictJson } from './json.ts';
import { compareDecimals, decimalParts, boundedIdentifier } from './normalize.ts';
/** Supplied by the trusted host, never read from contract bytes. No default registrations. */
export interface ValidationContext {
  expectedPrivateContractHash?: string | null;
  derivationRegistry?: { version: string; implementations: Readonly<Record<string, string>> };
}
export type Validation<T> = { ok: true; value: T; verification: 'structure-only' } | { ok: false; errors: string[] };
const escape = (s: string) => /[~/]/.test(s) ? s.replace(/~/g, '~0').replace(/\//g, '~1') : s;
const atomicRegistryPointer = /^\/structure\/alias_registries\/[0-9]+$/;
/** Every leaf has evidence, except each explicitly atomic alias-registry descriptor. */
export function evidencePointers(value: unknown, prefix = '/structure'): string[] {
  const out: string[] = [];
  const visit = (v: unknown, path: string) => {
    if (atomicRegistryPointer.test(path) || v === null || typeof v !== 'object') { out.push(path); return; }
    const keys = Object.keys(v);
    if (!keys.length) out.push(path);
    else for (const k of keys) visit((v as Record<string,unknown>)[k], `${path}/${escape(k)}`);
  };
  visit(value, prefix); return out;
}
export function layerErrors(layer: PublicLayer | PrivateLayer, context: ValidationContext = {}): string[] {
  const s = layer.structure, errors: string[] = [];
  const identity = new IdentityResolver(s);
  errors.push(...identity.errors);
  const require = (valid: unknown, message: string) => { if (!valid && errors.length < 100) errors.push(message); };
  const unique = (values: string[], label: string) => require(new Set(values).size === values.length, `duplicate ${label}`);
  const safePath = (path: string) => !path.startsWith('/') && !path.includes('\\') && !path.includes('\0') && path.split('/').every(p => p !== '' && p !== '.' && p !== '..') && !/^[A-Za-z]:/.test(path);
  const fileCheck = (f: {path: string}) => require(safePath(f.path), 'artifact path must be relative without traversal');
  const producers = new Map(layer.producers.map(p => [p.id, p]));
  unique(layer.producers.map(p => p.id), 'producer id');
  layer.producers.forEach(p => require(p.kind !== 'curator' || (p.model_family && p.outcome_blind), 'curator requires model family and outcome blindness'));
  const pointers = evidencePointers(s);
  if ('planted_defects' in layer) evidencePointers(layer.planted_defects, '/planted_defects').forEach(p => pointers.push(p));
  const expected = new Set(pointers);
  const evidence = new Map(layer.evidence.map(e => [e.pointer, e]));
  const trustedProducer = (id: string) => { const p = producers.get(id); return p?.outcome_blind && ['stager', 'task-author'].includes(p.kind); };
  // Index only the subtrees whose provenance is queried; each leaf is indexed once.
  const provenanceIndex = new Map<string, string[]>();
  for (const pointer of pointers) {
    const prefix = /^\/structure\/(?:row_exclusions|transformations|joins|source_files|tables)\/[^/]+/.exec(pointer)?.[0];
    if (prefix) { const list = provenanceIndex.get(prefix) ?? []; list.push(pointer); provenanceIndex.set(prefix, list); }
  }
  const provenance = (prefix: string, producer?: string, source = false) => {
    for (const pointer of provenanceIndex.get(prefix) ?? []) {
      const e = evidence.get(pointer);
      require(e && e.producer_ids.some(id => {
        const p = producers.get(id);
        return source ? p && p.outcome_blind && ['stager', 'owner'].includes(p.kind) && !['assumed', 'contested'].includes(e.status)
          : trustedProducer(id) && !['assumed', 'contested'].includes(e.status) && (producer === undefined || id === producer);
      }), 'trusted producer must attest each source/exclusion/transformation field');
    }
  };
  const bundleHash = canonicalSha256(s.source_files);
  for (const p of layer.producers) require(p.source_bundle_hash === bundleHash, 'producer source bundle hash mismatch');
  s.source_files.forEach((_, i) => provenance(`/structure/source_files/${i}`, undefined, true));
  const sourceHashes = new Set(s.source_files.map(f => f.sha256));
  unique(layer.evidence.map(e => e.pointer), 'evidence pointer');
  require(layer.evidence.length === expected.size && layer.evidence.every(e => expected.has(e.pointer)), 'evidence must cover exactly every structural leaf');
  for (const e of layer.evidence) {
    e.producer_ids.forEach(p => require(producers.has(p), 'unknown evidence producer'));
    require(e.status !== 'cited' || e.citations.length > 0, 'cited field requires citation');
    require(e.status !== 'author' || e.producer_ids.some(p => producers.get(p)?.kind === 'task-author'), 'author status requires task author');
    require(!['assumed', 'contested'].includes(e.status) || e.note !== null, 'uncertainty requires note');
    for (const c of e.citations) {
      require(c.byte_end > c.byte_start, 'empty/reversed citation span');
      require(Buffer.byteLength(c.quote, 'utf8') === c.byte_end - c.byte_start, 'citation quote byte length differs from span');
      require(sourceHashes.has(c.file_sha256), 'citation hash absent from source bundle');
    }
  }
  if ('planted_defects' in layer) {
    unique(layer.planted_defects.map(d => d.id), 'planted defect');
    const nodeIds = new Set(s.graph.nodes.map(n => n.id));
    for (const d of layer.planted_defects) d.affected_nodes.forEach(n => require(nodeIds.has(n), 'unknown planted-defect node'));
  }
  const levels = new Map(s.unit_hierarchy.map(l => [l.id, l]));
  const namespaces = new Map(s.namespaces.map(n => [n.id, n]));
  for (const ns of s.namespaces) require(ns.entity_kind === 'unit' ? ns.level !== null && levels.has(ns.level) : ns.level === null, 'namespace kind/level mismatch');
  const nodes = new Map(s.graph.nodes.map(n => [n.id, n]));
  const tables = new Map(s.tables.map(t => [t.id, t]));
  for (const [name, arr] of [['level', s.unit_hierarchy], ['namespace', s.namespaces], ['node', s.graph.nodes], ['table', s.tables], ['join', s.joins], ['replicate', s.replicate_groups], ['partition', s.partitions], ['survival', s.survival], ['transformation', s.transformations], ['dependence', s.dependence]] as const) unique(arr.map(x => x.id), name);
  require(s.unit_hierarchy.filter(l => l.minimum_independent).length === 1, 'exactly one minimum independent level required');
  require(s.unit_hierarchy.filter(l => l.coarser_level === null).length === 1, 'hierarchy requires one root');
  const {coarser, floor} = identity.hierarchy;
  identity.hierarchy.errors.forEach(e => require(false,e));
  for (const n of s.graph.nodes) {
    require(levels.has(n.level), 'unknown node level');
    require(namespaces.get(n.namespace)?.entity_kind === 'unit' && namespaces.get(n.namespace)?.level === n.level, 'unknown node namespace or namespace level mismatch');
  }
  const edges = new Map<string, string[]>();
  unique(s.graph.edges.map(e => JSON.stringify([e.from,e.to,e.relation])), 'graph edge');
  for (const e of s.graph.edges) {
    require(nodes.has(e.from) && nodes.has(e.to) && e.from !== e.to, 'invalid graph endpoints');
    const target = nodes.get(e.to), source = nodes.get(e.from);
    if (source && target) require(coarser(source.level, target.level), 'hierarchy edge must point to a strictly coarser level');
    const targetKind = { 'sample-of': 'donor/subject', 'assigned-with': 'randomization-unit', 'dependent-with': 'dependence-cluster', 'member-of-population': 'target-population', 'derived-from': null }[e.relation];
    require(!targetKind || target?.kind === targetKind, 'graph relation has wrong target kind');
    if (e.relation === 'sample-of') require(nodes.get(e.from)?.kind === 'specimen/sample', 'sample-of requires specimen source');
    const list = edges.get(e.from) ?? []; list.push(e.to); edges.set(e.from, list);
  }
  const cycleCheck = (graph: Map<string, string[]>, label: string) => {
    const indegree = new Map<string, number>();
    for (const [id, next] of graph) { if (!indegree.has(id)) indegree.set(id, 0); for (const n of next) indegree.set(n, (indegree.get(n) ?? 0) + 1); }
    const queue = [...indegree.keys()].filter(id => indegree.get(id) === 0);
    for (let i = 0; i < queue.length; i++) for (const n of graph.get(queue[i]!) ?? []) {
      const count = indegree.get(n)! - 1; indegree.set(n, count); if (!count) queue.push(n);
    }
    require(queue.length === indegree.size, `cyclic ${label}`);
  };
  cycleCheck(edges, 'provenance graph');
  const columnIndex = new Map(s.tables.map(t => [t.id, new Map(t.columns.map(c => [c.name, c]))]));
  const column = (r: {table: string; column: string}) => {
    const c = columnIndex.get(r.table)?.get(r.column);
    require(c, `unknown column ${r.table}/${r.column}`); return c;
  };
  const columns = (t: string, cs: string[]) => cs.forEach(c => column({ table: t, column: c }));
  const pathCache = new Map<string,string>();
  const pathKey = (path: string) => { let result=pathCache.get(path); if(result===undefined){boundedIdentifier(path);identity.unicodeBudget.charge(path);result=path.normalize('NFC').toLowerCase().toUpperCase().toLowerCase().normalize('NFC');identity.unicodeBudget.charge(result);pathCache.set(path,result);}return result; };
  s.source_files.forEach(fileCheck); unique(s.source_files.map(f => pathKey(f.path)), 'source path');
  unique(s.tables.map(t => pathKey(t.file.path)), 'table path');
  const sourceExactPaths = new Set(s.source_files.map(f => f.path));
  const sourceByPath = new Map(s.source_files.map(f => [pathKey(f.path), f.sha256]));
  const derived = new Map<string, string>(), derivedTables = new Map<string,string>();
  const outputHashes = new Set<string>();
  const recordOutput = (f: {path: string; sha256: string}) => {
    require(!sourceHashes.has(f.sha256) && !outputHashes.has(f.sha256), 'transformation output cannot reuse artifact bytes'); outputHashes.add(f.sha256);
    require(!derived.has(pathKey(f.path)), 'duplicate transformation output file'); derived.set(pathKey(f.path), f.sha256);
    require(!sourceByPath.has(pathKey(f.path)), 'transformation output cannot also be a source file');
  };
  for (const t of s.transformations) {
    const output = tables.get(t.output_table); if (output) { recordOutput(output.file); derivedTables.set(pathKey(output.file.path), output.file.sha256); }
    for (const f of t.output_files) {
      require(canonicalJson(f) === canonicalJson(t.row_lineage), 'only row lineage may be an auxiliary transformation output');
      recordOutput(f);
    }
    require(t.output_files.length === 1 && canonicalJson(t.output_files[0]) === canonicalJson(t.row_lineage), 'row lineage must be a dedicated generated output');
  }
  const artifact = (f: {path: string; sha256: string}) => {
    fileCheck(f);
    require(sourceByPath.has(pathKey(f.path)) ? sourceByPath.get(pathKey(f.path)) === f.sha256 : derived.get(pathKey(f.path)) === f.sha256, 'artifact must trace to matching source file or transformation output');
  };
  const sourceArtifact = (f: {path:string;sha256:string}) => {
    fileCheck(f); require(sourceByPath.get(pathKey(f.path)) === f.sha256, 'structural sidecar must be a source file');
  };
  const registries = new Map(s.alias_registries.map(r => [r.namespace, r]));
  unique(s.alias_registries.map(r => r.namespace), 'alias registry namespace');
  unique(s.alias_registries.map(r => pathKey(r.file.path)), 'alias registry path');
  const tablePaths = new Set(s.tables.map(t => pathKey(t.file.path)));
  const namespaceNodes = new Map<string, typeof s.graph.nodes>();
  for (const n of s.graph.nodes) { const list = namespaceNodes.get(n.namespace) ?? []; list.push(n); namespaceNodes.set(n.namespace, list); }
  const aliasNamespaces = new Set(s.aliases.map(a => a.namespace));
  const structuralHashes = new Set(s.tables.map(t => t.file.sha256));
  for (const t of s.tables) if (t.unit_derivation.kind === 'sidecar') structuralHashes.add(t.unit_derivation.map.sha256);
  for (const a of s.assignments) {
    if ('allocation' in a && a.allocation) structuralHashes.add(a.allocation.sha256);
    if ('sequence_allocation' in a) structuralHashes.add(a.sequence_allocation.sha256);
  }
  if (s.summary_statistics) structuralHashes.add(s.summary_statistics.ld_reference.file.sha256);
  for (const e of layer.evidence) for (const c of e.citations) structuralHashes.add(c.file_sha256);
  for (const h of outputHashes) structuralHashes.add(h);
  const registryHashes = new Set<string>();
  for (const r of s.alias_registries) {
    require(!structuralHashes.has(r.file.sha256) && !registryHashes.has(r.file.sha256), 'registry cannot reuse table or sidecar bytes'); registryHashes.add(r.file.sha256);
    artifact(r.file); require(namespaces.has(r.namespace), 'unknown registry namespace');
    require(!tablePaths.has(pathKey(r.file.path)), 'registry cannot reuse table file');
    require(sourceByPath.get(pathKey(r.file.path)) === r.file.sha256, 'registry must be a source file');
    if (namespaces.get(r.namespace)?.entity_kind === 'unit') {
      const count = namespaceNodes.get(r.namespace)?.length ?? 0;
      require(count > 0 && r.entry_count >= count, 'unit registry count must cover closed-world graph');
    }
    require(!aliasNamespaces.has(r.namespace), 'namespace cannot mix inline aliases and registry sidecar');
  }
  const unitNamespace = (namespace: string, level: string) => require(namespaces.get(namespace)?.entity_kind === 'unit' && namespaces.get(namespace)?.level === level && identity.resolvable('public', namespace) && (namespaceNodes.get(namespace)?.length ?? 0) > 0, 'unit derivation namespace must resolve nodes at declared level');

  const outputTransforms = new Map(s.transformations.map(t => [t.output_table,t]));
  const checkedDerivationNamespaces = new Set<string>();
  for (const [tableNumber, t] of s.tables.entries()) {
    fileCheck(t.file);
    require(!sourceByPath.has(pathKey(t.file.path)) || sourceExactPaths.has(t.file.path), 'table must use the pinned source path spelling');
    require(sourceByPath.get(pathKey(t.file.path)) === t.file.sha256 || derivedTables.get(pathKey(t.file.path)) === t.file.sha256, 'table must be a source or a transformation output_table');
    for (const name of t.row_key) {
      const ns = column({table:t.id,column:name})?.namespace;
      require(ns && identity.resolvable('public', ns) && (namespaces.get(ns)?.entity_kind !== 'unit' || (namespaceNodes.get(ns)?.length ?? 0) > 0), 'every row key requires a resolvable alias namespace');
    }
    const outputTransform = outputTransforms.get(t.id);
    if (outputTransform) provenance(`/structure/tables/${tableNumber}`, outputTransform.producer_id);
    unique(t.columns.map(c => c.name), 'column'); columns(t.id, t.row_key);
    require(levels.has(t.unit_derivation.level) && namespaces.has(t.unit_derivation.namespace), 'invalid derivation level/namespace');
    unitNamespace(t.unit_derivation.namespace, t.unit_derivation.level);
    if (t.unit_derivation.kind === 'column-tuple') { t.unit_derivation.columns.forEach(name => require(identity.compatibleNamespaces('public', column({table: t.id, column: name})?.namespace, t.unit_derivation.namespace), 'tuple column namespace mismatch')); columns(t.id, t.unit_derivation.columns); require(t.orientation.unit_axis === 'rows', 'column tuple requires row unit axis'); }
    if (t.unit_derivation.kind === 'sidecar') sourceArtifact(t.unit_derivation.map);
    if (t.unit_derivation.kind === 'row-key-regex') {
      require(safeUnitRegex(t.unit_derivation.pattern) && t.unit_derivation.capture_group === 1, 'unsupported bounded unit regex grammar/capture');
      require(t.row_key.length === 1 && t.orientation.unit_axis === 'rows', 'regex requires a single row key and row unit axis');
    }
    require(t.orientation.layout !== 'records' || (t.orientation.unit_axis === 'rows' && t.orientation.header_namespace === null), 'invalid record orientation');
    require(t.orientation.layout !== 'matrix' || (t.orientation.header_namespace !== null && namespaces.has(t.orientation.header_namespace)), 'matrix header namespace required');
    require(t.orientation.unit_axis !== 'columns' || ['features', 'variants'].includes(t.orientation.row_entity), 'column-oriented units require feature/variant rows');
    if (t.orientation.layout === 'matrix' && t.orientation.header_namespace) {
      if(t.orientation.unit_axis==='columns'){
        unitNamespace(t.orientation.header_namespace, t.unit_derivation.level);
        require(identity.compatibleNamespaces('public', t.orientation.header_namespace, t.unit_derivation.namespace), 'matrix header/derivation namespace mismatch');
      }else require(['feature','variant'].includes(namespaces.get(t.orientation.header_namespace ?? '')?.entity_kind??'')&&registries.has(t.orientation.header_namespace),'row-unit matrix requires a feature/variant header registry');
    }
    if (['features', 'variants'].includes(t.orientation.row_entity)) {
      const kind = t.orientation.row_entity === 'features' ? 'feature' : 'variant';
      for (const name of t.row_key) { const ns = column({table: t.id, column: name})?.namespace; require(ns && namespaces.get(ns)?.entity_kind === kind && registries.has(ns), 'feature/variant row keys require matching registry namespace'); }
    }
    if (!checkedDerivationNamespaces.has(t.unit_derivation.namespace)) {
      checkedDerivationNamespaces.add(t.unit_derivation.namespace);
      for (const n of namespaceNodes.get(t.unit_derivation.namespace) ?? []) require(identity.floorCovered('public', n.id), 'derived unit has no floor identity');
    }
    for (const c of t.columns) {
      if(c.structural_kind === 'unit' && c.namespace && !checkedDerivationNamespaces.has(c.namespace)){checkedDerivationNamespaces.add(c.namespace);for(const n of namespaceNodes.get(c.namespace) ?? [])require(identity.floorCovered('public',n.id),'unit column has no floor identity');}
      if (c.namespace && namespaces.get(c.namespace)?.entity_kind === 'unit' && namespaces.get(c.namespace)?.level === t.unit_derivation.level)
        require(identity.compatibleNamespaces('public', c.namespace, t.unit_derivation.namespace), 'same-level table columns and derivation must share an identity namespace');
      if (c.structural_kind === 'feature') require(c.namespace && namespaces.get(c.namespace)?.entity_kind === 'feature', 'feature column requires feature namespace');
      if (c.namespace && ['feature', 'variant'].includes(namespaces.get(c.namespace)?.entity_kind ?? '')) require(registries.has(c.namespace), 'feature/variant namespace requires alias registry sidecar');
      require(c.namespace === null || namespaces.has(c.namespace), 'unknown column namespace');
      require(c.structural_kind !== 'identifier' && c.structural_kind !== 'unit' || c.namespace !== null, 'identifier/unit requires namespace');
      require(c.storage === 'decimal' ? c.decimal_resolution !== null : c.decimal_resolution === null, 'decimal resolution required exactly for decimal columns');
      if (c.decimal_resolution !== null) require(decimalParts(c.decimal_resolution).coefficient > 0n, 'decimal resolution must be positive');
      require(c.structural_kind !== 'measurement' || c.measurement !== null, 'outcome-capable measurement requires measurement type');
      if (c.measurement) {
        require(['binary', 'ordinal'].includes(c.measurement.type) || c.storage === 'decimal', 'numeric measurement requires decimal storage');
        require(c.measurement.type !== 'bounded-score' || c.measurement.bounds !== null, 'bounded score requires bounds');
        require(!['binary', 'ordinal'].includes(c.measurement.type) || c.measurement.categories.length >= 2, 'categorical measurement requires code order');
        require(c.measurement.type !== 'binary' || c.measurement.categories.length === 2, 'binary requires two categories');
        if (c.measurement.bounds) {
          require(compareDecimals(c.measurement.bounds.lower, c.measurement.bounds.upper) < 0, 'measurement bounds must increase');
        }
      }
    }
  }
  if (s.dataset_type === 'feature-level') require(s.tables.some(t => t.row_key.some(name => namespaces.get(columnIndex.get(t.id)?.get(name)?.namespace ?? '')?.entity_kind === 'feature') || (t.orientation.layout === 'matrix' && t.orientation.unit_axis === 'rows' && namespaces.get(t.orientation.header_namespace ?? '')?.entity_kind === 'feature')), 'feature dataset requires registered feature row keys or headers');
  for (const j of s.joins) { columns(j.from_table, j.from_columns); columns(j.to_table, j.to_columns); require(j.from_columns.length === j.to_columns.length, 'join tuple arity mismatch');
    j.from_columns.forEach((name, i) => require(identity.compatibleNamespaces('public', columnIndex.get(j.from_table)?.get(name)?.namespace, columnIndex.get(j.to_table)?.get(j.to_columns[i]!)?.namespace), 'joined columns must share an identity namespace')); }
  s.batch.forEach(r => { require(column(r)?.structural_kind === 'batch', 'batch annotation requires batch column'); });
  // Index events are bounded ASCII IDs, not fuzzy human labels or Unicode identifiers.
  const indexEvent = (text: string) => { require(/^[a-z][a-z0-9-]{0,63}$/.test(text), 'index event must be a lowercase ASCII ID (64 characters maximum)'); return text.trim().toLowerCase(); };
  const refKey = (r: {table:string;column:string}) => JSON.stringify([r.table,r.column]);
  const timeKey = (r: {table:string;column:string}, event: string) => JSON.stringify([r.table,r.column,indexEvent(event)]);
  const timeAnnotations = new Map(s.time.map(t => [timeKey(t.column,t.index_event),t]));
  require(timeAnnotations.size === s.time.length, 'duplicate time annotation per column/index event');
  s.time.forEach(r => { require(column(r.column)?.structural_kind === 'time', 'time annotation requires time column'); });
  const batchColumns = new Set(s.batch.map(refKey)), timeColumns = new Set(s.time.map(t => refKey(t.column)));
  for (const t of s.tables) for (const c of t.columns) {
    if (c.structural_kind === 'batch') require(batchColumns.has(refKey({table:t.id,column:c.name})), 'missing batch annotation');
    if (c.structural_kind === 'time') require(timeColumns.has(refKey({table:t.id,column:c.name})), 'missing time annotation');
  }
  for (const d of s.dependence) { require(levels.has(d.unit_level), 'unknown dependence level'); d.cluster_nodes.forEach(n => require(nodes.get(n)?.kind === 'dependence-cluster', 'invalid dependence cluster')); require(d.kind === 'independent' || d.kind === 'unknown' || d.cluster_nodes.length > 0, 'dependent design needs clusters'); }
  require(s.dependence.length > 0, 'dependence declaration required (unknown allowed)');
  unique(s.assignments.map(a => canonicalJson(a.exposure)), 'assignment exposure');
  for (const a of s.assignments) {
    column(a.exposure); require(levels.has(a.assignment_unit), 'unknown assignment unit level');
    if (a.kind === 'randomized-unit') sourceArtifact(a.allocation);
    if (a.kind === 'randomized-within-unit-order') { column(a.order_column); sourceArtifact(a.sequence_allocation); }
    if (a.kind === 'blocked/stratified') { a.blocks.forEach(column); require(!a.randomized || a.allocation !== null, 'randomized blocks require allocation'); if (a.allocation) sourceArtifact(a.allocation); }
  }
  for (const r of s.replicate_groups) {
    require(r.kind !== 'technical' || r.handling !== 'retain-distinct', 'technical replicates cannot retain-distinct');
    require(r.members.length >= 2, 'replicate group requires at least two members');
    r.members.forEach(n => require(nodes.has(n), 'unknown replicate member')); require(nodes.has(r.grouping_node), 'unknown replicate grouping node');
    require(new Set(r.members.map(id => nodes.get(id)?.level)).size === 1, 'replicate members must share a level');
    require(nodes.get(r.grouping_node)?.kind !== 'target-population', 'replicate grouping node cannot be a target population');
  }
  errors.push(...identity.partitionErrors(s.partitions.map(partition => ({layer: 'public', partition}))));
  errors.push(...partitionMetadataErrors(layer.producers, s.partitions));
  s.forbidden_uses.forEach(f => column(f.column));
  for (const v of s.survival) {
    const annotation = timeAnnotations.get(timeKey(v.time, v.time_origin.index_event));
    require(annotation, 'survival time needs its own index-event annotation');
    require(annotation && ['post-index','at-index'].includes(annotation.relation), 'survival time must be post-index or at-index');
    if (v.entry_time) require(timeAnnotations.has(timeKey(v.entry_time,v.time_origin.index_event)), 'survival entry time needs origin annotation');
    require(canonicalJson(v.time) !== canonicalJson(v.event), 'survival event must differ from time');
    require(column(v.time)?.measurement?.type === 'time-to-event', 'survival time requires time-to-event measurement'); column(v.event);
    if (v.time_origin.column) column(v.time_origin.column); if (v.entry_time) column(v.entry_time); if (v.censoring_reason) column(v.censoring_reason);
    unique(v.event_codes.map(c => c.code), 'event code'); require(v.event_codes.some(c => c.status === 'event') && v.event_codes.some(c => c.status === 'censored'), 'survival needs event and censoring code meanings');
  }
  const transforms = new Map(s.transformations.map(t => [t.id, t]));
  const lineage = new Map<string, string[]>();
  const dataflow = new Map<string, string[]>();
  const exclusionsByLineage = new Set(s.row_exclusions.map(e => e.lineage_id));
  const joinPairs = new Map<string,number>();
  for (const j of s.joins) { const pair=JSON.stringify([j.from_table,j.to_table].sort()); joinPairs.set(pair,(joinPairs.get(pair) ?? 0)+1); }
  const excludedJoinPairs = new Set<string>();
  const transformByOutput = new Map(s.transformations.map(t => [t.output_table, t.id]));
  for (const [i, t] of s.transformations.entries()) {
    require(context.derivationRegistry?.version === t.registry_version && context.derivationRegistry?.implementations[t.operation] === t.implementation_hash, 'transformation implementation is not registered by trusted host');
    require(t.row_lineage_format === 'omb-row-lineage/v1', 'unsupported row lineage format');
    if (t.operation === 'join') {
      const pair = JSON.stringify([...t.input_tables].sort());
      require(t.input_tables.length === 2 && joinPairs.get(pair) === 1, 'join transformation requires both declared join tables');
      if (exclusionsByLineage.has(t.id)) excludedJoinPairs.add(pair);
    }
    if (['outcome-blind-filter','complete-case'].includes(t.operation)) require(exclusionsByLineage.has(t.id), 'filter requires an exclusion table');
    const expectedParents = t.input_tables.flatMap(id => transformByOutput.has(id) ? [transformByOutput.get(id)!] : []).sort();
    require(canonicalJson([...t.parent_transformations].sort()) === canonicalJson(expectedParents), 'parent transformations must match input-table producers');
    require(trustedProducer(t.producer_id), 'transformation requires trusted outcome-blind producer'); provenance(`/structure/transformations/${i}`, t.producer_id);
    dataflow.set(t.output_table, t.input_tables);
    t.output_files.forEach(artifact);
    t.input_tables.forEach(id => require(tables.has(id), 'unknown lineage input table')); require(tables.has(t.output_table), 'unknown lineage output table'); artifact(t.row_lineage);
    t.parent_transformations.forEach(id => require(transforms.has(id), 'unknown parent transformation')); lineage.set(t.id, t.parent_transformations);
  }
  cycleCheck(lineage, 'transformation lineage');
  cycleCheck(dataflow, 'table dataflow');
  s.joins.forEach((j, i) => { if (j.unmatched === 'exclude-with-lineage') { provenance(`/structure/joins/${i}`); require(excludedJoinPairs.has(JSON.stringify([j.from_table,j.to_table].sort())), 'unmatched exclusion requires exclusion lineage'); } });
  unique(s.row_exclusions.map(e => canonicalJson(e.row)), 'row exclusion');
  for (const [i, e] of s.row_exclusions.entries()) {
    provenance(`/structure/row_exclusions/${i}`, e.producer_id);
    const t = transforms.get(e.lineage_id);
    require(t?.outcome_blind && ['outcome-blind-filter', 'complete-case', 'join'].includes(t.operation) && t.input_tables.includes(e.row.table), 'exclusion requires outcome-blind filter lineage over its source table');
    require(trustedProducer(e.producer_id), 'exclusion requires trusted outcome-blind producer');
    require(tables.get(e.row.table)?.row_key.length === e.row.key.length, 'excluded row key arity/table mismatch');
    require(producers.has(e.producer_id) && producers.get(e.producer_id)?.kind !== 'curator', 'curators cannot exclude rows'); require(transforms.has(e.lineage_id), 'exclusion needs transformation lineage');
  }
  require((s.dataset_type === 'summary-statistic') === (s.summary_statistics !== null), 'summary metadata required exactly for summary-statistic datasets');
  if (s.summary_statistics) {
    const m = s.summary_statistics;
    require(new Set(m.cohorts.map(c => c.trait_type)).size === 1, 'summary dataset must have one trait type');
    unique([m.variant_id,m.effect_allele,m.other_allele,m.per_snp_n].map(canonicalJson), 'summary column role');
    require(new Set([m.variant_id,m.effect_allele,m.other_allele,m.per_snp_n].map(r => r.table)).size === 1, 'summary roles must be row-aligned in one table');
    for (const ref of [m.effect_allele,m.other_allele]) { const c = column(ref); require(c?.storage === 'string' && c.structural_kind === 'annotation' && c.namespace === null, 'summary alleles require string annotation columns without namespace'); }
    const variant = column(m.variant_id);
    require(variant?.namespace && namespaces.get(variant.namespace)?.entity_kind === 'variant' && registries.has(variant.namespace) && tables.get(m.variant_id.table)?.row_key.includes(m.variant_id.column), 'summary variant ID must be a registered variant row key');
    require(column(m.per_snp_n)?.measurement?.type === 'count', 'per-SNP N requires count measurement'); unique(m.cohorts.map(c => c.id), 'cohort'); unique(m.cohorts.map(c => c.accession), 'cohort accession');
    m.cohorts.forEach(c => require(c.trait_type === 'quantitative' ? c.sample_size > 0 : c.cases + c.controls > 0, 'empty summary cohort'));
    require(column(m.per_snp_n)?.storage === 'decimal', 'per-SNP N must be numeric'); column(m.variant_id); column(m.effect_allele); column(m.other_allele); sourceArtifact(m.ld_reference.file);
    require(m.genome_build === m.ld_reference.genome_build, 'LD reference genome build mismatch');
  }
  return errors;
}
function result<T>(value: unknown, errors: string[]): Validation<T> { return errors.length ? { ok: false, errors } : { ok: true, value: value as T, verification: 'structure-only' }; }
export function validatePublicLayer(value: unknown, context: ValidationContext = {}): Validation<PublicLayer> {
  try { assertJson(value); const errors = shapeErrors(publicLayerShape.json, value); return result(value, errors.length ? errors : layerErrors(value as PublicLayer, context)); } catch (e) { return { ok: false, errors: [String(e)] }; }
}
export function validatePrivateLayer(value: unknown, context: ValidationContext = {}): Validation<PrivateLayer> {
  try { assertJson(value); const errors = shapeErrors(privateLayerShape.json, value); return result(value, (errors.length || layerErrors(value as PrivateLayer, context).length) ? ['invalid private layer'] : []); } catch { return { ok: false, errors: ['invalid private layer'] }; }
}
function validateCheckedDataContract(value: unknown, context: ValidationContext): Validation<DataContract> {
  try {
    const errors = shapeErrors(dataContractShape.json, value); if (errors.length) return result(value, errors.map(e => e.startsWith('/sealed_private') ? 'invalid private layer' : e));
    const c = value as DataContract;
    errors.push(...layerErrors(c.public.content, context));
    if (canonicalSha256(c.public.content) !== c.public.hash) errors.push('public hash mismatch');
    if (c.sealed_private) {
      try {
        const priv = c.sealed_private.content;
        if (layerErrors(priv, context).length) throw new Error('invalid private layer');
        const resolver = new IdentityResolver(c.public.content.structure, priv.structure);
        const snapshots = [...c.public.content.structure.partitions.map(partition => ({layer:'public' as const,partition})), ...priv.structure.partitions.map(partition => ({layer:'private' as const,partition}))];
        if (resolver.errors.length || resolver.partitionErrors(snapshots).length) errors.push('private layer reconciliation failed');
      } catch { errors.push('private layer reconciliation failed'); }
      if (canonicalSha256(c.sealed_private.content) !== c.sealed_private.hash) errors.push('private hash mismatch');
      if (c.sealed_private.content.public_hash !== c.public.hash) errors.push('private layer bound to different public hash');
      if (c.sealed_private.content.structure.dataset_id !== c.public.content.structure.dataset_id) errors.push('private/public dataset mismatch');
    }
    return result(value, errors);
  } catch (e) { return { ok: false, errors: [String(e)] }; }
}
/** Both entry points establish the same JSON resource/type bounds before the shared validator. */
export function validateDataContract(value: unknown, context: ValidationContext = {}): Validation<DataContract> {
  try { assertJson(value); return validateCheckedDataContract(value, context); } catch (e) { return { ok: false, errors: [String(e)] }; }
}
export function parseDataContract(text: string, context: ValidationContext = {}): Validation<DataContract> {
  try { return validateCheckedDataContract(parseStrictJson(text), context); } catch (e) { return { ok: false, errors: [String(e)] }; }
}
