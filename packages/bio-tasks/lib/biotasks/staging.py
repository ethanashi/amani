"""Deterministic staging: every task's `stage.py --out DIR` writes DIR/data/<flat files>, copies the
task's TASK.md to DIR/TASK.md and writes DIR/manifest.json (sha256 + size per file).

The manifest format and its verification live in bio-baseline's `armlib` (stdlib only) so that the
arm runner verifies exactly what this library writes. Generator truth, when a caller asks for it,
may only be written beneath the grading root and never inside the staged directory.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path

from .paths import require_under_grading_root, use_baseline

use_baseline()
import armlib  # noqa: E402  (bio-baseline/arms/lib)


def sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def sha256_file(p: Path) -> str:
    return armlib.sha256_file(Path(p))


def stage_args(argv: list[str] | None = None) -> argparse.Namespace:
    ap = argparse.ArgumentParser(description="Stage the arm-facing task directory.")
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--truth-out", type=Path, default=None,
                    help="write generator truth here (must be inside the grading root)")
    a = ap.parse_args(argv)
    return a


def prepare_out(out: Path) -> Path:
    """`out` must be absent or an empty directory; returns out/data (created)."""
    out = Path(out)
    if out.exists() and (not out.is_dir() or any(out.iterdir())):
        raise SystemExit(f"refusing to stage into a non-empty path: {out}")
    (out / "data").mkdir(parents=True, exist_ok=True)
    return out / "data"


def guard_truth(truth_out: Path | None, out: Path) -> Path | None:
    if truth_out is None:
        return None
    require_under_grading_root(truth_out, "generator truth")
    if Path(truth_out).resolve().is_relative_to(Path(out).resolve()):
        raise SystemExit("refusing: generator truth may not be written inside the staged directory")
    return Path(truth_out)


def write_truth(truth_out: Path | None, truth: dict) -> None:
    if truth_out is not None:
        truth_out.parent.mkdir(parents=True, exist_ok=True)
        truth_out.write_text(json.dumps(truth, indent=2, sort_keys=True) + "\n")


def write_tsv(path: Path, header: list[str], rows) -> None:
    """Byte-deterministic TSV: '\\n' line endings, UTF-8, values already formatted as strings."""
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write("\t".join(header) + "\n")
        for r in rows:
            fh.write("\t".join(r) + "\n")


def finalize(out: Path, task_dir: Path, task_id: str, seed: int) -> str:
    """Copy TASK.md and write manifest.json; returns the manifest sha256 (datasetManifestHash)."""
    shutil.copyfile(Path(task_dir) / "TASK.md", Path(out) / "TASK.md")
    return armlib.task_manifest_write(Path(out), task_id, seed)


def verify(stage: Path, expected_sha: str) -> list[str]:
    return armlib.task_manifest_problems(Path(stage), expected_sha)


def manifest_sha(stage: Path) -> str:
    return sha256_file(Path(stage) / "manifest.json")


def run_stage(task_dir: Path, out: Path, truth_out: Path | None = None) -> str:
    """Run the task's stage.py in a child process; returns the staged manifest sha256."""
    cmd = [sys.executable, str(Path(task_dir) / "stage.py"), "--out", str(out)]
    if truth_out is not None:
        cmd += ["--truth-out", str(truth_out)]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit(f"stage.py failed for {Path(task_dir).name} (exit {r.returncode}): {r.stderr[-800:]}")
    return manifest_sha(out)
