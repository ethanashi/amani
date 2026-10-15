# Amani v2 design: loose in the middle, strict at the end

2026-10-10. Final synthesis of three audits (gates, gauntlet, prior art), three candidate designs (boss-workers, evolve-v1, toolpack-certifier) and two judges. Both judges picked **boss-workers** (scores 44 and 49 against 41–43 and 42–46). This document is that design, plus the runner-up ideas the judges recommended, with each fatal flaw they found fixed.

Evidence note. Line numbers refer to commit 1b5c5c8, the reviewed 7j code the official runs used (branch `build/block7j-deliverable`). On main @c382fd9 the lines differ; for example, the empty `topRungChecks` is at `bio-pipeline/src/index.ts:712`, not :841. The `runs-warmup-official` worktree has been deleted. The official evidence (c1–c3, the 6 plain runs, LIVE-ATTEMPT-20..27) is on branch `runs/warmup-official` @b6e28c2.

## 1. The recommendation in five sentences

1. Rebuild Amani as a small deterministic kernel around untrusted workers. The kernel is a claim gauntlet, a single-writer store, a quota-aware scheduler and harness adapters. The workers run in parallel on Claude Code, Codex or OpenCode and hand back only files.
2. Keep v1's one proven asset, the software-owned data-validity gate, and move it to staging so it runs once per dataset. It caught the 99 planted duplicate patients every time it ran; plain agents caught them 1 time in 6.
3. Strictness lives in two places only: four hard stops, which fire only on observed events that invalidate evidence, and an eight-gate gauntlet in which each gate protects one assumption behind "P(confirmed | no real effect) ≤ α". Every other v1 check becomes a warning or a bounded repair turn, and a finished analysis on disk is never thrown away.
4. Test the theory before spending quota on orchestration. Build in this order: the standalone claim service (`omb certify`) and an LLM-free calibration on all 16 tasks, then a checkpoint, then the boss, explorers and scheduler.
5. Run the plain arms and arm B on the 16 tasks now, and do not run v1 arm C on them at all. Judge v2 by pre-registered kill rules that can kill the orchestrator, the claim service or the whole design independently.

**Terms used below** (for a non-biologist reader):

| Term | Meaning |
|---|---|
| Effective unit | One independent subject (usually a patient or donor) after duplicates are merged. The real n. |
| Pseudo-replication | Counting repeated measurements of one subject as independent subjects, which inflates n and fakes significance. |
| Confounding, "aligned" / "strong" | A third variable tracks the exposure. Aligned (association ≥ 0.999) means the effect cannot be separated at all. Strong (≥ 0.5) means it must be adjusted for. |
| Null calibration (G5a) | Rerun the primary test many times on data with the exposure shuffled. A correct test rejects about 5% of the time at α = 0.05. |
| Planted effect, power (G5b) | Insert a known effect and check that the analysis recovers it. Power is the share of runs that detect it. |
| MEI | Minimum effect of interest: the smallest effect the plan says would matter. |
| Family, multiplicity (G6) | The set of tests whose false positives are controlled together (Holm or BH correction). |
| Holdout, look (G8) | A sealed slice of data, analysed once, by software, after the plan is frozen. |
| Freedman-Lane | A permutation scheme for covariate-adjusted models: permute residuals, not the raw exposure. |

## 2. What changes and why

**The record.** These counts come from the gates audit's firing ledger.

| Evidence | Value |
|---|---|
| Arm C attempts recorded / credited | 19 / 1 (attempt 27) |
| Official warm-up, same grader for all 9 runs | Plain Claude 3/3 credited (trap caught 1/3). Plain Codex 3/3 credited (trap 0/3). **v1 0/3 produced a result.** |
| Runs ended because a gate caught a real scientific or containment problem | **0** |
| Finished analyses discarded by non-scientific gates | 4 (attempts 25, 26, c1, c3), about 78 min |
| Time lost to failed runs | About 118 min: format/plumbing 3,577 s; infrastructure proofs 1,681 s; false positives 921 s; design 688 s; unknown 218 s |
| Run-ending `throw new Error(` sites in bio-pipeline + bio-host | 308, against 3 repair loops |
| Can v1 ever label a claim "confirmed"? | No. `index.ts:841` always passes `topRungChecks: [], reviewer: null`. |

**Which gates fired, what they cost, and what they caught.**

| v1 gate | Fired in | Cost | What it caught |
|---|---|---|---|
| Duplicate / effective-unit gate | 9, 23, 25–27, c1, c3 | 70–243 s per run | **99/99 planted duplicates every time.** The only real catch, and it handled the problem without ending the run. |
| Flat-name check on reported artifacts (`index.ts:706`) | c1 | 973 s, finished analysis lost | Nothing. The host itself advertises `development-results/`. |
| Process-sweep budget, 8 s (`cleanup-evidence.ts:86-99`) | c2 | 127 s, draft lost | Nothing. The process was confirmed gone 8 s later. |
| Claim-ID regex (`runner-result.ts:38`) plus hook reason hidden by `2>&-` (`worker.ts:28`) | c3 | 1,379 s, finished analysis lost | Nothing. The worker retried blind 3 times. |
| "Audit unavailable" treated as an outside write (`index.ts:242`) | 26, c2 | 1,450 s (attempt 26) | Nothing |
| AI-chosen requiredChecks | 25 | 896 s | Nothing (4 invented check names) |
| "@" rule in prompts | 4, 7 | 448 s | Nothing (a Homebrew path, a gene symbol) |
| Unverifiable cross-table matches, axis heuristic, sparse rows | 23, 21, 20 | 473 s | False positives |
| Claude binary pin | 1–3 | 102 s | Nothing |
| pixi environment missing | 24 | 2 s | A correct preflight failure. Nothing was lost; this is the right kind of failure. |
| Second and third executions | every complete run | 160–174 s (about 27%) | Never a mismatch. The plain arms reproduced 6/6 too. |

