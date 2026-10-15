#!/usr/bin/env python3
"""Calibration for the IAD tasks (iad1-brady-audit, iad2-brady-twin, iad3-browning-count).

    calibrate_iad.py TASK [--no-write]

bio-tasks' calibrate.calibrate() records empty -> empty, reference -> reference and one naive answer ->
permuted. The IAD tasks list several naive answers and every one must fail, so this wrapper reuses
calibrate.calibrate() for the staging, reference, empty and binding checks and then evaluates every naive
control faithfully:
- `naive/` (the primary slot) and each `naive/variants/<name>/` are run the way an attempt is graded: an
  emulated arm run in grading-root scratch on freshly staged, manifest-verified data (this produces the
  outputs/ files the checker reads, e.g. comparator score files), then grade.py's sandboxed re-run (reused, not
  forked) must reproduce its results.json exactly, then check.py against the sealed key. The standard
  calibrate.run_naive keeps only the re-run's results.json, without outputs/, which would make a naive fail for
  the wrong reason; its outcome is replaced by the faithful one.
- iad2-brady-twin also submits iad1-brady-audit's reference answer verbatim ("recall": what an agent that
  remembered the real study's audit would hand in). It is generated in grading-root scratch at calibration
  time and never committed (it is iad1's answer key in plaintext).
Every control goes into calibrationInput.permuted, so calibrateTask semantics require each to fail. The record
keeps the standard shape (outcomes hold outcome/score/verdicts only, no answers), lists the controls in
`naiveControls`, and is bound to the same artifacts (variants live inside naive/, covered by the naiveTree
binding; this script is pinned through each task's bindings.json). `python -m biotasks calibrate` alone would
record only the primary naive; test_iad_tasks refuses such a record.
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "lib"))

from biotasks import calibrate, sealing, staging  # noqa: E402
from biotasks.card import key_path, load_card  # noqa: E402
from biotasks.paths import BASELINE, TASKS, use_baseline  # noqa: E402

use_baseline()
import armlib  # noqa: E402
import grade  # noqa: E402
import operation  # noqa: E402

RECALL_FROM = {"iad2-brady-twin": ["iad1-brady-audit"]}


def controls_of(task_dir: Path) -> list[str]:
    v = Path(task_dir) / "naive" / "variants"
    return ["naive"] + ([f"naive/variants/{p.name}" for p in sorted(v.iterdir()) if p.is_dir()] if v.is_dir() else [])


def emulate_attempt(src: Path, stage: Path, attempt: Path, cap_sec: int) -> Path | None:
    """Arm run (scratch, scrubbed env) then grade.rerun reproduction; returns the workdir or None."""
    work = attempt / "workdir"
    shutil.copytree(src, work, ignore=shutil.ignore_patterns("__pycache__", "*.pyc", "variants"))
    shutil.copytree(stage / "data", work / "data")
    armlib.env_sh(BASELINE / "pixi.toml", work / "env.sh")
    home = attempt / "home"
    home.mkdir()
    env = {"HOME": str(home), "TMPDIR": str(home), "PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "LANG": "C.UTF-8"}
    try:
        r = subprocess.run(["bash", "run_all.sh"], cwd=work, env=env, capture_output=True, timeout=cap_sec)
    except subprocess.TimeoutExpired:
        return None
    if r.returncode != 0 or not (work / "results.json").is_file():
        return None
    st = grade.rerun(attempt, stage / "data", cap_sec, attempt / "rerun")
    rerun_res = attempt / "rerun" / "results.json"
    if not grade.successful_rerun(st) or not rerun_res.is_file():
        return None
    if json.loads(rerun_res.read_text()) != json.loads((work / "results.json").read_text()):
        return None
    return work


def recall_answer(sibling: str, tmp: Path) -> Path | None:
    sd = TASKS / sibling
    stage, truth, ref = tmp / f"{sibling}-stage", tmp / f"{sibling}-truth.json", tmp / f"{sibling}-ref"
    staging.run_stage(sd, stage, truth)
    r = subprocess.run([sys.executable, str(sd / "reference.py"), "--data", str(stage), "--truth", str(truth),
                        "--out", str(ref)], capture_output=True, text=True)
    return ref / "workdir" if r.returncode == 0 and (ref / "workdir" / "results.json").is_file() else None


def calibrate_task(task_dir: Path, write: bool = True, cap_sec: int = 900) -> dict:
    task_dir = Path(task_dir)
    card = load_card(task_dir)
    names = controls_of(task_dir) + [f"recall:{s}" for s in RECALL_FROM.get(card["id"], [])]
    with operation.lease():
        rec = calibrate.calibrate(task_dir, cap_sec=cap_sec, write=False)
        base_reasons = calibrate.evaluate(rec["calibrationInput"])["reasons"]
        notes = [r for r in rec["reasons"] if r not in base_reasons]
        results: dict[str, dict | None] = {}
        with sealing.scratch("biotasks-cal-iad.") as tmp:
            stage = tmp / "stage"
            mhash = staging.run_stage(task_dir, stage)
            stage_ok = mhash == card["datasetManifestHash"] and not staging.verify(stage, card["datasetManifestHash"])
            if not stage_ok:
                notes.append("staged manifest does not match the card's datasetManifestHash")
            with sealing.opened(key_path(card)) as key_plain:
                for i, name in enumerate(names):
                    if name.startswith("recall:"):
                        work = recall_answer(name.split(":", 1)[1], tmp)
                    else:
                        work = emulate_attempt(task_dir / name, stage, tmp / f"control-{i}", cap_sec) if stage_ok else None
                    results[name] = calibrate._check(task_dir, work, key_plain, tmp / f"check-control-{i}.json") if work else None
    status_of = lambda r: calibrate.STATUS_OF[None if r is None else r["passed"]]
    rec["calibrationInput"]["permuted"] = [status_of(results[n]) for n in names]
    rec["outcomes"] = {"empty": rec["outcomes"]["empty"], "reference": rec["outcomes"]["reference"],
                       **{n: calibrate._summary(results[n]) for n in names}}
    rec["naiveControls"] = names
    rec["naiveExecution"] = ("emulated arm run in grading-root scratch, reproduced exactly by grade.py's sandboxed re-run, "
                             "then check.py; recall controls check a sibling task's reference answer")
    verdict = calibrate.evaluate(rec["calibrationInput"])
    rec["status"] = verdict["status"] if not notes or verdict["status"] != "valid" else "refused-inconclusive"
    rec["reasons"] = verdict["reasons"] + notes
    if write:
        (task_dir / "calibration.json").write_text(json.dumps(rec, indent=2, sort_keys=True) + "\n")
    return rec


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("task")
    ap.add_argument("--no-write", action="store_true")
    a = ap.parse_args()
    rec = calibrate_task(TASKS / a.task, write=not a.no_write)
    print(f"{a.task}: {rec['status']} {json.dumps(rec['calibrationInput'], sort_keys=True)}"
          + (f" reasons={rec['reasons']}" if rec["reasons"] else ""))
    return 0 if rec["status"] == "valid" else 1


if __name__ == "__main__":
    sys.exit(main())
