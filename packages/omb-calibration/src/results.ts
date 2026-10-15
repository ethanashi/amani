// Renders RESULTS.md (tables only) from the committed V2d records. A test pins the committed file
// to this rendering, so every number in the tables comes from a record.

import type { InvarianceDiff } from "./load.ts";
import type { Mismatch } from "./expectations.ts";
import type { RateSummary } from "./null-run.ts";
import type { CertRecord } from "./run.ts";

export interface CalibrationDoc { gitHead: string; startedAt: string; wallMs: number; machine: unknown; records: CertRecord[]; mismatches: Mismatch[]; stages: { task: string; ok: boolean; ms: number }[] }
export interface NullDoc { gitHead: string; wallMs: number; verdicts: Record<string, string>; summaries: RateSummary[]; validation: { task: string; k: number; identical: boolean; sandboxMs: number; inProcessMs: number | null }[]; design?: { name?: string; tasks: { task: string; n: number | null }[] } }
export interface LoadDoc { gitHead: string; workers: number; verdict: string; compared: number; identical: number; quietWallMs: number; loadedWallMs: number; diffs: InvarianceDiff[]; machine: { loadStart: number[]; loadEnd: number[] }; timing: { task: string; analysis: string; mode: string; quietMs: number | null; loadedMs: number }[] }
export interface SyntheticDoc { gitHead: string; kernel: { design: string; description: string; direction: string; nulls: number; rejected: number; rate: number; wilson95: [number, number]; stopping: string[]; guarantee: string[] }[];
  constant: { level: number; units: number; controls: number; direction: string; rejected: boolean; status: string; stopping: string }[];
  pathSummary: { design: string; reStagings: number; confirmed: number; rate: number; wilson95: [number, number]; kernelRejected: number; kernelWilson95: [number, number] }[] }
export interface ResultsInput { cal: CalibrationDoc; prior: CalibrationDoc; v2c: CalibrationDoc; nul: NullDoc; a2: NullDoc; a9: NullDoc; v2cA9: NullDoc; v2bA2: NullDoc; load: LoadDoc; ablation: CalibrationDoc; rawStaging: CalibrationDoc; synthetic: SyntheticDoc }

const pct = (v: number) => `${(100 * v).toFixed(1)}%`;
const key = (r: CertRecord) => `${r.task} ${r.analysis} ${r.mode}`;
const statusOf = (r: CertRecord | undefined, claim: string) => r?.claims.find((c) => c.id === claim)?.status ?? "-";
const gateText = (s: { outcome: string; passed: boolean; code: string | null } | undefined, g: string) =>
  s ? `${g} ${s.outcome === "passed" && s.passed ? "pass" : s.outcome === "passed" ? "pass*" : s.outcome}${s.code ? ` (${s.code})` : ""}` : `${g} -`;
function gateCell(r: CertRecord | undefined, claim: string, gates: readonly string[]): string {
  const c = r?.claims.find((x) => x.id === claim);
  return c ? gates.map((g) => gateText(c.gates[g as keyof typeof c.gates], g)).join("; ") : "-";
}
function median(xs: number[]): number { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)]! : 0; }
const GATES = ["G1", "G1a", "G1c", "G3", "G4", "G5a", "G5b-recovery", "G6"] as const;

function nullTable(L: string[], doc: NullDoc): void {
  L.push(`Verdicts: ${Object.entries(doc.verdicts).map(([k, v]) => `${k} ${v}`).join(", ")}. Sizes: ${(doc.design?.tasks ?? []).map((t) => `${t.task} n = ${t.n}`).join(", ")}. Wall ${Math.round(doc.wallMs / 1000)} s (slowest parallel part).`, "",
    "| Task | Variant | Re-stagings | Confirmed | Rate (95% Clopper-Pearson) | P(X >= k \\| alpha) | Kernel decided | Kernel rejected | Kernel rejected and G5a passed |",
    "|---|---|---|---|---|---|---|---|---|");
  for (const s of doc.summaries) L.push(`| ${s.task} | ${s.variant} | ${s.n} | ${s.confirmed} | ${pct(s.rate)} (${pct(s.rateInterval[0])}-${pct(s.rateInterval[1])}) | ${s.pExceedsAlpha === null ? "-" : s.pExceedsAlpha.toFixed(3)} | ${s.decided} | ${s.kernelRejects} | ${s.kernelRejectsWithG5a} |`);
  L.push("", "Sandbox validation (in-process simulation program vs the real sandboxed program, same re-staging):", "",
    ...doc.validation.map((v) => `- ${v.task} null ${v.k}: ${v.identical ? "identical" : "DIFFERENT"} outcome fingerprint (sandbox ${Math.round(v.sandboxMs / 1000)} s, in-process ${v.inProcessMs === null ? "-" : Math.round(v.inProcessMs / 1000) + " s"})`), "");
}

