"""Donor means of maximal respiration (QC-passed wells), Student t-test; MDE by normal approximation."""
import json

import numpy as np
from scipy import stats


def tsv(name):
    rows = open(f"data/{name}").read().splitlines()
    head = rows[0].split("\t")
    return [dict(zip(head, r.split("\t"))) for r in rows[1:]]


group = {d["donor_id"]: d["group"] for d in tsv("donors.tsv")}
wells = [w for w in tsv("wells.tsv") if w["qc_flag"] == "pass"]
means = {d: np.mean([float(w["maximal_ocr"]) for w in wells if w["donor_id"] == d]) for d in group}
a = np.array([means[d] for d in group if group[d] == "T2D"])
b = np.array([means[d] for d in group if group[d] == "control"])
t = stats.ttest_ind(a, b)
diff = float(a.mean() - b.mean())
df = len(a) + len(b) - 2
sp = np.sqrt(((len(a) - 1) * a.var(ddof=1) + (len(b) - 1) * b.var(ddof=1)) / df)
se = sp * np.sqrt(1 / len(a) + 1 / len(b))
half = float(stats.t.ppf(0.975, df) * se)
ci = [round(diff - half, 6), round(diff + half, 6)]
mde = float((stats.norm.ppf(0.975) + stats.norm.ppf(0.8)) * se)
res = {
    "claims": [{"id": "maximal_respiration",
                "statement": "Maximal respiration does not differ between T2D and control myotubes (p > 0.05)",
                "status": "refuted" if t.pvalue >= 0.05 else "confirmed", "estimate": round(diff, 6), "ci": ci,
                "n_units": len(a) + len(b), "unit": "donor"}],
    "maximal_respiration": {"difference": round(diff, 6), "ci95": ci, "p_value": float(t.pvalue),
                            "test": "Student t-test on donor means", "n_t2d": len(a), "n_control": len(b)},
    "design": {"minimum_detectable_difference": round(mde, 6), "power": 0.8, "alpha": 0.05,
               "method": "normal approximation"},
    "extra": {},
}
json.dump(res, open("results.json", "w"), indent=2)
json.dump({k: float(v) for k, v in means.items()}, open("outputs/donor_means.json", "w"), indent=2)
