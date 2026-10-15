# Task: can a single cell's profile tell patients from healthy people?

## Background

Systemic lupus erythematosus (SLE) is an autoimmune disease; many patients carry an interferon
response signature in their blood immune cells. A lab profiled peripheral blood mononuclear cells
(PBMCs) from 20 people, 10 with SLE and 10 healthy, by single-cell RNA-seq, and quantified a
targeted panel of 40 genes in every cell.

They want to know whether disease status can be read out from individual cells. If a cell's
expression profile predicts disease well (they consider an AUC of 0.80 or more useful), they will
develop a cell-based diagnostic test; otherwise they will not.

## Data (in `./data`, read-only)

| File | Contents |
|---|---|
| `cells.tsv` | One row per cell: `cell_id`, `donor_id`, `cell_type` (from the lab's clustering), `n_umi`, `n_genes_detected`. |
| `expression.tsv` | One row per cell (`cell_id`), one column per panel gene: log-normalised expression, log1p(counts per 10,000). |
| `donors.tsv` | One row per person: `donor_id`, `status` (`SLE` or `healthy`), `age`, `sex`. |

## Questions

1. **Prediction.** How well does a cell's expression profile predict disease status? Build a
   classifier and report its AUC with a 95% confidence interval. This is the headline result.
2. **Genes.** Which genes carry most of the predictive signal?
3. **Recommendation.** Should the lab develop the cell-based diagnostic? Say why.

Choose your own methods, but justify them. State which data each result uses and why any data
were excluded. You are responsible for the integrity of the analysis from raw files
to conclusions.

## Deliverables (all in the current directory)

- `run_all.sh`: one command that recreates every number you report from `./data`, from scratch,
  in a fresh shell (it must `source ./env.sh`). Fix all random seeds.
- `code/`: your analysis code. `outputs/`: tables and figures produced by `run_all.sh`.
- `results.json`: produced by `run_all.sh`, with exactly these keys (add more under `"extra"`):

```json
{
  "claims": [
    {"id": "cell_auc",
     "statement": "one sentence: how well a cell's profile predicts disease status",
     "status": "confirmed | tentative | refuted | insufficient-evidence",
     "estimate": 0.0,
     "ci": [0.0, 0.0],
     "n_units": 0,
     "unit": "what one of the n_units is"}
  ],
  "classifier": {"model": "", "n_features": 0, "evaluation": "how the AUC was estimated"},
  "top_genes": ["", ""],
  "develop_diagnostic": true,
  "extra": {}
}
```

  Claims: `status` is `confirmed` (the data establish the statement), `tentative` (the data
  support it but do not establish it), `refuted` (the data establish that it is false) or
  `insufficient-evidence` (the data cannot decide). For `cell_auc`, `estimate` and `ci` are the
  headline AUC and its 95% confidence interval; `n_units` is the sample size that the claim's
  interval is based on, and `unit` says what one of those `n_units` is. You may add further claims
  with their own ids.

- `REPORT.md`: a short report a scientist could review: question, data and exclusions, methods,
  results (the numbers in `results.json`), caveats, and a conclusion. Every number in the report
  must come from `outputs/` or `results.json`. Cite only sources you are sure exist; give DOIs
  only if you are certain of them.
