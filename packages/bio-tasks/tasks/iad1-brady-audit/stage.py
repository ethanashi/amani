#!/usr/bin/env python3
"""Stage iad1-brady-audit: the published leave-one-out PSA-dynamics predictions, de-identified.

    stage.py --out DIR [--truth-out FILE]

Reads only the pinned D1 archive from the private cache (~/.omerta-bio/datasets/iad, verified by SHA-256;
see iad_common.py) and writes DIR/data/{predictions.csv, training_roc.csv, psa_history.csv, README.md},
DIR/TASK.md and DIR/manifest.json. Subjects are renamed S-01..S-70 in HMAC(task id, card seed) order; days
are relative to each subject's first record; the history stops at the start of each subject's last predicted
cycle; rows are ordered by pseudonymous subject, never by source order (which groups resistant patients first).
Deterministic: same seed, same bytes. The original-to-pseudonymous ID map is written only with --truth-out,
inside the grading root.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "lib"))
sys.path.insert(0, str(HERE))

from biotasks import staging  # noqa: E402

import iad_common as ic  # noqa: E402


def main() -> int:
    a = staging.stage_args()
    card = json.loads((HERE / "card.json").read_text())
    truth_out = staging.guard_truth(a.truth_out, a.out)
    z = ic.archive()                      # refuses before anything is written if the cache is absent or altered
    staging.prepare_out(a.out)
    world = ic.base_world(z)
    ids = ic.stage_loo(a.out, card["id"], card["seed"], world, include_roc=True)
    staging.write_truth(truth_out, {"task": card["id"], "seed": card["seed"],
                                    "pseudo_ids": {str(k): v for k, v in sorted(ids.items())}})
    staging.finalize(a.out, HERE, card["id"], card["seed"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
