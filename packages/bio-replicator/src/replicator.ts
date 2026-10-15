import { chmodSync, copyFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  BoundedProcessRunner, canonicalSha256, cleanupEvidence,
  type BoundedCommandResult, type CleanupEvidence, type CommandRunner,
} from "../../bio-core/src/index.ts";
import { artifactHash, contains, directory, hashDataDirectory, inventory, nonempty, removeWorkspace, fileHash, type TreeEntry } from "./files.ts";
import { auditTranscript } from "./audit.ts";
import { buildBlindPrompt, parseCodexOutput, validateInput, type BlindInput, type ReplicationStatus } from "./protocol.ts";

export interface ReplicationVerdict {
  status: ReplicationStatus | "contaminated";
  /** Analyst claims, NOT verified observations. */
  numbers: Record<string, number>;
  /** canonicalSha256(sorted [{path, sha256, bytes}]); null when no code is available. */
  codeHash: string | null;
  outputHashes: Record<string, string>;
  /** Host-requested route, not provider-attested runtime identity. */
  modelId: string;
  cliVersion: string | null;
  effort: string;
  /** Weakest process cleanup evidence across CLI invocations; absent execution/failed shutdown is unproven. */
  cleanupStatus: CleanupEvidence;
  reason: string | null;
}

export type ReplicationBoundary = "workspace-created" | "before-exec" | "after-exec";

export interface ReplicatorOptions {
  /** Absolute, host-owned CLI; never resolved through ambient PATH. */
  command: string;
  /** Existing host-owned scratch parent, separate from data and runtime roots. */
  tempParent: string;
  /** Absolute auth.json; copied alone, never inherited from ambient CODEX_HOME. */
  authFile: string;
  /** Investigation work/results/report roots. Audit deny rules override toolchain grants. */
  investigationPaths: string[];
  modelId: string;
  effort: string;
  timeoutMs: number;
  now: () => number;
  /** Explicit, vetted, secret-free runtime directories only. */
  toolPath: string;
  toolchainReadRoots?: string[];
  maxOutputBytes?: number;
}

/** Trusted test/host seams only, never populated from an analyst report. */
export interface ReplicatorDependencies {
  createRunner?: () => CommandRunner;
  faultAt?: (boundary: ReplicationBoundary, workspace: string) => void;
  onOutput?: (stream: "stdout" | "stderr", chunk: string) => void;
}

export function buildCodexArgs(prompt: string, workspace: string, options: Pick<ReplicatorOptions, "modelId" | "effort">): string[] {
  const config = [
    'approval_policy="never"', "sandbox_workspace_write.network_access=false",
    "sandbox_workspace_write.exclude_slash_tmp=true", "sandbox_workspace_write.exclude_tmpdir_env_var=true",
    "sandbox_workspace_write.writable_roots=[]", "allow_login_shell=false",
    'shell_environment_policy.inherit="core"',
    'shell_environment_policy.include_only=["PATH","HOME","TMPDIR","LANG"]',
    'web_search="disabled"', "project_doc_max_bytes=0", "features.skip_host_skill_discovery=true",
    "suppress_unstable_features_warning=true", 'cli_auth_credentials_store="file"',
    ...["apps", "plugins", "hooks", "memories", "multi_agent", "multi_agent_v2", "browser_use", "computer_use", "skill_search", "skill_mcp_dependency_install"].map(name => `features.${name}=false`),
    `model_reasoning_effort=${JSON.stringify(options.effort)}`,
  ];
  return ["exec", "--json", "--color", "never", "--ignore-user-config", "--ignore-rules", "--ephemeral",
    "--skip-git-repo-check", "--sandbox", "workspace-write", "--cd", workspace, "--model", options.modelId,
    ...config.flatMap(value => ["--config", value]), prompt];
}

function successful(result: BoundedCommandResult): boolean {
  return result.exitCode === 0 && result.signal === null && result.timedOut === false;
}

function verifyData(input: BlindInput): TreeEntry[] {
  const entries = inventory(input.dataDirectory);
  const expected = new Map(input.manifest.files.map(file => [file.path, file]));
  for (const entry of entries) {
    if (entry.kind === "directory") {
      if (entry.path && !input.manifest.files.some(file => file.path.startsWith(`${entry.path}/`))) throw new Error("extra data directory");
    } else if (entry.path === "manifest.json") {
      if (entry.bytes! > 4 * 1024 * 1024 || canonicalSha256(JSON.parse(readFileSync(path.join(input.dataDirectory, entry.path), "utf8"))) !== input.manifestHash) {
        throw new Error("on-disk manifest mismatch");
      }
    } else {
      const file = expected.get(entry.path);
      if (!file || file.sha256 !== entry.sha256 || file.bytes !== entry.bytes) throw new Error("data manifest mismatch or extra file");
      expected.delete(entry.path);
    }
  }
  if (expected.size) throw new Error("missing data file");
  return entries;
}

class ContaminationError extends Error {}

