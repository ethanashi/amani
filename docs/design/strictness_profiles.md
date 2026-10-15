# Amani strictness profiles: how strict, for which use

2026-10-10. Written for the project owner. It answers one question: how strict does Amani have to be to stay fast and still be trusted in medicine? It builds on `omerta_bio_v2_design.md` (the gates G1–G8), `integrity_catalog.md` (the B-numbered missing checks) and three research sweeps on medical reporting, regulation and gate costs.

**How to read the labels.**
- **VERIFIED** means a primary source was opened and the quoted text was found in it. Source keys like [S4] point to the list at the end. Keys marked "re-checked" were opened again on 2026-10-10 and the quotes were matched word for word in the extracted text.
- **INFERENCE** means my reasoning from those sources plus the repo evidence. It is a proposal, not a finding.
- Repo facts cite files (read-only reads only).

---

## 1. The rule: strictness proportional to the use of the claim

**The rule in one sentence.** The checks a claim must pass scale with who will rely on it and what a wrong answer would cost:
- A claim that only steers our own next analysis gets cheap, always-on checks and an honest label.
- A claim other people may rely on gets the full gauntlet.
- A claim about an individual patient is never made by the system.

**Regulators and medical statisticians already work this way.**
- **FDA, draft AI credibility guidance for drugs (Jan 2025, still a draft).** Credibility work "should be commensurate with the AI model risk and tailored to the specific COU [context of use]". Model risk is model influence × decision consequence. "For certain low-risk models, FDA may request minimal information". When credibility falls short, the sponsor "may downgrade the model influence by incorporating additional types of evidence". VERIFIED [S1].
- **FDA–EMA joint principles (Jan 2026).** A "risk-based approach with proportionate validation, risk mitigation, and oversight based on the context of use and determined model risk". VERIFIED [S2].
- **EMA reflection paper.** AI in drug discovery "can be low regulatory impact if non-optimal performance only affects the developer. However, if results contribute to the total body of evidence presented for regulatory review", stricter principles apply. VERIFIED [S3].
- **ICH E9.** "Only results from analyses envisaged in the protocol (including amendments) can be regarded as confirmatory." VERIFIED [S4].
- **Bender & Lange 2001.** In confirmatory work "the use of multiple test procedures is mandatory". In exploratory studies "multiple test adjustments are not strictly required", but "'Significant' results based upon exploratory analyses should clearly be labeled as exploratory results". VERIFIED [S5].
- **TRIPOD+AI, items 18c and 18d.** Writing "state that a protocol was not prepared" and "state that the study was not registered" is an acceptable answer. The standard asks for disclosure, not procedure. VERIFIED [S6].

**What follows for Amani** (INFERENCE):
1. **Exploration needs honesty, not procedure.** A loose Explore mode is defensible in medical-statistics terms if software writes complete disclosure: "exploratory; no protocol; not registered; no multiplicity correction". That costs seconds and no LLM turns.
2. **Procedure is required only where a claim is called confirmed.** That means a lock before the look, one look, recomputed numbers, null calibration, multiplicity control and an independent re-implementation.
3. **Clinical use is never the system's decision.** The reasons are legal (FDA CDS guidance; section 5), empirical (biased AI cuts clinician accuracy; section 5) and epistemic (the v2 guarantee is associational, single-dataset and conditional on the declared covariates).

**Two things are on in every tier** (INFERENCE, from the evidence in section 4):
- **Cheap deterministic checks that catch the errors that actually happen.** These are G1 data integrity, G3 recomputation, one G4 re-run and citation resolution.
  - G1 caught 99/99 planted duplicates on every run where it ran. Plain agents caught the same trap in 1 of 6 official runs (memory file; design section 2).
  - These errors are common in published work too: pseudo-replication in 46% of sampled animal studies, nested data in 53% of 314 neuroscience papers, and probable duplicates in more than 50% of curated cancer datasets [S38].
- **A label that states its tier and what it may not be used for.**

**The rule that keeps it fast:** fail closed on claims, fail soft on runs (design section 2). Strictness changes the label. It never ends a run or throws away a finished analysis, except for the four hard stops.

**A tier is two settings, not one** (INFERENCE; this is the main design change, see section 7):
- **Target tier** is chosen before the run. It decides which gates get scheduled, so it controls time and quota.
- **Earned label** is computed by software afterwards. It decides what the result may be used for.
- The v2 labeller already works on the earned-label side. In `omb-gauntlet/src/labels.ts`, "confirmed" is unreachable unless every gate the claim kind requires passed, and a claim without a passed G2 is "exploratory" (VERIFIED, worktree `v2-gates` @99ef329).
- **Promotion** means running the missing gates later on the frozen artifacts, with no new LLM work except G7. It is possible only if two things hold:
  1. A plan hash was recorded before the outcomes were seen.
  2. An unused look remains: a sealed partition, a route P look not yet spent, or new data.
- So staging should seal the confirm partition, and the store should record plan hashes, **in every tier, including Explore**. That costs seconds and keeps promotion possible.

**Where speed actually comes from.** The checks are not the slow part:
- The G1 detector takes 0.2 s. v1's G1 took 70–243 s because it re-parsed the same tables.
- Attempt 27 took 641 s in total. Of that, the AI turns took 284 s (draft 62, code 194, interpret 28), G1 took 100 s, execution 48 s, and two identical re-runs 82 + 92 s. The re-runs sit inside the 174 s "check" phase. (VERIFIED, `LIVE-ATTEMPT-27.json`, re-read.)
- v1 lost about 118 minutes to plumbing failures. No run was ever ended by a real scientific catch (design section 2).

So the recipe is: cheap gates always on, expensive gates in parallel and only at promotion, and no run-ending checks.

The slow evidence medicine actually asks for is calendar time, not compute: an independent cohort, or "prospectively generated data (future calendar time)" in the EMA's words (VERIFIED [S3]). It cannot be sped up, only started earlier. That is what the prediction registry is for.

---

## 2. Tier table

### 2.1 The tiers

Internal status names stay as in `labels.ts`. The display names in brackets are what humans see (section 7, R2).

