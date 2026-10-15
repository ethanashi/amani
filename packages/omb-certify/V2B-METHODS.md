# V2b kernel interface and statistical scope

All declarations below must be locked before the look. No live study was run. A shape
admission is not a scientific result; data validation, signed gates and the V5 look record
remain necessary. Unknown computations cannot earn support or refutation.

## Monte Carlo

`kernelDecision` defaults to automatic mode: enumerate small orbits (at most 10,000),
otherwise sample independent uniform permutations with replacement. The locked claim can
carry `monteCarlo: {draws: 9999, maxDraws: 39996, extensionFactor: 4, bandSE: 3}`.
Each stage reports `(1+b)/(1+B)`. One extension is allowed when the initial p is within
`bandSE * sqrt(p*(1-p)/(B+1))` of alpha. The deciding p is **max(initial p, final p)**.
Thus its rejection event is a subset of the initial fixed-B rejection event for every
threshold, including Holm thresholds. The band is a precision diagnostic, not a confidence
sequence or a probability-one claim about the exhaustive orbit. The extension is conservative
and can only remove an initial rejection. All work bounds are numerical, never deadlines.

The primary seed is derived from the authority's HMAC of the gate binding and claim.
Software publishes per-claim seed tokens in `OMB_SOFTWARE_SEEDS` for each offline run;
look and rerun receive identical tokens, synthetic requests receive distinct tokens with
no phase labels. A worker may omit p for Monte Carlo claims: software supplies it. A
worker p, if supplied, must agree with the deciding p; it is never an alternative source.
`jobs` records look/rerun attempts and simulation callback requests, including failed ones.

The low-level API retains explicit exact mode and legacy bounded exact calls with an
explicit work budget. A host limit below 19 retains the old deterministic fault-injection
path (unresolved, no p). `permutationMode: 'exact'` must be chosen before lock. Unresolved
is a hold, never a negative finding. Sign flips enumerate up to 1,024 patterns, otherwise
use the same Monte Carlo rule.

Validity assumes the declared randomization/exchangeability group. Cluster sign flips
require symmetry of independent cluster contrasts (or randomized paired assignment).
Freedman–Lane with varying nuisance is approximate/model-based, as the result explicitly
states; no universal finite-sample type-I guarantee is asserted for that model.

