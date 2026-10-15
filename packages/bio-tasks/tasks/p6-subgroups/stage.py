#!/usr/bin/env python3
"""Stage p6-subgroups: a synthetic 12-week randomised placebo-controlled phase 2 trial in knee
osteoarthritis pain with many baseline characteristics (no true treatment effect for anyone).

    stage.py --out DIR [--truth-out FILE]

Deterministic from the card seed (numpy PCG64): same seed, same bytes. Writes
DIR/data/participants.tsv, DIR/data/subgroups.tsv, DIR/TASK.md and DIR/manifest.json. Generator
truth is written only when --truth-out is given, and only inside the grading root (never into DIR).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "lib"))

import numpy as np  # noqa: E402

from biotasks import staging  # noqa: E402

N = 480
ARMS = ("NT-6602 50 mg", "placebo")
REGIONS = {"Europe": ["PL-02", "PL-05", "HU-01", "DE-04", "ES-03", "CZ-02"],
           "North America": ["US-02", "US-06", "US-09", "US-12", "US-15"],
           "Latin America": ["MX-01", "MX-03", "AR-02"],
           "Asia-Pacific": ["KR-02", "KR-03", "AU-01", "TW-02"]}
REGION_P = (0.35, 0.30, 0.15, 0.20)
SUBGROUPS = [
    ("age", "age", "years: < 65 vs >= 65"),
    ("sex", "sex", "F vs M"),
    ("bmi", "bmi", "kg/m2: < 30 vs >= 30"),
    ("kl_grade", "kl_grade", "Kellgren-Lawrence grade of the index knee: 2 vs 3 vs 4"),
    ("baseline_pain", "pain_bl", "baseline pain NRS: < 7 vs >= 7"),
    ("region", "region", "Europe vs North America vs Latin America vs Asia-Pacific"),
    ("prior_nsaid", "prior_nsaid", "NSAID use in the 3 months before screening: yes vs no"),
    ("diabetes", "diabetes", "type 2 diabetes: yes vs no"),
    ("bilateral", "bilateral", "symptomatic osteoarthritis in both knees: yes vs no"),
    ("smoking", "smoking", "never vs former vs current"),
    ("egfr", "egfr", "mL/min/1.73 m2: < 60 vs >= 60"),
    ("symptom_duration", "symptom_years", "years since knee symptoms began: < 5 vs >= 5"),
]
HEADER = ["participant_id", "site", "region", "arm", "age", "sex", "bmi", "kl_grade", "symptom_years",
          "prior_nsaid", "diabetes", "bilateral", "smoking", "egfr", "pain_bl", "pain_w12", "discontinued"]


def generate(seed: int):
    rng = np.random.default_rng(seed)
    regions = list(REGIONS)
    region = rng.choice(4, N, p=REGION_P)
    site = [REGIONS[regions[r]][rng.integers(len(REGIONS[regions[r]]))] for r in region]
    arm = np.empty(N, dtype=int)
    for r in range(4):
        idx = np.where(region == r)[0]
        rng.shuffle(idx)
        blocks = np.concatenate([rng.permutation([0, 0, 1, 1]) for _ in range(len(idx) // 4 + 1)])
        arm[idx] = blocks[: len(idx)]
    age = np.clip(np.round(rng.normal(63.0, 8.5, N)), 40, 85).astype(int)
    female = rng.random(N) < 0.64
    bmi = np.clip(rng.normal(30.4, 5.0, N), 19.0, 48.0)
    kl = rng.choice([2, 3, 4], N, p=[0.35, 0.45, 0.20])
    years = np.clip(rng.gamma(2.0, 3.6, N), 0.5, 40.0)
    nsaid = rng.random(N) < 0.70
    diabetes = rng.random(N) < np.clip(0.08 + 0.012 * (bmi - 25), 0.03, 0.45)
    bilateral = rng.random(N) < 0.55
    smoking = rng.choice(["never", "former", "current"], N, p=[0.55, 0.33, 0.12])
    egfr = np.clip(np.round(rng.normal(80.0, 16.0, N) - 0.4 * (age - 63)), 30, 125).astype(int)
    pain_bl = np.clip(rng.normal(6.6, 1.0, N), 4.0, 10.0)
    # Week-12 change: placebo response, regression to the mean, mild structural severity effect.
    # No treatment effect in any participant.
    change = -1.7 - 0.38 * (pain_bl - 6.6) + 0.10 * (kl - 3) + rng.normal(0.0, 1.85, N)
    pain_w12 = np.clip(pain_bl + change, 0.0, 10.0)
    discontinued = rng.random(N) < 0.06

    serial: dict[str, int] = {}
    rows, ids = [], []
    for k in rng.permutation(N):
        serial[site[k]] = serial.get(site[k], 1000) + int(rng.integers(1, 4))
        pid = f"{site[k]}-{serial[site[k]]}"
        ids.append(pid)
        rows.append([pid, site[k], regions[region[k]], ARMS[arm[k]], str(age[k]), "F" if female[k] else "M",
                     f"{bmi[k]:.1f}", str(kl[k]), f"{years[k]:.1f}", "yes" if nsaid[k] else "no",
                     "yes" if diabetes[k] else "no", "yes" if bilateral[k] else "no", smoking[k], str(egfr[k]),
                     f"{pain_bl[k]:.1f}", "NA" if discontinued[k] else f"{pain_w12[k]:.1f}",
                     "yes" if discontinued[k] else "no"])
    truth = {"task": "p6-subgroups", "seed": seed, "true_effect": 0.0, "n": N}
    return rows, truth


def main() -> int:
    a = staging.stage_args()
    card = json.loads((HERE / "card.json").read_text())
    data = staging.prepare_out(a.out)
    truth_out = staging.guard_truth(a.truth_out, a.out)
    rows, truth = generate(card["seed"])
    staging.write_tsv(data / "participants.tsv", HEADER, rows)
    staging.write_tsv(data / "subgroups.tsv", ["factor", "column", "levels"], ([f, c, d] for f, c, d in SUBGROUPS))
    staging.write_truth(truth_out, truth)
    staging.finalize(a.out, HERE, card["id"], card["seed"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
