import { DatabaseSync } from 'node:sqlite';
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { contentHash, deriveSeed, digest, equal, fail, hash, json, key, mac, text, tuple } from './primitives.ts';
import { validatePartitionArtifact, type PublicLayer, type PrivateLayer, type PublicEnvelope, type PartitionArtifact } from '../../omb-contract/src/index.ts';
import { exposureSnapshot, identityKey, priorFor, stickyAllocation, type ExposureCandidate } from './exposure.ts';
import { contractIdentities, uniqueIdentities } from './identities.ts';
import { planFrom } from './apply-plan.ts';
import { familyKey, lordThreshold } from './alpha.ts';
import type { AlphaFamily, AlphaReservation, AlphaResult, AmendmentDecision, AmendmentSubmission, Attempt, Claim, ContentTuple, DevSchemaView, GateFiring, Hypothesis, LockRecord, LockTimeline, Look, PartitionCommitment, PriorExposure, PreLookLock, StoreEvent, UnitIdentity } from './types.ts';

export type FaultPoint = 'before-commit' | 'after-commit' | 'before-look-fsync' | 'after-look-fsync';
export interface StoreCheckpoint { sequence: number; hash: string | null; authorityMac: string }
export interface StoreOptions { separation?: Look['separation']; integrityCheckEvery?: number; minimumCheckpoint?: StoreCheckpoint; root: string; hostKey: Uint8Array; now: () => number; faultAt?: (point: FaultPoint) => void; alpha?: number; initialWealth?: number; busyTimeoutMs?: number }
const stages = ['L0-source-lock', 'L1-contract-lock', 'L2-partition-lock', 'L3-schema-view', 'L4-plan-lock', 'L5-training', 'L6-look-record'];
const kinds = new Set(['artifact', 'lock', 'partition', 'probe', 'look', 'attempt', 'claim', 'hypothesis', 'gate', 'amendment', 'identity-merge', 'alpha-reserve', 'alpha-result', 'settings', 'resolution']);
function payloads<T>(events: StoreEvent[], kind: string): T[] { return events.filter(e => e.kind === kind).map(e => e.payload as T); }
function identity(i: UnitIdentity): string {
  text(i.scope); text(i.key);
  let components: unknown;
  try { components = JSON.parse(i.key); } catch { fail('canonical identity tuple required'); }
  if (!/^[A-Za-z][A-Za-z0-9_.:-]*$/.test(i.scope) || !Array.isArray(components) || !components.length || components.some(c => typeof c !== 'string' || !c.length) || JSON.stringify(components) !== i.key) fail('canonical identity tuple required');
  return json([i.scope, i.key]);
}
function timeline(events: StoreEvent[], datasetId: string): LockTimeline {
  return events.flatMap(e => {
    if (e.kind !== 'lock' && e.kind !== 'look') return [];
    const p = e.payload as { datasetId: string; record: LockRecord; hash: string };
    return p.datasetId === datasetId ? [{ record: p.record, hash: p.hash }] : [];
  });
}
function pins(t: LockTimeline): Record<string, unknown> { return Object.assign({}, ...t.map(e => e.record)); }
/** Host-only event-sourced store. SQLite serializes writers per short transaction;
 * no run-long lease. No worker is permitted to open this database or hold its key.
 */
