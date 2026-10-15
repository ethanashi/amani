# iad1-brady-audit: blind re-implementation spec (for a different model family)

Purpose: an independent implementation of the reference analysis (arm D) that the integrator runs with a
different model family (Codex) to cross-check the sealed answer key. This spec is written only from the
task's staged inputs and the locked definitions below. It contains no answer values. Do not look at
`iad_common.py`, `reference.py`, the sealed key, the calibration record, or any design notes; work only from
the staged files and this document.

## Procedure for the integrator

1. Stage the task (needs the private D1 cache on this machine):
   `PYTHONPATH=packages/bio-tasks/lib packages/bio-baseline/.pixi/envs/default/bin/python -m biotasks stage iad1-brady-audit --out <DIR>`
2. Give the replicating agent `<DIR>/data/` and this file only (network off). It writes `replication.json`.
3. Compare against the sealed key without displaying values:
   `PYTHONPATH=packages/bio-tasks/lib packages/bio-baseline/.pixi/envs/default/bin/python packages/bio-tasks/tasks/iad1-brady-audit/compare_replication.py --replication <path>/replication.json`
   It prints `match` or `MISMATCH` per field and exits 0 only if every field matches.
   The same procedure works for `iad2-brady-twin` (`--task iad2-brady-twin`; it has no `training_roc.csv`, so
   omit `training_auc`).

## Inputs (UTF-8 CSV with header)

- `predictions.csv`: `subject, cycle, threshold, p_resistant, authors_call, observed`. One row per patient and
  predicted cycle. A row is **scored** when `p_resistant` is non-empty; otherwise it is **unscored**.
  `authors_call` and `observed` take the values `resistant` / `responsive`.
- `training_roc.csv`: `held_out_subject, cycle, threshold, n_responsive_at_or_above, n_resistant_at_or_above,
  fpr, tpr`. One block of rows per fold, identified by (`held_out_subject`, `cycle`), rows in stored order.
- `psa_history.csv`: `subject, day, psa, testosterone, cycle, on_treatment`, rows in file order. `psa` may be
  empty.

Parse numbers with full double precision. Keep the file order of rows wherever an order matters below.

## Locked definitions

Throughout, the positive class is `resistant`; `y` is `observed == resistant` on the scored rows.

1. `n_scored`: number of scored rows. `n_patients`: distinct `subject` values among scored rows.
   `nan_rows`: `[subject, cycle]` of every unscored row, in file order.
2. `counts`: `tp, fn, fp, tn` of `authors_call == resistant` against `y`.
   `counts_threshold_rule`: the same with the call defined as `p_resistant > threshold` (strict).
3. `rates` (and `rates_threshold_rule` from the threshold-rule counts): `sensitivity = tp/(tp+fn)`,
   `specificity = tn/(tn+fp)`, `accuracy = (tp+tn)/n_scored`, `balanced_accuracy = (sensitivity+specificity)/2`.
4. `majority_accuracy = max(p, 1 - p)` with `p` the share of scored rows with `y` true.
   `accuracy_minus_majority = rates.accuracy - majority_accuracy`;
   `accuracy_minus_majority_threshold_rule` likewise from `rates_threshold_rule`.
5. AUC of a score `s` against `y`: drop rows where `s` is not finite; with positives `P` and negatives `N`,
   `AUC = (#{(i,j) in P x N : s_i > s_j} + 0.5 * #{(i,j) : s_i == s_j}) / (|P| * |N|)`; undefined (null) if
   `P` or `N` is empty.
   `auc`: AUC of `p_resistant`, pooled over all scored rows. `auc_by_cycle`: the same within each cycle,
   keys `"2"`, `"3"`, `"4"`.
   `auc_alternatives_not_accepted`: `mean_of_cycles` = arithmetic mean of the three per-cycle AUCs;
   `n_weighted_cycles` = sum over cycles of (per-cycle AUC x scored rows in the cycle) / `n_scored`.
6. `training_auc` (iad1 only): for each fold, `numpy.trapezoid(y=tpr, x=fpr)` over the fold's rows in stored
   order (do not sort). `mean` and `sd` (`ddof = 1`) over all folds, `n_folds`; `by_cycle["c"]` = `mean`,
   `sd` (`ddof = 1`) and `n` over the folds of cycle `c`.
7. `inconsistent_rows`: `[subject, cycle]` of every scored row where `(authors_call == resistant)` differs
   from `p_resistant > threshold`, in file order.
