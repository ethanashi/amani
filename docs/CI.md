# Local CI and publishing gates

Run from the development checkout:

```sh
scripts/ci/install-hooks.sh
scripts/ci/ci.sh fast                 # exact HEAD
scripts/ci/ci.sh full main
snapshot=$(git rev-parse fix/practice-blinding-v2)
scripts/ci/ci.sh full "$snapshot"     # does not follow later branch commits
```

The entry point resolves the commit once and creates a detached worktree under
`~/projects/omerta-bio-wt/_ci/`. It never tests mutable developer files. The committed CI
helper tree is archived into each run’s log directory, so the harness can test older
refs without CI scripts and cannot change under an active run. Commit helper edits
before running CI. Receipts distinguish the tested commit/tree from the pipeline
commit and hash its helper files. Publish exclusions/audit come from this CI harness;
this is intentional when checking pre-publish-tooling commits. No git fetch is run.
Keep `origin/main` current before starting an integration round.

## Local stages

| Stage | Fast | Full | Behavior |
|---|---|---|---|
| Preflight | yes | yes | Node 24, required tools, at least 15 GiB free |
| Checkout/install | yes | yes | Exact commit, `pnpm install --frozen-lockfile`, independent app locks too |
| Typecheck | yes | yes | Root and discovered package/app typecheck scripts |
| Lint | if configured | if configured | Root and discovered lint scripts |
| Pixi environments | no | yes | Discover tracked `pixi.toml`; require adjacent lock; install `--frozen` |
| Unit suites | affected | all | Up to four shards for large packages; one worker per shard; up to four active shards, adjusted to host load |
| Development suites | no | yes | Build local synthetic cards, validate Python/R references, then test race and factory; evidence stays outside tracked files |
| Publish audit | yes | yes | Archive, apply publish exclusions, scan without sealed material |
| Diff secrets/email | yes | yes | Scan changed files since merge-base with `origin/main`, before exclusions |
| Mutation smoke | no | Amani | Baseline replay test; disable output confinement; require an assertion kill; restore source |
| Reference c01–c24 | no | Amani | Three consecutive `race/gauntlet.sh --fake --reference-worker` runs; each must pass all 24 cards, including the two scientific abstentions |
| Integrity | no | Amani | Integrity unit tests and saved public-input acceptance/oracle |
| Blinding | no | Amani | Practice/blinding tests, explicitly enable served-projection tests |
| Replays | no | Amani | Replay tests; saved-input replay also runs in integrity and C1 stages |
| C1 acceptance | no | Amani | Coloc/diagnostic tests, then latest tracked Amani saved-certification replay and acceptance adapter |
| Sealed publish audit | no | yes | Full audit with the documented scanner hook; missing config is failure |
| Licences | no | yes | Production npm dependencies, locked Rust metadata, vendored licences and source/linkage checks |
| Engine release | no | Amani | Medic release builder/policy when available; otherwise executable source closure; import smoke; tarball |
| Studio release | no | Studio app | Locked Rust build, ad-hoc signing, signature verification, fake-launcher smoke and medic exclusion; remove Rust intermediates |
| Sample PDF | no | Paper toolchain | Frozen `omb-package` runtime, render twice using its sample tool and require a PDF |
| Cleanup | yes | yes | Remove only this run's temporary worktree; preserve logs/receipt/artifacts |

Engine and Studio packaging bind the external codec environment to a durable
`runtimes/codec-<hash>` cache under CI state. The cache key includes both
`format-runtime/pixi.toml` and `pixi.lock`; reuse refuses altered cached inputs
and runs the same frozen installer. Packages retain the matching pins, notices,
canonical runtime path and interpreter hash. They verify these before codec use
and never fall back to an unpinned interpreter. Run-directory retention preserves
these runtime caches, so CI checkout cleanup cannot invalidate the codec binding.

Packages/apps are discovered from tracked manifests under `packages/*` and
`apps/*`. Fast selection includes transitive reverse dependencies from both package
manifests and relative source imports. Root/shared/unknown-path changes select all
packages. Nonliteral imports conservatively depend on every package. The diff
base is pinned at preflight. Large Vitest suites are deterministically split into
up to four shards; each shard gets a separate temporary directory and receipt row. An unchanged `main` relative to `origin/main` has no affected suites;
typechecking and auditing still run. Full runs always discover all suites.