Primary methodological sources:
- [Phipson and Smyth, permutation p-values](https://pubmed.ncbi.nlm.nih.gov/21044043/)
- [Winkler et al., permutation inference and Freedman–Lane](https://pmc.ncbi.nlm.nih.gov/articles/PMC4010955/)
- [sandwich HC covariance methods](https://sandwich.r-forge.r-project.org/articles/pdf/sandwich.pdf)

## Staging and independent units

A plan can declare:

```json
{
  "sharedKnobs": {"pipelineVersion": "frozen-v1"},
  "staging": {
    "analysis.tsv": {"mode": "analysis-table", "idColumn": "unit_id"},
    "pairs.tsv": {"mode": "repeated-measures", "idColumn": "sample_id", "unitColumn": "donor_id"}
  }
}
```

Every file in this declared analysis batch must have a declaration. Declarations are
hash-locked, included in staging cache identity, and cannot change by amendment. Content
identity never merges declared records. Missing/repeated row IDs, conflicting `unit_id`,
or inconsistent cross-table identity are refused. Repeated rows remain in RAW; the
stager adds unit_id from the declared biological unit. Raw mode retains its previous
content/donor collapse behavior. Original tables are retained in host-only SOURCE for
fact production; the worker receives only effective RAW.

Repeated inference currently admits binary conditions with both conditions represented
within each unit. It uses the equal-weight mean of within-unit differences (within each
condition, rows are averaged). `permutationLevel` must be `unit`. Varying within-unit
adjustment or strata, incomplete pairs, and repeated logistic models are refused.
For a gene-weighted P4 contrast, the prelocked table must contain the appropriately
scaled cluster sums described in the review. This code does not choose those weights.

Optional per-claim `<claim>.units.tsv` and `<claim>.splits.tsv` avoid borrowing a sibling's
unit set. Common files remain supported when the unit sets actually agree.

## Performance and model-based estimands

A frozen held-out prediction claim uses `kind: out-of-sample`,
`estimand: brier improvement` (or `auc improvement`, `accuracy improvement`,
`net benefit improvement`, `ece improvement`), `test: paired prediction permutation`,
`direction: greater`, `nullValue: 0`, and `unit: unit_id`. Exposure names the probability
column; outcome names the binary outcome. The `performance` knob contains:

```json
{
  "metric": "brier", "thresholds": [0.2, 0.5, 0.8], "bins": 10,
  "bootstrapDraws": 1999,
  "trainingTable": "train.tsv", "trainingPrevalence": 0.5,
  "simpleRuleColumn": "simple_rule_probability",
  "monteCarlo": {"draws": 9999, "maxDraws": 39996}
}
```

Training identities and outcomes come from a separately declared trusted table. The
prevalence is checked against those outcomes, and every training unit must be disjoint
from held-out units. Both probabilities must be finite in [0,1]. Baselines are the
training-prevalence model, the majority-class model (ties choose class 1), and a declared
simple-rule probability column. Decision curves also show treat-all/treat-none.

The deciding estimate is the smallest improvement over the required baselines. Each
comparison swaps the two prediction vectors together within each declared unit; its
validity assumes paired prediction exchangeability. The deciding p is the maximum across
baseline comparisons. Unit-block percentile bootstrap intervals use Bonferroni tails
across these baseline comparisons, but not across the separate locked claim family.
G9 requires the pack and positive lower bounds against all three baselines. G9 superiority
is a confirmation requirement, not a prerequisite to refuting an unsuccessful predictor.

The pack reports tied AUC, Brier/scaled Brier, accuracy, calibration intercept/slope,
calibration-in-the-large, fixed-bin ECE and net benefit. Unavailable calibration is null
and cannot pass G9. No probability clipping hides separation or boundary logits.
Recovery is conditional on the frozen predictor: a finite Bernoulli population is planted
at the MEI, independent units are resampled, and a shared uniform induces within-unit
binary dependence. All 100 requests stay in the denominator, and any unevaluable draw
fails recovery. This does **not** establish recovery of a training or CV pipeline.

Logistic slope/log odds ratio and natural-scale odds ratio use `test: logistic`, full-rank
IRLS (80-iteration bound), HC3 sandwich SEs, and Student reference intervals. OR intervals
are exponentiated from the log scale. Separation, extreme fitted probabilities, rank loss
and nonconvergence are refused. Binary additive models report HC3 intervals; continuous
additive models retain Student intervals unless `interval: HC3` is locked. Those intervals
are model-based, not exact randomization confidence sets.

## Facts, materiality and integrity diagnostics

Facts are reviewed fixed-code predicates, not worker callbacks. `producer` is a claim knob
with `producer`, `left`, `right`, `idColumn`, and producer-specific fields. Registered names:
`identity-overlap`, `content-overlap` (explicit fields), `id-set-equality`, `row-accounting`
(excluded table, reason column and locked allowed reasons), and `deterministic-mismatch`
(single numeric source value, target and tolerance). Each emits H-holds = 0 or 1 with
source/spec hashes; assert `value: 1`. Missing data and unknown producers are unevaluable.
Row accounting verifies the disjoint/exhaustive partition and declared reason vocabulary;
it does not verify a human reason or implement a general eligibility-predicate language.

A negative reproduction can therefore be stated positively as a mismatch predicate.
Only a reproduction with `estimand: deterministic fact`, a matching host target **and
producer specification**, successful recomputation and G3/G4 can earn the narrowly scoped
G5b-recovery not-applicable exception. Statistical claims cannot borrow this exception.

`material: true` reports a separate boolean: support is still the ordinary decision, while
materiality additionally requires the software CI to lie strictly beyond the MEI.
B7 checks range/order, malformed numbers, Student-Wald p/CI/SE relationships when that
method is declared, and log-Wald geometric centering. Alternative/missing methods are not
silently called Wald. The trusted primary computation remains authoritative.
B6 is a static RNG tripwire with software-owned seeds; it never awards a clean-scan pass.
It can miss dynamic/encoded calls and does not perform the catalog's exhaustive NumPy/R
synthetic-column seed reconstruction or a general AST/dataflow proof.

## Integration still required

V5 must precommit an atomic look session naming all plan objects, execute them without an
LLM between looks, bind partition identity, spend alpha/burn partitions, and recover that
session durably. No V2b API invents a G8 pass. X6 remains a V5 responsibility. V8 still
provides authenticated independent reproduction/replication evidence.

Whole-pipeline CV permutation/retraining, internal-external CV, subgroup/fairness tables,
Riley precision checks, arbitrary survival/rank estimands, and the rest of the full B4/B6/B7
catalog are not implemented here. They are precisely refused or remain explicit diagnostics,
not advertised as passed. The original P1–P5 plans remain drafts; the admission artifact
lists each needed pre-lock edit. No plan or scientific protocol outside this package was edited.
