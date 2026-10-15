import { type ContractStructure, type PublicLayer } from '../../omb-contract/src/index.ts';
import { contentHash, json } from './primitives.ts';
import { memberAnchors } from './anchors.ts';
import { contractIdentities, uniqueIdentities } from './identities.ts';
import type { Look, PartitionCommitment, PriorExposure, StoreEvent, UnitIdentity } from './types.ts';

export const identityKey = (i: UnitIdentity): string => json([i.scope, i.key]);
export interface ExposureCandidate { partition: PartitionCommitment; sourceHash: string; structure: ContractStructure }
/** Unlocked partition events have no authority to merge or burn global identities. */
export function exposureSnapshot(events: StoreEvent[], read: (hash: string) => Buffer, candidate?: ExposureCandidate, cache = new Map<string, UnitIdentity[][]>()): PriorExposure[] {
  const parents = new Map<string, string>(), identities = new Map<string, UnitIdentity>();
  const root = (k: string): string => { const p = parents.get(k); if (p === undefined) { parents.set(k, k); return k; } if (p === k) return k; const r = root(p); parents.set(k, r); return r; };
  const merge = (keys: string[]) => { const roots = keys.map(root).sort(); for (const k of roots) parents.set(k, roots[0]!); };
  const keys = (ids: UnitIdentity[]) => ids.map(i => { const k = identityKey(i); identities.set(k, i); return k; });
  const locks = events.filter(e => e.kind === 'lock').map(e => e.payload as { datasetId: string; record: Record<string, unknown>; hash: string });
  const vetted = events.filter(e => e.kind === 'partition').map(e => e.payload as PartitionCommitment).filter(p => locks.some(l => l.datasetId === p.datasetId && l.record.stage === 'L2-partition-lock' && l.record.partition_hash === p.partitionHash));
  const memberIds = new Map<PartitionCommitment, UnitIdentity[][]>();
  const register = (p: PartitionCommitment, _source: string, s: ContractStructure) => {
    const cacheKey = contentHash([p.publicContractHash, p.units, p.sourceSpellings]);
    let entries = cache.get(cacheKey);
    if (!entries) {
    const canonical = contractIdentities(s); entries = [];
    for (const u of p.units) for (const member of u.members) {
      // A batch imposes allocation equality, never biological identity equality.
      const ids = uniqueIdentities([...canonical.identities(member), ...memberAnchors(s, member, p.sourceSpellings)]);
      entries.push(ids);
    }
    cache.set(cacheKey, entries);
    }
    for (const ids of entries) merge(keys(ids));
    memberIds.set(p, entries);
  };
  for (const p of vetted) {
    const source = locks.find(l => l.datasetId === p.datasetId && l.record.stage === 'L0-source-lock')!.record.source_hash as string;
    register(p, source, (JSON.parse(read(p.publicContractHash).toString()) as PublicLayer).structure);
  }
  if (candidate) register(candidate.partition, candidate.sourceHash, candidate.structure);
  for (const e of events) if (e.kind === 'identity-merge') merge(keys(e.payload as UnitIdentity[]));
  const result = new Map<string, PriorExposure>();
  for (const [k, i] of identities) {
    const r = root(k), entry = result.get(r) ?? { identities: [], allocations: [], burnRecordHashes: [] };
    entry.identities.push(i); result.set(r, entry);
  }
  for (const p of vetted) {
    let index = 0;
    for (const u of p.units) for (const _member of u.members) {
      const entry = result.get(root(identityKey(memberIds.get(p)![index++]![0]!)))!;
      // Exclusion releases no bytes and reserves no allocation. A batch-only
      // exclusion must not poison another dataset's sticky member reservation.
      if (u.allocation !== 'excluded') entry.allocations.push(u.allocation);
      if (u.allocation === 'dev') entry.burnRecordHashes.push(...locks.filter(l => l.datasetId === p.datasetId && l.record.stage === 'L3-schema-view' && l.record.partition_hash === p.partitionHash).map(l => l.hash));
      if (u.allocation === 'held-out') entry.burnRecordHashes.push(...events.filter(e => e.kind === 'look').map(e => e.payload as Look).filter(l => l.partitionId === p.id && l.executable).map(l => l.hash));
    }
  }
  return [...result.values()].map(e => ({ identities: uniqueIdentities(e.identities), allocations: [...new Set(e.allocations)].sort(), burnRecordHashes: [...new Set(e.burnRecordHashes)].sort() }));
}
export function priorFor(snapshot: PriorExposure[], ids: UnitIdentity[]): PriorExposure {
  const wanted = new Set(ids.map(identityKey)), matching = snapshot.filter(e => e.identities.some(i => wanted.has(identityKey(i))));
  return { identities: uniqueIdentities([...ids, ...matching.flatMap(e => e.identities)]), allocations: [...new Set(matching.flatMap(e => e.allocations))].sort(), burnRecordHashes: [...new Set(matching.flatMap(e => e.burnRecordHashes))].sort() };
}
export function stickyAllocation(prior: PriorExposure): 'dev' | 'held-out' | 'excluded' | null {
  if (prior.allocations.includes('excluded') || (prior.allocations.includes('dev') && prior.allocations.includes('held-out'))) return 'excluded';
  if (prior.allocations.includes('dev')) return 'dev';
  if (prior.allocations.includes('held-out')) return prior.burnRecordHashes.length ? 'excluded' : 'held-out';
  return prior.burnRecordHashes.length ? 'excluded' : null;
}
