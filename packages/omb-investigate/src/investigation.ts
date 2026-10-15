import { mayRetryLook } from './look-retry.ts';
import { LiteraturePayloadError } from '../../omb-literature/src/validation.ts';
import { lateralSuggestions, lateralDecisions } from './lateral.ts';

import {modelFamily} from '../../omb-adapters/src/providers.ts';
import { ProviderDisagreement, type ProviderRuntime } from './provider-runtime.ts';
import { replanReason, classifyPlanIssues, blindReplanPrompt, renderPlanAmendments, capAmendedClaims } from './replan.ts';
import { tiercPlanSpecs } from '../../omb-certify/src/tierc-plan.ts';
import { TIERC_REGISTRATIONS, tiercRegistryHash } from '../../omb-certify/src/tierc.ts';
import { colocPlanSpecs } from '../../omb-certify/src/coloc-plan.ts';
import { COLOC_REGISTRATION, COLOC_REGISTRY_HASH } from '../../omb-certify/src/procedure-registry.ts';
import { trustedDataSummaries } from "./data-summaries.ts";
import { assumptionSignals, collectAssumptionSignals, methodsValidityPrompt, parseMethodsReview, type AssumptionSignal, type AdvisoryEvidence, type MethodsValidityReview } from "./methods-validity.ts";
import { enforceDiagnostics } from "./diagnostics.ts";
import { BriefLedger, emptyBrief, searchEnabled, recordIdeation, recordIdea, type Ideation, type LateralSuggestion, type LateralDecision } from '../../omb-literature/src/index.ts';
import {integrityMetrics,unavailableIntegrity,renderIntegrityReference} from "./integrity.ts";
import {InvestigationPaused,StagerRefusal,transientStorageFault} from "./pause.ts";
import { practiceDataClaim, PracticeStructureError, PRACTICE_RULE } from "./practice-structure.ts";
import { triageLimits, type TriageLimits } from "./triage-config.ts";
import { InvestigationParked, readAppeal, resolveAppeal, standbyReview, syncFalseAlarmLedger, parkTriage, recordRefusal, chargeRepair, collapsedRefusals, exceptionApplies, type TriageException, APPEAL_RECEIPT, type TriageAction, type Appeal, type ParkStatus } from "./triage.ts";
import { networkEvidence, NetworkDown } from "./network.ts";
// One investigation: the fixed scientific-method recipe (design §3 "One investigation", route P at
// line 103, routes P/H/N, kernel v3 amendments 7, 11, 14 and 15). Untrusted workers write files;
// trusted software stages, checks, locks, freezes, looks, certifies and labels.
//
//   question -> stage -> plan -> plan-lock -> code -> dry-run -> freeze -> look -> certify -> replicate -> interpret -> deliverable
//
// The lead is ONE resumed session (plan -> code -> repairs -> interpret), dispatched through
// omb-sched (Codex default, Claude secondary; a refused Claude worker is rerouted to Codex by the
// scheduler and the adapter's hint, logged, never scored). The G7 replicator is a different family.

import { cpSync, existsSync, copyFileSync, mkdirSync, realpathSync, readFileSync, rmSync, writeFileSync, readdirSync, lstatSync } from "node:fs";
import path from "node:path";
import type { WorkerAdapter } from "../../omb-adapters/src/index.ts";
import {
  buildMetricTable, findClaim, parsePlan, planLockHash, renderProse, routeFailure, type GateResult, type Plan,
} from "../../omb-gauntlet/src/index.ts";
import { decisionFingerprint, isTerminal, routeHOffer } from "../../omb-sched/src/index.ts";
import { CodePolicyError, refusalRecord, withBundleContext, type RefusalRecord } from "../../omb-certify/src/source-policy.ts";
import { fileSha256, freezeBundle, readSmall, removeTree, snapshotBundle, treeHash, treeHashes, sourceInventory, revalidateDevDrop, TrustedPathChanged, type Bundle } from "./bundle.ts";
import { renderDeliverable } from "./deliverable.ts";
import { computeLauncher, type Fleet } from "./fleet.ts";
import type { Journal } from "./journal.ts";
import { applyCaps, DEGRADED_REASON, mergeRouteN, terminalClaims } from "./labels.ts";
import { programLimitations, programState, recordDecisions, type ProgramState } from "./multiplicity.ts";
import { PhaseMachine, terminal, hashOf, HardStopObserved, TransitionRefused, type StepContext } from "./machine.ts";
import { scanForCanaries, scanAuthorizedCanaries, type Mount } from "./mounts.ts";
import { infrastructureFailure, runTurn, usableAfterFailure, type TurnEnv, type TurnRequest, type TurnResult } from "./turns.ts";
import { checkPlan, contractRules, kernelPlanText, repairMessage, planAlternatives, samePlan } from "./plan-check.ts";
import { REGISTERED_DESIGNS, RegistryProcedures } from "./procedures.ts";
import { ContractPinRefused, verifyPinnedContract } from "./contracts.ts";
import type {
  ApprovalPort, ConfirmationPort, LookRequest, ExecRequest, CertifyRequest, CertifyPort, CertifyResult, ContentTuple, ContractPin, ContractPort, DerivedData, ExecResult, ExecutorPort, HostCapabilities,
  HypothesisRegistryPort, LockLedgerPort, LockReceipt, LookRecord, OSAttestation, OSAttestationPort, PracticeCheck, PreflightPort, ProcedurePort, ProcedureResolution, ReproductionTargetSpec, StagedData, StagerPort,
} from "./ports.ts";
import {
  codePrompt, dryRunRepairPrompt, interpretPrompt, lookRepairPrompt, planPrompt, planRepairPrompt, replicatePrompt,
  type CodePromptInput, type PlanPromptInput,
} from "./prompts.ts";
import { compareReplication, g7NotRun, lookGate, readPrimary } from "./replication.ts";
import {
  errorCategory, type ClaimRecord, type ErrorCategory, type Family, type InvestigationSpec, type PhaseId, type PhaseOutputBase,
  type ProgramLink, type Route, type SessionRef, type Terminal,
} from "./types.ts";

// ------------------------------------------------------------------ configuration

export interface InvestigationPolicy {
  triage: TriageLimits;
  /** Blind plan repair rounds before locking the evaluable part of the plan (design: up to 2). */
  planRepairRounds: number;
  /** Repair turns after a failed synthetic dry run (before any look). */
  dryRunRepairRounds: number;
  /** Repair turns after a crashed look (each one spends a look; design: one). */
  lookRepairRounds: number;
  turnTimeoutMs: number;
  /** Run the G7 cross-family replicator. */
  replicate: boolean;
  /** Keep worker directories after the deliverable (default: delete them; evidence is in host state). */
  keepWorkdirs: boolean;
  /** Official arm-run id: every job of this investigation runs in omb-sched quiet mode. */
  quietGroup: string | null;
  /** Research mode: an adapter's provenance_unverified is a warning, not a retry (benchmark arms: false). */
  provenanceIsWarning: boolean;
}

export const DEFAULT_POLICY: InvestigationPolicy = Object.freeze({
  triage: triageLimits(), planRepairRounds: 5, dryRunRepairRounds: 6, lookRepairRounds: 2, turnTimeoutMs: 60 * 60_000, replicate: true, keepWorkdirs: false, quietGroup: null, provenanceIsWarning: true,
});

export interface InvestigationPaths {
  /** Host-only: journal copies, locked plans, bundles, look outputs, deliverables. Never mounted. */
  hostRoot: string;
  /** Host-written, worker-readable: task copies, locked-plan copies, certified reports. */
  shareRoot: string;
  /** Worker directories (the only writable paths a worker gets). */
  workRoot: string;
}

export interface InvestigationDeps {
  beforePhase?: (phase: PhaseId) => Promise<void>;
  providers?: ProviderRuntime;
  literature?: import("./ports.ts").PlanLiteraturePort;
  contractVerification?:Omit<import("../../omb-certify/src/contract-verifier.ts").ContractVerificationOptions,"expectedContractHash">;
  journal: Journal;
  fleet: Fleet;
  workers: Readonly<Record<Family, WorkerAdapter>>;
  stager: StagerPort;
  executor: ExecutorPort;
  certifier: CertifyPort;
  confirmation?: ConfirmationPort;
  ledger: LockLedgerPort;
  registry: HypothesisRegistryPort;
  host: HostCapabilities;
  paths: InvestigationPaths;
  now: () => number;
  procedures?: ProcedurePort;
  contracts?: ContractPort;
  preflight?: PreflightPort;
  approval?: ApprovalPort;
  /** OS-user attestation (production: LauncherAttestation). Absent or failing: degraded. */
  attestation?: OSAttestationPort;
  /** Read-only runtime roots (e.g. the pixi analysis environment) mounted into code turns. The
   * adapters must be built with `schemas: WORKER_SCHEMAS` (the WorkerSpec.expect schema names). */
  runtimeMounts?: readonly string[];
  policy?: Partial<InvestigationPolicy>;
  faultAt?: (point: string) => void;
}

// ------------------------------------------------------------------ phase outputs (journaled)

export interface PlanClaimSummary {
  id: string; kind: string; estimand: string | null; exposure: string | null; outcome: string | null; unit: string | null;
  adjustment: string[]; strata: string[]; test: string | null; direction: string; mei: number | null; exploratory: boolean;
}
interface QuestionOut extends PhaseOutputBase { question: string; plainStatement: string; datasetId: string; route: "P" | "H"; independent: string | null; program: ProgramLink | null; taskPromptHash: string | null }
/** OS-user separation for this investigation: a verified attestation AND the host execution path under it. */
export interface Separation { separated: boolean; attested: boolean; reason: string; attestation: OSAttestation | null }
const NO_SEPARATION: Separation = { separated: false, attested: false, reason: "separation not established (the stage phase did not complete)", attestation: null };
interface StageOut extends PhaseOutputBase { staged: StagedData | null; contract: ContractPin | null; route: "P" | "H"; routeReasons: string[]; taskFile: string | null; preflight: string[]; separation: Separation }
interface PlanOut extends PhaseOutputBase {
  literatureBrief?: import("../../omb-literature/src/index.ts").FrozenBrief;
  lead: SessionRef | null; lockedPlan: string | null; planBytesHash: string | null; planHash: string | null; plainStatement: string | null;
  paperSet: string[]; confirmatory: string[]; claims: PlanClaimSummary[]; repairRounds: number; issues: string[]; warnings: string[];
}
interface LockOut extends PhaseOutputBase {
  planHash: string; lock: LockReceipt | null; procedures: Record<string, ProcedureResolution>; ordinals: Record<string, number>;
  fingerprints: Record<string, string>; plainStatement: string; paperSet: string[]; approvalActor: "owner" | "policy"; expectedContractHash: string | null;
}
interface CodeOut extends PhaseOutputBase { lead: SessionRef | null; devData: DerivedData | null; warnings: string[] }
interface Attempt { attempt: number; status: "ok" | "crash"; category: ErrorCategory | null }
interface DryRunOut extends PhaseOutputBase { lead: SessionRef | null; candidate: Bundle | null; synthetic: DerivedData | null; attempts: Attempt[] }
interface FreezeOut extends PhaseOutputBase { frozen: { dir: string; hash: string } | null; receipt: LockReceipt | null; discarded: string[]; planRestored: boolean }
export interface LookEntry { number: number; partitionId: string; route: Route; sequence: number; hash: string; status: "ok" | "crash"; category: ErrorCategory | null; frozenHash: string }
interface LookOut extends PhaseOutputBase {
  looks: LookEntry[]; final: { number: number; outputsDir: string; outputsHash: string | null; sequence: number } | null;
  frozen: { dir: string; hash: string }; lead: SessionRef | null; partitionId: string; dataDir: string; repairs: number;
}
interface CertifyOut extends PhaseOutputBase { certification: CertifyResult; g8: GateResult[]; program: ProgramState }
interface RouteNOut { datasetId: string; manifestHash: string; look: LookEntry | null; claims: ClaimRecord[] | null; reason: string }
interface ReplicateOut extends PhaseOutputBase {
  methodsValidity?: MethodsValidityReview;
  implementationAgreement?: {scope:"implementation-agreement";methodsCorroboration:false;family:string|null;verified:boolean;reason:string}|null;
  g7: GateResult[]; replicator: { family: string | null; verified: boolean; reason: string } | null; certification: CertifyResult | null;
  routeN: RouteNOut | null; claims: ClaimRecord[];
}
interface InterpretOut extends PhaseOutputBase { interpretation: { file: string; hash: string; typedNumbers: number; unknownMetrics: number; references: string[] } | null; warnings: string[] }
export interface DeliverableOut extends PhaseOutputBase { outcome: Terminal | null; status: string; claims: ClaimRecord[]; dir: string; files: Record<string, string> }

const SAFE = (s: string): string => s.replace(/[^A-Za-z0-9._-]/g, "_");

/** Blinding unit and strata from the trusted contract design ({unit, blindingStrata}), else none. */
export function trustedBlinding(contract: ContractPin | null): { unit: string | null; strata: string[] } {
  const d = contract?.design;
  if (!d || typeof d !== "object" || Array.isArray(d)) return { unit: null, strata: [] };
  const unit = typeof d.unit === "string" && d.unit ? d.unit : null;
  const strata = Array.isArray(d.blindingStrata) ? d.blindingStrata.filter((x): x is string => typeof x === "string" && !!x).sort() : [];
  return { unit, strata };
}

// ------------------------------------------------------------------ the investigation

export class Investigation {
  readonly machine: PhaseMachine;
  readonly policy: InvestigationPolicy;
  readonly #d: InvestigationDeps;
  readonly #id: string;
  /** Synthetic practice data the current pre-look dry-run executes (host self-check target). */
  #practiceUnderTest: DerivedData | null = null;

  constructor(readonly spec: InvestigationSpec, deps: InvestigationDeps) {
    if (!/^[A-Za-z0-9._:-]{1,120}$/.test(spec.id)) throw new TypeError("investigation id must match [A-Za-z0-9._:-]{1,120}");
    if (!spec.question?.trim()) throw new TypeError("an investigation needs a question");
    if (!spec.plainStatement?.trim()) throw new TypeError("an investigation needs a plain_statement");
    if (!path.isAbsolute(spec.dataset.dataRoot)) throw new TypeError("dataRoot must be absolute");
    const { hostRoot, shareRoot, workRoot } = deps.paths;
    const roots = [hostRoot, shareRoot, workRoot].map((p) => path.resolve(p));
    for (const a of roots) for (const b of roots) if (a !== b && (a.startsWith(b + path.sep) || b.startsWith(a + path.sep))) throw new Error("host, share and work roots must be disjoint");
    if (new Set(roots).size !== 3) throw new Error("host, share and work roots must be distinct");
    for (const r of deps.runtimeMounts ?? []) for (const root of roots) if (path.resolve(r).startsWith(root + path.sep) || root.startsWith(path.resolve(r) + path.sep) || path.resolve(r) === root) throw new Error("runtime mounts must not overlap host, share or work roots");
    this.#d = deps;
    this.#id = spec.id;
    this.policy = { ...DEFAULT_POLICY, ...deps.policy, triage:triageLimits(deps.policy?.triage) };
    this.machine = new PhaseMachine(deps.journal, `inv:${spec.id}`, deps.faultAt ?? (() => {}));
  }

