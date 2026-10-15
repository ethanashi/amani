# Task: is mitochondrial respiration lower in muscle cells from people with type 2 diabetes?

## Background

Several groups have proposed that skeletal muscle of people with type 2 diabetes (T2D) has an
intrinsic defect in mitochondrial respiration that persists when the cells are taken out of the
body. Our lab cultured primary myoblasts from vastus lateralis biopsies of donors with T2D and of
normoglycaemic donors, differentiated them into myotubes under identical conditions, and ran a
Seahorse XF mitochondrial stress test (oligomycin, FCCP, rotenone/antimycin A). The hypothesis is
that maximal (FCCP-stimulated) respiration is lower in myotubes from donors with T2D; reductions of
about 10-20% would be biologically important.

The lab will cite this experiment in a grant application, either as evidence that the defect is
intrinsic to muscle cells or as evidence against it, and it is deciding whether to recruit more
donors.

## Data (in `./data`, read-only)

| File | Contents |
|---|---|
| `donors.tsv` | One row per donor: `donor_id`, `group` (`T2D` or `control`), `sex`, `age`, `bmi`, `hba1c` (%), `passage` (myoblast passage used). |
| `wells.tsv` | One row per assay well, as exported from the Seahorse Wave report: `plate`, `assay_date`, `well`, `donor_id`, `protein_ug` (protein in the well), the stress-test parameters `basal_ocr`, `maximal_ocr`, `atp_linked_ocr`, `proton_leak_ocr` (each with non-mitochondrial respiration subtracted) and `nonmito_ocr`, all in pmol O2/min per µg protein, and Wave's `qc_flag`. |

## Questions

1. **Maximal respiration.** Estimate the difference in maximal respiration between T2D and control
   myotubes (T2D minus control, in pmol O2/min/µg protein) with a 95% confidence interval, and test
   it. Do the data show that maximal respiration is lower in T2D myotubes?
2. **Design.** What is the smallest true difference in maximal respiration that this experiment
   would detect with 80% power in a two-sided test at α = 0.05? The lab will use this to decide
   whether to recruit more donors.
3. **Conclusion.** What can the grant application say about this question on the basis of this
   experiment?

Choose your own methods, but justify them. For every test, state the sample size it rests on and
why any data were excluded. You are responsible for the integrity of the analysis from raw files to
conclusions.

## Deliverables (all in the current directory)

- `run_all.sh`: one command that recreates every number you report from `./data`, from scratch,
  in a fresh shell (it must `source ./env.sh`). Fix all random seeds.
- `code/`: your analysis code. `outputs/`: tables and figures produced by `run_all.sh`.
- `results.json`: produced by `run_all.sh`, with exactly these keys (add more under `"extra"`):

```json
{
  "claims": [
    {"id": "maximal_respiration",
     "statement": "one sentence: what the data show about maximal respiration in T2D versus control myotubes",
     "status": "confirmed | tentative | refuted | insufficient-evidence",
     "estimate": 0.0,
     "ci": [0.0, 0.0],
     "n_units": 0,
     "unit": "what one of the n_units is"}
  ],
  "maximal_respiration": {"difference": 0.0, "ci95": [0.0, 0.0], "p_value": 0.0, "test": "",
                          "n_t2d": 0, "n_control": 0},
  "design": {"minimum_detectable_difference": 0.0, "power": 0.8, "alpha": 0.05, "method": ""},
  "extra": {}
}
```

  Claims: `status` is `confirmed` (the data establish the statement), `tentative` (the data
  support it but do not establish it), `refuted` (the data establish that it is false) or
  `insufficient-evidence` (the data cannot decide). For `maximal_respiration`, `status` grades the
  proposition "maximal respiration is lower in myotubes from donors with T2D than from control
  donors", and `estimate` and `ci` are the difference (T2D minus control, pmol O2/min/µg protein)
  and its 95% confidence interval; `n_units` is the sample size that the claim's test and interval
  are based on, and `unit` says what one of those `n_units` is. `n_t2d` and `n_control` count the
  same units. `design.minimum_detectable_difference` is the answer to question 2, as a positive
  number in pmol O2/min/µg protein, with `power` 0.8 and `alpha` 0.05. You may add further claims
  with their own ids.

- `REPORT.md`: a short report a scientist could review: question, data and exclusions, methods,
  results (the numbers in `results.json`), caveats, and a conclusion. Every number in the report
  must come from `outputs/` or `results.json`. Cite only sources you are sure exist; give DOIs
  only if you are certain of them.
