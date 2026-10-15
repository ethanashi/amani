#!/usr/bin/env python3
"""Stage iad3-browning-count: the 101 de-identified PSA series of the D1 archive.

    stage.py --out DIR [--truth-out FILE]

Reads only the pinned D1 archive from the private cache (see ../iad1-brady-audit/iad_common.py) and writes
DIR/data/{psa_series.csv, README.md}, DIR/TASK.md and DIR/manifest.json. Subjects are renamed S-001..S-101
in HMAC(task id, card seed) order (unrelated to the other IAD cards' IDs); days are relative to each
subject's first record; PSA and testosterone are the exported tokens, unchanged (blank where not recorded);
trailing all-blank padding rows of the source files are dropped. Deterministic: same seed, same bytes.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "lib"))
sys.path.insert(0, str(HERE.parent / "iad1-brady-audit"))

from biotasks import staging  # noqa: E402

import iad_common as ic  # noqa: E402

README = """# Data dictionary

`psa_series.csv` is UTF-8 CSV with a header row: one row per recorded visit of each patient, in the order
of the source records. Values are as exported by the source files.

| Column | Meaning |
|---|---|
| `subject` | pseudonymous patient identifier |
| `day` | days since the patient's first record |
| `psa` | serum PSA, ug/L (ng/mL); empty if not recorded |
| `testosterone` | serum testosterone, nmol/L; empty if not recorded |
| `cycle` | treatment cycle (1 = first) |
| `on_treatment` | 1 during the treatment period of the cycle, 0 during its pause |
"""


def main() -> int:
    a = staging.stage_args()
    card = json.loads((HERE / "card.json").read_text())
    truth_out = staging.guard_truth(a.truth_out, a.out)
    z = ic.archive()
    data = staging.prepare_out(a.out)
    pids = ic.series_ids(z)
    ids = ic.pseudo_ids(card["id"], card["seed"], pids, 3)
    rows = []
    for pid in sorted(pids, key=lambda p: ids[p]):
        for h in ic.series(z, pid):
            rows.append([ids[pid], str(h["day"]), h["psa"], h["ts"], str(h["cycle"]), str(h["on"])])
    ic.write_csv(data / "psa_series.csv", ic.HIST_HEADER, rows)
    (data / "README.md").write_text(README, encoding="utf-8")
    staging.write_truth(truth_out, {"task": card["id"], "seed": card["seed"],
                                    "pseudo_ids": {str(k): v for k, v in sorted(ids.items())}})
    staging.finalize(a.out, HERE, card["id"], card["seed"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