8. Previous-cycle PSA features of a scored row (`subject = s`, `cycle = c`): take `psa_history.csv` rows of
   subject `s` with `cycle == c - 1`, in file order. A PSA value is *positive* if non-empty and `> 0`; it is
   *recorded* if non-empty.
   - `nadir`: minimum positive PSA among those rows with `on_treatment == 1`.
   - `end_psa`: the last positive PSA among those rows with `on_treatment == 1`.
   - `nadir_zeros_kept`, `end_psa_zeros_kept`: the same with *recorded* instead of *positive*.
   - `restart_psa`: the last positive PSA among those rows with `on_treatment == 0`.
   A feature with no qualifying value is missing (NaN).
9. `comparators[name]` for each of the five features: `auc` (definition 5) and `coverage` (share of scored
   rows where the feature is finite). For `nadir` and `end_psa` also:
   - `auc_model_minus` = `auc` of `p_resistant` minus `auc` of the feature (model minus comparator);
   - `ci95`: patient-cluster bootstrap. Subjects = the sorted (Python `sorted`, string order) distinct
     subjects of the scored rows. Use a fresh `numpy.random.default_rng(0)` for each of the two features.
     Repeat 4000 times: `draw = rng.integers(0, n_subjects, n_subjects)`; the resample is the concatenation,
     over `j` in `draw`, of the scored rows of subject `subjects[j]`; skip the draw if it has fewer than 2
     positive or fewer than 2 negative rows; otherwise record `AUC(p_resistant) - AUC(feature)` on the
     resample (each AUC per definition 5). `ci95 = numpy.percentile(recorded, [2.5, 97.5])` (default linear
     interpolation). Also report `draws_used` (number of recorded draws).
10. `strong_threshold = min(auc, max(comparators.nadir.auc, comparators.end_psa.auc)) - 0.05`.
11. `in_sample_trap_nadir_gt_2_accuracy`: accuracy of the rule `nadir > 2` (missing nadir counts as false)
    against `y` over the scored rows.

## Output: `replication.json`

```json
{
  "n_scored": 0, "n_patients": 0, "nan_rows": [["S-00", 0]],
  "counts": {"tp": 0, "fn": 0, "fp": 0, "tn": 0},
  "counts_threshold_rule": {"tp": 0, "fn": 0, "fp": 0, "tn": 0},
  "rates": {"sensitivity": 0.0, "specificity": 0.0, "accuracy": 0.0, "balanced_accuracy": 0.0},
  "rates_threshold_rule": {"sensitivity": 0.0, "specificity": 0.0, "accuracy": 0.0, "balanced_accuracy": 0.0},
  "majority_accuracy": 0.0, "accuracy_minus_majority": 0.0, "accuracy_minus_majority_threshold_rule": 0.0,
  "auc": 0.0, "auc_by_cycle": {"2": 0.0, "3": 0.0, "4": 0.0},
  "auc_alternatives_not_accepted": {"mean_of_cycles": 0.0, "n_weighted_cycles": 0.0},
  "training_auc": {"mean": 0.0, "sd": 0.0, "n_folds": 0,
                   "by_cycle": {"2": {"mean": 0.0, "sd": 0.0, "n": 0}, "3": {"mean": 0.0, "sd": 0.0, "n": 0},
                                "4": {"mean": 0.0, "sd": 0.0, "n": 0}}},
  "inconsistent_rows": [["S-00", 0]],
  "comparators": {
    "nadir": {"auc": 0.0, "coverage": 0.0, "auc_model_minus": 0.0, "ci95": [0.0, 0.0], "draws_used": 0},
    "end_psa": {"auc": 0.0, "coverage": 0.0, "auc_model_minus": 0.0, "ci95": [0.0, 0.0], "draws_used": 0},
    "nadir_zeros_kept": {"auc": 0.0, "coverage": 0.0},
    "end_psa_zeros_kept": {"auc": 0.0, "coverage": 0.0},
    "restart_psa": {"auc": 0.0, "coverage": 0.0}
  },
  "strong_threshold": 0.0,
  "in_sample_trap_nadir_gt_2_accuracy": 0.0
}
```

Write numbers at full precision (no rounding). Implement in Python 3 with numpy; any other dependency is
unnecessary.

## How the comparison judges each field

- Integers, lists of rows and counts: exact equality.
- Rates, AUCs, training-fold statistics, thresholds and the trap accuracy: absolute difference at most 1e-6
  (the definitions are deterministic; the key stores 10 significant digits).
- Bootstrap intervals: both bounds within 0.01 and on the same side of zero as the key's bounds; `draws_used`
  within 1% (implementations that follow definition 9 exactly reproduce the key's intervals).
