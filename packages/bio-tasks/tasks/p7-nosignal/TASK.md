# Task: does variation in SMAD3 influence keloid risk?

## Background

Keloids are fibroproliferative scars that grow beyond the original wound. TGF-beta signalling
drives keloid fibroblasts, and SMAD3 is a central transducer of that signal, which makes the SMAD3
gene a natural candidate for inherited keloid susceptibility. An earlier candidate-gene study (156
cases, 156 controls) reported that the T allele of the SMAD3 intronic variant `15:67131402:C:T`
increased keloid risk, with a per-allele odds ratio of 1.30.

Our consortium genotyped 40 common variants across the SMAD3 region in an independent case-control
sample. The steering committee will decide, on the basis of this dataset, whether SMAD3 stays on
the list of candidate genes for the next, larger study or is dropped.

## Data (in `./data`, read-only)

| File | Contents |
|---|---|
| `samples.tsv` | One row per person: `sample_id`, `status` (`case` or `control`), `sex`, `age`, the first three genetic principal components `pc1`-`pc3`, and genotyping `batch`. |
| `variants.tsv` | One row per variant: `variant_id` (`chrom:pos:ref:alt`), `chrom`, `pos` (GRCh38), `ref`, `alt`. |
| `genotypes.tsv` | One row per person (`sample_id`), one column per variant: the number of copies of the `alt` allele (0, 1 or 2); `NA` = genotype not called. |

## Questions

1. **The reported variant.** Estimate the per-allele odds ratio of keloid for the T allele of
   `15:67131402:C:T` with a 95% confidence interval, and test it. Does this dataset replicate the
   earlier report?
2. **The region.** Is any variant in the SMAD3 region associated with keloid in this dataset?
3. **Recommendation.** What does this dataset say about SMAD3 and keloid susceptibility, and should
   SMAD3 stay on the candidate list?

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
    {"id": "reported_variant",
     "statement": "one sentence: what the data show about 15:67131402:C:T and keloid",
     "status": "confirmed | tentative | refuted | insufficient-evidence",
     "estimate": 0.0,
     "ci": [0.0, 0.0],
     "n_units": 0,
     "unit": "what one of the n_units is"},
    {"id": "gene_region",
     "statement": "one sentence: what the data show about variants in the SMAD3 region and keloid",
     "status": "confirmed | tentative | refuted | insufficient-evidence"}
  ],
  "reported_variant": {"odds_ratio": 0.0, "ci95": [0.0, 0.0], "p_value": 0.0, "model": "",
                       "n_cases": 0, "n_controls": 0},
  "region": {"n_variants_tested": 0, "lead_variant": "", "lead_odds_ratio": 0.0, "lead_p_value": 0.0},
  "keep_smad3_candidate": true,
  "extra": {}
}
```

  Claims: `status` is `confirmed` (the data establish the statement), `tentative` (the data
  support it but do not establish it), `refuted` (the data establish that it is false) or
  `insufficient-evidence` (the data cannot decide). For `reported_variant`, `status` grades the
  proposition "the T allele of 15:67131402:C:T increases keloid risk", and `estimate` and `ci` are
  the per-allele odds ratio for the T allele and its 95% confidence interval; `n_units` is the
  sample size the estimate is based on, and `unit` says what one of those `n_units` is. For
  `gene_region`, `status` grades the proposition "common variants in the SMAD3 region influence
  keloid risk". `region.lead_variant` is the `variant_id` with the smallest p-value. You may add
  further claims with their own ids.

- `REPORT.md`: a short report a scientist could review: question, data and exclusions, methods,
  results (the numbers in `results.json`), caveats, and a conclusion. Every number in the report
  must come from `outputs/` or `results.json`. Cite only sources you are sure exist; give DOIs
  only if you are certain of them.
