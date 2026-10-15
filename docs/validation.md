# Validation

Everything on this page is a **developer-run** result from a system under active development. It is
stated with its limits, including the negative ones. None of it is an independent evaluation, and none
of it shows that Amani is reliable in general or that it has found anything new.

The architecture is a proposal for making research more reliable. Testing tells us where it works,
where it refuses too much and where it can still be wrong.

## The validation ladder

| Rung | What it tests | Status |
|---|---|---|
| **Tier A: known-answer tests** | Cases where the correct result is known or planted. Useful for building and calibrating; passing them is not an independent test. | Built; results below. |
| **Tier B: sealed one-shot investigations** | Cards and scoring rules frozen before the run; one attempt each; the system learns nothing back except criterion names and pass or fail. | One round run: 5 cards. |
| **Tier B2: trap cards built by another AI family** | Hidden flaws designed outside the builder's model family, to find blind spots a builder and its own tests share. | Planned. No pass rate is claimed. |
| **Tier C: open problems written up as papers** | Real open questions, written up as papers with the full checks. | In preparation. Topics are not announced. |
| **Tier D: ALS** | The long-term goal, on public data only. | Gated on the earlier rungs. |
| **Independent evaluation and head-to-head** | Evaluation by people who did not build the system, and a pre-registered comparison with other research agents. | Planned. Not run. |

## Tier B: five sealed one-shot investigations

Five benchmark cards were built from public-data cases, blinded with keyed tokens, sealed, and scored by
a host-side grader. Amani got one attempt on each.

- **Result: 59 of 66 criteria passed (89%).** Two of the five cards were answered perfectly.
- Most of the misses came from a reporting rule that withheld correct answers. One was a real scientific
  mistake in colocalisation (deciding whether two biological signals share a genetic cause): the method
  assumed a simpler situation than the data had. It has since been fixed with a verified method.
- **What the result does not show.** The 66 criteria come from five cards, not from 66 independent
  studies. It is an internal evaluation, not an estimate of general reliability, an external audit or
  evidence of a new treatment. Fixes made after the run are regression evidence, not new blinded
  validation, and a fresh set of sealed cards is needed to measure them.
- The cards, keys and held-out material are private and are not in this repository.

## Tier A: known-answer tests and calibration

### Certified methods, calibrated by simulation

For the Tier C methods (trial meta-analysis and trial-level surrogacy), 35 design cells of 5,000
simulated datasets each (175,000 datasets) were run with a fixed, recorded seed.

- **All 29 release cells pass** the declared pointwise upper bound of 6.25% (a Clopper–Pearson bound) on
  null rejection and interval non-coverage, with at least 95% of datasets estimable.
- **Six stress cells fail and are excluded** from the certified range as whole families, including cells
  whose individual intervals pass. Examples: a bivariate t5 null rejected 12.14% of the time, and a
  Fisher R² interval covered only 87.7–89.4%. They are exposed in the record, not averaged away.
- No claim of simultaneous confidence or interpolation between cells is made. The label's envelope is
  hashed with the full simulation artifact, and every label prints the assumptions and the cells it was
  evaluated on.
- The outputs were also compared with independent R reference software (for example `metafor` for
  meta-analysis and the `Surrogate` package for trial-level surrogacy).

The registered procedures for the core kernel went through the same kind of simulation (the K2a
feasibility study, [`FEASIBILITY.md`](../packages/omb-procedures/FEASIBILITY.md)). The main findings:

- Minimum design envelopes were found for every built procedure, for example a smaller arm of at least 8
  at 1:1 allocation for the two-group procedure and at least 6 units for the paired one.
- Honest designs with a planted effect can reach Confirmed at ≥ 0.84 times the power of a correctly
  specified parametric oracle.
- **A negative result.** Mean-type tests cannot be certified against rare, far outliers: an adversarial
  search found false-Confirmed rates of 52–97% at design corners with such contamination, and every one of
  those false results came from a sample in which no outlier was drawn. No rule computed from the sample
  can separate that case from real low-noise data with a real effect. So mean-type Confirmed claims now
  state a contamination bound, and carry a rank-based companion estimate.

