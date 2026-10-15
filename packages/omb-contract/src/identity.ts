import { canonicalJson as stableJson } from '../../bio-core/src/index.ts';
import type { PostLookAmendment } from './locks.ts';
import type { ContractStructure, Partition } from './schema.ts';
import { normalizeAlias, normalizeIdentifier, UnicodeBudget } from './normalize.ts';

/** K1b registry ingestion. Only this module interprets identity targets and spellings.
 * The caller must hash-check the immutable bytes before supplying them. */
export function hydrateRegistries(structure: ContractStructure, read: (path: string) => Uint8Array): {
  structure: ContractStructure; entities: Map<string, Map<string, string>>;
} {
  const s = structuredClone(structure), entities = new Map<string, Map<string, string>>();
  const budget = new UnicodeBudget();
  for (const descriptor of s.alias_registries) {
    const ns = s.namespaces.find(n => n.id === descriptor.namespace)!;
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(read(descriptor.file.path));
    const header = 'namespace\tencoding\toriginal\tcanonical\ttarget\n';
    if (!text.startsWith(header) || !text.endsWith('\n') || text.includes('\r')) throw new Error('registry format');
    const lines = text.slice(header.length, -1).split('\n');
    if (lines.length !== descriptor.entry_count) throw new Error('registry entry count');
    const resolved = new Map<string, string>(), targets = new Set<string>();
    let previous: [string, string] | undefined;
    for (const line of lines) {
      const cells = line.split('\t');
      if (cells.length !== 5 || cells[0] !== ns.id || !['token','canonical-json-array'].includes(cells[1]!)) throw new Error('registry namespace/encoding');
      const values = cells.slice(2).map(cell => {
        const value: unknown = JSON.parse(cell);
        if (typeof value !== 'string' || JSON.stringify(value) !== cell) throw new Error('registry canonical JSON cell');
        return value;
      });
      const encoding = cells[1] as 'token' | 'canonical-json-array';
      const original = values[0]!, canonical = values[1]!, node = values[2]!;
      if (!node) throw new Error('registry target missing');
      if (previous && (Buffer.compare(Buffer.from(previous[0]), Buffer.from(encoding)) > 0 || previous[0] === encoding && Buffer.compare(Buffer.from(previous[1]), Buffer.from(original)) >= 0)) throw new Error('registry order/duplicate');
      previous = [encoding, original];
      const alias = {namespace: ns.id, encoding, original, canonical, node};
      if (normalizeAlias(alias, ns, budget) !== canonical) throw new Error('registry normalization');
      const normalized = encoding === 'token' ? JSON.stringify([canonical]) : canonical;
      if (resolved.has(normalized) && resolved.get(normalized) !== node) throw new Error('registry conflicting targets');
      resolved.set(normalized, node); targets.add(node);
      if (ns.entity_kind === 'unit') s.aliases.push(alias);
    }
    if (ns.entity_kind === 'unit') {
      const nodes = s.graph.nodes.filter(n => n.namespace === ns.id), nodeMap=new Map(nodes.map(n=>[n.id,n]));
      if (nodes.some(n => !targets.has(n.id)) || [...targets].some(id => nodeMap.get(id)?.level !== ns.level)) throw new Error('registry graph coverage');
    }
    entities.set(ns.id, resolved);
  }
  // Inline validation in the resolver now checks the actual collision spellings, not a descriptor.
  s.alias_registries = s.alias_registries.filter(r => s.namespaces.find(n => n.id === r.namespace)!.entity_kind !== 'unit');
  return {structure: s, entities};
}

// All unit equality, resolution, closure and partition propagation live here. Wire node
// IDs are references, never identities. JSON tuples make each key unambiguous.
const key = JSON.stringify;
type Layer = 'public' | 'private';
type Namespace = ContractStructure['namespaces'][number];
type Node = ContractStructure['graph']['nodes'][number];

