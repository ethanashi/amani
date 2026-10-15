// The boss program (internal design notes (not published) §3.1 and DM11): an untrusted boss proposes hypotheses from a
// small world digest; trusted software validates them (rung, kind, scope, an approved manifest,
// a complete decision rule), fingerprints them, registers EVERY valid proposal in the program-wide
// hypothesis registry (G6: "kth hypothesis on this manifest", whether or not it ever runs),
// deduplicates against the registry and within the cycle, selects at most K, dispatches the
// selected investigations in parallel through omb-sched, runs a read-only novelty worker beside
// each (annotations only, never labels), and stops after 2 consecutive dry cycles (no new
// distinct hypothesis). The boss never sees outcome-revealing data before locks: it gets the digest
// (labels of finished investigations, counts) and schema views, nothing else.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { WorkerAdapter } from "../../omb-adapters/src/index.ts";
import { parseLenientJson, IssueLog } from "../../omb-gauntlet/src/index.ts";
import { decisionFingerprint, selectProposals, type Proposal as SchedProposal } from "../../omb-sched/src/index.ts";
import { readSmall, treeHash } from "./bundle.ts";
import type { Fleet } from "./fleet.ts";
import type { DeliverableOut } from "./investigation.ts";
import type { Journal } from "./journal.ts";
import { Steps, type StepContext } from "./machine.ts";
import type { HypothesisRegistryPort, LiteraturePort } from "./ports.ts";
import { bossPrompt, noveltyPrompt } from "./prompts.ts";
import { runTurn, SAFE } from "./turns.ts";
import type { Family, InvestigationSpec, Json, JsonObject } from "./types.ts";

export const RUNGS = ["prediction", "association", "genetic-directional", "causal", "target", "dossier"] as const;
export const PROPOSAL_KINDS = ["effect-exists", "effect-size", "null", "reproduction", "out-of-sample"] as const;
export const SCOPES = ["S1", "S2", "S3"] as const;
export const DIGEST_MAX_BYTES = 8192;

export interface ProgramManifest { datasetId: string; dataRoot: string; manifestHash: string; schemaViewDir: string }

export interface BossProgramSpec {
  programId: string;
  /** The approved manifest list. Schema views come from staging (no row values). */
  manifests: ProgramManifest[];
  /** K: proposals eligible for selection per cycle. */
  maxProposals: number;
  /** Investigations dispatched per cycle. */
  maxParallel: number;
  dryCyclesToStop: number;
  maxCycles: number;
  route: "P" | "H";
  /** Cap per proposing family per cycle. */
  perOriginLimit?: number;
}

export interface BossDeps {
  journal: Journal;
  fleet: Fleet;
  workers: Readonly<Record<Family, WorkerAdapter>>;
  registry: HypothesisRegistryPort;
  paths: { hostRoot: string; shareRoot: string; workRoot: string };
  now: () => number;
  /** Run (or resume) one investigation to its deliverable. */
  investigate: (spec: InvestigationSpec) => Promise<DeliverableOut>;
  literature?: LiteraturePort;
  quietGroup?: string | null;
  turnTimeoutMs?: number;
  faultAt?: (point: string) => void;
}

export interface NormalizedProposal {
  id: string; rung: string; kind: string; scope: string; manifest: string; question: string; plainStatement: string;
  rule: { exposure: string; outcome: string; unit: string; adjustment: string[]; strata: string[]; test: string; direction: string };
  fingerprint: string;
}

export interface Selection {
  proposals: NormalizedProposal[];
  /** Valid, new and within K: dispatched this cycle (up to maxParallel) or backlogged to the next. */
  selected: string[];
  /** Valid and new but beyond K: registered (they count toward G6) and never run. */
  overLimit: string[];
  duplicates: { id: string; duplicateOf: string }[];
  refused: { id: string; reason: string }[];
  /** New distinct hypotheses this cycle (0 = dry): valid, not duplicates of the registry or the cycle. */
  newCount: number;
}

export interface Registration extends Selection { ordinals: Record<string, number> }

export interface CycleResult {
  cycle: number;
  newCount: number;
  dry: boolean;
  dispatched: string[];
  outcomes: { proposalId: string; investigationId: string; status: string; claims: { claimId: string; status: string }[] }[];
  novelty: Record<string, { annotations: Json[]; dropped: string[] }>;
}

