"""Naive analysis-set derivation: every expression sample whose patient has overall survival
(non-missing OS_MONTHS >= 0 and a LIVING/DECEASED status) counts as one patient. Only the sample
IDs on the expression header are read; profiles are never compared."""
import csv
import json

with open("data/expression_mrna.tsv") as fh:
    samples = fh.readline().rstrip("\n").split("\t")[2:]
s2p = {r["SAMPLE_ID"]: r["PATIENT_ID"] for r in csv.DictReader(open("data/clinical_sample.tsv"), delimiter="\t")}
clin = {r["PATIENT_ID"]: r for r in csv.DictReader(open("data/clinical_patient.tsv"), delimiter="\t")}
n = events = 0
for s in samples:
    p = clin.get(s2p.get(s, ""))
    if p is None:
        continue
    try:
        t = float(p["OS_MONTHS"])
    except (TypeError, ValueError):
        continue
    if p["OS_STATUS"] not in ("0:LIVING", "1:DECEASED") or t < 0:
        continue
    n += 1
    events += p["OS_STATUS"] == "1:DECEASED"
res = {
    "n_patients_analyzed": n, "n_events": events,
    "score_method": "not computed (calibration fixture)",
    "proliferation_metagene": {"definition": "not computed", "n_genes": 0},
    "random_signatures": [], "published_signatures": [],
    "negative_control": {"description": "not computed", "share_p_lt_0_05": None},
    "conclusion": {"random_rate_similar_to_published": None, "proliferation_adjustment_removes_most": None},
    "extra": {},
}
json.dump(res, open("results.json", "w"), indent=2)
json.dump({"n": n, "events": events}, open("outputs/counts.json", "w"))