A component absent from the tested tree is **not present**, never passed. If the
component exists but its tool, adapter, lock, baseline or fixture is missing, its
stage fails. A lint stage is not present only when no lint configuration exists.
Independent stages continue after failure, providing a useful integration report.
An install/preflight failure blocks dependent stages, which are recorded as failed.
No skipped stage, partial run or running receipt can satisfy a gate.

`fast` targets less than ten minutes; it does not install R/Python environments.
An affected suite requiring an unavailable runtime fails rather than silently
excluding that suite. Run full for native coverage. Existing suites can be slow;
the target is a budget, not a green-result guarantee. Each suite has a 15-minute
crash timeout. Full can take longer, particularly for cold pixi/Rust installs.

Node is `/opt/homebrew/opt/node@24/bin/node`. pnpm uses its shared content-addressed
store, pixi uses its normal shared download cache, and each disposable worktree gets
its own environment links/files. Environments are removed with the worktree; no
other worktree's environment is edited. Each run also has a short, private `TMPDIR`
under `/private/tmp`, removed afterwards, so simultaneous tests cannot count or
clean one another's scratch files. BLAS threads are capped at one.

## Offline and protected-input rules

The child environment is rebuilt from a small allowlist: provider credentials,
live opt-ins and `AMANI_MEDIC` activation are not inherited. Explicit provider-live opt-in unit files are excluded; offline fake-worker tests
remain included even if their filenames contain “live”. Legacy package suites that
require a real sealing key fail before execution: their fixtures must be migrated
to synthetic keys before the full gate can become green. On macOS, installation and simple commands run under a Seatbelt profile that
denies protected held-out cards, keys and installed provider files. Native tests
need their own worker sandboxes: macOS rejects nested sandbox application. These
tests instead load cooperative Node/Python path and command guards while retaining
the production worker sandbox. The guards are an accidental-access defence for
trusted repository tests, not a security boundary for arbitrary hostile test code.
Provider executables and pattern-kill commands are refused. Process cleanup tracks descendant
PIDs and their birth identities; it never signals a process group or pattern.

The sole protected-input exception is the full publish audit's existing one-shot
scanner. Configure paths (never paste token contents) as documented in
[`scripts/publish/README.md`](../scripts/publish/README.md):

Create the host-only file `~/.omerta-bio/ci/sealed-audit.env` (never commit it),
with these four assignments. Replace every placeholder with an absolute path:

```sh
AMANI_LEAK_CARDS='/absolute/card-directory-1:/absolute/card-directory-2'
BIO_GRADING_ROOT='/absolute/grading-root'
BIO_SEALING_KEY='/absolute/sealing-key-file'
AMANI_LEAK_SCANNER='/absolute/installed-checkout/packages/bio-tasks/oneshot/oneshot.sh'
```

The parser accepts literal quoted paths and comments, but no shell expansion or
commands. CI does not source this file, and inherited environment variables cannot
replace it. Missing files, missing values and malformed assignments fail closed.
Only the sealed audit receives these variables; ordinary tests never receive them.
After creating it, rerun `scripts/ci/ci.sh full HEAD`.

CI does not enumerate protected directories or read protected tokens. The scanner
loads its own tokens and emits categories/paths. No full receipt is green without a
successful `ran` leakage-hook result. There is no publish bypass for missing full CI.

The race worktree is the fallback when the tested tree lacks `race/gauntlet.sh`.
CI records the race and one-shot commits, refuses dirty tracked race code, and
checks for a race commit change after success. Race uses only fake reference workers;
there are no auth, quota or model calls. Its existing doctor currently requires
**60 GiB free**, which is stricter than CI's initial 15 GiB floor. CI does not lower
that guard. An unbuilt harness, missing synthetic cards or doctor refusal fails.
When race is integrated, its synthetic build assets must be provisioned in the
isolated tree; absence is a failure, not permission to generate new sealed data.

