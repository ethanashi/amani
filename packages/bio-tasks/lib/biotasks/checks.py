"""Fail-closed helpers shared by every task's deterministic `check.py` (no LLM).

    check.py --attempt WORKDIR --key KEY --out OUT.json [--rerun RERUN_DIR]

Per-item verdicts are `correct | incorrect | needs-review` with evidence. Missing, unparseable or
malformed results are `incorrect`, never skipped. Tolerances and expected values come from the
sealed key only; nothing the attempt writes changes how strict a check is. Evidence may contain
key-derived values, so OUT must be inside the grading root (callers seal it) and stdout carries
only the score.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
import traceback
from pathlib import Path

from .paths import require_under_grading_root, use_baseline

use_baseline()
import armlib  # noqa: E402 (shared duplicate-key/row validation)

STATUSES = ("confirmed", "tentative", "refuted", "insufficient-evidence")
VERDICTS = ("correct", "incorrect", "needs-review")
MAX_RESULTS_BYTES = 5_000_000
KEY_SCHEMA = "bio-tasks/key@1"


def number(x) -> float | None:
    """A finite real number (bools and strings are not numbers), else None."""
    if isinstance(x, bool) or not isinstance(x, (int, float)):
        return None
    try:
        x = float(x)
    except OverflowError:
        return None
    return x if math.isfinite(x) else None


def claim_problems(c) -> list[str]:
    if not isinstance(c, dict):
        return ["claim is not an object"]
    probs = []
    if not isinstance(c.get("id"), str) or not c["id"].strip():
        probs.append("claim id missing")
    if not isinstance(c.get("statement"), str) or not c["statement"].strip():
        probs.append(f"claim {c.get('id')!r}: statement missing")
    if c.get("status") not in STATUSES:
        probs.append(f"claim {c.get('id')!r}: status must be one of {STATUSES}")
    if "estimate" in c and c["estimate"] is not None and number(c["estimate"]) is None:
        probs.append(f"claim {c.get('id')!r}: estimate is not a finite number")
    if "ci" in c and c["ci"] is not None:
        ci = c["ci"]
        if (not isinstance(ci, list) or len(ci) != 2 or any(number(v) is None for v in ci) or
                number(ci[0]) > number(ci[1])):
            probs.append(f"claim {c.get('id')!r}: ci must be [low, high] finite numbers")
    if "n_units" in c and c["n_units"] is not None:
        n = number(c["n_units"])
        if n is None or n <= 0 or n != int(n):
            probs.append(f"claim {c.get('id')!r}: n_units must be a positive integer")
    if "unit" in c and c["unit"] is not None and (not isinstance(c["unit"], str) or not c["unit"].strip()):
        probs.append(f"claim {c.get('id')!r}: unit must be a non-empty string")
    return probs


def load_results(workdir: Path, task: str | None = None) -> tuple[dict | None, list[str]]:
    """(results, problems). results is None whenever it cannot be trusted structurally."""
    p = Path(workdir) / "results.json"
    if p.is_symlink() or not p.is_file():
        return None, ["results.json missing"]
    if p.stat().st_size > MAX_RESULTS_BYTES:
        return None, ["results.json too large"]
    try:
        data = armlib.strict_json_loads(p.read_text(encoding="utf-8"))
        armlib.validate_result_rows(data)
    except (OSError, UnicodeDecodeError, ValueError, RecursionError) as exc:
        known = {"duplicate JSON key", "duplicate list row key (size/name)",
                 "invalid list row key (size/name)", "nonfinite list row key", "nonfinite JSON number"}
        return None, [str(exc) if str(exc) in known else "results.json unparseable"]
    if not isinstance(data, dict):
        return None, ["results.json is not an object"]
    claims = data.get("claims")
    if not isinstance(claims, list) or not claims:
        return None, ["results.json has no claims array"]
    probs = [p for c in claims for p in claim_problems(c)]
    ids = [c.get("id") for c in claims if isinstance(c, dict)]
    if all(isinstance(i, str) for i in ids) and len(set(ids)) != len(ids):
        probs.append("duplicate claim ids")
    if probs:
        return None, probs
    if task is not None:
        probs = task_results_problems(data, task)
        if probs:
            return None, probs
    return data, []


def find_claim(results: dict, claim_id: str) -> dict | None:
    for c in results.get("claims", []):
        if isinstance(c, dict) and c.get("id") == claim_id:
            return c
    return None


def item(item_id: str, verdict: str, evidence: str, required: bool = True) -> dict:
    if verdict not in VERDICTS:
        raise ValueError(f"bad verdict {verdict!r}")
    return {"id": item_id, "verdict": verdict, "evidence": evidence, "required": required}


def finalize(task: str, items: list[dict], expected_ids: list[str]) -> dict:
    """passed only when exactly the expected items are present and every required item is correct
    (needs-review is not correct). score = correct required items / required items. Informational
    (required=False) items are reported but never decide the task."""
    ids = [i["id"] for i in items]
    if sorted(ids) != sorted(expected_ids):
        items = [item(i, "incorrect", "checker did not produce this item") for i in expected_ids]
    req = [i for i in items if i["required"]]
    correct = sum(1 for i in req if i["verdict"] == "correct")
    passed = bool(req) and correct == len(req)
    return {"task": task, "items": items, "score": round(correct / len(req), 6) if req else 0.0, "passed": passed}


def all_incorrect(task: str, expected_ids: list[str], why: str) -> dict:
    return finalize(task, [item(i, "incorrect", why) for i in expected_ids], expected_ids)


def load_key(path: Path, task: str) -> dict:
    key = json.loads(Path(path).read_text())
    if not isinstance(key, dict) or key.get("schema") != KEY_SCHEMA or key.get("task") != task:
        raise ValueError("key schema/task mismatch")
    return key


def run_check(task: str, expected_ids: list[str], evaluate, key_loader=None, argv: list[str] | None = None) -> int:
    """CLI driver. `evaluate(workdir, key, rerun_dir) -> list[item]`. Any exception inside evaluate
    marks every item incorrect (fail closed). An unreadable key is a checker error (exit 2), which
    callers treat as 'did not run', never as a pass."""
    ap = argparse.ArgumentParser()
    ap.add_argument("--attempt", required=True, type=Path, help="attempt workdir (REPORT.md, results.json, ...)")
    ap.add_argument("--key", required=True, type=Path, help="plaintext key inside the grading root")
    ap.add_argument("--out", required=True, type=Path, help="verdict JSON inside the grading root")
    ap.add_argument("--rerun", type=Path, default=None, help="grader re-run directory, when available")
    a = ap.parse_args(argv)
    require_under_grading_root(a.out, "checker output")
    require_under_grading_root(a.key, "plaintext key")
    try:
        key = (key_loader or (lambda p: load_key(p, task)))(a.key)
    except Exception as e:  # noqa: BLE001
        print(f"{task}: key unreadable ({type(e).__name__}); not graded", file=sys.stderr)
        return 2
    try:
        result = finalize(task, evaluate(a.attempt, key, a.rerun), expected_ids)
    except Exception as e:  # noqa: BLE001 - fail closed, without echoing key-derived values
        tb = traceback.extract_tb(e.__traceback__)
        where = f"{Path(tb[-1].filename).name}:{tb[-1].lineno}" if tb else "?"
        result = all_incorrect(task, expected_ids, f"checker exception {type(e).__name__} at {where}")
    a.out.parent.mkdir(parents=True, exist_ok=True)
    a.out.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")
    print(f"{task}: passed={result['passed']} score={result['score']:.3f}")
    return 0


def task_results_problems(data: dict, task: str) -> list[str]:
    """Validate the public deliverable contract; extra data belongs only under `extra`."""
    text = lambda v: isinstance(v, str) and bool(v.strip())
    real = lambda v: number(v) is not None
    integer = lambda v: real(v) and v >= 0 and v == int(v)
    interval = lambda v: isinstance(v, list) and len(v) == 2 and all(real(x) for x in v) and v[0] <= v[1]
    boolean = lambda v: type(v) is bool
    schemas = {
        'p10-pseudorep': {
            'dlg4': {'log2_fold_change': real, 'ci95': interval, 'p_value': lambda v: real(v) and 0 <= v <= 1,
                     'test': text, 'n_disease': integer, 'n_control': integer},
            'genome_wide': {'n_genes_tested': integer, 'n_genes_fdr_0_05': integer, 'method': text},
            'start_rescue_experiment': boolean},
        'p9-leakage': {
            'classifier': {'model': text, 'n_features': integer, 'evaluation': text},
            'top_genes': lambda v: isinstance(v, list) and all(text(x) for x in v),
            'develop_diagnostic': boolean},
    }
    schema = schemas[task]
    if set(data) != set(schema) | {'claims', 'extra'} or not isinstance(data.get('extra'), dict):
        return ['results fields missing, unknown, or wrongly typed']
    for field, rule in schema.items():
        value = data[field]
        if isinstance(rule, dict):
            if not isinstance(value, dict) or set(value) != set(rule) or not all(test(value[k]) for k, test in rule.items()):
                return ['results section malformed']
        elif not rule(value):
            return ['results field malformed']
    main_id = 'dlg4_effect' if task == 'p10-pseudorep' else 'cell_auc'
    main = find_claim(data, main_id)
    if main is None or any(main.get(k) is None for k in ('estimate', 'ci', 'n_units', 'unit')):
        return ['headline claim fields missing']
    if task == 'p10-pseudorep':
        detail = data['dlg4']
        if (detail['log2_fold_change'] != main['estimate'] or detail['ci95'] != main['ci'] or
                detail['n_disease'] + detail['n_control'] != main['n_units'] or
                data['genome_wide']['n_genes_fdr_0_05'] > data['genome_wide']['n_genes_tested']):
            return ['contradictory headline fields']
    elif not (0 <= main['estimate'] <= 1 and all(0 <= v <= 1 for v in main['ci'])):
        return ['AUC outside probability domain']
    return []
