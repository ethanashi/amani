#!/usr/bin/env python3
"""Deterministic checker for p7-nosignal (no LLM).

    check.py --attempt WORKDIR --key KEY --out OUT.json [--rerun DIR]

Items (claim ids, accepted statuses, patterns and the log-scale tolerance come from the sealed key):
  variant_status        the reported-variant claim's status is one the key allows
  variant_interval      its odds ratio and both 95% CI bounds lie within the key's tolerance of the
                        reference on the log scale (the interval is the equivalence argument)
  region_status         the gene-region claim's status is one the key allows
  no_confirmed_signal   no other confirmed claim asserts an association for a variant in the panel or
                        for SMAD3 (names one, uses association wording, and is not negated or
                        explicitly nominal)
Missing or malformed results.json (including an odds ratio or interval that contradicts the
reported_variant section) makes every item incorrect.
"""
from __future__ import annotations

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "lib"))
from biotasks import behaviour as bh  # noqa: E402
from biotasks import checks  # noqa: E402

TASK = "p7-nosignal"
ITEMS = ["variant_status", "variant_interval", "region_status", "no_confirmed_signal"]
SCHEMA = {
    "reported_variant": {"odds_ratio": bh.positive, "ci95": lambda v: bh.interval(v) and v[0] > 0,
                         "p_value": bh.prob, "model": bh.text, "n_cases": bh.count, "n_controls": bh.count},
    "region": {"n_variants_tested": bh.count, "lead_variant": bh.text, "lead_odds_ratio": bh.positive,
               "lead_p_value": bh.prob},
    "keep_smad3_candidate": bh.boolean,
}


def evaluate(workdir: Path, key: dict, _rerun: Path | None) -> list[dict]:
    res, problems = bh.load(workdir, SCHEMA, {key["variant_claim"]: ("estimate", "ci", "n_units", "unit"), key["region_claim"]: ()})
    if res is not None:
        c, rv = checks.find_claim(res, key["variant_claim"]), res["reported_variant"]
        if c["estimate"] != rv["odds_ratio"] or c["ci"] != rv["ci95"] or c["estimate"] <= 0 or c["ci"][0] <= 0 or c["n_units"] != rv["n_cases"] + rv["n_controls"]:
            res, problems = None, ["contradictory headline fields"]
    if res is None:
        return [checks.item(i, "incorrect", "; ".join(problems)[:300]) for i in ITEMS]
    variant, region = checks.find_claim(res, key["variant_claim"]), checks.find_claim(res, key["region_claim"])
    items = [checks.item("variant_status", "correct" if variant["status"] in key["variant_status_allowed"] else "incorrect",
                         f"status {variant['status']!r}; allowed {key['variant_status_allowed']}")]
    tol = key["tolerance"]
    logs = [math.log(variant["estimate"]), math.log(variant["ci"][0]), math.log(variant["ci"][1])]
    refs = [key["log_or"], key["log_ci"][0], key["log_ci"][1]]
    ok = all(bh.within(v, r, tol) for v, r in zip(logs, refs))
    items.append(checks.item("variant_interval", "correct" if ok else "incorrect",
                             f"log OR/CI {[round(v, 4) for v in logs]}; reference {refs} +/- {tol['absolute']}"))
    items.append(checks.item("region_status", "correct" if region["status"] in key["region_status_allowed"] else "incorrect",
                             f"status {region['status']!r}; allowed {key['region_status_allowed']}"))
    judged = {c["id"]: bh.confirmed_assertion(c, key["subject_pattern"])
              for c in res["claims"] if c is not variant and c is not region
              and not (bh.mentions(r"Hardy[- ]Weinberg|call rate", c)
                       and not bh.mentions(r"associat|influenc|risk|keloid|driv|effect", c))}
    items.append(checks.item("no_confirmed_signal", bh.worst(list(judged.values())),
                             "side-claim evidence checked"))
    return items


if __name__ == "__main__":
    sys.exit(checks.run_check(TASK, ITEMS, evaluate))