**Why v1 cannot be patched into shape.**
- *Fragile by construction.* Only three failure types get a repair round. Any other throw ends the run. Each firing so far led to more checks, not fewer: 7k adds about 30 lines to validate an informational field. And 7k as scoped leaves the c3 cause untouched (`CLAIM_ID` and `2>&-` are unchanged in `block7k-robust`).
- *Cannot parallelize.* The process sweep scans every new process on the machine. The host polls `ps` every 20 ms. A notebook-index lock is held for the whole run. Only one launch is allowed per investigation. Several correctness checks depend on timeouts, so sibling workers would make each other fail, exactly as in c2.
- *Tied to Claude.* Model names must start with `claude-*`. Enforcement uses Claude hooks. Reports must arrive through StructuredOutput. The sandbox is Seatbelt only.
- *Strict about the wrong things.* It cannot confirm anything, and it stops runs over things that don't affect the science.

**What v2 changes.**
1. CONTRACT.md hard rule 5 becomes: "Fail closed on claims, fail soft on runs. Unknown or unavailable means this claim is not confirmed. It never ends a run or discards a finished analysis, except for the hard stops in section 5."
2. Files are the contract. There are no hooks and no required StructuredOutput call. Claim IDs are any metrics key, case-folded.
3. Infrastructure is checked before the first model turn (environment, CLI, OAuth, disk, data-use terms). After that, failures are routed into three classes (section 3).
4. Speed: one re-run instead of two, G1 cached per dataset, each table parsed and hashed once per phase boundary instead of about 9–10 times, and no `ps` polling.
5. New verification makes "confirmed" reachable and meaningful: a decision rule software can evaluate, simulation gates, cross-family replication, and a one-look holdout.
6. Parallelism: one process group per job, one folder per investigation, and a single-writer store.

## 3. Architecture

| Component | Trust | Job | Built from |
|---|---|---|---|
| `omb-store` | Trusted | One SQLite file (WAL mode) per state root: jobs, append-only events, content-addressed artifacts, claims, fleet hypothesis registry, partitions and looks, quota snapshots, gate firings. Only the orchestrator writes to it, in short transactions. | bio-core event-store, artifacts, canonical; bio-ledger rules, keyed fleet-wide |
| `omb-sched` | Trusted | Deterministic scheduler. Places jobs by family constraint, quota headroom and CPU/RAM admission. Parks rate-limited jobs. | New, about 500 lines |
| `omb-worker` | Boundary | `run(WorkerSpec) → WorkerResult` adapters for claude-code and codex now, opencode later. Sandbox backend interface. | bio-baseline arms/lib (armlib, egress proxy, run_capped); bio-runner egress pieces |
| `omb-gauntlet` / `omb certify` | Trusted | Reads files only and assigns every label. Also runs standalone, as the claim service for any agent: CLI plus a file mailbox, and `adopt` to certify finished runs after the fact. | bio-checks; bio-pipeline validity, inference, effective-input, deliverable, prepare_data.py, repair rules; toolpack `omb-sim` |
| `omb-seal` | Trusted | Donor-stratified dev/confirm split at staging, after duplicates are merged. Uses seal v2. The confirm runner runs as OS user `_ombcert` and executes code as `_ombrun`. | bio-baseline seal.py v2; bio-ledger commitPartition / recordProbe / unseal |
| `omb-investigate` | Trusted recipe | The fixed sequence for one investigation. Replaces the 927-line `index.ts`. | New, about 700 lines |
| `omb-report` | Trusted | The single renderer. Every number is a software placeholder (`[m:key]`). Software writes the limitation lines. | bio-report, plus host report.ts merged in |
| Boss, lead, explorers, replicator | **Untrusted** | LLM sessions on any harness. Each writes only its own workdir. The boss can propose and select, never label. | — |

```
UNTRUSTED  (claude -p | codex exec | opencode run; each in its own sandbox + process group)
  boss ---------> proposals.json
  lead ---------> plan.json, code/, run_primary.sh, run_all.sh, outputs/{metrics,primary}.json, units.tsv, splits.tsv?
  explorers ----> findings.json (threat flags), alt/primary.json        (dev partition, read-only mount)
  replicator ---> its own code + primary.json                         (other model family, locked plan only)
=========================== files only; lenient parsing; transcripts are never evidence ===========================
TRUSTED  (deterministic TS/Python, no LLM)
  stage once per manifest: terms -> inference -> G1 validity (cached) -> effective inputs -> sealer -> schema view
  omb-sched (quota bands, CPU/RAM admission, park/resume) --- omb-store (single writer, fleet look ledger)
  omb-gauntlet: G1c G2 G3 G4 G5a/b G6 G7-compare G8 -> evaluator -> labels -> omb-report
  executor: untrusted code runs as _ombrun under Seatbelt, no network, group SIGKILL, scratch deleted
  confirm runner (_ombcert holds the key): one software-run look per partition, no LLM involved
```

