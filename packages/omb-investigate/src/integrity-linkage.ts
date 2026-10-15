import { createHmac } from 'node:crypto';
import { canonicalJson, canonicalSha256 } from '../../bio-core/src/index.ts';
import type { IntegrityInput, IntegrityFinding } from './integrity.ts';

export type LinkReason = 'exact-profile' | 'shared-unit' | 'repeated-observation';
export type ContractSource = 'certify' | 'served-card-translation';
export type IntegrityIdentities = {
  schema: 'omb-investigate/integrity-identities@1';
  observations: Record<string, {namespace: string; identifiers: string[]; recordSet: string; tables: string[]}>;
}
export type Linkage = {
  status: 'observed' | 'not-run'; recordSets: 'single' | 'declared'; floorLevel: string | null;
  coverage: string[]; notCovered: string[];
  frames: {tables: string[]; features: number; records: number}[];
  observations: string[]; pairCount: number | null; exactProfilePairCount: number | null;
  sharedUnitPairCount: number | null; repeatedObservationPairCount: number | null;
  pairs: {a: string; b: string; reasons: LinkReason[]}[]; pairsTruncated: boolean;
}
export interface LinkageOptions {recordSets?: ReadonlyMap<string, string>; maxPairs?: number; contractSource?: ContractSource}
export const emptyIdentities = (): IntegrityIdentities => ({schema: 'omb-investigate/integrity-identities@1', observations: {}});
export const emptyLinkage = (): Linkage => ({status: 'not-run', recordSets: 'single', floorLevel: null, coverage: [], notCovered: [], frames: [], observations: [], pairCount: null, exactProfilePairCount: null, sharedUnitPairCount: null, repeatedObservationPairCount: null, pairs: [], pairsTruncated: false});
const sorted = (v: Iterable<string>) => [...new Set(v)].sort();