export interface ProgramResult { programId: string; cycles: CycleResult[]; stoppedBy: "dry-cycles" | "max-cycles"; registered: number }

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.normalize("NFKC").trim() : null);
const list = (v: unknown): string[] | null => (Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]).map((x) => x.trim()).filter(Boolean) : v === undefined ? [] : null);

/** Software validation of one proposal; a refusal names the missing or invalid field. */
export function normalizeProposal(raw: unknown, approved: readonly string[]): NormalizedProposal | { id: string; reason: string } {
  const r = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const id = str(r.id) ?? "";
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(id)) return { id: id || "(missing)", reason: "id must match [A-Za-z0-9._-]{1,64}" };
  const rung = str(r.rung)?.toLowerCase() ?? null, kind = str(r.kind)?.toLowerCase() ?? null, scope = str(r.scope)?.toUpperCase() ?? null;
  if (!rung || !(RUNGS as readonly string[]).includes(rung)) return { id, reason: "rung must be one of " + RUNGS.join("|") };
  if (!kind || !(PROPOSAL_KINDS as readonly string[]).includes(kind)) return { id, reason: "kind must be one of " + PROPOSAL_KINDS.join("|") };
  if (!scope || !(SCOPES as readonly string[]).includes(scope)) return { id, reason: "scope must be one of " + SCOPES.join("|") };
  const manifest = str(r.manifest);
  if (!manifest || !approved.includes(manifest)) return { id, reason: "manifest is not on the approved list" };
  const question = str(r.question), plainStatement = str(r.plain_statement ?? r.plainStatement);
  if (!question || !plainStatement) return { id, reason: "question and plain_statement are required" };
  const rule = (r.rule && typeof r.rule === "object" ? r.rule : {}) as Record<string, unknown>;
  const exposure = str(rule.exposure), outcome = str(rule.outcome), unit = str(rule.unit), test = str(rule.test), direction = str(rule.direction);
  const adjustment = list(rule.adjustment), strata = list(rule.strata);
  if (!exposure || !outcome || !unit || !test || !direction || adjustment === null || strata === null) return { id, reason: "rule needs exposure, outcome, unit, test, direction and adjustment/strata lists" };
  const ruleOut = { exposure, outcome, unit, adjustment, strata, test, direction };
  return { id, rung, kind, scope, manifest, question, plainStatement, rule: ruleOut, fingerprint: decisionFingerprint({ ...ruleOut, manifest }) };
}

/** Annotations only: every other key (status, label, confirmed, rank...) is dropped and logged. */
export function sanitizeNovelty(text: string | null): { annotations: Json[]; dropped: string[] } {
  if (text === null) return { annotations: [], dropped: ["novelty.json missing"] };
  const parsed = parseLenientJson(text, new IssueLog());
  const root = (parsed.value && typeof parsed.value === "object" && !Array.isArray(parsed.value) ? parsed.value : {}) as Record<string, unknown>;
  const dropped = Object.keys(root).filter((k) => k !== "annotations").map((k) => `$.${k}`);
  const annotations: Json[] = [];
  for (const [i, a] of (Array.isArray(root.annotations) ? root.annotations : []).entries()) {
    if (!a || typeof a !== "object" || Array.isArray(a)) continue;
    const rec = a as Record<string, unknown>;
    const keep: JsonObject = {};
    for (const k of ["source", "ref", "relation", "note"]) if (typeof rec[k] === "string") keep[k] = (rec[k] as string).slice(0, 2000);
    for (const k of Object.keys(rec)) if (!["source", "ref", "relation", "note"].includes(k)) dropped.push(`$.annotations[${i}].${k}`);
    if (Object.keys(keep).length) annotations.push(keep);
  }
  return { annotations: annotations.slice(0, 200), dropped };
}

export class BossProgram {
  readonly steps: Steps;
  readonly #s: BossProgramSpec;
  readonly #d: BossDeps;