| | **Explore** | **Tentative** ("Pre-specified") | **Confirmed** ("Verified on this dataset") | **Replicated** (Confirmed plus route N) | **Clinical hand-off** |
|---|---|---|---|---|---|
| Question answered | Is there something worth testing? | Does a rule fixed before the look hold on this data, with software-verified numbers? | Does it also survive null calibration, multiplicity control and an independent re-implementation? | Does the same locked rule hold on an independent dataset? | Should this change care? Only humans answer this. |
| What the AI sees | The dev partition, or all data if there are fewer than 150 effective units (then nothing on this dataset can be confirmed later) | The schema view while planning, scrambled outcomes while coding, and real outcomes only through one software-run look (route P), or route H | Same as Tentative. The G7 replicator gets the locked plan only. | Nothing new. Software runs the frozen code on the new data. | — |
| Gates that **decide** the label | G1a, G1b, G3, G4 (one run), citation resolution | Adds G2 lock, a route P or H look, G1c (aligned confounder = non-identifiable), G1d with zero unexplained drops (new), missing-data method declared, lock hash timestamped externally | Adds G5a (or the kernel permutation decision), G5b where the claim kind needs it, G6 deciding, G7, G9 for prediction claims (new), a CI on every estimate, the missing-data sensitivity run agreeing | Adds the route N look and a dev-vs-eval difference table | None. The system never assigns this. |
| Computed but **warning or annotation only** | G1c, G6 count and "kth hypothesis on this manifest", analytic power, G9 metrics, missingness and flow tables, dataset-card gaps, recall probe | G6 count, analytic power, G9 metrics, subgroup table, recall probe | Subgroup (fairness) table, recall probe, multiverse table, explorer threat flags that software could not re-verify | Same as Confirmed | — |
| Best possible label | exploratory | tentative | confirmed | replicated | — |
| **May** be used for | Choosing what to pre-register next; idea cards; internal triage | Deciding to spend Confirm effort; a preprint section clearly marked "pre-specified, not independently verified" | Evidence handed to an accountable human author; robustness audits of published claims; prediction-registry entries; preprints or papers as "pre-specified analysis of retrospective data, internal validation" | Claims of retrospective external validation; supporting or refuting a published claim across cohorts; the case for a prospective study | Input to an ethics-approved prospective study, a device-status decision or a guideline panel |
| May **not** be used for | Any external claim; reading a p-value as evidence; "no effect" | The word "confirmed"; "no effect" (refuted needs G5b power, G7 and a look) | "Validated" (route H is internal validation); causal language unless the design follows TARGET; anything patient-level | Clinical use; "clinically validated"; patient-level output | Any decision by the system |
| Wall-clock on the warm-up task (INFERENCE) | About 6–15 min. Plain Codex took 12–16 min, plain Claude 24–70 min (median 32). | Explore plus 0–3 min (possible real-data repair turn) | About 20–35 min. G7 (7–15 min) is the critical path; the other gates run alongside it. | Confirmed plus 1–2 min of compute per new dataset, plus variable-harmonisation time (unknown; may need a human) | Months to years |
| Quota | One family | One family | Plus one other-family session (G7; Codex is the scarce quota) | None (software run) | — |

**Wall-clock basis.**
- VERIFIED from repo evidence: plain Claude 32, 70 and 24 min; plain Codex 14, 12 and 16 min; v1-final 12, 35 and 18 min; Codex with the tool pack 12.05 min. These come from `meta.json` files on `runs/v1-final`, as reported by the cost sweep; I did not re-read them.
- Caveat: several runs were on a machine that was not quiet.
- INFERENCE: the tier estimates add the measured per-gate costs from section 4 to attempt 27's AI-turn time.
- Per-gate wall-clock has never been measured on real task data for G1c, G5a, G5b, G6, G7 or G8. V3 must measure it before the tiers are frozen (section 6).

### 2.2 What each tier means in medical vocabulary

| Amani label | ICH E9 [S4] | TRIPOD+AI / PROBAST+AI [S6][S7] | NASEM [S25] | DECIDE-AI rung [S15] |
|---|---|---|---|---|
| exploratory | Exploratory: "cannot be the basis of the formal proof of efficacy" | — | — | In silico |
| tentative | Pre-specified analysis of existing data | Development, with internal validation if a split is used | — | In silico |
| confirmed | Pre-specified confirmatory analysis of retrospective data, with a formal lock record and a recorded blind break | Internal validation. Route H's random split is internal by the PROBAST+AI glossary: "splitting, resampling, or cross validation technique on the development dataset". | Reproducible (G4 meets "same input data, computational steps, methods, code") | In silico, retrospective |
| replicated | — | External validation, retrospective: "participant data that were not used for development (including internal validation)" | Replicable only in a weak sense (same plan, different existing data) | In silico, retrospective |
| (clinical) | Confirmatory trials | — | — | Silent/shadow, then early live clinical evaluation (DECIDE-AI), then comparative prospective (SPIRIT-AI / CONSORT-AI), then vigilance |

VERIFIED: the DECIDE-AI figure lists "In silico, Silent/shadow, Early live clinical, Comparative prospective, Vigilance" [S15, re-checked]. The PROBAST+AI glossary quotes are re-checked [S7].

INFERENCE: every report should carry an evidence-stage line, "in silico, retrospective; not clinical evidence". It costs nothing.

### 2.3 Extra requirements by claim kind

The gates still vary by claim kind, so positive controls are not over-gated. This is the design's table plus the medical additions from section 3.

| Claim kind | Top label needs (repo, VERIFIED `labels.ts` CONFIRM_REQUIREMENTS) | Medical additions (INFERENCE) |
|---|---|---|
| Data-integrity finding | G1 | Flow table (G1d) |
| Reproduction of a published value | G1a, G2, G3, G4, G7 | Recall-probe line, because the model may already know the target (EMA "a priori knowledge" [S3]) |
| Effect exists | G1a, G1c, G2, G3, G4, G5a, G6, G7, G8 (look) | CI present; unadjusted and adjusted estimates; missing-data sensitivity run; "associational" qualifier |
| Effect size | Above plus G5b recovery | Same as above |
| Null or refuted | G1a, G2, G3, G4, G5b power, G7, G8 | Absence of evidence is never reported as evidence of absence below power 0.8 |
| Out-of-sample performance | Effect gates plus G5b recovery and G1b | **G9 performance pack**; optimism-corrected estimate (never apparent performance); whole-pipeline permutation; Riley/precision check; internal-external CV when a cluster variable has 3 or more levels |
| Citation | CIT (deterministic resolution) | Whether the source supports the claim stays an annotation |

**A collision to fix.** In `labels.ts`, `taskStatusOf` maps a supported "exploratory" claim with verified numbers to the task status "tentative" (VERIFIED, v2-gates @99ef329, lines 93–101). That is fine for the four-value benchmark schema. But human-facing reports must show the seven-value software status, or Explore results will read as Tentative ones.

---

## 3. Mapping: medical and regulatory requirements to gates and tiers

**Status column:**
- **Built** means it exists in v1 or the V1/V2 gauntlet code.
- **Planned** means it is in the v2 build plan.
- **Missing** means no block covers it yet.

Quotes are short extracts from the source.

### 3.1 Plan, look and confirmation

