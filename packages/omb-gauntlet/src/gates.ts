// The gate interface (design section 5). Every gate reports passed / failed / not-run /
// not-applicable with software-produced evidence. Only "passed" (with evidence that satisfies the
// gate's own pass rule) counts as passed: not-run, not-applicable, absent, malformed and conflicting
// results never do. Producers: G1a, G1b, G2, G3, G4, G6 are pure code in this package; G1, G1c, G5a,
// G5b and the G6 cross-check are adapters over the toolpack; G7 (V8) and G8 (V5) are interfaces.

import { canonicalJson } from "../../bio-core/src/index.ts";
import { foldKey, normKey, isRecord, toJson, type Json } from "./json.ts";
import { decideCalibration, G5B_COVERAGE_METHOD, coverageMeetsNominal } from "./calibration.ts";
import { POLICY } from "./policy.ts";

export const GATE_IDS = [
  "G1", "G1a", "G1b", "G1c", "G2", "G3", "G4", "G5a", "G5b-power", "G5b-recovery", "G5c", "G6", "G7", "G8", "G9", "CIT",
] as const;
export type GateId = (typeof GATE_IDS)[number];

export const GATE_NAMES: Readonly<Record<GateId, string>> = {
  G1: "staging validity (duplicates, effective units)",
  G1a: "units contract",
  G1b: "unit-disjoint splits",
  G1c: "confounding",
  G2: "plan lock",
  G3: "recompute",
  G4: "reproduce from raw data",
  G5a: "null calibration",
  "G5b-power": "planted-effect power",
  "G5b-recovery": "planted-effect bias and coverage",
  G5c: "registered procedure within envelope",
  G6: "multiplicity",
  G7: "cross-family implementation agreement",
  G8: "single recorded look",
  G9: "held-out performance pack",
  CIT: "citation resolution",
};

export const GATE_OUTCOMES = ["passed", "failed", "not-run", "not-applicable"] as const;
export type GateOutcome = (typeof GATE_OUTCOMES)[number];

export interface GateResult {
  readonly gate: GateId;
  readonly outcome: GateOutcome;
  /** Case-folded claim ID; absent means the result applies to every claim of the plan. */
  readonly claimId?: string;
  /** Machine-readable finding, e.g. "aligned", "mismatch", "fabricated", "waived". */
  readonly code?: string;
  /** One line, software-written; never contains unit IDs. */
  readonly summary: string;
  readonly evidence: Readonly<Record<string, Json>>;
}

export function gateResult(
  gate: GateId, outcome: GateOutcome, summary: string,
  options: { claimId?: string | undefined; code?: string | undefined; evidence?: Record<string, unknown> } = {},
): GateResult {
  const result: { -readonly [K in keyof GateResult]: GateResult[K] } = {
    gate, outcome, summary, evidence: toJson(options.evidence ?? {}) as Record<string, Json>,
  };
  if (options.claimId !== undefined) result.claimId = foldKey(options.claimId);
  if (options.code !== undefined) result.code = options.code;
  return result;
}

/** Validate a gate result received as data (e.g. from another process). Malformed means absent. */
export function readGateResult(value: unknown): GateResult | null {
  if (!isRecord(value)) return null;
  const { gate, outcome, summary, claimId, code, evidence } = value;
  if (typeof gate !== "string" || !(GATE_IDS as readonly string[]).includes(gate)) return null;
  if (typeof outcome !== "string" || !(GATE_OUTCOMES as readonly string[]).includes(outcome)) return null;
  if (typeof summary !== "string") return null;
  if (claimId !== undefined && (typeof claimId !== "string" || !claimId.trim())) return null;
  if (code !== undefined && typeof code !== "string") return null;
  if (evidence !== undefined && !isRecord(evidence)) return null;
  return gateResult(gate as GateId, outcome as GateOutcome, summary, {
    claimId: claimId as string | undefined, code: code as string | undefined, evidence: (evidence ?? {}) as Record<string, unknown>,
  });
}

// ------------------------------------------------------------------ evidence pass rules

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

