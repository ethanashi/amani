#!/usr/bin/env python3
"""Compare a blind re-implementation (REPLICATION-SPEC.md) against the sealed key, without showing values.

    compare_replication.py --replication replication.json [--task iad1-brady-audit|iad2-brady-twin]

The key is decrypted only inside grading-root scratch (under the grading lease) and deleted afterwards. Output
is one line per field, `match` or `MISMATCH`, and a summary; exit 0 only if every field matches. Rules (see the
spec): integers and row lists exact; deterministic floats within 1e-6; bootstrap intervals within 0.01 per bound
and on the key's side of zero; draws_used within 1%.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "lib"))

from biotasks import sealing  # noqa: E402
from biotasks.card import key_path, load_card  # noqa: E402
from biotasks.paths import TASKS  # noqa: E402

FLOAT_TOL = 1e-6


def num(x) -> bool:
    return not isinstance(x, bool) and isinstance(x, (int, float)) and math.isfinite(x)


def fields(task: str) -> list[tuple[str, str]]:
    f = [("n_scored", "exact"), ("n_patients", "exact"), ("nan_rows", "exact"), ("counts", "exact"),
         ("counts_threshold_rule", "exact"), ("rates", "float"), ("rates_threshold_rule", "float"),
         ("majority_accuracy", "float"), ("accuracy_minus_majority", "float"),
         ("accuracy_minus_majority_threshold_rule", "float"), ("auc", "float"), ("auc_by_cycle", "float"),
         ("auc_alternatives_not_accepted", "float"), ("inconsistent_rows", "exact"), ("strong_threshold", "float"),
         ("in_sample_trap_nadir_gt_2_accuracy", "float")]
    for n in ("nadir", "end_psa", "nadir_zeros_kept", "end_psa_zeros_kept", "restart_psa"):
        f += [(f"comparators.{n}.auc", "float"), (f"comparators.{n}.coverage", "float")]
    for n in ("nadir", "end_psa"):
        f += [(f"comparators.{n}.auc_model_minus", "float"), (f"comparators.{n}.ci95", "interval"),
              (f"comparators.{n}.draws_used", "draws")]
    if task == "iad1-brady-audit":
        f += [("training_auc", "float")]
    return f


def get(obj, path: str):
    for part in path.split("."):
        if not isinstance(obj, dict) or part not in obj:
            return KeyError
        obj = obj[part]
    return obj


def same(a, b, rule: str) -> bool:
    if a is KeyError or b is KeyError:
        return False
    if rule == "exact":
        return json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True)
    if rule == "draws":
        return num(a) and num(b) and abs(a - b) <= 0.01 * b
    if rule == "interval":
        return (isinstance(a, list) and len(a) == 2 and all(num(x) for x in a) and
                all(abs(x - y) <= 0.01 and (x > 0) == (y > 0) and (x < 0) == (y < 0) for x, y in zip(a, b)))
    if isinstance(b, dict):
        return isinstance(a, dict) and set(a) == set(b) and all(same(a[k], b[k], rule) for k in b)
    if b is None:
        return a is None
    if isinstance(b, bool) or not num(b):
        return a == b
    return num(a) and abs(a - b) <= FLOAT_TOL


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--replication", required=True, type=Path)
    ap.add_argument("--task", default="iad1-brady-audit", choices=["iad1-brady-audit", "iad2-brady-twin"])
    a = ap.parse_args()
    rep = json.loads(a.replication.read_text())
    key = sealing.load_json(key_path(load_card(TASKS / a.task)))
    bad = 0
    for path, rule in fields(a.task):
        ok = same(get(rep, path), get(key, path), rule)
        bad += not ok
        print(f"{'match   ' if ok else 'MISMATCH'} {path}")
    print(f"{a.task}: {len(fields(a.task)) - bad} of {len(fields(a.task))} fields match")
    return 0 if bad == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