/** Linear forest indexing, including sibling branches (depth alone is insufficient). */
export function hierarchyIndex(s: ContractStructure) {
  const levels = new Map(s.unit_hierarchy.map(l => [l.id, l]));
  const children = new Map<string, string[]>();
  const errors: string[] = [];
  for (const l of levels.values()) if (l.coarser_level !== null) {
    if (!levels.has(l.coarser_level)) errors.push('unknown coarser level');
    const list = children.get(l.coarser_level) ?? []; list.push(l.id); children.set(l.coarser_level, list);
  }
  const start = new Map<string, number>(), end = new Map<string, number>();
  let clock = 0;
  const stack: [string, boolean][] = [...levels.values()].filter(l => l.coarser_level === null).map(l => [l.id, false]);
  while (stack.length) {
    const [id, done] = stack.pop()!;
    if (done) { end.set(id, clock++); continue; }
    if (start.has(id)) continue;
    start.set(id, clock++); stack.push([id, true]);
    for (const child of children.get(id) ?? []) stack.push([child, false]);
  }
  if (start.size !== levels.size) errors.push('cyclic unit hierarchy');
  const coarser = (from: string, to: string) => start.has(from) && start.has(to) && start.get(to)! < start.get(from)! && end.get(from)! < end.get(to)!;
  const floor = s.unit_hierarchy.find(l => l.minimum_independent)?.id;
  const allowed = new Set([...levels.keys()].filter(l => l === floor || (floor !== undefined && coarser(floor, l))));
  return { errors, coarser, floor, allowed };
}

