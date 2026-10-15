# Pre-treatment program and early non-response

An inflammatory gut disease. Colonic biopsies were taken before the first dose of a biologic, and each patient was later classified as a responder or a non-responder. A published analysis reports three things: a pre-treatment gene-expression program predicts early non-response; the prediction replicates in held-out data from each of three cohorts (A, C and D), each cohort held out in turn with the genes selected in the other two; and the program still separates the outcome groups after adjustment for a reference pathway score.

Question: does the published claim hold up in these data? Report the held-out effect size under the protocol below, its comparison with the published three-cohort design, the adjusted check, and the data-integrity section of the report template.

## Data (offline, one look)

- `<cohort>-expression.tsv`: processed probe-level array intensities (not log-transformed; values with more than three decimals were rounded to three); probes with at least one mapped gene in rows, biopsies in columns.
- `<cohort>-samples.tsv`: one row per biopsy with its patient, its outcome (`responder` or `non-responder`) and the outcome definition used by that cohort.
- `B-probe-genes.tsv`: probe-to-gene map (several genes for one probe are separated by `;`).
- `B-gene-sets.tsv`: membership of reference pathway gene sets with keyed names, one gene per row.

## Held-out effect size (use this protocol so that answers are comparable)

Use leave-one-unit-out validation over the units of analysis you use (report them in the data-integrity section). Each unit serves once as the held-out fold and otherwise as training data:

1. Work on log2 intensities; treat non-positive intensities as missing. Within each cohort, keep the probes that map to exactly one gene and collapse them to genes by keeping, for each gene, the probe with the highest mean log2 intensity.
2. For each held-out unit, select the genes that are higher in non-responders at nominal two-sided p < 0.05 (two-group moderated t-test, non-responders versus responders) in every training unit (all units except the held-out one).
3. Score every biopsy of the held-out unit as the mean within-cohort z-score of the selected genes.
4. In each held-out fold, compute Hedges' g of the score (non-responders minus responders). Pool the folds, one per unit, with DerSimonian-Laird random effects.

Also reproduce the published three-cohort design with the same steps: each of the three cohorts is held out in turn, with the genes selected in both other cohorts.

## Adjusted check

In each of your held-out folds, regress the held-out score by ordinary least squares on the outcome (1 = non-responder, 0 = responder) and on the sample-level score of gene set `L24` (the mean within-cohort z-score of its genes after the same probe-to-gene collapse). Report the outcome coefficient and its p-value per fold.

## Report template

Fill every field; only the fields listed under Report below are graded. Placeholders in angle brackets stand for your values.

```
{
  "direction": "<allowed value>",
  "effect_size": {
    "folds": [{"held_out": "<dataset letter(s)>", "g": <JSON number>, "se": <JSON number>}],
    "n_folds": <JSON number>,
    "pooled_g": <JSON number>,
    "pooled_ci95": [<JSON number>, <JSON number>],
    "three_cohort_g": <JSON number>,
    "three_cohort_comparison": "<allowed value>"
  },
  "adjusted": {
    "folds": [{"held_out": "<dataset letter(s)>", "outcome_coef": <JSON number>, "outcome_p": <JSON number>}],
    "outcome_effect": "<allowed value>"
  },
  "data_integrity": {
    "duplicated_or_overlapping": ["<dataset letter>"],
    "n_duplicated_or_overlapping_pairs": <JSON number>,
    "other_problems": ["<free text>"],
    "units_of_analysis": "<free text>"
  },
  "verdict": "<allowed value>"
}
```

Data-integrity fields: `duplicated_or_overlapping` = duplicated or overlapping units/samples found (list; empty if none); `n_duplicated_or_overlapping_pairs` = number of duplicated or overlapping sample pairs found (0 if none); `other_problems` = other data-quality problems found (list; empty if none); `units_of_analysis` = units of analysis used.

## Files

- `data/A-expression.tsv`
- `data/A-samples.tsv`
- `data/B-gene-sets.tsv`
- `data/B-probe-genes.tsv`
- `data/C-expression.tsv`
- `data/C-samples.tsv`
- `data/D-expression.tsv`
- `data/D-samples.tsv`
- `data/gene-aliases.tsv`
- `data/probe-aliases.tsv`
- `data/sample-aliases.tsv`
- `data/subject-aliases.tsv`
- `DATA-CONTRACT.json` (columns, roles, precision and identifier namespaces)

## Report

Write `report.json`: a single JSON object. Only these fields are graded; each field is a JSON
pointer into that object.

- `/direction` (criterion `direction`): exactly one of `higher-in-non-responders`, `higher-in-responders`, `no-consistent-difference`. Sign of Hedges' g (non-responders minus responders) across your held-out folds: higher-in-non-responders if positive in every fold, higher-in-responders if negative in every fold, otherwise no-consistent-difference.
- `/data_integrity/duplicated_or_overlapping` (criterion `duplicated-or-overlapping`): a list of distinct dataset letters. Duplicated or overlapping units/samples found (list; empty if none), given as the dataset letter of every cohort that holds at least one of them.
- `/data_integrity/n_duplicated_or_overlapping_pairs` (criterion `duplicated-or-overlapping-pairs`): a number. Number of duplicated or overlapping sample pairs found (a JSON number; 0 if none).
- `/effect_size/n_folds` (criterion `held-out-folds`): a number. Number of held-out folds pooled in your estimate, one per unit of analysis (a JSON number).
- `/effect_size/pooled_g` (criterion `pooled-effect`): a number. Pooled held-out Hedges' g (non-responders minus responders) over your held-out folds, following the protocol (a JSON number).
- `/effect_size/three_cohort_comparison` (criterion `three-cohort-comparison`): exactly one of `higher`, `lower`, `similar`. Pooled g of the published three-cohort design, reproduced with the same protocol, relative to your pooled g: higher or lower when they differ by more than 0.1, otherwise similar.
- `/adjusted/outcome_effect` (criterion `adjusted-outcome-effect`): exactly one of `every-fold`, `no-fold`, `some-folds`. Held-out folds in which the outcome coefficient of the adjusted regression is positive (non-responders higher) with p < 0.05: every-fold, no-fold or some-folds.
- `/verdict` (criterion `overall`): exactly one of `does-not-hold-up`, `holds-up`. Whether the published claim stated at the top of this task holds up in these data.

Identifiers, dataset names and category levels are keyed tokens. Report identifiers exactly as
they appear in the data files. Grading returns only each criterion name with pass or fail.
