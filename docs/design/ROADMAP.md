# Amani: roadmap to "entire thing built", then discovery, then hard problems

Written for: the builders and the owner. Started 2026-10-11, after the owner's instruction: "don't stop till the entire thing is built, run all trials, then easier discovery tasks, then extremely hard things".

Each stage has an exit gate. A stage starts as soon as its inputs exist. Stages run in parallel where they don't touch the same files.

## North star (owner, 2026-10-11)

**Use public datasets to narrow down which drugs and methods are worth testing, before money goes into wet labs and clinical work, and quickly test whether a method should theoretically work.**

Concretely, this is the internal design notes (not published) funnel:
1. human genetics (cis-MR + colocalization, rare-variant direction);
2. → targets with genetic support and the right direction;
3. → existing compounds on those targets (Open Targets, ChEMBL, DrugCentral);
4. → graded candidate dossiers;
5. plus perturbation evidence (LINCS, CRISPR screens).

**Third goal: a real scientific paper for every result.**
- Each paper has a structured abstract, key points, a plain-language summary, methods, results with tables and figures, a "how we verified this" section, limitations, data and code availability, and AI-use disclosure.
- It follows the matching reporting checklist (TRIPOD+AI, STROBE-MR, ...) and is readable by scientists from other fields.
- The AI writes the prose; software fills every number, table and figure from certified records; a linter keeps wording within each claim's label; software verifies citations.
- A reproducibility bundle lets anyone re-run it.
- Design: internal design notes (not published) (in progress). Block V12 omb-paper.

**Second goal: genuinely new causes leading to new treatment routes.** The boss proposes hypotheses from agnostic scans across public data, for example:
- proteome-wide cis-MR;
- splicing/cryptic-exon analyses;
- cross-dataset combinations.
Every proposal goes into a program-wide hypothesis registry, so mining data until something passes is penalised through G6. A novelty worker checks literature and ClinicalTrials.gov (D8). A new cause is only labelled after a sealed held-out confirmation plus independent replication or triangulation. Treatment routes follow from the cause's direction and modality (small molecule, ASO, antibody; D3).

The proof that the triage works is a **time-sliced backtest**:
- freeze the method;
- use only data that existed in year Y;
- rank drug–disease pairs;
- check whether the pairs that later succeeded in trials ranked higher.
The benchmark is genetic support, which gives a relative success of about 2.5× in neurology (Minikel 2024). No ranking is shown as a ranking until it passes this backtest (gate D1).

## Stage 1: trusted checker, kernel v3 (design: kernel_v3_redesign.md)

| Block | Owner | What | Gate |
|---|---|---|---|
| K0 | Claude | safety fixes: census exit mapping, vacuous G3, deterministic-fact numbers, Welch alias, plantedEffect floor, reaper binding | Codex review → integrate |
| K1a | Codex | `omb-contract` schema, private/public layers, lock timeline (done 07f28fc) | Claude review → integrate |
| K2a | Claude | `omb-procedures` feasibility: statistics + calibration grid under the owner's D | FEASIBILITY.md; envelopes chosen |
| K1b | Codex | contract verifier (G1a/G1b), contradiction detectors, identity heuristics removed as gates, contracts for the 19 pilot tasks | Claude review → integrate |
| K2b | Claude | registry wired into certify: G5c, label stamping from procedure, design-matched calibration, content-derived seeds, CI inversion, G3-kernel/G3-exec, two-phase held-out, G6 computed families | Codex review → integrate |
| K-acc | both | re-probe round 3 (breakers + skeptics) and V3 stage-0 calibration on kernel v3 | no false Confirmed within D; liveness designs reach Confirmed at ≥0.8× power; correct references hit expected labels |

## Stage 2: the agent around the checker (design: omerta_bio_v2_design.md §V5–V11)

| Block | Owner | What |
|---|---|---|
| V5 | Codex | omb-store: look ledger, sealer (contract partitions), `_ombcert`/`_ombrun`, confirm runner, alpha spending |
| V6 | Claude | Claude adapter (secondary worker; see the worker-model rule below): sandbox settings, no-fallback, rate-limit handling, **pre-work refusal = infrastructure retry** (the pilot saw 18/61 plain-Claude starts blocked by the "cyber" usage classifier in under 3 s) |
| V7 | Claude (Codex reviews) | omb-investigate: boss + parallel workers, the scientific-method steps (question → plan lock → explore on dev → confirm look → replicate → report), phase memoization |
| V8 | Codex | G7 replicator (cross-family) |
| V9 | Claude | scheduler/fleet: quota bands, park/resume, CPU admission |
| V10 | Codex | benchmark arms B+G and full Amani v2; pilot amendment |
| V11 | Codex | v1 demolition |
| V12 | Claude (Codex reviews) | omb-paper: manuscript generator from certified records; [m:key] numbers; deterministic figures and tables; wording linter bound to claim labels; citation verifier; cross-family referee loop; PDF/DOCX/preprint packaging (internal design notes (not published); blocks PW0–PW11; lean first cut about 95 h → PSA tutorial note) |

## Stage 3: trials (does it work?)

1. Finish the locked pilot (plain Claude / plain Codex / Codex+tools) and analyse it, item-level, with refusals reported separately.
2. Add the v2 arms by amendment (B+G, Amani v2) and run them on all 19 tasks, quiet machine.
3. CP1: B vs B+G.
4. Gate: Amani v2 catches planted flaws at least as well as the best plain arm, never certifies a planted-flaw analysis as Confirmed, and its Confirmed claims are correct.

