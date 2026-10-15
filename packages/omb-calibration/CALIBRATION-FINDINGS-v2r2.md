# V3 calibration findings: round-2 kernel (archived, unchanged since e1ad9d7 except this title)

Stage-0 offline calibration of the v2 gauntlet (`omb certify`), no AI arms. Expectations were
pre-registered in `PREREGISTRATION.md` (commit 97d745a) before the first calibration run; every
mismatch below is reported as found and nothing was tuned to remove one. Tables are in
`RESULTS.md`, generated from `records/`. Evidence never quotes a task value: records and this note
carry labels, gate outcomes/codes, column names, counts of duplicate groups and timings only.

Two kernels were calibrated with the same deliverables: the V2 round-1 kernel as first merged
(`records/calibration-v2r1.json`, git 97d745a+runners) and the V2 fix-round-2 kernel merged at
24e9eb1 (`records/calibration.json`, the final record). Labels are identical between them; gate
outcomes differ (section "Kernel round 1 vs round 2").

## Headline

- 88 certifications (19 tasks, 44 analyses, adopt and locked). **No analysis was ever confirmed**
  (E1, E2 hold), and **no reference analysis earned more than insufficient-evidence either**: in
  locked mode 61 claims are insufficient-evidence, 16 exploratory (unplanned extras and post-hoc
  claims), and the one other label is a **false refutation** of the w0 positive control (F7).
  Every adopt-mode claim is exploratory (E4 holds).
- 54 mismatches against the pre-registration (round-1 kernel: 15). E3: 6 reference labels wrong
  (p1, p2, p16 positive controls stuck at insufficient-evidence; iad2, iad3; w0 refuted). E5: 5
  planted flaws not caught by their gate (p10, p10b, p12, p14, p9). E6: 43 gate failures on
  correct analyses, almost all G3/G4 in round 2.
- Causes, in order of reach: staging refuses 10 of 19 tasks (F1); the exact permutation kernel
  abstains at every real sample size (F2); round-2 G3/G4 accept only a worker that reproduces the
  kernel's permutation p-value (F3); G1 false duplicate merges (F4); G1a blind to replicate
  structure (F5) and to legitimate exclusions (F6); integrity facts on the wrong input layer (F7);
  G1c blind to outcome-strong confounders (F8); the CLI cannot run Python (F10); sporadic
  supervisor false positives (F12) make gate outcomes, and load invariance (F13), non-reproducible.
- Null calibration (E8) passes only vacuously (0/600 confirmed, because G3/G4 block everything);
  descriptively the trusted kernel rejected 4.8% of 600 null re-stagings (95% CP 3.3-6.9%), as an
  exact test should. Planted-effect yield (E9) fails: 0/120 confirmed.
- The gauntlet is safe on this suite (it never confirms) but not yet useful: as calibrated it
  cannot confirm a true positive control, and on no task does a correct analysis get a better
  label than its naive counterpart (the only reference/naive label difference, w0, favours the
  naive analysis: F7). Stage 0 of the design is not met; CP1 should not run B+G expecting
  confirmations until F1-F3 are fixed.

## Findings about the kernel

### F1. Staging refuses 10 of 19 tasks, so their reference and naive analyses are indistinguishable

- Evidence: `stagingAvailable: false` and warnings in every record for iad1, iad2, iad3, p4, p6,
  p7, p8, p9, p13, p14. Per-file probe of `parseStageTable` (bio-toolpack single-parse):
  - `unsupported staged table`: README.md (iad1-3), protocol.md (p13), draft_introduction.md and
    literature_records.jsonl (p14). One non-table file refuses staging of the whole dataset.
  - `ambiguous identity; staging declaration required`: no recognised unique identity column in
    predictions.csv / psa_history.csv / training_roc.csv / psa_series.csv (long format, `subject`),
    outcomes.tsv and participants.tsv (`participant_id`), literature_index.tsv (`record_id`),
    Swarm_1.csv (`DishNumber`), subgroups.tsv, variants.tsv (`variant_id`), wells.tsv (plate+well),
    cells.tsv / expression.tsv (`cell_id`). The identity patterns accept only sample/patient/donor/
    cellline/attribute/id names, and there is no staging-declaration mechanism.
- Consequence: no execution; every claim is insufficient-evidence (locked) or exploratory (adopt)
  whatever the analysis does. The planted flaws of p6 (G6), p9 (G1b), p13 (G2) and p14 (CIT) can
  never be caught; p7 and p8's G5b-power "fails" only because the trusted computation is
  unavailable. The design's stage-0 target (">= 14 of 16 reference labels correct") cannot be met
  while half the suite cannot be staged.

### F2. The exact permutation kernel abstains at every realistic sample size