const count = (v: unknown): v is number => num(v) && Number.isSafeInteger(v) && v >= 0;
const positive = (v: unknown): v is number => count(v) && v > 0;
const empty = (v: unknown) => Array.isArray(v) && v.length === 0;
const probability = (v: unknown): v is number => num(v) && v >= 0 && v <= 1;
const hash = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const named = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

/** Families supported by the current V8 seam. Harness aliases do not create independence.
 * New families require a trusted mapping, not an arbitrary worker-provided name. */
function familyIdentity(value: string): string | null {
  const key = normKey(value);
  if (["claude", "claudecode", "anthropic"].includes(key)) return "anthropic";
  if (["codex", "openai", "gpt"].includes(key)) return "openai";
  return null;
}

/** Sequential G5a rule (design section 5), shared by the adapter and the board. */
export function decideG5a(stage1: { rejections: number; trials: number }, stage2?: { rejections: number; trials: number } | null):
  "pass" | "fail" | "extend" | "invalid" {
  const g = POLICY.g5a;
  const ok = (s: { rejections: number; trials: number }) => Number.isInteger(s.rejections) && Number.isInteger(s.trials) && s.rejections >= 0 && s.rejections <= s.trials;
  if (!ok(stage1) || stage1.trials !== g.stage1) return "invalid";
  if (stage2 && (!ok(stage2) || stage1.trials + stage2.trials !== g.total)) return "invalid";
  if (stage1.rejections <= g.passMax) return "pass";
  if (stage1.rejections >= g.failMin) return "fail";
  if (!stage2) return "extend";
  if (!ok(stage2) || stage1.trials + stage2.trials !== g.total) return "invalid";
  return stage1.rejections + stage2.rejections >= g.failMinTotal ? "fail" : "pass";
}

function stage(v: Json | undefined): { rejections: number; trials: number } | null {
  if (v === null || v === undefined || typeof v !== "object" || Array.isArray(v)) return null;
  const s = v as Record<string, Json>;
  return num(s.rejections) && num(s.trials) ? { rejections: s.rejections, trials: s.trials } : null;
}

/** Each gate's pass rule re-checked on the evidence (defense in depth): a "passed" whose evidence
 * does not satisfy the rule is not passed. Returns null when satisfied, else the reason. */
