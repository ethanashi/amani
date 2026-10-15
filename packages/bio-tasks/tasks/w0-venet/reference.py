#!/usr/bin/env python3
"""Positive-control fixture for w0-venet calibration.

    reference.py --data STAGED_DIR --truth TRUTH.json --out OUTDIR

The warm-up's answer key already exists (bio-baseline task/SEALED-ANSWER.md.enc and the sealed
reference outputs of reference/venet_reference.R), so this writes no key. It writes OUTDIR/workdir:
an attempt that performs the analysis-set derivation correctly (the venet_reference.R rules, plus
removal of samples whose expression profile duplicates another sample's) and reports the resulting
counts. It is not a full Venet re-analysis: the random/published-signature fields are not computed.
That is enough to calibrate the answer-key items (planted flaw, unit of analysis, sample accounting);
grade.py's other verdicts are informational for this task. OUTDIR must be inside the grading root.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "lib"))

from biotasks.paths import require_under_grading_root  # noqa: E402


def analysis_set(data: Path) -> dict:
    """Same inclusion rules as venet_reference.R; duplicate expression profiles are dropped
    (drop_duplicates on the per-sample profile hash) before counting patients and events."""
    import numpy as np
    import pandas as pd
    clin = pd.read_csv(data / "clinical_patient.tsv", sep="\t", dtype=str, keep_default_na=False, na_values=["NA", ""])
    samp = pd.read_csv(data / "clinical_sample.tsv", sep="\t", dtype=str, keep_default_na=False, na_values=["NA", ""])
    with open(data / "expression_mrna.tsv") as fh:
        columns = fh.readline().rstrip("\n").split("\t")[2:]
    expr = pd.read_csv(data / "expression_mrna.tsv", sep="\t", usecols=range(2, len(columns) + 2),
                       dtype=np.float64, na_values=["NA", ""]).to_numpy()
    expr = np.where(np.isnan(expr), np.inf, expr)          # one canonical bit pattern for missing values
    profile = {c: hashlib.sha256(np.ascontiguousarray(expr[:, j]).tobytes()).hexdigest()
               for j, c in enumerate(columns)}
    s2p = dict(zip(samp["SAMPLE_ID"], samp["PATIENT_ID"]))
    clin = clin.set_index("PATIENT_ID")
    rows = []
    for c in columns:
        pid = s2p.get(c)
        if pid is None or pid not in clin.index:
            continue
        t = pd.to_numeric(clin.at[pid, "OS_MONTHS"], errors="coerce")
        st = clin.at[pid, "OS_STATUS"]
        ev = 1 if st == "1:DECEASED" else 0 if st == "0:LIVING" else None
        if pd.isna(t) or ev is None or t < 0:
            continue
        rows.append({"sample": c, "patient": pid, "profile": profile[c], "event": ev})
    df = pd.DataFrame(rows)
    dedup = df.drop_duplicates(subset="profile", keep="first")
    return {"n_candidates": int(len(df)), "n_duplicates_removed": int(len(df) - len(dedup)),
            "n_patients": int(dedup["patient"].nunique()), "n_events": int(dedup["event"].sum())}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True, type=Path)
    ap.add_argument("--truth", required=True, type=Path)
    ap.add_argument("--out", required=True, type=Path)
    a = ap.parse_args()
    require_under_grading_root(a.out, "reference output")
    s = analysis_set(a.data / "data")
    work = a.out / "workdir"
    (work / "code").mkdir(parents=True)
    shutil.copyfile(Path(__file__), work / "code" / "analysis_set.py")
    results = {
        "n_patients_analyzed": s["n_patients"], "n_events": s["n_events"],
        "score_method": "not computed (calibration fixture: analysis-set derivation only)",
        "proliferation_metagene": {"definition": "not computed", "n_genes": 0},
        "random_signatures": [], "published_signatures": [],
        "negative_control": {"description": "not computed", "share_p_lt_0_05": None},
        "conclusion": {"random_rate_similar_to_published": None, "proliferation_adjustment_removes_most": None},
        "extra": {"duplicate_expression_profiles_removed": s["n_duplicates_removed"]},
    }
    (work / "results.json").write_text(json.dumps(results, indent=2) + "\n")
    (work / "REPORT.md").write_text(
        "# Analysis set (calibration fixture)\n\nSamples were matched to patients; patients without overall "
        "survival or with negative follow-up were excluded. Samples whose expression profile duplicates another "
        "sample's were removed before counting, so each patient enters once. Counts are in results.json.\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
