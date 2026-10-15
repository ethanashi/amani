export type { HostLiteratureConfig } from './literature.ts';
export type { TierCConfig, TierCOptions } from './tier-c.ts';
// Keep the legacy host's startup/recovery path independent of the Tier C module graph.
export async function createTierCInvestigation(...args: Parameters<typeof import('./literature.ts').createTierCInvestigation>) {
  return (await import('./literature.ts')).createTierCInvestigation(...args);
}
export async function runTierCInvestigation(...args: Parameters<typeof import('./tier-c.ts').runTierCInvestigation>) {
  return (await import('./tier-c.ts')).runTierCInvestigation(...args);
}
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { canonicalSha256, SqliteEventStore, sweepUserProcesses, processRows, type CleanupEvidence, type CommandRunner } from "../../bio-core/src/index.ts";
import { InvestigationLedger } from "../../bio-ledger/src/index.ts";
import { investigate, parseResultsSchema, type InvestigationConfig, type PipelineDependencies, type PipelineResult } from "../../bio-pipeline/src/index.ts";
import { claudeBin, startEgressProxy, type EgressProxy } from "../../bio-runner/src/index.ts";
import { NotebookIndex, hypothesisKeys } from "./notebook.ts";
import { hostLocations, inside, privateDirectory, privateFile } from "./paths.ts";
import { AnalysisSandbox, preparedPixiEnvironment, reexecutionAdapter } from "./reexecution.ts";
import { renderEvidenceReport } from "./report.ts";
import { removeWorkspace } from "../../bio-supervisor/src/index.ts";
import { LaunchRegistry } from "./launch.ts";
import { readEgressLog } from "./network.ts";
import { HostWorker, defaultTurnTimeouts, type TurnTimeouts } from "./worker.ts";
import { inspectClaude } from "./claude.ts";
export { inspectClaude, requireClaudeVersion } from "./claude.ts";
export { NotebookIndex, normalizeKey, hypothesisKeys, type NotebookKeys } from "./notebook.ts";
export { HostWorker, defaultTurnTimeouts, type TurnTimeouts, type WorkerHostOptions } from "./worker.ts";
export { authorizeTool, runHook, type ToolBoundary } from "./tool-hook.ts";
export { renderEvidenceReport } from "./report.ts";
export { pixiEnvironment, reexecutionAdapter, AnalysisSandbox } from "./reexecution.ts";

export interface HostConfig {
  intent: "confirmatory" | "exploratory";
  allowedHosts: string[];
  entityKeys: string[];
}
export interface HostOptions {
  /** Trusted Tier C test/runtime seams; unavailable to investigation JSON. */
  tierC?: Omit<import('./tier-c.ts').TierCOptions, 'now' | 'approval'>;
  now(): number;
  turnTimeouts?: Partial<TurnTimeouts>;
  /** Trusted fixture seam: null retains legacy Node without pixi. */
  analysisEnvironment?: PipelineDependencies["analysisEnvironment"] | null;
  mode?: "explore" | "confirm";
  approval?: "auto" | "prompt";
  approve?: PipelineDependencies["approve"];
  stateRoot?: string;
  workRoot?: string;
  indexFile?: string;
  command?: string;
  env?: NodeJS.ProcessEnv;
  /** Trusted test/runtime composition seam, never investigation JSON. */
  runner?: CommandRunner;
  sandbox?: AnalysisSandbox;
  /** Trusted composition seam, like runner/sandbox; unavailable to investigation JSON. */
  reexecutionSandbox?: PipelineDependencies["reexecutionSandbox"];
  signal?: AbortSignal;
  /** Trusted evidence provider for abandoned workspace reclamation. Never from JSON. */
  recoverProcesses?: PipelineDependencies["recoverProcesses"];
  /** Operator-supplied task results.json schema; validated, hash-pinned and journaled before any worker turn. */
  resultsSchema?: unknown;

}

export function readHostConfig(directory: string): HostConfig {
  const file = path.join(directory, "host.json");
  if (!existsSync(file)) return { intent: "confirmatory", allowedHosts: [], entityKeys: [] };
  privateFile(file);
  const config = JSON.parse(readFileSync(file, "utf8")) as HostConfig;
  if (!config || !["confirmatory", "exploratory"].includes(config.intent) ||
    Object.keys(config).some(k => !["intent", "allowedHosts", "entityKeys"].includes(k)) ||
    !Array.isArray(config.allowedHosts) || !Array.isArray(config.entityKeys) ||
    [...config.allowedHosts, ...config.entityKeys].some(s => typeof s !== "string" || !s.trim())) throw new Error("invalid host.json");
  return config;
}

export function checkApprovalMode(intent: HostConfig["intent"], approval: "auto" | "prompt"): void {
  if (approval === "auto" && intent !== "exploratory") throw new Error("--approve auto is refused for confirmatory plans");
}

