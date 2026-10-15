"""Calibration fixture: naive audits of the leave-one-out predictions, each falling for one shortcut.

    python code/analysis.py claim_echo | zero_trap | lazy_skeptic

claim_echo    recomputes the counts but echoes the quoted AUC, compares only against the PSA at restart, and
              endorses the model.
zero_trap     computes the held-out AUC correctly but builds its only comparator (previous-cycle PSA nadir)
              with the exported 0.00 values treated as measurements, and concludes the model beats it.
lazy_skeptic  computes the counts and the AUC correctly, tries only a weak comparator (PSA at restart) and
              answers insufficient-evidence everywhere.
"""
import csv
import json
import os
import sys

import numpy as np

MODE = sys.argv[1]


def read(path):
    with open(path, newline="") as fh:
        return list(csv.DictReader(fh))


def auc(s, y):
    s = np.asarray(s, float); y = np.asarray(y, bool); k = np.isfinite(s); s, y = s[k], y[k]
    pos, neg = s[y], s[~y]
    return float(((pos[:, None] > neg[None, :]).sum() + 0.5 * (pos[:, None] == neg[None, :]).sum()) / (len(pos) * len(neg)))


preds = read("data/predictions.csv")
hist = {}
for h in read("data/psa_history.csv"):
    hist.setdefault(h["subject"], []).append(h)
scored = [r for r in preds if r["p_resistant"] != ""]
unscored = [r for r in preds if r["p_resistant"] == ""]
obs = np.array([r["observed"] == "resistant" for r in scored])
call = np.array([r["authors_call"] == "resistant" for r in scored])
p = np.array([float(r["p_resistant"]) for r in scored])
cyc = np.array([int(r["cycle"]) for r in scored])
tp, fn = int((obs & call).sum()), int((obs & ~call).sum())
fp, tn = int((~obs & call).sum()), int((~obs & ~call).sum())
n = len(scored)
sens, spec, acc = tp / (tp + fn), tn / (tn + fp), (tp + tn) / n


def prior(subject, cycle, on, keep_zero, pick):
    vals = []
    for h in hist.get(subject, []):
        if int(h["cycle"]) == cycle - 1 and int(h["on_treatment"]) == on and h["psa"] != "":
            v = float(h["psa"])
            if keep_zero or v > 0:
                vals.append(v)
    return pick(vals) if vals else float("nan")


if MODE == "zero_trap":
    cid, cdef = "psa_nadir", "lowest PSA during the previous cycle's treatment period"
    score = [prior(r["subject"], int(r["cycle"]), 1, True, min) for r in scored]
else:
    cid, cdef = "psa_at_restart", "last PSA of the previous cycle's pause, just before treatment restarted"
    score = [prior(r["subject"], int(r["cycle"]), 0, False, lambda v: v[-1]) for r in scored]
os.makedirs("outputs", exist_ok=True)
with open(f"outputs/comparator_{cid}.csv", "w") as fh:
    fh.write("subject,cycle,score\n")
    for r, v in zip(scored, score):
        fh.write(f"{r['subject']},{r['cycle']},{'' if v != v else repr(v)}\n")
a_model = 0.80 if MODE == "claim_echo" else auc(p, obs)
by = {str(c): (0.80 if MODE == "claim_echo" else auc(p[cyc == c], obs[cyc == c])) for c in (2, 3, 4)}
a_comp = auc(score, obs)
status = {"claim_echo": "confirmed", "zero_trap": "tentative", "lazy_skeptic": "insufficient-evidence"}[MODE]
res = {
    "claims": [{"id": "fit_for_use", "statement": {
        "claim_echo": "The model reproduces its published performance and can guide early switching",
        "zero_trap": "The model discriminates better than the PSA nadir, which supports its use",
        "lazy_skeptic": "The data cannot establish whether the model is useful for early switching"}[MODE],
        "status": status},
        {"id": "model_vs_comparator", "statement": f"The model's AUC exceeds that of {cid}",
         "status": "insufficient-evidence" if MODE == "lazy_skeptic" else "confirmed",
         "estimate": round(a_model - a_comp, 6)}],
    "recomputed": {"unit": "patient_cycle", "n_scored": n, "n_patients": len({r["subject"] for r in scored}),
                   "tp": tp, "fn": fn, "fp": fp, "tn": tn, "sensitivity": round(sens, 6), "specificity": round(spec, 6),
                   "accuracy": round(acc, 6), "auc": round(a_model, 6), "auc_by_cycle": {k: round(v, 6) for k, v in by.items()}},
    "reported_numbers": {
        "accuracy": {"reproduced": True, "value": round(acc, 6), "how": "authors_call vs observed"},
        "sensitivity": {"reproduced": True, "value": round(sens, 6), "how": "authors_call vs observed"},
        "specificity": {"reproduced": True, "value": round(spec, 6), "how": "authors_call vs observed"},
        "auc": {"reproduced": MODE == "claim_echo", "value": 0.80 if MODE == "claim_echo" else round(a_model, 6),
                "how": "as reported" if MODE == "claim_echo" else "pooled AUC of p_resistant"}},
    "flagged_records": [{"subject": r["subject"], "cycle": int(r["cycle"]), "reason": "no prediction"} for r in unscored],
    "comparators": [{"id": cid, "definition": cdef, "auc": round(a_comp, 6),
                     "auc_model_minus_comparator": None if MODE == "lazy_skeptic" else round(a_model - a_comp, 6),
                     "ci95": None, "scores_file": f"outputs/comparator_{cid}.csv"}],
    "adopt_model": MODE != "lazy_skeptic",
    "extra": {},
}
with open("results.json", "w") as fh:
    json.dump(res, fh, indent=2)
with open("REPORT.md", "w") as fh:
    fh.write(f"# Naive audit ({MODE})\n\nSee results.json.\n")
