import { providerTurn, providerPause, type ProviderRuntime } from './provider-runtime.ts';
import type { Role } from '../../omb-adapters/src/providers.ts';
import {isHardStopKind} from '../../omb-gauntlet/src/routing.ts';
import { refusalRecord } from "../../omb-certify/src/source-policy.ts";
import { phaseBudget } from "./liveness.ts";
// One LLM turn through the scheduler: mount policy check, host-written prompt file, adapter launch
// on the family omb-sched chose, durable dispatch record, refusal log, session tracking and the
// three-class routing of how the job ended. Shared by investigations and the boss program.

import { adapterNetworkFailure } from "./network.ts";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import type { WorkerAdapter, WorkerResult, WorkerSpec } from "../../omb-adapters/src/index.ts";
import { IssueLog, parseLenientJson, routeFailure } from "../../omb-gauntlet/src/index.ts";
import type { FamilyRequirement, JobRecord, JobSpec, LlmKind } from "../../omb-sched/src/index.ts";
import { adapterLauncher, type Fleet, type Launcher, type WorkerPayload } from "./fleet.ts";
import type { StepContext } from "./machine.ts";
import { assertMounts, type Mount, type TurnKind } from "./mounts.ts";
import type { Family, SessionRef } from "./types.ts";

export interface TurnEnv {
  providers?: ProviderRuntime;
  fleet: Fleet;
  workers: Readonly<Record<Family, WorkerAdapter>>;
  now: () => number;
  /** Host-only directory for prompt files (read by the adapter host process, never mounted). */
  promptDir: string;
  investigation: string;
  quietGroup: string | null;
  timeoutMs: number;
  route: "P" | "H";
  /** Host-only and real-data roots no mount may overlap. */
  forbidden: readonly string[];
  /** Research mode (default): an adapter's provenance_unverified is a journaled warning, not a retry
   * (charter: provenance checks are warnings). Benchmark arms set false. */
  provenanceIsWarning?: boolean;
}

export interface TurnRequest {
  role?: Role;
  againstModel?: string;
  ctx: StepContext;
  /** Scheduler job id: deterministic, so a restart resubmits the same job (idempotent submit). */
  jobId: string;
  kind: LlmKind;
  turn: TurnKind;
  family: FamilyRequirement;
  /** Resume this session when the scheduler places the job on its family. */
  session: SessionRef | null;
  /** Where a fresh session starts. */
  fresh: { workerJobId: string; workdir: string };
  /** Seed a newly created workdir (e.g. copy the locked plan in after a reroute). */
  seed?: (workdir: string) => void;
  mounts: Mount[];
  prompt: string;
  expect: { file: string; schema: string; required: boolean }[];
}

export interface TurnResult {
  ok: boolean;
  job: JobRecord;
  /** The session as it actually ran (after any reroute), or null when no dispatch happened. */
  session: SessionRef | null;
  result: WorkerResult | null;
  /** Hard-stop kind when the adapter positively observed one (job stopped, claims void). */
  hardStop: string | null;
  warnings: string[];
  /** Every required expected file exists in the session's directory (files are the contract). */
  filesPresent: boolean;
}

/**
 * Files are the contract (charter rule 5): a turn whose job did not end ok, without a hard stop, but
 * whose required files are on disk, is used, with a journaled warning; the next software step
 * (plan check, dry run, execution) judges the files.
 */
export function usableAfterFailure(turn: TurnResult, ctx: StepContext): boolean {
  if (turn.ok || turn.hardStop || turn.job.endReason?.startsWith("network-down:") || !turn.filesPresent) return false;
  ctx.note("warning", { kind: "turn-failed-files-used", detail: `${turn.job.spec.id} ended ${turn.job.lastStatus ?? turn.job.state}; its files on disk are used` });
  return true;
}