/** Library/CLI entry: acquire the host lock before starting workers, indexing, or cleanup. */
export function runInvestigation(directory: string, config: InvestigationConfig, options: HostOptions): Promise<PipelineResult> {
  return runHost(directory, config, options, false);
}

/** Stop permanently and publish every verified record; cleanup is separately graded. */
export function abandonInvestigation(directory: string, config: InvestigationConfig, options: HostOptions): Promise<PipelineResult> {
  return runHost(directory, config, options, true);
}

async function runHost(directory: string, config: InvestigationConfig, options: HostOptions, abandon: boolean): Promise<PipelineResult> {
  // Validate before registering a pending notebook. The pipeline repeats these
  // checks, but a pre-ledger refusal must not strand an unpublishable index entry.
  const expected = ["id", "question", "successCriterion", "files", "model", "home", "node", "toolPath", "timeoutMs", ...(config && "planRepairRounds" in config ? ["planRepairRounds"] : [])].sort();
  if (!config || Object.keys(config).sort().join() !== expected.join() || typeof config.id !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(config.id) ||
    [config.question, config.successCriterion].some(s => typeof s !== "string" || !s.trim() || s.length > 16000) ||
    typeof config.model !== "string" || !config.model.startsWith("claude-") || !Array.isArray(config.files) || !config.files.length ||
    (config.planRepairRounds !== undefined && (!Number.isSafeInteger(config.planRepairRounds) || config.planRepairRounds < 0 || config.planRepairRounds > 2)) ||
    !Number.isSafeInteger(config.timeoutMs) || config.timeoutMs < 1 || typeof config.toolPath !== "string" ||
    [config.home, config.node, ...config.toolPath.split(path.delimiter)].some(s => typeof s !== "string" || !path.isAbsolute(s))) throw new Error("invalid investigation configuration");
  const root = privateDirectory(path.resolve(directory));
  const hostConfig = readHostConfig(root);
  const mode = options.mode ?? "confirm", approval = options.approval ?? "prompt";
  if (!["confirm", "explore"].includes(mode) || !["auto", "prompt"].includes(approval)) throw new Error("invalid host mode");
  checkApprovalMode(hostConfig.intent, approval);
  const resultsSchema = options.resultsSchema === undefined ? undefined : parseResultsSchema(options.resultsSchema);
  const turnTimeouts = { ...defaultTurnTimeouts, ...options.turnTimeouts };
  if (Object.keys(turnTimeouts).some(k => !["draft", "code", "interpret"].includes(k)) ||
    Object.values(turnTimeouts).some(n => !Number.isSafeInteger(n) || n < 1 || n > 2_147_483_647)) throw new Error("invalid worker turn timeout");
  if (hostConfig.allowedHosts.some(host => !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(host))) throw new Error("allowlist must contain exact DNS names");
  const authority = privateDirectory(path.join(root, "authority"));
  const lockFile = path.join(authority, "host-lock.sqlite"); privateFile(lockFile);
  const fresh = !existsSync(lockFile);
  const lock = new InvestigationLedger(lockFile, "host", { now: options.now });
  let proxy: EgressProxy | undefined;
  let token: string | undefined;
  let events: SqliteEventStore | undefined;
  let index: NotebookIndex | undefined;
  let sharedLock: InvestigationLedger | undefined, sharedToken: string | undefined;
  try {
    if (fresh) lock.create();
    token = lock.acquire();
    const env = options.env ?? process.env;
    const locations = hostLocations(options, env);
    const stateRoot = privateDirectory(locations.stateRoot);
    let workRoot = privateDirectory(locations.workRoot);
    const indexFile = locations.indexFile;
    if (inside(root, workRoot) || inside(workRoot, root) || inside(workRoot, indexFile)) throw new Error("host work and evidence roots must be disjoint");
    privateDirectory(path.dirname(indexFile));
    const sharedFile = `${indexFile}.lock.sqlite`; privateFile(sharedFile);
    const sharedFresh = !existsSync(sharedFile);
    sharedLock = new InvestigationLedger(sharedFile, "shared-host", { now: options.now });
    if (sharedFresh) sharedLock.create();
    sharedToken = sharedLock.acquire();
    index = new NotebookIndex(indexFile, options.now);
    if (!abandon) index.assertAvailable(config.id);
    const eventFile = path.join(authority, "host.sqlite"); privateFile(eventFile);
    events = new SqliteEventStore(eventFile);
    if (!events.verifyStream(config.id).valid) throw new Error("host journal chain invalid");
    const record = (type: string, payload: unknown) => events!.append({ eventId: randomUUID(), streamId: config.id, type, schemaVersion: 1,
      occurredAt: new Date(options.now()).toISOString(), producerPlaneId: "bio-host", payload });
    const old = events.readStream(config.id).find(e => e.type === "configured");
    if (old && !options.workRoot) {
      // Preserve the recorded scratch location for pre-fix investigations too.
      workRoot = privateDirectory((old.payload as { workRoot: string }).workRoot);
      if (inside(root, workRoot) || inside(workRoot, root) || inside(workRoot, indexFile)) throw new Error("host work and evidence roots must be disjoint");
    }
    if (abandon && !old) throw new Error("cannot abandon an investigation that this host has not configured");
    const executable = abandon ? (old!.payload as { executable: ReturnType<typeof inspectClaude> }).executable
      : inspectClaude(options.command ?? claudeBin(env), env, stateRoot);
    const analysisEnvironment = options.analysisEnvironment === null ? undefined : options.analysisEnvironment ?? (() => preparedPixiEnvironment(process.cwd()));
    const environment = abandon ? undefined : await analysisEnvironment?.();
    if (!abandon) record("environment-checked", environment ?? { legacyNode: true });
    // Older pins carry no schema field, so investigations without a schema keep resuming.
    const pin = { turnTimeouts, config, hostConfig, mode, approval, stateRoot, workRoot, indexFile, executable,
      ...(resultsSchema ? { resultsSchemaSha256: canonicalSha256(resultsSchema) } : {}) };
    if (old && canonicalSha256(old.payload) !== canonicalSha256(pin)) throw new Error("host configuration changed on resume");
    if (!old) record("configured", pin);
    if (resultsSchema && !events.readStream(config.id).some(e => e.type === "results-schema")) record("results-schema", { sha256: canonicalSha256(resultsSchema), schema: resultsSchema });
    // Publication and process cleanup are separate obligations.
    const history = events.readStream(config.id);
    const open = history.filter(e => e.type === "worker-workspace").filter(e => {
      const workspace = e.payload as { nonce: string; scratch: string };
      return !history.some(other => other.type === "worker-cleanup" && (other.payload as { nonce: string; absent: boolean }).nonce === workspace.nonce && (other.payload as { absent: boolean }).absent);
    });
    const ledgerFile = path.join(authority, "ledger.sqlite");
    const publish = () => {
      privateFile(ledgerFile);
      const freshLedger = !existsSync(ledgerFile);
      const ledger = new InvestigationLedger(ledgerFile, config.id, { now: options.now });
      try {
        // A crash after begin but before pipeline creation has no records to lose.
        if (freshLedger) ledger.create();
        const snapshot = ledger.snapshot();
        const manifestHash = canonicalSha256({ version: 1, files: config.files.map(({ sourcePath: _source, ...file }) => file).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0) });
        index!.publish({ ledgerFile, investigationId: config.id, keys: { manifestHash,
          accessions: config.files.map(f => f.accession), hypothesisKeys: hypothesisKeys(snapshot.records), entityKeys: hostConfig.entityKeys } });
      } finally { ledger.close(); }
    };
    if (abandon) {
      record("abandoned", { reason: "operator abandoned investigation; no further worker dispatch" });
      // Resolve pending even if cleanup is unavailable. Never drop source history.
      publish();
      let cleanupStatus: CleanupEvidence = "proven";
      const workspaces = [...open.map(e => e.payload as { scratch: string; nonce: string; startedAt?: number }),
        ...(existsSync(path.join(root, "work")) ? [{ scratch: path.join(root, "work"), nonce: "pipeline", startedAt: new Date(history[0]!.occurredAt).getTime() }] : [])];
      for (const workspace of workspaces) {
        const input = { cwd: workspace.scratch, startedAt: workspace.startedAt ?? new Date(history[0]!.occurredAt).getTime() };
        let evidence: CleanupEvidence = "unproven";
        try {
          evidence = options.recoverProcesses ? await options.recoverProcesses(input) :
            sweepUserProcesses({ ...input, observed: [], processGroupIds: [], preexisting: processRows().filter(row => row.pid === process.pid) }) ? "observed-clean" : "unproven";
        } catch { /* incomplete census retains scratch */ }
        if (evidence !== "proven" && evidence !== "observed-clean") evidence = "unproven";
        if (evidence !== "unproven") removeWorkspace(workspace.scratch, [workRoot, root], [authority, ...["data", "sealed", "results", "report"].map(name => path.join(root, name))]);
        cleanupStatus = cleanupStatus === "unproven" || evidence === "unproven" ? "unproven" :
          cleanupStatus === "observed-clean" || evidence === "observed-clean" ? "observed-clean" : "proven";
        record("worker-cleanup", { ...workspace, cleanupStatus: evidence, absent: !existsSync(workspace.scratch), recovery: true });
      }
      const result: PipelineResult = { status: cleanupStatus === "unproven" ? "cleanup-incomplete" : "rejected",
        reason: "investigation abandoned; verified notebook published", label: "insufficient", exploratory: mode === "explore" || hostConfig.intent === "exploratory", claims: [], reexecution: null, report: null, cleanupStatus };
      record("terminal", result);
      return result;
    }
    if (history.some(e => e.type === "abandoned")) { publish(); throw new Error("investigation was abandoned; use a new investigation directory"); }
    const registry = new LaunchRegistry({ authority, now: options.now, record, history: () => events!.readStream(config.id),
      ...(options.runner ? { runner: options.runner } : {}) });
    const recover = options.recoverProcesses ?? (input => registry.recover(input));
    if (open.length) {
      publish();
      for (const event of open) {
        const workspace = event.payload as { scratch: string; nonce: string; startedAt: number };
        const reservations = history.filter(e => e.type === "launch-reserved" && (e.payload as { cwd: string }).cwd === workspace.scratch);
        if (!reservations.length || options.runner && !options.recoverProcesses) throw new Error("interrupted worker recovery unavailable: notebook published; use bio-host abandon to stop and reclaim settled scratch");
        for (const reservation of reservations) {
          const evidence = await recover(reservation.payload as { launchId: string; cwd: string; startedAt: number });
          if (evidence !== "observed-clean" && evidence !== "proven") throw new Error("interrupted worker recovery unavailable");
        }
        removeWorkspace(workspace.scratch, [workRoot], [authority]);
        record("worker-cleanup", { ...workspace, cleanupStatus: "observed-clean", absent: true, recovery: true });
      }
    }
    const runner: CommandRunner = {
      run: async spec => { const result = await registry.run(spec); worker.settled(result); return result; },
      stopAll: () => registry.stopAll(),
    };
    const command = executable.command;
    const worker = new HostWorker({ turnTimeouts, intent: hostConfig.intent, nativeEnvironment: !!analysisEnvironment, ...(environment ? { environmentPrefix: environment.prefix } : {}), command, sha256: executable.sha256, cliVersion: executable.version, env: { ...env }, workRoot, authority,
      dataRoot: path.join(root, "data"), dataFiles: config.files.map(f => path.join(root, "data", f.path)), now: options.now, record }, runner);
    let network: PipelineDependencies["network"] = { mode: "confirm" };
    if (mode === "explore") {
      const logFile = path.join(authority, `egress-${randomUUID()}.jsonl`);
      writeFileSync(logFile, "", { flag: "wx", mode: 0o600 });
      proxy = await startEgressProxy({ logFile, allowedHosts: hostConfig.allowedHosts, now: options.now });
      network = { mode: "explore", proxyPort: proxy.port, allowedHosts: proxy.allowedHosts, egressLog: () => readEgressLog(logFile) };
      record("proxy-started", { logFile, port: proxy.port, allowedHosts: proxy.allowedHosts });
    }
    record("runtime", { command, turnTimeouts });
    const deps: PipelineDependencies = {
      now: options.now, runner, worker, network,
      approvalActor: approval === "auto" ? "policy" : "human",
      approve: approval === "auto" ? ({ plan }) => hostConfig.intent === "exploratory" && plan.analysis.exploratory === true : options.approve ?? (() => false),
      ...(analysisEnvironment ? { analysisEnvironment } : {}),
      registerLaunch: (id, cwd) => registry.register(id, cwd),
      priorRecords: query => index!.query({ ...query, entityKeys: hostConfig.entityKeys }, config.id),
      enforceWorkerBoundary: input => worker.enforce(input), auditWorker: () => worker.audit(),
      renderReport: input => {
        const content = renderEvidenceReport(input);
        const file = path.join(authority, "notebook.json"); privateFile(file);
        writeFileSync(file, JSON.stringify(input.snapshot, null, 2) + "\n", { mode: 0o600 });
        return content;
      },
      sandbox: options.sandbox ?? new AnalysisSandbox(), reexecutionSandbox: options.reexecutionSandbox ?? reexecutionAdapter(null,
        environment ? { stateRoot, prefix: environment.prefix, lockfile: environment.lockfile } : undefined),
      recoverProcesses: recover,
      ...(options.signal ? { signal: options.signal } : {}),
      ...(resultsSchema ? { resultsSchema } : {}),
    };
    index.begin(config.id, path.join(authority, "ledger.sqlite"));
    let result: PipelineResult;
    try { result = await investigate(root, config, deps); }
    finally { publish(); }
    record("terminal", result);
    return result;
  } finally {
    try { await proxy?.close(); }
    finally {
      try { index?.close(); events?.close(); if (sharedToken) sharedLock!.release(sharedToken); }
      finally { sharedLock?.close(); try { if (token) lock.release(token); } finally { lock.close(); } }
    }
  }
}