- Evidence: all 24 staged METABRIC-task certifications (p1, p2, p5, p11 naive, p12, p16; 390-790
  effective units) record kernel `unresolved`, stopping `work-limit`; decision `unevaluable`;
  G6 `incomplete-family`; G5b-power failed. Code: `permutation.ts` decides only when the orbit is
  at most `maxPermutations / alpha` (2 x 10^6 by default): about n <= 25 for a balanced binary
  exposure, n <= 9 for a Freedman-Lane residual permutation.
- Consequence: the positive controls p1, p2 and p16 cannot reach tentative (E3 mismatches); no
  statistical claim on any task dataset can earn a label above insufficient-evidence. The
  host can raise the work limit, but exhaustive enumeration grows combinatorially; a valid
  Monte Carlo decision rule (or an exact conditional test with a Monte Carlo error budget) is
  needed before stage 1.

### F3. Round 2: G3/G4 require the worker to reproduce the kernel's permutation p-value

- Evidence: round-2 `certify.ts` fails G3 and G4 unless the look and re-run `primary.json` report
  an estimate and p within 1e-8 of the trusted kernel's estimate and permutation p; a missing p
  or an unavailable kernel is a disagreement. In `calibration.json` G3 and G4 fail on every
  reference and naive analysis of every staged task (round 1: passed on all honest locked runs
  except p11 and p10b). On the null re-stagings, where the kernel does resolve, the reference
  reports the classical t p-value it was written to report, so G3/G4 fail and nothing can be
  confirmed (null-calibration liveness, E9).
- Consequence: confirmation is reachable only for an analysis whose p-value is bit-identical to
  the kernel's exact permutation p. Every reference in the suite reports a parametric p. A
  numerically honest analysis is labelled "numbers not verified". Round 2 also reports G3/G4 as
  `failed` (not `not-run`) when staging or the kernel is unavailable, so the firing ledger now
  counts infrastructure gaps as gate failures on correct analyses (43 of the 54 E6 mismatches).

### F4. G1 merges coincidental content matches and drops real patients from the effective inputs

- Evidence: on p1, p2, p5, p11 and p16 the staged observations.tsv has 3, 6, 3, 2 and 1 groups of
  rows with identical (cohort, exposure, expression to 4 dp). Their full source profiles
  (ESR1, ERBB2, ACTB, MKI67) all differ: distinct patients. `effectiveTable` keeps the first row
  of each group. Adopt-mode G3 failed with `mismatch` on these tasks in round 1, because the
  worker computed on the raw table and the software look on the effective one.
- Consequence: false duplicate merging silently changes n and the estimate. Low-entropy row
  signatures (few columns, rounded values) need a collision guard (minimum informative columns,
  or a cross-table identity requirement) before merging.

### F5. G1a cannot see replicate structure unless a column is named donor/patient/cellline, and then inverts on p10

- Evidence: p10's sample sheet carries `line_id`; the donor pattern does not match it, so the
  effective units are the 12 libraries. Locked: the naive analysis (libraries as units) passes
  G1a; the reference (line-level n) fails G1a with `count-mismatch`. p10b (line hidden) behaves
  the same for the naive analysis.
- Consequence: the planted pseudo-replication flaw (E5) is missed and the correct analysis is
  penalised (E6). Integrity catalog B24 (hidden replicate structure) is the planned fix.

### F6. G1a requires the analysis to use the full effective unit set

- Evidence: w0 reference and naive both fail G1a `count-mismatch` (the analysis set is patients
  with expression and survival; the effective set is every merged subject across the four tables).
- Consequence: any legitimate population restriction or exclusion fails G1a until row accounting
  with declared exclusions (catalog B4) exists. On w0 the flaw gate fires, but it fires on the
  correct analysis too, so it does not discriminate.

### F7. Integrity claims are judged against raw-data facts while route-P workers see deduplicated inputs

- Evidence (w0 reference, booleans only): on the raw staged data the reference's duplicate-profile
  count equals the G1 fact `expression_mrna.tsv.duplicate_records` (adopt: decision `supported`);
  on the software effective inputs it counts zero, because staging already merged the duplicates
  (locked: decision `contradicted`, label **refuted**). Data-integrity refutation needs only G1.
- Consequence: in locked mode a correct integrity analysis is "software-verified to be false". The
  only non-insufficient label in the whole calibration is this false refutation of a positive
  control. Integrity facts must state which input layer they describe, and claims must be matched
  to that layer.

### F8. G1c misses a confounder that is moderately associated with the exposure but drives the outcome

- Evidence: p12 naive (quality omitted): G1c passed; recorded classification `strong: []`. G1c
  rates only the exposure-covariate association against the 0.5 threshold, never the covariate-
  outcome association.
- Consequence: the planted confounding flaw of p12 is not caught (E5 mismatch).