| Requirement (source) | What it asks | Gate(s) | Tier | Status |
|---|---|---|---|---|
| Rigor in proportion to risk ([S1][S2][S3], VERIFIED, re-checked) | "commensurate with the AI model risk"; "proportionate validation" | Tier definitions (this note) | All | Missing as a scheduling parameter (R1) |
| Confirmatory means pre-specified, with formal records ([S4] ICH E9, VERIFIED, re-checked) | The analysis plan is "finalised before breaking the blind. Formal records should be kept of when the statistical analysis plan was finalised as well as when the blind was subsequently broken" | G2 lock hash with `lockedAt < firstLookAt`; G8 fleet look ledger | Tentative (lock), Confirmed | G2 built (V1); look ledger planned (V5) |
| Freeze the pipeline before the data are opened ([S3] EMA, VERIFIED, re-checked) | "Once a dataset has been opened, any non-prespecified modifications ... considered post hoc and hence not suited for confirmatory evidence generation" | G2 plus route P (plan from the schema view, code written on scrambled outcomes, one software run) | Tentative and above | Planned (V7) |
| Feasibility checks without outcomes ([S10] FDA RWE, VERIFIED, re-checked) | "estimate the statistical precision of a potential study without evaluating outcomes for treatment arms"; disclose "the data sources evaluated" | Route P schema view; **dataset-selection ledger** (new) | Tentative and above | Schema view planned (V7); ledger missing |
| Amendments dated, with reasons; extra analyses labelled exploratory ([S10], VERIFIED, re-checked; CONSORT 2025 item 10 [S14], re-checked) | Revisions "date-stamped, and the rationale for each change"; changes "including any outcomes or analyses that were not prespecified, with reason" | G2 amendment journal (can never weaken); software labels anything outside the locked family "post hoc" | Tentative and above | Built (G2); post-hoc auto-label built in the labeller |
| Protocol and registration disclosure ([S6] TRIPOD+AI 18c/18d, VERIFIED, re-checked) | "state that a protocol was not prepared" / "not registered" is allowed | Auto-disclosure line at Explore; external timestamp of the lock hash at Tentative and above | All | Missing (R12, R13) |
| Registration ([S9] ICMJE Jan 2026, VERIFIED, re-checked) | For trials, "Retrospective registration ... meets none of these purposes"; for non-trial research, "the ICMJE does not require it" | External timestamp of the lock hash before the look (hash only, $0) | Tentative and above | Missing (overlaps catalog B29) |
| Multiplicity ([S4] ICH E9 5.6; [S5] Bender & Lange, VERIFIED, re-checked) | Mandatory in confirmatory work; not required in exploratory work if labelled exploratory | G6 Holm/BH within the locked family; "kth hypothesis" annotation; forced exploratory label | Explore: label only. Confirmed: G6 decides. | G6 built (V2) |
| QC of statistical programming ([S11] ICH E6(R3) 3.16.2(b), VERIFIED, re-checked) | "appropriate and documented quality control of statistical programming and data analysis" | G3 recompute, G4 re-run, G5b recovery, G7 blind re-implementation (the automated form of independent double programming, INFERENCE) | Confirmed | G3/G4 built; G7 planned (V8) |
| Test data kept from developers; no tuning on test data ([S12] FDA AI device draft, VERIFIED, re-checked) | Test data "sequestered from the model developers"; the model must not be "adjusted opportunistically in light of the test data" | G8 run as `_ombcert`/`_ombrun` with no LLM present; one look per partition | Confirmed | Planned (V5) |
| Every estimate with its uncertainty ([S1], VERIFIED, re-checked; TRIPOD+AI 23a [S6]) | "All performance estimates should be provided with confidence intervals" | G3 rule: no SE or CI in `primary.json` means not confirmable | Confirmed | Missing (R3) |

### 3.2 Data, flow and reporting

| Requirement (source) | What it asks | Gate(s) | Tier | Status |
|---|---|---|---|---|
| A reason for every exclusion ([S11] ICH E6(R3) 3.16.2(d), VERIFIED, re-checked; STROBE 13a–c [S18]; CONSORT 2025 22 [S14]) | "The rationale for exclusion for any participant (or particular data point) should be clearly described and documented" | **G1d accounting**: ID-set differences from raw to effective to eligible to analysed, with a reason code for each drop; a CONSORT/STROBE-style flow table that never prints IDs | Explore: table plus warning. Tentative and above: unexplained drops must be 0. | Missing. G1a checks only a subset relation (`units.ts:113`, per the catalog). Same as catalog B4. |
| Missing data: method stated, plus sensitivity ([S4] ICH E9 5.3, VERIFIED, re-checked; PROBAST+AI 4.3 [S7]) | "An investigation should be made concerning the sensitivity of the results ... to the method of handling missing values" | Locked `missingData` knob (G2); per-variable missingness table; one pre-declared alternative run at Confirmed when analysed n is more than 5% below effective n (tune in the pilot) | Explore: table. Tentative: declared. Confirmed: the alternative run must agree. | Missing (R10) |
| Confounding methods; unadjusted and adjusted estimates (STROBE 12a/16a [S18]; ICH E9 5.7 [S4]) | Report "unadjusted estimates and, if applicable, confounder-adjusted estimates" | G1c; G2 locks the adjustment set; G3 recomputes both estimates | Tentative: locked. Confirmed: required. | G1c built (toolpack); both-estimates rule missing (R3) |
| Data provenance: a dataset card (TRIPOD+AI 5–7 [S6]; STARD-AI 11–14 [S20]; RECORD 12.2 [S19]) | Source, accrual dates, setting, eligibility, preprocessing "in sufficient detail to allow replication" | A dataset card built once per dataset at staging, from repository metadata plus manual fields. "Not reported by source" is a valid value. | Explore: warning on gaps. Confirmed: every field filled or marked. | Missing (R12) |
| Prior access to the database ([S19] RECORD 12.1) | "the extent to which the investigators had access to the database" | Fleet-ledger count of earlier hypotheses on this manifest; recall probe; a line saying "published analyses of this dataset exist" | Annotation at every tier; required line at Confirmed | Recall probe unwired (`ledger.recordProbe` has no caller) |
| Audit trail ([S27] 21 CFR 11.10(e); [S11] ICH E6(R3) 4.2.2) | "secure, computer-generated, time-stamped audit trails"; unambiguous UTC timestamps | omb-store append-only events plus a hash chain (reuse bio-registry `merkleRoot`), UTC, sandbox read logs | All | Store planned (V5); hash chain is catalog B29 |
| Code and data availability; independent verification (TRIPOD+AI 18e/18f [S6]; TOP 2025 Level 3 [S33]) | Analytical code available; "A party independent from the authors verified that reported results reproduce" | A release bundle: code, `run_all.sh`, `prepare.sh`, environment lock, manifest hashes, locked plan, gate board, and data-access instructions (restricted data is described, never included) | Tentative and above; required before publication | Missing (R12) |
| AI-use disclosure ([S9] ICMJE Jan 2026, VERIFIED, re-checked) | "If AI was used for data collection, analysis, or figure generation, authors should describe this use in the methods", "including the tool used, version, and prompts where applicable" | A methods paragraph generated by software: harness, model ID, CLI version and SHA, which steps an LLM did, which steps software did, prompt files, and the endorsing human | All | Provenance partly built (`WorkerResult.provenance`); paragraph missing (R12) |
| Representativeness and subgroups (TRIPOD+AI 23a [S6], re-checked; GMLP 3 [S28]; FDA device draft [S12]) | "performance estimates with confidence intervals, including for any key subgroups (eg, sociodemographic)" | A subgroup table inside G9 as an annotation only (subgroup tests multiply). Pre-declared subgroups join the G6 family. If the variables are absent, software writes "fairness not assessable". | Annotation at Tentative and above; required line at Confirmed | Missing (R6) |
| Predictor timing (PROBAST+AI 2.4 [S7]) | Predictors "available at the time the model was intended to be used" | Locked plan fields: time origin and measured-before-origin per predictor; cross-checked against the dataset card where dates exist | Tentative: declared. Confirmed: verified where possible, otherwise annotated. | Missing (R4; overlaps catalog B19, B22) |

### 3.3 Prediction-model claims (the largest gap)

