# Validity checkers

- `calibrateTask`: runs empty, reference and permuted runners (sync or async). Any throw or
  non-boolean result -> `refused-inconclusive`. Otherwise: empty passes -> `refused-vacuous`;
  reference fails -> `refused-reference-fails`; permuted passes -> `refused-inconclusive`;
  else `calibrated`.
- `checkDonorDisjoint`: invalid if any donor is in both train and test (`leakedDonors`, sorted),
  and fails closed if any sample has a missing/null/empty `donorId`.
- `checkPseudoReplication`: runtime `unit` must be `donor`, `cellLine`, or `sample`.
  `declaredN` defaults to `samples.length` only when the property is omitted; an explicit
  count must be a finite positive safe integer (including rejection of null, undefined,
  strings, NaN, and fractions). `effectiveN` = unique donors or cell lines for the corresponding
  unit. Missing, non-string, empty, or whitespace-only unit identities invalidate the check;
  counts greater than `effectiveN` are invalid. Aggregated counts below that bound are allowed.
  Sample mode requires valid unique sample IDs **and** valid unique donor IDs, and rejects
  repeated or malformed supplied cell-line IDs. Cell-line metadata may be absent/null when
  not applicable. Record IDs alone cannot establish independence. Unverified sample
  independence returns `valid: false, effectiveN: 0` even if the declared count is reduced.
- `checkClusterVsGradient`: k-means++ (seeded mulberry32, best of 5 restarts by inertia),
  statistic = mean silhouette. Null = 19 simulations of uniform data in a box aligned with the
  principal axes, matched in mean and covariance (half-width sqrt(3·λ)). Input must contain
  at least `k` distinct locations. Zero/non-finite seeding weight is a failed fit; a zero RNG
  draw cannot select a zero-weight center. Only converged restarts with exactly `k` occupied
  clusters are eligible. If no eligible observed fit or any simulated fit exists, the entire
  check is unsupported; failed simulations are never skipped or replaced with zero scores.

## Numerical decomposition

All coordinates are divided by one common maximum absolute coordinate before distance and
covariance calculations. This preserves Euclidean geometry while avoiding overflow/underflow
from a common unit change. Covariance is separately normalized by its largest absolute entry
before cyclic Jacobi decomposition. The stopping condition uses the off-diagonal Frobenius
norm relative to the normalized matrix norm (relative tolerance 1e-12, up to 100 sweeps).
The decomposition must satisfy `||AV - VΛ||F <= 1e-10 ||A||F` and
`||VᵀV - I||F <= 1e-10 sqrt(d)`. Non-finite residuals, materially negative eigenvalues,
zero covariance, and unsuccessful decomposition fail closed. Only roundoff-sized negative
eigenvalues are clamped, and the residual is verified with those clamped values.

## Monte Carlo rank test and options

For `B` simulations and `b` null silhouettes **greater than or equal to** the observed
silhouette, `pValue = (b + 1) / (B + 1)`, including ties as exceedances. This is the corrected
Monte Carlo rank formula described in the
[SciPy goodness-of-fit reference](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.goodness_of_fit.html).
Support requires **both** `pValue <= 1 - quantile` and
`statistic > nullQuantile + margin`. The implementation compares `quantile <= 1 - pValue`
to avoid subtraction error at boundaries such as p=0.1, quantile=0.9. `nullQuantile` remains
the empirical order statistic at one-based rank `ceil(quantile * B)`; it is a descriptive
threshold for the separate margin test, not a substitute for the corrected p-value.
With 20 simulations and one exceedance, p=2/21, so support at quantile=0.95 is refused.
At that quantile, fewer than 19 simulations cannot establish support even with no exceedances.

Options are checked before fitting or simulation:

| Option | Default | Accepted values |
| --- | --- | --- |
| `seed` | 0 | Safe integer, reduced to uint32 by mulberry32 |
| `simulations` | 19 | Integer from 1 through 999 |
| `restarts` | 5 | Integer from 1 through 100 |
| `quantile` | 0.95 | Finite number strictly between 0 and 1 |
| `margin` | 0.05 | Finite nonnegative number |

Omitted/undefined options use defaults; null values and numeric strings are rejected. Invalid
options return `supported: false` with an `invalid options` reason. Invalid inputs and failed
fits/decompositions also return an explicit unsupported result. Unverified results use NaN for
`statistic`, `nullQuantile`, and `pValue`; they are never reported as passed.

