"""Calibration: a task is valid only if its checker fails the empty answer, passes the reference
answer and fails the naive ("falls for the flaw") answer. The record maps to
`@omerta-bio/checks` `validity.calibrateTask` semantics: empty -> empty, reference -> reference,
naive -> permuted. `calibration.json` holds outcomes, verdict ids and artifact bindings only -- no
plaintext answers, estimates or tolerances.

Bindings pin the calibrated artifacts (card, staged manifest, sealed key, stage/reference/check
code, naive tree, shared checker helpers). Any change makes the record stale, and the harness then
refuses to run or grade the task until it is recalibrated.
"""
from __future__ import annotations

import hashlib
import json
import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path

from . import sealing, staging
from .card import key_path, load_card
from .paths import BASELINE, LIB, REPO, use_baseline

use_baseline()
import grade  # noqa: E402  (bio-baseline/grading/grade.py: sandboxed re-run machinery, reused)

SCHEMA = "bio-tasks/calibration@1"
STATUS_OF = {True: "passed", False: "failed", None: "error"}


def evaluate(inp) -> dict:
    """Python port of bio-checks `calibrateTask` evaluate(): identical decision rules."""
    def refuse(status, reason):
        return {"status": status, "reasons": [reason]}
    if not isinstance(inp, dict):
        return refuse("refused-inconclusive", "missing calibration evidence")
    perm = inp.get("permuted")
    if (inp.get("empty") not in ("passed", "failed") or inp.get("reference") not in ("passed", "failed") or
            not isinstance(perm, list) or not perm or any(s not in ("passed", "failed") for s in perm)):
        return refuse("refused-inconclusive", "every calibration control must execute conclusively")
    if inp["empty"] == "passed":
        return refuse("refused-vacuous", "empty analysis passed")
    if inp["reference"] == "failed":
        return refuse("refused-reference-fails", "reference analysis failed")
    if not all(s == "failed" for s in perm):
        return refuse("refused-inconclusive", "every label permutation must execute and fail")
    return {"status": "valid", "reasons": []}


def tree_sha256(root: Path) -> str:
    """Hash of a directory tree: relative paths + file bytes, sorted; caches excluded."""
    h = hashlib.sha256()
    root = Path(root)
    for p in sorted(root.rglob("*")):
        rel = p.relative_to(root)
        if "__pycache__" in rel.parts or p.suffix == ".pyc" or not p.is_file():
            continue
        h.update(rel.as_posix().encode() + b"\0" + staging.sha256_file(p).encode() + b"\n")
    return h.hexdigest()


def bindings(task_dir: Path, card: dict) -> dict:
    task_dir = Path(task_dir)
    kp = key_path(card)
    files = {name: staging.sha256_file(task_dir / name)
             for name in ("card.json", "TASK.md", "stage.py", "reference.py", "check.py")}
    out = {
        "datasetManifestHash": card["datasetManifestHash"],
        "sealedKey": {"path": card["sealedAnswerKeyRef"], "sha256": staging.sha256_file(kp),
                      "ciphertextSha256": sealing.ciphertext_sha256(kp)},
        "files": files,
        "naiveTree": tree_sha256(task_dir / "naive"),
        "shared": {"lib/biotasks/" + name: staging.sha256_file(LIB / "biotasks" / name)
                   for name in ("checks.py", "calibrate.py", "staging.py", "sealing.py", "card.py", "grading.py")},
    }
    for rel in ("packages/bio-baseline/arms/lib/armlib.py", "packages/bio-baseline/arms/lib/seal.py",
                "packages/bio-baseline/grading/grade.py", "packages/bio-baseline/pixi.lock"):
        out["shared"][rel] = staging.sha256_file(REPO / rel)
    extra = task_dir / "bindings.json"     # task-specific extra artifacts (e.g. w0: grade.py)
    if extra.is_file():
        for rel in json.loads(extra.read_text()):
            out["shared"][rel] = staging.sha256_file(REPO / rel)
        out["files"]["bindings.json"] = staging.sha256_file(extra)
    return out


def binding_problems(task_dir: Path, card: dict, record: dict) -> list[str]:
    try:
        now = bindings(task_dir, card)
    except (OSError, ValueError, SystemExit) as e:
        return [f"bindings unavailable: {type(e).__name__}"]
    want = record.get("bindings") if isinstance(record, dict) else None
    if not isinstance(want, dict):
        return ["calibration record has no bindings"]
    probs = []
    for k in sorted(set(now) | set(want)):
        if now.get(k) != want.get(k):
            probs.append(f"stale binding: {k}")
    return probs


def check_record(task_dir: Path, card: dict) -> list[str]:
    """Problems with the recorded calibration (empty list = valid and current)."""
    p = Path(task_dir) / "calibration.json"
    try:
        rec = json.loads(p.read_text())
    except (OSError, ValueError):
        return ["calibration.json missing or unparseable"]
    probs = []
    if not isinstance(rec, dict):
        return ["calibration.json is not an object"]
    if rec.get("schema") != SCHEMA or rec.get("task") != card["id"]:
        probs.append("calibration.json schema/task mismatch")
    if evaluate(rec.get("calibrationInput"))["status"] != "valid" or rec.get("status") != "valid":
        probs.append("task did not calibrate")
    return probs + binding_problems(task_dir, card, rec)


