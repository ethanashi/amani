import { enforceDiagnostics } from "./diagnostics.ts";
import type { CertifyResult, ProcedureResolution } from "./ports.ts";
import {unavailableIntegrity,renderIntegrity,type TrustedIntegrity} from "./integrity.ts";
// The deliverable: a software-rendered report bundle plus the PaperInput fields omb-paper's
// plan-lineage adapter (PW0) needs from V7 (paper_writer_design §1, §4 and §13). Every label and
// number here comes from software records; the interpretation is the only model text, marked as
// such, with numbers rendered from [m:key] references.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { canonicalJson, sha256Canonical } from "../../bio-core/src/index.ts";
import { fileSha256 } from "./bundle.ts";
import type { ClaimRecord, InvestigationSpec, Json, JsonObject, Terminal } from "./types.ts";

export interface DeliverableInput {
  offRecord?: boolean;
  protocolDeviations?: JsonObject[];
  dir: string;
  spec: InvestigationSpec;
  terminal: Terminal | null;
  claims: ClaimRecord[];
  /** Phase outputs by phase id (journaled records). */
  outputs: Record<string, JsonObject>;
  notes: { warnings: JsonObject[]; routing: JsonObject[]; refusals: JsonObject[]; dispatches: JsonObject[] };
  registryCount: number | null;
  degraded: boolean;
  /** How OS-user separation was (not) established: the attestation outcome and the reason. */
  separation?: { separated: boolean; attested: boolean; reason: string; attestation: { releaseHash: string } | null } | null;
  journalHead: string | null;
  journalStream: string;
}

const obj = (v: Json | undefined): JsonObject => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
const arr = (v: Json | undefined): Json[] => (Array.isArray(v) ? v : []);
const str = (v: Json | undefined): string | null => (typeof v === "string" ? v : null);
const esc = (s: string): string => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

