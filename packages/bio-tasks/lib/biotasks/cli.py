"""bio-tasks command line (run with the bio-baseline pixi python, PYTHONPATH=packages/bio-tasks/lib).

  python -m biotasks validate [TASK ...]           strict card validation
  python -m biotasks stage TASK --out DIR          deterministic arm-facing staging
  python -m biotasks verify-stage TASK DIR         refuse unless DIR matches the card's manifest hash
  python -m biotasks seal TASK                     stage, pin the manifest hash in card.json, run
                                                   reference.py and seal its key (plaintext deleted)
  python -m biotasks calibrate TASK                empty / reference / naive -> calibration.json
  python -m biotasks preflight TASK                print "<manifest sha256> <cap seconds>" if the task is
                                                   valid and calibrated against its current artifacts
  python -m biotasks grade TASK ATTEMPT_DIR ...    sandboxed re-run + check.py, sealed records

Nothing here prints answer-key content: outputs are hashes, statuses, verdict ids and scores.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

from .card import CardError, key_path, load_card, write_card
from .paths import TASKS, task_dir


def cmd_validate(ids: list[str]) -> int:
    rc = 0
    for tid in ids or sorted(p.name for p in TASKS.iterdir() if (p / "card.json").is_file()):
        try:
            load_card(task_dir(tid))
            print(f"ok      {tid}")
        except CardError as e:
            print(f"INVALID {tid}: {e}")
            rc = 1
    return rc


def cmd_stage(tid: str, out: Path) -> int:
    from . import staging
    print(staging.run_stage(task_dir(tid), out))
    return 0


def cmd_verify(tid: str, stage: Path) -> int:
    from . import staging
    card = load_card(task_dir(tid))
    problems = staging.verify(stage, card["datasetManifestHash"])
    for p in problems:
        print(f"refusing {tid}: {p}", file=sys.stderr)
    return 1 if problems else 0


def cmd_seal(tid: str) -> int:
    from . import sealing, staging
    td = task_dir(tid)
    card = load_card(td, require_key=False)
    with sealing.scratch("biotasks-seal-run.") as tmp:
        stage, truth, ref = tmp / "stage", tmp / "truth.json", tmp / "ref"
        mhash = staging.run_stage(td, stage, truth)
        if staging.run_stage(td, tmp / "stage2") != mhash:
            raise SystemExit(f"{tid}: staging is not deterministic; refusing to pin a manifest hash")
        card["datasetManifestHash"] = mhash
        write_card(td, card)
        r = subprocess.run([sys.executable, str(td / "reference.py"), "--data", str(stage), "--truth", str(truth),
                            "--out", str(ref)], capture_output=True, text=True)
        if r.returncode != 0:
            # reference stderr carries only design-guard names, never values
            raise SystemExit(f"{tid}: reference.py failed (exit {r.returncode}): {r.stderr[-600:]}")
        if (ref / "key.json").is_file():
            dest = key_path(card)
            if not dest.resolve().is_relative_to(td.resolve()):
                raise SystemExit(f"{tid}: refusing to overwrite a key outside the task directory")
            sealing.seal_json(json.loads((ref / "key.json").read_text()), dest)
            print(f"sealed  {dest.relative_to(td.parents[3])}")
    print(f"pinned  {tid} datasetManifestHash={mhash}")
    return 0


def cmd_calibrate(tid: str) -> int:
    from . import calibrate
    rec = calibrate.calibrate(task_dir(tid))
    print(f"{tid}: {rec['status']} {json.dumps(rec['calibrationInput'], sort_keys=True)}"
          + (f" reasons={rec['reasons']}" if rec["reasons"] else ""))
    return 0 if rec["status"] == "valid" else 1


def cmd_preflight(tid: str) -> int:
    from . import calibrate
    td = task_dir(tid)
    try:
        card = load_card(td)
    except CardError as e:
        print(f"refusing {tid}: invalid card: {e}", file=sys.stderr)
        return 3
    problems = calibrate.check_record(td, card)
    if problems:
        print(f"refusing {tid}: " + "; ".join(problems), file=sys.stderr)
        return 3
    print(card["datasetManifestHash"], card["capMinutes"] * 60)
    return 0


def cmd_grade(tid: str, attempts: list[Path], cap_sec: int) -> int:
    if tid == "p16-recovery":
        # One p16 implementation for every entry point: a not-exercised attempt is excluded and
        # must be rerun (null scores), never graded as a recovery or science failure.
        from .recovery_grade import grade_p16
        return grade_p16(attempts, cap_sec)
    from . import grading
    rows = grading.grade_attempts(task_dir(tid), attempts, cap_sec)
    rc = 0
    for s in rows:
        items = " ".join(f"{i['id']}={i['verdict']}" for i in s["check"].get("items", [])) or "check-error"
        print(f"{s['attempt']}: credited={s['credited']} task_passed={s['task_passed']} "
              f"score={s['check'].get('score')} {items}")
        if not s["credited"]:
            print(f"  not credited: {'; '.join(s['not_credited_reasons'])}")
        if s["rerun"].get("ran") and not s["rerun"].get("tmp_deleted"):
            rc = 3
    return rc


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="biotasks")
    sub = ap.add_subparsers(dest="cmd", required=True)
    v = sub.add_parser("validate"); v.add_argument("ids", nargs="*")
    s = sub.add_parser("stage"); s.add_argument("task"); s.add_argument("--out", required=True, type=Path)
    vs = sub.add_parser("verify-stage"); vs.add_argument("task"); vs.add_argument("dir", type=Path)
    for name in ("seal", "calibrate", "preflight"):
        sub.add_parser(name).add_argument("task")
    g = sub.add_parser("grade"); g.add_argument("task"); g.add_argument("attempts", nargs="+", type=Path)
    g.add_argument("--rerun-cap-sec", type=int, default=3600)
    a = ap.parse_args(argv)
    if a.cmd == "validate":
        return cmd_validate(a.ids)
    if a.cmd == "stage":
        return cmd_stage(a.task, a.out)
    if a.cmd == "verify-stage":
        return cmd_verify(a.task, a.dir)
    if a.cmd == "seal":
        return cmd_seal(a.task)
    if a.cmd == "calibrate":
        return cmd_calibrate(a.task)
    if a.cmd == "preflight":
        return cmd_preflight(a.task)
    return cmd_grade(a.task, a.attempts, a.rerun_cap_sec)