  constructor(spec: BossProgramSpec, deps: BossDeps) {
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(spec.programId)) throw new TypeError("program id must match [A-Za-z0-9._-]{1,64}");
    if (spec.manifests.length === 0) throw new TypeError("a program needs at least one approved manifest");
    if (!(spec.maxProposals >= 1 && spec.maxParallel >= 1 && spec.dryCyclesToStop >= 1 && spec.maxCycles >= 1)) throw new RangeError("program limits must be positive");
    this.#s = spec;
    this.#d = deps;
    this.steps = new Steps(deps.journal, `program:${spec.programId}`, deps.faultAt ?? (() => {}));
  }

  #host(...p: string[]): string { return path.join(this.#d.paths.hostRoot, "programs", SAFE(this.#s.programId), ...p); }
  #share(...p: string[]): string { return path.join(this.#d.paths.shareRoot, "programs", SAFE(this.#s.programId), ...p); }
  #work(...p: string[]): string { return path.join(this.#d.paths.workRoot, "programs", SAFE(this.#s.programId), ...p); }

  #env() {
    return {
      fleet: this.#d.fleet, workers: this.#d.workers, now: this.#d.now, promptDir: this.#host("prompts"), investigation: `program:${this.#s.programId}`,
      quietGroup: this.#d.quietGroup ?? null, timeoutMs: this.#d.turnTimeoutMs ?? 30 * 60_000, route: "P" as const,
      forbidden: [this.#d.paths.hostRoot, ...this.#s.manifests.map((m) => m.dataRoot)], provenanceIsWarning: true,
    };
  }

  async run(): Promise<ProgramResult> {
    const cycles: CycleResult[] = [];
    let dryRun = 0;
    for (let c = 1; c <= this.#s.maxCycles; c++) {
      const r = await this.#cycle(c, cycles);
      cycles.push(r);
      dryRun = r.dry ? dryRun + 1 : 0;
      if (dryRun >= this.#s.dryCyclesToStop) return this.#finish(cycles, "dry-cycles");
    }
    return this.#finish(cycles, "max-cycles");
  }

  #finish(cycles: CycleResult[], stoppedBy: ProgramResult["stoppedBy"]): ProgramResult {
    const registered = this.#s.manifests.reduce((n, m) => n + this.#d.registry.count(m.manifestHash), 0);
    return { programId: this.#s.programId, cycles, stoppedBy, registered };
  }

  /** The world digest (<= 8 KB): approved datasets, registry counts and labels of finished work only. */
  digest(cycle: number, previous: readonly CycleResult[], registrations: readonly Registration[]): JsonObject {
    const results = previous.flatMap((c) => c.outcomes.map((o) => ({ cycle: c.cycle, proposal: o.proposalId, status: o.status, claims: o.claims })));
    const proposals = registrations.flatMap((r) => r.proposals.map((p) => ({ id: p.id, rung: p.rung, kind: p.kind, scope: p.scope, manifest: p.manifest.slice(0, 12), exposure: p.rule.exposure, outcome: p.rule.outcome })));
    const doc: JsonObject = {
      schema: "omb-investigate/world-digest@1", program: this.#s.programId, cycle,
      datasets: this.#s.manifests.map((m) => ({ datasetId: m.datasetId, manifest: m.manifestHash, schemaView: m.schemaViewDir })),
      registry: Object.fromEntries(this.#s.manifests.map((m) => [m.manifestHash, this.#d.registry.count(m.manifestHash)])),
      proposals, results, omitted: 0,
    };
    // Bounded: drop the oldest entries first, always keep the counts.
    let omitted = 0;
    while (Buffer.byteLength(JSON.stringify(doc)) > DIGEST_MAX_BYTES && ((doc.results as Json[]).length || (doc.proposals as Json[]).length)) {
      if ((doc.results as Json[]).length) (doc.results as Json[]).shift(); else (doc.proposals as Json[]).shift();
      omitted += 1;
      doc.omitted = omitted;
    }
    return doc;
  }

  async #cycle(c: number, previous: readonly CycleResult[]): Promise<CycleResult> {
    const ctx = this.steps.context(`cycle-${c}`);
    const priorRegs: Registration[] = [];
    for (let k = 1; k < c; k++) {
      const sel = this.steps.peekStep<Selection>(`cycle-${k}`, "select", { c: k }), ord = this.steps.peekStep<Record<string, number>>(`cycle-${k}`, "register", { c: k });
      if (sel && ord) priorRegs.push({ ...sel, ordinals: ord });
    }
    const digestDir = await ctx.step("digest", { c }, async () => {
      const dir = this.#share(`digest-${c}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, "digest.json"), JSON.stringify(this.digest(c, previous, priorRegs), null, 2) + "\n");
      return dir;
    });
    const boss = await ctx.step("boss", { c, digest: treeHash(digestDir) }, async () => {
      const turn = await runTurn(this.#env(), {
        ctx, jobId: `program:${this.#s.programId}/cycle-${c}/boss`, kind: "boss", turn: "boss", family: { mode: "any" }, session: null,
        fresh: { workerJobId: `program:${this.#s.programId}:boss-${c}`, workdir: this.#work(`boss-${c}`) },
        mounts: [{ role: "digest", path: digestDir }, ...this.#s.manifests.map((m) => ({ role: "schema" as const, path: m.schemaViewDir }))],
        prompt: bossPrompt({ programId: this.#s.programId, cycle: c, digestDir, maxProposals: this.#s.maxProposals, manifests: this.#s.manifests.map((m) => m.manifestHash) }),
        expect: [{ file: "proposals.json", schema: "omb-json", required: true }],
      });
      return { text: turn.session ? readSmall(path.join(turn.session.workdir, "proposals.json"), 500_000) : null, family: turn.session?.family ?? null, ok: turn.ok, hardStop: turn.hardStop };
    });
    // Selection intent is persisted BEFORE anything is registered (review finding 5): a crash between
    // registrations replays this cycle's own registrations idempotently instead of reading them back
    // as earlier duplicates, so selected work is never lost and nothing is counted twice.
    const sel = await ctx.step("select", { c }, async () => this.#select(boss.text, boss.family));
    const registered = await ctx.step("register", { c }, async () => this.#registerSelected(c, sel));
    const reg: Registration = { ...sel, ordinals: registered };
    // Backlog first (registered earlier, never dispatched), then this cycle's selection.
    const dispatchedBefore = new Set(previous.flatMap((p) => p.dispatched));
    const backlog = priorRegs.flatMap((r) => r.selected.map((id) => r.proposals.find((p) => p.id === id)!)).filter((p) => p && !dispatchedBefore.has(p.id));
    const fresh = reg.selected.map((id) => reg.proposals.find((p) => p.id === id)!);
    const queue = [...backlog, ...fresh];
    const run = queue.slice(0, this.#s.maxParallel);
    const ordinals: Record<string, number> = Object.assign({}, ...priorRegs.map((r) => r.ordinals), reg.ordinals);
    const outcomes = await Promise.all(run.map(async (p) => {
      const spec = this.#specFor(c, p, ordinals[p.id] ?? 0);
      const novelty = this.#novelty(ctx, c, p);
      const out = await this.#d.investigate(spec);
      const nov = await novelty;
      return { p, spec, out, nov };
    }));
    return ctx.step("result", { c }, async (): Promise<CycleResult> => ({
      cycle: c, newCount: reg.newCount, dry: reg.newCount === 0, dispatched: run.map((p) => p.id),
      outcomes: outcomes.map(({ p, spec, out }) => ({ proposalId: p.id, investigationId: spec.id, status: out.status, claims: out.claims.map((x) => ({ claimId: x.claimId, status: x.status })) })),
      novelty: Object.fromEntries(outcomes.map(({ p, nov }) => [p.id, nov])),
    }));
  }

  /** Validate, dedupe against the registry and select: no side effects (memoized as the "select" step). */
  #select(text: string | null, family: Family | null): Selection {
    const out: Selection = { proposals: [], selected: [], overLimit: [], duplicates: [], refused: [], newCount: 0 };
    if (text === null) { out.refused.push({ id: "(file)", reason: "proposals.json missing" }); return out; }
    const parsed = parseLenientJson(text, new IssueLog());
    const root = parsed.value as Record<string, unknown> | unknown[] | null;
    const items = Array.isArray(root) ? root : root && typeof root === "object" && Array.isArray((root as Record<string, unknown>).proposals) ? (root as Record<string, unknown>).proposals as unknown[] : [];
    const approved = this.#s.manifests.map((m) => m.manifestHash);
    const valid: NormalizedProposal[] = [];
    for (const item of items) {
      const n = normalizeProposal(item, approved);
      if ("reason" in n) out.refused.push(n); else valid.push(n);
    }
    // Repeated ids with different content are refused entirely (order-independent).
    const byId = new Map<string, NormalizedProposal[]>();
    for (const v of valid) byId.set(v.id, [...(byId.get(v.id) ?? []), v]);
    const unique: NormalizedProposal[] = [];
    for (const [id, group] of [...byId].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      if (new Set(group.map((g) => g.fingerprint)).size > 1) out.refused.push({ id, reason: "conflicting proposals share this id" });
      else unique.push(group[0]!);
    }
    out.proposals = unique;
    // Dedupe against the program-wide registry and within the cycle; at most K eligible.
    const seen = new Set(this.#d.registry.entries().map((e) => e.fingerprint));
    const origin: SchedProposal["origin"] = family ?? "software";
    const sel = selectProposals(unique.map((p) => ({ id: p.id, rule: { ...p.rule, manifest: p.manifest }, origin, kind: "hypothesis" as const })), {
      limit: this.#s.maxProposals, seen, ...(this.#s.perOriginLimit ? { perOriginLimit: this.#s.perOriginLimit } : {}),
    });
    for (const d of sel.duplicates) out.duplicates.push({ id: d.id, duplicateOf: d.duplicateOf });
    for (const r of sel.refused) out.refused.push(r);
    out.selected = sel.selected.map((s) => s.id).sort();
    out.overLimit = sel.deferred.map((d) => d.id).sort();
    // EVERY valid, non-duplicate proposal counts toward G6, selected or not.
    out.newCount = out.selected.length + out.overLimit.length;
    return out;
  }

  /** Register every counted proposal of this cycle (idempotent by fingerprint; replay returns the same ordinals). */
  #registerSelected(c: number, sel: Selection): Record<string, number> {
    const ordinals: Record<string, number> = {};
    for (const id of [...sel.selected, ...sel.overLimit].sort()) {
      const p = sel.proposals.find((u) => u.id === id)!;
      ordinals[p.id] = this.#d.registry.register({ manifest: p.manifest, fingerprint: p.fingerprint, source: { programId: this.#s.programId, cycle: c, proposalId: p.id, rung: p.rung, kind: p.kind, scope: p.scope } }).ordinal;
    }
    return ordinals;
  }

  #specFor(c: number, p: NormalizedProposal, ordinal: number): InvestigationSpec {
    const m = this.#s.manifests.find((x) => x.manifestHash === p.manifest)!;
    return {
      id: `${this.#s.programId}.c${c}.${p.id}`, question: p.question, plainStatement: p.plainStatement,
      dataset: { datasetId: m.datasetId, dataRoot: m.dataRoot, expectedManifestHash: m.manifestHash }, route: this.#s.route,
      program: { programId: this.#s.programId, proposalId: p.id, fingerprint: p.fingerprint, ordinal, rung: p.rung, scope: p.scope },
    };
  }

  async #novelty(ctx: StepContext, c: number, p: NormalizedProposal): Promise<{ annotations: Json[]; dropped: string[] }> {
    if (!this.#d.literature) return { annotations: [], dropped: [] };
    return ctx.step(`novelty-${p.id}`, { c, fingerprint: p.fingerprint }, async () => {
      const snap = await this.#d.literature!.snapshot({ programId: this.#s.programId, proposalId: p.id, query: `${p.rule.exposure} ${p.rule.outcome}` });
      const turn = await runTurn({ ...this.#env(), forbidden: [this.#d.paths.hostRoot, ...this.#s.manifests.map((m) => m.dataRoot), ...this.#s.manifests.map((m) => m.schemaViewDir)] }, {
        ctx, jobId: `program:${this.#s.programId}/cycle-${c}/novelty-${p.id}`, kind: "explore", turn: "novelty", family: { mode: "any" }, session: null,
        fresh: { workerJobId: `program:${this.#s.programId}:novelty-${c}-${p.id}`, workdir: this.#work(`novelty-${c}-${p.id}`) },
        mounts: [{ role: "literature", path: snap.dir }], prompt: noveltyPrompt({ proposalId: p.id, question: p.question, snapshotDir: snap.dir }),
        expect: [{ file: "novelty.json", schema: "omb-json", required: true }],
      });
      const result = sanitizeNovelty(turn.session ? readSmall(path.join(turn.session.workdir, "novelty.json"), 500_000) : null);
      if (result.dropped.some((d) => d !== "novelty.json missing")) ctx.note("warning", { kind: "novelty-label-ignored", detail: `the novelty worker may annotate only; dropped ${result.dropped.length} field(s)` });
      return result;
    });
  }
}
