import { canonicalSha256 } from "../../bio-core/src/index.ts";
import { validity } from "../../bio-checks/src/index.ts";
import { checkEquivalence, exactMcNemar, pairedBootstrap } from "./statistics.ts";
import type { ArmConfig, ArmOutput, ArmSummary, AttemptRecord, BenchmarkDependencies, BenchmarkSettings, Grade, TaskCalibration, TaskCard, Usage } from "./types.ts";
import { freeze, parseGrade, parseOutput, snapshot, validateSettings } from "./validation.ts";

type Boundary<T> = { status: "ok"; value: T } | { status: "timeout" | "error"; reason: string };
const unavailableGrade = (): Grade => ({ outcome: "unavailable", claims: [] });
const message = (error: unknown): string => error instanceof Error ? error.message : "callback failed";

export interface BenchmarkResult {
  settings: BenchmarkSettings;
  settingsHash: string;
  tasks: readonly TaskCalibration[];
  attempts: readonly AttemptRecord[];
  arms: readonly ArmSummary[];
  comparison: {
    taskIds: readonly string[];
    mcnemar: ReturnType<typeof exactMcNemar> | null;
    bootstrap: ReturnType<typeof pairedBootstrap> | null;
    equivalence: ReturnType<typeof checkEquivalence>;
  };
}

/** No subprocesses or filesystem writes. Adapters own isolation, process reaping and
 * cleanup on AbortSignal; trusted calibration/grading adapters own sealed evidence.
 */
export class BenchmarkHarness {
  readonly #settings: BenchmarkSettings;
  readonly #settingsHash: string;
  readonly #deps: BenchmarkDependencies;
  #started = false;

  constructor(settings: BenchmarkSettings, dependencies: BenchmarkDependencies) {
    this.#settings = validateSettings(settings);
    this.#settingsHash = canonicalSha256(this.#settings);
    for (const name of ["register", "now", "calibration", "runArm", "grade"] as const) {
      if (typeof dependencies[name] !== "function") throw new Error(`missing dependency: ${name}`);
    }
    this.#deps = Object.freeze({ ...dependencies });
  }

