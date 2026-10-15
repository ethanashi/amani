import { configuredProviders } from './provider-factory.ts';
import {runUntilSettled, type SettleOptions} from "./pause.ts";
import { Connectivity, httpsProbe } from "./network.ts";
import { progressRunner } from "./liveness.ts";
// LIVE smoke wiring (block V7 acceptance, design §8: "Live run on w0, p1, p10"). Real Codex lead
// workers (Codex default pool; Claude secondary and the G7 replicator) through omb-sched, real
// staging from bio-tasks, the real omb-certify kernel. NOT run by the builder: it spends quota and
// must wait for the locked pilot to finish (quiet machine) and for the owner's OS-user setup.
// The authority protocol selects native confirmation per investigation; unavailable or refused
// preparation retains the explicit degraded single-user cap.

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { accessSync, constants as fsConstants, existsSync, mkdirSync, readFileSync, realpathSync, statfsSync, writeFileSync, renameSync } from "node:fs";
import { homedir, loadavg } from "node:os";
import path from "node:path";
import { ClaudeAdapter, CodexAdapter, PINNED_CLAUDE_CLI, PINNED_CLAUDE_VERSION } from "../../omb-adapters/src/index.ts";
import { authorDraftPolicy, TaskContractPort } from "./contracts.ts";
import { LauncherNativeSession } from "./launcher-native.ts";
import { selectLiveWiring } from "./live-wiring.ts";
import { LauncherAttestation } from "./os-attestation.ts";
import { osResourceProbe, Scheduler } from "../../omb-sched/src/index.ts";
import { Fleet } from "./fleet.ts";
import { Investigation, type DeliverableOut } from "./investigation.ts";
import { anchorInvestigation } from './terminal-anchor.ts';
import { SqliteJournal } from "./journal.ts";
import { KernelExecutor } from "./kernel.ts";
import { ThreadKernelCertifier } from "./thread-certifier.ts";
export { liveContractAuthority } from "./thread-certifier.ts";
import { OmbStore } from "../../omb-store/src/index.ts";
import { StoreLedger, StoreRegistry, StoreJournal, SqliteSchedStore } from "./store-adapter.ts";
import { TabularStager } from "./tabular.ts";
import { WORKER_SCHEMAS } from "./turns.ts";
import type { PreflightPort } from "./ports.ts";

/** Both providers' dev shells inherit this host-set environment. */
export function workerRuntimeRunner(runner: ReturnType<typeof progressRunner>): ReturnType<typeof progressRunner> {
  return launch => runner({ ...launch, env: { ...launch.env, PYTHONDONTWRITEBYTECODE: "1" } });
}

export const SMOKE_TASKS = ["w0-venet", "p1-esr1", "p10-pseudorep"] as const;

export interface AttemptRecord { id: string; status: string; reason: string | null }

/**
 * Infrastructure is never a science result: an investigation that ends as `infrastructure` (a model
 * turn never ran: network outage, CLI or API failure) is retried as a fresh investigation after a
 * pause; every attempt is reported. Any other outcome, including science outcomes, is final.
 */
export async function withInfrastructureRetries(
  run: (attempt: number) => Promise<DeliverableOut>,
  o: { retries: number; pauseMs: number; sleep?: (ms: number) => Promise<void>; onAttempt?: (a: AttemptRecord) => void },
): Promise<{ out: DeliverableOut; attempts: AttemptRecord[] }> {
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const attempts: AttemptRecord[] = [];
  for (let attempt = 1; ; attempt++) {
    const out = await run(attempt);
    const record = { id: out.dir, status: out.status, reason: out.outcome?.reason ?? null };
    attempts.push(record);
    o.onAttempt?.(record);
    if (out.status !== "infrastructure" || attempt > o.retries) return { out, attempts };
    await sleep(o.pauseMs);
  }
}

export interface LivePreflightOptions {
  codexEnabled?:boolean;claudeEnabled?:boolean;
  codexCli: string; codexAuthFile: string; claudeCli: string; pixiEnv: string;
  /** Directory whose filesystem must keep this much free space. */
  diskRoot: string; diskFloorBytes?: number;
}