## Regression coverage and build notes

`test/validity/validity.test.ts` retains the original 19 tests for calibration statuses,
donor-disjoint splits, donor pseudo-replication, separated clusters, gradient controls,
repeatability, missing/empty inputs, and this notes file.

`test/validity/regressions.test.ts` adds 26 tests:

| Requirement / review defect | Coverage |
| --- | --- |
| 1: scale-dependent false cluster support | Line gradients at scales 1, 1e-6, 1e-150, 1e150 across three rotations; separated-cluster positive control after rotation/rescaling |
| 2: sample identities/independence | Duplicate/missing/malformed sample IDs, distinct IDs without biological metadata, shared donors/cell lines, and valid independent samples |
| 3: declared-count validation | Malformed counts, explicit undefined/null, fractions, unsafe integers, omitted count, and valid aggregated count for every unit |
| 4: runtime analysis unit | Missing, null, unknown, empty-string, and numeric unit values |
| 5: incomplete k-cluster fits | Two distinct locations with k=3 and k=4; unrepresentable seeding distances; an exact zero RNG draw with positive seeding weights available |
| 6: option validation/nontermination | Malformed numeric options, negative margin, infinite/oversized counts; worker terminated on a 100ms deadline armed at the checker boundary |
| 7: finite-simulation rank | Reviewer seed at B=19/20/21, zero-exceedance boundaries at B=18/19/20 and quantile=0.9, and separate margin rejection |
| Direct cell-line pseudo-replication | Repeated line counts once, valid aggregated count, independent-line control |
| Calibration failure coverage | Async rejection and sync/async non-booleans in each of the three runners |

Before implementation, the regression suite (excluding the known unbounded loops) produced
16 failures and 6 passes, reproducing all seven defect categories. After implementation all
45 validity tests pass. Tests use fixed seeds, no network, and no sleeps. The worker used for
nontermination protection is always terminated in `finally`; no temporary files are created.
Final verification on Node 24.19.0: root `pnpm typecheck` passed; root `pnpm test` passed
90/90 tests in 2.61s (the 45 validity tests accounted for 626ms of test execution).

Scope deviation: the task explicitly permits edits only in `src/validity/` and `test/validity/`.
Therefore this file carries the build notes; package-level `BUILD-NOTES.md` and `package.json`
were not created or modified. No dependencies or bio-core changes were needed.

Limits: the null is a single uniform box, so curved/branching gradients, strongly non-uniform
densities along a gradient, or heavy-tailed data may be misjudged; silhouette is O(n²) per fit,
so large n should be subsampled by the caller. Simulation/restart bounds do not impose a total
resource bound on arbitrary input sizes. With 19 simulations the null quantile is coarse;
the rank correction does not establish exact type-I error control for this fitted null on
arbitrary biological data. Euclidean distance assumes features are on comparable scales.
Extreme within-data dynamic range can still lose representable distances; a failed fit is
unsupported. Identity checks trust the supplied metadata and cannot establish independence
against undisclosed shared donors, cell lines, or other biological confounding. No known
reviewed defect remains outstanding.

## Block 4d — content-duplicate / pseudo-replication detector

Source: `duplicates.ts`, exported through the validity namespace. Tests:
`test/validity/duplicates.test.ts`. Motivation: in the Block 0 baseline both plain agents checked
ID uniqueness, missed 99 patients duplicated under new IDs, and reported "no duplicates".

**`detectContentDuplicates({ rows, idField, compareFields?, vectorOf?, tolerance })`.** Content is
a numeric vector (`vectorOf`: a field name, or a function called exactly once per row; plain
number arrays or numeric typed arrays) and/or scalar `compareFields` (finite number, string or
boolean; no type coercion, so `1` and `"1"` differ). When both are given, both must match.
`tolerance` is required and declares the relation:

- `0`: exact. Two records are duplicates iff every value is identical (`-0` equals `+0`).
- `t > 0`: rounded. Every number is quantized as `Math.round(x / tolerance)` (halves toward
  +Infinity); records are duplicates iff all quantized values agree. Members of a group differ
  by at most about `t` per coordinate; each group reports its actual `maxAbsDifference`.

