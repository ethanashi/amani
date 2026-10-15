import { developmentAuthorized } from './medic-authorization.ts';
import { persistCheckpoint } from './transport/checkpoint-io.ts';
import { InvestigationPaused } from '../../omb-investigate/src/pause.ts';
import { TurnCassette, Divergence } from './dev-cassette.ts';
import { copyPlain } from './dev-fork.ts';
import type { InvestigationDeps } from '../../omb-investigate/src/investigation.ts';

import { configuredProviders } from '../../omb-investigate/src/provider-factory.ts';
import { auditTurn, type TurnAudit } from './adapter-audit.ts';
import { retainAdapterEvidence } from './retain.ts';
import { computeCardIntegrity, writeCardIntegrity } from './card-integrity.ts';
import { randomBytes, createHmac } from 'node:crypto';
import { certifiedEvidence } from './diagnostic-blocks.ts';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, loadavg } from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CodexAdapter, ClaudeAdapter, PINNED_CLAUDE_VERSION, type WorkerAdapter } from '../../omb-adapters/src/index.ts';
import { Scheduler, GiB, osResourceProbe } from '../../omb-sched/src/index.ts';
import { OmbStore } from '../../omb-store/src/index.ts';
import { Investigation, type DeliverableOut } from '../../omb-investigate/src/investigation.ts';
import { Fleet } from '../../omb-investigate/src/fleet.ts';
import { SqliteJournal } from '../../omb-investigate/src/journal.ts';
import { StoreLedger, StoreRegistry, StoreJournal, SqliteSchedStore } from '../../omb-investigate/src/store-adapter.ts';
import { TabularStager } from '../../omb-investigate/src/tabular.ts';
import { KernelExecutor } from '../../omb-investigate/src/kernel.ts';
import { ThreadKernelCertifier } from '../../omb-investigate/src/thread-certifier.ts';
import { liveContracts, livePreflight, LIVE_DEFAULTS, workerRuntimeRunner } from '../../omb-investigate/src/live.ts';
import { progressRunner } from '../../omb-investigate/src/liveness.ts';
import { WORKER_SCHEMAS } from '../../omb-investigate/src/turns.ts';
import { treeHash } from '../../omb-investigate/src/bundle.ts';
import { readDeliverableIntegrity } from './integrity.ts';
import { cardStager } from './card-stager.ts';
import { reportWorker } from './report-worker.ts';
import { loadTask, readJson, type Task } from './task.ts';
import { object, type Evidence, type Json } from './results.ts';

export interface EngineResult {
  offRecord?: true; gradable?: false;
  workerAudit?: TurnAudit[];
  medicHeals?: Json[];
  phases?: string[]; replans?: Json[]; planAmendments?: Json[];
  id: string; status: string; draft: Json; evidence: Evidence; parks: Json[]; warnings: string[];
  frozen: string | null; deliverable: string | null; simulated: boolean;
}
/** Legacy status mapping; official medic-enabled runs park separately below. */
export function attemptStatus(status: string, lastPause: { kind?: unknown } | undefined): string {
  return status === 'paused' && lastPause?.kind === 'infra' ? 'infrastructure' : status;
}
export const emptyResult = (id: string, simulated: boolean): EngineResult => ({ id, status: 'incomplete', draft: {}, evidence: { metrics: {}, outputs: {}, claims: [] }, parks: [], warnings: [], frozen: null, deliverable: null, simulated });
export function saveJson(file: string, value: unknown): void {
  writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flush: true });
}

/** Offline CLI mode is deliberately non-scientific: fake workers cannot manufacture certification. */
export const offlineWorker: WorkerAdapter = { async run() {
  return { status: 'agent_error', resetAt: null, sessionToken: null, files: {}, warnings: ['OMB_LIVE unset: fake worker has no scientific analysis'], usage: null, usageComplete: false,
    containment: 'reaped', supervisor: null, eventsPath: '', quota: null, rateLimit: { terminal: false, signals: [], resetHint: null },
    provenance: { cliVersion: null, cliSha256: null, initInventory: [], observedModels: [], observedEfforts: [], identitySource: 'unavailable', profileSha256: null, configSha256: null, canary: 'denied' } };
} };

