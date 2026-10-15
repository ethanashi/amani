// Scores a verifier's per-row output against the suite.
//
// Fail closed: a row with no output, or with an unreadable verdict, a missing/unknown status, or a
// verdict/status combination no section-7 verifier can emit (e.g. pass + retracted), counts as the
// worst outcome for that row (false pass on an invalid row, false block on a valid one), and the
// report is marked incomplete.
//
// Admission is decided on the HELD-OUT (private) rows only, for a frozen verifier: the public rows
// are tuning data, so pooled numbers are descriptive. Rows from the same work are not independent,
// so the false-pass target must hold at the row level AND at the work-cluster level.

import { clopperPearson } from "./binomial.ts";
import { clusterOf } from "./clusters.ts";
import { COMPATIBLE_STATUSES } from "./expectations.ts";
import {
  DOMAINS,
  FACTUAL,
  FAILURE_CLASSES,
  SPLITS,
  STATUSES,
  VERDICTS,
  type Domain,
  type FailureClass,
  type Split,
  type Status,
  type SuiteRow,
  type Verdict,
  type VerifierResult,
} from "./types.ts";

export interface Rate {
  k: number;
  n: number;
  /** null when n = 0 (nothing to estimate). */
  rate: number | null;
  lower: number;
  upper: number;
  level: number;
}

export function rate(k: number, n: number, level = 0.95): Rate {
  if (n === 0) return { k, n, rate: null, lower: 0, upper: 1, level };
  const [lower, upper] = clopperPearson(k, n, level);
  return { k, n, rate: k / n, lower, upper, level };
}

export type RowOutcome =
  | "passed" // valid row, verdict pass
  | "owner-routed" // valid row, needs-owner where section 7 routes it (accepted)
  | "owner-routed-extra" // valid row, needs-owner where nothing routes it (not a false block; costs owner time)
  | "false-block" // valid row, verdict block (or missing/malformed)
  | "caught" // invalid row, verdict block or needs-owner
  | "flagged-pass" // invalid row, pass with a safe status (abstract-supported marking)
  | "false-pass"; // invalid row, unflagged pass (or missing/malformed)

export type Problem = "missing" | "malformed" | null;

export interface RowScore {
  id: string;
  split: Split;
  class: FailureClass;
  domain: Domain;
  factual: string;
  cluster: string;
  outcome: RowOutcome;
  verdict: Verdict | null;
  status: string | null;
  statusAgrees: boolean;
  idealVerdict: boolean;
  /** null when the row requires no flags. */
  flagsShown: boolean | null;
  problem: Problem;
}

export interface GroupScore {
  n: number;
  invalid: number;
  valid: number;
  falsePass: Rate;
  falseBlock: Rate;
  ownerRouted: Rate;
  validHandled: Rate;
  invalidCaught: Rate;
  statusAgreement: Rate;
  flagRecall: Rate;
  /** Work clusters with >= 1 invalid row; a cluster fails when any of its invalid rows is falsely passed. */
  clusterFalsePass: Rate;
  flaggedPasses: number;
  idealVerdict: Rate;
}

export interface ScoreOptions {
  level?: number;
  /** Design target on the false-pass rate, judged on the upper confidence bound. Default 0.05. */
  maxFalsePassRate?: number;
  /** Section 13 gate: at least this share of invalid rows caught. Default 0.95. */
  minInvalidCaught?: number;
  /** Section 13 gate: at least this share of valid rows handled (passed, or routed where section 7 routes). Default 0.80. */
  minValidHandled?: number;
  /** PW4s addition: statuses must explain the verdicts. Default 0.80 of held-out rows. */
  minStatusAgreement?: number;
  /** PW4s addition: section 7 L3 flags must be shown. Default 0.80 of held-out rows that require one. */
  minFlagRecall?: number;
  /** Per-row details for private rows leak the hold-out; off by default. */
  revealPrivateRows?: boolean;
  /** Identity of the frozen verifier build (e.g. a commit). Admission requires it. */
  verifierId?: string | null;
  /** How many distinct frozen verifiers have scored this hold-out, this one included (from the look ledger). */
  look?: { number: number; priorVerifierIds: string[] } | null;
}

