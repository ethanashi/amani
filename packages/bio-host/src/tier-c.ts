import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { freemem, loadavg } from 'node:os';
import path from 'node:path';
import { canonicalSha256 } from '../../bio-core/src/index.ts';
import { InvestigationLedger } from '../../bio-ledger/src/index.ts';
import { CodexAdapter, ClaudeAdapter } from '../../omb-adapters/src/index.ts';
import { LITERATURE_SCHEMAS } from '../../omb-literature/src/index.ts';
import { Scheduler } from '../../omb-sched/src/index.ts';
import { OmbStore } from '../../omb-store/src/index.ts';
import { SqliteJournal } from '../../omb-investigate/src/journal.ts';
import { StoreLedger, StoreRegistry, StoreJournal, SqliteSchedStore } from '../../omb-investigate/src/store-adapter.ts';
import { Fleet } from '../../omb-investigate/src/fleet.ts';
import { KernelExecutor } from '../../omb-investigate/src/kernel.ts';
import { ThreadKernelCertifier } from '../../omb-investigate/src/thread-certifier.ts';
import { TabularStager } from '../../omb-investigate/src/tabular.ts';
import { TaskContractPort, authorDraftPolicy } from '../../omb-investigate/src/contracts.ts';
import { WORKER_SCHEMAS } from '../../omb-investigate/src/turns.ts';
import type { InvestigationDeps, DeliverableOut } from '../../omb-investigate/src/investigation.ts';
import type { InvestigationSpec } from '../../omb-investigate/src/types.ts';
import { createTierCInvestigation, type HostLiteratureConfig, type LiteratureIO } from './literature.ts';
import { inside, privateDirectory, privateFile } from './paths.ts';

export interface TierCConfig {
  tier: 'C';
  investigation: InvestigationSpec;
  literature?: HostLiteratureConfig;
  runtime: { codexCli: string; codexAuthFile?: string; claudeCli: string; keychainDir?: string; pixiEnv: string; contractsRoot: string; codexModel: string; claudeModel: string };
}
export interface TierCOptions extends LiteratureIO {
  now: () => number;
  approval?: InvestigationDeps['approval'];
  /** Trusted integration-test seam; never read from investigation.json. */
  dependencies?: InvestigationDeps;
}
/** Production Tier C root. Analysis stays behind the existing offline kernel; only the literature
 * broker owns academic HTTP. All adapter state, cache and decisions are outside worker scopes. */
export async function runTierCInvestigation(directory: string, config: TierCConfig, options: TierCOptions): Promise<DeliverableOut> {
  if (config.tier !== 'C' || !config.investigation || !config.runtime || !['P', 'H'].includes(config.investigation.route)) throw new Error('invalid Tier C configuration');
  const root = privateDirectory(path.resolve(directory)), authority = privateDirectory(path.join(root, 'authority'));
  if (inside(root, path.resolve(config.investigation.dataset.dataRoot)) || inside(path.resolve(config.investigation.dataset.dataRoot), root)) throw new Error('Tier C raw data and host scopes must be disjoint');
  const lockFile = path.join(authority, 'tier-c-lock.sqlite'); privateFile(lockFile);
  const fresh = !existsSync(lockFile), lock = new InvestigationLedger(lockFile, 'tier-c-host', { now: options.now });
  let token: string | undefined, journal: SqliteJournal | undefined, store: OmbStore | undefined, schedStore: SqliteSchedStore | undefined;
  try {
    if (fresh) lock.create(); token = lock.acquire();
    const pinFile = path.join(authority, 'tier-c-config.json'); privateFile(pinFile);
    const pin = canonicalSha256(config);
    if (existsSync(pinFile)) { if (readFileSync(pinFile, 'utf8') !== pin) throw new Error('Tier C configuration changed on resume'); }
    else writeFileSync(pinFile, pin, { mode: 0o600, flag: 'wx' });
    let deps = options.dependencies;
    if (!deps) {
      const dir = (...parts: string[]) => privateDirectory(path.join(root, ...parts));
      const runtime = config.runtime, now = options.now;
      for (const p of [runtime.codexCli, runtime.claudeCli, runtime.pixiEnv, runtime.contractsRoot]) if (!path.isAbsolute(p)) throw new Error('absolute Tier C runtime paths required');
      const keyFile = path.join(authority, 'host.key'); privateFile(keyFile);
      if (!existsSync(keyFile)) writeFileSync(keyFile, randomBytes(32), { mode: 0o600, flag: 'wx' });
      const key = readFileSync(keyFile);
      journal = new SqliteJournal(path.join(authority, 'journal.sqlite'), now);
      store = new OmbStore({ root: dir('authority', 'store'), hostKey: key, now, separation: 'single-user' });
      schedStore = new SqliteSchedStore(path.join(authority, 'scheduler.sqlite'));
      const sched = Scheduler.open({ now, store: schedStore, quota: { read: () => null },
        resources: { sample: () => ({ load1: loadavg()[0]!, availableMemBytes: freemem(), pressure: 'normal' }) },
        policy: { pools: { codex: { model: runtime.codexModel }, claude: { model: runtime.claudeModel } } } });
      const fleet = new Fleet({ sched, now, waitUntil: at => new Promise(resolve => setTimeout(resolve, Math.max(0, at - now()))) });
      const schemas = { ...WORKER_SCHEMAS, ...LITERATURE_SCHEMAS }, toolPath = `${runtime.pixiEnv}/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin`;
      const codex = new CodexAdapter({ stateRoot: dir('adapters', 'codex-state'), scratchRoot: dir('adapters', 'codex-scratch'), cliPath: runtime.codexCli,
        ...runtime.codexAuthFile && { authFile: runtime.codexAuthFile }, now, schemas, toolPath });
      const claude = new ClaudeAdapter({ stateRoot: dir('adapters', 'claude-state'), scratchRoot: dir('adapters', 'claude-scratch'), cliPath: runtime.claudeCli,
        ...runtime.keychainDir && { keychainDir: runtime.keychainDir }, now, schemas, toolPath });
      const nodeRoot = path.dirname(realpathSync(process.execPath));
      const exec = { toolPath: `${runtime.pixiEnv}/bin:${nodeRoot}:/usr/bin:/bin`, runtimeRoots: [runtime.pixiEnv, nodeRoot], timeoutMs: 900_000 };
      deps = { journal, fleet, workers: { codex, claude }, now,
        ledger: new StoreLedger(store, new StoreJournal(store, now)), registry: new StoreRegistry(store),
        stager: new TabularStager({ hostRoot: dir('host'), shareRoot: dir('share') }),
        executor: new KernelExecutor({ ...exec, scratchRoot: dir('kernel', 'exec'), now }),
        certifier: new ThreadKernelCertifier({ stateRoot: dir('kernel', 'certify'), hostKey: key, executor: { ...exec, scratchRoot: dir('kernel', 'certify-exec') } }),
        contracts: new TaskContractPort({ contractsRoot: runtime.contractsRoot, cacheRoot: dir('host', 'contracts'), approval: authorDraftPolicy() }),
        host: { osUserSeparation: false, sandboxBackend: 'seatbelt' }, runtimeMounts: [runtime.pixiEnv],
        paths: { hostRoot: dir('host'), shareRoot: dir('share'), workRoot: dir('work') } };
    }
    return await createTierCInvestigation(config.investigation, { ...deps, ...options.approval && { approval: options.approval } }, config.literature, options).run();
  } finally { journal?.close(); schedStore?.close(); store?.close(); try { if (token) lock.release(token); } finally { lock.close(); } }
}