## Stage 4: easier discovery (known answers, blinded) (internal design notes (not published))

1. Build the known-answer discovery suite (critic fixes KC1–KC3), blinded/renamed, in **triage-first order**:
   1. KA0 harness (running);
   2. **KA1 trial-outcome backtests BT1–BT4** (does the frozen ranker predict which drugs later succeeded?);
   3. **KA5 known drug targets** (HMGCR/PCSK9 → LDL → heart disease; IL6R → CRP);
   4. KA2 ALS controls;
   5. then KA3/KA4/KA6/KA7.
2. **Novel-discovery tests** (can it find things nobody told it about?):
   - **planted hidden causes** in real data (PL6 spikes fake loci into the real ALS GWAS; a recall-only arm that reports famous genes fails);
   - **time-travel rediscovery** (BT5: frozen on 2016 GWAS and 2018–19 TDP-43 RNA-seq, with names disguised. Does it forecast which loci and cryptic exons, e.g. the STMN2-type events, later data confirmed?);
   - **prospective forecasts** (PR1: dated predictions scored when future data or trials report; no skill claim before N ≥ 100).
   Discovery-mode boss block DM11 (proposals with rung/kind/scope, program-wide G6, stop after 2 dry cycles) goes into V7.
2. Run discovery mode on it. Gate: it re-finds the known answers at the pre-registered rate and does not confirm decoys.
3. Starter projects in order 2 → 1 → 3 → 4 → 5 (starter_portfolio.md). Pre-registrations are edited for kernel v3, then locked with timestamps. Each gets a paper draft plus a trained model. The owner contacts the original authors before any preprint.

**Researcher handoff (owner goal: "get this in the hands of researchers"):**
- the 5 starter papers, each with a reproducibility bundle and certificate (anyone can re-run and get the same numbers);
- a one-page lab explainer (what the labels mean);
- a "send us your question" offer (a lab names a question plus a public dataset and gets a certified report);
- **the tool itself, OPEN-SOURCED (owner decision, 2026-10-11).** The outreach pitch is the AGENT: what it is, how it works, how it builds models and makes discoveries, with the papers as evidence. It runs locally, so a lab can point it at its own private data without that data leaving its machines.

**Open-source release workstream (OSR):**
- OSR-1 clean public repo: export a scrubbed tree as a NEW repository with a fresh history (seal-v1 residue, redacted planted-ID history, keys, tokens, absolute home paths). Never flip the private repo's history to public.
- OSR-2 a private held-out benchmark: the 19 pilot tasks' planted defects become public on release (contamination), so keep a sealed private task set for future evaluation.
- [redacted]
- OSR-4 docs: README, install, a one-command demo on a public dataset, architecture, a "run it on your own data locally" guide, contributing, security policy.
- OSR-5 packaging: pixi/pnpm one-command setup and a CI that runs the test suite.
- The system paper (PW11) describes the open-source agent and is the LEAD outreach document.
- OSR-6 distribution (from company_landscape.md):
  - an MCP server / Claude connector ("verify this claim / re-run this analysis") so researchers use it inside the tools they already have;
  - a free public "reproducibility index" demo (the agent run over open GEO and PMC datasets), the way Clear Skies built its Oversight index;
  - a pitch as a data source or tool for existing agent platforms (e.g. Biomni Lab).
- The actual visibility flip and the first public push need the owner's explicit go at release time.

**Gate to ALS (owner, 2026-10-11):** first the known-answer tests (items 1–2), then all 5 starter projects (item 3) must produce certified results. Only then does ALS start. Polishing the starter papers, author contact and owner approval may overlap with the start of ALS work.

## Stage 5: hard problems

ALS (als_open_questions_projects.md), starting with internal design notes (not published) Q2 (proteome-wide cis-MR + coloc → targets → drug dossiers), with public data only (no PRO-ACT / Answer ALS / dbGaP / UKB individual-level data). Then AGA and PSA as backups.

## Worker-model rule (owner, 2026-10-11)

- Amani's own workers default to **Codex on GPT-6 Astra, reasoning effort high**, because it does not hit the usage-policy blocks Claude hit on biology tasks.
- Claude workers are a secondary pool. Any Claude worker that is refused, or blocked by a classifier before doing work, is automatically re-dispatched to Codex. The refusal is logged and counted, never scored as a science failure.
- Cross-family review and the G7 replicator still need both families: when Codex builds or analyses, Claude reviews or replicates, and vice versa.

## Vendor-policy constraints (verified 2026-10-11, partners_and_commercial_plan.md)

- **Anthropic Usage Policy, effective 2026-11-12:** no providing Claude access "through services that route requests through consumer subscriptions". So anything run FOR OTHER PEOPLE (hosted service, "send us your question") must use API keys, never the owner's Max login. V6/V9 need an API-key mode; Codex is the default worker anyway. Whether heavy automated use of the owner's own Max plan is allowed is unverified, so check before scaling.
- **Claude Fable models block professional biology:** biology workers must be pinned to Opus-class models (V6/V9 must never route biology tasks to Fable).
- [redacted]

## Standing rules

- Merges go only through integrate.sh.
- Every block gets a cross-family review.
- Experiments run from pinned commits alongside reviews.
- Builders use a private BIO_GRADING_ROOT and never touch ~/.omerta-bio/pilots.
- Load-sensitive official Amani arms run on a quiet machine.
- Delete each worktree when its job ends.
