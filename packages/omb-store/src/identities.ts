import { IdentityResolver, type ContractStructure } from '../../omb-contract/src/index.ts';
import { fail, json } from './primitives.ts';
import type { UnitIdentity } from './types.ts';

/** Only K1a may name identities. Keep each material original as well as the
 * collapsed commitment: merging p0/p1 must not erase p1's earlier exposure. */
export function contractIdentities(s: ContractStructure) {
  const resolver = new IdentityResolver(s);
  if (resolver.errors.length) fail(resolver.errors.join('; '));
  const byLevel = new Map<string, IdentityResolver>();
  const atomic = (node: string): UnitIdentity => {
    const n = s.graph.nodes.find(n => n.id === node) ?? fail('unknown identity node');
    let r = byLevel.get(n.level);
    if (!r) {
      r = new IdentityResolver({ ...s, graph: { nodes: s.graph.nodes.filter(x => x.level === n.level), edges: [] },
        aliases: s.aliases.filter(a => s.graph.nodes.some(x => x.id === a.node && x.level === n.level)),
        collision_merges: s.collision_merges.filter(a => s.graph.nodes.some(x => x.id === a.merged_node && x.level === n.level)),
        replicate_groups: [], unit_hierarchy: s.unit_hierarchy.map(l => ({ ...l, minimum_independent: l.id === n.level })) });
      if (r.errors.length) fail(r.errors.join('; '));
      byLevel.set(n.level, r);
    }
    const c = r.commitment('public', node); return { scope: c.identity_scope, key: c.identity_key };
  };
  const identities = (node: string): UnitIdentity[] => {
    const c = resolver.commitment('public', node), ids = [{ scope: c.identity_scope, key: c.identity_key }, atomic(node)];
    const seen = new Set<string>(), queue = [node];
    for (let i = 0; i < queue.length; i++) {
      const id = queue[i]!; if (seen.has(id)) continue; seen.add(id);
      ids.push(atomic(id));
      for (const e of s.graph.edges) if (['sample-of', 'derived-from', 'assigned-with', 'dependent-with'].includes(e.relation)) {
        // A coarser independent unit retains every underlying donor/material
        // identity; changing the floor must not erase their earlier exposure.
        if (e.from === id) queue.push(e.to);
        if (e.to === id) queue.push(e.from);
      }
    }
    return uniqueIdentities(ids);
  };
  return { resolver, identities };
}
export function uniqueIdentities(ids: UnitIdentity[]): UnitIdentity[] {
  return [...new Map(ids.map(i => [json(i), i])).entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, i]) => i);
}