| Requirement (source) | What it asks | Gate(s) | Tier | Status |
|---|---|---|---|---|
| No apparent performance ([S7] PROBAST+AI evaluation 4.1, VERIFIED, re-checked) | "Was model evaluation based on only apparent performance avoided?" | Point estimate from the confirm-partition look, or optimism-corrected (bootstrap of at least 500, or CV with every development step inside the loop). **Never from the training fit.** | Tentative and above for out-of-sample claims | **Design defect.** Design section 5 says route H's "point estimate comes from one frozen-code run on all the data". (R7) |
| Leakage avoided; resampling replicates every step ([S7] 4.5, 4.6, VERIFIED, re-checked) | "were all model development steps replicated in the resampling process?" | G1b (unit-disjoint folds); **whole-pipeline permutation**: permute the outcome before any preprocessing, run everything, and flag any metric above the chance band | Confirmed (out-of-sample) | G1b built; whole-pipeline permutation missing (= catalog B22) |
| Calibration, discrimination, net benefit ([S7] 4.7, VERIFIED, re-checked; TRIPOD+AI glossary [S6]) | "calibration, discrimination, and net benefit"; "clinical utility (eg, decision curve analysis)" | **G9 performance pack** from a worker-written `predictions.tsv`: C-statistic with CI; calibration-in-the-large, slope and a flexible curve; Brier and scaled Brier against a prevalence-only model; net benefit against treat-all and treat-none at locked thresholds; accuracy against the majority class and against a locked clinical comparator | Explore: computed and shown. Confirmed: required, and the model must beat the locked baseline. | Missing. p9 scores AUC only. (R6) |
| Internal is not external ([S8] Collins 2024, VERIFIED, re-checked) | "Randomly splitting a dataset is often erroneously perceived as a methodological strength—it is not"; "split sample validation is generally advised against"; "at least 500 bootstraps" | Route H labelled "internal (split-sample)"; only route N may say "external validation" | All | Missing (R2) |
| Sample size and precision ([S23] Riley criteria; TRIPOD+AI 10 [S6]; PROBAST+AI 4.1 dev / 4.2 eval [S7]) | Expected shrinkage ≥ 0.9; overall risk within ±0.05; a justified evaluation size | A closed-form Riley check from plan fields, plus a target CI width for the C-statistic and the calibration slope. Route H eligibility for prediction claims depends on precision, not only on G5b power. | Explore: annotation. Confirmed: required (otherwise "imprecise", at most tentative). | Missing (R9) |

Why this matters now: the PSA audit found exactly this class of error in a published model. Its 89% accuracy equalled the always-"responsive" rate (122/137), and its 0.80 AUC was a training-fold mean (memory file; preliminary and Claude-only). The cardio critique found that a constant 0.5 predictor passed bio-registry's Brier check. G9's baseline and comparator rows catch both.

### 3.4 Governance and the clinical boundary

| Requirement (source) | What it asks | Gate(s) | Tier | Status |
|---|---|---|---|---|
| Patient-facing software is a device ([S13] FDA CDS, 29 Jan 2026, VERIFIED, re-checked) | "Software functions that support or provide recommendations to patients or caregivers – not HCPs – meet the definition of a device"; clinician-facing software must let the HCP "independently review the basis for the recommendations" | Product boundary: population-level outputs only, never a per-patient interface | Clinical (out of scope) | Policy only; add a README and terms line (R12) |
| EU research exclusion does not cover real-world testing ([S34] AI Act Art. 2(6), 2(8); mirror site) | "Testing in real world conditions shall not be covered by that exclusion" | Same boundary | Clinical | Policy |
| Humans own conclusions ([S9] ICMJE, re-checked; [S31] Springer Nature) | AI "cannot be responsible"; not permitted: "Generating hypotheses, analyses or conclusions and presenting them as human-derived" | `endorsed` flag required before anything leaves the system; a log of reviewer actions | Before publication or registration | Flag designed (design section 5); review log missing |
| Change control ([S3] EMA, VERIFIED, re-checked) | "all non-trivial changes in the software and hardware stack ... including changes for key dependencies, require a re-evaluation of system performance" | Stamp every label with the gauntlet version, tolerance-table hash, model IDs and CLI version/SHA. Any change re-runs the stage-0 calibration and the drift-sentinel tasks before new labels count. | All | Provenance partial; trigger missing (R15) |
| Controlled data must not go to public AI ([S29] NIH NOT-OD-25-081) | Sharing controlled-access data "with public generative AI tools ... via prompts" violates non-transferability | Data-class preflight in bio-guard. Open: normal. Registered: follow its terms. Controlled: the LLM sees only the schema and synthetic stand-ins, software runs the code, and only small-cell-suppressed aggregates go back. PHI: never on consumer plans. | Preflight (hard) | Terms check built; class rule missing (R14) |
| LLMs cannot be the checker ([S32] BadScientist) | LLM reviewers accepted up to 82% of fabricated papers | No LLM in scoring; explorer flags count only after software re-checks them | All | Built (design rule) |
| One public dataset is no longer publishable at some journals ([S17] Frontiers, VERIFIED, re-checked; [S35] PLOS Biol 2025) | Frontiers asks for "new experimental validation or additional data from their own institution"; it has rejected 5,513 Mendelian-randomization and 1,382 NHANES submissions | Route N; plan starter studies as pairs of datasets | Replicated, for publication | Route N planned |

---

## 4. Gate cost and value, and the resulting classification

**Classes:**
- **A**: always on, decides the label.
- **L**: always on as a label limiter. It is computed in every tier and can cap the label, but it never stops a run.
- **P**: runs at promotion. It decides at Confirmed and runs in parallel after the lock.
- **W**: warning or annotation only.

Costs are VERIFIED where a repo file is cited and INFERENCE otherwise.

