import { sourceSpellings, memberAnchors } from './anchors.ts';
import { createHmac, randomBytes } from 'node:crypto';
import { evidencePointers, partitionErrors, type PartitionArtifact, type PublicEnvelope, type PublicLayer } from '../../omb-contract/src/index.ts';
import { contentHash, digest, fail, hash, json, key, mac, text } from './primitives.ts';
import { priorFor, stickyAllocation } from './exposure.ts';
import { identifierColumns } from './apply-plan.ts';
import { contractIdentities, uniqueIdentities } from './identities.ts';
import { sealV2 } from './seal-v2.ts';
import type { DevSchemaView, PartitionCommitment, PriorExposure, UnitIdentity } from './types.ts';

export type Cell = string | number | boolean | null;
/** K1b's exhaustive, trusted resolution, never a worker-supplied splits.tsv.
 * Both axes carry lineage. [] means non-unit schema/feature material, not an
 * unresolved identity; K1b must prove that distinction against source bytes.
 */
export interface ResolvedTable {
  id: string; headers: string[]; rows: Cell[][];
  rowNodes: string[][]; columnNodes: string[][];
}
/** donor/identities are legacy hints only; the contract graph owns equality. */
export interface UnitMetadata { node: string; donor: string; stratum: string; batches: string[]; identities: UnitIdentity[] }
export interface SealRequest {
  contract: PublicEnvelope; expectedContractHash: string; partitionId: string;
  units: UnitMetadata[]; tables: ResolvedTable[]; hostKey: Uint8Array;
  priorExposure?: PriorExposure[];
  readSourceArtifact?: (hash: string) => Uint8Array;
  confirmFraction?: number; entropy?: (n: number) => Uint8Array;
}
export interface SealedPartition {
  commitment: PartitionCommitment; commitmentBytes: Buffer; partitionArtifact: PartitionArtifact; partitionBytes: Buffer; sealedBytes: Buffer;
  devView: ResolvedTable[]; devViewHash: string; canaryTokens: string[];
  seedCommitment: string; schemaView: DevSchemaView;
}
class Groups {
  parents = new Map<string, string>();
  constructor(ids: string[]) { ids.forEach(id => this.parents.set(id, id)); }
  root(id: string): string { const p = this.parents.get(id) ?? fail('unknown contract unit'); if (p === id) return id; const r = this.root(p); this.parents.set(id, r); return r; }
  merge(ids: string[]): void { const roots = ids.map(id => this.root(id)).sort(); for (const r of roots) this.parents.set(r, roots[0]!); }
}
export function partitionSeed(hostKey: Uint8Array, contractHash: string): Buffer {
  hash(contractHash); return createHmac('sha256', key(hostKey)).update(contractHash, 'utf8').digest();
}
/** Resolves any contract graph node to its contract floor (minimum independent) unit nodes. Shared
 * by the sealer and the confirm runner's unit tokens (K2b-fix1 finding 14). */
