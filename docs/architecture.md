# Architecture

Amani is an **untrusted generator inside a trusted checker**. AI models propose questions, plans, code
and prose, and they run as sandboxed workers that only write files. Small, deterministic software that
contains no language model decides what counts: it stages the data, locks the plan, runs the frozen
code, recomputes every number and assigns every label.

Two rules carry the design (they are stated in [`CONTRACT.md`](../CONTRACT.md)):

- **Fail closed on claims, fail soft on runs.** Unknown, missing, skipped or unavailable evidence means
  "not confirmed". It never ends a run or throws away a finished analysis. Scientific problems lower a
  label; only four hard stops end a job.
- **The AI writes prose; software writes every number.** Every number in a report is a reference to a
  software-recomputed metric. Software writes statuses, labels and limitation lines.

## The trust boundary

```text
UNTRUSTED   AI workers: Codex and Claude Code, each in its own sandbox and process group
              boss ------> proposals                  (schema views and a short digest only)
              lead ------> plan, code, run script, outputs
              replicator -> its own code and outputs  (other model family; locked plan only)
              novelty ----> annotations only          (frozen literature snapshot)
  ======== files only; lenient parsing; transcripts are never evidence ==========================
TRUSTED     deterministic TypeScript and Python, no model inside
              stage      manifest hashes, data-use terms, data contract, validity checks, schema view
              scheduler  worker pools, model-family constraints, quota bands, one look at a time
              store      hash-chained events, look ledger, sealed partitions, alpha spending
              executor   worker code runs with no network; process group killed, scratch deleted
              gauntlet   gates -> labels -> report
```

Workers are launched by the scheduler, never by each other. They see a *schema view* of the data
(shapes, headers, types, missingness, marginal counts, effective n) and never an exposure-by-outcome
summary before the plan is locked. They cannot read the store, the seal key, the data contract's
private layer or the grader.

**Account separation.** The store and the seal key belong to a certification service account, and worker
code runs as a different one, reached through a narrow `sudo`-delegated launcher. Claims certified
without that separation are capped at Tentative. See
[getting-started.md](getting-started.md#certification-launcher-os-account-separation).

## One investigation

One investigation is a fixed state machine (`omb-investigate`). Software enforces the order from a
hash-chained journal: a phase cannot run until the one before it has completed, going back is refused,
and a completed phase refuses to be redone with different inputs.

| # | Phase | Who | What happens |
|---|---|---|---|
| 1 | `question` | software | Records the question, a plain-language statement, the dataset and the requested route. Registers the hypothesis in the program-wide registry. |
| 2 | `stage` | software | Preflight (environment, CLI authentication, disk, data-use terms) before any model turn. Pins the data contract, checks manifest hashes, runs the data-validity checks once per dataset, builds the schema view and plants canaries. |
| 3 | `plan` | AI lead | From the task and the schema view only, writes the plan: estimand, exposure, outcome, test, direction, unit and the smallest effect of interest. |
| 4 | `plan-lock` | software | Resolves each claim to a registered statistical procedure from its design and estimand (never from the worker's test name), registers every decision rule and locks the plan by hash. Amendments can tighten, never weaken. |
| 5 | `code` | AI lead | Writes and debugs code against the real data layout with outcomes permuted at the unit level within strata. It cannot see the real effect, so it cannot tune to it. |
| 6 | `dry-run` | software | Runs the code on synthetic data. A crash earns a repair turn that sees only synthetic diagnostics. |
| 7 | `freeze` | software | Freezes an immutable copy of the code. |
| 8 | `look` | software | Writes the look to the ledger *before* running, then runs the frozen code once on the real data (or the sealed held-out partition). The partition is then burned. |
| 9 | `certify` | kernel | Runs the gates and assigns labels. |
| 10 | `replicate` | AI of the other family, plus software | The replicator gets the locked plan and the schema, never the lead's code or numbers. Software runs its code and compares decisions and estimates. |
| 11 | `interpret` | AI lead | Sees certified outputs only and writes prose. Numbers typed into the prose are stripped. |
| 12 | `deliverable` | software | The report, claims and manifest. |

**Routes to a look.** **P** (prospective): plan from the schema view, code on scrambled outcomes, one
software run on the real data. **H** (held-out): explore a development partition freely, then take one
look at a sealed partition; offered only with enough effective units, OS-account separation and enough
predicted power. **N** (new data): the same locked rule and frozen code on an independent dataset, which
earns the `replicated` tier.

**Standby reviewer and triage.** Separately from the lead, a standby reviewer examines recorded evidence
when a run breaks and suggests a bounded repair or pause, using closed verdicts. It cannot waive a
scientific check or grant a label. Repairs before a look never reset the evidence: extra data exposure is
recorded and can prevent confirmation.

## The data contract

Facts about the data are established **once per dataset, by a trusted path**, and locked before any
outcome-dependent look (`omb-contract`):

- what the biological unit is;
- which rows belong to which unit;
- the role of each column (identifier, outcome, exposure, covariate, batch, ...);
- known replicates;
- the held-out partition.

The analyst cannot author or change these facts, and the certifier verifies the contract against the
data deterministically. For public datasets, two curator agents from different model families can
build the contract independently; a field they disagree on is "contested" and any claim that depends on
it is capped at Tentative.

## Registered statistical procedures

A Confirmed label is reachable only through a **registered procedure** (`omb-procedures`) whose error
rate has been validated by simulation over a stated design envelope. The plan's declared design selects
the procedure; the observed data and the worker's test name do not. Each procedure carries
**refusal-only diagnostics**: they can block a result or cap its label, but they cannot make a failing
check pass. Outside the envelope, a result is capped at Tentative and carries a limitation. The
procedures include two-group Welch, paired and repeated sign-flip, crossover, weighted Welch, regression
with robust errors, an exact binary risk difference, Brunner–Munzel, a log-geometric ratio,
colocalisation, and the Tier C meta-analysis and trial-level surrogacy methods. Calibration results are in
[validation.md](validation.md).

## From certified records to a paper

```text
certified records ──> numbers, tables, figures   (software; every value tied to its source)
AI prose          ──> sentences with slots        (closed grammar; wording linter)
                      └──> renderer ──> manuscript ──> checks ──> human author's sign-off
```

The paper writer is partly built. The certified-input and controlled-rendering core
(`omb-paper`, `omb-report`, `omb-figures`, `omb-citations`, `omb-literature`) is in this repository. The
full manuscript, review and packaging pipeline is still being completed. The design is in
internal design notes (not published).

## Packages

See the table in the [README](../README.md#architecture). In short: `omb-*` packages are the v2 system
(orchestrator, scheduler, adapters, certifier, procedures, contract, store, paper writer); `bio-*`
packages are the earlier system and the benchmark infrastructure, kept where the v2 system still uses
them. The v1 orchestration (`bio-supervisor`, `bio-host`, `bio-pipeline`, `bio-replicator`) is being
retired.

## Design documents

Working documents written for the builders and the owner live in [`design/`](design/). They cite other
notes that are not in this repository, and a few personal details were replaced with `[redacted]`.