**One investigation (benchmark mode).**
1. *Stage (software).* Hash the manifest and check data-use terms. Run G1 once and cache the result by manifest hash. Publish effective inputs in the raw layout, with a neutral `unit_id` column and a software-owned `prepare.sh`; this removes the transposed `Hugo_Symbol` confusion that cost c3 a rewrite. If there are at least 150 effective units, seal a 30% donor-stratified confirm partition. Merging duplicates *before* the split is an invariant with its own test; otherwise a duplicated patient could land on both sides.
2. *Plan turn.* The lead's session is mounted with the task and the schema view only: shapes, headers, types, missingness, marginal counts, effective n. There are no joint exposure × outcome summaries, and the data itself is denied. The lead writes `plan.json`.
3. *Plan check (software, uses no outcome data).* Confound check of the exposure against every measured covariate, the unit against effective n, and a `splits.tsv` requirement for any held-out estimand. Up to 2 blind repair rounds, then **lock**.
4. *Code turn, same resumed session.* The data is mounted with the outcome **scrambled**: permuted at the unit level within strata, after duplicate merging. The lead writes and debugs code against the real layout but cannot see the real effect. Software then runs the frozen code once on the real data; that run *is* the look. If the frozen code crashes on real data, there is one repair turn that sees only the error text, never outputs. This fixes the judges' Route P flaw: you can't tune implementation choices while watching results that are noise.
5. *Fan-out after lock, in parallel:* the G7 replicator (other family), 0–2 explorers on the dev partition, G5 simulations as soon as `run_primary.sh` exists, and the G4 re-run.
6. *Gauntlet, then report.* Software re-checks explorer threat flags it can verify. Flags it cannot verify become annotations. Statuses, limitation lines and numbers are all written by software. Scratch is deleted and the process group is killed.

Research mode, after the pilot: the boss runs Kosmos-style cycles. It reads a world summary of 8 KB or less, writes at most K proposals, has them deduplicated by decision-rule fingerprint, and stops after 2 dry cycles.

**Worker interface.**
```ts
interface WorkerSpec { jobId; kind: "plan"|"code"|"explore"|"replicate"|"select"|"boss"|"repair";
  harness: "claude-code"|"codex"|"opencode"; family; model; effort; workdir /* only writable path */;
  mounts: {path; mode:"ro"}[] /* mounted, never copied */; promptFile /* no data inline */;
  network: "model-api-only"; timeoutMs; resume?: {sessionToken; message}; expect: {file; schema; required}[] }
interface WorkerResult { status: "ok"|"timeout"|"rate_limited"|"needs_resume"|"infra_error"|"agent_error"|"violation";
  resetAt?; sessionToken?; files: Record<string,"valid"|"repaired"|"invalid"|"missing">; warnings; usage; eventsPath;
  provenance: {cliVersion; cliSha256; initInventory} }
```
- **Claude adapter.** Uses `claude -p --output-format stream-json --verbose --model --effort --settings <host-owned file>` and Claude's native sandbox. There is no outer Seatbelt, because nesting one breaks Claude's Bash (`run-claude-arm.sh:20`). Flags are pinned, `--bare` is never used, and a startup self-test asserts OAuth is active. Quota comes from `rate_limit_event`.
- **Codex adapter.** Runs `codex exec --json --ignore-user-config` inside the armlib Seatbelt profile with an egress proxy to the model API only. Each worker gets its own `CODEX_HOME`. The profile file is host-owned and outside the workdir; the 9b resume-escape becomes a regression test. Quota comes from the rollout file's `token_count.rate_limits`.
- **OpenCode adapter.** API-key or local models only (it cannot use Max OAuth). A stub for now, for the open-source release.
- **Acceptance for every adapter:** a canary probe. A read of a sealed canary file must be denied before the adapter counts. Harbor's adapter boundaries and error regexes are copied with attribution; its container runtime is not adopted.

**Failure routing** (replaces "every throw ends the run").

| Class | Examples | Action |
|---|---|---|
| Preflight | pixi env missing, CLI not authenticated, disk floor, terms | Hard fail **before any LLM turn**, so nothing is lost |
| (a) Evidence-invalidating | The 4 hard stops (section 5) | Stop the job, void its claims, keep the record |
| (b) Scientific | Aligned confounder, leakage, unpowered null, G7 disagreement | Continue. The label drops and the report is still written. |
| (c) Everything else | Path shapes, missing or invalid files, NaN metrics, size caps, resume failure, timeout with partial files | Bounded repair turn with the error shown, or proceed with a warning. The gauntlet always runs on the files on disk. |

## 4. Parallelism and scheduling

**What runs where.**
- *Sequential, in one resumed session:* plan → code → interpret. Google's scaling study measured −39% to −70% for multi-agent setups on sequential tasks. In our B5 runs, fresh-context repairs failed where a single session succeeded.
- *Parallel inside an investigation:* the code turn, the G7 replicator, explorers, G5 simulations and the G4 re-run.
- *Parallel across investigations:* tasks, datasets, multiverse branches and new-data replications.
- *Once per dataset:* G1 and the sealer, shared by every worker. That saves 70–243 s per worker.
- *Serialized:* G8 looks, one partition at a time, through the fleet look ledger.

