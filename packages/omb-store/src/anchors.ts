import { normalizeIdentifier, type ContractStructure } from '../../omb-contract/src/index.ts';
import { digest, fail, json } from './primitives.ts';
import type { ResolvedTable } from './sealer.ts';
import type { UnitIdentity } from './types.ts';

/** Fixed exposure policy, deliberately independent of all curator labels/rules. */
export function spellingAnchor(raw: string): UnitIdentity {
  const normalize = (value: string) => normalizeIdentifier(value, { id: 'exposure', entity_kind: 'unit', level: null, preserve_originals: true, collision_policy: 'merge-with-limitation', rules: ['nfkc', 'remove-zero-width', 'ascii-case-fold', 'trim-ascii', 'canonical-decimal'] });
  // Unicode upper/lower folding deliberately also merges compatibility case
  // variants (including sharp-s and final sigma). Extra merging costs power.
  const key = normalize(normalize(raw).toUpperCase().toLowerCase().trim());
  if (!key) fail('empty normalized source spelling');
  return { scope: 'exposure', key: json([key]) };
}
export function closureNodes(s: ContractStructure, node: string): string[] {
  const seen = new Set<string>(), queue = [node];
  for (const id of queue) {
    if (seen.has(id)) continue; seen.add(id);
    for (const e of s.graph.edges) if (['sample-of', 'derived-from', 'assigned-with', 'dependent-with'].includes(e.relation)) {
      if (e.from === id) queue.push(e.to);
      if (e.to === id) queue.push(e.from);
    }
    for (const r of s.replicate_groups) if (r.members.includes(id)) queue.push(...r.members);
  }
  return [...seen];
}
export type NodeSpellings = Record<string, string[]>;
/** K1b's resolved tables must preserve the raw source cell spellings. Registry
 * bytes are content-addressed inputs, never curator-supplied replacement rows. */
export function sourceSpellings(s: ContractStructure, tables: ResolvedTable[], read?: (hash: string) => Uint8Array): NodeSpellings {
  const result: NodeSpellings = Object.fromEntries(s.graph.nodes.map(n => [n.id, []]));
  const add = (node: string, value: unknown) => {
    if (!result[node]) fail('unknown source spelling node');
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') fail('missing raw unit spelling');
    result[node]!.push(String(value));
  };
  for (const t of tables) {
    const d = s.tables.find(d => d.id === t.id) ?? fail('unknown source table');
    const columns = new Set([...d.row_key, ...(d.unit_derivation.kind === 'column-tuple' ? d.unit_derivation.columns : []), ...d.columns.filter(c => c.namespace && s.namespaces.some(n => n.id === c.namespace && n.entity_kind === 'unit')).map(c => c.name)]);
    for (const [i, row] of t.rows.entries()) for (const [j, name] of t.headers.entries()) if (columns.has(name)) for (const node of t.rowNodes[i] ?? []) add(node, row[j]);
    for (const [i, nodes] of t.columnNodes.entries()) for (const node of nodes) add(node, t.headers[i]);
  }
  for (const registry of s.alias_registries) {
    if (s.namespaces.find(n => n.id === registry.namespace)?.entity_kind !== 'unit') continue;
    if (!read) fail('unit alias registry bytes required');
    const bytes = Buffer.from(read(registry.file.sha256));
    if (digest(bytes) !== registry.file.sha256) fail('registry source hash mismatch');
    const lines = bytes.toString('utf8').trimEnd().split(/\r?\n/), header = lines.shift()!.split('\t');
    const original = header.indexOf('original'), node = header.indexOf('node'), encoding = header.indexOf('encoding');
    if (original < 0 || node < 0 || lines.length !== registry.entry_count) fail('invalid alias registry');
    for (const line of lines) {
      const cells = line.split('\t'); if (cells.length !== header.length) fail('ragged alias registry');
      const id = cells[node]!;
      if (!s.graph.nodes.some(n => n.id === id && n.namespace === registry.namespace)) fail('registry node namespace mismatch');
      add(id, cells[original]);
      if (cells[encoding] === 'canonical-json-array') for (const v of JSON.parse(cells[original]!) as unknown[]) add(id, v);
    }
  }
  return Object.fromEntries(Object.entries(result).map(([n, values]) => [n, [...new Set(values)].sort()]));
}
export function memberAnchors(s: ContractStructure, node: string, source: NodeSpellings = {}): UnitIdentity[] {
  const raw: string[] = [];
  const add = (value: string, encoding = 'token') => { raw.push(value); if (encoding === 'canonical-json-array') raw.push(...JSON.parse(value) as string[]); };
  for (const id of closureNodes(s, node)) {
    const n = s.graph.nodes.find(n => n.id === id) ?? fail('unknown closure node'); add(n.original_id);
    for (const a of s.aliases) if (a.node === id) add(a.original, a.encoding);
    for (const c of s.collision_merges) if (c.merged_node === id) for (const original of c.originals) add(original, c.encoding);
    raw.push(...source[id] ?? []);
  }
  return raw.map(spellingAnchor);
}
