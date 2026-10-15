# Labels and certification

Only software assigns labels. A label is an internal evidence statement about **one claim, one method
and one dataset**. It is not a biological truth, not clinical evidence and not a statement about any
patient.

## Labels

| Label | What it means | May be used for | May not be used for |
|---|---|---|---|
| **exploratory** | Found while looking at the data; no pre-registration, no multiplicity correction. Software writes that disclosure. | Choosing what to pre-register next; internal triage. | Any external claim; "no effect". |
| **tentative** | A rule fixed before the look holds on this data and software verified the numbers, but a confirmation check failed or could not run. | Deciding whether to spend confirmation effort; a preprint section marked "pre-specified, not independently verified". | The word "confirmed"; "no effect". |
| **confirmed** | Every gate required for this kind of claim passed, including null calibration, multiplicity, a registered procedure within its validated envelope, and an independent re-implementation by the other model family. | Evidence handed to an accountable human author; robustness audits of published claims. | "Validated" in the clinical sense; causal language without a matching design; anything patient-level. |
| **replicated** | Confirmed, and the same locked rule holds on an independent dataset (route N). | Retrospective external validation across cohorts. | Clinical use. |
| **refuted** | The data rule out the pre-specified effect of interest: the interval lies below the smallest effect of interest, with power of at least 0.8. | Reporting a well-powered null. | Any claim stronger than the tested effect size. |
| **insufficient-evidence** | The data or the checks cannot settle the question. | Reporting that we cannot tell. | Any directional claim. |
| **non-identifiable** | For example, the exposure is perfectly aligned with a confounder. | Explaining why no effect can be estimated. | — |

**Confirmed means computationally confirmed within the stated data and method.** It never means "true
in biology". The guarantee is associational, not causal: it is conditional on the declared adjustment
set and does not cover unmeasured confounding. Software writes that limitation into every report.

Clinical hand-off is never a software label. Human sign-off is an "endorsed" flag, not a label, because a
veto after seeing results would reintroduce selection.

### What a missing check does

Fail closed on claims: a missing, skipped, unavailable or failed required check means "not confirmed".
No combination of missing gates yields Confirmed (a test in `omb-gauntlet` asserts this). A check that
could not run is reported as `not-run`, never as passed.

## The gates

If the gates required for a claim's kind pass, then P(confirmed | no real effect) ≤ α_family / L, where
L is the number of looks allowed on that data. The statement rests on four assumptions, each enforced by
gates: units are counted correctly, the decision rule was fixed before the confirming data were seen,
the test's null distribution is right and multiplicity is accounted for, and the numbers are what a
faithful implementation produces.

| Gate | Checks | If it fails |
|---|---|---|
| **G1a** units contract | Duplicates, effective units, pseudo-replication; the analysis must read software's effective inputs. | At most Tentative ("n inflated"). |
| **G1b** unit-disjoint splits | Donor or unit overlap across train/test splits and the dev/confirm partition. | A held-out claim cannot be confirmed. |
| **G1c** confounding | Exposure against every measured covariate, before lock. | Aligned: non-identifiable. Strong and unhandled: at most Tentative. |
| **G2** plan lock | Decision rule (metric, estimand, test, direction, unit, minimum effect, family, α) hash-locked before the look. | Exploratory. |
| **G3** recompute | Every reported number against software recomputation; a parse failure or zero compared numbers fails. | Claim dropped; repair turn. |
| **G4** reproduce | One run script from raw data in a fresh no-network sandbox; outputs identical. | Cannot be confirmed. |
| **G5a** null calibration | The primary test rerun on unit-level permutations within strata must reject at about α. | Cannot be confirmed. |
| **G5b** power and recovery | An effect planted at the smallest effect of interest must be recovered (bias and coverage); nulls need power ≥ 0.8. | A null becomes insufficient-evidence. |
| **G5c** registered procedure | The claim's procedure is registered, its design is inside the simulated envelope, and its diagnostics did not refuse. | Capped at Tentative with a limitation. |
| **G6** multiplicity | Holm within the locked family; Benjamini–Hochberg for declared screens; a program-wide hypothesis count. | Cannot be confirmed. |
| **G7** cross-family agreement | The other model family implements the locked plan; same decision, estimates within tolerance. Same-family agreement counts as zero. | Tentative ("plan under-specified or implementation error"). |
| **G8** one look | Recorded in the ledger before execution; frozen code; no model present; one look per partition. | A second look is refused (route N only). |
| **G9** performance pack | Prediction claims: discrimination, calibration, net benefit, comparison with the majority class and a constant predictor. | A prediction claim cannot be confirmed. Not built yet. |
| **CIT** citation resolution | Cited sources resolve (DOI, metadata, retraction status, quoted text). | The citation does not pass; see the citation verifier in `omb-citations`. |

### Hard stops

Exactly four, and each fires only on positive evidence:

1. A sealed or answer-key canary appears in worker output or in a successful tool result.
2. Network egress to anything other than the model API.
3. A trusted path changes: the raw manifest hash, the store, the graders, or frozen code after freeze.
4. In benchmark mode, access to a grader or key, or reading another arm's results.

Everything else is a bounded repair turn or a warning. The tests in `omb-gauntlet` fail if a fifth hard
stop appears.

## Registered procedures and the Confirmed guarantee

A Confirmed label is reachable only through a registered procedure that has been simulated over a design
envelope covering the claim. For example, the two-group Welch procedure is validated when the smaller
arm has at least 8 units at 1:1 allocation, and the paired procedure when there are at least 6 units.
The precise envelopes and the simulation method are in
[`packages/omb-procedures/FEASIBILITY.md`](../packages/omb-procedures/FEASIBILITY.md).

The guarantee carries an explicit limit for **mean-type** tests. They cannot be certified against rare,
far outliers: a tight, outlier-free sample whose bulk sits slightly off the true mean looks exactly like
real low-noise data with a real effect, and no rule computed from the sample can tell them apart without
also refusing honest data. So a mean-type Confirmed label states a contamination bound instead of claiming
validity for every distribution, and carries a rank-based companion estimate.

Assumption diagnostics **block**, not caveat: if the data contradict a method's assumptions, that
method's answer is withheld or downgraded, and adding "interpret with caution" does not rescue it.

## OS-account separation

The store and the seal key belong to a certification service account; worker code runs as another. A
claim certified in single-user mode is capped at Tentative. Installing the launcher that provides the
separation is described in [getting-started.md](getting-started.md#certification-launcher-os-account-separation).

## The report

Every number in a report is a reference to a recomputed metric; numbers typed into prose are stripped.
Software writes statuses, labels and limitation lines. In papers, the AI writes sentences in a closed
format with slots, software fills every number and draws every table and figure from the certified
records, and a wording linter ties each finding sentence to one claim and allows only words as strong as
that claim's label. See [`design/strictness_profiles.md`](design/strictness_profiles.md) for how strict
each label is meant to be and what each may be used for.
