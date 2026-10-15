#!/usr/bin/env python3
"""Arm D for p9-leakage: the scripted, version-pinned reference analysis (positive control).

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
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "lib"))

import numpy as np  # noqa: E402
from scipy.stats import rankdata  # noqa: E402

from biotasks.paths import require_under_grading_root  # noqa: E402

TASK = "p9-leakage"
TOLERANCE = {"absolute": 0.08, "relative": 0}
INFLATED_FLOOR = 0.90
AUC_PATTERN = r"\bauc\b|area under|\broc\b"


def r10(x: float) -> float:
    return float(f"{x:.10g}")


def load(stage: Path):
    def tsv(name):
        rows = (stage / "data" / name).read_text().splitlines()
        head = rows[0].split("\t")
        return head, [r.split("\t") for r in rows[1:]]
    _, cells = tsv("cells.tsv")
    ehead, erows = tsv("expression.tsv")
    _, donors = tsv("donors.tsv")
    status = {d[0]: d[1] for d in donors}
    cell_donor = {c[0]: c[1] for c in cells}
    ids = [r[0] for r in erows]
    X = np.array([[float(v) for v in r[1:]] for r in erows])
    D = np.array([cell_donor[i] for i in ids])
    y = np.array([1.0 if status[d] == "SLE" else 0.0 for d in D])
    return X, D, y, ehead[1:], status


def fit(X: np.ndarray, y: np.ndarray, lam: float = 1.0) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Ridge logistic regression (IRLS) on features standardised with training statistics."""
    m, s = X.mean(0), X.std(0)
    s[s == 0] = 1.0
    Z = np.hstack([np.ones((len(X), 1)), (X - m) / s])
    w = np.zeros(Z.shape[1])
    R = lam * np.eye(Z.shape[1])
    R[0, 0] = 0.0
    for _ in range(100):
        p = 1.0 / (1.0 + np.exp(-(Z @ w)))
        step = np.linalg.solve((Z * (p * (1 - p))[:, None]).T @ Z + R, Z.T @ (p - y) + R @ w)
        w -= step
        if np.abs(step).max() < 1e-10:
            break
    return w, m, s


def score(model, X: np.ndarray) -> np.ndarray:
    w, m, s = model
    return np.hstack([np.ones((len(X), 1)), (X - m) / s]) @ w


def auc(y: np.ndarray, s: np.ndarray) -> float:
    r = rankdata(s)
    n1 = y.sum()
    n0 = len(y) - n1
    return float((r[y == 1].sum() - n1 * (n1 + 1) / 2) / (n1 * n0))


