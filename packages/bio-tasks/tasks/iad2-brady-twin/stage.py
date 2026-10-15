#!/usr/bin/env python3
"""Stage iad2-brady-twin: the counterfactual ("changed-truth") twin of iad1-brady-audit.

    stage.py --out DIR [--truth-out FILE]

Same source and de-identification as iad1 (see ../iad1-brady-audit/iad_common.py), with the critic's fixes for
the twin: the observed outcomes are regenerated (iad_common.twin_candidate, attempt pinned below from
search_twin.py), a resistant outcome ends the patient's predictions (later prediction rows and history are
removed, as the trial withdrew resistant patients), the per-fold thresholds are permuted within cycle (the real
ones separate the real held-out outcome), training_roc.csv is not staged (its counts identify the real outcome
of every held-out patient), rows are ordered by pseudonymous subject (the source order groups resistant patients
first), and the one record whose call contradicts its threshold is planted on a different record. Subject IDs
come from this card's own seed, so they do not map onto iad1's. Deterministic: same seed, same bytes.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "lib"))
sys.path.insert(0, str(HERE.parent / "iad1-brady-audit"))

from biotasks import staging  # noqa: E402

import iad_common as ic  # noqa: E402

TWIN_ATTEMPT = 0     # first attempt accepted by search_twin.py (min gain 0.05) with this card's seed


def main() -> int:
    a = staging.stage_args()
    card = json.loads((HERE / "card.json").read_text())
    truth_out = staging.guard_truth(a.truth_out, a.out)
    z = ic.archive()
    staging.prepare_out(a.out)
    world = ic.base_world(z)
    original = next((r["pid"], r["cycle"]) for r in world["rows"]
                    if r["p"] is not None and r["call"] != (r["p"] > r["kappa"]))
    twin = ic.twin_candidate(world, card["seed"], TWIN_ATTEMPT)
    ids = ic.stage_loo(a.out, card["id"], card["seed"], twin, include_roc=False)
    pid, cyc = twin["planted"]
    staging.write_truth(truth_out, {
        "task": card["id"], "seed": card["seed"], "attempt": TWIN_ATTEMPT, "min_gain": 0.05,
        "pseudo_ids": {str(k): v for k, v in sorted(ids.items())},
        "planted": [ids[pid], cyc], "planted_source_record": [pid, cyc], "original_inconsistent_record": list(original),
        "recall_guard": ic.recall_guard(world)})
    staging.finalize(a.out, HERE, card["id"], card["seed"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