### F9. Honest "not identifiable" reports fail G3 (round 1)

- Evidence: p11 reference reports a null estimate and interval (identifiable = false). Round 1:
  G3 `missing-recomputed` because the claimed null is treated as a number to verify.

### F10. The shipped `omb certify` CLI cannot execute a Python analysis

- Evidence: the CLI hard-codes `toolPath` to the node runtime plus /usr/bin:/bin. Running the CLI
  on the p1 reference deliverable gives `analysis command failed (exit 80)` for look and re-run;
  the same deliverable executes under the identical executor with the pixi runtime added. Exit
  80 is the Darwin supervisor's code for any non-zero child exit, so the real cause (command not
  found) is masked; the supervisor maps every failure to 80/90/124.
- Consequence: V3 drives `certifyDirectory` with the CLI's options plus a Python runtime grant;
  the CLI needs a trusted runtime-grant option before arms that write Python can be certified.

### F11. Executions re-parse and rewrite every input table

- Evidence: w0 look/re-run executions take 15-45 s each against the 60 s deadline (the 287 MB
  matrix is copied and normalized per execution); METABRIC certifications rose from about 2.5 s
  (round 1) to about 25-30 s (round 2), dominated by 100 sandboxed planted executions.
- Consequence: load sensitivity and slow promotion; in-process simulation (strictness R11) and
  one normalization per staged dataset would remove most of it.

### F12. Sporadic sandbox-supervisor failures make gate outcomes non-reproducible

- Evidence: two quiet runs of the same round-2 calibration (deterministic execution ids, inputs
  and code) differ in 2 of 88 certifications. In the final record, one of the 100 planted
  executions of p1 naive (locked) failed with exit code 90, the Darwin supervisor's "observed
  detached survivor: killed, but execution fails closed"; in the earlier record one planted
  execution of p2 reference (adopt) failed, which turned its G5b-recovery from passed to failed.
  The analyses are single-process Python scripts; nothing in them detaches. The same phenomenon
  appeared in V2's own suite during V3's root test runs: `omb-certify/test/certify.test.ts`
  "end-to-end uses software runs" failed once with G3 "changed-truth probe failed" (a sandboxed
  dependence execution failed under machine load) and passed in the other runs.
- Consequence: an honest analysis can lose a simulation gate at random. Here labels did not move
  (upstream gates already fail), but on a working confirm path one supervisor false positive in
  any of ~104 executions would change a label. The supervisor's census needs a false-positive
  rate measurement and a retry rule that cannot be abused (a survivor that reappears on retry
  still fails).

### F13. Load invariance (E7) fails on gate outcomes, for the F12 reason, not because of deadlines

- Evidence (`records/load-invariance.json`): under 8 equal-priority busy workers (load average
  rising to about 16 on 10 cores) 86 of 88 certifications were outcome-identical to the quiet run.
  All 88 labels, decision outcomes and kernel statuses were identical. The two differences: p1
  reference (locked) lost G5b-recovery under load when one planted execution failed with
  supervisor exit 90; p1 naive (locked) had exactly such a failure in the quiet run and none under
  load. No execution hit the 60 s deadline (slowest loaded certification: w0 reference, 33 s);
  wall time rose 1.23x (848 s -> 1,045 s).
- Consequence: the pre-registered rule (identical gate outcomes) fails. The design invariant "no
  gate outcome may depend on a wall-clock deadline" was not violated in this run, but gate outcomes
  are not reproducible even on a quiet machine (F12), so load invariance cannot be certified until
  the supervisor false positives are fixed. Official runs should keep the quiet-machine rule.

## Findings about the tasks

- **T1. p10b and p14 references are not analyses of staged data alone.** p10b injects generator-
  truth line ids into its samples; p14 takes the citation statuses from truth. Under the truth-free
  runner p10b crashes (exit 1) and p14 produces no results (exit 4); their deliverables execute
  nothing (G3/G4 fail, G1a `units-missing`).
- **T2. p4 is a reproduction claim with no trusted target offline.** Without decrypting the key
  there is no card target; the plan parser refuses the target-less claim, so every p4 claim is
  exploratory.
- **T3. iad1 and iad2 `fit_for_use` carry no number.** The kernel has nothing to evaluate even if
  staging worked; iad2's expected tentative is unreachable with this schema.
- **T4. iad3 has no software fact for an inclusion-rule count.** The positive control can only be
  verified by a G1 fact that does not exist.
- **T5. p12's planted confounder is below G1c's strong threshold** (see F8); the naive analysis is
  not distinguishable from the reference by any gate.

## Kernel round 1 vs round 2

Same 88 deliverables, same expectations. Labels: identical (0 changes). Mismatches: 15 (round 1)
-> 54 (round 2). The change is entirely in G3/G4 and G5b-recovery:

- G3 and G4 went from passed to failed on every honest locked analysis of a staged task (p1, p2,
  p5, p10, p10b naive, p11 naive, p12, p16; p11 reference G4), because round 2 binds them to the
  kernel's look computation (F3). Where staging or the kernel is unavailable, G3/G4 went from
  not-run to failed.
- G5b-recovery went from failed to passed on several METABRIC analyses: round 2 no longer needs a
  resolved kernel for recovery, and 100 planted executions now complete (previously the first
  unresolved planting aborted the gate). G5b-power still fails (unresolved plantings count as
  non-rejections). Certification time per METABRIC analysis rose from about 2.5 s to 25-30 s.
- Repeat runs on the round-2 kernel (records committed at ec8b62e vs the final record) differ in
  two of 88 certifications, both from one sandboxed planted execution failing (see F12).

## Null calibration

Design as pre-registered (p1-esr1 and p2-erbb2 at n = 12, p12-quality at n = 7; reference
analysis, locked, G7/G8 stand-ins that always pass). Run as three parallel processes, one per task,
merged with `--merge` (`records/null-calibration.json`, 2,110 s wall for the slowest part).

| Task | Null: confirmed / 200 (95% CP) | Kernel rejected under the null (descriptive) | MEI: confirmed / 40 | Kernel rejected at MEI | Liveness (+4 SD): confirmed / 20 | Kernel rejected |
|---|---|---|---|---|---|---|
| p1-esr1 | 0 (0.0-1.8%) | 10 (5.0%, 2.4-9.0%) | 0 | 6 | 0 | 20 |
| p2-erbb2 | 0 (0.0-1.8%) | 10 (5.0%, 2.4-9.0%) | 0 | 8 | 0 | 20 |
| p12-quality | 0 (0.0-1.8%) | 9 (4.5%, 2.1-8.4%) | 0 | 23 | 0 | 20 |
| pooled | 0 / 600 (0.0-0.6%) | 29 / 600 (4.8%, 3.3-6.9%) | | | | |

- **E8 passes, vacuously.** No re-staging was confirmed, because G3 and G4 failed on every one
  (F3: the reference reports a classical t p-value; the kernel's look p is the exact permutation
  p). The binomial bound therefore says nothing about the decision rule's alpha.
- **The decision core itself is calibrated.** Read descriptively, the trusted kernel rejected 4.8%
  of 600 null re-stagings (exact one-sided test of rate <= 0.05: p = 0.60), and 5.0% / 5.0% / 4.5%
  per task, as an exact permutation test at alpha 0.05 should (C(12,6) = 924 label permutations allow at most
  46/924 = 4.98%). Not pre-registered as a pass rule.
- **E9 fails (MEI and liveness).** The confirm path is dead for this analysis: 0 of 120 planted
  re-stagings confirmed although the kernel rejected 60/60 at four standard deviations. At the MEI
  the kernel's own power was 15%, 20% and 57.5%: the decidable sample sizes are far too small for
  the design's ">= 80% of effects planted at the MEI are confirmed" (F2).
- **G5a over-fires on the small Freedman-Lane design.** p12 null re-stagings failed G5a in 17/200
  (8.5%, 95% CP 5.0-13.3%) against about 1% for the exact label designs (2/200, 4/200) and the
  rule's designed false alarm of about 1.1%. The Freedman-Lane decision at n = 7 carries the
  "model-based" guarantee; its null simulations reject above alpha on some data sets even though
  the realised null rejection rate across re-stagings (4.5%) is fine.
- **Sandbox validation passes.** For 3 null re-stagings per task, the real sandboxed program (104
  executions, 28-41 s) and the in-process transcription (3-12 s) gave identical outcome
  fingerprints. Median certification: 2.3 s (p1, p2), 5.9 s (p12).

## Load invariance

E7: **fail** (86/88 identical; all labels identical). See F13. Per-certification quiet and loaded
timings are in RESULTS.md; METABRIC certifications slowed 1.1-1.5x under load, w0 1.2-1.5x. The
quiet run itself shared the machine with the locked pilot's arms and the V4 builder (load
average 4-11 during it), so "quiet" means "no V3 load generator".

## Mismatch index

Every row of RESULTS.md "Mismatches against the pre-registration" maps to a finding:
E1, E2, E4: none. E3: p1, p2, p16 (F2, F3); iad2 (F1, T3); iad3 (F1, T4); w0 (F7). E5: p10, p10b
(F5); p12 (F8); p14 (F1, CIT not produced offline); p9 (F1). E6: p10 (F5); p10b (T1); w0 (F6);
p11 G3 (F3; round 1 F9); every other G3/G4 failure (F3: kernel unavailable or permutation-p
disagreement).