**Counts on this Mac (10 cores, 16 GB).**
- LLM sessions: 4 by default (2 per family), at most 6. RAM is the limit (0.3–0.5 GB per CLI); model compute is remote.
- CPU simulation slots: 8. G5a at K = 200 on a 1–5 s primary test takes 0.5–2 min.
- Heavy executions: at most 2, admitted by RAM. Peak RSS is measured on the first run, and 3 GB stays free; the 287 MB matrix is the sizing case.
- One C2 task uses at most 4 sessions. In benchmark quiet mode only one arm-run is active on the machine.

**How results merge.** There is no debate and no LLM judge.
- Workers never write facts. Software ingests their files and turns each `primary.json` into a claim using the evaluator.
- Duplicate proposals collapse by fingerprint: hash of exposure, outcome, unit, adjustment, strata, test, direction and manifest.
- Agreement within one model family counts as one check, never N.
- Multiverse branches feed a software table of estimates (a robustness annotation, never confirmation). Every branch counts in the G6 family.

**Quota-aware scheduling across Claude Max and ChatGPT Pro.** Telemetry: Claude's `rate_limit_event`, plus a `/usage` poll every 10 min when idle. Codex's `token_count.rate_limits` from rollout files; `codex exec --json` emits no rate-limit event of its own. A moving average of quota spent per (family, job kind) is seeded by running the first 5 jobs one at a time.

| Weekly use per family | What runs |
|---|---|
| Below 70% | Everything |
| 70–85% | Confirm path (plan, code, replicate) and resumes |
| 85–95% | G7 replications only (15% of each weekly window is reserved for them) |
| ≥ 95% or `rejected` | Park with the resume token; wake at resetsAt + 60 s |

- The 5-hour window must also stay under 90%.
- `maxShare` defaults to 50% of each 5-hour window, so the user's own interactive sessions keep working.
- A rate-limited job never fails, and stalls are excluded from benchmark active time for every arm alike.
- The replicator never falls back to the same family; it waits.
- Priority order: in-flight resumes, then confirm path, then G7, then explorers, then boss cycles.

**Invariant:** no gate outcome may depend on a wall-clock deadline. A deadline can only mean "not run yet, retry". A pre-registered load-invariance test enforces this (section 9).

## 5. The verification gauntlet

**The guarantee, stated precisely.** If the gates required for a claim's kind pass, then P(label = confirmed | no real effect) ≤ α_family / L, where L is the number of looks allowed on that data (default 1). This holds under four assumptions, each enforced by gates:
- **A1.** Units are counted correctly and are independent (G1).
- **A2.** The decision rule was fixed before the confirming data were seen (G2 plus a look: route P, H or N).
- **A3.** The test's null distribution is correct (G5a), with multiplicity accounted for (G6).
- **A4.** The numbers are what a faithful implementation of the plan produces (G3, G4, G7).

Limits of the guarantee:
- It is associational, not causal.
- It is conditional on the declared adjustment set and the permutation model.
- It does not cover unmeasured confounding; software writes that limitation line into every report.
- Exposure permutation within strata does not validate a covariate-adjusted null, so adjusted tests use Freedman-Lane residual permutation.
- Negative claims also need power (G5b).

**The look comes from one of three routes:**
- **Route P (prospective).** Plan locked from the schema view, code written on scrambled outcomes, one software run on real data. Available on every pilot task. All 16 cards have `heldOut: false`.
- **Route H (holdout).** Explore the dev partition freely, lock, then one software-run look at the sealed partition. Offered only when G5b predicts confirm-partition power ≥ 0.8 at the MEI. The label comes from the look; the point estimate comes from one frozen-code run on all the data.
- **Route N (new data).** The same locked rule passes on an independent dataset. Gives the "replicated" tier.

| Gate | Check | Pass rule | On fail |
|---|---|---|---|
| G1a units | Duplicates, effective units, pseudo-replication | Analysis read effective inputs (`prepare.sh` in `run_all.sh`). `outputs/units.tsv` lists only software effective units, none repeated, row count = `n_units`. IDs are never printed. | At most tentative ("n inflated") |
| G1b leakage | Donor overlap across splits | Any held-out estimand emits `splits.tsv`; folds are unit-disjoint. The dev/confirm split is checked at staging. | Held-out claim not confirmable |
| G1c confounding | `omb-sim confound-check`, run before lock | Not aligned. Every strong covariate is adjusted for or given a declared role with a reason. | Aligned: **non-identifiable**. Strong and unhandled: at most tentative. |
| G2 lock | `plan.json` decision rule: metric, estimand, test, direction, unit, exposure, outcome, MEI, family, α (software default), knobs | Hash locked before the look. Amendments may never weaken anything (repair.ts rule). | Exploratory |
| G3 recompute | `reconcileClaims` against software-executed outputs | Exact, apart from display rounding. Tolerance is software-owned. Software overwrites model-written statuses. | Claim dropped; repair turn |
| G4 reproduce | One `run_all.sh` from raw data, fresh no-network sandbox | Outputs identical (floats within 1e-9 relative). A second run happens only on a mismatch. | Not confirmable |
| G5a null calibration | K = 200 unit-level permutations within strata, on `run_primary.sh` | ≤14 rejections at α = 0.05 passes; ≥20 fails; 15–19 extends to K = 600 and fails at ≥42. About 2% false alarm, about 0.9 power against a doubled false-positive rate. Waived when the locked test is itself a unit-level permutation test. | Not confirmable |
| G5b power, planted effect | Effect planted at the MEI, 100 seeds | Power ≥ 0.8 for refuted / no-effect. Bias ≤ 2 SE and CI coverage OK for an effect size or CI. | Null becomes insufficient-evidence; estimate not confirmable |
| G6 multiplicity | Holm within the locked family; BH for declared screens of ≥20 tests | Adjusted p decides. Tests outside the family become exploratory. Each claim is annotated "kth hypothesis on this manifest". | Not confirmable |
| G7 replication | Other family, locked plan only. Software runs its code too (G3/G4 apply). | Same evaluator decision, and \|Δestimate\| ≤ min(√(SE₁²+SE₂²), MEI/2). The tolerance is calibrated on a reference vs a deliberately divergent implementation. Same-family agreement counts as zero. | Tentative: "plan under-specified or implementation error" |
| G8 look | Recorded in the fleet ledger before execution; frozen code plus evaluator; no LLM present | One look per partition, then the partition is burned | A second look is refused; route N only |

