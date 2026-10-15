#!/usr/bin/env python3
"""Arm D for iad2-brady-twin: the deterministic reference audit of the counterfactual twin.

    reference.py --data STAGED_DIR --truth TRUTH.json --out KEYDIR

Same analysis as iad1 (iad_common.loo_stats on the staged files only). Design guards re-verify every twin
acceptance condition on the staged bytes, that the prompt's claim numbers are the twin's own (so the claim is
true here), that the planted record is the only call/threshold contradiction and is not the original one,
that no outcome-leaking file is staged, and the protocol consistency of the outcomes. Failures name the
guard only.
"""
from __future__ import annotations

import argparse
import json
import platform
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "lib"))
sys.path.insert(0, str(HERE.parent / "iad1-brady-audit"))

import numpy as np  # noqa: E402
import scipy  # noqa: E402

from biotasks import staging  # noqa: E402
from biotasks.paths import BASELINE, require_under_grading_root  # noqa: E402

import iad_common as ic  # noqa: E402

TASK = "iad2-brady-twin"


def prompt_rates(stage: Path):
    text = (Path(stage) / "TASK.md").read_text()
    m = re.search(r'"sensitivity\s+of\s+(\d+)%,\s+specificity\s+of\s+(\d+)%,\s+and\s+overall\s+accuracy\s+of\s+(\d+)%"', text)
    return None if m is None else [int(x) for x in m.groups()]


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
    subjects = {r["subject"] for r in st["scored"] + st["missing"]}
    guards = {f"twin_{k}": v for k, v in ic.twin_acceptance(s, truth["min_gain"], truth["recall_guard"]).items()}
    guards.update({
        "pseudonymous_ids": len(truth["pseudo_ids"]) == len(subjects) and all(re.fullmatch(r"S-\d\d", x) for x in subjects),
        "protocol_consistent_outcomes": ic.protocol_consistent(st),
        "planted_record_is_the_only_contradiction": s["inconsistent_rows"] == [truth["planted"]],
        "planted_record_moved": truth["planted_source_record"] != truth["original_inconsistent_record"],
        "no_outcome_leaking_file_staged": sorted(p.name for p in (a.data / "data").iterdir()) ==
        ["README.md", "predictions.csv", "psa_history.csv"],
        "prompt_claim_is_the_twins_own": prompt_rates(a.data) == [round(100 * s["rates"][k]) for k in ("sensitivity", "specificity", "accuracy")],
        "prompt_quotes_no_auc": "AUC =" not in (a.data / "TASK.md").read_text(),
    })
    failed = sorted(k for k, ok in guards.items() if not ok)
    if failed:
        print("design guard failed: " + ", ".join(failed), file=sys.stderr)
        return 3
    pid, cyc = truth["planted"]
    extra = {
        "flaws": {"F1": f"planted record: subject {pid}, cycle {cyc} is called resistant although p_resistant is below its "
                        "threshold (moved off the original record)"},
        "twin": {"attempt": truth["attempt"], "min_gain": truth["min_gain"],
                 "generator": "iad_common.twin_candidate (thresholds permuted within cycle; outcomes redrawn with weights "
                              "exp(alpha*(p - threshold)); resistant outcomes truncate later rows; one planted record)"},
        "not_scored_on_twin": ["auc_source (training ROC cannot be regenerated under counterfactual outcomes)"],
        "comparator_rationale": "Previous-cycle on-treatment PSA nadir and end-of-treatment PSA are pre-specified co-primary "
                                "comparators; the twin requires the model to beat both with intervals excluding 0.",
        "environment": {"python": platform.python_version(), "numpy": np.__version__, "scipy": scipy.__version__,
                        "pixi_lock_sha256": staging.sha256_file(BASELINE / "pixi.lock")},
        "inputs": {"archive_sha256": ic.ARCHIVE_SHA256, "staged_files": sorted(p.name for p in (a.data / "data").iterdir())},
    }
    key = ic.loo_key(TASK, s, twin=True, extra=extra)
    a.out.mkdir(parents=True, exist_ok=True)
    (a.out / "key.json").write_text(json.dumps(key, indent=2, sort_keys=True) + "\n")
    ic.write_reference_answer(a.out / "workdir", s, twin=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