/**
 * Infrastructure checks before the first model turn (omb-gauntlet PREFLIGHT_KINDS). The first live
 * smoke ran Codex workers without credentials (401 on every turn); this catches that, and missing
 * CLIs, analysis environment or disk, before anything is spent. It never prints a credential.
 */
export function livePreflight(o: LivePreflightOptions): PreflightPort {
  return {
    async check() {
      const failing = new Set<string>();
      for (const cli of [...(o.codexEnabled!==false?[o.codexCli]:[]),...(o.claudeEnabled!==false?[o.claudeCli]:[])]) { try { accessSync(cli, fsConstants.X_OK); } catch { failing.add("cli-missing"); } }
      if(o.codexEnabled!==false)try {
        const auth = JSON.parse(readFileSync(o.codexAuthFile, "utf8")) as { tokens?: { access_token?: unknown }; OPENAI_API_KEY?: unknown };
        const token = typeof auth.tokens?.access_token === "string" && auth.tokens.access_token.length > 0;
        const key = typeof auth.OPENAI_API_KEY === "string" && auth.OPENAI_API_KEY.length > 0;
        if (!token && !key) failing.add("cli-unauthenticated");
      } catch { failing.add("cli-unauthenticated"); }
      if (!existsSync(path.join(o.pixiEnv, "bin", "python"))) failing.add("analysis-env-missing");
      try { const f = statfsSync(o.diskRoot); if (f.bavail * f.bsize < (o.diskFloorBytes ?? 10 * 1024 ** 3)) failing.add("disk-floor"); } catch { failing.add("disk-floor"); }
      return [...failing].sort();
    },
  };
}

export interface LiveSmokeOptions {
  repoRoot: string;
  /** Evidence root (journal, staged data, deliverables). Never ~/.omerta-bio/pilots or grading. */
  root: string;
  tasks: readonly string[];
  codexCli: string;
  /** Codex credentials copied (frozen, 0400) into each worker's own CODEX_HOME. */
  codexAuthFile?: string;
  claudeCli: string;
  claudeModel: string;
  /** Admission load ceiling (omb-sched default 9; the smoke needs a quiet machine). */
  loadCeiling?: number;
  /** Fresh-investigation retries after an infrastructure terminal (default 2), pause between (default 2 min). */
  networkCapMs?: number;
  silenceMs?: number;
  infraRetries?: number;
  infraPauseMs?: number;
  log?: (line: string) => void;
}

export interface LiveSmokeResult {
  root: string;
  investigations: { task: string; id: string; status: string; claims: { claimId: string; status: string }[]; deliverable: string | null; error: string | null; attempts: AttemptRecord[] }[];
}

function refusePrivateRoots(root: string): void {
  const home = homedir();
  for (const forbidden of [path.join(home, ".omerta-bio", "pilots"), path.join(home, ".omerta-bio", "grading")]) {
    const r = path.resolve(root);
    if (r === forbidden || r.startsWith(forbidden + path.sep)) throw new Error(`refusing ${forbidden}: the locked pilot owns it`);
  }
  const grading = process.env.BIO_GRADING_ROOT;
  if (!grading) throw new Error("set a private BIO_GRADING_ROOT for the kernel's native supervisor cache");
  if (path.resolve(grading) === path.join(home, ".omerta-bio", "grading")) throw new Error("refusing the default grading root: the locked pilot needs its operation lease");
}

/** Stage one pilot task with bio-tasks (deterministic, verified against the card's manifest). */
export function stagePilotTask(repoRoot: string, task: string, out: string): { dataRoot: string; taskFile: string } {
  const python = path.join(repoRoot, "packages", "bio-baseline", ".pixi", "envs", "default", "bin", "python");
  if (!existsSync(python)) throw new Error("bio-baseline pixi env missing: pixi install --frozen --manifest-path packages/bio-baseline/pixi.toml");
  const env = { ...process.env, PYTHONPATH: path.join(repoRoot, "packages", "bio-tasks", "lib") };
  const commands = existsSync(path.join(out, "TASK.md")) ? [["verify-stage", task, out]] : [["stage", task, "--out", out], ["verify-stage", task, out]];
  for (const args of commands) {
    const r = spawnSync(python, ["-m", "biotasks", ...args], { cwd: repoRoot, env, encoding: "utf8", timeout: 600_000 });
    if (r.status !== 0) throw new Error(`biotasks ${args[0]} ${task} failed: ${(r.stderr || r.stdout).slice(0, 500)}`);
  }
  return { dataRoot: path.join(out, "data"), taskFile: path.join(out, "TASK.md") };
}