export function floorResolver(s: PublicLayer['structure']): (node: string) => string[] {
  const floor = s.unit_hierarchy.filter(l => l.minimum_independent);
  if (floor.length !== 1) fail('unique contract independent unit required');
  const nodeSet = new Set(s.graph.nodes.map(n => n.id));
  const unitSet = new Set(s.graph.nodes.filter(n => n.level === floor[0]!.id).map(n => n.id));
  function resolve(node: string, seen = new Set<string>()): string[] {
    if (!nodeSet.has(node) || seen.has(node)) fail('unresolved or cyclic contract node');
    if (unitSet.has(node)) return [node];
    seen.add(node);
    const paths = s.graph.edges.filter(e => e.from === node && ['sample-of', 'assigned-with', 'derived-from', 'dependent-with'].includes(e.relation));
    const resolved = [...new Set(paths.flatMap(e => resolve(e.to, new Set(seen))))];
    if (!resolved.length) fail('node cannot resolve to contract independent unit');
    return resolved;
  }
  return node => resolve(node);
}
export function createSealedPartition(request: SealRequest): SealedPartition {
  const { contract, expectedContractHash, units, tables, partitionId } = request;
  const hostKey = key(request.hostKey); text(partitionId); hash(expectedContractHash);
  if (contract.hash !== expectedContractHash || contentHash(contract.content) !== expectedContractHash) fail('contract pin mismatch');
  if (contract.content.schema_version !== 'omb-data-contract/v3.1') fail('v3.1 public contract required');
  const s = contract.content.structure;
  const floor = s.unit_hierarchy.filter(l => l.minimum_independent);
  if (floor.length !== 1) fail('unique contract independent unit required');
  const nodes = s.graph.nodes.filter(n => n.level === floor[0]!.id).map(n => n.id).sort();
  if (nodes.length < 2 || json(nodes) !== json(units.map(u => u.node).sort())) fail('unit metadata must exhaust contract units exactly');
  const resolve = floorResolver(s);
  const canonical = contractIdentities(s);
  const spellings = sourceSpellings(s, tables, request.readSourceArtifact);
  const canonicalUnits = units.map(u => ({ ...u, identities: uniqueIdentities([...canonical.identities(u.node), ...memberAnchors(s, u.node, spellings)]) }));
  const groups = new Groups(nodes);
  for (const r of s.replicate_groups) groups.merge([...new Set(r.members.flatMap(n => resolve(n)))]);
  // Donor, identity and whole-batch constraints are unions, including transitive
  // cross-batch replicates. No grouping ever splits a contract unit.
  const memberships = new Map<string, string[]>();
  for (const u of canonicalUnits) {
    text(u.donor); text(u.stratum);
    if (!u.identities.length || (s.batch.length > 0 && !u.batches.length)) fail('missing identity or batch resolution');
    for (const b of u.batches) text(b);
    const keys = [json(['canonical', canonical.resolver.nodeKey('public', u.node)]), ...u.identities.map(i => { text(i.scope); text(i.key); return json(['identity', i.scope, i.key]); }), ...(s.batch.length ? u.batches.map(b => json(['batch', b])) : [])];
    for (const k of keys) memberships.set(k, [...(memberships.get(k) ?? []), u.node]);
  }
  for (const members of memberships.values()) groups.merge(members);
  for (const e of request.priorExposure ?? []) {
    const members = canonicalUnits.filter(u => u.identities.some(i => e.identities.some(j => json(i) === json(j)))).map(u => u.node);
    if (members.length) groups.merge(members);
  }
  const merged = new Map<string, UnitMetadata[]>();
  for (const u of canonicalUnits) { const r = groups.root(u.node); merged.set(r, [...(merged.get(r) ?? []), u]); }
  if (merged.size < 2) fail('cannot split without breaking donor/replicate/batch groups');
  const seed = partitionSeed(hostKey, expectedContractHash), fraction = request.confirmFraction ?? 0.3;
  if (!(fraction > 0 && fraction < 1)) fail('invalid confirm fraction');
  const strata = new Map<string, string[]>();
  for (const [root, members] of merged) {
    const stratum = json([...new Set(members.map(m => m.stratum))].sort());
    strata.set(stratum, [...(strata.get(stratum) ?? []), root]);
  }
  const rank = (root: string): string => mac(seed, 'omb-store/partition-rank/v1', root);
  const assigned = new Map<string, 'dev' | 'held-out' | 'excluded'>();
  const prior = request.priorExposure ?? [];
  for (const [root, members] of merged) {
    const allocation = stickyAllocation(priorFor(prior, members.flatMap(m => m.identities)));
    if (allocation) assigned.set(root, allocation);
  }
  for (const roots of strata.values()) {
    const fresh = roots.filter(r => !assigned.has(r)).sort((a, b) => rank(a).localeCompare(rank(b)));
    const target = Math.max(1, Math.round(roots.length * fraction));
    const held = roots.filter(r => assigned.get(r) === 'held-out').length;
    const count = Math.max(0, Math.min(fresh.length, target - held));
    fresh.forEach((r, i) => assigned.set(r, i < count ? 'held-out' : 'dev'));
  }
  const fresh = [...merged.keys()].filter(r => stickyAllocation(priorFor(prior, merged.get(r)!.flatMap(m => m.identities))) === null).sort((a, b) => rank(a).localeCompare(rank(b)));
  for (const allocation of ['held-out', 'dev'] as const) if (![...assigned.values()].includes(allocation)) {
    const r = fresh.find(r => assigned.get(r) !== allocation && [...assigned.values()].filter(a => a === assigned.get(r)).length > 1);
    if (!r) fail('cannot split sticky or burned identities into nonempty dev and held-out');
    assigned.set(r, allocation);
  }
  const allocations = new Map(nodes.map(n => [n, assigned.get(groups.root(n))!]));
  if (new Set(tables.map(t => t.id)).size !== tables.length || json(tables.map(t => t.id).sort()) !== json(s.tables.map(t => t.id).sort())) fail('resolved table inventory mismatch');
  for (const t of tables) {
    const declaration = s.tables.find(d => d.id === t.id)!;
    if (!t.headers.length || !t.rows.length || new Set(t.headers).size !== t.headers.length || t.rowNodes.length !== t.rows.length || t.columnNodes.length !== t.headers.length || t.rows.some(r => r.length !== t.headers.length)) fail('ragged or incomplete resolved table');
    json(t.rows);
    for (const n of [...t.rowNodes, ...t.columnNodes].flat()) resolve(n);
    if (declaration.orientation.unit_axis === 'rows' && t.rowNodes.some(n => !n.length)) fail('unresolved row unit');
    if (declaration.orientation.unit_axis === 'columns' && !t.columnNodes.some(n => n.length)) fail('missing matrix unit headers');
    // All declared record fields must be present; resolved matrix headers may
    // additionally contain entity columns, whose exhaustive coverage K1b pins.
    for (const c of declaration.columns) if (!t.headers.includes(c.name)) fail('missing declared table column');
  }
  const project = (allocation: 'dev' | 'held-out'): ResolvedTable[] => tables.map(t => {
    const include = (ns: string[]): boolean => ns.flatMap(n => resolve(n)).every(n => allocations.get(n) === allocation);
    const ri = t.rowNodes.flatMap((n, i) => include(n) ? [i] : []), ci = t.columnNodes.flatMap((n, i) => include(n) ? [i] : []);
    return { id: t.id, headers: ci.map(i => t.headers[i]!), rows: ri.map(r => ci.map(c => t.rows[r]![c]!)), rowNodes: ri.map(i => [...t.rowNodes[i]!]), columnNodes: ci.map(i => [...t.columnNodes[i]!]) };
  });
  const devView = project('dev'), confirmView = project('held-out');
  const token = `OMBCANARY_${mac(hostKey, 'omb-store/dev-canary/v1', expectedContractHash)}`;
  if (json(tables).includes(token)) fail('canary collides with source');
  const identityColumns = identifierColumns(contract.content);
  for (const t of devView) {
    const declaration = s.tables.find(d => d.id === t.id)!;
    if (!t.rows.length) fail('empty dev table after lineage filtering');
    if (declaration.orientation.unit_axis === 'rows') {
      const ids = declaration.columns.filter(c => identityColumns.has(JSON.stringify([t.id, c.name]))).map(c => t.headers.indexOf(c.name));
      if (!ids.length || ids.some(i => i < 0)) fail('cannot plant row canary without identity column');
      const row = [...t.rows[0]!]; ids.forEach(i => { row[i] = token; });
      t.rows.push(row); t.rowNodes.push([token]);
    } else {
      const sample = t.columnNodes.findIndex(n => n.length > 0);
      if (sample < 0) fail('empty dev matrix');
      t.headers.push(token); t.columnNodes.push([token]);
      t.rows.forEach(r => r.push(r[sample]!));
    }
  }
  const sealedBytes = sealV2(Buffer.from(json(confirmView)), hostKey, request.entropy ?? randomBytes);
  const commitmentUnits: PartitionCommitment['units'] = [...merged].sort(([a], [b]) => a.localeCompare(b)).map(([node, members]) => ({ node, members: members.map(m => m.node).sort(), allocation: assigned.get(node)!, identities: uniqueIdentities(members.flatMap(m => canonical.identities(m.node))) }));
  const sealedTables = confirmView.map(t => ({ id: t.id, headers: [...t.headers], rowCount: t.rows.length, recordAxis: t.columnNodes.every(n => !n.length) && t.rowNodes.every(n => n.length > 0) }));
  const base = { sourceSpellings: spellings, sealedTables, id: partitionId, datasetId: s.dataset_id, publicContractHash: expectedContractHash, sealedArtifactHash: digest(sealedBytes), units: commitmentUnits };
  const commitmentBytes = Buffer.from(json(base)), commitmentHash = digest(commitmentBytes);
  // L2 is the standalone K1a v3.1 artifact; V5's collapsed members, aliases and
  // ciphertext binding remain a separately content-addressed host commitment.
  const partitions: PartitionArtifact['content']['partitions'] = [{
    id: partitionId, unit_level: floor[0]!.id,
    seed_provenance: { method: 'hmac-sha256', producer_id: 'omb-store', key_id: 'host-partition-key', contract_hash: expectedContractHash, seed_commitment: digest(seed) },
    units: [...new Map(nodes.map(node => [canonical.resolver.nodeKey('public', node), node])).values()].map(node => ({ node, ...canonical.resolver.commitment('public', node), allocation: allocations.get(node)!, burn: (() => { const hashes = priorFor(prior, merged.get(groups.root(node))!.flatMap(m => m.identities)).burnRecordHashes; return hashes.length ? { status: 'burned' as const, look_record_hashes: hashes } : { status: 'unseen' as const }; })() })),
  }];
  const producers: PartitionArtifact['content']['producers'] = [{ id: 'omb-store', kind: 'stager', name: 'omb-store deterministic sealer', version: '2', model_family: null, source_bundle_hash: contentHash(s.source_files), outcome_blind: true }];
  const errors = partitionErrors(s, producers, partitions, expectedContractHash);
  if (errors.length) fail(errors.join('; '));
  const content: PartitionArtifact['content'] = {
    schema_version: 'omb-partition-artifact/v3.1', dataset_id: s.dataset_id, antecedent_public_contract_hash: expectedContractHash, partitions, producers,
    evidence: evidencePointers(partitions, '/partitions').map(pointer => ({ pointer, status: 'assumed', producer_ids: ['omb-store'], citations: [], note: 'Deterministic host allocation; source lineage and global identities require K1b verification.' })),
  };
  const partitionBytes = Buffer.from(json(content)), partitionHash = digest(partitionBytes);
  const partitionArtifact: PartitionArtifact = { content, hash: partitionHash };
  const schemaView: DevSchemaView = { version: 'omb-dev-schema/v1', partitionHash,
    devUnits: commitmentUnits.filter(u => u.allocation === 'dev').flatMap(u => u.members).sort(),
    tables: devView.map(t => ({ id: t.id, headers: [...t.headers], rowCount: t.rows.length, columnCount: t.headers.length })),
  };
  return { commitment: { ...base, partitionHash, commitmentHash }, commitmentBytes, partitionArtifact, partitionBytes, sealedBytes, devView, devViewHash: contentHash(devView), canaryTokens: [token], seedCommitment: digest(seed), schemaView };
}
/** Use only on successful reads/results; a denied read is not leakage evidence. */
export function detectCanaryLeak(output: string, tokens: readonly string[], successful: boolean): boolean {
  return successful && tokens.some(t => t.length > 0 && output.includes(t));
}
