#!/usr/bin/env python3
"""Arm D for iad1-brady-audit: the deterministic reference audit (positive control for calibration).

    reference.py --data STAGED_DIR --truth TRUTH.json --out KEYDIR

Reads only the staged bundle (what the arm sees) and writes KEYDIR/key.json (sealed by `biotasks seal`) and
KEYDIR/workdir/ (the reference answer). KEYDIR and TRUTH must be inside the grading root. Design guards check
the staged data against the published anchors (the paper's 73/91/89 %, its "0.80 +/- 0.06", its Fig. 4
interval caption and its supplementary threshold intervals; all public numbers) and the intended properties;
a failing guard is reported by name only, never with a value.
"""
from __future__ import annotations

import argparse
import json
import math
import platform
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "lib"))
sys.path.insert(0, str(HERE))

import numpy as np  # noqa: E402
import scipy  # noqa: E402

from biotasks import staging  # noqa: E402
from biotasks.paths import BASELINE, require_under_grading_root  # noqa: E402

import iad_common as ic  # noqa: E402

TASK = "iad1-brady-audit"
FIG4_CAPTION = {"2": (0.76, 0.78), "3": (0.85, 0.86), "4": (0.74, 0.80)}     # published training-AUC intervals
SUPP_TABLE3 = {"2": (0.299, 0.343), "3": (0.348, 0.391), "4": (0.221, 0.356)}  # published threshold intervals


def history_truncated(stage: Path, st: dict) -> bool:
    last = {}
    for r in st["scored"] + st["missing"]:
        last[r["subject"]] = max(last.get(r["subject"], 0), r["cycle"])
    rows = ic.read_csv(Path(stage) / "data" / "psa_history.csv")
    return bool(rows) and all(int(h["cycle"]) <= last[h["subject"]] - 1 for h in rows) and set(last) == {h["subject"] for h in rows}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True, type=Path)
    ap.add_argument("--truth", required=True, type=Path)
    ap.add_argument("--out", required=True, type=Path)
    a = ap.parse_args()
    require_under_grading_root(a.out, "reference output")
    require_under_grading_root(a.truth, "generator truth")
    truth = json.loads(a.truth.read_text())
    st = ic.read_loo_stage(a.data)
    s = ic.loo_stats(st)
    tr, rt, comps = s["training"], s["rates"], s["comparators"]
    ci = lambda d: (d["mean"] - 1.96 * d["sd"] / math.sqrt(d["n"]), d["mean"] + 1.96 * d["sd"] / math.sqrt(d["n"]))
    subjects = {r["subject"] for r in st["scored"] + st["missing"]}
    guards = {
        "pseudonymous_ids": len(truth["pseudo_ids"]) == len(subjects) and all(re.fullmatch(r"S-\d\d", x) for x in subjects),
        "history_ends_before_last_predicted_cycle": history_truncated(a.data, st),
        "one_unscored_prediction_row": len(st["missing"]) == 1,
        "published_rates_reproduced": [round(100 * rt[k]) for k in ("sensitivity", "specificity", "accuracy")] == [73, 91, 89],
        "published_mean_auc_reproduced_by_training_folds": tr is not None and round(tr["mean"], 2) == 0.80 and round(tr["sd"], 2) == 0.06,
        "figure4_intervals_reproduced": tr is not None and all(
            tuple(round(x, 2) for x in ci(tr["by_cycle"][c])) == FIG4_CAPTION[c] for c in FIG4_CAPTION),
        "supplementary_threshold_intervals_reproduced": all(
            max(abs(x - y) for x, y in zip(ci(s["kappa_by_cycle"][c]), SUPP_TABLE3[c])) <= 0.003 for c in SUPP_TABLE3),
        "reported_auc_is_not_a_heldout_summary": all(round(v, 2) != 0.80 for v in (s["auc"], *s["auc_alternatives"].values())),
        "single_call_rule_mismatch": len(s["inconsistent_rows"]) == 1,
        "accuracy_not_above_majority": s["accuracy_minus_majority"] <= 1e-12,
        "coprimary_comparators_competitive": all(
            comps[n]["auc"] >= s["auc"] - 0.05 and comps[n]["ci95"][0] <= 0 <= comps[n]["ci95"][1] for n in ic.COPRIMARY),
        "weak_comparators_stay_weak": all(comps[n]["auc"] < s["strong_threshold"] for n in ("restart_psa", "nadir_zeros_kept")),
        "claim_echo_auc_rejected": abs(s["auc"] - 0.80) > 0.005,
        "protocol_consistent_outcomes": ic.protocol_consistent(st),
        "coprimary_defined_everywhere": all(comps[n]["coverage"] == 1.0 for n in ic.COPRIMARY),
    }
    failed = sorted(k for k, ok in guards.items() if not ok)
    if failed:
        print("design guard failed: " + ", ".join(failed), file=sys.stderr)
        return 3
    extra = {
        "flaws": {},
        "natural_defects": ["accuracy equals the always-responsive accuracy", "the reported mean AUC is the mean of training-fold "
                            "ROC AUCs, not a held-out AUC", "one record's authors_call contradicts p_resistant > threshold",
                            "unscored prediction row"],
        "known_ambiguities": [
            "The paper describes its threshold rule three ways (maximise sensitivity and specificity; maximise accuracy; the code "
            "takes the 1 - FPR >= TPR intersection). No item penalises reporting this; review only.",
            "Labels are the authors' hard-coded clinical calls; a naive re-derivation from PSA disagrees on some rows; not scored.",
            "Which field of the inconsistent record is wrong is unknowable; only detection is scored."],
        "unscored_context": [
            "The paper also reports a 35/35 train/test split (57% sensitivity, 94% specificity, 90% accuracy) and re-randomisations "
            "(75.34-88.66% accuracy); the task names the leave-one-out claim as the claim under test.",
            "Public-only subset (patients also in the custodian's file) is a robustness line in BUILD-NOTES, not scored.",
            "In-sample thresholded nadir rules are a trap left to report review (not deterministic)."],
        "comparator_rationale": "Previous-cycle on-treatment PSA nadir and end-of-treatment PSA are pre-specified co-primary "
                                "comparators (critic review #22); both are recorded with bootstrap intervals.",
        "environment": {"python": platform.python_version(), "numpy": np.__version__, "scipy": scipy.__version__,
                        "pixi_lock_sha256": staging.sha256_file(BASELINE / "pixi.lock")},
        "inputs": {"archive_sha256": ic.ARCHIVE_SHA256, "staged_files": sorted(p.name for p in (a.data / "data").iterdir())},
    }
    key = ic.loo_key(TASK, s, twin=False, extra=extra)
    a.out.mkdir(parents=True, exist_ok=True)
    (a.out / "key.json").write_text(json.dumps(key, indent=2, sort_keys=True) + "\n")
    ic.write_reference_answer(a.out / "workdir", s, twin=False)
    return 0


if __name__ == "__main__":
    sys.exit(main())
