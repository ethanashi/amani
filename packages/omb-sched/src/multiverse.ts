import { canonicalSha256 } from "../../bio-core/src/index.ts";
import { isFamily, type Family } from "./types.ts";

/**
 * V9 fleet pieces kept to data structures and selection rules: decision-rule fingerprints, the multiverse
 * table (a robustness annotation, never confirmation; every branch counts in the G6 family), the proposal
 * selector (duplicates collapse by fingerprint), explorer threat-flag triage, and the route H offer rule.
 * Nothing here assigns a label or writes prose numbers; omb-gauntlet and omb-report own those.
 */

/** Design section 4: hash of exposure, outcome, unit, adjustment, strata, test, direction and manifest. */
export interface DecisionRuleKey {
  readonly exposure: string;
  readonly outcome: string;
  readonly unit: string;
  readonly adjustment: readonly string[];
  readonly strata: readonly string[];
  readonly test: string;
  readonly direction: string;
  readonly manifest: string;
}

const fold = (s: string): string => s.trim().toLowerCase().replace(/[\s_]+/g, "-");
const set = (xs: readonly string[]): string[] => [...new Set(xs.map(fold))].sort();

/** Case-folded, order-free fingerprint. A missing field refuses (it must not collapse distinct rules). */
export function decisionFingerprint(rule: DecisionRuleKey): string {
  for (const k of ["exposure", "outcome", "unit", "test", "direction", "manifest"] as const) {
    if (typeof rule?.[k] !== "string" || !rule[k].trim()) throw new TypeError(`decision rule needs ${k}`);
  }
  for (const k of ["adjustment", "strata"] as const) {
    if (!Array.isArray(rule[k]) || !rule[k].every((x) => typeof x === "string" && x.trim())) throw new TypeError(`decision rule ${k} must be a list of names`);
  }
  return canonicalSha256({
    v: 1, exposure: fold(rule.exposure), outcome: fold(rule.outcome), unit: fold(rule.unit), adjustment: set(rule.adjustment),
    strata: set(rule.strata), test: fold(rule.test), direction: fold(rule.direction), manifest: fold(rule.manifest),
  });
}

// ------------------------------------------------------------------ multiverse table

export type BranchStatus = "planned" | "ok" | "failed" | "not-run";
export interface MultiverseBranch {
  readonly id: string;
  readonly fingerprint: string;
  readonly knobs: Readonly<Record<string, string | number | boolean>>;
  readonly status: BranchStatus;
  /** Software-recomputed values only (from executed outputs), never worker-typed numbers. */
  readonly estimate: number | null;
  readonly se: number | null;
  readonly p: number | null;
}
export interface MultiverseTable {
  readonly manifest: string;
  readonly primary: { readonly fingerprint: string; readonly estimate: number | null };
  readonly branches: readonly MultiverseBranch[];
}

export function createMultiverse(manifest: string, primaryFingerprint: string, primaryEstimate: number | null = null): MultiverseTable {
  if (!manifest || !primaryFingerprint) throw new TypeError("multiverse needs a manifest and a primary fingerprint");
  return { manifest, primary: { fingerprint: primaryFingerprint, estimate: finiteOrNull(primaryEstimate) }, branches: [] };
}

const finiteOrNull = (v: number | null | undefined): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Add a planned branch. A branch duplicating the primary or another branch's fingerprint is not added. */
export function addBranch(
  table: MultiverseTable, branch: { id: string; fingerprint: string; knobs: Readonly<Record<string, string | number | boolean>> },
): { table: MultiverseTable; added: boolean; duplicateOf: string | null } {
  if (!branch.id || !branch.fingerprint) throw new TypeError("branch needs an id and a fingerprint");
  if (table.branches.some((b) => b.id === branch.id)) throw new Error(`branch ${branch.id} already exists`);
  if (branch.fingerprint === table.primary.fingerprint) return { table, added: false, duplicateOf: "primary" };
  const twin = table.branches.find((b) => b.fingerprint === branch.fingerprint);
  if (twin) return { table, added: false, duplicateOf: twin.id };
  const next: MultiverseBranch = { id: branch.id, fingerprint: branch.fingerprint, knobs: { ...branch.knobs }, status: "planned", estimate: null, se: null, p: null };
  const branches = [...table.branches, next].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { table: { ...table, branches }, added: true, duplicateOf: null };
}

/** Record a branch result. "ok" without a finite estimate is recorded as failed (fail closed on the number). */
export function recordBranchResult(
  table: MultiverseTable, id: string, result: { status: "ok" | "failed" | "not-run"; estimate?: number | null; se?: number | null; p?: number | null },
): MultiverseTable {
  const index = table.branches.findIndex((b) => b.id === id);
  if (index < 0) throw new Error(`unknown branch ${id}`);
  const estimate = finiteOrNull(result.estimate);
  const status: BranchStatus = result.status === "ok" && estimate === null ? "failed" : result.status;
  const prev = table.branches[index]!;
  const updated: MultiverseBranch = status === "ok"
    ? { ...prev, status, estimate, se: finiteOrNull(result.se), p: finiteOrNull(result.p) }
    : { ...prev, status, estimate: null, se: null, p: null };
  return { ...table, branches: table.branches.map((b, i) => (i === index ? updated : b)) };
}