### Known-answer harnesses

- **Backtest reproduction (BT1).** Reproducing a published analysis of the relative success of
  genetically supported drug targets, an unmodified R analysis re-run in a locked environment gave 2.632
  overall and 2.511 in neurology, an absolute discrepancy of 0 against a tolerance of ±0.05.
- **BT2 and BT3.** BT3, a planted-effect card, recovered a truth of 2.000 as 1.869 (95% interval 1.405 to
  2.488), with the truth covered in 576 of 600 planted draws (96.0%). BT2 is calibrated, but its
  development band **fails** its own pre-set requirement that the interval's lower bound exceed 1.3. The
  historical-join card (BT4) is unavailable and fails closed. The backtest's power to detect a better
  ranker is 78.8% at +0.050 AUROC and 87.7% at +0.055, and is substantially underpowered (23.7%) at the
  +0.02 minimum effect of interest. The drug-ranking backtest therefore stays **uncertified**, with
  unranked evidence cards only. These are synthetic results and do not establish power for an actual
  biological ranker.
- **Planted target-direction conflicts (PL4).** A registered calibration run used five fresh keys and 600
  packs per key per stratum: the reference analysis passed 3,000 of 3,000 packs in both the forward and
  reversed strata, and a classifier trained to find structural shortcuts scored an AUC of about 0.50
  (registered ceiling 0.55). An earlier development cohort *failed* the leave-one-key-out rule, and all
  four runs are disclosed. The screen is univariate and not a proof against every multivariate
  shortcut; real-versus-simulated realism checks are not built, so PL4 is **not certified**. A related
  family (PL1) is disabled because review found structural shortcuts in its generator.
- **Mutation testing.** The guards of several packages were mutated one at a time and a test was
  required to fail for each mutant. Where such audits were run, their kill tables and any surviving
  mutants are recorded in the package's notes and mutation-result files.

### Baseline: plain models on the 19-task trap suite

A locked study, run on 2026-10-11 from a pinned commit, gave plain models a 19-task suite of
public-data analyses, each with a planted trap (duplicate patients, pseudo-replication, leakage,
confounding, citation errors and so on).

| Arm (main phase) | Graded | Passed | Pass rate |
|---|---:|---:|---:|
| Plain Claude Code, 3 attempts per task | 39 | 32 | 82% |
| Plain Codex, 1 attempt | 18 | 14 | 78% |
| Codex plus the check-and-simulate tool pack, 1 attempt | 18 | 14 | 78% |

Plain frontier models already pass most single-trap tasks (about 80%), so a harness cannot win by being
careful in general. Every arm failed the citation task and the duplicate-patients task. These baseline
arms are *not* a comparison with Amani. They are the reference against which Amani's own arms will be
measured. 18 of 57 plain-Claude runs were blocked by a provider usage classifier before any work, and
are reported separately as infrastructure events. See
[`design/pilot19b_results.md`](design/pilot19b_results.md).

## What a clean clone can and cannot run

- `pnpm typecheck` and the package test suites run from a clean clone, except where noted below.
- Some `bio-tasks` Python tests need private host-side material (the sealing key and cached benchmark
  datasets under `~/.omerta-bio/`). Without it they fail as "not verified". That is intentional: it is
  fail-closed, not a bug. Making the suite runnable from a clean checkout is part of the open-release
  work.
- Opt-in live tests (live Codex, live Claude, live citation services) are skipped unless enabled.
- The 19 pilot tasks are published in this repository, with their planted defects. They are a
  *development* suite. Held-out benchmark sets are kept private so that future evaluations are not
  contaminated.
- The full root suite was **not** re-run for this publication. The developer-run integration logs are in
  [`INTEGRATION-NOTES.md`](../INTEGRATION-NOTES.md), and each package's `BUILD-NOTES.md` maps its
  requirements to the tests that cover them.

## Planned

- **Tier B2.** A race against trap cards designed by a different AI family.
- **Independent evaluation** by people who did not build the system.
- **A head-to-head** with other research agents, pre-registered, on tasks all of them can attempt. Until
  it is run, this project makes no claim about how Amani compares with other agents.
