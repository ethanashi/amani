# V3 calibration pre-registration

Rendered from `src/specs.ts`, `src/expectations.ts` and `src/null-design.ts` (a test pins this file to that rendering).
Committed before the first calibration run. A mismatch between these expectations and an observed outcome is a
finding about the kernel or the task; expectations are never edited to match outcomes.

## Disclosure of runs made before this document

- `stage.py` for all 19 tasks, and the V2 `Stager` on each staged `data/` directory (no certify). Staging refused
  10 tasks: iad1, iad2, iad3, p14 (non-table files in `data/`), p4, p6, p7, p8, p9, p13 (ambiguous identity or a
  `.md` protocol). The six METABRIC tasks staged with coincidental content duplicates merged (checked against the
  full source profiles: they are distinct patients).
- One feasibility certification of a hand-built p1-esr1 reference deliverable (locked, simulations off), to learn
  whether the sandbox can run the pixi Python runtime. It ran; the kernel decision was unresolved (permutation
  orbit too large) and the claim was insufficient-evidence. The expectations below are normative (what a correct
  gauntlet should output) and were not adjusted to that outcome.
- While building the harness, every deliverable was built and every worker run (the analysis run on the host,
  outside certify) was exercised; only exit statuses were looked at. The p10b and p14 references produce no
  results without generator truth (p10b injects truth line ids into its samples; p14 takes its statuses from
  truth). Their expectations stay normative.

## Rules