export interface DevelopmentHooks { offRecord: true; wrapWorker:(worker:WorkerAdapter)=>WorkerAdapter; configure:(deps:InvestigationDeps)=>void; initialize?:(inv:Investigation,result:EngineResult)=>Promise<void>; onPhase?:(point:string)=>void }
export async function runEngine(o: { task: Task; root: string; repoRoot: string; id: string; capMs: number; now: () => number; live: boolean; medic?: boolean; development?: DevelopmentHooks; workers?: { codex: WorkerAdapter; claude: WorkerAdapter } }): Promise<EngineResult> {
  const { root, now } = o, result = emptyResult(o.id, !o.live);
  if(o.development){result.offRecord=true;result.gradable=false;}
  result.warnings.push(...o.task.warnings);
  const dir = (...p: string[]) => { const d = path.join(root, ...p); mkdirSync(d, { recursive: true, mode: 0o700 }); return d; };
  dir();
  const io = { persist: persistCheckpoint };
  const checkpoint = () => io.persist(() => saveJson(path.join(root, 'engine-result.json'), result));
  checkpoint();
  const key = randomBytes(32); // Signing material is memory-only; never exported with evidence.
  const hostRoot = dir('host'), shareRoot = dir('share'), workRoot = dir('work');
  const journal = new SqliteJournal(path.join(root, 'journal.sqlite'), now);
  const schedStore = new SqliteSchedStore(path.join(root, 'scheduler.sqlite'));
  const store = new OmbStore({ root: dir('store'), hostKey: key, now, separation: 'single-user' });
  const startedAt = now(), remaining = () => Math.max(1, o.capMs - (now() - startedAt));
  try {
    const pixi = path.join(o.repoRoot, 'packages/bio-baseline/.pixi/envs/default');
    const pixiEnv = existsSync(pixi) ? realpathSync(pixi) : pixi;
    const nodeRoot = path.dirname(realpathSync(process.execPath));
    const sched = Scheduler.open({ now, store: schedStore, quota: { read: () => null },
      resources: o.live ? osResourceProbe({ loadavg, vmStat: () => spawnSync('vm_stat', { encoding: 'utf8' }).stdout, pressureLevel: () => spawnSync('sysctl', ['-n', 'kern.memorystatus_vm_pressure_level'], { encoding: 'utf8' }).stdout.trim() }) : { sample: () => ({ load1: 0, availableMemBytes: 12 * GiB, pressure: 'normal' }) },
      policy: { pools: { codex: { model: process.env.OMB_CODEX_MODEL?.trim() || 'gpt-6-astra' }, claude: { model: process.env.OMB_CLAUDE_MODEL || LIVE_DEFAULTS.claudeModel } }, admission: { warmupMs: 0, ...(process.env.OMB_LOAD_CEILING ? { loadCeiling: Number(process.env.OMB_LOAD_CEILING) } : {}) }, ...weeklyBandsFromEnv(), attempts: { maxAttempts: o.live ? 2 : 1 } },
    });
    const fleet = new Fleet({ sched, now, ...(o.development ? {fatal:(e:unknown)=>e instanceof Divergence||e instanceof InvestigationPaused} : {}), waitUntil: async at => {
      if (now() - startedAt >= o.capMs) throw new Error('Amani wall cap reached; unfinished work is not verified');
      if (o.live) await new Promise<void>(r => setTimeout(r, Math.min(remaining(), Math.max(1, at - now()), 1000)));
    }, idleWaitMs: 1000, maxIdleWaits: o.live ? Math.ceil(o.capMs / 1000) : 1 });
    const runner = workerRuntimeRunner(progressRunner({ now }));
    const toolPath = `${pixiEnv}/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin`;
    const codexCli = process.env.OMB_CODEX_CLI || LIVE_DEFAULTS.codexCli;
    const claudeCli = process.env.OMB_CLAUDE_CLI || LIVE_DEFAULTS.claudeCli;
    const codexAuthFile = path.join(homedir(), '.codex/auth.json');
    const rawWorkers = o.workers ?? (o.live ? {
      codex: new CodexAdapter({ stateRoot: dir('adapters/codex-state'), scratchRoot: dir('adapters/codex-scratch'), cliPath: codexCli, authFile: codexAuthFile, now, runner, schemas: WORKER_SCHEMAS, toolPath }),
      claude: new ClaudeAdapter({ stateRoot: dir('adapters/claude-state'), scratchRoot: dir('adapters/claude-scratch'), cliPath: claudeCli, cliVersion: PINNED_CLAUDE_VERSION, keychainDir: path.join(homedir(), 'Library/Keychains'), now, runner, schemas: WORKER_SCHEMAS, toolPath }),
    } : { codex: offlineWorker, claude: offlineWorker });
    const recording = new TurnCassette({root:dir('host/cassette'),roots:[[root,'$AMANI'],[o.task.dir,'$TASK']],mode:'record'});
    const workerWrap=o.development?.wrapWorker ?? ((worker:WorkerAdapter)=>process.env.AMANI_RECORD_TURNS==='1'?recording.wrap(worker):worker);
    let promptSequence = 0;
    let trustedIntegrity: Json = null;
    const promptArchive = dir('host/amani-prompts');
    const wrap = (worker: WorkerAdapter) => reportWorker({ run: async s => { const r = await workerWrap(worker).run({ ...s, timeoutMs: Math.min(s.timeoutMs, remaining()) }); (result.workerAudit ??= []).push(auditTurn(root, s, r, o.live)); checkpoint(); return r; } }, o.task.template, draft => { result.draft = draft; checkpoint(); }, () => ({ taskInstructions: o.task.prompt, trustedIntegrity, claims: result.evidence.claims.map(c => ({ claimId: c.claimId, status: c.taskStatus, voided: c.voided })), metrics: result.evidence.metrics, frozenTaskResult: result.evidence.outputs['task-results.json'] ?? null, frozenPrimary: result.evidence.outputs['primary.json'] ?? null, outputs: Object.fromEntries(Object.entries(result.evidence.outputs).map(([k, v]) => [k, shape(v)])) }), (phase, prompt) => writeFileSync(path.join(promptArchive, `${++promptSequence}-${phase.replace(/[^a-z-]/g, '_')}.txt`), prompt, { mode: 0o600 }));
    const execOptions = { toolPath: `${pixiEnv}/bin:${nodeRoot}:/usr/bin:/bin`, runtimeRoots: [pixiEnv, nodeRoot], timeoutMs: Math.min(900_000, o.capMs) };
    const executor = new KernelExecutor({ ...execOptions, scratchRoot: dir('kernel/exec'), now });
    const certifier = new ThreadKernelCertifier({ stateRoot: dir('kernel/certify'), hostKey: key, executor: { ...execOptions, scratchRoot: dir('kernel/certify-exec') } });
    const ledger = new StoreLedger(store, new StoreJournal(store, now)), registry = new StoreRegistry(store);
    const stager = new TabularStager({ hostRoot, shareRoot });
    let inv: Investigation;
    const deps: InvestigationDeps = {
      faultAt: point => {
        o.development?.onPhase?.(point);
        if((o.development||process.env.AMANI_RECORD_TURNS==='1')&&point.startsWith('phase:')&&point.endsWith(':completed')){
          const phase=point.split(':')[1]!;
          const output=inv.machine.output<import('../../omb-investigate/src/types.ts').PhaseOutputBase & {lead?:{workdir:string}}>(phase as import('../../omb-investigate/src/types.ts').PhaseId);
          const lead=output?.lead??inv.machine.completed().findLast(p=>p.output.lead)?.output.lead as {workdir:string}|undefined;
          if(lead?.workdir&&existsSync(lead.workdir)){const target=path.join(root,'host/dev-snapshots',phase);rmSync(target,{recursive:true,force:true});copyPlain(lead.workdir,target);}
        }
        if (point.startsWith('phase:') && point.endsWith(':started')) {
          result.phases = [...(result.phases ?? []), point.split(':')[1]!];
          result.replans = inv.machine.notes('plan-replanned');
          result.planAmendments = inv.machine.notes('plan-amendment');
          result.parks = inv.machine.notes('triage-parked'); checkpoint();
        }
      },
      journal, fleet, workers: { codex: wrap(rawWorkers.codex), claude: wrap(rawWorkers.claude) },
      ...(o.live && !o.workers ? {providers:configuredProviders({root:dir("providers"),repoRoot:o.repoRoot,now,toolPath,codexCli,claudeCli,wrap})} : {}), ledger, registry, now,
      stager: o.task.mode === 'card' ? cardStager(stager, o.task, staged => {
        const inventory = computeCardIntegrity({ publicContract: o.task.publicContract ?? null, dataDir: staged.realDataDir, key: createHmac('sha256', key).update('omb-amani/card-integrity/v1').digest() });
        result.evidence.integrity = writeCardIntegrity(dir('host/card-integrity'), inventory);
        trustedIntegrity = result.evidence.integrity.value; checkpoint();
      }) : stager,
      executor: { health: () => executor.health(), timeoutBudget: executor.timeoutBudget, run: async req => {
        const exec = await executor.run({ ...req, timeoutMs: Math.min(req.timeoutMs ?? execOptions.timeoutMs, remaining(), execOptions.timeoutMs) });
        if (req.mode === 'look' && exec.status === 'ok' && exec.outputsHash) {
          result.evidence.outputs = {};
          for (const f of exec.files.filter(f => f.endsWith('.json'))) {
            try { result.evidence.outputs[f] = readJson(path.join(req.outDir, f)); } catch { result.warnings.push(`unreadable frozen output: ${f}`); }
          }
          result.frozen = req.bundleDir; checkpoint();
        }
        return exec;
      } },
      certifier: { certify: async req => { const c = await certifier.certify(req); result.evidence = certifiedEvidence(result.evidence, c); if (c.integrity && (!object(trustedIntegrity) || trustedIntegrity.status !== 'observed' || c.integrity.status === 'observed')) trustedIntegrity = c.integrity as unknown as Json; checkpoint(); return c; } },
      ...(o.task.mode === 'pilot' ? { contracts: liveContracts(o.repoRoot, dir('contracts')) } : {}),
      preflight: o.live ? livePreflight({ codexCli, codexAuthFile, claudeCli, pixiEnv, diskRoot: root }) : { check: async () => [] },
      host: { osUserSeparation: false, sandboxBackend: 'seatbelt' }, paths: { hostRoot, shareRoot, workRoot },
      runtimeMounts: o.live ? [pixiEnv] : [], policy: { turnTimeoutMs: o.capMs, planRepairRounds: o.live ? 5 : 0, replicate: o.live, keepWorkdirs: !!o.development || process.env.AMANI_KEEP_DIAGNOSTICS === '1' },
    };
    o.development?.configure(deps);
    const create = () => inv = new Investigation({id:o.id,question:o.task.prompt,plainStatement:'Answer the task using only software-verified evidence.',dataset:{datasetId:o.task.datasetId,dataRoot:o.task.dataRoot,expectedManifestHash:o.task.expectedManifestHash??null},route:'P',taskPromptFile:path.join(o.task.dir,'TASK.md')},deps);
    const execute = async (run: () => Promise<DeliverableOut>) => {
    await o.development?.initialize?.(inv,result);
    trustedIntegrity=result.evidence.integrity?.value??trustedIntegrity;
    let out: DeliverableOut | undefined;
    try { out = await run(); }
    catch (e) { result.status = 'error'; result.warnings.push(String(e)); }
    if (out) {
      result.status = attemptStatus(out.status, inv.machine.notes('paused').at(-1)); result.deliverable = out.dir;
      if (out.status === 'complete' || out.status === 'hard-stop') result.evidence.claims = out.claims;
      if (out.status === 'complete') {
        try { const integrity = readDeliverableIntegrity(out.dir, out.files); if (integrity && object(integrity.value) && integrity.value.status === 'observed') result.evidence.integrity = integrity; }
        catch (error) { result.status = 'hard-stop'; result.evidence = { metrics: {}, outputs: {}, claims: [] }; result.warnings.push(String(error)); }
      }
      if (out.status === 'hard-stop') result.evidence = { metrics: {}, outputs: {}, claims: out.claims };
    }
    result.replans = inv.machine.notes('plan-replanned'); result.planAmendments = inv.machine.notes('plan-amendment');
    result.parks = [...inv.machine.notes('paused'), ...inv.machine.notes('triage-parked')];
    result.warnings.push(...inv.machine.notes('warning').map(v => JSON.stringify(v)));
    // A frozen path is useful only while its bytes still match the recorded look bundle.
    const look = inv.machine.output<import('../../omb-investigate/src/types.ts').PhaseOutputBase & { frozen?: { dir: string; hash: string } }>('look');
    if (result.frozen && look?.frozen && treeHash(result.frozen) !== look.frozen.hash) {
      result.evidence = { metrics: {}, outputs: {}, claims: [] }; result.frozen = null; result.status = 'hard-stop'; result.warnings.push('trusted-path-changed: frozen code');
    }
    checkpoint(); return result;
    };
    // BEGIN TEMPORARY MEDIC SEAM
    if (developmentAuthorized(o.medic === true) && !o.development) {
      return await (await import('./medic/runtime.ts')).runWithMedic({ authorized:true, root, repo:o.repoRoot, pixiEnv, deps, journal, result, io, create, execute, checkpoint });
    }
    // END TEMPORARY MEDIC SEAM
    create(); return await execute(() => inv.run());
  } finally {
    journal.close(); schedStore.close(); store.close();
    rmSync(path.join(root, 'host.key'), { force: true });
    if (process.env.AMANI_KEEP_DIAGNOSTICS === '1') { try { retainAdapterEvidence(root); } catch { result.warnings.push('adapter diagnostics retention failed'); } }
    if (result.status !== 'needs-medic' && !o.development && process.env.AMANI_KEEP_DIAGNOSTICS !== '1') rmSync(workRoot, { recursive: true, force: true });
    // Adapter-owned ephemeral session/auth state is never part of the exported attempt.
    rmSync(path.join(root, 'adapters'), { recursive: true, force: true });
  }
}
function shape(v: Json): Json { return Array.isArray(v) ? v.map(shape) : object(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shape(x)])) : typeof v; }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = JSON.parse(readFileSync(process.argv[2]!, 'utf8')) as { taskDir: string; expectedManifestHash?: string; mode: 'card' | 'pilot'; root: string; repoRoot: string; id: string; capMs: number; live: boolean; medic?:boolean };
  const task = loadTask(config.taskDir, config.mode);
  if (config.expectedManifestHash && config.expectedManifestHash !== task.expectedManifestHash) throw new Error('task data changed after outer load');
  runEngine({ ...config, task, now: Date.now }).catch(e => { process.stderr.write(String(e) + '\n'); process.exitCode = 1; });
}

