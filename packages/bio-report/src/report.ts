import { canonicalJson } from "../../bio-core/src/index.ts";
import { type Json, type ParentLink, type NotebookRecord } from "../../bio-ledger/src/index.ts";
import { assertCaptured, assertHash, currentRecords, hashLink, negativePointers, plain, recordLink, refuse, type ReportSnapshot } from "./snapshot.ts";

export interface OutputBinding {
  readonly observationId: string;
  /** Actual output artifact hash, supplied by the trusted host (not by the model). */
  readonly outputHash: string;
}
export interface ManifestReference { readonly name: string; readonly sha256: string }
export interface ReportOptions {
  readonly summary: string;
  readonly methods: string;
  readonly limitations: readonly string[];
  /** Exactly one binding for every observation; no caller-provided result values. */
  readonly outputs: readonly OutputBinding[];
  readonly manifests: readonly ManifestReference[];
  /** Explicit host classification; IDs must name outcomes, not plans or questions. */
  readonly exploratoryIds?: readonly string[];
}
const outcomeKinds = new Set(["observation", "interpretation", "check"]);
const labels = ["confirmed", "tentative", "refuted", "insufficient", "contradicted"] as const;

function nonblank(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value.trim()) refuse("Required report text is missing");
}
/** Narrative cannot introduce measurements outside typed observations. */
function narrative(text: string): string {
  if (/\p{N}/u.test(text)) refuse("Quantitative narrative text must be moved to linked observation results");
  return plain(text);
}
function resultText(text: string): string {
  if (/\p{N}/u.test(text)) refuse("Numeric result text must be a typed observation number");
  return plain(text);
}
function fields(value: unknown, required: readonly string[], optional: readonly string[] = []): void {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || required.some(key => !Object.hasOwn(value, key))
    || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) refuse("Unknown or missing report fields; result values must come from observation records");
}

/** Pure Markdown rendering. The trusted caller owns provenance bindings and narrative.
 * ledger:record/<id> and sha256:<hash> are resolver URIs, never caller-supplied URLs.
 */
