import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, mkdirSync, readFileSync, statfsSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SqliteEventStore, appendKernelEventInTransaction, canonicalJson } from "../../bio-core/src/index.ts";
import { assertNoSymlink, overlaps, physicalPath, removeWorkspace, samePath, within } from "./paths.ts";
import { PosixProcessHost, processAlive } from "./processes.ts";
import type { Dependencies, FaultPoint, PreparedWorker, RunConfig, RunState, StepSpec, TerminalStatus, Worktree } from "./types.ts";

const identifier = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/;
function validateConfig(input: RunConfig): RunConfig {
  const config = structuredClone(input);
  if (!identifier.test(config.runId)) throw new Error("invalid run id");
  const limits = config.limits;
  if (!Number.isSafeInteger(limits.maxAttempts) || limits.maxAttempts < 1 || limits.maxAttempts > 2 ||
      !Number.isSafeInteger(limits.deadline) || limits.deadline < 0 ||
      !Number.isSafeInteger(limits.crashWindowMs) || limits.crashWindowMs < 1 ||
      !/^\d+$/.test(limits.minFreeBytes)) throw new Error("invalid limits");
  config.authorityDir = physicalPath(config.authorityDir);
  config.workRoot = physicalPath(config.workRoot);
  config.scratchRoots = config.scratchRoots.map(physicalPath);
  config.evidenceRoots = config.evidenceRoots.map(physicalPath);
  const roots = [config.workRoot, ...config.scratchRoots];
  for (let i = 0; i < roots.length; i++) {
    if (samePath(roots[i]!, path.parse(roots[i]!).root)) throw new Error("filesystem root forbidden");
    if (roots.slice(i + 1).some(r => overlaps(roots[i]!, r))) throw new Error("overlapping cleanup roots");
    if ([config.authorityDir, ...config.evidenceRoots].some(r => overlaps(roots[i]!, r))) {
      throw new Error("authority/evidence must be outside agent write and cleanup roots");
    }
  }
  return config;
}
function materializeConfig(input: RunConfig): RunConfig {
  const config = validateConfig(input);
  // No database or disposable content exists yet. Revalidate after mkdir resolves missing aliases.
  for (const directory of [config.workRoot, ...config.scratchRoots, config.authorityDir, ...config.evidenceRoots]) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
  return validateConfig(config);
}
function repositoryGitDirectory(repository: string): string {
  const marker = path.join(repository, ".git");
  const stat = lstatSync(marker); // Never let Git fall back to a parent repository.
  if (stat.isSymbolicLink()) throw new Error("symlink Git metadata refused");
  let directory: string;
  if (stat.isDirectory()) directory = physicalPath(marker);
  else {
    const match = readFileSync(marker, "utf8").trim().match(/^gitdir: (.+)$/);
    if (!match) throw new Error("invalid Git metadata pointer");
    directory = physicalPath(path.resolve(repository, match[1]!));
  }
  if (!lstatSync(directory).isDirectory()) throw new Error("Git metadata directory unavailable");
  return directory;
}
function git(worktree: Worktree, args: string[]): string {
  assertNoSymlink(worktree.gitDirectory);
  if (!samePath(repositoryGitDirectory(worktree.repository), worktree.gitDirectory)) throw new Error("Git repository identity changed");
  return execFileSync("git", ["--git-dir", worktree.gitDirectory, "--work-tree", worktree.repository, ...args], {
    // Git may contend with concurrent native CI jobs; keep a bounded I/O budget.
    encoding: "utf8", timeout: 10000, stdio: ["ignore", "pipe", "pipe"],
  });
}
function listedWorktrees(worktree: Worktree): string[] {
  const output = git(worktree, ["worktree", "list", "--porcelain", "-z"]);
  const paths = output.split("\0").filter(s => s.startsWith("worktree ")).map(s => path.resolve(s.slice(9)));
  if (!paths.length) throw new Error("unparseable git worktree census");
  return paths;
}

