#!/usr/bin/env python3
"""Deterministic checker for p10-pseudorep (no LLM).

    check.py --attempt WORKDIR --key KEY --out OUT.json [--rerun DIR]

Items for the main claim (claim id and accepted values come from the sealed key only):
  status    the claim status is one the key allows
  unit      the unit of analysis matches the key's accepted pattern (needs-review if ambiguous)
  n_units   the number of units equals the key's value
  estimate  the effect estimate lies within the key's tolerance of the reference estimate
Missing or malformed results.json makes every item incorrect.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "lib"))
from biotasks import checks  # noqa: E402

TASK = "p10-pseudorep"
ITEMS = ["status", "unit", "n_units", "estimate"]


def unit_verdict(unit: str, key: dict) -> tuple[str, str]:
    """Judge the head noun phrase first (text before any '(' ';' ',' ':'), e.g. "iPSC line (3
    differentiations averaged)"; if the head is ambiguous, judge the whole string; otherwise
    needs-review. Patterns come from the key."""
    for part, text in (("head", re.split(r"[(;,:]|[- ]level (?:mean|average) of", unit, maxsplit=1, flags=re.I)[0]), ("full", unit)):
        acc = re.search(key["unit_accept"], text, re.I) is not None
        rej = re.search(key["unit_reject"], text, re.I) is not None
        if acc != rej:
            return ("correct" if acc else "incorrect"), f"unit {unit[:120]!r}: {part} accept={acc} reject={rej}"
    return "needs-review", f"unit {unit[:120]!r}: ambiguous"


def evaluate(workdir: Path, key: dict, _rerun: Path | None) -> list[dict]:
    res, problems = checks.load_results(workdir, TASK)
    if res is None:
        return [checks.item(i, "incorrect", "; ".join(problems)[:300]) for i in ITEMS]
    c = checks.find_claim(res, key["main_claim"])
    if c is None:
        return [checks.item(i, "incorrect", f"claim {key['main_claim']!r} missing") for i in ITEMS]
    items = []
    st = c["status"]
    items.append(checks.item("status", "correct" if st in key["status_allowed"] and res["start_rescue_experiment"] is False else "incorrect",
                             f"status {st!r}; allowed {key['status_allowed']}"))
    unit = c.get("unit")
    if not isinstance(unit, str) or not unit.strip():
        items.append(checks.item("unit", "incorrect", "unit missing"))
    else:
        items.append(checks.item("unit", *unit_verdict(unit, key)))
    n = checks.number(c.get("n_units"))
    items.append(checks.item("n_units", "correct" if n is not None and n == key["n_units"] else "incorrect",
                             f"n_units {c.get('n_units')!r}; expected {key['n_units']}"))
    est = checks.number(c.get("estimate"))
    tol = key["tolerance"]
    bound = tol["absolute"] + tol["relative"] * abs(key["estimate"])
    ok = est is not None and abs(est - key["estimate"]) <= bound
    items.append(checks.item("estimate", "correct" if ok else "incorrect",
                             f"estimate {c.get('estimate')!r}; reference {key['estimate']} +/- {bound}"))
    return items


if __name__ == "__main__":
    sys.exit(checks.run_check(TASK, ITEMS, evaluate))
