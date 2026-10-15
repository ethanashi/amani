import { checkEquivalence, exactMcNemar, pairedBootstrap, pairedRatioBootstrap } from "./statistics.ts";
import type { ArmConfig, AttemptRecord, Claim, Grade, TaskCard } from "./types.ts";

type Row = {
  id: string; task: string; arm: string; attempt: number; retry: number; phase: string;
  status: string; taskPassed: boolean; gradeOutcome: Grade["outcome"];
  claims: Claim[]; claimsAvailable: boolean; wallClockMs: number | null;
  provenance: { modelId: string | null; cliVersion: string; effort: string } | null;
  executionRetry?: number; sequence?: number; startedAt?: number; graded?: boolean; credited?: boolean;
  gradingMs?: number | null; infrastructureWarnings?: string[]; failure?: string | null; crashed?: boolean; claimsState?: "available" | "missing" | "malformed";
  tokens?: { inputTokens: number; outputTokens: number } | null; costUsd?: number | null; rateLimited?: boolean; tokenUsageComplete?: boolean;
  provenanceOk: boolean; resultSha256?: string | null; summarySha256?: string | null;
  /** Schedule window: 0 = locked plan, k = rows appended by amendment k. */
  window?: number;
  /** Status "rate-limited": the provider CLI's terminal outcome was a rate/usage limit. Infrastructure:
   * "rate-limited" (re-queued once per limit event) or "rate-limit-exhausted" (beyond rateLimitRetries). */
  infrastructure?: string; rateLimitEvents?: number;
  rateLimit?: { family?: string; signals?: string[]; resetsAt?: number | null; resetsAtUtc?: string | null; resetHint?: string | null } | null;
  /** Status "provider-refused": the CLI's terminal outcome was a provider safety refusal. Infrastructure:
   * "provider-refused" (fresh session re-queued) or "provider-refused-exhausted" (beyond refusalRetries).
   * `providerRefusals` counts refused turns in any row (transient ones in graded rows). */
  providerRefusals?: number; syntheticMessages?: number; providerRefusalEvents?: number; provenanceFailure?: string | null;
  providerRefusal?: { family?: string; signals?: string[]; categories?: string[]; refusals?: number; transient?: number; fallback?: boolean;
    /** Real (non-synthetic) assistant messages before the refusal ended the session. */
    agentMessages?: number } | null;
  /** Provider-refused rows: whether results.json existed, and the transcript audit verdict (never its hits). */
  deliverables?: boolean; contamination?: string;
  /** Supplement rows: "reclassified"/"regrade" replace the original row with the same id and retry;
   * "rerun" sessions ran after the whole study and are outside its locked order. */
  supplement?: { index: number; kind: "reclassified" | "regrade" | "rerun"; hash: string };
  supersedes?: Record<string, unknown>;
};
type Adjudication = {
  id: string; retry: number; resultSha256: string; summarySha256: string;
  claims: Grade["claims"];
};
export type PilotAmendmentOp = { op: string; arm: string; task?: string; from?: number; to?: number; previousReason?: string; settings?: unknown };
export type PilotAmendment = { index: number; timestamp: string; reason: string; diff: PilotAmendmentOp[]; settingsHash: string; previous: string; hash: string };
export interface PilotScoreInput {
  settingsHash: string;
  plan: {
    dryRun: boolean; tasks: { id: string; card: TaskCard }[];
    /** `attempts` defaults to attemptsPerArm. */
    arms: (Omit<ArmConfig, "kind" | "allowedHosts"> & { attempts?: number })[];
    attemptsPerArm: number; seed: number; retryRule?: { interruptedRetries: number; gradingRetries: number; rateLimitRetries?: number; refusalRetries?: number };
    /** Arm id -> reason. Disabled arms have no runs and are never scored (not zero, not a loss). */
    disabledArms?: Record<string, string>;
    /** Arm id -> task id -> reason, for registry-declared undispatchable cells of enabled arms. */
    disabledCells?: Record<string, Record<string, string>>;
    statistics: { resamples: number; equivalenceMargin: number; minPairedTasks: number; minConfirmationTasks: number; maxDroppedBootstrapShare: number; comparator: string; pilotImprovement: number };
  };
  schedule: { id: string; phase: string; window?: number; task?: string; arm?: string; attempt?: number }[];
  rows: Row[];
  adjudications: Adjudication[];
  amendments?: PilotAmendment[];
  /** Arm id -> provider family (registry). Lets the order check accept runs deferred by a provider pause. */
  providers?: Record<string, string>;
  /** Set when rows are a finished study overlaid by its supplement (pilot.py supplement_rows). */
  supplement?: { index: number; hash: string; previous: string; reason: string; commit: { sha: string; dirty: boolean };
    refusalRetries: number; rerunSlots: string[]; regradedRows: string[] };
}

/** The 9e rule's treatment arm. v1 is retired, so its pre-registered decision stays unavailable. */
export const PILOT_TREATMENT = "omerta-bio";

/** Pilot-only rule. This never authorizes a superiority or shipping claim. */
export function pilotDecision(input: {
  complete: boolean; comparatorAvailable: boolean; bFalseRate: number | null; cFalseRate: number | null;
  positiveControls: number; bPositivePasses: number; cPositivePasses: number;
}): "unavailable" | "proceed-to-confirmation" | "futility" {
  if (!input.complete || !input.comparatorAvailable || input.positiveControls === 0 ||
      input.bFalseRate === null || input.cFalseRate === null ||
      ![input.bFalseRate, input.cFalseRate].every(n => Number.isFinite(n) && n >= 0 && n <= 1)) return "unavailable";
  return input.bFalseRate - input.cFalseRate >= 0.1 - Number.EPSILON &&
    input.cPositivePasses >= input.bPositivePasses ? "proceed-to-confirmation" : "futility";
}

