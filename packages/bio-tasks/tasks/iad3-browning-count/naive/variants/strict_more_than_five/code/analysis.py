"""Calibration fixture: naive applications of the inclusion rule.

    python code/analysis.py zeros_counted | strict_more_than_five | visits_not_measurements

zeros_counted            counts every recorded PSA value, including the exported 0.00 values, as a measurement
strict_more_than_five    reads "fewer than five" as requiring more than five
visits_not_measurements  counts visits on and off treatment, whether or not PSA was recorded
"""
import csv
import json
import sys

MODE = sys.argv[1]
with open("data/psa_series.csv", newline="") as fh:
    rows = list(csv.DictReader(fh))
series = {}
for r in rows:
    series.setdefault(r["subject"], []).append(r)
need = 6 if MODE == "strict_more_than_five" else 5


def counts(r):
    if MODE == "visits_not_measurements":
        return True
    if r["psa"] == "":
        return False
    return MODE == "zeros_counted" or float(r["psa"]) > 0


kept = sorted(s for s, rs in series.items()
              if sum(1 for r in rs if counts(r) and r["on_treatment"] == "1") >= need
              and sum(1 for r in rs if counts(r) and r["on_treatment"] == "0") >= need)
res = {"claims": [{"id": "cohort_size", "statement": f"The rule keeps {len(kept)} of {len(series)} patients",
                   "status": "confirmed", "estimate": len(kept), "n_units": len(series), "unit": "patient"}],
       "n_series": len(series), "n_kept": len(kept), "kept_subjects": kept, "extra": {}}
with open("results.json", "w") as fh:
    json.dump(res, fh, indent=2)
