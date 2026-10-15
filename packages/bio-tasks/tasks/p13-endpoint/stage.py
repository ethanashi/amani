#!/usr/bin/env python3
"""Stage p13-endpoint: a synthetic 24-week randomised placebo-controlled phase 2b trial in type 2
diabetes, with its registered protocol.

    stage.py --out DIR [--truth-out FILE]

Deterministic from the card seed (numpy PCG64): same seed, same bytes. Writes DIR/data/protocol.md,
DIR/data/participants.tsv, DIR/data/outcomes.tsv, DIR/TASK.md and DIR/manifest.json. Generator truth
is written only when --truth-out is given, and only inside the grading root (never into DIR).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "lib"))

import numpy as np  # noqa: E402

from biotasks import staging  # noqa: E402

ARMS = ("ZT-0412 study-dose", "placebo")
REGIONS = {"Europe": ["DE-01", "DE-02", "PL-01", "PL-03", "ES-02", "HU-01", "CZ-01"],
           "North America": ["US-03", "US-07", "US-11", "US-14", "CA-02"],
           "Asia-Pacific": ["KR-01", "KR-04", "JP-02", "TW-01", "AU-01"]}
REGION_P = (0.45, 0.31, 0.24)
N_RANDOMISED = 322
# Efficacy measures: (stem, baseline generator, change model, decimals). Every true treatment effect
# is zero; only the placebo/trial response and regression to the mean move the values.
STEMS = ("hba1c", "fpg", "weight", "sbp", "ldl", "tg", "hscrp")

PROTOCOL = """# Protocol ZT-0412-202, version 1.0 (registered)

Registered in the sponsor's public trial registry on 2024-03-18, before the first participant was
enrolled (2024-04-29). No amendment changed the endpoints or the analysis plan.

## Title

A 24-week, randomised, double-blind, placebo-controlled, parallel-group phase 2b trial of ZT-0412
study-dose once daily added to metformin in adults with type 2 diabetes.

## Objectives

Primary: to compare the effect of ZT-0412 study-dose with placebo on glycaemic control after 24 weeks.

Secondary: to compare the effects of ZT-0412 study-dose and placebo on fasting glycaemia, body weight,
blood pressure, lipids and low-grade inflammation after 24 weeks.

## Population

Adults aged 30 to 75 years with type 2 diabetes for at least 6 months, on a stable metformin dose
(at least 1000 mg/day) for at least 12 weeks, HbA1c 7.5% to 10.5% at screening, and eGFR at least
45 mL/min/1.73 m2.

## Randomisation and blinding

Participants are randomised 1:1 to ZT-0412 study-dose or matching placebo in permuted blocks,
stratified by screening HbA1c (8.5% or lower vs above 8.5%) and region (Europe, North America,
Asia-Pacific). Participants, investigators and the sponsor's study team are blinded until database
lock.

## Endpoints

Primary endpoint

- Change from baseline to week 24 in HbA1c (%).

Key secondary endpoints, in this order

1. Change from baseline to week 24 in fasting plasma glucose (mmol/L).
2. Change from baseline to week 24 in body weight (kg).
3. Change from baseline to week 24 in systolic blood pressure (mmHg).

Other secondary endpoints

- Change from baseline to week 24 in LDL cholesterol (mmol/L).
- Change from baseline to week 24 in fasting triglycerides (mmol/L).
- Ratio to baseline at week 24 of high-sensitivity C-reactive protein (analysed on the log scale).
- Proportion of participants with HbA1c below 7.0% at week 24.

Safety endpoints (adverse events, hypoglycaemia, laboratory safety) are reported separately.

## Sample size

A difference of 0.4 percentage points in the change in HbA1c (SD 1.0) is considered clinically
relevant. With 133 participants per group the trial has 90% power to detect it with a two-sided
test at alpha = 0.05; 160 participants per group allow for up to 15% without a week-24 value.

## Statistical analysis

Analysis set: all randomised participants who received at least one dose of study drug (modified
intention-to-treat).

Primary analysis: analysis of covariance (ANCOVA) of the change from baseline at week 24, with
treatment and the two stratification factors (screening HbA1c category, region) as factors and the
baseline value as a covariate, in participants with a week-24 value. The treatment effect is the
least-squares mean difference (ZT-0412 minus placebo) with its 95% confidence interval, tested
two-sided at alpha = 0.05.

Key secondary endpoints are analysed with the same model, each with its own baseline value. To
control the type I error rate they are tested in the fixed sequence listed above, each at two-sided
alpha = 0.05, and only if the primary endpoint and every preceding key secondary endpoint are
statistically significant.

Other secondary endpoints are analysed with the same model (log scale for hs-CRP; logistic
regression for the HbA1c < 7.0% responder endpoint). Their p-values are nominal and are not
adjusted for multiplicity.

