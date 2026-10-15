#!/usr/bin/env python3
"""Deterministic checker for p10b-pseudorep-hidden (no LLM): p10-pseudorep's scientific checker plus strict claim fields.

    check.py --attempt WORKDIR --key KEY --out OUT.json [--rerun DIR]

The deliverable schema is p10's (validated with p10's public schema); items `status`, `unit`,
`n_units`, `estimate` are judged exactly as in p10, against this task's sealed key. p10's check.py is
pinned in this task's bindings.json, so any change to it makes this calibration stale.
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "lib"))
from biotasks import behaviour as bh
from biotasks import checks  # noqa: E402

_spec = importlib.util.spec_from_file_location("p10_check", HERE.parent / "p10-pseudorep" / "check.py")
p10 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(p10)

TASK = "p10b-pseudorep-hidden"
ITEMS = p10.ITEMS
def evaluate(workdir: Path, key: dict, rerun: Path | None) -> list[dict]:
    data, _ = checks.load_results(workdir)
    if data is None or not bh.claim_fields_valid(data):
        return [checks.item(i, "incorrect", "malformed results or unknown claim fields") for i in ITEMS]
    return p10.evaluate(workdir, key, rerun)

if __name__ == "__main__":
    sys.exit(checks.run_check(TASK, ITEMS, evaluate))
