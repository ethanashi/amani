# Expression and a binary phenotype

Assess whether the binary phenotype (exposure 1 versus 0) is associated with ESR1 expression in these breast-tumor records. Fit ordinary least squares with an intercept, exposure, and cohort fixed effects. Report its coefficient, classical two-sided t test and 95% confidence interval. Also assess the association with a conditional randomization test: permute exposure within cohort, retain group sizes, and refit the same coefficient; use 499 draws from NumPy default_rng(519901), traversing sorted cohort values on each draw. Report the null coefficient mean, sample standard deviation (ddof=1), and the two-sided Monte Carlo p value (include the observed statistic via the plus-one correction). Include all 499 null coefficients in `null.coefficients` so the summaries and plus-one correction can be verified. Use the supplied expression scale.

`data/observations.tsv` has one tumor per patient. `sample_id` identifies records, `cohort` identifies the study cohort, `exposure` encodes the binary comparison, and `expression` is the target measurement. Where present, `batch` is the processing batch and `quality` is a continuous assay quality score. Use complete cases and describe exclusions.

In `analysis.covariates`, list column names used besides exposure and intercept. If the requested coefficient cannot be estimated, set identifiable=false and estimate, ci95, p_value, and the corresponding claim estimate/ci to null; explain why in the report. Otherwise use finite numbers. The `null` field is null unless a randomization analysis was requested.

## Deliverables

- `run_all.sh` must source `./env.sh` and recreate every reported number from `./data` in a fresh shell. Fix all random seeds.
- `code/`: analysis code; `outputs/`: generated tables or figures.
- `results.json`: exactly the schema below; additional content belongs under `extra`. Provide exactly one primary claim. `n_units` is the sample size used by the analysis, and `unit` names its unit.

```json
{
  "claims": [
    {
      "id": "primary",
      "statement": "one sentence describing the association",
      "status": "confirmed | tentative | refuted | insufficient-evidence",
      "estimate": 0.0,
      "ci": [
        0.0,
        0.0
      ],
      "n_units": 1,
      "unit": "patient"
    }
  ],
  "analysis": {
    "estimate": 0.0,
    "ci95": [
      0.0,
      0.0
    ],
    "p_value": 0.0,
    "n_units": 1,
    "covariates": [
      "cohort"
    ],
    "identifiable": true,
    "method": "describe the fitted model"
  },
  "null": {
    "p_value": 0.0,
    "mean": 0.0,
    "sd": 0.0,
    "draws": 499,
    "seed": 519901,
    "coefficients": []
  },
  "extra": {}
}
```

Claim status is confirmed if the data establish the statement, tentative if they support it without establishing it, refuted if they establish it is false, or insufficient-evidence if they cannot decide.

- `REPORT.md`: question, data/exclusions, methods, results, caveats and conclusion. Every reported number must come from `results.json` or `outputs/`.
