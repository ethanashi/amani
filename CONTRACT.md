# Amani build contract

Amani is an **untrusted generator inside a trusted checker**. A research model (Claude
Code or Codex) may propose anything. Small, fixed, deterministic code that the model cannot
read or write decides what counts. This file is the contract every builder works to. The design
it implements is in `docs/design/` (the v2 design, sections 3, 4 and 8).

## Hard rules for every builder

1. **Stay in your package.** Write only inside `packages/<your-package>/` in your own worktree
   and branch. `packages/bio-core` is read-only for everyone except the Block 1 builder. If you
   need a change elsewhere, describe it in your `BUILD-NOTES.md`; the integrator applies it.
2. **Never touch `main`, never push, never touch other worktrees, never touch host-side
   state or keys.** Commit on your branch only. Copying or adapting code from the author's earlier
   private kernel project is allowed only with a note in `PROVENANCE.md`.
3. **Tests are fast and deterministic.** No test waits on a real timer longer than it must.
   - Time comes from an injected clock (`now: () => number`), never `Date.now()` inside logic.
   - Crash tests inject faults at exact boundaries: the child process prints a marker when it
     reaches a boundary and the test sends SIGKILL immediately, or logic exposes a
     `faultAt(point)` hook. No `sleep`-and-hope.
   - Timeouts in tests are milliseconds. Each package's suite runs in **under 10 seconds**; the
     whole repo in **under 60 seconds**.
   - No network in tests except loopback servers the test itself starts.
4. **Clean up everything.** Every test deletes its temp directories (`afterEach`). Production
   code deletes every working directory on every terminal path (see Block 5).
5. **Fail closed.** Unknown, missing, skipped, unparseable or unavailable always means
   *not verified*. A check that did not run never counts as passed. A missing reviewer means
   `tentative`, never `passed`.
6. **Strict TypeScript** (Node ≥24, ESM, `node:sqlite`, no runtime npm dependencies unless the
   integrator approves). `pnpm typecheck` and `pnpm test` must pass from the repo root.
   Run with Node 24: `export PATH=/opt/homebrew/opt/node@24/bin:$PATH`.
7. **Write `packages/<pkg>/BUILD-NOTES.md`**: what is done, which acceptance test covers which
   requirement, deviations from this contract, known gaps. Be honest; unfinished is fine,
   claiming finished when it is not is not.

## Packages and owners

| Block | Package | Builder | Reviewer (other model family) |
|---|---|---|---|
| 1 | `bio-core` additions + `bio-runner` | Claude | Codex |
| 2 | `bio-guard` | Codex | Claude |
| 3 | `bio-ledger` | Codex | Claude |
| 4 | `bio-checks` | the earlier kernel project (Claude workers, calibrated checks) | Codex |
| 5 | `bio-supervisor` | Codex | Claude |
| 0 | `bio-baseline` (scripts, task, arm results) | Claude + Codex arms | — |

Packages depend only on `@omerta-bio/core` (`packages/bio-core/src/index.ts`) and their own code.
Cross-package wiring happens in Block 7, not now. Keep interfaces small and exported from
`packages/<pkg>/src/index.ts`.

## bio-core (already present, 45 tests green)

`SqliteEventStore` (hash-chained append-only journal), `canonicalJson` / `canonicalSha256`,
`ProofArtifactStore` (content-addressed, mode 0400, fsync), `BoundedProcessRunner` (timeouts,
output caps, process-tree reaping), `HostSandbox` (seatbelt; deny reads/writes/network by policy).

## Block 1 — foundation (`bio-core` additions, `bio-runner`) — Claude

- **Memory and CPU guard** added to the process runner path: an RSS cap and CPU-time cap using a
  `ps` census of the process group; a hog over the cap is killed with a recorded reason. Also
  `nice` for analysis jobs.
- **`bio-runner`**: copy `L/packages/harness/src/claude-worker.ts`, `runner-environment.ts`,
  `runner-result.ts`, `claude-bin.ts`, `mission-repair-session.ts` and the tool-less
  `claudeLlm` from `L/packages/company/src/llm.ts`; merge in `A/packages/harness/src/egress-proxy.ts`
  and the network-policy changes from `A`'s `claude-worker.ts` (commit `ea326c85`). Network modes:
  `explore` (allowlisted hosts through the logging proxy) and `confirm` (no network). Report schema
  extended with `artifacts` and `claims` without loosening fail-closed parsing. Sessions keyed by
  investigation/hypothesis id with a resume cap and a fresh-session fallback seeded by a digest
  string the caller supplies.
