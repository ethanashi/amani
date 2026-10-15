import { regularBytes } from "./regular-bytes.ts";
import { randomUUID } from "node:crypto";
import { copyFileSync, constants, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalSha256, cleanupEvidence, machOLibraryRoots, type CleanupEvidence, type CommandRunner } from "../../bio-core/src/index.ts";
import { ClaudeWorkerClient, secretPaths, postTurnSweepWarning, type RunnerClient, type WorkerTurnInput, type WorkerTurnResult } from "../../bio-runner/src/index.ts";
import type { PipelineDependencies, WorkerAudit } from "../../bio-pipeline/src/index.ts";
import { removeWorkspace } from "../../bio-supervisor/src/index.ts";
import { noLinks, privateDirectory } from "./paths.ts";
import { assertSafePrompt, type ToolBoundary } from "./tool-hook.ts";
import { requireClaudeVersion, verifyClaude } from "./claude.ts";
import { auditToolReceipts } from "./tool-audit.ts";

const nativeTools = ["Read", "Write", "Edit"];
let runtimeReads: string[] | undefined;
function developmentRuntimeReads(): string[] {
  return runtimeReads ??= [...new Set([path.dirname(realpathSync(process.execPath)),
    "/bin", "/usr/bin", "/usr/lib", "/System/Library", "/Library/Apple/System/Library",
    "/private/var/db/dyld", "/private/etc/localtime", "/usr/share/zoneinfo", "/private/var/db/timezone",
    "/private/var/select", "/dev/null", "/dev/urandom", "/dev/random",
    ...(process.platform === "darwin" ? machOLibraryRoots(process.execPath) : ["/lib", "/lib64", "/etc/ld.so.cache"])
  ].filter(existsSync))];
}
const outputNames = ["proposal.json", "analysis.mjs", "analysis.R", "analysis.py", "revised-plan.json"];
/** Denials travel through JSON stdout. Suppress only unsanitized startup diagnostics;
 * a loader failure emits a constant JSON stop decision instead. */
export const workerHookCommand = '"$OMERTA_BIO_HOOK_NODE" "$OMERTA_BIO_HOOK_SCRIPT" "$OMERTA_BIO_HOOK_CONFIG" 2>&- || { printf \'%s\\n\' \'{"continue":false,"stopReason":"Host boundary refused: hook unavailable"}\'; }';
export function hookEnvironment(hookFile: string): Record<string, string> {
  return { OMERTA_BIO_HOOK_NODE: process.execPath, OMERTA_BIO_HOOK_SCRIPT: fileURLToPath(new URL("./tool-hook.ts", import.meta.url)), OMERTA_BIO_HOOK_CONFIG: hookFile };
}
type BoundaryInput = Parameters<PipelineDependencies["enforceWorkerBoundary"]>[0];
/** Live attempt 26: a careful code turn (one slow first dev run, profiling, a fixed rerun and
 * a schema self-check) finished at the old 20-minute deadline and was killed. 45 minutes stays
 * well inside the arm's 90-minute wall cap. */
export const defaultTurnTimeouts = { draft: 600_000, code: 2_700_000, interpret: 600_000 };
export type TurnTimeouts = typeof defaultTurnTimeouts;
export interface WorkerHostOptions {
  turnTimeouts?: Partial<TurnTimeouts>;
  intent?: "confirmatory" | "exploratory";
  nativeEnvironment?: boolean;
  environmentPrefix?: string;
  command: string;
  sha256: string;
  cliVersion: string;
  env: NodeJS.ProcessEnv;
  workRoot: string;
  authority: string;
  dataRoot: string;
  dataFiles: string[];
  now(): number;
  record(type: string, payload: unknown): void;
}

