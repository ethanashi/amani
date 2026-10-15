// Shared types of the V7 investigation orchestrator. Everything journaled is plain JSON (canonical
// JSON safe: no undefined, no non-finite numbers), so a SQLite journal can hold it verbatim.

import type { Family } from "../../omb-sched/src/index.ts";

export type { Family };

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

/** P: plan from the schema view, code on scrambled outcomes, one software run on real data.
 * H: explore the dev partition, lock, one software look at the sealed partition.
 * N: the locked rule run again on independent data (the "replicated" tier). */
export type Route = "P" | "H" | "N";

/**
 * The scientific-method phases of one investigation, in order. `plan-lock` is step 3b of the
 * brief (the plan turn and its lock are separate phases so each is memoized and recorded).
 */
export const PHASES = [
  "question", "stage", "plan", "plan-lock", "code", "dry-run", "freeze", "look", "certify", "replicate", "interpret", "deliverable",
] as const;
export type PhaseId = (typeof PHASES)[number];
export const isPhase = (value: unknown): value is PhaseId => typeof value === "string" && (PHASES as readonly string[]).includes(value);

/**
 * Why an investigation jumps straight to its deliverable. The record is always kept and a report is
 * always written (fail soft on runs); only a hard stop voids claims.
 * - preflight-failed: an infrastructure precondition failed before any model turn (nothing lost).
 * - hard-stop: one of the four charter hard stops was positively observed; claims void.
 * - no-plan / no-code: the worker never produced an evaluable plan / runnable code within its budget.
 * - look-withheld: the code never ran on the synthetic schema; the look stays unspent.
 * - look-refused: the ledger refused the look (partition burned or units exposed).
 * - look-crash-channel: the frozen code crashed on real data but not on the scrambled twin.
 * - look-failed: the look (and its single repair) crashed; nothing certifiable.
 * - infrastructure: a model turn never ran (process/CLI/auth failures, or every allowed family
 *   refused) and wrote none of its files. Infrastructure, never a science result.
 */
export const TERMINAL_KINDS = [
  "preflight-failed", "hard-stop", "no-plan", "no-code", "look-withheld", "look-refused", "look-crash-channel", "look-failed", "infrastructure",
] as const;
export type TerminalKind = (typeof TERMINAL_KINDS)[number];

export interface Terminal {
  kind: TerminalKind;
  reason: string;
  /** Hard-stop kind (omb-gauntlet HARD_STOPS) when kind is "hard-stop". */
  stop: string | null;
  phase: PhaseId;
}

/** Every phase output carries these: `next` is the only phase allowed to run after it. Outputs are
 * journaled as canonical JSON, so every field must be JSON-safe. */
export interface PhaseOutputBase {
  next: PhaseId | null;
  terminal: Terminal | null;
}

/** Error categories a model may see after a look (amendment 14). Never stderr text, never outputs. */
export const ERROR_CATEGORIES = [
  "code-policy", "exit-nonzero", "timeout", "memory-limit", "signal", "missing-output", "invalid-output", "interrupted", "infra", "output-cap", "output-link", "data-unreadable",
] as const;
export type ErrorCategory = (typeof ERROR_CATEGORIES)[number];
export const errorCategory = (value: unknown): ErrorCategory =>
  typeof value === "string" && (ERROR_CATEGORIES as readonly string[]).includes(value) ? (value as ErrorCategory) : "exit-nonzero";

/** Software statuses (omb-gauntlet SOFTWARE_STATUSES) as carried in V7 records. */
export type ClaimStatus = "confirmed" | "replicated" | "tentative" | "refuted" | "insufficient-evidence" | "non-identifiable" | "exploratory";
export type TaskStatus = "confirmed" | "tentative" | "refuted" | "insufficient-evidence";

/** One claim as V7 records it after certification and V7's own caps. */
export interface ClaimRecord {
  claimId: string;
  kind: string | null;
  status: ClaimStatus;
  taskStatus: TaskStatus;
  reasons: string[];
  limitations: string[];
  voided: boolean;
}

/** What starts an investigation. Host-only fields (dataRoot) never reach a worker. */
export interface InvestigationSpec {
  /** Host classification; absent is search-off. Task cards always override to benchmark. */
  literatureMode?: import('../../omb-literature/src/index.ts').SearchMode;

  /** Plan-lineage id; also the journal stream suffix. [A-Za-z0-9._:-]+ */
  id: string;
  question: string;
  /** One-sentence plain-language statement of the question (paper_writer_design: owner approves at lock). */
  plainStatement: string;
  dataset: DatasetRef;
  /** Requested primary route. H is used only when routeHOffer allows it; otherwise P with a reason. */
  route: "P" | "H";
  /** Independent dataset for route N, when one exists. */
  independentDataset?: DatasetRef | null;
  /** Task prompt file (e.g. bio-tasks TASK.md), shown to the lead read-only. Host path. */
  taskPromptFile?: string | null;
  /** Set when the boss program proposed this investigation (DM11). */
  program?: ProgramLink | null;
  /** HOST-ONLY trusted reproduction targets (e.g. from the task card); never shown to a worker. */
  reproductionTargets?: readonly import("./ports.ts").ReproductionTargetSpec[] | null;
}

export interface DatasetRef {
  datasetId: string;
  /** Host path of the raw data. Never mounted into any worker. */
  dataRoot: string;
  /** Expected manifest hash, when the host pins one (a mismatch refuses staging before any model turn). */
  expectedManifestHash?: string | null;
}

export interface ProgramLink {
  programId: string;
  proposalId: string;
  fingerprint: string;
  /** "kth hypothesis on this manifest" at proposal time (G6). */
  ordinal: number;
  rung: string;
  scope: string;
}

/** A lead or replicator session as it actually ran (after any refusal reroute). */
export interface SessionRef {
  provider?: string;
  model?: string;
  family: Family;
  sessionToken: string | null;
  /** WorkerSpec.jobId the adapter binds the session to (stable across resumed turns). */
  workerJobId: string;
  workdir: string;
}