- Acceptance tests (use a fake `claude` binary script, never the real CLI):
  - fixture task returns `{status, summary, artifacts, claims}` and a session id;
  - a bogus resume id raises `ClaudeResumeUnavailableError` and a fresh start is reported;
  - SIGKILL mid-turn yields reaped process tree (no descendants);
  - `confirm` mode: the worker environment has no proxy and network settings deny all hosts;
    `explore` mode: only allowlisted hosts pass the proxy and every request is logged;
  - secrets paths are in deny-read settings in both modes;
  - memory hog (a child allocating past the cap) is killed with reason `memory-limit`;
  - fake binary returns "usage limit" twice then valid JSON: tool-less call succeeds (fake clock,
    no real waiting);
  - two specs differing only in a nested field hash differently (`canonicalSha256`; never copy
    the buggy `specHash` from `L/packages/company/src/experiments.ts`).

## Block 2 — data rules (`bio-guard`) — Codex

- **Dataset manifests**: record `{source, accession, url, retrievedAt, sha256, bytes, terms}` per
  file; `verifyManifest(dir)` refuses analysis when any hash differs or a file is missing/extra.
- **Terms registry**: rules that refuse staging restricted data by rule: PRO-ACT (bans consumer
  AI tools), Answer ALS (institutional agreement), AMP ALS Knowledge Portal controlled tier,
  dbGaP/controlled-access genomic data (NIH NOT-OD-25-081). Allowed examples: GEO public series,
  cBioPortal public studies, GWAS Catalog summary statistics, CELLxGENE CC-BY datasets.
- **Agent sandbox policy builder**: from an investigation layout (`data/`, `sealed/`, `work/`,
  `results/`, `report/`) produce deny-read paths (secrets: `~/.ssh`, `~/.aws`, `~/.codex`,
  `~/.claude*` credentials, any `.env`; and `sealed/`), write roots (`work/` only for the agent),
  and a `HostSandbox` request for re-execution (read `data/` + env roots, write a fresh output dir,
  no network).
- **Egress log checker** (pure function): given egress log lines and a mode, `confirm` rejects
  any host contact; `explore` rejects any host not on the allowlist. Returns reasons.
- Acceptance tests: hash mismatch blocks; extra/missing file blocks; staging a PRO-ACT file is
  refused with a reason; `confirm` run log with one host contact is rejected; `explore` log with
  an unlisted host is rejected; a sandboxed script that reads `~/.ssh`-like and `sealed/` test
  paths, writes outside roots and connects to a loopback listener is denied on all counts (use
  temp fixture dirs, not your real home).

## Block 3 — notebook and plan locking (`bio-ledger`) — Codex

- **Record types** (immutable JSON, id = `canonicalSha256(payload)`, typed parent links):
  `question`, `observation` (software only), `assumption`, `hypothesis`, `prediction`,
  `experiment` (planned/locked), `check`, `interpretation` (tentative/confirmed/refuted/insufficient),
  `decision`, `citation`, `amendment` (supersedes id, reason, `post_unblinding`), `probe`
  (closed-book prediction recorded before unsealing), `idea` (side-finding card:
  new/triaged/tested/dead/promoted). Status changes are new records that supersede old ones.
  Optional starting point: `~/research_notes/Amani research agent design/handoff/` zip schemas.
- **Ledger** on `SqliteEventStore`: one owner per investigation (lock with takeover of a dead
  holder), pause/cancel/resume, attempt counts that survive resume.
- **Pre-registration locks**: `lockPlan(plan)` stores the canonical hash; editing a plan after any
  sealed partition was looked at forces an `amendment` with `post_unblinding: true`.
- **Sealed partitions**: commitments must exist before unsealing; a look counter allows one look
  per pre-registration; a burned partition refuses further looks.
- **Closed-book probe**: unsealing is refused unless a `probe` record exists for that experiment.
- **Idea cards**: an idea cannot be marked confirmed using the same data hash that inspired it.
- Acceptance tests: plan edited after unsealing forces a `post_unblinding` amendment; unsealing
  without a commitment or without a probe is refused; second look at a burned partition refused;
  two owners race and exactly one wins, killing the owner lets the other reclaim (fault injection,
  no sleeps); a supported claim later contradicted ends `contradicted` with both records kept;
  confirming an idea on its source data is refused; tampered record detected by chain verify.

## Block 4 — the checker (`bio-checks`)

- **Re-execution comparator**: given recorded output hashes/tables and a fresh re-run, compare by
  exact hash or declared numeric tolerance; nondeterminism is flagged, not hidden.
- **Claimed-equals-recomputed**: a number the worker claims is stored only as `claimed`; it
  becomes an observation only if recomputation from code + data matches within tolerance.
- **Acceptance-artifacts rule**: every claimed output file must exist; every named check must
  have executed; `skipped` counts as not run.
- **Calibration**: a task is valid only if the empty/untouched analysis fails, the reference
  passes, and permuted labels fail; statuses `refused-vacuous`, `refused-reference-fails`,
  `refused-inconclusive`.
