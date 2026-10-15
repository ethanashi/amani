#!/usr/bin/env python3
"""Arm D for p10-pseudorep: the scripted, version-pinned reference analysis (positive control).

    reference.py --data STAGED_DIR --truth TRUTH.json --out KEYDIR

Writes KEYDIR/key.json (the answer key, sealed by `biotasks seal`) and KEYDIR/workdir/ (the
reference answer used by calibration). KEYDIR must be inside the grading root. Design guards make
the run fail (naming the guard, never a value) if the realised data do not have the intended
properties; stdout/stderr never carry key values.
"""
from __future__ import annotations

import argparse
import json
import sys
import warnings
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "lib"))

import numpy as np  # noqa: E402
from scipy import stats  # noqa: E402

from biotasks.paths import require_under_grading_root  # noqa: E402

TASK = "p10-pseudorep"
TARGET = "DLG4"
UNIT_ACCEPT = r"\b(?:i?psc[- ]?)?(?:cell[- ]?)?lines?\b|\bdonors?\b|\bindividuals?\b|\bpatients?\b|\bpersons?\b|\bpeople\b|\bparticipants?\b|\bsubjects?\b"
UNIT_REJECT = r"sample|librar|culture|differentiation|replicate|well|batch|round|observation"


def r10(x: float) -> float:
    return float(f"{x:.10g}")


def load(stage: Path):
    lines = (stage / "data" / "samples.tsv").read_text().splitlines()
    head = lines[0].split("\t")
    samples = [dict(zip(head, ln.split("\t"))) for ln in lines[1:]]
    rows = (stage / "data" / "counts.tsv").read_text().splitlines()
    sids = rows[0].split("\t")[1:]
    genes, mat = [], []
    for ln in rows[1:]:
        f = ln.split("\t")
        genes.append(f[0])
        mat.append([int(v) for v in f[1:]])
    by_id = {s["sample_id"]: s for s in samples}
    return [by_id[s] for s in sids], genes, np.array(mat, dtype=float)


def log_cpm(counts: np.ndarray) -> np.ndarray:
    lib = counts.sum(axis=0)
    return np.log2((counts + 0.5) / (lib[None, :] + 1.0) * 1e6)


def bh(p: np.ndarray) -> np.ndarray:
    n = len(p)
    o = np.argsort(p)
    q = p[o] * n / np.arange(1, n + 1)
    q = np.minimum.accumulate(q[::-1])[::-1]
    out = np.empty(n)
    out[o] = np.minimum(q, 1.0)
    return out


def line_level(y: np.ndarray, samples: list[dict]):
    lines = sorted({s["line_id"] for s in samples})
    means = {ln: float(np.mean([y[i] for i, s in enumerate(samples) if s["line_id"] == ln])) for ln in lines}
    cond = {s["line_id"]: s["condition"] for s in samples}
    d = np.array([means[ln] for ln in lines if cond[ln] == "disease"])
    c = np.array([means[ln] for ln in lines if cond[ln] == "control"])
    diff = d.mean() - c.mean()
    sp2 = ((len(d) - 1) * d.var(ddof=1) + (len(c) - 1) * c.var(ddof=1)) / (len(d) + len(c) - 2)
    se = np.sqrt(sp2 * (1 / len(d) + 1 / len(c)))
    df = len(d) + len(c) - 2
    t = diff / se
    p = 2 * stats.t.sf(abs(t), df)
    half = stats.t.ppf(0.975, df) * se
    return diff, (diff - half, diff + half), p, len(d) + len(c), len(d), len(c)


