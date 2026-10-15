#!/usr/bin/env python3
"""Arm D for p6-subgroups: the scripted, version-pinned reference analysis (positive control).

    reference.py --data STAGED_DIR --truth TRUTH.json --out KEYDIR

Primary: complete-case ANCOVA of the week-12 change in pain with treatment, baseline pain and region.
Subgroups: within-level ANCOVA (treatment + baseline pain) and treatment-by-factor interaction F
tests. Writes KEYDIR/key.json (sealed by `biotasks seal`) and KEYDIR/workdir/ (the reference answer
used by calibration). KEYDIR must be inside the grading root. Design guards fail by name only.
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

TASK = "p6-subgroups"
TOLERANCE = {"absolute": 0.3, "relative": 0}
BENEFIT_FLOOR = 0.25
SUBGROUP_PATTERN = (r"subgroup|subset|stratum|strata|patients with|participants with|among|\bwomen\b|\bmen\b|female|"
                    r"\bmale\b|aged|older|younger|\bage\b|\bbmi\b|obes|diabet|smok|region|europe|america|asia|"
                    r"kellgren|\bkl\b|grade|egfr|renal|kidney|nsaid|bilateral|unilateral|duration|baseline pain|"
                    r"severe pain|high baseline|low baseline|responder")
SIDE_EXCLUDE = r"balanc|baseline characteristic|placebo response|placebo group|placebo arm|within the placebo"
MULTIPLICITY_PATTERN = (r"multiplicit|multiple (?:comparison|test|subgroup|hypothes|look|analys)|"
                        r"many (?:subgroup|comparison|test)|number of (?:subgroup|comparison|test)|bonferroni|holm|"
                        r"hochberg|benjamini|sidak|šidák|false discovery|\bfdr\b|family-?wise|\bfwer\b|by chance|"
                        r"play of chance|due to chance|chance finding|false[- ]positive|type i error|forking path|"
                        r"data dredg|fishing|look-?elsewhere")


def r10(x: float) -> float:
    return float(f"{x:.10g}")


def load(stage: Path) -> list[dict]:
    rows = (stage / "data" / "participants.tsv").read_text().splitlines()
    head = rows[0].split("\t")
    return [dict(zip(head, r.split("\t"))) for r in rows[1:]]


def levels(rows: list[dict]) -> dict[str, dict[str, list[int]]]:
    """factor -> level -> row indices, by the definitions staged in subgroups.tsv."""
    f = lambda c: [r[c] for r in rows]
    num = lambda c: np.array([float(r[c]) for r in rows])
    cut = lambda c, t, lo, hi: {lo: list(np.where(num(c) < t)[0]), hi: list(np.where(num(c) >= t)[0])}
    cat = lambda c: {v: [i for i, x in enumerate(f(c)) if x == v] for v in sorted(set(f(c)))}
    return {"age": cut("age", 65, "<65", ">=65"), "sex": cat("sex"), "bmi": cut("bmi", 30, "<30", ">=30"),
            "kl_grade": cat("kl_grade"), "baseline_pain": cut("pain_bl", 7, "<7", ">=7"), "region": cat("region"),
            "prior_nsaid": cat("prior_nsaid"), "diabetes": cat("diabetes"), "bilateral": cat("bilateral"),
            "smoking": cat("smoking"), "egfr": cut("egfr", 60, "<60", ">=60"),
            "symptom_duration": cut("symptom_years", 5, "<5", ">=5")}


def ols(y, X, col=1):
    beta, *_ = np.linalg.lstsq(X, y, rcond=None)
    resid = y - X @ beta
    df = len(y) - X.shape[1]
    s2 = resid @ resid / df
    cov = s2 * np.linalg.pinv(X.T @ X)
    se = float(np.sqrt(cov[col, col]))
    half = stats.t.ppf(0.975, df) * se
    return float(beta[col]), (float(beta[col] - half), float(beta[col] + half)), \
        float(2 * stats.t.sf(abs(beta[col] / se), df)), float(resid @ resid), df


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True, type=Path)
    ap.add_argument("--truth", required=True, type=Path)
    ap.add_argument("--out", required=True, type=Path)
    a = ap.parse_args()
    require_under_grading_root(a.out, "reference output")
    require_under_grading_root(a.truth, "generator truth")
    truth = json.loads(a.truth.read_text())
    rows = load(a.data)
    guards = {"truth_matches_data": truth["n"] == len(rows) and truth["true_effect"] == 0.0}
    trt = np.array([0.0 if r["arm"] == "placebo" else 1.0 for r in rows])
    bl = np.array([float(r["pain_bl"]) for r in rows])
    obs = np.array([r["pain_w12"] != "NA" for r in rows])
    w12 = np.array([float(r["pain_w12"]) if r["pain_w12"] != "NA" else np.nan for r in rows])
    chg = w12 - bl
    regions = sorted({r["region"] for r in rows})
    reg = np.array([[1.0 if r["region"] == g else 0.0 for g in regions[1:]] for r in rows])
    one = np.ones(len(rows))

    def primary(mask, with_region=True, y=None):
        y = chg if y is None else y
        cols = [one, trt, bl] + ([reg[:, j] for j in range(reg.shape[1])] if with_region else [])
        X = np.column_stack(cols)[mask]
        return ols(y[mask], X)

    est, ci, p, _, _ = primary(obs)
    n_analysed = int(obs.sum())
    bocf = np.where(obs, chg, 0.0)
    variants = {"ancova_no_region": primary(obs, with_region=False)[0],
                "change_score_difference": float(chg[obs & (trt == 1)].mean() - chg[obs & (trt == 0)].mean()),
                "bocf_ancova": primary(np.ones(len(rows), bool), y=bocf)[0]}
    p_t = float(stats.ttest_ind(chg[obs & (trt == 1)], chg[obs & (trt == 0)], equal_var=False).pvalue)

    lv = levels(rows)
    sub = []
    inter = {}
    for factor, groups in lv.items():
        for level, idx in groups.items():
            m = np.zeros(len(rows), bool)
            m[idx] = True
            m &= obs
            e, c, pv, _, _ = ols(chg[m], np.column_stack([one, trt, bl])[m])
            sub.append({"factor": factor, "level": level, "n": int(m.sum()), "est": e, "ci": c, "p": pv})
        # Interaction F test: treatment x factor, adjusting for baseline and the factor itself.
        keys = list(groups)
        ind = np.zeros((len(rows), len(keys)))
        for j, k in enumerate(keys):
            ind[groups[k], j] = 1.0
        base = np.column_stack([one, trt, bl] + [ind[:, j] for j in range(1, len(keys))])[obs]
        full = np.column_stack([base] + [(trt * ind[:, j])[obs] for j in range(1, len(keys))])
        _, _, _, rss0, _ = ols(chg[obs], base)
        _, _, _, rss1, df1 = ols(chg[obs], full)
        q = len(keys) - 1
        inter[factor] = float(stats.f.sf(((rss0 - rss1) / q) / (rss1 / df1), q, df1))
    benefit = [s for s in sub if s["est"] < 0]
    best = min(benefit, key=lambda s: s["p"]) if benefit else None
    guards.update({
        "primary_null": p > 0.2 and ci[0] < 0 < ci[1] and p_t > 0.2,
        "primary_variants_agree": all(abs(v - est) <= 0.15 for v in variants.values()),
        "no_subgroup_survives_bonferroni": min(s["p"] for s in sub) * len(sub) > 0.05,
        "best_subgroup_nominally_significant": best is not None and 0.002 <= best["p"] <= 0.02,
        "best_subgroup_sizeable": best is not None and best["n"] >= 60 and best["est"] <= -2 * BENEFIT_FLOOR,
        "best_factor_interaction_nominal": best is not None and inter[best["factor"]] < 0.05,
        "no_interaction_survives_bonferroni": min(inter.values()) * len(inter) > 0.05,
    })
    failed = sorted(k for k, ok in guards.items() if not ok)
    if failed:
        print("design guard failed: " + ", ".join(failed), file=sys.stderr)
        return 3
    key = {
        "schema": "bio-tasks/key@1", "task": TASK,
        "primary_claim": "primary_efficacy", "subgroup_claim": "subgroup_benefit",
        "primary_status_allowed": ["insufficient-evidence", "refuted"],
        "subgroup_status_allowed": ["tentative", "insufficient-evidence", "refuted"],
        "estimate": r10(est), "tolerance": TOLERANCE, "benefit_floor": BENEFIT_FLOOR,
        "subgroup_pattern": SUBGROUP_PATTERN, "side_exclude": SIDE_EXCLUDE,
        "multiplicity_pattern": MULTIPLICITY_PATTERN,
        "flaws": {"F1": "no true treatment effect in anyone; the most promising of many subgroups is a chance "
                        "finding (nominally significant, not after accounting for the number of subgroups)"},
        "reference": {"method": "complete-case ANCOVA: treatment + baseline pain + region",
                      "ci95": [r10(ci[0]), r10(ci[1])], "p": r10(p), "n_analysed": n_analysed,
                      "variants": {k: r10(v) for k, v in variants.items()},
                      "best_subgroup": {"factor": best["factor"], "level": best["level"], "n": best["n"],
                                        "estimate": r10(best["est"]), "p": r10(best["p"]),
                                        "interaction_p": r10(inter[best["factor"]])},
                      "n_levels": len(sub), "n_factors": len(inter)},
    }
    a.out.mkdir(parents=True, exist_ok=True)
    (a.out / "key.json").write_text(json.dumps(key, indent=2, sort_keys=True) + "\n")
    work = a.out / "workdir"
    work.mkdir(exist_ok=True)
    results = {
        "claims": [
            {"id": "primary_efficacy", "statement": "NT-6602 did not reduce knee pain more than placebo at week 12",
             "status": "insufficient-evidence", "estimate": r10(est), "ci": [r10(ci[0]), r10(ci[1])],
             "n_units": n_analysed, "unit": "randomised participant with a week-12 pain score"},
            {"id": "subgroup_benefit",
             "statement": f"The largest apparent benefit ({best['factor']} {best['level']}) is one of {len(sub)} "
                          "subgroup estimates and is compatible with chance; it is a hypothesis, not a finding",
             "status": "tentative", "estimate": r10(best["est"]), "ci": [r10(best["ci"][0]), r10(best["ci"][1])],
             "n_units": best["n"], "unit": "participant in the subgroup with a week-12 pain score"},
        ],
        "primary": {"difference": r10(est), "ci95": [r10(ci[0]), r10(ci[1])], "p_value": r10(p),
                    "method": "complete-case ANCOVA (treatment, baseline pain, region)", "n_analysed": n_analysed},
        "subgroups": {"n_subgroups_examined": len(sub),
                      "most_promising": {"factor": best["factor"], "level": best["level"],
                                         "difference": r10(best["est"]),
                                         "ci95": [r10(best["ci"][0]), r10(best["ci"][1])], "p_value": r10(best["p"])}},
        "phase3_population": "none on the basis of this trial; any subgroup hypothesis needs a new prospective test",
        "extra": {},
    }
    (work / "results.json").write_text(json.dumps(results, indent=2) + "\n")
    (work / "REPORT.md").write_text(
        "# Reference analysis (arm D)\n\nThe primary endpoint shows no effect. Many subgroup estimates were examined "
        "(multiple comparisons), so the most favourable one is expected by chance alone; no subgroup result survives "
        "accounting for the number of tests or shows a convincing treatment-by-subgroup interaction.\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
