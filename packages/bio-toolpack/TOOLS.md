# Tools: omb-check

`omb-check` is on your PATH. It runs Omerta Bio's deterministic checks (the same code Omerta Bio's
own software runs) on files you name. Offline, deterministic, fail-closed.

**Output.** One JSON document on stdout (or in the file named by `--json-out FILE`; stdout then
gets the summary) and a one-line summary on stderr. Every document has `status`, `exitCode`,
`verified` and `summary`. **Exit codes:** `0` the check ran and found no problem; `1` it found a
problem or could not establish the property; `2` usage error or unreadable/malformed input, nothing
was checked. Only `0` means verified.

**Tables.** Single-table commands read one CSV, TSV or JSON (array of records) file; the format comes
from the extension or `--format`. Parsing is strict: ragged rows, blank or duplicate headers and bad
quoting are errors.
- `--axis rows` (default): one record per row; `--id-field F` is the unique, non-blank ID column.
- `--axis columns`: one record per column of a feature x record matrix. The first header names the
  feature column; `--feature-fields a,b` lists all leading annotation columns, starting with the
  first. Every other column is a record whose values must be numeric.
- Omitted `--axis`, `--id-field` or `--feature-fields` are inferred as `omb-check infer` reports
  (`--axis` falls back to rows); if no ID field can be inferred, the command exits 2 and asks for it.
- Identity fields (ID, `--donor-field` (default for `duplicates`, `near-duplicates` and
  `effective-units`: the inferred donor/patient column), `--cell-line-field`, a split field) are
  never compared as content; every other field is content.
- `--missing auto|none|T1,T2`: tokens marking a missing numeric value. `auto` (default): the
  standard markers (empty, `NA`, `N/A`, `NaN`, `null`, `[Not Available]`, `[Unknown]`,
  `[Not Applicable]`; case-insensitive) present in the file. `none`: any non-numeric value in a
  numeric vector is an error. Missing values are compared by position, never imputed.

**`omb-check duplicates TABLE [--tolerance T] [--vector-fields a,b] [--fields a,b]`** Records with
different IDs but identical content. Content is every non-identity field: on the column axis the
full numeric vector; on the row axis each field as exact text, except `--vector-fields`, compared as
numbers. `--tolerance 0` (default) is exact (-0 = +0); `T > 0` compares `round(x / T)`. Candidates
are hashed and every group is verified exactly. A record with fewer than min(3, width) informative
fields, or under half of its compared fields informative, is never merged and makes the status
`insufficient-information`. `--fields` compares only that subset. Status `no-duplicates` (exit 0),
`duplicates-found` or `insufficient-information`; `report.groups` lists the ID groups.

**`omb-check near-duplicates TABLE [--threshold 0.999] [--vector-fields a,b] [--max-candidate-pairs 50000]`**
Pairs whose numeric vectors have Pearson r > threshold but are not identical (suspected technical
replicates); numerically identical vectors are collapsed first and listed in `identicalGroups`
(also exit 1). Needs numeric vectors (column axis or `--vector-fields`); not run (exit 2) when
missing tokens are present. Exhaustive: a provable filter, then exact Pearson on every surviving
pair; more surviving pairs than the cap is inconclusive.

**`omb-check effective-units TABLE [--tolerance T] [--near-threshold R]`** Merges content duplicates
(and near duplicates with `--near-threshold`) transitively into units: `effectiveUnits.effectiveN`,
`inputN`, `units`, `representatives` (first member of each unit). Does not merge by donor. Exit 0
only if the effective n equals the number of records.

**`omb-check pseudorep TABLE --unit donor|cellLine|sample [--donor-field D] [--cell-line-field C] [--declared-n N]`**
Whether N (default: the number of rows) counts independent units. `donor` needs `--donor-field`
(effective n = distinct donors); `cellLine` needs `--cell-line-field`; `sample` needs
`--donor-field` and unique sample IDs, unique donors and no shared cell line. A row without the unit
field means not established. Exit 0 only if N <= effective n.

**`omb-check donor-split TABLE --split-field S --train A --test B --donor-field D`** Whether no donor
is in both train and test. Every split value must be A or B (else exit 2); an empty side or a row
without a donor is not verified.

**`omb-check infer DATA_DIR`** The validity declarations Omerta Bio's software infers for every file
directly in DATA_DIR (flat): format, axis, ID field, donor field, annotation fields, unit of
analysis, declared n, detected missing markers, or a refusal with its reason (ambiguous or absent
ID column). Exit 1 if any file is refused.

**`omb-check gates DATA_DIR [--handling collapse|stop] [--exploratory] [--review FILE]`** Omerta Bio's
automatic validity gates on every file in DATA_DIR using the inferred declarations: full-content
duplicates, pseudo-replication against the unit of analysis, near duplicates and donor-disjoint
split when declared. Duplicate samples from a sample table whose donor field is the ID of a donor
table in DATA_DIR merge only where that table confirms the same donor. A dataset is `allowed` only
with no split leakage, no suspected matches, and no duplicated or replicated units unless handling
is `collapse` (`--exploratory` without `--handling` collapses exact full-content duplicates when no
donor merge or near check is involved). Per dataset: `allowed`, `decision`, `effectiveN`, `rowCount`,
`units`, `findings`. Exit 0 only if every dataset is allowed. `--review FILE` is JSON `{handling?,
exploratory?, exclusions?: [{file, reason}], overrides?: [{file, field, value, justification}]}`;
overrides may only add `split` (`{field, train, test}`), `nearDuplicates` (`{threshold}`),
`vectorFields`, `compareFields` or `subsetJustification`. An excluded file is not checked.

**`omb-check reproduce [--dir D] [--clean p1,p2] [--only p1,p2] [--timeout-sec 3600] -- COMMAND...`**
Runs COMMAND twice, each in a fresh copy of D (default `.`; a top-level `env/` is linked, not
copied), after deleting the `--clean` and `--only` paths in the copy. Selected outputs must be
recreated by each command; cached outputs cannot establish reproduction. Outputs are the files inside the copy that
a run created, changed or deleted (or exactly `--only`); their sha256 is compared across the two
runs and with the same paths now in D: `reproduced` (exit 0), `nondeterministic` (the runs differ),
`mismatch` (the runs agree but differ from D), `missing` (absent from a run or from D),
`command-failed` or `no-outputs`. `runToRun` compares run 1 (as recorded) with run 2 alone:
`reproduced` if they agree, otherwise `mismatch` or `missing`.
