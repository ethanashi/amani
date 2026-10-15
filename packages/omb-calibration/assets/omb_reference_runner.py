"""V3 generic reference runner (calibration only; identical bytes for every task).

Runs main() of code/omb/reference/reference_truthfree.py (the task's reference.py with every
truth-dependent top-level statement of main() removed at build time by the host tool
omb_truthfree.py) on the staged data in the current directory. Grading-root assertions are
identity stubs (code/omb/stubs/biotasks). main() writes into a private temporary --out directory;
only workdir/results.json is copied to ./results.json, and key.json and everything else are
deleted with the directory. No dynamic execution: the reference is imported statically.

Usage (cwd = deliverable root with ./data): python code/omb/omb_reference_runner.py
Exit codes: 0 ok; 3 reference refused (design guard or SystemExit); 4 needs truth (no results).
"""
from __future__ import annotations

import os
import shutil
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path[0:0] = [str(HERE / "reference"), str(HERE / "stubs")]
os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")
os.environ.setdefault("OMP_NUM_THREADS", "1")

import reference_truthfree as reference  # noqa: E402


def run(stage: Path, results_out: Path) -> int:
    out = Path(tempfile.mkdtemp(prefix="omb-ref-"))
    try:
        argv = sys.argv
        sys.argv = ["reference.py", "--data", str(stage), "--truth", str(out / "absent-truth.json"), "--out", str(out / "keydir")]
        try:
            rc = reference.main()
        except SystemExit as e:  # design guard or refusal inside the reference
            print(f"reference refused: {e}", file=sys.stderr)
            return 3
        finally:
            sys.argv = argv
        produced = out / "keydir" / "workdir" / "results.json"
        if rc not in (0, None):
            print(f"reference refused (rc={rc})", file=sys.stderr)
            return 3
        if not produced.is_file():
            print("reference produced no results (its results depend on generator truth)", file=sys.stderr)
            return 4
        shutil.copyfile(produced, results_out)
        return 0
    finally:
        shutil.rmtree(out, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(run(Path.cwd(), Path.cwd() / "results.json"))