/**
 * The live ContractPort: the committed bio-tasks contracts (host index pins + public layers), opened
 * into a host-only cache under the smoke root. Author drafts are approved by the recorded host
 * policy (actor "policy", journaled), never as an owner review. Sealed public material (w0) needs
 * the host seal-v2 key (BIO_SEALING_KEY, default ~/.omerta-bio/keys/sealing.key); without it the w0
 * pin is refused before any model turn.
 */
export function liveContracts(repoRoot: string, cacheRoot: string, sealingKeyFile = process.env.BIO_SEALING_KEY ?? path.join(homedir(), ".omerta-bio", "keys", "sealing.key")): TaskContractPort {
  return new TaskContractPort({
    contractsRoot: path.join(repoRoot, "packages", "bio-tasks", "contracts"), cacheRoot, approval: authorDraftPolicy(),
    sealingKey: () => { try { return existsSync(sealingKeyFile) ? readFileSync(sealingKeyFile) : null; } catch { return null; } },
  });
}

function hostKey(file: string): Buffer {
  if (!existsSync(file)) writeFileSync(file, randomBytes(32), { mode: 0o600, flag: "wx" });
  return readFileSync(file);
}

/** Stable investigation IDs are necessary for durable scheduler/journal replay. */
export function smokeIdentity(root: string, tasks: readonly string[], now: number): { stamp: string; tasks: string[]; startedAt: number } {
  const file = path.join(root, "smoke-identity.json"), ordered = [...tasks].sort();
  if (existsSync(file)) {
    const saved = JSON.parse(readFileSync(file, "utf8")) as { stamp: string; tasks: string[]; startedAt: number };
    if (!/^[0-9]{14}$/.test(saved.stamp) || !Number.isFinite(saved.startedAt) || JSON.stringify(saved.tasks) !== JSON.stringify(ordered)) throw new Error("smoke root identity or task set changed");
    return saved;
  }
  const stamp = /^[0-9]{14}$/.test(path.basename(root)) ? path.basename(root) : new Date(now).toISOString().replace(/[^0-9]/g, "").slice(0, 14);
  const identity = { stamp, tasks: ordered, startedAt: now };
  writeFileSync(file, JSON.stringify(identity), { flag: "wx", mode: 0o600, flush: true });
  return identity;
}