export class OmbStore {
  readonly databasePath: string;
  #db: DatabaseSync;
  #key: Buffer;
  #domain: string;
  #options: StoreOptions;
  #seen = 0;
  #seenHash: string | null = null;
  #closed = false;
  #checks = 0;
  #physicalFiles = new Map<string, string>();
  #exposureMembers = new Map<string, UnitIdentity[][]>();
  #integrityCheckEvery: number;
  constructor(options: StoreOptions) {
    this.#key = key(options.hostKey); this.#options = options;
    this.#integrityCheckEvery = options.integrityCheckEvery ?? 16;
    if (!Number.isSafeInteger(this.#integrityCheckEvery) || this.#integrityCheckEvery < 1 || this.#integrityCheckEvery > 16) fail('invalid integrity check interval');
    mkdirSync(options.root, { recursive: true, mode: 0o700 });
    if (lstatSync(options.root).isSymbolicLink()) fail('symlink state root refused');
    this.databasePath = join(realpathSync(options.root), 'store.sqlite');
    this.#domain = mac(this.#key, 'omb-store/root/v1', realpathSync(options.root));
    const existed = existsSync(this.databasePath);
    if (existed && !lstatSync(this.databasePath).isFile()) fail('invalid database path');
    for (const suffix of ['', '-wal', '-shm']) if (existsSync(this.databasePath + suffix) && lstatSync(this.databasePath + suffix).isSymbolicLink()) fail('symlink database refused');
    if (!existed) { const fd = openSync(this.databasePath, 'wx', 0o600); closeSync(fd); }
    const timeout = options.busyTimeoutMs ?? 250;
    if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 60_000) fail('invalid busy timeout');
    this.#db = new DatabaseSync(this.databasePath, { timeout });
    try {
      this.#integrityCheck();
      this.#db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF;');
      const separation = options.separation ?? 'single-user';
      if (!['single-user', 'os-users'].includes(separation)) fail('unknown store separation');
      const alpha = options.alpha ?? 0.05, w0 = options.initialWealth ?? alpha / 2;
      lordThreshold(1, [], alpha, w0);
      this.#write((events, append) => {
        const settings = payloads<{ alpha: number; w0: number; version: number; separation: Look['separation'] }>(events, 'settings');
        if (events.length === 0) append('settings', { alpha, w0, version: 4, separation });
        else if (settings.length !== 1 || settings[0]!.alpha !== alpha || settings[0]!.w0 !== w0 || settings[0]!.version !== 4 || settings[0]!.separation !== separation) fail('missing or changed store policy');
      }, true);
      // Creation policy must survive loss of subsequent WAL frames. A restored
      // older database still requires the external checkpoint, as documented.
      this.#db.exec('PRAGMA wal_checkpoint(FULL)');
      this.#sync();
    } catch (e) { this.#db.close(); this.#key.fill(0); throw e; }
  }
  #headMac(sequence: number, hash: string | null): string {
    // Every physical row, including autoindexes and root pages, is authenticated.
    // There is deliberately no LIKE filter ("_" would be a wildcard).
    return mac(this.#key, 'omb-store/head/v2', [this.#domain, sequence, hash, this.#db.prepare('SELECT type,name,tbl_name,rootpage,sql FROM sqlite_schema ORDER BY name').all()]);
  }
  #integrityCheck(): void {
    // Raw keyless writes need not update SQLite's change counter. Evict clean
    // cached pages so a long-lived connection checks physical bytes again.
    this.#db.exec('PRAGMA shrink_memory');
    const check = this.#db.prepare('PRAGMA integrity_check').all();
    if (check.length !== 1 || check[0]!.integrity_check !== 'ok') fail('SQLite integrity_check failed');
  }
  #verify(): StoreEvent[] {
    if (this.#closed) fail('store closed');
    // SQLite may continue reading an unlinked WAL through its open descriptor.
    // A live store must not silently authenticate a file the next opener cannot see.
    for (const suffix of ['', '-wal', '-shm']) {
      const path = this.databasePath + suffix, prior = this.#physicalFiles.get(path);
      if (!existsSync(path)) { if (prior) fail('store physical file deleted'); continue; }
      const stat = lstatSync(path), current = `${stat.dev}:${stat.ino}`;
      if (!stat.isFile() || (prior && prior !== current)) fail('store physical file replaced');
      this.#physicalFiles.set(path, current);
    }
    if (++this.#checks >= this.#integrityCheckEvery) { this.#checks = 0; this.#integrityCheck(); }
    const rows = this.#db.prepare('SELECT * FROM events ORDER BY sequence').all();
    const events: StoreEvent[] = [];
    let prev: string | null = null, time = 0;
    for (const row of rows) {
      const e: StoreEvent = { sequence: Number(row.sequence), time: Number(row.time), kind: String(row.kind), payload: JSON.parse(String(row.payload)), previousHash: row.previous_hash as string | null, hash: String(row.hash), authorityMac: String(row.authority_mac) };
      const expected = contentHash({ sequence: e.sequence, time: e.time, kind: e.kind, payload: e.payload, previousHash: e.previousHash });
      if (e.sequence !== events.length + 1 || !Number.isSafeInteger(e.time) || e.time < time || e.previousHash !== prev || !kinds.has(e.kind) || String(row.payload) !== json(e.payload) || !equal(e.hash, expected) || !equal(e.authorityMac, mac(this.#key, 'omb-store/event/v1', [this.#domain, e.hash]))) fail('event chain or authority MAC mismatch');
      events.push(e); prev = e.hash; time = e.time;
    }
    const heads = this.#db.prepare('SELECT * FROM head').all(), h = heads[0];
    if (heads.length !== 1 || !h || h.sequence !== events.length || h.hash !== prev || !equal(String(h.authority_mac), this.#headMac(events.length, prev))) fail('head mismatch or truncated chain');
    if (events.length < this.#seen || (this.#seen > 0 && events[this.#seen - 1]?.hash !== this.#seenHash)) fail('store rollback detected');
    const checkpoint = this.#options.minimumCheckpoint;
    if (checkpoint && (!Number.isSafeInteger(checkpoint.sequence) || checkpoint.sequence < 0 || !equal(checkpoint.authorityMac, this.#headMac(checkpoint.sequence, checkpoint.hash)) || events.length < checkpoint.sequence || (checkpoint.sequence > 0 && events[checkpoint.sequence - 1]?.hash !== checkpoint.hash))) fail('external checkpoint mismatch or rollback');
    const refs = payloads<{ hash: string; bytes: number }>(events, 'artifact');
    const artifacts = this.#db.prepare('SELECT hash, bytes FROM artifacts').all();
    if (refs.length !== artifacts.length) fail('artifact inventory mismatch');
    for (const a of artifacts) {
      const data = a.bytes as Uint8Array;
      if (!refs.some(r => r.hash === a.hash && r.bytes === data.byteLength) || digest(data) !== a.hash) fail('artifact tampered');
    }
    this.#seen = events.length; this.#seenHash = prev;
    return events;
  }
  #write<T>(fn: (events: StoreEvent[], append: (kind: string, payload: unknown) => StoreEvent) => T, initialize = false): T {
    if (this.#closed) fail('store closed');
    this.#db.exec('BEGIN IMMEDIATE'); let committed = false;
    try {
      if (initialize && this.#db.prepare('SELECT name FROM sqlite_schema').all().length === 0) {
        this.#db.exec(`CREATE TABLE events (sequence INTEGER PRIMARY KEY, time INTEGER NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL, previous_hash TEXT, hash TEXT NOT NULL, authority_mac TEXT NOT NULL);
          CREATE TABLE artifacts (hash TEXT PRIMARY KEY, bytes BLOB NOT NULL);
          CREATE TABLE head (singleton INTEGER PRIMARY KEY CHECK(singleton=1), sequence INTEGER NOT NULL, hash TEXT, authority_mac TEXT NOT NULL);
          CREATE TRIGGER events_no_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT, 'append-only'); END;
          CREATE TRIGGER events_no_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT, 'append-only'); END;`);
        this.#db.prepare('INSERT INTO head VALUES (1,0,NULL,?)').run(this.#headMac(0, null));
      }
      const events = this.#verify();
      const result = fn(events, (kind, payload) => {
        if (!kinds.has(kind)) fail('unknown event');
        const time = this.#options.now();
        if (!Number.isSafeInteger(time) || time < (events.at(-1)?.time ?? 0)) fail('clock must be monotone nonnegative safe integer');
        const base = { sequence: events.length + 1, time, kind, payload: JSON.parse(json(payload)) as unknown, previousHash: events.at(-1)?.hash ?? null };
        const hash = contentHash(base), authorityMac = mac(this.#key, 'omb-store/event/v1', [this.#domain, hash]);
        const event = { ...base, hash, authorityMac };
        if (this.#db.prepare('INSERT INTO events VALUES (?,?,?,?,?,?,?)').run(base.sequence, time, kind, json(payload), base.previousHash, hash, authorityMac).changes !== 1) fail('event insert was not durable');
        if (this.#db.prepare('UPDATE head SET sequence=?, hash=?, authority_mac=? WHERE singleton=1').run(base.sequence, hash, this.#headMac(base.sequence, hash)).changes !== 1) fail('head update was not durable');
        const stored = this.#db.prepare('SELECT hash,payload,authority_mac FROM events WHERE sequence=?').get(base.sequence);
        if (!stored || stored.hash !== hash || stored.payload !== json(payload) || stored.authority_mac !== authorityMac) fail('appended event readback mismatch');
        events.push(event); return event;
      });
      this.#options.faultAt?.('before-commit');
      this.#db.exec('COMMIT'); committed = true;
      this.#seen = events.length; this.#seenHash = events.at(-1)?.hash ?? null;
      this.#options.faultAt?.('after-commit');
      return JSON.parse(json(result === undefined ? null : result)) as T;
    } catch (e) { if (!committed) this.#db.exec('ROLLBACK'); throw e; }
  }
  #read<T>(fn: (events: StoreEvent[]) => T): T {
    this.#db.exec('BEGIN');
    try { const result = fn(this.#verify()); this.#db.exec('COMMIT'); return result; }
    catch (e) { this.#db.exec('ROLLBACK'); throw e; }
  }
  #sync(): void {
    // FULL already syncs the WAL at COMMIT. Explicitly sync both files and root
    // before returning the look capability; any I/O error denies execution.
    for (const path of [this.databasePath, this.databasePath + '-wal', realpathSync(this.#options.root)]) {
      if (path.endsWith('-wal') && !existsSync(path)) continue;
      const fd = openSync(path, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); }
    }
  }
  checkpoint(): StoreCheckpoint { return this.#read(e => ({ sequence: e.length, hash: e.at(-1)?.hash ?? null, authorityMac: this.#headMac(e.length, e.at(-1)?.hash ?? null) })); }
  events(): StoreEvent[] { return this.#read(e => e); }
  authorityReceipt(value: unknown): string { return mac(this.#key, 'omb-store/authority/v1', [this.#domain, value]); }
  verifyAuthority(value: unknown, receipt: string): boolean { return equal(receipt, this.authorityReceipt(value)); }
  seed(input: ContentTuple, purpose: string): string { return deriveSeed(this.#key, input, purpose); }
  putArtifact(bytes: Uint8Array): string {
    const copy = Buffer.from(bytes), id = digest(copy);
    return this.#write((events, append) => {
      if (!payloads<{ hash: string }>(events, 'artifact').some(a => a.hash === id)) {
        this.#db.prepare('INSERT INTO artifacts VALUES (?,?)').run(id, copy); append('artifact', { hash: id, bytes: copy.length });
      }
      return id;
    });
  }
  hasArtifact(id: string): boolean { hash(id); return this.#read(e => payloads<{ hash: string }>(e, 'artifact').some(a => a.hash === id)); }
  artifact(id: string): Buffer {
    hash(id); return this.#read(() => this.#artifactBytes(id));
  }
  #artifactBytes(id: string): Buffer {
    const row = this.#db.prepare('SELECT bytes FROM artifacts WHERE hash=?').get(id);
    if (!row) fail('missing artifact');
    const bytes = Buffer.from(row.bytes as Uint8Array);
    if (digest(bytes) !== id) fail('artifact content address mismatch');
    return bytes;
  }
  #hasArtifact(events: StoreEvent[], id: string): void { hash(id); if (!payloads<{ hash: string }>(events, 'artifact').some(a => a.hash === id)) fail('missing pinned artifact'); }
  timeline(datasetId: string): LockTimeline { return this.#read(e => timeline(e, datasetId)); }
  lock(datasetId: string, input: PreLookLock): LockTimeline[number] {
    text(datasetId);
    return this.#write((events, append) => {
      const t = timeline(events, datasetId), p = pins(t), index = t.length;
      if (index > 5 || input.stage !== stages[index]) fail('L0-L6 lock order violation');
      const fields: Record<string, string[]> = {
        'L0-source-lock': ['source_hash'], 'L1-contract-lock': ['public_contract_hash', 'private_contract_hash'],
        'L2-partition-lock': ['partition_hash', 'public_contract_hash'], 'L3-schema-view': ['schema_view_hash', 'partition_hash', 'dev_only'],
        'L4-plan-lock': ['plan_hash', 'public_contract_hash', 'partition_hash', 'registry_version', 'calibration_result_hash'],
        'L5-training': ['artifact_hash', 'frozen_code_hash', 'plan_hash', 'dev_only'],
      };
      const required = fields[input.stage] ?? fail('invalid lock stage');
      if (json(Object.keys(input).sort()) !== json(['stage', ...required].sort())) fail('unexpected or missing lock fields');
      for (const [k, v] of Object.entries(input)) {
        if (k.endsWith('_hash') && !(k === 'private_contract_hash' && v === null)) { hash(v as string); this.#hasArtifact(events, v as string); }
        if (k in p && k !== 'stage' && p[k] !== v) fail(`lock binding changed: ${k}`);
        if (k === 'dev_only' && v !== true) fail('dev-only view required');
        if (k === 'registry_version') text(v as string);
      }
      if (input.stage === 'L1-contract-lock') {
        const contract = JSON.parse(this.#artifactBytes(input.public_contract_hash).toString()) as PublicLayer;
        if (contract.schema_version !== 'omb-data-contract/v3.1' || contract.structure.dataset_id !== datasetId) fail('v3.1 contract dataset binding mismatch');
        for (const registry of contract.structure.alias_registries) this.#hasArtifact(events, registry.file.sha256);
      }
      if (input.stage === 'L2-partition-lock' && !payloads<PartitionCommitment>(events, 'partition').some(c => c.datasetId === datasetId && c.partitionHash === input.partition_hash && c.publicContractHash === input.public_contract_hash)) fail('commitPartition required before L2');
      if (input.stage === 'L2-partition-lock') {
        const c = payloads<PartitionCommitment>(events, 'partition').find(c => c.datasetId === datasetId && c.partitionHash === input.partition_hash)!;
        this.#checkPartitionExposure(events, c, true);
      }
      if (input.stage === 'L4-plan-lock') planFrom(this.#artifactBytes(input.plan_hash), this.#artifactBytes(input.public_contract_hash));
      if (input.stage === 'L3-schema-view') {
        const bytes = this.#artifactBytes(input.schema_view_hash);
        const view = JSON.parse(Buffer.from(bytes).toString()) as DevSchemaView;
        const c = payloads<PartitionCommitment>(events, 'partition').find(c => c.partitionHash === input.partition_hash)!;
        this.#checkPartitionExposure(events, c, false);
        const expectedUnits = c.units.filter(u => u.allocation === 'dev').flatMap(u => u.members).sort();
        if (view.version !== 'omb-dev-schema/v1' || view.partitionHash !== c.partitionHash || json(view.devUnits) !== json(expectedUnits)
          || json(Object.keys(view).sort()) !== json(['version', 'partitionHash', 'devUnits', 'tables'].sort())
          || !Array.isArray(view.tables) || !view.tables.length || view.tables.some(t => json(Object.keys(t).sort()) !== json(['id', 'headers', 'rowCount', 'columnCount'].sort()) || !Array.isArray(t.headers) || t.headers.some(h => typeof h !== 'string') || t.columnCount !== t.headers.length || !Number.isSafeInteger(t.rowCount) || t.rowCount < 1)) fail('schema view must contain only dev unit schema');
      }
      const record = { ...input, sequence: index, previous_hash: t.at(-1)?.hash ?? null, time_ms: this.#options.now() } as LockRecord;
      if (!Number.isSafeInteger(record.time_ms) || record.time_ms < (t.at(-1)?.record.time_ms ?? 0)) fail('invalid lock time');
      const entry = { record, hash: contentHash(record) }; append('lock', { datasetId, ...entry }); return entry;
    });
  }
  commitPartition(p: PartitionCommitment): void {
    text(p.id); text(p.datasetId); hash(p.publicContractHash); hash(p.partitionHash); hash(p.sealedArtifactHash);
    this.#write((events, append) => {
      const t = timeline(events, p.datasetId), pin = pins(t);
      if (t.length !== 2 || pin.public_contract_hash !== p.publicContractHash) fail('partition requires antecedent L1 lock');
      this.#hasArtifact(events, p.partitionHash); this.#hasArtifact(events, p.sealedArtifactHash);
      const { partitionHash: _partitionHash, commitmentHash, ...body } = p;
      this.#hasArtifact(events, commitmentHash);
      if (contentHash(body) !== commitmentHash) fail('partition metadata differs from committed bytes');
      const content = JSON.parse(this.#artifactBytes(p.partitionHash).toString()) as PartitionArtifact['content'];
      const publicLayer = JSON.parse(this.#artifactBytes(p.publicContractHash).toString()) as PublicLayer;
      const privateHash = pin.private_contract_hash as string | null;
      const checked = validatePartitionArtifact({ public: { content: publicLayer, hash: p.publicContractHash }, ...(privateHash === null ? {} : { sealed_private: { content: JSON.parse(this.#artifactBytes(privateHash).toString()) as PrivateLayer, hash: privateHash } }) }, { content, hash: p.partitionHash }, { expectedPrivateContractHash: privateHash });
      if (!checked.ok) fail('invalid v3.1 partition artifact: ' + checked.errors.join('; '));
      const allocations = content.partitions[0];
      if (content.partitions.length !== 1 || allocations?.id !== p.id) fail('partition artifact identity mismatch');
      const floor = publicLayer.structure.unit_hierarchy.find(l => l.minimum_independent)!.id;
      const canonical = contractIdentities(publicLayer.structure);
      const expectedNodes = publicLayer.structure.graph.nodes.filter(n => n.level === floor).map(n => n.id).sort();
      if (json(p.units.flatMap(u => u.members).sort()) !== json(expectedNodes) || json(allocations.units.map(u => canonical.resolver.nodeKey('public', u.node)).sort()) !== json([...new Set(expectedNodes.map(n => canonical.resolver.nodeKey('public', n)))].sort())
        || p.units.some(u => u.members.some(m => allocations.units.find(a => canonical.resolver.nodeKey('public', a.node) === canonical.resolver.nodeKey('public', m))?.allocation !== u.allocation))) fail('partition floor allocation mismatch');
      if (payloads<PartitionCommitment>(events, 'partition').some(x => x.id === p.id || x.partitionHash === p.partitionHash)) fail('partition already committed');
      if (!p.units.some(u => u.allocation === 'dev') || !p.units.some(u => u.allocation === 'held-out')) fail('nonempty dev and held-out units required');
      for (const u of p.units) if (json(uniqueIdentities(u.members.flatMap(n => canonical.identities(n)))) !== json(uniqueIdentities(u.identities))) fail('commitment identities must be canonical contract identities');
      const nodes = new Set<string>(), ids = new Set<string>(), members = new Set<string>();
      for (const u of p.units) {
        text(u.node); if (nodes.has(u.node) || !['dev', 'held-out', 'excluded'].includes(u.allocation) || !u.identities.length) fail('invalid partition unit'); nodes.add(u.node);
        if (!u.members.length || !u.members.includes(u.node)) fail('collapsed partition needs member lineage');
        for (const m of u.members) { text(m); if (members.has(m)) fail('overlapping collapsed units'); members.add(m); }
        for (const i of u.identities) { const k = identity(i); if (ids.has(k)) fail('duplicate unit identity'); ids.add(k); }
      }
      this.#checkPartitionExposure(events, p, false);
      append('partition', p);
    });
  }
  recordProbe(datasetId: string, prediction: string): void {
    text(prediction); this.#write((events, append) => {
      const t = timeline(events, datasetId);
      if (t.length < 5 || t.length > 6 || payloads<{ datasetId: string }>(events, 'probe').some(p => p.datasetId === datasetId)) fail('probe requires locked plan and no previous look/probe');
      append('probe', { datasetId, prediction, planHash: pins(t).plan_hash });
    });
  }
  #attempt(events: StoreEvent[], append: (kind: string, payload: unknown) => StoreEvent, input: ContentTuple, executionId: string): Attempt {
    text(executionId); const normalized = tuple(input), tupleHash = contentHash(normalized);
    const count = payloads<Attempt>(events, 'attempt').filter(a => a.tupleHash === tupleHash).length + 1;
    const attempt = { tuple: normalized, tupleHash, executionId, count, first: count === 1 }; append('attempt', attempt); return attempt;
  }
  recordAttempt(input: ContentTuple, executionId: string): Attempt { return this.#write((e, a) => this.#attempt(e, a, input, executionId)); }
  attemptCount(input: ContentTuple): number { return this.#read(e => payloads<Attempt>(e, 'attempt').filter(a => a.tupleHash === contentHash(tuple(input))).length); }
  /** Records every request, but only a first, unburned look may execute. A crash
   * after commit consumes both the attempt and the partition forever. */
  get separation(): Look['separation'] { return this.#read(e => payloads<{ separation: Look['separation'] }>(e, 'settings')[0]!.separation); }
  recordLook(datasetId: string, partitionId: string, input: ContentTuple, executionId: string, separation: Look['separation'] = 'single-user'): Look {
    if (!['single-user', 'os-users'].includes(separation) || separation !== this.separation) fail('look separation differs from immutable store policy');
    // Invalid/missing preconditions still leave a certification-attempt record.
    const result = this.#write((events, append): { look: Look } | { refusal: string } => {
      const attempt = this.#attempt(events, append, input, executionId);
      // Refused preconditions retain the audit attempt without spending L6.
      const c = payloads<PartitionCommitment>(events, 'partition').find(p => p.id === partitionId);
      if (!c) return { refusal: 'missing partition commitment' };
      const t = timeline(events, datasetId), p = pins(t);
      if (t.length < 6 || c.datasetId !== datasetId || c.partitionHash !== p.partition_hash) return { refusal: 'look requires L0-L5 and locked partition' };
      if (input.registryVersion !== p.registry_version || input.planLockHash !== p.plan_hash || input.contractHash !== p.public_contract_hash || input.frozenCodeHash !== p.frozen_code_hash || input.dataHash !== p.source_hash) return { refusal: 'content tuple differs from locks' };
      if (!payloads<{ datasetId: string; planHash: string }>(events, 'probe').some(x => x.datasetId === datasetId && x.planHash === p.plan_hash)) return { refusal: 'closed-book probe required' };
      const number = payloads<Look>(events, 'look').filter(l => l.partitionId === partitionId).length + 1;
      const previouslyBurned = this.#burned(events, c.units.filter(u => u.allocation === 'held-out').flatMap(u => u.identities));
      const policyHash = events.find(e => e.kind === 'settings')!.hash;
      const claimCeiling = separation === 'os-users' ? 'requires-certification' as const : 'Tentative' as const;
      const receipt = this.authorityReceipt({ datasetId, partitionId, previousHash: t.at(-1)!.hash, attempt, number, separation, claimCeiling, policyHash });
      const record: Look['record'] = {
        stage: 'L6-look-record', sequence: t.length, previous_hash: t.at(-1)!.hash, time_ms: this.#options.now(),
        plan_hash: p.plan_hash as string, public_contract_hash: p.public_contract_hash as string, private_contract_hash: p.private_contract_hash as string | null,
        partition_hash: p.partition_hash as string, artifact_hash: p.artifact_hash as string, frozen_code_hash: p.frozen_code_hash as string,
        registry_version: p.registry_version as string, calibration_result_hash: p.calibration_result_hash as string,
        attempt: t.length - 5, fsynced_before_execution: true, durability_receipt_hash: receipt,
      };
      if (!Number.isSafeInteger(record.time_ms) || record.time_ms < t.at(-1)!.record.time_ms) fail('invalid look time');
      const look: Look = { policyHash, separation, claimCeiling, datasetId, partitionId, number, label: `look ${number}`, executable: number === 1 && previouslyBurned.length === 0, previouslyBurned, attempt, record, hash: contentHash(record) };
      append('look', look); return { look };
    });
    if ('refusal' in result) fail(result.refusal);
    const look = result.look;
    this.#options.faultAt?.('before-look-fsync'); this.#sync(); this.#options.faultAt?.('after-look-fsync'); return look;
  }
  mergeIdentities(identities: UnitIdentity[]): void {
    if (identities.length < 2 || new Set(identities.map(identity)).size !== identities.length) fail('identity merge requires distinct identities');
    this.#write((_e, a) => { a('identity-merge', identities); });
  }
  #snapshot(events: StoreEvent[], candidate?: ExposureCandidate): PriorExposure[] {
    return exposureSnapshot(events, h => this.#artifactBytes(h), candidate, this.#exposureMembers);
  }
  #candidate(events: StoreEvent[], partition: PartitionCommitment): ExposureCandidate {
    return { partition, sourceHash: pins(timeline(events, partition.datasetId)).source_hash as string,
      structure: (JSON.parse(this.#artifactBytes(partition.publicContractHash).toString()) as PublicLayer).structure };
  }
  #burned(events: StoreEvent[], ids: UnitIdentity[]): UnitIdentity[] {
    return uniqueIdentities(this.#snapshot(events).filter(e => e.burnRecordHashes.length && e.identities.some(i => ids.some(j => identityKey(i) === identityKey(j)))).flatMap(e => e.identities));
  }
  #checkPartitionExposure(events: StoreEvent[], c: PartitionCommitment, atL2: boolean): void {
    const snapshot = this.#snapshot(events, this.#candidate(events, c));
    const dev = c.units.filter(u => u.allocation === 'dev').flatMap(u => u.identities).map(identityKey);
    const held = c.units.filter(u => u.allocation === 'held-out').flatMap(u => u.identities).map(identityKey);
    if (snapshot.some(e => e.identities.some(i => dev.includes(identityKey(i))) && e.identities.some(i => held.includes(identityKey(i))))) fail('partition dev and held-out share known identity');
    if (!atL2) return;
    const artifact = JSON.parse(this.#artifactBytes(c.partitionHash).toString()) as PartitionArtifact['content'];
    for (const u of c.units) {
      const prior = priorFor(snapshot, u.identities), sticky = stickyAllocation(prior);
      if (u.allocation === 'held-out' && prior.burnRecordHashes.length) fail('held-out identities already burned or dev-exposed');
      if (sticky && u.allocation !== sticky && u.allocation !== 'excluded') fail('sticky allocation changed; dev-exposed or reserved held-out identities');
      for (const a of artifact.partitions[0]!.units.filter(a => u.members.includes(a.node))) {
        const expected = prior.burnRecordHashes.length ? { status: 'burned', look_record_hashes: prior.burnRecordHashes } : { status: 'unseen' };
        if (json(a.burn) !== json(expected)) fail('L2 burn snapshot differs from actual store state; re-seal');
      }
    }
  }
  /** Call after L0/L1, before sealing; L2 rechecks this snapshot atomically. */
  priorExposure(contract: PublicEnvelope, sourceHash: string): PriorExposure[] {
    hash(sourceHash);
    const canonical = contractIdentities(contract.content.structure);
    const nodes = contract.content.structure.graph.nodes.filter(n => n.level === canonical.resolver.hierarchy.floor);
    const partition: PartitionCommitment = { id: 'exposure-query', datasetId: contract.content.structure.dataset_id, publicContractHash: contract.hash, partitionHash: '', commitmentHash: '', sealedArtifactHash: '',
      sourceSpellings: {}, sealedTables: [], units: nodes.map(n => ({ node: n.id, members: [n.id], allocation: 'excluded', identities: canonical.identities(n.id) })) };
    return this.#read(e => this.#snapshot(e, { partition, sourceHash, structure: contract.content.structure }));
  }
  burned(identities: UnitIdentity[]): UnitIdentity[] { identities.forEach(identity); return this.#read(e => this.#burned(e, identities)); }
  addClaim(claim: Claim): void {
    text(claim.id); text(claim.datasetId); hash(claim.contractHash);
    this.#write((e, a) => { if (payloads<Claim>(e, 'claim').some(c => c.id === claim.id)) fail('claim already recorded'); if (pins(timeline(e, claim.datasetId)).public_contract_hash !== claim.contractHash) fail('claim contract not locked'); a('claim', claim); });
  }
  claims(): (Claim & { voidsConfirmed: boolean; amendments: AmendmentDecision[] })[] {
    return this.#read(e => payloads<Claim>(e, 'claim').map(c => { const amendments = payloads<AmendmentDecision>(e, 'amendment').filter(a => a.datasetId === c.datasetId); return { ...c, voidsConfirmed: amendments.some(a => a.voidsConfirmed), amendments }; }));
  }
  registerHypothesis(h: Hypothesis): { first: boolean; hypothesis: Hypothesis } {
    hash(h.fingerprint); return this.#write((e, a) => { const old = payloads<Hypothesis>(e, 'hypothesis').find(x => x.fingerprint === h.fingerprint); if (old) return { first: false, hypothesis: old }; a('hypothesis', h); return { first: true, hypothesis: h }; });
  }
  recordGate(g: GateFiring): void {
    if (!['passed', 'failed', 'not-run', 'unavailable'].includes(g.status)) fail('unknown gate status'); text(g.gate); hash(g.evidenceHash);
    this.#write((e, a) => {
      const claim = payloads<Claim>(e, 'claim').find(c => c.id === g.claimId) ?? fail('missing claim');
      const p = pins(timeline(e, claim.datasetId));
      const expected = { publicContractHash: p.public_contract_hash, privateContractHash: p.private_contract_hash, partitionHash: p.partition_hash, artifactHash: p.artifact_hash, registryVersion: p.registry_version, calibrationResultHash: p.calibration_result_hash };
      if (json(g.binding) !== json(expected)) fail('gate binding mismatch'); this.#hasArtifact(e, g.evidenceHash); a('gate', g);
    });
  }
  recordResolution(contractHash: string, artifactHash: string): void { hash(contractHash); this.#write((e, a) => { this.#hasArtifact(e, contractHash); this.#hasArtifact(e, artifactHash); a('resolution', { contractHash, artifactHash }); }); }
  amendContract(input: AmendmentSubmission): AmendmentDecision {
    hash(input.previousContractHash); hash(input.amendedContractHash); hash(input.evidenceHash); text(input.reason);
    return this.#write((e, a) => {
      const looks = payloads<Look>(e, 'look').filter(l => l.datasetId === input.datasetId);
      if (!looks.length) fail('post-look amendment requires a look');
      const previous = payloads<AmendmentDecision>(e, 'amendment').filter(x => x.datasetId === input.datasetId).at(-1)?.amendedContractHash ?? looks[0]!.record.public_contract_hash;
      if (input.previousContractHash !== previous || input.amendedContractHash === previous) fail('amendment chain mismatch');
      this.#hasArtifact(e, input.amendedContractHash); this.#hasArtifact(e, input.evidenceHash);
      const allowedKinds = input.changes.length > 0 && input.changes.every(c => ['coarsen-units', 'add-replicate-groups', 'remove-held-out-units'].includes(c.kind));
      const result: AmendmentDecision = { ...input, allowedKinds, voidsConfirmed: !allowedKinds || input.outcomeBlind !== true, requiresBothVersions: true, affectedClaims: payloads<Claim>(e, 'claim').filter(c => c.datasetId === input.datasetId).map(c => c.id) };
      a('amendment', result); return result;
    });
  }
  #alphaState(e: StoreEvent[], f: AlphaFamily): { reservations: AlphaReservation[]; rejections: number[]; alpha: number; w0: number } {
    familyKey(f);
    // One spending stream per outcome DATASET; software family keys annotate it.
    const reservations = payloads<AlphaReservation>(e, 'alpha-reserve').filter(r => r.family.outcomeDatasetHash === f.outcomeDatasetHash);
    const results = payloads<AlphaResult>(e, 'alpha-result');
    const rejections = reservations.filter(r => results.some(x => x.reservationId === r.id && x.rejected)).map(r => r.index);
    const settings = payloads<{ alpha: number; w0: number }>(e, 'settings')[0]!;
    return { reservations, rejections, ...settings };
  }
  nextThreshold(f: AlphaFamily): number { return this.#read(e => { const s = this.#alphaState(e, f); return lordThreshold(s.reservations.length + 1, s.rejections, s.alpha, s.w0); }); }
  reserveAlpha(f: AlphaFamily, exploratory = false, planFamily: string | null = null): AlphaReservation {
    return this.#write((e, a) => {
      const s = this.#alphaState(e, f), results = payloads<AlphaResult>(e, 'alpha-result');
      if (s.reservations.some(r => !results.some(x => x.reservationId === r.id))) fail('settle pending alpha test first (null for crash/unavailable)');
      const index = s.reservations.length + 1, threshold = lordThreshold(index, s.rejections, s.alpha, s.w0), familyHash = familyKey(f);
      const r = { id: contentHash([f.outcomeDatasetHash, index]), family: f, familyHash, index, threshold, exploratory, planFamily }; a('alpha-reserve', r); return r;
    });
  }
  settleAlpha(reservationId: string, p: number | null): AlphaResult {
    if (p !== null && (typeof p !== 'number' || !Number.isFinite(p) || p < 0 || p > 1)) fail('invalid p-value');
    return this.#write((e, a) => {
      const r = payloads<AlphaReservation>(e, 'alpha-reserve').find(x => x.id === reservationId) ?? fail('unknown alpha reservation');
      if (payloads<AlphaResult>(e, 'alpha-result').some(x => x.reservationId === reservationId)) fail('alpha result already settled');
      const result = { reservationId, p, rejected: p !== null && p <= r.threshold }; a('alpha-result', result); return result;
    });
  }
  close(): void { if (!this.#closed) { this.#db.close(); this.#key.fill(0); this.#closed = true; } }
}
