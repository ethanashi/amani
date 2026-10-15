"""Naive analysis: logistic regression on cells, random 80/20 split of cells, test-set AUC."""
import json

import numpy as np
from scipy.stats import rankdata


def tsv(name):
    rows = open(f"data/{name}").read().splitlines()
    return rows[0].split("\t"), [r.split("\t") for r in rows[1:]]


_, cells = tsv("cells.tsv")
head, erows = tsv("expression.tsv")
_, donors = tsv("donors.tsv")
status = {d[0]: d[1] for d in donors}
donor_of = {c[0]: c[1] for c in cells}
X = np.array([[float(v) for v in r[1:]] for r in erows])
y = np.array([1.0 if status[donor_of[r[0]]] == "SLE" else 0.0 for r in erows])

rng = np.random.default_rng(1)
perm = rng.permutation(len(y))
cut = int(0.8 * len(y))
tr, te = perm[:cut], perm[cut:]
m, s = X[tr].mean(0), X[tr].std(0)
s[s == 0] = 1.0
Z = np.hstack([np.ones((len(X), 1)), (X - m) / s])
w = np.zeros(Z.shape[1])
for _ in range(100):
    p = 1 / (1 + np.exp(-(Z[tr] @ w)))
    step = np.linalg.solve((Z[tr] * (p * (1 - p))[:, None]).T @ Z[tr] + np.eye(len(w)), Z[tr].T @ (p - y[tr]) + w)
    w -= step
    if np.abs(step).max() < 1e-10:
        break


def auc(yy, ss):
    r = rankdata(ss)
    n1 = yy.sum()
    return float((r[yy == 1].sum() - n1 * (n1 + 1) / 2) / (n1 * (len(yy) - n1)))


sc = Z[te] @ w
est = auc(y[te], sc)
boots = []
for _ in range(500):
    i = rng.integers(0, len(te), len(te))
    boots.append(auc(y[te][i], sc[i]))
lo, hi = np.percentile(boots, [2.5, 97.5])
top = [head[1:][i] for i in np.argsort(-np.abs(w[1:]))[:5]]
res = {
    "claims": [{"id": "cell_auc", "statement": "A cell's expression profile predicts disease status almost perfectly",
                "status": "confirmed", "estimate": round(est, 6), "ci": [round(float(lo), 6), round(float(hi), 6)],
                "n_units": int(len(te)), "unit": "cell (held-out test cells)"}],
    "classifier": {"model": "logistic regression", "n_features": int(X.shape[1]),
                   "evaluation": "random 80/20 split of cells"},
    "top_genes": top,
    "develop_diagnostic": bool(est >= 0.8),
    "extra": {},
}
json.dump(res, open("results.json", "w"), indent=2)
json.dump({"auc": est}, open("outputs/auc.json", "w"))
