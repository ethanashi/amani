# Task: rebuild a published analysis cohort from its inclusion rule

## Background

A cohort of men with prostate cancer was treated with intermittent androgen deprivation: treatment was
given in cycles, paused once PSA had fallen and restarted when PSA rose again. A 2026 modelling study of
this cohort states its inclusion rule as follows: "We exclude patients with fewer than five measurements
either on or off treatment from our analysis". That is, a patient is kept only if he has at least five
PSA measurements while on treatment and at least five PSA measurements while off treatment.

The study's input is the set of 101 patient series in `data/psa_series.csv`. A modelling team wants to
rebuild the study's analysis cohort exactly from these series.

## Data (in `./data`, read-only)

| File | Contents |
|---|---|
| `psa_series.csv` | One row per recorded visit of each of the 101 patients. |
| `README.md` | Columns and units. |

## Question

Apply the inclusion rule to the 101 patient series. How many patients are kept, and which ones?

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
    {"id": "cohort_size",
     "statement": "one sentence: how many of the 101 patients the inclusion rule keeps",
     "status": "confirmed | tentative | refuted | insufficient-evidence",
     "estimate": 0,
     "n_units": 0,
     "unit": "patient"}
  ],
  "n_series": 0,
  "n_kept": 0,
  "kept_subjects": ["S-001"],
  "extra": {}
}
```

  `n_series` is the number of patient series you read, `n_kept` the number kept, and
  `kept_subjects` the kept patients' `subject` values. For `cohort_size`, `estimate` is the number
  kept, `n_units` the number of patient series the rule was applied to, and `unit` what one of the
  `n_units` is. Claims: `status` is `confirmed` (the data establish the statement), `tentative` (the
  data support it but do not establish it), `refuted` (the data establish that it is false) or
  `insufficient-evidence` (the data cannot decide). You may add further claims with their own ids.

- `REPORT.md`: a short report: question, data, how you applied the rule and any judgment calls,
  the result, caveats. Every number in the report must come from `outputs/` or `results.json`.