/** One authority DB per run. All mutable state and journal events commit atomically. */
export class RunSupervisor {
  private readonly db: DatabaseSync;
  private readonly journal: SqliteEventStore;
  private readonly token = randomUUID();
  private readonly pid: number;
  private readonly host;
  private state!: RunState;
  private busy = false;
  private closed = false;
  private crashed = false;
  private stopHeartbeat: (() => void) | undefined;
  private stopActive: ((status: TerminalStatus, reason: string) => void) | undefined;
  private readonly config: RunConfig;
  private readonly deps: Dependencies;

  static async open(config: RunConfig, deps: Dependencies): Promise<RunSupervisor> {
    const supervisor = new RunSupervisor(config, deps);
    try {
      await supervisor.recover();
      supervisor.armHeartbeat();
      return supervisor;
    } catch (error) { supervisor.dispose(); throw error; }
  }

  private constructor(input: RunConfig, deps: Dependencies) {
    this.config = materializeConfig(input);
    this.deps = deps;
    this.pid = deps.ownerPid ?? process.pid;
    if (!Number.isSafeInteger(this.pid) || this.pid < 1) throw new Error("invalid owner pid");
    this.host = deps.processes ?? new PosixProcessHost();
    mkdirSync(this.config.authorityDir, { recursive: true, mode: 0o700 });
    const databasePath = path.join(this.config.authorityDir, "supervisor.sqlite");
    assertNoSymlink(databasePath);
    this.db = new DatabaseSync(databasePath);
    this.journal = new SqliteEventStore(this.db);
    this.db.exec("PRAGMA synchronous = FULL; PRAGMA busy_timeout = 25");
    this.db.exec("CREATE TABLE IF NOT EXISTS run_owner (singleton INTEGER PRIMARY KEY CHECK(singleton = 1), pid INTEGER NOT NULL, token TEXT NOT NULL, heartbeat REAL NOT NULL)");
    try {
      this.transaction(() => {
        if (!this.journal.verifyStream(this.config.runId).valid) throw new Error("journal integrity failure");
        const events = this.journal.readStream(this.config.runId);
        const last = events.at(-1);
        if (last) {
          const restored = last.payload as RunState;
          if (restored.version !== 1 || canonicalJson(restored.config) !== canonicalJson(this.config)) throw new Error("persisted policy/config mismatch");
          this.state = structuredClone(restored);
          this.validateState();
        } else {
          // Refuse opening a different run over an existing authority database.
          const count = this.db.prepare("SELECT COUNT(*) AS n FROM kernel_events").get() as { n: number };
          if (count.n) throw new Error("authority database belongs to another run");
          this.state = {
            version: 1, config: this.config, status: "ready", reason: "created", attempts: {}, steps: [], crashes: [],
            directories: [], groups: [], launches: [], worktrees: [], cleanupPending: false, terminalIntent: null, auditRequired: false, lastTime: 0,
          };
        }
        const now = this.time();
        const owner = this.db.prepare("SELECT pid FROM run_owner WHERE singleton = 1").get() as { pid: number } | undefined;
        if (owner && (deps.isAlive ?? processAlive)(owner.pid) !== false) throw new Error("run already owned; holder is live or unproven dead");
        this.db.prepare("INSERT OR REPLACE INTO run_owner VALUES (1, ?, ?, ?)").run(this.pid, this.token, now);
        if (this.state.cleanupPending) {
          if (this.state.status === "running") {
            const step = this.state.steps.at(-1)!;
            step.status = "interrupted";
            step.reason = "orchestrator interrupted; recovered by new owner";
            this.state.status = "interrupted";
            this.state.reason = step.reason;
          }
        }
        if (owner || this.state.cleanupPending) {
          this.state.crashes = this.state.crashes.filter(t => now - t <= this.config.limits.crashWindowMs);
          this.state.crashes.push(now);
          if (this.state.crashes.length >= 6 && this.state.status !== "cleanup-incomplete") {
            this.state.status = "paused";
            this.state.reason = "crash loop: 6 crashes inside the configured window";
          }
        }
        this.append("owner-acquired");
      });
    } catch (error) { this.db.close(); throw error; }
  }