**Gates per claim kind**, so the positive controls aren't over-gated:

| Claim kind (tasks) | Required for the top label |
|---|---|
| Data-integrity finding (w0, p10, p10b) | G1 → "verified by software" |
| Reproduction of a published value (p1, p2, p4) | G1, G2, G3, G4, G7. No look needed, because the publication fixed the target. |
| Effect exists (p6, p11, p12, p13) | G1, G1c, G2, G3, G4, G5a, G6, G7 plus a route P/H/N look |
| Effect size or CI reported | Above, plus G5b bias and coverage |
| Null or refuted (p5, p7, p8) | G1, G2, G3, G4, G5b power ≥ 0.8, G7 plus a look; otherwise insufficient-evidence |
| Out-of-sample performance (p9) | Above, plus G1b on the emitted `splits.tsv` |
| Citation (p14) | Deterministic DOI/PMID resolution against the frozen index. Whether the source supports the claim is an annotation. |

**Labels (software only):**
- **confirmed:** all required gates pass.
- **refuted:** no effect, power ≥ 0.8, CI below the MEI.
- **insufficient-evidence**.
- **non-identifiable:** mapped to insufficient in the task schema.
- **tentative:** G3 and G4 pass, a confirm gate failed or was not run.
- **exploratory**.
- **replicated**.

Human sign-off moves out of the label. It becomes an "endorsed" flag, required only before publishing or registering a prediction, because a veto after seeing results reintroduces selection.

**Explore vs confirm.** Exploration is cheap and never blocked by heuristics:

| Check | Explore mode | Confirm path |
|---|---|---|
| Exact duplicates | Auto-collapse, annotate | Gate (G1a) |
| Unverifiable cross-table matches (attempt 23), axis heuristics when inference is confident (21), sparse rows (20) | Warning | Warning |
| Orphan references, near-duplicates touching the unit | Warning | Gate |
| Leakage, aligned confounder | Warning and label | Gate |
| Cleanup level, sweep survivors, audit unavailable, CLI/env hashes, startup inventory, tool receipts, missing StructuredOutput, AI metric bounds, closed-book probe departure | Warning | Warning |

**Hard stops.** These fire on positive evidence only, never on "couldn't prove it didn't happen". A denied attempt is a warning, because denial means containment worked.
1. A sealed or answer-key canary appears in worker output or in a *successful* tool result. The scanner ignores strings inside denials, which fixes the attempt 25 false flag.
2. Egress to anything but the model API, as shown by the proxy log.
3. A trusted path changes: raw manifest hash, store, graders, or frozen code after freeze.
4. Benchmark only: access to a grader or key, or reading another arm's results.

**Cost per confirmed claim:** about 10–20 extra minutes, dominated by the G7 session, with G4 and G5 running alongside. Exploratory runs get cheaper than v1: one fewer re-run (about −85 s) and cached G1 (−70 to −243 s).

## 6. Keep, demote, scrap

**Packages** (source lines on 1b5c5c8):

