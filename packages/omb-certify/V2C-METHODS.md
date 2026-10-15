# V2c kernel corrections

These rules supersede conflicting statements in V2B-METHODS.md. They apply to the
certifier only; the pilot's pinned bio-toolpack is unchanged.

## Repeated observations

The trusted estimate is the equal-weight mean of unit-specific condition-1 minus
condition-0 means. Every unit must contain both binary conditions. Strata and nuisance
columns must be constant within unit; otherwise the computation is refused.

At a zero null, exactly one row per condition permits a sign flip as the actual
within-unit relabeling. All other row-count patterns use permutations of labels within
each unit, preserving its condition counts. Small orbits are enumerated; larger orbits
use the existing plus-one fixed-stage Monte Carlo rule. At a nonzero null, sign flips
are explicitly model-based and assume independent contrasts symmetric about that null.
Repeated claims always run G5a, regardless of whether the plan says `sign-flip` or
`permutation test`; neither name earns a waiver.

Zero-null twins shuffle labels within units. Nonzero-null twins use the symmetric unit
plasmode. Planting removes the same equal-weight contrast that the estimator measures,
keeps unit intercepts fixed, and independently flips each unit's residual vector before
adding the planted contrast. Binary plantings use a shared uniform within each unit;
probabilities outside support refuse the planting. Repeated logistic models remain
unsupported. Unit-specific Student intervals have units-minus-one degrees of freedom.

## Logistic and adjusted continuous calibration

OR nulls are converted to log coefficients. Zero-log-coefficient unadjusted nulls
shuffle labels; other logistic nulls draw Bernoulli outcomes from a reduced logistic
model with the locked coefficient as an offset. Outcomes are never shifted arithmetically.
OR recovery bias is measured on the log scale. Coverage on exponentiated intervals is
identical to log-scale coverage by monotonicity.

Reduced-model residuals have covariance proportional to I-H, so permuting and projecting
them again does not simulate iid model errors at small n. Continuous adjusted null twins
instead use independent Gaussian errors about the reduced fitted mean. Under the declared
Gaussian homoskedastic linear model, the Student p is a finite-sample reference. The
certifier's deciding adjusted p is the maximum of the FL randomization p and this reference;
its rejection event is a subset of the Student rejection event. This is model-based,
not an exact exchangeability claim. Both the model reference and generator are recorded.
Binary additive nonzero-null calibration with adjustment remains unavailable rather than
inventing a probability model. The 200/600 G5a thresholds are unchanged.

## Worker numbers and B7

The deciding p is always software-owned. A worker's reported p is checked against its own
reviewed calculation, separately from that deciding p. `primary.json` may specify
`pMethod: "student" | "logistic" | "kernel"`. Unknown methods fail verification. Legacy
outputs without pMethod may match the trusted classical fit or the executed kernel; this
compatibility rule never admits an arbitrary unmatched p. Missing worker p is permitted
because software calculates the decision; missing trusted computation is never permitted.
Worker estimates, SEs, unit counts and supplied intervals must match trusted quantities.

Student degrees of freedom come from the trusted fit, including the full independent
nuisance/strata rank or the number of pairs. B7 uses trusted interval metadata, so omitting
worker intervalMethod cannot bypass checks. The Student p identity is not applied to a
permutation/sign-flip p. Changed-input probes still require estimate dependence; look and
rerun p values are independently checked. Forged look values cannot earn G3/G4 passes.

Materiality uses the original locked MEI. A missing MEI stays missing, and material is
false when requested without one. The capped MEI is used only for the stricter refutation
and recovery policy. Results expose both `mei` and `refutationMei`.

## Staging, facts and locks

The certifier owns a local staging parser fork to avoid changing/re-pinning the running
pilot's toolpack. Raw row-content matches require corroboration from a full-profile matrix
and agreement across shared tables before merging; otherwise distinct IDs are retained
with a warning. Biological units, including line_id, remain a separate merge criterion.
Common participant/cell/variant/record IDs are recognized. Non-table documentation and
JSONL are copied through but not interpreted as analysis tables; their bytes remain hashed.

Declared staging can coarsen detected donor/patient/cell-line/line/participant/subject/person
identity but cannot split it. Repeated mode requires a distinct unit column. Orphan joins
are checked. Content signatures do not merge declared IDs: identical records across
units require locked `acknowledgeContentDuplicates: true`. Synthetic transformed copies
reuse the checked source identity; newly coincident simulated outcomes do not require a
second acknowledgement.

All data-integrity labels require G2, including both confirmation and refutation. A changed
producer vocabulary, staging rule or added claim therefore remains exploratory. Qualified
facts `raw.<table>.<fact>` and `effective.<table>.<fact>` describe their named views;
unqualified counts describe the effective view supplied to analysis. Registered predicates
accept `view: "raw" | "effective"` (legacy default raw) and record the chosen view.

## Held-out comparisons

G9 compares against training prevalence, training majority, held-out prevalence, held-out
majority and the locked simple rule. Scaled Brier uses ybar*(1-ybar) on held-out rows.
Recovery targets the same baselines using the planted population prevalence and majority,
and records the planted slope/prevalence so its population truth can be checked separately.
Training identities are collapsed to unique units and checked against held-out units.
Both declarations must use the same biological-unit column name; finer declared identities
are refused. Existing G1b evidence is never overwritten. Identity disjointness is separate
G9 evidence; `heldOut` is false and provenance says `declared held-out, unverified provenance`.
The existing gate validator therefore cannot count that evidence as verified held-out
performance. Software predictions.tsv under G8 and B22 influence testing remain unavailable.
Locked performance strata/adjustment are refused at admission and execution.

## Runtime integrity

Every admitted frozen source extension reaches the advisory RNG scan. The tripwire covers
the listed NumPy/Python/R/scipy/sklearn/Faker/torch/awk APIs and simple aliases/multiline
member access. A clean scan never proves absence of RNG. Python source is parsed by a
host-selected Python AST checker at freeze, refusing dynamic import/exec/subprocess
capabilities, simple aliases and computed call targets. Other languages have conservative
lexical capability refusals, not a general AST/dataflow proof. The Python checker requires
/usr/bin/python3; missing parsing capability refuses freeze rather than skipping it.

The CLI host mailbox may supply `environment: {prefix, envFile, manifest, lockfile}`.
The existing pinTaskEnvironment/taskExecutor path pins Python, Rscript, conda history,
manifest, lock and activation, prepends prefix/bin, and rechecks at execution boundaries.
Worker env.sh never grants a runtime. Missing host environment retains the Node-only mode.

Darwin sandbox policy samples are followed by another live-process identity check. An exit
between allow/deny calls cannot fabricate a survivor; identity reuse retries within the
fixed work bound. A real live matched survivor still fails and is killed. No sleep or
retry of the analysis converts a cleanup finding into a pass.
