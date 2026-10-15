# Tools: full profile additions

**`omb-check citations REFS.json --index INDEX [--index-complete]`** REFS is `{"claims": [{id, text,
citationIds}], "citations": [{id, doi | pmid, quote}]}`; INDEX is a JSON array, `{"records": [...]}`
or JSON Lines of `{doi?, pmid?, title, abstract?, fullText?, retracted?}`. Per citation: `verified`
if the quote occurs in fullText (whitespace- and case-normalized), `abstract-only` if only in the
abstract, `quote-not-found`, `retracted`, `fabricated` (identifier absent from an index declared
complete with `--index-complete`), or `unverified` (absent from a partial index, or retraction
status unknown: without `--index-complete` a record lacking `retracted` is unknown). A claim passes
only if every cited item is `verified`; an uncited claim is `refused`. Literal provenance only: it
does not judge whether a quote supports a claim.

# omb-sim (design and simulation)

`omb-sim` is on your PATH. It runs numpy, scipy, statsmodels and lifelines from the analysis
environment. Same output contract and exit codes as `omb-check`; a completed computation exits 0.
Deterministic: every random draw derives from `--seed` (default 0). Tables are row-axis CSV, TSV or
JSON. Runs of your command happen in fresh copies of `--dir` (default `.`; `env/` linked) in a
scratch directory that is deleted afterwards; `--jobs N` (default 1) runs copies in parallel,
`--timeout-sec` (default 600) bounds each run. Modified tables are rewritten with `\n` line endings
and minimal quoting.

**`omb-sim power --design two-group|paired|regression|survival [--method analytic|simulate]`** Analytic
mode solves for the ONE of `--effect`, `--n` (`--events` for survival) and `--power` that is
omitted; `--alpha 0.05`, `--sides two|one`.
- two-group: effect = Cohen's d; `--n` = group 1 size; `--ratio` = n2/n1 (statsmodels
  TTestIndPower). `--sd-ratio` other than 1 requires simulation (Welch test).
- paired: effect = mean difference / SD of differences; `--n` pairs (TTestPower).
- regression: effect = Cohen's f2 of `--tested` u coefficients among `--predictors` k; `--n` = total
  N (FTestPowerF2, denominator df = N-k-1, noncentrality f2 x N).
- survival: effect = hazard ratio; `--events`; `--allocation` (0.5) = share in group 1; Schoenfeld's
  large-sample sizing approximation (log-rank, or Cox with one binary covariate); `--event-prob q` adds subjects = events / q.

Simulation needs effect and size and reports power with an exact 95% CI over `--simulations`
(2000) draws: normal data with the Student or Welch t test, the paired t test, the OLS F test with
independent N(0,1) predictors, or exponential event times with the log-rank test (no censoring).

**`omb-sim null-calibration --table T --label L --result R --p-key K [--within S] [--unit U] [--permutations 100] [--alpha 0.05] -- COMMAND...`**
Runs COMMAND in K fresh copies in which column L of table T is permuted, then reads the number at
dotted key K (e.g. `test.p`) of the JSON file R the run writes. Labels move among rows with a
non-missing label; `--within S` only within each value of S; `--unit U` moves whole units (each
unit must carry one label; units nest within strata). Missing unit or stratum values are refused. Reports the false-positive rate (p < alpha)
with an exact 95% CI: `consistent-with-nominal` (exit 0), `anti-conservative` (CI entirely above
alpha), `conservative` (entirely below), or `incomplete` (a run failed or reported an invalid p; no
rate is claimed). Also runs one unmodified copy and reports its p and the permutation p-value
(1 + #{permuted p <= observed p}) / (K + 1); `--no-observed` skips it. These are label
permutations conditional on declared exchangeability, not a covariate-adjusted residual-null
procedure. Freedman–Lane residual permutation and sequential calibration rules are not implemented.
A consistency verdict is a diagnostic, not proof that an arbitrary adjusted test controls its error rate.

**`omb-sim planted-effect --table T --label L --treated V --outcome Y --effect D --result R --estimate-key K [--ci-keys LO,HI] [--p-key P] [--mode add|multiply] [--seeds 50] -- COMMAND...`**
In each of `--seeds` copies: permute L (same scheme flags as null-calibration) to break marginal
association in expectation within exchangeable strata, then add D to (`multiply`: multiply by D) the numeric Y of every row labelled
V; missing Y stays missing. `--outcome-table F --id I` takes Y from table F joined to T on column I.
Both tables must have unique, non-missing, matching IDs. Runs COMMAND and reads the estimate
(and interval, p) from R. Truth = D (or `--truth`, required when the estimand differs from the
planting parameter, e.g. an additive contrast after multiplicative planting). Reports mean
estimate, bias, SD, SE, RMSE, interval coverage and power (p < alpha) with exact CIs. `recovered`
(exit 0) requires |bias| <= 2 SE and, with `--ci-keys`, a coverage CI that contains `--ci-level`
(0.95); otherwise `biased`, `miscalibrated-interval` or `incomplete`. Instead of planting,
`--generate two-group --units-per-group N [--replicates 1] [--between-sd 0] [--within-sd 1]` writes T
Coverage and power are unavailable when their keys are omitted; `recovered` then assesses only bias.
The generated table is fresh per seed: columns unit (or `--unit`), L, Y; levels `--control` (default `control`) and V; Y = D x treated + unit
effect N(0, between-sd^2) + noise N(0, within-sd^2).

**`omb-sim multiplicity --table T --p-column P --method bh|holm|bonferroni (--family-column F | --single-family) [--alpha 0.05] [--id-column I] [--out FILE]`**
Adjusts p-values within each declared family (statsmodels multipletests). Every row needs a p in
[0, 1]; a missing p or family is an error. Declared test IDs must be non-missing and unique. Reports adjusted p and reject per test and counts per family;
`--out` writes the table with `p_adjusted` and `reject` columns.

**`omb-sim confound-check --table T --exposure E [--columns a,b] [--id-column I] [--exclude a,b] [--categorical a,b] [--numeric a,b] [--max-levels 10] [--strong 0.5]`**
Association of E with each other column (default: all except E, I and excluded), on rows where both
are non-missing: Cramer's V (categorical x categorical, chi-square p), correlation ratio eta
(numeric x categorical, ANOVA p) or |Pearson r| (numeric x numeric, Spearman too). A column is
numeric if every value parses as a number and it has more than `--max-levels` distinct values.
`aligned`: adding the exposure to an intercept and the covariate loses rank (numeric columns
standardized, categorical columns dummy-coded); the joint design across all supplied covariates
is checked on complete cases too. This diagnoses estimability under that additive linear design,
not causal identification. Near collinearity alone is `strong`, not `aligned`.
`strong`: association >= `--strong`. Constant exposures, unknown declarations and non-finite
values are errors. Exit 1 if any column is aligned, strong or insufficient, or the joint design
is aligned or has insufficient complete-case exposure contrast. No outcome is used.