  get id(): string { return this.#id; }

  /** Run (or resume) to the deliverable. Completed phases are replayed from the journal, not redone. */
  async run(): Promise<DeliverableOut> {
    try {
    const lastPause=this.machine.notes("paused").at(-1);
    if(lastPause&&!this.machine.notes("pause-resumed").some(n=>n.id===lastPause.id))this.machine.note("pause-resumed",{id:lastPause.id,phase:lastPause.phase});
    const parked = this.machine.notes("triage-parked").filter(n => !this.machine.notes("triage-resumed").some(r => r.id === n.id) && !this.machine.notes("plan-replanned").some(r => r.id === n.id)).at(-1);
    if (parked && !(await this.#replanBeforeLook(parked.id as string, parked.status as string, parked.reason as string))) return this.#parkedResult(new InvestigationParked(parked.status as ParkStatus, String(parked.id), String(parked.reason)));
    try { for (let due = this.machine.due(); due !== null; due = this.machine.due()) await this.step(due); }
    catch (error) {
      // Keep replan storage failures inside the outer transient-storage pause boundary.
      if (error instanceof InvestigationParked && await this.#replanBeforeLook(error.id, error.status, error.reason)) return this.run();
      throw error;
    }
    syncFalseAlarmLedger(this.machine.context("deliverable"),this.#host());
    return this.machine.output<DeliverableOut>("deliverable")!;
    } catch (e) {
      if (e instanceof LiteraturePayloadError) e = new InvestigationPaused("infra", e.message, this.machine.due() ?? "plan");
      if(!(e instanceof InvestigationPaused)&&transientStorageFault(e))e=new InvestigationPaused("infra","Transient host journal/storage fault",this.machine.due()??"stage");
      if(e instanceof InvestigationPaused){
      this.machine.note("paused",{id:`pause-${this.machine.notes("paused").length+1}`,kind:e.kind,reason:e.reason,phase:this.machine.due()??e.phase,retryAfterMs:e.retryAfterMs,at:this.#d.now(),hint:"infra"});
      syncFalseAlarmLedger(this.machine.context(this.machine.due()??e.phase),this.#host());
      return {next:this.machine.due(),terminal:null,outcome:null,status:"paused",claims:this.#retainedClaims(),dir:this.#host(),files:{}};
    } if (e instanceof InvestigationParked) return this.#parkedResult(e); throw e; }
  }

  async #replanBeforeLook(id: string, status: string, reason: string): Promise<boolean> {
    const scope = this.machine.due();
    if (status !== "plan-infeasible" || !scope || !["plan", "plan-lock", "code", "dry-run"].includes(scope) || this.machine.notes("plan-replanned").length >= 2 || !this.#d.ledger.authorizeReplan) return false;
    if (this.machine.notes("look-executing").length || (await this.#d.ledger.looks(this.#id)).length) return false;
    const reasonCode = replanReason(this.machine.notes("plan-infeasibility").find(n => n.id === id)?.classification);
    if (!reasonCode) return false;
    const amendment = { kind: "plan-amendment", reason: reasonCode, postExposure: this.machine.notes("practice-data-exposure").length > 0, scope, at: this.#d.now(), generation: this.machine.notes("plan-replanned").length + 1 };
    const receipt = await this.#d.ledger.authorizeReplan({ investigationId: this.#id, id, reason: JSON.stringify(amendment), scope: scope as "plan" | "plan-lock" | "code" | "dry-run" });
    if (!this.machine.notes("plan-amendment").some(n => n.id === id)) this.machine.note("plan-amendment", { id, ...amendment, receipt });
    if (amendment.postExposure && !this.machine.notes("label-cap").some(n => n.amendmentId === id)) this.machine.note("label-cap", { amendmentId: id, reason: "plan amended after practice-data exposure: exploratory ceiling", ceiling: "exploratory", hint: "true-catch" });
    // Persist exposure metadata and caps BEFORE the rewind: a crash after it must
    // never produce an uncapped plan generation or omit its deviation record.
    this.machine.replan(id, reasonCode, receipt);
    this.machine.note("triage-resumed", { id, reason: "Bounded pre-look replan", generation: this.machine.notes("plan-replanned").length });
    return true;
  }

  #retainedClaims():ClaimRecord[] {return this.machine.output<ReplicateOut>("replicate")?.claims??this.machine.output<CertifyOut>("certify")?.certification.claims??[];}

  async #parkedResult(e: InvestigationParked): Promise<DeliverableOut> {
    syncFalseAlarmLedger(this.machine.context(this.machine.due() ?? "stage"), this.#host());
    const result: DeliverableOut = { next: this.machine.due(), terminal: null, outcome: null, status:e.status, claims:this.#retainedClaims(), dir:this.#host(), files:{} };
    mkdirSync(this.#host(), {recursive:true,mode:0o700});
    const checkpoint={investigationId:this.#id,phase:this.machine.due(),lookLedger:await this.#d.ledger.looks(this.#id),planLockHash:this.machine.output<LockOut>("plan-lock")?.planHash??null,bundleHash:this.machine.notes("triage-parked").at(-1)?.bundleHash??null,rulebookVersion:"triage-2026-10-12-v2",historyHead:this.machine.head(),planAmendments:this.machine.notes("plan-amendment"),refusalHistory:this.machine.notes("refusal-observed"),appealHistory:this.machine.notes("appeal-filed")};
    const resumeToken=hashOf(checkpoint);
    writeFileSync(this.#host("triage-status.json"), JSON.stringify({...result, reason:e.reason, resumable:true,resumeToken,checkpoint}));
    return result;
  }

  /** Host/operator only: resume a parked phase after a concrete system fix. Never resets appeal or look budgets. */
  resumeAfterSystemFix(reason: string, resumeToken?:string): void {
    const saved=JSON.parse(readSmall(this.#host("triage-status.json"))??"null") as {resumeToken?:string;checkpoint?:unknown}|null;
    if(resumeToken!==undefined&&(!saved||saved.resumeToken!==resumeToken||hashOf(saved.checkpoint)!==resumeToken))throw new Error("Invalid resume token");
    if (!reason.trim()) throw new Error("A host repair reason is required");
    const parked = this.machine.notes("triage-parked").filter(n=>!this.machine.notes("triage-resumed").some(r=>r.id===n.id)).at(-1);
    if (!parked || parked.status !== "blocked-by-system-bug") throw new Error("No resumable system-bug park");
    this.machine.note("triage-resumed", {id:parked.id, phase:this.machine.due(), reason});
  }

  /** Run one named phase. Refused unless it is exactly the phase due now. */
  async step(phase: PhaseId): Promise<PhaseOutputBase> {
    await this.#d.beforePhase?.(phase);
    // Enforced from the journal before any input (or predecessor output) is read.
    this.machine.assertCanRun(phase);
    switch (phase) {
      case "question": return this.#question();
      case "stage": return this.#stage();
      case "plan": return this.#plan();
      case "plan-lock": return this.#planLock();
      case "code": return this.#code();
      case "dry-run": return this.#dryRun();
      case "freeze": return this.#freeze();
      case "look": return this.#look();
      case "certify": return this.#certify();
      case "replicate": return this.#replicate();
      case "interpret": return this.#interpret();
      case "deliverable": return this.#deliverable();
      default: throw new TransitionRefused(String(phase), "unknown phase");
    }
  }

  // -------------------------------------------------------------- paths

  #host(...parts: string[]): string { return path.join(this.#d.paths.hostRoot, SAFE(this.#id), ...(this.machine.notes("plan-replanned").length ? [`replan-${this.machine.notes("plan-replanned").length}`] : []), ...parts); }
  #share(...parts: string[]): string { return path.join(this.#d.paths.shareRoot, SAFE(this.#id), ...(this.machine.notes("plan-replanned").length ? [`replan-${this.machine.notes("plan-replanned").length}`] : []), ...parts); }
  #work(...parts: string[]): string { return path.join(this.#d.paths.workRoot, SAFE(this.#id), ...(this.machine.notes("plan-replanned").length ? [`replan-${this.machine.notes("plan-replanned").length}`] : []), ...parts); }

  #forbidden(staged: StagedData | null): string[] {
    const out = [this.#d.paths.hostRoot, this.spec.dataset.dataRoot];
    if (this.spec.independentDataset) out.push(this.spec.independentDataset.dataRoot);
    if (staged) {
      out.push(staged.realDataDir);
      if (staged.partition) out.push(staged.partition.heldOutDir);
    }
    return out;
  }

  #runtime(): Mount[] { return (this.#d.runtimeMounts ?? []).map((p) => ({ role: "runtime" as const, path: p })); }

  #out<T extends PhaseOutputBase>(phase: PhaseId): T {
    const o = this.machine.output<T>(phase);
    if (!o) throw new Error(`omb-investigate: ${phase} output missing`);
    return o;
  }

  // -------------------------------------------------------------- dispatch helpers

  #turnEnv(route: "P" | "H", staged: StagedData | null): TurnEnv {
    return {
      ...(this.#d.providers ? {providers:this.#d.providers} : {}),
      fleet: this.#d.fleet, workers: this.#d.workers, now: this.#d.now, promptDir: this.#host("prompts"), investigation: this.#id,
      quietGroup: this.policy.quietGroup, timeoutMs: this.policy.turnTimeoutMs, route, forbidden: this.#forbidden(staged),
      provenanceIsWarning: this.policy.provenanceIsWarning,
    };
  }

  async #appeal(ctx: StepContext, id: string, appeal: Appeal, refusal: RefusalRecord, lead: SessionRef | null, evidence: string, files: string[], route: "P" | "H", staged: StagedData | null, automatic=false, hostEvidence?: string): Promise<TriageAction> {
    const epoch=this.machine.notes("triage-resumed").length+this.machine.notes("pause-resumed").length+this.machine.notes("plan-replanned").length;
    const reviewId=`${id}/appeal-${epoch}`;
    let inventory:Record<string,string>={};
    try{if(lead)inventory=sourceInventory(lead.workdir);}
    catch(error){
      const denied=refusalRecord("code-policy",`Invalid source inventory: ${error instanceof Error?error.message:"linked or non-regular code"}`,refusal.phase);
      const action={kind:"feedback" as const,text:JSON.stringify(denied)};
      ctx.note("refusal-record",{id:reviewId,refusal:denied});ctx.note("appeal-remedy",{id:reviewId,...action});syncFalseAlarmLedger(ctx,this.#host());return action;
    }
    const lockedPlan=this.machine.output<PlanOut>("plan")?.lockedPlan;
    if(lockedPlan)inventory["plan.json"]=fileSha256(lockedPlan);
    const bundleHash=hashOf(inventory);
    return resolveAppeal({id:reviewId, ctx, hostDir:this.#host(), appeal, refusal, files, hardStop:null, automatic, limits:this.policy.triage, bundleHash, investigationId:this.#id,
      lookSpent:(await this.#d.ledger.looks(this.#id)).length>0,
      timeoutMs:this.#d.executor.timeoutBudget?.initialMs ?? this.policy.turnTimeoutMs, hardTimeoutMs:this.#d.executor.timeoutBudget?.hardCapMs ?? this.policy.turnTimeoutMs,
      validateInfeasibility:async()=>{
        if (!lockedPlan) return null;
        const st = this.machine.output<StageOut>("stage");
        const check = checkPlan(readSmall(lockedPlan), st?.contract ? contractRules(st.contract.design) : null, [], false);
        return classifyPlanIssues(check.issues.map(i => i.code));
      },
      revalidateDrop:async paths=>{
        if(!lead || refusal.phase!=="pre-look")return false;
        const locked=this.machine.output<PlanOut>("plan")?.lockedPlan;
        const dryData=this.machine.output<DryRunOut>("dry-run")?.synthetic;
        if(!locked || !staged)return false;
        const candidate=snapshotBundle(lead.workdir,this.#host("triage-bundles",SAFE(reviewId)),locked,samePlan,{keepDevFiles:true});
        const data=dryData??await this.#d.stager.synthesize({staged,seed:this.#seed("synthetic"),investigationId:this.#id,outcomes:this.#practiceOutcomes(),exposures:this.#practiceExposures()});
        if (await this.#verifyPractice(ctx, `${reviewId}/drop-practice`, data, "synthetic")) return false;
        return revalidateDevDrop(candidate,paths,async b=>{
          const r=await this.#d.executor.run({bundleDir:b.dir,dataDir:data.dir,outDir:this.#host("triage-validation",SAFE(reviewId)),mode:"dry-run",seed:this.#seed("dry-run")});
          if(r.hardStop)throw new HardStopObserved(r.hardStop);
          return r.status==="ok" ? true : r.category==="infra" || r.refusal?.decision==="guard-error" ? false : {repair:r.refusal??refusalRecord(r.category??"execution",r.errorText??"Analysis failed after dev-file removal.","pre-look")};
        });
      },
      reproduce:async()=>{
        if(!lead||!staged||refusal.phase!=="pre-look"||!lockedPlan)return false;
        const bundle=snapshotBundle(lead.workdir,this.#host("triage-reproduce",SAFE(reviewId)),lockedPlan,samePlan,{keepDevFiles:true});
        const data=await this.#d.stager.synthesize({staged,seed:this.#seed("synthetic"),investigationId:this.#id,outcomes:this.#practiceOutcomes(),exposures:this.#practiceExposures()});
        if (await this.#verifyPractice(ctx, `${reviewId}/reproduce-practice`, data, "synthetic")) return false;
        const r=await this.#d.executor.run({bundleDir:bundle.dir,dataDir:data.dir,outDir:this.#host("triage-reproduce-output",SAFE(reviewId)),mode:"dry-run",seed:this.#seed("dry-run")});
        if(r.hardStop)throw new HardStopObserved(r.hardStop);
        return r.status==="crash"&&r.refusal?.ruleId===refusal.ruleId&&r.refusal.trigger===refusal.trigger;
      },
      review:async a => (await standbyReview(this.#turnEnv(route,staged), {ctx,id:reviewId,appeal:a,refusal,files,evidence,worker:lead,workdir:this.#work(`standby-${SAFE(reviewId)}`),hashes:inventory,...(hostEvidence?{hostEvidence}:{}),feasibility:appeal.issueType === "plan-cannot-satisfy-rule" ? { task: this.spec.question, schema: staged ? readSmall(path.join(staged.schemaViewDir, "schema.json"), 20000) : null, planSource: lockedPlan ? "host-locked" : "worker-proposal", plan: readSmall(lockedPlan ?? path.join(lead?.workdir ?? this.#host(), "plan.json"), 20000), contract: this.machine.output<StageOut>("stage")?.contract?.design ?? null, registry: REGISTERED_DESIGNS } : {},code:lead&&refusal.location.path&&files.includes(refusal.location.path)?readSmall(path.join(lead.workdir,refusal.location.path),16000)??"":""})).verdict,
    });
  }

  async #turn(req: TurnRequest, route: "P" | "H", staged: StagedData | null): Promise<TurnResult> {
    const epoch=this.machine.notes("triage-resumed").length+this.machine.notes("pause-resumed").length+this.machine.notes("plan-replanned").length;
    if(epoch && !req.jobId.includes(`/triage-resume-${epoch}`)) req={...req,jobId:`${req.jobId}/triage-resume-${epoch}`};
    if (this.machine.notes("plan-replanned").length && req.fresh) req = { ...req, fresh: { ...req.fresh, workerJobId: `${req.fresh.workerJobId}:replan-${this.machine.notes("plan-replanned").length}` } };
    if (["plan-repair","dry-run-repair","look-repair"].includes(req.turn)&&!chargeRepair({id:req.jobId,ctx:req.ctx,hostDir:this.#host(),refusal:(req.ctx.notes("refusal-record").at(-1)?.refusal as unknown as RefusalRecord)??refusalRecord("execution","worker repair"),lookSpent:(await this.#d.ledger.looks(this.#id)).length>0,limits:this.policy.triage})) {
      this.#d.fleet.sched.submit({id:req.jobId,kind:req.kind,family:req.family,investigation:this.#id,maxAttempts:1});
      this.#d.fleet.sched.cancel(req.jobId,"Repair lineage limit reached; original rule feedback still applies.");
      return {ok:false,job:this.#d.fleet.sched.job(req.jobId)!,session:req.session??null,result:null,hardStop:null,warnings:["Repair lineage limit reached; fail the step normally."],filesPresent:false};
    }
    const blindPlanning = ["plan", "plan-repair"].includes(req.turn);
    const feedback=blindPlanning ? undefined : req.ctx.notes("appeal-remedy").filter(n=>n.kind==="feedback").at(-1);
    const postLook=(await this.#d.ledger.looks(this.#id)).length>0;
    const records=blindPlanning ? [] : collapsedRefusals(req.ctx.notes("refusal-record").map(n=>{const r=n.refusal as unknown as RefusalRecord;return postLook?refusalRecord(r.ruleId,"","post-look",r.decision):r;}));
    if(!postLook&&req.ctx.notes("warning").some(n=>n.kind==="executor-warning"&&String(n.detail).includes("sweep-survivor")))req={...req,prompt:req.prompt+"\nLeave no background processes; n_jobs=1."};
    if(feedback)req.ctx.note("appeal-feedback-delivered",{id:feedback.id});
    // Dataset values cease to be secret once supplied in an authorized mount. Keep that
    // fact across resumed turns; copying the development data is not evidence of a breach.
    const authorized=new Set(req.ctx.notes("data-canary-authorized").flatMap(n=>Array.isArray(n.hashes)?n.hashes as string[]:[]));
    if(staged){
      const newly=new Set<string>();
      try{for(const mount of req.mounts.filter(m=>m.role!=="runtime"))for(const c of await scanAuthorizedCanaries(mount.path,staged.canaries.filter(c=>!authorized.has(hashOf(c)))))newly.add(hashOf(c));}
      catch(error){throw new InvestigationPaused("infra",`Authorized canary inventory unavailable: ${String(error)}`,this.machine.due()??"code");}
      if(newly.size){req.ctx.note("data-canary-authorized",{jobId:req.jobId,hashes:[...newly].sort()});for(const h of newly)authorized.add(h);}
    }
    if (req.mounts.some(m => ["dev", "scrambled", "synthetic", "real"].includes(m.role))) req.ctx.note("practice-data-exposure", { jobId: req.jobId, phase: this.machine.due(), at: this.#d.now() });
    let result:TurnResult;
    try { result=await runTurn(this.#turnEnv(route,staged), {...req,prompt:req.prompt+(["plan-repair","dry-run-repair","look-repair"].includes(req.turn)?`\nFirst and latest refusals per rule:\n${JSON.stringify(records)}`:"")+(feedback ? `\nStandby reviewer feedback (advisory; all runtime rules remain):\n${feedback.text}` : "")});
    } catch(error) {
      if(!(error instanceof ProviderDisagreement))throw error;
      const refusal=refusalRecord("plan-lock","model disagreement",postLook?"post-look":"pre-look");
      await this.#appeal(req.ctx,req.jobId,{issueType:"other",evidence:["plan.json"],claim:"Model disputes the locked plan; owner review required"},refusal,req.session,error.outcome.text??"",[],route,staged);
      throw new InvestigationPaused("needs-you","Model disagreement has been routed to triage; review the closed verdict before resuming",this.machine.due()??"plan",0);
    }
    if(req.turn==="look-repair"&&!result.ok&&!result.hardStop){
      req.ctx.note("look-repair-retry",{jobId:req.jobId});
      result=await runTurn(this.#turnEnv(route,staged),{...req,jobId:`${req.jobId}/fresh-repair`,session:result.session??req.session,prompt:req.prompt+"\nThe previous repair turn was incomplete. Write ./run_all.sh and validate the required files. Diagnostics remain redacted."});
    }
    if (["code","dry-run-repair","look-repair","replicate"].includes(req.turn)) {
      const events=result.result?.eventsPath ? readSmall(result.result.eventsPath,2_000_000) : null;
      if(result.result?.eventsPath && events===null)req.ctx.note("warning",{kind:"assumption-scan-unavailable",detail:`Turn log unscanned (oversized or unreadable): ${req.turn}`});
      const evidence = [...result.warnings, ...(events===null?[]:[events])].join("\n");
      for (const signal of assumptionSignals(`turn:${req.turn}`,evidence)) if(!req.ctx.notes("assumption-signal").some(n=>hashOf(n.signal)===hashOf(signal))) req.ctx.note("assumption-signal",{signal});
    }
    if (result.hardStop || !result.session) return result;
    if (staged && scanForCanaries(result.session.workdir,staged.canaries.filter(c=>!authorized.has(hashOf(c)))).length) { req.ctx.note("routing",{event:"canary-exposed",class:"hard-stop",reason:`real-data canary found in ${req.turn} files`}); return {...result,hardStop:"canary-exposed"}; }
    if(readSmall(path.join(result.session.workdir,"turn-output.json"))?.includes('"appeal"')) { const receipt=path.join(result.session.workdir,"appeal-receipt.json");rmSync(receipt,{force:true});writeFileSync(receipt,JSON.stringify({receipt:APPEAL_RECEIPT}),{flag:"wx",mode:0o400}); }
    const appeal=readAppeal(result.session.workdir);
    const last=(req.ctx.notes("refusal-record").at(-1)?.refusal as unknown as RefusalRecord | undefined) ?? (appeal?.issueType === "plan-cannot-satisfy-rule" && ["plan", "code"].includes(req.turn) ? refusalRecord("plan-lock", "worker-requested-feasibility-review") : undefined);
    if (!appeal || !last || (!["plan-repair","dry-run-repair","look-repair"].includes(req.turn) && !(appeal.issueType === "plan-cannot-satisfy-rule" && ["plan", "code"].includes(req.turn) && !req.ctx.notes("look-executing").length))) return result;
    const post=(await this.#d.ledger.looks(this.#id)).length>0;
    const refusal=post ? refusalRecord(last.ruleId,"","post-look") : last;
    let files:string[]=[];try{files=Object.keys(sourceInventory(result.session.workdir));}catch{/* file inventory unavailable */}
    // An appeal that blames the practice data is checked by the host first. An upheld claim is a
    // host fault: no reviewer, no charge; the dry-run loop regenerates the data. A refuted claim
    // reaches the reviewer with the trusted self-check instead of an unverifiable assertion.
    let hostEvidence: string | undefined;
    if (!post && req.turn === "dry-run-repair" && this.#practiceUnderTest && practiceDataClaim(appeal.claim)) {
      req.ctx.note("practice-claim", { jobId: req.jobId, issueType: appeal.issueType, source: "worker-appeal" });
      const fault = await this.#verifyPractice(req.ctx, `${req.jobId}/practice-appeal`, this.#practiceUnderTest, "synthetic");
      if (fault) { req.ctx.note("appeal-upheld-by-host", { jobId: req.jobId, reason: fault }); return result; }
      hostEvidence = `Host self-check (rule ${PRACTICE_RULE}) re-verified the synthetic practice data the code ran on: it satisfies the served data structure (row keys, per-unit design levels, allowed levels, missingness and count bounds). The data-defect claim is refuted by the host.`;
    }
    const action=await this.#appeal(req.ctx,req.jobId,appeal,refusal,result.session,refusal.trigger,files,route,staged,false,hostEvidence);
    // Effects are host-owned decisions. Actual execution still passes every original guard.
    if(action.kind==="route-other-family") {
      return this.#turn({...req,jobId:`${req.jobId}/other-family`,family:{mode:"cross-family",producer:result.session.family},session:null,
        fresh:{workerJobId:`${req.fresh.workerJobId}:reroute`,workdir:this.#work(`reroute-${SAFE(req.jobId)}`)}},route,staged);
    }
    if(action.kind==="refused") req.ctx.note("appeal-refused",{jobId:req.jobId,reason:action.reason});
    return result;
  }

  /**
   * Trusted compute through the scheduler (kind rerun/stage/sim). The launcher journals its result
   * before the scheduler hears of it, so a restart reads the result instead of recomputing; a
   * result lost to a crash is recomputed under a new job id (compute here is idempotent).
   */
  async #compute<T>(ctx: StepContext, jobId: string, kind: "rerun" | "stage" | "sim", run: () => Promise<T>): Promise<T | null> {
    const epoch=this.machine.notes("triage-resumed").length+this.machine.notes("pause-resumed").length+this.machine.notes("plan-replanned").length;
    if(epoch) jobId += `/triage-resume-${epoch}`;
    for (let k = 1; k <= 5; k++) {
      const id = k === 1 ? jobId : `${jobId}~${k}`;
      const prior = ctx.notes("compute-result").find((n) => n.jobId === id);
      if (prior) {
        // Journaled just before a crash: the scheduler requeued the job on restart. Retire it so an
        // unclaimed dispatch never holds a slot.
        this.#retire(id, "result already journaled");
        return prior.payload as T;
      }
      const r = await this.#d.fleet.run({ id, kind, investigation: this.#id, ...(this.policy.quietGroup ? { quietGroup: this.policy.quietGroup } : {}) },
        computeLauncher(async () => { const payload = await run(); if(!(payload&&typeof payload==="object"&&(("category" in payload&&["infra","data-unreadable"].includes(String(payload.category)))||("refusal" in payload&&(payload.refusal as {decision?:string})?.decision==="guard-error"))&&!("hardStop" in payload&&payload.hardStop)))ctx.note("compute-result", { jobId: id, payload }); return payload; }));
      const after = ctx.notes("compute-result").find((n) => n.jobId === id);
      if (after) return after.payload as T;
      if (r.job.state !== "succeeded") return null;
      if(r.payloads.length)return r.payloads.at(-1) as T;
    }
    return null;
  }

  #retire(jobId: string, reason: string): void {
    const job = this.#d.fleet.sched.job(jobId);
    if (job && !isTerminal(job.state)) this.#d.fleet.sched.cancel(jobId, reason);
  }

  async #exec(ctx: StepContext, jobId: string, request: Parameters<ExecutorPort["run"]>[0]): Promise<ExecResult> {
    if (this.machine.notes("plan-replanned").length) jobId += `/replan-${this.machine.notes("plan-replanned").length}`;
    const r = await this.#compute(ctx, jobId, "rerun", async () => {
      mkdirSync(request.outDir, { recursive: true, mode: 0o700 });
      for (let infraAttempt=0;infraAttempt<3;infraAttempt++) {
        try {
          const extension=ctx.notes("appeal-remedy").find(n=>n.kind==="extend-timeout-once");
          const used=ctx.notes("timeout-extension-used").find(n=>n.id===extension?.id);
          const exception=ctx.notes("triage-exception").find(n=>n.id===extension?.id) as unknown as TriageException|undefined;
          const applicable=exception && exceptionApplies(exception,{investigationId:this.#id,bundleHash:treeHash(request.bundleDir),ruleId:"timeout",phase:(await this.#d.ledger.looks(this.#id)).length?"post-look":"pre-look",paths:[],ended:this.machine.due()===null,consumed:!!used&&used.jobId!==jobId});
          const timeoutMs=extension && applicable && (!used || used.jobId===jobId) ? Number(extension.timeoutMs) : undefined;
          if(timeoutMs && !used) ctx.note("timeout-extension-used",{id:extension!.id,jobId,timeoutMs});
          const result = await this.#d.executor.run({...request,...(timeoutMs ? {timeoutMs} : {})});
          if (result.status === "crash") {
            result.refusal = refusalRecord(result.hardStop ?? result.refusal?.ruleId ?? errorCategory(result.category), (request.mode==="dry-run"&&result.refusal?.ruleId==="execution"?result.errorText??result.refusal.trigger:result.refusal?.trigger??result.errorText??"execution unavailable"), request.mode === "dry-run" && !(await this.#d.ledger.looks(this.#id)).length ? "pre-look" : "post-look", result.refusal?.decision ?? (result.category === "infra" ? "guard-error" : "denied"));
            if(result.refusal.decision === "guard-error")ctx.note("warning",{kind:"executor-infrastructure",jobId,detail:result.errorText??"trusted executor unavailable"});
            ctx.note(result.refusal.decision === "guard-error" ? "guard-error" : "refusal-record", { jobId, refusal: result.refusal });
          }
          for(const warning of result.warnings??[])ctx.note("warning",{kind:"executor-warning",detail:warning});
          if(result.category==="infra"&&!result.hardStop&&infraAttempt<2){await this.#d.fleet.delay(1000*2**infraAttempt);continue;}
          if (result.hardStop) return result;
          if (result.refusal?.decision === "guard-error") return result;
          return result;
        }
        catch (e) {
          ctx.note("guard-error", { jobId, refusal: refusalRecord("infra", String((e as Error)?.message ?? e), request.mode === "dry-run" ? "pre-look" : "post-look", "guard-error") });
          ctx.note("warning", { kind: "executor-infrastructure", jobId, detail: String((e as Error)?.message ?? e) });
          if(infraAttempt<2){await this.#d.fleet.delay(1000*2**infraAttempt);continue;}
          return {status:"crash",category:"infra",errorText:String((e as Error)?.message??e),outputsHash:null,files:[],refusal:refusalRecord("infra","trusted executor unavailable",request.mode==="dry-run"?"pre-look":"post-look","guard-error")} satisfies ExecResult;
        }
      }
      throw new InvestigationPaused("infra","Executor retry bound reached",this.machine.due()??"dry-run");
    });
    const result:ExecResult = r ?? { status: "crash", category: "infra", errorText: String(ctx.notes("warning").filter(n => n.kind === "executor-infrastructure" && n.jobId === jobId).at(-1)?.detail ?? "compute job did not run"), outputsHash: null, files: [] };
    if(result.kind==="data-unreadable"||result.category==="data-unreadable")throw new InvestigationPaused("system-bug","Host data unreadable; repair the parser or staged inputs",this.machine.due()??"dry-run");
    if(result.status==="crash"&&result.category==="infra"&&!result.hardStop)throw new InvestigationPaused("infra",request.mode==="dry-run"?result.errorText??"Executor unavailable":"Trusted executor unavailable after look; prior charge retained",this.machine.due()??"dry-run");
    if(result.refusal?.decision==="guard-error"&&!result.hardStop)throw new InvestigationPaused("system-bug","Trusted guard unavailable; host repair required",this.machine.due()??"dry-run");
    return result;
  }

  async #guardData<T>(ctx:StepContext, name:string, run:()=>Promise<T>, ruleId="staging"):Promise<T> {
    try{return await run();}catch(e){
      if(e instanceof CodePolicyError&&e.refusal.decision!=="guard-error"||e instanceof TrustedPathChanged||e instanceof HardStopObserved||e instanceof PracticeStructureError)throw e;
      const id=`${this.#id}/guard/${name}/${this.machine.notes("triage-resumed").length}`;
      const lookSpent=(await this.#d.ledger.looks(this.#id)).length>0;
      const refusal=refusalRecord(ruleId,String((e as Error)?.message??e),lookSpent?"post-look":"pre-look","guard-error");
      ctx.note("guard-error",{id,refusal});ctx.note("system-bug-ticket",{id,ruleId:refusal.ruleId,trigger:refusal.trigger,source:"guard-error",reproduced:true});
      throw new InvestigationPaused("infra",refusal.trigger,this.machine.due()??"stage");
    }
  }

  /**
   * Practice data comes from a host stager; workers only ever see it. Generate it and run the
   * host self-check (journaled) before any worker code touches it. A generator that cannot keep
   * the real structure, or data that fails the check, is a HOST fault: the caller ends the
   * investigation as `infrastructure` (never look-withheld, never a charged repair).
   */
  async #practice(ctx: StepContext, step: string, kind: "scramble" | "synthetic", input: Record<string, unknown>, make: () => Promise<DerivedData>): Promise<{ data: DerivedData | null; fault: string | null }> {
    const made = await ctx.step(step, input, async () => {
      try { return await this.#guardData(ctx, kind === "scramble" ? "scramble" : "synthesize", make); }
      catch (e) { if (e instanceof PracticeStructureError) return { practiceFault: e.message }; throw e; }
    });
    if ("practiceFault" in made) return { data: null, fault: this.#practiceFaultNote(ctx, kind, step, [{ file: "*", check: "generation", detail: String(made.practiceFault) }]) };
    return { data: made, fault: await this.#verifyPractice(ctx, `verify-${step}`, made, kind) };
  }

  #checkLateralAvailability(turn: TurnResult): void {
    if (turn.ok) return;
    const status = turn.result?.status;
    if (!status || ['provider-error', 'infra_error', 'timeout', 'rate_limited', 'needs_resume'].includes(status)) {
      throw new InvestigationPaused(status === 'rate_limited' ? 'quota' : status === 'infra_error' ? 'infra' : 'provider', 'Lateral turn temporarily unavailable', 'plan');
    }
  }

  #practiceExposures(): string[] {
    return [...new Set(this.#out<PlanOut>("plan").claims.map(c => c.exposure).filter((x): x is string => !!x))].sort();
  }

  #practiceOutcomes(): string[] {
    return [...new Set(this.#out<PlanOut>("plan").claims.map(c => c.outcome).filter((x): x is string => !!x))].sort();
  }

  async #verifyPractice(ctx: StepContext, step: string, data: DerivedData, kind: "scramble" | "synthetic"): Promise<string | null> {
    const staged = this.#out<StageOut>("stage").staged!, stager = this.#d.stager;
    if (!stager.verifyPractice) return null;
    const check = await ctx.step(step, { data: data.hash, kind, rule: PRACTICE_RULE }, async (): Promise<PracticeCheck> => {
      try { return await stager.verifyPractice!({ staged, data, kind, outcomes: this.#practiceOutcomes(), exposures: this.#practiceExposures() }); }
      catch (e) { if (e instanceof HardStopObserved) throw e; return { ok: false, rule: PRACTICE_RULE, kind, tables: 0, violations: [{ file: "*", check: "self-check", detail: `host self-check unavailable: ${String((e as Error)?.message ?? e)}` }] }; }
    });
    ctx.note("practice-check", { step, kind, data: data.hash, ok: check.ok, rule: check.rule, tables: check.tables, violations: check.violations.slice(0, 20) });
    return check.ok ? null : this.#practiceFaultNote(ctx, kind, step, check.violations);
  }

  #practiceFaultNote(ctx: StepContext, kind: "scramble" | "synthetic", step: string, violations: PracticeCheck["violations"]): string {
    const detail = violations.slice(0, 4).map(v => `${v.file} ${v.check}: ${v.detail}`).join("; ");
    const id = `${this.#id}/practice/${step}`;
    if (!ctx.notes("system-bug-ticket").some(n => n.id === id)) ctx.note("system-bug-ticket", { id, ruleId: "practice-structure", trigger: detail, source: "practice-self-check", reproduced: true });
    return `${kind === "synthetic" ? "synthetic dry-run" : "scrambled development"} practice data violates the served data structure (${detail}); host fault, not charged to the worker; the look stays unspent`;
  }

  #seed(purpose: string, extra: { planLockHash?: string; frozenCodeHash?: string } = {}): string {
    const staged = this.machine.output<StageOut>("stage")?.staged ?? null;
    const tuple: Partial<ContentTuple> = { dataHash: staged?.manifestHash ?? "", contractHash: staged?.contractHash ?? "" };
    if (extra.planLockHash) tuple.planLockHash = extra.planLockHash;
    if (extra.frozenCodeHash) tuple.frozenCodeHash = extra.frozenCodeHash;
    return this.#d.ledger.seed(tuple, `${purpose}:${this.#id}`);
  }

  // -------------------------------------------------------------- 1. question

  #question(): Promise<QuestionOut> {
    const s = this.spec;
    const prompt = s.taskPromptFile ? readSmall(s.taskPromptFile, 2_000_000) : null;
    const input = {
      question: s.question.trim(), plainStatement: s.plainStatement.trim(), datasetId: s.dataset.datasetId, route: s.route,
      independent: s.independentDataset?.datasetId ?? null, program: s.program ?? null, taskPromptHash: prompt === null ? null : hashOf(prompt),
    };
    return this.machine.phase("question", input, async () => ({ next: "stage", terminal: null, ...input }));
  }

  // -------------------------------------------------------------- 2. stage (software, before any model turn)

  #stage(): Promise<StageOut> {
    const q = this.#out<QuestionOut>("question");
    return this.machine.phase("stage", { expected: this.spec.dataset.expectedManifestHash ?? null }, async (ctx) => {
      const fail = (reason: string, preflight: string[] = []): StageOut => {
        ctx.note("refusal-record", { refusal: refusalRecord("staging", reason) });
        return ({
        ...terminal("stage", "preflight-failed", reason), staged: null, contract: null, route: q.route, routeReasons: [], taskFile: null, preflight, separation: NO_SEPARATION,
      }); };
      const failing = await ctx.step("preflight", {}, async () => {
        let failures:string[];try{failures=this.#d.preflight?await this.#d.preflight.check({investigationId:this.#id,datasetId:q.datasetId}):[];}catch(e){throw new InvestigationPaused("infra",String(e),"stage");}
        if(failures.some(k=>!["cli-missing","data-terms-refused"].includes(k)))throw new InvestigationPaused("infra",failures.join(", "),"stage");return failures;
      });
      if (failing.length) {
        const routes = failing.map((kind) => routeFailure({ kind, afterFirstModelTurn: false }));
        return fail(`preflight failed before any model turn: ${failing.join(", ")} (${routes[0]!.reason})`, failing);
      }
      // OS-user separation, recorded once: cert-launch attestation (never the host flag alone).
      const separation = await ctx.step("os-attestation", { host: this.#d.host.osUserSeparation }, async () => this.#attest());
      // The task's host contract (K1a/K1b): pinned by the host index, before any model turn.
      const contract = await ctx.step("contract", {}, async (): Promise<ContractPin | null | { refused: string }> => {
        if (!this.#d.contracts) return null;
        try { return await this.#d.contracts.pin({ datasetId: q.datasetId, dataRoot: this.spec.dataset.dataRoot }); }
        catch (e) { if (e instanceof ContractPinRefused) return { refused: e.message }; throw new InvestigationPaused("infra",String(e),"stage"); }
      });
      if (contract && "refused" in contract) return fail(`${contract.refused} (before any model turn; nothing lost)`);
      const publicText = q.taskPromptHash && this.spec.taskPromptFile ? readSmall(this.spec.taskPromptFile, 2_000_000) ?? "" : "";
      let staged = await ctx.step("stage", { contract }, async (): Promise<StagedData | { error: string }> => {
        try {
          return await this.#d.stager.stage({ investigationId: this.#id, datasetId: q.datasetId, dataRoot: this.spec.dataset.dataRoot, expectedManifestHash: this.spec.dataset.expectedManifestHash ?? null, contract, route: q.route, publicText: `${q.question}\n${q.plainStatement}\n${publicText}` });
        } catch (e) { if(e instanceof StagerRefusal){ctx.note("refusal-record",{refusal:refusalRecord("staging",e.message)});return {error:e.message};}ctx.note("guard-error",{refusal:refusalRecord("staging",String(e),"pre-look","guard-error")});throw new InvestigationPaused("infra",String((e as Error)?.message??e),"stage"); }
      });
      if ("error" in staged) return fail(`staging refused: ${staged.error}`);
      for(const detail of staged.warnings)ctx.note("warning",{kind:"staged-data",detail});
      if (contract) {
        // K1b byte verification of the pinned contract on the host-only contract input. A contract that
        // does not verify could never certify a claim: stop before any model turn (nothing lost).
        if (!staged.contractInput) return fail("the stager produced no contract input for the pinned contract (before any model turn; nothing lost)");
        const check = await ctx.step("contract-verify", { contract: contract.expectedContractHash, input: staged.contractInput.manifestHash }, async () => verifyPinnedContract(contract, staged.contractInput!.dir,this.#d.contractVerification));
        if (!check.ok) {ctx.note("contract-unverified",{code:check.code,contractHash:contract.expectedContractHash});ctx.note("label-cap",{reason:`contract check failed: ${check.code}`,cap:"insufficient-evidence",hint:"true-catch"});}
        if(check.ok)ctx.note("info", { kind: "contract-verified", detail: `contract ${contract.expectedContractHash} verified on ${check.tables} table(s); ${contract.approval ? `approved by ${contract.approval.actor} (${contract.approval.status})` : "not approved: certification cannot authenticate it (G1a not passed)"}` });
      }
      const expected = this.spec.dataset.expectedManifestHash;
      if (expected && staged.manifestHash !== expected) return fail("the raw manifest differs from the host pin (before any model turn; nothing lost)");
      if (staged.canaries.length === 0) ctx.note("warning", { kind: "canaries-unavailable", detail: "no data canaries: the plan-turn read check relies on the sandbox mount policy alone" });
      let route: "P" | "H" = "P";
      const routeReasons: string[] = [];
      if (q.route === "H") {
        const offer = routeHOffer({ effectiveUnits: staged.effectiveUnits ?? 0, predictedConfirmPower: staged.predictedConfirmPower, sealerAvailable: separation.separated && staged.partition !== null });
        if (offer.offered) {if(!this.#d.confirmation)throw new InvestigationPaused("infra","attested confirmation port unavailable","stage");route = "H";}
        else routeReasons.push(...offer.reasons.map((r) => `route H not offered: ${r}; using route P`));
      }
      let taskFile: string | null = null;
      if (this.spec.taskPromptFile && q.taskPromptHash) {
        taskFile = await ctx.step("task", { hash: q.taskPromptHash }, async () => {
          const dest = this.#share("task", "TASK.md");
          mkdirSync(path.dirname(dest), { recursive: true });
          try{copyFileSync(this.spec.taskPromptFile!, dest);}catch(e){throw new InvestigationPaused("infra",String(e),"stage");}
          return dest;
        });
      }
      return { next: "plan", terminal: null, staged, contract, route, routeReasons, taskFile, preflight: [], separation };
    });
  }

  async #attest(): Promise<Separation> {
    if (!this.#d.attestation) return { separated: false, attested: false, attestation: null, reason: "no OS attestation port: degraded single-user mode (Confirmed requires an attested _ombcert/_ombrun launcher)" };
    let r;
    try { r = await this.#d.attestation.attest(); }
    catch (e) { return { separated: false, attested: false, attestation: null, reason: `OS attestation failed: ${String((e as Error)?.message ?? e).slice(0, 200)}` }; }
    if (!r.attested) return { separated: false, attested: false, attestation: null, reason: r.reason };
    if (!this.#d.host.osUserSeparation) {
      return { separated: false, attested: true, attestation: r.attestation, reason: `launcher attested (release ${r.attestation.releaseHash.slice(0, 12)}), but this host's execution path does not run worker code under it (route P executes in the owner account): degraded` };
    }
    return { separated: true, attested: true, attestation: r.attestation, reason: `OS-user separation attested by cert-launch (release ${r.attestation.releaseHash.slice(0, 12)}); worker code runs as _ombrun` };
  }

  /** Degraded unless the stage phase established OS-user separation (attested and wired). */
  #degraded(): boolean {
    return this.machine.output<StageOut>("stage")?.separation?.separated !== true;
  }

  // -------------------------------------------------------------- 3. plan turn (schema view only)

  #planInput(): { pi: PlanPromptInput; st: StageOut; staged: StagedData } {
    const q = this.#out<QuestionOut>("question"), st = this.#out<StageOut>("stage");
    const staged = st.staged!;
    return {
      st, staged,
pi: { nativeConfirmation: this.#d.host.nativeConfirmation ?? false, id: this.#id, question: q.question + (this.machine.notes("plan-replanned").length ? blindReplanPrompt(this.machine.notes("plan-replanned").at(-1)!.reason) : ""), plainStatement: q.plainStatement, taskFile: st.taskFile, schemaViewDir: staged.schemaViewDir, devDir: null,
        contract: st.contract ? contractRules(st.contract.design) : null, designs: REGISTERED_DESIGNS },
    };
  }

  #plan(): Promise<PlanOut> {
    return this.machine.phase("plan", { rounds: this.policy.planRepairRounds }, async (ctx) => {
      const { pi, st, staged } = this.#planInput();
      const literature = new BriefLedger(this.#d.ledger.literatureJournal ?? this.#d.journal, this.#id);
      const mode = this.spec.taskPromptFile ? 'benchmark' : this.spec.literatureMode ?? 'one-shot';
      const brief = await ctx.step('literature-before-plan', { mode, question: pi.question }, async () => {
        const prior = literature.frozen();
        if (prior) { if (prior.mode !== mode) throw new Error('literature mode changed'); return prior; }
        if (!searchEnabled(mode)) return literature.freeze(emptyBrief(this.#id, mode));
        if (!this.#d.literature) throw new InvestigationPaused('provider', 'Dedicated literature port is required for discovery/ALS', 'plan');
        const result = await this.#d.literature.prepare({ investigationId: this.#id, question: pi.question, datasetId: staged.datasetId, mode });
        if (result.mode !== mode) throw new Error('literature port returned wrong mode');
        return literature.freeze(result);
      });
      const briefPrompt = `\nFrozen literature context (planning only; never analysis data): ${JSON.stringify(brief)}\nPublic dataset availability: ${JSON.stringify(brief.datasets)}`;

      const mounts: Mount[] = [
        ...(st.taskFile ? [{ role: "task" as const, path: path.dirname(st.taskFile) }] : []),
        { role: "schema", path: staged.schemaViewDir },
        ...this.#runtime(),
      ];
      const empty = { lead: null, lockedPlan: null, planBytesHash: null, planHash: null, plainStatement: null, paperSet: [], confirmatory: [], claims: [], issues: [], warnings: [] };
      let lead: SessionRef | null = null;
      let check = null as ReturnType<typeof checkPlan> | null;
      let rounds = 0;
      let previousIssues = new Set<string>();
      for (let round = 0; round <= this.policy.planRepairRounds; round++) {
        const turn = await this.#turn({
          ctx, jobId: round === 0 ? `${this.#id}/plan/turn` : `${this.#id}/plan/repair-${round}`, kind: "plan", turn: round === 0 ? "plan" : "plan-repair",
          family: { mode: "any" }, session: lead, fresh: { workerJobId: `${this.#id}:lead`, workdir: this.#work("lead") },
          mounts, prompt: (round === 0 ? planPrompt(pi) : planRepairPrompt(pi, repairMessage(check!.issues))) + briefPrompt, expect: [{ file: "plan.json", schema: "omb-plan", required: true }],
        }, st.route, staged);
        if (turn.session) lead = turn.session;
        if (turn.hardStop) return { ...terminal("plan", "hard-stop", `${turn.hardStop} observed during the plan turn`, turn.hardStop), ...empty, lead, repairRounds: round };
        // Positive evidence that the plan turn read the data: real-data canaries in its files.
        const leaked = lead ? scanForCanaries(lead.workdir, staged.canaries) : [];
        if (leaked.length) {
          const r = routeFailure({ kind: "canary-exposed", positiveEvidence: true, afterFirstModelTurn: true });
          ctx.note("routing", { event: "canary-exposed", class: r.class, reason: "real-data values found in the plan turn's files", count: leaked.length });
          return { ...terminal("plan", "hard-stop", "the plan turn's files contain real-data values it was never shown (route P's schema-only fact broken)", "canary-exposed"), ...empty, lead, repairRounds: round };
        }
        for (const w of turn.warnings) if (/denied|not permitted/i.test(w)) ctx.note("warning", { kind: "canary-denied", detail: "a read outside the mounted paths was denied (containment worked)" });
        const infra = infrastructureFailure(turn, ["plan.json"]);
        if (infra) return { ...terminal("plan", "infrastructure", `plan turn: ${infra}; infrastructure, not a science result`), ...empty, lead, repairRounds: round };
        if (!turn.ok && !lead) throw new InvestigationPaused("provider","plan.json is missing; model turn unavailable","plan");
        if (!turn.ok) usableAfterFailure(turn, ctx);
        check = checkPlan(lead ? readSmall(path.join(lead.workdir, "plan.json")) : null, st.contract ? contractRules(st.contract.design) : null);
        if (check.plan) {
          const registryAssumptions = (await Promise.all(check.plan.claims.map(c => (this.#d.procedures ?? new RegistryProcedures()).resolve({claim:c})))).flatMap(r => r.assumptions ?? []);
          check = checkPlan(lead ? readSmall(path.join(lead.workdir, "plan.json")) : null, st.contract ? contractRules(st.contract.design) : null, registryAssumptions);
        }
        rounds = round;
        if (check.status === "accepted") break;
        const signatures = new Set(check.issues.map(i => JSON.stringify([i.code, i.path])));
        const repeated = [...signatures].filter(s => previousIssues.has(s));
        previousIssues = signatures;
        const { id: _genericId, ...baseRefusal } = refusalRecord("plan-lock", repairMessage(check.issues));
        const specific = { ...baseRefusal, allowed: [...new Set(check.issues.flatMap(i => i.allowed ?? planAlternatives(i.code, i.path)))] };
        const refusal = { ...specific, id: hashOf(specific) };
        ctx.note("refusal-record", { refusal });
        // Missing/unparseable artifacts are provider/worker availability, not an
        // infeasible scientific plan. The host already supplies omitted context.
        const infeasible = repeated.filter(key => {
          const [code, field] = JSON.parse(key) as [string, string];
          return !["missing-file", "invalid-file"].includes(code) && !(code === "missing-field" && field === "$.plain_statement");
        });
        if (repeated.length && !infeasible.length) break;
        if (infeasible.length) {
          const id = `${this.#id}/plan/replan-${this.machine.notes("plan-replanned").length}/repeated-plan-refusal-${round}`;
          const classification = classifyPlanIssues(check.issues.map(i => i.code));
          if (!classification) break; // Repetition is not proof that a plan is infeasible.
          ctx.note("plan-infeasibility", { id, classification, source: "host-plan-check" });
          parkTriage({ id, ctx, hostDir: this.#host(), refusal, lookSpent: false }, "plan-infeasible", classification);
        }
      }
      if (!check || check.plan === null) throw new InvestigationPaused("provider",`plan.json remains missing or invalid after ${rounds} repair round(s); resume with repair feedback`,"plan");
      for (const advisory of check.advisories ?? []) {
        ctx.note("deviation", {kind:"plan-assumption-advisory",path:advisory.path,detail:advisory.message});
        ctx.note("assumption-signal", {signal:{source:`plan:${advisory.path}`,evidence:advisory.evidence ?? advisory.message,trusted:false}});
      }
      if (check.issues.some(i => i.path === '$.ideation')) throw new InvestigationPaused('provider', 'Ideation breadth/prior knowledge gate failed; no plan lock permitted', 'plan');
      const ideation = check.ideation;
      if (!ideation) throw new InvestigationPaused('system-bug', 'Validated plan has no ideation snapshot', 'plan');
      const lateralWarnings = await ctx.step('lateral-review-and-score', { ideation, briefHash: brief.sha256 }, async () => {
        try {
        const review = await this.#turn({ ctx, jobId: `${this.#id}/plan/lateral`, kind: 'plan', turn: 'lateral-review',
          family: { mode: 'cross-family', producer: lead!.family }, session: null,
          fresh: { workerJobId: `${this.#id}:lateral`, workdir: this.#work('lateral') }, mounts: [{ role: 'schema', path: staged.schemaViewDir }],
          prompt: `OMB-PHASE: lateral-review\nQuestion: ${pi.question}\nCandidates: ${JSON.stringify(ideation.candidates)}\nSchema: ${staged.schemaViewDir}\nWhat angle, confounder, subgroup, dataset or mechanism is missing? Write lateral.json as {suggestions: [{id, suggestion}]}; an empty list is allowed.`,
          expect: [{ file: 'lateral.json', schema: 'omb-json', required: true }],
        }, st.route, staged);
        if (review.hardStop) throw new HardStopObserved(review.hardStop);
        this.#checkLateralAvailability(review);
        if (!review.ok || !review.session) throw new LiteraturePayloadError('lateral reviewer content unavailable');
        const checked = lateralSuggestions(readSmall(path.join(review.session.workdir, 'lateral.json')));
        if (!checked.ok) throw new LiteraturePayloadError(checked.error);
        const suggestions = checked.value;
        let decisions: LateralDecision[] = [];
        if (suggestions.length) {
          let feedback = '';
          for (let attempt = 0; attempt < 2; attempt++) {
            const response = await this.#turn({ ctx, jobId: `${this.#id}/plan/lateral-response${attempt ? '-repair' : ''}`, kind: 'plan', turn: 'lateral-response',
              family: { mode: 'exactly', family: lead!.family }, session: null, fresh: { workerJobId: `${this.#id}:lateral-response:${attempt}`, workdir: this.#work(`lateral-response-${attempt}`) },
              mounts: [{ role: 'schema', path: staged.schemaViewDir }],
              prompt: `OMB-PHASE: lateral-response\nQuestion: ${pi.question}\nCandidates: ${JSON.stringify(ideation.candidates)}\nSuggestions: ${JSON.stringify(suggestions)}\nAccept each as an exploratory next-run item or reject with a reason. Write decisions.json as {decisions: [{id, disposition: "exploratory"|"rejected", reason}]}.\nExactly one decision per valid id: ${JSON.stringify(suggestions.map(s => s.id))}. Copy these ids verbatim; never use list indices. No unplanned claims. ${feedback}`,
              expect: [{ file: 'decisions.json', schema: 'omb-json', required: true }],
            }, st.route, staged);
            if (response.hardStop) throw new HardStopObserved(response.hardStop);
            this.#checkLateralAvailability(response);
            const parsed = lateralDecisions(response.session ? readSmall(path.join(response.session.workdir, 'decisions.json')) : null, suggestions);
            if (parsed.ok) {
              decisions = parsed.value;
              for (const normalization of parsed.normalizations) ctx.note('lateral-id-normalized', { attempt, ...normalization });
              break;
            }
            ctx.note('lateral-dispositions-invalid', { attempt, detail: parsed.error, validIds: suggestions.map(s => s.id) });
            if (attempt === 1) throw new LiteraturePayloadError(parsed.error);
            feedback = `Repair the previous invalid response: ${parsed.error}. This is the only repair turn.`;
          }
        }
        // Record the validated pair first, then use a guarded join (never assert a worker id exists).
        recordIdeation(literature, ideation, brief.datasets, { family: review.session.family, leadFamily: lead!.family, sameFamilyReason: null, suggestions, decisions });
        for (const suggestion of suggestions) if (decisions.some(d => d.id === suggestion.id && d.disposition === 'exploratory')) recordIdea(literature, { idea: suggestion.suggestion, angle: 'alternative-mechanism', evidenceSeen: ['schema-only lateral review'], dataNeeded: ['new pre-registered run on independent data'], priority: 3 }, !searchEnabled(mode));
        return [] as string[];
        } catch (error) {
          // Only advisory failures are optional. Host journal/scheduler faults must retain crash/resume semantics.
          if (!(error instanceof LiteraturePayloadError)) throw error;
          const warning = 'lateral dispositions invalid; exploratory ideas not recorded';
          ctx.note('warning', { kind: 'lateral-dispositions-invalid', detail: warning, reason: String(error) });
          return [warning];
        }
      });
      const warnings = [...check.warnings, ...lateralWarnings];
      if (check.status !== "accepted") warnings.push(`plan locked with unresolved issues after ${rounds} repair round(s): ${check.issues.map((i) => i.code).join(", ")}`);
      const plainStatement = check.plainStatement ?? this.#out<QuestionOut>("question").plainStatement;
      if (!check.plainStatement) warnings.push("plan.json has no plain_statement: the question's plain statement is locked instead");
      // The locked paper set names locked claims only (an unresolved unknown id is dropped with a warning).
      const known = check.paperSet.filter((id) => check.plan!.claims.some((c) => c.id === id));
      if (known.length !== check.paperSet.length) warnings.push("paper_set named claims outside the locked plan; they were dropped");
      const paperSet = known.length ? known : [...check.confirmatory].sort();
      // The kernel's plan carries the locked context (L4 payload): certifyDirectory hard-stops a
      // locked plan without plain_statement and paper_set, and the lock hash covers both.
      const locked = await ctx.step("copy-plan", { planHash: check.planHash, plainStatement, paperSet }, async () => {
        const dest = this.#host("locked", "plan.json");
        mkdirSync(path.dirname(dest), { recursive: true, mode: 0o700 });
        const text = kernelPlanText(readFileSync(path.join(lead!.workdir, "plan.json"), "utf8"), { plainStatement, paperSet, registryDecisions:check!.registryDecisions ?? [] });
        if (text === null) return null;
        rmSync(dest, { force: true }); // a read-only leftover from an interrupted attempt
        writeFileSync(dest, text, { mode: 0o400 });
        const kernel = parsePlan(text).plan;
        return kernel ? { file: dest, planHash: planLockHash(kernel) } : null;
      });
      if (!locked) throw new InvestigationPaused("system-bug","plan.json could not be reduced to a kernel plan","plan");
      const lockedPlan = locked.file;
      const plan = parsePlan(readFileSync(lockedPlan, "utf8")).plan!;
      return {
        literatureBrief: brief, next: "plan-lock", terminal: null, lead, lockedPlan, planBytesHash: fileSha256(lockedPlan), planHash: locked.planHash, plainStatement, paperSet,
        confirmatory: check.confirmatory,
        claims: plan.claims.map((c) => ({ id: c.id, kind: c.kind, estimand: c.estimand, exposure: c.exposure, outcome: c.outcome, unit: c.unit, adjustment: [...c.adjustment], strata: [...c.strata], test: c.test, direction: c.direction, mei: c.mei, exploratory: c.exploratory })),
        repairRounds: rounds, issues: check.issues.map((i) => `${i.code} ${i.path}`), warnings,
      };
    });
  }

  // -------------------------------------------------------------- 3b. plan lock

  #planLock(): Promise<LockOut> {
    return this.machine.phase("plan-lock", {}, async (ctx) => {
      const p = this.#out<PlanOut>("plan"), st = this.#out<StageOut>("stage"), staged = st.staged!;
      // The registered procedure each locked claim will be certified with (K2b registry): selected by
      // the locked estimand and design only, recorded in the lock. No match stays Tentative by design.
      const procedures: Record<string, ProcedureResolution> = {};
      const lockedRule = parsePlan(readFileSync(p.lockedPlan!, "utf8")).plan!;
      const procedurePort = this.#d.procedures ?? new RegistryProcedures();
      for (const c of lockedRule.claims) {
        procedures[c.id] = await ctx.step(`procedure:${c.id}`, { planHash: p.planHash, claim: c.id }, async () => procedurePort.resolve({ claim: c }));
      }
      for(const spec of colocPlanSpecs(lockedRule.sharedKnobs))procedures[`procedure:${spec.id}`]={procedureId:COLOC_REGISTRATION.procedureId,registryVersion:COLOC_REGISTRATION.registryVersion,registryHash:COLOC_REGISTRY_HASH,design:'coloc',reason:'locked coloc source and settings binding',assumptions:COLOC_REGISTRATION.assumptions};
      for(const spec of tiercPlanSpecs(lockedRule.sharedKnobs)){const r=TIERC_REGISTRATIONS[spec.kind];procedures[`procedure:${spec.id}`]={procedureId:r.procedureId,registryVersion:r.registryVersion,registryHash:tiercRegistryHash(spec.kind),design:r.design,reason:'locked Tier C sources and settings',assumptions:r.assumptions};}
      const assumptionCheck = checkPlan(readFileSync(p.lockedPlan!, "utf8"), null, Object.values(procedures).flatMap(r => r.assumptions ?? []), false);
      ctx.note("registry-decisions", {rules:assumptionCheck.registryDecisions ?? []});
      // G6: every confirmatory decision rule is a hypothesis on this manifest (idempotent registration).
      const registered = await ctx.step("register", { claims: p.claims, manifest: staged.manifestHash }, async () => {
        const ordinals: Record<string, number> = {}, fingerprints: Record<string, string> = {};
        for (const c of p.claims.filter((x) => !x.exploratory && x.exposure && x.outcome)) {
          const fp = decisionFingerprint({ exposure: c.exposure!, outcome: c.outcome!, unit: c.unit ?? "row", adjustment: c.adjustment, strata: c.strata, test: c.test ?? c.estimand ?? c.kind, direction: c.direction, manifest: staged.manifestHash });
          fingerprints[c.id] = fp;
          ordinals[c.id] = this.#d.registry.register({ manifest: staged.manifestHash, fingerprint: fp, source: { investigationId: this.#id, claimId: c.id, program: this.spec.program?.programId ?? null } }).ordinal;
        }
        return { ordinals, fingerprints };
      });
      const approval = await ctx.step("approval", { planHash: p.planHash }, async () => (this.#d.approval
        ? await this.#d.approval.approve({ investigationId: this.#id, planHash: p.planHash!, plainStatement: p.plainStatement!, paperSet: p.paperSet })
        : { actor: "policy" as const }));
      const literatureBrief = new BriefLedger(this.#d.ledger.literatureJournal ?? this.#d.journal, this.#id).bindPlan(p.planHash!);
      const registryVersion = Object.values(procedures).find((x) => x.registryVersion)?.registryVersion ?? null;
      const lock = await ctx.step("lock", { planHash: p.planHash }, async () => this.#guardData(ctx,"lock-plan",()=>this.#d.ledger.lockPlan({
        planFile: p.lockedPlan!, investigationId: this.#id, datasetId: staged.datasetId, planHash: p.planHash!, planBytesHash: p.planBytesHash!, contractHash: staged.contractHash,
        partitionHash: staged.partition?.hash ?? null, procedures: Object.fromEntries(Object.entries(procedures).map(([k, v]) => [k, v.procedureId])),
        literatureBriefHash: literatureBrief.sha256, registryVersion, plainStatement: p.plainStatement!, paperSet: p.paperSet, approvalActor: approval.actor,
      }),"plan-lock"));
      // The replicator's copy of the locked plan (host-written, worker-readable).
      await ctx.step("share-plan", { planHash: p.planHash }, async () => {
        const dest = this.#share("locked-plan", "plan.json");
        mkdirSync(path.dirname(dest), { recursive: true });
        rmSync(dest, { force: true });
        copyFileSync(p.lockedPlan!, dest);
        return dest;
      });
      return {
        next: "code", terminal: null, planHash: p.planHash!, lock, procedures, ordinals: registered.ordinals, fingerprints: registered.fingerprints,
        plainStatement: p.plainStatement!, paperSet: p.paperSet, approvalActor: approval.actor, expectedContractHash: st.contract?.expectedContractHash ?? null,
      };
    });
  }

  // -------------------------------------------------------------- 4. code turn (same session, scrambled outcomes)

  #codeInput(dataDir: string): CodePromptInput {
    const q = this.#out<QuestionOut>("question"), st = this.#out<StageOut>("stage");
    return { nativeConfirmation: this.#d.host.nativeConfirmation ?? false, id: this.#id, question: q.question, taskFile: st.taskFile, schemaViewDir: st.staged!.schemaViewDir, dataDir, route: st.route,realOnlyFiles:st.staged!.realOnlyFiles??[] };
  }

  #devMounts(dev: DerivedData | null): Mount[] {
    const st = this.#out<StageOut>("stage");
    if (st.route === "H") return [{ role: "dev", path: st.staged!.partition!.devDir }];
    return dev ? [{ role: "scrambled", path: dev.dir }] : [];
  }

  #seedLead(): (workdir: string) => void {
    const p = this.#out<PlanOut>("plan");
    return (workdir) => {
      if (p.lockedPlan) copyFileSync(p.lockedPlan, path.join(workdir, "plan.json"));
      const lead=this.machine.output<CodeOut>("code")?.lead??p.lead;
      if(lead&&lead.workdir!==workdir)for(const name of ["run_all.sh","code"])if(existsSync(path.join(lead.workdir,name)))cpSync(path.join(lead.workdir,name),path.join(workdir,name),{recursive:true,dereference:false});
    };
  }

  #code(): Promise<CodeOut> {
    return this.machine.phase("code", {}, async (ctx) => {
      const st = this.#out<StageOut>("stage"), p = this.#out<PlanOut>("plan"), lock = this.#out<LockOut>("plan-lock"), staged = st.staged!;
      // The plan lock may normalize context (paper_set order/defaults). A resumed lead
      // previously kept its pre-lock bytes because runTurn seeds only fresh sessions.
      await ctx.step("publish-locked-plan-to-lead", { planHash: p.planHash, workdir: p.lead?.workdir ?? null }, async () => {
        if (p.lead && p.lockedPlan) {
          const workdir = realpathSync(p.lead.workdir), root = realpathSync(this.#d.paths.workRoot);
          if (!workdir.startsWith(root + path.sep)) throw new InvestigationPaused("system-bug", "Lead workdir escaped its host root", "code");
          const dest = path.join(workdir, "plan.json");
          rmSync(dest, { force: true }); // remove a worker-controlled leaf, never follow a link
          writeFileSync(dest, readFileSync(p.lockedPlan), { flag: "wx", mode: 0o600 });
        }
        return true;
      });
      let dev: DerivedData | null = null;
      if (st.route === "P") {
        const outcomes = this.#practiceOutcomes();
        const exposures = this.#practiceExposures();
        // Blinding groups come from trusted structural facts only (review finding 1): the data
        // contract's unit and blinding strata. The lead's plan never chooses them.
        const { unit, strata } = trustedBlinding(st.contract);
        const made = await this.#practice(ctx, "scramble", "scramble", { outcomes, exposures, unit, strata, planHash: lock.planHash }, () =>
          this.#d.stager.scramble({ staged, outcomes, exposures, unit, strata, seed: this.#seed("scramble", { planLockHash: lock.planHash }), investigationId: this.#id }));
        if (made.fault) return { ...terminal("code", "infrastructure", made.fault), lead: p.lead, devData: made.data, warnings: [] };
        dev = made.data;
      }
      for(const detail of dev?.warnings??[])ctx.note("warning",{kind:"derived-data",detail});
      const dataDir = st.route === "H" ? staged.partition!.devDir : dev!.dir;
      const mounts: Mount[] = [
        ...(st.taskFile ? [{ role: "task" as const, path: path.dirname(st.taskFile) }] : []),
        { role: "schema", path: staged.schemaViewDir }, ...this.#devMounts(dev), ...this.#runtime(),
      ];
      const turn = await this.#turn({
        ctx, jobId: `${this.#id}/code/turn`, kind: "code", turn: "code", family: { mode: "any" }, session: p.lead,
        fresh: { workerJobId: `${this.#id}:lead`, workdir: this.#work("lead") }, seed: this.#seedLead(),
        mounts, prompt: codePrompt(this.#codeInput(dataDir)), expect: [{ file: "run_all.sh", schema: "omb-script", required: true }],
      }, st.route, staged);
      const lead = turn.session ?? p.lead;
      if (turn.hardStop) return { ...terminal("code", "hard-stop", `${turn.hardStop} observed during the code turn`, turn.hardStop), lead, devData: dev, warnings: [] };
      const infra = infrastructureFailure(turn, ["run_all.sh"]);
      if (infra) return { ...terminal("code", "infrastructure", `code turn: ${infra}; infrastructure, not a science result`), lead, devData: dev, warnings: [] };
      if (!turn.ok) usableAfterFailure(turn,ctx);
      if(!lead)throw new InvestigationPaused("provider","run_all.sh is missing; model turn unavailable","code");
      return { next: "dry-run", terminal: null, lead, devData: dev, warnings: turn.warnings };
    });
  }

  // -------------------------------------------------------------- 5. dry run on a synthetic schema (before any look)

  async #dryRunLoop(ctx: StepContext, prefix: string, startLead: SessionRef | null, initialSynthetic: DerivedData, rounds: number): Promise<{ lead: SessionRef | null; candidate: Bundle | null; attempts: Attempt[]; hardStop: string | null; infra?: string | null; synthetic: DerivedData }> {
    const st = this.#out<StageOut>("stage"), p = this.#out<PlanOut>("plan"), code = this.#out<CodeOut>("code"), staged = st.staged!;
    let lead = startLead, synthetic = initialSynthetic;
    this.#practiceUnderTest = synthetic;
    const attempts: Attempt[] = [];
    let repairRounds=0,previousSignature="",sameSignature=0,regenerations=0,hostCheck:string|null=null;
    let lastCandidate:Bundle|null=null;
    for (let attempt = 0; attempt <= rounds + 5; attempt++) {
      if (!lead) return { lead, candidate: null, attempts, hardStop: null, synthetic };
      const workdir = lead.workdir;
      const snapshot = await ctx.step(`${prefix}snapshot-${attempt}`, { workdir, attempt }, async () => {
        try { return await this.#guardData(ctx,"bundle-snapshot",async()=>snapshotBundle(workdir, this.#host("bundles", `${prefix}candidate-${attempt}`), p.lockedPlan!, samePlan)); }
        catch (e) { if (e instanceof CodePolicyError) { ctx.note("refusal-record", { refusal: e.refusal }); return { codePolicyError: e.message }; } throw e; }
      });
      const candidate = "codePolicyError" in snapshot ? null : snapshot;
      lastCandidate=candidate;
      if (candidate?.discarded.length) ctx.note("warning", { kind: "discarded-worker-files", detail: candidate.discarded.join(", ") });
      const exec: ExecResult = "codePolicyError" in snapshot
        ? { status: "crash", category: "code-policy", errorText: snapshot.codePolicyError, outputsHash: null, files: [] }
        : await ctx.step(`${prefix}exec-${attempt}`, { bundle: snapshot.hash, synthetic: synthetic.hash }, async () =>
          this.#exec(ctx, `${this.#id}/dry-run/${prefix}exec-${attempt}`, { bundleDir: snapshot.dir, dataDir: synthetic.dir, outDir: this.#host("outputs", `${prefix}dry-run-${attempt}`), mode: "dry-run", seed: this.#seed("dry-run") }));
      if (exec.hardStop) return { lead, candidate: null, attempts, hardStop: exec.hardStop, synthetic };
      if(exec.status === "crash" && exec.refusal?.decision !== "guard-error") ctx.note("refusal-record", { refusal:refusalRecord(exec.category ?? "infra",exec.errorText ?? "",(await this.#d.ledger.looks(this.#id)).length ? "post-look" : "pre-look") });
      if (exec.category === "infra" || exec.errorText?.startsWith("network-down:")) {
        const refusal=refusalRecord("infra",exec.errorText ?? "executor unavailable",(await this.#d.ledger.looks(this.#id)).length ? "post-look" : "pre-look","guard-error");
        const action=await this.#appeal(ctx,`${this.#id}/dry-run/${prefix}infra-${attempt}`,{issueType:"harness-missing-input",evidence:[hashOf(refusal)],claim:"Trusted synthetic executor unavailable."},refusal,lead,refusal.trigger,candidate?Object.keys(treeHashes(candidate.dir)):[],st.route,staged);
        if(action.kind!=="feedback") continue;
      }
      attempts.push({ attempt, status: exec.status, category: exec.status === "ok" ? null : errorCategory(exec.category) });
      if (exec.status === "ok") return { lead, candidate, attempts, hardStop: null, synthetic };
      // The worker (its error text or its appeal) blames the practice INPUT. The host checks
      // that claim itself instead of looping repair turns: a confirmed fault regenerates the
      // practice data and reruns the same bundle uncharged; a refuted claim becomes verified
      // feedback for the worker and the standby reviewer.
      const lookSpent=(await this.#d.ledger.looks(this.#id)).length>0;
      const previousRepair=`${this.#id}/dry-run/${prefix}repair-${attempt}`;
      const claimed=!lookSpent && (practiceDataClaim(exec.errorText ?? "") || ctx.notes("practice-claim").some(n => n.jobId === previousRepair || String(n.jobId).startsWith(previousRepair + "/")));
      if (claimed) {
        const fault = await this.#verifyPractice(ctx, `${prefix}practice-claim-${attempt}`, synthetic, "synthetic");
        ctx.note("practice-claim-checked", { attempt, prefix, data: synthetic.hash, upheld: !!fault });
        if (fault) {
          if (regenerations >= 2) return { lead, candidate: null, attempts, hardStop: null, infra: fault, synthetic };
          regenerations++;
          const made = await this.#practice(ctx, `${prefix}resynthesize-${regenerations}`, "synthetic", { previous: synthetic.hash }, () => this.#d.stager.synthesize({ staged, seed: this.#seed(`synthetic-regenerated-${regenerations}`), investigationId: this.#id, outcomes: this.#practiceOutcomes(), exposures: this.#practiceExposures() }));
          if (made.fault || !made.data) return { lead, candidate: null, attempts, hardStop: null, infra: made.fault ?? fault, synthetic };
          ctx.note("practice-regenerated", { attempt, prefix, previous: synthetic.hash, data: made.data.hash, reason: fault });
          synthetic = made.data; this.#practiceUnderTest = synthetic;
          continue;
        }
        hostCheck = "Host self-check (trusted, rule " + PRACTICE_RULE + "): the synthetic practice data satisfies the served data structure (row keys, per-unit design levels, allowed levels, missingness and count bounds). The failure is in the analysis code or its assumptions; do not weaken the frozen validation.";
      }
      const refusal=withBundleContext(exec.refusal??refusalRecord(exec.category??"execution",exec.errorText??"ran, no output",(await this.#d.ledger.looks(this.#id)).length?"post-look":"pre-look"),candidate?Object.keys(treeHashes(candidate.dir)):[]);
      ctx.note("refusal-record",{refusal});
      const signature=hashOf([refusal.ruleId,refusal.trigger]);sameSignature=signature===previousSignature?sameSignature+1:1;previousSignature=signature;
      const repeat=recordRefusal({id:`${prefix}refusal-${attempt}`,ctx,hostDir:this.#host(),refusal,lookSpent:(await this.#d.ledger.looks(this.#id)).length>0,bundleHash:candidate?.hash??"unavailable",limits:this.policy.triage});
      let reroute=false;
      if(repeat.autoAppeal){
        const action=await this.#appeal(ctx,`${this.#id}/dry-run/${prefix}auto-${attempt}`,{issueType:"other",evidence:[hashOf(refusal)],claim:"Repeated identical trusted refusal."},refusal,lead,refusal.trigger,candidate?Object.keys(treeHashes(candidate.dir)):[],st.route,staged,true);
        if(action.kind==="retry-infra"||action.kind==="extend-timeout-once"||action.kind==="drop-dev-files")continue;
        reroute=action.kind==="route-other-family";
      }
      const pendingFeedback=ctx.notes("appeal-remedy").some(n=>n.kind==="feedback"&&!ctx.notes("appeal-feedback-delivered").some(d=>d.id===n.id));
      if (repairRounds >= rounds || sameSignature>=2&&!reroute&&!pendingFeedback) break;
      repairRounds++;
      // Pre-look repair: the diagnostics come from synthetic data, so they may be shown in full.
      const turn = await this.#turn({
        ctx, jobId: `${this.#id}/dry-run/${prefix}repair-${attempt + 1}`, kind: "repair", turn: "dry-run-repair", family: reroute ? {mode:"cross-family",producer:lead.family} : { mode: "any" }, session: reroute ? null : lead,
        fresh: { workerJobId: reroute ? `${this.#id}:auto-reroute-${attempt}` : `${this.#id}:lead`, workdir: this.#work(reroute ? `auto-reroute-${attempt}` : "lead") }, seed: this.#seedLead(),
        mounts: [...(st.taskFile ? [{ role: "task" as const, path: path.dirname(st.taskFile) }] : []), { role: "schema", path: staged.schemaViewDir }, ...this.#devMounts(code.devData), { role: "synthetic", path: synthetic.dir }, ...this.#runtime()],
        prompt: (await this.#d.ledger.looks(this.#id)).length
          ? lookRepairPrompt(this.#codeInput(st.route === "H" ? staged.partition!.devDir : code.devData!.dir),errorCategory(exec.category))
          : dryRunRepairPrompt(this.#codeInput(st.route === "H" ? staged.partition!.devDir : code.devData!.dir), errorCategory(exec.category), refusalRecord("infra",exec.errorText ?? "").trigger, candidate?.discarded ?? [], refusal) + (hostCheck ? `\n${hostCheck}` : ""),
        expect: [{ file: "run_all.sh", schema: "omb-script", required: true }],
      }, st.route, staged);
      if (turn.session) lead = turn.session;
      if (turn.hardStop) return { lead, candidate: null, attempts, hardStop: turn.hardStop, synthetic };
      if (!turn.ok) usableAfterFailure(turn, ctx);
    }
    if(lastCandidate && code.devData && !(await this.#d.ledger.looks(this.#id)).length){
      const dev=await ctx.step(`${prefix}scrambled-fallback`,{bundle:lastCandidate.hash,dev:code.devData.hash},()=>this.#exec(ctx,`${this.#id}/dry-run/${prefix}scrambled-fallback`,{bundleDir:lastCandidate!.dir,dataDir:code.devData!.dir,outDir:this.#host("outputs",`${prefix}scrambled-fallback`),mode:"scrambled-twin",seed:this.#seed("dry-run")}));
      if(dev.hardStop)return {lead,candidate:null,attempts,hardStop:dev.hardStop,synthetic};
      if(dev.status==="ok"){ctx.note("warning",{kind:"dry-run-synthetic-failed",detail:"Synthetic run failed; the already mounted scrambled development copy ran successfully",hint:"false-alarm"});return {lead,candidate:lastCandidate,attempts,hardStop:null,synthetic};}
    }
    return { lead, candidate: null, attempts, hardStop: null, synthetic };
  }

  #dryRun(): Promise<DryRunOut> {
    return this.machine.phase("dry-run", { rounds: this.policy.dryRunRepairRounds }, async (ctx) => {
      const st = this.#out<StageOut>("stage"), code = this.#out<CodeOut>("code");
      const outcomes = [...new Set(this.#out<PlanOut>("plan").claims.map((c) => c.outcome).filter((x): x is string => !!x))].sort();
      const made = await this.#practice(ctx, "synthesize", "synthetic", { outcomes }, () => this.#d.stager.synthesize({ staged: st.staged!, seed: this.#seed("synthetic"), investigationId: this.#id, outcomes, exposures: this.#practiceExposures() }));
      if (made.fault || !made.data) return { ...terminal("dry-run", "infrastructure", made.fault ?? "synthetic practice data unavailable; host fault"), lead: code.lead, candidate: null, synthetic: made.data, attempts: [] };
      const synthetic = made.data;
      for(const detail of synthetic.warnings)ctx.note("warning",{kind:"synthetic-data",detail});
      const r = await this.#dryRunLoop(ctx, "", code.lead, synthetic, this.policy.dryRunRepairRounds);
      if (r.hardStop) return { ...terminal("dry-run", "hard-stop", `${r.hardStop} observed during a dry-run repair turn`, r.hardStop), lead: r.lead, candidate: null, synthetic: r.synthetic, attempts: r.attempts };
      if (!r.candidate && r.infra) return { ...terminal("dry-run", "infrastructure", r.infra.includes("practice data") ? r.infra : `dry-run repair turn: ${r.infra}; infrastructure, not a science result (the look stays unspent)`), lead: r.lead, candidate: null, synthetic: r.synthetic, attempts: r.attempts };
      if (!r.candidate) return { ...terminal("dry-run", "look-withheld", `the code never ran on the synthetic schema (${r.attempts.length} attempt(s)); the look stays unspent`), lead: r.lead, candidate: null, synthetic: r.synthetic, attempts: r.attempts };
      return { next: "freeze", terminal: null, lead: r.lead, candidate: r.candidate, synthetic: r.synthetic, attempts: r.attempts };
    });
  }

  // -------------------------------------------------------------- 6. freeze

  #freeze(): Promise<FreezeOut> {
    return this.machine.phase("freeze", {}, async (ctx) => {
      const dr = this.#out<DryRunOut>("dry-run"), lock = this.#out<LockOut>("plan-lock");
      const candidate = dr.candidate!;
      let frozen: { dir: string; hash: string };
      try {
        frozen = await ctx.step("freeze", { candidate: candidate.hash }, () => this.#guardData(ctx,"freeze",async () => freezeBundle(candidate, this.#host("frozen", "frozen-1")),"freeze"));
      } catch (e) {
        if (!(e instanceof TrustedPathChanged)) throw e;
        ctx.note("refusal-record", { refusal: refusalRecord("trusted-path-changed", e.message) });
        const r = routeFailure({ kind: "trusted-path-changed", positiveEvidence: true, afterFirstModelTurn: true });
        ctx.note("routing", { event: "trusted-path-changed", class: r.class, reason: e.message });
        return { ...terminal("freeze", "hard-stop", e.message, "trusted-path-changed"), frozen: null, receipt: null, discarded: candidate.discarded, planRestored: candidate.planRestored };
      }
      const receipt = await ctx.step("record-freeze", { frozen: frozen.hash }, () => this.#guardData(ctx,"record-freeze",async () => this.#d.ledger.recordFreeze({ investigationId: this.#id, planHash: lock.planHash, frozenCodeHash: frozen.hash, bundleDir: frozen.dir, attempt: 1 }),"look-ledger"));
      if (candidate.planRestored) ctx.note("warning", { kind: "plan-edited-after-lock", detail: "the worker's plan.json differed from the locked plan; the locked plan is frozen and used" });
      if (candidate.discarded.length) ctx.note("info", { kind: "discarded-worker-files", detail: candidate.discarded.slice(0, 50) });
      return { next: "look", terminal: null, frozen, receipt, discarded: candidate.discarded, planRestored: candidate.planRestored };
    });
  }

  // -------------------------------------------------------------- 7. the look (software only, G8 lane, recorded before execution)

  async #recordLook(partitionId: string, route: Route, frozenHash: string, executionId: string, datasetId: string, inputManifestHash: string): Promise<LookRecord> {
    const lock = this.#out<LockOut>("plan-lock"), st = this.#out<StageOut>("stage");
    // A crash between the ledger write and the journal step must not record the look twice.
    const prior = (await this.#d.ledger.looks(this.#id)).find((l) => l.partitionId === partitionId && l.executionId === executionId && l.frozenCodeHash === frozenHash);
    if (prior) return prior;
    new BriefLedger(this.#d.ledger.literatureJournal ?? this.#d.journal, this.#id).assertLook(lock.planHash);
    return this.#d.ledger.recordLook({ investigationId: this.#id, datasetId, partitionId, route, planHash: lock.planHash, frozenCodeHash: frozenHash, contractHash: st.staged!.contractHash, inputManifestHash, executionId });
  }

  #diagnosticGuard(result: CertifyResult): CertifyResult {
    const prior = this.machine.output<CertifyOut>("certify")?.certification.diagnostics ?? [];
    return enforceDiagnostics({...result,diagnostics:[...prior,...result.diagnostics ?? []].filter((d,i,a)=>a.findIndex(x=>hashOf(x)===hashOf(d))===i)}, Object.values(this.machine.output<LockOut>("plan-lock")?.procedures ?? {}).flatMap(p=>p.assumptions ?? []));
  }

  async #certifyData(request: CertifyRequest): Promise<CertifyResult> {
    const verify=()=>{let code:string,input:string;try{code=treeHash(request.bundleDir);input=treeHash(request.rawDir);}catch{throw new InvestigationPaused("system-bug","Certification input hash guard unavailable","certify");}if(code!==request.expectedCodeHash||input!==request.expectedInputHash)throw new HardStopObserved("trusted-path-changed");};
    verify();
    try{
      if (request.pass === "route-n" || this.#out<StageOut>("stage").route === "H" || this.#d.host.nativeConfirmation === true && this.#d.confirmation) {
        if (!this.#d.confirmation) throw new InvestigationPaused("infra","attested confirmation port unavailable","certify");
        return this.#diagnosticGuard(await this.#d.confirmation.certify(request));
      }
      return this.#diagnosticGuard(await this.#d.certifier.certify(request));
    }finally{verify();}
  }

  async #confirm(ctx: StepContext, look: LookRequest, execution: ExecRequest) {
    if (!this.#d.confirmation) throw new Error("attested confirmation port unavailable");
    const jobId = `${this.#id}/native/${look.executionId}`;
    const prior = ctx.notes("native-confirm-result").find(n => n.jobId === jobId);
    if (prior) { this.#retire(jobId, "native confirmation already journaled"); return prior.value as unknown as Awaited<ReturnType<ConfirmationPort["run"]>>; }
    const r = await this.#d.fleet.run({ id: jobId, kind: "look", partition: look.partitionId, investigation: this.#id, maxAttempts: 1 }, computeLauncher(async () => {
      new BriefLedger(this.#d.ledger.literatureJournal ?? this.#d.journal, this.#id).markLook(look.planHash, look.executionId);
      const value = await this.#d.confirmation!.run({ look, execution });
      ctx.note("native-confirm-result", { jobId, value }); return value;
    }));
    const value = r.payloads.at(-1) as Awaited<ReturnType<ConfirmationPort["run"]>> | undefined;
    return value ?? { record: null, result: { status: "crash" as const, category: "interrupted" as const, errorText: null, outputsHash: null, files: [] }, reason: "native confirmation interrupted; the store decides whether the look was spent" };
  }

  /** Manifest of the exact confirming input of the primary look (review finding 6). */
  #confirmingManifest(): string {
    const st = this.#out<StageOut>("stage"), staged = st.staged!;
    return st.route === "H" ? staged.partition!.heldOutManifestHash : staged.manifestHash;
  }

  async #executeLook(ctx: StepContext, jobId: string, record: LookRecord, request: Parameters<ExecutorPort["run"]>[0]): Promise<ExecResult> {
    const epoch=this.machine.notes("triage-resumed").length+this.machine.notes("pause-resumed").length+this.machine.notes("plan-replanned").length;if(epoch)jobId+=`/triage-resume-${epoch}`;
    const rebound=ctx.notes("look-dispatch-rebound").findLast(n=>n.recordHash===record.hash);
    if(rebound)jobId=String(rebound.jobId);
    const prior = ctx.notes("compute-result").find((n) => n.jobId === jobId);
    if (prior) {
      // The look ran and its result was journaled before a crash: the scheduler parked the job as
      // look-interrupted; the journal (and the look ledger) decide, so release nothing, cancel it.
      this.#retire(jobId, "look result already journaled");
      return prior.payload as unknown as ExecResult;
    }
    // Only positive evidence that the latest invocation did not expose data permits reuse.
    const spent = () => {
      const marker=ctx.notes("look-executing").findLast(n=>n.recordHash===record.hash);
      const receipts = marker ? ctx.notes("look-infra").filter(n=>n.recordHash===record.hash && n.attempt===marker.attempt) : [];
      return marker && (!receipts.length || !receipts.every(mayRetryLook));
    };
    if (spent()) {
      this.#retire(jobId, "look interrupted; spent per the look ledger");
      throw new InvestigationPaused("infra", "No affirmative no-output receipt; look remains spent", "look");
    }
    const interruptedJob=this.#d.fleet.sched.job(jobId);
    if(interruptedJob && ["parked","exhausted","cancelled"].includes(interruptedJob.state)){
      this.#retire(jobId,"No execution marker: retire dispatch and reuse the unspent look record");
      const oldJobId=jobId;jobId+=`/unspent-${ctx.notes("look-dispatch-rebound").length+1}`;
      ctx.note("look-dispatch-rebound",{recordHash:record.hash,oldJobId,jobId,number:record.number});
    }
    ctx.note("look-started", { recordHash: record.hash, jobId, number: record.number });
    this.#d.faultAt?.("look:started");
    await this.#d.fleet.run(
      { id: jobId, kind: "look", partition: record.partitionId, investigation: this.#id, maxAttempts: 1, ...(this.policy.quietGroup ? { quietGroup: this.policy.quietGroup } : {}) },
      computeLauncher(async () => {
        mkdirSync(request.outDir, { recursive: true, mode: 0o700 });
        let result: ExecResult;
        let retry=ctx.notes("look-retry-in-place").filter(n=>n.recordHash===record.hash).length;
        for(;;){
          if(spent())return {status:"crash",category:"interrupted",errorText:null,outputsHash:null,files:[]};
          const attempt=ctx.notes("look-executing").filter(n=>n.recordHash===record.hash).length+1;
          ctx.note("look-executing",{recordHash:record.hash,number:record.number,jobId,attempt});
          this.#d.faultAt?.("look:executing");
          try { result = await this.#d.executor.run(request); }
          catch (e) { result = { status:"crash", category:"infra", errorText:String(e), outputsHash:null,files:[] }; }
          const receipt = {recordHash:record.hash,jobId,attempt,status:result.status,category:result.category??null,hardStop:result.hardStop??null,workerStarted:result.workerStarted??null,kind:result.kind??null,cleanReceipt:result.cleanReceipt??null,outputFiles:Array.isArray(result.files)?result.files.length:null,outputsHash:result.outputsHash===undefined?"missing":result.outputsHash};
          ctx.note("look-infra",receipt);
          const safe=mayRetryLook(receipt) && !spent();
          if(!safe||retry>=3)break;
          ctx.note("look-retry-in-place",{recordHash:record.hash,number:record.number,frozenHash:record.frozenCodeHash,retry:++retry});
          await this.#d.fleet.delay(1000*retry);
        }
        if(result.status==="crash"){
          result.refusal=refusalRecord(result.hardStop??result.category??"execution","","post-look",result.hardStop?"denied":result.refusal?.decision??(["infra","data-unreadable"].includes(result.category??"")?"guard-error":"denied"));
          ctx.note(result.refusal.decision==="guard-error"?"guard-error":"refusal-record",{jobId,refusal:result.refusal});
        }
        if (!result.hardStop&&(result.category === "infra"||result.category==="data-unreadable"||result.refusal?.decision==="guard-error")) {
          if(!spent())ctx.note("look-unspent",{recordHash:record.hash,number:record.number,jobId,reason:result.workerStarted===false?"worker never started":"clean census receipt"});
          ctx.note("warning", { kind: "executor-infrastructure", jobId, detail: "Trusted look executor unavailable; diagnostics withheld" });
          ctx.note("look-infra", { jobId, recordHash:record.hash, category:"infra", pauseKind:result.category==="infra"?"infra":"system-bug",workerStarted:result.workerStarted??null, cleanReceipt:result.cleanReceipt??false, kind:result.kind??null });
          // The invocation settled. Pause outside the scheduler so it cannot relaunch a spent look.
          return result;
        }
        ctx.note("compute-result", { jobId, payload: result });
        this.#d.faultAt?.("look:executed");
        return result;
      }),
    );
    const infra=ctx.notes("look-infra").findLast(n=>n.jobId===jobId&&typeof n.pauseKind==="string");
    if(infra)throw new InvestigationPaused(infra.pauseKind==="system-bug"?"system-bug":"infra","Trusted look executor unavailable; the look remains spent", "look");
    const after = ctx.notes("compute-result").find((n) => n.jobId === jobId);
    if (after) return after.payload as unknown as ExecResult;
    this.#retire(jobId, "look interrupted; spent per the look ledger");
    throw new InvestigationPaused("infra", "Missing durable execution receipt; look remains spent", "look");
  }

  #look(): Promise<LookOut> {
    return this.machine.phase("look", { rounds: this.policy.lookRepairRounds }, async (ctx) => {
      const st = this.#out<StageOut>("stage"), fz = this.#out<FreezeOut>("freeze"), dr = this.#out<DryRunOut>("dry-run"), code = this.#out<CodeOut>("code");
      const lock = this.#out<LockOut>("plan-lock"), staged = st.staged!;
      const route: Route = st.route;
      const partitionId = route === "H" ? staged.partition!.id : `P:${staged.manifestHash.slice(0, 16)}:${this.#id}`;
      const dataDir = route === "H" ? staged.partition!.heldOutDir : staged.realDataDir;
      let frozen = fz.frozen!, lead = dr.lead, repairs = 0;
      const looks: LookEntry[] = [];
      const base = { frozen, lead, partitionId, dataDir, repairs };
      for (let n = 1; ; n++) {
        try { await this.#d.fleet.beforeLook(`${this.#id}/look/preflight`); }
        catch (e) { if (!(e instanceof NetworkDown)) throw e; return { ...terminal("look", "infrastructure", e.message), ...base, frozen, lead, repairs, looks, final: null }; }
        try{await this.#d.executor.health();}catch(e){throw new InvestigationPaused("infra",`executor health: ${String(e)}`,"look");}
        const executionId = `${this.#id}:look-${n}`;
        const outDir = this.#host("outputs", `look-${n}`);
        const execution = { bundleDir: frozen.dir, dataDir, outDir, mode: "look" as const, seed: this.#seed("look", { planLockHash: lock.planHash, frozenCodeHash: frozen.hash }) };
        if (route === "H" && !this.#d.confirmation) return { ...terminal("look", "infrastructure", "attested confirmation port unavailable; sealed look withheld"), ...base, frozen, lead, repairs, looks, final: null };
        const native = (route === "H" || this.#d.host.nativeConfirmation === true && this.#d.confirmation) ? await ctx.step(`native-${n}`, { frozen: frozen.hash, partitionId }, () => this.#confirm(ctx, { investigationId: this.#id, datasetId: staged.datasetId, partitionId, route, planHash: lock.planHash, frozenCodeHash: frozen.hash, contractHash: staged.contractHash, inputManifestHash: this.#confirmingManifest(), executionId }, execution)) : null;
        if ((route === "H" || this.#d.host.nativeConfirmation === true && this.#d.confirmation) && !native?.record) return { ...terminal("look", "infrastructure", native?.reason ?? "native confirmation refused"), ...base, frozen, lead, repairs, looks, final: null };
        const rec = native?.record ?? await ctx.step(`record-${n}`, { frozen: frozen.hash, n, partitionId }, async () => this.#guardData(ctx,"record-look",()=>this.#recordLook(partitionId, route, frozen.hash, executionId, staged.datasetId, this.#confirmingManifest()),"look-ledger"));
        this.#d.faultAt?.(`look:recorded-${n}`);
        if (!rec.executable) {
          looks.push({ number: rec.number, partitionId, route, sequence: rec.sequence, hash: rec.hash, status: "crash", category: null, frozenHash: frozen.hash });
          return { ...terminal("look", "look-refused", `look ${rec.number} on ${route === "H" ? "the sealed partition" : "this partition"} is not executable (burned or exposed units)`), ...base, frozen, lead, repairs, looks, final: null };
        }
        const exec = native?.result ?? await ctx.step(`execute-${n}`, { record: rec.hash }, async () =>
          this.#executeLook(ctx, `${this.#id}/look/execute-${n}`, rec, execution));
        const category = exec.status === "ok" ? null : errorCategory(exec.category);
        looks.push({ number: rec.number, partitionId, route, sequence: rec.sequence, hash: rec.hash, status: exec.status, category, frozenHash: frozen.hash });
        if (exec.status === "ok") {
          return { next: "certify", terminal: null, ...base, frozen, lead, repairs, looks, final: { number: rec.number, outputsDir: outDir, outputsHash: exec.outputsHash, sequence: rec.sequence } };
        }
        if (exec.hardStop) return { ...terminal("look", "hard-stop", "Trusted executor hard stop", exec.hardStop), ...base, frozen, lead, repairs, looks, final:null };
        if(category==="infra"){
          const id=`${this.#id}/look/guard-${n}/${this.machine.notes("triage-resumed").length}`,refusal=refusalRecord("infra","","post-look","guard-error");
          ctx.note("system-bug-ticket",{id,ruleId:"infra",source:"guard-error",reproduced:true});
          throw new InvestigationPaused("infra","Trusted look executor unavailable; the spent look remains charged.","look");
        }
        // The look is spent. An interrupted look (orchestrator crash) re-runs the same frozen code as
        // the next look; a code crash first checks the scrambled twin (amendment 14).
        if(route==="H")return {...terminal("look","look-failed","Route H does not permit an executable second look; repair withheld"),...base,frozen,lead,repairs,looks,final:null};
        if (category !== "interrupted" && !["timeout","output-cap","memory-limit"].includes(category??"")) {
          const twinData = code.devData!.dir;
          const twin = await ctx.step(`twin-${n}`, { frozen: frozen.hash }, async () =>
            this.#exec(ctx, `${this.#id}/look/twin-${n}`, { bundleDir: frozen.dir, dataDir: twinData, outDir: this.#host("outputs", `twin-${n}`), mode: "scrambled-twin", seed: this.#seed("twin") }));
          if (twin.status === "ok") ctx.note("label-cap",{reason:`outcome-dependent crash on look ${n}`,cap:"tentative",hint:"true-catch"});
        }
        if (repairs >= this.policy.lookRepairRounds) {
          return { ...terminal("look", "look-failed", `look ${n} failed (${category}) and the repair budget is spent`), ...base, frozen, lead, repairs, looks, final: null };
        }
        if (category === "interrupted" && n>=3)throw new InvestigationPaused("infra","repeated interrupted looks; resume requires host recovery","look");
        if (category !== "interrupted") {
          repairs += 1;
          // After a look the model sees only the trusted error category.
          const turn = await this.#turn({
            ctx, jobId: `${this.#id}/look/repair-${repairs}`, kind: "repair", turn: "look-repair", family: { mode: "any" }, session: lead,
            fresh: { workerJobId: `${this.#id}:lead`, workdir: this.#work("lead") }, seed: this.#seedLead(),
            mounts: [...(st.taskFile ? [{ role: "task" as const, path: path.dirname(st.taskFile) }] : []), { role: "schema", path: staged.schemaViewDir }, ...this.#devMounts(code.devData), ...this.#runtime()],
            prompt: lookRepairPrompt(this.#codeInput(code.devData!.dir), category ?? "infra"),
            expect: [{ file: "run_all.sh", schema: "omb-script", required: true }],
          }, route as "P" | "H", staged);
          if (turn.session) lead = turn.session;
          if (turn.hardStop) return { ...terminal("look", "hard-stop", `${turn.hardStop} observed during the look repair turn`, turn.hardStop), ...base, frozen, lead, repairs, looks, final: null };
          if (!turn.ok && !usableAfterFailure(turn, ctx)) {
            const infra = infrastructureFailure(turn, ["run_all.sh"]);
            return { ...terminal("look", infra ? "infrastructure" : "look-failed", infra ? `look repair turn: ${infra}; infrastructure, not a science result` : "the look repair turn did not complete"), ...base, frozen, lead, repairs, looks, final: null };
          }
          const dry = await this.#dryRunLoop(ctx, `look${repairs}-`, lead, dr.synthetic!, this.policy.dryRunRepairRounds);
          if(dry.infra)throw new InvestigationPaused("infra",dry.infra,"look");
          if (dry.hardStop || !dry.candidate) return { ...terminal("look", "look-failed", "the repaired code did not run on the synthetic schema"), ...base, frozen, lead, repairs, looks, final: null };
          const candidate = dry.candidate;
          frozen = await ctx.step(`refreeze-${repairs}`, { candidate: candidate.hash }, () => this.#guardData(ctx,"refreeze",async()=>freezeBundle(candidate, this.#host("frozen", `frozen-${repairs + 1}`)),"freeze"));
          await ctx.step(`record-freeze-${repairs}`, { frozen: frozen.hash }, async () => this.#d.ledger.recordFreeze({ investigationId: this.#id, planHash: lock.planHash, frozenCodeHash: frozen.hash, bundleDir: frozen.dir, attempt: repairs + 1 }));
        }
      }
    });
  }

  // -------------------------------------------------------------- 8. certify

  #ordinals(): Record<string, number> {
    return this.#out<LockOut>("plan-lock").ordinals;
  }

  #certifyRequest(pass: "certify" | "replicate" | "route-n", externalGates: GateResult[], program: ProgramState, over: Partial<Parameters<CertifyPort["certify"]>[0]> = {}): Parameters<CertifyPort["certify"]>[0] {
    const lk = this.#out<LockOut>("plan-lock"), look = this.#out<LookOut>("look"), st = this.#out<StageOut>("stage");
    // Under a pinned contract (route P), certification reads the host-only contract input (the real
    // data plus the contract's public assets) and receives the pinned contract itself.
    const ci = st.route === "P" && st.contract ? st.staged!.contractInput ?? null : null;
    return {
      investigationId: this.#id, pass, bundleDir: look.frozen.dir, lookOutputsDir: look.final!.outputsDir, rawDir: ci ? ci.dir : look.dataDir,
      lock: { planHash: lk.planHash, lockedAt: lk.lock!.sequence }, firstLookAt: look.looks[0]!.sequence,
      expectedInputHash: ci ? ci.manifestHash : this.#confirmingManifest(), expectedCodeHash: look.frozen.hash, expectedContractHash: lk.expectedContractHash,
      contract: ci ? st.contract : null,
      externalGates, hypothesisOrdinals: this.#ordinals(), programMultiplicity: program.datasets, reproductionTargets: this.#reproductionTargets(), executionId: `${this.#id}:${pass}`,
      degraded: this.#degraded(), osUserSeparation: !this.#degraded(), ...over,
    };
  }

  /** Host-owned targets for locked reproduction claims, matched by content as certifyDirectory's cardMatches (review finding 8). */
  #reproductionTargets(): Record<string, ReproductionTargetSpec> {
    const targets = this.spec.reproductionTargets ?? [];
    if (!targets.length) return {};
    const plan = parsePlan(readFileSync(this.#out<PlanOut>("plan").lockedPlan!, "utf8")).plan;
    const out: Record<string, ReproductionTargetSpec> = {};
    for (const c of plan?.claims ?? []) {
      if (c.kind !== "reproduction") continue;
      const key = hashOf([c.knobs.table ?? null, c.exposure, c.outcome, c.adjustment, c.strata, c.nullValue, c.estimand]);
      const match = targets.filter((t) => hashOf([t.table, t.exposure, t.outcome, t.adjustment, t.strata, t.nullValue, t.estimand]) === key);
      if (match.length === 1) out[c.id] = match[0]!;
    }
    return out;
  }

  #applyAuditedCaps(ctx:StepContext,pass:string,input:readonly ClaimRecord[],lookNumber:number):ClaimRecord[] {
    const degraded=this.#degraded(),claims=capAmendedClaims(applyCaps(input,{degraded,lookNumber}), this.machine.notes("plan-amendment"));
    const reasons=[...(degraded?[DEGRADED_REASON]:[]),...(lookNumber>1?[`look ${lookNumber} on this partition: a repaired re-run is never Confirmed`]:[])];
    if(reasons.length)for(const c of claims){
      const before=input.find(x=>x.claimId===c.claimId)!;
      const capKey=hashOf([pass,c.claimId,degraded,lookNumber]);
      if(!ctx.notes("label-cap").some(n=>n.capKey===capKey))ctx.note("label-cap",{capKey,pass,claimId:c.claimId,ceiling:"tentative",from:before.status,to:c.status,changed:before.status!==c.status,reason:reasons.join("; "),hint:degraded?"infra":"true-catch"});
    }
    return claims;
  }

  #certify(): Promise<CertifyOut> {
    return this.machine.phase("certify", { degraded: this.#degraded() }, async (ctx) => {
      const p = this.#out<PlanOut>("plan"), look = this.#out<LookOut>("look"), final = look.final!;
      const g8 = p.claims.filter((c) => !c.exploratory).map((c) => lookGate(c.id, { route: look.looks.at(-1)!.route, partitionId: look.partitionId, number: final.number, recordedBeforeExecution: true }));
      // Program-wide G6 (K2b): the registry's LORD++ state, snapshotted once and reused by every pass.
      const manifest = this.#out<StageOut>("stage").staged!.manifestHash;
      const program = await ctx.step("program-state", { manifest }, async () => programState(this.#d.registry, manifest, this.#id, this.#ordinals()));
      const result = await ctx.step("certify", { g8, targets: this.#reproductionTargets(), program }, async () => this.#certifyData(this.#certifyRequest("certify", g8, program)));
      // The kernel's software decisions are final per hypothesis (first decision wins) and feed later wealth.
      const finality = await ctx.step("record-decisions", { decisions: result.multiplicity ?? [] }, async () => recordDecisions(this.#d.registry, result.multiplicity ?? [], program, manifest, this.#id));
      const state: ProgramState = { datasets: program.datasets, notes: [...program.notes, ...finality] };
      const claims = programLimitations(this.#applyAuditedCaps(ctx,"certify",result.claims,final.number), state.notes);
      for(const failure of this.machine.notes("contract-unverified"))for(const c of claims){c.status="insufficient-evidence";c.taskStatus="insufficient-evidence";c.limitations.push(`contract check failed: ${failure.code}`);}
      const crashCaps=this.machine.notes("label-cap").filter(n=>n.cap==="tentative").map(n=>String(n.reason));
      for(const c of claims)if(crashCaps.length){if(["confirmed","replicated"].includes(c.status)){c.status="tentative";c.taskStatus="tentative";}c.limitations.push(...crashCaps);}
      return { next: "replicate", terminal: null, certification: { ...result, claims }, g8, program: state };
    });
  }

  // -------------------------------------------------------------- 9. replicate (G7 cross-family; route N)

  async #advisoryAppeal(ctx: StepContext, evidence: AdvisoryEvidence, worker: SessionRef | null): Promise<void> {
    const st=this.#out<StageOut>("stage"), id=`${this.#id}/assumption-review/${hashOf(evidence).slice(0,20)}`;
    const ruleId=evidence.source==='worker-log'?'assumption-signal':'methods-validity';
    const refusal=refusalRecord(ruleId,"","post-look");
    const appeal:Appeal={issueType:'other',evidence:[refusal.id],claim:'Review the attached assumption-validity concern; advisory evidence only.'};
    ctx.note("assumption-review-evidence",{id,evidence});
    ctx.note("warning",{kind:ruleId,detail:`${evidence.signals.length} assumption concerns routed to standby review; excerpts retained in the reviewer packet and journal.`});
    try {
      await resolveAppeal({ctx,id,hostDir:this.#host(),refusal,appeal,files:[refusal.id],hardStop:null,lookSpent:true,automatic:true,advisory:true,bundleHash:hashOf(evidence),limits:this.policy.triage,
        timeoutMs:this.policy.turnTimeoutMs,hardTimeoutMs:this.policy.turnTimeoutMs,
        review:async a=>(await standbyReview(this.#turnEnv(st.route,st.staged),{ctx,id,appeal:a,refusal,files:[],evidence:'',worker,workdir:this.#work(`advisory-${hashOf(evidence).slice(0,20)}`),advisoryEvidence:evidence})).verdict});
    } catch(e) {if(!(e instanceof InvestigationPaused)||e.kind==="needs-you")throw e; ctx.note("warning",{kind:"methods-review-unavailable",detail:"Advisory standby review unavailable; concern retained without changing labels."});}
  }

  async #methodsValidity(ctx: StepContext, certification: CertifyResult): Promise<MethodsValidityReview> {
    const st=this.#out<StageOut>("stage"), look=this.#out<LookOut>("look");
    const scan=collectAssumptionSignals(look.final?.outputsDir??this.#host(),look.final?Object.keys(treeHashes(look.final.outputsDir)):[],ctx.notes("assumption-signal").map(n=>n.signal as unknown as AssumptionSignal));
    const signals=scan.signals;
    for(const detail of scan.warnings)ctx.note("warning",{kind:"assumption-scan-unavailable",detail});
    const softwareSummaries={...trustedDataSummaries(st.staged!.realDataDir),...certification.dataSummaries};
    const methods=this.#out<PlanOut>("plan").claims.map(c=>({claimId:c.id,kind:c.kind,estimand:c.estimand,procedure:this.machine.output<LockOut>("plan-lock")?.procedures[c.id]?.procedureId??null}));
    if(signals.length) await this.#advisoryAppeal(ctx,{source:'worker-log',signals:signals.slice(0,32)},look.lead);
    const fallback:MethodsValidityReview={status:'not-evaluable',objections:[],advisory:true};
    let turn:TurnResult;
    try { turn=await runTurn(this.#turnEnv(st.route,st.staged),{ctx,jobId:`${this.#id}/methods-validity`,kind:'replicate',turn:'methods-validity',...(look.lead?.model?{againstModel:look.lead.model}:{}),family:{mode:'cross-family',producer:look.lead!.family},session:null,
      fresh:{workerJobId:`${this.#id}:methods-validity`,workdir:this.#work('methods-validity')},mounts:[],
      prompt:methodsValidityPrompt(this.#out<QuestionOut>("question").question,readSmall(path.join(st.staged!.schemaViewDir,'schema.json'),200_000)??'Data summary unavailable',certification.diagnostics??[],methods,softwareSummaries,signals),
      expect:[{file:'methods-validity.json',schema:'omb-json',required:true}]});
    } catch(e) {if(e instanceof ProviderDisagreement){await this.#advisoryAppeal(ctx,{source:'methods-validity',signals:[{source:'model-disagreement',evidence:(e.outcome.text??'Model objection').slice(0,1000),trusted:false}]},look.lead);throw new InvestigationPaused('needs-you','Reviewer disagreement routed to the existing advisory triage path','replicate',0);}if(!(e instanceof InvestigationPaused)||e.kind==="needs-you")throw e; ctx.note("warning",{kind:"methods-review-unavailable",detail:"Independent advisory methods review unavailable."});return fallback;}
    if(turn.hardStop)throw new HardStopObserved(turn.hardStop);
    let review:MethodsValidityReview|null=null;
    if(turn.ok && turn.session) try{review=parseMethodsReview(JSON.parse(readSmall(path.join(turn.session.workdir,'methods-validity.json'),20_000)??'null'));}catch{/* advisory unavailable */}
    if(!review)ctx.note("warning",{kind:"methods-review-unavailable",detail:"Independent methods-validity pass did not produce a usable review; implementation agreement remains implementation-only."});
    if(review?.objections.length) await this.#advisoryAppeal(ctx,{source:'methods-validity',signals:review.objections.map(evidence=>({source:'methods-validity.json',evidence,trusted:false}))},turn.session);
    return review??fallback;
  }

  #replicate(): Promise<ReplicateOut> {
    return this.machine.phase("replicate", { replicate: this.policy.replicate, independent: this.spec.independentDataset?.datasetId ?? null }, async (ctx) => {
      try{
      const st = this.#out<StageOut>("stage"), p = this.#out<PlanOut>("plan"), look = this.#out<LookOut>("look"), cert = this.#out<CertifyOut>("certify");
      const code = this.#out<CodeOut>("code"), staged = st.staged!;
      const plan = parsePlan(readFileSync(p.lockedPlan!, "utf8")).plan as Plan;
      const targets = p.claims.filter((c) => !c.exploratory);
      let g7: GateResult[] = [];
      let replicator: ReplicateOut["replicator"] = null;
      let certification: CertifyResult | null = null;
      if (this.policy.replicate && targets.length) {
        const leadSession=(look.lead??p.lead)!;
        const leadFamily = leadSession.family, leadModelFamily=leadSession.model?modelFamily(leadSession.model):leadFamily;
        const dataDev = st.route === "H" ? staged.partition!.devDir : code.devData!.dir;
        const turn = await this.#turn({
          ctx, jobId: `${this.#id}/replicate/turn`, kind: "replicate", turn: "replicate", ...(leadSession.model?{againstModel:leadSession.model}:{}), family: { mode: "cross-family", producer: leadFamily }, session: null,
          fresh: { workerJobId: `${this.#id}:replicator`, workdir: this.#work("replicator") },
          seed: (w) => copyFileSync(p.lockedPlan!, path.join(w, "plan.json")),
          mounts: [{ role: "locked-plan", path: this.#share("locked-plan") }, { role: "schema", path: staged.schemaViewDir }, ...this.#devMounts(code.devData), ...this.#runtime()],
          prompt: replicatePrompt({ id: this.#id, question: this.#out<QuestionOut>("question").question, lockedPlanDir: this.#share("locked-plan"), schemaViewDir: staged.schemaViewDir, dataDir: dataDev, route: st.route }),
          expect: [{ file: "run_all.sh", schema: "omb-script", required: true }],
        }, st.route, staged);
        const family = turn.session?.family ?? null;
        if (turn.job.endReason?.startsWith("network-down:")) throw new InvestigationPaused("provider",turn.job.endReason,"replicate");
        if (turn.hardStop) {
          return {...terminal("replicate","hard-stop",`Positive hard-stop evidence during replication: ${turn.hardStop}`,turn.hardStop),claims:cert.certification.claims,g7:[],routeN:null,replicator:{family,verified:false,reason:turn.hardStop},certification:null};
        } else if ((!turn.ok && !usableAfterFailure(turn, ctx)) || !turn.session) {
          const infra = infrastructureFailure(turn, ["run_all.sh"]);
          const reason = turn.job.park?.reason === "family-unavailable"
            ? "no other model family could take the replication (the replicator never falls back to the lead's family)"
            : infra ? `infrastructure: the replicator ${infra}` : `the replicator did not complete (${turn.job.endReason ?? turn.job.state})`;
          g7 = targets.map((c) => g7NotRun(c.id, reason));
          replicator = { family, verified: false, reason };
        } else {
          const rs = turn.session;
          const bundle = await ctx.step("replicator-snapshot", { workdir: rs.workdir }, async () => snapshotBundle(rs.workdir, this.#host("bundles", "replicator"), p.lockedPlan!, samePlan));
          const run = (k: number, data: string) => ctx.step(`replicator-exec-${k}`, { bundle: bundle.hash, data }, async () =>
            this.#exec(ctx, `${this.#id}/replicate/exec-${k}`, { bundleDir: bundle.dir, dataDir: data, outDir: this.#host("outputs", `replicator-${k}`), mode: "replicate", seed: this.#seed("replicate") }));
          // Route P compares on the confirming data the look used. Route H must not unseal the
          // held-out partition again, so implementations are compared on the dev partition.
          const data = st.route === "H" ? staged.partition!.devDir : look.dataDir;
          const r1 = await run(1, data), r2 = await run(2, data);
          const networkCap = [r1, r2].find(r => r.errorText?.startsWith("network-down:"));
          if (networkCap) throw new InvestigationPaused("provider",networkCap.errorText!,"replicate");
          const verified = r1.status === "ok" && r2.status === "ok" && r1.outputsHash !== null && r1.outputsHash === r2.outputsHash;
          let leadOut = look.final!.outputsDir;
          if (st.route === "H") {
            const l = await ctx.step("lead-dev-exec", { frozen: look.frozen.hash }, async () =>
              this.#exec(ctx, `${this.#id}/replicate/lead-dev`, { bundleDir: look.frozen.dir, dataDir: data, outDir: this.#host("outputs", "lead-dev"), mode: "replicate", seed: this.#seed("replicate") }));
            leadOut = l.status === "ok" ? this.#host("outputs", "lead-dev") : "";
          }
          const leadPrimary = readPrimary(leadOut ? readSmall(path.join(leadOut, "primary.json")) : null);
          const replPrimary = readPrimary(readSmall(path.join(this.#host("outputs", "replicator-1"), "primary.json")));
          g7 = targets.map((c) => compareReplication({ plan, claim: findClaim(plan, c.id)!, lead: leadPrimary, replicator: verified ? replPrimary : null, families: [leadModelFamily, rs.model?modelFamily(rs.model):rs.family], replicatorVerified: verified }));
          replicator = { family: rs.model?modelFamily(rs.model):rs.family, verified, reason: verified ? "software ran the replicator's frozen code twice with identical outputs" : "the replicator's code did not run reproducibly under software" };
          if ((rs.model?modelFamily(rs.model):rs.family) === leadModelFamily) ctx.note("warning", { kind: "same-family-replicator", detail: "same-family agreement counts as zero" });
        }
        certification = await ctx.step("certify-g7", { g7, targets: this.#reproductionTargets(), program: cert.program }, async () => this.#certifyData(this.#certifyRequest("replicate", [...cert.g8, ...g7], cert.program)));
        certification = { ...certification, claims: programLimitations(this.#applyAuditedCaps(ctx,"replicate",certification.claims,look.final!.number), cert.program.notes) };
      }
      const methodsValidity = await ctx.step("methods-validity",{},()=>this.#methodsValidity(ctx,certification ?? cert.certification));
      const primaryClaims = certification?.claims ?? cert.certification.claims;
      let routeN: RouteNOut | null = null;
      if (this.spec.independentDataset) routeN = await this.#routeN(ctx, g7);
      const claims = mergeRouteN(primaryClaims, routeN?.claims ?? null);
      for(const failure of this.machine.notes("contract-unverified"))for(const c of claims){c.status="insufficient-evidence";c.taskStatus="insufficient-evidence";c.limitations.push(`contract check failed: ${failure.code}`);}
      const crashCaps=this.machine.notes("label-cap").filter(n=>n.cap==="tentative").map(n=>String(n.reason));
      for(const c of claims)if(crashCaps.length){if(["confirmed","replicated"].includes(c.status)){c.status="tentative";c.taskStatus="tentative";}c.limitations.push(...crashCaps.filter(r=>!c.limitations.includes(r)));}
      return { next: "interpret", terminal: null, g7, replicator, implementationAgreement:replicator?{...replicator,scope:"implementation-agreement",methodsCorroboration:false}:null, methodsValidity, certification, routeN, claims };
      }catch(e){
        if(!(e instanceof InvestigationPaused)&&!(e instanceof CodePolicyError))throw e;
        const claims=this.#out<CertifyOut>("certify").certification.claims.map(c=>({...c,limitations:[...c.limitations,"replication unavailable; prior certified evidence retained"]}));
        ctx.note("label-cap",{reason:"replication unavailable; prior certified evidence retained",hint:"infra"});
        const methodsValidity=await ctx.step("methods-validity",{},()=>this.#methodsValidity(ctx,this.#out<CertifyOut>("certify").certification));
        return {next:"interpret",terminal:null,g7:[],replicator:null,implementationAgreement:null,methodsValidity,certification:null,routeN:null,claims};
      }
    });
  }

  async #routeN(ctx: StepContext, g7: GateResult[]): Promise<RouteNOut> {
    const ind = this.spec.independentDataset!;
    const p = this.#out<PlanOut>("plan"), look = this.#out<LookOut>("look"), lk = this.#out<LockOut>("plan-lock");
    // The independent dataset's own host contract (a route N certification is bound to its own pin).
    const contract = await ctx.step("route-n-contract", { datasetId: ind.datasetId }, async (): Promise<ContractPin | null | { refused: string }> => {
      if (!this.#d.contracts) return null;
      try { return await this.#d.contracts.pin({ datasetId: ind.datasetId, dataRoot: ind.dataRoot }); }
      catch (e) { if (e instanceof ContractPinRefused) return { refused: e.message }; throw new InvestigationPaused("infra",String(e),"stage"); }
    });
    if (contract && "refused" in contract) return { datasetId: ind.datasetId, manifestHash: "", look: null, claims: null, reason: `independent data contract: ${contract.refused}` };
    const staged = await ctx.step("route-n-stage", { datasetId: ind.datasetId, contract }, async (): Promise<StagedData | { error: string }> => {
      try {
        return await this.#d.stager.stage({ investigationId: this.#id, datasetId: ind.datasetId, dataRoot: ind.dataRoot, expectedManifestHash: ind.expectedManifestHash ?? null, contract, route: "N", publicText: "" });
      } catch (e) { return { error: String((e as Error)?.message ?? e).slice(0, 300) }; }
    });
    if ("error" in staged) return { datasetId: ind.datasetId, manifestHash: "", look: null, claims: null, reason: `independent data could not be staged: ${staged.error}` };
    if (contract) {
      if (!staged.contractInput) return { datasetId: ind.datasetId, manifestHash: staged.manifestHash, look: null, claims: null, reason: "the stager produced no contract input for the independent data contract" };
      const check = await ctx.step("route-n-contract-verify", { contract: contract.expectedContractHash, input: staged.contractInput.manifestHash }, async () => verifyPinnedContract(contract, staged.contractInput!.dir,this.#d.contractVerification));
      if (!check.ok) return { datasetId: ind.datasetId, manifestHash: staged.manifestHash, look: null, claims: null, reason: `the independent data contract does not verify against its staged data (${check.code})` };
    }
    if (staged.manifestHash === this.#out<StageOut>("stage").staged!.manifestHash) return { datasetId: ind.datasetId, manifestHash: staged.manifestHash, look: null, claims: null, reason: "the independent dataset is the primary dataset: not independent" };
    const partitionId = `N:${staged.manifestHash.slice(0, 16)}:${this.#id}`;
    const executionId = `${this.#id}:route-n`;
    if (!this.#d.confirmation) return { datasetId: ind.datasetId, manifestHash: staged.manifestHash, look: null, claims: null, reason: "attested confirmation port unavailable; route N withheld" };
    try { await this.#d.fleet.beforeLook(`${this.#id}/route-n/preflight`); }
    catch (e) { if (!(e instanceof NetworkDown)) throw e; return { datasetId: ind.datasetId, manifestHash: staged.manifestHash, look: null, claims: null, reason: e.message }; }
    const outDir = this.#host("outputs", "route-n");
    const native = await ctx.step("route-n-confirm", { frozen: look.frozen.hash, partitionId }, () => this.#confirm(ctx, { investigationId: this.#id, datasetId: staged.datasetId, partitionId, route: "N", planHash: lk.planHash, frozenCodeHash: look.frozen.hash, contractHash: staged.contractHash, inputManifestHash: staged.manifestHash, executionId }, { bundleDir: look.frozen.dir, dataDir: staged.realDataDir, outDir, mode: "route-n", seed: this.#seed("route-n") }));
    const rec = native.record;
    if (!rec) return { datasetId: ind.datasetId, manifestHash: staged.manifestHash, look: null, claims: null, reason: native.reason ?? "native confirmation refused" };
    const entryBase = { number: rec.number, partitionId, route: "N" as const, sequence: rec.sequence, hash: rec.hash, frozenHash: look.frozen.hash };
    if (!rec.executable) return { datasetId: ind.datasetId, manifestHash: staged.manifestHash, look: { ...entryBase, status: "crash", category: null }, claims: null, reason: "route N look not executable" };
    const exec = native.result;
    const entry: LookEntry = { ...entryBase, status: exec.status, category: exec.status === "ok" ? null : errorCategory(exec.category) };
    if (exec.status !== "ok") return { datasetId: ind.datasetId, manifestHash: staged.manifestHash, look: entry, claims: null, reason: `route N run failed (${entry.category})` };
    const g8n = p.claims.filter((c) => !c.exploratory).map((c) => lookGate(c.id, { route: "N", partitionId, number: rec.number, recordedBeforeExecution: true }));
    const program = this.#out<CertifyOut>("certify").program;
    const result = await ctx.step("route-n-certify", { g8n, g7, program }, async () => this.#certifyData(this.#certifyRequest("route-n", [...g8n, ...g7], program, {
      lookOutputsDir: outDir, rawDir: contract && staged.contractInput ? staged.contractInput.dir : staged.realDataDir, firstLookAt: rec.sequence,
      expectedInputHash: contract && staged.contractInput ? staged.contractInput.manifestHash : staged.manifestHash, expectedContractHash: contract?.expectedContractHash ?? null, contract: contract ?? null,
      lock: { planHash: lk.planHash, lockedAt: lk.lock!.sequence },
    })));
    const claims = programLimitations(this.#applyAuditedCaps(ctx,"route-n",result.claims,rec.number), program.notes);
    return { datasetId: ind.datasetId, manifestHash: staged.manifestHash, look: entry, claims, reason: "the locked rule and frozen code ran once on independent data" };
  }

  // -------------------------------------------------------------- 10. interpret (resumed lead; certified outputs only)

  #interpret(): Promise<InterpretOut> {
    return this.machine.phase("interpret", {}, async (ctx) => {
      const st = this.#out<StageOut>("stage"), rep = this.#out<ReplicateOut>("replicate"), look = this.#out<LookOut>("look"), cert = this.#out<CertifyOut>("certify");
      const certification = this.#diagnosticGuard({...rep.certification ?? cert.certification,claims:rep.claims});
      const integrity = cert.certification.integrity ?? certification.integrity ?? unavailableIntegrity();
      const publishedMetrics = {...certification.metrics,...integrityMetrics(integrity)};
      const certified = this.#share("certified");
      await ctx.step("publish-certified", { claims: rep.claims, metrics: publishedMetrics, integrity }, async () => {
        mkdirSync(certified, { recursive: true });
        writeFileSync(path.join(certified, "report.md"), certification.report);
        writeFileSync(path.join(certified, "claims.json"), JSON.stringify(certification.claims.map((c) => ({ claimId: c.claimId, kind: c.kind, status: c.status, reasons: c.reasons, limitations: c.limitations })), null, 2));
        writeFileSync(path.join(certified, "metrics.json"), JSON.stringify(publishedMetrics, null, 2));
        writeFileSync(path.join(certified, "diagnostics.json"), JSON.stringify(certification.diagnostics ?? [], null, 2));
        writeFileSync(path.join(certified, "official-answers.json"), JSON.stringify(certification.diagnosticIntegrity?.officialAnswers ?? {}, null, 2));
        writeFileSync(path.join(certified, "integrity.json"), JSON.stringify(integrity, null, 2));
        writeFileSync(path.join(certified, "errors.json"), JSON.stringify(look.looks.filter((l) => l.status !== "ok").map((l) => ({ look: l.number, category: l.category })), null, 2));
        return treeHash(certified);
      });
      if (certification.diagnosticIntegrity?.blocked.length) ctx.note("warning",{kind:"diagnostic-block",detail:certification.diagnosticIntegrity.line});
      const lead = look.lead;
      const turn = await this.#turn({
        ctx, jobId: `${this.#id}/interpret/turn`, kind: "plan", turn: "interpret", family: { mode: "any" }, session: lead,
        fresh: { workerJobId: `${this.#id}:lead`, workdir: this.#work("lead") },
        mounts: [{ role: "certified", path: certified }, ...this.#runtime()],
        prompt: interpretPrompt({ id: this.#id, question: this.#out<QuestionOut>("question").question, certifiedDir: certified }),
        expect: [{ file: "interpretation.md", schema: "omb-markdown", required: true }],
      }, st.route, st.staged);
      const warnings: string[] = [];
      if (turn.job.endReason?.startsWith("network-down:")){ctx.note("label-cap",{reason:"interpretation network unavailable; certified claims retained",hint:"infra"});return {next:"deliverable",terminal:null,interpretation:null,warnings:["interpretation unavailable; software report retained"]};}
      if (turn.hardStop) {
        warnings.push(`hard stop during interpretation (${turn.hardStop}): interpretation discarded`);
        return {...terminal("interpret","hard-stop",`Positive hard-stop evidence during interpretation: ${turn.hardStop}`,turn.hardStop),interpretation:null,warnings};
      }
      const text = turn.session ? readSmall(path.join(turn.session.workdir, "interpretation.md"), 200_000) : null;
      if (!turn.ok && text !== null) usableAfterFailure(turn, ctx);
      if (text === null) {
        warnings.push("no interpretation was written; the report carries software text only");
        return { next: "deliverable", terminal: null, interpretation: null, warnings };
      }
      const metrics = buildMetricTable({ metrics: publishedMetrics, primary: null });
      const rendered = renderProse(text, metrics);
      const addressed = new Set<string>();
      const interpretationText = rendered.text.replace(/\[i:(if_[a-f0-9]{64})\]/g, (_ref,id:string)=>{const value=renderIntegrityReference(integrity,id);if(value)addressed.add(id);return value??"(unknown integrity reference)";});
      const omitted = integrity.duplicates.groups.filter(g=>!addressed.has(g.id));
      if(omitted.length)warnings.push("Interpretation omitted trusted duplicate findings; software integrity section retains every finding.");
      const file = await ctx.step("store-interpretation", { hash: hashOf(interpretationText) }, async () => {
        const dest = this.#host("interpretation.md");
        writeFileSync(dest, interpretationText);
        return dest;
      });
      const typedNumbers = rendered.issues.filter((i) => i.kind === "typed-number").length;
      const unknownMetrics = rendered.issues.filter((i) => i.kind !== "typed-number").length;
      if (typedNumbers) warnings.push(`${typedNumbers} typed number(s) stripped from the interpretation (numbers must be [m:key] references)`);
      return { next: "deliverable", terminal: null, interpretation: { file, hash: hashOf(interpretationText), typedNumbers, unknownMetrics, references: [...rendered.references] }, warnings };
    });
  }

  // -------------------------------------------------------------- 11. deliverable

  #deliverable(): Promise<DeliverableOut> {
    return this.machine.phase("deliverable", {}, async (ctx) => {
      const done = this.machine.completed();
      const term = done.map((d) => d.output.terminal as Terminal | null).find((t) => t !== null) ?? null;
      const plan = this.machine.output<PlanOut>("plan");
      const literature = new BriefLedger(this.#d.ledger.literatureJournal ?? this.#d.journal, this.#id), brief = literature.frozen();
      const finalLook = this.machine.output<LookOut>('look')?.final;
      if (finalLook) await ctx.step('exploratory-idea-cards', { output: finalLook.outputsDir }, async () => {
        const directory = path.join(finalLook.outputsDir, 'exploratory');
        if (!existsSync(directory)) return [];
        if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink()) { ctx.note('warning', { kind: 'exploratory-output-invalid', category: 'infra', detail: 'Exploratory directory must be regular; ideas not recorded' }); return []; }
        return readdirSync(directory).sort().filter(name => name.endsWith('.json')).flatMap(name => {
          try {
            const bytes = readSmall(path.join(directory, name)); if (bytes === null) throw new LiteraturePayloadError('invalid exploratory output');
            const proposal: unknown = JSON.parse(bytes);
            if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal)) throw new LiteraturePayloadError('exploratory output must be an object');
            const p = proposal as Parameters<typeof recordIdea>[1];
            return [recordIdea(literature, { idea: p.idea, angle: p.angle, evidenceSeen: [`exploratory/${name}`], dataNeeded: p.dataNeeded, priority: p.priority }, !brief || !searchEnabled(brief.mode))];
          } catch (error) {
            if (!(error instanceof LiteraturePayloadError) && !(error instanceof SyntaxError)) throw error;
            ctx.note('warning', { kind: 'exploratory-output-invalid', category: 'infra', file: name, detail: `Exploratory idea not recorded: ${String(error)}` });
            return [];
          }
        });
      });
      if (!term && brief && searchEnabled(brief.mode)) await ctx.step('novelty-after-look', { briefHash: brief.sha256 }, async () => {
        if (!this.#d.literature) throw new InvestigationPaused('provider', 'Literature novelty port missing', 'deliverable');
        await this.#d.literature.novelty({ investigationId: this.#id, question: this.spec.question, briefHash: brief.sha256 });
        if (!literature.events().some(e => e.type === 'novelty-checked')) throw new InvestigationPaused('provider', 'Novelty judgments have not been recorded', 'deliverable');
        return true;
      });
      const planClaims = (plan?.claims ?? []).map((c) => ({ id: c.id, kind: c.kind }));
      const certified=this.machine.output<ReplicateOut>("replicate")?.claims??this.machine.output<CertifyOut>("certify")?.certification?.claims;
      const unguardedClaims: ClaimRecord[] = term?.kind==="hard-stop"?terminalClaims(planClaims,term):certified??(term?terminalClaims(planClaims,term):[]);
      const certification=this.machine.output<ReplicateOut>("replicate")?.certification??this.machine.output<CertifyOut>("certify")?.certification;
      const claims=certification && term?.kind!=="hard-stop" ? this.#diagnosticGuard({...certification,claims:unguardedClaims}).claims : unguardedClaims;
      const dir = this.#host("deliverable");
      const files = await ctx.step("render", { claims, terminal: term }, async () => renderPlanAmendments(dir, renderDeliverable({
        dir, protocolDeviations:this.machine.notes("protocol-deviation"), offRecord:this.machine.notes("dev-genesis").some(n=>n.offRecord===true), spec: this.spec, terminal: term, claims, outputs: Object.fromEntries(done.map((d) => [d.phase, d.output])),
        notes: {
          warnings: ctx.notes("warning"), routing: ctx.notes("routing"), refusals: ctx.notes("refusal"), dispatches: ctx.notes("turn-dispatch"),
        },
        registryCount: (() => { const m = this.machine.output<StageOut>("stage")?.staged?.manifestHash; return m ? this.#d.registry.count(m) : null; })(),
        degraded: this.#degraded(), separation: this.machine.output<StageOut>("stage")?.separation ?? NO_SEPARATION, journalHead: this.machine.head(), journalStream: this.machine.stream,
      }), this.machine.notes("plan-amendment")));
      if (!this.policy.keepWorkdirs) await ctx.step("cleanup", {}, async () => { removeTree(this.#work()); return true; });
      return { next: null, terminal: null, outcome: term, status: term ? term.kind : "complete", claims, dir, files };
    });
  }
}
