"""Allelic chi-square test and allelic odds ratio per variant."""
import json

import numpy as np
from scipy import stats

s = open("data/samples.tsv").read().splitlines()
case = {r.split("\t")[0]: r.split("\t")[1] == "case" for r in s[1:]}
g = open("data/genotypes.tsv").read().splitlines()
vids = g[0].split("\t")[1:]
rows = [r.split("\t") for r in g[1:]]
y = np.array([case[r[0]] for r in rows])
G = np.array([[np.nan if v == "NA" else float(v) for v in r[1:]] for r in rows])


def allelic(j):
    ok = ~np.isnan(G[:, j])
    a1, a0 = G[ok & y, j].sum(), G[ok & ~y, j].sum()
    r1, r0 = 2 * (ok & y).sum() - a1, 2 * (ok & ~y).sum() - a0
    orr = a1 * r0 / (a0 * r1)
    se = np.sqrt(1 / a1 + 1 / a0 + 1 / r1 + 1 / r0)
    p = stats.chi2_contingency([[a1, r1], [a0, r0]], correction=False)[1]
    return float(orr), [float(np.exp(np.log(orr) - 1.96 * se)), float(np.exp(np.log(orr) + 1.96 * se))], float(p), int(ok.sum()), int((ok & y).sum())


rep = vids.index("15:67131402:C:T")
orr, ci, p, n, nc = allelic(rep)
res_all = [allelic(j) for j in range(len(vids))]
lead = int(np.argmin([r[2] for r in res_all]))
res = {
    "claims": [
        {"id": "reported_variant", "statement": "The reported association does not replicate: no effect of the T allele",
         "status": "refuted" if p >= 0.05 else "confirmed", "estimate": round(orr, 6), "ci": [round(c, 6) for c in ci],
         "n_units": n, "unit": "person"},
        {"id": "gene_region", "statement": f"SMAD3 variant {vids[lead]} is associated with keloid (p < 0.05)",
         "status": "confirmed" if res_all[lead][2] < 0.05 else "refuted"},
    ],
    "reported_variant": {"odds_ratio": round(orr, 6), "ci95": [round(c, 6) for c in ci], "p_value": p,
                         "model": "allelic chi-square", "n_cases": nc, "n_controls": n - nc},
    "region": {"n_variants_tested": len(vids), "lead_variant": vids[lead],
               "lead_odds_ratio": round(res_all[lead][0], 6), "lead_p_value": res_all[lead][2]},
    "keep_smad3_candidate": res_all[lead][2] < 0.05,
    "extra": {},
}
json.dump(res, open("results.json", "w"), indent=2)
json.dump({v: r[2] for v, r in zip(vids, res_all)}, open("outputs/pvalues.json", "w"), indent=2)