| Package | Verdict | What happens |
|---|---|---|
| bio-checks (2,657) | **KEEP**, gauntlet core | Validity, compareReexecution, reconcileClaims, citations. labelClaim is rewired to the tier ladder. `checkClusterVsGradient` is wired as a warning. |
| bio-toolpack (block10, committed, unmerged) | **KEEP, merge first** | Worker tool layer and the gauntlet's compute engine (`omb-sim ... -- COMMAND`). Gauntlet uses K = 200 sequential; the worker default stays 100. |
| bio-ledger (673) | **KEEP rules, move storage** | Lock, commitPartition, recordProbe and one-look unseal move into omb-store, keyed fleet-wide. The run-long ownership lock is scrapped. |
| bio-core (1,890) | **KEEP most** | Keep event-store, artifacts (nested paths allowed), canonical, path-identity, the sandbox profile builder. cleanup-evidence becomes a warning. process-runner shrinks to group spawn + kill. Scrap protocol, resource-guard and unused budget/validation code (about 350 lines). |
| bio-guard (723) | **KEEP containment** | terms, manifest, egress (observed violations), sandbox policy behind a backend interface. Owner/link/ACL checks apply only to bytes copied out of scratch. |
| bio-pipeline (2,721) | **SPLIT** | Keep validity, inference (silence counts as confirmation), effective-input (single parse, target <10 s), deliverable, prepare_data.py, repair rule, findings-summary, results-schema (benchmark only, repairable). Metric bounds become an annotation. **Scrap index.ts orchestration**: 20 fault points, replay, legacy checks, requiredChecks, artifact check, resume pinning. |
| bio-replicator (613) | **KEEP, rewrite verdict** | `replicator.ts:240` copies the model's own opinion as the verdict. Replace with a software comparison of `primary.json`. Make it harness-neutral. |
| bio-report (366) | **KEEP and wire** | The single renderer and the boss's world digest. Untraceable numbers are stripped and repaired instead of throwing. |
| bio-bench (542) | **KEEP** | exactMcNemar, pairedBootstrap, checkEquivalence drive scoring. |
| bio-tasks (5,168) + pilot.py | **KEEP** | 16 tasks, calibration, sealing, pilot runner. Add control fixtures for each new gate. |
| bio-baseline (3,562) | **KEEP**, becomes the containment layer | armlib, egress proxy, seal v2, grade.py (scanner fixed). The operation lease applies to official arms only. omerta-arm.ts is replaced by a v2 adapter. |
| bio-registry (381) | **PARK** | Prediction track, off the critical path. `merkleRoot` is reused to commit lock hashes. |
| bio-runner (1,315) | **DEMOTE** into the Claude adapter | Keep stream parsing and egress pieces. Scrap the CLAIM_ID regex, required StructuredOutput, llm.ts and sessions.ts (334, unused), binary pinning (becomes provenance). |
| bio-host (1,304) | **SCRAP mostly** | Scrap the launch chain, notebook lock, private-file checks, hooks as enforcement, the "@" rule, `2>&-`. worker.ts becomes the Claude settings builder; reexecution merges into G4. |
| bio-supervisor (728) | **SCRAP** | Unused live. The 15-line process-group idea moves to core. |

**Major v1 gates:**

| v1 gate | v2 |
|---|---|
| Duplicates / effective units; pseudo-replication; split leakage | **KEEP** as G1a/G1b, cached per dataset, plus `units.tsv` and an emitted `splits.tsv` |
| Software-owned declarations (lesson of attempt 7) | **KEEP**; the AI can only tighten them |
| Plan lock, exploratory/confirmatory labels, cannot-weaken amendment rule | **KEEP** as G2; lenient parser; human approval becomes "endorsed" |
| Claims reconciliation | **KEEP** as G3, with software-owned tolerance |
| Deliverable prepare-from-raw hash match | **KEEP**, folded into G4 |
| Re-execution ×3 | **One** re-run; a second only on mismatch |
| OS sandbox (deny reads from root, writes to scratch, no network); sealed/authority isolation; data-use terms | **KEEP**, plus canaries, OS-user key and a backend interface |
| Cross-table unverifiable, axis heuristics, sparse rows, near-duplicates in explore | **DEMOTE** to warnings |
| Egress/write audits | Observed violation = hard stop; "unavailable" = warning |
| Prior-record citation | One repair turn, then a lower label; retrieval unavailable = warning |
| Process sweep, cleanup grade driving status, "audit unavailable = outside write" | **SCRAP** as gates; group kill; scratch always deleted |
| Binary pin, startup inventory, tool-receipt reconciliation, env re-checks | Provenance warnings; env checked once at preflight |
| Flat-path check on reported artifacts, claim-ID regex, `2>&-`, required StructuredOutput, status must be "completed" | **SCRAP**; files are the contract |
| AI-chosen requiredChecks, "@" rule, raw-path throw, `claude-*` name check | **SCRAP** (raw paths are redacted) |
| Crash-resume, fault points, legacy checks, resume pinning | **SCRAP**; replaced by phase memoization keyed by (phase, input hash) |
| 20 ms `ps` polling, 4-process launch chain, global notebook lock | **SCRAP** |
| Size caps that end runs, exact-key model JSON, extension rules | Raised caps routed to repair; lenient parsing; warnings |

## 7. What happens to the in-flight work

| Item | State now (checked read-only) | Recommendation |
|---|---|---|
| Official warm-up | Done. v1 0/3; evidence on `runs/warmup-official` b6e28c2 | Record as is: c1 and c3 are v1 defects; c2 is a protocol deviation caused by my builder load. |
| Block 7k (`block7k-robust`, 17 files uncommitted) | Fixes the path check by aliasing and adds sweep retries. **Does not touch CLAIM_ID or `2>&-`.** | Rescope as **V0**: scrap the reported-artifact check instead of aliasing it; sweep becomes a warning; "audit unavailable" is no longer an outside write; return the hook reason through JSON stdout; claim IDs = case-folded metrics keys; proceed when the files exist. Merge 7j + 7k, run 3 quiet replacement runs (about 1 h of machine time), tag `v1-final`, and stop v1 work. |
| Block 10 toolpack (`build/block10-toolpack` 6b9d57d) | Committed, unmerged; `codex-tools-t1` result untracked | Commit the t1 evidence and merge first. It is the engine for G1c, G5 and G6, and it is arm B. |
| 9b real-data tasks | 16 tasks; `heldOut: false` on all 16; `positiveControl: true` on 2 | Merge after the re-probe. Route P is what makes confirmation possible on these cards. |
| 9e pilot.py | Fix round 2 | Amend the arms before any lock: A, A′, B now; B+G, C2, C2-noG7, C2′ added later by a documented amendment on the same tasks, caps and grader. |
| **16-task pilot arms** | — | **Run now:** A (plain Claude) ×3 attempts; A′ (plain Codex) and B (Codex + toolpack) ×1 now, attempts 2–3 after the Codex weekly reset. They don't depend on v2, they are its yardstick, and they use the machine's serial run slot while builders write code. **Never run:** v1 arm C on the 16 tasks; it would measure plumbing. **Wait for v2:** B+G, C2 and its variants. When C2 runs, re-run a drift sentinel (w0, p1, p9 for A and A′) to catch model or CLI changes between stages. |

