#!/usr/bin/env python3
"""Stage p7-nosignal: a synthetic keloid case-control genotype dataset for 40 common variants in the
SMAD3 gene region (300 cases, 300 controls). Genotypes are independent of case status.

    stage.py --out DIR [--truth-out FILE]

Deterministic from the card seed (numpy PCG64): same seed, same bytes. Writes DIR/data/samples.tsv,
DIR/data/variants.tsv, DIR/data/genotypes.tsv, DIR/TASK.md and DIR/manifest.json. Generator truth is
written only when --truth-out is given, and only inside the grading root (never into DIR).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "lib"))

import numpy as np  # noqa: E402
from scipy.stats import norm  # noqa: E402

from biotasks import staging  # noqa: E402

N_CASES, N_CONTROLS, N_VARIANTS = 300, 300, 40
CHROM, START, END = "15", 67060000, 67200000
REPORTED = "15:67131402:C:T"          # the variant from the earlier report (alt allele T)
REPORTED_MAF = 0.28
LD_SCALE_BP = 12000.0
BASES = "ACGT"


def variants(rng: np.random.Generator) -> list[dict]:
    pos = np.sort(rng.choice(np.arange(START, END), N_VARIANTS - 1, replace=False))
    rep_pos = int(REPORTED.split(":")[1])
    pos = np.sort(np.append(pos[np.abs(pos - rep_pos) > 500], rep_pos))[:N_VARIANTS]
    while len(pos) < N_VARIANTS:
        extra = int(rng.integers(START, END))
        if extra not in pos:
            pos = np.sort(np.append(pos, extra))
    out = []
    for p in pos:
        if int(p) == rep_pos:
            out.append({"pos": rep_pos, "ref": "C", "alt": "T", "maf": REPORTED_MAF})
            continue
        ref = BASES[rng.integers(4)]
        alt = rng.choice([b for b in BASES if b != ref])
        out.append({"pos": int(p), "ref": ref, "alt": str(alt), "maf": float(rng.uniform(0.06, 0.45))})
    for v in out:
        v["id"] = f"{CHROM}:{v['pos']}:{v['ref']}:{v['alt']}"
    return out


def generate(seed: int):
    rng = np.random.default_rng(seed)
    vs = variants(rng)
    pos = np.array([v["pos"] for v in vs], dtype=float)
    cov = np.exp(-np.abs(pos[:, None] - pos[None, :]) / LD_SCALE_BP)
    chol = np.linalg.cholesky(cov + 1e-9 * np.eye(len(vs)))
    thr = norm.ppf([v["maf"] for v in vs])
    n = N_CASES + N_CONTROLS
    hap = lambda: ((rng.standard_normal((n, len(vs))) @ chol.T) < thr).astype(int)
    geno = hap() + hap()                          # independent of case status: no true association
    status = np.array(["case"] * N_CASES + ["control"] * N_CONTROLS)
    order = rng.permutation(n)
    geno, status = geno[order], status[order]
    sex = np.where(rng.random(n) < np.where(status == "case", 0.56, 0.52), "F", "M")
    age = np.clip(np.round(rng.normal(np.where(status == "case", 34, 37), 11)), 18, 75).astype(int)
    pcs = rng.normal(0.0, 0.012, (n, 3))
    batch = np.where(rng.random(n) < 0.5, "B1", "B2")
    missing = rng.random(geno.shape) < 0.006
    ids = [f"KS{100000 + int(i):06d}" for i in rng.choice(900000, n, replace=False)]
    samples = [[ids[i], status[i], sex[i], str(age[i])] + [f"{x:.5f}" for x in pcs[i]] + [batch[i]] for i in range(n)]
    geno_rows = [[ids[i]] + ["NA" if missing[i, j] else str(int(geno[i, j])) for j in range(len(vs))] for i in range(n)]
    variant_rows = [[v["id"], CHROM, str(v["pos"]), v["ref"], v["alt"]] for v in vs]
    truth = {"task": "p7-nosignal", "seed": seed, "true_effects": "none (genotypes independent of status)",
             "reported_variant": REPORTED, "variants": [v["id"] for v in vs]}
    return samples, variant_rows, geno_rows, [v["id"] for v in vs], truth


def main() -> int:
    a = staging.stage_args()
    card = json.loads((HERE / "card.json").read_text())
    data = staging.prepare_out(a.out)
    truth_out = staging.guard_truth(a.truth_out, a.out)
    samples, variant_rows, geno_rows, vids, truth = generate(card["seed"])
    staging.write_tsv(data / "samples.tsv", ["sample_id", "status", "sex", "age", "pc1", "pc2", "pc3", "batch"], samples)
    staging.write_tsv(data / "variants.tsv", ["variant_id", "chrom", "pos", "ref", "alt"], variant_rows)
    staging.write_tsv(data / "genotypes.tsv", ["sample_id"] + vids, geno_rows)
    staging.write_truth(truth_out, truth)
    staging.finalize(a.out, HERE, card["id"], card["seed"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