const launchedFailure = (row: Row) => ["timeout", "failed", "crashed", "blocked"].includes(row.status);
/** Provider rate/usage-limit failure: infrastructure, never charged to an arm, never in a denominator. */
const rateLimited = (row: Row) => row.status === "rate-limited";
/** Provider safety refusal that ended the CLI session: infrastructure, like a limit event. */
const providerRefused = (row: Row) => row.status === "provider-refused";
/** Statuses that never enter arm metrics: refusals, interruptions and provider limit/refusal events. */
const excluded = (row: Row) => ["not-started", "interrupted", "rate-limited", "provider-refused"].includes(row.status);
const infrastructureEvent = (row: Row) => rateLimited(row) || providerRefused(row);
const supplementRun = (row: Row) => row.supplement?.kind === "rerun";
const provenanceAvailable = (row: Row) => row.provenanceOk || (launchedFailure(row) && !row.provenance?.modelId);
const determinate = (row: Row) => provenanceAvailable(row) && row.graded !== false &&
  (launchedFailure(row) || (row.status === "completed" && row.gradeOutcome !== "unavailable"));

/** Convert the trusted task summaries to bio-bench's audit record format.
 * A task-level check cannot adjudicate arbitrary claims. Only a separate, hash-bound,
 * trusted adjudication may set a claim accepted/rejected; absent evidence is unavailable.
 */
export function pilotRecords(input: PilotScoreInput): AttemptRecord[] {
  const seen = new Set<string>();
  for (const a of input.adjudications) {
    const key = `${a.id}/${a.retry}`;
    if (seen.has(key)) throw new Error("duplicate adjudication");
    seen.add(key);
    if (!input.rows.some(r => r.id === a.id && r.retry === a.retry)) throw new Error("unknown adjudication run");
  }
  return input.rows.filter(row => !excluded(row) && determinate(row)).map(row => {
    const config = input.plan.arms.find(a => a.id === row.arm);
    if (!config) throw new Error("unknown arm");
    const arm: ArmConfig = { ...config, kind: config.id as ArmConfig["kind"], allowedHosts: [] };
    const status: AttemptRecord["status"] = row.status === "interrupted" || row.status === "running" || row.crashed || row.failure === "adapter-error" ? "crashed" :
      row.status === "completed" || row.status === "timeout" || row.status === "crashed" ? row.status : "failed";
    const submitted = row.claims;
    const zeroOutcome = !["completed", "running"].includes(row.status) || row.credited === false || row.claimsState === "malformed" || !provenanceAvailable(row);
    const claims = zeroOutcome ? [] : submitted;
    if (!Array.isArray(submitted) || new Set(submitted.map(c => c.id)).size !== submitted.length ||
        submitted.some(c => typeof c.id !== "string" || !["confirmed", "tentative", "refuted", "insufficient", "contradicted"].includes(c.label))) {
      throw new Error("invalid claim records");
    }
    const adjudication = input.adjudications.find(a => a.id === row.id && a.retry === row.retry);
    if (adjudication && (!row.claimsAvailable || !row.resultSha256 || !row.summarySha256 ||
        row.resultSha256 !== adjudication.resultSha256 || row.summarySha256 !== adjudication.summarySha256 ||
        adjudication.claims.length !== submitted.length || new Set(adjudication.claims.map(c => c.id)).size !== submitted.length ||
        adjudication.claims.some(c => !submitted.some(v => v.id === c.id) || !["accepted", "rejected", "unavailable"].includes(c.verdict)))) {
      throw new Error("adjudication must match immutable result, summary and exact claim IDs");
    }
    const gradeAvailable = status === "completed" && row.provenanceOk && ["accepted", "rejected"].includes(row.gradeOutcome);
    const grade: Grade = { outcome: gradeAvailable ? row.gradeOutcome : "unavailable", claims: claims.map(c => {
      const verdict = adjudication?.claims.find(v => v.id === c.id)?.verdict ?? "unavailable";
      return { id: c.id, verdict };
    }) };
    const confirmed = claims.filter(c => c.label === "confirmed");
    const count = (verdict: string) => confirmed.filter(c => grade.claims.some(v => v.id === c.id && v.verdict === verdict)).length;
    const success = row.taskPassed === true && status === "completed" && row.graded !== false && row.credited !== false && row.claimsState !== "malformed" && gradeAvailable && row.gradeOutcome === "accepted";
    return {
      taskId: row.task, arm, observed: row.provenance?.modelId && row.provenanceOk ? {
        ...row.provenance, modelId: row.provenance.modelId, networkMode: "confirm", allowedHosts: [], networkEnforced: true,
      } : null,
      attempt: row.attempt, retries: row.executionRetry ?? row.retry, settingsHash: input.settingsHash, status,
      wallClockMs: row.wallClockMs, usage: row.tokens && row.costUsd != null ? { ...row.tokens, costUsd: row.costUsd } : null, failures: success ? [] : [row.status === "interrupted" ? "interrupted" : "task not verified"],
      output: null, grade, claims, falseVerified: count("rejected"), correctConfirmed: count("accepted"),
      unverifiedConfirmed: count("unavailable"), success,
    };
  });
}