Integrity/blinding/C1 checks read retained **public served projections and saved
attempts**, not sealed cards. Missing historical baselines fail explicitly. The three round-2 replay baselines
are copied read-only from `~/projects/omerta-bio-wt/_logs/replay` (override with
`AMANI_CI_REPLAY_BASELINES`) into the run directory; their source paths and hashes
are retained in `integrity-baselines.json`. The
latest tracked `validation/amani-*/.../step3-replay.local.ts` and matching acceptance
adapter provide the C1 saved-input protocol; update these adapters during integration
if their fixture or output contracts change. Existing version-specific assertions
remain authoritative and may expose integration drift.

The licence gate conservatively accepts a small explicit permissive SPDX set,
including explicit permissive alternatives in dual licences. Unknown/missing
licences fail for review. GPL-family npm/Rust libraries or vendored code fail;
R, pandoc and other GPL analysis tools may run as separate external processes.
Source checks catch declared GPL code and known GPL FFI linkage, but licence
metadata checks are not a substitute for review of new vendored code or native FFI.

## Receipts and logs

Each run atomically writes:

```text
~/.omerta-bio/ci/receipts/<full-commit>-<fast|full>.json
```

The receipt records schema, commit, tree, mode, overall status, pipeline provenance,
tool versions, harness commits, stage status/duration/log, diff base, package
selection and per-suite results. Every run has a separate log directory under
`~/.omerta-bio/ci/`, including `summary.txt`. The canonical receipt points to the
latest run of that commit/mode. Failed reruns replace earlier green receipts.
Retained release artifacts and PDFs are in that run's log directory.

```sh
python3 -m json.tool ~/.omerta-bio/ci/receipts/<commit>-full.json
python3 scripts/ci/receipt.py . <commit> full
```

A failure prints the first failing stage and its log path. For suite failures,
`unit-suites.log` points to each package's log. Logs can contain private developer
paths and stay local; do not publish them. Local receipts are trusted owner-machine
state, not cryptographic attestations or a defence against someone editing local
files. GitHub cannot verify a receipt stored on the Mac.

## Push and publish gates

The installer accepts only the development repository's canonical origin URL and
sets local `core.hooksPath` to the main checkout's `scripts/ci` directory
(`~/projects/omerta-bio/scripts/ci`), even when invoked from a linked worktree.
Linked development worktrees share this config. After merge, run
`sh scripts/ci/install-hooks.sh` from any worktree. It migrates the former
`~/projects/omerta-bio-wt/ci/scripts/ci` setting; other custom hook paths are left
untouched and must be integrated first. The main checkout must contain the merged
hook before installation.

The pre-push hook checks every non-deletion ref update and peels annotated tags to
commits. `origin` → `refs/heads/main` requires a green **full** receipt for that exact
commit. Other destinations require **fast**; if absent/failed, the hook runs fast
in isolation and checks again. It does not automatically spend full-run time while
pushing main. Deletions have no commit to test.

For a deliberate emergency override:

```sh
AMANI_CI_OVERRIDE_REASON='incident explanation and follow-up owner' git push ...
```

The reason must be at least 12 characters. Every bypass records UTC time, local
repository, remote, ref updates and reason in `~/.omerta-bio/ci/overrides.jsonl`, and
prints a prominent notice. This is a push-hook override only. `--no-verify` can bypass
any Git client hook without this log and is outside the supported emergency path.

`publish.sh` checks the exact full receipt **before** export, audit, clone, visibility
query or push, including `--dry-run`. Its existing cleanup-audit override cannot
bypass this gate. Publishing remains an owner-session action after integration.

## Lightweight GitHub Actions

`.github/workflows/ci.yml` runs only on Linux for pushes and pull requests targeting
main, with a 20-minute job timeout, read-only contents permission and concurrency
cancellation. Every job has `github.repository == 'ethanashi/amani'`; development
repository pushes therefore start no runner jobs. There are no configured secrets,
release jobs or macOS runners. Checkout does not persist credentials.

It installs Node 24 and the package manager pinned in `package.json`, installs with
the frozen lock, typechecks discovered workspaces, runs portable offline tests and
audits an excluded git archive. `github-units.mjs` discovers tests and follows local
imports, conservatively excluding native/analysis/live/host-fixture dependencies.
It prints selected and excluded files with reasons; unknown external dependencies
need review before adding them to this small CI subset. Full local CI remains the
release gate. The portable selector passed 43 files / 840 tests locally; this was
not a hosted Linux Actions run.

