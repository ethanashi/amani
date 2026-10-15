// Renders PREREGISTRATION.md from the specs and rules (a test pins the committed file to this
// rendering, so the document and the machine-readable expectations cannot drift apart).

import { readFileSync } from "node:fs";
import path from "node:path";
import { POST_HOC_FLAW_CLAIMS, RULES } from "./expectations.ts";
import { TASK_SPECS, type CardFacts, type TaskSpec } from "./specs.ts";
import { NULL_DESIGN, NULL_DESIGN_A2 } from "./null-design.ts";
import { A1_DECLARED_TASKS } from "./specs.ts";

export function readCards(tasksDir: string, specs: readonly TaskSpec[] = TASK_SPECS): Record<string, CardFacts> {
  return Object.fromEntries(specs.map((s) => {
    const card = JSON.parse(readFileSync(path.join(tasksDir, s.id, "card.json"), "utf8")) as { negativeControl: boolean; positiveControl: boolean; family: string };
    return [s.id, { negativeControl: card.negativeControl === true, positiveControl: card.positiveControl === true, family: String(card.family) }];
  }));
}

export function renderPreregistration(cards: Readonly<Record<string, CardFacts>>, specs: readonly TaskSpec[] = TASK_SPECS): string {
  const lines: string[] = [];
  lines.push("# V3 calibration pre-registration", "",
    "Rendered from `src/specs.ts`, `src/expectations.ts` and `src/null-design.ts` (a test pins this file to that rendering).",
    "Committed before the first calibration run. A mismatch between these expectations and an observed outcome is a",
    "finding about the kernel or the task; expectations are never edited to match outcomes.", "",
    "## Disclosure of runs made before this document", "",
    "- `stage.py` for all 19 tasks, and the V2 `Stager` on each staged `data/` directory (no certify). Staging refused",
    "  10 tasks: iad1, iad2, iad3, p14 (non-table files in `data/`), p4, p6, p7, p8, p9, p13 (ambiguous identity or a",
    "  `.md` protocol). The six METABRIC tasks staged with coincidental content duplicates merged (checked against the",
    "  full source profiles: they are distinct patients).",
    "- One feasibility certification of a hand-built p1-esr1 reference deliverable (locked, simulations off), to learn",
    "  whether the sandbox can run the pixi Python runtime. It ran; the kernel decision was unresolved (permutation",
    "  orbit too large) and the claim was insufficient-evidence. The expectations below are normative (what a correct",
    "  gauntlet should output) and were not adjusted to that outcome.",
    "- While building the harness, every deliverable was built and every worker run (the analysis run on the host,",
    "  outside certify) was exercised; only exit statuses were looked at. The p10b and p14 references produce no",
    "  results without generator truth (p10b injects truth line ids into its samples; p14 takes its statuses from",
    "  truth). Their expectations stay normative.", "",
    "## Rules", "");
  for (const r of RULES) lines.push(`- **${r.id}.** ${r.text}`);
  lines.push("", "## Deliverables and plans (deterministic generation)", "",
    "- Reference, `workdir-rule` tasks (p1, p2, p4, p5, p11, p12, p16): exactly what `p1-esr1/reference_support.py` writes:",
    "  `code/analysis.py` = `method.py`, run as `python code/analysis.py <task>`.",
    "- Reference, `runner` tasks: the task's `reference.py` (plus the sibling modules it imports) run by the generic",
    "  `assets/omb_reference_runner.py`: grading-root assertions are identity, generator truth is unavailable, and a static",
    "  taint pass drops every top-level statement of `main()` that depends on truth. Key material never leaves a private",
    "  temporary directory. A reference whose results depend on truth produces no results (recorded, not repaired).",
    "- Naive analyses: each `naive/` and `naive/variants/*` tree, copied byte-for-byte.",
    "- Every deliverable gets the same `run_all.sh` wrapper (software `prepare.sh`, the analysis's own `run_all.sh`,",
    "  then `assets/omb_primary.py`, which copies the analysis's own numbers into `outputs/primary.json` and lists the",
    "  full software effective unit set in `outputs/units.tsv`).",
    "- `plan.json`: the task-level claim fields below plus only what the analysis itself reports (its adjustment",
    "  covariates, asserted integrity value, number of tests in a family). Additive linear coefficients on a staged",
    "  row table use the kernel vocabulary (`linear`, or `freedman-lane` when adjusted). MEI only where TASK.md states one.",
    "- Worker `results.json`: adopt mode runs the analysis on the raw staged data (plain-arm practice); locked mode",
    "  runs it on the software effective inputs, normalized as the executor normalizes them.",
    "- Executor: `omb certify` CLI options (60 s deadline, node runtime) plus the bio-baseline pixi Python runtime.",
    "  Adopt = lock null; locked = lock before the look (lockedAt 1 < firstLookAt 2), explicit raw directory, host",
    "  input-hash pin. Execution ids are deterministic (`v3:<task>:<analysis>:<mode>`).", "",
    "## Per-task expectations (locked mode, reference analysis)", "",
    "| Task | Card | Claim | Kind | Expected reference label | Planted flaw: naive must | Rationale |",
    "|---|---|---|---|---|---|---|");
  for (const s of specs) {
    const card = cards[s.id];
    const cardText = card ? [card.family, card.negativeControl ? "negative control" : "", card.positiveControl ? "positive control" : ""].filter(Boolean).join(", ") : "?";
    s.claims.forEach((c, i) => {
      const flaw = i > 0 ? "" : !s.flaw ? "none" : POST_HOC_FLAW_CLAIMS[s.id] ? `receive exploratory on \`${POST_HOC_FLAW_CLAIMS[s.id]}\` (design gate: ${s.flaw.gate})`
        : `fail ${s.flaw.gate}${s.flaw.code ? ` (${s.flaw.code})` : ""}`;
      lines.push(`| ${i === 0 ? s.id : ""} | ${i === 0 ? cardText : ""} | ${c.id} | ${String(c.plan.kind)}${c.plan.exploratory === true ? " (exploratory)" : ""} | ${(s.referenceExpected[c.id] ?? []).join(" or ")} | ${flaw} | ${i === 0 ? s.rationale : ""} |`);
    });
  }
  lines.push("", "## Null calibration design (E8, E9)", "");
  for (const l of NULL_DESIGN.describe()) lines.push(l);
  lines.push("", "## Load invariance design (E7)", "",
    "Every task analysis that staged (both modes) is certified once on a quiet machine and once while 8 busy CPU",
    "workers (`node -e 'for(;;){}'`, equal priority, killed afterwards) run. The comparison is the outcome fingerprint",
    "in `src/run.ts` (`outcomeFingerprint`): labels, decision outcomes, gate outcomes and codes, execution statuses.",
    "The quiet run is the main calibration run. Wall-clock is recorded for both.", "");
  lines.push(...AMENDMENTS);
  return lines.join("\n");
}