export class IdentityResolver {
  readonly errors: string[] = [];
  readonly hierarchy: ReturnType<typeof hierarchyIndex>;
  private readonly structures: Partial<Record<Layer, ContractStructure>>;
  private readonly namespaces = new Map<string, Namespace>();
  private readonly nodes = new Map<string, Node>();
  private readonly nodeIdentities = new Map<string,string>();
  private readonly refs = {public:new Map<string,string>(),private:new Map<string,string>()};
  private readonly indices = new Map<string, number>();
  private readonly parents: number[] = [];
  private readonly sizes: number[] = [];
  private readonly names: string[] = [];
  private readonly keys: string[] = [];
  private readonly declarations = new Map<string, string>();
  private readonly coverage = new Set<string>();
  private readonly down = new Map<string, string[]>();
  private readonly hasFloor = new Set<string>();
  readonly unicodeBudget = new UnicodeBudget();
  private readonly publicView?: IdentityResolver;
  private privateView?: IdentityResolver;
  private readonly floorNames = new Map<string, string>();
  private readonly commitments = new Map<string, {identity_scope: string; identity_key: string}>();
  private readonly materialNames = new Map<string, string>();
  private readonly namespaceRoots = new Map<string, Set<string>>();
  private readonly memo = new Map<string, string>();
  private readonly levelMemo = new Map<string, string>();
  private ref(layer: Layer, id: string) { let value=this.refs[layer].get(id); if(value===undefined){value=key([layer,id]);this.refs[layer].set(id,value);}return value; }
  private require(ok: unknown, message: string) { if (!ok) { if(this.errors.length >= 100) throw new Error(`identity error limit: ${this.errors[0]}`); this.errors.push(message); } }
  private add(k: string) {
    if (!this.indices.has(k)) { const i=this.parents.length; this.indices.set(k,i); this.parents.push(i); this.sizes.push(1); this.names.push(k); this.keys.push(k); }
    return k;
  }
  private find(i: number): number {
    let r=i; while(this.parents[r] !== r) r=this.parents[r]!;
    while(this.parents[i] !== r) { const next=this.parents[i]!; this.parents[i]=r; i=next; }
    return r;
  }
  private root(k: string): string { k=this.nodeIdentities.get(k) ?? k; const i=this.indices.get(k); return i === undefined ? k : this.keys[this.find(i)]!; }
  private canonical(k: string): string { k=this.nodeIdentities.get(k) ?? k; const i=this.indices.get(k); if(i===undefined)throw new Error('unknown unit identity'); return this.names[this.find(i)]!; }
  private union(left: string, right: string) {
    left=this.nodeIdentities.get(left) ?? left; right=this.nodeIdentities.get(right) ?? right;
    if(left===right){this.add(left);return;}
    this.add(left); this.add(right);
    let a=this.find(this.indices.get(left)!), b=this.find(this.indices.get(right)!); if(a===b)return;
    if(this.sizes[a]! < this.sizes[b]!) [a,b]=[b,a];
    this.parents[b]=a; this.sizes[a]=this.sizes[a]!+this.sizes[b]!;
    if(this.names[b]! < this.names[a]!) this.names[a]=this.names[b]!;
  }
  private normalized(layer: Layer, namespace: string, raw: string, encoding: 'token' | 'canonical-json-array' = 'token') {
    const ns = this.namespaces.get(this.ref(layer, namespace));
    if (!ns) throw new Error('unknown identity namespace');
    const cacheKey = key([layer, namespace, encoding, raw]);
    let value = this.memo.get(cacheKey);
    if (value === undefined) {
      value = encoding === 'token' ? key([normalizeIdentifier(raw, ns, this.unicodeBudget)]) : normalizeAlias({ namespace, encoding, original: raw, canonical: '', node: '' }, ns, this.unicodeBudget);
      this.memo.set(cacheKey, value);
    }
    return value;
  }
  private bind(layer: Layer, namespace: string, raw: string, node: string, encoding: 'token' | 'canonical-json-array' = 'token', resolvable = true) {
    const normalized = this.normalized(layer, namespace, raw, encoding);
    const ns = this.namespaces.get(this.ref(layer, namespace))!;
    // All accepted namespaces at one level share the same normalization rules.
    // A level-qualified canonical tuple therefore also closes cross-namespace cells.
    const identity = this.add(key(['identity', ns.level, normalized]));
    const ref=this.ref(layer,node); if(!this.nodeIdentities.has(ref))this.nodeIdentities.set(ref,identity);
    this.union(identity, ref);
    if (resolvable) this.declarations.set(key([layer, namespace, normalized]), this.ref(layer, node));
  }
  constructor(publicS: ContractStructure, privateS?: ContractStructure) {
    if (privateS) this.publicView = new IdentityResolver(publicS);
    this.structures = { public: publicS, ...(privateS ? { private: privateS } : {}) };
    this.hierarchy = hierarchyIndex(publicS);
    if (privateS) {
      this.require(stableJson(publicS.unit_hierarchy) === stableJson(privateS.unit_hierarchy), 'private identity declarations disagree');
      const publicNs = new Map(publicS.namespaces.map(n => [n.id, n]));
      for (const ns of privateS.namespaces) if (publicNs.has(ns.id)) this.require(stableJson({...publicNs.get(ns.id),rules:[...publicNs.get(ns.id)!.rules].sort()}) === stableJson({...ns,rules:[...ns.rules].sort()}), 'private identity declarations disagree');
      for (const field of ['replicate_groups', 'partitions'] as const) {
        const records = new Map(publicS[field].map(r => [r.id, stableJson(r)]));
        for (const r of privateS[field]) if (records.has(r.id)) this.require(records.get(r.id) === stableJson(r), 'private identity declarations disagree');
      }
    }
    const ruleSets = new Map<string,string>();
    for (const layer of ['public', 'private'] as const) {
      const s = this.structures[layer]; if (!s) continue;
      const namespaces = new Map(s.namespaces.map(n => [n.id, n]));
      const nodes = new Map(s.graph.nodes.map(n => [n.id, n]));
      for (const ns of s.namespaces) {
        this.namespaces.set(this.ref(layer, ns.id), ns);
        if (ns.entity_kind === 'unit' && ns.level) {
          const signature=key([...ns.rules].sort());
          this.require(!ruleSets.has(ns.level) || ruleSets.get(ns.level) === signature, 'same-level namespace normalization rules disagree');ruleSets.set(ns.level,signature);
        }
      }
      const registryNamespaces = new Set(s.alias_registries.map(r => r.namespace));
      const originalNodes = new Map<string, string>();
      for (const n of s.graph.nodes) {
        this.nodes.set(this.ref(layer, n.id), n);
        if (namespaces.has(n.namespace)) {
          const originalKey = key([n.namespace,this.normalized(layer,n.namespace,n.original_id)]);
          this.require(!originalNodes.has(originalKey), 'duplicate node canonical identity'); originalNodes.set(originalKey,n.id);
          this.bind(layer, n.namespace, n.original_id, n.id, 'token', registryNamespaces.has(n.namespace));
        }
        if (layer === 'private' && this.nodes.has(this.ref('public', n.id))) {
          this.require(stableJson(this.nodes.get(this.ref('public', n.id))) === stableJson(n), 'private identity declarations disagree');
          this.union(this.ref('public', n.id), this.ref(layer, n.id));
        }
      }
      const groups = new Map<string, typeof s.aliases>();
      const aliasOriginals = new Set<string>();
      for (const a of s.aliases) {
        const ns = namespaces.get(a.namespace), n = nodes.get(a.node);
        this.require(ns?.entity_kind === 'unit' && n?.namespace === a.namespace && n?.level === ns.level, 'alias node namespace/level mismatch');
        if (!ns || !n) { this.require(false, 'unknown alias namespace/node'); continue; }
        if (layer === 'private') {
          const publicTarget = this.declarations.get(key(['public',a.namespace,this.normalized(layer,a.namespace,a.original,a.encoding)]));
          const publicNode = publicTarget && this.nodes.get(publicTarget);
          if (publicNode) this.require(this.normalized(layer,a.namespace,publicNode.original_id) === this.normalized(layer,a.namespace,n.original_id), 'private identity declarations disagree');
        }
        const originalKey = key([a.namespace, a.encoding, a.original]);
        this.require(!aliasOriginals.has(originalKey), 'duplicate alias original'); aliasOriginals.add(originalKey);
        const normalized = this.normalized(layer, a.namespace, a.original, a.encoding);
        this.require(normalized === (a.encoding === 'token' ? key([a.canonical]) : a.canonical), 'alias canonical value disagrees with namespace rules');
        const gkey = key([a.namespace, normalized]); const list = groups.get(gkey) ?? []; list.push(a); groups.set(gkey, list);
        this.bind(layer, a.namespace, a.original, a.node, a.encoding); this.coverage.add(this.ref(layer, a.namespace));
      }
      const merges = new Map<string, ContractStructure['collision_merges'][number]>();
      const registries = new Set(s.alias_registries.map(r => r.namespace));
      for (const r of s.alias_registries) this.coverage.add(this.ref(layer, r.namespace));
      for (const m of s.collision_merges) {
        const ns = namespaces.get(m.namespace), n = nodes.get(m.merged_node);
        this.require(ns?.entity_kind === 'unit' && n?.namespace === m.namespace && m.originals.length >= 2, 'invalid registry collision merge');
        if (!ns || !n) continue;
        const canonical = this.normalized(layer, m.namespace, m.canonical, m.encoding), gkey = key([m.namespace, canonical]);
        this.require(canonical === (m.encoding === 'token' ? key([m.canonical]) : m.canonical), 'collision merge canonical must be a normalization fixed point');
        this.require(!merges.has(gkey), 'duplicate collision merge'); merges.set(gkey, m);
        for (const original of m.originals) {
          this.require(this.normalized(layer, m.namespace, original, m.encoding) === canonical, 'registry collision normalization mismatch');
          this.bind(layer, m.namespace, original, m.merged_node, m.encoding);
        }
        // Multi-column registry tuples need byte-level target verification by K1b.
        if (registries.has(m.namespace) && (JSON.parse(canonical) as string[]).length === 1)
          this.require(canonical === this.normalized(layer, m.namespace, n.original_id), 'orphan collision merge');
        if (!registries.has(m.namespace)) this.require((groups.get(gkey)?.length ?? 0) > 1, 'orphan collision merge');
      }
      for (const [gkey, aliases] of groups) {
        this.require(new Set(aliases.map(a => a.node)).size === 1, 'ambiguous token/tuple aliases must share merged node');
        const spellings = [...new Set(aliases.map(a => a.encoding === 'token' ? key([a.original]) : a.original))].sort();
        if (spellings.length > 1) {
          const m = merges.get(gkey);
          this.require(m && m.merged_node === aliases[0]!.node && key(m.originals.map(o => m.encoding === 'token' ? key([o]) : o).sort()) === key(spellings), 'collision requires exact merge record with limitation');
        }
      }
    }
    // Snapshot identity-only equivalence before material/dependence closure.
    for (const ref of this.nodes.keys()) this.materialNames.set(ref, this.canonical(ref));
    this.checkMaterialAncestry();
    const children = new Map<string, string[]>(), collapsed: string[] = [];
    for (const layer of ['public', 'private'] as const) {
      const s = this.structures[layer]; if (!s) continue;
      for (const e of s.graph.edges) {
        const a = this.ref(layer, e.from), b = this.ref(layer, e.to), target = this.nodes.get(b);
        const list = children.get(b) ?? []; list.push(a); children.set(b, list);
        if (e.relation === 'sample-of' || e.relation === 'derived-from' || e.relation === 'dependent-with' || (target && (!this.hierarchy.allowed.has(target.level) || target.level === this.hierarchy.floor))) this.union(a, b);
      }
      // Both technical sameness and declared biological dependence constrain partitions.
      for (const g of s.replicate_groups) {
        for (const id of g.members) { this.union(this.ref(layer, g.members[0]!), this.ref(layer, id)); collapsed.push(this.ref(layer, id)); }
      }
    }
    const visited = new Set<string>();
    for (let i = 0; i < collapsed.length; i++) {
      const id = collapsed[i]!; if (visited.has(id)) continue; visited.add(id);
      for (const child of children.get(id) ?? []) { this.union(id, child); collapsed.push(child); }
    }
    const up = new Map<string, string[]>();
    for (const [parent, childrenOf] of children) for (const child of childrenOf) {
      const a = this.root(parent), b = this.root(child); if (a === b) continue;
      if (!this.down.has(a)) this.down.set(a, []); this.down.get(a)!.push(b);
      if (!up.has(b)) up.set(b, []); up.get(b)!.push(a);
    }
    for (const [id, n] of this.nodes) if (n.level === this.hierarchy.floor) this.hasFloor.add(this.root(id));
    const queue = [...this.hasFloor];
    for (let i = 0; i < queue.length; i++) for (const parent of up.get(queue[i]!) ?? []) if (!this.hasFloor.has(parent)) { this.hasFloor.add(parent); queue.push(parent); }
    for (const [ref, n] of this.nodes) {
      const root = this.root(ref), layer: Layer = this.refs.public.get(n.id) === ref ? 'public' : 'private';
      const nsRef = this.ref(layer, n.namespace), roots = this.namespaceRoots.get(nsRef) ?? new Set<string>();
      roots.add(root); this.namespaceRoots.set(nsRef, roots);
      if (n.level === this.hierarchy.floor && (!privateS || layer === 'public')) {
        const name = this.normalized(layer, n.namespace, n.original_id);
        if (!this.floorNames.has(root) || name < this.floorNames.get(root)!) this.floorNames.set(root, name);
      }
    }
  }
  /** Registry declarations resolve known graph originals/merges only. Unknown registry
   * rows need K1b's verified contents; a declaration is never a successful lookup. */
  resolve(layer: Layer, namespace: string, raw: string, encoding: 'token' | 'canonical-json-array' = 'token'): string {
    const k = this.declarations.get(key([layer, namespace, this.normalized(layer, namespace, raw, encoding)]));
    if (!k) throw new Error('unresolved unit identity');
    return this.canonical(k);
  }
  /** Non-unit registry lookup shares exactly the same namespace normalization and budget. */
  resolveEntity(layer: Layer, namespace: string, raw: string, encoding: 'token' | 'canonical-json-array', registries: ReadonlyMap<string, ReadonlyMap<string,string>>): string {
    const ns = this.namespaces.get(this.ref(layer, namespace));
    if (!ns) throw new Error('unknown entity namespace');
    if (ns.entity_kind === 'unit') return this.resolve(layer, namespace, raw, encoding);
    const target = registries.get(namespace)?.get(this.normalized(layer, namespace, raw, encoding));
    if (target === undefined) throw new Error('unresolved registry entity');
    return key([ns.entity_kind, namespace, target]);
  }
  /** Resolve a row identity at an explicitly requested coarser level. Never infer from columns. */
  atLevel(layer: Layer, identity: string, level: string): string {
    if (!this.hierarchy.allowed.has(level)) throw new Error('unit below independence floor');
    const memoKey=key([layer,identity,level]),cached=this.levelMemo.get(memoKey);if(cached)return cached;
    if(level===this.hierarchy.floor){
      for(const n of this.structures[layer]!.graph.nodes)if(n.level===level){const value=this.nodeKey(layer,n.id);this.levelMemo.set(key([layer,value,level]),value);}
      const value=this.levelMemo.get(memoKey);if(value)return value;
    }
    const candidates = new Set<string>();
    const s = this.structures[layer]!;
    for (const n of s.graph.nodes) if (n.level === level) {
      const target = this.nodeKey(layer,n.id);
      if (target === identity) candidates.add(target);
      else {
        const queue = [this.root(this.ref(layer,n.id))], seen = new Set<string>();
        for (let i=0;i<queue.length;i++) {
          if(i>100_000)throw new Error('coarsening work limit');
          const current=queue[i]!;if(seen.has(current))continue;seen.add(current);
          if(this.canonical(current)===identity)candidates.add(target);
          queue.push(...this.down.get(current)??[]);
        }
      }
    }
    if(candidates.size!==1)throw new Error('unit has ambiguous or missing coarser mapping');
    const value=[...candidates][0]!;this.levelMemo.set(memoKey,value);return value;
  }
  nodeKey(layer: Layer, node: string): string {
    const ref = this.ref(layer, node); if (!this.nodes.has(ref)) throw new Error('unknown unit identity');
    return this.canonical(ref);
  }
  /** Floor-pinned public originals; aliases and sub-floor material never choose names. */
  commitment(layer: Layer, node: string): {identity_scope: string; identity_key: string} {
    if (layer === 'public' && this.publicView) return this.publicView.commitment(layer, node);
    const ref = this.ref(layer, node);
    if (!this.nodes.has(ref)) throw new Error('unknown unit identity');
    const root = this.root(ref);
    let result = this.commitments.get(root);
    if (!result) {
      const covered = this.coveredFloorIdentities(layer, node);
      if (!covered.length) throw new Error('partition unit has no public floor identity');
      result = {identity_scope: this.hierarchy.floor!, identity_key: covered.length === 1 ? covered[0]! : key(covered)};
      this.commitments.set(root, result);
    }
    return result;
  }
  coveredFloorIdentities(layer: Layer, node: string): string[] {
    if (layer === 'public' && this.publicView) return this.publicView.coveredFloorIdentities(layer, node);
    const queue = [this.root(this.ref(layer,node))], seen = new Set<string>(), names = new Set<string>();
    for (let i=0;i<queue.length;i++) {
      if (i > 100_000) throw new Error('floor coverage work limit');
      const r=queue[i]!; if(seen.has(r))continue;seen.add(r);
      const name=this.floorNames.get(r); if(name !== undefined)names.add(name);
      for(const child of this.down.get(r) ?? [])queue.push(child);
    }
    return [...names].sort();
  }
  private checkMaterialAncestry(): void {
    const children = new Map<string,string[]>(), descendants = new Map<string,Set<string>>();
    const material = (layer: Layer, id: string) => this.materialNames.get(this.ref(layer,id)) ?? this.ref(layer,id);
    for (const layer of ['public','private'] as const) {
      const s=this.structures[layer]; if(!s)continue;
      for(const n of s.graph.nodes) if(n.kind === 'donor/subject')
        this.require(n.level === this.hierarchy.floor || (!!this.hierarchy.floor && this.hierarchy.coarser(n.level,this.hierarchy.floor)), 'independence floor cannot be below or on a sibling branch of a donor/subject');
      for(const e of s.graph.edges) {
        const source=this.nodes.get(this.ref(layer,e.from)), target=this.nodes.get(this.ref(layer,e.to));
        if(source && source.level === this.hierarchy.floor && target && (source.kind === 'specimen/sample' || (this.hierarchy.coarser(source.level,target.level) && ['donor/subject','randomization-unit','dependence-cluster'].includes(target.kind))))
          this.require(false,'independence floor cannot be below declared specimen ancestry or assignment target');
        const parent=material(layer,e.to),list=children.get(parent) ?? [];list.push(material(layer,e.from));children.set(parent,list);
      }
    }
    let work=0;
    for (const layer of ['public','private'] as const) for(const g of this.structures[layer]?.replicate_groups ?? []) {
      const parent=material(layer,g.grouping_node);
      this.require(!g.members.some(id=>material(layer,id)===parent),'grouping node cannot be a replicate member');
      let below=descendants.get(parent);
      if(!below){below=new Set();const queue=[parent];for(let i=0;i<queue.length;i++)for(const child of children.get(queue[i]!) ?? []){
        if(++work>100_000)throw new Error('replicate ancestry work limit');
        if(!below.has(child)){below.add(child);queue.push(child);}
      }descendants.set(parent,below);}
      this.require(g.members.every(id=>below.has(material(layer,id))), 'replicate grouping node must be an ancestor of every member');
    }
  }
  resolvable(layer: Layer, namespace: string): boolean {
    return this.coverage.has(this.ref(layer, namespace));
  }
  floorCovered(layer: Layer, node: string): boolean { return this.hasFloor.has(this.root(this.ref(layer, node))); }
  compatibleNamespaces(layer: Layer, left: string | null | undefined, right: string | null | undefined): boolean {
    if (!left || !right) return false;
    const a=this.namespaces.get(this.ref(layer,left)), b=this.namespaces.get(this.ref(layer,right));
    if(!a || !b || a.entity_kind !== b.entity_kind || a.level !== b.level)return false;
    if(left===right)return true;
    const x=this.namespaceRoots.get(this.ref(layer,left)), y=this.namespaceRoots.get(this.ref(layer,right));
    return !!x?.size && !!y?.size && x.size===y.size && [...x].every(r=>y.has(r));
  }
  amendmentErrors(before: Partition[], after: Partition[], amendment: PostLookAmendment): string[] {
    const errors = this.partitionErrors([
      ...before.map(partition=>({layer:'public' as const,partition})),
      ...after.map(partition=>({layer:'private' as const,partition})),
    ]);
    const require=(ok:unknown,message:string)=>{if(!ok)errors.push(message);};
    const identity=(layer:Layer,id:string)=>{this.nodeKey(layer,id);return this.root(this.ref(layer,id));};
    const unique=(layer:Layer,ids:string[])=>{const keys=ids.map(id=>identity(layer,id));const sourceKeys=ids.map(id=>this.publicView?.nodeKey(layer,id) ?? this.nodeKey(layer,id));require(new Set(sourceKeys).size===sourceKeys.length,'amendment double-counts one resolved unit');return keys;};
    const removals=new Map<string,Set<string>>(), coarsened=new Map<string,string>();
    const descendants=new Map<string,Set<string>>();let work=0;
    const covers=(parent:string,child:string)=>{
      let covered=descendants.get(parent);if(!covered){covered=new Set([parent]);const queue=[parent];for(let i=0;i<queue.length;i++)for(const next of this.down.get(queue[i]!) ?? []){
        if(++work>100_000)throw new Error('amendment coverage work limit');if(!covered.has(next)){covered.add(next);queue.push(next);}
      }descendants.set(parent,covered);}return covered.has(child);
    };
    for(const change of amendment.changes){
      if(change.kind==='remove-held-out-units'){
        const keys=unique('public',change.nodes), old=before.find(p=>p.id===change.partition_id), next=after.find(p=>p.id===change.partition_id);
        require(old && next,'amendment removal references unknown partition');
        const oldUnits=new Map(old?.units.map(u=>[identity('public',u.node),u]));
        const nextUnits=new Map(next?.units.map(u=>[identity('private',u.node),u]));
        const removed=removals.get(change.partition_id) ?? new Set<string>();
        for(const k of keys){require(!removed.has(k),'amendment double-counts one resolved unit');removed.add(k);
          require(oldUnits.get(k)?.allocation==='held-out','amendment may remove only held-out units');
          require(!nextUnits.has(k) || nextUnits.get(k)?.allocation==='excluded','removed held-out unit remains allocated');
        }removals.set(change.partition_id,removed);
      }else if(change.kind==='coarsen-units')for(const merge of change.merges){
        const sources=unique('public',merge.from_nodes), targetKey=identity('private',merge.to_node);const target=this.nodes.get(this.ref('private',merge.to_node));
        for(const source of sources){require(!coarsened.has(source),'amendment double-counts one resolved unit');coarsened.set(source,targetKey);require(covers(targetKey,source),'amendment coarsening target must cover every source');}
        require(target?.level===merge.coarser_level,'amendment coarsening target level mismatch');
        for(const id of merge.from_nodes){const source=this.nodes.get(this.ref('public',id));require(source && target && this.hierarchy.coarser(source.level,target.level),'amendment must strictly coarsen units');}
      }else for(const group of change.groups){unique('public',group.members);identity('private',group.grouping_node);}
    }
    for(const p of before){
      const next=after.find(q=>q.id===p.id), nextKeys=new Set(next?.units.map(u=>identity('private',u.node)));
      for(const u of p.units)require(nextKeys.has(identity('public',u.node)) || nextKeys.has(coarsened.get(identity('public',u.node)) ?? '') || removals.get(p.id)?.has(identity('public',u.node)), 'amendment removes an undeclared or non-held-out unit');
    }
    return errors;
  }
  partitionErrors(snapshots: { layer: Layer; partition: Partition }[]): string[] {
    const errors: string[] = [];
    const require = (ok: unknown, why: string) => { if (!ok && errors.length < 100) errors.push(why); };
    const allocations = new Map<string, number>(), burns = new Map<string, number>();
    const queue: string[] = [], pending = new Set<string>();
    const histories = new Map<string, {order:number; hashes:Set<string>}[]>();
    let historyWork = 0;
    const add = (id: string, mask: number, burn: number) => {
      const a = allocations.get(id) ?? 0, b = burns.get(id) ?? 0;
      if ((a | mask) === a && (b | burn) === b) return;
      allocations.set(id, a | mask); burns.set(id, b | burn);
      if (!pending.has(id)) { pending.add(id); queue.push(id); }
    };
    for (const [order, { layer, partition: p }] of snapshots.entries()) {
      require(this.hierarchy.allowed.has(p.unit_level), 'partition level must be at or above minimum independent floor');
      const seen = new Set<string>();
      for (const u of p.units) {
        const ref = this.ref(layer, u.node), n = this.nodes.get(ref);
        require(n?.level === p.unit_level, 'partition unit level mismatch'); if (!n) continue;
        if (!this.hasFloor.has(this.root(ref))) { require(false, 'partition unit has no floor identity'); continue; }
        // Each sealed snapshot commits in its own identity view; joint closure still
        // enforces all private merges without leaking their spellings into public L2.
        if(layer === 'private' && this.publicView && !this.privateView)this.privateView=new IdentityResolver(this.structures.private!);
        const canonical=layer === 'private' && this.privateView ? this.privateView.commitment('public',u.node) : this.commitment(layer,u.node);
        require(u.identity_scope === canonical.identity_scope && u.identity_key === canonical.identity_key, 'partition identity must be canonical');
        const root = this.root(ref);
        require(!seen.has(root), 'duplicate partition global identity'); seen.add(root);
        require(this.hasFloor.has(root), 'partition unit has no floor identity');
        const mask = u.allocation === 'dev' ? 1 : u.allocation === 'held-out' ? 2 : 0;
        add(root, mask, u.burn.status === 'unseen' ? 1 : 2);
        if (u.burn.status === 'burned') {
          const current = new Set(u.burn.look_record_hashes), targets = [root], visited = new Set<string>();
          for (let i = 0; i < targets.length; i++) {
            if (++historyWork > 100_000) throw new Error('burn history work limit');
            const target = targets[i]!; if (visited.has(target)) continue; visited.add(target);
            const list = histories.get(target) ?? []; list.push({order,hashes:current}); histories.set(target,list);
            for (const child of this.down.get(target) ?? []) targets.push(child);
          }
        }
      }
    }
    for (let i = 0; i < queue.length; i++) {
      const id = queue[i]!; pending.delete(id);
      for (const child of this.down.get(id) ?? []) add(child, allocations.get(id)!, burns.get(id)!);
    }
    for (const list of histories.values()) {
      list.sort((a,b) => a.order-b.order);
      for (let i=1;i<list.length;i++) for (const h of list[i-1]!.hashes) {
        if (++historyWork > 100_000) throw new Error('burn history work limit');
        require(list[i]!.hashes.has(h), 'burn history cannot shrink across snapshots');
      }
    }
    require(![...allocations.values()].includes(3), 'partition dev/held-out share floor identity or allocation changes across snapshots');
    require(![...burns.values()].includes(3), 'unit burn status inconsistent across partitions');
    return errors;
  }
}