/** Adapter `expect` schemas V7 relies on; production adapters must be constructed with these. */
export const WORKER_SCHEMAS: Readonly<Record<string, (bytes: string) => boolean>> = Object.freeze({
  "omb-plan": (t: string) => { try { const v = parseLenientJson(t,new IssueLog()).value; return !!v && typeof v === "object" && !Array.isArray(v); } catch { return false; } },
  "omb-script": (t: string) => t.trim().length > 0,
  "omb-markdown": (t: string) => t.trim().length > 0,
  "omb-json": (t: string) => { try { JSON.parse(t); return true; } catch { return false; } },
});

const WORKER_KINDS: ReadonlySet<string> = new Set(["plan", "code", "explore", "replicate", "select", "boss", "repair"]);
export const SAFE = (s: string): string => s.replace(/[^A-Za-z0-9._-]/g, "_");

export function violationKind(result:WorkerResult|null):string|null {
  const violation=(result as (WorkerResult&{violation?:{kind?:unknown;evidence?:unknown}})|null)?.violation;
  return violation&&typeof violation.kind==='string'&&isHardStopKind(violation.kind)&&typeof violation.evidence==='string'&&violation.evidence.trim()?violation.kind:null;
}

const INFRA_STATUSES = new Set(["infra-error", "provider-error", "containment-failure"]);

/**
 * Why a failed turn is an infrastructure failure rather than a worker outcome, or null. It is when
 * the worker wrote none of its expected files AND either every allowed family refused the job or the
 * last dispatch ended in a process-level status (the CLI failed: auth, crash, timeout, containment).
 * A worker that ran and simply did not write its file (needs-resume exhausted) is not infrastructure.
 */
export function infrastructureFailure(turn: TurnResult, expect: readonly string[]): string | null {
  if (turn.job.endReason?.startsWith("network-down:")) return turn.job.endReason;
  if (turn.ok || turn.hardStop) return null;
  if (turn.session && expect.some((f) => existsSync(path.join(turn.session!.workdir, f)))) return null;
  if (turn.job.park?.reason === "family-unavailable") return `every allowed model family refused the turn: ${turn.job.refusals.map(f=>f.reason).join("; ")}`;
  const status = String(turn.result?.status ?? turn.job.lastStatus ?? "").toLowerCase().replace(/_/g, "-");
  if (!INFRA_STATUSES.has(status)) return null;
  return `${turn.job.dispatchCount} dispatch(es) ended ${status} without writing ${expect.join(", ")}`;
}

