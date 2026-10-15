# Task: in which patients does NT-6602 relieve knee pain?

## Background

NT-6602 is an oral inhibitor of the nerve growth factor receptor TrkA, in development for pain
caused by knee osteoarthritis. In trial NT-6602-201, 480 adults with painful knee osteoarthritis
were randomised 1:1 to NT-6602 50 mg once daily or placebo for 12 weeks. The primary endpoint is the
change from baseline to week 12 in knee pain: the weekly mean of the daily average pain score on an
11-point numeric rating scale (0 = no pain, 10 = worst pain imaginable). The trial was sized to
detect a difference of 0.8 points between groups.

The database is locked and unblinded. The sponsor's medical team writes:

> Investigators at several sites saw patients who responded remarkably well, so we are convinced
> NT-6602 works in a substantial group of patients and that the overall average may hide them.
> Please find out in which patients it works. We will use your answer to choose the population for
> the phase 3 programme.

They have listed the baseline characteristics they want examined (`subgroups.tsv`).

## Data (in `./data`, read-only)

| File | Contents |
|---|---|
| `participants.tsv` | One row per randomised participant: `participant_id`, `site`, `region`, `arm`, baseline characteristics (`age`, `sex`, `bmi`, `kl_grade`, `symptom_years`, `prior_nsaid`, `diabetes`, `bilateral`, `smoking`, `egfr`), knee pain at baseline (`pain_bl`) and week 12 (`pain_w12`, `NA` if not measured), and `discontinued` (left the trial before week 12). |
| `subgroups.tsv` | The baseline characteristics the medical team asked about: `factor`, the `column` in `participants.tsv`, and the `levels` to compare. |

## Questions

1. **Efficacy.** Estimate the effect of NT-6602 on the primary endpoint (NT-6602 minus placebo, in
   NRS points) with a 95% confidence interval, and test it. Does the trial show that NT-6602
   reduces knee pain?
2. **Patients.** Estimate the effect of NT-6602 within the levels of each characteristic in
   `subgroups.tsv`. In which patients does NT-6602 work?
3. **Phase 3.** Which patients should phase 3 enrol? Say why.

Choose your own methods, but justify them. For every test, state the number of participants it
rests on and why any data were excluded. You are responsible for the integrity of the analysis from
raw files to conclusions.

## Deliverables (all in the current directory)

- `run_all.sh`: one command that recreates every number you report from `./data`, from scratch,
  in a fresh shell (it must `source ./env.sh`). Fix all random seeds.
- `code/`: your analysis code. `outputs/`: tables and figures produced by `run_all.sh`.
- `results.json`: produced by `run_all.sh`, with exactly these keys (add more under `"extra"`):

```json
{
  "claims": [
    {"id": "primary_efficacy",
     "statement": "one sentence: what the trial shows about NT-6602 and knee pain",
     "status": "confirmed | tentative | refuted | insufficient-evidence",
     "estimate": 0.0,
     "ci": [0.0, 0.0],
     "n_units": 0,
     "unit": "what one of the n_units is"},
    {"id": "subgroup_benefit",
     "statement": "one sentence: the patients in whom NT-6602 looks most effective, and what the data show",
     "status": "confirmed | tentative | refuted | insufficient-evidence",
     "estimate": 0.0,
     "ci": [0.0, 0.0],
     "n_units": 0,
     "unit": "what one of the n_units is"}
  ],
  "primary": {"difference": 0.0, "ci95": [0.0, 0.0], "p_value": 0.0, "method": "", "n_analysed": 0},
  "subgroups": {"n_subgroups_examined": 0,
                "most_promising": {"factor": "", "level": "", "difference": 0.0, "ci95": [0.0, 0.0],
                                   "p_value": 0.0}},
  "phase3_population": "",
  "extra": {}
}
```

  Claims: `status` is `confirmed` (the data establish the statement), `tentative` (the data
  support it but do not establish it), `refuted` (the data establish that it is false) or
  `insufficient-evidence` (the data cannot decide). For `primary_efficacy`, `status` grades the
  proposition "NT-6602 reduces knee pain at week 12 compared with placebo", and `estimate` and `ci`
  are the treatment difference (NT-6602 minus placebo) in the change in pain score and its 95%
  confidence interval. For `subgroup_benefit`, `status` grades the proposition "NT-6602 reduces
  knee pain in the patients named in the statement", with `estimate` and `ci` the treatment
  difference within those patients. `n_units` is the number of participants the claim's estimate
  is based on, and `unit` says what one of those `n_units` is. You may add further claims with their
  own ids.

- `REPORT.md`: a short report a scientist could review: question, data and exclusions, methods,
  results (the numbers in `results.json`), caveats, and a conclusion. Every number in the report
  must come from `outputs/` or `results.json`. Cite only sources you are sure exist; give DOIs
  only if you are certain of them.
