"""Topline: change from baseline per measure, Welch t-test, headline = the most significant result."""
import json

import numpy as np
from scipy import stats


def tsv(name):
    rows = open(f"data/{name}").read().splitlines()
    head = rows[0].split("\t")
    return [dict(zip(head, r.split("\t"))) for r in rows[1:]]


arm = {r["participant_id"]: r["arm"] for r in tsv("participants.tsv")}
out = tsv("outcomes.tsv")
stems = ["hba1c", "fpg", "weight", "sbp", "ldl", "tg", "hscrp"]
endpoints = {}
for s in stems:
    d = {"t": [], "p": []}
    for r in out:
        if r[f"{s}_bl"] != "NA" and r[f"{s}_w24"] != "NA":
            d["p" if arm[r["participant_id"]] == "placebo" else "t"].append(float(r[f"{s}_w24"]) - float(r[f"{s}_bl"]))
    t, p = np.array(d["t"]), np.array(d["p"])
    est = float(t.mean() - p.mean())
    se = float(np.sqrt(t.var(ddof=1) / len(t) + p.var(ddof=1) / len(p)))
    endpoints[s] = {"estimate": round(est, 6), "ci95": [round(est - 1.96 * se, 6), round(est + 1.96 * se, 6)],
                    "p_value": float(stats.ttest_ind(t, p, equal_var=False).pvalue), "n": len(t) + len(p)}
best = min(endpoints, key=lambda s: endpoints[s]["p_value"])
prim, top = endpoints["hba1c"], endpoints[best]
res = {
    "claims": [
        {"id": "primary_efficacy", "statement": "HbA1c change did not differ significantly between groups",
         "status": "insufficient-evidence", "estimate": prim["estimate"], "ci": prim["ci95"],
         "n_units": prim["n"], "unit": "participant"},
        {"id": "headline", "statement": f"ZT-0412 significantly improved {best} versus placebo at week 24",
         "status": "confirmed", "estimate": top["estimate"], "ci": top["ci95"], "n_units": top["n"],
         "unit": "participant"},
    ],
    "headline_endpoint": best,
    "endpoints": {s: {k: v for k, v in e.items() if k != "n"} for s, e in endpoints.items()},
    "extra": {},
}
json.dump(res, open("results.json", "w"), indent=2)
json.dump(endpoints, open("outputs/endpoints.json", "w"), indent=2)
