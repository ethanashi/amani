# METABRIC: ERBB2 and HER2 copy number

Estimate the ERBB2 expression contrast for HER2 SNP6 copy-number GAIN versus NEUTRAL primary breast tumors. Use the supplied normalized microarray expression values on their supplied scale. Exposure is 1 for HER2_SNP6 GAIN and 0 for NEUTRAL (an independent copy-number assay). Fit ordinary least squares with an intercept, exposure, and a fixed effect for cohort (cohort 1 is the reference). Report the exposure coefficient, its classical two-sided t test and 95% confidence interval. Is there evidence of an association in this dataset?

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
  "null": null,
  "extra": {}
}
```

Claim status is confirmed if the data establish the statement, tentative if they support it without establishing it, refuted if they establish it is false, or insufficient-evidence if they cannot decide.

- `REPORT.md`: question, data/exclusions, methods, results, caveats and conclusion. Every reported number must come from `results.json` or `outputs/`.