  get settingsHash(): string { return this.#settingsHash; }
  get settings(): BenchmarkSettings { return snapshot(this.#settings); }

  /** Locks at construction, before even calibration; identical settings are idempotent. */
  assertSettings(settings: BenchmarkSettings): void {
    if (canonicalSha256(validateSettings(settings)) !== this.#settingsHash) throw new Error("pre-registered settings are locked");
  }

  async #bounded<T>(timeoutMs: number, action: (signal: AbortSignal) => T | Promise<T>): Promise<Boundary<T>> {
    const controller = new AbortController();
    const schedule = this.#deps.schedule ?? ((callback: () => void, ms: number) => {
      const timer = setTimeout(callback, ms);
      return () => clearTimeout(timer);
    });
    let cancel = () => {};
    try {
      let expire!: (value: Boundary<T>) => void;
      const timeout = new Promise<Boundary<T>>(resolve => { expire = resolve; });
      cancel = schedule(() => {
        // Settle the timeout before abort listeners can resolve the operation.
        expire({ status: "timeout", reason: `deadline exceeded (${timeoutMs} ms)` });
        controller.abort();
      }, timeoutMs);
      const operation = Promise.resolve().then(() => {
        if (controller.signal.aborted) throw new Error("deadline exceeded before start");
        return action(controller.signal);
      }).then<Boundary<T>, Boundary<T>>(
        value => ({ status: "ok", value }),
        error => ({ status: "error", reason: message(error) }),
      );
      return await Promise.race([timeout, operation]);
    } catch (error) {
      controller.abort();
      return { status: "error", reason: message(error) };
    } finally {
      cancel();
    }
  }

  #readClock(): number {
    try { return this.#deps.now(); } catch { return NaN; }
  }

  async #attempt(task: TaskCard, arm: ArmConfig, attempt: number): Promise<AttemptRecord> {
    const failures: string[] = [];
    const start = this.#readClock();
    const execution = await this.#bounded(this.#settings.timeoutMs, signal => this.#deps.runArm({
      task: freeze({ id: task.id, family: task.family, datasetManifestHash: task.datasetManifestHash, prompt: task.prompt }),
      arm, attempt, settingsHash: this.#settingsHash, signal,
    }));
    const end = this.#readClock();
    const wallClockMs = Number.isFinite(start) && Number.isFinite(end) && end >= start && Number.isFinite(end - start) ? end - start : null;
    if (wallClockMs === null) failures.push("clock: missing or non-monotonic measurement");
    let output: ArmOutput | null = null;
    let status: AttemptRecord["status"];
    if (execution.status === "ok") {
      try {
        output = parseOutput(execution.value);
        const observed = output.observed;
        if (observed.modelId !== arm.modelId || observed.cliVersion !== arm.cliVersion || observed.effort !== arm.effort ||
            observed.networkMode !== arm.networkMode || canonicalSha256(observed.allowedHosts) !== canonicalSha256(arm.allowedHosts)) {
          throw new Error("observed provenance does not match locked arm");
        }
        status = output.status;
      }
      catch (error) { status = "invalid-output"; failures.push(`execution: ${message(error)}`); }
    } else {
      status = execution.status === "timeout" ? "timeout" : "crashed";
      failures.push(`execution: ${execution.reason}`);
    }
    if (output && output.status !== "completed") failures.push(`execution: ${output.status}${output.reason ? `: ${output.reason}` : ""}`);
    let grade = unavailableGrade();
    if (output && status === "completed") {
      const grading = await this.#bounded(this.#settings.gradingTimeoutMs, signal => this.#deps.grade(task, output!, signal));
      if (grading.status === "ok") {
        try { grade = parseGrade(grading.value, output); }
        catch (error) { failures.push(`grading: ${message(error)}`); }
      } else failures.push(`grading: ${grading.reason}`);
      if (grade.outcome !== "accepted") failures.push(`answer key: ${grade.outcome}`);
    }
    const claims = output?.claims ?? [];
    const confirmed = claims.filter(c => c.label === "confirmed");
    const verdict = (id: string) => {
      const claimVerdict = grade.claims.find(c => c.id === id)?.verdict ?? "unavailable";
      // An unavailable overall check cannot certify acceptance, but does not erase a rejection.
      return grade.outcome === "unavailable" && claimVerdict === "accepted" ? "unavailable" : claimVerdict;
    };
    const falseVerified = confirmed.filter(c => verdict(c.id) === "rejected").length;
    const correctConfirmed = confirmed.filter(c => verdict(c.id) === "accepted").length;
    const unverifiedConfirmed = confirmed.length - falseVerified - correctConfirmed;
    const success = status === "completed" && grade.outcome === "accepted" && (task.negativeControl || correctConfirmed > 0) &&
      grade.claims.every(c => c.verdict === "accepted") && unverifiedConfirmed === 0 && falseVerified === 0;
    if (status === "completed" && !success && failures.length === 0) failures.push("endpoint: no fully supported result for the registered control");
    return freeze({ taskId: task.id, arm, observed: output?.observed ?? null, attempt, retries: attempt - 1, settingsHash: this.#settingsHash,
      status, wallClockMs, usage: output?.usage ?? null, output: output?.output ?? null, failures, grade, claims,
      falseVerified, correctConfirmed, unverifiedConfirmed, success });
  }

  /** Single use: reruns require a new explicitly registered benchmark, never overwrite evidence. */
  async run(): Promise<BenchmarkResult> {
    if (this.#started) throw new Error("benchmark already started");
    this.#started = true;
    if (this.#deps.register(this.#settings.studyId, this.#settingsHash) !== true) {
      throw new Error("pre-registered settings are locked or unavailable");
    }
    const tasks: TaskCalibration[] = [];
    const attempts: AttemptRecord[] = [];
    for (const task of this.#settings.tasks) {
      const boundary = await this.#bounded(this.#settings.calibrationTimeoutMs, signal => {
        const runners = this.#deps.calibration(task, signal);
        const guard = (runner: validity.CalibrationRunner): validity.CalibrationRunner => () => {
          if (signal.aborted) throw new Error("calibration deadline exceeded");
          return runner();
        };
        return validity.calibrateTask({ runEmpty: guard(runners.runEmpty),
          runReference: guard(runners.runReference), runPermuted: guard(runners.runPermuted) });
      });
      const calibration: validity.CalibrationResult = boundary.status === "ok" ? boundary.value : {
        status: "refused-inconclusive", empty: "error", reference: "error", permuted: "error", reason: boundary.reason,
      };
      const valid = calibration.status === "calibrated";
      tasks.push({ taskId: task.id, status: valid ? "valid" : "invalid", calibration });
      if (!valid) continue;
      for (const arm of this.#settings.arms) {
        for (let attempt = 1; attempt <= this.#settings.attemptsPerTask; attempt++) attempts.push(await this.#attempt(task, arm, attempt));
      }
    }
    const taskIds = tasks.filter(t => t.status === "valid" && (this.#settings.statistics.population === "all-valid" ||
      this.#settings.tasks.find(card => card.id === t.taskId)!.heldOut)).map(t => t.taskId);
    // Keep incomplete executions in the paired endpoint as failures, but never use
    // missing execution/grading evidence to authorize an equivalence decision.
    let completeEvidence = true;
    const pairs = taskIds.map(taskId => {
      const outcome = (armId: string): number => {
        const rows = attempts.filter(a => a.taskId === taskId && a.arm.id === armId);
        if (rows.length !== this.#settings.attemptsPerTask || rows.some(a => a.status !== "completed" ||
            a.grade.outcome === "unavailable" || a.grade.claims.some(c => c.verdict === "unavailable"))) completeEvidence = false;
        return Number(rows.length === this.#settings.attemptsPerTask && rows.every(a => a.success));
      };
      return { b: outcome("B"), c: outcome("C") };
    });
    const bootstrap = pairs.length ? pairedBootstrap(pairs, this.#settings.statistics) : null;
    return freeze({ settings: snapshot(this.#settings), settingsHash: this.#settingsHash, tasks, attempts,
      arms: this.#settings.arms.map(arm => summarizeArm(arm.id, attempts)),
      comparison: { taskIds, mcnemar: pairs.length ? exactMcNemar(pairs) : null, bootstrap,
        equivalence: checkEquivalence(completeEvidence ? bootstrap : null, this.#settings.statistics.equivalenceMargin,
          this.#settings.statistics.minPairedTasks) } });
  }
}

function summarizeArm(armId: string, all: readonly AttemptRecord[]): ArmSummary {
  const rows = all.filter(row => row.arm.id === armId);
  const sum = (fn: (row: AttemptRecord) => number) => rows.reduce((total, row) => total + fn(row), 0);
  const knownUsage = rows.length > 0 && rows.every(row => row.usage !== null);
  const usage: Usage | null = knownUsage ? { inputTokens: sum(r => r.usage!.inputTokens), outputTokens: sum(r => r.usage!.outputTokens), costUsd: sum(r => r.usage!.costUsd) } : null;
  return { armId, denominator: rows.length, successes: sum(r => Number(r.success)),
    successRate: rows.length ? sum(r => Number(r.success)) / rows.length : null,
    falseVerified: sum(r => r.falseVerified), correctConfirmed: sum(r => r.correctConfirmed), unverifiedConfirmed: sum(r => r.unverifiedConfirmed),
    // Each repeat is one retry, not the sum of cumulative retry indices.
    retries: sum(r => Number(r.attempt > 1)), failedAttempts: sum(r => Number(!r.success)),
    failures: sum(r => r.failures.length), timeouts: sum(r => Number(r.status === "timeout")), crashes: sum(r => Number(r.status === "crashed")),
    wallClockMs: rows.length > 0 && rows.every(r => r.wallClockMs !== null) ? sum(r => r.wallClockMs!) : null, usage };
}
