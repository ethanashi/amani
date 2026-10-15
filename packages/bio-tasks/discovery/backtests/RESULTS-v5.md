# KA1 review repair: corrected development results

Run date: 2026-10-11. Criteria: `criteria-v5.json` and its SHA-256 pin.
All four cards were rerun under a fresh current freeze. The same private key was retained
through implementation verification; no key or draw was selected for passing results.
Only rounded scientific aggregates are published here. Full receipts, freezes, logs and
sealed cards remain in the ignored package-local host research directory.

| Card | Corrected result | Outcome |
|---|---|---|
| BT1 overall | 2.632, tolerance ±0.05 around the published estimate | Fresh R reproduction passed; absolute discrepancy 0 |
| BT1 neurology | 2.511, tolerance ±0.05 | Fresh R reproduction passed; absolute discrepancy 0 |
| BT2 original Nelson 2013 | MH relative success **1.779**, 95% CI **[1.177, 2.688]** | Card calibrated; development band fails its CI lower-bound >1.3 requirement |
| BT3 finite-stratum plant | Truth **2.000**; recovered **1.869**, 95% CI **[1.405, 2.488]** | Truth covered; card calibrated |
| BT4 historical ChEMBL join | Unavailable | Current mapping rejected by release-date gate; reference/calibration fail closed |

BT2 accounting: 5,251 eligible snapshot rows; 50 pre-snapshot-approved, 364 approved,
2,133 negative, 1,401 censored, 1,296 unmatched and 7 conflicting-date. The scored cohort
has 3,898 rows. Among scored approvals, **248** have blank `year_launch`; across all
Pharmaprojects launched pairs, **1,120** have blank launch year. The snapshot approval flag
and dated sentinel guard fix known pre-snapshot contamination, but do not establish exact
first-approval dates for every remaining launch.

The primary log-RR SE is **0.211**. An independent nonlinear one-way bootstrap cross-check
(2,000 draws for each covariance component, combined target + indication − intersection)
gave **0.230**. The discrepancy is reported, not tuned away: the score method is a first-order
approximation, while the nonlinear bootstrap includes sparse-cell curvature.

Across three keyed streams of 200 BT3 plants each, truth coverage was **576/600 (96.0%)**.
The empirical log-RR SD was **0.130**, versus mean estimated SE **0.134**. The confounded
crude arm covered truth in **1/600** draws. Every stream met reference lower one-sided
95% Clopper–Pearson bound ≥0.8 and crude upper bound ≤0.2. Unit tests additionally compare
the score variance with an analytic crossed random-effects mean and a seeded simulation,
and compare MH/AUC influence functions with numerical derivatives.

The BT3 behavioral audit left honest scores unchanged. The actual leaky control's AUROC
fell **0.990 → 0.509** (drop **0.481**) after the six secret candidate columns were permuted.
Names/metadata do not identify these six: two additional honest candidates share the same
naming and descriptor scheme, and no offered candidate equals the visible outcome label.

A separate public-input-only numerical-delta implementation (`independent_analysis.py`)
passed BT2 and BT3 through the **real sandbox rerunner**, including their secret subsamples
and BT3 candidate intervention. It imports no host generator/checker and needs no hidden RNG
seed. This is implementation diversity within the same author family, not independent
cross-family scientific confirmation.

## Corrected conditional D1 power curve

Detection means the paired-gain 95% interval has lower endpoint >0. Each point uses
1,000 independent synthetic score trials. B_gen is original-Nelson support. Bounds below
are one-sided 95% Clopper–Pearson lower/upper bounds reported together.

| Expected AUROC gain | Detected / 1,000 | Power | Bounds |
|---:|---:|---:|---:|
| 0.000 | 32 | 3.2% | 2.3–4.3% |
| 0.010 | 72 | 7.2% | 5.9–8.7% |
| 0.020 | 237 | 23.7% | 21.5–26.0% |
| 0.030 | 402 | 40.2% | 37.6–42.8% |
| 0.040 | 628 | 62.8% | 60.2–65.3% |
| 0.045 | 711 | 71.1% | 68.6–73.5% |
| 0.050 | 788 | 78.8% | 76.6–80.9% |
| 0.055 | 877 | 87.7% | 85.9–89.4% |
| 0.060 | 919 | 91.9% | 90.3–93.3% |
| 0.080 | 993 | 99.3% | 98.7–99.7% |

**The first tested gain reaching 80% power is +0.055 AUROC.** The crossing is near +0.05;
no interpolated exact threshold is claimed. The +0.02 MEI remains substantially underpowered.
D1 stays **uncertified**, with unranked evidence cards only. These conditional synthetic-score
results do not establish power for an actual biological ranker or an unseen outcome window.

## Files and verification

Created: `backtest-analyst-writer.ts`, `backtest_validation.py`, `independent_analysis.py`,
`criteria-v5.json`, its SHA-256 pin, `test_backtest_fixes.py`, and this report. Updated the
existing KA1 estimators, stagers, checkers, provenance, release-date guard, runner, tests,
README and package BUILD-NOTES. The review-to-test mapping is in BUILD-NOTES.md.

- Focused KA1 tests: **44 passed, 3.553 s** (27 existing/updated plus 17 new regressions).
- Full bio-tasks Python suite: **244 passed, 110.300 s** under concurrent host load.
- Explicit `test_leakage`: **6 passed, 38.079 s**; generated KA1 key/public-projection scan passed.
- `pilot/test_amend.py`: **13 passed, 44.212 s**.
- Fresh upstream R experiment: **1,000.7 s**, separate from unit tests.
- `pnpm typecheck`: passed.
- The single requested root run (`pnpm test --maxWorkers=4`): **3,346 passed, 1 failed,
  6 skipped**, plus **2 Vitest RPC timeouts**, **177.61 s**. The failing test was
  `bio-host/test/cli-process.test.ts`: its fake worker timed out under host load. It passed
  in isolation (**1/1, 4.85 s**). No bio-host code was changed. Therefore the full root
  run is **not claimed green**, and the root runtime limit was not met.

Final inspection added explicit rejection of nonfinite BT1 claimed/observed values; the
real-path regression checks NaN, infinity, null and booleans. The final frozen card run
uses the same private key and unchanged scientific criteria. All reported scientific
numbers are invariant to that guard-only repair.

An intermediate package rerun hit the existing 500 ms real-backend recovery cap under
concurrent load. All 16 recovery tests passed in isolation (0.857 s), and the final full
package rerun passed all 244 tests. No timeout was widened and no test was skipped.

The full inherited package suite exceeds the requested 10-second budget; no existing tests
were skipped or weakened to hide this. BT4 historical inputs, independent family agreement,
an unseen outcome window, a real ranker and the separate upstream --oto reproduction remain
unavailable. See BUILD-NOTES.md for the constrained BT1 execution protocol and host-mount limits.
