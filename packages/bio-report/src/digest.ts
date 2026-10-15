import { assertCaptured, currentRecords, negativePointers, plain, refuse, type ReportSnapshot } from "./snapshot.ts";

export interface DigestOptions {
  readonly byteBudget: number;
  readonly recentDecisions?: number;
}
export interface Digest {
  readonly markdown: string;
  readonly bytes: number;
  readonly negativeIds: readonly string[];
  readonly omittedContextLines: number;
}

/** UTF-8 budget, deterministic ledger order, no truncation of mandatory pointers. */
export function compileDigest(snapshot: ReportSnapshot, options: DigestOptions): Digest {
  assertCaptured(snapshot);
  const { byteBudget, recentDecisions = 5 } = options;
  if (!Number.isSafeInteger(byteBudget) || byteBudget < 1 || !Number.isSafeInteger(recentDecisions) || recentDecisions < 1) refuse("Invalid digest budget or decision count");
  const current = currentRecords(snapshot);
  const negatives = negativePointers(snapshot);
  const negativeIds = new Set(negatives.map(n => n.id));
  const negativeHypotheses = new Set<string>();
  const byId = new Map(snapshot.ledger.records.map(r => [r.id, r]));
  for (const r of current) {
    if (r.payload.kind !== "interpretation" || !negativeIds.has(r.id)) continue;
    const visited = new Set<string>();
    const pending = [r];
    while (pending.length) {
      const ancestor = pending.pop()!;
      if (visited.has(ancestor.id)) continue;
      visited.add(ancestor.id);
      if (ancestor.payload.kind === "hypothesis") { negativeHypotheses.add(ancestor.id); continue; }
      if (ancestor.payload.kind === "experiment") { negativeHypotheses.add(ancestor.payload.data.plan.hypothesisId); continue; }
      for (const p of ancestor.payload.parents) {
        if (!["derived_from", "supports", "supersedes"].includes(p.relation)) continue;
        const parent = byId.get(p.id);
        if (parent) pending.push(parent);
      }
    }
  }
  const questions = current.filter(r => r.payload.kind === "question");
  const hypotheses = current.filter(r => r.payload.kind === "hypothesis" && !negativeHypotheses.has(r.id));
  const experiment = current.filter(r => r.payload.kind === "experiment").at(-1);
  const decisions = current.filter(r => r.payload.kind === "decision").slice(-recentDecisions);
  const groups = [questions, hypotheses, experiment ? [experiment] : [], decisions];
  const headings = ["Question", "Live hypotheses", "Current experiment", "Recent decisions"];
  // Every context item initially gets its full ID; optional prose is admitted only
  // after the reserved negative section and all context pointers fit.
  const lines = groups.map(group => group.map(r => `- ${r.id}`));
  const suffix = `\n## Negative and unverified history (complete)\n${negatives.length ? negatives.map(n => `- ${n.label}: ${n.id}`).join("\n") : "None recorded."}\n`;
  const render = () => `# Session digest\nState: ${snapshot.ledger.status}\n` + headings.map((heading, i) => `\n## ${heading}\n${lines[i]!.join("\n") || "None recorded."}\n`).join("") + suffix;
  const requiredBytes = Buffer.byteLength(render(), "utf8");
  if (requiredBytes > byteBudget) refuse(`Digest requires ${requiredBytes} bytes; budget ${byteBudget}. Split by sub-question; negative history cannot be truncated.`);
  let omittedContextLines = 0;
  groups.forEach((group, i) => group.forEach((r, j) => {
    const p = r.payload;
    const prose = p.kind === "question" || p.kind === "hypothesis" ? p.data.text
      : p.kind === "experiment" ? `${p.data.experimentKey} (${p.data.status}); plan ${p.data.planHash}`
      : p.kind === "decision" ? `${p.data.action}: ${p.data.reason}` : "";
    // Numeric narrative is not an observation. Keep its pointer, never present
    // model-authored measurements as notebook evidence. Plan metadata is explicit.
    const text = p.kind !== "experiment" && /\p{N}/u.test(prose)
      ? "Quantitative prose omitted; consult record" : prose;
    const base = lines[i]![j]!;
    lines[i]![j] = `${base}: ${plain(text)}`;
    if (Buffer.byteLength(render(), "utf8") > byteBudget) { lines[i]![j] = base; omittedContextLines++; }
  }));
  const markdown = render();
  return Object.freeze({ markdown, bytes: Buffer.byteLength(markdown, "utf8"), negativeIds: Object.freeze([...negativeIds]), omittedContextLines });
}
