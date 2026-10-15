#!/usr/bin/env python3
"""Arm D for p10b-pseudorep-hidden: p10's reference analysis, with the line structure taken from
generator truth (the staged sample sheet has no line column).

    reference.py --data STAGED_DIR --truth TRUTH.json --out KEYDIR

Reuses p10-pseudorep/reference.py (log CPM, per-line means, t-test on line means, mixed model,
Benjamini-Hochberg). Extra design guards check that the hidden structure is discoverable from the
expression data alone (correlation clustering recovers the four lines; sex-chromosome genes split
each condition 3/3) and that no line or donor column was staged. Writes KEYDIR/key.json (sealed by
`biotasks seal`) and KEYDIR/workdir/. KEYDIR must be inside the grading root. Guards fail by name only.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "lib"))

import numpy as np  # noqa: E402
from scipy import stats  # noqa: E402
from scipy.cluster.hierarchy import fcluster, linkage  # noqa: E402

from biotasks.paths import require_under_grading_root  # noqa: E402

_spec = importlib.util.spec_from_file_location("p10_reference", HERE.parent / "p10-pseudorep" / "reference.py")
p10 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(p10)

TASK = "p10b-pseudorep-hidden"
TARGET = "DLG4"
UNIT_ACCEPT = p10.UNIT_ACCEPT + r"|\bclusters?\b"
UNIT_REJECT = p10.UNIT_REJECT
r10 = p10.r10


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True, type=Path)
    ap.add_argument("--truth", required=True, type=Path)
    ap.add_argument("--out", required=True, type=Path)
    a = ap.parse_args()
    require_under_grading_root(a.out, "reference output")
    require_under_grading_root(a.truth, "generator truth")
    truth = json.loads(a.truth.read_text())
    samples, genes, counts = p10.load(a.data)
    head = (a.data / "data" / "samples.tsv").read_text().splitlines()[0].split("\t")
    line_of = {s["sample_id"]: s["line_id"] for s in truth["samples"]}
    guards = {"no_line_or_donor_column": not any(h in head for h in ("line_id", "donor_sex", "donor", "line")),
              "truth_covers_samples": sorted(line_of) == sorted(s["sample_id"] for s in samples) and len(samples) == 12}
    for s in samples:
        s["line_id"] = line_of.get(s["sample_id"], "?")
    lc = p10.log_cpm(counts)
    y = lc[genes.index(TARGET)]
    est, ci, p_line, n_units, n_d, n_c = p10.line_level(y, samples)
    dis = np.array([s["condition"] == "disease" for s in samples])
    p_welch = float(stats.ttest_ind(y[dis], y[~dis], equal_var=False).pvalue)
    p_student12 = float(stats.ttest_ind(y[dis], y[~dis]).pvalue)
    p_mixed = p10.mixed_p(y, samples)
    expressed = lc.mean(axis=1) > 1.0
    lines = sorted({s["line_id"] for s in samples})
    lm = np.stack([lc[:, [i for i, s in enumerate(samples) if s["line_id"] == ln]].mean(axis=1) for ln in lines], 1)
    ldis = np.array([next(s["condition"] for s in samples if s["line_id"] == ln) == "disease" for ln in lines])
    p_gl = stats.ttest_ind(lm[expressed][:, ldis], lm[expressed][:, ~ldis], axis=1).pvalue
    p_gs = stats.ttest_ind(lc[expressed][:, dis], lc[expressed][:, ~dis], axis=1, equal_var=False).pvalue
    n_line_fdr = int((p10.bh(p_gl) < 0.05).sum())
    n_naive_fdr = int((p10.bh(p_gs) < 0.05).sum())
    # Discoverability from expression alone: average-linkage clustering on 1 - Pearson correlation of
    # the 1,000 most variable expressed genes, and the sex-chromosome genes within each condition.
    var = lc[expressed].var(axis=1)
    top = lc[expressed][np.argsort(-var)[:1000]]
    corr = np.corrcoef(top.T)
    iu = np.triu_indices(12, 1)
    clusters = fcluster(linkage(1 - corr[iu], method="average"), 4, criterion="maxclust")
    true_lines = [s["line_id"] for s in samples]
    recovered = all((clusters[i] == clusters[j]) == (true_lines[i] == true_lines[j]) for i, j in zip(*iu))
    xist = lc[genes.index("XIST")] > 3
    sex_split = all(sorted([int(xist[g].sum()), int((~xist[g]).sum())]) == [3, 3] for g in (dis, ~dis))
    guards.update({
        "naive_12_sample_tests_significant": p_welch < 0.02 and p_student12 < 0.02,
        "line_level_test_not_significant": p_line > 0.10,
        "mixed_model_not_significant": bool(np.isfinite(p_mixed)) and p_mixed > 0.08,
        "line_level_n_is_four": n_units == 4 and n_d == 2 and n_c == 2,
        "reduction_direction": est < 0 and ci[0] < 0 < ci[1],
        "naive_genome_wide_inflated": n_naive_fdr > 10 * max(n_line_fdr, 1),
        "lines_recovered_by_expression_clustering": recovered,
        "sex_genes_split_each_condition": sex_split,
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
        "flaws": {"F1": "hidden pseudo-replication: 12 libraries are 4 iPSC lines x 3 differentiations, recorded nowhere "
                        "in the sample sheet; the structure is visible only in the expression profiles; n = 4 lines"},
        "reference": {"method": "log2 CPM; per-line mean (lines from generator truth); t-test on line means (df 2)",
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
                    "statement": "DLG4 is lower in disease cultures, but the 12 libraries come from 4 lines (inferred from "
                                 "expression) and the reduction is not established at line level",
                    "status": "insufficient-evidence", "estimate": r10(est), "ci": [r10(ci[0]), r10(ci[1])],
                    "n_units": 4, "unit": "iPSC line (inferred from expression; differentiations averaged)"}],
        "dlg4": {"log2_fold_change": r10(est), "ci95": [r10(ci[0]), r10(ci[1])], "p_value": r10(p_line),
                 "test": "t-test on per-line means", "n_disease": n_d, "n_control": n_c},
        "genome_wide": {"n_genes_tested": int(expressed.sum()), "n_genes_fdr_0_05": n_line_fdr,
                        "method": "per-line mean log2 CPM, t-test, Benjamini-Hochberg"},
        "start_rescue_experiment": False,
        "extra": {},
    }
    (work / "results.json").write_text(json.dumps(results, indent=2) + "\n")
    (work / "REPORT.md").write_text(
        "# Reference analysis (arm D)\n\nSample correlations and sex-chromosome genes show that the 12 libraries "
        "form 4 groups of 3 (one per iPSC line). The analysis averages within line and compares 2 vs 2 lines; the "
        "DLG4 reduction is not established.\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
