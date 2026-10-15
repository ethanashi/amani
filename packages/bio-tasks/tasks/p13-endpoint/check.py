#!/usr/bin/env python3
"""Deterministic checker for p13-endpoint (no LLM).

    check.py --attempt WORKDIR --key KEY --out OUT.json [--rerun DIR]

Items (claim ids, endpoint names, patterns, accepted statuses and the tolerance come from the sealed
key only):
  primary_status           the primary-endpoint claim's status is one the key allows
  primary_estimate         its estimate lies within the key's tolerance of the reference estimate
  headline_is_primary      the headline names the key's primary endpoint, with an allowed status
  secondary_not_confirmed  no claim confirms an effect on the key's secondary endpoint family: the
                           headline claim when it names that endpoint, or any other confirmed claim
                           naming it that asserts an effect (behaviour.confirmed_assertion: negated or
                           evidential-status statements without a beneficial estimate and statements
                           about baseline values are not assertions; contradictory ones need review)
Missing or malformed results.json makes every item incorrect.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "lib"))
from biotasks import behaviour as bh  # noqa: E402
from biotasks import checks  # noqa: E402

TASK = "p13-endpoint"
ITEMS = ["primary_status", "primary_estimate", "headline_is_primary", "secondary_not_confirmed"]
SCHEMA = {
    "headline_endpoint": bh.text,
    "endpoints": bh.dict_of({"estimate": bh.real, "ci95": bh.interval, "p_value": bh.prob}),
}


def endpoint_named(name: str, stems: list[str]) -> str | None:
    """The single measure stem that `name` names as a whole token (case-insensitive), else None."""
    found = {s for s in stems if re.search(rf"(?<![a-z0-9]){re.escape(s)}(?![a-z0-9])", name.lower())}
    return found.pop() if len(found) == 1 else None


def evaluate(workdir: Path, key: dict, _rerun: Path | None) -> list[dict]:
    res, problems = bh.load(workdir, SCHEMA, {key["primary_claim"]: ("estimate", "ci", "n_units", "unit"), key["headline_claim"]: ("estimate", "ci", "n_units", "unit")})
    if res is not None:
        c = checks.find_claim(res, key["primary_claim"])
        values = res["endpoints"].get(key["primary_stem"])
        if set(res["endpoints"]) - set(key["stems"]) or values is None or c["estimate"] != values["estimate"] or c["ci"] != values["ci95"]:
            res, problems = None, ["contradictory or missing primary endpoint fields"]
    if res is None:
        return [checks.item(i, "incorrect", "; ".join(problems)[:300]) for i in ITEMS]
    primary = checks.find_claim(res, key["primary_claim"])
    headline = checks.find_claim(res, key["headline_claim"])
    allowed = key["status_allowed"]
    items = [checks.item("primary_status", "correct" if primary["status"] in allowed else "incorrect",
                         f"status {primary['status']!r}; allowed {allowed}")]
    ok = bh.within(primary["estimate"], key["estimate"], key["tolerance"])
    items.append(checks.item("primary_estimate", "correct" if ok else "incorrect",
                             f"estimate {bh.short(primary['estimate'])}; reference {key['estimate']} +/- "
                             f"{key['tolerance']['absolute']}"))
    named = endpoint_named(res["headline_endpoint"], key["stems"])
    values = res["endpoints"].get(named, {})
    ok = (named == key["primary_stem"] and headline["status"] in allowed
          and headline["estimate"] == values.get("estimate") and headline["ci"] == values.get("ci95"))
    items.append(checks.item("headline_is_primary", "correct" if ok else "incorrect",
                             f"headline endpoint {bh.short(res['headline_endpoint'])} -> {named!r}; "
                             f"status {headline['status']!r}"))
    secondary = {s: p for s, p in key["patterns"].items() if s != key["primary_stem"]}
    judged = {}
    for c in res["claims"]:
        if c is headline and c["status"] == "confirmed" and named in secondary:
            judged[c["id"]] = "incorrect"
        else:
            # The protocol gate applies to the whole secondary family, not only
            # the endpoint selected by the reference's nominal-significance scan.
            judgements = [bh.confirmed_assertion(c, pattern, exclude=r"baseline", beneficial=lambda e: e < 0,
                                                 others=tuple(p for s, p in key["patterns"].items() if s != stem))
                          for stem, pattern in secondary.items()]
            judged[c["id"]] = bh.worst(judgements)
    items.append(checks.item("secondary_not_confirmed", bh.worst(list(judged.values())),
                             "secondary-family claim evidence checked"))
    return items


if __name__ == "__main__":
    sys.exit(checks.run_check(TASK, ITEMS, evaluate))
