# Cohort X: a muscle splicing signature

Cohort X is a bulk RNA-seq study of human muscle tissue collected at several sites. You receive three tables:

- `data/A-psi.tsv`: one row per alternative-splicing event, one column per sample. Each cell is the event's percent spliced in (PSI, a fraction from 0 to 1, given to 2 decimal places); `n/a` means not quantified in that sample.
- `data/A-events.tsv`: the type of each event (`SE` skipped exon, `MXE` mutually exclusive exons, `ALTSS` alternative 5' or 3' splice site, `RI` retained intron).
- `data/A-samples.tsv`: for each sample, the donor (coded), the group, the muscle (coded), the tissue class (coded), the collection site (coded) and the collection type (`biopsy` or `autopsy`).

Groups: `G0` = unaffected controls; `G1` = an inherited neuromuscular disorder (the index disorder); `G2` = a related inherited disorder; `G3` = a different inherited muscle disease (the comparator).

Question: does muscle from the index disorder carry a reproducible splicing signature, how specific is it to that disorder, does it track clinical severity, and how far do the results generalise? Use the definitions below so that results are comparable.

Arithmetic convention: medians and differences of PSI values are exact multiples of 0.005. Round every group median and every dPSI to 3 decimal places, and every f (step 3) to 4 decimal places, before using them in any threshold, ranking, median or ratio. This removes floating-point noise.

1. Discovery. Compare `G1` with `G0` among the `biopsy` samples of muscle `M12` collected at site `site1`. Keep events with a PSI value in at least 75% of the samples of each of the two groups. For each kept event, dPSI_disc = median PSI in `G1` minus median PSI in `G0`. Test each kept event with a two-sided Mann-Whitney U test, using the normal approximation with tie correction and continuity correction (an event whose values are all tied gets p = 1), and apply the Benjamini-Hochberg correction across all kept events. The signature is the set of events with |dPSI_disc| >= 0.20 and q < 0.05. Report the number of signature events. Rank the signature events by |dPSI_disc|, largest first (ties: smaller p first), and report the top 50, split by the sign of dPSI_disc.

2. Replication. For the signature events, compute dPSI_rep the same way (same 75% rule) for `G1` versus `G0` among the `biopsy` samples of muscle `M06` collected at site `site3`. Over the signature events kept at both sites, report the Spearman correlation between dPSI_disc and dPSI_rep, the magnitude ratio median(|dPSI_rep|) / median(|dPSI_disc|), and a verdict: `replicates` if the Spearman correlation is positive with a two-sided p < 0.05, otherwise `does-not-replicate`.

3. Comparator. For each signature event, f = (median PSI over all `G3` samples minus median PSI over all `G0` samples of tissue class `T1`, from any site or collection type) / dPSI_disc, applying the same 75% rule within each of those two groups. An f near 0 means the comparator looks like controls for that event; an f near 1 means it looks like the index disorder. Report the median f, the specific core (the signature events with f < 0.25), and a verdict: `specific` if more than half of the signature events with a computable f fall in the specific core, otherwise `not-specific`.

4. Related disorder. Compute the same f with the `G2` samples of tissue class `T1` in place of `G3`, and report its median.

5. Severity. Does the index-disorder signature track clinical severity across patients? Answer one of:
   - `does-not-track-severity`: the data allow the test, and the signature is not associated with severity;
   - `not-testable`: the data do not allow the test;
   - `tracks-severity`: the data allow the test, and the signature is associated with severity.

6. Scope. For each of steps 1 to 4, state whether its result supports conclusions about the conditions compared in general (`generalisable`) or describes only the particular individuals sampled (`sample-only`).

7. Data integrity. Report the duplicated or overlapping units/samples found (list; empty if none), the other data-quality problems found (list; empty if none), and the units of analysis used.

Report template (placeholders in angle brackets; replace each with your value):