Both relations are equivalences, so groups are well defined and independent of row order.
Method: each row's canonical content (zero normalized, or quantized integers, plus an injective
JSON encoding of the scalar fields) is hashed with SHA-256 into a bucket. Each row is then
verified exactly against the class representatives in its bucket. Because equality is
transitive, matching the representative verifies the row against every member. A hash collision
only costs an extra comparison (`counts.hashCollisions`); it can never merge different content.
The test seam `detectContentDuplicatesWithBucketHash` (not exported from the package) proves
this with a constant hash. Cost: one hashing pass over all values plus O(d) per bucket mate,
never an all-pairs comparison. Measured in the test suite on Node 24.19 (Apple Silicon),
2,000 x 20,000: exact 160-175 ms, rounded 430-460 ms.

**`detectNearDuplicates({ rows, idField, vectorOf, threshold = 0.999, maxCandidatePairs = 50000 })`.**
Flags pairs with Pearson r strictly greater than `threshold` across all features, as suspected
technical replicates. Numerically identical vectors (including signed-zero equality) are collapsed first and reported apart in
`identicalGroups`. `pairs` never contains two identical vectors, so exact duplicates and near
duplicates are reported separately. Search: each vector is standardized (u = (x - mean) /
||x - mean||, so r = u.v) and projected by an orthogonal projection P: a seeded partition of
features into min(d, 1024) blocks with random signs, each row scaled by 1/sqrt(block size). Since
||Pu - Pv|| <= ||u - v|| = sqrt(2 - 2r), any pair with projected squared distance above
2(1 - threshold) + 1e-9 provably has r < threshold and is skipped. This filter has no false
negatives, and the seed changes only speed. Every surviving pair is verified with the full
shifted, scaled Pearson correlation with compensated mean, variance and covariance sums.
Shifting before scaling preserves representable differences on large offsets; scaling keeps
squares finite even for subnormal or near-maximum finite inputs. A raw range that overflows
is handled by scaling about zero. Exactly constant vectors are rejected before summation.
A candidate within 1e-12 of the threshold makes the whole result inconclusive. If more than `maxCandidatePairs` pairs survive, the result is
`invalid` (inconclusive), never empty. Cost: O(n·d) for statistics and sketch, O(n² ·
early-exit) sketch comparisons, O(d) per candidate. Measured: 2,000 x 20,000 in 320-360 ms
on uniform data (test suite), and about 0.45 s on expression-like data with typical r = 0.8
(scratch probe, not in the suite).

**`effectiveUnits(evidence | evidence[], { ids? })`.** This merges, with union-find over every
checked record (so transitivity through records outside `ids` holds): exact groups,
identical-vector groups and near pairs. It then returns `effectiveN`, the units and one
representative per unit. If any report is invalid or inconsistent (for example, an unchecked
ID, overlapping groups, or status/valid/groups that disagree, missing metadata, inconsistent counts or row indices,
invalid pair correlations, or near groups that differ from the connected components of pairs), or does not cover every
requested ID, the result has `valid: false` and `effectiveN: null`.

**Fail closed (declared policy, `DUPLICATE_POLICY`).** Each of the following returns
`status: "invalid"`, `checked: false`, with no `groups`/`pairs`/`counts`, so it cannot be read
as "no duplicates":

- empty rows, sparse rows, or rows that are not plain objects;
- missing, blank, non-string or duplicate IDs;
- unknown input properties (typos), proxies (including nested evidence), and accessor (getter)
  properties at read boundaries, which are never invoked;
- ragged, empty, resized-while-reading or non-numeric vectors, including BigInt arrays,
  DataView and array-likes;
- any NaN or ±Infinity, regardless of NaN payload;
- shared-memory vectors: a non-atomic copy cannot prove a coherent snapshot; the producer must
  supply a synchronized private snapshot;
- missing/null scalar values: missingness must be encoded explicitly, for example as `"NA"`;
- a missing or malformed tolerance, or a value too large to quantize at the declared tolerance;
- for correlation: a zero- or unrepresentable-variance row, or fewer than 3 features.

`valid` is true only for a completed check that found nothing; a duplicate finding sets
`valid: false` (pseudo-replication present). Plain arrays are copied from own data properties (holes cannot inherit numeric values).
Typed arrays returned by a `vectorOf` callback are copied before the next callback, so reused
scratch buffers cannot change earlier rows. Named-field typed arrays remain borrowed, with no
caller code executed during analysis. Original view lengths are re-read through intrinsic getters
after callbacks have run. IDs are opaque, case-sensitive strings: whitespace is preserved and
only whitespace-only IDs are invalid. No ID normalization is inferred from content.