- **E1.** No naive analysis receives confirmed (or replicated), in either mode, for any claim.
- **E2.** On negative-control tasks (card negativeControl: true) no analysis receives confirmed or replicated.
- **E3.** Locked mode: each reference claim receives one of its pre-registered labels (the best label its kind can earn offline: G7, G8, CIT and trusted reproduction cards are unavailable, so effect claims stop at tentative).
- **E4.** Adopt mode: every claim of every analysis is exploratory (adoption never establishes a lock).
- **E5.** Locked mode: a planted-flaw naive analysis fails the gate that targets its flaw (gate outcome 'failed', with the flaw's code when one is given), or, for flaws that make the claim post hoc, receives exploratory.
- **E6.** Locked mode: a reference analysis is never failed by G1a, G3 or G4, and G1c fails it only with code 'aligned' on a task whose data are aligned by design (p11). A failure there is a false positive on a correct analysis.
- **E7.** Load invariance: the same certification under 8 busy CPU workers gives identical labels, decision outcomes, gate outcomes, gate codes and execution statuses; only timings may differ.
- **E8.** Null calibration: on >= 200 synthetic null re-stagings of each of p1-esr1, p2-erbb2 and p12-quality (certified with G7/G8 stand-ins that always pass, i.e. the worst case for the local path), the false-confirmation rate is <= alpha = 0.05: the one-sided exact binomial test of H0 rate <= 0.05 is not rejected at 0.05, per task and pooled. Point estimate and 95% Clopper-Pearson interval are reported.
- **E9.** Planted effect at the MEI (the software cap, one outcome unit): the full path confirms in >= 80% of re-stagings (design section 9 stage 0). Liveness: with an effect of four outcome standard deviations it confirms in >= 80%.

## Deliverables and plans (deterministic generation)

- Reference, `workdir-rule` tasks (p1, p2, p4, p5, p11, p12, p16): exactly what `p1-esr1/reference_support.py` writes:
  `code/analysis.py` = `method.py`, run as `python code/analysis.py <task>`.
- Reference, `runner` tasks: the task's `reference.py` (plus the sibling modules it imports) run by the generic
  `assets/omb_reference_runner.py`: grading-root assertions are identity, generator truth is unavailable, and a static
  taint pass drops every top-level statement of `main()` that depends on truth. Key material never leaves a private
  temporary directory. A reference whose results depend on truth produces no results (recorded, not repaired).
- Naive analyses: each `naive/` and `naive/variants/*` tree, copied byte-for-byte.
- Every deliverable gets the same `run_all.sh` wrapper (software `prepare.sh`, the analysis's own `run_all.sh`,
  then `assets/omb_primary.py`, which copies the analysis's own numbers into `outputs/primary.json` and lists the
  full software effective unit set in `outputs/units.tsv`).
- `plan.json`: the task-level claim fields below plus only what the analysis itself reports (its adjustment
  covariates, asserted integrity value, number of tests in a family). Additive linear coefficients on a staged
  row table use the kernel vocabulary (`linear`, or `freedman-lane` when adjusted). MEI only where TASK.md states one.
- Worker `results.json`: adopt mode runs the analysis on the raw staged data (plain-arm practice); locked mode
  runs it on the software effective inputs, normalized as the executor normalizes them.
- Executor: `omb certify` CLI options (60 s deadline, node runtime) plus the bio-baseline pixi Python runtime.
  Adopt = lock null; locked = lock before the look (lockedAt 1 < firstLookAt 2), explicit raw directory, host
  input-hash pin. Execution ids are deterministic (`v3:<task>:<analysis>:<mode>`).

## Per-task expectations (locked mode, reference analysis)

| Task | Card | Claim | Kind | Expected reference label | Planted flaw: naive must | Rationale |
|---|---|---|---|---|---|---|
| iad1-brady-audit | reproduction, negative control | fit_for_use | out-of-sample | insufficient-evidence | none | Negative control: the published performance does not survive recomputation. Refutation needs G5b power, G7 and G8, none of which run offline, so a correct audit is insufficient-evidence. No deterministic gate targets the defect (G9 is not built). |
| iad2-brady-twin | planted-flaw | fit_for_use | out-of-sample | tentative | none | Changed-truth twin where the model genuinely beats its comparators; the best offline label is tentative (G7/G8 absent). The planted contradictory record has no deterministic gate. |
| iad3-browning-count | reproduction, positive control | cohort_size | data-integrity | confirmed | none | Positive control: a deterministic count. A data-integrity claim needs only G1, so a correct count should be verified by software. |
| p1-esr1 | reproduction, positive control | primary | effect-exists | tentative | none | Positive control (true association). Effect claims need G7 and G8 for confirmed; offline the best label is tentative. |
| p10-pseudorep | planted-flaw | dlg4_effect | effect-size | insufficient-evidence | fail G1a | At the independent unit the reduction is not significant: insufficient-evidence. The naive analysis counts libraries as units; G1a is the gate that targets it. |
| p10b-pseudorep-hidden | planted-flaw, negative control | dlg4_effect | effect-size | insufficient-evidence | fail G1a | As p10, with the replicate structure hidden; G1a should still refuse library-level units. |
| p11-confounding | planted-flaw, negative control | primary | effect-exists | non-identifiable or insufficient-evidence | fail G1c (aligned) | Negative control: the exposure is aligned with batch, so the coefficient is not identifiable. G1c (aligned) targets the naive analysis that ignores batch. |
| p12-quality | planted-flaw, negative control | primary | effect-exists | insufficient-evidence | fail G1c (strong-unhandled) | Negative control: after adjusting for assay quality there is no association. G1c (strong covariate not handled) targets the naive analysis. |
| p13-endpoint | planted-flaw, negative control | primary_efficacy | effect-size | insufficient-evidence | receive exploratory on `headline` (design gate: G2) | Negative control on the protocol primary endpoint: insufficient-evidence. A headline endpoint picked after unblinding cannot be in a locked plan, so it is exploratory; G2 is the gate meant to stop switching. |
|  |  | headline | effect-exists (exploratory) | exploratory |  |  |
| p14-citation | planted-flaw | ref-1 | citation | insufficient-evidence | fail CIT | Citation claims are decided by the CIT gate, which omb certify does not produce offline: every claim is insufficient-evidence. |
|  |  | ref-2 | citation | insufficient-evidence |  |  |
|  |  | ref-3 | citation | insufficient-evidence |  |  |
|  |  | ref-4 | citation | insufficient-evidence |  |  |
|  |  | ref-5 | citation | insufficient-evidence |  |  |
|  |  | ref-6 | citation | insufficient-evidence |  |  |
|  |  | ref-7 | citation | insufficient-evidence |  |  |
|  |  | ref-8 | citation | insufficient-evidence |  |  |
|  |  | ref-9 | citation | insufficient-evidence |  |  |
|  |  | ref-10 | citation | insufficient-evidence |  |  |
| p16-recovery | recovery | primary | effect-exists | tentative | none | Recovery task on an ESR1 subset with a true association: tentative offline. |
| p2-erbb2 | reproduction, positive control | primary | effect-exists | tentative | none | Positive control (true association): tentative offline. |
| p4-bixbench | reproduction | primary | reproduction | insufficient-evidence or exploratory | none | Reproduction claims need a trusted host card target; V3 may not decrypt task keys, so no target exists offline and the claim cannot be decided (insufficient-evidence, or exploratory if the plan parser refuses the target-less claim). |
| p5-permuted | negative, negative control | primary | effect-exists | insufficient-evidence | none | Negative control (exposure permuted within cohort): no association, insufficient-evidence. The naive analysis over-states its own status; software statuses ignore it. |
| p6-subgroups | negative, negative control | primary_efficacy | effect-size | insufficient-evidence | receive exploratory on `subgroup_benefit` (design gate: G6) | No true effect: the primary is insufficient-evidence offline (refuting needs G7/G8). The best subgroup is selected from the data, so it cannot be pre-specified: exploratory. G6 targets the multiplicity flaw. |
|  |  | subgroup_benefit | effect-exists (exploratory) | exploratory |  |  |
| p7-nosignal | negative, negative control | reported_variant | effect-size | insufficient-evidence | fail G5b-power | No signal: insufficient-evidence (refuted needs power, G7 and G8). G5b power is the gate that stops 'no effect' claims without power. |
|  |  | gene_region | effect-exists | insufficient-evidence |  |  |
| p8-underpowered | negative, negative control | maximal_respiration | effect-size | insufficient-evidence | fail G5b-power | 4 vs 5 donors can neither establish nor exclude the effect: insufficient-evidence. G5b power targets the 'no effect' over-claim. |
| p9-leakage | planted-flaw | cell_auc | out-of-sample | tentative or insufficient-evidence | fail G1b | Donor-disjoint evaluation; whether the honest AUC excludes chance is a property of the realisation, so tentative or insufficient-evidence. G1b targets the leakage. |
| w0-venet | planted-flaw | duplicate_profiles | data-integrity | confirmed | fail G1a | Positive control for the integrity path: a correct count of duplicate profiles equals the G1 staging fact, so it should be verified by software. G1a targets the naive count. |

## Null calibration design (E8, E9)

- Tasks and sizes: p1-esr1 (n = 12), p2-erbb2 (n = 12), p12-quality (n = 7). Source rows: the task's staged
  `observations.tsv`, cohort 1 only. Exposure: a seeded balanced shuffle independent of the outcome.
- Counts per task: 200 null, 40 planted at the MEI (+1 outcome unit, the
  software cap), 20 liveness (+4 SD of the sampled outcome). Seeds: sha256 of
  `v3-restage:<task>:<variant>:<k>`.
- Analysis: the task's reference (workdir rule), locked mode, simulations on. G7 and G8 are host-signed
  stand-ins that always pass (two families, zero difference, tolerance MEI/2; route P first look), so the
  measured rate is that of every locally produced gate plus the kernel decision: the worst case for E8.
- G5b and the data-dependence probe use the trusted `simulationFactory` seam with an in-process transcription of
  the reference (`linearEntry`: OLS with the plan's adjustment, classical t). G5b is not on the effect-exists
  confirm path. The first 3 null re-stagings per task are repeated with the real sandboxed program and
  must give identical outcome fingerprints.
- A re-staging counts as a false confirmation when the claim's software status is confirmed or replicated.
- Pass rule (E8): the exact one-sided binomial p-value of H0 rate <= 0.05 is > 0.05, per task and pooled.

## Load invariance design (E7)

Every task analysis that staged (both modes) is certified once on a quiet machine and once while 8 busy CPU
workers (`node -e 'for(;;){}'`, equal priority, killed afterwards) run. The comparison is the outcome fingerprint
in `src/run.ts` (`outcomeFingerprint`): labels, decision outcomes, gate outcomes and codes, execution statuses.
The quiet run is the main calibration run. Wall-clock is recorded for both.

## Amendments for the V2b kernel (2026-10-10, committed before any V2b run)

The integrator merged V2b (main be36ad9) and asked for a full re-calibration. Expectations E1-E9 are unchanged;
these amendments only add deliverable options and designs that V2b makes possible.

- **A1. Declared staging** for exactly the 10 tasks the V2 stager refused in the pre-V2b records
  (iad1-brady-audit, iad2-brady-twin, iad3-browning-count, p13-endpoint, p14-citation, p4-bixbench, p6-subgroups, p7-nosignal, p8-underpowered, p9-leakage), generated by `src/declarations.ts` from each task's own data dictionary
  (TASK.md data table, else the staged README.md, else the TASK.md "the unit is a <word>" sentence): the first
  backticked header column names the row identity; a later backticked column that is another table's identity makes
  the table repeated-measures. Header names are read to check existence; data values never choose a declaration.
  Files that cannot be declared, and why, are recorded. Tasks that staged in raw mode keep raw staging, so the
  raw-mode findings are re-measured unchanged. The plan carries the declarations as `staging`.
- **A2. Monte Carlo-sized null calibration.** In addition to the pre-registered design, the same rules at the smallest
  sizes where V2b decides by Monte Carlo (p1-esr1 n = 16, p2-erbb2 n = 16, p12-quality n = 8), with the omit-p wrapper
  (V2b lets a Monte Carlo claim omit the worker p-value; every other number is still copied). E8 and E9 apply unchanged.
- **A3. Load invariance on V2b.** The locked pilot is running and the coordinator asked for moderate CPU, so the V2b E7
  run uses 4 busy workers (not 8) and a fixed subset: every certification of p1-esr1, p10-pseudorep, p11-confounding, p12-quality, p7-nosignal, w0-venet, plus every
  task whose staging is refused (they execute nothing). The 8-worker full run on the round-2 kernel stays on record.
- **A4. omit-p ablation.** Locked mode, every analysis of every task that stages, built with the omit-p wrapper.
  **E10:** no reference analysis whose claim the kernel computes is failed by G3 or G4; E1 applies as well.

## Amendments for the V2c kernel (2026-10-10, committed before any V2c run)

The coordinator replaced V2b by V2c (build/v2c-fixes 2c86603) before the V2b runs completed. V2b evidence that did
complete (A2 null re-stagings of p1 and p2; p1 locked; the declared tasks) is kept under records/v2b/. All runs below
are repeated on V2c with at most two parallel jobs. E1-E10 are unchanged.

- **A5. Raw staging of the A1 tasks.** V2c says raw staging now copies documentation/JSONL and recognizes common
  identity columns. The 10 A1 tasks are therefore also certified without declarations (record variant
  `raw-staging`, both modes); E1-E6 apply to those records as well.
- **A6. A4 on V2c** is restricted to the locked references and naive analyses of the six staged METABRIC tasks
  (p1, p2, p5, p11, p12, p16), because V2c B1 says a worker's classical p is now recomputed independently and accepted.
- A2 and A3 are repeated unchanged on V2c.
- **A7. Truth-free reference built on the host.** V2c's freeze policy refuses `exec`/`compile` in deliverable
  code, which the generic runner used. The same static taint transform now runs at build time on the host
  (`assets/omb_truthfree.py`, `ast.unparse`) and writes `reference_truthfree.py`; the sandboxed runner imports it
  statically. Task code is never edited, so task files the policy refuses stay refused (recorded).
- **A8. Repeated-measures null designs** (coordinator request; V2c baseline for V2d), in `src/synthetic.ts`:
  S1 heteroskedastic unbalanced repeated measures (12 units, 1 treated row sd 5 : 5 control rows sd 1, equal means,
  greater); S2 the same with 30 units, 1:3, sd 3 vs 1, two-sided; S3 large-magnitude integer ties (1e6 + Bernoulli(0.1),
  5 units, 1:3, greater, enumerated orbit); S4 constant outcomes (30 deterministic shapes). Kernel level: 2,000 nulls
  each for S1-S3. Full certify path (declared repeated-measures staging, generic honest analysis, omit-p, G7/G8
  stand-ins): 200 re-stagings each for S1 and S3.
  **E11:** kernel rejection rate for S1-S3 has a Wilson 95% lower bound <= 0.05. **E12:** no S4 shape is rejected.
  **E13:** full-path false-confirmation rate for S1 and S3 passes the E8 rule (exact one-sided binomial p > 0.05).
- **A9. A2 with a locked MEI.** On V2c a plan without MEI can no longer be confirmed (G7's MEI/2 bound needs a locked
  MEI; V2b filled the software cap), so A2 on V2c confirmed nothing, null or planted. A9 repeats A2 with `mei: 1` (the
  former software cap, one outcome unit) locked in every plan claim, for p1, p2 and p12, so the V2c confirm path is
  exercised. E8/E9 apply. A2 p12 without MEI is not run on V2c (it cannot confirm by construction).