export async function runLiveSmoke(o: LiveSmokeOptions): Promise<LiveSmokeResult> {
  refusePrivateRoots(o.root);
  const log = o.log ?? ((line: string) => process.stdout.write(line + "\n"));
  const now = () => Date.now();
  const root = (mkdirSync(o.root, { recursive: true, mode: 0o700 }), realpathSync(o.root));
  const dir = (...p: string[]) => { const d = path.join(root, ...p); mkdirSync(d, { recursive: true, mode: 0o700 }); return d; };
  const identity = smokeIdentity(root, o.tasks, now());
  const pixiEnv = realpathSync(path.join(o.repoRoot, "packages", "bio-baseline", ".pixi", "envs", "default"));
  const nodeRoot = path.dirname(realpathSync(process.execPath));
  const key = hostKey(path.join(dir("keys"), "host.key"));

  const journal = new SqliteJournal(path.join(root, "journal.sqlite"), now);
  const schedStore = new SqliteSchedStore(path.join(root, "scheduler.sqlite"));
  const store = new OmbStore({ root: dir("store"), hostKey: key, now, separation: "single-user" });
  const sched = Scheduler.open({
    now, store: schedStore,
    // No quota reader is wired here: probe mode (one job per provider at a time), the conservative setting.
    quota: { read: () => null },
    resources: osResourceProbe({
      loadavg: () => loadavg(),
      vmStat: () => { const r = spawnSync("vm_stat", { encoding: "utf8" }); return r.status === 0 ? r.stdout : null; },
      pressureLevel: () => { const r = spawnSync("sysctl", ["-n", "kern.memorystatus_vm_pressure_level"], { encoding: "utf8" }); return r.status === 0 ? r.stdout.trim() : null; },
    }),
    policy: { pools: { claude: { model: o.claudeModel } }, ...(o.loadCeiling ? { admission: { loadCeiling: o.loadCeiling } } : {}) },
  });
  const waitUntil = (ms: number) => new Promise<void>(r => setTimeout(r, Math.max(0, ms - now())));
  const network = new Connectivity({ now, waitUntil, probe: httpsProbe({ now }), journal, ...(o.networkCapMs === undefined ? {} : { capMs: o.networkCapMs }) });
  const fleet = new Fleet({ sched, now, waitUntil, network, idleWaitMs: 5_000 });
  const supervisedRunner = progressRunner({ now, ...(o.silenceMs === undefined ? {} : { silenceMs: o.silenceMs }) });
  const runner = workerRuntimeRunner(supervisedRunner);
  const toolPath = `${pixiEnv}/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin`;
  const codexAuthFile = o.codexAuthFile ?? path.join(homedir(), ".codex", "auth.json");
  const codex = new CodexAdapter({ stateRoot: dir("adapters", "codex-state"), scratchRoot: dir("adapters", "codex-scratch"), cliPath: o.codexCli, authFile: codexAuthFile, now, runner, schemas: WORKER_SCHEMAS, toolPath });
  const preflight = livePreflight({ codexCli: o.codexCli, codexAuthFile, claudeCli: o.claudeCli, pixiEnv, diskRoot: root,codexEnabled:sched.policy.pools.codex.sessions>0,claudeEnabled:sched.policy.pools.claude.sessions>0 });
  const claude = new ClaudeAdapter({
    stateRoot: dir("adapters", "claude-state"), scratchRoot: dir("adapters", "claude-scratch"), cliPath: o.claudeCli, cliVersion: PINNED_CLAUDE_VERSION,
    keychainDir: path.join(homedir(), "Library", "Keychains"), now, runner, schemas: WORKER_SCHEMAS, toolPath,
  });
  const execOptions = { toolPath: `${pixiEnv}/bin:${nodeRoot}:/usr/bin:/bin`, runtimeRoots: [pixiEnv, nodeRoot], timeoutMs: 900_000 };
  const executor = new KernelExecutor({ ...execOptions, scratchRoot: dir("kernel", "exec"), now });
  const certifier = new ThreadKernelCertifier({ stateRoot: dir("kernel", "certify"), hostKey: key, executor: { ...execOptions, scratchRoot: dir("kernel", "certify-exec") } });
  const contracts = liveContracts(o.repoRoot, dir("host", "contracts"));
  const ledger = new StoreLedger(store, new StoreJournal(store, now)), registry = new StoreRegistry(store);
  const stager = new TabularStager({ hostRoot: dir("host"), shareRoot: dir("share") });
  // OS-user separation requires the real launcher attestation plus successful authority
  // preparation below. Exploratory/synthetic execution does not supply certification gates.
  const attestation = new LauncherAttestation();
  const attested = await attestation.attest();
  log(`omb-investigate live smoke: root ${root}; launcher ${attested.attested ? `attested (release ${attested.attestation.releaseHash.slice(0, 12)})` : `not attested (${attested.reason})`}; authority preparation selects native wiring per investigation; unavailable preparation remains explicitly degraded`);

  const stamp = identity.stamp;
  const result: LiveSmokeResult = { root, investigations: [] };
  const save = () => {
    const summary = { ...result, startedAt: identity.startedAt, wallMs: now() - identity.startedAt,
      turns: sched.jobs().filter(j => j.spec.family !== null).reduce((n, j) => n + j.dispatchCount, 0),
      networkEvents: journal.read("network").map(e => ({ type: e.type, at: e.at, payload: e.payload })) };
    writeFileSync(path.join(root, "summary.json.tmp"), JSON.stringify(summary, null, 2) + "\n", { mode: 0o600, flush: true });
    renameSync(path.join(root, "summary.json.tmp"), path.join(root, "summary.json"));
  };
  await Promise.all(o.tasks.map(async (task) => {
    const base = `smoke-${task}-${stamp}`;
    try {
      const staged = stagePilotTask(o.repoRoot, task, path.join(dir("raw"), task));
      const title = readFileSync(staged.taskFile, "utf8").split("\n").find((l) => l.trim())?.replace(/^#+\s*/, "") ?? task;
      const id=base;
      const wiring=await selectLiveWiring({attested, fallback:{ledger,stager}, prepare:async pins=>{
        const pin=await contracts.pin({datasetId:task,dataRoot:staged.dataRoot});
        if(!pin)throw new Error("no verified K1 contract available");
        const data=await stager.stage({investigationId:id,datasetId:task,dataRoot:staged.dataRoot,expectedManifestHash:null,contract:pin,route:"P",publicText:readFileSync(staged.taskFile,"utf8")});
        const session=await LauncherNativeSession.open({investigationId:id,root:dir("authority",id),pins,staged:data,contract:pin,literatureJournal:journal});
        // The authority hashes the contract input including public alias registries. Keep local
        // trusted-path checks bound to exactly those transferred bytes.
        const prepared={...data,manifestHash:data.contractInput!.manifestHash,realDataDir:data.contractInput!.dir};
        return {ledger:session.ledger,confirmation:session.confirmation,stager:{stage:async()=>prepared,scramble:stager.scramble.bind(stager),synthesize:stager.synthesize.bind(stager)}};
      }});
      log(`${id}: ${wiring.reason}`);
      const attempts:AttemptRecord[]=[];
      const {out}=await (async()=>{
        const inv = new Investigation({
          id, question: `${title} (answer the question the task description poses)`,
          plainStatement: "We re-test the task's main question on the staged data and report only what software verifies.",
          dataset: { datasetId: task, dataRoot: staged.dataRoot }, route: "P", taskPromptFile: staged.taskFile,
        }, {
journal, fleet, workers: { codex, claude }, providers: configuredProviders({root:dir("providers"),repoRoot:o.repoRoot,now,toolPath,codexCli:o.codexCli,claudeCli:o.claudeCli}), stager:wiring.stager, executor, certifier, ledger:wiring.ledger, registry, now, preflight, contracts, attestation, ...(wiring.confirmation?{confirmation:wiring.confirmation}:{}),
          host: { osUserSeparation: wiring.separated, nativeConfirmation: wiring.separated, sandboxBackend: "seatbelt" }, runtimeMounts: [pixiEnv],
          paths: { hostRoot: path.join(root, "host"), shareRoot: path.join(root, "share"), workRoot: dir("work") },
        });
        log(`${id}: started`);
        const out=await settleLiveInvestigation(inv,{now,waitUntil,health:async()=>true},()=>anchorInvestigation(journal,store,id));
        for(const p of inv.machine.notes("paused"))attempts.push({id:base,status:"paused",reason:String(p.reason)});
        attempts.push({id:base,status:out.status,reason:out.outcome?.reason??null});return {out};
      })();
      log(`${base}: ${out.status} ${out.claims.map((c) => `${c.claimId}=${c.status}`).join(" ")}`);
      result.investigations.push({ task, id: base, status: out.status, claims: out.claims.map((c) => ({ claimId: c.claimId, status: c.status })), deliverable: out.dir, error: null, attempts });
    } catch (e) {
      const error = String((e as Error)?.stack ?? e).slice(0, 2000);
      log(`${base}: ERROR ${error.split("\n")[0]}`);
      result.investigations.push({ task, id: base, status: "error", claims: [], deliverable: null, error, attempts: [] });
    } finally { save(); }
  }));
  save();
  journal.close();
  schedStore.close();
  store.close();
  return result;
}

export const LIVE_DEFAULTS = { codexCli: "/opt/homebrew/bin/codex", claudeCli: PINNED_CLAUDE_CLI, claudeModel: "claude-opus-5-5" } as const;

/** Keep the terminal authority receipt attached to the same resumable investigation. */
export async function settleLiveInvestigation(inv: Investigation, options: SettleOptions, anchor:()=>unknown):Promise<DeliverableOut> {
  const out = await runUntilSettled(inv, options);
  if (inv.machine.output("deliverable")) anchor();
  return out;
}