export const EVIDENCE_RULES: Readonly<Record<GateId, (e: Readonly<Record<string, Json>>) => string | null>> = {
  G9: (e) => {
    if(e.heldOut!==true||!positive(e.units)||e.beatsBaselines!==true||e.calibrationAvailable!==true||!isRecord(e.metrics)||!['auc','brier','ece','calibrationSlope','calibrationIntercept'].every(k=>num((e.metrics as Record<string,Json>)[k]))||!isRecord(e.comparisons))return 'performance pack unavailable';
    return ['no-information','majority-class','simple-rule'].every(k=>{const c=(e.comparisons as Record<string,Json>)[k];return isRecord(c)&&num(c.estimate)&&Array.isArray(c.ci)&&c.ci.length===2&&num(c.ci[0])&&num(c.ci[1])&&c.ci[0]>0&&c.ci[1]>=c.ci[0];})?null:'declared baselines not beaten';
  },
  G1: (e) => isRecord(e.facts) && Object.keys(e.facts).length > 0 && Object.values(e.facts).every(count)
    && Array.isArray(e.datasets) && e.datasets.length > 0 && e.datasets.every((d) => isRecord(d) && d.allowed === true && positive(d.effectiveN) && count(d.rowCount) && d.effectiveN <= d.rowCount)
    ? null : "staging facts or checked datasets missing",
  G1a: (e) => e.ruleVersion==='contract-v3' ? e.bytesVerified===true&&e.authenticated===true&&hash(e.contractHash)&&e.effectiveInputsVerified===true&&positive(e.rows)&&positive(e.effectiveN)&&e.effectiveN<=e.rows&&e.nUnits===e.effectiveN&&empty(e.findings)?null:'invalid contract unit evidence' : e.effectiveInputsVerified === true && positive(e.rows) && e.rows === e.nUnits && count(e.effectiveN) && e.rows === e.effectiveN && empty(e.findings) ? null : "invalid units evidence",
  G1b: (e) => e.ruleVersion==='contract-v3' ? e.authenticated===true&&hash(e.contractHash)&&hash(e.partitionHash)&&e.disjoint===true&&positive(e.rows)&&positive(e.units)&&e.units<=e.rows&&empty(e.findings)?null:'invalid contract partition evidence' : positive(e.rows) && positive(e.units) && e.units <= e.rows && positive(e.folds) && e.folds >= 2 && empty(e.findings) ? null : "invalid split evidence",
  G1c: (e) => empty(e.aligned) && empty(e.unhandled) && empty(e.insufficient) && Array.isArray(e.strong) && e.jointStatus === "estimable" && num(e.threshold) && e.threshold > 0 && e.threshold <= 0.5 ? null : "confounding not established",
  G2: (e) => hash(e.lockedHash) && e.lockedHash === e.currentHash && num(e.lockedAt) && num(e.firstLookAt) && e.lockedAt < e.firstLookAt ? null : "invalid lock evidence",
  G3: (e) => count(e.compared) && empty(e.mismatched) && empty(e.missingRecomputed) && num(e.relCap) && e.relCap >= 0 && (e.kernelRelativeTolerance===1e-8&&e.kernelAgreement===true?e.relCap<=1e-8:e.relCap<=POLICY.g3RelativeTolerance) && num(e.displayPrecisionCap) && e.displayPrecisionCap >= 0 && e.displayPrecisionCap <= POLICY.g3DisplayPrecisionCap ? null : "invalid recomputation evidence",
  "G5b-power": (e) => (probability(e.power) && e.power >= POLICY.powerThreshold && count(e.seeds) && e.seeds >= POLICY.plantedSeeds && probability(e.alpha) && e.alpha > 0 && e.alpha <= POLICY.alphaMax ? null : `power below ${POLICY.powerThreshold} or invalid evidence`),
  "G5b-recovery": (e) => e.calibrationMethod===G5B_COVERAGE_METHOD&&num(e.bias)&&num(e.seMean)&&e.seMean>=0&&probability(e.coverage)&&Array.isArray(e.coverageCI)&&e.coverageCI.length===2&&probability(e.coverageCI[0])&&probability(e.coverageCI[1])&&probability(e.ciLevel)&&e.ciLevel>=0.95&&e.coverageCI[0]<=e.coverageCI[1]&&e.coverageTolerance===POLICY.g5bCoverageTolerance&&coverageMeetsNominal(e.coverage,e.ciLevel,POLICY.g5bCoverageTolerance)&&e.coverageCalibrated===true&&count(e.seeds)&&e.seeds>=POLICY.plantedSeeds?null:"design-matched calibrated interval coverage not established",
  G5c: (e) => named(e.procedureId) && named(e.registryVersion) && hash(e.registryHash) && e.registered === true && e.withinEnvelope === true && e.diagnosticsPassed === true ? null : "procedure is absent, outside its envelope, or validity diagnostics did not pass",
  G6: (e) => {
    if(e.rule==="LORD++"){
      const ordinals=e.priorRejectionOrdinals;
      const validOrdinals=Array.isArray(ordinals)&&ordinals.every((v,i)=>count(v)&&v>0&&v<(e.hypothesisOrdinal as number)&&(i===0||(ordinals[i-1] as number)<v));
      // Program alpha is the nominal .05; a directional per-test threshold never exceeds one-sided .025.
      const alphaCap=e.direction==="two-sided"||e.direction==="greater"||e.direction==="less" ? .05 : 0;
      const thresholdCap=e.direction==="two-sided" ? 1 : POLICY.directionalAlphaMax;
      const registered=e.registeredOrdinals;
      const contiguous=Array.isArray(registered)&&registered.length===e.registeredHypotheses&&registered.every((v,i)=>v===i+1);
      return hash(e.outcomeDatasetHash)&&count(e.hypothesisOrdinal)&&e.hypothesisOrdinal>0&&count(e.registeredHypotheses)&&e.registeredHypotheses>=e.hypothesisOrdinal&&contiguous&&e.includingUnrun===true&&validOrdinals&&alphaCap>0&&num(e.alpha)&&e.alpha>0&&e.alpha<=alphaCap&&probability(e.threshold)&&e.threshold>0&&e.threshold<=e.alpha&&e.threshold<=thresholdCap&&probability(e.p)&&typeof e.adjustedDecision==="boolean"&&e.adjustedDecision===(e.p<=e.threshold)?null:"invalid LORD++ multiplicity evidence";
    }
    return named(e.family) && ["holm", "bonferroni", "bh"].includes(String(e.method)) && positive(e.members) && count(e.size) && e.size >= e.members && e.missingP === 0 && probability(e.pAdjusted) && (e.method !== "bh" || (e.screen === true && e.size >= POLICY.bhMinScreen)) ? null : "invalid multiplicity evidence";
  },
  CIT: (e) => positive(e.citations) && Array.isArray(e.statuses) && e.statuses.length === e.citations && e.statuses.every((s) => s === "verified") ? null : "citations not verified",
  G5a: (e) => {
    if(e.ruleVersion==='prediction-pair-v1')return e.kernelExecuted===true&&num(e.alpha)&&e.alpha>0&&e.alpha<=.05?null:'invalid prediction permutation evidence';
    if (e.ruleVersion === "alpha-aware-v2") {
      const first = stage(e.stage1), second = stage(e.stage2);
      if (!num(e.alpha) || !first || first.trials !== 200 || e.stage2 !== undefined && (!second || second.trials !== 400)) return "invalid alpha-aware evidence";
      if (!named(e.seedStream1) || second && (!named(e.seedStream2) || e.seedStream1 === e.seedStream2)) return "invalid seed streams";
      return decideCalibration(e.alpha, first.rejections, second?.rejections) === "pass" ? null : "alpha-aware calibration failed";
    }
    if (e.waived === true) return e.waiver === "unit-level-permutation-test" ? null : "unrecognised G5a waiver";
    if (e.stage2 !== undefined && !stage(e.stage2)) return "invalid extension evidence";
    const s1 = stage(e.stage1);
    if (!s1) return "null-calibration counts not reported";
    return decideG5a(s1, stage(e.stage2)) === "pass" ? null : "null-calibration counts do not pass the sequential rule";
  },
  G7: (e) => {
    const f = e.families;
    if (!Array.isArray(f) || f.length !== 2 || f.some((x) => typeof x !== "string" || !x.trim())) return "replication families not reported";
    const families = f.map((value) => familyIdentity(value as string));
    if (families.includes(null)) return "unrecognized model family";
    if (families[0] === families[1]) return "same-family agreement counts as zero";
    if (!num(e.seLead) || !num(e.seReplicator) || e.seLead < 0 || e.seReplicator < 0 || !num(e.tolerance) || e.tolerance > Math.hypot(e.seLead, e.seReplicator)) return "replication SE bound missing or exceeded";
    if (!num(e.deltaEstimate) || !num(e.tolerance) || e.tolerance < 0 || Math.abs(e.deltaEstimate) > e.tolerance) return "invalid replication difference or tolerance";
    if (e.sameDecision !== true) return "replication did not reach the same decision";
    if (e.withinTolerance !== true) return "replicated estimate outside min(sqrt(SE1^2+SE2^2), MEI/2)";
    return e.replicatorVerified === true ? null : "the replicator's code was not verified by software (G3/G4)";
  },
  G8: (e) => {
    if (e.route !== "P" && e.route !== "H" && e.route !== "N") return "look route not reported";
    if (!named(e.partitionId)) return "partition identity missing";
    if (e.lookNumber !== 1) return "not the first look on this partition";
    if (e.recordedBeforeExecution !== true) return "look not recorded before execution";
    return e.llmPresent === false ? null : "an LLM was present at the look";
  },
  G4: (e) => (e.classification === "reproduced" && positive(e.reruns) && e.reruns <= 2 && num(e.rel) && e.rel >= 0 && (e.rel <= POLICY.g4RelativeTolerance || e.trustedComputation===true&&e.kernelAgreement===true&&e.kernelRelativeTolerance===1e-8&&e.rel<=1e-8&&e.minimumSignificantDigits===3&&num(e.displayPrecisionCap)&&e.displayPrecisionCap>=0&&e.displayPrecisionCap<=POLICY.g3DisplayPrecisionCap) ? null : "re-run classification is not reproduced"),
};