export function scorePilot(input: PilotScoreInput) {
  const disabledArms = input.plan.disabledArms ?? {};
  const disabledCells = input.plan.disabledCells ?? {};
  const planArmIds = input.plan.arms.map(a => a.id);
  for (const [arm, reason] of Object.entries(disabledArms))
    if (!planArmIds.includes(arm) || typeof reason !== "string" || !reason.trim()) throw new Error("invalid disabled arm");
  for (const [arm, cellsOff] of Object.entries(disabledCells)) for (const [task, reason] of Object.entries(cellsOff))
    if (!planArmIds.includes(arm) || disabledArms[arm] !== undefined || !input.plan.tasks.some(t => t.id === task) ||
        typeof reason !== "string" || !reason.trim()) throw new Error("invalid disabled task cell");
  const cellReason = (task: string, arm: string) => disabledCells[arm]?.[task];
  const off = (task: string, arm: string) => disabledArms[arm] !== undefined || cellReason(task, arm) !== undefined;
  // Fail closed: a disabled arm or cell can never contribute evidence, zeros or losses.
  if (input.rows.some(r => off(r.task, r.arm)) ||
      input.schedule.some(s => s.arm !== undefined && s.task !== undefined && off(s.task, s.arm)))
    throw new Error("disabled arms and task cells must have no scheduled or recorded runs");
  const attemptsOf = (arm: string) => input.plan.arms.find(a => a.id === arm)?.attempts ?? input.plan.attemptsPerArm;
  const slotKey = (arm: string, task: string, attempt: number) => `${arm}\u0000${task}\u0000${attempt}`;
  const slotWindow = new Map<string, number>();
  for (const r of input.rows) if (r.phase === "main") slotWindow.set(slotKey(r.arm, r.task, r.attempt), r.window ?? 0);
  for (const s of input.schedule) if (s.phase === "main" && s.arm !== undefined && s.task !== undefined && s.attempt !== undefined)
    slotWindow.set(slotKey(s.arm, s.task, s.attempt), s.window ?? 0);
  const adjudicationKeys = new Set<string>();
  for (const a of input.adjudications) {
    const key = `${a.id}/${a.retry}`;
    if (adjudicationKeys.has(key) || !input.rows.some(r => r.id === a.id && r.retry === a.retry))
      throw new Error("duplicate or unknown adjudication run");
    adjudicationKeys.add(key);
  }
  const originalRows = input.rows;
  const infrastructureRefusals = originalRows.filter(r => r.status === "not-started");
  const interruptions = originalRows.filter(r => r.status === "interrupted");
  const replaced = (r: Row) => originalRows.some(next => next.id === r.id && next.retry > r.retry && determinate(next) &&
    (next.executionRetry ?? next.retry) <= (input.plan.retryRule?.interruptedRetries ?? 0));
  const unresolvedInterruptions = interruptions.filter(r => !replaced(r));
  // A rate-limited slot is resolved once a newer launched row replaces it; otherwise it stays outstanding
  // (retryable, or exhausted beyond rateLimitRetries) and its comparisons are incomplete.
  const newest = new Map<string, Row>();
  for (const r of originalRows) if (r.status !== "not-started" && (newest.get(r.id)?.retry ?? -1) < r.retry) newest.set(r.id, r);
  const rateLimitedRows = originalRows.filter(rateLimited);
  const unresolvedRateLimits = [...newest.values()].filter(rateLimited);
  // Same for provider safety refusals: resolved by a newer launched row (a fresh session) for the slot.
  const refusedRows = originalRows.filter(providerRefused);
  // Refused sessions that did work first (agent messages or deliverables): shown, since the slot got a fresh session.
  const refusedAfterWork = refusedRows.filter(r => (r.providerRefusal?.agentMessages ?? 0) > 0 || r.deliverables === true);
  const unresolvedRefusals = [...newest.values()].filter(providerRefused);
  const unavailableArms = new Set(originalRows.filter(r => r.status !== "not-started" && !infrastructureEvent(r) &&
    ((r.status === "interrupted" && !replaced(r)) || (r.status !== "interrupted" && !determinate(r)))).map(r => r.arm));
  const provenanceUnavailable = [...new Set(originalRows.filter(r => !excluded(r) &&
    !provenanceAvailable(r)).map(r => r.arm))];
  const infrastructureUnknowns = originalRows.filter(r => r.status !== "not-started" && !infrastructureEvent(r) &&
    (r.status === "interrupted" || !determinate(r)));
  const scoredRows = originalRows.filter(r => !excluded(r) && determinate(r));
  input = { ...input, rows: scoredRows, adjudications: input.adjudications.filter(a =>
    scoredRows.some(r => r.id === a.id && r.retry === a.retry)) };
  const order = new Map(input.schedule.map((s, i) => [s.id, i]));
  // Supplement sessions ran after the whole study by design: outside the locked order, ordered among themselves.
  const supplementRows = originalRows.filter(r => r.status !== "not-started" && supplementRun(r));
  const supplementOrderValid = supplementRows.every((r, i) => order.has(r.id) && Number.isSafeInteger(r.sequence) &&
    r.sequence! > 0 && Number.isFinite(r.startedAt) && (i === 0 || (r.sequence! > supplementRows[i - 1]!.sequence! &&
    r.startedAt! >= supplementRows[i - 1]!.startedAt!)));
  const launchedRows = originalRows.filter(r => r.status !== "not-started" && !supplementRun(r));
  const providers = input.providers ?? {};
  let frontier = -1;
  const providerFrontier = new Map<string, number>(), pausedFrom = new Map<string, number>();
  const deferredRows: Row[] = [];
  const lockedOrderValid = launchedRows.every((r, i) => {
    const previous = launchedRows[i - 1];
    if (!(Number.isSafeInteger(r.sequence) && r.sequence! > 0 && Number.isFinite(r.startedAt) && order.has(r.id) &&
        (!previous || (r.sequence! > previous.sequence! && r.startedAt! >= previous.startedAt!)))) return false;
    const index = order.get(r.id)!, provider = providers[r.arm];
    // Locked order, except a provider paused by an earlier rate-limited run at or before this slot may
    // run behind the other providers; it never runs behind its own provider's earlier runs.
    if (index < frontier) {
      if (provider === undefined || index < (providerFrontier.get(provider) ?? -1) ||
          (pausedFrom.get(provider) ?? Infinity) > index) return false;
      deferredRows.push(r);
    }
    frontier = Math.max(frontier, index);
    if (provider !== undefined) {
      providerFrontier.set(provider, Math.max(providerFrontier.get(provider) ?? -1, index));
      if (rateLimited(r)) pausedFrom.set(provider, Math.min(pausedFrom.get(provider) ?? Infinity, index));
    }
    return true;
  });
  const orderValid = lockedOrderValid && supplementOrderValid;
  const allRecords = pilotRecords(input);
  const indices = input.rows.map((r, i) => r.phase === "main" ? i : -1).filter(i => i >= 0);
  const rows = indices.map(i => input.rows[i]!);
  const records = indices.map(i => allRecords[i]!);
  const tasks = input.plan.tasks;
  const armIds = planArmIds.filter(arm => disabledArms[arm] === undefined);
  const ratio = (n: number, d: number) => d ? n / d : null;
  const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
  const expected = input.schedule.filter(s => s.phase === "main");
  const complete = expected.length > 0 && expected.every(s => rows.some(r => r.id === s.id && r.status !== "running"));
  const scheduleComplete = input.schedule.length > 0 && input.schedule.every(s =>
    input.rows.some(r => r.id === s.id && r.status !== "running"));
  const metrics = (selected: AttemptRecord[], source: Row[]) => {
    const confirmed = sum(selected.map(r => r.claims.filter(c => c.label === "confirmed").length));
    const rejected = sum(selected.map(r => r.falseVerified));
    const accepted = sum(selected.map(r => r.correctConfirmed));
    const unknown = sum(selected.map(r => r.unverifiedConfirmed));
    const known = source.length > 0 && source.every(r => r.claimsAvailable ||
      (!["completed", "running"].includes(r.status)) || r.credited === false || r.claimsState === "missing" || r.claimsState === "malformed") && unknown === 0;
    const subset = (flag: "positiveControl" | "negativeControl" | "plantedFlaws") => selected.filter(r => {
      const card = tasks.find(t => t.id === r.taskId)!.card;
      return flag === "plantedFlaws" ? card.plantedFlaws.length > 0 : card[flag];
    });
    const positive = subset("positiveControl");
    const negative = subset("negativeControl");
    const flaws = subset("plantedFlaws");
    const correctAbstentions = negative.filter(r => r.success && !r.claims.some(c => c.label === "confirmed") &&
      source[selected.indexOf(r)]?.claimsAvailable).length;
    return {
      availability: source.some(r => unavailableArms.has(r.arm)) ? "infrastructure unavailable" : "available",
      denominator: selected.length, successes: selected.filter(r => r.success).length,
      taskPassRate: ratio(selected.filter(r => r.success).length, selected.length),
      confirmedClaims: confirmed, rejectedConfirmed: rejected, acceptedConfirmed: accepted, unverifiedConfirmed: unknown,
      claimMetricsAvailable: known, falseVerifiedRate: known ? ratio(rejected, confirmed) : null,
      // Mean number of correct confirmed claims per task-attempt, including failed attempts/retries.
      verifiedYield: known ? ratio(accepted, selected.length) : null,
      positiveControlPasses: positive.filter(r => r.success).length,
      positiveControlPassRate: ratio(positive.filter(r => r.success).length, positive.length),
      negativeControlAbstention: ratio(correctAbstentions, negative.length),
      plantedFlawCatchRate: ratio(flaws.filter(r => r.success).length, flaws.length),
      timeouts: selected.filter(r => r.status === "timeout").length,
      crashes: selected.filter(r => r.status === "crashed").length,
      tasksWithConfirmations: new Set(selected.filter(r => r.claims.some(c => c.label === "confirmed")).map(r => r.taskId)).size,
      taskConfirmationShare: ratio(new Set(selected.filter(r => r.claims.some(c => c.label === "confirmed")).map(r => r.taskId)).size,
        new Set(selected.map(r => r.taskId)).size),
      reportedInputTokens: sum(source.map(r => r.tokens?.inputTokens ?? 0)),
      reportedOutputTokens: sum(source.map(r => r.tokens?.outputTokens ?? 0)),
      tokenUsageComplete: source.length > 0 && source.every(r => r.tokens != null && r.tokenUsageComplete === true),
      reportedCostUsd: sum(source.map(r => r.costUsd ?? 0)),
      // Transient limit markers in scored (completed or charged) runs; limit failures are counted below.
      rateLimitedRuns: source.filter(r => r.rateLimited).length,
      gradingMs: sum(source.map(r => r.gradingMs ?? 0)),
      knownWallClockMs: sum(selected.map(r => r.wallClockMs ?? 0)),
      wallClockComplete: selected.length > 0 && selected.every(r => r.wallClockMs !== null),
      retries: selected.filter(r => r.retries > 0).length,
      wallClockMs: selected.length && selected.every(r => r.wallClockMs !== null) ? sum(selected.map(r => r.wallClockMs!)) : null,
    };
  };
  const limitCounts = (keep: (r: Row) => boolean) => {
    const refused = refusedRows.filter(r => r.phase === "main" && keep(r)).length;
    const outcomes = rows.filter(keep).length;
    return {
      rateLimitExcludedRuns: rateLimitedRows.filter(r => r.phase === "main" && keep(r)).length,
      rateLimitUnresolvedRuns: unresolvedRateLimits.filter(r => r.phase === "main" && keep(r)).length,
      rateLimitExhaustedRuns: unresolvedRateLimits.filter(r => r.phase === "main" && keep(r) && r.infrastructure === "rate-limit-exhausted").length,
      // Refused sessions are excluded from every denominator; the rate is refused / (refused + scored) sessions.
      providerRefusedRuns: refused,
      providerRefusedUnresolvedRuns: unresolvedRefusals.filter(r => r.phase === "main" && keep(r)).length,
      providerRefusedExhaustedRuns: unresolvedRefusals.filter(r => r.phase === "main" && keep(r) && r.infrastructure === "provider-refused-exhausted").length,
      providerRefusalRate: ratio(refused, refused + outcomes),
      // Scored runs that rode out a refused turn (graded normally).
      providerRefusalTransientRuns: rows.filter(r => keep(r) && (r.providerRefusals ?? 0) > 0).length,
      supplementRuns: rows.filter(r => keep(r) && supplementRun(r)).length,
    };
  };
  const armMetrics = (arm: string, selected: AttemptRecord[], source: Row[], keep: (r: Row) => boolean) => {
    const value = { ...metrics(selected, source), ...limitCounts(keep) };
    return { ...value, availability: provenanceUnavailable.includes(arm) ? "provenance unavailable" :
      unavailableArms.has(arm) ? "infrastructure unavailable" : "available",
      ...(unavailableArms.has(arm) ? { taskPassRate: null, falseVerifiedRate: null, verifiedYield: null,
        positiveControlPassRate: null, negativeControlAbstention: null, plantedFlawCatchRate: null,
        claimMetricsAvailable: false, tokenUsageComplete: false, wallClockComplete: false, wallClockMs: null } : {}) };
  };
  const arms = armIds.map(arm => ({ arm, ...armMetrics(arm, records.filter(r => r.arm.id === arm), rows.filter(r => r.arm === arm),
    r => r.arm === arm) }));
  const cells = tasks.flatMap(task => armIds.filter(arm => cellReason(task.id, arm) === undefined).map(arm => ({ task: task.id, arm,
    ...armMetrics(arm, records.filter(r => r.taskId === task.id && r.arm.id === arm), rows.filter(r => r.task === task.id && r.arm === arm),
      r => r.task === task.id && r.arm === arm),
    plannedAttempts: attemptsOf(arm),
    outcomes: rows.filter(r => r.task === task.id && r.arm === arm).map(r => ({ attempt: r.attempt, retry: r.retry, status: r.status, passed: r.taskPassed })),
  })));
  const disabledCellList = tasks.flatMap(task => planArmIds.flatMap(arm => {
    const reason = disabledArms[arm] ?? cellReason(task.id, arm);
    return reason === undefined ? [] : [{ task: task.id, arm, availability: `disabled: ${reason}` }];
  }));
  const bootstrap = (pairs: { b: number; c: number }[], confidence: number) => pairs.length ? pairedBootstrap(pairs, {
    seed: input.plan.seed, resamples: input.plan.statistics.resamples, confidence,
  }) : null;
  // Every enabled pair, first arm minus second; the 9e treatment is always second ("B minus C").
  const pairOrder = (ids: string[]) => [...ids.filter(a => a !== PILOT_TREATMENT), ...ids.filter(a => a === PILOT_TREATMENT)];
  const armPairs = (ids: string[]) => pairOrder(ids).flatMap((b, i, all) => all.slice(i + 1).map(c => [b, c] as const));
  const comparisons = armPairs(armIds).map(([b, c]) => {
    const cell = (task: string, arm: string) => cells.find(x => x.task === task && x.arm === arm)!;
    const excludedTasks = tasks.flatMap(t => [b, c].flatMap(arm => {
      const reason = cellReason(t.id, arm);
      return reason === undefined ? [] : [{ task: t.id, arm, reason }];
    }));
    const counted = tasks.filter(t => !excludedTasks.some(x => x.task === t.id));
    const plannedB = attemptsOf(b), plannedC = attemptsOf(c);
    // Endpoint all-attempts-task-passed is only paired at equal, fully completed attempts.
    const incompleteReasons: string[] = [];
    if (plannedB !== plannedC) incompleteReasons.push(`unequal planned attempts (${b} ${plannedB}, ${c} ${plannedC})`);
    else {
      const uneven = counted.filter(t => cell(t.id, b).denominator !== plannedB || cell(t.id, c).denominator !== plannedC).length;
      if (uneven) incompleteReasons.push(`completed attempts unequal or outstanding on ${uneven} task(s)`);
    }
    if (!counted.length) incompleteReasons.push("no task is enabled for both arms");
    const limited = unresolvedRateLimits.filter(r => r.arm === b || r.arm === c);
    if (limited.length) incompleteReasons.push(`provider rate/usage limit: ${limited.length} unresolved run(s) (${[b, c]
      .map(arm => `${arm} ${limited.filter(r => r.arm === arm).length}`).join(", ")})`);
    const refusing = unresolvedRefusals.filter(r => r.arm === b || r.arm === c);
    if (refusing.length) incompleteReasons.push(`provider refusal: ${refusing.length} unresolved run(s) (${[b, c]
      .map(arm => `${arm} ${refusing.filter(r => r.arm === arm).length}`).join(", ")})`);
    const attemptsComplete = incompleteReasons.length === 0;
    const windowsB = new Set<number>(), windowsC = new Set<number>();
    let windowMismatch = false;
    for (const t of counted) for (let k = 1; k <= Math.max(plannedB, plannedC); k++) {
      const x = k <= plannedB ? slotWindow.get(slotKey(b, t.id, k)) ?? 0 : undefined;
      const y = k <= plannedC ? slotWindow.get(slotKey(c, t.id, k)) ?? 0 : undefined;
      if (x !== undefined) windowsB.add(x);
      if (y !== undefined) windowsC.add(y);
      if (x !== undefined && y !== undefined && x !== y) windowMismatch = true;
    }
    const windowConfounded = windowMismatch || windowsB.size !== windowsC.size || [...windowsB].some(w => !windowsC.has(w));
    const pairs = counted.map(t => {
      const value = (arm: string, planned: number) => {
        const x = cell(t.id, arm);
        // Additional retries never erase the original failure.
        return Number(x.denominator === planned && x.successes === planned);
      };
      return { b: value(b, plannedB), c: value(c, plannedC) };
    });
    const pairAvailable = attemptsComplete && !unavailableArms.has(b) && !unavailableArms.has(c) && complete && scheduleComplete;
    const interval90 = pairAvailable ? bootstrap(pairs, 0.90) : null;
    const evidenceComplete = pairAvailable && orderValid && unresolvedInterruptions.length === 0 &&
      originalRows.filter(r => !excluded(r) && (r.arm === b || r.arm === c))
        .every(r => determinate(r) && r.failure !== "adapter-error");
    const ratesKnown = counted.every(t => cell(t.id, b).claimMetricsAvailable && cell(t.id, c).claimMetricsAvailable);
    const falsePairs = counted.map(t => {
      const counts = (arm: string) => ({ numerator: cell(t.id, arm).rejectedConfirmed, denominator: cell(t.id, arm).confirmedClaims });
      return { b: counts(b), c: counts(c) };
    });
    const falseInterval = (confidence: number) => pairAvailable && ratesKnown ? pairedRatioBootstrap(falsePairs, {
      seed: input.plan.seed, resamples: input.plan.statistics.resamples, confidence,
    }) : null;
    const false90 = falseInterval(0.90);
    // checkEquivalence labels superiority for higher-is-better outcomes. False-verified
    // rate is lower-is-better, so invert only its decision input; report raw B-minus-C CIs.
    const sparsityReasons: string[] = [];
    for (const arm of [b, c]) {
      if ((arms.find(a => a.arm === arm)?.tasksWithConfirmations ?? 0) < input.plan.statistics.minConfirmationTasks)
        sparsityReasons.push(`${arm}: fewer than ${input.plan.statistics.minConfirmationTasks} tasks with confirmations`);
    }
    if (!false90 || false90.droppedShare > input.plan.statistics.maxDroppedBootstrapShare)
      sparsityReasons.push(`defined bootstrap evidence unavailable or dropped share exceeds ${input.plan.statistics.maxDroppedBootstrapShare}`);
    const falseUtility90 = false90 && sparsityReasons.length === 0 ? { n: false90.n, estimate: -false90.estimate,
      lower: -false90.upper, upper: -false90.lower } : null;
    const equivalence = (interval: Parameters<typeof checkEquivalence>[0]) => {
      const result = checkEquivalence(evidenceComplete ? interval : null,
        input.plan.statistics.equivalenceMargin, input.plan.statistics.minPairedTasks);
      const labels = { "ship-tool-pack": "within-margin", "b-superior": "comparator-better",
        "retain-omerta-bio": "omerta-better", "insufficient": "insufficient" } as const;
      return { ...result, decision: labels[result.decision] };
    };
    return { b, c, role: "descriptive-only", difference: `${b} minus ${c}`, independentUnit: "task",
      status: !attemptsComplete ? "incomplete" : pairAvailable ? "available" : "unavailable",
      incompleteReasons, excludedTasks, pairedTasks: counted.length, plannedAttempts: { b: plannedB, c: plannedC },
      windowConfounded, windows: { b: [...windowsB].sort((x, y) => x - y), c: [...windowsC].sort((x, y) => x - y) },
      rateLimitDeferredRuns: deferredRows.filter(r => r.arm === b || r.arm === c).length,
      supplementRuns: rows.filter(r => supplementRun(r) && (r.arm === b || r.arm === c)).length,
      evidenceComplete, sparsityReasons,
      mcnemar: pairAvailable && pairs.length ? exactMcNemar(pairs) : null,
      taskPassBootstrap95: pairAvailable ? bootstrap(pairs, 0.95) : null, taskPassBootstrap90: interval90,
      falseVerifiedBootstrap95: falseInterval(0.95), falseVerifiedBootstrap90: false90,
      falseVerifiedEquivalence: equivalence(falseUtility90),
      equivalence: equivalence(interval90),
      shippingAuthorized: false,
    };
  });
  const comparator = input.plan.statistics.comparator;
  // The decision needs both registered arms enabled, and both run in the same schedule window(s).
  const decisionReasons: string[] = [];
  for (const [role, arm] of [["comparator", comparator], ["treatment", PILOT_TREATMENT]] as const) {
    if (!planArmIds.includes(arm)) decisionReasons.push(`reserved ${role} ${arm} unavailable`);
    else if (disabledArms[arm] !== undefined) decisionReasons.push(`${role} ${arm} disabled: ${disabledArms[arm]}`);
  }
  const decisionPair = comparisons.find(x => x.b === comparator && x.c === PILOT_TREATMENT);
  if (decisionPair?.windowConfounded)
    decisionReasons.push(`${comparator} and ${PILOT_TREATMENT} ran in different schedule windows (window-confounded)`);
  if (decisionPair?.rateLimitDeferredRuns)
    decisionReasons.push(`${comparator} and ${PILOT_TREATMENT} include runs deferred by a provider usage-limit pause`);
  if (decisionPair?.supplementRuns)
    decisionReasons.push(`${comparator} and ${PILOT_TREATMENT} include supplement runs made after the study`);
  const b = arms.find(a => a.arm === comparator);
  const c = arms.find(a => a.arm === PILOT_TREATMENT);
  const gate = pilotDecision({ complete: complete && scheduleComplete && orderValid && !input.plan.dryRun &&
      comparisons.every(c => c.evidenceComplete && c.sparsityReasons.length === 0), comparatorAvailable: Boolean(b),
    bFalseRate: b?.falseVerifiedRate ?? null, cFalseRate: c?.falseVerifiedRate ?? null,
    positiveControls: tasks.filter(t => t.card.positiveControl).length,
    bPositivePasses: b?.positiveControlPasses ?? 0, cPositivePasses: c?.positiveControlPasses ?? 0 });
  const decision = decisionReasons.length ? "unavailable" : gate;
  const decisionReason = decisionReasons.length ? decisionReasons.join("; ") : "pre-registered pilot gate";
  const disabledArmList = planArmIds.flatMap(arm => disabledArms[arm] === undefined ? [] :
    [{ arm, reason: disabledArms[arm]!, availability: `disabled: ${disabledArms[arm]}` }]);
  const disabledComparisons = armPairs(planArmIds).flatMap(([x, y]) => {
    const offArms = [x, y].filter(a => disabledArms[a] !== undefined);
    return offArms.length ? [{ b: x, c: y, availability: `disabled: ${offArms.map(a => `${a}: ${disabledArms[a]}`).join("; ")}` }] : [];
  });
  const amendments = input.amendments ?? [];
  const sentinels = input.rows.flatMap((r, i) => r.phase === "main" ? [] : [{ task: r.task, arm: r.arm, phase: r.phase,
    attempt: r.attempt, retry: r.retry, window: r.window ?? 0, status: r.status, passed: allRecords[i]!.success,
    provenance: r.provenance, wallClockMs: r.wallClockMs }]);
  const infrastructureWarnings = originalRows.filter(r => r.infrastructureWarnings?.length).map(r =>
    ({ id: r.id, retry: r.retry, arm: r.arm, warnings: r.infrastructureWarnings! }));
  const missingSlots = input.schedule.filter(s => !scoredRows.some(r => r.id === s.id));
  const fmt = (n: number | null) => n === null ? "unavailable" : String(Math.round(n * 10000) / 10000);
  const ci = (v: ReturnType<typeof pairedBootstrap> | null) => v ? `${fmt(v.estimate)} [${fmt(v.lower)}, ${fmt(v.upper)}]` : "unavailable";
  const change = (op: PilotAmendmentOp) => op.op === "raise-attempts" ? `raise ${op.arm} attempts ${op.from} to ${op.to}` :
    op.op === "enable-cell" ? `enable ${op.arm} on ${op.task}` : `${op.op} ${op.arm}`;
  const status = (x: typeof comparisons[number]) => [x.status === "incomplete" ? `incomplete: ${x.incompleteReasons.join("; ")}` : x.status,
    ...x.excludedTasks.map(e => `${e.task} excluded (${e.arm} disabled: ${e.reason})`),
    ...(x.rateLimitDeferredRuns ? [`${x.rateLimitDeferredRuns} run(s) deferred by a provider usage-limit pause`] : []),
    ...(x.supplementRuns ? [`SUPPLEMENTED: ${x.supplementRuns} run(s) re-run after the study`] : [])].join("; ");
  const resets = (r: Row) => [r.rateLimit?.resetsAtUtc ? `CLI-reported reset ${r.rateLimit.resetsAtUtc}` : "",
    r.rateLimit?.resetHint ? `CLI says try again ${r.rateLimit.resetHint} (local time)` : ""].filter(Boolean).join("; ") || "reset time not reported";
  const windows = (x: typeof comparisons[number]) => x.windowConfounded ?
    `WINDOW-CONFOUNDED (${x.b} ${x.windows.b.join("+")} vs ${x.c} ${x.windows.c.join("+")})` : `same (${x.windows.b.join("+") || "none"})`;
  const markdown = ["# Pilot scoreboard", "", `Mode: ${input.plan.dryRun ? "DRY RUN (no scientific inference)" : "live"}. Complete main schedule: ${complete}.`,
    `Execution order: ${orderValid ? "matches recorded locked order" + (deferredRows.length ?
      ` (${deferredRows.length} run(s) deferred behind other providers by a provider usage-limit pause)` : "") :
      "DEVIATED OR UNRECORDED — NON-CONFIRMATORY"}.`,
    "Tokens are uncapped across arms; Amani may make multiple internal calls. Reported usage is partial when CLI events are absent.",
    `Provenance: ${provenanceUnavailable.length ? "unavailable for " + provenanceUnavailable.join(", ") : "no unresolved identity failures"}. Infrastructure unknowns: ${infrastructureUnknowns.length}; unresolved interruptions: ${unresolvedInterruptions.length}.`,
    `Pilot stage: descriptive-only, never confirmatory. Missing determinate slots: ${missingSlots.length}.`,
    `Provider rate/usage limits: ${rateLimitedRows.length} run(s) excluded as infrastructure (never charged to an arm); ` +
      `unresolved: ${unresolvedRateLimits.length}${unresolvedRateLimits.length ? " — affected comparisons are incomplete" : ""}.`,
    ...unresolvedRateLimits.map(r => `Rate-limited ${r.id}/r${r.retry} (${r.arm}): ${r.infrastructure === "rate-limit-exhausted" ?
      "retry bound exhausted; infrastructure failure, study incomplete" : `re-queued by the next run; ${resets(r)}`}.`),
    `Provider refusals: ${refusedRows.length} refused session(s) excluded as infrastructure (never charged to an arm); ` +
      `unresolved: ${unresolvedRefusals.length}${unresolvedRefusals.length ? " — affected comparisons are incomplete" : ""}; ` +
      `${originalRows.filter(r => !excluded(r) && (r.providerRefusals ?? 0) > 0).length} graded run(s) rode out a refused turn; ` +
      `${refusedAfterWork.length} refused session(s) ended after agent work.`,
    ...refusedAfterWork.map(r => `Provider-refused after agent work ${r.id}/r${r.retry} (${r.arm}): ` +
      `${r.providerRefusal?.agentMessages ?? 0} agent message(s), deliverables ${r.deliverables ? "present" : "absent"}.`),
    ...unresolvedRefusals.map(r => `Provider-refused ${r.id}/r${r.retry} (${r.arm}): ${r.infrastructure === "provider-refused-exhausted" ?
      "refusal retries exhausted; infrastructure failure, study incomplete" : "a fresh session is re-queued by the next run"}.`),
    ...(input.supplement ? [`Supplement ${input.supplement.index} (${input.supplement.hash}, chained to ${input.supplement.previous}; ` +
      `commit ${input.supplement.commit.sha}${input.supplement.commit.dirty ? " (dirty)" : ""}): ${input.supplement.rerunSlots.length} ` +
      `provider-refused slot(s) re-run, ${input.supplement.regradedRows.length} refused-turn row(s) re-assessed. ` +
      `Results WITH the supplement; original rows are unchanged (scoreboard-original has the study alone).`] : []),
    ...infrastructureWarnings.map(r => `Infrastructure warning ${r.id}/r${r.retry}: ${r.warnings.join(", ")}.`),
    `Plan: ${input.settingsHash}`,
    amendments.length ? `Amendments: ${amendments.length}. Rows each adds run after every earlier row; none is re-run or reordered.` : "Amendments: none.",
    ...amendments.map(a => `- Amendment ${a.index} (${a.timestamp} UTC): ${a.reason} Changes: ${a.diff.map(change).join("; ")}. Hash ${a.hash}.`),
    ...disabledArmList.map(d => `Disabled arm ${d.arm}: ${d.reason}. No runs are scheduled and it is excluded from scoring.`),
    "", `Pre-registered decision: **${decision}** (${decisionReason}). Comparator: ${comparator}; treatment: ${PILOT_TREATMENT}.`,
    "All arm comparisons are descriptive; the pilot cannot certify superiority.", "",
    "| Task | Arm | Passed / executions (planned) | False-verified rate | Verified yield | Wall ms |",
    "|---|---|---:|---:|---:|---:|",
    ...tasks.flatMap(t => planArmIds.map(arm => {
      const x = cells.find(y => y.task === t.id && y.arm === arm);
      if (!x) return `| ${t.id} | ${arm} | ${disabledCellList.find(y => y.task === t.id && y.arm === arm)!.availability} | | | |`;
      const limits = (x.rateLimitUnresolvedRuns ? `; ${x.rateLimitUnresolvedRuns} rate-limited, unresolved` : "") +
        (x.providerRefusedUnresolvedRuns ? `; ${x.providerRefusedUnresolvedRuns} provider-refused, unresolved` : "");
      return `| ${x.task} | ${x.arm} | ${x.availability === "available" ? `${x.successes} / ${x.denominator} (${x.plannedAttempts})${limits}` : x.availability} | ${fmt(x.falseVerifiedRate)} | ${fmt(x.verifiedYield)} | ${fmt(x.wallClockMs)} |`;
    })),
    "", "| Arm | Flaw-check pass | Negative abstention | Positive pass | Timeouts | Crashes | Confirmation task share | Input/output tokens (reported) | Rate/usage-limited runs excluded (unresolved) | Transient limit signals |",
    "|---|---:|---:|---:|---:|---:|---:|---|---:|---:|",
    ...planArmIds.map(arm => {
      const x = arms.find(y => y.arm === arm);
      if (!x) return `| ${arm} | disabled: ${disabledArms[arm]} | | | | | | | | |`;
      return `| ${x.arm} | ${fmt(x.plantedFlawCatchRate)} | ${fmt(x.negativeControlAbstention)} | ${fmt(x.positiveControlPassRate)} | ${x.timeouts} | ${x.crashes} | ${fmt(x.taskConfirmationShare)} | ${x.reportedInputTokens}/${x.reportedOutputTokens}${x.tokenUsageComplete ? "" : " (partial)"} | ${x.rateLimitExcludedRuns} (${x.rateLimitUnresolvedRuns}) | ${x.rateLimitedRuns} |`;
    }),
    "", "| Arm | Provider-refused sessions excluded (unresolved, exhausted) | Provider-refusal rate | Graded runs with a transient refusal | Supplement runs |",
    "|---|---:|---:|---:|---:|",
    ...planArmIds.map(arm => {
      const x = arms.find(y => y.arm === arm);
      if (!x) return `| ${arm} | disabled: ${disabledArms[arm]} | | | |`;
      return `| ${x.arm} | ${x.providerRefusedRuns} (${x.providerRefusedUnresolvedRuns}, ${x.providerRefusedExhaustedRuns}) | ${fmt(x.providerRefusalRate)} | ${x.providerRefusalTransientRuns} | ${x.supplementRuns} |`;
    }),
    "", "| Pair (first minus second) | Status | Windows | Paired tasks | McNemar p | Task-pass difference (95% CI) | False-verified difference (95% CI) | False-rate equivalent |",
    "|---|---|---|---:|---:|---|---|---|",
    ...comparisons.map(x => `| ${x.b} vs ${x.c} | ${status(x)} | ${windows(x)} | ${x.mcnemar?.n ?? 0} | ${fmt(x.mcnemar?.pValue ?? null)} | ${ci(x.taskPassBootstrap95)} | ${ci(x.falseVerifiedBootstrap95)} | ${x.falseVerifiedEquivalence.equivalent ? "within margin" : "not established"} |`),
    ...disabledComparisons.map(x => `| ${x.b} vs ${x.c} | ${x.availability} | | | | | | |`),
    ...comparisons.map(x => `Conditional ratio bootstrap ${x.b} vs ${x.c}: dropped share ${fmt(x.falseVerifiedBootstrap95?.droppedShare ?? null)}. ${x.sparsityReasons.join("; ")}`),
    `Differences are the first arm minus the second; equivalence uses 90% intervals and the locked ±${input.plan.statistics.equivalenceMargin} margin. These comparisons authorize no shipping decision.`,
    "Pairs count only tasks where both arms completed the same, full number of attempts; other pairs are incomplete. Window-confounded pairs ran in different schedule windows (before/after an amendment) and are not like-for-like even when the drift sentinels agree.",
    "", "Launched failures remain in the denominator. Infrastructure unknowns are excluded; registered retries can replace interruptions. Sentinels are separate from inference (see JSON).",
    `A run whose provider CLI ended on a rate/usage limit is infrastructure: excluded, re-queued once per limit event (at most ${input.plan.retryRule?.rateLimitRetries ?? 0} per slot), never charged to an arm.`,
    `A session the provider CLI ended on a safety refusal is infrastructure: excluded, re-queued in a fresh session (at most ${input.plan.retryRule?.refusalRetries ?? 0} per slot), never charged to an arm. A refusal-triggered model fallback stays a provenance failure.`,
    "Flaw catch means the task's deterministic checks passed; it does not certify arbitrary narrative claims.",
    "Claim rates require complete trusted adjudications; zero confirmed claims gives an unavailable false-verified rate.",
    "Arm wall time includes staging and execution; grading milliseconds are reported separately in JSON. Unfinished schedules are provisional. Missing evidence never authorizes equivalence.", ""].join("\n");
  return { schema: "bio-pilot/scoreboard@1", settingsHash: input.settingsHash, dryRun: input.plan.dryRun,
    complete, scheduleComplete, orderValid, orderDeferredByRateLimit: deferredRows.length, confirmatory: false, evidenceComplete: comparisons.every(c => c.evidenceComplete) && complete && scheduleComplete && orderValid, infrastructureRefusals, infrastructureUnknowns, infrastructureWarnings, missingSlots, provenanceUnavailable, decision, decisionReason,
    amendments, disabledArms: disabledArmList, disabledCells: disabledCellList, disabledComparisons,
    rateLimited: rateLimitedRows.map(r => ({ id: r.id, retry: r.retry, task: r.task, arm: r.arm, phase: r.phase, attempt: r.attempt,
      infrastructure: r.infrastructure ?? "rate-limited", resolved: !unresolvedRateLimits.includes(r),
      resetsAtUtc: r.rateLimit?.resetsAtUtc ?? null, resetHint: r.rateLimit?.resetHint ?? null })),
    providerRefused: refusedRows.map(r => ({ id: r.id, retry: r.retry, task: r.task, arm: r.arm, phase: r.phase, attempt: r.attempt,
      infrastructure: r.infrastructure ?? "provider-refused", resolved: !providerRefused(newest.get(r.id)!),
      categories: r.providerRefusal?.categories ?? [], supplement: r.supplement?.kind ?? null,
      agentMessages: r.providerRefusal?.agentMessages ?? null, deliverables: r.deliverables ?? null })),
    supplement: input.supplement ? { ...input.supplement, runs: supplementRows.length, orderValid: supplementOrderValid } : null,
    arms, cells, comparisons, sentinels,
    records: allRecords.map((record, i) => ({ ...record, runId: input.rows[i]!.id, phase: input.rows[i]!.phase })), markdown };
}
