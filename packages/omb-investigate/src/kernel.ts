import {unavailableIntegrity,type TrustedIntegrity} from "./integrity.ts";
// Production adapters from V7's ExecutorPort / CertifyPort onto today's omb-certify kernel:
// - KernelExecutor: snapshot the data directory as the plain worker input (no identity inference:
//   identity is the certifier's G1 domain, on the host contract), freeze the bundle's code inventory
//   (freezeCode) and run run_all.sh once in the offline Seatbelt executor (no network, group kill,
//   scratch deleted). Outputs are copied into the request's host outDir.
// - KernelCertifier: certifyDirectory on the frozen bundle with the host's pins, sealing V7's G7 and
//   G8 gate results with the GateAuthority under the exact binding certifyDirectory computes.
// Both are host-only: the GateAuthority key and state roots never reach a worker.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { canonicalSha256, sha256Canonical } from "../../bio-core/src/index.ts";
import {
  certifyDirectory, ContractAuthority, freezeCode, GateAuthority, OfflineExecutor, signedGates, snapshotContractFiles, stageWithContract, treeManifest, verifyContractBytes, type Binding, type ExecutorOptions,
} from "../../omb-certify/src/index.ts";
import { CodePolicyError, refusalRecord } from "../../omb-certify/src/source-policy.ts";
import { loadPinnedContract } from "./contracts.ts";
import { parsePlan, planLockHash } from "../../omb-gauntlet/src/index.ts";
import { treeHash } from "./bundle.ts";
import { lordDecisions } from "./multiplicity.ts";
import type { CertifyPort, CertifyRequest, CertifyResult, ExecRequest, ExecResult, ExecutorPort } from "./ports.ts";
import type { ClaimRecord, ErrorCategory } from "./types.ts";

export function categoryOf(reason: string,kind?:import('../../omb-certify/src/execution.ts').ExecutionKind): ErrorCategory {
  if(kind){switch(kind){
    case 'sandbox-unavailable':case 'census-fault':case 'host-fault':case 'cancelled':return 'infra';
    case 'data-unreadable':return 'data-unreadable';
    case 'timeout':return 'timeout';case 'output-cap':return 'output-cap';case 'output-link':return 'output-link';
    case 'missing-output':return 'missing-output';case 'bad-json':return 'invalid-output';
    case 'exit-nonzero':case 'survivor':case 'copy-denied':return 'exit-nonzero';
    default:{const exhaustive:never=kind;void exhaustive;return 'exit-nonzero';}
  }}
  const r = reason.toLowerCase();
  if (r.includes("deadline")) return "timeout";
  if (r.includes("analysis command failed")) return "exit-nonzero";
  if (r.includes("missing primary") || r.includes("no outputs")) return "missing-output";
  if (r.includes("invalid worker json") || r.includes("output size cap")) return "invalid-output";
  if (r.includes("memory")) return "memory-limit";
  return "exit-nonzero";
}

export interface KernelExecutorOptions extends Omit<ExecutorOptions, "scratchRoot"> {
  /** Host-only scratch for staging snapshots and execution copies. */
  scratchRoot: string;
  now: () => number;
  initialTimeoutMs?: number;
}

export class KernelExecutor implements ExecutorPort {
  readonly #o: KernelExecutorOptions;
  readonly #executor: OfflineExecutor;
  constructor(options: KernelExecutorOptions) {
    this.#o = options;
    mkdirSync(options.scratchRoot, { recursive: true, mode: 0o700 });
    this.#executor = new OfflineExecutor({ ...options, scratchRoot: path.join(options.scratchRoot, "exec") });
  }

