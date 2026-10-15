# V3 calibration findings (status against V2d)

Stage-0 offline calibration of the v2 gauntlet (`omb certify`), no AI arms. Expectations were
pre-registered before the first run (`PREREGISTRATION.md`, 97d745a) and amended only before each
new kernel's runs (A1-A4 before V2b, A5-A7 before V2c, A8-A9 during V2c; every amendment is
dated in the file and its text above it is unchanged). A mismatch is a finding about the kernel or
the task; nothing was tuned away. Records never carry a task value (labels, gate outcomes and
codes, column names, counts and timings only). Tables: `RESULTS.md` (V2d) and `RESULTS-v2r2.md`.
The round-2 findings document is archived unchanged as `CALIBRATION-FINDINGS-v2r2.md`.

Kernels calibrated with the same deliverables:

| Kernel | Commit | Records |
|---|---|---|
| Round 1 | f87bcc9 | `records/calibration-v2r1.json` |
| Round 2 | 24e9eb1 | `records/calibration-v2r2.json`, `null-calibration-v2r2.json`, `load-invariance-v2r2.json` |
| V2b | be36ad9 | `records/v2b/` (partial: superseded mid-run by V2c on the coordinator's instruction) |
| V2c | 2c86603 / 2a07946 | `records/v2c/` (88-certification calibration, A2, A9) |
| V2d | 568d531 | `records/*.json` (current) |

## Stage-0 answer on V2d

**No, for the references. Yes, for naive analyses and nulls.**

- **References.** On V2d (88 certifications, 49 mismatches) no correct reference reaches its
  pre-registered label. The positive controls p1, p2 and p16 fall from tentative (V2c) to
  insufficient-evidence, and w0 falls from confirmed (V2c) to "staging unavailable".
- **Naive analyses** never confirm (E1 holds on every kernel). The only locked label above
  insufficient-evidence on V2d is **tentative for the naive p12 analysis**, which omits the
  confounder its reference adjusts for (the reference is insufficient-evidence; F8).
- **Nulls** never confirm above alpha. Without a locked MEI nothing can confirm (0/600
  pre-registered, 0/400 A2). With `mei: 1` (A9) the full path confirms 7/200 (3.5%) and 6/200
  (3.0%) nulls, which is the kernel's own rate (E8 passes; exact binomial p 0.88 and 0.94). The
  A8 stress designs confirm 0/400.

Two new V2d defects cause the four new reference failures (E3), and a third adds false gate
failures:
- **N9 (p1, p2, p16).** The trusted Student p is computed as 1 - CDF and loses all precision in
  the extreme tail, so an honest worker's accurate tiny p fails G3/G4 on every strong effect. The
  omit-p ablation restores tentative for all three.
- **N10 (w0).** Staging refuses 13 of 19 tasks because content heuristics read measurement and
  category columns as biological identities. The other two E3 mismatches (iad2, iad3) are declared
  long tables refused on every kernel (N2).
- **N11 (E6).** A near-duplicate rule corroborated by a constant and a binary column fails G1 and
  G1a on all six METABRIC tables. That does not lower a tentative label, but it would block
  confirmation.

V2c was the best kernel so far: p1, p2, p16 tentative and w0 confirmed exactly as pre-registered.

| Kernel | Mismatches | E3 (reference label) | E5 (flaw gate) | E6 (false gate failure on a reference) | Tasks staged | Locked labels other than insufficient/exploratory |
|---|---|---|---|---|---|---|
| Round 1 | 15 | 6 | 5 | 4 | 9 | w0 reference refuted (false) |
| Round 2 | 54 | 6 | 5 | 43 | 9 | w0 reference refuted (false) |
| V2c | 49 | 2 | 5 | 42 | 12 | p1, p2, p16 references tentative; w0 reference confirmed; p11 naive non-identifiable; p12 naive tentative |
| V2d | 49 | 6 | 6 | 37 | 6 | p12 naive tentative |


## Status of every finding

Status words: **fixed** (the V2d record shows the defect gone), **still open**, **regressed** (fixed
on an earlier kernel, broken again on V2d), **new** (first seen on V2b/V2c/V2d), **changed** (the
behaviour moved but the underlying problem remains).

| ID | Finding (first seen) | Round 2 | V2b | V2c | **V2d** | V2d evidence |
|---|---|---|---|---|---|---|
| F1 | Staging refuses tasks (non-table files; identity not recognized; no declarations) | 10/19 refused | declared staging (A1) staged p6, p7 | 7/19 refused | **regressed: 13/19 refused** | Only the six single-table METABRIC tasks stage. Refusals: iad1-3, p8 (declared keys not unique), p4 (plan refused), p7, p9 (content duplicates need acknowledgement), p6 `site`, p8 `group`, p13 `sbp_bl`, p14 `year` ("declared unit splits a detected biological unit"), p10, p10b, w0 ("ambiguous biological identity"). See N10. |
| F2 | Exact permutation kernel abstains at realistic n | open | fixed (Monte Carlo) | fixed | **fixed** | Kernel decides (reject/retain, monte-carlo-fixed) on every METABRIC claim. |
| F3 | G3/G4 require the worker to report the kernel's permutation p | open | open (look.p, rerun.p) | fixed (classical p accepted) | **fixed in rule, regressed in effect (N9)** | Moderate p passes (p5, p12 references G3/G4 pass); every strong effect fails with "B7: p disagrees with its recomputed test" because of N9. |
| F4 | G1 merges coincidental content matches (distinct patients dropped) | open | open | fixed (no merge; 786 units) | **changed: blocking false positive (N11)** | No rows dropped, but G1 fails on all six METABRIC tables and G1a fails on five; warning "unresolved content duplicate". |
| F5 | p10: G1a blind to `line_id`; inverted on the correct analysis | open | open | changed: lines recognized, replicate rows dropped (N12) | **changed: p10/p10b refused** | "samples.tsv: ambiguous biological identity requires a locked declaration"; the planted pseudo-replication can no longer be certified either way. |
| F6 | G1a requires the full effective unit set (no exclusions) | open | open | open (w0, p13, p6 count-mismatch on correct analyses) | **still open (unobservable)** | All affected tasks are refused at staging on V2d. Row-accounting facts exist (V2b X5) but G1a does not use them. |
| F7 | w0 integrity fact on the raw layer vs deduplicated worker inputs (false refutation) | open | n/a | **fixed** (w0 reference confirmed) | **regressed (w0 refused)** | "clinical_attributes.tsv: ambiguous biological identity" (a dictionary table). |
| F8 | G1c misses a confounder that drives the outcome (p12) | open | open | open; p12 naive tentative | **still open** | p12 naive (quality omitted) G1c passed, tentative; reference insufficient-evidence. A label inversion. |
| F9 | Honest "not identifiable" reports fail G3 (p11) | open | open | open | **still open** | p11 reference G3 failed (missing-recomputed). Label (insufficient-evidence) is right; the gate failure is a false E6 hit. |
| F10 | Shipped CLI cannot run a Python analysis | open | open | **fixed** (host environment descriptor) | **fixed** | CLI with the mailbox environment executes the p1 reference (no execution warnings); without it, still Node-only and the cause is masked as exit 80. |
| F11 | Certification is slow (round 2: executions re-parse and normalize every input) | open | open | open | **changed (slower)** | V2d: the 92 sandboxed executions take 107 s in total (median 1.0 s), but a METABRIC certification takes a median 227 s (up to 432 s), almost all of it in-process certify work outside the sandbox (not profiled; round 2: 12-37 s). See RESULTS.md timing. |
| F12 | Sporadic supervisor exit-90 "detached survivor" false positive | open (1 in 2,251 executions) | not observed | 0 in 132 executions | **not observed (0 in 92 quiet + 44 loaded + 46 omit-p)** | V2c/V2d plans carry no MEI, so the 100 planted executions per claim did not run; the sample is small. The V2c/V2d census changes target this; not established as fixed. |
| F13 | Load invariance fails on gate outcomes | open (86/88) | not run | not run | **not reproduced (E7 passes)** | A3 subset on V2d under 4 busy workers (load average 3.4 rising to 16-17): 76/76 certifications outcome-identical to the quiet records, 44 sandboxed executions, no failures (`records/load-invariance.json`). The round-2 failures were two exit-90 executions (F12); the subset is smaller than the round-2 run. |
| G5a | G5a over-fires on the n = 7 Freedman-Lane design (8.5%) | open | n/a | n/a | **fixed** | Pre-registered p12 null design (Freedman-Lane, n = 7), V2d: G5a failed on 1 of 200 null re-stagings (0.5%; round 2: 17/200 = 8.5%); all 9 kernel rejections had G5a passed (`records/null-calibration.json`). |
| T1 | p10b and p14 references need generator truth; p10b uses importlib | open | open | open (freeze refuses p10b `importlib`, p14 `re.compile`) | **still open (refused at staging)** | Task-side. |
| T2 | p4 reproduction has no trusted target offline | open | open | open | **still open** | Plan refused, so its A1 declaration is lost too (N3). |
| T3/T4 | iad1/iad2 claims carry no number; iad3 has no software fact | open | open | open | **still open** | iad tables are refused at staging on every kernel. |
| N1 | Declared staging counts dictionary-table rows as analysis units (p6 subgroups, p7 variants) | - | new | still open (p6 G1a count-mismatch) | **unobservable (p6, p7 refused)** | |
| N2 | Declared staging has no composite keys or cross-table unit joins (p8 wells, p9 expression, iad long tables) | - | new | still open | **still open** | p8, p9, iad1-3 refused. |
| N3 | A refused plan loses its staging declarations (p4) | - | new | still open | **still open** | |
| N4 | Declared effective inputs add a `unit_id` column that breaks column-iterating analyses (p7) | - | new | unobservable | **unobservable** | p7 refused before execution. |
| N5 | Freeze AST policy refuses `re.compile` (any `.compile`/`getattr`/`vars` call) and parses with system Python 3.9 under a 1 s timeout | - | - | new | **still open** | iad_common.py and p14 reference.py refused by freeze on V2d too. |
| N6 | A plan without MEI can never be confirmed (G7 MEI/2 bound), while the parser only warns "cannot be refuted" | - | (V2b filled a cap) | new | **still open** | Pre-registered design (plans without MEI), V2d: 0/600 null, 0/120 MEI and 0/60 large-effect re-stagings confirmed although the kernel rejected 10/200, 10/200 and 9/200 nulls and 60/60 large effects (each such re-staging is tentative). With `mei: 1` locked (A9) V2d confirms. |
| N9 | Trusted Student tail p = 1 - CDF underflows; with no absolute floor an accurate tiny worker p fails G3/G4 | - | - | - | **new (high)** | p1, p2, p16 references and p11 naive: G3/G4 "B7: p disagrees with its recomputed test"; worker estimate agrees to 1e-14 relative, p differs by >1e150 relative. |
| N10 | Content-identity heuristics read measurement and category columns (`sbp_bl`, `year`, `site`, `group`) as biological identities; raw tables with dictionary files become "ambiguous" | - | - | - | **new (high)** | 13/19 tasks refused (F1). |
| N11 | Coincidental content matches become blocking integrity facts (G1 and G1a fail) | - | - | - | **new (high)** | All six METABRIC tasks. 12-14% of n = 12 and 18-32% of n = 16 null re-stagings, and 10 of 40 large planted effects in A9 (E9 liveness fails for p2). |
| N12 | Raw staging keeps the first row per biological unit (replicates dropped, not aggregated) | - | - | new (p10: 8 of 12 libraries; p9: 5,549 cells to 20) | **unobservable (refused)** | |
| N13 | Model-based kernel decisions are capped below confirmed through G1a: every repeated-measures mean claim (including exchangeable designs) and every Freedman-Lane claim with a varying nuisance, which covers all six METABRIC tasks on their full tables | - | - | - | **new (by design)** | V2d BUILD-NOTES section C states the cap. A8 S1 and S3 full path: G1a failed on 400/400, 0 confirmed. Pre-registered p12 nulls: G1a failed on 260/260. Every decided METABRIC claim in the 88 records: "model-based: assumptions A1-A4" limitation. |
| N14 | The within-unit studentized test over-rejects on heteroskedastic, unbalanced repeated measures; under the cap this shows up as tentative labels on true nulls | - | - | - | **new (medium)** | A8 S1 (12 units, 1 treated row with sd 5, 5 control rows with sd 1): kernel 173/2,000 = 8.65% (Wilson 7.50-9.96%), so E11 fails; V2d's own notes report 8.75%. Full path: 0/200 confirmed (E13 passes) but 32/200 tentative (16.0%, Wilson 11.6-21.7%). |


## Answer to the coordinator's A2 question (V2b): no type-I failure

The "7 of 12" and "7 of 11" null confirmations read from `a2-*.log` were a biased sample: the
progress printer wrote **every** confirmation but only every 20th re-staging. At that moment the
denominators were 103 (p1) and 101 (p2): 8/103 and 7/101. The complete V2b runs confirmed
**10/200 (5.0%, Clopper-Pearson 2.4-9.0%) for p1 and 10/200 (5.0%) for p2**; exact one-sided
binomial p = 0.545 against alpha = 0.05 (`records/v2b/null-calibration-a2-p1-p2.json`). The trusted
kernel alone on 4,000 fresh null re-stagings from the identical generator rejected 5.25% (p1,
Wilson 4.58-5.99%), 5.20% (p2), 4.4% (p12 Freedman-Lane, n = 8, 2,000 nulls) and 5.0% (p12, n = 7)
(`scripts/kernel-null-diagnostic.ts`). None of the four suspected mechanisms applies: omit-p does
not change the kernel statistic (only which worker numbers G3/G4 compare); the re-staging is
exchangeable by construction (balanced exposure shuffled independently of the outcome); no signal
is carried over; "null" means a true zero effect. The progress lines now print running
denominators. Severity: none (resolved as a reporting artefact). The same re-stagings confirm on
V2c with a locked MEI (A9: 9/200 and 10/200) and on V2d (see the null section).

Disclosure: while cleaning scratch at 20:40 I deleted two `/private/tmp/omb-run-*` execution
directories that belonged to the running V2b A2 jobs. That invalidated exactly one large-effect
re-staging in each (p1 large 12, p2 large 8: execution failed). The null phase had finished.

## Findings in detail (new on V2b-V2d)

### N9 (V2d, high). The trusted Student p loses precision in the extreme tail

- Mechanism: `linear.ts` computes the two-sided p as `2 * min(cdf, 1 - cdf)` with `studentCDF`
  returning a value that rounds to 1 for large |t|; `1 - cdf` is then 0 or about 1e-16. V2d's
  `numericAgreement` is purely relative (B1 removed the absolute floor), so an honest worker that
  reports the accurate tail probability (scipy `t.sf`) "disagrees with its recomputed test".
- Evidence: p1, p2 and p16 references (locked and adopt) and the p11 naive analysis: G3/G4 detail
  `look.B7:p disagrees with its recomputed test`, `look.p`, `rerun.p`. A host-side diagnostic on the
  same staged data and worker output: estimate relative difference 4e-15 to 6e-15, p relative
  difference above 1e150 for p1 and p16, 4e-14 for p12 (moderate p, which passes).
- Ablation (A4/A6, `records/ablation-omit-p.json`): the same deliverables with the worker p left
  out bring the p1, p2 and p16 references back to tentative, their V2c labels (12 certifications,
  0 E10/E1 mismatches). So N9 alone explains the positive-control regression; what remains below
  confirmed is N6/N11 (and N13 for p16).
- Impact: every strong true effect fails G3/G4, so every positive control drops to
  insufficient-evidence (E3). Fix: compute the tail with a complementary incomplete-beta (or
  log-space) routine, and compare p on a log scale or with a documented floor.

### N10 (V2d, high). Content-identity heuristics refuse 13 of 19 tasks

- Evidence (`records/calibration.json`, staging warnings): measurement or category columns are
  read as biological identities: p13 `outcomes.tsv` `sbp_bl` (systolic blood pressure), p14
  `literature_index.tsv` `year`, p6 `participants.tsv` `site`, p8 `donors.tsv` `group`
  ("declared unit splits a detected biological unit"). Raw tables become "ambiguous biological
  identity requires a locked declaration" for p10/p10b `samples.tsv`, w0 `clinical_attributes.tsv`
  (a data dictionary), p13, p14, p6, p7, p8, p9 (raw probe). Only the six single-table METABRIC
  tasks stage. V2c staged 12 tasks.
- Impact: the integrity positive control (w0) and the pseudo-replication tasks (p10, p10b) cannot be
  certified at all; the planted flaws of w0, p10, p10b, p9 are not reached (E5).
- `nonBiologicalColumns` can unlock staging but caps the claim; choosing those columns per task would
  be hand-tuning, so V3 does not.

### N11 (V2d, high). Coincidental content matches block G1 and G1a on every METABRIC table

- Evidence: G1 failed on all six METABRIC tasks, G1a failed on five (p11 passes G1a), with
  "identical content observed; distinct identities retained unless full-profile corroboration
  permits collapse" and "unresolved content duplicate". These are the same coincidental
  (cohort, exposure, expression to 4 dp) matches as F4; the full source profiles show distinct
  patients.
- Mechanism (`identity.ts` `contentFindings`, read only): two rows are a "near" duplicate when
  every non-identity field but one is equal and that one differs by at most 0.1% (relative), with
  at least three informative fields. A METABRIC observation table has exactly three: `cohort`
  (constant within a cohort), `exposure` (binary) and the measurement. So any two same-cohort,
  same-exposure patients whose measurements agree within 0.1% (about 0.01 on a log2 scale) are
  "unresolved content duplicates", and `certify.ts` then fails G1a for the claim. The two
  corroborating fields carry about one bit; the third is the only real evidence.
- Rate: in the full tables (hundreds of patients) such a pair is certain, hence all six tasks. In
  the V2d A9 re-stagings (16 patients drawn from cohort 1, exposure shuffled) G1/G1a fail on
  36/200 (p1) and 63/200 (p2) null re-stagings (n = 16), and on 24/200 and 28/200 at
  n = 12 (pre-registered design). That blocks false confirmations and true ones alike: on large planted effects
  the kernel rejected 40/40 but only 17/20 (p1) and 13/20 (p2) confirmed (each miss: G1 and G1a failed,
  label tentative), so E9 liveness fails for p2.
- Impact: even with N9 fixed and authentic G7/G8, no METABRIC claim could be confirmed (G1a is a
  confirm requirement; N13 blocks the full tables as well). Three low-entropy columns cannot corroborate identity; the screen needs a
  minimum-information rule (for example, exclude constant and binary fields from the informative
  count, or require several continuous fields) before it may block.

### N6 (V2c, medium). A plan without MEI cannot be confirmed

- Evidence: V2c A2 (p1, p2, n = 16, omit-p): 0/400 null, 0/80 MEI and 0/40 large-effect re-stagings
  confirmed although the kernel rejected 10/200, 10/200 nulls and 40/40 large effects; the labeller
  reason is "G7 reported passed but replication tolerance exceeds the locked MEI bound or MEI
  missing" (`records/v2c/null-calibration-a2.json`). V2b filled the software MEI cap and confirmed.
  With `mei: 1` locked (A9) V2c confirms 9/200 and 10/200 nulls and 40/40 large effects.
- Impact: tasks whose TASK.md states no MEI (all METABRIC tasks) can never be confirmed; the parser
  warns only "this claim cannot be refuted". Either document MEI as required for confirmation (and
  say so in the warning) or restore a declared default.

### N5 (V2c, medium). Freeze AST policy false positives

- Evidence: the policy refuses any call whose last attribute is `compile`, `getattr`, `vars`, etc.
  `re.compile(...)` in `iad_common.py` (iad1-3 references) and `p14/reference.py` is refused as
  dynamic code. The policy parses with `/usr/bin/python3` (3.9.6) while analyses run on 3.13, with a
  1-second timeout per file (load-dependent; not observed to trigger).
- V3 change: the generic runner no longer needs `exec` (A7); task code is untouched, so these task
  files stay refused.

### N12 (V2c, medium). Raw staging drops replicate rows instead of aggregating them

- Evidence (V2c raw probe): p10 `counts.tsv` 12 libraries to 4 lines, keeping the first library
  per line; p9 `cells.tsv` 5,549 cells to 20 donors. The p10 naive analysis then passes G1a
  because its pseudo-replication was deleted with two thirds of the data, and the correct analysis
  silently averages one library per line. V2d refuses these tables instead.

### N1-N4 (V2b, declared staging)

- N1: dictionary tables (p6 `subgroups.tsv`, p7 `variants.tsv`) become analysis units; p6's correct
  analysis fails G1a `count-mismatch` on V2b and V2c.
- N2: no composite keys (p8 `wells.tsv` plate x well; iad long tables subject x cycle) and no
  cross-table unit join (p9 `expression.tsv` cells map to donors only through `cells.tsv`).
- N3: declarations live in the plan, so a refused plan (p4, target-less reproduction) loses them.
- N4: declared effective inputs append `unit_id`; p7's analysis iterates every genotype column and
  crashed on V2b (worker failed in locked mode).

### N13 (V2d, by design). Model-based decisions are capped below confirmed

- Mechanism (`certify.ts`): when the kernel's guarantee starts with "model-based", the guarantee
  text is added to the claim's scientific limitations and G1a is set to failed, which keeps the
  label at tentative or below. V2d documents this for repeated-measures mean claims (BUILD-NOTES
  section C). It also covers every Freedman-Lane claim whose nuisance is not constant within
  strata (`permutation.ts`: guarantee "model-based: assumptions A1-A4").
- Evidence: A8 S1 and S3 full path, G1a failed on all 400 re-stagings, including S3, an
  exchangeable sharp null. Pre-registered p12 nulls (Freedman-Lane, n = 7): G1a failed on all 260
  re-stagings, so every large planted effect was tentative (20/20). In the 88-certification record
  every METABRIC claim the kernel decides carries "primary: model-based: assumptions A1-A4" as a
  G1a limitation (next to N11's duplicate warning). Re-stagings draw from one cohort, so their
  nuisance is constant, the guarantee is exact, and A9 can confirm.
- Impact: on the full METABRIC tables, and for any repeated-measures claim, confirmed is
  unreachable. The pre-registered offline expectation for the positive controls is tentative, so
  this produces no E3 mismatch. It does mean a live arm cannot confirm p1, p2 or p16 even with
  authentic G7/G8. This trades yield for safety; it is recorded so that V2e can be judged against
  it.

### N14 (V2d, medium). Tentative labels on heteroskedastic repeated-measures nulls

- Evidence: A8 S1 kernel level, 173/2,000 rejections (8.65%, Wilson 7.50-9.96%). V2d's own
  simulation of the same design reports 8.75% (`omb-certify/calibration/repeated-results.jsonl`).
  Full path: 0/200 confirmed, but 32/200 re-stagings were labelled tentative (16.0%, Wilson
  11.6-21.7%). `scripts/synthetic-path-diagnostic.ts` regenerates the same 200 path datasets and
  the trusted kernel rejects 31 of them in-process. So the certify path reproduces the kernel, and
  the gap from 8.65% is dataset sampling: pooled over 2,200 datasets the rate is 205/2,200 = 9.3%
  (Wilson 8.2-10.6%).
- Impact: the cap prevents false confirmation, as designed. But the false tentative rate is about
  twice alpha, and the only signal to a reader is a G1a limitation string. Either report capped
  claims under a distinct label or calibrate the studentized within-unit test for small, unbalanced
  designs.


## Null calibration

Same generators, seeds and counts as on V2c; V2d records `records/null-calibration.json`
(pre-registered), `null-calibration-a2.json` (A2) and `null-calibration-a9.json` (A9). A false
confirmation is a confirmed or replicated label on a re-staging with no effect. Intervals:
Clopper-Pearson 95%; "P" is the exact one-sided binomial P(X >= k | alpha = 0.05), the E8 test.

| Design | Task (n) | Null confirmed | P | Kernel rejected (null) | G1/G1a failed (null) | MEI confirmed | Large confirmed |
|---|---|---|---|---|---|---|---|
| Pre-registered (no MEI in plan) | p1 (12) | 0/200 (0-1.8%) | 1.000 | 10/200 | 24/200 | 0/40 | 0/20 (20 tentative) |
| | p2 (12) | 0/200 (0-1.8%) | 1.000 | 10/200 | 28/200 | 0/40 | 0/20 (20 tentative) |
| | p12 (7, Freedman-Lane) | 0/200 (0-1.8%) | 1.000 | 9/200 | G1a 200/200 (N13) | 0/40 | 0/20 (20 tentative) |
| A2 (omit-p, no MEI) | p1 (16) | 0/200 (0-1.8%) | 1.000 | 10/200 | 36/200 | 0/40 | 0/20 (20 tentative) |
| | p2 (16) | 0/200 (0-1.8%) | 1.000 | 10/200 | 62/200 | 0/40 | 0/20 (20 tentative) |
| A9 (A2 + locked `mei: 1`) | p1 (16) | **7/200 (3.5%, 1.4-7.1%)** | 0.876 | 9/200 | 36/200 | 7/40 | 17/20 |
| | p2 (16) | **6/200 (3.0%, 1.1-6.4%)** | 0.938 | 10/200 | 63/200 | 10/40 | 13/20 |
| | p12 (8, Freedman-Lane) | 0/200 (0-1.8%) | 1.000 | 6/200 | G1a 200/200 (N13) | 0/40 | 0/20 (20 tentative) |

- **E8 passes on every design and task**: no null design confirms above alpha. The only design that
  can confirm (A9) gives 3.5% and 3.0% (p1, p2; pooled with p12 13/600 = 2.2%), against 4.5% and
  5.0% on V2c (9/200, 10/200). p12 cannot confirm under the model-based cap (N13). The
  pooled kernel null rejection is 29/600 = 4.8% (pre-registered) and 20/400 = 5.0% (A2), so the
  trusted kernel is calibrated at these sizes. Every confirmation coincides with a kernel
  rejection with G5a passed. The gauntlet adds no false positives; it only blocks.
- **G5a no longer misfires**: 1/200 G5a failures on the p12 Freedman-Lane null (round 2: 8.5%).
- **E9 fails everywhere**, for three reasons:
  - without a plan MEI nothing can be confirmed (N6), which covers the pre-registered design and A2;
  - an MEI of one outcome unit is under-powered at n = 16 (7/40, 10/40; the kernel itself rejects
    10/40 and 16/40);
  - with an MEI, liveness fails for p2 because N11 fails G1/G1a on 7 of 20 large-effect
    re-stagings (p1 3 of 20). The kernel rejected all 40, and every miss is tentative.
- **N11 at small n**: the coincidental-duplicate screen fails G1/G1a on 12-14% of n = 12 and
  18-32% of n = 16 null re-stagings. This lowers the false confirmation rate below alpha and costs
  the same share of power.
- Sandbox validation (three re-stagings per task run in the real sandbox as well as in-process):
  identical outcome fingerprints in every run.

## Repeated-measures stress designs (A8, coordinator request)

Pre-registered as A8 (E11-E13, 48b5d6c); first complete run on V2d (`records/synthetic-null.json`).
Rates are rejections or confirmations per dataset, with Wilson 95% intervals.

| Design | Level | Datasets | Kernel rejected | False confirmations | Rule |
|---|---|---|---|---|---|
| S1 heteroskedastic, unbalanced (12 units, 1:5, sd 5 vs 1, greater) | kernel | 2,000 | 173 = 8.65% (7.50-9.96%) | - | **E11 fails** |
| S2 heteroskedastic, unbalanced (30 units, 1:3, sd 3 vs 1, two-sided) | kernel | 2,000 | 90 = 4.50% (3.68-5.50%) | - | E11 passes |
| S3 large-magnitude ties (1e6 + Bernoulli(0.1), 5 units, 1:3, greater, exhaustive) | kernel | 2,000 | 12 = 0.60% (0.34-1.05%) | - | E11 passes |
| S4 constant outcomes (30 shapes, 5 magnitudes up to 1e9 + 7) | kernel | 30 | 0 | - | E12 passes |
| S1 | full certify path | 200 | 32 = 16.0% (11.6-21.7%) | 0 (0-1.9%) | E13 passes; 32 tentative (N14) |
| S3 | full certify path | 200 | 0 (0-1.9%) | 0 (0-1.9%) | E13 passes |

- The large-magnitude rounding defect is gone on V2d. On V2c the coordinator's re-probe
  (`_logs/v2c-probe-evidence/rm-rand`) measured 27.3% rejections on the S3 design and found a
  constant table confirmed. V2d rejects no constant shape, and the ties design is conservative
  (exhaustive orbit, 0.6%).
- The heteroskedastic weak null still over-rejects at 12 units (S1: 8.65%; the V2c re-probe
  measured 19.25% for a one-sided heteroskedastic design). At 30 units with a two-sided test it is
  calibrated (S2). The model-based cap (N13) turns every S1 kernel rejection into a
  tentative label, never a confirmation (N14).
- Every full-path re-staging fails G1a with the model-based limitation (N13), so the full path
  cannot confirm a repeated-measures claim even with an exchangeable sharp null (S3).
- The first V2d kernel-level run printed the same counts but crashed while writing its record: the
  S4 field `value` tripped the answer-free check. It was renamed `level` and re-run with
  identical results (deterministic seeds).

## Load invariance

Amendment A3 on V2d (`records/load-invariance.json`, `scripts/load-invariance.ts --workers 4`):
every certification of p1, p10, p11, p12, p7 and w0, plus every task whose staging V2d refuses.
That is 16 tasks and 76 certifications, re-run while 4 equal-priority busy loops ran. The run went
alone, after all other V2d jobs.

- **E7 passes: 76/76 outcome fingerprints identical** to the quiet V2d records (labels, gate
  outcomes and codes, execution statuses, kernel decisions).
- Load average rose from 3.4 to 16-17 on 10 cores (the locked pilot was also running). The 44
  sandboxed executions all succeeded, with no exit 90.
- METABRIC certifications under load took 0.9-1.6 times their quiet time (p12 reference locked:
  391 s quiet, 621 s loaded). Wall time for the subset was 3,371 s.
- Scope: the round-2 failure (86/88) came from two sporadic exit-90 executions in 2,251. This
  subset has 44 executions and no planted executions, so it cannot show that F12 is fixed, only
  that V2d's decisions do not depend on load.

## Still-open findings ranked by impact

Ranked by what blocks stage 0 (correct references reach their labels; naive analyses and nulls never
confirm). For every kernel finding the fix belongs in `omb-certify`; V3 changed no kernel code.

1. **N9 (high).** Trusted Student tail p underflows, and the relative-only p comparison makes
   every strong true effect fail G3/G4. All three METABRIC positive controls drop to
   insufficient-evidence; the omit-p ablation restores their tentative label.
2. **N10 (high).** Content-identity heuristics refuse 13/19 tasks (F1 regressed). This includes
   the w0 integrity positive control (F7 regressed) and both pseudo-replication tasks (F5), so
   their planted flaws are never reached (E5).
3. **N11 (high).** The near-duplicate rule counts a constant column and a binary column as
   corroboration. G1/G1a fail on every full METABRIC table and on 12-32% of small null
   re-stagings, costing liveness (E9 for p2: 13/20).
4. **N6 (medium).** A plan without MEI can never be confirmed, and the warning says only "cannot
   be refuted". No METABRIC task states an MEI.
5. **F8 (medium).** G1c misses p12's confounder: the naive analysis is tentative while the
   adjusted reference is insufficient-evidence (a label inversion, on V2c and V2d).
6. **N14 (medium).** The heteroskedastic, unbalanced repeated-measures null is rejected at 8.65%.
   The cap prevents confirmation, but 16% of those nulls are labelled tentative.
7. **N5 (medium).** Freeze AST false positives (`re.compile`) refuse the iad and p14 references.
8. **F11 (medium).** A METABRIC certification takes about 4 minutes, almost all in-process. That
   bounds how many re-stagings and tasks a calibration or a live arm can afford.
9. **F9 (low).** The honest p11 "not identifiable" reference fails G3 (missing-recomputed); its
   label is right.
10. **Declared staging gaps N1-N4, F6** (unobservable while N10 refuses the tasks) and the
    **task-side items T1-T4**.

Not defects, but they bound what V2d can show: **N13** (model-based decisions capped below
confirmed, by design) and **F12** (exit-90 not observed in 182 V2d executions; there were no planted executions
to sample).