| Check | Cost (wall-clock; quota) | When it runs | What it catches (evidence) | Class |
|---|---|---|---|---|
| G1a/G1b integrity (duplicates, effective units, pseudo-replication, donor-disjoint splits) | Detection 0.2 s, effective inputs about 10 s and 0.9 GB on METABRIC (VERIFIED, cost sweep); once per dataset, cached; no LLM | Staging, before the plan turn | 99/99 planted duplicates every time it ran; plain agents 1/6. Literature: [S38]. ALS GSE153960 has about 3.8 samples per donor, so the donor must be the unit. | **A** |
| G1d accounting (new; catalog B4) | Milliseconds (set differences on tables already parsed) | After analysis | Silent patient drops, which G1a cannot see. Required by ICH E6(R3) 3.16.2(d). | L in Explore, **A** from Tentative |
| G1c confounding screen | About 1–2 s (INFERENCE) | After the plan, before the lock; uses no outcome data | Batch or site confounding (Leek 2010, Soneson 2014, per the cost sweep). It only sees measured covariates, so the "unmeasured confounding" limitation line stays. | **L** (aligned means non-identifiable in every tier) |
| G2, recording the plan hash | Milliseconds | Whenever a plan exists | Keeps promotion possible later | **A** (record) in every tier |
| G2, enforcing the lock | 0–2 repair rounds of 1–2 min, only when the plan is invalid; serial | Before the look | Outcome switching: 62% of trials changed, added or dropped a primary outcome (Chan 2004 [S43]); large NHLBI trials reporting benefit fell from 57% to 8% after registration (Kaplan & Irvin 2015 [S44]); LLM analysis choices can make "virtually anything" significant [S48] | **A** from Tentative |
| Blinding (route P: schema-view plan, scrambled-outcome code turn) | About 0 extra, since the turns exist anyway; risk of a 1–3 min real-data repair turn | Plan and code turns | Tuning code while watching results. It gives a legitimate single look without spending 30% of the data. | **A** from Tentative |
| G3 recompute | About 0.34 s (VERIFIED: `LIVE-ATTEMPT-27` check phase minus re-runs) | After the software execution, which happens anyway | Forged or drifted numbers. About half of psychology papers had at least one p-value inconsistent with its test statistic (statcheck [S41]). 5 of 6 plain agents counted the duplicates yet claimed "no duplicates". | **A** |
| G3c consistency, placeholders, CI present (catalog B7, B23; R3) | Seconds | With G3 | Impossible numbers; 0.00 placeholders (the PSA agent's real miss); estimates with no uncertainty | **A** |
| G4, one re-run from raw data | About 14 s small; 70–92 s METABRIC (VERIFIED: grader re-run 69.6 s); overlapped with the interpret turn, so about 0–60 s of wall time | At freeze | 0 nondeterminism mismatches in all runs. It caught one portability defect (attempt 25's code ran only against the prepared layout). 74% of R files in Dataverse failed on first run [S47]. | **A** |
| G4 second and third re-runs | 82 + 92 s, 27% of attempt 27 (VERIFIED) | — | Nothing in 19+ attempts | **W** (re-run only on a mismatch) |
| G5a null calibration, or the kernel permutation decision | K = 200 × T_primary ÷ jobs: 0.5–2 min on small tasks; 17 min or more on METABRIC unless run in-process (INFERENCE; `omb-sim` defaults to `--jobs 1`, VERIFIED by the cost sweep) | Parallel after the lock | Miscalibrated model-based p-values: parametric fMRI cluster inference had false-positive rates up to 70% [S40]; DESeq2 and edgeR exceeded 20% actual FDR at a 5% target on population RNA-seq [S39], which is exactly the ALS bulk RNA-seq setting | **P**; waived for unit-level permutation tests |
| G5b analytic power | Milliseconds | Plan check | Underpowered nulls read as "no effect" (Button 2013 [S46]) | **L** (annotation in every tier; a null without power is "insufficient") |
| G5b simulated power and planted-effect recovery | 100 seeds × T: 0.2–1 min small, 8–40 min METABRIC unless in-process (INFERENCE) | Parallel after the lock; only null and effect-size claims | Biased estimators; wrong CI coverage | **P** (kind-dependent) |
| G6 multiplicity | Milliseconds | After the lock | Subgroup fishing: only 1 of 46 supported subgroup claims was adjusted for multiplicity, and all 5 that were re-tested failed to replicate (Wallach 2017 [S45]) | **L** (count and "kth hypothesis" always), **P** decides |
| G7 blind cross-family replication | 7–15 min; one other-family session (Codex is scarce) | Parallel after the lock; **critical path** | Implementation errors and plan ambiguity: 29 analyst teams got odds ratios from 0.89 to 2.93 on one dataset [S26]; build-time cross-model review caught real bugs that an earlier proof pass missed. Weak against shared blind spots: LLMs agree about 60% of the time when both are wrong [S36], and 5 of 6 Claude and Codex runs missed the same duplicate trap. | **P** (same-family agreement counts as zero) |
| G8 sealed look (route H) | 14–90 s compute, serial per partition; **costs 30% of the units** | After the lock | Leakage inside the code, and choosing a hypothesis after seeing the data. 291 of 552 papers in the biomedical reviews Kapoor and Narayanan list had leakage pitfalls (selection-biased) [S37]. | **P**; required for claims that came from exploration and for prediction claims |
| G9 performance pack (new) | Seconds | Parallel after the lock | Majority-class baselines, training-fold AUCs, constant predictors passing Brier (the PSA and cardio cases); PROBAST+AI 4.7 | L in Explore (shown), **P** decides for out-of-sample claims |
| Optimism-corrected estimate and internal-external CV (new) | Bootstrap of at least 500: seconds to minutes for regressions on 8 CPU slots; fall back to CV for heavy ML (INFERENCE) | Parallel | Apparent performance (PROBAST+AI 4.1) | **P** (out-of-sample) |
| Whole-pipeline permutation (new; catalog B22) | About 100 × pipeline time on CPU slots | Parallel with G7 | Preprocessing or feature selection on all the data (PROBAST+AI 4.6), which G1b cannot see | **P** (out-of-sample) |
| Riley and precision check (new) | Milliseconds | Plan check | Prediction models developed or evaluated on too little data | L, **P** decides (out-of-sample) |
| Missing-data sensitivity run (new) | About one execution, 48–79 s (VERIFIED execute times), alongside G4 | Parallel | Conclusions that depend on the missing-data method (ICH E9 5.3) | **P** (only when the analysed n falls short) |
| Citation resolution | Milliseconds to 1 s per lookup | Report | 55% of GPT-3.5 and 18% of GPT-4 citations were fabricated [S42] | **A** (an unresolvable citation is dropped) |
| Citation support | — | Report | Whether a real source actually supports the claim | **W** |
| Recall (closed-book) probe | About 0.5–1 min, one short AI turn | Before the plan | Whether the model already "knows" the answer (EMA: LLMs "are at particular risk of memorisation" [S3], re-checked) | **W**; required report line at Confirmed and before registering a prediction |
| Reporting pack (dataset card, flow table, AI-use paragraph, evidence card, checklist pre-fill, release bundle) | Seconds; no LLM | Report | Most reporting-guideline items, written by software from the ledger | Always produced. Complete at Confirmed, but a missing field renders as "not reported by source" and never blocks. |
| External timestamp of the lock hash | Seconds; $0 if it publishes only the hash (INFERENCE: OpenTimestamps or a public git tag) | At each lock | Backdated "pre-registration" | **A** (record) from Tentative |
| Metric bounds, cleanup and sweep grades, CLI and environment provenance, unverifiable cross-table matches, near-duplicate heuristics, AI-chosen checks | v1 cost minutes of false positives (design section 2) | — | Nothing in 19+ attempts | **W** |

**Time budget that results** (INFERENCE):
- **Explore** adds less than 30 s of wall time over the AI turns: G1 cached (about 10 s once per dataset), G3 under 1 s, G4 overlapped with interpretation, citations in milliseconds.
- **Tentative** adds milliseconds for the lock, plus the occasional repair round.
- **Confirmed** costs max(G7 at 7–15 min, G5, whole-pipeline permutation). Keep G5 in-process so that G7 stays the bound.
- None of the medical-reporting additions needs an extra LLM turn.

**One caution on G5a.** The V1 review decision recorded in the status notes makes the confirmatory decision a kernel-run permutation test at the locked α, because a finite G5a diagnostic does not imply P(confirmed | null) ≤ α. That moves G5a's K × T cost into the primary decision itself. So the in-process permutation mode (R11) is a requirement, not an optimisation, on METABRIC-scale and ALS-scale data.

---

## 5. What the system must never do, and what a clinical hand-off contains

### 5.1 Never

1. **Never emit a per-patient prediction, score, risk or recommendation, and never build a per-patient interface.** Output stays at dataset or population level.
   - Patient- or caregiver-facing recommendation software is a device (FDA CDS, VERIFIED [S13], re-checked).
   - Clinician-facing software escapes device status only if the clinician can "independently review the basis for the recommendations".
   - The EMA notes that AI used "for clinical management of an individual patient" may be a device under MDR or IVDR [S3].
   - An ALS or PSA robustness audit is fine. A "PSA response predictor" that a clinician could apply to one patient is not (INFERENCE).
2. **Never produce patient-facing output of any kind.** That includes chat answers about someone's own data.
3. **Never assign "Clinical", and never use wording that implies clinical validity.** That means no "validated", "clinically", "recommend" or "should be treated". Route H is never called validation. "Confirmed" is shown as "Verified on this dataset". Every label carries "associational" unless the design follows the TARGET structure (INFERENCE).
4. **Never let anything leave the system without an endorsed, accountable human.** Never present AI conclusions as human-derived ([S31]). Never draft grant text: NIH will not treat applications "substantially developed by AI" as original ([S30]).
5. **Never send controlled-access data or PHI to a model provider.** Anything an agent cats or heads is a prompt ([S29]). PRO-ACT's terms ban consumer AI tools outright (memory file).
6. **Never let an LLM decide a label or a score** ([S32]).
7. **Never change the model, CLI, gauntlet or tolerances silently** ([S3] change control).
8. **Never run in time-critical clinical settings.** Those fail CDS criterion 4 ([S13]).

**Why the system must not decide, even when its label is correct.**
- In Jabbour et al. (JAMA 2023), clinician diagnostic accuracy was 73.0% at baseline. A systematically biased model cut it to 61.7%, and explanations did not fix this (64.0%). A standard model raised it only to 75.9%. VERIFIED [S16], re-checked.
- A correct association read as a recommendation is still a harm. The v2 guarantee says nothing about causation, individual patients, transport to other populations or clinical importance (design section 5, INFERENCE).

### 5.2 The clinical hand-off package

This is what the system can produce for a Confirmed or Replicated claim. It is shaped after the SPIRIT-AI, CONSORT-AI, TRIPOD+AI and DECIDE-AI items [S21][S22][S6][S15] (INFERENCE). Every item is generated by software from the store, and none needs an LLM.

1. **Evidence card**, one per claim:
   - the question and the context of use;
   - data and population;
   - each gate as passed, failed or not run, with its reason;
   - validation type (internal split-sample, temporal, or external retrospective);
   - the "kth hypothesis on this manifest" rank and the recall-probe result;
   - what the result does **not** show;
   - the fixed line "Research use only; not for clinical decision-making";
   - the evidence-stage line.
2. **Locked plan** with the amendment journal, the lock time, the external timestamp receipt and the look record (the blind-break time in ICH E9 terms).
3. **Dataset card(s)** and, for route N, the dev-vs-eval difference table.
4. **Participant-flow table** with a reason code for each exclusion, plus missingness by variable and the result of the missing-data sensitivity run.
5. **Results:**
   - unadjusted and adjusted estimates, each with a CI;
   - the multiverse table (robustness only, never confirmation);
   - for prediction claims, the G9 pack: discrimination, a calibration curve, net benefit at the locked thresholds, the comparison with the majority class and with a clinical comparator;
   - the subgroup table, or "fairness not assessable".
6. **Release bundle** that a journal data editor or CODECHECK can re-run in minutes (TOP 2025 Level 3 [S33]). Restricted data is described with its access route, never included.
7. **AI-use methods paragraph** following ICMJE: tool, version, prompts, and which steps were AI and which were software [S9].
8. **Pre-filled reporting checklist**: TRIPOD+AI for prediction, STROBE plus RECORD for associations in routine or public data, STARD-AI for diagnostic accuracy. Items software cannot know are marked "needs human", for example patient involvement and conflicts of interest.
9. **Change-control stamp**: gauntlet version, tolerance-table hash, model IDs, CLI versions and SHAs, and the stage-0 calibration result for that version.
10. **"Next rung" sheet** listing what humans must still do, in order (INFERENCE, from [S3][S12][S13][S15]):
    1. Independent external replication with public pre-registration.
    2. Peer review with accountable authors and a third-party reproducibility check.
    3. For prediction tools: external validation, then a device-status decision, then prospective evaluation (DECIDE-AI), then an impact trial, then clearance, then monitoring.
    4. For causal claims: a pre-registered target-trial emulation, then a randomised trial.
    5. A guideline panel.

The useful medical contribution sits upstream of this ladder:
- robustness audits;
- refutations of weak published claims (the PSA 89% finding is the model case);
- choosing the next experiment;
- time-stamped predictions scored against future readouts.

That last item is the only fast way to build the "future calendar time" evidence regulators value.

---

## 6. How the pilot tells whether each tier's dial is right

### 6.1 Metrics and pre-registered targets

Lock these targets before the kill screen, next to the design's section 9 rules. Targets marked INFERENCE are proposals.

| Metric | Definition | Explore | Tentative | Confirmed | Where it is measured |
|---|---|---|---|---|---|
| False-confirmed rate (FCR) | Share of claims holding the tier's top label that are wrong by task truth, clustered by task | Reported as a "false-lead rate". No target, but the empirical rate is printed on every exploratory label. | Reported and printed on every tentative label | Offline: at most α (binomial upper bound) over at least 200 null re-stagings per claim kind. Live: 0 confirms on tasks whose flaw a deterministic gate targets (w0, p9, p10, p10b, p11) and 0 on honeypots. 3 or more confirms across about 15 pure-null claim-attempts halts the run (design). | Stage 0 offline (V3, no LLM), kill screen, full pilot |
| Planted-flaw catch rate | Share of G1-class flaws caught | Must equal Confirmed's, because G1 is always on | Same | 100% on deterministic-gate tasks | Live |
| Verified yield | Share of true-effect claims that reach the tier's top label | — | At least Confirmed's | Offline: at least 80% of effects planted at the MEI are confirmed. Live: p1 and p2 confirmed; p16 recovered. | Both |
| Completion | Runs that end with a report and a gauntlet board | At least 15/16 | At least 15/16 | At least 15/16, and 0 finished analyses lost (design kill rule) | Live |
| Time | Median active wall-clock against arm B (Codex plus tool pack) on the same tasks | At most 1.2× B (INFERENCE) | At most 1.3× B (INFERENCE) | At most 2× B (design "cut layers" rule) | Live, quiet machine |
| Correct abstention | p5, p6, p7, p8, p13 | — | Reported | Reported (co-primary in the design) | Live |
| Forgery rate | Honeypot tasks (catalog section 5.4) | Measured | Measured | 0 confirmed forgeries | Live |

**Reading the result** (INFERENCE):
- **Confirmed FCR is fine but yield is low:** the dial is too strict. In the firing ledger, find the gate that fires most often on positive controls and repair or loosen it.
- **FCR is high:** the dial is too loose. Find which assumption (A1–A4) broke and which gate should have caught it, then add or harden that gate under the admission rule.
- **Explore is much slower than B:** some always-on check is too expensive. Move it to promotion, or fix its implementation, as with v1's G1 re-parsing.

**Statistical reality.**
- 16–19 tasks give a McNemar power of about 0.20 (design section 9). The live pilot can detect "unsafe" and "too strict", not fine differences between gates.
- The α claim for Confirmed must come from the offline synthetic suite. It is cheap and uses no LLM quota, because reference analyses are re-staged under null and planted effects.
- Superiority claims need the 60–80-task sealed suite.

### 6.2 Rule for demoting a gate that costs time without cutting errors

The design's rule stays: 2 or more false positives and 0 real catches in the pilot turns a gate into a warning. Add four refinements (INFERENCE):

1. **Log the unique catch.** For each firing, the ledger records real catch, false positive or silent. It also records whether the catch was **unique**, meaning neither another gate nor the agent itself flagged the same defect. Catches are correlated (both model families missed the same trap 5 of 6 times), so non-unique catches overstate a gate's value.
2. **Ablation, not silence, decides.** A gate that never fires on tasks without its flaw has not shown it is useless. To demote, re-run the gate's own planted-flaw tasks and 3 neutral tasks with it switched off (offline where possible, which costs no quota).
   - If FCR is unchanged within a pre-set margin and time is saved, demote it to a warning, or move it from always-on to promotion.
   - If it was the sole catcher on its planted task, keep it whatever it costs, and make it faster instead.
3. **Time trigger.** Any always-on gate whose median cost exceeds 10% of its tier's median wall-clock, and which has 0 unique catches, is automatically put up for ablation.
   - A gate belongs in always-on only if it is close to free, or if catching its error late would void downstream work (duplicates inflate n for everything after them).
   - Everything else waits for promotion.
4. **Promotion of warnings is never automatic.** A warning becomes a gate only under the design's admission rule: it cites a real catch, ships with positive and negative controls, has a timer and an off switch, and survives a lean ablation.
   - One extra trigger: a warning that co-occurs with 2 or more false-confirmed claims is put up for promotion.

**Two guards against cheating the dial:**
- Tolerances and thresholds are tuned only on controls, never on pilot outcomes (design rule).
- Every model, CLI or gauntlet change re-runs stage-0 calibration and the drift sentinels before any new label counts.

---

## 7. Recommended changes to the v2 design and build plan

V2 is currently being built by Codex in worktree `v2-gates`. Changes that touch V2 should land as a follow-up block (**V2b**) after V2 merges, not as a mid-flight scope change. Hours are builder-hours and are INFERENCE.

| # | Change | Where | Hours |
|---|---|---|---|
| R1 | **Target tier as a scheduling parameter**, separate from the earned label. Add `omb certify promote`, which reuses `adopt` and runs the missing gates on the frozen artifacts. **Seal at staging and record the plan hash in every tier.** On datasets under 150 units, default to route P when the goal is confirmation; Explore there needs an explicit "nothing found here can be confirmed on this dataset". | V1 schema plus V7/V9 | 4 |
| R2 | **Honest display names**: exploratory / pre-specified / verified on this dataset (internal) / replicated (external, retrospective). G5a is shown as "null check (type-I calibration)". G7 is shown as "independent re-analysis (other AI family)". Route H is shown as "internal (split-sample)". Add the evidence-stage line. Show the 7-value status in reports (section 2.3 collision). | V1 labels and renderer | 1.5 |
| R3 | **CI required** (no SE or CI means not confirmable); **unadjusted and adjusted estimates** both in `primary.json`, recomputed by G3. | V1/V2b | 1.5 |
| R4 | **New plan fields**: context of use; `missingData` method; time origin and predictor timing; locked thresholds and clinical comparator (out-of-sample); data class; cluster variable. Explore auto-fills the context of use as "internal hypothesis triage". | V1 plan schema | 2 |
| R5 | **G1d accounting and flow table.** This is catalog B4; keep it in the lean cut and make sure the flow table renders. | V2b/V3 | 0 new (B4's 11 h) |
| R6 | **G9 performance pack** plus the `predictions.tsv` contract and the subgroup table, with positive and negative controls (the constant-0.5 predictor and the majority-class model must fail). | V2b, controls in V3 | 6 |
| R7 | **Fix route H's point estimate.** Use the confirm-partition estimate or an optimism-corrected one, never the all-data training fit (this rewrites design section 5). Add internal-external CV when a cluster variable has 3 or more levels. Overlaps catalog B27 (winner's curse). | V2b plus V9 | 3 |
| R8 | **Whole-pipeline permutation** for out-of-sample claims. Same as catalog B22. | V2b | 0 new |
| R9 | **Riley and precision check**; route H eligibility for prediction claims depends on precision. | V2b | 2 |
| R10 | **Missing-data sensitivity run**, alongside G4 at Confirmed. | V2b plus V7 | 3 |
| R11 | **In-process permutation mode** for G5a, G5b and the kernel permutation decision (load once, permute in memory), plus an explicit job count. Required for METABRIC-scale and ALS-scale data. | V2b | 3 |
| R12 | **Reporting pack in omb-report**: evidence card, dataset card, AI-use methods paragraph, auto-disclosure lines, dataset-selection ledger, prior-access line, checklist pre-fill (TRIPOD+AI / STROBE+RECORD / STARD-AI), release bundle, "research use only" line in the README and terms. | V7 (or a small V7r) | 8 |
| R13 | **External timestamp of the lock hash** at every lock (hash only, $0), plus a hash-chained store with UTC. Overlaps catalog B29. | V5 | 1 beyond B29 |
| R14 | **Data-class preflight** in bio-guard: open, registered, controlled or PHI. | V2b stager | 3 |
| R15 | **Change control**: version and hash stamps on every label; any change triggers a stage-0 re-run before new labels count. | V3 | 2 |
| R16 | **Measurement**: per-gate timers and peak RSS on all tasks; firing ledger with the unique-catch field; per-tier metrics in pilot.py scoring. | V3/V10 | 3 |
| R17 | **Pre-registration addendum** to design section 9: the section 6.1 targets and the section 6.2 demotion refinements. | Operator | 0.5 |

**Totals** (INFERENCE):
- About 43.5 new hours if everything is built. That excludes B4, B22, B27 and B29, which the integrity catalog already budgets.
- **Lean cut**, which fits the owner's "every stage must earn its time" rule: R1, R2, R3, R4, R6, R11, R14, R16, R17 plus a minimal R12 (evidence card, AI-use paragraph, flow table). That is about **28 hours**. It makes the first usable `omb certify` honest about tiers, closes the prediction-model gap the PSA work needs, and keeps G7 as the only slow gate.
- Defer R7's internal-external CV, R9, R10, R13 and the rest of R12 until a task or a publication needs them. Defer R15 until the first model or CLI change after the pilot.

**What not to add** (keeping it lean, INFERENCE):
- No second identical re-run.
- No fairness gate (keep it an annotation; small subgroups make a poor gate).
- No recall-probe gate.
- No run-ending check for a missing reporting field.
- No LLM reviewer anywhere in scoring.

**Ordering for the owner's two programmes** (INFERENCE):
- **PSA audit (iad1–3):** R6 (G9 with the nadir-PSA comparator) and R7 matter most. They turn the preliminary 89% finding into a software-verified, reportable audit.
- **ALS (GSE153960, snRNA atlases):** G1a with the donor as the unit, R11 (in-process permutation at donor level) and G1c (site and batch) matter most. G8 matters only if a subtype classifier's out-of-sample accuracy is claimed.
- **Plan studies as pairs of datasets from the start**, so route N is available. A single public dataset now gets desk-rejected at some venues ([S17]).

---

## Sources

**Re-checked on 2026-10-10.** I opened these myself and matched the quoted text in the extracted primary text.
- [S1] FDA, *Considerations for the Use of AI to Support Regulatory Decision-Making for Drug and Biological Products*, draft, Jan 2025. https://www.fda.gov/media/184830/download
- [S2] FDA–EMA, *Guiding principles of good AI practice in drug development*, Jan 2026. https://www.ema.europa.eu/en/documents/other/guiding-principles-good-ai-practice-drug-development_en.pdf
- [S3] EMA, *Reflection paper on the use of AI in the medicinal product lifecycle*. https://www.ema.europa.eu/en/documents/scientific-guideline/reflection-paper-use-artificial-intelligence-ai-medicinal-product-lifecycle_en.pdf
- [S4] ICH E9, *Statistical principles for clinical trials*. https://www.ema.europa.eu/en/documents/scientific-guideline/ich-e-9-statistical-principles-clinical-trials-step-5_en.pdf
- [S5] Bender & Lange, J Clin Epidemiol 2001;54:343 (full-text copy). https://www.alanaragonblog.com/wp-content/uploads/2012/12/2001-Adjusting-for-multiple-testing%E2%80%94when-and-how.pdf
- [S6] TRIPOD+AI, BMJ 2024;385:e078378. https://epub.ub.uni-muenchen.de/116670/1/bmj-2023-078378.full.pdf
- [S7] PROBAST+AI, BMJ 2025. https://ora.ox.ac.uk/objects/uuid:8b15c087-459b-43fa-ad03-1f66ed6ba370/files/s1g05fd94g
- [S8] Collins et al., BMJ 2024 (evaluation of clinical prediction models, part 1). https://pmc.ncbi.nlm.nih.gov/articles/PMC10772854/
- [S9] ICMJE Recommendations, updated January 2026. https://www.icmje.org/icmje-recommendations.pdf ; AI page: https://www.icmje.org/recommendations/browse/artificial-intelligence/ai-use-by-authors.html
- [S10] FDA, *Considerations for the Use of Real-World Data and Real-World Evidence to Support Regulatory Decision-Making for Drug and Biological Products*, Aug 2023. https://www.fda.gov/media/171667/download
- [S11] ICH E6(R3) GCP, Step 4, Jan 2025. https://database.ich.org/sites/default/files/ICH_E6%28R3%29_Step4_FinalGuideline_2025_0106.pdf
- [S12] FDA, *AI-Enabled Device Software Functions*, draft, Jan 2025. https://www.fda.gov/media/184856/download
- [S13] FDA, *Clinical Decision Support Software*, final, revised January 2026. https://www.fda.gov/media/109618/download
- [S14] CONSORT 2025 statement. https://pure.amsterdamumc.nl/ws/files/139853933/Consort-2025-statement.pdf
- [S15] DECIDE-AI, BMJ 2022;377:e070904. https://ora.ox.ac.uk/objects/uuid:f3d4d76c-cfc7-40dc-a5c3-4f3a460c5901/files/rz603qz42n
- [S16] Jabbour et al., JAMA 2023;330(23):2275. https://jamanetwork.com/journals/jama/fullarticle/2812908
- [S17] Frontiers, "Cutting through fast-churn science", Sep 2025. https://www.frontiersin.org/news/2025/09/15/cutting-through-fast-churn-science-how-frontiers-raised-the-bar

**Opened by the research sweeps on 2026-10-10 and not re-opened by me.** Their VERIFIED status comes from the sweeps.
- [S18] STROBE checklist. https://resources.equator-network.org/reporting-guidelines/strobe/strobe-checklist.html
- [S19] RECORD, PLoS Med 2015;12:e1001885. https://journals.plos.org/plosmedicine/article?id=10.1371/journal.pmed.1001885
- [S20] STARD-AI items, from a reproduced checklist (the primary, Nat Med 2025 doi:10.1038/s41591-025-03953-8, is paywalled). https://assets-eu.researchsquare.com/files/rs-8680502/v1/c6e913805fe60d2534306535.docx
- [S21] CONSORT-AI. https://pmc.ncbi.nlm.nih.gov/articles/PMC7490784
- [S22] SPIRIT-AI. https://pmc.ncbi.nlm.nih.gov/articles/PMC8212701
- [S23] pmsampsize manual (Riley criteria). https://erised.las.iastate.edu/CRAN/web/packages/pmsampsize/pmsampsize.pdf
- [S24] Van Calster et al., J Clin Epidemiol 2016;74:167. https://repub.eur.nl/pub/87511
- [S25] NASEM, *Reproducibility and Replicability in Science*, 2019. https://www.nationalacademies.org/read/25303/chapter/2
- [S26] Silberzahn et al., AMPPS 2018. https://dare.uva.nl/id/0785a9cc-2470-4a3a-bea8-0f34828953c2
- [S27] 21 CFR 11.10. https://www.law.cornell.edu/cfr/text/21/11.10
- [S28] GMLP guiding principles (FDA, Health Canada, MHRA). https://www.gov.uk/government/publications/good-machine-learning-practice-for-medical-device-development-guiding-principles/good-machine-learning-practice-for-medical-device-development-guiding-principles
- [S29] NIH NOT-OD-25-081. https://grants.nih.gov/grants/guide/notice-files/NOT-OD-25-081.html
- [S30] NIH NOT-OD-25-132. https://grants.nih.gov/grants/guide/notice-files/NOT-OD-25-132.html
- [S31] Springer Nature AI editorial policy. https://www.nature.com/nature-portfolio/editorial-policies/ai
- [S32] Jiang et al., "BadScientist", arXiv 2510.18003. https://arxiv.org/html/2510.18003v1
- [S33] TOP Guidelines 2025 update (COS). https://www.cos.io/blog/new-preprint-introduces-major-update-to-the-top-guidelines
- [S34] EU AI Act Article 2 (text via mirror). https://artificialintelligenceact.eu/article/2/
- [S35] Suchak et al., PLOS Biology 2025. https://pmc.ncbi.nlm.nih.gov/articles/PMC12061153/
- [S36] Kim et al., correlated errors in LLMs, ICML 2025. https://arxiv.org/abs/2506.07962
- [S37] Kapoor & Narayanan, leakage and the reproducibility crisis. https://reproducible.cs.princeton.edu/
- [S38] G1-class prevalence: Lazic 2018 https://pubmed.ncbi.nlm.nih.gov/29617358/ ; Aarts 2014 https://pubmed.ncbi.nlm.nih.gov/24671065/ ; Waldron 2016 https://pubmed.ncbi.nlm.nih.gov/27381624/ ; Squair 2021 https://pubmed.ncbi.nlm.nih.gov/34584091/
- [S39] Li et al. 2022 (DESeq2/edgeR FDR inflation). https://pubmed.ncbi.nlm.nih.gov/35292087/
- [S40] Eklund et al. 2016. https://pmc.ncbi.nlm.nih.gov/articles/PMC4948312/
- [S41] Nuijten et al. 2016 (statcheck). https://pubmed.ncbi.nlm.nih.gov/26497820/
- [S42] Walters & Wilder 2023 (fabricated citations). https://pubmed.ncbi.nlm.nih.gov/37679503/
- [S43] Chan et al. 2004 (outcome switching). https://pubmed.ncbi.nlm.nih.gov/15161896/
- [S44] Kaplan & Irvin 2015. https://pubmed.ncbi.nlm.nih.gov/26244868/
- [S45] Wallach et al. 2017 (subgroup claims). https://pubmed.ncbi.nlm.nih.gov/28192563/
- [S46] Button et al. 2013. https://pubmed.ncbi.nlm.nih.gov/23571845/
- [S47] Trisovic et al. 2022. https://pubmed.ncbi.nlm.nih.gov/35190569/
- [S48] LLM hacking (2025). https://arxiv.org/abs/2509.08825

**Repo and local evidence** (read-only):
- `~/projects/omerta-bio/packages/bio-host/LIVE-ATTEMPT-25.json` and `LIVE-ATTEMPT-27.json`, phase timings re-read. The 174 s check phase contains the two re-runs; the grader re-run took 69.6 s.
- `~/projects/omerta-bio-wt/v2-gates/packages/omb-gauntlet/src/labels.ts` @99ef329: CONFIRM_REQUIREMENTS, REFUTE_REQUIREMENTS, `taskStatusOf`.
- `omerta_bio_v2_design.md` (sections 2, 5, 9, 10); `integrity_catalog.md` (B-numbers, section 5); memory file `omerta-bio-status.md`.
- Plain-arm wall-clock values come from `runs/v1-final` `meta.json` files, as reported by the cost sweep; I did not re-read them.