// ------------------------------------------------------------------ board

export interface GateLookup {
  readonly gate: GateId;
  /** "absent" when no producer reported this gate. */
  readonly outcome: GateOutcome | "absent";
  readonly result: GateResult | null;
  readonly passed: boolean;
  /** Why a reported "passed" does not count (conflict or evidence rule), else null. */
  readonly reason: string | null;
}

function freezeEvidence(value:unknown):void {
  if(value===null||typeof value!=='object'||Object.isFrozen(value))return;
  for(const child of Object.values(value))freezeEvidence(child);
  Object.freeze(value);
}

/** All gate results for one plan. Claim-specific results take precedence over plan-wide ones. */
export class GateBoard {
  private readonly byKey = new Map<string, GateResult[]>();
  private readonly lookups = new Map<string, GateLookup>();

  constructor(results: readonly GateResult[]) {
    for (const raw of results) {
      if (!isRecord(raw) || !GATE_IDS.includes(raw.gate)) continue;
      const r = readGateResult(raw) ?? gateResult(raw.gate, "not-run", "malformed gate result", { claimId: typeof raw.claimId === "string" ? raw.claimId : undefined });
      const key = JSON.stringify([r.gate, r.claimId ?? null]);
      const list = this.byKey.get(key) ?? [];
      list.push(r);
      this.byKey.set(key, list);
    }
  }