/** Pure host projection. Raw identifiers live only in the returned host identity map. */
export function collectLinkage(input: IntegrityInput, options: LinkageOptions): {linkage: Linkage; identities: IntegrityIdentities; finding?: IntegrityFinding} {
  const v = input.verifiedContract!, key = input.contractUnitKey!;
  if (!v || !key || key.length < 32) throw new Error('linkage input unavailable');
  const cap = options.maxPairs ?? 10_000;
  if (!Number.isSafeInteger(cap) || cap < 0) throw new Error('invalid linkage pair limit');
  const floor = v.resolver.hierarchy.floor!;
  const aliases = new Map(v.structure.aliases.filter(a => a.encoding === 'token').map(a => [canonicalJson([a.namespace, a.original]), a.node]));
  const identity = (ns: string, raw: string) => aliases.get(canonicalJson([ns, raw])) ?? canonicalJson([ns, raw]);
  type Profile = {frame: string; digest: string; cells: string[]};
  type Record = {obs: string; set: string; unit: string; ns: string; ids: Set<string>; tables: Set<string>; profiles: Profile[]; token: string};
  const records = new Map<string, Record>();
  const frames = new Map<string, {tables: Set<string>; features: number; records: Set<string>}>();
  const setFrames = new Map<string, Set<string>>();
  const publicTables = new Map(v.contract.public.content.structure.tables.map(t => [t.id, t]));
  for (const t of [...v.tables.values()].filter(t => publicTables.get(t.definition.id)?.file.path === t.definition.file.path).sort((a,b) => a.definition.file.path.localeCompare(b.definition.file.path))) {
    const d = t.definition, file = d.file.path, set = options.recordSets ? options.recordSets.get(file) : 'all';
    if (!set) throw new Error('record set missing for a public table');
    const knownFrames = setFrames.get(set) ?? new Set<string>(); setFrames.set(set, knownFrames);
    const columns = d.orientation.unit_axis === 'columns';
    const rowNS = d.row_key.length === 1 ? d.columns.find(c => c.name === d.row_key[0])?.namespace : null;
    const rowUnit = v.structure.namespaces.some(n => n.id === rowNS && n.entity_kind === 'unit');
    const ns = columns ? d.orientation.header_namespace! : rowUnit ? rowNS! : floor;
    // Canonical feature identities permit aliases and column-name differences across tables.
    const keyNamespaces = d.row_key.map(k => d.columns.find(c => c.name === k)!.namespace!);
    const order = t.keys.map((k, i) => ({key: canonicalJson(k.map((raw,j) => identity(keyNamespaces[j]!, raw))), i})).sort((a,b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
    const frame = canonicalSha256([keyNamespaces, order.map(o => o.key)]);
    if (columns) knownFrames.add(frame);
    for (let i = 0; i < t.units.length; i++) {
      const raw = columns ? t.entityHeaders[i]! : rowUnit ? t.keys[i]![0]! : null;
      const obs = raw === null ? t.units[i]! : identity(ns, raw), recordID = canonicalJson([obs, set]);
      // Tokens name observation-records, so a repeated observation in another set stays distinct.
      const token = 'o_' + createHmac('sha256', key).update('omb-public-observation/v1\0' + recordID).digest('hex');
      const r = records.get(recordID) ?? {obs, set, unit: t.units[i]!, ns, ids: new Set<string>(), tables: new Set<string>(), profiles: [], token};
      if (r.unit !== t.units[i] || r.ns !== ns) throw new Error('inconsistent observation identity');
      if (raw !== null) r.ids.add(raw);
      r.tables.add(file); records.set(recordID, r);
      if (columns) {
        const j = t.header.indexOf(raw!), cells = order.map(o => t.rows[o.i]![j]!);
        const f = frames.get(frame) ?? {tables: new Set<string>(), features: order.length, records: new Set<string>()};
        f.tables.add(file); f.records.add(recordID); frames.set(frame, f);
        if (cells.some(c => c !== '' && !d.columns[j]!.missingness_codes.includes(c))) r.profiles.push({frame, digest: canonicalSha256(cells), cells});
      }
    }
  }
  const linkage: Linkage = {...emptyLinkage(), status: 'observed', recordSets: options.recordSets ? 'declared' : 'single', floorLevel: floor,
    coverage: [`declared-unit:${floor}`, ...(options.recordSets ? ['repeated-observation'] : [])],
    notCovered: ['near-duplicate profiles', 'exact matches on row tables alone', 'matrices with different feature sets', 'identity links not declared by the contract'],
    pairCount: 0, exactProfilePairCount: 0, sharedUnitPairCount: 0, repeatedObservationPairCount: 0};
  // A common frame must cover every entity-bearing set. Disjoint feature sets cannot certify absence.
  const allFrames = [...setFrames.values()];
  if (allFrames.length && [...allFrames[0]!].some(f => allFrames.every(s => s.has(f)))) linkage.coverage.unshift('exact-profile:matrix');
  linkage.frames = [...frames].sort(([a],[b]) => a.localeCompare(b)).map(([,f]) => ({tables: sorted(f.tables), features: f.features, records: f.records.size}));
  const identities = emptyIdentities(), involved = new Set<string>(), involvedTables = new Set<string>();
  const list = [...records.values()].sort((a,b) => a.token.localeCompare(b.token));
  for (const r of list) identities.observations[r.token] = {namespace: r.ns, identifiers: sorted(r.ids), recordSet: r.set, tables: sorted(r.tables)};
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i]!, b = list[j]!, reasons: LinkReason[] = [];
    if (a.profiles.some(x => b.profiles.some(y => x.frame === y.frame && x.digest === y.digest && x.cells.length === y.cells.length && x.cells.every((c,k) => c === y.cells[k])))) {reasons.push('exact-profile'); linkage.exactProfilePairCount!++;}
    if (a.obs !== b.obs && a.unit === b.unit) {reasons.push('shared-unit'); linkage.sharedUnitPairCount!++;}
    if (a.obs === b.obs && a.set !== b.set) {reasons.push('repeated-observation'); linkage.repeatedObservationPairCount!++;}
    if (!reasons.length) continue;
    linkage.pairCount!++; involved.add(a.token); involved.add(b.token);
    for (const t of [...a.tables, ...b.tables]) involvedTables.add(t);
    if (linkage.pairs.length < cap) linkage.pairs.push({a: a.token, b: b.token, reasons}); else linkage.pairsTruncated = true;
  }
  linkage.observations = sorted(involved);
  if (!linkage.pairCount) return {linkage, identities};
  const base = {kind: 'overlap-pairs', admission: 'observed' as const, units: linkage.observations, tables: sorted(involvedTables), count: linkage.pairCount,
    detail: 'Record pairs that share a declared unit, repeat one observation across datasets, or have byte-identical aligned matrix profiles.',
    scope: {countUnit: 'pairs' as const, coverage: 'duplicate-or-overlap-union' as const}};
  return {linkage, identities, finding: {id: 'if_' + canonicalSha256(base), ...base}};
}