```
{
  "discovery":   {"n_signature": <a JSON number>,
                  "top50_increased": [<event identifier>, ...],
                  "top50_decreased": [<event identifier>, ...]},
  "replication": {"spearman_rho": <a JSON number>,
                  "magnitude_ratio": <a JSON number>,
                  "verdict": "<does-not-replicate | replicates>"},
  "comparator":  {"median_f": <a JSON number>,
                  "specific_core": [<event identifier>, ...],
                  "specificity": "<not-specific | specific>"},
  "related":     {"median_f": <a JSON number>},
  "severity":    {"verdict": "<does-not-track-severity | not-testable | tracks-severity>"},
  "scope":       {"discovery": "<generalisable | sample-only>",
                  "replication": "<generalisable | sample-only>",
                  "comparator": "<generalisable | sample-only>",
                  "related": "<generalisable | sample-only>"},
  "integrity":   {"duplicated_or_overlapping_units": [<identifier>, ...],
                  "other_data_quality_problems": [<short description>, ...],
                  "units_of_analysis": "<short description>"}
}
```

## Files

- `data/A-events.tsv`
- `data/A-psi.tsv`
- `data/A-samples.tsv`
- `data/donor-aliases.tsv`
- `data/event-aliases.tsv`
- `data/sample-aliases.tsv`
- `DATA-CONTRACT.json` (columns, roles, precision and identifier namespaces)

## Report

Write `report.json`: a single JSON object. Only these fields are graded; each field is a JSON
pointer into that object.

- `/discovery/n_signature` (criterion `n-signature`): a number. Step 1: the number of signature events (a JSON number).
- `/discovery/top50_increased` (criterion `top50-increased`): a list of distinct identifiers from namespace `event`. Step 1: the top-50 signature events with a positive dPSI_disc.
- `/discovery/top50_decreased` (criterion `top50-decreased`): a list of distinct identifiers from namespace `event`. Step 1: the top-50 signature events with a negative dPSI_disc.
- `/replication/verdict` (criterion `replication-verdict`): exactly one of `does-not-replicate`, `replicates`. Step 2: the replication verdict under the stated rule.
- `/replication/spearman_rho` (criterion `replication-rho`): a number. Step 2: Spearman correlation between dPSI_disc and dPSI_rep (a JSON number).
- `/replication/magnitude_ratio` (criterion `replication-ratio`): a number. Step 2: median(|dPSI_rep|) / median(|dPSI_disc|) (a JSON number).
- `/comparator/median_f` (criterion `comparator-median-f`): a number. Step 3: median f over the signature events with a computable f (a JSON number).
- `/comparator/specific_core` (criterion `comparator-core`): a list of distinct identifiers from namespace `event`. Step 3: the signature events with f < 0.25.
- `/comparator/specificity` (criterion `comparator-specificity`): exactly one of `not-specific`, `specific`. Step 3: the specificity verdict under the stated rule.
- `/related/median_f` (criterion `related-median-f`): a number. Step 4: median f over the signature events with a computable f (a JSON number).
- `/severity/verdict` (criterion `severity`): exactly one of `does-not-track-severity`, `not-testable`, `tracks-severity`. Step 5: the severity answer.
- `/scope/discovery` (criterion `scope-discovery`): exactly one of `generalisable`, `sample-only`. Step 6: scope of the step-1 result.
- `/scope/replication` (criterion `scope-replication`): exactly one of `generalisable`, `sample-only`. Step 6: scope of the step-2 result.
- `/scope/comparator` (criterion `scope-comparator`): exactly one of `generalisable`, `sample-only`. Step 6: scope of the step-3 result.
- `/scope/related` (criterion `scope-related`): exactly one of `generalisable`, `sample-only`. Step 6: scope of the step-4 result.

Identifiers, dataset names and category levels are keyed tokens. Report identifiers exactly as
they appear in the data files. Grading returns only each criterion name with pass or fail.