export function renderResults(x: ResultsInput): string {
  const { cal, prior, v2c, nul, a2, a9, v2cA9, v2bA2, load, ablation, rawStaging, synthetic } = x;
  const L: string[] = [];
  const tasks = [...new Set(cal.records.map((r) => r.task))];
  L.push("# V3 calibration results on the V2d kernel (generated from records/)", "",
    `Calibration: ${cal.records.length} certifications, ${cal.mismatches.length} mismatches against the pre-registration, wall ${Math.round(cal.wallMs / 1000)} s (slowest of the parallel parts), git ${cal.gitHead.slice(0, 7)}.`,
    `V2c record (records/v2c/calibration.json): ${v2c.mismatches.length} mismatches. Round-2 record (records/calibration-v2r2.json): ${prior.mismatches.length} mismatches; round-2 tables: RESULTS-v2r2.md.`, "",
    "## Labels per task (locked mode; adopt mode is exploratory for every claim)", "",
    "| Task | Staging | Claim | Reference | Naive analyses | Reference gates | Naive gates |", "|---|---|---|---|---|---|---|");
  for (const task of tasks) {
    const locked = cal.records.filter((r) => r.task === task && r.mode === "locked");
    const ref = locked.find((r) => r.analysis === "reference");
    const naives = locked.filter((r) => r.analysis !== "reference");
    const staging = !ref?.stagingAvailable ? "refused" : ref.declarations && Object.keys(ref.declarations.staging).length ? "declared" : "raw";
    const claims = [...new Set(locked.flatMap((r) => r.claims.filter((c) => c.planned).map((c) => c.id)))];
    claims.forEach((claim, i) => {
      L.push(`| ${i === 0 ? task : ""} | ${i === 0 ? staging : ""} | ${claim} | ${statusOf(ref, claim)} | ${naives.map((n) => `${n.analysis.replace("naive/variants/", "")}: ${statusOf(n, claim)}`).join("<br>")} | ${gateCell(ref, claim, GATES)} | ${naives.map((n) => gateCell(n, claim, GATES)).join("<br>")} |`);
    });
  }
  L.push("", "`pass*`: reported passed but its evidence rule refused it.", "", "## Amendment A1: generated staging declarations", "",
    "| Task | Declared tables (mode, identity column, unit column) | Not declarable / diagnostics | Certify staging |", "|---|---|---|---|");
  for (const task of tasks) {
    const r = cal.records.find((x) => x.task === task && x.mode === "locked" && x.analysis === "reference");
    if (!r?.declarations) continue;
    const decl = Object.entries(r.declarations.staging).map(([f, d]) => `${f}: ${d.mode}, ${d.idColumn}${d.unitColumn ? `, unit ${d.unitColumn}` : ""}`).join("<br>") || "-";
    const notes = r.declarations.notes.map((n) => `${n.file}: ${n.reason}`).join("<br>") || "-";
    const warn = r.warnings.find((w) => w.startsWith("staging unavailable")) ?? "staged";
    L.push(`| ${task} | ${decl} | ${notes} | ${warn} |`);
  }
  L.push("", "## Amendment A5: the A1 tasks with raw staging (no declarations)", "",
    "| Task | Analysis | Mode | Staging | Labels | Staging warning |", "|---|---|---|---|---|---|");
  for (const r of rawStaging.records) L.push(`| ${r.task} | ${r.analysis} | ${r.mode} | ${r.stagingAvailable ? "staged" : "refused"} | ${r.claims.filter((c) => c.planned).map((c) => `${c.id}: ${c.status}`).join("<br>")} | ${r.warnings.find((w) => w.startsWith("staging unavailable")) ?? "-"} |`);
  L.push("", `A5 mismatches against E1-E6: ${rawStaging.mismatches.length}.`, "");
  L.push("", "## Mismatches against the pre-registration", "", "| Rule | Task | Analysis | Mode | Claim | Expected | Actual |", "|---|---|---|---|---|---|---|");
  for (const m of cal.mismatches) L.push(`| ${m.rule} | ${m.task} | ${m.analysis} | ${m.mode} | ${m.claim ?? "-"} | ${m.expected} | ${m.actual} |`);
  // V2c -> V2d differences.
  const before = new Map(v2c.records.map((r) => [key(r), r]));
  let labelChanges = 0;
  const rows: string[] = [];
  for (const r of cal.records) {
    const o = before.get(key(r));
    for (const c of r.claims) {
      const oc = o?.claims.find((y) => y.id === c.id);
      if (oc?.status !== c.status) { labelChanges++; rows.push(`| ${r.task} | ${r.analysis} | ${r.mode} | ${c.id} | ${oc?.status ?? "-"} | ${c.status} |`); }
    }
  }
  L.push("", "## V2c vs V2d (identical deliverables)", "", `Label changes: ${labelChanges}.`, "",
    "| Task | Analysis | Mode | Claim | V2c | V2d |", "|---|---|---|---|---|---|", ...rows);
  L.push("", "## Amendment A4: omit-p ablation (locked, tasks that stage)", "",
    `${ablation.records.length} certifications; ${ablation.mismatches.length} E10/E1 mismatches.`, "",
    "| Task | Analysis | Claim | Pre-registered wrapper | omit-p wrapper | omit-p G3 / G4 (disagreement keys) |", "|---|---|---|---|---|---|");
  const main = new Map(cal.records.map((r) => [key(r), r]));
  for (const r of ablation.records) for (const c of r.claims.filter((y) => y.planned)) {
    const g3 = c.gates.G3, g4 = c.gates.G4;
    const d = [...new Set([...(g3?.detail ?? []), ...(g4?.detail ?? [])])].join(", ");
    L.push(`| ${r.task} | ${r.analysis} | ${c.id} | ${statusOf(main.get(key(r)), c.id)} | ${c.status} | ${g3?.outcome ?? "-"} / ${g4?.outcome ?? "-"}${d ? ` (${d})` : ""} |`);
  }
  if (ablation.mismatches.length) {
    L.push("", "| Rule | Task | Analysis | Claim | Expected | Actual |", "|---|---|---|---|---|---|");
    for (const m of ablation.mismatches) L.push(`| ${m.rule} | ${m.task} | ${m.analysis} | ${m.claim ?? "-"} | ${m.expected} | ${m.actual} |`);
  }
  L.push("", "## Null calibration, pre-registered design (E8, E9)", "");
  nullTable(L, nul);
  L.push("## Null calibration, amendment A2 (Monte Carlo sizes, omit-p wrapper), V2d", "");
  nullTable(L, a2);
  L.push("## Null calibration, amendment A9 (A2 with a locked MEI of one outcome unit), V2d", "");
  nullTable(L, a9);
  L.push("## Null calibration, amendment A9 on the V2c kernel (records/v2c/)", "");
  nullTable(L, v2cA9);
  L.push("## Null calibration, amendment A2 on the V2b kernel (records/v2b/)", "");
  nullTable(L, v2bA2);
  L.push("## Amendment A8: repeated-measures null designs (V2d)", "", "Kernel level (trusted kernelDecision only):", "",
    "| Design | Description | Direction | Nulls | Rejected | Rate (Wilson 95%) | Stopping | Guarantee |", "|---|---|---|---|---|---|---|---|");
  for (const k of synthetic.kernel) L.push(`| ${k.design} | ${k.description} | ${k.direction} | ${k.nulls} | ${k.rejected} | ${pct(k.rate)} (${pct(k.wilson95[0])}-${pct(k.wilson95[1])}) | ${k.stopping.join(", ")} | ${k.guarantee.join(", ")} |`);
  const constRejected = synthetic.constant.filter((c) => c.rejected);
  L.push("", `S4 constant outcomes: ${constRejected.length} of ${synthetic.constant.length} shapes rejected${constRejected.length ? ` (${constRejected.map((c) => `${c.level} ${c.units}x${c.controls + 1} ${c.direction}`).join("; ")})` : ""}.`, "",
    "Full certify path (declared repeated-measures staging, generic analysis, omit-p, G7/G8 stand-ins):", "",
    "| Design | Re-stagings | Confirmed | Rate (Wilson 95%) | Kernel rejected | Kernel rate (Wilson 95%) |", "|---|---|---|---|---|---|");
  for (const p of synthetic.pathSummary) L.push(`| ${p.design} | ${p.reStagings} | ${p.confirmed} | ${pct(p.rate)} (${pct(p.wilson95[0])}-${pct(p.wilson95[1])}) | ${p.kernelRejected} | ${pct(p.kernelRejected / Math.max(1, p.reStagings))} (${pct(p.kernelWilson95[0])}-${pct(p.kernelWilson95[1])}) |`);
  L.push("");
  L.push("Kernel columns are descriptive (not pre-registered).", "", "## Load invariance (E7, amendment A3)", "",
    `${load.verdict.toUpperCase()}: ${load.identical}/${load.compared} certifications identical under ${load.workers} busy workers (load ${load.machine.loadStart.join("/")} -> ${load.machine.loadEnd.join("/")}). Quiet wall ${Math.round(load.quietWallMs / 1000)} s (full run), loaded ${Math.round(load.loadedWallMs / 1000)} s (subset).`, "");
  if (load.diffs.length) { L.push("| Certification | Quiet | Loaded |", "|---|---|---|"); for (const d of load.diffs) L.push(`| ${d.key} | ${d.quiet ?? "-"} | ${d.loaded ?? "-"} |`); }
  // Sandbox supervisor failures across every recorded execution.
  const all = [...cal.records, ...ablation.records, ...((load as unknown as { loadedRecords?: CertRecord[] }).loadedRecords ?? [])];
  const execs = all.flatMap((r) => r.executions);
  const by = (code: string) => execs.filter((e) => e.reason.includes(`exit-code ${code}`)).length;
  L.push("", "## Sandboxed execution failures (all V2d calibration, ablation and loaded records)", "",
    `${execs.length} executions; failed: ${execs.filter((e) => e.status !== "ok").length}; supervisor exit 90 (detached survivor): ${by("90")}; exit 80 (analysis exited non-zero): ${by("80")}; other: ${execs.filter((e) => e.status !== "ok" && !/exit-code (80|90)/.test(e.reason)).length}.`, "",
    "## Timing (locked mode, quiet run)", "", "| Task | Analysis | Certify (s) | Executions | Execution total (s) | Loaded certify (s) |", "|---|---|---|---|---|---|");
  for (const r of cal.records.filter((y) => y.mode === "locked" && y.stagingAvailable)) {
    const lt = load.timing.find((t) => t.task === r.task && t.analysis === r.analysis && t.mode === r.mode);
    L.push(`| ${r.task} | ${r.analysis} | ${(r.timing.certifyMs / 1000).toFixed(1)} | ${r.timing.executionMs.length} | ${(r.timing.executionMs.reduce((a, b) => a + b, 0) / 1000).toFixed(1)} | ${lt ? (lt.loadedMs / 1000).toFixed(1) : "-"} |`);
  }
  const unstaged = cal.records.filter((y) => !y.stagingAvailable);
  L.push("", `Unstaged: ${unstaged.length} certifications, median ${median(unstaged.map((r) => r.timing.certifyMs))} ms each.`, "");
  return L.join("\n");
}