function ordinalText(k: number): string {
  const s = ["th", "st", "nd", "rd"], v = k % 100;
  return `${k}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

/** The fields V7 owns for omb-paper's PaperInput (one plan lineage = one investigation). */
function integrityOf(input:DeliverableInput):TrustedIntegrity {
  const cert=obj(obj(input.outputs.certify).certification),rep=obj(obj(input.outputs.replicate).certification);
  return (cert.integrity??rep.integrity??unavailableIntegrity()) as TrustedIntegrity;
}

export function publicationResult(input: DeliverableInput): CertifyResult {
  const first = obj(obj(input.outputs.certify).certification);
  const last = obj(obj(input.outputs.replicate).certification);
  const result = (Object.keys(last).length ? last : first) as unknown as Partial<CertifyResult>;
  const assumptions = Object.values(obj(obj(input.outputs["plan-lock"]).procedures)).flatMap(p => (p as unknown as ProcedureResolution).assumptions ?? []);
  const diagnostics = [...arr(first.diagnostics),...arr(last.diagnostics)] as unknown as NonNullable<CertifyResult["diagnostics"]>;
  return enforceDiagnostics({metrics:{},report:"",warnings:[],gates:[],multiplicity:[],...result,claims:input.claims,diagnostics:diagnostics.filter((d,i,a)=>a.findIndex(x=>sha256Canonical(x)===sha256Canonical(d))===i)}, assumptions);
}

export function paperInputFields(input: DeliverableInput): JsonObject {
  const publication = publicationResult(input);
  input = {...input, claims:publication.claims};
  const o = input.outputs;
  const plan = obj(o.plan), lock = obj(o["plan-lock"]), stage = obj(o.stage), look = obj(o.look), rep = obj(o.replicate), freeze = obj(o.freeze);
  const staged = obj(stage.staged);
  const ordinals = obj(lock.ordinals);
  const paperSet = arr(lock.paperSet ?? plan.paperSet).map(String);
  const workers = input.notes.dispatches.map((d) => ({ job: str(d.jobId), family: str(d.family), resumed: d.resumed === true, rerouted: d.rerouted === true }));
  const datasets: Json[] = [];
  if (staged.manifestHash) datasets.push({ datasetId: str(staged.datasetId), manifestHash: str(staged.manifestHash), contractHash: str(staged.contractHash) ?? null, role: "primary", used: true, reason: null });
  const routeN = obj(rep.routeN);
  if (routeN.datasetId) datasets.push({ datasetId: str(routeN.datasetId), manifestHash: str(routeN.manifestHash), contractHash: null, role: "independent (route N)", used: routeN.claims !== null && routeN.claims !== undefined, reason: str(routeN.reason) });
  return {
    schema: "omb-investigate/paper-input-fields@1",
    lineageId: input.spec.id,
    protocolDeviations: input.protocolDeviations ?? [],
    literatureBrief: plan.literatureBrief ?? null,
    literatureBriefHash: obj(plan.literatureBrief).sha256 ?? null,
    question: { text: input.spec.question, plainStatement: input.spec.plainStatement },
    plan: {
      lockHash: str(lock.planHash), lockSequence: (obj(lock.lock).sequence as number | undefined) ?? null, lockRecordHash: str(obj(lock.lock).hash),
      plainStatement: str(lock.plainStatement) ?? str(plan.plainStatement), paperSet, approvalActor: str(lock.approvalActor),
      planBytesHash: str(plan.planBytesHash), procedures: lock.procedures ?? {}, repairRounds: (plan.repairRounds as number | undefined) ?? 0,
    },
    looks: arr(look.looks),
    integrity: integrityOf(input),
    diagnosticIntegrity: publication.diagnosticIntegrity as unknown as Json,
    certifications: [
      ...(o.certify ? [{ pass: "certify", reportHash: sha256Canonical(str(obj(obj(o.certify).certification).report) ?? ""), gates: arr(obj(obj(o.certify).certification).gates) }] : []),
      ...(rep.certification ? [{ pass: "replicate", reportHash: sha256Canonical(str(obj(rep.certification).report) ?? ""), gates: arr(obj(rep.certification).gates) }] : []),
    ],
    claims: input.claims.map((c) => ({
      claimId: c.claimId, kind: c.kind, status: c.status, taskStatus: c.taskStatus, voided: c.voided, inPaperSet: paperSet.includes(c.claimId),
      hypothesisOrdinal: typeof ordinals[c.claimId] === "number" ? ordinals[c.claimId]! : null, reasons: c.reasons, limitations: c.limitations,
    })),
    hypothesisCounts: { manifest: str(staged.manifestHash), totalOnManifest: input.registryCount, byClaim: ordinals, program: input.spec.program ? { ...input.spec.program } : null },
    // Program-wide G6: the LORD++ state the kernel decided with and its software decisions.
    multiplicity: o.certify ? { state: obj(obj(o.certify).program).datasets ?? [], decisions: obj(obj(o.certify).certification).multiplicity ?? [], notes: obj(obj(o.certify).program).notes ?? [] } : null,
    implementationAgreement: rep.implementationAgreement ?? (rep.replicator ? {...obj(rep.replicator),scope:"implementation-agreement",methodsCorroboration:false} : null),
    methodsValidity: rep.methodsValidity ?? {status:"not-evaluable",objections:[],advisory:true},
    routeN: o.replicate ? (rep.routeN ?? null) : null,
    datasets,
    frozenCodeHash: str(obj(look.frozen).hash) ?? str(obj(freeze.frozen).hash),
    workers,
    refusals: input.notes.refusals.map((r) => ({ family: str(r.family), status: str(r.status), scored: false })),
    deviations: input.notes.warnings.filter((w) => w.kind === "plan-edited-after-lock").map((w) => ({ kind: str(w.kind), detail: str(w.detail), postUnblinding: false })),
    exploratoryClaims: arr(plan.claims).filter((c) => obj(c).exploratory === true).length,
    degraded: input.degraded,
    separation: input.separation ? { separated: input.separation.separated, attested: input.separation.attested, reason: input.separation.reason, releaseHash: input.separation.attestation?.releaseHash ?? null } : null,
    terminal: input.terminal ? { ...input.terminal } : null,
    journal: { stream: input.journalStream, head: input.journalHead },
  };
}

export function renderReport(input: DeliverableInput): string {
  const publication = publicationResult(input);
  input = {...input,claims:publication.claims};
  const o = input.outputs;
  const lock = obj(o["plan-lock"]), look = obj(o.look), rep = obj(o.replicate), stage = obj(o.stage), interp = obj(o.interpret);
  const ordinals = obj(lock.ordinals);
  const lines: string[] = [];
  lines.push(`# ${input.spec.question}`, "", `**Plain statement:** ${input.spec.plainStatement}`, "");
  lines.push(`Investigation \`${input.spec.id}\`. Status: **${input.terminal ? input.terminal.kind : "complete"}**${input.degraded ? " (degraded single-user mode: every label capped at Tentative)" : ""}.`, "");
  if (input.terminal) lines.push(`> ${input.terminal.kind}${input.terminal.stop ? ` (${input.terminal.stop})` : ""} in ${input.terminal.phase}: ${input.terminal.reason}`, "");
  lines.push("## Claims (labels written by software)", "", "| Claim | Kind | Status | Hypothesis on this manifest | Reasons |", "|---|---|---|---|---|");
  for (const c of input.claims) {
    const k = typeof ordinals[c.claimId] === "number" ? ordinalText(ordinals[c.claimId] as number) : "not known";
    lines.push(`| ${esc(c.claimId)} | ${esc(c.kind ?? "")} | ${c.status}${c.voided ? " (voided)" : ""} | ${k} | ${esc(c.reasons.join("; "))} |`);
  }
  if (input.claims.length === 0) lines.push("| (no locked claims) | | | | |");
  lines.push("");
  if (input.separation) lines.push("## OS-user separation", "", `- ${input.separation.separated ? "Established" : "Not established"}: ${input.separation.reason}`, "");
  const contract = obj(stage.contract);
  if (typeof contract.expectedContractHash === "string") {
    const approval = obj(contract.approval);
    lines.push("## Data contract (host-pinned before any model turn)", "", `- Data contract: \`${contract.expectedContractHash}\` (${approval.actor ? `approved by ${String(approval.actor)} (${String(approval.status)}): ${String(approval.reason)}` : "not approved: certification cannot authenticate it, so G1a cannot pass"})`, "");
  }
  if (lock.planHash) {
    lines.push("## Plan lock", "", `- Plan hash: \`${String(lock.planHash)}\` (ledger sequence ${String(obj(lock.lock).sequence ?? "?")}, approved by ${String(lock.approvalActor)})`);
    lines.push(`- Paper set: ${arr(lock.paperSet).map(String).join(", ") || "(none)"}`, `- Route: ${String(stage.route)}${arr(stage.routeReasons).length ? ` (${arr(stage.routeReasons).map(String).join("; ")})` : ""}`, "");
  }
  const procedures = Object.entries(obj(lock.procedures)).map(([id, v]) => [id, obj(v)] as const);
  if (procedures.length) {
    lines.push("## Registered procedures (selected at the lock by the locked estimand and design)", "", "| Claim | Procedure | Note |", "|---|---|---|");
    for (const [id, p] of procedures) lines.push(`| ${esc(id)} | ${p.procedureId ? esc(String(p.procedureId)) : "none"} | ${esc(String(p.reason ?? ""))} |`);
    lines.push("");
  }
  const looks = arr(look.looks).map(obj);
  if (looks.length) {
    lines.push("## Looks (software only, recorded before execution)", "", "| Look | Route | Ledger sequence | Result |", "|---|---|---|---|");
    for (const l of looks) lines.push(`| ${String(l.number)} | ${String(l.route)} | ${String(l.sequence)} | ${l.status === "ok" ? "ran" : `crashed (${String(l.category ?? "refused")})`} |`);
    lines.push("");
  }
  if (o.replicate) {
    const r = obj(rep.replicator);
    lines.push("## Implementation agreement (same locked plan; not methods corroboration)", "", rep.replicator ? `- G7: replicator family ${String(r.family ?? "none")}; ${String(r.reason)}` : "- G7 not run", "");
    lines.push(`- Independent methods-validity review (advisory): ${String(obj(rep.methodsValidity).status ?? "not-evaluable")}`, ...arr(obj(rep.methodsValidity).objections).map(x=>`- Objection: ${String(x)}`), "");
    const n = obj(rep.routeN);
    if (rep.routeN) lines.push(`- Route N on independent data (${String(n.datasetId)}): ${String(n.reason)}`, "");
  }
  lines.push(renderIntegrity(integrityOf(input)), "", publication.diagnosticIntegrity!.line, "");
  if (publication.diagnosticIntegrity!.blocked.length) lines.push("Official valid alternatives:", JSON.stringify(publication.diagnosticIntegrity!.officialAnswers, null, 2), "");
  const limitations = [...new Set(input.claims.flatMap((c) => c.limitations))];
  if (limitations.length) { lines.push("## Limitations (software-written)", "", ...limitations.map((l) => `- ${l}`), ""); }
  const warnings = input.notes.warnings.map((w) => `${String(w.kind)}${w.detail && typeof w.detail === "string" ? `: ${w.detail}` : ""}`);
  const refusals = input.notes.refusals.length;
  const routing = input.notes.routing.map((r) => `routing: ${String(r.event)} -> ${String(r.class)}`);
  if (warnings.length || refusals || routing.length) {
    lines.push("## Warnings and infrastructure events", "", ...warnings.map((w) => `- ${w}`), ...routing.map((r) => `- ${r}`));
    if (refusals) lines.push(`- ${refusals} worker refusal(s) by a provider classifier, rerouted by the scheduler; logged and counted, never scored as science.`);
    lines.push("");
  }
  const interpretation = obj(interp.interpretation);
  if (typeof interpretation.file === "string" && !publication.diagnosticIntegrity!.blocked.length) {
    let text = "";
    try { text = readFileSync(interpretation.file, "utf8"); } catch { text = "(interpretation file unavailable)"; }
    lines.push("## Interpretation (written by the AI lead from certified outputs; numbers rendered by software)", "", text.trim(), "");
  }
  lines.push("## How to check this yourself", "");
  lines.push(`- Data manifest: \`${String(obj(stage.staged).manifestHash ?? "n/a")}\``, `- Frozen code: \`${String(obj(look.frozen).hash ?? "n/a")}\``, `- Journal \`${input.journalStream}\` head: \`${input.journalHead ?? "n/a"}\``, "");
  return lines.join("\n");
}

