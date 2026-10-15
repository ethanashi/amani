You have eight tables of genetic association summary statistics. All eight cover the same one-megabase window of one chromosome, in cohorts of the same continental ancestry. Every identifier has been replaced by an opaque code: variant labels, the chromosome label, the allele labels, and the base-pair positions (positions keep their original ordering but not their original spacing). The recoding is consistent across all eight tables, so one variant code, one allele code and one position mean the same thing in every table.

One table, whose file name ends in `-exposure.tsv`, is an association study of a single continuous molecular trait measured in blood. Its `beta` is the change in that trait, in standard-deviation units, per copy of `effect_allele`.

The seven other tables, whose file names end in `-outcome.tsv`, are case/control association studies of seven different binary clinical outcomes in large cohorts. Their `beta` is the log odds ratio per copy of `effect_allele`. Nothing further is disclosed about what the seven outcomes are, and nothing further is needed. Refer to each outcome table by the single letter that prefixes its file name, written exactly as the file name prints it (an upper-case letter).

Every table has the columns `variant`, `chromosome`, `position`, `effect_allele`, `other_allele`, `beta`, `standard_error`, `eaf`. The tables do not all hold the same variants. P-values are deliberately withheld; derive everything you need from `beta` and `standard_error`.

Your question: does genetically predicted LOWERING of the exposure trait change the risk of these seven outcomes, and if it does, is the effect of similar size on all of them or concentrated on a few?

Follow this procedure exactly, so that your numbers are comparable with the reference analysis.

1. Keep only variants that appear in all eight tables.
2. Instrument: the one variant with the largest absolute value of `beta` divided by `standard_error` in the exposure table. Break ties by the lexicographically smallest variant code. Use this single variant for every estimate in steps 3 to 7; do not combine several variants into one instrument, and do not substitute another estimator.
3. Let b_e and s_e be that variant's exposure estimate and standard error. For each outcome table, let b_o and s_o be the same variant's outcome estimate and standard error, expressed against the same `effect_allele`; if an outcome table reports the allele pair the other way round, negate its estimate first.
4. The log odds ratio per one standard deviation LOWER exposure is L = -b_o / b_e, with standard error s = s_o / |b_e|. The odds ratio is exp(L), and its interval runs from exp(L - 1.96*s) to exp(L + 1.96*s).
5. Classify every outcome: `harmful` when the whole interval lies above one, `inconclusive` when it is neither of the other two cases, `protective` when the whole interval lies below one.
6. Rank the seven outcomes by |L|, largest first. Break ties by the alphabetically smallest table letter.
7. Let S be the outcomes you classified harmful or protective. When S holds at least two outcomes, let h be the member of S with the largest |L| and m the member with the smallest |L|, and let the gap ratio be R = |L_h| / |L_m|. Treating the two outcome estimates as independent, the interval for R runs from R*exp(-1.96*w) to R*exp(1.96*w), with w = sqrt((s_o_h/b_o_h)^2 + (s_o_m/b_o_m)^2).
8. Your conclusion is `gap` when S holds at least two outcomes, R is at least two, and the lower end of the interval for R is above one; `inconclusive` when S holds fewer than two outcomes; `no-gap` when S holds at least two outcomes but that does not hold.

Write `report.json`: a single JSON object of exactly this shape.

```
{
  "instrument": {"n_shared": <number>, "top_variants": ["<variant code>", "<variant code>", "<variant code>", "<variant code>", "<variant code>"]},
  "ranked": [
    {"dataset": "<letter>", "or": <number>, "ci_low": <number>, "ci_high": <number>, "classification": "<harmful|inconclusive|protective>"}
  ],
  "ratio": {"estimate": <number>, "ci_low": <number>, "ci_high": <number>},
  "conclusion": "<gap|inconclusive|no-gap>",
  "data_integrity": {
    "duplicate_units": ["<short description>"],
    "other_problems": ["<short description>"],
    "units_of_analysis": "<short description>"
  }
}
```

Everything inside angle brackets is a placeholder for a value you compute; never copy a placeholder into your report. Each `<number>` must be a JSON number, not a string.

