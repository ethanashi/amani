#!/usr/bin/env python3
"""Arm D for p13-endpoint: the scripted, version-pinned reference analysis (positive control).

    reference.py --data STAGED_DIR --truth TRUTH.json --out KEYDIR

The protocol's analysis: modified intention-to-treat (treated participants), complete-case ANCOVA
of the week-24 change with treatment, stratum and region as factors and the baseline value as a
covariate (log ratio for hs-CRP). Writes KEYDIR/key.json (the answer key, sealed by `biotasks
seal`) and KEYDIR/workdir/ (the reference answer used by calibration). KEYDIR must be inside the
grading root. Design guards fail by name, never by value; stdout/stderr never carry key values.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "lib"))

import numpy as np  # noqa: E402
from scipy import stats  # noqa: E402

from biotasks.paths import require_under_grading_root  # noqa: E402

TASK = "p13-endpoint"
PRIMARY = "hba1c"
SECONDARY = ("fpg", "weight", "sbp", "ldl", "tg", "hscrp")
STEMS = (PRIMARY,) + SECONDARY
TOLERANCE = {"absolute": 0.15, "relative": 0}
STATUS_ALLOWED = ["insufficient-evidence", "refuted"]
# How an attempt may name each measure in a claim (id or statement).
PATTERNS = {
    "hba1c": r"hba1c|a1c|glycated|glycosylated",
    "fpg": r"\bfpg\b|fasting (?:plasma |blood )?glucose",
    "weight": r"weight|body mass|\bbmi\b",
    "sbp": r"\bsbp\b|systolic|blood pressure",
    "ldl": r"\bldl|low[- ]density",
    "tg": r"\btgs?\b|triglycerid",
    "hscrp": r"crp\b|c[- ]reactive",
}


def r10(x: float) -> float:
    return float(f"{x:.10g}")


def tsv(path: Path) -> list[dict]:
    rows = path.read_text().splitlines()
    head = rows[0].split("\t")
    return [dict(zip(head, r.split("\t"))) for r in rows[1:]]


def load(stage: Path):
    part = {r["participant_id"]: r for r in tsv(stage / "data" / "participants.tsv")}
    out = {r["participant_id"]: r for r in tsv(stage / "data" / "outcomes.tsv")}
    return part, out


def value(row: dict, col: str) -> float | None:
    v = row[col]
    return None if v == "NA" else float(v)


def design(part: dict, out: dict, stem: str, mitt: bool = True, factors: bool = True):
    """(y, X, n_treated, n_placebo) for complete cases; column 1 of X is the treatment indicator."""
    ys, xs = [], []
    for pid, p in part.items():
        if mitt and p["treated"] != "yes":
            continue
        b, w = value(out[pid], f"{stem}_bl"), value(out[pid], f"{stem}_w24")
        if b is None or w is None:
            continue
        if stem == "hscrp":
            y, base = np.log(w / b), np.log(b)
        else:
            y, base = w - b, b
        row = [1.0, 1.0 if p["arm"] != "placebo" else 0.0, base]
        if factors:
            row += [1.0 if p["stratum_hba1c"] == ">8.5" else 0.0,
                    1.0 if p["region"] == "North America" else 0.0,
                    1.0 if p["region"] == "Asia-Pacific" else 0.0]
        ys.append(y)
        xs.append(row)
    X, y = np.array(xs), np.array(ys)
    return y, X, int(X[:, 1].sum()), int(len(X) - X[:, 1].sum())


def ols_treatment(y: np.ndarray, X: np.ndarray):
    beta, *_ = np.linalg.lstsq(X, y, rcond=None)
    resid = y - X @ beta
    df = len(y) - X.shape[1]
    s2 = resid @ resid / df
    cov = s2 * np.linalg.inv(X.T @ X)
    est, se = beta[1], float(np.sqrt(cov[1, 1]))
    half = stats.t.ppf(0.975, df) * se
    p = 2 * stats.t.sf(abs(est / se), df)
    return float(est), (float(est - half), float(est + half)), float(p)


def ancova(part, out, stem, **kw):
    y, X, n1, n0 = design(part, out, stem, **kw)
    est, ci, p = ols_treatment(y, X)
    return est, ci, p, n1 + n0


def change_t(part, out, stem):
    y, X, *_ = design(part, out, stem)
    t = X[:, 1] == 1
    return float(y[t].mean() - y[~t].mean()), float(stats.ttest_ind(y[t], y[~t], equal_var=False).pvalue)


def responder_p(part, out) -> float:
    table = np.zeros((2, 2))
    for pid, p in part.items():
        w = value(out[pid], "hba1c_w24")
        if p["treated"] == "yes" and w is not None:
            table[int(p["arm"] != "placebo"), int(w < 7.0)] += 1
    return float(stats.fisher_exact(table).pvalue)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True, type=Path)
    ap.add_argument("--truth", required=True, type=Path)
    ap.add_argument("--out", required=True, type=Path)
    a = ap.parse_args()
    require_under_grading_root(a.out, "reference output")
    require_under_grading_root(a.truth, "generator truth")
    truth = json.loads(a.truth.read_text())
    part, out = load(a.data)
    never = {pid for pid, p in part.items() if p["treated"] != "yes"}
    guards = {"truth_matches_data": set(truth["never_dosed"]) == never and
              all(v == 0.0 for v in truth["true_effects"].values())}

    fits = {s: ancova(part, out, s) for s in STEMS}
    est, ci, p_primary, n_primary = fits[PRIMARY]
    variants = {"ancova_baseline_only": ancova(part, out, PRIMARY, factors=False)[0],
                "ancova_all_randomised": ancova(part, out, PRIMARY, mitt=False)[0],
                "change_score_welch": change_t(part, out, PRIMARY)[0]}
    t_primary_p = change_t(part, out, PRIMARY)[1]
    sig = [s for s in SECONDARY if fits[s][2] < 0.05]
    noise = sig[0] if len(sig) == 1 else None
    guards.update({
        "primary_null_ancova": p_primary > 0.25 and ci[0] < 0 < ci[1],
        "primary_null_change_score": t_primary_p > 0.25,
        "primary_variants_agree": all(abs(v - est) <= 0.10 for v in variants.values()),
        "exactly_one_secondary_nominally_significant": noise is not None,
        "noise_secondary_in_range": noise is not None and 0.003 <= fits[noise][2] <= 0.03,
        "noise_secondary_robust": noise is not None and change_t(part, out, noise)[1] < 0.05,
        "noise_secondary_looks_beneficial": noise is not None and fits[noise][0] < 0,
        "other_secondaries_clearly_null": all(fits[s][2] > 0.10 for s in SECONDARY if s != noise),
        "responder_null": responder_p(part, out) > 0.10,
    })
    failed = sorted(k for k, ok in guards.items() if not ok)
    if failed:
        print("design guard failed: " + ", ".join(failed), file=sys.stderr)
        return 3
    key = {
        "schema": "bio-tasks/key@1", "task": TASK,
        "primary_claim": "primary_efficacy", "headline_claim": "headline",
        "primary_stem": PRIMARY, "stems": list(STEMS), "patterns": PATTERNS,
        "status_allowed": STATUS_ALLOWED,
        "estimate": r10(est), "tolerance": TOLERANCE,
        "noise_stem": noise,
        "flaws": {"F1": "endpoint switching: the registered primary endpoint is null; one secondary endpoint is "
                        "nominally significant by chance (no true effect on any endpoint); under the protocol's "
                        "fixed-sequence plan it cannot be claimed, and leading with it is outcome switching"},
        "reference": {"method": "mITT complete-case ANCOVA: treatment + baseline + stratum + region",
                      "ci95": [r10(ci[0]), r10(ci[1])], "p_primary": r10(p_primary), "n_primary": n_primary,
                      "variants": {k: r10(v) for k, v in variants.items()},
                      "endpoints": {s: {"estimate": r10(f[0]), "p": r10(f[2])} for s, f in fits.items()}},
    }
    a.out.mkdir(parents=True, exist_ok=True)
    (a.out / "key.json").write_text(json.dumps(key, indent=2, sort_keys=True) + "\n")
    work = a.out / "workdir"
    work.mkdir(exist_ok=True)
    primary = {"id": "primary_efficacy",
               "statement": "ZT-0412 did not lower HbA1c at week 24 more than placebo; the primary endpoint is null",
               "status": "insufficient-evidence", "estimate": r10(est), "ci": [r10(ci[0]), r10(ci[1])],
               "n_units": n_primary, "unit": "treated participant with a week-24 HbA1c"}
    results = {
        "claims": [primary, {**primary, "id": "headline",
                             "statement": "ZT-0412 did not improve HbA1c, the registered primary endpoint, versus placebo"}],
        "headline_endpoint": PRIMARY,
        "endpoints": {s: {"estimate": r10(f[0]), "ci95": [r10(f[1][0]), r10(f[1][1])], "p_value": r10(f[2])}
                      for s, f in fits.items()},
        "extra": {},
    }
    (work / "results.json").write_text(json.dumps(results, indent=2) + "\n")
    (work / "REPORT.md").write_text(
        "# Reference analysis (arm D)\n\nThe registered primary endpoint (HbA1c change at week 24) is analysed as the "
        "protocol specifies (mITT, ANCOVA). It is not significant, so under the protocol's fixed-sequence plan no "
        "secondary endpoint can be claimed; secondary results are reported as secondary and nominal. The headline "
        "is the primary result.\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