def _check(task_dir: Path, workdir: Path, key_plain: Path, out: Path, rerun: Path | None = None) -> dict | None:
    cmd = [sys.executable, str(Path(task_dir) / "check.py"), "--attempt", str(workdir),
           "--key", str(key_plain), "--out", str(out)]
    if rerun is not None:
        cmd += ["--rerun", str(rerun)]
    # The parent holds the grading lease; the checker reuses it (as bio-baseline's supervisor does).
    r = subprocess.run(cmd, capture_output=True, text=True, env=dict(os.environ, BIO_OPERATION="grading"))
    if r.returncode != 0:
        return None
    try:
        res = json.loads(out.read_text())
    except (OSError, ValueError):
        return None
    if not isinstance(res, dict) or not isinstance(res.get("passed"), bool):
        return None
    return res


def _summary(res: dict | None) -> dict:
    if res is None:
        return {"outcome": "error"}
    return {"outcome": STATUS_OF[res["passed"]], "score": res.get("score"),
            "verdicts": {i["id"]: i["verdict"] for i in res.get("items", [])}}


def run_naive(task_dir: Path, stage: Path, tmp: Path, cap_sec: int) -> Path | None:
    """Execute the naive workdir's run_all.sh with grade.py's sandboxed re-run (no network, writes
    confined, verified staged data). Returns the workdir with the re-run results.json, or None."""
    attempt = tmp / "naive"
    work = attempt / "workdir"
    shutil.copytree(Path(task_dir) / "naive", work, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    st = grade.rerun(attempt, stage / "data", cap_sec, attempt / "rerun")
    res = attempt / "rerun" / "results.json"
    if not grade.successful_rerun(st) or not res.is_file():
        return None
    shutil.copy2(res, work / "results.json")
    return work


def calibrate(task_dir: Path, cap_sec: int = 900, write: bool = True) -> dict:
    task_dir = Path(task_dir)
    card = load_card(task_dir)
    kp = key_path(card)
    with sealing.scratch("biotasks-cal.") as tmp:
        stage, truth, ref = tmp / "stage", tmp / "truth.json", tmp / "ref"
        mhash = staging.run_stage(task_dir, stage, truth)
        stage_ok = mhash == card["datasetManifestHash"] and not staging.verify(stage, card["datasetManifestHash"])
        r = subprocess.run([sys.executable, str(task_dir / "reference.py"), "--data", str(stage),
                            "--truth", str(truth), "--out", str(ref)], capture_output=True, text=True)
        reference_ran = r.returncode == 0 and (ref / "workdir" / "results.json").is_file()
        with sealing.opened(kp) as key_plain:
            key_current = True
            if (ref / "key.json").is_file():
                fresh = json.loads((ref / "key.json").read_text())
                sealed = sealing.strip_nonce(json.loads(key_plain.read_text()))
                key_current = fresh == sealed
            empty = tmp / "empty" / "workdir"
            empty.mkdir(parents=True)
            out = {"empty": _check(task_dir, empty, key_plain, tmp / "check-empty.json")}
            out["reference"] = (_check(task_dir, ref / "workdir", key_plain, tmp / "check-reference.json")
                                if reference_ran and key_current and stage_ok else None)
            naive = run_naive(task_dir, stage, tmp, cap_sec) if stage_ok else None
            out["naive"] = _check(task_dir, naive, key_plain, tmp / "check-naive.json") if naive else None
    inp = {"empty": STATUS_OF[None if out["empty"] is None else out["empty"]["passed"]],
           "reference": STATUS_OF[None if out["reference"] is None else out["reference"]["passed"]],
           "permuted": [STATUS_OF[None if out["naive"] is None else out["naive"]["passed"]]]}
    verdict = evaluate(inp)
    notes = []
    if not stage_ok:
        notes.append("staged manifest does not match the card's datasetManifestHash")
    if not reference_ran:
        notes.append("reference.py failed or produced no reference results")
    if not key_current:
        notes.append("sealed key differs from the key the reference regenerates (stale key)")
    record = {
        "schema": SCHEMA, "task": card["id"], "status": verdict["status"], "reasons": verdict["reasons"] + notes,
        "calibrationInput": inp,
        "outcomes": {k: _summary(v) for k, v in out.items()},
        "mapping": {"empty": "empty", "reference": "reference", "naive": "permuted"},
        "bindings": bindings(task_dir, card),
        "environment": {"python": platform.python_version(), "numpy": _numpy_version(),
                        "pixi_lock_sha256": staging.sha256_file(BASELINE / "pixi.lock")},
    }
    if notes and record["status"] == "valid":
        record["status"] = "refused-inconclusive"
    if write:
        (task_dir / "calibration.json").write_text(json.dumps(record, indent=2, sort_keys=True) + "\n")
    return record


def _numpy_version() -> str | None:
    try:
        import numpy
        return numpy.__version__
    except ImportError:
        return None