export interface MultiverseSummary {
  readonly role: "robustness-annotation";
  readonly confirms: false;
  /** Primary plus every branch, whatever its status: all of them count in the G6 family. */
  readonly familySize: number;
  readonly counts: { planned: number; ok: number; failed: number; notRun: number };
  readonly sameSignAsPrimary: { agree: number; of: number } | null;
  readonly range: { min: number; max: number } | null;
  readonly median: number | null;
}

export function summarizeMultiverse(table: MultiverseTable): MultiverseSummary {
  const count = (s: BranchStatus): number => table.branches.filter((b) => b.status === s).length;
  const okEstimates = table.branches.filter((b) => b.status === "ok").map((b) => b.estimate!).sort((a, b) => a - b);
  const primary = table.primary.estimate;
  const all = primary === null ? okEstimates : [...okEstimates, primary].sort((a, b) => a - b);
  const mid = okEstimates.length >> 1;
  const median = okEstimates.length === 0 ? null
    : okEstimates.length % 2 ? okEstimates[mid]! : (okEstimates[mid - 1]! + okEstimates[mid]!) / 2;
  return {
    role: "robustness-annotation",
    confirms: false,
    familySize: table.branches.length + 1,
    counts: { planned: count("planned"), ok: count("ok"), failed: count("failed"), notRun: count("not-run") },
    sameSignAsPrimary: primary === null ? null : { agree: okEstimates.filter((e) => Math.sign(e) === Math.sign(primary)).length, of: okEstimates.length },
    range: all.length ? { min: all[0]!, max: all[all.length - 1]! } : null,
    median,
  };
}

// ------------------------------------------------------------------ proposal selector

export type ProposalKind = "hypothesis" | "multiverse-branch" | "explorer-followup";
export interface Proposal {
  readonly id: string;
  readonly rule: DecisionRuleKey;
  readonly origin: Family | "software";
  readonly kind: ProposalKind;
  /** Lower runs first. Default 0. */
  readonly rank?: number;
}
export interface SelectOptions {
  readonly limit: number;
  /** Fingerprints already registered fleet-wide (omb-store hypothesis registry). */
  readonly seen?: Iterable<string>;
  /** Cap per origin so one family cannot flood a cycle. */
  readonly perOriginLimit?: number;
}
export interface Selection {
  selected: { id: string; fingerprint: string; origin: Proposal["origin"]; kind: ProposalKind }[];
  duplicates: { id: string; fingerprint: string; duplicateOf: string }[];
  deferred: { id: string; fingerprint: string; reason: "limit" | "origin-limit" }[];
  refused: { id: string; reason: string }[];
}