export function renderReport(snapshot: ReportSnapshot, options: ReportOptions): string {
  assertCaptured(snapshot);
  fields(options, ["summary", "methods", "limitations", "outputs", "manifests"], ["exploratoryIds"]);
  nonblank(options.summary); nonblank(options.methods);
  if (/\p{N}/u.test(options.summary)) refuse("Quantitative summary text must be moved to linked observation results");
  if (!Array.isArray(options.limitations) || !options.limitations.length) refuse("Explicit limitations required");
  options.limitations.forEach(nonblank);
  if (!Array.isArray(options.outputs) || !Array.isArray(options.manifests) || !options.manifests.length) refuse("Output bindings and manifests required");
  const records = snapshot.ledger.records;
  const byId = new Map(records.map(r => [r.id, r]));
  const current = currentRecords(snapshot);
  const currentIds = new Set(current.map(r => r.id));
  const exploratoryList = options.exploratoryIds ?? [];
  if (!Array.isArray(exploratoryList)) refuse("Invalid exploratory classification");
  const exploratory = new Set(exploratoryList);
  if (exploratory.size !== exploratoryList.length) refuse("Duplicate exploratory classification");
  for (const id of exploratory) {
    const r = byId.get(id);
    if (!r || !outcomeKinds.has(r.payload.kind)) refuse(`Unknown exploratory outcome: ${id}`);
  }
  const outputs = new Map<string, string>();
  for (const binding of options.outputs) {
    fields(binding, ["observationId", "outputHash"]);
    assertHash(binding.observationId); assertHash(binding.outputHash);
    const r = byId.get(binding.observationId);
    if (!r || r.payload.kind !== "observation" || r.payload.actor.kind !== "software") refuse("A result must reference a software observation record");
    if (outputs.has(r.id)) refuse(`Duplicate output binding: ${r.id}`);
    outputs.set(r.id, binding.outputHash);
  }
  const manifests = new Map<string, string>();
  for (const manifest of options.manifests) {
    fields(manifest, ["name", "sha256"]); nonblank(manifest.name); assertHash(manifest.sha256);
    if (manifests.has(manifest.name)) refuse("Duplicate manifest name");
    manifests.set(manifest.name, manifest.sha256);
  }

  // Looks have no event timestamp/sequence in the public snapshot. A lock is
  // provably before a look only if it precedes that look's mandatory probe in
  // verified record order. Ambiguous ordering is exploratory, even across roots
  // or disjoint partitions. Clock equality therefore cannot fabricate priority.
  const positions = new Map(records.map((r, i) => [r.id, i]));
  const postUnblinding = new Set(records.flatMap(r => r.payload.kind === "amendment"
    && r.payload.data.post_unblinding ? [r.payload.data.replacementId] : []));
  function validLock(record: NotebookRecord<"experiment">): boolean {
    if (record.payload.data.status !== "locked") return false;
    let version: NotebookRecord | undefined = record;
    while (version) {
      if (postUnblinding.has(version.id)) return false;
      const previous: ParentLink | undefined = version.payload.parents.find(p => p.relation === "supersedes");
      version = previous ? byId.get(previous.id) : undefined;
    }
    return snapshot.ledger.looks.every(look => {
      const probePosition = positions.get(look.probeId);
      return probePosition !== undefined && positions.get(record.id)! < probePosition;
    });
  }
  // Every evidence path must register. Citation links are bibliographic metadata;
  // ideas, explicitly exploratory outcomes, and unregistered roots taint the
  // entire outcome, even when another parent points directly to a valid lock.
  function lockedAncestors(record: NotebookRecord): NotebookRecord<"experiment">[] {
    const found = new Map<string, NotebookRecord<"experiment">>();
    const visited = new Set<string>();
    const pending = [record];
    while (pending.length) {
      const r = pending.pop()!;
      if (visited.has(r.id)) continue;
      visited.add(r.id);
      if (exploratory.has(r.id) || r.payload.kind === "idea") return [];
      if (r.payload.kind === "experiment") {
        const experiment = r as NotebookRecord<"experiment">;
        if (!validLock(experiment)) return [];
        found.set(r.id, experiment);
        continue;
      }
      const evidence = r.payload.parents.filter(p => p.type !== "citation"
        && ["derived_from", "supports", "supersedes"].includes(p.relation));
      if (!evidence.length) return [];
      for (const p of evidence) pending.push(byId.get(p.id) ?? refuse("Missing provenance parent"));
    }
    return [...found.values()];
  }
  const registrations = new Map<string, readonly NotebookRecord<"experiment">[]>();
  for (const r of records) {
    if (!outcomeKinds.has(r.payload.kind)) continue;
    const locks = lockedAncestors(r);
    if (!locks.length && !exploratory.has(r.id)) refuse(`Outcome is not traceable to a locked pre-registration: ${r.id}`);
    registrations.set(r.id, locks);
    if (r.payload.kind === "observation" && !outputs.has(r.id)) refuse(`Missing output hash for observation: ${r.id}`);
    if (r.payload.kind === "interpretation") {
      if (/\p{N}/u.test(r.payload.data.text)) refuse(`Quantitative claim text must be moved to linked observation results: ${r.id}`);
      const citations = r.payload.parents.filter(p => p.type === "citation" && ["supports", "derived_from"].includes(p.relation));
      if (!citations.length || citations.some(p => {
        const c = byId.get(p.id);
        return c?.payload.kind !== "citation" || c.payload.data.resolution !== "resolved"
          || c.payload.actor.kind !== "software" || !currentIds.has(c.id);
      })) refuse(`Uncited or unresolved claim: ${r.id}`);
    }
  }
  function scope(r: NotebookRecord): string {
    if (exploratory.has(r.id)) return "exploratory";
    return `pre-registered: ${(registrations.get(r.id) ?? []).map(e => hashLink(e.payload.data.planHash, "locked plan")).join(", ")}`;
  }
  function value(value: Json, observation: NotebookRecord<"observation">): string {
    if (typeof value === "number") {
      if (!Number.isFinite(value)) refuse("Non-finite observation");
      return `${recordLink(observation.id, String(value))} (${hashLink(observation.payload.data.codeHash, "code")}, ${hashLink(outputs.get(observation.id)!, "output")})`;
    }
    if (typeof value === "string") {
      // Refuse numeric prose/string coercions; numbers must be typed JSON numbers.
      if (/\p{N}/u.test(value)) refuse("Numeric result text must be a typed observation number");
      return `“${resultText(value)}”`;
    }
    if (value === null) return "missing (not verified)";
    if (typeof value === "boolean") return value ? "true" : "false";
    if (Array.isArray(value)) return `\\[${value.map(v => valueRenderer(v, observation)).join("; ")}\\]`;
    return `{ ${Object.keys(value).sort().map(key => `${resultText(key)}: ${valueRenderer((value as { readonly [key: string]: Json })[key]!, observation)}`).join("; ")} }`;
  }
  const valueRenderer = value;
  const lines: string[] = ["# Research report", "", "## Plain-language summary", narrative(options.summary), "", "## Question and hypotheses"];
  for (const r of current) {
    if (r.payload.kind === "question") lines.push(`- Question: ${narrative(r.payload.data.text)} — ${recordLink(r.id)}`, `  Success criterion: ${narrative(r.payload.data.successCriterion)}`);
    if (r.payload.kind === "hypothesis") lines.push(`- Hypothesis: ${narrative(r.payload.data.text)} — ${recordLink(r.id)}`);
  }
  if (!current.some(r => r.payload.kind === "question")) refuse("Missing research question");
  lines.push("", "## Locked plans");
  const locks = records.filter((r): r is NotebookRecord<"experiment"> => r.payload.kind === "experiment" && r.payload.data.status === "locked");
  for (const r of locks) lines.push(`- ${plain(r.payload.data.experimentKey)} (${currentIds.has(r.id) ? "current" : "historical"}): ${hashLink(r.payload.data.planHash)} — ${recordLink(r.id)}`);
  if (!locks.length) lines.push("None recorded; outcomes below are exploratory.");
  lines.push("", "## Deviations", "| Amendment | Supersedes | Replacement | Reason | post_unblinding |", "| --- | --- | --- | --- | --- |");
  for (const r of records) if (r.payload.kind === "amendment") {
    const d = r.payload.data;
    lines.push(`| ${recordLink(r.id)} | ${recordLink(d.supersedes)} | ${recordLink(d.replacementId)} | ${narrative(d.reason)} | ${d.post_unblinding ? "**true — after unblinding**" : "false"} |`);
  }
  lines.push("", "## Methods", narrative(options.methods));
  for (const r of locks) lines.push(`- Locked specification ${recordLink(r.id)}: ${plain(canonicalJson(r.payload.data.plan.analysis))}`);
  lines.push("", "## Results");
  for (const r of records) if (r.payload.kind === "observation") {
    const observation = r as NotebookRecord<"observation">;
    lines.push(`- ${recordLink(r.id, "Observation")} (${scope(r)}): ${valueRenderer(observation.payload.data.value, observation)}; unit: ${resultText(observation.payload.data.unit)}.`);
  }
  if (!outputs.size) lines.push("No software observations recorded; no quantitative results verified.");
  lines.push("", "## Negative and failed analyses");
  const negatives = negativePointers(snapshot);
  for (const n of negatives) lines.push(`- ${n.label}: ${recordLink(n.id)}${outcomeKinds.has(byId.get(n.id)!.payload.kind) ? ` (${scope(byId.get(n.id)!)})` : ""}`);
  if (!negatives.length) lines.push("None recorded. Absence of a failure record is not verification.");
  if (snapshot.ledger.status !== "ready") lines.push(`Investigation ${snapshot.ledger.status}: ${narrative(snapshot.ledger.reason)}.`);
  lines.push("", "## Limitations", ...options.limitations.map(text => `- ${narrative(text)}`));
  lines.push("", "## Claims");
  for (const label of labels) {
    lines.push("", `### ${label}`);
    const claims = current.filter(r => r.payload.kind === "interpretation" && (snapshot.claimStatuses[r.id] === "supported" ? "tentative" : snapshot.claimStatuses[r.id]) === label);
    if (!claims.length) lines.push("None recorded.");
    for (const r of claims) if (r.payload.kind === "interpretation") {
      lines.push(`- ${narrative(r.payload.data.text)} — ${recordLink(r.id)} (${scope(r)}${snapshot.claimStatuses[r.id] === "supported" ? "; ledger: supported, not confirmed" : ""}). Citations: ${r.payload.parents.filter(p => p.type === "citation" && ["supports", "derived_from"].includes(p.relation)).map(p => {
        const c = byId.get(p.id)! as NotebookRecord<"citation">;
        return recordLink(c.id, c.payload.data.doi);
      }).join(", ")}`);
    }
  }
  lines.push("", "## Side findings — hypothesis-generating");
  for (const r of records) if (r.payload.kind === "idea") lines.push(`- Hypothesis-generating (${r.payload.data.status}; ${currentIds.has(r.id) ? "current" : "historical"}): ${narrative(r.payload.data.text)} — ${recordLink(r.id)}.`);
  if (!records.some(r => r.payload.kind === "idea")) lines.push("None recorded.");
  lines.push("", "## How to check this yourself", "Resolve ledger:record links in the verified notebook and sha256 links in the content-addressed artifact store. Verify manifest file hashes, check the locked specification, and rerun its code against the declared inputs. Compare the output hash and observation value. Missing artifacts or checks are not verification.", "", "### Manifests");
  for (const [name, hash] of [...manifests].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) lines.push(`- ${plain(name)}: ${hashLink(hash)}`);
  lines.push("", "### Observation provenance", "| Observation | Code hash | Output hash | Input hashes |", "| --- | --- | --- | --- |");
  for (const r of records) if (r.payload.kind === "observation") lines.push(`| ${recordLink(r.id)} | ${hashLink(r.payload.data.codeHash)} | ${hashLink(outputs.get(r.id)!)} | ${r.payload.data.inputHashes.map(h => hashLink(h)).join(", ")} |`);
  lines.push("", "### Sealed data commitments");
  for (const c of snapshot.ledger.commitments) lines.push(`- ${plain(c.partitionId)}: ${hashLink(c.dataHash)}`);
  return `${lines.join("\n")}\n`;
}
