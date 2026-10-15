#!/usr/bin/env python3
"""Arm D for iad3-browning-count: apply the published inclusion rule to the staged series.

    reference.py --data STAGED_DIR --truth TRUTH.json --out KEYDIR

Rule: keep a patient with >= 5 PSA measurements on treatment and >= 5 off treatment, where a PSA value that is
blank or <= 0 is not a measurement (the 0.00 values are export placeholders: in the custodian's own file 250 of
252 of them are blank, and the study's own loader keeps psa > 0). Design guards: a second implementation that
derives on/off status from treatment-switch parity, as the study's loader does, keeps exactly the same set; the
kept count equals the published count, read from the private anchors file next to the data (never stored in
the repository); and treating the placeholders as measurements changes the answer (the trap exists).
Failures name the guard only.
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

from biotasks import staging  # noqa: E402
from biotasks.paths import BASELINE, require_under_grading_root  # noqa: E402

import iad_common as ic  # noqa: E402

TASK = "iad3-browning-count"


def series(stage: Path) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {}
    for r in ic.read_csv(Path(stage) / "data" / "psa_series.csv"):
        out.setdefault(r["subject"], []).append(r)
    return out


def value(s: str):
    try:
        return float(s)
    except ValueError:
        return None


def kept(S: dict, measurement, at_least: int = 5, by_parity: bool = False, visits: bool = False) -> list[str]:
    keep = []
    for subj, rows in S.items():
        if by_parity:
            # the study loader's view: status flips at each change of the treatment sequence, starting on treatment
            status, prev, flags = 1, rows[0]["on_treatment"], []
            for r in rows:
                if r["on_treatment"] != prev:
                    status, prev = 1 - status, r["on_treatment"]
                flags.append(status)
        else:
            flags = [int(r["on_treatment"]) for r in rows]
        ok = [visits or measurement(value(r["psa"])) for r in rows]
        on = sum(1 for f, o in zip(flags, ok) if o and f == 1)
        off = sum(1 for f, o in zip(flags, ok) if o and f == 0)
        if on >= at_least and off >= at_least:
            keep.append(subj)
    return sorted(keep)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True, type=Path)
    ap.add_argument("--truth", required=True, type=Path)
    ap.add_argument("--out", required=True, type=Path)
    a = ap.parse_args()
    require_under_grading_root(a.out, "reference output")
    require_under_grading_root(a.truth, "generator truth")
    truth = json.loads(a.truth.read_text())
    S = series(a.data)
    positive = lambda v: v is not None and v > 0
    recorded = lambda v: v is not None
    main_set = kept(S, positive)
    zeros_set = kept(S, recorded)
    strict = kept(S, positive, at_least=6)
    visits = kept(S, positive, visits=True)
    try:
        anchor = json.loads((ic.CACHE / "anchors.json").read_text())["browning_2026_cohort_count"]["value"]
    except (OSError, ValueError, KeyError):
        anchor = None
    guards = {
        "pseudonymous_ids": len(truth["pseudo_ids"]) == len(S) and all(re.fullmatch(r"S-\d{3}", x) for x in S),
        "all_series_staged": len(S) == 101,
        "loader_parity_rule_agrees": kept(S, positive, by_parity=True) == main_set,
        "published_count_reproduced": anchor is not None and len(main_set) == anchor,
        "placeholder_handling_changes_the_answer": zeros_set != main_set,
        "misreadings_differ": strict != main_set and visits != main_set,
    }
    failed = sorted(k for k, ok in guards.items() if not ok)
    if failed:
        print("design guard failed: " + ", ".join(failed), file=sys.stderr)
        return 3
    key = {
        "schema": "bio-tasks/key@1", "task": TASK, "card_kind": "reproduction-anchor (data handling)",
        "rule": "keep if >= 5 PSA values > 0 with on_treatment = 1 and >= 5 with on_treatment = 0 (blank or 0.00 PSA is "
                "not a measurement)",
        "n_series": len(S), "n_kept": len(main_set), "kept": main_set,
        "alternatives": {"zeros_counted": {"n_kept": len(zeros_set), "kept": zeros_set, "verdict": "needs-review"},
                         "strict_more_than_five": {"n_kept": len(strict)}, "visits_not_measurements": {"n_kept": len(visits)}},
        "items": ["count", "kept_set"], "gating_items": ["count", "kept_set"], "prompt_derivable_items": [],
        "tolerance": {"absolute": 0, "relative": 0},
        "anchor": "equals the published cohort count (private anchors file; answer published after the model cutoff)",
        "environment": {"python": platform.python_version(), "numpy": np.__version__,
                        "pixi_lock_sha256": staging.sha256_file(BASELINE / "pixi.lock")},
        "inputs": {"archive_sha256": ic.ARCHIVE_SHA256},
    }
    a.out.mkdir(parents=True, exist_ok=True)
    (a.out / "key.json").write_text(json.dumps(key, indent=2, sort_keys=True) + "\n")
    work = a.out / "workdir"
    work.mkdir(exist_ok=True)
    res = {"claims": [{"id": "cohort_size", "statement": "Applying the rule (PSA values of 0.00 are export placeholders, not "
                                                         "measurements) keeps the listed patients",
                       "status": "confirmed", "estimate": len(main_set), "n_units": len(S), "unit": "patient"}],
           "n_series": len(S), "n_kept": len(main_set), "kept_subjects": main_set, "extra": {}}
    (work / "results.json").write_text(json.dumps(res, indent=2) + "\n")
    (work / "REPORT.md").write_text("# Reference (arm D)\n\nRule applied with blank and 0.00 PSA values not counted as "
                                    "measurements; the kept set is in results.json.\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
