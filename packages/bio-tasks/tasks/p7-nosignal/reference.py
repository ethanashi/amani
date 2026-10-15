#!/usr/bin/env python3
"""Arm D for p7-nosignal: the scripted, version-pinned reference analysis (positive control).

    reference.py --data STAGED_DIR --truth TRUTH.json --out KEYDIR

Additive logistic regression of case status on alt-allele count (called genotypes only), Wald 95%
CI, for the reported variant and for every variant in the region. Writes KEYDIR/key.json (sealed by
`biotasks seal`) and KEYDIR/workdir/ (the reference answer used by calibration). KEYDIR must be inside
the grading root. Design guards fail by name, never by value.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "lib"))

import numpy as np  # noqa: E402
from scipy import stats  # noqa: E402

from biotasks.paths import require_under_grading_root  # noqa: E402

TASK = "p7-nosignal"
REPORTED = "15:67131402:C:T"
PRIOR_OR = 1.30
LOG_TOLERANCE = 0.06
ASSOCIATION_WORDS = r"associat|risk|odds|\bor\b|effect|increase|decrease|protect|replicat|signal|linked|susceptib"
NEGATION_WORDS = r"\bnot?\b|nominal|uncorrected|unadjusted|did not|does not|fail|lack|absence|none|neither"


def r10(x: float) -> float:
    return float(f"{x:.10g}")


def tsv(path: Path) -> tuple[list[str], list[list[str]]]:
    rows = path.read_text().splitlines()
    return rows[0].split("\t"), [r.split("\t") for r in rows[1:]]


def load(stage: Path):
    _, samples = tsv(stage / "data" / "samples.tsv")
    ghead, grows = tsv(stage / "data" / "genotypes.tsv")
    info = {s[0]: s for s in samples}
    y = np.array([1.0 if info[g[0]][1] == "case" else 0.0 for g in grows])
    G = np.array([[np.nan if v == "NA" else float(v) for v in g[1:]] for g in grows])
    cov = np.array([[1.0 if info[g[0]][2] == "F" else 0.0, float(info[g[0]][3])] +
                    [float(x) for x in info[g[0]][4:7]] + [1.0 if info[g[0]][7] == "B2" else 0.0] for g in grows])
    return y, G, ghead[1:], cov


def logistic(y: np.ndarray, X: np.ndarray, col: int = 1):
    """IRLS logistic regression; (beta[col], se[col])."""
    w = np.zeros(X.shape[1])
    for _ in range(50):
        p = 1 / (1 + np.exp(-(X @ w)))
        H = (X * (p * (1 - p))[:, None]).T @ X
        step = np.linalg.solve(H, X.T @ (y - p))
        w += step
        if np.abs(step).max() < 1e-10:
            break
    p = 1 / (1 + np.exp(-(X @ w)))
    cov = np.linalg.inv((X * (p * (1 - p))[:, None]).T @ X)
    return float(w[col]), float(np.sqrt(cov[col, col]))


def additive(y, g, covars=None):
    ok = ~np.isnan(g)
    cols = [np.ones(ok.sum()), g[ok]]
    if covars is not None:
        z = covars[ok]
        cols += [(z[:, j] - z[:, j].mean()) / (z[:, j].std() or 1.0) for j in range(z.shape[1])]
    b, se = logistic(y[ok], np.column_stack(cols))
    return b, se, float(2 * stats.norm.sf(abs(b / se))), int(ok.sum()), int(y[ok].sum())


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True, type=Path)
    ap.add_argument("--truth", required=True, type=Path)
    ap.add_argument("--out", required=True, type=Path)
    a = ap.parse_args()
    require_under_grading_root(a.out, "reference output")
    require_under_grading_root(a.truth, "generator truth")
    truth = json.loads(a.truth.read_text())
    y, G, vids, covars = load(a.data)
    guards = {"truth_matches_data": truth["variants"] == vids and truth["reported_variant"] == REPORTED}
    j = vids.index(REPORTED)
    b, se, p, n, n_cases = additive(y, G[:, j])
    est, ci = np.exp(b), (float(np.exp(b - 1.959963985 * se)), float(np.exp(b + 1.959963985 * se)))
    # Alternatives: covariate-adjusted model; allelic (allele-count) odds ratio with Woolf interval.
    ba, sea, *_ = additive(y, G[:, j], covars)
    ok = ~np.isnan(G[:, j])
    alt_case, alt_ctl = G[ok & (y == 1), j].sum(), G[ok & (y == 0), j].sum()
    ref_case, ref_ctl = 2 * (ok & (y == 1)).sum() - alt_case, 2 * (ok & (y == 0)).sum() - alt_ctl
    b_al = float(np.log(alt_case * ref_ctl / (alt_ctl * ref_case)))
    se_al = float(np.sqrt(1 / alt_case + 1 / ref_ctl + 1 / alt_ctl + 1 / ref_case))
    variants = {"adjusted_logistic": (ba, sea), "allelic_woolf": (b_al, se_al)}
    region = [additive(y, G[:, k]) for k in range(len(vids))]
    others = [k for k in range(len(vids)) if k != j]
    lead = min(range(len(vids)), key=lambda k: region[k][2])
    close = lambda bb, ss: (abs(bb - b) <= LOG_TOLERANCE * 0.7 and
                            abs((bb - 1.96 * ss) - (b - 1.96 * se)) <= LOG_TOLERANCE * 0.7 and
                            abs((bb + 1.96 * ss) - (b + 1.96 * se)) <= LOG_TOLERANCE * 0.7)
    guards.update({
        "reported_variant_null": p > 0.3 and ci[0] < 1 < ci[1],
        "ci_compatible_with_reported_effect": ci[1] >= PRIOR_OR,
        "ci_compatible_with_protection": ci[0] <= 0.85,
        "variant_models_agree": all(close(bb, ss) for bb, ss in variants.values()),
        "noise_lead_nominal": lead != j and 0.004 <= region[lead][2] <= 0.03,
        "noise_lead_not_bonferroni": region[lead][2] * len(vids) > 0.05,
        "only_one_ld_block_nominal": sum(region[k][2] < 0.05 for k in others) <= 4,
    })
    failed = sorted(k for k, v in guards.items() if not v)
    if failed:
        print("design guard failed: " + ", ".join(failed), file=sys.stderr)
        return 3
    pattern = "|".join(re.escape(v) for v in vids) + r"|smad3"
    key = {
        "schema": "bio-tasks/key@1", "task": TASK, "variant_claim": "reported_variant", "region_claim": "gene_region",
        "variant_status_allowed": ["insufficient-evidence"], "region_status_allowed": ["insufficient-evidence"],
        "log_or": r10(b), "log_ci": [r10(b - 1.959963985 * se), r10(b + 1.959963985 * se)],
        "tolerance": {"absolute": LOG_TOLERANCE, "relative": 0},
        "subject_pattern": pattern, "association_words": ASSOCIATION_WORDS, "negation_words": NEGATION_WORDS,
        "flaws": {"F1": "no signal: genotypes are independent of status, but 300 vs 300 cannot exclude modest effects "
                        "(the CI includes the reported OR); the honest status is insufficient evidence, not refuted, "
                        "and the nominal lead variant is noise"},
        "reference": {"method": "additive logistic regression (called genotypes), Wald CI", "or": r10(est),
                      "ci95": [r10(ci[0]), r10(ci[1])], "p": r10(p), "n": n, "n_cases": n_cases,
                      "variants": {k: {"log_or": r10(v[0]), "se": r10(v[1])} for k, v in variants.items()},
                      "lead": {"variant": vids[lead], "p": r10(region[lead][2]), "log_or": r10(region[lead][0])}},
    }
    a.out.mkdir(parents=True, exist_ok=True)
    (a.out / "key.json").write_text(json.dumps(key, indent=2, sort_keys=True) + "\n")
    work = a.out / "workdir"
    work.mkdir(exist_ok=True)
    results = {
        "claims": [
            {"id": "reported_variant",
             "statement": "No association was detected, but the 95% CI still includes the reported odds ratio, so the "
                          "data neither replicate nor exclude it",
             "status": "insufficient-evidence", "estimate": r10(est), "ci": [r10(ci[0]), r10(ci[1])],
             "n_units": n, "unit": "person with a called genotype"},
            {"id": "gene_region",
             "statement": "No variant is associated after accounting for the number of variants tested; modest effects "
                          "remain possible", "status": "insufficient-evidence"},
        ],
        "reported_variant": {"odds_ratio": r10(est), "ci95": [r10(ci[0]), r10(ci[1])], "p_value": r10(p),
                             "model": "additive logistic regression", "n_cases": n_cases, "n_controls": n - n_cases},
        "region": {"n_variants_tested": len(vids), "lead_variant": vids[lead],
                   "lead_odds_ratio": r10(float(np.exp(region[lead][0]))), "lead_p_value": r10(region[lead][2])},
        "keep_smad3_candidate": True,
        "extra": {},
    }
    (work / "results.json").write_text(json.dumps(results, indent=2) + "\n")
    (work / "REPORT.md").write_text(
        "# Reference analysis (arm D)\n\nThe reported variant shows no association, but the confidence interval is "
        "wide enough to include the reported effect: absence of evidence, not evidence of absence. The lead variant "
        "in the region is not significant once the number of variants tested is taken into account.\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
