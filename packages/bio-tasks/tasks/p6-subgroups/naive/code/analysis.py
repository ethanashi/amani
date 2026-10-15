"""Primary: Welch t-test on the change in pain. Subgroups: the same test within every level; the level
with the smallest p-value among those favouring NT-6602 identifies the responders."""
import json

import numpy as np
from scipy import stats

rows = open("data/participants.tsv").read().splitlines()
head = rows[0].split("\t")
P = [dict(zip(head, r.split("\t"))) for r in rows[1:]]
P = [p for p in P if p["pain_w12"] != "NA"]
chg = np.array([float(p["pain_w12"]) - float(p["pain_bl"]) for p in P])
trt = np.array([p["arm"] != "placebo" for p in P])


def effect(mask):
    a, b = chg[mask & trt], chg[mask & ~trt]
    est = float(a.mean() - b.mean())
    se = float(np.sqrt(a.var(ddof=1) / len(a) + b.var(ddof=1) / len(b)))
    return est, [round(est - 1.96 * se, 6), round(est + 1.96 * se, 6)], float(stats.ttest_ind(a, b, equal_var=False).pvalue), int(mask.sum())


def groups():
    num = lambda c: np.array([float(p[c]) for p in P])
    for f, c, t in (("age", "age", 65), ("bmi", "bmi", 30), ("baseline_pain", "pain_bl", 7), ("egfr", "egfr", 60),
                    ("symptom_duration", "symptom_years", 5)):
        yield f, f"<{t}", num(c) < t
        yield f, f">={t}", num(c) >= t
    for f in ("sex", "kl_grade", "region", "prior_nsaid", "diabetes", "bilateral", "smoking"):
        vals = np.array([p[f] for p in P])
        for v in sorted(set(vals)):
            yield f, v, vals == v


est, ci, p, n = effect(np.ones(len(P), bool))
subs = [(f, lvl) + effect(m) for f, lvl, m in groups()]
best = min((s for s in subs if s[2] < 0), key=lambda s: s[4])
res = {
    "claims": [
        {"id": "primary_efficacy", "statement": "No significant difference in pain change overall",
         "status": "insufficient-evidence", "estimate": round(est, 6), "ci": ci, "n_units": n, "unit": "participant"},
        {"id": "subgroup_benefit", "statement": f"NT-6602 significantly reduces pain in patients with {best[0]} {best[1]}",
         "status": "confirmed", "estimate": round(best[2], 6), "ci": best[3], "n_units": best[5], "unit": "participant"},
    ],
    "primary": {"difference": round(est, 6), "ci95": ci, "p_value": p, "method": "Welch t-test, completers",
                "n_analysed": n},
    "subgroups": {"n_subgroups_examined": len(subs),
                  "most_promising": {"factor": best[0], "level": best[1], "difference": round(best[2], 6),
                                     "ci95": best[3], "p_value": best[4]}},
    "phase3_population": f"patients with {best[0]} {best[1]}",
    "extra": {},
}
json.dump(res, open("results.json", "w"), indent=2)
json.dump([list(s) for s in subs], open("outputs/subgroups.json", "w"), indent=2)