def mixed_p(y: np.ndarray, samples: list[dict]) -> float:
    import pandas as pd
    import statsmodels.formula.api as smf
    df = pd.DataFrame({"y": y, "disease": [1.0 if s["condition"] == "disease" else 0.0 for s in samples],
                       "line": [s["line_id"] for s in samples]})
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        fit = smf.mixedlm("y ~ disease", df, groups=df["line"]).fit(reml=True)
    return float(fit.pvalues["disease"])


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True, type=Path)
    ap.add_argument("--truth", required=True, type=Path)
    ap.add_argument("--out", required=True, type=Path)
    a = ap.parse_args()
    require_under_grading_root(a.out, "reference output")
    require_under_grading_root(a.truth, "generator truth")
    truth = json.loads(a.truth.read_text())
    samples, genes, counts = load(a.data)
    # Guard: the sample sheet carries exactly the generator's line structure.
    want = {s["sample_id"]: s["line_id"] for s in truth["samples"]}
    guards = {"sample_sheet_matches_truth": all(want.get(s["sample_id"]) == s["line_id"] for s in samples)
              and len(want) == len(samples) == 12}
    lc = log_cpm(counts)
    y = lc[genes.index(TARGET)]
    est, ci, p_line, n_units, n_d, n_c = line_level(y, samples)
    dis = np.array([s["condition"] == "disease" for s in samples])
    p_welch = float(stats.ttest_ind(y[dis], y[~dis], equal_var=False).pvalue)
    p_student12 = float(stats.ttest_ind(y[dis], y[~dis]).pvalue)
    p_mixed = mixed_p(y, samples)
    # Genome-wide, expressed genes: line-level tests vs sample-level tests.
    expressed = lc.mean(axis=1) > 1.0
    lines = sorted({s["line_id"] for s in samples})
    lm = np.stack([lc[:, [i for i, s in enumerate(samples) if s["line_id"] == ln]].mean(axis=1) for ln in lines], 1)
    ldis = np.array([next(s["condition"] for s in samples if s["line_id"] == ln) == "disease" for ln in lines])
    p_gl = stats.ttest_ind(lm[expressed][:, ldis], lm[expressed][:, ~ldis], axis=1).pvalue
    p_gs = stats.ttest_ind(lc[expressed][:, dis], lc[expressed][:, ~dis], axis=1, equal_var=False).pvalue
    n_line_fdr = int((bh(p_gl) < 0.05).sum())
    n_naive_fdr = int((bh(p_gs) < 0.05).sum())
    guards.update({
        "naive_12_sample_tests_significant": p_welch < 0.02 and p_student12 < 0.02,
        "line_level_test_not_significant": p_line > 0.10,
        "mixed_model_not_significant": bool(np.isfinite(p_mixed)) and p_mixed > 0.08,
        "line_level_n_is_four": n_units == 4 and n_d == 2 and n_c == 2,
        "reduction_direction": est < 0 and ci[0] < 0 < ci[1],
        "naive_genome_wide_inflated": n_naive_fdr > 10 * max(n_line_fdr, 1),
    })
    failed = sorted(k for k, ok in guards.items() if not ok)
    if failed:
        print("design guard failed: " + ", ".join(failed), file=sys.stderr)
        return 3
    key = {
        "schema": "bio-tasks/key@1", "task": TASK, "main_claim": "dlg4_effect",
        "status_allowed": ["insufficient-evidence", "tentative"],
        "unit_accept": UNIT_ACCEPT, "unit_reject": UNIT_REJECT,
        "n_units": 4, "estimate": r10(est), "tolerance": {"absolute": 0.25, "relative": 0},
        "flaws": {"F1": "pseudo-replication: 12 libraries are 4 iPSC lines (one donor each) x 3 differentiations; "
                        "the independent unit is the line (n = 4, 2 vs 2), at which the DLG4 effect is not significant"},
        "reference": {"method": "log2 CPM; per-line mean of the 3 differentiations; two-sample t-test on line means (df 2)",
                      "ci95": [r10(ci[0]), r10(ci[1])], "p_line": r10(p_line), "p_naive_welch": r10(p_welch),
                      "p_naive_student": r10(p_student12), "p_mixed_reml_wald": r10(p_mixed),
                      "genome_wide_fdr05_line": n_line_fdr, "genome_wide_fdr05_naive": n_naive_fdr,
                      "genes_tested": int(expressed.sum())},
    }
    a.out.mkdir(parents=True, exist_ok=True)
    (a.out / "key.json").write_text(json.dumps(key, indent=2, sort_keys=True) + "\n")
    work = a.out / "workdir"
    work.mkdir(exist_ok=True)
    results = {
        "claims": [{"id": "dlg4_effect",
                    "statement": "DLG4 is lower in disease lines, but with 2 lines per condition the reduction is not established",
                    "status": "insufficient-evidence", "estimate": r10(est), "ci": [r10(ci[0]), r10(ci[1])],
                    "n_units": 4, "unit": "iPSC line (one donor each; differentiations averaged within line)"}],
        "dlg4": {"log2_fold_change": r10(est), "ci95": [r10(ci[0]), r10(ci[1])], "p_value": r10(p_line),
                 "test": "t-test on per-line means", "n_disease": n_d, "n_control": n_c},
        "genome_wide": {"n_genes_tested": int(expressed.sum()), "n_genes_fdr_0_05": n_line_fdr,
                        "method": "per-line mean log2 CPM, t-test, Benjamini-Hochberg"},
        "start_rescue_experiment": False,
        "extra": {},
    }
    (work / "results.json").write_text(json.dumps(results, indent=2) + "\n")
    (work / "REPORT.md").write_text(
        "# Reference analysis (arm D)\n\nThe 12 libraries come from 4 iPSC lines (2 disease, 2 control), each "
        "differentiated 3 times. Differentiations of one line are not independent, so the analysis averages "
        "them within line and compares 2 vs 2 lines. The DLG4 estimate, interval and test are in results.json; "
        "the reduction is not established with 4 lines, so the rescue experiment is not supported by this dataset.\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
