// Frozen renderer of RESULTS-v2r2.md (round-2 kernel snapshot). Do not edit: a test pins the file.
// Renders RESULTS.md (tables only) from the committed records. A test pins the committed file to
// this rendering, so every number in the tables comes from a record.

import type { InvarianceDiff } from "./load.ts";
import type { Mismatch } from "./expectations.ts";
import type { RateSummary } from "./null-run.ts";
import type { CertRecord } from "./run.ts";

interface CalibrationDoc { gitHead: string; startedAt: string; wallMs: number; machine: unknown; records: CertRecord[]; mismatches: Mismatch[]; stages: { task: string; ok: boolean; ms: number }[] }
interface NullDoc { gitHead: string; wallMs: number; verdicts: Record<string, string>; summaries: RateSummary[]; validation: { task: string; k: number; identical: boolean; sandboxMs: number; inProcessMs: number | null }[] }
interface LoadDoc { gitHead: string; workers: number; verdict: string; compared: number; identical: number; quietWallMs: number; loadedWallMs: number; diffs: InvarianceDiff[]; machine: { loadStart: number[]; loadEnd: number[] }; timing: { task: string; analysis: string; mode: string; quietMs: number | null; loadedMs: number }[] }

const pct = (v: number) => `${(100 * v).toFixed(1)}%`;
const statusOf = (r: CertRecord | undefined, claim: string) => r?.claims.find((c) => c.id === claim)?.status ?? "-";

function gateCell(r: CertRecord | undefined, claim: string, gates: readonly string[]): string {
  const c = r?.claims.find((x) => x.id === claim);
  if (!c) return "-";
  return gates.map((g) => { const s = c.gates[g as keyof typeof c.gates]; return s ? `${g} ${s.outcome === "passed" && s.passed ? "pass" : s.outcome === "passed" ? "pass*" : s.outcome}${s.code ? ` (${s.code})` : ""}` : `${g} -`; }).join("; ");
}

