// Pre-registered expectations (PREREGISTRATION.md is rendered from this file and committed before
// the first calibration run). A mismatch is a finding about the kernel or the task; nothing here
// is tuned after seeing outcomes.

import type { SoftwareStatus } from "../../omb-gauntlet/src/index.ts";
import type { CertRecord } from "./run.ts";
import { TASK_SPECS, type CardFacts, type TaskSpec } from "./specs.ts";

export interface Mismatch {
  readonly rule: string; readonly task: string; readonly analysis: string; readonly mode: string;
  readonly claim: string | null; readonly expected: string; readonly actual: string;
}

export const RULES = [
  { id: "E1", text: "No naive analysis receives confirmed (or replicated), in either mode, for any claim." },
  { id: "E2", text: "On negative-control tasks (card negativeControl: true) no analysis receives confirmed or replicated." },
  { id: "E3", text: "Locked mode: each reference claim receives one of its pre-registered labels (the best label its kind can earn offline: G7, G8, CIT and trusted reproduction cards are unavailable, so effect claims stop at tentative)." },
  { id: "E4", text: "Adopt mode: every claim of every analysis is exploratory (adoption never establishes a lock)." },
  { id: "E5", text: "Locked mode: a planted-flaw naive analysis fails the gate that targets its flaw (gate outcome 'failed', with the flaw's code when one is given), or, for flaws that make the claim post hoc, receives exploratory." },
  { id: "E6", text: "Locked mode: a reference analysis is never failed by G1a, G3 or G4, and G1c fails it only with code 'aligned' on a task whose data are aligned by design (p11). A failure there is a false positive on a correct analysis." },
  { id: "E7", text: "Load invariance: the same certification under 8 busy CPU workers gives identical labels, decision outcomes, gate outcomes, gate codes and execution statuses; only timings may differ." },
  { id: "E8", text: "Null calibration: on >= 200 synthetic null re-stagings of each of p1-esr1, p2-erbb2 and p12-quality (certified with G7/G8 stand-ins that always pass, i.e. the worst case for the local path), the false-confirmation rate is <= alpha = 0.05: the one-sided exact binomial test of H0 rate <= 0.05 is not rejected at 0.05, per task and pooled. Point estimate and 95% Clopper-Pearson interval are reported." },
  { id: "E9", text: "Planted effect at the MEI (the software cap, one outcome unit): the full path confirms in >= 80% of re-stagings (design section 9 stage 0). Liveness: with an effect of four outcome standard deviations it confirms in >= 80%." },
] as const;

/** Amendment A4 (V2b): E10 on omit-p ablation records, plus E1. */
export function evaluateAblation(records: readonly CertRecord[]): Mismatch[] {
  const out: Mismatch[] = [];
  for (const r of records) {
    if (r.mode !== "locked") continue;
    for (const c of r.claims) {
      if (r.analysis !== "reference" && TOP.includes(c.status as SoftwareStatus)) out.push({ rule: "E1", task: r.task, analysis: r.analysis, mode: r.mode, claim: c.id, expected: "not confirmed", actual: c.status });
      if (r.analysis === "reference" && c.kernel) for (const gate of ["G3", "G4"] as const) {
        const g = c.gates[gate];
        if (g?.outcome === "failed") out.push({ rule: "E10", task: r.task, analysis: r.analysis, mode: r.mode, claim: c.id, expected: `${gate} not failed`, actual: `${gate} failed${g.detail?.length ? ` (${g.detail.join(", ")})` : ""}` });
      }
    }
  }
  return out;
}

const TOP: readonly SoftwareStatus[] = ["confirmed", "replicated"];

/** Flaw checks that are about the plan (post-hoc claims) rather than a gate. */
export const POST_HOC_FLAW_CLAIMS: Readonly<Record<string, string>> = { "p6-subgroups": "subgroup_benefit", "p13-endpoint": "headline" };

export function evaluateRecords(records: readonly CertRecord[], cards: Readonly<Record<string, CardFacts>>, specs: readonly TaskSpec[] = TASK_SPECS): Mismatch[] {
  const out: Mismatch[] = [];
  const add = (rule: string, r: CertRecord, claim: string | null, expected: string, actual: string) =>
    out.push({ rule, task: r.task, analysis: r.analysis, mode: r.mode, claim, expected, actual });
  for (const r of records) {
    const spec = specs.find((s) => s.id === r.task);
    const card = cards[r.task];
    if (!spec || !card) { add("SPEC", r, null, "task has a spec and card", "missing"); continue; }
    const naive = r.analysis !== "reference";
    for (const c of r.claims) {
      if (naive && TOP.includes(c.status as SoftwareStatus)) add("E1", r, c.id, "not confirmed", c.status);
      if (card.negativeControl && TOP.includes(c.status as SoftwareStatus)) add("E2", r, c.id, "not confirmed", c.status);
      if (r.mode === "adopt" && c.status !== "exploratory") add("E4", r, c.id, "exploratory", c.status);
    }
    if (r.mode !== "locked") continue;
    if (!naive) {
      for (const [claim, allowed] of Object.entries(spec.referenceExpected)) {
        const c = r.claims.find((x) => x.id === claim);
        const actual = c ? c.status : "missing";
        if (!allowed.includes(actual as SoftwareStatus)) add("E3", r, claim, allowed.join("|"), actual);
      }
      for (const c of r.claims) {
        for (const gate of ["G1a", "G3", "G4"] as const) {
          const g = c.gates[gate];
          if (g?.outcome === "failed") add("E6", r, c.id, `${gate} not failed`, `${gate} failed${g.code ? ` (${g.code})` : ""}`);
        }
        const g1c = c.gates.G1c;
        if (g1c?.outcome === "failed" && !(r.task === "p11-confounding" && g1c.code === "aligned")) add("E6", r, c.id, "G1c not failed", `G1c failed (${g1c.code ?? "?"})`);
      }
    } else if (spec.flaw) {
      const postHoc = POST_HOC_FLAW_CLAIMS[r.task];
      if (postHoc) {
        const c = r.claims.find((x) => x.id === postHoc);
        if (!c || c.status !== "exploratory") add("E5", r, postHoc, "exploratory (post-hoc claim)", c ? c.status : "missing");
      } else {
        const gate = spec.flaw.gate;
        const hit = r.claims.some((c) => c.gates[gate]?.outcome === "failed" && (spec.flaw!.code === undefined || c.gates[gate]?.code === spec.flaw!.code));
        if (!hit) {
          const states = [...new Set(r.claims.map((c) => { const g = c.gates[gate]; return g ? `${g.outcome}${g.code ? ` (${g.code})` : ""}` : "absent"; }))];
          add("E5", r, null, `${gate} failed${spec.flaw.code ? ` (${spec.flaw.code})` : ""}`, `${gate} ${states.join(", ")}`);
        }
      }
    }
  }
  return out;
}