/** Amendments written after the V2b kernel landed and before any V2b calibration run. The text
 * above is unchanged; these sections are appended. */
export const LOAD_SUBSET_A3 = ["p1-esr1", "p10-pseudorep", "p11-confounding", "p12-quality", "p7-nosignal", "w0-venet"] as const;
export const AMENDMENTS: readonly string[] = [
  "## Amendments for the V2b kernel (2026-10-10, committed before any V2b run)", "",
  "The integrator merged V2b (main be36ad9) and asked for a full re-calibration. Expectations E1-E9 are unchanged;",
  "these amendments only add deliverable options and designs that V2b makes possible.", "",
  `- **A1. Declared staging** for exactly the ${A1_DECLARED_TASKS.length} tasks the V2 stager refused in the pre-V2b records`,
  `  (${A1_DECLARED_TASKS.join(", ")}), generated by \`src/declarations.ts\` from each task's own data dictionary`,
  "  (TASK.md data table, else the staged README.md, else the TASK.md \"the unit is a <word>\" sentence): the first",
  "  backticked header column names the row identity; a later backticked column that is another table's identity makes",
  "  the table repeated-measures. Header names are read to check existence; data values never choose a declaration.",
  "  Files that cannot be declared, and why, are recorded. Tasks that staged in raw mode keep raw staging, so the",
  "  raw-mode findings are re-measured unchanged. The plan carries the declarations as `staging`.",
  `- **A2. Monte Carlo-sized null calibration.** In addition to the pre-registered design, the same rules at the smallest`,
  `  sizes where V2b decides by Monte Carlo (${NULL_DESIGN_A2.tasks.map((t) => `${t.task} n = ${t.n}`).join(", ")}), with the omit-p wrapper`,
  "  (V2b lets a Monte Carlo claim omit the worker p-value; every other number is still copied). E8 and E9 apply unchanged.",
  `- **A3. Load invariance on V2b.** The locked pilot is running and the coordinator asked for moderate CPU, so the V2b E7`,
  `  run uses 4 busy workers (not 8) and a fixed subset: every certification of ${LOAD_SUBSET_A3.join(", ")}, plus every`,
  "  task whose staging is refused (they execute nothing). The 8-worker full run on the round-2 kernel stays on record.",
  "- **A4. omit-p ablation.** Locked mode, every analysis of every task that stages, built with the omit-p wrapper.",
  "  **E10:** no reference analysis whose claim the kernel computes is failed by G3 or G4; E1 applies as well.",
  "",
  "## Amendments for the V2c kernel (2026-10-10, committed before any V2c run)", "",
  "The coordinator replaced V2b by V2c (build/v2c-fixes 2c86603) before the V2b runs completed. V2b evidence that did",
  "complete (A2 null re-stagings of p1 and p2; p1 locked; the declared tasks) is kept under records/v2b/. All runs below",
  "are repeated on V2c with at most two parallel jobs. E1-E10 are unchanged.", "",
  "- **A5. Raw staging of the A1 tasks.** V2c says raw staging now copies documentation/JSONL and recognizes common",
  "  identity columns. The 10 A1 tasks are therefore also certified without declarations (record variant",
  "  `raw-staging`, both modes); E1-E6 apply to those records as well.",
  "- **A6. A4 on V2c** is restricted to the locked references and naive analyses of the six staged METABRIC tasks",
  "  (p1, p2, p5, p11, p12, p16), because V2c B1 says a worker's classical p is now recomputed independently and accepted.",
  "- A2 and A3 are repeated unchanged on V2c.",
  "- **A7. Truth-free reference built on the host.** V2c's freeze policy refuses `exec`/`compile` in deliverable",
  "  code, which the generic runner used. The same static taint transform now runs at build time on the host",
  "  (`assets/omb_truthfree.py`, `ast.unparse`) and writes `reference_truthfree.py`; the sandboxed runner imports it",
  "  statically. Task code is never edited, so task files the policy refuses stay refused (recorded).",
  "- **A8. Repeated-measures null designs** (coordinator request; V2c baseline for V2d), in `src/synthetic.ts`:",
  "  S1 heteroskedastic unbalanced repeated measures (12 units, 1 treated row sd 5 : 5 control rows sd 1, equal means,",
  "  greater); S2 the same with 30 units, 1:3, sd 3 vs 1, two-sided; S3 large-magnitude integer ties (1e6 + Bernoulli(0.1),",
  "  5 units, 1:3, greater, enumerated orbit); S4 constant outcomes (30 deterministic shapes). Kernel level: 2,000 nulls",
  "  each for S1-S3. Full certify path (declared repeated-measures staging, generic honest analysis, omit-p, G7/G8",
  "  stand-ins): 200 re-stagings each for S1 and S3.",
  "  **E11:** kernel rejection rate for S1-S3 has a Wilson 95% lower bound <= 0.05. **E12:** no S4 shape is rejected.",
  "  **E13:** full-path false-confirmation rate for S1 and S3 passes the E8 rule (exact one-sided binomial p > 0.05).",
  "- **A9. A2 with a locked MEI.** On V2c a plan without MEI can no longer be confirmed (G7's MEI/2 bound needs a locked",
  "  MEI; V2b filled the software cap), so A2 on V2c confirmed nothing, null or planted. A9 repeats A2 with `mei: 1` (the",
  "  former software cap, one outcome unit) locked in every plan claim, for p1, p2 and p12, so the V2c confirm path is",
  "  exercised. E8/E9 apply. A2 p12 without MEI is not run on V2c (it cannot confirm by construction).",
  "",
];
