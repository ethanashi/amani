#!/usr/bin/env python3
"""Seed search for the iad2-brady-twin counterfactual (authoring tool; run once, result pinned in stage.py).

    search_twin.py [--max-attempts N] [--min-gain 0.05]

Walks attempts 0, 1, 2, ... of iad_common.twin_candidate with the card seed and accepts the first one meeting
every condition of iad_common.twin_acceptance (design 5.5 with the critic's fixes: protocol-consistent
truncation, 12-20 positives, accuracy >= majority + min-gain, model ahead of both co-primary comparators with a
patient-cluster bootstrap interval excluding 0, realistic error counts and discrimination, weak comparators
weak, exactly one planted inconsistency, moved off the original record, and a recalled real-audit answer
rejected). It prints pass/fail counts and the
accepted attempt index only, never a value.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "lib"))
sys.path.insert(0, str(HERE.parent / "iad1-brady-audit"))

import iad_common as ic  # noqa: E402


def evaluate(world: dict, task: str, seed: int, attempt: int, min_gain: float, original: tuple, resamples: int,
             real: dict | None = None) -> dict:
    cand = ic.twin_candidate(world, seed, attempt)
    ids = ic.pseudo_ids(task, seed, [r["pid"] for r in cand["rows"]], 2)
    st = ic.scored_from_world(cand, ids)
    s = ic.loo_stats(st, resamples=resamples)
    acc = ic.twin_acceptance(s, min_gain, real if real is not None else ic.recall_guard(world))
    acc["protocol_consistent_outcomes"] = ic.protocol_consistent(st)
    acc["planted_record_moved"] = cand["planted"] != original
    return acc


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-attempts", type=int, default=20000)
    ap.add_argument("--min-gain", type=float, default=0.05)
    a = ap.parse_args()
    card = json.loads((HERE / "card.json").read_text())
    world = ic.base_world(ic.archive())
    original = next((r["pid"], r["cycle"]) for r in world["rows"] if r["p"] is not None and r["call"] != (r["p"] > r["kappa"]))
    real = ic.recall_guard(world)
    ci_key = "model_beats_coprimary_comparators_with_ci"
    screened = cheap = 0
    for attempt in range(a.max_attempts):
        screened += 1
        acc = evaluate(world, card["id"], card["seed"], attempt, a.min_gain, original, 0, real)
        if not all(v for k, v in acc.items() if k != ci_key):
            continue
        cheap += 1
        if not evaluate(world, card["id"], card["seed"], attempt, a.min_gain, original, 300, real)[ci_key]:
            continue
        if all(evaluate(world, card["id"], card["seed"], attempt, a.min_gain, original, 4000, real).values()):
            print(f"accepted attempt {attempt} after {screened} candidates ({cheap} passed screening); min_gain {a.min_gain}")
            return 0
    print(f"no acceptable attempt in {screened} candidates ({cheap} passed screening); min_gain {a.min_gain}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
