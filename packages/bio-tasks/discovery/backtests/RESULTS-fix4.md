# KA-fix4 verification

The BT1 card now uses a keyed transition twin, rather than the published Minikel
answers. Its phase-transition vectors are jointly permuted with an HMAC ordering;
the matching cached fields in merge2.tsv.gz are updated too. The host runs the unchanged script in pinned R 4.2 to derive the sealed key. Both
published-precision and rounded recall controls include the complete dictated request.
Private twin answers are not published here. This remains a synthetic development
check, not biological evidence or ranking certification.

BT2's primary estimator and criteria are unchanged. The first-order CGM interval is
slightly anti-conservative: the independent final review reported coverage 93.4–94.1%
near relative success 1.77, and 92.1–93.5% in sparser settings. BT3 plant-conditional
coverage does not establish coverage under the BT2 sampling design.

The added delete-cluster jackknife-CGM sensitivity independently reproduces the
reviewer's result on the development cohort:

| Method | Estimate | log-scale SE | 95% CI |
|---|---:|---:|---|
| First-order CGM, primary | 1.7789 | 0.2107 | [1.1771, 2.6884] |
| Delete-cluster jackknife-CGM, sensitivity | 1.7789 | 0.2417 | [1.1076, 2.8568] |

The earlier target-cluster bootstrap SE was approximately 0.230. These sensitivities
support reporting finite-sample uncertainty; they do not establish exact coverage.
No criterion was changed after seeing results. Both intervals fail the predeclared
lower-bound threshold of 1.3, so the output remains unranked evidence cards.

BT public trees now use KA0's public-only writer, PATH-only children, normalized
metadata, an exact entry inventory, regenerated public bytes, and a manifest pinned
before private sealing. BSD flags are refused and cleared; kernel-owned provenance
is ignored consistently across checkouts. Sealed generator family, rather than edited
host labels, disables PL1. BT3 columns have a keyed permutation and retain the
behavioral intervention audit. Numeric claim/rerun tolerances and evaluable-population
count definitions are explicit. Recorded ChEMBL mapping releases are hash-bound to
the derived file; caller dates cannot backdate a mapping.

The final scientific rerun reproduces BT2 at 1.7789 [1.1771, 2.6884] and BT3
at 1.8694 [1.4046, 2.4880], covering its exact planted estimand 2.000. D1 power
is 78.8% at +0.05 and 87.7% at +0.055; the first tested 80% crossing stays +0.055.
BT1/BT2/BT3 calibrate valid. BT4 remains unavailable because dated mappings, labels
and target crosswalks are missing. No D1 certification or independent-family
confirmation is claimed.

## PL4 cohorts and code checks

Two fresh, unselected five-key cohorts each used 2,000 packs/key/stratum. Both PL4
directions in both cohorts calibrated valid (5/5 keys, 10,000/10,000 reference passes).
Both PL1 strata remained invalid (0/5 keys). All 40 public staging/leakage checks passed.
The cohort receipts still validate against the final implementation hashes.

| Cohort | Runtime (s) | Worst pooled PL4 AUC upper | Worst leave-one-key-out upper | Individual PL4 cards admitted |
|---|---:|---:|---:|---:|
| 1 | 296.587 | 0.512065 | 0.517766 | 10/10 |
| 2 | 295.237 | 0.508639 | 0.512653 | 5/10 |

Individual-card controls additionally refused zero and five packs respectively; those
outcomes are retained. Cohort calibration does not override an individual refusal.
Reports: `../smoke-fix4-release-cohort-1.json`, `../smoke-fix4-release-cohort-2.json`, and their summary.

After the scored-area receipt repair, typecheck passed. All 18 new fix4 regressions
passed in 2.422 s. Explicit leakage passed 6/6 (115.307 s), and pilot amendments
passed 13/13 (16.373 s). The full package passes 107 TypeScript plus 281 Python tests (108 Vitest entries
including the Python wrapper), 112.78 s. Final root-suite verification follows below. The earlier root pass and superseded
cohort receipts remain documented in BUILD-NOTES; they are not substituted for the
final implementation's checks.

## Review-item regressions

All listed tests use small offline fixtures. Faults are injected at exact boundaries;
bootstrap tests inject distinct deterministic RNG streams. The real-data unseeded
bootstrap check is an explicit scientific smoke, not a nondeterministic unit test.

| Review item | Regression evidence |
|---|---|
| BT1 published-answer recall | `test_keyed_twin_recall_with_dictated_request_fails_real_path`, `test_bt1_calibrates_recall_with_request_on_keyed_source_and_isolates_copy`; keyed input and cached-join preservation tests |
| Numeric tolerance and population counts | `test_claim_and_rerun_use_numeric_tolerances`, `test_honest_resampling_with_distinct_rng_streams_passes`; TASK discloses evaluable-row count definitions |
| Shared public-only writer/isolation | `test_bt_exact_metadata_and_manifest_pin_before_sealing`, `test_bt_manifest_rewrite_at_private_boundary_refused`, `test_bt_children_environment_path_only`; existing import-graph and public-parity tests |
| BSD flags | `test_bsd_flags_refused_before_reads_and_cleared_on_normalization`; stage-out flags assertion and shared snapshots |
| BT3 column positions | `test_candidate_order_is_keyed_not_six_leaks_then_controls` |
| FORBIDDEN production use/variants | `test_forbidden_variants_have_a_production_writer_caller` |
| Mapping release provenance | `test_mapping_release_is_recorded_in_mapping_not_caller_date`, `test_mapping_loader_binds_manifest_bytes_and_release` |
| Checkout-independent provenance | `test_provenance_is_ignored_independent_of_checkout` |
| Sealed-family PL1 disable | `test_pl1_relabelled_host_metadata_cannot_override_sealed_family` |
| CGM finite-sample sensitivity | `test_jackknife_cgm_reduces_to_one_way_for_nested_clusters`; real BT2 jackknife comparison above |
| Live R receipt robustness | `test_R_receipt_scores_only_declared_areas_and_retains_unavailable_output` |

## Real execution checks

The unchanged pinned R 4.2 analysis on the keyed twin completed in 731.820 s. Its
receipt, log, table, environment and source hashes are authenticated and bound into
the final KA1 freeze. BT1's reference passes, while exact published and rounded recall
answers fail with the dictated run_all.sh and script attached. The control checks
reuse this freshly authenticated receipt, as in the review's exploit reproduction;
they do not claim three additional R executions. The served copy also passes metadata
verification. Private twin answers remain only in the dedicated ignored host run.

Independent public-input numerical-delta analyses pass the actual sandbox checks
for BT2 and BT3. Unseeded two-way Gaussian score-bootstrap submissions also pass,
including the hidden challenge and BT3 candidate interventions. The standalone
regressions use injected RNG streams so they stay deterministic. A target-only
percentile bootstrap was also attempted: it passed full-data comparisons but its
lower endpoint exceeded the tolerance on the BT2 hidden subset, despite correct
estimates/counts and successful execution. That refusal is retained; the declared
method requires two-way covariance and its tolerance was not widened.
