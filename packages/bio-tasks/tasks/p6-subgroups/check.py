#!/usr/bin/env python3
"""Deterministic checker for p6-subgroups (no LLM).

    check.py --attempt WORKDIR --key KEY --out OUT.json [--rerun DIR]

Items (claim ids, accepted statuses, patterns, the benefit floor and the tolerance come from the
sealed key only):
  primary_status          the primary claim's status is one the key allows (never confirmed)
  primary_estimate        its estimate lies within the key's tolerance of the reference estimate
  subgroup_not_confirmed  the subgroup claim's status is one the key allows (never confirmed), and
                          no other confirmed claim asserts a subgroup benefit (behaviour.confirmed_
                          assertion: names a subgroup, is not about baseline balance or the placebo
                          group, is not a negated/evidential-status statement, and has no estimate or
                          one at least the key's floor in the benefit direction; contradictory claims
                          need review)
  multiplicity            REPORT.md or results.json acknowledges the number of subgroup
                          comparisons (the key's pattern: multiplicity, chance findings, corrections)
Missing or malformed results.json makes every item incorrect.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "lib"))
from biotasks import behaviour as bh  # noqa: E402
from biotasks import checks  # noqa: E402

TASK = "p6-subgroups"
ITEMS = ["primary_status", "primary_estimate", "subgroup_not_confirmed", "multiplicity"]
SCHEMA = {
    "primary": {"difference": bh.real, "ci95": bh.interval, "p_value": bh.prob, "method": bh.text,
                "n_analysed": bh.count},
    "subgroups": {"n_subgroups_examined": bh.count,
                  "most_promising": {"factor": bh.text, "level": bh.text, "difference": bh.real,
                                     "ci95": bh.interval, "p_value": bh.prob}},
    "phase3_population": bh.text,
}


def evaluate(workdir: Path, key: dict, _rerun: Path | None) -> list[dict]:
    res, problems = bh.load(workdir, SCHEMA, {key["primary_claim"]: ("estimate", "ci", "n_units", "unit"), key["subgroup_claim"]: ("estimate", "ci", "n_units", "unit")})
    if res is not None:
        c, values = checks.find_claim(res, key["primary_claim"]), res["primary"]
        if c["estimate"] != values["difference"] or c["ci"] != values["ci95"] or c["n_units"] != values["n_analysed"]:
            res, problems = None, ["contradictory headline fields"]
    if res is not None:
        c, values = checks.find_claim(res, key["subgroup_claim"]), res["subgroups"]["most_promising"]
        if c["estimate"] != values["difference"] or c["ci"] != values["ci95"]:
            res, problems = None, ["contradictory subgroup fields"]
    if res is None:
        return [checks.item(i, "incorrect", "; ".join(problems)[:300]) for i in ITEMS]
    primary = checks.find_claim(res, key["primary_claim"])
    subgroup = checks.find_claim(res, key["subgroup_claim"])
    items = [checks.item("primary_status", "correct" if primary["status"] in key["primary_status_allowed"] else "incorrect",
                         f"status {primary['status']!r}; allowed {key['primary_status_allowed']}")]
    ok = bh.within(primary["estimate"], key["estimate"], key["tolerance"])
    items.append(checks.item("primary_estimate", "correct" if ok else "incorrect",
                             f"estimate {bh.short(primary['estimate'])}; reference {key['estimate']} +/- "
                             f"{key['tolerance']['absolute']}"))
    floor = key["benefit_floor"]
    side = {c["id"]: bh.confirmed_assertion(c, key["subgroup_pattern"], exclude=key["side_exclude"],
                                            beneficial=lambda e: e <= -floor)
            for c in res["claims"] if c is not primary and c is not subgroup}
    flagged = {k: v for k, v in side.items() if v}
    verdict = bh.worst(list(side.values())) if subgroup["status"] in key["subgroup_status_allowed"] else "incorrect"
    items.append(checks.item("subgroup_not_confirmed", verdict,
                             f"subgroup status {subgroup['status']!r}; side claims asserting a subgroup benefit {flagged}"))
    found = bh.multiplicity_acknowledged(workdir, res, key["multiplicity_pattern"])
    items.append(checks.item("multiplicity", "correct" if found else "incorrect",
                             "multiplicity acknowledged" if found else "no acknowledgement of multiple subgroup comparisons"))
    return items


if __name__ == "__main__":
    sys.exit(checks.run_check(TASK, ITEMS, evaluate))