def held_out(X, D, y, folds, lam: float = 1.0) -> np.ndarray:
    out = np.zeros(len(y))
    for f in folds:
        test = np.isin(D, f)
        out[test] = score(fit(X[~test], y[~test], lam), X[test])
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True, type=Path)
    ap.add_argument("--truth", required=True, type=Path)
    ap.add_argument("--out", required=True, type=Path)
    a = ap.parse_args()
    require_under_grading_root(a.out, "reference output")
    require_under_grading_root(a.truth, "generator truth")
    truth = json.loads(a.truth.read_text())
    X, D, y, genes, status = load(a.data)
    donors = sorted(status)
    rng = np.random.default_rng(20261010)
    guards = {"donor_labels_match_truth": {d["donor_id"]: d["status"] for d in truth["donors"]} == status}

    # Reference: leave-one-person-out, pooled cell-level AUC; person-level bootstrap CI.
    lopo = held_out(X, D, y, [[d] for d in donors])
    ref = auc(y, lopo)
    idx = {d: np.where(D == d)[0] for d in donors}
    boots = []
    for _ in range(1000):
        pick = rng.choice(donors, len(donors), replace=True)
        sel = np.concatenate([idx[d] for d in pick])
        if 0 < y[sel].sum() < len(sel):
            boots.append(auc(y[sel], lopo[sel]))
    ci = (float(np.percentile(boots, 2.5)), float(np.percentile(boots, 97.5)))

    # Variants an analyst could reasonably choose; all must land near the reference.
    sle = [d for d in donors if status[d] == "SLE"]
    hea = [d for d in donors if status[d] != "SLE"]
    rng.shuffle(sle)
    rng.shuffle(hea)
    five = [sle[i::5] + hea[i::5] for i in range(5)]
    v_five = auc(y, held_out(X, D, y, five))
    nc = np.zeros(len(y))
    for d in donors:
        t = D == d
        c1, c0 = X[~t & (y == 1)].mean(0), X[~t & (y == 0)].mean(0)
        nc[t] = ((X[t] - c0) ** 2).sum(1) - ((X[t] - c1) ** 2).sum(1)
    v_nc = auc(y, nc)
    pb_scores = np.zeros(len(y))
    PB = np.array([X[idx[d]].mean(0) for d in donors])
    yd = np.array([1.0 if status[d] == "SLE" else 0.0 for d in donors])
    for i, d in enumerate(donors):
        keep = np.arange(len(donors)) != i
        pb_scores[idx[d]] = score(fit(PB[keep], yd[keep], lam=5.0), X[idx[d]])
    v_pb = auc(y, pb_scores)

    # The inflated estimate: random 80/20 split of cells, the same people in training and test.
    perm = rng.permutation(len(y))
    cut = int(0.8 * len(y))
    tr, te = perm[:cut], perm[cut:]
    naive = auc(y[te], score(fit(X[tr], y[tr]), X[te]))

    v_unpen = auc(y, held_out(X, D, y, [[d] for d in donors], lam=1e-6))
    gated = {"grouped_5fold_logistic": v_five, "unpenalised_logistic_lopo": v_unpen,
             "pseudobulk_trained_lopo": v_pb}
    variants = {**gated, "nearest_centroid_lopo": v_nc}
    guards.update({
        "naive_cell_split_inflated": naive >= 0.95,
        "reference_in_design_range": 0.62 <= ref <= 0.74,
        "tolerance_band_below_inflated": ref + TOLERANCE["absolute"] < INFLATED_FLOOR,
        "tolerance_excludes_chance": ref - TOLERANCE["absolute"] > 0.5,
        "variants_near_reference": all(abs(v - ref) <= 0.08 for v in gated.values()),
        "ci_ordered": ci[0] < ref < ci[1],
    })
    failed = sorted(k for k, ok in guards.items() if not ok)
    if failed:
        print("design guard failed: " + ", ".join(failed), file=sys.stderr)
        return 3
    w = fit(X, y)[0][1:]
    top = [genes[i] for i in np.argsort(-np.abs(w))[:5]]
    key = {
        "schema": "bio-tasks/key@1", "task": TASK, "main_claim": "cell_auc",
        "reference_auc": r10(ref), "tolerance": TOLERANCE, "inflated_floor": INFLATED_FLOOR,
        "auc_claim_pattern": AUC_PATTERN,
        "flaws": {"F1": "leakage: cells of the same person in training and test (random cell split) inflate the AUC; "
                        "the generalisable estimate holds people out"},
        "reference": {"method": "ridge logistic regression (lambda 1, training-fold standardisation), leave-one-person-out, "
                                "pooled cell AUC, 1000 person-level bootstrap resamples",
                      "ci95": [r10(ci[0]), r10(ci[1])], "naive_cell_split_auc": r10(naive),
                      "variants": {k: r10(v) for k, v in variants.items()}, "top_genes": top},
    }
    a.out.mkdir(parents=True, exist_ok=True)
    (a.out / "key.json").write_text(json.dumps(key, indent=2, sort_keys=True) + "\n")
    work = a.out / "workdir"
    work.mkdir(exist_ok=True)
    results = {
        "claims": [{"id": "cell_auc",
                    "statement": "Held-out-person AUC of a cell-level classifier; well below the usefulness threshold",
                    "status": "tentative", "estimate": r10(ref), "ci": [r10(ci[0]), r10(ci[1])],
                    "n_units": len(donors), "unit": "person (leave-one-person-out evaluation)"}],
        "classifier": {"model": "ridge logistic regression", "n_features": len(genes),
                       "evaluation": "leave-one-person-out; pooled AUC over held-out cells; person bootstrap CI"},
        "top_genes": top,
        "develop_diagnostic": False,
        "extra": {},
    }
    (work / "results.json").write_text(json.dumps(results, indent=2) + "\n")
    (work / "REPORT.md").write_text(
        "# Reference analysis (arm D)\n\nCells from one person share that person's profile, so the classifier is "
        "evaluated on people it never saw (leave-one-person-out); the AUC and its person-level bootstrap interval "
        "are in results.json.\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