export interface Admission {
  basis: "held-out";
  maxFalsePassRate: number;
  heldOutRows: number;
  falsePassUpper: number | null;
  clusterFalsePassUpper: number | null;
  met: boolean;
  gate: {
    minInvalidCaught: number;
    minValidHandled: number;
    minStatusAgreement: number;
    minFlagRecall: number;
    invalidCaughtOk: boolean;
    validHandledOk: boolean;
    statusAgreementOk: boolean;
    flagRecallOk: boolean;
  };
  verifierId: string | null;
  look: { number: number; priorVerifierIds: string[] } | null;
  admitted: boolean;
  reasons: string[];
}

export interface ScoreReport {
  suiteRows: number;
  complete: boolean;
  missing: number;
  malformed: number;
  unexpectedIds: string[];
  /** All scored rows, public tuning rows included: descriptive only. */
  pooled: GroupScore;
  /** Private rows only: the basis for admission. null when no private rows were scored. */
  heldOut: GroupScore | null;
  byClass: Record<string, GroupScore>;
  heldOutByClass: Record<string, GroupScore>;
  byDomain: Record<string, GroupScore>;
  bySplit: Record<string, GroupScore>;
  byFactual: Record<string, GroupScore>;
  target: Admission;
  /** Rows not handled as expected. Private rows appear only as counts unless revealPrivateRows. */
  failures: Array<Pick<RowScore, "id" | "class" | "outcome" | "verdict" | "status" | "problem">>;
  privateFailureCount: number;
}

const VERDICT_SET = new Set<string>(VERDICTS);
const STATUS_SET = new Set<string>(STATUSES);

/** Why an output entry is unusable, or null when it is a coherent section-7 result. */
export function resultProblem(verdict: string, status: string | null): string | null {
  if (!VERDICT_SET.has(verdict)) return `unknown verdict ${verdict || "(none)"}`;
  if (status === null) return "missing status";
  if (!STATUS_SET.has(status)) return `unknown status ${status}`;
  if (!(COMPATIBLE_STATUSES[verdict as Verdict] as readonly string[]).includes(status)) return `status ${status} contradicts verdict ${verdict}`;
  return null;
}

/**
 * Parse verifier output: a JSON array or JSONL of {id, verdict, status, flags?}. Duplicate ids are
 * refused. Entries with an unknown verdict, a missing or unknown status, an incompatible verdict and
 * status, or non-string flags are kept as "malformed" (scored as the worst outcome).
 */
export function parseResults(text: string): { results: Map<string, VerifierResult | "malformed">; errors: string[] } {
  const errors: string[] = [];
  const results = new Map<string, VerifierResult | "malformed">();
  const trimmed = text.trim();
  let items: unknown[] = [];
  if (trimmed.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      items = Array.isArray(parsed) ? parsed : [];
    } catch {
      throw new Error("results file is not valid JSON");
    }
  } else if (trimmed !== "") {
    trimmed.split("\n").forEach((line, i) => {
      if (line.trim() === "") return;
      try {
        items.push(JSON.parse(line));
      } catch {
        errors.push(`line ${i + 1}: not JSON`);
      }
    });
  }
  for (const item of items) {
    if (typeof item !== "object" || item === null || typeof (item as { id?: unknown }).id !== "string") {
      errors.push("an entry has no string id");
      continue;
    }
    const o = item as { id: string; verdict?: unknown; status?: unknown; flags?: unknown };
    if (results.has(o.id)) throw new Error(`duplicate result for ${o.id}; refusing to score`);
    const verdict = typeof o.verdict === "string" ? o.verdict.trim().toLowerCase() : "";
    const status = typeof o.status === "string" && o.status.trim() !== "" ? o.status.trim().toLowerCase() : null;
    const flagsOk = o.flags === undefined || (Array.isArray(o.flags) && o.flags.every((f) => typeof f === "string"));
    const problem = resultProblem(verdict, status) ?? (flagsOk ? null : "flags must be an array of strings");
    if (problem) {
      results.set(o.id, "malformed");
      errors.push(`${o.id}: ${problem}`);
      continue;
    }
    const flags = Array.isArray(o.flags) ? (o.flags as string[]).map((f) => f.trim().toLowerCase()) : [];
    results.set(o.id, { id: o.id, verdict: verdict as Verdict, status: status as Status, flags });
  }
  return { results, errors };
}