/** Fresh isolated invocation. Errors are failed verdicts, including cleanup/integrity failures. */
export async function replicateBlind(
  input: BlindInput, options: ReplicatorOptions, dependencies: ReplicatorDependencies = {}, signal?: AbortSignal,
): Promise<ReplicationVerdict> {
  let verdict: ReplicationVerdict = {
    status: "failed", numbers: {}, codeHash: null, outputHashes: {},
    modelId: options.modelId, cliVersion: null, effort: options.effort, cleanupStatus: "unproven", reason: "replication did not run",
  };
  const fail = (reason: string) => {
    verdict = { ...verdict, status: "failed", numbers: {}, codeHash: null, outputHashes: {}, reason };
  };
  let runRoot: string | undefined, stagedData: string | undefined, stagedHash: string | undefined;
  let workspace: string | undefined, dataRoot: string | undefined, beforeHash: string | undefined;
  let runner: CommandRunner | undefined;
  let priorCleanup: CleanupEvidence | undefined;
  const stopping: Promise<void>[] = [];
  let stopFailure = false;
  const stop = () => {
    if (runner?.stopAll) stopping.push(runner.stopAll().catch(() => { stopFailure = true; }));
  };
  try {
    validateInput(input);
    if (!nonempty(options.modelId) || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(options.modelId)
      || !["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"].includes(options.effort)
      || !Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1) throw new Error("invalid execution settings");
    const cap = options.maxOutputBytes ?? 1024 * 1024;
    if (!Number.isSafeInteger(cap) || cap < 1 || cap > 16 * 1024 * 1024) throw new Error("invalid output bound");
    if (!path.isAbsolute(options.command) || !lstatSync(options.command).isFile()) throw new Error("absolute host-owned executable required");
    const command = realpathSync.native(options.command);
    dataRoot = directory(input.dataDirectory);
    const parent = directory(options.tempParent);
    if (contains(dataRoot, parent) || contains(parent, dataRoot)) throw new Error("scratch and data must be disjoint");
    // Toolchain roots are audit exceptions, never broad host or investigation roots.
    const tools = options.toolPath.split(path.delimiter);
    const runtimeRoots = options.toolchainReadRoots ?? [];
    for (const root of [path.dirname(command), ...tools.map(directory), ...runtimeRoots.map(directory)]) {
      if (root === path.parse(root).root || contains(root, dataRoot) || contains(dataRoot, root)
        || contains(root, parent) || contains(parent, root)) throw new Error("runtime roots overlap data or scratch");
    }
    // Snapshot caller-owned inputs before the first await; later caller mutation cannot affect the prompt.
    if (!path.isAbsolute(options.authFile)) throw new Error("absolute CLI auth.json required");
    fileHash(options.authFile, 64 * 1024);
    const login = readFileSync(options.authFile);
    const parsedLogin: unknown = JSON.parse(login.toString("utf8"));
    if (!parsedLogin || typeof parsedLogin !== "object" || Array.isArray(parsedLogin)) throw new Error("invalid CLI login");
    if (!Array.isArray(options.investigationPaths) || options.investigationPaths.some(p => !path.isAbsolute(p))) {
      throw new Error("explicit investigation path list required");
    }
    const forbidden = [...options.investigationPaths, dataRoot, options.authFile];
    const isolated: BlindInput = JSON.parse(JSON.stringify({ ...input, dataDirectory: dataRoot }));
    const entries = verifyData(isolated);
    beforeHash = canonicalSha256(entries);
    if (signal?.aborted) throw new Error("replication aborted");
    const startedAt = options.now();
    if (!Number.isFinite(startedAt)) throw new Error("invalid clock");
    let previousTime = startedAt;
    const remaining = () => {
      const time = options.now();
      if (!Number.isFinite(time) || time < previousTime) throw new Error("invalid or regressing clock");
      previousTime = time;
      const budget = Math.floor(options.timeoutMs - (time - startedAt));
      if (budget < 1) throw new Error("replication deadline exceeded");
      return budget;
    };
    runRoot = mkdtempSync(path.join(parent, "bio-replicator-"));
    workspace = path.join(runRoot, "work");
    stagedData = path.join(runRoot, "data");
    const codexHome = path.join(runRoot, "codex-home"), home = path.join(runRoot, "home"), tmp = path.join(workspace, "tmp");
    for (const dir of [workspace, stagedData, codexHome, home, tmp]) mkdirSync(dir, { mode: 0o700 });
    dependencies.faultAt?.("workspace-created", workspace);
    writeFileSync(path.join(codexHome, "auth.json"), login, { mode: 0o600, flag: "wx" });
    // Copy the verified inventory only; never recursively discover additional source files.
    for (const entry of entries) {
      if (!entry.path) continue;
      const target = path.join(stagedData, entry.path);
      if (entry.kind === "directory") mkdirSync(target, { mode: 0o700 });
      else {
        copyFileSync(path.join(dataRoot, entry.path), target);
        const copied = fileHash(target);
        if (copied.sha256 !== entry.sha256 || copied.bytes !== entry.bytes) throw new Error("data changed while staging");
        chmodSync(target, 0o400);
      }
    }
    for (const entry of [...entries].reverse()) {
      if (entry.kind === "directory") chmodSync(path.join(stagedData, entry.path), 0o500);
    }
    stagedHash = hashDataDirectory(stagedData);
    const prompt = buildBlindPrompt({ ...isolated, dataDirectory: stagedData });
    const env = { CODEX_HOME: codexHome, HOME: home, TMPDIR: tmp, LANG: "C.UTF-8", PATH: tools.join(path.delimiter) };
    runner = dependencies.createRunner?.() ?? new BoundedProcessRunner();
    if (!runner.stopAll) throw new Error("runner must support tree shutdown");
    signal?.addEventListener("abort", stop, { once: true });
    let outputFailure: string | undefined;
    const run = async (args: string[]) => {
      if (signal?.aborted) throw new Error("replication aborted");
      let bytes = 0;
      const consume = (stream: "stdout" | "stderr", chunk: string) => {
        bytes += Buffer.byteLength(chunk);
        if (bytes > cap) { outputFailure = "Codex output exceeds bound"; stop(); return; }
        try { dependencies.onOutput?.(stream, chunk); }
        catch { outputFailure = "output observer failed"; stop(); }
      };
      const timeoutMs = remaining();
      // A thrown run must not inherit the version probe's successful evidence.
      verdict.cleanupStatus = "unproven";
      const result = await runner!.run({ command, args, cwd: workspace!, env, timeoutMs, maxOutputBytes: cap,
        onStdoutChunk: chunk => consume("stdout", chunk), onStderrChunk: chunk => consume("stderr", chunk),
      });
      const evidence = cleanupEvidence(result);
      verdict.cleanupStatus = evidence === "unproven" || priorCleanup === "unproven" ? "unproven"
        : evidence === "observed-clean" || priorCleanup === "observed-clean" ? "observed-clean" : "proven";
      priorCleanup = verdict.cleanupStatus;
      if (verdict.cleanupStatus === "unproven") throw new Error("process cleanup failed (evidence=unproven)");
      if (outputFailure) throw new Error(outputFailure);
      if (signal?.aborted) throw new Error("replication aborted");
      if (Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr) > cap) throw new Error("Codex output exceeds bound");
      if (!successful(result)) throw new Error(`Codex transport failed (${result.timedOut ? "timeout" : result.signal ?? result.exitCode ?? "unknown"}; cleanup=${verdict.cleanupStatus})`);
      remaining();
      return result;
    };
    const version = (await run(["--version"])).stdout.trim();
    if (!/^codex(?:-cli)? \d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(version)) throw new Error("unrecognized CLI version");
    verdict.cliVersion = version;
    dependencies.faultAt?.("before-exec", workspace);
    const result = await run(buildCodexArgs(prompt, workspace, options));
    dependencies.faultAt?.("after-exec", workspace);
    const contamination = auditTranscript(result.stdout, {
      workspace, stagedData, toolchainRoots: [...tools, ...runtimeRoots],
      forbiddenPaths: [...forbidden, codexHome, home],
    });
    if (contamination) {
      throw new ContaminationError(contamination);
    }
    const report = parseCodexOutput(result.stdout);
    let artifactBytes = 0;
    const hashArtifact = (file: string) => {
      const hash = artifactHash(workspace!, file, 64 * 1024 * 1024 - artifactBytes);
      artifactBytes += hash.bytes;
      return hash;
    };
    const code = report.codeFiles.slice().sort().map(file => ({ path: file, ...hashArtifact(file) }));
    const outputHashes = Object.fromEntries(report.outputFiles.slice().sort().map(file => [file, hashArtifact(file).sha256]));
    verdict = { ...verdict, status: report.status, numbers: report.numbers,
      codeHash: code.length ? canonicalSha256(code) : null, outputHashes, reason: null };
    if (report.status === "failed") fail("analyst reported failure");
  } catch (error) {
    fail(error instanceof Error ? error.message : "unknown replication failure");
    if (error instanceof ContaminationError) verdict.status = "contaminated";
    stop();
  } finally {
    signal?.removeEventListener("abort", stop);
    await Promise.all(stopping);
    if (stopFailure) { verdict.cleanupStatus = "unproven"; fail("process cleanup failed"); }
    if (dataRoot !== undefined && beforeHash !== undefined) {
      try { if (hashDataDirectory(dataRoot) !== beforeHash) fail("data directory changed during replication"); }
      catch { fail("data directory integrity unavailable after replication"); }
    }
    if (stagedData !== undefined && stagedHash !== undefined) {
      try { if (hashDataDirectory(stagedData) !== stagedHash) fail("staged data directory changed during replication"); }
      catch { fail("staged data directory integrity unavailable after replication"); }
    }
    if (runRoot !== undefined) {
      try { removeWorkspace(runRoot); }
      catch { fail("temporary workspace cleanup failed"); }
    }
  }
  return verdict;
}