/** Write report.md, paper-input.json and manifest.json; return name -> sha256. */
export function renderDeliverable(input: DeliverableInput): Record<string, string> {
  mkdirSync(input.dir, { recursive: true, mode: 0o700 });
  const report = path.join(input.dir, "report.md"), paper = path.join(input.dir, "paper-input.json"), manifest = path.join(input.dir, "manifest.json");
  writeFileSync(report, (input.offRecord ? "OFF-RECORD DEVELOPMENT RESULT — INELIGIBLE FOR SUBMISSION\n\n" : "") + renderReport(input) + (input.protocolDeviations?.length ? "\n\nProtocol deviations (host recorded):\n" + input.protocolDeviations.map(d => `- protocol-deviation: ${String(d.kind)}`).join("\n") + "\n" : ""));
  writeFileSync(paper, canonicalJson({...paperInputFields(input),...(input.offRecord?{offRecord:true,gradable:false}:{})}) + "\n");
  const integrity = path.join(input.dir,"integrity.json");
  writeFileSync(integrity,canonicalJson(integrityOf(input))+"\n");
  const diagnostics = path.join(input.dir,"diagnostics.json");
  writeFileSync(diagnostics,canonicalJson(publicationResult(input).diagnosticIntegrity)+"\n");
  const files = { "diagnostics.json": fileSha256(diagnostics), "report.md": fileSha256(report), "paper-input.json": fileSha256(paper), "integrity.json": fileSha256(integrity) };
  writeFileSync(manifest, canonicalJson({ schema: "omb-investigate/deliverable@1", investigation: input.spec.id, ...(input.offRecord?{offRecord:true,gradable:false}:{}), files }) + "\n");
  return { ...files, "manifest.json": fileSha256(manifest) };
}
