#!/usr/bin/env python3
"""Deterministic checker for iad3-browning-count (no LLM).

    check.py --attempt WORKDIR --key KEY --out OUT.json [--rerun DIR]

Items (both gating; expected values from the sealed key only):
  count     n_series and n_kept equal the key, consistent with the cohort_size claim (estimate = n_kept,
            n_units = n_series) and with the listed subjects; the zeros-counted reading is needs-review
  kept_set  the listed subjects are exactly the key's kept set; the zeros-counted set is needs-review
needs-review never counts as correct. Missing or malformed results make every item incorrect.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "lib"))
from biotasks import checks  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "iad1-brady-audit"))
import result_format  # noqa: E402

TASK = "iad3-browning-count"
ITEMS = ["count", "kept_set"]


def results_problems(res: dict) -> list[str]:
    if set(res) != {"claims", "n_series", "n_kept", "kept_subjects", "extra"} or not isinstance(res["extra"], dict):
        return ["results fields missing, unknown, or wrongly typed"]
    for k in ("n_series", "n_kept"):
        v = checks.number(res[k])
        if v is None or v < 0 or v != int(v):
            return [f"{k} must be a non-negative integer"]
    ks = res["kept_subjects"]
    if not isinstance(ks, list) or not all(isinstance(x, str) and x.strip() for x in ks) or len(set(ks)) != len(ks):
        return ["kept_subjects must be a list of distinct subject ids"]
    c = checks.find_claim(res, "cohort_size")
    if c is None or any(c.get(k) is None for k in ("estimate", "n_units", "unit")):
        return ["claim 'cohort_size' with estimate, n_units and unit missing"]
    return []


def evaluate(workdir: Path, key: dict, _rerun: Path | None, warnings: list[str] | None = None) -> list[dict]:
    res, problems = result_format.load_results(workdir, result_format.COHORT, warnings)
    if res is not None:
        problems = results_problems(res)
        if problems:
            res = None
    if res is None:
        return [checks.item(i, "incorrect", "; ".join(problems)[:300]) for i in ITEMS]
    c = checks.find_claim(res, "cohort_size")
    consistent = (c["status"] in ("confirmed", "tentative") and c["unit"] == "patient" and c["estimate"] == res["n_kept"] and c["n_units"] == res["n_series"] and len(res["kept_subjects"]) == res["n_kept"])
    alt = key["alternatives"]["zeros_counted"]
    if consistent and res["n_series"] == key["n_series"] and res["n_kept"] == key["n_kept"]:
        v = "correct"
    elif consistent and res["n_series"] == key["n_series"] and res["n_kept"] == alt["n_kept"]:
        v = "needs-review"
    else:
        v = "incorrect"
    items = [checks.item("count", v, f"n_series {res['n_series']}, n_kept {res['n_kept']}, consistent {consistent}")]
    got = set(res["kept_subjects"])
    v = "correct" if got == set(key["kept"]) else ("needs-review" if got == set(alt["kept"]) else "incorrect")
    items.append(checks.item("kept_set", v, f"{len(got)} subjects listed"))
    return items


if __name__ == "__main__":
    warnings: list[str] = []
    rc = checks.run_check(TASK, ITEMS, lambda w, k, r: evaluate(w, k, r, warnings))
    if rc == 0:
        import argparse
        ap = argparse.ArgumentParser(add_help=False)
        ap.add_argument("--out", type=Path)
        args, _ = ap.parse_known_args()
        result_format.record_warnings(args.out, warnings)
    sys.exit(rc)
