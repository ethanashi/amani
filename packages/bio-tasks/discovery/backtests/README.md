# KA1 trial-outcome development backtests (review repair, v5)

The host code is Python using the existing pinned scientific environment; the public-only
writer and D1 policy boundary are TypeScript. No production ranking is certified.

From the repository root:

```sh
export PATH=/opt/homebrew/opt/node@24/bin:$PATH
packages/bio-baseline/.pixi/envs/default/bin/python \
  packages/bio-tasks/discovery/backtests/run.py --as-of 2026-10-11 \
  --out "$PWD/packages/bio-tasks/.ka1-private/new-run"
```

The fresh output must be inside the package's ignored `.ka1-private/` research directory.
This exception to KA0's external-root staging rule keeps this builder's writes in its package.
Keep that entire directory, the repository, generators and host scripts outside analyst mounts.
The existing rerunner denies home/repository reads, exposes only staged data and the baseline
runtime, and denies network. The public writer is a separate process with an allowlisted
protocol and empty host environment; that process separation alone is not an OS sandbox.

Sources default to the existing read-only `~/.omerta-bio/datasets/discovery` cache. For explicit
acquisition, set `BIO_BACKTEST_CACHE` to a package-local private directory and use `--fetch`.
Cached fetches preserve the actual original retrieval date and unchanged manifest bytes.
Missing cached retrieval provenance fails closed. `sources.lock.json` pins URLs, licences,
sizes and hashes. Minikel data/code are CC BY 4.0, Open Targets CC0, and ChEMBL CC BY-SA 3.0.
Nelson's original similarity is Supplementary Data Set **4**; its publisher supplement licence
is not verified for redistribution, so its bytes are not committed.

## What the cards measure

- **BT1** executes the full unmodified upstream R analysis in empty output directories, in
  locked R 4.2.3 plus SHA-pinned lawstat. Its receipt authenticates the precommit digest, source
  manifest, script, complete installed environment tree, lock, log, elapsed time and produced
  table. Attached executions need the same host key, verified HMAC and unchanged bound inputs;
  their receipt, log, table and original precommit enter the new freeze. The submitted worker
  must provide the exact constrained `run_all.sh` request disclosed in TASK.md and an exact
  copy of the supplied R script under `code/`. The host validates that request and launches
  the identical R script itself. Arbitrary worker shell is never run with host key access.
  A pasted table or JSON-only script fails the same check path used by calibration. Numbers
  are compared with ±0.05 tolerance. This is execution plumbing, not blinded judgment.
- **BT2** uses the original Nelson 2013 terms/matrix as primary genetics. The 2023 MeSH roll-up
  and 0.8 threshold are explicitly named sensitivities. Current vocabulary still joins outcomes
  and therapy areas; this is development data, not certified 2013-only ascertainment.
  `lApprovedUS.EU == TRUE` becomes counted, never-scored `pre-snapshot-approved`, regardless
  of blank/late `year_launch`. Known dated sentinel approvals also exclude pre-snapshot events.
  Blank launch years are counted. The field is neither complete nor a first-approval timestamp.
- **BT3** solves the exact finite-stratum ratio of expected MH components, including success
  self-exclusion, to 2.0. Exposure prevalence varies with stratum risk and averages 3% in
  expectation. Thus the crude arm is scientifically biased. No seed or realization is selected
  for a favorable estimate. Six noisy outcome proxies and two honest controls have opaque
  keyed names and identical metadata, alongside the primary support exposure. None is a
  visible label copy. The actual submitted per-pair scores are rerun after secret leak-column
  permutations; any score change fails. A leaky positive control must show performance collapse.
  This validates the intervention harness, not a real OT feature provenance ingestion system.
- **BT4** parses the archived Open Targets evidence, but refuses the available 2026 REST MeSH
  mapping for the 2019/2024 join. It stages an explicitly unavailable card. Missing historical
  target crosswalks and dated indication approval events remain gaps. No phase-four or ATC
  shortcut creates approval evidence.

## Statistical method and keys

The old product-multinomial pigeonhole interval counted the intersection contribution with
the wrong sign for this use. v5 uses log-MH and paired-AUC influence functions with the CGM
covariance **target + indication − target×indication**. Scalar Gaussian score multipliers have
that covariance; their known normal quantiles avoid Monte Carlo endpoint noise. Nonpositive
variance and unidentified estimands remain unavailable. This is first-order asymptotic
inference, not a finite-sample exact interval. See [Cameron, Gelbach & Miller](https://cameron.econ.ucdavis.edu/research/JBESpaper2009version.pdf).

Tests compare both derivatives to numerical derivatives and validate variance against an
analytic crossed random-effects model and simulation. The host run separately compares
nonlinear one-way bootstrap components and evaluates 600 planted draws over three keyed
streams. Calibration recomputes Clopper–Pearson bounds from counts: reference lower ≥0.8 and
crude upper ≤0.2 for each stream; one passing realization alone cannot validate the card.

BT2/BT3 keys include a secret keyed 80% subsample and its reference. A submitted program must
recompute on both the public table and hidden subset. Public estimates alone cannot regenerate
the whole key or pass by constant recall. CI endpoints allow ±0.15 on the log scale and the
point estimate ±0.05; BT3 also requires truth coverage. The complete output schema and method
are disclosed. Key ciphertext, task ID, card, manifest, contracts and calibration are bound
and checked. Single-implementation reference keys still lack independent family agreement.

The D1 power experiment is separate from the RR plant: bounded Gaussian tie-breaking scores
produce expected incremental within-phase AUROC gains over **original-Nelson B_gen**.
The v5 grid uses 1,000 trials per gain, including 0, .02, .05 and .055. It is conditional on
this observed cohort, and cannot certify a real ranker or an unseen evaluation window.

For a historical mapping, run `chembl_join.py --release N --sha256 HASH --as-of SNAPSHOT
--retrieved-at ACTUAL_DATE`. Release dates 25–36 come from the official dump release notes'
“prepared on” lines. Unknown releases, missing dates, a before-map after snapshot, or an
after-map after horizon are refused. The streaming extractor deletes its SQLite/archive
scratch on all exits and retains only the derived mapping. Real historical dumps were not
acquired in this repair.

## Verification and retained history

Run `python packages/bio-tasks/test/run.py test_backtests test_backtest_fixes test_leakage`
with the baseline pixi Python, then the full package suite, `pilot/test_amend.py`, root
`pnpm typecheck` and `pnpm test`. Tests use offline fixtures, seeded randomness and exact fault
boundaries. The long R reproduction and scientific simulations are explicit host experiments,
not unit tests. BUILD-NOTES.md records counts, runtimes, results and remaining gaps.

Historical v4's BT1 result was an attachment of execution-v2 under criteria-v1; v4 did not
perform another R execution. Its unauthenticated receipt and exact-CI grading are superseded.
v5 has a fresh authenticated R run, retains the original and current freezes, and does not
claim an external timestamp or a new unseen-outcome window.