  private validateState(): void {
    const s = this.state;
    const statuses = ["ready", "running", "cleaning", "paused", "success", "analysis-failed", "policy-limited", "canceled", "worker-killed", "interrupted", "cleanup-incomplete"];
    if (!statuses.includes(s.status) || !Number.isSafeInteger(s.lastTime) || !Array.isArray(s.steps) ||
        !Array.isArray(s.crashes) || !s.crashes.every(t => Number.isSafeInteger(t) && t >= 0) ||
        typeof s.cleanupPending !== "boolean" || typeof s.auditRequired !== "boolean" ||
        (s.terminalIntent !== null && !statuses.slice(4).includes(s.terminalIntent)) ||
        (s.status === "cleaning" && (!s.cleanupPending || s.terminalIntent === null)) ||
        !s.attempts || typeof s.attempts !== "object" || Array.isArray(s.attempts) ||
        !Object.values(s.attempts).every(n => Number.isSafeInteger(n) && n >= 1 && n <= 2) ||
        !Array.isArray(s.directories) || !s.directories.every(d => this.runDirectories().includes(d)) ||
        !Array.isArray(s.launches) || !s.launches.every(id => /^[a-f0-9-]{36}$/.test(id)) ||
        !Array.isArray(s.groups) || !s.groups.every(g => Number.isSafeInteger(g.id) && g.id > 1 && typeof g.identity === "string" && g.identity.length > 0) ||
        !Array.isArray(s.worktrees) || !s.worktrees.every(w => w.directory === path.join(this.config.workRoot, this.config.runId, "repo") && path.isAbsolute(w.repository) && typeof w.gitDirectory === "string" && path.isAbsolute(w.gitDirectory)) ||
        (s.status === "running" && (s.steps.at(-1)?.status !== "running" || !s.cleanupPending))) {
      throw new Error("invalid persisted supervisor state");
    }
  }
  private time(): number {
    const now = this.deps.now();
    if (!Number.isSafeInteger(now) || now < this.state.lastTime) throw new Error("invalid or regressing clock");
    return now;
  }
  private transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try { const result = fn(); this.db.exec("COMMIT"); return result; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  private assertOwner(): void {
    if (this.closed) throw new Error("supervisor closed");
    const owner = this.db.prepare("SELECT token FROM run_owner WHERE singleton = 1").get() as { token: string } | undefined;
    if (owner?.token !== this.token) throw new Error("owner fencing failure");
  }
  private append(type: string): void {
    this.state.lastTime = this.time();
    appendKernelEventInTransaction(this.db, {
      eventId: randomUUID(), streamId: this.config.runId, type, schemaVersion: 1,
      occurredAt: new Date(this.state.lastTime).toISOString(), producerPlaneId: "bio-supervisor", payload: this.state,
    });
  }
  private change(type: string, mutate: () => void): void {
    const previous = structuredClone(this.state);
    try {
      this.transaction(() => { this.assertOwner(); mutate(); this.append(type); });
    } catch (error) { this.state = previous; throw error; }
  }
  snapshot(): RunState { return structuredClone(this.state); }
  events() { return this.journal.readStream(this.config.runId); }
  verifyJournal() { return this.journal.verifyStream(this.config.runId); }
  heartbeat(): void {
    this.change("heartbeat", () => {
      this.db.prepare("UPDATE run_owner SET heartbeat = ? WHERE token = ?").run(this.time(), this.token);
    });
  }
  private schedule(ms: number, fn: () => void): () => void {
    if (this.deps.schedule) return this.deps.schedule(ms, fn);
    const timer = setTimeout(fn, ms);
    timer.unref();
    return () => clearTimeout(timer);
  }
  private armHeartbeat(): void {
    this.stopHeartbeat = this.schedule(1000, () => {
      try { this.heartbeat(); this.armHeartbeat(); }
      catch { this.stopActive?.("cleanup-incomplete", "heartbeat/ownership could not be verified"); }
    });
  }
  private fault(point: FaultPoint): void {
    try { this.deps.faultAt?.(point); }
    catch (error) { this.crashed = true; throw error; }
  }
  private runDirectories(): string[] { return [this.config.workRoot, ...this.config.scratchRoots].map(r => path.join(r, this.config.runId)); }
  private async recover(): Promise<void> {
    if (this.state.cleanupPending) await this.cleanup();
  }

  resume(): void {
    if (this.busy || this.state.cleanupPending || this.state.status === "cleanup-incomplete" || this.state.status === "running") throw new Error("run cannot resume before proven cleanup");
    this.change("resumed", () => {
      this.state.status = "ready";
      this.state.reason = "operator resumed; budgets retained";
    });
  }

  async runStep(spec: StepSpec): Promise<RunState> {
    if (this.busy || this.state.status !== "ready") throw new Error("run is not ready");
    if (!identifier.test(spec.hypothesis) || !path.isAbsolute(spec.command)) throw new Error("invalid hypothesis or executable");
    this.assertOwner();
    this.busy = true;
    let cancelDeadline: (() => void) | undefined;
    let removeAbort: (() => void) | undefined;
    let prepared: PreparedWorker | undefined;
    let stopped: { status: TerminalStatus; reason: string } | undefined;
    let resolveStop!: () => void;
    const stopPromise = new Promise<void>(resolve => { resolveStop = resolve; });
    const stop = (status: TerminalStatus, reason: string) => {
      if (!stopped) { stopped = { status, reason }; resolveStop(); }
    };
    this.stopActive = stop;
    try {
      const attempts = Object.hasOwn(this.state.attempts, spec.hypothesis) ? this.state.attempts[spec.hypothesis]! : 0;
      let refusal: string | undefined;
      if (attempts >= this.config.limits.maxAttempts) refusal = "hypothesis attempt cap reached";
      else if (this.time() >= this.config.limits.deadline) refusal = "run deadline reached";
      if (refusal || spec.signal?.aborted) {
        this.change("step-refused", () => {
          this.state.status = spec.signal?.aborted ? "canceled" : "policy-limited";
          this.state.reason = refusal ?? "operator canceled before step";
        });
        return this.snapshot();
      }
      try {
        for (const root of [this.config.workRoot, ...this.config.scratchRoots]) {
          assertNoSymlink(root);
          mkdirSync(root, { recursive: true, mode: 0o700 });
          const free = (this.deps.freeBytes ?? (dir => { const s = statfsSync(dir, { bigint: true }); return s.bavail * s.bsize; }))(root);
          if (typeof free !== "bigint" || free < BigInt(this.config.limits.minFreeBytes)) throw new Error("disk below free-space floor or unavailable");
        }
      } catch (error) {
        this.change("disk-refused", () => { this.state.status = "policy-limited"; this.state.reason = String(error); });
        return this.snapshot();
      }
      this.change("step-started", () => {
        Object.defineProperty(this.state.attempts, spec.hypothesis, { value: attempts + 1, enumerable: true, configurable: true, writable: true });
        this.state.steps.push({ id: randomUUID(), hypothesis: spec.hypothesis, attempt: attempts + 1, status: "running", reason: "started" });
        this.state.status = "running";
        this.state.reason = "step running";
        this.state.cleanupPending = true;
        this.state.terminalIntent = null;
        this.state.directories = this.runDirectories();
      });
      this.fault("step-recorded");
      for (const dir of this.state.directories) {
        assertNoSymlink(dir);
        mkdirSync(dir, { recursive: false, mode: 0o700 });
      }
      this.fault("workspace-created");
      let cwd = this.state.directories[0]!;
      if (spec.worktree) {
        const repository = physicalPath(spec.worktree.repository);
        const worktree: Worktree = { repository, gitDirectory: repositoryGitDirectory(repository), directory: path.join(cwd, "repo") };
        if (!spec.worktree.revision || spec.worktree.revision.startsWith("-")) throw new Error("invalid git revision");
        this.change("worktree-registered", () => { this.state.worktrees.push(worktree); });
        this.fault("worktree-recorded");
        git(worktree, ["worktree", "add", "--detach", worktree.directory, spec.worktree.revision]);
        cwd = worktree.directory;
        this.fault("worktree-created");
      }
      const checkDeadline = () => {
        try {
          const remaining = this.config.limits.deadline - this.time();
          if (remaining <= 0) stop("policy-limited", "run deadline reached; running step aborted");
          else cancelDeadline = this.schedule(Math.min(remaining, 2_147_483_647), checkDeadline);
        } catch { stop("cleanup-incomplete", "deadline clock unavailable or invalid"); }
      };
      checkDeadline();
      const abort = () => stop("canceled", "operator canceled running step");
      spec.signal?.addEventListener("abort", abort, { once: true });
      removeAbort = () => spec.signal?.removeEventListener("abort", abort);
      if (spec.signal?.aborted) abort();
      if (!stopped) {
        const launchId = randomUUID();
        this.change("launch-registered", () => { this.state.launches.push(launchId); });
        prepared = await this.host.prepare({
          launchId, command: spec.command, args: spec.args ?? [], cwd,
          env: { ...spec.env, TMPDIR: this.state.directories[1] ?? this.state.directories[0]!, OMERTA_BIO_RUN_ID: this.config.runId },
        });
        this.fault("worker-prepared");
        this.change("worker-registered", () => {
          if (!Number.isSafeInteger(prepared!.group.id) || prepared!.group.id <= 1 || !prepared!.group.identity) throw new Error("invalid process group");
          this.state.groups.push(prepared!.group);
          // Atomically replace the provisional launch token with the durable group identity.
          this.state.launches = this.state.launches.filter(id => id !== launchId);
          this.state.auditRequired = true;
        });
        this.fault("worker-registered");
        if (this.time() >= this.config.limits.deadline) stop("policy-limited", "run deadline reached; running step aborted");
        if (!stopped) {
          prepared.start();
          this.fault("worker-started");
          const result = await Promise.race([prepared.completion, stopPromise.then(() => undefined)]);
          if (!stopped) {
            if (this.time() >= this.config.limits.deadline) stop("policy-limited", "run deadline reached; running step aborted");
            else if (result?.code === 0 && result.signal === null) stop("success", "worker exited successfully");
            else if (result?.signal === "SIGKILL") stop("worker-killed", "worker received SIGKILL");
            else stop("analysis-failed", "worker failed or returned an unavailable/unknown result");
          }
        }
      }
      this.settle(stopped!.status, stopped!.reason);
      this.fault("step-settled");
      await this.cleanup();
      return this.snapshot();
    } catch (error) {
      if (this.crashed) throw error; // Exact crash injection: leave durable state for the next owner.
      if (prepared && !this.state.groups.some(g => g.id === prepared!.group.id)) {
        if (await this.host.reap(prepared.group) !== true) stop("cleanup-incomplete", "unregistered prepared worker could not be reaped");
      }
      try {
        this.settle(stopped?.status ?? "interrupted", stopped?.reason ?? `infrastructure interrupted: ${String(error)}`);
      } finally {
        // Even an unavailable clock/journal must not bypass physical process/resource cleanup.
        if (this.state.cleanupPending) await this.cleanup();
      }
      return this.snapshot();
    } finally {
      cancelDeadline?.(); removeAbort?.(); this.stopActive = undefined; this.busy = false;
    }
  }
  private settle(status: TerminalStatus, reason: string): void {
    this.change("step-settled", () => {
      this.state.terminalIntent = status;
      this.state.status = this.state.cleanupPending ? "cleaning" : status;
      this.state.reason = reason;
      const step = this.state.steps.at(-1);
      if (step?.status === "running") { step.status = status; step.reason = reason; }
    });
  }

  /** Reap first, audit second, remove only declared disposable roots, then verify absence. */
  private async cleanup(): Promise<void> {
    this.assertOwner();
    const errors: string[] = [];
    for (const group of this.state.groups) {
      try { if (await this.host.reap(group) !== true) errors.push(`process group ${group.id} cleanup unproven`); }
      catch (error) { errors.push(`process census/reap unavailable: ${String(error)}`); }
    }
    for (const launchId of this.state.launches) {
      try { if (await this.host.reapLaunch(launchId) !== true) errors.push(`process launch ${launchId} cleanup unproven`); }
      catch (error) { errors.push(`process launch census unavailable: ${String(error)}`); }
    }
    if (this.state.auditRequired) {
      try {
        const audit = await this.deps.auditWrites?.(this.snapshot());
        if (audit?.status !== "complete" || !Array.isArray(audit.outsideWrites) || !audit.outsideWrites.every(p => typeof p === "string")) errors.push("write audit unavailable or incomplete");
        else if (audit.outsideWrites.length) errors.push(`writes outside declared roots: ${audit.outsideWrites.join(", ")}`);
      } catch (error) { errors.push(`write audit unavailable: ${String(error)}`); }
    }
    const processesGone = !errors.some(e => e.startsWith("process"));
    if (processesGone) {
      for (const worktree of this.state.worktrees) {
        try {
          assertNoSymlink(worktree.directory);
          if (!within(this.state.directories[0]!, worktree.directory)) throw new Error("worktree outside run root");
          if ([this.config.authorityDir, ...this.config.evidenceRoots].some(protectedPath => overlaps(worktree.directory, protectedPath))) throw new Error("protected directory overlaps worktree");
          if (listedWorktrees(worktree).some(directory => samePath(directory, worktree.directory))) git(worktree, ["worktree", "remove", "--force", "--force", worktree.directory]);
          if (listedWorktrees(worktree).some(directory => [this.config.workRoot, ...this.config.scratchRoots].some(root => overlaps(root, directory)))) throw new Error("git worktree remains registered inside cleanup roots");
        } catch (error) { errors.push(`worktree cleanup unproven: ${String(error)}`); }
      }
      for (const dir of this.state.directories) {
        try { removeWorkspace(dir, [this.config.workRoot, ...this.config.scratchRoots], [this.config.authorityDir, ...this.config.evidenceRoots]); }
        catch (error) { errors.push(`directory cleanup refused: ${String(error)}`); }
      }
      for (const root of [this.config.workRoot, ...this.config.scratchRoots]) {
        try {
          assertNoSymlink(root);
          lstatSync(root); // Missing cleanup roots are not a successful census.
          try {
            lstatSync(path.join(root, this.config.runId));
            errors.push(`run directory remains: ${root}`);
          } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        } catch (error) { errors.push(`cleanup census unavailable: ${String(error)}`); }
      }
    }
    this.change("cleanup-completed", () => {
      if (errors.length) { this.state.status = "cleanup-incomplete"; this.state.reason = errors.join("; "); }
      else {
        if (this.state.status === "cleaning") this.state.status = this.state.terminalIntent!;
        this.state.cleanupPending = false; this.state.auditRequired = false;
        this.state.directories = []; this.state.worktrees = []; this.state.groups = []; this.state.launches = [];
      }
    });
    this.fault("cleanup-finished");
  }

  /** Close idle ownership. Active/incomplete work leaves a lock for positively-dead-owner recovery. */
  dispose(): void {
    if (this.closed) return;
    if (this.busy) throw new Error("cannot dispose a running supervisor");
    this.stopHeartbeat?.();
    try {
      if (!this.state.cleanupPending) this.transaction(() => {
        this.assertOwner(); this.db.prepare("DELETE FROM run_owner WHERE token = ?").run(this.token);
      });
    } finally { this.db.close(); this.closed = true; }
  }
}