/** Development-only override of the scheduler's weekly quota bands, e.g. OMB_QUOTA_WEEKLY="97,98,99"
 * (all, confirm, replication). Unset keeps the protective defaults (70/85/95). */
export function weeklyBandsFromEnv(): { quota?: { weeklyAll: number; weeklyConfirm: number; weeklyReplication: number } } {
  const raw = process.env.OMB_QUOTA_WEEKLY?.trim();
  if (!raw) return { quota: { weeklyAll: 70, weeklyConfirm: 85, weeklyReplication: 95 } };
  if (process.env.OMB_DEVELOPMENT !== '1') throw new Error('OMB_QUOTA_WEEKLY requires OMB_DEVELOPMENT=1');
  const bands = raw.split(',').map(v => v.trim() ? Number(v) : NaN);
  const [weeklyAll = NaN, weeklyConfirm = NaN, weeklyReplication = NaN] = bands;
  if (bands.length !== 3 || !bands.every(n => Number.isFinite(n) && n >= 0 && n <= 100) || !(weeklyAll <= weeklyConfirm && weeklyConfirm <= weeklyReplication))
    throw new Error('OMB_QUOTA_WEEKLY must be three ascending percentages: all,confirm,replication');
  return { quota: { weeklyAll, weeklyConfirm, weeklyReplication } };
}
