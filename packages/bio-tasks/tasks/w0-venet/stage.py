#!/usr/bin/env python3
"""Stage w0-venet: the Block 0 warm-up (Venet et al. 2011 re-test in METABRIC), wrapped as a task.

    stage.py --out DIR [--truth-out FILE]

Copies the four arm-facing METABRIC tables from the local dataset store (default
~/.omerta-bio/datasets/metabric/arm, override with BIO_W0_ARM_DATA) after verifying them against
bio-baseline's committed manifest (data/metabric.manifest.json, role "arm"), plus the warm-up's
TASK.md (byte-identical copy of packages/bio-baseline/task/TASK.md). Deterministic: the bytes are
fixed by the manifest. The answer key is the pre-existing sealed warm-up answer; no generator truth.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "lib"))

from biotasks import staging  # noqa: E402
from biotasks.paths import BASELINE, use_baseline  # noqa: E402

use_baseline()
import grade  # noqa: E402  (bio-baseline grading/grade.py: verify_data)

FILES = ("clinical_attributes.tsv", "clinical_patient.tsv", "clinical_sample.tsv", "expression_mrna.tsv")


def main() -> int:
    a = staging.stage_args()
    card = json.loads((HERE / "card.json").read_text())
    src = Path(os.environ.get("BIO_W0_ARM_DATA", str(Path.home() / ".omerta-bio/datasets/metabric/arm")))
    problems = grade.verify_data(src, BASELINE / "data" / "metabric.manifest.json")
    if problems:
        raise SystemExit("warm-up arm data failed the bio-baseline manifest: " + "; ".join(problems))
    if (BASELINE / "task" / "TASK.md").read_bytes() != (HERE / "TASK.md").read_bytes():
        raise SystemExit("w0-venet TASK.md is not byte-identical to the warm-up TASK.md")
    data = staging.prepare_out(a.out)
    truth_out = staging.guard_truth(a.truth_out, a.out)
    for name in FILES:
        if subprocess.run(["cp", "-c", str(src / name), str(data / name)], capture_output=True).returncode != 0:
            subprocess.run(["cp", str(src / name), str(data / name)], check=True)
    staging.write_truth(truth_out, {"task": "w0-venet", "key": "pre-existing sealed warm-up answer"})
    staging.finalize(a.out, HERE, card["id"], card["seed"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