export function renderResultsV2r2(cal: CalibrationDoc, prior: CalibrationDoc | null, nul: NullDoc, load: LoadDoc): string {
  const L: string[] = [];
  const tasks = [...new Set(cal.records.map((r) => r.task))];
  L.push("# V3 calibration results (generated from records/)", "",
    `Calibration: ${cal.records.length} certifications (${tasks.length} tasks x analyses x {adopt, locked}), ${cal.mismatches.length} mismatches against the pre-registration, wall ${Math.round(cal.wallMs / 1000)} s, git ${cal.gitHead.slice(0, 7)}.`,
    prior ? `Earlier run on the V2 round-1 kernel (records/calibration-v2r1.json): ${prior.mismatches.length} mismatches, wall ${Math.round(prior.wallMs / 1000)} s, git ${prior.gitHead.slice(0, 7)}.` : "", "",
    "## Labels per task (locked mode; adopt mode is exploratory for every claim)", "",
    "| Task | Staged | Claim | Reference | Naive analyses | Reference gates (G1a; G1c; G3; G4; G5a) | Naive gates (G1a; G1c; G3; G4; G5a) |",
    "|---|---|---|---|---|---|---|");
  for (const task of tasks) {
    const locked = cal.records.filter((r) => r.task === task && r.mode === "locked");
    const ref = locked.find((r) => r.analysis === "reference");
    const naives = locked.filter((r) => r.analysis !== "reference");
    const claims = [...new Set(locked.flatMap((r) => r.claims.filter((c) => c.planned).map((c) => c.id)))];
    claims.forEach((claim, i) => {
      const naiveLabels = naives.map((n) => `${n.analysis.replace("naive/variants/", "")}: ${statusOf(n, claim)}`).join("<br>");
      L.push(`| ${i === 0 ? task : ""} | ${i === 0 ? (ref?.stagingAvailable ? "yes" : "no") : ""} | ${claim} | ${statusOf(ref, claim)} | ${naiveLabels} | ${gateCell(ref, claim, ["G1a", "G1c", "G3", "G4", "G5a"])} | ${naives.map((n) => gateCell(n, claim, ["G1a", "G1c", "G3", "G4", "G5a"])).join("<br>")} |`);
    });
  }
  L.push("", "`pass*`: reported passed but its evidence rule refused it.", "", "## Mismatches against the pre-registration", "", "| Rule | Task | Analysis | Mode | Claim | Expected | Actual |", "|---|---|---|---|---|---|---|");
  for (const m of cal.mismatches) L.push(`| ${m.rule} | ${m.task} | ${m.analysis} | ${m.mode} | ${m.claim ?? "-"} | ${m.expected} | ${m.actual} |`);
  if (prior) {
    const key = (r: CertRecord) => `${r.task} ${r.analysis} ${r.mode}`;
    const before = new Map(prior.records.map((r) => [key(r), r]));
    let labelChanges = 0, gateChanges = 0;
    const rows: string[] = [];
    for (const r of cal.records) {
      const o = before.get(key(r));
      for (const c of r.claims) {
        const oc = o?.claims.find((x) => x.id === c.id);
        if (oc?.status !== c.status) labelChanges++;
        const changed = [...new Set([...Object.keys(c.gates), ...Object.keys(oc?.gates ?? {})])].sort().filter((g) => {
          const a = (oc?.gates as Record<string, { outcome: string; code: string | null }> | undefined)?.[g], b = (c.gates as Record<string, { outcome: string; code: string | null }>)[g];
          return `${a?.outcome}${a?.code}` !== `${b?.outcome}${b?.code}`;
        });
        if (changed.length) { gateChanges++; if (r.mode === "locked" && r.stagingAvailable) rows.push(`| ${r.task} | ${r.analysis} | ${c.id} | ${changed.map((g) => { const a = (oc?.gates as Record<string, { outcome: string }> | undefined)?.[g]?.outcome ?? "absent", b = (c.gates as Record<string, { outcome: string }>)[g]?.outcome ?? "absent"; return `${g}: ${a} -> ${b}`; }).join("; ")} |`); }
      }
    }
    L.push("", "## V2 round-1 kernel vs round-2 kernel (same deliverables)", "",
      `Label changes: ${labelChanges}. Claims with any gate outcome/code change: ${gateChanges}. Locked-mode changes on staged tasks:`, "",
      "| Task | Analysis | Claim | Gate changes |", "|---|---|---|---|", ...rows);
  }
  L.push("", "## Null calibration (E8) and planted checks (E9)", "",
    `Verdicts: ${Object.entries(nul.verdicts).map(([k, v]) => `${k} ${v}`).join(", ")}. Wall ${Math.round(nul.wallMs / 1000)} s, git ${nul.gitHead.slice(0, 7)}.`, "",
    "| Task | Variant | Re-stagings | Confirmed | Rate (95% Clopper-Pearson) | P(X >= k \\| alpha) | Kernel decided | Kernel rejected | Kernel rejected and G5a passed |",
    "|---|---|---|---|---|---|---|---|---|");
  for (const s of nul.summaries) L.push(`| ${s.task} | ${s.variant} | ${s.n} | ${s.confirmed} | ${pct(s.rate)} (${pct(s.rateInterval[0])}-${pct(s.rateInterval[1])}) | ${s.pExceedsAlpha === null ? "-" : s.pExceedsAlpha.toFixed(3)} | ${s.decided} | ${s.kernelRejects} | ${s.kernelRejectsWithG5a} |`);
  L.push("", "Kernel columns are descriptive (not pre-registered): how often the trusted permutation decision rejected, before G3/G4 and the other gates.", "",
    "Sandbox validation (in-process simulation program vs the real sandboxed program, same re-staging):", "",
    ...nul.validation.map((v) => `- ${v.task} null ${v.k}: ${v.identical ? "identical" : "DIFFERENT"} outcome fingerprint (sandbox ${Math.round(v.sandboxMs / 1000)} s, in-process ${v.inProcessMs === null ? "-" : Math.round(v.inProcessMs / 1000) + " s"})`), "",
    "## Load invariance (E7)", "",
    `${load.verdict.toUpperCase()}: ${load.identical}/${load.compared} certifications identical under ${load.workers} busy workers (load ${load.machine.loadStart.join("/")} -> ${load.machine.loadEnd.join("/")}). Quiet wall ${Math.round(load.quietWallMs / 1000)} s, loaded ${Math.round(load.loadedWallMs / 1000)} s.`, "");
  if (load.diffs.length) {
    L.push("| Certification | Quiet | Loaded |", "|---|---|---|");
    for (const d of load.diffs) L.push(`| ${d.key} | ${d.quiet ?? "-"} | ${d.loaded ?? "-"} |`);
  }
  L.push("", "## Timing (locked mode, quiet run)", "", "| Task | Analysis | Certify (s) | Executions | Execution total (s) | Loaded certify (s) |", "|---|---|---|---|---|---|");
  for (const r of cal.records.filter((x) => x.mode === "locked" && x.stagingAvailable)) {
    const lt = load.timing.find((t) => t.task === r.task && t.analysis === r.analysis && t.mode === r.mode);
    L.push(`| ${r.task} | ${r.analysis} | ${(r.timing.certifyMs / 1000).toFixed(1)} | ${r.timing.executionMs.length} | ${(r.timing.executionMs.reduce((a, b) => a + b, 0) / 1000).toFixed(1)} | ${lt ? (lt.loadedMs / 1000).toFixed(1) : "-"} |`);
  }
  const unstaged = cal.records.filter((x) => !x.stagingAvailable);
  L.push("", `Unstaged tasks: ${unstaged.length} certifications, median ${median(unstaged.map((r) => r.timing.certifyMs))} ms each (staging refused before any execution).`, "");
  return L.join("\n");
}

function median(xs: number[]): number { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)]! : 0; }
