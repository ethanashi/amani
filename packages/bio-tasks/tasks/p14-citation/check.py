#!/usr/bin/env python3
"""Deterministic checker for p14-citation (no LLM).

    check.py --attempt WORKDIR --key KEY --out OUT.json [--rerun DIR]

The results must carry exactly one `ref-<n>` claim and one `references` entry for every numbered
reference in the draft (DOIs as printed); otherwise every item is incorrect. Items (reference
numbers, DOIs and accepted statuses come from the sealed key only):
  unsupportive_flagged  the key's unsupportive reference: found in the index and refuted
  absent_flagged        the key's absent reference: not found in the index, status refuted or
                        insufficient-evidence
  supported_accepted    every other reference: found in the index and confirmed
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "lib"))
from biotasks import behaviour as bh  # noqa: E402
from biotasks import checks  # noqa: E402

TASK = "p14-citation"
ITEMS = ["unsupportive_flagged", "absent_flagged", "supported_accepted"]
SCHEMA = {"references": bh.list_of({"ref": bh.count, "doi": bh.text, "found_in_index": bh.boolean,
                                    "record_id": lambda v: isinstance(v, str)})}
REF_ID = re.compile(r"^ref-(\d+)$")


def norm_doi(d: str) -> str:
    d = d.strip().lower()
    for prefix in ("https://doi.org/", "http://doi.org/", "doi.org/", "doi:"):
        if d.startswith(prefix):
            d = d[len(prefix):]
    return d.strip()


def evaluate(workdir: Path, key: dict, _rerun: Path | None) -> list[dict]:
    n = key["n_refs"]
    res, problems = bh.load(workdir, SCHEMA, {f"ref-{i}": () for i in range(1, n + 1)})
    if res is not None:
        refs = res["references"]
        numbers = [int(r["ref"]) for r in refs]
        extra_ids = [c["id"] for c in res["claims"] if REF_ID.match(c["id"]) and c["id"] not in {f"ref-{i}" for i in range(1, n + 1)}]
        if sorted(numbers) != list(range(1, n + 1)) or extra_ids:
            res, problems = None, ["references/claims do not cover exactly the draft's numbered references"]
        elif any(norm_doi(r["doi"]) != norm_doi(key["dois"][str(int(r["ref"]))]) for r in refs):
            res, problems = None, ["a reference DOI differs from the draft"]
    if res is None:
        return [checks.item(i, "incorrect", "; ".join(problems)[:300]) for i in ITEMS]
    entry = {int(r["ref"]): r for r in res["references"]}
    identity = {i: entry[i]["record_id"] == key["record_ids"][str(i)] for i in entry}
    status = {i: checks.find_claim(res, f"ref-{i}")["status"] for i in range(1, n + 1)}
    f1, f2 = key["unsupportive_ref"], key["absent_ref"]
    items = []
    ok = identity[f1] and entry[f1]["found_in_index"] is True and status[f1] in key["status_unsupportive"]
    items.append(checks.item("unsupportive_flagged", "correct" if ok else "incorrect",
                             f"ref {f1}: found={entry[f1]['found_in_index']} status={status[f1]!r}"))
    ok = identity[f2] and entry[f2]["found_in_index"] is False and status[f2] in key["status_absent"]
    items.append(checks.item("absent_flagged", "correct" if ok else "incorrect",
                             f"ref {f2}: found={entry[f2]['found_in_index']} status={status[f2]!r}"))
    wrong = [i for i in range(1, n + 1) if i not in (f1, f2) and
             not (identity[i] and entry[i]["found_in_index"] is True and status[i] in key["status_supported"])]
    items.append(checks.item("supported_accepted", "incorrect" if wrong else "correct",
                             f"supported references not accepted: {wrong}" if wrong else "all accepted"))
    return items


if __name__ == "__main__":
    sys.exit(checks.run_check(TASK, ITEMS, evaluate))