Workflow syntax was checked against the [GitHub workflow reference](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)
and [setup-node documentation](https://github.com/actions/setup-node). `actionlint`
was unavailable; Ruby/Psych parsed the YAML and assertions checked the job guard,
Linux runner and timeout. Run `actionlint .github/workflows/ci.yml` when available.

A future release workflow could trigger only on version tags, resolve the exact
release commit, require a verified full receipt/artifact from an owner-controlled
runner, then build/upload checksummed engine and Studio artifacts. Keep ordinary
checks on Linux; a macOS release runner needs an explicit budget decision. Ad-hoc
signing supports local development but is not notarization. Developer ID signing
and Apple notarization require the paid Apple Developer Program account the owner
does not currently have. No such workflow or credentials are installed here.

## Validation evidence

The implementation was committed in sub-steps after merging `docs/amani` without
conflicts. Validation snapshots: main `6738467a37fa69bc5fa68793cf18474c38644e26`;
blinding branch `e640c88bb47e856e144e6ae64fd750bc54240547`. The latter was resolved
once while another job continued committing; its working tree was not changed.

Receipt/process/guard regression tests are run with `python3 -m unittest discover -s scripts/ci -p test_ci.py -v`. The real installed pre-push hook
refused a missing full receipt in a disposable repository with exactly one local
bare origin; the bare repository remained empty. `publish.sh HEAD --dry-run` refused
a missing full receipt before any network work. Local evidence lives under
`~/.omerta-bio/ci/gate-demo/`.

An initial gate demonstration mistakenly used `git -c remote.origin.url=...`, which
appended a URL instead of replacing the configured URL: it addressed GitHub as well
as the local remote. Both updates were blocked by the hook before ref changes.
The corrected demonstration used an isolated repository with only a local remote.
No remote refs were changed. Do not use a temporary `-c remote.origin.url` override
for an isolated push test.

Measured stage results and integration blockers follow. A dash means that the mode does not include that stage.

### Completed main proof

Main was pinned at `6738467a37fa69bc5fa68793cf18474c38644e26`. Fast finished in
13.6s and full in 892.0s, both **failed**. Fast used CI harness `88d76111`;
full used the frozen CI harness `a92c6ed5`. Timings include this Mac's concurrent workload.
The full run attempted 36 unit shards: 32 passed and 4 failed.

| Stage | Fast (seconds) | Full (seconds) |
|---|---:|---:|
| preflight | passed 0.30 | passed 0.31 |
| checkout-install | passed 1.90 | passed 2.06 |
| typecheck | passed 6.95 | passed 7.45 |
| lint | not present | not present |
| pixi-environments | — | passed 8.93 |
| unit-suites | passed 0.28 | failed 861.72 |
| publish-audit | failed 3.39 | failed 3.86 |
| diff-secrets-email | passed 0.29 | passed 0.30 |
| mutation-smoke | — | not present |
| reference-c01-c24 | — | not present |
| integrity | — | not present |
| blinding | — | not present |
| replays | — | not present |
| c1-acceptance | — | not present |
| publish-audit-sealed | — | failed 1.42 |
| licences | — | passed 0.27 |
| engine-release | — | not present |
| studio-release | — | not present |
| paper-pdf | — | not present |
| cleanup | passed 0.48 | passed 5.66 |

The non-leak publish audit found **16 absolute-home-path findings and 127 private-project
name findings**; no secrets or personal-email findings. Main's failed unit shards were
`bio-bench` (fake pilot grading unavailable), `bio-pipeline` (CLI test parses undefined
output), `bio-tasks` (explicitly requires the prohibited real sealing key), and one
`omb-certify` shard (149 assertions passed, but Vitest reported an unhandled worker RPC
timeout). These are red gates; passing assertions do not erase a framework error.
The sealed audit failed because its four required environment settings were absent.

CI regression checks: **16 passed**. An isolated native-worker/fixture check passed
**20 tests**. A subsequent isolated check of the native sandbox boundary and the
strict fake-provider environment contracts passed **18 tests** across three files.
The last boundary fix is commit `bc345dfd`; it strips CI preloads before entering
production worker sandboxes. Full proofs retain their original frozen helper commit;
the targeted follow-up is recorded separately rather than rewriting their receipts.
Commit `f2327741` also fixes the process guard's custom promisifier: it preserves
Node's `{stdout, stderr}` result and error streams while keeping the guard active.
The formerly failing `bio-pipeline` CLI test passes in a fresh isolated checkout of
the pinned Amani snapshot (one selected test, 1.73s). Its separate log is
`~/.omerta-bio/ci/promisify-proof-rzljrlco/proof.log`. This was also a CI defect,
not evidence of an application CLI regression.

Full main receipt: `~/.omerta-bio/ci/receipts/6738467a37fa69bc5fa68793cf18474c38644e26-full.json`.
Fast main receipt uses the same hash with `-fast.json`. Per-run `receipt.json` copies
and `summary.txt` remain next to logs, even when a later run replaces the canonical receipt.

### Reference regression and remaining integration work

The final Amani reference regression used race commit
`1abe686173a845813edbe2385a3ca858c60dbfca` and one-shot commit
`f1ea20c4577680e7ad7ff8b7d54c3e2d94723893`. Race's own `batch.json` agrees with the
receipt's runner commit and records `reference-fake`. It ran all 24 cards in 226.48s:
20 completed correctly, c23/c24 produced the expected scientific abstentions, and
c18/c22 reported system faults because their code never ran on the synthetic schema
(seven attempts each). Coverage was complete; the strict reference gate failed.
A preliminary run had refused at the race doctor's 60 GiB floor; this final run had
61.46 GiB and actually exercised the cards. Do not report the preliminary refusal
as the final reference result.

Before integration can earn a green receipt:

- Fix the failed package assertions and migrate real-key test fixtures to synthetic
  fixtures. The `omb-adapters` preload failure in the frozen proof was a CI defect;
  commit `bc345dfd` fixes it and the separate 18-test native check passes. The
  `bio-pipeline` CLI failure was the promisifier defect fixed by `f2327741`, with
  its exact failing test now passing. Remaining failures still need resolution.
- Resolve c18/c22's reference-worker execution failures and rerun all 24 cards.
- Clean the publish snapshot. The Amani audit found 149 absolute-home-path findings,
  128 private-project-name findings, and a missing licence-file finding for
  `third_party/openpyxl-NOTICE.md`. It found no secrets or personal emails.
- Supply the four documented sealed-audit environment settings. Missing configuration
  remains a failed stage; CI will not guess protected card paths or inspect keys.
- Provision the public saved replay baselines and synthetic race assets for the
  integration checkout. Keep sufficient disk for each component's own guard:
  race currently requires 60 GiB and Studio's release script requires 50 GiB.
- Exercise the medic-policy release, Studio app and paper PDF after those branches
  are integrated. Their adapter entry points were inspected, but absent components
  are not validated by these historical snapshots.

Run the final integrated commit through full CI using the latest committed helpers.
The proofs here deliberately retain their original target and pipeline commits;
a later targeted fix does not retroactively make an earlier full receipt green.

### Completed Amani blinding-branch proof

The full run tested the pinned snapshot
`e640c88bb47e856e144e6ae64fd750bc54240547`, using frozen CI helpers `a92c6ed5`.
It finished **failed in 1709.0s** (28m 29s). Of 40 unit shards, 34 passed and six
failed. Fast was not requested on this snapshot. The run removed its temporary
checkout and scratch directory successfully.

| Stage | Full (seconds) |
|---|---:|
| preflight | passed 0.68 |
| checkout-install | passed 5.73 |
| typecheck | passed 29.77 |
| lint | not present |
| pixi-environments | passed 12.71 |
| unit-suites | failed 632.87 |
| publish-audit | failed 3.91 |
| diff-secrets-email | passed 1.03 |
| mutation-smoke | passed 15.54 |
| reference-c01-c24 | failed 226.48 |
| integrity | passed 32.23 |
| blinding | failed 658.77 |
| replays | passed 18.14 |
| c1-acceptance | passed 53.97 |
| publish-audit-sealed | failed 2.24 |
| licences | passed 0.28 |
| engine-release | passed 5.99 |
| studio-release | not present |
| paper-pdf | not present |
| cleanup | passed 8.60 |

The six failed unit shards were `bio-bench`, `bio-pipeline`, `bio-tasks`,
`omb-adapters`, `omb-figures`, and `omb-gauntlet`. The two CI-induced failures and
subsequent targeted fixes are identified above. Remaining package failures include
unavailable real-key grading fixtures, the committed `ae-funnel.svg` gallery not
matching regenerated hashes, and the case/whitespace-normalized G2 plan lock.

Blinding passed 17 of 19 tests. Served c1 failed the key-disjointness assertion at
`served-practice.test.ts:62`: a generated practice key matched a real served key.
Served c5 exceeded its 240,000ms test deadline. c3 and c4-r2 passed. These results
need investigation in the blinding branch; successful scramble/synthetic self-check
messages do not override the independent assertion or timeout. Saved-input C1
acceptance is a separate protocol and passed.

Mutation, integrity, replay, C1 acceptance, licences and the engine source release
passed. The release tarball is retained as `engine.tgz` beside the logs. Studio and
paper were absent, not passed. The sealed audit failed for missing configuration,
so no successful full receipt is available for publishing or merging to main.

Receipt: `~/.omerta-bio/ci/receipts/e640c88bb47e856e144e6ae64fd750bc54240547-full.json`.
Logs and immutable per-run receipt:
`~/.omerta-bio/ci/e640c88bb47e-full-3p8d16hq/`.
First failure: `unit-suites.log`; individual shard logs are linked in that JSON log
and the receipt. Full main's first failure is also `unit-suites`; fast main's first
failure is `publish-audit`.

Release verification uses the native subprocess guard for the paper renderer so
Chromium can establish its own OS sandbox. The guard still rejects provider CLIs
and privileged launcher commands. Rust licence checks use Cargo's locked host
runtime tree (`normal,no-proc-macro`), preserving the same runtime/build boundary
as Studio's dependency notices; build-only MPL tooling remains listed there for
the owner's pending policy decision. Runtime SPDX expressions retain AND/OR
grouping, and unknown licences fail closed. Unicode-3.0 notices are already
included in Studio's complete third-party licence file.

### Paper PDF stage in isolation

After committing changes, `scripts/ci/ci.sh paper-pdf` runs the same
`Pipeline.paper` method used by full CI against the clean current checkout and its
locked installed runtime. It renders the sample twice and compares digests,
using the native offline guards. Receipts and PDF copies are under
`.bio-scratch/ci-paper-pdf/<timestamp>/`; the source commit and unchanged tracked
worktree are checked. This deliberately scoped receipt is **not** a fast/full CI
pass and cannot satisfy a publish gate. It does not run sealed audits or read
held-out/key material. Use `fast` or `full` for commit-isolated complete CI.


Host-only sealed scan exceptions may be configured with `AMANI_LEAK_ALLOW` in
`~/.omerta-bio/ci/sealed-audit.env`, using a literal absolute path outside the
repository to `sealed-leak-allow.json`. Never commit that file. Its JSON array
accepts exactly one of these shapes per entry:

- `{"term_sha256":"<64 lowercase hex>","category":"redact","cards":["card-id"],"reason":"Public or generic term; explain why here"}`
- `{"path":"relative/binary.png","file_sha256":"<64 lowercase hex>","category":"identifier","reason":"Binary byte coincidence; explain why here"}`

Reasons need at least 20 non-padding characters. Unknown fields, invalid hashes,
unsafe paths and malformed entries fail closed. Term entries apply only to the
listed cards and category. File entries apply only to binary files with the exact
bytes and category. Canary and structural refusals cannot be exempted. The receipt
retains allowlisted findings, counts per category and the allowlist SHA-256; every
uncovered finding fails. Structural scanner findings carry a null term hash.
The full pipeline uses the tested commit's scanner and pinned Python environment;
the configured scanner path remains available to standalone publish audits.


At startup CI retains the two newest recognized run directories under
`~/.omerta-bio/ci/`, plus any still-running pipeline. Older runs have their receipts
archived under `receipts/runs/` before their scratch trees are removed. Existing
receipts and runtime caches are retained. Cleanup restores owner permissions on
owned directories only, so frozen files can be unlinked without changing shared
file inodes or following symlinks.
