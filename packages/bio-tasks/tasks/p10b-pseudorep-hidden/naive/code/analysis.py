"""Naive DLG4 analysis: log2 CPM, Welch t-test of 6 disease vs 6 control libraries."""
import json

import numpy as np
from scipy import stats

rows = open("data/counts.tsv").read().splitlines()
sids = rows[0].split("\t")[1:]
genes = [r.split("\t", 1)[0] for r in rows[1:]]
counts = np.array([[int(v) for v in r.split("\t")[1:]] for r in rows[1:]], dtype=float)
sheet = open("data/samples.tsv").read().splitlines()
head = sheet[0].split("\t")
cond = {d["sample_id"]: d["condition"] for d in (dict(zip(head, ln.split("\t"))) for ln in sheet[1:])}
dis = np.array([cond[s] == "disease" for s in sids])
lc = np.log2((counts + 0.5) / (counts.sum(0) + 1.0) * 1e6)

y = lc[genes.index("DLG4")]
t = stats.ttest_ind(y[dis], y[~dis], equal_var=False)
est = float(y[dis].mean() - y[~dis].mean())
se = float(np.sqrt(y[dis].var(ddof=1) / dis.sum() + y[~dis].var(ddof=1) / (~dis).sum()))
lo, hi = est - 1.96 * se, est + 1.96 * se

expressed = lc.mean(1) > 1.0
p = stats.ttest_ind(lc[expressed][:, dis], lc[expressed][:, ~dis], axis=1, equal_var=False).pvalue
o = np.argsort(p)
q = np.minimum.accumulate((p[o] * len(p) / np.arange(1, len(p) + 1))[::-1])[::-1]
n_fdr = int((q < 0.05).sum())

confirmed = bool(t.pvalue < 0.05 and est < 0)
res = {
    "claims": [{"id": "dlg4_effect", "statement": "DLG4 expression is reduced in disease neurons",
                "status": "confirmed" if confirmed else "refuted", "estimate": round(est, 6),
                "ci": [round(lo, 6), round(hi, 6)], "n_units": int(len(sids)), "unit": "RNA-seq sample"}],
    "dlg4": {"log2_fold_change": round(est, 6), "ci95": [round(lo, 6), round(hi, 6)],
             "p_value": float(t.pvalue), "test": "Welch t-test on log2 CPM",
             "n_disease": int(dis.sum()), "n_control": int((~dis).sum())},
    "genome_wide": {"n_genes_tested": int(expressed.sum()), "n_genes_fdr_0_05": n_fdr,
                    "method": "Welch t-test per gene, Benjamini-Hochberg"},
    "start_rescue_experiment": confirmed,
    "extra": {},
}
json.dump(res, open("results.json", "w"), indent=2)
json.dump(res["dlg4"], open("outputs/dlg4.json", "w"), indent=2)
