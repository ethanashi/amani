#!/usr/bin/env python3
"""Stage p10-pseudorep: synthetic bulk RNA-seq of iPSC-derived cortical neurons (12 libraries).

    stage.py --out DIR [--truth-out FILE]

Deterministic from the card seed (numpy PCG64): same seed, same bytes. Writes DIR/data/counts.tsv,
DIR/data/samples.tsv, DIR/TASK.md and DIR/manifest.json. Generator truth is written only when
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
from biotasks.paths import RESOURCES  # noqa: E402

N_GENES = 11000
TARGET = "DLG4"
LINE_IDS = ["NCRM-2417", "NCRM-3065", "NCRM-5182", "NCRM-7731"]
ROUNDS = [("R1", "2025-02-11"), ("R2", "2025-03-25"), ("R3", "2025-05-06")]
NEURONAL = {"MAP2": 10.0, "TUBB3": 11.0, "STMN2": 11.5, "SNAP25": 10.5, "SYP": 9.5, "RBFOX3": 8.0,
            "GAP43": 11.0, "NEFL": 10.5, "NEFM": 10.0, "SLC17A7": 7.5, "GRIN2B": 7.5, "SYN1": 9.0,
            "CAMK2A": 7.0, "NRXN1": 8.0, "SHANK3": 6.5, "BCL11B": 7.5, "TBR1": 7.0, "SATB2": 6.5}
HOUSEKEEPING = {"GAPDH": 12.0, "ACTB": 12.5, "EEF1A1": 12.5, "RPLP0": 11.5, "TUBA1A": 12.0}
ABSENT = {"ALB": -3.0, "HBB": -2.0, "PTPRC": -2.5, "MYOD1": -3.5, "INS": -4.0, "CD3E": -3.0}
FEMALE_ONLY = {"XIST": 9.0, "TSIX": 3.5}
MALE_ONLY = {"RPS4Y1": 8.0, "DDX3Y": 6.5, "KDM5D": 6.0, "UTY": 5.5, "EIF1AY": 6.5, "ZFY": 4.5}


def gene_list(rng: np.random.Generator) -> list[str]:
    symbols = [ln.strip() for ln in (RESOURCES / "hgnc_symbols.txt").read_text().splitlines()
               if ln.strip() and not ln.startswith("#")]
    fixed = sorted(set(NEURONAL) | set(HOUSEKEEPING) | set(ABSENT) | set(FEMALE_ONLY) | set(MALE_ONLY) |
                   {TARGET, "CHD8"})
    pool = sorted(set(symbols) - set(fixed))
    chosen = rng.choice(len(pool), N_GENES - len(fixed), replace=False)
    return sorted(set(fixed) | {pool[i] for i in chosen})


def generate(seed: int) -> tuple[list[list[str]], list[str], np.ndarray, dict]:
    rng = np.random.default_rng(seed)
    genes = gene_list(rng)
    gi = {g: i for i, g in enumerate(genes)}
    G = len(genes)

    # Lines: two carriers and two controls, one female and one male in each condition.
    roles = [("control", "F"), ("control", "M"), ("disease", "F"), ("disease", "M")]
    order = rng.permutation(4)
    lines = [{"line_id": LINE_IDS[i], "condition": roles[j][0], "sex": roles[j][1]}
             for i, j in zip(range(4), order)]
    # Every differentiation round included all four lines; libraries were numbered afterwards.
    combos = [(li, ri) for ri in range(3) for li in range(4)]
    sample_order = rng.permutation(12)
    samples = [None] * 12
    for k, idx in enumerate(sample_order):
        li, ri = combos[idx]
        samples[k] = {"sample_id": f"S{k + 1:02d}", "line": li, "round": ri}

    # Baseline log2 abundance per gene.
    expressed = rng.random(G) < 0.62
    mu = np.where(expressed, rng.normal(4.6, 2.0, G), rng.normal(-1.2, 1.4, G)).clip(-4.5, 13.0)
    for table in (NEURONAL, HOUSEKEEPING, ABSENT):
        for g, v in table.items():
            mu[gi[g]] = v
    # Per-line genetic background, per-round differentiation batch, per-culture residual.
    line_sd = np.exp(rng.normal(np.log(0.17), 0.55, G)).clip(0.03, 1.2)
    u = rng.normal(0.0, 1.0, (G, 4)) * line_sd[:, None]
    b = rng.normal(0.0, 0.10, (G, 3))
    resid_sd = rng.uniform(0.07, 0.15, G)
    # A modest set of genes with a consistent condition effect, and CHD8 itself reduced (NMD).
    delta = np.zeros(G)
    de = rng.choice(G, 60, replace=False)
    delta[de] = rng.normal(0.0, 0.45, 60)
    delta[gi["CHD8"]] = -0.62
    mu[gi["CHD8"]] = 7.2

    # Target gene: fixed line-level layout (two lines per condition, spread +/- h around the mean).
    t = gi[TARGET]
    mu[t], delta[t], h = 8.6, -0.74, 0.36
    disease_lines = [i for i in range(4) if lines[i]["condition"] == "disease"]
    control_lines = [i for i in range(4) if lines[i]["condition"] == "control"]
    for grp in (disease_lines, control_lines):
        signs = rng.permutation([1.0, -1.0])
        for i, s in zip(grp, signs):
            u[t, i] = s * h
    b[t] = rng.normal(0.0, 0.03, 3)
    resid_sd[t] = 0.06

    x = np.zeros((G, 12))
    for k, s in enumerate(samples):
        li, ri = s["line"], s["round"]
        line = lines[li]
        x[:, k] = (mu + u[:, li] + b[:, ri] + (delta if line["condition"] == "disease" else 0.0)
                   + rng.normal(0.0, 1.0, G) * resid_sd)
        for g, v in FEMALE_ONLY.items():
            x[gi[g], k] = (v if line["sex"] == "F" else -3.5) + rng.normal(0, 0.15)
        for g, v in MALE_ONLY.items():
            x[gi[g], k] = (v if line["sex"] == "M" else -3.5) + rng.normal(0, 0.15)

    # Counts: library size x relative abundance, Poisson-gamma sampling (small technical dispersion).
    lib = rng.uniform(18e6, 34e6, 12)
    p = 2.0 ** x
    p /= p.sum(axis=0, keepdims=True)
    mean = p * lib[None, :]
    phi = 0.004
    lam = rng.gamma(1.0 / phi, phi, mean.shape) * mean
    counts = rng.poisson(lam).astype(np.int64)

    rows = []
    for k, s in enumerate(samples):
        line = lines[s["line"]]
        rname, rdate = ROUNDS[s["round"]]
        rows.append([s["sample_id"], line["condition"], line["line_id"], line["sex"], rname, rdate, "42",
                     f"{rng.uniform(8.1, 9.8):.1f}", "A" if rng.random() < 0.5 else "B",
                     f"L00{1 + int(rng.random() < 0.5)}", f"{int(counts[:, k].sum()) / 1e6:.2f}"])
    truth = {"task": "p10-pseudorep", "seed": seed, "target": TARGET,
             "lines": lines, "samples": [{"sample_id": s["sample_id"], "line_id": lines[s["line"]]["line_id"],
                                          "round": ROUNDS[s["round"]][0]} for s in samples]}
    return rows, genes, counts, truth


HEADER = ["sample_id", "condition", "line_id", "donor_sex", "differentiation_round", "differentiation_start",
          "day_harvested", "rin", "library_batch", "lane", "mapped_reads_millions"]


def main() -> int:
    a = staging.stage_args()
    card = json.loads((HERE / "card.json").read_text())
    data = staging.prepare_out(a.out)
    truth_out = staging.guard_truth(a.truth_out, a.out)
    rows, genes, counts, truth = generate(card["seed"])
    staging.write_tsv(data / "samples.tsv", HEADER, rows)
    sids = [r[0] for r in rows]
    staging.write_tsv(data / "counts.tsv", ["gene"] + sids,
                      ([g] + [str(int(v)) for v in counts[i]] for i, g in enumerate(genes)))
    staging.write_truth(truth_out, truth)
    staging.finalize(a.out, HERE, card["id"], card["seed"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
