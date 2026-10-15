import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync, copyFileSync, chmodSync, statSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readKernelStream, sha256Canonical } from '../../bio-core/src/index.ts';
import { PhaseMachine, toJson } from '../../omb-investigate/src/machine.ts';
import { MemoryJournal, SqliteJournal, verifyChain, type JournalEvent } from '../../omb-investigate/src/journal.ts';
import { isPhase, type PhaseId, type PhaseOutputBase, type JsonObject } from '../../omb-investigate/src/types.ts';
import { safePath } from './task.ts';

export interface ForkOptions { from: string; at: PhaseId; out: string }
export interface DevManifest {
  schema: 'omb-amani/dev-fork@1'; offRecord: true; gradable: false; forkId: string;
  source: string; sourceHash: string; sourcePhaseHash: string | null; sourceCutoff: number; at: PhaseId;
  id: string; taskDir: string; mode: 'card' | 'pilot'; root: string;
  phases: { phase: PhaseId; output: JsonObject; outputHash: string }[];
  ledger: JournalEvent[]; sourceRoot: string; warnings: string[];
}
export function immutableDb(file: string): DatabaseSync {
  return new DatabaseSync(`${pathToFileURL(file).href}?immutable=1`, { readOnly: true });
}
export function inside(out: string, root: string): boolean {
  const expected = statSync(root);
  for (let p = out; ; p = path.dirname(p)) {
    if (existsSync(p)) { const actual = statSync(p); if (actual.dev === expected.dev && actual.ino === expected.ino) return true; }
    if (path.dirname(p) === p) return false;
  }
}
export function assertDevDestination(out: string, roots: string[]): void {
  if (roots.some(r => inside(out, r) || r.startsWith(out + path.sep)) || /(?:^|\/)(?:tierb2?-runs|served|report\.json|amani-run\.json)(?:\/|$)/i.test(out))
    throw new Error('development output must be outside official, served and source attempt destinations');
  if (existsSync(out)) throw new Error('development output must be a NEW directory');
}
/** Copy regular files only: a source symlink must never grant access outside the saved run. */
export function copyPlain(src: string, dest: string): void {
  const st = lstatSync(src);
  if (st.isSymbolicLink() || !st.isDirectory() && !st.isFile()) throw new Error(`unsupported saved artifact: ${src}`);
  if (st.isDirectory()) { mkdirSync(dest, { recursive: true, mode: 0o700 }); for (const n of readdirSync(src)) copyPlain(path.join(src, n), path.join(dest, n)); }
  else { mkdirSync(path.dirname(dest), { recursive: true, mode: 0o700 }); copyFileSync(src, dest); chmodSync(dest, st.mode & 0o111 ? 0o700 : 0o600); }
}
export function remap<T>(value: T, replacements: [string, string][]): T {
  const walk = (v: unknown): unknown => typeof v === 'string' ? replacements.reduce((s, [a,b]) => s.split(a).join(b), v) : Array.isArray(v) ? v.map(walk) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k,x]) => [k,walk(x)])) : v;
  return walk(value) as T;
}

