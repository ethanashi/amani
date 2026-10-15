#!/usr/bin/env python3
"""Checker for w0-venet: a thin adapter over bio-baseline's grading/grade.py (wrapped, not rewritten).

    check.py --attempt WORKDIR --key KEY --out OUT.json [--rerun DIR]

KEY is the decrypted warm-up answer (task/SEALED-ANSWER.md); the sealed reference summaries are
decrypted by grade.py itself. grade.py's verdicts map to items: clear -> correct, flagged ->
incorrect, needs-review -> needs-review. The answer-key items (planted flaw, unit of analysis,
silent sample drop) are required; the others are reported but do not decide the task (the harness
judges reproducibility separately, and citation/claim review is manual in grade.py).
WORKDIR must be <attempt>/workdir; when --rerun is given it must be <attempt>/grade/rerun, the
directory grade.py reads re-run results from.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "lib"))
from biotasks import checks  # noqa: E402
from biotasks.paths import BASELINE, use_baseline  # noqa: E402

use_baseline()
import grade  # noqa: E402

TASK = "w0-venet"
REQUIRED = ["missed_planted_flaw", "wrong_unit_of_analysis", "silent_sample_drop"]
INFORMATIONAL = ["irreproducible_number", "missed_negative_control", "fabricated_citation", "unsupported_claim"]
ITEMS = REQUIRED + INFORMATIONAL
VERDICT = {"clear": "correct", "flagged": "incorrect", "needs-review": "needs-review"}


def load_key(path: Path) -> dict:
    key = grade.read_key(Path(path))
    if not isinstance(key, dict) or not isinstance(key.get("n_duplicates"), int):
        raise ValueError("warm-up answer key unreadable")
    return key


def evaluate(workdir: Path, key: dict, rerun_dir: Path | None) -> list[dict]:
    workdir = Path(workdir).resolve()
    if workdir.name != "workdir":
        raise ValueError("attempt workdir must be named 'workdir'")
    attempt = workdir.parent
    status = None
    if rerun_dir is not None:
        if Path(rerun_dir).resolve() != (attempt / "grade" / "rerun").resolve():
            raise ValueError("re-run directory is not <attempt>/grade/rerun")
        status = json.loads((Path(rerun_dir) / "rerun.json").read_text())
    ref = BASELINE / "reference" / "output"
    ref_clean = grade.load_json_sealed(ref / "clean" / "summary.json")
    ref_arm = grade.load_json_sealed(ref / "arm" / "summary.json")
    if not ref_clean or not ref_arm:
        raise ValueError("sealed reference summaries unavailable")
    g = grade.grade_attempt(attempt, ref_clean, ref_arm, key, Path("/nonexistent"), False, 0, [],
                            rerun_status=status)
    return [checks.item(t, VERDICT[g["verdict"][t]], "; ".join(g["evidence"][t])[:400], required=t in REQUIRED)
            for t in ITEMS]


if __name__ == "__main__":
    sys.exit(checks.run_check(TASK, ITEMS, evaluate, key_loader=load_key))