export async function runTurn(env: TurnEnv, req: TurnRequest): Promise<TurnResult> {
  assertMounts(req.turn, env.route, req.mounts, env.forbidden);
  const promptFile = path.join(env.promptDir, `${SAFE(req.jobId)}.md`);
  mkdirSync(env.promptDir, { recursive: true, mode: 0o700 });
  writeFileSync(promptFile, req.prompt, { mode: 0o600 });
  const spec: JobSpec = {
    id: req.jobId, kind: req.kind, family: req.family, investigation: env.investigation,
    ...(env.providers ? {maxAttempts: 1} : {}),
    ...(req.session?.sessionToken ? { resumeFrom: { family: req.session.family, sessionToken: req.session.sessionToken } } : {}),
    ...(env.quietGroup ? { quietGroup: env.quietGroup } : {}),
  };
  let repairFeedback="";
  let policyError: unknown;
  const workers = env.providers ? Object.fromEntries(Object.keys(env.workers).map(f => [f, {run: async (spec: WorkerSpec) => {
    try { return (await providerTurn(env.providers!, req, spec, req.ctx, env.now)).result; }
    catch (e) { policyError=e; return {status:"agent_error", resetAt:null,sessionToken:null,files:{},warnings:["Provider chain did not complete"],usage:null,usageComplete:false,containment:"unavailable",supervisor:null,eventsPath:"",quota:null,rateLimit:{terminal:false,signals:[],resetHint:null},provenance:{cliVersion:null,cliSha256:null,initInventory:[],observedModels:[],observedEfforts:[],identitySource:"unavailable",profileSha256:null,configSha256:null,canary:"unavailable"}} as WorkerResult; }
  }}])) as unknown as TurnEnv["workers"] : env.workers;
  const base = adapterLauncher(workers, (d) => {
    const resumed = d.resume !== null && (!req.session || d.family === req.session.family);
    let workdir: string, workerJobId: string;
    if (resumed) ({ workdir, workerJobId } = req.session ?? req.fresh);
    else if (!d.rerouted) ({ workdir, workerJobId } = req.session ?? req.fresh);
    else {
      // A refused session moves to another family in a fresh directory; a mid-task refusal's
      // partial files stay behind for audit and are never certified.
      const k = SAFE(d.dispatchId.split("#").at(-1) ?? "x");
      workdir = `${req.fresh.workdir}-${SAFE(req.jobId.split("/").slice(1).join("-"))}-${k}`;
      workerJobId = `${req.fresh.workerJobId}-${k}`;
    }
    if (!existsSync(workdir)) {
      mkdirSync(workdir, { recursive: true, mode: 0o700 });
      req.seed?.(workdir);
    }
    if (["code","dry-run-repair","look-repair","replicate"].includes(req.turn)) for(const dir of ["data","outputs","tmp","code"]) mkdirSync(path.join(workdir,dir),{recursive:true,mode:0o700});
    if (req.turn !== "standby-review" && !req.ctx.notes("turn-dispatch").some(n=>n.jobId===req.jobId)) rmSync(path.join(workdir,"turn-output.json"),{force:true});
    req.ctx.note("turn-dispatch", { jobId: req.jobId, dispatchId: d.dispatchId, family: d.family, workerJobId, workdir, resumed, rerouted: d.rerouted });
    if(repairFeedback)writeFileSync(promptFile, repairFeedback?`${req.prompt}\n\n${repairFeedback}`:req.prompt,{mode:0o600});
    const worker: WorkerSpec = {
      jobId: workerJobId, kind: WORKER_KINDS.has(d.kind) ? (d.kind as WorkerSpec["kind"]) : "plan",
      harness: d.harness ?? (d.family === "codex" ? "codex" : "claude-code"), family: d.family, model: d.model ?? "", effort: d.effort ?? "",
      workdir, mounts: req.mounts.map((m) => ({ path: m.path, mode: "ro" as const })), promptFile, network: "model-api-only",
      timeoutMs: phaseBudget(req.turn, env.timeoutMs), expect: req.expect,
    };
    if (resumed && d.resume) worker.resume = { sessionToken: d.resume.sessionToken, message: req.turn === "standby-review" ? `OMB-PHASE: standby-review\nverdict.json was missing or invalid. Continue this reviewer session and write the strict JSON verdict to ./verdict.json. A chat reply does not create the required file.\n${req.prompt}` : repairFeedback?`${req.prompt}\n\n${repairFeedback}`:req.prompt };
    return worker;
  }, env.now);
  // Every dispatch's adapter result is journaled (status and the first warnings, never file content).
  const launcher: Launcher = async (d) => {
    const r = await base(d);
    const prior=(r.payload as WorkerPayload | undefined)?.result;
    if(prior && !["ok","violation","refused-prework","refused-midtask"].includes(prior.status)){
      const missing=req.expect.filter(e=>e.required&&prior.files[e.file]!=="valid").map(e=>e.file);
      const postLook=["look-repair","interpret","replicate"].includes(req.turn);
      repairFeedback=`OMB-PHASE: ${req.turn}\nRepair the preceding ${prior.status} turn. Required files missing or invalid: ${missing.join(", ")||"none"}. ${postLook?"Diagnostics withheld after the look.":prior.warnings.slice(-5).join("\n").slice(-8192)}\nWrite the required files in this workdir and validate them before finishing.`;
    }
    if(prior?.status==="violation"&&!violationKind(prior)){req.ctx.note("warning",{kind:"untyped-violation",detail:"Adapter violation lacked a charter kind and positive evidence; repair/retry required"});return {...r,outcome:{...r.outcome,status:"agent-error"}};}
    if(prior?.status.startsWith("refused-")){repairFeedback="";writeFileSync(promptFile,req.prompt,{mode:0o600});}
    const status = (r.payload as WorkerPayload | undefined)?.result.status ?? r.outcome.status;
    if(!env.providers){const a={jobId:req.jobId,role:req.role??(req.turn==="replicate"?"reviewer":"worker"),provider:d.family,model:d.model??"",outcome:status,durationMs:0,tokens:prior?.usage??null,decision:status==="ok"?"complete":"scheduler"};req.ctx.note("model-attempt",a);req.ctx.note("model-cost",a);}
    req.ctx.note("turn-result", { jobId: req.jobId, dispatchId: d.dispatchId, family: d.family, status, warnings: (r.payload as WorkerPayload | undefined)?.result.warnings.slice(0, 5) ?? [] });
    if (status === "provenance_unverified" && env.provenanceIsWarning !== false && !adapterNetworkFailure((r.payload as WorkerPayload).result)) {
      req.ctx.note("warning", { kind: "provenance-unverified", detail: `${req.jobId}: the adapter could not corroborate model identity or usage; a warning in research mode` });
      return { ...r, outcome: { ...r.outcome, status: "ok" } };
    }
    return r;
  };
  let r = await env.fleet.run(spec, launcher);
  if(!env.providers&&r.job.park?.reason==="family-unavailable"&&!req.ctx.notes("family-cooldown").some(n=>n.jobId===req.jobId)){
    const reason=r.job.refusals.map(f=>f.reason).join("; ")||r.job.park.detail;
    repairFeedback="";writeFileSync(promptFile,req.prompt,{mode:0o600});
    req.ctx.note("family-cooldown",{jobId:req.jobId,reason});
    await env.fleet.delay(60_000);env.fleet.sched.release(req.jobId);
    r=await env.fleet.run(spec,launcher);
  }
  if(policyError)throw providerPause(policyError)??policyError;
  const job = r.job;
  const last = req.ctx.notes("turn-dispatch").filter((n) => n.jobId === req.jobId).at(-1);
  const payload = (r.payloads.at(-1) ?? null) as WorkerPayload | null;
  const logged = new Set(req.ctx.notes("refusal").map((n) => String(n.dispatchId)));
  for (const refusal of job.refusals) {
    if (logged.has(refusal.dispatchId)) continue;
    req.ctx.note("refusal", { jobId: req.jobId, dispatchId: refusal.dispatchId, family: refusal.family, status: refusal.status, reason: refusal.reason, scored: false });
  }
  const session: SessionRef | null = last ? {
    family: last.family as Family, ...(typeof last.model === "string" ? {model:last.model,provider:String(last.provider)} : {}), workerJobId: String(last.workerJobId), workdir: String(last.workdir),
    sessionToken: job.pinned === last.family ? job.sessionToken : (payload?.result.sessionToken ?? null),
  } : null;
  const warnings = payload?.result.warnings.slice(0, 20) ?? [];
  const filesPresent = !!session && req.expect.filter((e) => e.required).every((e) => existsSync(path.join(session.workdir, e.file)));
  if (job.state === "stopped") {
    const kind = violationKind(payload?.result ?? null);
    const route = routeFailure({ kind:kind??"unknown-violation", positiveEvidence: true, afterFirstModelTurn: true });
    req.ctx.note("routing", { jobId: req.jobId, event: kind, class: route.class, reason: route.reason });
    return { ok: false, job, session, result: payload?.result ?? null, hardStop: route.class === "hard-stop" ? kind : null, warnings, filesPresent };
  }
  if (job.state !== "succeeded") {
    req.ctx.note("refusal-record", { jobId: req.jobId, refusal: refusalRecord("infra", "adapter turn unavailable", req.turn === "look-repair" || req.turn === "interpret" ? "post-look" : "pre-look") });
    const event = job.park?.reason ?? job.lastStatus ?? job.state;
    const route = routeFailure({ kind: event === "family-unavailable" ? "family-unavailable" : "timeout-partial-files", afterFirstModelTurn: true });
    req.ctx.note("routing", { jobId: req.jobId, event, class: route.class, reason: route.reason });
  }
  return { ok: job.state === "succeeded", job, session, result: payload?.result ?? null, hardStop: null, warnings, filesPresent };
}
