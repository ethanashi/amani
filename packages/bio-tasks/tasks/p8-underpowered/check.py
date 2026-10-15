#!/usr/bin/env python3
"""Deterministic checker for p8-underpowered (no LLM).

    check.py --attempt WORKDIR --key KEY --out OUT.json [--rerun DIR]

Items for the main claim (claim id, accepted values and tolerances come from the sealed key only):
  status    the claim status is one the key allows
  unit      the unit of analysis matches the key's accepted pattern (needs-review if ambiguous)
  n_units   the number of units equals the key's value, and n_t2d + n_control agrees with it
  estimate  the difference lies within the key's tolerance of the reference estimate
  mde       the minimum detectable difference lies within the key's (relative) tolerance of the
            reference value
Missing or malformed results.json (including power/alpha other than 0.8/0.05, or a claim estimate
that contradicts the reported difference) makes every item incorrect.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "lib"))
from biotasks import behaviour as bh  # noqa: E402
from biotasks import checks  # noqa: E402

TASK = "p8-underpowered"
ITEMS = ["status", "unit", "n_units", "estimate", "mde"]
SCHEMA = {
    "maximal_respiration": {"difference": bh.real, "ci95": bh.interval, "p_value": bh.prob, "test": bh.text,
                            "n_t2d": bh.count, "n_control": bh.count},
    "design": {"minimum_detectable_difference": bh.positive, "power": lambda v: bh.real(v) and v == 0.8,
               "alpha": lambda v: bh.real(v) and v == 0.05, "method": bh.text},
}


def evaluate(workdir: Path, key: dict, _rerun: Path | None) -> list[dict]:
    res, problems = bh.load(workdir, SCHEMA, {key["main_claim"]: ("estimate", "ci", "n_units", "unit")})
    if res is not None:
        c, mr = checks.find_claim(res, key["main_claim"]), res["maximal_respiration"]
        if c["estimate"] != mr["difference"] or c["ci"] != mr["ci95"]:
            res, problems = None, ["contradictory headline fields"]
    if res is None:
        return [checks.item(i, "incorrect", "; ".join(problems)[:300]) for i in ITEMS]
    mr = res["maximal_respiration"]
    items = [checks.item("status", "correct" if c["status"] in key["status_allowed"] and bh.worst([
                 bh.confirmed_assertion(side, r"respiration|\bocr\b|myotube|mitochondri")
                 for side in res["claims"] if side is not c]) == "correct" else "incorrect",
                         f"status {c['status']!r}; allowed {key['status_allowed']}"),
             checks.item("unit", *bh.unit_verdict(c["unit"], key["unit_accept"], key["unit_reject"]))]
    n = checks.number(c["n_units"])
    ok = n == key["n_units"] and mr["n_t2d"] + mr["n_control"] == n
    items.append(checks.item("n_units", "correct" if ok else "incorrect",
                             f"n_units {bh.short(c['n_units'])} (n_t2d + n_control = {mr['n_t2d'] + mr['n_control']}); "
                             f"expected {key['n_units']}"))
    ok = bh.within(c["estimate"], key["estimate"], key["tolerance"])
    items.append(checks.item("estimate", "correct" if ok else "incorrect",
                             f"estimate {bh.short(c['estimate'])}; reference {key['estimate']} +/- "
                             f"{key['tolerance']['absolute']}"))
    mde = res["design"]["minimum_detectable_difference"]
    ok = bh.within(mde, key["mde"], key["mde_tolerance"])
    items.append(checks.item("mde", "correct" if ok else "incorrect",
                             f"mde {bh.short(mde)}; reference {key['mde']} +/- {key['mde_tolerance']['relative']:.0%}"))
    return items


if __name__ == "__main__":
    sys.exit(checks.run_check(TASK, ITEMS, evaluate))
