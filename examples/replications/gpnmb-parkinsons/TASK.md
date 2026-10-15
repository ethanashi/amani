# Does genetically higher circulating protein P7 change the risk of Outcome A?

You are given genetic association summary statistics for one gene region: the gene that encodes **protein P7** (a circulating glycoprotein) plus about 500 kb on each side. Carry out a cis Mendelian randomisation and colocalisation analysis of P7 and Outcome A, and report the quantities listed below.

## Data

All four tables cover the same window. Chromosome labels are blinded and positions are shifted by one secret constant, so distances between variants are preserved and positions are comparable across tables. `variant` holds blinded identifiers: the same token means the same source identifier in every table (a cell may list several tokens separated by commas, or be empty). Alleles are real.

- Dataset C, table `protein-gwas`: association with P7 levels in about 2,900 European-ancestry adults. `beta` is per copy of `effect_allele`, in standard-deviation units of P7.
- Dataset B, table `outcome-gwas` (cohort **C1**): case-control GWAS meta-analysis of Outcome A (a binary disease) in European-ancestry samples. The effective sample size is about 125,000 for variants analysed in every contributing study; some variants were analysed in only part of the meta-analysis, and their standard errors are larger. `beta` is the log odds ratio per copy of `effect_allele`.
- Dataset D, table `outcome-gwas` (cohort **C2**): a separate case-control GWAS of Outcome A in European-ancestry samples, effective sample size about 23,000. `beta` is the log odds ratio per copy of `effect_allele`.
- Dataset A, table `reference-genotypes`: genotype dosages (copies of `counted_allele`: 0, 1 or 2) for 503 unrelated European-ancestry reference individuals (columns `ind001` to `ind503`), for linkage disequilibrium. It has no `variant` column; match it to the other tables on position and alleles.

## Conventions

- Harmonise the tables on position and allele pair and express every effect for the same allele. Drop palindromic variants (A/T or C/G) whose minor allele frequency in the protein table is above 0.42.
- The study group pre-specified variant V21461189 (the *reference variant*) as the instrument for the primary estimate.
- Colocalisation settings: Wakefield approximate Bayes factors with priors p1 = p2 = 1e-4 and p12 = 1e-5, prior standard deviation 0.15 for the protein effect (treat P7 as standardised) and 0.2 for the log odds ratio, using the variants within 50 kb (either side) of the reference variant. Choices not fixed by these settings are yours; describe the colocalisation analysis you ran in `coloc.method`.

## What to report (report.json)

1. Mendelian randomisation at the reference variant, per cohort. `mr.c1.wald_lnor` and `mr.c2.wald_lnor`: the Wald-ratio estimate, as the log odds ratio of Outcome A per 1-SD higher P7. `mr.c1.wald_ci_lower`, `mr.c1.wald_ci_upper`, `mr.c2.wald_ci_lower` and `mr.c2.wald_ci_upper`: the lower and upper bounds of its 95% confidence interval, using the first-order standard error (outcome standard error divided by the absolute protein effect). Each is a JSON number.
2. `direction`: your overall conclusion, one of `higher-decreases-risk`, `higher-increases-risk`, `no-detectable-effect`.
3. `replication`: how C2 compares with C1 at the reference variant: `concordant-not-weaker` (same sign, the C2 95% confidence interval excludes zero, and the C2 estimate is not smaller in absolute value than C1), `concordant-weaker` (same sign, the C2 interval excludes zero, and the C2 estimate is smaller), `not-significant` (same sign, the C2 interval includes zero) or `opposite-direction`.
4. Locus description. `locus.reference_variant_outcome`: `associated-in-both`, `associated-in-neither` or `associated-in-one`, according to whether the reference variant has an Outcome A p-value below 0.05 in C1 and in C2. `locus.n_significant_variants`: the number of variants (rows) in the protein table with a P7 p-value below 5e-8 (a JSON number). `locus.strongest_variant`: the `variant` token of the variant with the smallest P7 p-value in the protein table. `locus.strongest_variant_outcome`: the same three categories, for that variant. `locus.architecture`: `multiple-signals` if more than one independent signal is present (a signal counts as independent when its lead variant keeps a P7 p-value below 5e-8 after conditioning on the stronger signal or signals), or `single-signal` if the P7 associations in the protein table are explained by one association signal.
5. Colocalisation, per cohort. `coloc.c1.pp_h4` and `coloc.c2.pp_h4`: the posterior probability that P7 and Outcome A share one causal variant (a JSON number). `coloc.c1.verdict` and `coloc.c2.verdict`: `distinct-variants` (PP.H3 at least 0.8), `inconclusive` (otherwise) or `shared-variant` (PP.H4 at least 0.8). `coloc.method`: what you did, in prose.
6. Data integrity. Report the duplicated or overlapping units/samples found (list; empty if none), the other data-quality problems found (list; empty if none), and the units of analysis used.

Report template (placeholders in angle brackets; replace each with your value). Fill every field; only the fields listed under Report below are graded.