export function scoreRow(row: SuiteRow, result: VerifierResult | "malformed" | undefined, cluster = row.id): RowScore {
  const problem: Problem = result === undefined ? "missing" : result === "malformed" ? "malformed" : null;
  const got = problem ? null : (result as VerifierResult);
  const verdict = got?.verdict ?? null;
  const status = got?.status ?? null;
  const ex = row.expected;
  let outcome: RowOutcome;
  if (ex.valid) {
    if (verdict === "pass") outcome = "passed";
    else if (verdict === "needs-owner") outcome = ex.acceptVerdicts.includes("needs-owner") ? "owner-routed" : "owner-routed-extra";
    else outcome = "false-block";
  } else if (verdict === "block" || verdict === "needs-owner") {
    outcome = "caught";
  } else if (verdict === "pass" && status !== null && (ex.safePassStatuses as string[]).includes(status)) {
    outcome = "flagged-pass";
  } else {
    outcome = "false-pass";
  }
  const required = ex.requiredFlags ?? [];
  return {
    id: row.id,
    split: row.split,
    class: row.class,
    domain: row.domain,
    factual: row.adjudication?.factual ?? "unknown",
    cluster,
    outcome,
    verdict,
    status,
    statusAgrees: status !== null && (ex.acceptStatuses as string[]).includes(status),
    idealVerdict: verdict === ex.verdict,
    flagsShown: required.length === 0 ? null : got !== null && required.every((f) => got.flags.includes(f)),
    problem,
  };
}

const INVALID_OUTCOMES: RowOutcome[] = ["caught", "flagged-pass", "false-pass"];

export function group(scores: RowScore[], level = 0.95): GroupScore {
  const invalid = scores.filter((s) => INVALID_OUTCOMES.includes(s.outcome));
  const valid = scores.filter((s) => !INVALID_OUTCOMES.includes(s.outcome));
  const flagged = scores.filter((s) => s.flagsShown !== null);
  const clusters = new Map<string, boolean>();
  for (const s of invalid) clusters.set(s.cluster, (clusters.get(s.cluster) ?? false) || s.outcome === "false-pass");
  return {
    n: scores.length,
    invalid: invalid.length,
    valid: valid.length,
    falsePass: rate(invalid.filter((s) => s.outcome === "false-pass").length, invalid.length, level),
    falseBlock: rate(valid.filter((s) => s.outcome === "false-block").length, valid.length, level),
    ownerRouted: rate(valid.filter((s) => s.outcome === "owner-routed" || s.outcome === "owner-routed-extra").length, valid.length, level),
    validHandled: rate(valid.filter((s) => s.outcome === "passed" || s.outcome === "owner-routed").length, valid.length, level),
    invalidCaught: rate(invalid.filter((s) => s.outcome !== "false-pass").length, invalid.length, level),
    statusAgreement: rate(scores.filter((s) => s.statusAgrees).length, scores.length, level),
    flagRecall: rate(flagged.filter((s) => s.flagsShown).length, flagged.length, level),
    clusterFalsePass: rate([...clusters.values()].filter(Boolean).length, clusters.size, level),
    flaggedPasses: scores.filter((s) => s.outcome === "flagged-pass").length,
    idealVerdict: rate(scores.filter((s) => s.idealVerdict).length, scores.length, level),
  };
}