  async health():Promise<void>{await this.#executor.health();}
  get timeoutBudget(): { initialMs:number; hardCapMs:number } { return {initialMs:this.#o.initialTimeoutMs ?? this.#o.timeoutMs,hardCapMs:this.#o.timeoutMs}; }
  async run(request: ExecRequest): Promise<ExecResult> {
    const job = mkdtempSync(path.join(this.#o.scratchRoot, "job-"));
    try {
      // The legacy Stager inferred identity here and refused multi-table data ("ambiguous biological
      // identity requires a locked declaration"), which surfaced as a retried "infra" crash (live
      // smoke p10/w0). Execution only needs the input bytes and prepare.sh.
      let staged:ReturnType<typeof stageWithContract>;
      try{staged=stageWithContract(request.dataDir,path.join(job,"stage"),undefined);}catch(e){return {status:"crash",category:"data-unreadable",kind:"data-unreadable",workerStarted:false,errorText:String(e),files:[],outputsHash:null,refusal:refusalRecord("staging","Host input parser unavailable",request.mode==="dry-run"?"pre-look":"post-look","guard-error")};}
      const frozen = freezeCode(request.bundleDir, path.join(job, "frozen"), readFileSync(path.join(request.bundleDir, "plan.json"), "utf8"));
      const timeoutMs=request.timeoutMs ?? this.timeoutBudget.initialMs;
      if(!Number.isFinite(timeoutMs) || timeoutMs<=0 || timeoutMs>this.#o.timeoutMs) throw new Error("executor timeout exceeds hard cap");
      const executor=timeoutMs===this.#o.timeoutMs ? this.#executor : new OfflineExecutor({...this.#o,scratchRoot:path.join(this.#o.scratchRoot,"exec"),timeoutMs});
      const exec = await executor.run(frozen, staged, "all", undefined, {}, request.mode === "dry-run" ? "synthetic" : "redacted");
      if (exec.status !== "ok") {
        return { ...(exec.kind?{kind:exec.kind}:{}),workerStarted:exec.workerStarted??false,exitCode:exec.exitCode??null,warnings:exec.warnings??[],cleanReceipt:exec.cleanReceipt??false,refusal: refusalRecord(exec.trustedChange ? "trusted-path-changed" : exec.refusal?.ruleId ?? categoryOf(exec.reason,exec.kind), exec.reason, request.mode === "dry-run" ? "pre-look" : "post-look", exec.refusal?.decision ?? "denied"), ...(exec.trustedChange ? { hardStop: "trusted-path-changed" } : {}), status: "crash", category: exec.trustedChange ? "infra" : exec.refusal?.ruleId === "write-outside-outputs" ? "exit-nonzero" : categoryOf(exec.reason,exec.kind), errorText: (exec.internalReason ? `executor internal fault: ${exec.internalReason}` : exec.reason) + (exec.syntheticStderr ? `\nSynthetic stderr (tail):\n${exec.syntheticStderr}` : ""), outputsHash: null, files: [] };
      }
      mkdirSync(request.outDir, { recursive: true, mode: 0o700 });
      const hashes: Record<string, string> = {};
      for (const [name, text] of Object.entries({...exec.files,...exec.binaryFiles}).sort(([a], [b]) => (a < b ? -1 : 1))) {
        const dest = path.join(request.outDir, name);
        mkdirSync(path.dirname(dest), { recursive: true });
        writeFileSync(dest, text);
        hashes[name] = Buffer.isBuffer(text)?canonicalSha256([...text]):sha256Canonical(text);
      }
      return { status: "ok",warnings:exec.warnings??[],...(exec.kind?{kind:exec.kind}:{}),workerStarted:exec.workerStarted??false,exitCode:exec.exitCode??null,cleanReceipt:exec.cleanReceipt??false, category: null, errorText: null, outputsHash: sha256Canonical(hashes), files: Object.keys(hashes) };
    } catch (e) {
      const policy=e instanceof CodePolicyError,decision=policy?e.refusal.decision:"guard-error";
      return { refusal: policy && request.mode === "dry-run" ? e.refusal : refusalRecord(policy ? "code-policy" : "infra", String((e as Error)?.message ?? e), request.mode === "dry-run" ? "pre-look" : "post-look", decision), status: "crash", category: policy ? "code-policy" : "infra", errorText: String((e as Error)?.message ?? e), outputsHash: null, files: [] };
    } finally {
      rmSync(job, { recursive: true, force: true });
    }
  }
}

export interface KernelCertifierOptions {
  contractVerification?:Omit<import("../../omb-certify/src/contract-verifier.ts").ContractVerificationOptions,"expectedContractHash">;
  /** Host-only state (never inside a worker scope). */
  stateRoot: string;
  authority: GateAuthority;
  executor: OfflineExecutor;
  now: () => number;
  simulations?: boolean;
  maxPermutations?: number;
  /** Host contract authority: issues the receipt for a pinned contract whose approval the stage
   * phase recorded, on the exact certification input. Absent: contracts stay unauthenticated. */
  contractAuthority?: ContractAuthority;
}

type HostContract = Pick<Parameters<typeof certifyDirectory>[0], "contract" | "expectedContractHash" | "contractVerification">;

export class KernelCertifier implements CertifyPort {
  constructor(private readonly o: KernelCertifierOptions) { mkdirSync(o.stateRoot, { recursive: true, mode: 0o700 }); }

  async certify(req: CertifyRequest): Promise<CertifyResult> {
    const job = mkdtempSync(path.join(this.o.stateRoot, `${req.pass}-`));
    try {
      // The bundle must still be exactly what V7 froze (plan.json included).
      if (treeHash(req.bundleDir) !== req.expectedCodeHash) {
        return { claims: [], metrics: {}, report: "certification refused: the frozen bundle changed after freeze", warnings: ["trusted-path-changed: frozen bundle"], gates: [], multiplicity: [] };
      }
      const plan = parsePlan(readFileSync(path.join(req.bundleDir, "plan.json"), "utf8")).plan;
      const kernelCode = freezeCode(req.bundleDir, path.join(job, "frozen-probe"));
      const { host, contractBinding } = hostContractInput(req, this.o.contractAuthority,this.o.contractVerification);
      // The binding certifyDirectory computes: a verified contract adds its contract/partition pins.
      const binding: Binding = { planHash: plan ? planLockHash(plan) : canonicalSha256(null), inputManifestHash: canonicalSha256(treeManifest(req.rawDir)), frozenCodeHash: kernelCode.hash, executionId: req.executionId, ...contractBinding };
      const report = await certifyDirectory({
        workdir: req.bundleDir, rawDir: req.rawDir, stateRoot: path.join(job, "state"), executionId: req.executionId, lock: req.lock, firstLookAt: req.firstLookAt,
        now: this.o.now, authority: this.o.authority, executor: this.o.executor, expectedInputHash: req.expectedInputHash, expectedCodeHash: kernelCode.hash,
        externalGates: signedGates(this.o.authority, binding, req.externalGates),
        // Host-owned task-card targets, bound by certifyDirectory to the locked estimand (cardMatches).
        reproductionTargets: req.reproductionTargets as Parameters<typeof certifyDirectory>[0]["reproductionTargets"] & object,
        // OS-user separation from the stage phase's verified attestation (never a host flag alone);
        // certifyDirectory caps Confirmed without it.
        osUserSeparation: req.osUserSeparation === true && !req.degraded,
        // The pinned host contract (stage phase) on its contract input: G1/G1a run on the host declaration.
        ...host,
        // Program-wide G6: the registry's LORD++ state (the kernel fails G6 closed without it).
        programMultiplicity: req.programMultiplicity, hypothesisOrdinals: req.hypothesisOrdinals,
        ...(this.o.simulations === false ? { simulations: false } : {}), ...(this.o.maxPermutations ? { maxPermutations: this.o.maxPermutations } : {}),
      });
      const claims: ClaimRecord[] = report.certification.assessments.map((a) => ({
        claimId: a.claimId, kind: a.kind, status: a.status, taskStatus: a.taskStatus, reasons: [...a.label.reasons], limitations: [...a.limitations], voided: a.label.voided,
      }));
      const metrics: Record<string, number> = {};
      for (const [k, v] of report.certification.metrics.values) if (typeof v === "number" && Number.isFinite(v)) metrics[k] = v;
      const diagnosticFields = report as typeof report & Pick<CertifyResult, "diagnostics" | "outputs" | "fieldSources" | "claimSources">;
      return {
        ...(diagnosticFields.diagnostics ? {diagnostics:diagnosticFields.diagnostics} : {}),
        ...(diagnosticFields.outputs ? {outputs:diagnosticFields.outputs} : {}),
        ...(diagnosticFields.fieldSources ? {fieldSources:diagnosticFields.fieldSources} : {}),
        ...(diagnosticFields.claimSources ? {claimSources:diagnosticFields.claimSources} : {}),
        ...(report.reportBindings?{reportBindings:report.reportBindings}:{}),
        ...(report.dataSummaries?{dataSummaries:report.dataSummaries}:{}),
        ...(report.integrityFacts?.length?{integrityFacts:report.integrityFacts}:{}),
        claims, metrics, report: report.report, warnings: [...report.warnings],
        integrity: (report as typeof report & {integrity?:TrustedIntegrity}).integrity ?? unavailableIntegrity("Integrity projection missing from certifier"),
        gates: report.gates.map((g) => ({ gate: g.result.gate, claimId: g.result.claimId ?? null, outcome: g.result.outcome })),
        multiplicity: lordDecisions(report.gates.map((g) => g.result)),
      };
    } finally {
      rmSync(job, { recursive: true, force: true });
    }
  }
}

/**
 * The host contract input for certifyDirectory. The contract is the stage phase's pin (host index
 * hash, host-only file), never anything from the worker. A receipt is issued only for a contract
 * whose approval the stage phase recorded, and only when its bytes verify on this exact input;
 * otherwise the contract is passed unauthenticated (G1/G1a cannot pass: fail closed). An
 * unreadable pinned file still declares the contract intent, so no worker byte is staged.
 * `contractBinding` is what certifyDirectory adds to its gate binding for a verified contract.
 */
export function hostContractInput(req: Pick<CertifyRequest, "contract" | "rawDir">, contractAuthority?: ContractAuthority,context:Omit<import("../../omb-certify/src/contract-verifier.ts").ContractVerificationOptions,"expectedContractHash">={}): { host: HostContract; contractBinding: Partial<Binding> } {
  if (!req.contract) return { host: {}, contractBinding: {} };
  const expectedContractHash = req.contract.expectedContractHash;
  const contract = loadPinnedContract(req.contract) as HostContract["contract"] | null;
  if (!contract) return { host: { expectedContractHash }, contractBinding: {} };
  let verified: ReturnType<typeof verifyContractBytes> | null = null;
  try { verified = verifyContractBytes(contract, snapshotContractFiles(req.rawDir), { ...context,expectedContractHash }); } catch { verified = null; }
  if (!verified?.ok) return { host: { contract, expectedContractHash }, contractBinding: {} };
  const v = verified.value;
  const contractBinding = { contractHash: v.contract.public.hash, partitionHash: v.partitionHash, privateContractHash: v.contract.sealed_private?.hash ?? null };
  const authority = req.contract.approval ? contractAuthority : undefined;
  return {
    host: { contract, expectedContractHash, ...(authority ? { contractVerification: { authority, receipt: authority.approve(v, null) } } : {}) },
    contractBinding,
  };
}
