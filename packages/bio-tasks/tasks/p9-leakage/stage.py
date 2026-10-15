#!/usr/bin/env python3
"""Stage p9-leakage: synthetic targeted single-cell RNA-seq of PBMCs (20 people, 40-gene panel).

    stage.py --out DIR [--truth-out FILE]

Deterministic from the card seed (numpy PCG64): same seed, same bytes. Writes DIR/data/cells.tsv,
DIR/data/expression.tsv, DIR/data/donors.tsv, DIR/TASK.md and DIR/manifest.json. Generator truth is
written only when --truth-out is given, and only inside the grading root (never into DIR).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "lib"))

import numpy as np  # noqa: E402

from biotasks import staging  # noqa: E402

ISG = ["IFI27", "IFI44L", "ISG15", "MX1", "RSAD2", "IFI6", "OAS1", "SIGLEC1"]
MARKERS = ["CD14", "LYZ", "S100A8", "S100A9", "FCGR3A", "MS4A7", "CD3E", "CD3D", "IL7R", "CCR7",
           "CD8A", "CD8B", "GZMB", "GNLY", "NKG7", "MS4A1", "CD79A", "CD79B"]
HLA = ["HLA-DRA", "HLA-DRB1", "HLA-DQA1", "HLA-DQB1"]
SEX = ["XIST", "RPS4Y1", "DDX3Y"]
OTHER = ["ACTB", "B2M", "MALAT1", "RPL13", "RPS27", "FTL", "TMSB4X"]
GENES = ISG + MARKERS + HLA + SEX + OTHER                      # 40
TYPES = ["CD14 Mono", "CD16 Mono", "CD4 T", "CD8 T", "NK", "B"]
BASE_COMP = np.array([0.24, 0.06, 0.34, 0.13, 0.10, 0.13])
HIGH = {"CD14 Mono": {"CD14": 2.6, "LYZ": 3.6, "S100A8": 3.4, "S100A9": 3.6, "HLA-DRA": 2.2, "FTL": 3.0},
        "CD16 Mono": {"FCGR3A": 2.4, "MS4A7": 2.2, "LYZ": 2.6, "HLA-DRA": 2.4, "FTL": 3.0},
        "CD4 T": {"CD3E": 2.0, "CD3D": 2.1, "IL7R": 2.0, "CCR7": 1.6},
        "CD8 T": {"CD3E": 2.0, "CD3D": 2.0, "CD8A": 2.1, "CD8B": 1.9, "GZMB": 0.8, "NKG7": 1.4},
        "NK": {"GNLY": 3.2, "NKG7": 3.0, "GZMB": 2.4, "FCGR3A": 1.4},
        "B": {"MS4A1": 2.2, "CD79A": 2.6, "CD79B": 2.0, "HLA-DRA": 2.8, "HLA-DQA1": 1.4}}
ISG_TYPE_SCALE = {"CD14 Mono": 1.3, "CD16 Mono": 1.3, "CD4 T": 0.8, "CD8 T": 0.8, "NK": 0.9, "B": 1.0}
DONOR_SCALE = 0.75           # person-to-person offset scale (identity signal)
ISG_SHIFT = (0.50, 0.20)     # interferon score of SLE patients: mean, sd (healthy: 0.05, 0.10)


def generate(seed: int):
    rng = np.random.default_rng(seed)
    G, T = len(GENES), len(TYPES)
    gi = {g: i for i, g in enumerate(GENES)}
    type_mu = rng.uniform(0.05, 0.6, (T, G))
    for t, name in enumerate(TYPES):
        for g, v in HIGH[name].items():
            type_mu[t, gi[g]] = v
        for g, v in {"ACTB": 3.2, "B2M": 3.8, "MALAT1": 4.2, "RPL13": 3.4, "RPS27": 3.6, "TMSB4X": 3.9}.items():
            type_mu[t, gi[g]] = v + rng.normal(0, 0.15)
        for g in ISG:
            type_mu[t, gi[g]] = rng.uniform(0.15, 0.7)
    # People: 10 SLE and 10 healthy, sex balanced across groups (7 female, 3 male each).
    status = np.array(["SLE"] * 10 + ["healthy"] * 10)
    sex = np.array((["F"] * 7 + ["M"] * 3) * 2)
    order = rng.permutation(20)
    status, sex = status[order], sex[order]
    age = np.where(status == "SLE", rng.integers(22, 58, 20), rng.integers(22, 60, 20))
    donor_ids = [f"P{k:03d}" for k in sorted(rng.choice(np.arange(101, 999), 20, replace=False))]
    # Strong person-identity signal (genetic background, sample handling); weak disease signal.
    donor_sd = rng.uniform(0.5, 1.0, G) * DONOR_SCALE
    for g in HLA:
        donor_sd[gi[g]] = 1.1
    for g in SEX:
        donor_sd[gi[g]] = 0.2
    isg_load = rng.uniform(0.6, 1.2, len(ISG))
    cells, expr = [], []
    donors = []
    for d in range(20):
        comp = rng.dirichlet(BASE_COMP * 40)
        n = int(rng.integers(160, 421))
        types = rng.choice(T, n, p=comp)
        offset = rng.normal(0.0, donor_sd)
        s_isg = max(rng.normal(*ISG_SHIFT), 0.0) if status[d] == "SLE" else max(rng.normal(0.05, 0.10), 0.0)
        mu = type_mu[types] + offset
        for j, g in enumerate(ISG):
            mu[:, gi[g]] += s_isg * isg_load[j] * np.array([ISG_TYPE_SCALE[TYPES[t]] for t in types])
        mu[:, gi["XIST"]] = (2.4 if sex[d] == "F" else 0.0) + offset[gi["XIST"]]
        for g in ("RPS4Y1", "DDX3Y"):
            mu[:, gi[g]] = (2.0 if sex[d] == "M" else 0.0) + offset[gi[g]]
        mu = np.clip(mu, 0.0, None)
        x = mu + rng.normal(0.0, 0.5, mu.shape)
        dropout = rng.random(mu.shape) < np.exp(-1.3 * mu)
        x = np.where(dropout, 0.0, np.clip(x, 0.0, None))
        umi = np.round(np.exp(rng.normal(np.log(2600), 0.35, n))).astype(int)
        detected = (x > 0).sum(axis=1)
        for k in range(n):
            bc = "".join(rng.choice(list("ACGT"), 16))
            cells.append([f"{donor_ids[d]}_{bc}", donor_ids[d], TYPES[types[k]], str(umi[k]), str(int(detected[k]))])
            expr.append(x[k])
        donors.append([donor_ids[d], status[d], str(int(age[d])), sex[d]])
    # Cells are listed in processing order: shuffled within the run, not grouped by person.
    perm = rng.permutation(len(cells))
    cells = [cells[i] for i in perm]
    expr = np.array(expr)[perm]
    truth = {"task": "p9-leakage", "seed": seed,
             "donors": [{"donor_id": r[0], "status": r[1]} for r in donors]}
    return cells, expr, sorted(donors), truth


def main() -> int:
    a = staging.stage_args()
    card = json.loads((HERE / "card.json").read_text())
    data = staging.prepare_out(a.out)
    truth_out = staging.guard_truth(a.truth_out, a.out)
    cells, expr, donors, truth = generate(card["seed"])
    staging.write_tsv(data / "cells.tsv", ["cell_id", "donor_id", "cell_type", "n_umi", "n_genes_detected"], cells)
    staging.write_tsv(data / "expression.tsv", ["cell_id"] + GENES,
                      ([c[0]] + [("0" if v == 0 else f"{v:.3f}") for v in row] for c, row in zip(cells, expr)))
    staging.write_tsv(data / "donors.tsv", ["donor_id", "status", "age", "sex"], donors)
    staging.write_truth(truth_out, truth)
    staging.finalize(a.out, HERE, card["id"], card["seed"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