export function scoreSuite(rows: SuiteRow[], results: Map<string, VerifierResult | "malformed">, opts: ScoreOptions = {}): ScoreReport {
  const level = opts.level ?? 0.95;
  const maxFalsePassRate = opts.maxFalsePassRate ?? 0.05;
  const minInvalidCaught = opts.minInvalidCaught ?? 0.95;
  const minValidHandled = opts.minValidHandled ?? 0.8;
  const minStatusAgreement = opts.minStatusAgreement ?? 0.8;
  const minFlagRecall = opts.minFlagRecall ?? 0.8;
  if (rows.length === 0) throw new Error("no suite rows to score");
  const known = new Set(rows.map((r) => r.id));
  if (known.size !== rows.length) throw new Error("suite rows have duplicate ids; refusing to score");
  const clusters = clusterOf(rows);
  const scores = rows.map((r) => scoreRow(r, results.get(r.id), clusters.get(r.id)));
  const by = <K extends string>(subset: RowScore[], keys: readonly K[], pick: (s: RowScore) => string) =>
    Object.fromEntries(keys.map((k) => [k, group(subset.filter((s) => pick(s) === k), level)]).filter(([, g]) => (g as GroupScore).n > 0));

  const pooled = group(scores, level);
  const privateScores = scores.filter((s) => s.split === "private");
  const heldOut = privateScores.length ? group(privateScores, level) : null;
  const missing = scores.filter((s) => s.problem === "missing").length;
  const malformed = scores.filter((s) => s.problem === "malformed").length;
  const complete = missing === 0 && malformed === 0;

  const reasons: string[] = [];
  const h = heldOut;
  const met = h !== null && h.invalid > 0 && h.falsePass.upper <= maxFalsePassRate && h.clusterFalsePass.upper <= maxFalsePassRate;
  const gate = {
    minInvalidCaught,
    minValidHandled,
    minStatusAgreement,
    minFlagRecall,
    invalidCaughtOk: h !== null && h.invalidCaught.rate !== null && h.invalidCaught.rate >= minInvalidCaught,
    validHandledOk: h !== null && h.validHandled.rate !== null && h.validHandled.rate >= minValidHandled,
    statusAgreementOk: h !== null && h.statusAgreement.rate !== null && h.statusAgreement.rate >= minStatusAgreement,
    flagRecallOk: h !== null && (h.flagRecall.rate === null || h.flagRecall.rate >= minFlagRecall),
  };
  if (!complete) reasons.push(`incomplete output (${missing} missing, ${malformed} malformed)`);
  if (h === null) reasons.push("no held-out rows scored (public rows are tuning data)");
  else {
    if (h.falsePass.upper > maxFalsePassRate) reasons.push(`held-out false-pass upper bound ${(100 * h.falsePass.upper).toFixed(1)}% > ${100 * maxFalsePassRate}%`);
    if (h.clusterFalsePass.upper > maxFalsePassRate) reasons.push(`held-out cluster false-pass upper bound ${(100 * h.clusterFalsePass.upper).toFixed(1)}% > ${100 * maxFalsePassRate}%`);
    if (!gate.invalidCaughtOk) reasons.push("held-out invalid rows caught below gate");
    if (!gate.validHandledOk) reasons.push("held-out valid rows handled below gate");
    if (!gate.statusAgreementOk) reasons.push("held-out status agreement below gate");
    if (!gate.flagRecallOk) reasons.push("held-out flag recall below gate");
  }
  const verifierId = opts.verifierId?.trim() || null;
  if (verifierId === null) reasons.push("no frozen verifier id");
  const failures = scores.filter((s) => s.outcome === "false-pass" || s.outcome === "false-block");
  const reveal = opts.revealPrivateRows === true;
  return {
    suiteRows: rows.length,
    complete,
    missing,
    malformed,
    unexpectedIds: [...results.keys()].filter((id) => !known.has(id)).sort(),
    pooled,
    heldOut,
    byClass: by(scores, FAILURE_CLASSES, (s) => s.class),
    heldOutByClass: by(privateScores, FAILURE_CLASSES, (s) => s.class),
    byDomain: by(scores, DOMAINS, (s) => s.domain),
    bySplit: by(scores, SPLITS, (s) => s.split),
    byFactual: by(scores, FACTUAL, (s) => s.factual),
    target: {
      basis: "held-out",
      maxFalsePassRate,
      heldOutRows: privateScores.length,
      falsePassUpper: h ? h.falsePass.upper : null,
      clusterFalsePassUpper: h ? h.clusterFalsePass.upper : null,
      met: met && complete,
      gate,
      verifierId,
      look: opts.look ?? null,
      admitted: reasons.length === 0,
      reasons,
    },
    failures: failures
      .filter((s) => reveal || s.split === "public")
      .map(({ id, class: cls, outcome, verdict, status, problem }) => ({ id, class: cls, outcome, verdict, status, problem })),
    privateFailureCount: failures.filter((s) => s.split === "private").length,
  };
}

