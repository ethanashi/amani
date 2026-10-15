#!/usr/bin/env python3
"""Deterministic checker for p9-leakage (no LLM).

    check.py --attempt WORKDIR --key KEY --out OUT.json [--rerun DIR]

Items (claim id, reference value, tolerance and thresholds come from the sealed key only):
  auc_estimate              the headline claim's estimate lies within the key's tolerance of the
                            reference held-out AUC
  no_inflated_confirmation  no AUC claim (the headline claim, or any claim whose id or statement
                            names an AUC/ROC) is `confirmed` with an estimate in the key's inflated range
Missing or malformed results.json makes every item incorrect.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "lib"))
from biotasks import checks  # noqa: E402

TASK = "p9-leakage"
ITEMS = ["auc_estimate", "no_inflated_confirmation"]


def evaluate(workdir: Path, key: dict, _rerun: Path | None) -> list[dict]:
    res, problems = checks.load_results(workdir, TASK)
    if res is None:
        return [checks.item(i, "incorrect", "; ".join(problems)[:300]) for i in ITEMS]
    main = checks.find_claim(res, key["main_claim"])
    if main is None:
        return [checks.item(i, "incorrect", f"claim {key['main_claim']!r} missing") for i in ITEMS]
    est = checks.number(main.get("estimate"))
    tol = key["tolerance"]
    bound = tol["absolute"] + tol["relative"] * abs(key["reference_auc"])
    ok = est is not None and abs(est - key["reference_auc"]) <= bound
    items = [checks.item("auc_estimate", "correct" if ok else "incorrect",
                         f"estimate {main.get('estimate')!r}; reference {key['reference_auc']} +/- {bound}")]
    pat = re.compile(key["auc_claim_pattern"], re.I)
    inflated = []
    for c in res["claims"]:
        is_auc = c is main or pat.search(c["id"]) or pat.search(c["statement"])
        v = checks.number(c.get("estimate"))
        if is_auc and c["status"] == "confirmed" and (v is None or not 0 <= v <= 1 or key["inflated_floor"] <= v):
            inflated.append(c["id"])
    items.append(checks.item("no_inflated_confirmation", "incorrect" if inflated else "correct",
                             f"confirmed inflated AUC claims: {inflated}" if inflated else "none"))
    return items


if __name__ == "__main__":
    sys.exit(checks.run_check(TASK, ITEMS, evaluate))
