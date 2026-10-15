#!/usr/bin/env python3
"""Stage p8-underpowered: synthetic Seahorse mitochondrial stress-test data from primary myotubes of
4 donors with type 2 diabetes and 5 normoglycaemic donors (two assay plates, several wells each).

    stage.py --out DIR [--truth-out FILE]

Deterministic from the card seed (numpy PCG64): same seed, same bytes. Writes DIR/data/donors.tsv,
DIR/data/wells.tsv, DIR/TASK.md and DIR/manifest.json. Generator truth is written only when
--truth-out is given, and only inside the grading root (never into DIR).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "lib"))

import numpy as np  # noqa: E402

from biotasks import staging  # noqa: E402

PLATES = [("XF-2025-117", "2025-06-03"), ("XF-2025-124", "2025-06-17")]
DONOR_IDS = ["HSMM-03", "HSMM-05", "HSMM-08", "HSMM-11", "HSMM-12", "HSMM-14", "HSMM-17", "HSMM-19", "HSMM-22"]
WELLS_PER_PLATE = 4
CONTROL_MAX = 21.0          # pmol O2/min/ug protein, control donor mean of maximal respiration
TRUE_RELATIVE_EFFECT = -0.15
DONOR_CV, WELL_CV, PLATE_CV = 0.20, 0.12, 0.05


def generate(seed: int):
    rng = np.random.default_rng(seed)
    groups = ["T2D"] * 4 + ["control"] * 5
    order = rng.permutation(9)
    donors = []
    for k, i in enumerate(order):
        g = groups[i]
        t2d = g == "T2D"
        donors.append({
            "donor_id": DONOR_IDS[k], "group": g, "sex": "F" if rng.random() < 0.45 else "M",
            "age": int(np.clip(round(rng.normal(56 if t2d else 53, 7)), 38, 72)),
            "bmi": float(np.clip(rng.normal(33.5 if t2d else 26.0, 3.0), 20, 44)),
            "hba1c": float(np.clip(rng.normal(7.6 if t2d else 5.3, 0.6 if t2d else 0.2), 4.8, 10.5)),
            "passage": int(rng.integers(4, 7)),
        })
    # Donor-level true maximal respiration (and the other parameters scaled from it).
    for d in donors:
        mean = CONTROL_MAX * (1 + (TRUE_RELATIVE_EFFECT if d["group"] == "T2D" else 0.0))
        d["max"] = mean * float(np.exp(rng.normal(0.0, DONOR_CV)))
        d["basal_frac"] = float(np.clip(rng.normal(0.47, 0.04), 0.35, 0.6))
    plate_eff = np.exp(rng.normal(0.0, PLATE_CV, len(PLATES)))
    rows, layout = [], []
    for p, (plate, date) in enumerate(PLATES):
        # Each donor occupies WELLS_PER_PLATE wells, in a randomised layout over rows B-G, columns 2-11.
        free = [f"{r}{c}" for r in "BCDEFG" for c in range(2, 12)]
        picks = rng.choice(len(free), 9 * WELLS_PER_PLATE, replace=False)
        k = 0
        for d in donors:
            for _ in range(WELLS_PER_PLATE):
                well = free[picks[k]]
                k += 1
                maximal = d["max"] * plate_eff[p] * float(np.exp(rng.normal(0.0, WELL_CV)))
                basal = maximal * d["basal_frac"] * float(np.exp(rng.normal(0.0, 0.06)))
                leak = basal * float(np.clip(rng.normal(0.22, 0.03), 0.12, 0.35))
                nonmito = basal * float(np.clip(rng.normal(0.18, 0.03), 0.08, 0.3))
                protein = float(np.clip(rng.normal(7.4, 0.9), 4.5, 10.5))
                layout.append([plate, date, well, d["donor_id"], protein, basal, maximal, basal - leak, leak, nonmito, "pass"])
    # Wave QC: a few wells failed (no FCCP response, or detached cells with very low basal rate).
    bad = rng.choice(len(layout), 3, replace=False)
    for j, b in enumerate(bad):
        r = layout[b]
        if j % 2 == 0:
            r[6] = r[5] * float(rng.uniform(0.95, 1.15))
            r[10] = "no FCCP response"
        else:
            for c in (5, 6, 7, 8, 9):
                r[c] *= float(rng.uniform(0.25, 0.4))
            r[10] = "low basal OCR"
    layout.sort(key=lambda r: (r[0], r[2][0], int(r[2][1:])))
    for r in layout:
        rows.append([r[0], r[1], r[2], r[3], f"{r[4]:.2f}"] + [f"{v:.2f}" for v in r[5:10]] + [r[10]])
    donor_rows = [[d["donor_id"], d["group"], d["sex"], str(d["age"]), f"{d['bmi']:.1f}", f"{d['hba1c']:.1f}",
                   str(d["passage"])] for d in donors]
    truth = {"task": "p8-underpowered", "seed": seed, "true_relative_effect": TRUE_RELATIVE_EFFECT,
             "groups": {d["donor_id"]: d["group"] for d in donors}}
    return donor_rows, rows, truth


def main() -> int:
    a = staging.stage_args()
    card = json.loads((HERE / "card.json").read_text())
    data = staging.prepare_out(a.out)
    truth_out = staging.guard_truth(a.truth_out, a.out)
    donor_rows, rows, truth = generate(card["seed"])
    staging.write_tsv(data / "donors.tsv", ["donor_id", "group", "sex", "age", "bmi", "hba1c", "passage"], donor_rows)
    staging.write_tsv(data / "wells.tsv", ["plate", "assay_date", "well", "donor_id", "protein_ug", "basal_ocr",
                                           "maximal_ocr", "atp_linked_ocr", "proton_leak_ocr", "nonmito_ocr", "qc_flag"],
                      rows)
    staging.write_truth(truth_out, truth)
    staging.finalize(a.out, HERE, card["id"], card["seed"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
