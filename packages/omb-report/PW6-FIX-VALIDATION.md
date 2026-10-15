# PW6 fix-round validation — 2026-10-13

The review findings and probes were read from `_logs/pw6-review.json` and the
provided `codex-review-pw6` scratch directory. Each implementation sub-step was
committed. No pattern kills or process kills were used.

## Package checks

Final package run after all source changes and mutation-source restoration:

| Check | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| omb-report | 1,788 | 0 | 0 |
| omb-paper | 136 | 0 | 0 |
| Total | 1,924 | 0 | 0 |

Combined time: 10.78 seconds. Node 24.19.0, Vitest 3.2.7, one worker,
`--no-file-parallelism --no-isolate --reporter=json`.
Root `tsc -p tsconfig.json --noEmit` passed after the final source changes.
Raw package report: `/tmp/pw6-package-suites.json`.

## Root suite — one run only

Launched at 14:44 Arizona time with one-minute load **3.17**, **64,332,944 KiB**
free (**61.35 GiB**), satisfying both requested conditions. The tested source
revision was `95d51766`; subsequent code changes tightened Unicode/name normalization, rejected inherited family
keys, and compared limitation answers as exact multisets. They are covered by the final
package suites above; root was not rerun. Documentation and mutation scripts
were edited while root ran; its source and test files were held fixed.

Command:

```sh
env -u BIO_GRADING_ROOT nice -n 15 /opt/homebrew/opt/node@24/bin/node \
  node_modules/vitest/vitest.mjs run --maxWorkers=2 --reporter=json \
  --outputFile=/tmp/pw6-root-suite.json
```

Result: **exit 1**, **7,724 passed, 2 failed, 15 skipped**, 672.997 seconds.
470 test files passed and 2 failed. Vitest's suite/group counters report three
failed groups, not three failed files. Skips are not passes. Shared load rose
above 58 during the run. The parent runtime was Node 24.19.0; subprocess `node`
on the inherited PATH resolves to Node 22.22.3.

Failures outside the changed package:

- `bio-tasks/test/python.test.ts`: the Python harness reports subprocess timeouts,
  including `run-claude-arm.sh real` exceeding its two-second timeout in
  `test_dry_agent_refused_without_dry_run`.
- `omb-certify/test/v2b-monte-carlo.test.ts`: “Monte Carlo null simulation: 2000
  replicates, plus-one fixed-B rejection bound and Wilson CI” failed after
  12.149 seconds. The JSON records `STACK_TRACE_ERROR`; it does not expose a
  more specific assertion message. No causal attribution or passing rerun is claimed.

Every omb-report and omb-paper file passed in this root run. No root retry was
performed. Raw report and log: `/tmp/pw6-root-suite.json` and
`/tmp/pw6-root-suite.log`.

## Mutation audit

The fix-round inventory removes the disproved `directed:comprehension-q2-null`
exemption. That ID now disables the honest-null branch and must be killed by
reachable voided/non-identifiable cases, with both retained and absent metrics.
The audit also covers software provenance, receipt bindings, final-packet replay,
severity selection, precise prose assertions, review flags, acronym normalization,
and accent-insensitive copy comparison. The original 322/342 claim is superseded by the final counts below.

| Fix-round phase | Mutants in inventory | Executed this phase | Retained kills | Final kills | Survivors | Invalid |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Full audit | 387 | 387 | 0 | 334 | 53 (34 then unexplained) | 0 |
| Boundary follow-up | 389 | 139 | 250 | 352 | 37 documented equivalent | 0 |
| Final Unicode/name follow-up | 391 | 73 | 318 | 354 | 37 documented equivalent | 0 |

**Final: 354/391 killed (90.54%); all 354 non-equivalent mutants killed;
37 documented equivalent survivors; zero unexplained survivors; zero invalid runs.**
The equivalence claims are explicit reasons for the current implementation, not inferred
merely from surviving tests. In particular, both the null-branch exemption and the
now-reachable numeric-confusable expansion exemption were removed and their mutants killed.
The first full audit did not meet this result; follow-up boundary tests and fixes were required.

Refreshes verify source fingerprints and unchanged prefixes of every pre-existing PW6
test/fixture. They rerun every non-kill, all mutants in changed source files, and every new
mutant. The final run changed only the acronym source; its entire mutation set was rerun.
All ten source fingerprints matched after restoration; no mutation journal remains.
See `pw6-mutation-results.json`, `PW6-MUTATION-KILL-TABLE.md`, and
`scripts/pw6-equivalent-mutants.json` for the reproducible inventory and per-mutant evidence.

Coverage includes replay with stale and recomputed hashes, forged box metadata with matching
paper text and digests, host model aliases/inherited keys, receipt replay, edited scored
results, null outcomes with and without metrics, severity/tie/causal/length boundaries,
identical record-backed limitation rows, all registered lowercase acronyms, bounded
punctuation, Unicode code-point spans, exact approved entity names, accented copied answers,
and jargon/segmentation examples carrying independent-review flags.