`instrument.n_shared` is how many variants you kept at step 1, as a JSON number. `instrument.top_variants` holds the five variants with the largest absolute `beta` divided by `standard_error` in the exposure table, among the variants kept at step 1, as the codes printed in the data. `ranked` holds exactly seven entries, in the rank order of step 6, each naming its outcome table by the letter that prefixes its file name, copied exactly as the file name prints it. Report the odds ratio and interval of step 4 and the classification of step 5 for every outcome. If your S holds fewer than two outcomes, set every field of `ratio` to zero.

`data_integrity.duplicate_units` lists any duplicated or overlapping units or samples you found (an array of strings; an empty array if you found none). `data_integrity.other_problems` lists any other data-quality problems you found (an array of strings; an empty array if you found none). `data_integrity.units_of_analysis` states in one short string the units of analysis your numbers are computed over.

Show the files you read and the code you ran.

## Files

- `data/A-outcome.tsv`
- `data/B-outcome.tsv`
- `data/C-outcome.tsv`
- `data/D-outcome.tsv`
- `data/E-exposure.tsv`
- `data/F-outcome.tsv`
- `data/G-outcome.tsv`
- `data/H-outcome.tsv`
- `data/snp-aliases.tsv`
- `DATA-CONTRACT.json` (columns, roles, precision and identifier namespaces)

## Report

Write `report.json`: a single JSON object. Only these fields are graded; each field is a JSON
pointer into that object.

- `/instrument/top_variants` (criterion `q01`): a list of distinct identifiers from namespace `snp`. The five variants reported as the strongest candidate instruments in the exposure table.
- `/ranked/0/dataset` (criterion `q02`): one dataset letter. The outcome table reported in first place by effect magnitude.
- `/ranked/1/dataset` (criterion `q03`): one dataset letter. The outcome table reported in second place by effect magnitude.
- `/ranked/2/dataset` (criterion `q04`): one dataset letter. The outcome table reported in third place by effect magnitude.
- `/ranked/0/or` (criterion `q05`): a number. The odds ratio reported for the first-placed outcome.
- `/ranked/1/or` (criterion `q06`): a number. The odds ratio reported for the second-placed outcome.
- `/ranked/2/or` (criterion `q07`): a number. The odds ratio reported for the third-placed outcome.
- `/ratio/estimate` (criterion `q08`): a number. The value reported as the ratio estimate.
- `/ratio/ci_low` (criterion `q09`): a number. The value reported as the lower end of the interval for the ratio.
- `/ranked/0/classification` (criterion `q10`): exactly one of `harmful`, `inconclusive`, `protective`. The classification reported for the first-placed outcome.
- `/ranked/1/classification` (criterion `q11`): exactly one of `harmful`, `inconclusive`, `protective`. The classification reported for the second-placed outcome.
- `/ranked/2/classification` (criterion `q12`): exactly one of `harmful`, `inconclusive`, `protective`. The classification reported for the third-placed outcome.
- `/ranked/3/classification` (criterion `q13`): exactly one of `harmful`, `inconclusive`, `protective`. The classification reported for the fourth-placed outcome.
- `/ranked/4/classification` (criterion `q14`): exactly one of `harmful`, `inconclusive`, `protective`. The classification reported for the fifth-placed outcome.
- `/ranked/5/classification` (criterion `q15`): exactly one of `harmful`, `inconclusive`, `protective`. The classification reported for the sixth-placed outcome.
- `/ranked/6/classification` (criterion `q16`): exactly one of `harmful`, `inconclusive`, `protective`. The classification reported for the seventh-placed outcome.
- `/conclusion` (criterion `q17`): exactly one of `gap`, `inconclusive`, `no-gap`. The conclusion reported at step 8.
- `/instrument/n_shared` (criterion `q18`): one JSON string, number or boolean. The count reported as the number of variants kept at step 1.

Identifiers, dataset names and category levels are keyed tokens. Report identifiers exactly as
they appear in the data files. Grading returns only each criterion name with pass or fail.
