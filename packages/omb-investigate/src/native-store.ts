import type { Journal } from './journal.ts';
import { BriefLedger } from '../../omb-literature/src/brief.ts';
import { canonicalJson } from "../../bio-core/src/index.ts";
import { runConfirm, type OmbStore, type ApplyPlan, type ConfirmRequest, type ConfirmResult, type ConfirmBackend, type OSUserAttestation, type Look } from "../../omb-store/src/index.ts";
import type { ConfirmationPort, ExecRequest, ExecResult, CertifyRequest, ContentTuple, LockLedgerPort, PlanLockRequest, LookRequest, LookRecord, LockReceipt } from "./ports.ts";

/** Host-owned K1/V5 preparation. Must already have the authentic L0-L3 chain; missing is refused. */
export interface NativeBindings {
  datasetId: string; partitionId: string; dataHash: string; contractHash: string; partitionHash: string;
  registryVersion: string; calibrationResultHash: string; trainingArtifactHash: string; route: "P" | "H" | "N"; confirmingManifestHash: string; apply: ApplyPlan;
}
export class NativeStoreLedger implements LockLedgerPort {
  constructor(private readonly store: OmbStore | null, private readonly binding: (investigationId: string) => NativeBindings, readonly literatureJournal?: Journal, private readonly remote?: LockLedgerPort) {}
  static remote(port: LockLedgerPort, literatureJournal?: Journal): NativeStoreLedger { return new NativeStoreLedger(null, () => { throw new Error("remote binding"); }, literatureJournal, port); }
  async lockPlan(request: PlanLockRequest): Promise<LockReceipt> {
    if (request.literatureBriefHash) {
      if (!this.literatureJournal) throw new Error('native V8 requires a host StoreJournal for literature');
      const literature = new BriefLedger(this.literatureJournal, request.investigationId);
      if (literature.frozen()?.sha256 !== request.literatureBriefHash) throw new Error('native literature hash mismatch');
      literature.assertLook(request.planHash);
    }
    if (this.remote) return this.remote.lockPlan(request);
    const b = this.binding(request.investigationId);
    if (request.datasetId !== b.datasetId || request.contractHash !== b.contractHash || request.partitionHash !== b.partitionHash || request.registryVersion !== b.registryVersion) throw new Error("native plan binding mismatch");
    // The L4 content address binds the statement/paper set as well as the kernel plan and apply rule.
    const {planFile: _transportPath, ...persisted} = request;
    const bytes = Buffer.from(canonicalJson({ apply: b.apply, plain_statement: request.plainStatement, paper_set: request.paperSet, v7: persisted }));
    const planHash = this.store!.putArtifact(bytes);
    const prior = this.store!.timeline(b.datasetId).find(e => e.record.stage === "L4-plan-lock");
    if (prior) {
      if (prior.record.stage !== "L4-plan-lock" || prior.record.plan_hash !== planHash) throw new Error("native locked plan changed");
      return { sequence: prior.record.sequence, hash: prior.hash };
    }
    const entry = this.store!.lock(b.datasetId, { stage: "L4-plan-lock", plan_hash: planHash, public_contract_hash: b.contractHash, partition_hash: b.partitionHash, registry_version: b.registryVersion, calibration_result_hash: b.calibrationResultHash });
    return { sequence: entry.record.sequence, hash: entry.hash };
  }
  #plan(investigationId: string) {
    const b = this.binding(investigationId), entry = this.store!.timeline(b.datasetId).find(e => e.record.stage === "L4-plan-lock");
    if (!entry || entry.record.stage !== "L4-plan-lock") throw new Error("native L4 missing");
    const payload = JSON.parse(this.store!.artifact(entry.record.plan_hash).toString()) as { v7: PlanLockRequest };
    if (payload.v7.investigationId !== investigationId) throw new Error("native investigation binding mismatch");
    return { b, planHash: entry.record.plan_hash, request: payload.v7 };
  }
  async recordFreeze(request: { investigationId: string; planHash: string; frozenCodeHash: string; attempt: number; bundleDir?: string }): Promise<LockReceipt> {
    if (this.remote) return this.remote.recordFreeze(request);
    const p = this.#plan(request.investigationId);
    if (p.request.planHash !== request.planHash) throw new Error("native freeze plan mismatch");
    // Bytes must have been pinned by the trusted freezer. V7 tree hashes cannot masquerade as artifacts.
    if (!this.store!.hasArtifact(request.frozenCodeHash)) throw new Error("native frozen code artifact missing");
    const prior = this.store!.timeline(p.b.datasetId).find(e => e.record.stage === "L5-training");
    if (prior) {
      if (prior.record.stage !== "L5-training" || prior.record.frozen_code_hash !== request.frozenCodeHash) throw new Error("native freeze changed after L5");
      return { sequence: prior.record.sequence, hash: prior.hash };
    }
    const artifact = p.b.trainingArtifactHash;
    if (!this.store!.hasArtifact(artifact)) throw new Error("native trained artifact missing");
    const entry = this.store!.lock(p.b.datasetId, { stage: "L5-training", plan_hash: p.planHash, frozen_code_hash: request.frozenCodeHash, artifact_hash: artifact, dev_only: true });
    return { sequence: entry.record.sequence, hash: entry.hash };
  }
  #map(investigationId: string, look: Look): LookRecord {
    return { investigationId, partitionId: look.partitionId, route: this.binding(investigationId).route, number: look.number, executable: look.executable, sequence: look.record.sequence, hash: look.hash, executionId: look.attempt.executionId, frozenCodeHash: look.record.frozen_code_hash };
  }
  async looks(investigationId: string): Promise<LookRecord[]> {
    if (this.remote) return this.remote.looks(investigationId);
    const b = this.binding(investigationId);
    return this.store!.events().filter(e => e.kind === "look").map(e => e.payload as Look).filter(l => l.datasetId === b.datasetId).map(l => this.#map(investigationId, l));
  }
  async recordLook(request: LookRequest): Promise<LookRecord> {
    if (this.remote) return this.remote.recordLook(request);
    const p = this.#plan(request.investigationId);
    if (request.datasetId !== p.b.datasetId || request.partitionId !== p.b.partitionId || request.planHash !== p.request.planHash || request.contractHash !== p.b.contractHash || request.inputManifestHash !== p.b.confirmingManifestHash || request.route !== p.b.route) throw new Error("native look binding mismatch");
    const look = this.store!.recordLook(p.b.datasetId, p.b.partitionId, { registryVersion: p.b.registryVersion, planLockHash: p.planHash, contractHash: p.b.contractHash, frozenCodeHash: request.frozenCodeHash, dataHash: p.b.dataHash }, request.executionId, this.store!.separation);
    return { ...this.#map(request.investigationId, look), route: request.route };
  }
  seed(tuple: Partial<ContentTuple>, purpose: string): string {
    if (this.remote) return this.remote.seed(tuple, purpose);
    return this.store!.seed({ registryVersion: tuple.registryVersion || "unavailable/v7", planLockHash: tuple.planLockHash || "0".repeat(64), contractHash: tuple.contractHash || "0".repeat(64), frozenCodeHash: tuple.frozenCodeHash || "0".repeat(64), dataHash: tuple.dataHash || "0".repeat(64) }, purpose);
  }
}

export interface ConfirmLauncherPort {
  confirm(request: Omit<ConfirmRequest, "mode">): Promise<ConfirmResult>;
}
/** The narrow launcher client supplies only these two host ports. No UID inference or fallback. */
export class StoreConfirmLauncher implements ConfirmLauncherPort {
  constructor(private readonly backend: ConfirmBackend, private readonly attest: () => OSUserAttestation) {}
  confirm(request: Omit<ConfirmRequest, "mode">): Promise<ConfirmResult> {
    return runConfirm({ ...request, mode: { kind: "os-users", backend: this.backend, attest: this.attest } });
  }
}
export const unavailableConfirmLauncher: ConfirmLauncherPort = {
  async confirm() { return { look: null, status: "refused", claimCeiling: "Tentative", separation: "no OS-user separation", curatedEligible: false, sequestration: "internal, not sequestered", predictions: [], limitation: "narrow launcher not installed; OS-user attestation unavailable" }; },
};

/** K1/freezer preparation and prediction certification stay explicit trusted ports. There is no
 * default implementation that can re-open raw held-out tables or fabricate missing native pins. */
export class NativeConfirmation implements ConfirmationPort {
  static remote(transport: ConfirmationPort): NativeConfirmation { return new NativeConfirmation(null, transport); }
  constructor(private readonly ports: {
    launcher: ConfirmLauncherPort;
    prepare: (request: Parameters<ConfirmationPort["run"]>[0]) => Omit<ConfirmRequest, "mode">;
    evaluate: (result: ConfirmResult, execution: ExecRequest) => Promise<ExecResult>;
    certify: ConfirmationPort["certify"];
  } | null, private readonly remote?: ConfirmationPort) {}
  async run(request: Parameters<ConfirmationPort["run"]>[0]) {
    if (this.remote) return this.remote.run(request);
    const native = this.ports!.prepare(request);
    if (native.datasetId !== request.look.datasetId || native.partitionId !== request.look.partitionId || native.executionId !== request.look.executionId || native.tuple.frozenCodeHash !== request.look.frozenCodeHash || native.tuple.contractHash !== request.look.contractHash || native.tuple.dataHash !== request.look.inputManifestHash) throw new Error("native confirmation identity mismatch");
    const out = await this.ports!.launcher.confirm(native);
    if (out.look && (out.look.datasetId !== native.datasetId || out.look.partitionId !== native.partitionId || out.look.attempt.executionId !== native.executionId || canonicalJson(out.look.attempt.tuple) !== canonicalJson(native.tuple) || out.look.record.frozen_code_hash !== native.tuple.frozenCodeHash)) throw new Error("native returned look binding mismatch");
    const record: LookRecord | null = out.look ? { investigationId: request.look.investigationId, partitionId: out.look.partitionId, route: request.look.route,
      number: out.look.number, executable: out.look.executable, sequence: out.look.record.sequence, hash: out.look.hash,
      executionId: out.look.attempt.executionId, frozenCodeHash: request.look.frozenCodeHash } : null;
    if (out.status !== "completed" || out.separation !== "OS-user separation" || out.claimCeiling !== "requires-certification" || out.look?.separation !== "os-users" || !record?.executable) return { record,
      result: { status: "crash" as const, category: "infra" as const, errorText: null, outputsHash: null, files: [] }, reason: out.limitation ?? "attested confirmation incomplete" };
    return { record, result: await this.ports!.evaluate(out, request.execution), reason: null };
  }
  certify(request: CertifyRequest) { return this.remote ? this.remote.certify(request) : this.ports!.certify(request); }
}
