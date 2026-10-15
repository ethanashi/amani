A prior report states that conditions C10 and C15 differ extensively in expression: many features reach 5% FDR after quantile normalisation, empirical-Bayes batch adjustment protecting condition, and limma.

The prior pipeline, as described by its authors, used every sample and every condition at each step:
1. quantile normalisation of the whole expression matrix;
2. empirical-Bayes location/scale batch adjustment (parametric priors), with batch as the batch variable and condition (all levels) as the protected covariate;
3. a limma linear model with one coefficient per condition, the contrast C15 subtracted from C10, moderated t statistics and Benjamini-Hochberg FDR.

Does this claim hold up? You have the expression matrix (features in rows, samples in columns, values already on a log2 scale, not normalised) and a sample sheet that gives each sample's batch and condition. Re-run the prior pipeline as described. Then analyse the comparison in the way you consider sound, starting from the quantile-normalised values of step 1 (every later choice is yours), and report counts, methods and verdict.

Counts are numbers of features with Benjamini-Hochberg adjusted p < 0.05 for C10 versus C15. Where a field asks for the features with the smallest p-values, rank them by the p-value of the C10 versus C15 comparison, smallest first.

Fill every graded field listed under Report below. Also include these ungraded fields in `report.json`:
- `/data_integrity/other_problems`: other data-quality problems found (a list of short strings; empty if none);
- `/data_integrity/units_of_analysis`: units of analysis used (a string);
- `/methods`: your methods, in prose (a string).

## Files

- `data/A-expression.tsv`
- `data/A-samples.tsv`
- `data/probe-aliases.tsv`
- `data/sample-aliases.tsv`
- `DATA-CONTRACT.json` (columns, roles, precision and identifier namespaces)

## Report

Write `report.json`: a single JSON object. Only these fields are graded; each field is a JSON
pointer into that object.

- `/verdict` (criterion `verdict`): exactly one of `does-not-hold-up`, `holds-up`. Does the prior claim hold up, that is, is the extent of difference reported by the prior pipeline supported by a sound analysis of these data?
- `/cause` (criterion `cause`): exactly one of `batch-adjustment-step`, `linear-model-step`, `mislabelled-samples`, `multiple-testing-step`, `outlier-samples`, `true-difference`. Main source of the prior pipeline's feature count. batch-adjustment-step, linear-model-step or multiple-testing-step: the count is mainly an artifact created at that step of the prior pipeline, judged against a sound analysis of the same quantile-normalised values; mislabelled-samples or outlier-samples: the count is mainly due to a problem with the samples; true-difference: the count reflects a real difference between the conditions.
- `/reproduced_count` (criterion `reproduced-count`): a number. Count from your own re-run of the prior pipeline exactly as described (a JSON number).
- `/reproduced_top_features` (criterion `reproduced-top`): a list of distinct identifiers from namespace `probe`. The ten features with the smallest p-values in your own re-run of the prior pipeline (feature identifiers as in the data).
- `/final_count` (criterion `final-count`): a number. Count from your own final, preferred analysis of C10 versus C15 (a JSON number).
- `/final_batch_handling` (criterion `final-batch-handling`): exactly one of `in-model`, `none`, `pre-adjusted`. How batch enters your final analysis. in-model: batch, in any form, appears in the final test model (whether or not the values were also adjusted beforehand); none: batch is not used; pre-adjusted: the final test is run on values that were batch-adjusted beforehand, and batch does not appear in the final test model.
- `/design/first_condition_batches` (criterion `first-condition-batches`): a list of distinct levels of column `batch`. Batches that contain at least one sample of condition C10 (batch labels as in the sample sheet).
- `/design/second_condition_batches` (criterion `second-condition-batches`): a list of distinct levels of column `batch`. Batches that contain at least one sample of condition C15 (batch labels as in the sample sheet).
- `/data_integrity/duplicated_units` (criterion `duplicated-units`): a list of distinct identifiers from namespace `sample`. Duplicated or overlapping units/samples found (list of sample identifiers; empty list if none).

Identifiers, dataset names and category levels are keyed tokens. Report identifiers exactly as
they appear in the data files. Grading returns only each criterion name with pass or fail.