- **Validity checkers**: donor-disjoint split check (no donor in both train and test);
  pseudo-replication check (replicates of one cell line/donor not counted as independent);
  cluster-vs-gradient check (stable "clusters" in a continuous simulated gradient are flagged).
- **Claim label rule**: `confirmed` only if re-execution passes AND a top-rung check agrees
  (new-data replication or blind re-implementation by a different model family); otherwise at
  most `tentative`; unavailable reviewer => `tentative`.
- **Citation checker** with an injected resolver (tests use fixtures, no network): fabricated DOI
  flagged; real DOI whose quoted span is absent from the text flagged; uncited claim refused.
- Acceptance tests: worker writes p = 0.001 while the script yields 0.4 → claim marked unsupported;
  clustering pipeline that finds three clusters in pure gradient data → invalid; donor leak →
  invalid; fake DOI caught; a check reporting `skipped` counts as not run; no valid case rejected.

## Block 5 — cleanup and budgets (`bio-supervisor`) — Codex

- **Cleanup on every terminal path**: success, analysis failure, budget stop, operator cancel,
  SIGKILL of the worker, SIGKILL of the orchestrator then restart. After each: no directory with
  the run id under the work root or scratch roots; no stray git worktree; no process left in the
  run's process group; evidence (journal, artifacts, results, report) intact. A step that writes
  outside its roots makes the run end `cleanup-incomplete`, never success. Deletion is confined to
  declared roots (refuse paths outside them, like the earlier kernel's `removeWorkspace`).
- **Budgets**: attempt caps per hypothesis (third attempt refused as `policy-limited`), deadlines
  that abort the running step, resume never resets counts, limits stored outside the agent's
  write scope.
- **Disk floor**: refuse to start a step when free space is below the floor (inject the free-space
  reader in tests).
- **Run lock + heartbeat + supervisor**: single writer; dead holder taken over; heartbeat via
  injected clock; restart marks the interrupted step `interrupted` (never `failed`, never deleted);
  6 crashes inside the window pause the run with a reason. Sources to adapt:
  `L/packages/harness/src/omerta-gc.ts`, `workspace-hygiene.ts`, `mission-supervisor.ts`.
- Acceptance tests: all six terminal paths leave nothing behind (fault injection, no sleeps);
  outside-root leak → `cleanup-incomplete`; third attempt → `policy-limited`; deadline aborts and
  journals; disk floor refuses; crash-loop pause.

## Block 0 — baseline (`bio-baseline`) — Claude, with Claude and Codex arms

Install the minimal analysis stack, stage the starter-study-1 data offline (METABRIC from the
public cBioPortal API, with a manifest), write the task (Venet et al. 2011 random-signature
re-test, with one planted flaw), run plain `claude -p` and plain `codex exec` on identical staged
data with no web access, 2–3 attempts each, and log every error by type. Builds nothing in the
trusted core. Its error log decides what Block 6 builds.

## Block 6a — readable reports and notebook digest (`bio-report`) — Codex

Depends on `bio-core` and `bio-ledger` (read its exported API; do not edit it).
- **Digest compiler**: from a ledger snapshot, render a per-session digest under a byte budget:
  question, live hypotheses, current experiment, recent decisions, and a reserved section listing
  **every** refuted, contradicted, aborted or insufficient item as a one-line pointer (record id).
  If that section would overflow, refuse (or split by sub-question) — never truncate negatives.
  Re-rendering the same snapshot is byte-identical.
- **Report renderer** (static Markdown, optionally HTML): plain-language summary slot, question
  and hypotheses, locked plan hash, a deviations table (every amendment, flagging
  `post_unblinding`), methods, results where **every number is rendered with a link to its
  observation record id, code hash and output hash**, negative and failed analyses, limitations,
  claims grouped by label (confirmed/tentative/refuted/insufficient/contradicted — labels are read
  from the ledger, never computed from prose), side findings (idea cards, labeled
  hypothesis-generating), and a "how to check this yourself" section listing manifests and hashes.
- **Refusals**: refuse to render any outcome not traceable to a locked pre-registration unless it
  is labeled exploratory; refuse an uncited claim; refuse a number that is not an observation
  record (model-typed numbers never appear as results).
- Acceptance tests: 20 experiments with 8 negative and 2 contradicted → digest fits and lists every
  negative id; at 2× budget the compiler refuses or splits; re-render byte-identical; a report
  with a model-typed number is refused; an amendment with `post_unblinding` appears in the
  deviations table; an unregistered non-exploratory outcome is refused; every rendered number
  carries its three links. Package suite under 10 s.

## Block 6b — blind replicator (`bio-replicator`) — Codex

Codex as a blind second analyst. Adapt `L/packages/harness/src/codex-cli.ts` (strip debugger,
preview, terminal and standards sockets). Inputs: the locked pre-registration text, the dataset
manifest and a read-only data directory — never the first implementation, its code, numbers or
narrative. Runs `codex exec` in a fresh temp directory. The commands Codex executes run with
no network (sandbox `workspace-write`, network disabled); the Codex process itself may reach its
model API using only its own CLI login. The environment is allowlisted and carries no other
secrets. Returns a
structured verdict `{status: "agrees"|"disagrees"|"inconclusive"|"failed", numbers, codeHash,
outputHashes, modelId, cliVersion, effort}`; parsing is fail-closed (unparseable → `failed`).
The data directory hash is unchanged after the run; the temp directory is deleted on every exit.
Acceptance tests with a FAKE `codex` binary (never the real CLI): read-only run leaves the data
directory hash unchanged; the prompt contains no first-implementation content (assert on the
exact prompt); unparseable output → `failed`; SIGKILL mid-run reaps the tree and deletes the temp
dir; environment contains no secret variables. Suite under 10 s.

## Block 8a — benchmark harness core (`bio-bench`) — Codex

Adapt ideas from `L/packages/harness/src/mission-scoreboard.ts` and `grader-audit.ts`.
- **Task cards**: id, family, dataset manifest hash, prompt, sealed answer key reference,
  tolerance, planted flaws, negative/positive-control flags, held-out flag.
- **Calibration gate** (use `@omerta-bio/checks` `validity.calibrateTask`): a task that does not
  calibrate is reported invalid and no arm runs it.
- **Arms**: A plain Codex, B Codex + tools, C Amani, D deterministic reference, plus optional
  plain-Claude arms; each arm records model id, CLI version, effort, network mode (must be
  identical across arms — refuse to start otherwise), wall-clock and token cost, retries, failures.
- **Grading records**: per task-arm-attempt outcome incl. false-verified (claim marked confirmed but
  rejected by the answer key) and correct-confirmed counts; timeouts and crashes stay in the
  denominator.
- **Statistics**: exact McNemar for paired binary outcomes, paired bootstrap CI (seeded), and an
  equivalence check against a pre-registered margin implementing the decision rule "if B ≈ C,
  ship the tool pack". Pre-registered settings are hash-locked before any run.
- Acceptance tests: miscalibrated task → invalid, no arm runs; unequal network modes → refuse;
  timeout counted in denominator; McNemar and bootstrap match known values (hand-computed
  fixtures); equivalence rule decides correctly on fixtures; changing a locked setting after the
  first run is refused. Suite under 10 s. No real agents are run in tests.

## Block 6c — prediction registry (`bio-registry`) — Codex

Time-stamped, tamper-evident predictions scored when reality arrives ("the future as the judge").
- **Prediction record**: id = canonicalSha256(payload); question, event description, resolution
  criteria written so a third party could resolve them, resolution source, expected resolution
  date, probability (or distribution) with rationale pointer, model/agent provenance, and
  `createdAt`. Records are append-only on `SqliteEventStore` (hash chain); no edits — a revised
  forecast is a new record superseding the old one, and both are kept and scored.
- **Commitment export**: produce a list of record hashes (and a Merkle root) suitable for an
  external timestamp; external timestamping itself is optional and NOT exercised in tests.
- **As-of filter**: any query "what did the registry predict as of date D" returns only records
  with createdAt ≤ D, verified against chain order; a record whose createdAt is later than a
  resolution it claims to predict is refused.
- **Resolution and scoring**: resolution records (outcome, source, resolvedAt, resolver actor);
  Brier score and log score per prediction; calibration table (binned) over resolved predictions;
  unresolved past-due predictions are reported, never silently dropped; superseded forecasts are
  scored too (no cherry-picking the latest).
- Acceptance tests: editing a stored prediction is detected by chain verification; a prediction
  created after its event resolved is refused; as-of query excludes later records; Brier and log
  scores match hand-computed fixtures; superseded forecasts remain scored; past-due unresolved
  predictions are listed; Merkle root is stable and changes on any tampering. Suite under 10 s.

## Block 7b — end-to-end investigation pipeline (`bio-pipeline`) — Codex

Wire the merged packages into the first end-to-end workflow (design report Section 4, "The first
end-to-end workflow"). Software owns every hash, lock, re-execution and label; the research model
proposes; the human approves confirmatory plans via an injected `approve` callback.
Steps: (1) question record; (2) stage data with a `bio-guard` manifest + terms check, journal an
`observation` for the dataset; (3) research model (via `bio-runner` worker) drafts hypotheses,
predictions and a plan; (4) software validates and locks the plan (`bio-ledger`), human approval
callback; (5) worker writes analysis code in `work/`; (6) software runs it under the process runner
and stores outputs in the artifact store; (7) software re-executes the frozen code offline in a fresh
`bio-guard` re-execution sandbox and compares (`bio-checks` compareReexecution), reconciles claimed
numbers (claimed-equals-recomputed) and runs acceptance-artifacts; (8) worker drafts interpretation;
software attaches contradicting prior records; (9) software assigns the claim label by rule
(`labelClaim`), renders the report through an injected `renderReport` function (bio-report will be
plugged in; tests may use a stub), and runs `bio-supervisor` cleanup. Journal the cleanup evidence
level (`cleanupStatus`). A CLI entry `packages/bio-pipeline/src/cli.ts investigate <dir>` runs it.
Acceptance tests (FAKE claude binary, tiny CSV fixture, no network, no real agents): a full run
journals every step in order and ends with a tentative label (no top-rung check) and a rendered
report; a worker that claims p = 0.001 while recomputation gives 0.4 ends with the claim unsupported;
a nondeterministic analysis is flagged by re-execution; killing the orchestrator mid-run (fault
injection) and resuming marks the step interrupted, completes it, and creates no duplicate records;
a confirm-mode egress violation rejects the run; staging a PRO-ACT file is refused; the work
directory is deleted on every terminal path; a plan edited after lock forces an amendment. Package
suite under 10 s.

## Block 7c — host adapters and CLI (`bio-host`) — Codex

Supply the real, trusted adapters that `bio-pipeline` expects from its host (read
packages/bio-pipeline/BUILD-NOTES.md and src/host-adapter.ts for the exact interfaces), so one command
runs a real investigation on this Mac.
- **Worker adapter**: the real `bio-runner` Claude worker (unmodified `claude -p`) with `explore` mode
  through the `bio-runner` logging egress proxy (allowlist from the investigation config) and
  `confirm` mode with no network; agent sandbox policy from `bio-guard` (deny-by-root: home,
  /private/tmp, /private/var/folders denied except the investigation's own workdir; secrets denied);
  journals the cleanup evidence level.
- **Prior index**: a persistent shared notebook index at `~/.omerta-bio/notebook/index.sqlite`
  (append-only, hash-chained via bio-core), keyed by dataset manifest hash/accession and normalized
  hypothesis/entity keys; written after every investigation; read by the pipeline before
  interpretation. Location injectable for tests.
- **Reaper/cleanup**: `bio-supervisor` cleanup with roots under `~/.omerta-bio/work` (injectable).
- **Re-execution**: `bio-guard` re-execution sandbox using the pixi environment from
  `packages/bio-baseline/pixi.toml` when present (R + Python), read-only data, no network.
- **CLI**: `node packages/bio-host/src/cli.ts investigate <investigation-dir> [--mode explore|confirm]
  [--approve auto|prompt]` — `prompt` asks the human on the terminal to approve confirmatory plans;
  `auto` is allowed only for exploratory runs and is refused for confirmatory ones.
- Acceptance tests (FAKE claude binary, no network, no real agents): the CLI runs the tiny CSV fixture
  end to end through the real adapters and writes a report; the prior index persists across two
  investigations and the second one cites the first one's refuted record; `--approve auto` on a
  confirmatory plan is refused; deny-by-root settings are present in the worker's sandbox settings;
  cleanup leaves nothing under the work root; a second concurrent run on the same investigation is
  refused (single writer). Suite under 10 s. An OPT-IN live smoke (BIO_LIVE_CLAUDE=1) runs one tiny
  real investigation with the real `claude` CLI; it is skipped in the normal suite.

## Block 7d — pipeline: native R/Python, explore mode, launch registration (`bio-pipeline`) — Codex

Additive changes to `bio-pipeline` so real science can run (keep existing behavior and tests).
- **Native analysis runtimes**: the plan declares a runtime: `node` (existing `analysis.mjs`),
  `r` (`analysis.R` via `Rscript`) or `python` (`analysis.py`), executed inside a host-supplied,
  read-only pixi environment prefix (e.g. from `packages/bio-baseline/pixi.toml`) both for the first
  run and for offline re-execution; the environment identity (lockfile hash + prefix path) is
  journaled and must match between run and re-execution, otherwise re-execution fails closed.
  Outputs are declared files in `results/` (tables as TSV/JSON), never stdout scraping.
- **Explore vs confirm**: the host supplies `{ mode: "explore", proxyPort, allowedHosts, egressLog }`
  or `{ mode: "confirm" }`; explore turns use the given logging proxy and are checked with
  `checkEgressLog(lines, "explore", allowedHosts)`; confirm turns stay offline. Exploratory plans may
  be approved by policy (`approvalActor: "policy"`), confirmatory plans only by a human
  (`approvalActor: "human"`); the journal records the actual actor — never claim human approval that
  did not happen. Outputs of explore runs are labeled exploratory and can never reach `confirmed`.
- **Launch registration seam**: before dispatching any command, the pipeline asks a host-supplied
  `registerLaunch(launchId, cwd)` hook (connectable to `bio-supervisor`'s prepared-gate/launch-ID
  registration) and journals the handle, so an interrupted launch can be reaped by the host after an
  orchestrator crash; without the hook, behavior stays as today (retain scratch, refuse restart).
- Acceptance tests (fake worker, tiny fixture, no network, no real agents): an R analysis and a
  Python analysis each run and re-execute reproducibly in a fake pixi prefix (use the real
  /opt/homebrew or pixi binaries only if present, otherwise a stub runtime that the test controls);
  an environment-identity mismatch at re-execution fails closed; explore mode passes an allowlisted
  host and rejects an unlisted one; a confirmatory plan auto-approved by policy is refused; an explore
  result is never labeled confirmed; the journal records the true approval actor; registerLaunch is
  called before dispatch and its handle is journaled; existing tests stay green. Suite under 10 s.

## Block 4d — content-duplicate / pseudo-replication detector (`bio-checks`) — Claude

Motivated by the Block 0 baseline: both plain Claude Code and plain Codex checked ID uniqueness but
missed 99 patients duplicated under new IDs with identical expression and clinical data, and each
reported "no duplicates". Add to `packages/bio-checks/src/validity/` (new file, exported through the
validity namespace):
- `detectContentDuplicates({ rows, idField, compareFields | vectorOf, tolerance })`: finds records with
  different IDs but identical (or within-tolerance) content, at scale (tens of thousands of features x
  thousands of samples) using hashing of rounded vectors plus exact verification of candidate pairs —
  not O(n^2) full comparison. Returns groups of duplicate IDs, the fields/vector used, and counts.
- `detectNearDuplicates(...)` (optional, correlation-based, e.g. Pearson > 0.999 across all features)
  flagged separately as suspected technical replicates.
- An `effectiveUnits` helper that collapses duplicate groups to unique units before any n is reported.
- Fail closed: missing IDs, ragged vectors, NaN handling declared explicitly; an empty input is not
  "no duplicates".
Acceptance tests (deterministic, seeded, fast): the planted pattern (5% exact duplicates under new IDs
in a 2,000 x 1,000 matrix) is found exactly with no false positives; near-duplicates with tiny noise
are flagged only by the near-duplicate detector; genuinely distinct samples are never grouped; ragged
or NaN input fails closed; runtime for 2,000 samples x 20,000 features stays under 2 s.
Suite under 10 s.

## Block 7e — automatic validity gates + live R (`bio-pipeline`, `bio-host`) — Codex

Make the deterministic validity checks part of every investigation, not optional library calls.
- After staging and before the first analysis run, software runs on every staged tabular dataset the
  plan declares: `validity.detectContentDuplicates` (exact, tolerance 0, on declared sample vectors or
  record fields) and, when declared, `detectNearDuplicates`; `checkPseudoReplication` against the
  plan's declared unit of analysis; `checkDonorDisjoint` when the plan declares splits. The plan schema
  gains the declarations needed (sample axis, id field, unit of analysis, split assignment).
- Findings are journaled as `check` records. Duplicate groups or pseudo-replication make the run
  `blocked` before analysis unless the plan explicitly declares how they are handled (e.g. collapse to
  effective units); the report shows the finding, the decision and the effective n.
- A missing declaration needed for a check is a refusal, not a skip.
- Acceptance tests (fake worker, fixtures, no network): a fixture with 5% duplicated samples under new
  IDs is blocked before analysis with the duplicate groups journaled; the same fixture with a declared
  collapse completes and reports effective n; a donor leak across a declared split is blocked; a plan
  missing the sample-axis declaration is refused; clean data passes all gates. Suites under 10 s.
- LIVE R: with the installed pixi env, run the opt-in live smoke once using an R analysis (`analysis.R`)
  end to end and report the actual outcome and timing.

## Block 9 — pilot task suite (`bio-tasks`) — 9a Claude, 9b Codex, 9c Claude

The 16-task pilot of design report Section 7 ("Task families and the 16-task pilot"), with ALS
deferred: real-data tasks use public data already cached under `~/.omerta-bio/datasets/` (METABRIC
from cBioPortal) or fetched by the task author from a public source with a manifest; behaviour tasks
(negatives, planted flaws) are seeded semi-synthetic or synthetic. Python lives in the existing
`packages/bio-baseline` pixi env (`pixi run --manifest-path packages/bio-baseline/pixi.toml ...`);
add packages there only if unavoidable and say so in BUILD-NOTES.

Task directory `packages/bio-tasks/tasks/<id>/` (id like `p10-pseudorep`):
- `card.json` — the bio-bench `TaskCard` fields (`id`, `family` in reproduction | negative |
  planted-flaw | held-out | recovery, `datasetManifestHash`, `prompt` = "TASK.md", `sealedAnswerKeyRef`,
  `tolerance`, `plantedFlaws`, `negativeControl`, `positiveControl`, `heldOut`) plus `seed`,
  `capMinutes`, `contaminated` (true for any public-benchmark anchor).
- `TASK.md` — the arm-facing prompt, byte-identical for every arm. Same deliverables contract as the
  warm-up (`run_all.sh` sourcing `./env.sh`, `code/`, `outputs/`, `REPORT.md`, a task-specific
  `results.json` schema given verbatim). Every `results.json` carries a `claims` array:
  `{id, statement, status: confirmed|tentative|refuted|insufficient-evidence, estimate?, ci?, n_units?, unit?}`.
  The prompt never hints at the planted flaw or the expected answer.
- `stage.py --out DIR` — deterministic, seeded: writes the arm-facing `DIR/data/` and
  `DIR/manifest.json` (sha256 per file). Same seed, same bytes, on every machine.
- `reference.py --data DIR --truth T --out KEYDIR` — arm D: the version-pinned scripted analysis that
  produces the answer key (from the true, unflawed data or generator truth). It is the positive control.
- `check.py --attempt WORKDIR --key KEY` — deterministic grader, no LLM: per-item verdicts
  `correct | incorrect | needs-review` with evidence, plus a task score. Tolerances come from the
  sealed key / card only; the arm never influences how strict a check is. Unparseable or missing =
  `incorrect` (fail closed), never skipped.
- `naive/` — a scripted "falls for the flaw" analysis (for negatives: the over-claiming analysis).
  Calibration requires: the empty answer fails, the reference answer passes, the naive answer fails.
  The calibration record (`calibration.json`: outcomes, key sha256, staged manifest hash; no
  plaintext answers) is the input to `@omerta-bio/checks` `validity.calibrateTask` semantics
  (empty → empty, reference → reference, naive → permuted). A task that does not calibrate is
  invalid and no arm runs it.

Sealing: answer keys are generated by `reference.py` into a temp directory, encrypted with the
existing `packages/bio-baseline/arms/lib/seal.py` key (`~/.omerta-bio/keys/sealing.key`) to
`tasks/<id>/SEALED-KEY.json.enc` (+ `.sha256`), and the plaintext is deleted. Plaintext answer keys,
planted-flaw descriptions and generator truth files are never committed, never written inside a
worktree that an arm can read, and never printed to stdout/logs. Generators and references are
source code in this private repo; BUILD-NOTES must state that `packages/bio-tasks/tasks/` must be
excluded from any future open-source release (published keys become training data).

Harness: `packages/bio-tasks/run-task.sh <task-id> <arm> <attempt>` stages the task into a fresh
results dir and runs the existing arm runners (`run-claude-arm.sh`, `run-codex-arm.sh`,
`run-omerta-arm.sh`) on it with the same deny-by-root containment, caps and network-off policy as
the warm-up; `grade-task.sh <task-id> <attempt-dir>...` re-runs `run_all.sh` in the sandbox (reuse
`grade.py`'s rerun machinery, do not fork it) and then `check.py`. Arm runners gain a task parameter
that defaults to the warm-up, so existing commands and results keep working. The warm-up becomes
task `w0-venet` (its existing sealed answer and grader wrapped, not rewritten).

Ownership:
- **9a (Claude):** the package skeleton, card/manifest/calibration/sealing library + tests, the
  harness scripts and arm-runner task parameter, `w0-venet` wrapped, and two synthetic tasks:
  `p10-pseudorep` (4 iPSC lines × 3 differentiations presented as 12 samples; correct n = 4, effect
  not significant at line level) and `p9-leakage` (cell-level train/test split with shared donors;
  correct answer reports donor-held-out performance near the reference).
- **9b (Codex, after 9a merges):** real-data tasks on METABRIC: two reproduction anchors with
  data-derived keys (positive controls), `p5-permuted` (labels permuted within strata: no effect
  beyond chance), `p11-confounding` (a batch variable aligned with the exposure planted into real
  expression: non-identifiable or attenuated), `p12-quality` (a quality covariate confound planted
  into real data: model it, report the attenuated estimate), and `p16-recovery` (harness kills the arm
  at 50% of cap and resumes it; scored on correctness and no duplicate/contradictory records).
- **9c (Claude, after 9a merges):** synthetic behaviour tasks `p6-subgroups` (zero-effect trial, many
  subgroups), `p8-underpowered` (insufficient evidence with detectable effect stated), `p7-nosignal`
  (no signal: insufficient evidence, not refuted), `p13-endpoint` (null pre-specified primary,
  significant secondary, prompt pressure to report the most significant), `p14-citation` (offline
  literature index; one real-but-unsupportive citation and one fabricated DOI; flag both).
- Held-out (`p15`) and the BixBench anchor (`p4`) are a later block once a post-cutoff public dataset
  is chosen and fetched by the task author.

Acceptance (per builder): every task stages byte-identically twice; calibration passes (empty fails,
reference passes, naive fails) and is recorded; a tampered staged file is refused by the harness; the
sealed key decrypts only with the key file and no plaintext key exists anywhere in the worktree or git
history (`git log -p` scan in a test); `check.py` fails closed on a missing or malformed
`results.json`; a dry-run harness invocation with a fake arm completes and grades. Unit suites under
10 s; staging/reference/calibration for one task under 60 s. One LIVE check per builder: run one
plain-Claude or plain-Codex attempt on one new task end to end and report the actual outcome.

## v2 (2026-10-10): fail closed on claims, fail soft on runs

Integration exception: integration-level packages, including `packages/omb-adapters` and
`packages/omb-certify`, may depend on other workspace packages (including the certifier executor
and bio-baseline's environment staging, `env.sh`, and pixi environment). The bio-core-only
dependency restriction applies to the early leaf blocks, not these integration packages.

Approved by the owner on 2026-10-10 for the v2 rebuild (`~/research_notes/Amani research agent
design/omerta_bio_v2_design.md`, sections 2, 3 and 5). It applies to every v2 block (V1-V11) and
replaces the run-ending reading of hard rule 5 above. Hard rule 5's claim-level meaning stands
unchanged: unknown, missing, skipped or unavailable is never "verified".

**Rule 5 (v2).** Fail closed on claims, fail soft on runs. Unknown or unavailable means this claim
is not confirmed. It never ends a run or discards a finished analysis, except for the hard stops
below.

**Strictness charter.**

1. **Exactly four hard stops.** Each fires only on positive evidence of an event that invalidates
   evidence, never on "could not prove it did not happen". A denied attempt is a warning, because
   denial means containment worked. A hard stop ends the job, voids its claims and keeps the record.
   1. A sealed or answer-key canary appears in worker output or in a *successful* tool result.
      Strings inside a denial message do not count.
   2. Egress to anything but the model API, as shown by the proxy log.
   3. A trusted path changes: raw manifest hash, store, graders, or frozen code after freeze.
   4. Benchmark mode only: access to a grader or key, or reading another arm's results.
2. **Preflight** (analysis environment, CLI and OAuth, disk floor, data-use terms) is checked before
   the first model turn and may fail the job then, when nothing can be lost. The same failure after
   the first model turn is a repair turn or a warning.
3. **Scientific problems lower labels; they never end a run.** Aligned or unhandled confounding,
   leakage, an unpowered null, a G7 disagreement, a miscalibrated test: the run continues, the label
   drops and the report is still written.
4. **Everything else is a bounded repair turn or a warning**, including every condition no table
   lists: path shapes, missing or invalid files, NaN metrics, size caps, resume failures, timeouts
   with partial files, typed numbers in prose, unknown metric references, a refused plan field, and
   all of v1's former run-enders (cleanup level, sweep survivors, "audit unavailable", CLI/env hashes,
   startup inventory, tool receipts, missing StructuredOutput, AI metric bounds, probe departures).
   The gauntlet always runs on the files on disk; a finished analysis is never thrown away.
5. **Files are the contract.** No hooks as enforcement, no required StructuredOutput call. Worker
   files are parsed leniently (case, whitespace, aliases and defaults accepted with warnings); only
   what makes a decision rule unevaluable is refused, and a refusal is a repair turn. Claim IDs are
   any metrics key, case-folded. Transcripts are never evidence.
6. **Software owns every label, number and limitation line.** Statuses (confirmed, replicated,
   tentative, refuted, insufficient-evidence, non-identifiable, exploratory) come only from the
   decision rule and the gates each claim kind requires (design section 5). Every number in prose
   is a `[m:key]` reference to a recomputed metric. Software-owned values (alpha, tolerances, power
   threshold, G5a thresholds) can be tightened by a plan, never loosened.
7. **A gate that did not run never counts as passed**, and no gate outcome may depend on a
   wall-clock deadline: a deadline means "not run yet, retry".
8. **New hard gates must earn their place**: cite a real catch or a named threat, ship with positive
   and negative controls, have a timer and an off switch, and survive a lean ablation. A gate with
   two or more false positives and no real catch in the pilot is demoted to a warning.

The executable form of this charter is `packages/omb-gauntlet` (`routeFailure`, `HARD_STOPS`,
`labelClaim`, `CONFIRM_REQUIREMENTS`, `REFUTE_REQUIREMENTS`); its tests fail if a fifth hard stop
appears or if any combination of missing gates yields "confirmed".
