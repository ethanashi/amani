# P. aeruginosa swarming morphology

In a P. aeruginosa swarming analysis, what is the mean circularity measurement for the genotype showing the largest mean area? Use Swarm_1.csv. Group by Genotype; the unit is a dish. Report the selected genotype and its mean area alongside the answer. Report circularity to at least three decimal places and mean area to at least two decimal places.

## Deliverables

- `run_all.sh` must source `./env.sh` and recreate every reported number from `./data` in a fresh shell. Fix all random seeds.
- `code/`: analysis code; `outputs/`: generated tables or figures.
- `results.json`: exactly the schema below; additional content belongs under `extra`. Provide exactly one primary claim. `n_units` is the sample size used by the analysis, and `unit` names its unit.

```json
{
  "claims": [
    {
      "id": "primary",
      "statement": "one sentence answering the question",
      "status": "confirmed | tentative | refuted | insufficient-evidence",
      "estimate": 0.0,
      "n_units": 1,
      "unit": "dish"
    }
  ],
  "selection": {
    "genotype": "",
    "mean_area": 0.0
  },
  "extra": {}
}
```

Claim status is confirmed if the data establish the statement, tentative if they support it without establishing it, refuted if they establish it is false, or insufficient-evidence if they cannot decide.

- `REPORT.md`: question, data/exclusions, methods, results, caveats and conclusion. Every reported number must come from `results.json` or `outputs/`.
