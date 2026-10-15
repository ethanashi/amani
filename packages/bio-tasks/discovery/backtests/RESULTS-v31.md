# KA-adapt: v3.1 contract rerun

Run date: 2026-10-11. Criteria-v5 and its pin are unchanged. The package-local ignored
`run-v31` run used the same private seed as `run-v5-final`, with a fresh freeze and fresh
public/private card generation. No network acquisition or seed selection occurred.

The complete BT1, BT2, BT3, BT4, variance-validation and coverage-validation result
objects are **exactly equal** to those in the v5 run underlying RESULTS-v5.md. All four
cards' calibration outcomes are also unchanged. Contract/manifest/ciphertext hashes
change as expected. Software still emits unranked evidence cards and D1 is uncertified.

| Card | Result | Calibration |
|---|---|---|
| BT1 overall / neurology | 2.632 / 2.511 | valid |
| BT2 original Nelson | 1.779, 95% CI [1.177, 2.688] | valid; development CI band still fails |
| BT3 finite-stratum plant | 1.869, 95% CI [1.405, 2.488], truth 2.000 covered | valid |
| BT4 historical join | unavailable | refused |

BT1's card was restaged and recalibrated with the existing authenticated R execution
receipt, bound into the new freeze. Its HMAC, original freeze, source bytes, script,
lockfile, installed environment, log and reproduced table were reverified. **The long
upstream R computation was not run again.** Its previously measured runtime remains
1,000.7 seconds. BT2/BT3 estimators, three-stream coverage validation, variance validation
and the power curve were recomputed. The full card run took approximately 233 seconds
(from host-key creation to final result publication).

The v3.1 envelopes pass the merged omb-contract structural/semantic validator. Their
public registries are generated deterministically from public observations and included
in hashed source inventories and analyst manifests. This is not a claim of K1b data
verification or scientific certification. No card declares a dev/held-out partition;
there is no new L2 partition artifact. BT1 retains its disclosed inventory-level schema
for raw upstream files; historical BT4 inputs and independent-family confirmation remain
unavailable.

The public-input-only numerical-delta implementation was rerun for BT2 and BT3 using
the newly staged v3.1 inputs. Both passed through the real sandbox checker, including
secret subsamples and the BT3 candidate intervention. This remains implementation
diversity within one author family, not independent-family confirmation.

Final code checks: typecheck passed; bio-tasks passed all 107 TypeScript and 263 Python
tests (Python wrapper 195.476 s). Explicit leakage: 6/6; pilot amendments: 13/13.
The one root run was **not green**: 4,015 passed, two omb-contract timing assertions failed,
12 skipped and six todo, in 446.84 s. A focused omb-contract rerun also exceeded timing
limits. No read-only package or timing threshold was changed; see BUILD-NOTES for details.
