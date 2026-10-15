"""grade-task: re-run each attempt's run_all.sh with bio-baseline grade.py's sandboxed re-run (reused,
not forked), then the task's check.py against the sealed key.

Per attempt this writes, under <attempt>/grade/:
  rerun/                  grade.py re-run output (status, logs, re-run results.json, outputs listing)
  task-grade.json.enc     the full record incl. checker evidence (sealed: evidence is key-derived)
  task-summary.json       plaintext: verdict ids, score, credit, re-run status -- no key values
Credit is fail-closed: the attempt must be finished, uncontaminated, staged from this task's exact
manifest, with untouched data, all deliverables, and numbers/claims reproduced by the re-run.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

from . import calibrate, sealing, staging
from .card import key_path, load_card
from .paths import use_baseline

use_baseline()
import grade  # noqa: E402

CLAIM_FIELDS = ("statement", "id", "status", "unit", "n_units", "estimate", "ci")


def inputs_match(attempt: Path, stage: Path) -> list[str]:
    """The runner's inputs.sha256 (what the arm actually saw) must list exactly the manifest's
    TASK.md and data files with the same hashes."""
    p = attempt / "inputs.sha256"
    if not p.is_file():
        return ["inputs.sha256 missing"]
    seen = {}
    for line in p.read_text().splitlines():
        parts = line.split("  ")
        if len(parts) == 3:
            seen[parts[2]] = parts[0]
    m = json.loads((stage / "manifest.json").read_text())
    want = {f["path"]: f["sha256"] for f in m["files"]}
    got = {k: v for k, v in seen.items() if k == "TASK.md" or k.startswith("data/")}
    return [] if got == want else ["attempt inputs do not match this task's staged manifest"]


def claims_view(res) -> list | None:
    if not isinstance(res, dict) or not isinstance(res.get("claims"), list):
        return None
    return [{k: c.get(k) for k in CLAIM_FIELDS} if isinstance(c, dict) else c for c in res["claims"]]


def run_check(task_dir: Path, workdir: Path, key_plain: Path, out: Path, rerun_dir: Path | None) -> dict | None:
    cmd = [sys.executable, str(task_dir / "check.py"), "--attempt", str(workdir), "--key", str(key_plain),
           "--out", str(out)]
    if rerun_dir is not None:
        cmd += ["--rerun", str(rerun_dir)]
    # The parent holds the grading lease; the checker reuses it (as bio-baseline's supervisor does).
    r = subprocess.run(cmd, capture_output=True, text=True, env=dict(os.environ, BIO_OPERATION="grading"))
    if r.returncode != 0:
        return None
    try:
        return json.loads(out.read_text())
    except (OSError, ValueError):
        return None


def grade_one(task_dir: Path, card: dict, attempt: Path, stage: Path, key_plain: Path, tmp: Path,
              cap_sec: int) -> dict:
    meta = grade.load_json(attempt / "meta.json") or {}
    work = attempt / "workdir"
    claimed, result_problems = grade.load_results(work / "results.json")
    reasons: list[str] = list(result_problems)
    rec: dict = {"task": card["id"], "attempt": attempt.name,
                 "meta": {k: meta.get(k) for k in ("arm", "attempt", "task_id", "task_manifest_sha256", "status",
                                                   "model", "model_reported", "cli_version", "start", "end",
                                                   "dry_run", "contaminated", "data_modified")}}
    # ---- provenance: the arm saw exactly this task's staged bytes
    staged = inputs_match(attempt, stage)
    if meta.get("task_id") not in (None, card["id"]) or meta.get("task_manifest_sha256") not in (
            None, card["datasetManifestHash"]):
        staged.append("meta names a different task or manifest")
    reasons += staged
    # ---- sandboxed re-run (grade.py), on freshly staged, manifest-verified data
    rerun_dir = attempt / "grade" / "rerun"
    if rerun_dir.exists():                      # never let a previous grading's output stand in for this one
        shutil.rmtree(rerun_dir)
    if (work / "run_all.sh").is_file() and not staged:
        rr = grade.rerun(attempt, stage / "data", cap_sec, rerun_dir)
    else:
        rr = {"ran": False, "reason": "no run_all.sh" if not staged else "inputs mismatch"}
    rerun_dir.mkdir(parents=True, exist_ok=True)
    (rerun_dir / "rerun.json").write_text(json.dumps(rr, indent=2, sort_keys=True) + "\n")
    rec["rerun"] = rr
    rerun_res, rerun_problems = (grade.load_results(rerun_dir / "results.json")
                                 if rr.get("ran") else (None, []))
    reasons += ["re-run: " + p for p in rerun_problems]
    if claimed is None:
        reproduced, why = False, "; ".join(result_problems) or "no parseable results.json"
    elif rerun_res is None:
        reproduced, why = False, "; ".join(rerun_problems) or "re-run produced no results.json"
    else:
        bad, n_cmp = grade.compare_numbers(claimed, rerun_res)
        same_claims = claims_view(claimed) == claims_view(rerun_res)   # both absent is equal (w0 schema)
        reproduced = not bad and same_claims and n_cmp > 0
        why = (f"{len(bad)} numeric mismatch(es)" if bad else
               "claims differ after re-run" if not same_claims else
               "no comparable fields" if n_cmp == 0 else f"{n_cmp} fields and all claims reproduced")
        rec["reproducibility_mismatches"] = bad[:20]
    if not grade.successful_rerun(rr):
        reproduced, why = False, "re-run failed, timed out, or cleanup unavailable"
    rec["reproduced"] = {"ok": reproduced, "why": why}
    # ---- transcript / contamination (same rule as grade.py)
    tr = grade.scan_transcript(attempt / "transcript.jsonl", blank=meta.get("worktmp"))
    flag = str(meta.get("contaminated") or "")
    if tr["web"] or tr["outside_workdir"] or flag.startswith("CONTAMINATED"):
        contamination = "CONTAMINATED"
    elif not tr["available"] or flag in ("", "audit-error", "no-transcript"):
        contamination = "unknown"
    else:
        contamination = "none-found"
    rec["contamination"] = contamination
    # ---- answer-key check (claimed results; the re-run must reproduce them for credit)
    chk = run_check(task_dir, work, key_plain, tmp / f"check-{attempt.name}.json",
                    rerun_dir if rr.get("ran") else None)
    rec["check"] = chk if chk is not None else {"error": "check.py did not run conclusively"}
    deliverables = {n: (work / n).is_file() for n in ("REPORT.md", "results.json", "run_all.sh")}
    rec["deliverables"] = deliverables
    if meta.get("arm") == "omerta" and (meta.get("host_evidence_complete") is not True or
            meta.get("worker_transcript_complete") is not True or meta.get("no_web_check") != "pass"):
        reasons.append("host evidence unavailable or incomplete")
    if meta.get("status") != "finished":
        reasons.append(f"run status {meta.get('status')!r}")
    if contamination != "none-found":
        reasons.append(f"contamination {contamination}")
    if meta.get("data_modified") not in (False, "false"):
        reasons.append(f"data_modified {meta.get('data_modified')!r}")
    if not all(deliverables.values()):
        reasons.append("missing deliverable(s)")
    if not reproduced:
        reasons.append(f"not reproduced: {why}")
    if chk is None:
        reasons.append("check.py did not run conclusively")
    rec["credited"] = not reasons
    rec["not_credited_reasons"] = reasons
    rec["task_passed"] = bool(rec["credited"] and chk and chk.get("passed") is True)
    return rec


def summary(rec: dict) -> dict:
    """Plaintext view without checker evidence (evidence can contain key-derived values)."""
    chk = rec.get("check") or {}
    return {
        "task": rec["task"], "attempt": rec["attempt"], "credited": rec["credited"],
        "task_passed": rec["task_passed"],
        "not_credited_reasons": [r if not r.startswith("not reproduced") else "not reproduced"
                                 for r in rec["not_credited_reasons"]],
        "check": {"score": chk.get("score"), "passed": chk.get("passed"),
                  "items": [{"id": i["id"], "verdict": i["verdict"]} for i in chk.get("items", [])]}
                 if "items" in chk else {"error": True},
        "reproduced": rec["reproduced"]["ok"], "contamination": rec["contamination"],
        "rerun": {k: rec["rerun"].get(k) for k in ("ran", "exit_code", "timed_out", "tmp_deleted", "wall_ms")},
        "meta": {k: rec["meta"].get(k) for k in ("arm", "attempt", "task_id", "status", "dry_run", "model_reported")},
    }


def grade_attempts(task_id_dir: Path, attempts: list[Path], cap_sec: int = 3600) -> list[dict]:
    task_dir = Path(task_id_dir)
    card = load_card(task_dir)
    problems = calibrate.check_record(task_dir, card)
    if problems:
        raise SystemExit(f"refusing to grade {card['id']}: " + "; ".join(problems))
    out = []
    with sealing.scratch("biotasks-grade.") as tmp:
        stage = tmp / "stage"
        mhash = staging.run_stage(task_dir, stage)
        if mhash != card["datasetManifestHash"] or staging.verify(stage, card["datasetManifestHash"]):
            raise SystemExit(f"refusing to grade {card['id']}: fresh staging does not match the card")
        with sealing.opened(key_path(card)) as key_plain:
            for at in attempts:
                attempt = Path(at).resolve()
                rec = grade_one(task_dir, card, attempt, stage, key_plain, tmp, cap_sec)
                gdir = attempt / "grade"
                gdir.mkdir(parents=True, exist_ok=True)
                # Evidence is key-derived: the plaintext record exists only in the grading-root
                # scratch dir; only its ciphertext (+ integrity sidecar) lands next to the attempt.
                full = tmp / f"{attempt.name}.task-grade.json"
                full.write_text(json.dumps(rec, indent=2, sort_keys=True, default=str) + "\n")
                enc = sealing.seal_file(full, tmp)          # full-entropy passphrase (sealing.py)
                shutil.move(str(enc), str(gdir / "task-grade.json.enc"))
                shutil.move(str(enc) + ".sha256", str(gdir / "task-grade.json.enc.sha256"))
                (gdir / "task-summary.json").write_text(json.dumps(summary(rec), indent=2, sort_keys=True) + "\n")
                out.append(summary(rec))
    return out
