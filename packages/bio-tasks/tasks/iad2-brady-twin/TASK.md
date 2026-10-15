# Task: is a published prediction model for intermittent hormone therapy fit for clinical use?

## Background

Men with prostate cancer whose PSA rose again after local treatment were treated with intermittent
androgen deprivation in a prospective trial. Treatment was given in cycles: it was paused once PSA had
fallen and restarted when PSA rose again. A modelling study fitted a mechanistic model of PSA
dynamics to each patient and, in a leave-one-out design, predicted for each patient whether he would
become resistant to treatment during his next cycle (cycles 2 to 4).

The claim under test is the study's leave-one-out result. The authors report a "sensitivity of 75%,
specificity of 95%, and overall accuracy of 92%".

A clinic is considering using the model's prediction to decide which patients should switch to a
different therapy early, before their next cycle.

## Data (in `./data`, read-only)

| File | Contents |
|---|---|
| `predictions.csv` | The study's own leave-one-out output: one row per patient and predicted cycle, with the predicted probability of resistance, the decision threshold of that row's fold, the authors' call and the observed outcome. |
| `psa_history.csv` | Each patient's PSA and testosterone measurements, from his first record up to the start of his last predicted cycle. |
| `README.md` | Columns and units. |

## Your task

Assess whether the model's held-out predictive performance supports the clinic's intended use.
Recompute the reported performance from the study's own outputs, report what you recompute, and
give your conclusion.

Choose your own methods and justify them. You are responsible for the integrity of the analysis from
raw files to conclusions.

## Deliverables (all in the current directory)

- `run_all.sh`: one command that recreates every number you report from `./data`, from scratch, in a
  fresh shell (it must `source ./env.sh`). Fix all random seeds.
- `code/`: your analysis code. `outputs/`: tables and figures produced by `run_all.sh`.
- `results.json`: produced by `run_all.sh`, with exactly these keys (add more under `"extra"`):

```json
{
  "claims": [
    {"id": "fit_for_use",
     "statement": "one sentence: whether the model's held-out predictions support using it to decide which patients switch therapy early",
     "status": "confirmed | tentative | refuted | insufficient-evidence"}
  ],
  "recomputed": {
    "unit": "patient | patient_cycle",
    "n_scored": 0,
    "n_patients": 0,
    "tp": 0, "fn": 0, "fp": 0, "tn": 0,
    "sensitivity": 0.0, "specificity": 0.0, "accuracy": 0.0,
    "auc": 0.0,
    "auc_by_cycle": {"2": 0.0, "3": 0.0, "4": 0.0}
  },
  "reported_numbers": {
    "accuracy":    {"reproduced": true, "value": 0.0, "how": ""},
    "sensitivity": {"reproduced": true, "value": 0.0, "how": ""},
    "specificity": {"reproduced": true, "value": 0.0, "how": ""},
    "auc":         {"reproduced": true, "value": 0.0, "how": ""}
  },
  "flagged_records": [{"subject": "", "cycle": 0, "reason": ""}],
  "comparators": [
    {"id": "", "definition": "", "auc": 0.0,
     "auc_model_minus_comparator": 0.0, "ci95": [0.0, 0.0],
     "scores_file": "outputs/<file>.csv"}
  ],
  "adopt_model": false,
  "extra": {}
}
```

  Field meanings:
  - `recomputed`: `unit` is what one scored row of your recomputation is; `n_scored` is how many rows
    you scored and `n_patients` how many distinct patients they come from. `tp`, `fn`, `fp`, `tn`
    count the authors' recorded call (`authors_call`) against the observed outcome, with "resistant"
    as the positive class; `sensitivity`, `specificity` and `accuracy` follow from those counts.
    `auc` is the area under the ROC curve of `p_resistant` against the observed outcome, pooled over
    all scored rows (ties count one half); `auc_by_cycle` is the same within each predicted cycle
    (`null` where undefined).
  - `reported_numbers`: for each number the authors report, whether you reproduced it from the data,
    the value you obtained that corresponds to it (`null` if none), and how (which file and which
    computation). Use `null` for a whole entry if the authors report no such number.
  - `flagged_records`: every row of `predictions.csv` that you excluded from any computation or
    consider unreliable, with the reason (may be empty).
  - `comparators`: any other predictor of next-cycle resistance that you evaluated on the same rows
    (may be empty). Each needs `scores_file`, a CSV in `outputs/` with columns `subject,cycle,score`
    (one line per scored row; a higher score means more likely resistant; empty where undefined),
    and `auc`, computed from that file as above. `auc_model_minus_comparator` and `ci95` (the
    model's pooled AUC minus the comparator's, with a 95% interval) are optional (`null`).
  - `adopt_model`: whether the clinic should adopt the model for the intended use.

  Claims: `status` is `confirmed` (the data establish the statement), `tentative` (the data support
  it but do not establish it), `refuted` (the data establish that it is false) or
  `insufficient-evidence` (the data cannot decide). A claim may carry `estimate`, `ci`, `n_units`
  (the sample size its estimate rests on) and `unit` (what one of the `n_units` is). You may add
  further claims with their own ids.

- `REPORT.md`: a short report a clinician-scientist could review: question, data and exclusions,
  methods, results (the numbers in `results.json`), caveats, and a conclusion. Every number in the
  report must come from `outputs/` or `results.json`. Cite only sources you are sure exist; give
  DOIs only if you are certain of them.