/** Deterministic: the result depends on the set of proposals, not on their order. */
export function selectProposals(proposals: readonly Proposal[], opts: SelectOptions): Selection {
  if (!Number.isSafeInteger(opts.limit) || opts.limit < 0) throw new RangeError("limit must be a non-negative integer");
  const out: Selection = { selected: [], duplicates: [], deferred: [], refused: [] };
  // Validate each proposal; its content key decides whether repeats of one id agree.
  type Checked = { p: Proposal; fp: string; rank: number; key: string } | { p: Proposal; error: string; key: string };
  const groups = new Map<string, Checked[]>();
  for (const p of proposals) {
    if (typeof p.id !== "string" || !p.id) { out.refused.push({ id: String(p.id), reason: "missing id" }); continue; }
    let checked: Checked;
    if (!(p.origin === "software" || isFamily(p.origin))) checked = { p, error: "unknown origin", key: `!origin:${String(p.origin)}` };
    else {
      try {
        const fp = decisionFingerprint(p.rule);
        const rank = Number.isFinite(p.rank) ? p.rank! : 0;
        checked = { p, fp, rank, key: JSON.stringify([fp, p.origin, p.kind, rank]) };
      } catch (e) {
        checked = { p, error: (e as Error).message, key: `!rule:${(e as Error).message}` };
      }
    }
    groups.set(p.id, [...(groups.get(p.id) ?? []), checked]);
  }
  // An id whose occurrences disagree is refused entirely, so the result never depends on arrival order.
  // Identical repeats (same fingerprint, origin, kind and rank) collapse to one.
  const keyed: { p: Proposal; fp: string; rank: number }[] = [];
  for (const id of [...groups.keys()].sort()) {
    const group = groups.get(id)!;
    if (new Set(group.map((c) => c.key)).size > 1) {
      for (let i = 0; i < group.length; i++) out.refused.push({ id, reason: "conflicting proposal id" });
      continue;
    }
    const c = group[0]!;
    if ("error" in c) out.refused.push({ id, reason: c.error });
    else keyed.push({ p: c.p, fp: c.fp, rank: c.rank });
  }
  out.refused.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : a.reason < b.reason ? -1 : a.reason > b.reason ? 1 : 0));
  keyed.sort((a, b) => a.rank - b.rank || (a.fp < b.fp ? -1 : a.fp > b.fp ? 1 : 0) || (a.p.id < b.p.id ? -1 : a.p.id > b.p.id ? 1 : 0));
  const seen = new Set(opts.seen ?? []);
  const representative = new Map<string, string>();
  const perOrigin = new Map<string, number>();
  for (const { p, fp } of keyed) {
    if (seen.has(fp)) { out.duplicates.push({ id: p.id, fingerprint: fp, duplicateOf: "registry" }); continue; }
    const rep = representative.get(fp);
    if (rep) { out.duplicates.push({ id: p.id, fingerprint: fp, duplicateOf: rep }); continue; }
    representative.set(fp, p.id);
    const used = perOrigin.get(p.origin) ?? 0;
    if (opts.perOriginLimit !== undefined && used >= opts.perOriginLimit) { out.deferred.push({ id: p.id, fingerprint: fp, reason: "origin-limit" }); continue; }
    if (out.selected.length >= opts.limit) { out.deferred.push({ id: p.id, fingerprint: fp, reason: "limit" }); continue; }
    perOrigin.set(p.origin, used + 1);
    out.selected.push({ id: p.id, fingerprint: fp, origin: p.origin, kind: p.kind });
  }
  return out;
}

// ------------------------------------------------------------------ explorer threat flags

/** Threats software can re-check with a deterministic gate. Anything else becomes an annotation. */
export const VERIFIABLE_THREATS: Readonly<Record<string, string>> = {
  duplicates: "G1a", "pseudo-replication": "G1a", leakage: "G1b", confounding: "G1c", multiplicity: "G6",
};
export interface ThreatFlag { readonly id: string; readonly explorer: Family; readonly threat: string; readonly target: string }
export interface ThreatTriage {
  /** One verification per (threat, target); agreeing explorers of one family count once. */
  verify: { gate: string; threat: string; target: string; flags: string[]; families: Family[] }[];
  annotate: ThreatFlag[];
}

export function triageThreatFlags(flags: readonly ThreatFlag[], verifiable: Readonly<Record<string, string>> = VERIFIABLE_THREATS): ThreatTriage {
  const groups = new Map<string, ThreatTriage["verify"][number]>();
  const annotate: ThreatFlag[] = [];
  const ordered = [...flags].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const f of ordered) {
    const threat = fold(String(f.threat ?? ""));
    const target = String(f.target ?? "").trim();
    const gate = Object.hasOwn(verifiable, threat) ? verifiable[threat] : undefined;
    if (!gate || !target || !isFamily(f.explorer)) { annotate.push(f); continue; }
    const key = `${threat}\u0000${target}`;
    const g = groups.get(key) ?? { gate, threat, target, flags: [], families: [] };
    g.flags.push(f.id);
    if (!g.families.includes(f.explorer)) g.families = [...g.families, f.explorer].sort();
    groups.set(key, g);
  }
  const verify = [...groups.values()].sort((a, b) => (a.threat + a.target < b.threat + b.target ? -1 : a.threat + a.target > b.threat + b.target ? 1 : 0));
  return { verify, annotate };
}

// ------------------------------------------------------------------ route H promotion rule

export interface RouteHInput {
  readonly effectiveUnits: number;
  /** G5b's predicted confirm-partition power at the MEI; null when G5b has not run. */
  readonly predictedConfirmPower: number | null;
  /** Sealer plus the _ombcert/_ombrun OS users are set up (design risk 11). */
  readonly sealerAvailable: boolean;
}

/** Route H is offered only with >= 150 effective units, G5b power >= 0.8 at the MEI, and a working sealer. */
export function routeHOffer(input: RouteHInput, rule = { minUnits: 150, minPower: 0.8 }): { offered: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!Number.isFinite(input.effectiveUnits) || input.effectiveUnits < rule.minUnits) reasons.push(`fewer than ${rule.minUnits} effective units`);
  if (input.predictedConfirmPower === null || !Number.isFinite(input.predictedConfirmPower)) reasons.push("G5b power not available");
  else if (input.predictedConfirmPower < rule.minPower) reasons.push(`predicted confirm power below ${rule.minPower}`);
  if (!input.sealerAvailable) reasons.push("sealer or OS users unavailable");
  return { offered: reasons.length === 0, reasons };
}