/** Code development is offline; only host-frozen executions become evidence. */
export class HostWorker implements RunnerClient {
  private options: WorkerHostOptions;
  private runner: CommandRunner;
  private state: { boundary?: BoundaryInput; audit?: WorkerAudit; settled?: CleanupEvidence; sweepWarning?: string | undefined };
  constructor(options: WorkerHostOptions, runner: CommandRunner, state: HostWorker["state"] = {}) {
    requireClaudeVersion(options.cliVersion);
    this.options = options; this.runner = runner; this.state = state;
  }
  /** Called below the pipeline cancellation wrapper, before it can throw away a result. */
  settled(result: Parameters<typeof postTurnSweepWarning>[0]): void { this.state.settled = cleanupEvidence(result); this.state.sweepWarning = postTurnSweepWarning(result); }
  withRunner(runner: CommandRunner): HostWorker { return new HostWorker(this.options, runner, this.state); }
  enforce(input: BoundaryInput): void {
    assertSafePrompt(input.turn.prompt);
    if (input.policy.writableRoots.length !== 1 || input.policy.writableRoots[0] !== input.turn.cwd ||
      input.policy.failIfUnavailable !== true || input.policy.allowUnsandboxedCommands !== false) throw new Error("invalid worker policy");
    this.state.boundary = input; delete this.state.audit;
  }
  audit(): WorkerAudit {
    if (!this.state.audit) throw new Error("worker boundary audit unavailable");
    return structuredClone(this.state.audit);
  }
  async execute(turn: WorkerTurnInput): Promise<WorkerTurnResult> {
    const boundary = this.state.boundary;
    if (!boundary || boundary.turn !== turn) throw new Error("worker boundary was not prepared for this turn");
    delete this.state.boundary;
    delete this.state.settled;
    delete this.state.sweepWarning;
    assertSafePrompt(turn.prompt);
    if ([path.dirname(path.dirname(this.options.command)), this.options.workRoot, this.options.authority, this.options.env.HOME].some(root => root && turn.prompt.includes(root))) throw new Error("raw host path is forbidden in worker prompts");
    const { options } = this;
    const scratch = mkdtempSync(path.join(privateDirectory(options.workRoot), "worker-"));
    const nonce = randomUUID();
    const hookFile = path.join(options.authority, `hook-${nonce}.json`);
    const auditFile = path.join(options.authority, `tools-${nonce}.jsonl`);
    const writes = outputNames.map(name => path.join(scratch, name));
    let evidence: CleanupEvidence = "proven";
    // Persist ownership before dispatch; a restart must not blindly delete this path.
    try {
      options.record("worker-workspace", { scratch, nonce, phase: boundary.phase, startedAt: options.now() });
      for (const name of outputNames) {
        const from = path.join(turn.cwd, name);
        if (existsSync(from)) writeFileSync(path.join(scratch, name), regularBytes(from), { mode: 0o600 });
      }
      const development = boundary.phase === "code";
      if (development && !boundary.developmentInput) throw new Error("effective development inputs unavailable");
      const dataRoot = development ? boundary.developmentInput!.directory : options.dataRoot;
      const sources = development ? boundary.developmentInput!.schemas.map(s => path.join(dataRoot, s.file)) : options.dataFiles;
      const dataFiles = sources.map(file => {
        const name = path.relative(dataRoot, file);
        if (!name || path.isAbsolute(name) || name.split(path.sep).includes("..")) throw new Error("dataset is outside staged data");
        const target = path.join(scratch, "data", name);
        mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
        noLinks(file);
        const st = lstatSync(file);
        if (!st.isFile() || st.nlink !== 1) throw new Error("dataset must be regular single-link data");
        copyFileSync(file, target, constants.COPYFILE_EXCL);
        return target;
      });
      // These host-supplied files are readable but never writable by native tools.
      // Dataset names and all per-turn evidence stay out of CLI prompt text.
      const contextFile = path.join(scratch, "worker-context.json");
      writeFileSync(contextFile, regularBytes(path.join(turn.cwd, "worker-context.json")), { flag: "wx", mode: 0o400 });
      const findingsFiles = ["validity-summary.json", "validity-findings.json"].flatMap(name => {
        const source = path.join(turn.cwd, name);
        if (!existsSync(source)) return [];
        const target = path.join(scratch, name);
        writeFileSync(target, regularBytes(source, 64 * 1024 * 1024), { flag: "wx", mode: 0o400 });
        return [target];
      });
      const catalogFile = path.join(scratch, "dataset-catalog.json");
      writeFileSync(catalogFile, JSON.stringify(dataFiles.map(file => path.relative(scratch, file))), { flag: "wx", mode: 0o400 });
      const developmentOutput = path.join(scratch, "development-results");
      if (development) mkdirSync(developmentOutput, { mode: 0o700 });
      const config: ToolBoundary = { cwd: scratch, reads: [...dataFiles, contextFile, catalogFile, ...findingsFiles], writes, auditFile, nonce,
        ...(development ? { bash: { data: path.join(scratch, "data"), output: developmentOutput,
          toolPath: [options.environmentPrefix && path.join(options.environmentPrefix, "bin"), path.dirname(realpathSync(process.execPath)), "/usr/bin", "/bin"].filter(Boolean).join(path.delimiter) } } : {}) };
      writeFileSync(hookFile, JSON.stringify(config), { flag: "wx", mode: 0o400 });
      writeFileSync(auditFile, "", { flag: "wx", mode: 0o600 });
      let stdout = "";
      let denyRules: string[] = [];
      const adapted: CommandRunner = {
        run: async spec => {
          const args = [...spec.args];
          const index = args.indexOf("--settings") + 1;
          if (!index || !args[index]) throw new Error("Claude settings missing");
          const settings = JSON.parse(args[index]!);
          // Claude echoes a blocking hook's command text to the worker, so the command names
          // only variables. Their host paths live in this turn's CLI environment, which the
          // code-phase Bash wrapper resets; unset variables emit a JSON stop decision.
          const hook = workerHookCommand;
          settings.hooks = Object.fromEntries(["UserPromptSubmit", "PreToolUse"].map(event => [event, [{ matcher: "", hooks: [{ type: "command", command: hook, timeout: 5, onFailure: "block" }] }]]));
          settings.sandbox.filesystem = {
            denyRead: [...new Set([realpathSync(homedir()), ...(options.env.HOME ? [realpathSync(options.env.HOME)] : []), turn.home!, "/private/tmp", "/private/var/folders", ...boundary.policy.denyReadPaths])],
            allowRead: [scratch], allowWrite: [scratch],
          };
          if (development) {
            settings.sandbox = { ...settings.sandbox, enabled: true, failIfUnavailable: true,
              allowUnsandboxedCommands: false, autoAllowBashIfSandboxed: true, excludedCommands: [],
              network: { allowedDomains: [], deniedDomains: ["*"], strictAllowlist: true,
                allowLocalBinding: false, allowAllUnixSockets: false, allowUnixSockets: [] },
              filesystem: { denyRead: ["/"],
                allowRead: [scratch, ...developmentRuntimeReads(), ...(options.environmentPrefix ? [options.environmentPrefix] : [])],
                allowWrite: [scratch], denyWrite: [path.join(scratch, "data"), contextFile, catalogFile, ...["validity-summary.json", "validity-findings.json"].map(name => path.join(scratch, name)),
                  path.join(scratch, ".claude"), path.join(scratch, "CLAUDE.md"),
                  ...(options.environmentPrefix ? [options.environmentPrefix] : [])] },
            };
          };
          // Keep native Read denials: sandbox filesystem rules do not cover @ attachments.
          const secrets = [...new Set([turn.home!, realpathSync(homedir()), options.env.HOME!].filter(Boolean))]
            .flatMap(home => secretPaths(home));
          const nativeDenies = [...secrets, ...boundary.policy.denyReadPaths].flatMap(p =>
            [`Read(/${p.replace(/\/$/, "")})`, `Read(/${p.replace(/\/$/, "")}/**)`]);
          settings.permissions = { allow: [], deny: [...new Set([...settings.permissions.deny, ...nativeDenies,
            ...(development ? [] : ["Bash"]), "Grep", "Glob", "WebFetch", "WebSearch", "Agent", "Task", "NotebookEdit", "Read(**/.env)", "Read(**/.env.*)"])] };
          // Builtin plugins survive --setting-sources and --disable-slash-commands
          // in 2.1.296. Explicit per-plugin settings also disable their hooks.
          settings.enabledPlugins = Object.fromEntries([
            "agents-md", "plugin-authoring", "sec-default", "telemetry", "mods-guide",
            "tips", "mermaid", "responsive-mode", "diff", "you-should-know", "claude-test",
          ].map(name => [`cc-plugin-${name}@builtin`, false]));
          denyRules = settings.permissions.deny;
          args[index] = JSON.stringify(settings);
          const toolsStart = args.indexOf("--tools") + 1;
          const toolsEnd = args.findIndex((arg, i) => i >= toolsStart && arg.startsWith("--"));
          if (!toolsStart || toolsEnd < toolsStart) throw new Error("Claude tools missing");
          args.splice(toolsStart, toolsEnd - toolsStart, ...nativeTools, ...(development ? ["Bash"] : []));
          // Drafts must remain resumable for bounded repairs and gate amendments.
          // Claude >=2.1.223 resolves a session ID across scratch directories;
          // each turn still receives fresh hooks and the complete current policy.
          args.push("--setting-sources", "");
          if (boundary.phase !== "draft" && boundary.phase !== "amend") args.push("--no-session-persistence");
          options.record("worker-boundary", { nonce, phase: boundary.phase, settings, settingsHash: canonicalSha256(settings), tools: args.slice(toolsStart, args.findIndex((arg, i) => i >= toolsStart && arg.startsWith("--"))) });
          const sentPrompt = args[args.indexOf("-p") + 1];
          assertSafePrompt(sentPrompt);
          verifyClaude(options);
          evidence = "unproven";
          const result = await this.runner.run({ ...spec, args, env: { ...spec.env,
            TMPDIR: scratch, TMP: scratch, TEMP: scratch, CLAUDE_CODE_TMPDIR: scratch, DISABLE_AUTOUPDATER: "1", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
            ...hookEnvironment(hookFile),
          } });
          stdout = result.stdout;
          evidence = cleanupEvidence(result);
          this.state.sweepWarning = postTurnSweepWarning(result);
          if (this.state.sweepWarning) options.record("worker-cleanup-warning", { nonce, reason: this.state.sweepWarning, cleanupStatus: evidence });
          return result;
        },
        stopAll: async () => { await this.runner.stopAll?.(); },
      };
      const client = new ClaudeWorkerClient({ command: options.command, runner: adapted, env: options.env, settleMs: 1 });
      const timeoutMs = this.options.turnTimeouts?.[boundary.phase === "amend" ? "draft" : boundary.phase] ?? defaultTurnTimeouts[boundary.phase === "amend" ? "draft" : boundary.phase];
      const deadline = `This turn has a hard deadline of ${timeoutMs} milliseconds (${timeoutMs / 60_000} minutes) at most; any overall arm deadline takes precedence and earlier work consumes that shared budget. The host stops the worker at the deadline and the turn yields nothing.${development ? " A Bash command still running after 10 minutes is moved to the background and keeps using the budget: profile and bound development runs before a full run." : ""}`;
      const result = await client.execute({ ...turn, cwd: scratch, timeoutMs,
        prompt: turn.prompt + `\n${deadline}\nHost capabilities: use Read, Write, Edit for files and StructuredOutput for the final report. Read dataset-catalog.json for available dataset files and worker-context.json for turn evidence. Write files in the current worker directory. Native Write/Edit tools may write only ${JSON.stringify(outputNames)}. ${development ? "Use Bash to execute and debug your analysis before returning. Bash is sandboxed offline and the hook supplies BIO_DATA_DIR (effective row tables) and BIO_OUTPUT_DIR (development-results), plus the installed runtime PATH. You may inspect development-results via Bash. Development outputs are discarded and are NEVER evidence. Repair errors are in worker-context.json. Only source files are exported; the host freezes and executes them in fresh output directories. " : "Bash is unavailable in this phase."} The host checks numeric claims after frozen execution. Never inspect host policy/source files. Investigation intent: ${options.intent ?? "confirmatory"}; declare analysis.exploratory accordingly in the initial draft. A post-lock gate amendment must declare exploratory:true regardless of the original intent. ${options.nativeEnvironment ? "Installed runtimes: python and r; choose one of these in proposal.json." : "Use the node runtime."}`,
      });
      evidence = result.cleanupStatus;
      const audit = auditToolReceipts(stdout, readFileSync(auditFile, "utf8"), nonce, { cwd: scratch, deny: denyRules, bash: development });
      options.record("worker-tool-audit", { nonce, ...audit });
      if (audit.violations.length) throw new Error(`native tool enforcement receipts invalid: ${audit.violations.join("; ")}`);
      for (const name of outputNames) {
        const from = path.join(scratch, name);
        if (existsSync(from)) writeFileSync(path.join(turn.cwd, name), regularBytes(from), { mode: 0o600 });
      }
      this.state.audit = development
        ? { egress: { lines: [], complete: false, basis: "sandbox-deny-all" }, writes: { status: "policy-enforced", outsideWrites: [], basis: "sandbox-and-reconciled-tool-receipts" } }
        : { egress: { lines: [], complete: true }, writes: { status: "complete", outsideWrites: [] } };
      options.record("worker-evidence", { nonce, cleanupStatus: evidence, evidenceBasis: "native-tool-capabilities-and-host-hook", network: development ? "sandboxed-offline-development" : "no-network-capable-tools" });
      return result;
    } catch (error) {
      // Only a graded runner result can establish post-dispatch cleanup.
      if (this.state.settled) evidence = this.state.settled;
      options.record("worker-error", { nonce, cleanupStatus: evidence, reason: error instanceof Error ? error.message : "unavailable worker error" });
      throw error;
    } finally {
      if (evidence !== "unproven" || this.state.sweepWarning) removeWorkspace(scratch, [options.workRoot], [options.authority]);
      options.record("worker-cleanup", { nonce, scratch, cleanupStatus: evidence, absent: !existsSync(scratch) });
    }
  }
}