```
{
  "mr": {
    "c1": {"wald_lnor": <a JSON number>, "wald_ci_lower": <a JSON number>, "wald_ci_upper": <a JSON number>},
    "c2": {"wald_lnor": <a JSON number>, "wald_ci_lower": <a JSON number>, "wald_ci_upper": <a JSON number>}
  },
  "direction": "<higher-decreases-risk | higher-increases-risk | no-detectable-effect>",
  "replication": "<concordant-not-weaker | concordant-weaker | not-significant | opposite-direction>",
  "locus": {
    "reference_variant_outcome": "<associated-in-both | associated-in-neither | associated-in-one>",
    "n_significant_variants": <a JSON number>,
    "strongest_variant": "<variant token>",
    "strongest_variant_outcome": "<associated-in-both | associated-in-neither | associated-in-one>",
    "architecture": "<multiple-signals | single-signal>"
  },
  "coloc": {
    "c1": {"pp_h4": <a JSON number>, "verdict": "<distinct-variants | inconclusive | shared-variant>"},
    "c2": {"pp_h4": <a JSON number>, "verdict": "<distinct-variants | inconclusive | shared-variant>"},
    "method": "<short description>"
  },
  "integrity": {
    "duplicated_or_overlapping_units": [<identifier>, ...],
    "other_data_quality_problems": [<short description>, ...],
    "units_of_analysis": "<short description>"
  },
  "caveats": [<short description>, ...]
}
```

## Files

- `data/A-reference-genotypes.tsv`
- `data/B-outcome-gwas.tsv`
- `data/C-protein-gwas.tsv`
- `data/D-outcome-gwas.tsv`
- `data/snp-aliases.tsv`
- `DATA-CONTRACT.json` (columns, roles, precision and identifier namespaces)

## Report

Write `report.json`: a single JSON object. Only these fields are graded; each field is a JSON
pointer into that object.

- `/direction` (criterion `direction`): exactly one of `higher-decreases-risk`, `higher-increases-risk`, `no-detectable-effect`. Item 2: overall direction of the effect of genetically higher P7 on Outcome A.
- `/mr/c1/wald_lnor` (criterion `c1-wald`): a number. Item 1: Wald-ratio log odds ratio per 1-SD higher P7 at the reference variant, cohort C1 (a JSON number).
- `/mr/c2/wald_lnor` (criterion `c2-wald`): a number. Item 1: Wald-ratio log odds ratio per 1-SD higher P7 at the reference variant, cohort C2 (a JSON number).
- `/mr/c1/wald_ci_lower` (criterion `c1-ci-lower`): a number. Item 1: lower 95% confidence bound of the C1 Wald-ratio estimate, first-order standard error (a JSON number).
- `/mr/c1/wald_ci_upper` (criterion `c1-ci-upper`): a number. Item 1: upper 95% confidence bound of the C1 Wald-ratio estimate, first-order standard error (a JSON number).
- `/mr/c2/wald_ci_lower` (criterion `c2-ci-lower`): a number. Item 1: lower 95% confidence bound of the C2 Wald-ratio estimate, first-order standard error (a JSON number).
- `/mr/c2/wald_ci_upper` (criterion `c2-ci-upper`): a number. Item 1: upper 95% confidence bound of the C2 Wald-ratio estimate, first-order standard error (a JSON number).
- `/replication` (criterion `replication`): exactly one of `concordant-not-weaker`, `concordant-weaker`, `not-significant`, `opposite-direction`. Item 3: how the C2 estimate compares with C1 at the reference variant.
- `/locus/reference_variant_outcome` (criterion `reference-outcome`): exactly one of `associated-in-both`, `associated-in-neither`, `associated-in-one`. Item 4: Outcome A association (p < 0.05) of the reference variant in C1 and in C2.
- `/locus/n_significant_variants` (criterion `significant-count`): a number. Item 4: number of variants (rows) in the protein table with a P7 p-value below 5e-8 (a JSON number).
- `/locus/strongest_variant` (criterion `strongest-variant`): one identifier from namespace `snp`. Item 4: variant token with the smallest P7 p-value in the protein table.
- `/locus/strongest_variant_outcome` (criterion `strongest-outcome`): exactly one of `associated-in-both`, `associated-in-neither`, `associated-in-one`. Item 4: Outcome A association (p < 0.05) of that variant in C1 and in C2.
- `/locus/architecture` (criterion `architecture`): exactly one of `multiple-signals`, `single-signal`. Item 4: one or more independent P7 association signals in the protein table (independence rule as stated in item 4).
- `/coloc/c1/verdict` (criterion `c1-coloc`): exactly one of `distinct-variants`, `inconclusive`, `shared-variant`. Item 5: colocalisation verdict for P7 and Outcome A in C1.
- `/coloc/c1/pp_h4` (criterion `c1-pph4`): a number. Item 5: posterior probability of one shared causal variant (PP.H4) for P7 and Outcome A in C1 (a JSON number).
- `/coloc/c2/pp_h4` (criterion `c2-pph4`): a number. Item 5: posterior probability of one shared causal variant (PP.H4) for P7 and Outcome A in C2 (a JSON number).

Identifiers, dataset names and category levels are keyed tokens. Report identifiers exactly as
they appear in the data files. Grading returns only each criterion name with pass or fail.
