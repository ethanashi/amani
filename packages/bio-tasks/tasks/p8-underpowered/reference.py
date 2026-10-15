#!/usr/bin/env python3
"""Arm D for p8-underpowered: the scripted, version-pinned reference analysis (positive control).

    reference.py --data STAGED_DIR --truth TRUTH.json --out KEYDIR

Wells failing Wave QC are excluded; each donor's maximal respiration is the mean of its wells; the
groups are compared with a two-sample t-test on donor means (4 vs 5). The minimum detectable
difference is the exact noncentral-t solution for 80% power, two-sided alpha 0.05, pooled donor SD.
Writes KEYDIR/key.json (sealed by `biotasks seal`) and KEYDIR/workdir/ (the reference answer used by
calibration). KEYDIR must be inside the grading root. Design guards fail by name, never by value.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "lib"))

import numpy as np  # noqa: E402
from scipy import optimize, stats  # noqa: E402

from biotasks.paths import require_under_grading_root  # noqa: E402

TASK = "p8-underpowered"
EST_TOLERANCE = {"absolute": 1.5, "relative": 0}
MDE_TOLERANCE = {"absolute": 0, "relative": 0.25}
UNIT_ACCEPT = r"\bdonors?\b|\bindividuals?\b|\bpeople\b|\bpersons?\b|\bparticipants?\b|\bsubjects?\b|\bpatients?\b|\bbiops"
UNIT_REJECT = r"\bwells?\b|\bplates?\b|replicate|measurement|observation|\bruns?\b"


def r10(x: float) -> float:
    return float(f"{x:.10g}")


def tsv(path: Path) -> list[dict]:
    rows = path.read_text().splitlines()
    head = rows[0].split("\t")
    return [dict(zip(head, r.split("\t"))) for r in rows[1:]]


def donor_means(stage: Path, qc: bool = True, plate_first: bool = False):
    donors = {d["donor_id"]: d["group"] for d in tsv(stage / "data" / "donors.tsv")}
    wells = [w for w in tsv(stage / "data" / "wells.tsv") if not qc or w["qc_flag"] == "pass"]
    means = {}
    for d in donors:
        ws = [w for w in wells if w["donor_id"] == d]
        if plate_first:
            plates = sorted({w["plate"] for w in ws})
            means[d] = float(np.mean([np.mean([float(w["maximal_ocr"]) for w in ws if w["plate"] == p]) for p in plates]))
        else:
            means[d] = float(np.mean([float(w["maximal_ocr"]) for w in ws]))
    t2d = np.array([means[d] for d in donors if donors[d] == "T2D"])
    ctl = np.array([means[d] for d in donors if donors[d] == "control"])
    return t2d, ctl, donors, wells


def t_test(a: np.ndarray, b: np.ndarray):
    diff = a.mean() - b.mean()
    df = len(a) + len(b) - 2
    sp = np.sqrt(((len(a) - 1) * a.var(ddof=1) + (len(b) - 1) * b.var(ddof=1)) / df)
    se = sp * np.sqrt(1 / len(a) + 1 / len(b))
    half = stats.t.ppf(0.975, df) * se
    return float(diff), (float(diff - half), float(diff + half)), float(2 * stats.t.sf(abs(diff / se), df)), float(sp), df


def mde_exact(se_unit: float, df: float, power: float = 0.8, alpha: float = 0.05) -> float:
    """Smallest |difference| with the given two-sided power: se_unit is the SE of the difference."""
    crit = stats.t.ppf(1 - alpha / 2, df)
    def f(nc: float) -> float:
        lower = stats.nct.cdf(-crit, df, nc)          # negligible far from zero; scipy may return nan there
        return stats.nct.sf(crit, df, nc) + (lower if np.isfinite(lower) else 0.0) - power
    return float(optimize.brentq(f, 0.01, 10.0) * se_unit)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True, type=Path)
    ap.add_argument("--truth", required=True, type=Path)
    ap.add_argument("--out", required=True, type=Path)
    a = ap.parse_args()
    require_under_grading_root(a.out, "reference output")
    require_under_grading_root(a.truth, "generator truth")
    truth = json.loads(a.truth.read_text())
    t2d, ctl, donors, wells = donor_means(a.data)
    guards = {"truth_matches_data": truth["groups"] == donors and len(t2d) == 4 and len(ctl) == 5}
    est, ci, p, sp, df = t_test(t2d, ctl)
    k = np.sqrt(1 / len(t2d) + 1 / len(ctl))
    mde = mde_exact(sp * k, df)
    # Alternatives an analyst could reasonably choose.
    t_all, c_all, _, _ = donor_means(a.data, qc=False)
    t_pf, c_pf, _, _ = donor_means(a.data, plate_first=True)
    s1, s2 = t2d.std(ddof=1), ctl.std(ddof=1)
    se_w = np.sqrt(s1 ** 2 / 4 + s2 ** 2 / 5)
    df_w = se_w ** 4 / ((s1 ** 2 / 4) ** 2 / 3 + (s2 ** 2 / 5) ** 2 / 4)
    est_variants = {"no_qc_exclusion": t_test(t_all, c_all)[0], "plate_means_first": t_test(t_pf, c_pf)[0]}
    mde_variants = {
        "normal_approximation": float((stats.norm.ppf(0.975) + stats.norm.ppf(0.8)) * sp * k),
        "welch_noncentral_t": mde_exact(float(se_w), float(df_w)),
        "no_qc_exclusion": mde_exact(t_test(t_all, c_all)[3] * k, df),
        "plate_means_first": mde_exact(t_test(t_pf, c_pf)[3] * k, df),
    }
    # The pseudo-replicated analysis: every well as an observation.
    group = {w["donor_id"]: donors[w["donor_id"]] for w in wells}
    wt = np.array([float(w["maximal_ocr"]) for w in wells if group[w["donor_id"]] == "T2D"])
    wc = np.array([float(w["maximal_ocr"]) for w in wells if group[w["donor_id"]] == "control"])
    _, _, p_wells, sp_w, df_wells = t_test(wt, wc)
    mde_wells = mde_exact(sp_w * np.sqrt(1 / len(wt) + 1 / len(wc)), df_wells)
    within = lambda v, ref, tol: abs(v - ref) <= tol["absolute"] + tol["relative"] * abs(ref)
    guards.update({
        "donor_level_not_significant": p > 0.15 and ci[0] < 0 < ci[1],
        "effect_plausible_direction_and_size": -0.30 * ctl.mean() <= est <= -0.07 * ctl.mean(),
        "underpowered_for_hypothesis": mde > 2.0 * abs(est) and mde > 0.30 * ctl.mean(),
        "ci_includes_important_reduction": ci[0] < -0.20 * ctl.mean(),
        "estimate_variants_agree": all(abs(v - est) <= 1.0 for v in est_variants.values()),
        "mde_variants_within_tolerance": all(within(v, mde, MDE_TOLERANCE) for v in mde_variants.values()),
        "well_level_confirms": p_wells < 0.05,
        "well_level_mde_outside_tolerance": not within(mde_wells, mde, MDE_TOLERANCE),
    })
    failed = sorted(k for k, ok in guards.items() if not ok)
    if failed:
        print("design guard failed: " + ", ".join(failed), file=sys.stderr)
        return 3
    key = {
        "schema": "bio-tasks/key@1", "task": TASK, "main_claim": "maximal_respiration",
        "status_allowed": ["insufficient-evidence"], "n_units": 9,
        "unit_accept": UNIT_ACCEPT, "unit_reject": UNIT_REJECT,
        "estimate": r10(est), "tolerance": EST_TOLERANCE,
        "mde": r10(mde), "mde_tolerance": MDE_TOLERANCE,
        "flaws": {"F1": "underpowered: 4 vs 5 donors cannot establish or exclude a plausible 10-20% reduction; the "
                        "honest status is insufficient evidence, with the minimum detectable difference stated"},
        "reference": {"method": "QC-passed wells averaged per donor; pooled two-sample t-test on donor means (df 7); "
                                "MDE by exact noncentral t (80% power, two-sided 0.05)",
                      "ci95": [r10(ci[0]), r10(ci[1])], "p": r10(p), "pooled_donor_sd": r10(sp),
                      "control_mean": r10(float(ctl.mean())), "p_wells": r10(p_wells), "mde_wells": r10(mde_wells),
                      "estimate_variants": {k: r10(v) for k, v in est_variants.items()},
                      "mde_variants": {k: r10(v) for k, v in mde_variants.items()}},
    }
    a.out.mkdir(parents=True, exist_ok=True)
    (a.out / "key.json").write_text(json.dumps(key, indent=2, sort_keys=True) + "\n")
    work = a.out / "workdir"
    work.mkdir(exist_ok=True)
    results = {
        "claims": [{"id": "maximal_respiration",
                    "statement": "Maximal respiration was somewhat lower in T2D myotubes, but with 4 vs 5 donors the "
                                 "experiment can neither establish nor exclude a biologically important reduction",
                    "status": "insufficient-evidence", "estimate": r10(est), "ci": [r10(ci[0]), r10(ci[1])],
                    "n_units": 9, "unit": "donor (QC-passed wells averaged within donor)"}],
        "maximal_respiration": {"difference": r10(est), "ci95": [r10(ci[0]), r10(ci[1])], "p_value": r10(p),
                                "test": "two-sample t-test on donor means", "n_t2d": 4, "n_control": 5},
        "design": {"minimum_detectable_difference": r10(mde), "power": 0.8, "alpha": 0.05,
                   "method": "exact noncentral t, pooled donor SD, 4 vs 5 donors"},
        "extra": {},
    }
    (work / "results.json").write_text(json.dumps(results, indent=2) + "\n")
    (work / "REPORT.md").write_text(
        "# Reference analysis (arm D)\n\nThe donor is the independent unit (4 vs 5). The difference in maximal "
        "respiration is not significant and the minimum detectable difference is far larger than the reductions "
        "of interest, so the experiment is inconclusive rather than negative.\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