**Original acceptance coverage** (`test/validity/duplicates.test.ts`, 111 tests; cross-review additions below):

| Requirement | Test |
| --- | --- |
| 5% exact duplicates under new IDs, 2,000 x 1,000, found exactly with no false positives | `finds 5% exact duplicates ...`: planted groups equal both the construction and an independent byte-equality oracle; also at tolerance 1e-9 and after shuffling rows |
| Block 0 pattern (expression plus clinical) | `Block 0 scenario ...`: combined content, plus a decoy with the same vector and a different age |
| Hashing plus exact verification, not O(n^2) | `matches an all-pairs oracle ...` (exact and rounded, group sizes 2 to 10); `a constant bucket hash ...` and `a coarse hash ...` give identical groups when every row collides |
| Near duplicates flagged only by the near detector | `near-duplicates with tiny noise ...`: exact detector (tolerance 0 and 1e-6) finds only the 20 exact pairs; the near detector finds exactly the 50 noisy pairs, lists the exact pairs apart, and flags none of the 30 r ~ 0.99 pairs |
| Near detector has no false negatives | `matches brute-force Pearson ...` at d = 800 (exact sketch) and d = 3000 (lossy sketch), with exact planted correlations 1e-6 either side of 0.999 and thresholds 0.999, 0.9985 and 0.99 |
| Genuinely distinct samples never grouped | one ulp in one feature, a permutation, a same-sum change, float32 rounding, scalar-field differences without coercion, rounding-cell edges |
| Ragged / NaN / empty / IDs fail closed | 48 content cases and 16 near cases; accessors not invoked; a vector resized while rows are read; an invalid result has no `groups` |
| `effectiveUnits` | 2,000 to 1,900; exact plus near evidence merged transitively, including through a record outside the requested subset; 16 forged or inconsistent evidence cases give no n |
| 2,000 x 20,000 under 2 s | `performance`: exact, rounded and near all timed on planted data (exact, rounded and near each asserted < 2 s, with two concurrent CPU-load workers) |

Mutation checks during the build (each reverted): skipping exact verification, a filter bound of
(1 - threshold) or 1.998(1 - threshold), a looser correlation comparison, an unnormalized
(non-contracting) sketch, choosing the representative by row order, ignoring scalar fields,
dropping near pairs or cross-subset transitivity in `effectiveUnits`, accepting NaN, and removing
the length re-read. Every mutation failed at least one test.

**Limits.**

- Rounded mode is not an L∞ ball. Two values closer than `t` that straddle a rounding-cell edge
  in any coordinate are not exact duplicates under this declared relation; the near-duplicate
  detector exists for such cases.
- Content must be compared on the right fields. Including another per-record identifier (a
  barcode, a timestamp) in `compareFields` makes every record distinct; only `idField` is guarded.
- Duplicates that went through a transformation (renormalization, a different gene subset,
  log versus linear scale, a column permutation) are not exact duplicates. An affine copy is
  caught by the near detector (r = 1); other transformations may not be.
- The near search is quadratic in the number of distinct vectors (about 10^4 is practical).
  Weakly structured high-dimensional data prunes well. Data where many unrelated pairs have r close
  to the threshold may exceed `maxCandidatePairs`, and the result is then inconclusive.
- Correlations within 1e-12 of the threshold are inconclusive, not passed or flagged. This is
  a conservative floating-point guard, not arbitrary-precision interval arithmetic.
- Proxies are rejected with Node intrinsics before traps execute. Explicit `vectorOf` functions
  remain trusted caller code: this API is not a sandbox for functions that mutate globals or
  fabricate values. The generator should supply data, not executable callbacks.
- `effectiveUnits` verifies internal consistency, not report authenticity or scientific
  independence. A wholly fabricated but consistent report requires a trusted provenance
  boundary upstream. IDs remain opaque; any domain-specific case/whitespace normalization
  belongs in that upstream schema.
- Runtime assertions cover a seeded matrix under two busy worker threads, not an arbitrarily
  starved host or adversarial data exceeding the declared candidate budget.

Scope deviation: as with the earlier validity work, the task permits edits only in `src/validity/`
and `test/validity/`, so this section serves as the Block 4d build notes; the package-level
`BUILD-NOTES.md` is unchanged.