function pct(x: number | null): string {
  return x === null ? "n/a" : `${(100 * x).toFixed(1)}%`;
}

function fmt(r: Rate): string {
  return `${r.k}/${r.n} = ${pct(r.rate)} [${pct(r.lower)}, ${pct(r.upper)}]`;
}

function summary(lines: string[], title: string, g: GroupScore) {
  lines.push(title);
  lines.push(`  false-pass rate (invalid rows passed):   ${fmt(g.falsePass)}`);
  lines.push(`  cluster false-pass (works):              ${fmt(g.clusterFalsePass)}`);
  lines.push(`  false-block rate (valid rows blocked):   ${fmt(g.falseBlock)}`);
  lines.push(`  valid rows handled (pass / s7 routing):  ${fmt(g.validHandled)}`);
  lines.push(`  valid rows routed to owner (any):        ${fmt(g.ownerRouted)}`);
  lines.push(`  invalid rows caught:                     ${fmt(g.invalidCaught)}`);
  lines.push(`  status agreement:                        ${fmt(g.statusAgreement)}`);
  lines.push(`  required flags shown:                    ${fmt(g.flagRecall)}`);
  lines.push(`  flagged passes (abstract-supported):     ${g.flaggedPasses}`);
}

/** Plain-text summary for the CLI. */
export function formatReport(rep: ScoreReport): string {
  const lines: string[] = [];
  const lvl = Math.round(rep.pooled.falsePass.level * 100);
  lines.push(`PW4s citation suite: ${rep.suiteRows} rows scored (${lvl}% Clopper-Pearson intervals)${rep.complete ? "" : ` INCOMPLETE: ${rep.missing} missing, ${rep.malformed} malformed (counted as failures)`}`);
  if (rep.unexpectedIds.length) lines.push(`unexpected result ids ignored: ${rep.unexpectedIds.length}`);
  if (rep.heldOut) summary(lines, `HELD-OUT (private, ${rep.heldOut.n} rows) - basis for admission`, rep.heldOut);
  summary(lines, `POOLED (all scored rows, ${rep.pooled.n}) - descriptive only: public rows are tuning data`, rep.pooled);
  const t = rep.target;
  lines.push(`TARGET held-out false-pass upper bound <= ${pct(t.maxFalsePassRate)} (rows and work clusters): ${t.met ? "MET" : "NOT MET"} (rows ${pct(t.falsePassUpper)}, clusters ${pct(t.clusterFalsePassUpper)})`);
  lines.push(`verifier: ${t.verifierId ?? "(none)"}${t.look ? `; held-out look #${t.look.number}${t.look.priorVerifierIds.length ? ` (earlier: ${t.look.priorVerifierIds.join(", ")})` : ""}` : ""}`);
  lines.push(`ADMITTED: ${t.admitted ? "YES" : "NO"}${t.reasons.length ? ` - ${t.reasons.join("; ")}` : ""}`);
  lines.push("");
  lines.push("by class (pooled)            n   metric       rate [CI]");
  for (const [cls, g] of Object.entries(rep.byClass)) {
    const r = g.valid > 0 ? g.falseBlock : g.falsePass;
    lines.push(`  ${cls.padEnd(28)}${String(g.n).padStart(3)}  ${(g.valid > 0 ? "false-block" : "false-pass").padEnd(12)} ${fmt(r)}`);
  }
  lines.push("");
  for (const [name, table] of [["split", rep.bySplit], ["domain", rep.byDomain], ["factual support", rep.byFactual]] as const) {
    lines.push(`by ${name}`);
    for (const [k, g] of Object.entries(table)) {
      lines.push(`  ${k.padEnd(28)}${String(g.n).padStart(3)}  false-pass ${fmt(g.falsePass)}  false-block ${fmt(g.falseBlock)}`);
    }
    lines.push("");
  }
  if (rep.failures.length || rep.privateFailureCount) {
    lines.push(`failures (public rows listed; ${rep.privateFailureCount} private failures counted only):`);
    for (const f of rep.failures) lines.push(`  ${f.id} ${f.class} -> ${f.outcome} (verdict ${f.verdict ?? f.problem}, status ${f.status ?? "-"})`);
  }
  return lines.join("\n");
}