Builders must not run heavy tests while any pilot run is timed (`_logs/machine-free.flag`). Once V2 lands, `omb certify adopt` turns the A/A′/B outputs and the 6 warm-up plain runs into free post-hoc arms (A+cert, A′+cert, B+cert) that use no LLM quota.

## 8. Build plan

Every block is built by one family, cross-reviewed adversarially by the other, and needs a passing **live smoke against the real CLI** before it counts; fakes have hidden real CLI behavior three times. Merges go only through `_logs/integrate.sh`. Worktrees are deleted on merge.

| # | Block | Build / review | Builder-h |
|---|---|---|---|
| V0 | v1 freeze: 7k rescoped plus the c3 fixes; 3 quiet replacements; tag `v1-final` | Codex / Claude | 3 |
| V1 | Gauntlet core: `plan.json` schema with defaults and lenient parser; `primary.json` + `units.tsv` contract; decision-rule evaluator; claim-kind labeller; software statuses, limitation lines and `[m:key]` numbers; rule 5 and the strictness charter in CONTRACT.md | Claude / Codex | 8 |
| V2 | Gates and `omb certify`: merge toolpack; stager (single-parse G1 cached, <10 s on w0; raw-layout effective inputs with `unit_id` + `prepare.sh`; dedupe-before-split test); G3; one-run G4; sequential G5a; G5b; G6; G1c with Freedman-Lane; CLI, file mailbox, `adopt` | Codex / Claude | 16 |
| V3 | Offline calibration (stage 0): plan and primary wrappers for reference and naive analyses on all 16 tasks; adopt runs; load-invariance harness | Claude / Codex | 8 |
| V4 | Codex adapter + B+G arm: armlib Seatbelt, egress proxy, host-owned profile, per-worker `CODEX_HOME`, rollout quota reader, canary probe, resume-escape regression | Codex / Claude | 7 |
| CP1 | **Checkpoint:** B vs B+G on w0, p1, p9, p10, p12, p13 ×1 plus the adopt arms. Choose: continue, ship claim service only, or ship toolpack only. | operator | ~2 |
| V5 | Store and seal: omb-store; fleet look ledger; sealer (after dedupe, donor-stratified, seal v2, canaries); `_ombcert` / `_ombrun` users; confirm runner; CPU-only G8 calibration | Claude / Codex | 12 |
| V6 | Claude adapter: host-owned native sandbox settings, pinned flags, OAuth self-test, `rate_limit_event` + `/usage`, resume, canary probe | Claude / Codex | 8 |
| V7 | `omb-investigate`: schema view, route P with scrambled-outcome code turn, resumed lead, three-class routing, phase memoization (covers p16), deliverable, interpret. Live run on w0, p1, p10. | Codex / Claude | 16 |
| V8 | G7 replicator: harness-neutral, software comparison, tolerance calibration, family constraint | Claude / Codex | 6 |
| CP2 | **Checkpoint:** C2-min on the CP1 tasks plus the load-invariance test | operator | ~2 |
| V9 | Scheduler and fleet: quota bands, `maxShare`, park/resume, CPU/RAM admission, explorers with verifiable threat flags, multiverse table, selector, route H promotion | Claude / Codex | 14 |
| V10 | Benchmark integration: arms B+G, C2, C2-noG7, C2′; amendment and re-lock; scanner fix; active-time caps | Codex / Claude | 8 |
| V11 | v1 demolition (about 2.5k source lines plus tests) | Codex / Claude | 4 |

- **Total:** about 110 builder-hours. Claude builds 56 (V1, V3, V5, V6, V8, V9) and Codex builds 54 (V0, V2, V4, V7, V10, V11), which keeps the scarcer Codex quota from carrying the build.
- **Critical path:** V0 → V1 → V2 → V3 → CP1 → V7 → V8 → CP2 → V9 → V10, about 79 h. V4, V5 and V6 run in the other lane.
- **First usable product:** after V0–V4 (about 42 h), `omb certify` works around any agent.
- [redacted]

## 9. How v2 is benchmarked, and what would kill it

**Stages.**
0. *Offline, no LLM (V3, V5).*
   - The gauntlet makes zero confirmations on the 16 naive analyses.
   - The reference analyses get the correct label on ≥14 of 16 (p8 and p10 should be insufficient-evidence).
   - Synthetic sealed tasks: a planted effect at the MEI is confirmed in ≥80% of cases, and a null over 200 re-stagings is confirmed at most α of the time (binomial bound).
   - This tests "works in theory" before any quota is spent.
1. *Smokes (CP1, CP2), quiet machine.* All runs complete; the w0 trap is collapsed; p1 is confirmed; p10 comes out insufficient-evidence.
2. *Kill screen.* 16 tasks × 1 attempt × {B+G, C2}, against the A, A′ and B runs from section 7. Caps: 90 active minutes for the warm-up, 60 for p9/p10.
3. *Full pilot.* 3 attempts per arm, about 240 runs.