  get results(): GateResult[] {
    return structuredClone([...this.byKey.values()].flat());
  }

  lookup(gate: GateId, claimId: string): GateLookup {
    return structuredClone(this.lookupStored(gate, claimId));
  }

  /** Immutable view for the labeller's repeated lookups. Public lookup() retains
   * its defensive-copy API; no consumer can mutate this cached evidence. */
  readonlyLookup(gate:GateId,claimId:string):GateLookup { return this.lookupStored(gate,claimId); }

  private lookupStored(gate: GateId, claimId: string): GateLookup {
    const key = JSON.stringify([gate, foldKey(claimId)]);
    const cached = this.lookups.get(key);
    if (cached) return cached;
    const value = this.computeLookup(gate, claimId);
    freezeEvidence(value);
    this.lookups.set(key, value);
    return value;
  }

  private computeLookup(gate: GateId, claimId: string): GateLookup {
    const specific = this.byKey.get(JSON.stringify([gate, foldKey(claimId)])) ?? [];
    const global = this.byKey.get(JSON.stringify([gate, null])) ?? [];
    const candidates = specific.length > 0 ? [...specific, ...global.filter((r) => r.outcome !== "passed" || EVIDENCE_RULES[gate](r.evidence) !== null)] : global;
    if (candidates.length === 0) return { gate, outcome: "absent", result: null, passed: false, reason: null };
    const first = candidates[0]!;
    const conflicting = candidates.slice(1).some((r) => r.outcome !== first.outcome || r.code !== first.code
      || canonicalJson(r.evidence) !== canonicalJson(first.evidence));
    if (conflicting) {
      const outcome: GateOutcome = candidates.some((r) => r.outcome === "failed") ? "failed" : candidates.some((r) => r.outcome !== "passed") ? "not-run" : "passed";
      return { gate, outcome, result: first, passed: false, reason: "conflicting results for this gate" };
    }
    if (first.outcome !== "passed") return { gate, outcome: first.outcome, result: first, passed: false, reason: null };
    const rule = EVIDENCE_RULES[gate];
    const reason = rule ? rule(first.evidence) : null;
    return { gate, outcome: "passed", result: first, passed: reason === null, reason };
  }

  passed(gate: GateId, claimId: string): boolean {
    return this.lookupStored(gate, claimId).passed;
  }
}
