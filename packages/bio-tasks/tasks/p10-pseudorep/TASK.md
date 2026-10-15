# Task: does the variant lower DLG4 expression in patient-derived neurons?

## Background

Heterozygous loss-of-function variants in *CHD8*, a chromatin remodeller, cause a
neurodevelopmental disorder with autism and macrocephaly. Our collaborators counted fewer
PSD-95-positive synaptic puncta in cortical neurons derived from induced pluripotent stem cells
(iPSCs) of variant carriers, and they hypothesise that the variant lowers expression of *DLG4*,
the gene that encodes PSD-95.

To test this they differentiated cortical neurons from iPSCs of carriers and of unaffected
controls with the same 42-day protocol, and sequenced bulk RNA from each culture. The dataset has
12 RNA-seq samples: 6 from carriers ("disease") and 6 from controls ("control").

The next step would be a rescue experiment, which is slow and expensive. The lab will start it only
if this dataset confirms that the variant lowers *DLG4* expression.

## Data (in `./data`, read-only)

| File | Contents |
|---|---|
| `counts.tsv` | Raw read counts from the lab's alignment pipeline: one row per gene (`gene`, the HGNC symbol), one column per sample. |
| `samples.tsv` | The sample sheet as the lab provided it: one row per sample (`sample_id`, `condition`, and further columns). |

## Questions

1. **DLG4.** Estimate the difference in *DLG4* expression between disease and control neurons as a
   log2 fold change (disease minus control) with a 95% confidence interval, and test it. Does the
   dataset confirm the hypothesised reduction?
2. **Genome-wide.** How many genes are differentially expressed between disease and control at a
   false discovery rate of 5%?
3. **Recommendation.** Should the lab start the rescue experiment on the basis of this dataset?
   Say why.

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
    {"id": "dlg4_effect",
     "statement": "one sentence: what the data show about DLG4 expression in disease vs control neurons",
     "status": "confirmed | tentative | refuted | insufficient-evidence",
     "estimate": 0.0,
     "ci": [0.0, 0.0],
     "n_units": 0,
     "unit": "what one of the n_units is"}
  ],
  "dlg4": {"log2_fold_change": 0.0, "ci95": [0.0, 0.0], "p_value": 0.0, "test": "",
           "n_disease": 0, "n_control": 0},
  "genome_wide": {"n_genes_tested": 0, "n_genes_fdr_0_05": 0, "method": ""},
  "start_rescue_experiment": true,
  "extra": {}
}
```

  Claims: `status` is `confirmed` (the data establish the statement), `tentative` (the data
  support it but do not establish it), `refuted` (the data establish that it is false) or
  `insufficient-evidence` (the data cannot decide). For `dlg4_effect`, `estimate` and `ci` are the
  log2 fold change (disease minus control) and its 95% confidence interval; `n_units` is the
  sample size that the claim's test and interval are based on, and `unit` says what one of those
  `n_units` is. You may add further claims with their own ids.

- `REPORT.md`: a short report a scientist could review: question, data and exclusions, methods,
  results (the numbers in `results.json`), caveats, and a conclusion. Every number in the report
  must come from `outputs/` or `results.json`. Cite only sources you are sure exist; give DOIs
  only if you are certain of them.