**Arms.**
- A: plain Claude. A′: plain Codex. B: Codex + toolpack.
- B+G: B plus the claim service, route H only, G7 on Claude.
- C2: the fleet, with a Codex lead, Claude replicator, one explorer per family, routes P and H.
- C2-noG7.
- C2′: Claude lead, on half the tasks. It relieves Codex quota and separates model from method.
- Post-hoc, free: A+cert, A′+cert, B+cert, and A∧A′, where a claim counts only if both plain arms agree. That separates "two families voting" from the gauntlet.

**Metrics.**
- *Primary:* false-verified rate of claims labelled confirmed, clustered by task.
- *Co-primary:* verified yield; correct abstention on p5, p6, p7, p8, p13; completion rate.
- *Also:*
  - finished analyses lost (must be 0);
  - planted-flaw catches;
  - positive controls p1 and p2;
  - p16 recovery;
  - active wall-clock;
  - quota % per run per family;
  - human minutes;
  - the per-gate firing ledger (real catches vs false positives).

**Pre-registered rules** (lock them before stage 2):

| Outcome | Condition | Action |
|---|---|---|
| Halt, fix the gate | Any confirm on a task whose planted flaw a deterministic gate targets (w0, p9, p10, p10b, p11), or any hard-stop breach | Two halts on one gate disable that route |
| Halt, investigate | ≥3 confirms across about 15 pure-null claim-attempts (p5, p7, p8; P ≈ 0.036 at nominal α). A single one triggers a review, not a halt. | Recalibrate on controls, never on pilot outcomes |
| **Kill v2: too strict** | C2 completes fewer than 15/16 runs for infrastructure reasons, any finished analysis is lost, or neither p1 nor p2 is confirmed | Loosen the failing gates from the firing ledger |
| **Kill v2: unsafe** | C2 misses the w0 duplicate trap in any attempt | Revert that specific softening |
| Wrong base | Any v1 failure class recurs (path, claim-ID, sweep, audit-unavailable, hidden hook reason) | Halt; a second recurrence means re-examining the kernel |
| Load-invariance broken | Same task and seed gives a different label on a quiet machine vs under 8 busy CPU loops | Fix before any score counts |
| **Kill orchestration** | C2 beats B+G by neither ≥10 points on FVR nor ≥2 tasks on (flaw catches + positive controls) | Ship B+G; keep the fleet only for multi-dataset throughput |
| **Kill claim service** | B+G is within ±10 points of B on FVR with no flaw-catch gain, or loses ≥2 positive controls | Ship the toolpack (B) only |
| Cut layers | C2's median active time is more than 2× B's | Drop the layers the per-layer timers show are slowest |
| Parallelism must pay | C2-min ≈ C2 on yield and catches while using ≥2× the quota | Default to 0 explorers |

Power caveat: 16 tasks can show futility, not superiority (McNemar power about 0.20). A superiority claim needs the 60–80-task sealed confirmation suite.

## 10. Open risks

1. **Route P rests on two sandbox facts:** the plan turn cannot read data, and the code turn sees only scrambled outcomes. If Claude's native sandbox defaults drift, both weaken at once. Mitigations: canary probes at adapter start and in every run, OS-user key separation, and the sandbox backend recorded on every route P label.
2. **Scrambled-outcome coding may cost yield,** because some bugs only show on real data. Track the real-data repair rate. If it exceeds 30%, improve the schema view or prefer route H where n allows.
3. **The gauntlet becomes the new v1 and never confirms.** Mitigations: positive controls offline and live, and the demotion rule (≥2 false positives and 0 real catches in the pilot turns a gate into a warning). Admission rule for any new hard gate: it cites a real catch or a named threat, ships with positive and negative controls, has a timer and an off switch, and survives a lean ablation.
4. **Correlated replication.** Both families can misread the same ambiguous plan, and two analyses of the same data are not independent. G7 is therefore probabilistic; G1 and G5 catch structural errors independently of either model.
5. **The guarantee's scope.** It is associational and conditional on the declared covariates. It says nothing about biological importance. Reports must say so plainly.
6. **Holdout power.** Small datasets lose too much n to a split. They use route P or N only, and G5b predicts power before a look is spent.
7. **Subscription and CLI drift.** `--bare` is slated to become the `-p` default, OAuth policy for third-party harnesses has changed before, `/usage` is experimental, and Codex exec emits no rate-limit events. Pinned flags, the OAuth self-test and spawning only the user's own signed-in binaries cover the known cases.
8. **Codex quota is the scarce resource.** A′, B, B+G and the C2 lead all draw on it. C2′ and the after-reset scheduling in section 7 are the mitigation; watch the weekly window (36% used at the last reading).
9. **Stage-to-stage drift.** A/A′/B run now, C2 later. Model or CLI updates in between could bias the comparison. The sentinel re-runs detect this; if drift appears, re-run the baselines on the affected tasks.
10. **The 16 GB machine.** RAM admission and read-only mounts keep the 287 MB matrix workable. Official runs still need a quiet machine until the load-invariance test passes.
11. **Admin setup for OS users** (`_ombcert`, `_ombrun`) is one-time on this Mac but adds friction for open-source users. Without it, route H and benchmark sealing are disabled; routes P and N still work.
12. [redacted]
