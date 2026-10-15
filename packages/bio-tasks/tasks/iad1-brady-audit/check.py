#!/usr/bin/env python3
"""Deterministic checker for iad1-brady-audit (no LLM).

    check.py --attempt WORKDIR --key KEY --out OUT.json [--rerun DIR]

Every expected value, tolerance, accepted status and the gating set come from the sealed key only.
Gating items (all must be correct to pass):
  n_and_unit              unit = patient_cycle, number of scored rows and patients, unscored row(s) flagged
  counts                  TP/FN/FP/TN of the authors' calls, summing to n, with matching rates
  heldout_auc             pooled held-out AUC (the estimand TASK.md defines) within tolerance
  comparators_recomputed  >= 1 comparator; every listed AUC recomputes from its scores file
  strong_comparator       a listed comparator at least as strong as the key's (its AUC >= the key threshold) that
                          rank-matches a co-primary prior-cycle PSA summary, or is not model-/structure-derived
                          (otherwise needs-review)
  fit_verdict             the fit_for_use status is allowed, with no adopt-while-not-fit contradiction
Informational items: inconsistency, auc_by_cycle, difference_ci, majority_comparison, auc_source.
Items derivable from the prompt alone (fit_verdict, majority_comparison, auc_source) are flagged per item and
left out of the analysis-attributable score added to OUT. Missing or malformed results make every item
incorrect.
"""
from __future__ import annotations

import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "lib"))
sys.path.insert(0, str(HERE))

import iad_common as ic  # noqa: E402

TASK = "iad1-brady-audit"
ITEMS = list(ic.LOO_ITEMS)

if __name__ == "__main__":
    sys.exit(ic.run_loo_check(TASK, ITEMS))