export async function devFork(options: ForkOptions): Promise<DevManifest> {
  if (!isPhase(options.at)) throw new Error(`unknown fork phase: ${options.at}`);
  const source = safePath(options.from), sourceRoot = path.join(source, '.amani');
  if(lstatSync(sourceRoot).isSymbolicLink())throw new Error('linked source root refused');
  const config = JSON.parse(readFileSync(path.join(sourceRoot, 'config.json'), 'utf8'));
  const task = safePath(config.taskDir), out = safePath(options.out), root = path.join(out, '.amani');
  assertDevDestination(out, [source, task]);
  const db = immutableDb(path.join(sourceRoot, 'journal.sqlite'));
  let events, directLedger;
  try { events = readKernelStream(db, `inv:${config.id}`); directLedger=readKernelStream(db,"ledger"); } finally { db.close(); }
  if (!events.length) throw new Error('source investigation journal is empty');
  let previous: string | null = null;
  const memory = new MemoryJournal(Date.now);
  for (const e of events) {
    const {sequence: _seq, eventSha256, previousEventSha256, ...event} = e;
    if (previousEventSha256 !== previous || sha256Canonical({event, previousEventSha256}) !== eventSha256) throw new Error('source journal hash chain is broken');
    previous = eventSha256;
    memory.append(`inv:${config.id}`, e.type, (e.payload as {data: JsonObject}).data);
  }
  const machine = new PhaseMachine(memory, `inv:${config.id}`), completed = machine.completed();
  const target = completed.findIndex(p => p.phase === options.at);
  const phases = target >= 0 ? completed.slice(0, target) : machine.due() === options.at ? completed : null;
  if (!phases) throw new Error(`source did not reach ${options.at}`);
  const boundary = phases.at(-1);
  const cutoff = boundary ? events.findLast(e => e.type === 'phase-completed' && (e.payload as {data: JsonObject}).data.outputHash === boundary.outputHash)!.occurredAt : events[0]!.occurredAt;
  const ledger: JournalEvent[] = [];
  const storeFile = path.join(sourceRoot, 'store/store.sqlite');
  if (directLedger.length) {
    let prev:string|null=null;
    for(const e of directLedger){const{sequence,eventSha256,previousEventSha256,...event}=e;
      if(previousEventSha256!==prev||sha256Canonical({event,previousEventSha256})!==eventSha256)throw new Error('source ledger chain is broken');
      prev=eventSha256;
      if(Date.parse(e.occurredAt)<=Date.parse(cutoff))ledger.push({stream:'ledger',seq:ledger.length+1,at:Date.parse(e.occurredAt),type:e.type,payload:(e.payload as {data:JsonObject}).data,hash:e.eventSha256,prevHash:e.previousEventSha256});
    }
  } else if (existsSync(storeFile)) {
    const store = immutableDb(storeFile);
    try { for (const row of store.prepare('SELECT bytes FROM artifacts').all()) {
      let a; try { a = JSON.parse(Buffer.from(row.bytes as Uint8Array).toString()); } catch { continue; }
      if (a.domain === 'omb-investigate/journal/v1' && a.event?.stream === 'ledger' && a.event.at <= Date.parse(cutoff)) ledger.push(a.event);
    } } finally { store.close(); }
    ledger.sort((a,b) => a.seq-b.seq);
    if(!verifyChain(ledger).valid)throw new Error('source ledger chain is broken');
  }
  // Imported phases in a development fork were seeded together, so wall-clock
  // timestamps alone cannot bound its ledger. Use the receipts of the last
  // retained phase; never carry a future lock/freeze/look into an earlier fork.
  const planPhase=phases.find(p=>p.phase==='plan')?.output;
  const lockPhase=phases.find(p=>p.phase==='plan-lock')?.output;
  const freezePhase=phases.find(p=>p.phase==='freeze')?.output;
  const lookPhase=phases.find(p=>p.phase==='look')?.output;
  const receipt=(v:unknown)=>v&&typeof v==='object'&&'sequence' in v?Number(v.sequence):undefined;
  const looks=lookPhase?.looks as {sequence:number}[]|undefined;
  const limit=looks?.at(-1)?.sequence??receipt(freezePhase?.receipt)??receipt(lockPhase?.lock)??
    (planPhase ? (ledger.find(e=>['literature-plan-bound','plan-locked'].includes(e.type)&&(e.payload as JsonObject).planHash===planPhase.planHash)?.seq??(ledger.length+1))-1 : 0);
  ledger.splice(ledger.findIndex(e=>e.seq>limit)<0?ledger.length:ledger.findIndex(e=>e.seq>limit));
  mkdirSync(out, { recursive: true, mode: 0o700 }); mkdirSync(root, { mode: 0o700 });
  const taskDir = path.join(out, 'task'); copyPlain(task, taskDir);
  const replacements: [string,string][] = [[sourceRoot,root],[task,taskDir]];
  const paths = new Set<string>();
  const collect = (v: unknown): void => { if (typeof v === 'string' && v.startsWith(sourceRoot + '/') && existsSync(v)) paths.add(v); else if (Array.isArray(v)) v.forEach(collect); else if (v && typeof v === 'object') Object.values(v).forEach(collect); };
  phases.forEach(p => collect(p.output));
  // Workdirs at the end of a historical attempt are NOT the workdirs at a phase boundary.
  // Prefer new per-phase snapshots; for old dry-run boundaries candidate-0 is the exact code snapshot.
  for (const p of paths) if (!p.startsWith(path.join(sourceRoot, 'work') + '/')) copyPlain(p, remap(p,replacements));
  const warnings: string[] = [];
  const leadPhase = phases.findLast(p=>p.output.lead);
  const prior = leadPhase?.output;
  const lead = prior?.lead as JsonObject | undefined;
  if (lead?.workdir) {
    const snapshot = path.join(sourceRoot,'host','dev-snapshots',String(phases.at(-1)?.phase??''));
    const legacy = path.join(sourceRoot,'host',config.id,'bundles','candidate-0');
    const from = existsSync(snapshot) ? snapshot : options.at === 'dry-run' && existsSync(legacy) ? legacy : null;
    if (!from) {
      const locked=phases.find(p=>p.phase==='plan')?.output.lockedPlan;
      if(!['plan-lock','code'].includes(options.at)||typeof locked!=='string')throw new Error('saved phase workdir unavailable; capture a new run with turn recording');
      copyPlain(locked,path.join(remap(String(lead.workdir),replacements),'plan.json'));
      warnings.push('Legacy planning scratch unavailable: seeded authoritative locked plan only; next model input requires a cassette match or live fallback.');
    } else copyPlain(from, remap(String(lead.workdir),replacements));
    if (from === legacy) warnings.push('Legacy code checkpoint recovered from candidate-0; no complete legacy turn cassettes exist.');
  }
  for(const p of phases){const snapshot=path.join(sourceRoot,'host/dev-snapshots',p.phase);if(existsSync(snapshot))copyPlain(snapshot,path.join(root,'host/dev-snapshots',p.phase));}
  const cassette = path.join(sourceRoot,'host','cassette');
  if (existsSync(cassette)) copyPlain(cassette,path.join(root,'host','source-cassette'));
  const manifest: DevManifest = { schema:'omb-amani/dev-fork@1',offRecord:true,gradable:false,forkId:randomUUID(),source,sourceHash:previous!,sourcePhaseHash:boundary?.outputHash??null,sourceCutoff:Date.parse(cutoff),at:options.at,id:config.id,taskDir,mode:config.mode,root,phases:remap(phases,replacements),ledger:remap(ledger,replacements),sourceRoot,warnings };
  writeFileSync(path.join(out,'OFF-RECORD'),'DEVELOPMENT ONLY. NOT ELIGIBLE FOR SUBMISSION OR GRADING.\n',{flag:'wx',mode:0o400});
  const journal = new SqliteJournal(path.join(root,'journal.sqlite'),Date.now);
  try {
    journal.append(`inv:${manifest.id}`,'dev-genesis',toJson({offRecord:true,gradable:false,forkId:manifest.forkId,sourceHash:manifest.sourceHash,sourcePhaseHash:manifest.sourcePhaseHash,at:manifest.at}));
    journal.append('ledger','dev-genesis',toJson({offRecord:true,gradable:false,sourceHash:manifest.sourceHash}));
    const receipts = new Map<string,{hash:string;sequence:number}>();
    for (const e of manifest.ledger) { const next=journal.append('ledger',e.type,e.payload); receipts.set(e.hash,{hash:next.hash,sequence:next.seq}); }
    const rebind = (v: unknown): unknown => {
      if (Array.isArray(v)) return v.map(rebind);
      if (v && typeof v==='object') { const obj=v as Record<string,unknown>, receipt=typeof obj.hash==='string' ? receipts.get(obj.hash) : null; return {...Object.fromEntries(Object.entries(obj).map(([k,x])=>[k,rebind(x)])),...(receipt && typeof obj.sequence==='number' ? receipt : {})}; }
      return v;
    };
    manifest.phases = rebind(manifest.phases) as DevManifest['phases'];
    const stage=manifest.phases.find(p=>p.phase==='stage')?.output.staged as JsonObject|undefined;
    const lock=manifest.phases.find(p=>p.phase==='plan-lock')?.output;
    if(stage && lock) for(const [claim,fingerprint] of Object.entries(lock.fingerprints as JsonObject)) journal.append('registry','hypothesis-registered',toJson({manifest:stage.manifestHash,fingerprint,ordinal:(lock.ordinals as JsonObject)[claim],source:{offRecord:true}}));
    const fresh = new PhaseMachine(journal,`inv:${manifest.id}`);
    for (const p of manifest.phases) await fresh.phase(p.phase,{devFork:manifest.forkId,sourceOutputHash:p.outputHash},async()=>p.output as unknown as PhaseOutputBase);
    if (fresh.due() !== options.at) throw new Error('fork projection did not reach requested phase');
  } finally { journal.close(); }
  writeFileSync(path.join(root,'config.json'),JSON.stringify({id:manifest.id,taskDir,mode:manifest.mode,root,offRecord:true,gradable:false,live:true})+'\n',{flag:'wx',mode:0o400});
  writeFileSync(path.join(out,'dev-fork.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o400});
  return manifest;
}
