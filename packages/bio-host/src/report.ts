import { canonicalSha256 } from "../../bio-core/src/index.ts";
import type { ReportInput } from "../../bio-pipeline/src/index.ts";

const escape = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replace(/[\\`*_{}\[\]()#+!|.]/g, "\\$&").replace(/[\r\n]/g, " ");

/** Minimal evidence report while bio-report is absent from this checkout.
 * Numeric results come exclusively from software observation records. */
export function renderEvidenceReport(input: ReportInput): string {
  const records = input.snapshot.records;
  for (const record of records) if (canonicalSha256(record.payload) !== record.id) throw new Error("report record hash mismatch");
  const interpretation = records.find(r => r.id === input.interpretationId);
  if (interpretation?.payload.kind !== "interpretation" || interpretation.payload.data.status !== input.label) throw new Error("report label is not ledger-backed");
  const locked = records.find(r => r.payload.kind === "experiment" && r.payload.data.status === "locked" && r.payload.data.planHash === input.planHash);
  if (!locked || !interpretation.payload.parents.some(p => p.id === locked.id)) throw new Error("report outcome has no locked plan");
  const lines = ["# Investigation evidence", "", `Label: **${input.label}**`, "", "No independent top-rung review is available.", "",
    "## Question", "", ...records.flatMap(r => r.payload.kind === "question" ? [escape(r.payload.data.text)] : []), "",
    `Locked plan: [${input.planHash}](../authority/notebook.json#${locked.id})`, "", "## Recomputed results", ""];
  for (const r of records) {
    if (r.payload.kind !== "observation" || r.payload.data.unit !== "recomputed") continue;
    const value = r.payload.data.value as { name: string; value: number; outputHash: string };
    if (r.payload.actor.kind !== "software" || typeof value.value !== "number" || !Number.isFinite(value.value) ||
      r.payload.data.codeHash !== input.codeHash || !Object.values(input.outputHashes).includes(value.outputHash) ||
      !r.payload.parents.some(p => p.id === locked.id)) throw new Error("untraceable numeric result");
    const artifact = (hash: string) => `../authority/artifacts/${hash}`;
    lines.push(`- ${escape(value.name)}: ${value.value} — [observation ${r.id}](../authority/notebook.json#${r.id}), [code ${input.codeHash}](${artifact(input.codeHash)}), [output ${value.outputHash}](${artifact(value.outputHash)})`);
  }
  lines.push("", "## Checks", "", `Re-execution: ${input.reexecution.status}`, "");
  for (const claim of input.claims) lines.push(`- ${escape(claim.id)}: ${claim.status}`);
  lines.push("", "## Deviations", "", "| Amendment | Reason | Post-unblinding |", "| --- | --- | --- |");
  for (const r of records) if (r.payload.kind === "amendment") lines.push(`| ${r.id} | ${escape(r.payload.data.reason)} | ${r.payload.data.post_unblinding} |`);
  lines.push("", "## Prior evidence", "");
  for (const r of records) {
    if (r.payload.kind !== "observation" || r.payload.data.unit !== "prior-notebook-record") continue;
    const item = r.payload.data.value as unknown as { investigationId: string; record: { id: string }; status: string };
    lines.push(`- [prior:${item.record.id}] — ${escape(item.investigationId)}, ${escape(item.status)}; [local evidence](../authority/notebook.json#${r.id})`);
  }
  lines.push("", "## How to check", "", `Dataset manifest SHA-256: ${input.manifestHash}`, "",
    "Use data/manifest.json, results/evidence.json and the hash-chained authority/ledger.sqlite notebook.", "",
    "## Limitations", "", "This is a minimal evidence report. Scientific narrative, citation resolution, and independent replication have not been performed. Unsupported claims remain unsupported.", "");
  return lines.join("\n");
}