### Block 4d Codex cross-review and fixes

Edits are confined to `src/validity/` and `test/validity/`. This section is the required build
record in lieu of editing the out-of-scope package-level BUILD-NOTES.md/package.json (both
already exist). No runtime dependencies or bio-core changes were needed.

Confirmed probes before fixes: the first 40 cross-review tests produced **36 failures and
4 passes**. Direct Node probes independently reproduced accessor execution, inherited sparse
entries, scratch-buffer aliasing, constant-vector false positives, tiny affine-copy false
negatives, and an effective-n change caused solely by a forged near-group summary.

| Confirmed finding / requirement | Fix and regression coverage in `duplicates-review.test.ts` |
| --- | --- |
| Vector getters executed; holes inherited numeric entries; proxy traps ran | Own descriptors, explicit missing/accessor rejection, intrinsic proxy rejection. Tests cover vectors, input, rows, a row, compareFields, and nested evidence; trap/getter counters stay zero. |
| Reused callback view falsely merged different rows | Copy the returned typed view immediately. A three-row fixture pins exact groups and a separate fixture pins near pairs; original resized-buffer refusal remains covered. |
| Shared memory was accepted without synchronization | Reject it, require a producer-owned coherent private snapshot. Acceptance test covers rejection plus the private-copy positive control. |
| Constant 0.1/0.2 vectors falsely correlated at r≈1 | Check raw min/max for exact constancy before arithmetic; three lengths exercise the former summation drift. |
| Tiny affine copies at 1e-161/1e-162 were reported clean | Shift and scale coordinates before variance, sketch and covariance. Positive controls span MIN_VALUE through 1e300, overflowed ranges and large offsets; negative/anticorrelated controls cover four scales. |
| The strict 0.999 boundary silently depended on rounding | ±1e-12 ambiguity returns invalid/inconclusive. An orthogonal analytic fixture pins the boundary and both sides at ±1e-8; seeded all-pairs tests retain ±1e-6 cases. A final affine-copy probe at threshold `1 - 1e-12` exposed a guard/clamping mismatch; clamping now precedes the ambiguity decision, with a regression and effectiveUnits positive control. |
| `effectiveUnits` trusted inconsistent summaries, counts and metadata | Validate method, policy, basis, counts, row-index mappings, spreads, representative IDs, correlations and unique pairs; recompute pair components and require exact agreement. Sixteen evidence mutations and a misspelled-options test all refuse n. |
| Signed zeros, Float32/Float64, collisions, ID spelling, NaN payloads and rounding edges | Existing collision/type tests remain; new opaque-ID/prototype-name, payload, extreme-double and positive/negative grid-edge tests pin the declared policy. No additional defect found in the exact hash relation. |
| Speed and deterministic load startup | The 2,000 × 20,000 test now starts two CPU-load workers at message handshakes and requires all three detectors <2s; finally always stops and terminates both workers. No sleeps or temporary files. |

Mutation review: **13/13 deliberate source mutations were killed by assertion failures**, then
restored: bypass candidate verification; ignore scalar verification; remove signed-zero
normalization; accept NaNs; replace rounding with floor; retain callback buffers; read vector
getters; accept vector proxies; suppress threshold ambiguity; halve the sketch bound; ignore
pair components; drop near merges; break transitivity through excluded IDs. An additional
1,008 nested-field corruption probes caused zero uncaught effectiveUnits exceptions.

The new file contains 48 tests (159 Block 4d tests total). Final verification on Node 24.19.0:

- Root `pnpm typecheck`: passed.
- Root `pnpm test`: 1,591 passed, one pre-existing opt-in live test skipped, 18.10s wall time.
  The skipped real-agent smoke is not duplicate-detector evidence and is not counted as passed.
- `pnpm exec vitest run packages/bio-checks/test`: 493 passed, 2.78s wall time.
- Final package performance under two load workers: exact 184ms, rounded 501ms, near 579ms.
  During the full repository run: exact 475ms, rounded 1,538ms, near 639ms, all below 2s.

 Remaining limits are listed above; no confirmed
review defect is intentionally left unfixed. Rounded mode remains the documented grid relation,
not a guarantee to find every pair inside an L∞ tolerance ball; changing that relation would
require a separate API/algorithm decision. Test timing cannot guarantee a deadline on a host
with unbounded CPU contention.