Sensitivity analyses: multiple imputation of missing week-24 values under missing at random; the
per-protocol set.
"""


def fmt(v: float, d: int) -> str:
    return f"{v:.{d}f}"


def generate(seed: int):
    rng = np.random.default_rng(seed)
    n = N_RANDOMISED
    regions = list(REGIONS)
    region = rng.choice(3, n, p=REGION_P)
    site = [REGIONS[regions[r]][rng.integers(len(REGIONS[regions[r]]))] for r in region]

    # Baseline characteristics.
    age = np.clip(np.round(rng.normal(58.0, 9.0, n)), 30, 75).astype(int)
    female = rng.random(n) < 0.42
    duration = np.clip(rng.gamma(2.2, 3.4, n), 0.6, 35.0)
    metformin = rng.choice([1000, 1500, 2000, 2550], n, p=[0.18, 0.30, 0.42, 0.10])
    egfr = np.clip(np.round(rng.normal(86.0, 15.0, n)), 45, 125).astype(int)
    screen = np.clip(rng.normal(8.45, 0.72, n), 7.5, 10.5)
    stratum = np.where(screen > 8.5, ">8.5", "<=8.5")

    # Stratified permuted blocks of 4 within stratum x region (the order of entry is random).
    arm = np.empty(n, dtype=int)
    for s in ("<=8.5", ">8.5"):
        for r in range(3):
            idx = np.where((stratum == s) & (region == r))[0]
            rng.shuffle(idx)
            blocks = np.concatenate([rng.permutation([0, 0, 1, 1]) for _ in range(len(idx) // 4 + 1)])
            arm[idx] = blocks[: len(idx)]

    bl = {}
    bl["hba1c"] = np.clip(screen + rng.normal(0.0, 0.22, n), 6.9, 11.2)
    bl["fpg"] = np.clip(1.35 * bl["hba1c"] - 2.1 + rng.normal(0.0, 1.25, n), 5.2, 17.5)
    bl["weight"] = np.clip(rng.normal(87.0, 15.5, n) - 9.0 * female, 52.0, 150.0)
    bl["sbp"] = np.clip(rng.normal(133.0, 13.5, n) + 0.12 * (age - 58), 102, 178)
    bl["ldl"] = np.clip(rng.normal(2.65, 0.78, n), 0.9, 5.4)
    bl["tg"] = np.clip(np.exp(rng.normal(np.log(1.85), 0.45, n)), 0.5, 7.5)
    bl["hscrp"] = np.clip(np.exp(rng.normal(np.log(2.6), 0.9, n)), 0.2, 28.0)

    # Week-24 changes: trial/placebo response, regression to the mean and correlated noise.
    cov = np.eye(7)
    for (i, j), r in {(0, 1): 0.5, (2, 3): 0.2, (4, 5): 0.2, (2, 6): 0.1, (2, 5): 0.15}.items():
        cov[i, j] = cov[j, i] = r
    z = rng.standard_normal((n, 7)) @ np.linalg.cholesky(cov).T
    w24 = {}
    w24["hba1c"] = bl["hba1c"] - 0.32 - 0.30 * (bl["hba1c"] - 8.45) + 0.84 * z[:, 0]
    w24["fpg"] = bl["fpg"] - 0.35 - 0.30 * (bl["fpg"] - 9.3) + 1.55 * z[:, 1]
    w24["weight"] = bl["weight"] - 0.55 + 3.1 * z[:, 2]
    w24["sbp"] = bl["sbp"] - 1.6 - 0.25 * (bl["sbp"] - 133.0) + 10.5 * z[:, 3]
    w24["ldl"] = bl["ldl"] - 0.04 - 0.20 * (bl["ldl"] - 2.65) + 0.52 * z[:, 4]
    w24["tg"] = bl["tg"] * np.exp(-0.03 - 0.20 * (np.log(bl["tg"]) - np.log(1.85)) + 0.30 * z[:, 5])
    w24["hscrp"] = bl["hscrp"] * np.exp(-0.05 - 0.30 * (np.log(bl["hscrp"]) - np.log(2.6)) + 0.62 * z[:, 6])

    # Never dosed (4), discontinued before week 24 (about 7%), sporadic missing week-24 samples.
    treated = np.ones(n, dtype=bool)
    treated[rng.choice(n, 4, replace=False)] = False
    no_w24 = (rng.random(n) < 0.07) | ~treated
    sporadic = rng.random((n, 7)) < 0.012

    decimals = {"hba1c": 1, "fpg": 1, "weight": 1, "sbp": 0, "ldl": 2, "tg": 2, "hscrp": 1}
    ids = []
    serial = {}
    order = rng.permutation(n)
    rows_p, rows_o = [], []
    for k in order:
        serial[site[k]] = serial.get(site[k], 100) + int(rng.integers(1, 4))
        pid = f"{site[k]}-{serial[site[k]]:03d}"
        ids.append(pid)
        rows_p.append([pid, site[k], regions[region[k]], ARMS[arm[k]], stratum[k], "yes" if treated[k] else "no",
                       str(age[k]), "F" if female[k] else "M", fmt(duration[k], 1), str(metformin[k]), str(egfr[k])])
        o = [pid]
        for j, s in enumerate(STEMS):
            d = decimals[s]
            o.append(fmt(bl[s][k], d))
            o.append("NA" if no_w24[k] or sporadic[k, j] else fmt(w24[s][k], d))
        rows_o.append(o)
    truth = {"task": "p13-endpoint", "seed": seed, "true_effects": {s: 0.0 for s in STEMS},
             "never_dosed": [ids[list(order).index(k)] for k in np.where(~treated)[0]]}
    return rows_p, rows_o, truth


P_HEADER = ["participant_id", "site", "region", "arm", "stratum_hba1c", "treated", "age", "sex",
            "diabetes_years", "metformin_mg_day", "egfr"]
O_HEADER = ["participant_id"] + [f"{s}_{v}" for s in STEMS for v in ("bl", "w24")]


def main() -> int:
    a = staging.stage_args()
    card = json.loads((HERE / "card.json").read_text())
    data = staging.prepare_out(a.out)
    truth_out = staging.guard_truth(a.truth_out, a.out)
    rows_p, rows_o, truth = generate(card["seed"])
    (data / "protocol.md").write_text(PROTOCOL, encoding="utf-8", newline="\n")
    staging.write_tsv(data / "participants.tsv", P_HEADER, rows_p)
    staging.write_tsv(data / "outcomes.tsv", O_HEADER, rows_o)
    staging.write_truth(truth_out, truth)
    staging.finalize(a.out, HERE, card["id"], card["seed"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
