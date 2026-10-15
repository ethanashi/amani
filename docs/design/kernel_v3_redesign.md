# Amani certifier: kernel v3 redesign (data contract + procedure registry)

Written for: the builders (Codex and Claude) and the owner. Date: 2026-10-11.

**Owner decisions (2026-10-11), binding:**
- α_max = 1.25α (6.25% at two-sided .05; 3.125% for one-sided .025);
- directional Confirmed claims use one-sided α = .025 (ICH E9);
- distribution class D = moderate for now: |skew| ≤ 1, variance ratio ≤ 4, tails no heavier than t5. Revisit once K2a reports what wider D costs in minimum n;
- held-out/out-of-sample Confirmed requires logged proof of no internet egress during training and apply. Otherwise the label is "internal, not sequestered" and the claim stays Tentative.

**Owner decisions, round 2 (2026-10-11, after the K2a feasibility study), binding; these supersede the corresponding round-1 items:**
- **Directional Confirmed claims:** the label's guarantee is a false-direction rate ≤ 5%. Release rule for a directional claim: the one-sided CP upper bound of the wrong-direction rate is ≤ 5% within the procedure's envelope. The nominal test is still one-sided .025, so the 3.125% α_max for directional claims is replaced by 5%. The bootstrap-t branch should be extended to the paired, stratified and regression procedures over time to tighten this.
- **Distribution class D widened:** tails no heavier than t3 (free per K2a), variance ratio ≤ 9 (about one sample-size step), |skew| ≤ 1 unchanged (skew 2 is prohibitive).
- Non-directional: α_max 6.25% at two-sided .05 (unchanged).

**Decision (2026-10-11, mine under the owner's delegation, after the Codex R audit of K2a):** D-wide certification by moment class is WITHDRAWN.
- The audit's counterexample: a zero-skew bounded mixture with rare outliers rejects 43% at 15/60 (Bahadur–Savage).
- The guarantee becomes: validated over the listed calibration families plus an adversarial search (rare-outlier mixtures, lattice outcomes), for data that passes observable, refusal-only validity diagnostics (influence/Lindeberg ratio, concentration, ties).
- Release certifies the END-TO-END false-Confirmed rate (procedure + diagnostics + refusals) by CP upper ≤ α_max.
- The owner's round-2 thresholds (6.25% non-directional; 5% false-direction; t3; variance ratio 9; |skew| ≤ 1) stay as calibration families.

**Decision (2026-10-11, mine, after the V5 verification):** Confirmed REQUIRES OS-user separation (`_ombcert` owns the store and seal key; worker code runs as `_ombrun`).
- In degraded single-user mode a worker sharing the UID can delete the WAL and roll back a spent look, and no in-process check can prevent that. So every claim from degraded mode is capped at Tentative, whatever the contract source (this tightens amendment 15).
- The owner runs `packages/omb-store/scripts/setup-os-users.sh` once with sudo before official Confirmed runs.
- Identity strings in partition commitments are the K1a canonical forms (alias registry plus normalizeIdentifier), and they include the floor-unit (donor) identity, so cross-dataset burn works across scopes, levels and spellings.

**Decision (2026-10-11, mine, after the K2a fix round):** mean-type procedures cannot be certified against rare far outliers. The adversarial false Confirmed results come from outlier-FREE samples, which are indistinguishable from genuine effects (a Bahadur–Savage consequence).
- Confirmed labels on mean-type claims therefore carry a CONTAMINATION BOUND: "validated for data with no values beyond 3 core SDs from the bulk; diagnostics passed (generalized ESD outlier test at 0.01 per claim; ties rule)".
- Within 3 core-SDs and |skew| ≤ 1, every confirmed corner passes.
- Each mean-type Confirmed claim is accompanied by a rank- or quantile-based companion estimand (Brunner–Munzel at ≥ 10/arm) as a robustness line.
- A bounded-mean test (with a declared outcome range, e.g. ALSFRS-R) is to be built in K2c.
- Envelopes come from FEASIBILITY.md v2. The new procedures need an independent R re-check before K2b certification goes live.

**Status: amended after review.** Four Claude critics (statistics, trust, usability, completeness) and one Codex critic all said "proceed with changes". The amendments at the end of this doc OVERRIDE sections A–D wherever they conflict. Owner decisions are pending on α_max, one-sided α, the distribution class D, and public-data sequestration.

## Why

The v2 certifier (omb-certify and omb-gauntlet) went through three fix rounds: V2b, V2c and V2d. Two adversarial re-probes with executable counterexamples, each break re-run by an independent skeptic, show it is not converging.

| Round | False Confirmed or unsafe Tentative | Over-strict (correct analyses blocked) | Held |
|---|---|---|---|
| Re-probe 1 (V2c) | 16 confirmed breaks + 4 charter items | several honest-worker blocks | — |
| Re-probe 2 (V2d) | 19 (16 reach Confirmed) | 15 | census containment (after R7); numeric tolerance function. The R7-adapter and forgery items reproduced, but skeptics marked them not-real because none gives a false label. They are false signed evidence, not false labels. G5b honest-failure rate is about 5%, not 7.5%. |

The breaks fall into the same classes every round:

1. **Who is a patient.** Identity is inferred from the content of tables the untrusted worker prepares and declares: column-name regexes in V2c, content heuristics in V2d.
   - Under-firing: float/hex IDs, two-donor designs, replicate suffixes, a decoy claim that removes patient_id from detection, an exclusion placed on another table.
   - Over-firing: integer age, stage, sex, site and visit columns are treated as patient IDs, so correct tables are refused or capped.
   - Inferring biological provenance from a table is not decidable in general, so every patch moves the boundary rather than closing it.
2. **Which test, under which assumption.** Labels such as "exact under exchangeability" are stamped by route, not by what was proven.
   - Assumption caps keyed on one route are dodged by declaring the same rows differently.
   - Unstudentized statistics on stratified and continuous-exposure paths reject a mean or slope null 14–28% of the time.
   - The G5a waiver fires on the worker's test *name*.
3. **Duplicates.**
   - The near-copy screen catches exact copies and single fields within 0.1%. It misses formatting, unit conversion, rounding and joint jitter.
   - It also fires on coincidental ties in low-information tables, so honest small trials lose Confirmed.
   - Findings in a companion table do not reach the claim.
   - A worker-locked flag can switch it off.
4. **Unreachable top label.**
   - Adjusted (Freedman–Lane, logistic) and repeated designs are forced to fail G1a, so they can never be Confirmed even when calibration passes.
   - Out-of-sample claims can never be Confirmed (heldOut is never true).
5. **Number corroboration gaps.**
   - Deterministic-fact claims check only the estimate.
   - A strict-JSON parse failure compares zero numbers and passes G3 vacuously.
   - The Welch alias on odds-ratio claims compares the wrong estimand.

What held: the R7 shared census supervisor (fork-handoff, budget, transient PIDs) and `numericAgreement`, which survived a 569k-candidate forgery fuzz.

## Principle

Separate **facts about the data** from **analysis of the data**.

- Facts about the data are established once per dataset, by a trusted path, and locked before any outcome-dependent look:
  - what the biological unit is;
  - which table rows belong to which unit;
  - which columns are identifiers, outcome, exposure, covariate or batch;
  - which samples are known replicates;
  - the held-out partition.
- The analyst (the untrusted generator) cannot author or change these facts. The certifier *verifies* the contract against the data with sound, deterministic checks. It never guesses.
- **Confirmed is available only through a registered procedure whose guarantee has been validated by simulation over a design envelope that covers the claim.** Everything else can reach Tentative at most. This keeps the top label honest and makes it reachable: a correct analysis inside an envelope gets Confirmed, and nothing outside one can.

## A. Data contract (replaces heuristic identity and duplicate gating)

**Schema** (`data-contract.json`, canonical JSON, hashed into the plan lock):
- tables: for each table,
  - path and content hash;
  - row key column(s);
  - unit column(s) (the biological unit: patient, donor, cell line, animal);
  - the unit level name;
  - the mapping to other tables (foreign key → unit);
  - orientation (rows = units / samples / features).
- columns: for each column, a role, one of `id`, `unit`, `outcome`, `exposure`, `covariate`, `batch`, `time`, `feature`, `ignore`.
- replicates: known technical or biological replicate groups (from metadata). Planted traps are never disclosed here.
- partitions: an optional trusted train/held-out assignment at the unit level, with its provenance.
- provenance: who produced each field (task author, curator A, curator B, owner) and any contested fields.

**Producers (trust):**
- Benchmark and pilot tasks: the task author writes the contract, and it is sealed with the task. The 19 pilot tasks each need one. The author states the true unit structure but never discloses planted defects.
- Public datasets (discovery mode, the starter projects): **two independent curator agents from different model families** (Claude and Codex) each build the contract.
  - They read source metadata (GEO sample characteristics, data dictionaries, papers) and identifier columns.
  - They do not see outcome-exposure associations and cannot run analyses.
  - A deterministic merge keeps fields both curators agree on. Disagreements become `contested`.
  - A claim that depends on a contested field is capped at Tentative until the owner resolves it.
  - Curation happens before the analyst's first look and is logged in the look ledger.

**Verification (deterministic, gates G1a/G1b):**
- Every analysis row maps to exactly one contract unit, and cross-table mappings are consistent.
- Every unit ID matches across tables, both raw and after a fixed normalisation: NFKC, casefold, trimmed whitespace and zero-width characters, canonical numbers so 101 = 101.0 = 1.01e2. A collision introduced by normalisation is refused.
- The claim's unit of inference must equal the contract unit or be coarser. The analyst's plan names the contract unit; it cannot declare a finer one.
- Held-out disjointness is checked on contract units through the contract mappings, including matrix headers.
- `effective_n` is the number of distinct contract units after known replicates are collapsed.

**Contradiction detectors** (the old heuristics, demoted):
- They run on the data and compare it against the contract.
- Strong evidence that the contract is wrong blocks Confirmed with "contract contradicted", and Tentative stays available with the limitation stated. Strong evidence means:
  - byte-identical or near-identical **high-dimensional** profiles under distinct units (the bio-checks correlation detector, which found 99/99 in w0);
  - exact duplicate rows across distinct units in a table with at least K informative fields.
- Low-information coincidences, such as two binary columns tied, are advisory only and never block.
- No content heuristic decides who a patient is. They only flag contradictions.
- Contradiction findings attach to every claim whose units include the affected units, whichever table they were found in.

**Removed:**
- column-name and content identity inference as gates;
- the worker-lockable `nonBiologicalColumns` and `acknowledgeContentDuplicates` (these facts now live in the contract);
- the run-input re-check that ignores model columns.

## B. Procedure registry (the only route to Confirmed)

Each registered procedure states:

| Field | Meaning |
|---|---|
| estimand | e.g. difference in unit means, a slope, an adjusted coefficient, a risk difference, a held-out Brier/AUC/net-benefit improvement |
| design | the shape it accepts: two-group, paired/crossover, stratified two-group, continuous exposure, adjusted (Freedman–Lane), repeated measures, frozen held-out prediction |
| statistic | always studentized where the null is a mean or slope null. Welch t for two groups; within-stratum studentized for stratified; HC3-studentized Freedman–Lane for adjusted and continuous exposure; sign-flip of unit contrasts for paired |
| guarantee | the exact text the label stamps, e.g. "exact under exchangeability; asymptotically valid under unequal variances" |
| envelope | the design range the guarantee is validated for: minimum units per arm, maximum imbalance ratio, minimum strata size, minimum events, and so on |
| validity checks | run on the data, e.g. ties, near-zero SE, separation |
| calibration grid | null rejection ≤ α + MC error, and power, over the grid. Grid axes: n, imbalance, heteroskedasticity, skew and heavy tails, ties, magnitude (1e-9 to 1e9), stratification, serial correlation. **It includes every design from re-probes 1 and 2.** |

**Rules:**
- The label and the guarantee come from the procedure the certifier ran, never from the worker's naming. G5a stress twins are mandatory for every procedure; there are no name-based waivers.
- A claim inside an envelope with passing validity checks can earn Confirmed, with G7 replication and the G8 held-out look as now.
- Outside the envelope, or with a design that matches no procedure, the claim gets Tentative at most, with the limitation.
- Repeated-measures and adjusted procedures can reach Confirmed when their grid passes. The blanket "model-based → G1a fail" is removed.
- Out-of-sample: if the contract provides a trusted partition and the executor applies the worker's frozen model artifact to the held-out units under the G8 look, the producer emits `heldOut: true`. Confirmed is then reachable. Externally supplied prediction columns stay at Tentative.
- The skill test stays as in V2d: prediction permutation plus minimum events, with no Bonferroni on min-over-baselines. Net-benefit event support is fixed so stronger models are not penalised.
- G5b recovery uses a calibrated interval-coverage rule, not a fixed 2σ bias rule (the current rule fails about 7.5% of correct analyses).

## C. Number corroboration

- One parser and one alias table for `primary.json` and `results.json`. A parse error, a duplicate claim ID or an unmatched ID fails closed. G3 must never pass with zero compared numbers.
- Every reported number (estimate, SE, CI, p, n) for every claim kind, including deterministic facts, is compared with software recomputation through `numericAgreement`. A number software did not compute must be absent, or the claim fails G3.
- The p-method and alias must match the claim's estimand: Welch on an OR claim is refused.
- Prototype keys are refused.
- `plantedEffect` uses the relative tolerance (no absolute floor).

## D. Small safety fixes (now, independent of the redesign)

1. The adapter maps any supervisor exit outside {0, 80, 90, 124}, including 3, 7 and 18, to an infrastructure failure. It never maps them to `ok`/`reaped`, even if a follow-up `--reap` census is clean.
2. The supervisor keeps `found` on exhaustion: a killed survivor reports exit 90 and survivors ≥ 1, even when the budget is also exhausted.
3. The C items above (vacuous G3, deterministic-fact numbers, Welch alias, plantedEffect floor, alias unification, prototype keys).
4. Reaper: a long-lived host process must re-verify the supervisor binary hash on each run, not cache a pre-upgrade binary forever.

## Acceptance (release gate for kernel v3)

1. Re-probe round 3 (the same breaker targets plus new ones) finds **no** false-Confirmed and no unsafe Tentative.
2. Liveness suite: these honest designs with planted effects reach **Confirmed** (with G7/G8 envelopes):
   - two-group n=40, d=0.8, with ties in 2-decimal outcomes;
   - repeated measures, 10 patients × 3 visits;
   - randomized crossover;
   - adjusted regression with integer age, sex and site covariates;
   - frozen held-out prediction (trusted partition);
   - a p1-esr1-shaped table with a cohort column.
   They must reach Tentative or better with an unused covariate present.
3. The calibration grid passes for every procedure, with rates and Wilson CIs in BUILD-NOTES.
4. V3 calibration, stage 0: on the 19 tasks (with their contracts), correct references reach their expected labels and naive analyses and nulls never confirm.

## Build split (equal Claude/Codex)

- **K0 (Claude builder, now, small):** section D safety fixes plus section C number corroboration. Writes: omb-certify, omb-adapters, omb-gauntlet.
- **K1 (Codex):** the data contract schema, the verifier (G1a/G1b), the contradiction detectors (demoted heuristics, the high-dimensional correlation detector from bio-checks), and removal of identity inference as a gate. Plus contracts for the 19 pilot tasks as author-written drafts. The owner or I review them against the sealed task specs without exposing planted defects in the contract.
- **K2 (Claude builder):** the procedure registry, studentized statistics on every route, label stamping from the procedure, mandatory G5a stress twins, the calibration grid as a CI suite (the re-probe designs included), the out-of-sample `heldOut` path through the executor, and the G5b coverage rule.
- **K3 (Codex, after K1):** the dual-curator pipeline for public datasets: curator prompts, deterministic merge, contested fields, look-ledger entries.
- Then: re-probe round 3 (Claude breakers + skeptics) and V3 calibration on kernel v3, in parallel.

The running pilot is unaffected: its arms are plain Claude, plain Codex and Codex+tools, pinned at fc62160.

---

# Amendments: Claude critic-panel synthesis (overrides A–D)

# Kernel v3 redesign: synthesis of four critiques

**Critics:** C1 = statistics, C2 = trust and contract integrity, C3 = liveness and scope, C4 = mapping against the re-probe breaks and the build plan. All four returned **sound-with-amendments**.

**Code checks I made on main @568d531:**
- The G5a waiver is still keyed on the test name (`certify.ts:191`).
- The G5a and G5b seeds come from `binding.executionId` (`certify.ts:195,202`).
- `linear.ts:46` uses the homoskedastic Student SE unless the HC3 knob is set or the outcome is binary.
- `certify.ts:208` fails G3 and G4 whenever the kernel cannot run the claim.

The size and power rates quoted below come from the critics' own simulations. I did not re-run them.

## Verdict

**Proceed with the redesign, but not with section B as written.** All four critics keep the principle and its structure:
- a sealed contract holds the facts about the data;
- a claim's unit is the contract unit or coarser;
- Confirmed is reachable only through a registered procedure;
- labels are stamped from the procedure that actually ran;
- section C and section D stand.

Two problems mean the build should not start as written:
1. **Section B's guarantee is undefined, and its statistics would fail their own grid.** Studentized permutation alone rejected 15.5% at 3:12, and HC3 Freedman–Lane with lognormal x rejected 16.8%. Taken together, acceptance items 2 (liveness) and 3 (every procedure passes the grid) cannot both be met.
2. **Three liveness gaps would make the system stricter than v1, which the owner already called "almost too strict":**
   - claims outside the registry land at insufficient-evidence, not Tentative;
   - contested fields block claims until the owner rules;
   - the registry does not cover ALS endpoints.

**Order of work:**
1. K0 now, expanded as in amendment 14.
2. K1a: freeze the contract schema (half a day).
3. K2a: a kernel-level feasibility simulation, taking hours, before any plumbing.
4. K1b, K2b and K3.

The gate at K2a: if the amended procedures cannot pass the release rule on the liveness designs under the chosen distribution class D, revise D or the liveness list first.

## Amendments (most important first)

**1. Define the guarantee: an exactness claim and a validated bound** (Principle; B "guarantee" and "envelope" rows) — K1a, K2
- Split the guarantee field into two parts.
  - (a) *Sharp-null exact.* Stamp it only when the contract records randomized assignment and the resampling matches that mechanism (complete, blocked, or within-unit order), or for an unadjusted binary risk difference of 0.
  - (b) *Validated bound.* "Worst-case Confirmed rate ≤ α_max over envelope E and distribution class D", with the bounds of D printed in the label: |skew| ≤ s, tails no heavier than t_ν, variance ratio ≤ r.
- Envelope membership uses only quantities the certifier can observe: n per arm, Bell–McCaffrey (BM) df computed from X, strata or cluster sizes, events. It is evaluated on the data the deciding test actually uses (the confirm partition). The axes it cannot observe are covered by taking the supremum over D.
- Checks that depend on the outcome (ties, near-zero SE, separation) may only refuse a claim, never reroute it.
- Add an `assignment` contract field per exposure: randomized-unit, randomized-within-unit-order, blocked/stratified, or observational, with the assignment unit and its provenance.

**2. Replace the "statistic" column** (B) — K2
- Every linear procedure uses the OLS coefficient divided by an HC2 SE. The decision p is **max(p_resample, p_t with BM df)**.
- p_resample is exposure permutation when assignment was randomized or the sharp null is wanted. Otherwise it is wild Rademacher sign-flips of restricted residuals inside Freedman–Lane.
- For two groups this reduces to max(permutation, Welch–Satterthwaite). C1 measured 4.9–6.0% on the heteroskedastic designs and 3.2–5.2% on slopes, including lognormal x.
- "BM df ≥ k" becomes the envelope axis for imbalance and leverage.
- Stratified designs have two regimes, chosen from the contract design:
  - few large strata: a weighted Welch combination with the weights locked in the estimand;
  - many small strata: CR2 clustered on stratum with BM df, maxed with within-stratum relabeling. This is the same procedure as paired and repeated measures, so R2 #12 and #13 close by construction.
- Crossover uses Hills–Armitage.
- Multi-visit designs with randomized order keep `withinUnitTest`.
- For pre/post designs, the label says "mean within-unit change", never "treatment effect".

**3. Directional claims, skew and measurement type** (B rules; contract) — K1a, K2
- Directional Confirmed claims use **one-sided α = .025** (ICH E9), and the label promises a false-directional rate ≤ 5%.
- Outcome measurement type becomes a contract fact: positive concentration, bounded score, count, binary, ordinal or time-to-event. Skew handling is then chosen before the look.
- Register skew-robust estimands:
  - log-scale ratio of geometric means for concentrations;
  - Brunner–Munzel studentized permutation;
  - an exact bounded-mean test for ALSFRS-R.
- The grid evaluates size at the thresholds actually used (α/m), not only at α.
- This needs owner approval: power for 20 vs 20 at d = .8 drops from .80 to .69.

**4. The reported interval is the inversion of the decision rule** (B) — K2, and K0 if anything certifies on main before K2
- Each procedure's CI inverts its own test (the BM-df HC2 interval, or the wider of that and the resampling interval). This fixes `linear.ts:46`, which feeds false Refuted labels and false effect-size Confirmed labels.
- Add grid cells for coverage ≥ 1 − α − tolerance, and a false-refute cell: P(Refuted | true effect = MEI) ≤ α.
- Refuted requires a registered procedure, with power computed by that same procedure.

**5. A defined release rule and bounded cost for the calibration grid** (B grid row; Acceptance 3) — K2
- Replace "≤ α + MC error" with this rule. A cell passes iff its one-sided 95% Clopper–Pearson upper bound is ≤ **α_max = 1.25α**.
  - Two stages: screen at 2,000 nulls, then 20,000 fresh nulls deciding alone.
  - Sharp-null-exact cells need only 2,000 nulls as an implementation check.
  - Release requires every cell to pass. This is an intersection–union test, so no Bonferroni correction is needed.
- Cells:
  - only the axes that apply to each procedure, covered by a strength-2 covering array plus the corners plus every re-probe design (about 40–60 cells per procedure);
  - an adversarial search over D;
  - a null-value axis (0, small nonzero, exact shift), with the R2 #17 exact-shift designs required to give p = 1 on every branch.
- Replace the magnitude axis with metamorphic tests: rescaling by 10^k, shifting, reordering rows, adding or renaming unused columns, and 101 vs 101.0 must not change the decision or p.
- Measure end-to-end Confirmed rates (procedure, envelope check and refusals together), and require power ≥ 0.9× oracle on the liveness designs.
- Two tiers:
  - CI: cached results plus a fail-fast smoke run of 10 s or less;
  - release: nightly, re-run only when a procedure's code hash changes.
- The contract records each numeric column's decimal resolution, and kernels compute on integer-scaled values.

**6. Replace per-claim G5a stress twins and the G5b rule** (B rules) — K2, with seed derivation in K0
- Per-claim G5a becomes **design-matched calibration**. Run the registered procedure on the worst-case laws in D at the claim's exact design (x, strata, units; never y), with N ≥ 5,000. Cache by design-signature hash and pass iff the CP upper bound is ≤ α_max. This also covers designs that fall between grid cells.
- G5b recovery for linear procedures becomes the deterministic lineage check. Coverage moves to the grid, generated with wild sign-flipped residuals so heteroskedasticity survives. The bias check stays only for nonlinear estimators.
- Derive every stochastic seed from content (registry version, plan-lock hash, contract hash, frozen-code hash), not from `executionId`. In re-probe 2, 16 of 16 alternative execution IDs passed G5b on the same data.
- Record every certification attempt in the look ledger. Only the first attempt per content tuple counts.
- Keep whole-pipeline G5a and negative controls wherever worker code computes something.

**7. Close the analyst-controlled inputs** (A Producers and Verification) — K1, with procedure selection in K2
- Delete `plan.staging`, `knobs.performance.trainingTable` and the worker's `splits.tsv` as inputs to any gate that can reach Confirmed.
- The host passes the contract through `CertifyRequest` with an `expectedContractHash` pin. It is never read from rawDir or workdir. A missing contract means G1a is not-run, with no fallback to heuristics.
- For public data, a trusted stager fetches the full archive record per accession (SOFT/MINiML, series matrix, supplementary file listing, SRA RunInfo, BioSample attributes, the paper by DOI). It hashes every byte stream and runs versioned, deterministic converters. Only the owner adds sources.
- The procedure is a deterministic function of the contract design and the plan's estimand, exposure and adjustment. The worker's test name only triggers a warning on mismatch. Add a regression: the same rows declared under every test name give the same procedure and label.

**8. The contract holds structural facts only** (A Schema) — K1a, frozen before K1b and K2
- Move outcome, exposure and covariate roles to `plan.json`. The contract may only forbid uses, such as an ID or a post-index column used as a covariate.
- Add:
  - a unit hierarchy with the minimum independent level marked;
  - per-table `unit_derivation`: an ordered column tuple canonicalised as a JSON array (never concatenated), an anchored regex on the row key, or a hashed sidecar map;
  - a **closed-world alias registry**: every row and matrix header must resolve, or the table is refused; orientation is the axis whose labels resolve, and is refused if both or neither do;
  - a strict decimal grammar, so 0x65 stays a string;
  - batch, time relative to the index event, `dependence`, assignment, measurement type and decimal resolution;
  - three dataset types: subject-level, feature-level, and summary-statistic. The summary-statistic type holds cohort lists with case and control counts, ancestry, genome build, per-SNP N and a pinned LD reference; software computes cohort overlap.
- Normalisation collisions merge the units and add a limitation line, instead of refusing.

**9. Curation: cited evidence and a conservative merge, not "agreement means correct"** (A Producers) — K3
- Every safety-relevant field (unit, foreign key, replicates, batch, time, partition) cites an evidence span: file hash, byte range and quote, verified deterministically. An uncited field is "assumed", and agreement never upgrades it.
- Curators are compared on the partitions their choices produce, not on column labels. The merge:
  - unit: the finest common coarsening (union-find over both groupings plus detector clusters);
  - replicates: the union;
  - held-out: the intersection, with any unit merged across the split dropped.
- **Auto-coarsened fields allow Confirmed.** Cap a claim only for fields with no safe direction (time zero, which file is authoritative, assignment, outcome definition), and only when the claim uses that field.
- The owner queue is optional, batched and outcome-blind. A resolution made after a look counts only if the claim passes under both readings.
- Free text can only tighten a field. Loosening needs a structured span. Screen metadata for injected instructions.
- Curators run sandboxed, on a fixed template plus the bundle, with no boss or analyst text. They get a schema-only view and never a joint view of two non-structural columns. They cannot exclude rows.
- Two curators from the same model family count as one.
- If the unit field is assumed, Confirmed requires the contract's unit count to be at most the subject count the source states, plus clean (or unavailable, stated) fingerprint checks.

**10. Duplicate detectors: a threat model, identity fingerprints, and validation before blocking** (A Contradiction detectors) — K1
- Write down the in-scope duplicate mechanisms, applied within and across tables, training vs held-out included:
  - exact match after canonical numeric tokens;
  - display rounding;
  - a constant ratio per column (unit conversion);
  - a constant offset per column (date shift);
  - all fields but one equal, over at least 3 informative fields;
  - near-identical high-dimensional profiles.
- Implement this as a calibrated record-linkage score on each unit's full linked profile across all tables, so neither table choice nor `ignore` roles can shrink what is checked. Block when coincidental matches are unlikely enough for at most 1% false blocks.
- Copies with several fields jittered together are out of scope, and a fixed limitation line on every Confirmed label says so.
- R1 #15 must stay caught. As written, the doc regresses it.
- Add structural detectors:
  - identity fingerprints: methylation rs probes, expressed-SNP concordance, kinship, XIST/RPS4Y1 checked against the sex field;
  - an undeclared grouping coarser than the contract unit;
  - row-key prefix structure (`assertCrossIdentity`);
  - ID-shaped non-identity columns that split rows into groups of 2 or more;
  - value links to another table's unit keys.
- **Admission:** no detector blocks until it shows ≤1% false blocks on real negatives (GSE112681, GSE153960 donor pairs, a cell-line panel) and passes the discovery-mode gate rule (≥80% of positives pass, ≥95% of invalid fixtures blocked).
- Negative integrity facts ("duplicate_records = 0") are capped at Tentative or worded as detector-scoped.

**11. Held-out route: a two-phase protocol** (B Out-of-sample) — K2 for the executor, K1 for the sealer
- **Train:** the executor runs frozen training code on a dev-only view. Held-out rows are physically absent, features and matrix headers included. Only the executor produces the artifact, and its hash goes in the ledger.
- **Apply** (the G8 look, as `_ombrun`, no network):
  - the view holds only the plan-locked feature columns, with HMAC tokens in place of IDs and rows shuffled;
  - the only accepted output is `predictions.tsv`;
  - a trusted scorer joins tokens to outcomes.
- Before emitting `heldOut: true`, require:
  - whole-pipeline permutation: retrain on at least 20 permuted dev label sets;
  - sub-batch invariance (otherwise Tentative);
  - whole batches held out, or a within-batch skill permutation.
- G1b for this claim kind is the contract partition. Drop the two-fold requirement for frozen splits.
- Only the trusted sealer makes partitions, with seed HMAC(host key, contract hash).
- Literature-derived inputs are declared with their source accessions. Overlap with the held-out set means Tentative.
- For public data without proof of archive sequestration, the label says "internal, not sequestered" (see disagreement 9).
- Regressions: training code that reads a held-out file fails closed; the 300/300 liveness design reaches Confirmed.

**12. Kernel-run derivations and declarative claims** (new B subsection) — K2
- Register these derivations: join along a foreign key, an outcome-blind filter with an exclusion table, complete-case handling or a registered missing-data method, change score, log1p/CPM/z, aggregation to a unit level, and event time from dates.
- A claim is a list of derivations followed by one procedure.
- For kernel-run claims, G7 becomes a deterministic conformance check and per-claim G5a becomes amendment 6. Worker-written derivations are still allowed, but they cap at Tentative and keep G7.

**13. G3 grades and unverified numbers** (C) — K0
- Two grades:
  - **G3-kernel**, required for Confirmed;
  - **G3-exec**: the numbers equal what the frozen worker code produced when software ran it, and the G4 rerun agrees. This is enough for Tentative and fixes the `certify.ts:208` path to insufficient-evidence.
- Extra numbers with no trusted counterpart are stripped and listed under "unverified worker numbers". They do not fail G3.
- G3 fails only on disagreement, a parse failure, an ID collision or mismatch, or zero compared numbers.
- The kernel also emits conventional companion statistics (classical t, Wald, log-rank), each tagged with its method and checked by method. Reports mark which statistic is deciding and which are conventional.
- The registry governs inferential claims only. Deterministic facts, statistics recomputed from supplied columns, and citations keep their own deterministic routes to Confirmed.
- Key the alias table by procedure ID.

**14. Additions to K0 (land now)** — K0
- R2 #18: event support needs ≥10 discordant units plus ≥10 events and ≥10 non-events.
- R2 #19: take the lower bound at α per baseline.
- R2 #20: use a cluster bootstrap stratified by event and non-event.
- Content-derived seeds (amendment 6).
- Remove the name waiver at `certify.ts:191` now if anything certifies on main before K2.
- Refuse ECE as a Confirmed headline metric. Clip exact 0 and 1 predictions for log loss and ECE.
- Land the F1–F5 and S1–S3 repros as failing regressions first, then fix them.
- Generate the logistic changed-truth twin without separation.
- Close the look-time crash channel at `routing.ts:82`:
  - run a synthetic-schema dry run before the look;
  - a crash after the look starts spends the look, and a repaired re-run counts as look 2, which means Tentative;
  - after a look, models see only trusted error categories;
  - a crash on real data that does not happen on the scrambled twin is a hard stop.

**15. Ledger, binding and the lock timeline** (A; new section) — K1, with binding in K2
- Binding adds contractHash, partitionHash, artifactHash, registryVersion and the calibration-result hash. G7 and G8 envelopes bind to them.
- Fixed timeline: L0 source lock → L1 contract lock → L2 partition lock (burn status belongs to units, across datasets where identity is known) → L3 schema view from dev units only → L4 plan lock → L5 training → L6 look record, fsynced before execution.
- After any look, contract amendments may only coarsen units, add replicate groups or remove held-out units, and must be made outcome-blind. The claim must pass under both the locked version and the new one. Any other amendment voids Confirmed.
- Contracts, resolutions and the ledger live in the `_ombcert` store with the authority MAC. Without the OS-user setup, curated contracts cannot support Confirmed.

**16. Multiplicity computed by software** (G6, currently unchanged by the doc) — K2
- Software computes the family from (outcome-dataset hash, outcome, exposure, contract unit). Plan-declared families do not reset alpha, and exploratory claims count.
- Use an alpha-wealth rule per outcome dataset (LORD++ or spending).
- Per-feature Confirmed needs FWER control (Holm, or Westfall–Young/Romano–Wolf maxT step-down) or held-out replication. BH-only selections stay Tentative.
- Set B ≥ ⌈20m/α⌉ and centre the Monte Carlo extension band on the adjusted threshold.
- Allow gatekeeping families for primary-then-secondary endpoints.
- Add a screen claim type certified once per family, for the roughly 9,300 MR tests in Q2.

**17. Registry scope driven by the ALS program** (B) — K2, plus a new K4
- K2 ships:
  - the seven listed designs, with the amended statistics;
  - exact binary risk difference;
  - logistic: score or LR tests, Firth estimates, a marginal-effect estimand;
  - survival: a studentized weighted log-rank permutation for "effect exists" and RMST at a locked τ for effect size, with the Cox HR as a companion statistic only;
  - kernel-owned grouped-CV performance;
  - pseudobulk feature tests with maxT or BH.
- Survival needs new contract roles: `event` with the meaning of each code, `time_origin`, `entry_time`, `event_type`/composite, and censoring reason. Envelope: ≥10 events per arm.
- K4: counts with an exposure-time offset, ordinal outcomes, clustered data (CR2 plus wild cluster bootstrap), MR and coloc validated on the DM3 fixtures, and gene sets against matched nulls.
- Plans may name a `proc@pending` ID (see disagreement 11).

**18. Gate hygiene** — K1/K2 boundary
- Add **G5c "registered procedure within envelope"** to `CONFIRM_REQUIREMENTS`, with its own limitation text. Reserve G1a for contract verification, and give "contract contradicted" its own reason code (R2 #28).
- G1c selects columns from plan covariates plus contract batch and time. An exposure aligned with a batch or a unit grouping is non-identifiable.
- `batch` becomes load-bearing in G9: add a per-batch-prevalence baseline, and require disjoint held-out batches before "transportable" wording.
- When a claim falls outside an envelope, the label names the bound that failed, the observed and required values, and the nearest procedure that would cover the design.

**19. Acceptance and build split** — all blocks
- Item 1 becomes "no false Confirmed within the stated threat model and D". Define "unsafe Tentative" as unit inflation, held-out leakage, or unverified numbers shown as verified.
- Item 2: state liveness as rates (Confirmed in ≥0.8× the procedure's power over 50 seeds). Add one liveness design per K2 procedure, plus a p13-shaped two-table ANCOVA with NA rows. An unused covariate must leave the label unchanged, not merely at Tentative or better.
- New item: K3 curator acceptance.
  - Run an adversarial curation suite plus at least 10 real series: GSE112681, GSE153960/GSE137810, GSE296710–16, GSE299976.
  - Report wall-clock, the contested rate on fields claims actually use, and the share resolved without the owner (target ≥90%).
  - The rate at which both curators agree on a wrong safety-relevant field needs a Wilson upper bound ≤2%.
- Produce the 19 pilot contracts **blind through the K3 pipeline** (stage 0b). The author only checks fields unrelated to the planted defects, and every edit is logged. Report V3 calibration twice: with curator contracts and with author contracts.
- Ownership: K1 owns G1a, G1b and contradiction findings. K2 owns G5c and the labels.ts requirements. Neither edits the other's lines in `certify.ts`.
- Start round-3 probes on each block as it lands.
- Take curation off the critical path: seal the partition at staging on a provisional conservative grouping. Exploration starts once curator A finishes. Curator B and the merge run in parallel, and only for claims targeting Confirmed.

## Points where critics disagree, with recommendations

1. **What replaces per-claim G5a.**
   - C1: design-matched calibration that never uses y.
   - C4: twins built by resampling residuals of the observed y under the null.
   - C3: drop it for kernel-run claims.
   - **Recommendation: C1.** It adds no gate that depends on the outcome, and it covers designs between grid cells. Keep C4's concern by measuring end-to-end Confirmed rates in the grid.
2. **The grid rule: does the procedure have to prove it is safe, or does the grid have to prove it is unsafe?**
   - C1: pass iff the CP upper bound is ≤ 1.25α.
   - C4: fail only if the Wilson lower bound exceeds α + 0.5pp.
   - C3: at 200 reps, fail if the Wilson lower bound exceeds 1.5α.
   - **Recommendation: C1 for release**, because C4's rule often passes a procedure whose true size is 7%, which is unacceptable for medical claims. Use C3's rule only as the CI smoke tier. The owner sets α_max.
3. **"Standard methods" admission.**
   - C3: established theory plus a short grid.
   - C1: Bahadur–Savage means every mean or slope test needs validation over a named D.
   - **Recommendation:** "standard" buys a smaller covering array, never an exemption from the CP rule over D. The evidence: a studentized permutation alone reached 15.5% at 3:12.
4. **Cox at Confirmed.**
   - C3: register `cox-ph-robust` in K2.
   - C1: Cox is Tentative-only because the hazard ratio is non-collapsible and depends on proportional hazards.
   - **Recommendation: C1.** Log-rank and RMST decide. The Cox HR is reported as a kernel companion statistic.
5. **How many curators.**
   - C2: more scrutiny (cited spans, an adversarial suite, same-family counts as one).
   - C3: one curator, with a risk-based second.
   - **Recommendation: both.** Safety comes from cited spans, the lattice merge and the fingerprint detectors, not from agreement. So the second curator is needed only for claims targeting Confirmed, and it must be from the other model family.
6. **Contract lock timing.**
   - C2: lock before any analyst access, the schema view included.
   - C3: exploration starts after curator A.
   - **Recommendation:** seal the partition and curator A's provisional contract before the schema view. Curator B and the merge may finish later, because the merge is a join and can only coarsen. Curators never see analyst text.
7. **An assignment unit finer than the biological unit** (wells in one iPSC line).
   - C4: allow it with a scope limitation.
   - Doc and C2: the contract unit is the floor.
   - **Recommendation:** allow it only for sharp-null randomization claims, labelled "within these N lines; does not generalise". Such claims cannot serve as population-level evidence on the discovery ladder, where F4 still requires at least 3 lines.
8. **Normalisation collisions.**
   - Doc: refuse.
   - C3: merge the units and add a limitation.
   - **Recommendation: merge.** It costs power, never type I error.
9. **Public held-out sequestration.**
   - C2: out-of-sample Confirmed is unavailable without proof from the egress allowlist.
   - Others are silent, but it bears on liveness.
   - **Recommendation:** adopt C2. An artifact can fingerprint the real dev labels and defeat the permutation test. This is cheap if worker sandboxes already lack archive egress. It is an owner decision if they do not.
10. **The G5b plasmode rule.**
    - C4: keep the generators and change only the decision rule.
    - C1: for linear procedures the bias term produces only false alarms, and the permuted residuals erase heteroskedasticity.
    - **Recommendation: C1 for linear procedures; keep the generators for nonlinear ones.**
11. **Pending procedure IDs** (C3). There is a risk that the envelope gets tailored after the result is seen. **Recommendation:** allow promotion only if the pending entry's estimand, statistic and envelope were pinned in the plan lock before the look. The grid result binds whichever way it goes.

## Owner decisions needed before K2a

- α_max = 1.25α (6.25% at .05; 5% for one-sided .025 claims).
- One-sided .025 for directional claims, at the stated power cost.
- The bounds of D (for example |skew| ≤ 1, variance ratio ≤ 4 or 9, tails no heavier than t_5), printed in every Confirmed label.
- The sequestration rule for public data.
- The release budget, which C1 estimates at about 1–2 hours on 8 workers, run nightly.
---

# Amendments: Codex cross-family critique (overrides A–D; where it conflicts with the synthesis, the synthesis's recommendation stands unless noted)

The redesign is directionally right, but it still overstates what contracts and simulation can establish. I reviewed the proposal, both probe reports, and the relevant code at `568d531`, read-only; I did not rerun probes.

1. **The diagnosis identifies a major cause, not the whole cause.**

   V2c’s name heuristics and V2d’s content heuristics alternate between admitting pseudoreplication and rejecting ordinary covariates. Biological identity is **not identifiable from arbitrary tables alone**; “undecidable” is unnecessary. The decoy-claim bypass particularly demonstrates that analysis declarations must not change dataset identity.

   Separate causes remain: invalid resampling assumptions, floating-point tie loss, inconsistent gate propagation, and permissive label fallback. Contracts alone cannot fix these.

   Author-sealed contracts are appropriate for benchmarks. Two model families agreeing is useful corroboration, **not a trusted provenance authority**: they can share metadata errors, contamination, and prompt-injection exposure. Require source citations per field, immutable source snapshots, explicit unknowns, and accountable approval for consequential identity assertions.

   I would build a typed provenance graph distinguishing specimen, donor, randomization unit, dependence cluster, and target population. Include join cardinalities, row exclusions, transformations, measurement units, missingness codes, and assignment mechanism. Every derived analysis row needs lineage to sealed source rows.

   Avoid universal numeric/case normalization: `001`, `1`, and `A`/`a` can identify different entities. Use namespace-specific rules, preserve originals, and reject ambiguous collisions. Distinct donors are a count, not automatically statistical `effective_n`; biological replicates should not automatically collapse.

   Resolve the benchmark contradiction: a contract cannot simultaneously reveal true duplicate identities and conceal that defect from the analyst. Separate checker-private truth from analyst-visible metadata.

2. **The registry is worthwhile, but its guarantees need rewriting.**

   Welch studentization is appropriate for independent mean contrasts. Its permutation test is exact under the relevant exchangeability null, and asymptotically valid for unequal-distribution mean nulls under regularity conditions. Those are different guarantees; studentization does not repair small samples automatically. [Chung–Romano](https://arxiv.org/abs/1304.5939)

   Stratified procedures need a locked weighting estimand and corresponding variance estimator—not merely “within-stratum studentized.” Sign flips require independent, symmetric null contrasts or a justified randomization distribution. Ten patients × three visits is ten independent units; arbitrary pre/post visits are not exchangeable. Randomized crossover permutations must reproduce the actual sequence assignment and address carryover.

   **HC3–Freedman–Lane is not a general heteroskedasticity fix.** Residual permutation still needs justified exchangeability. Keep Freedman–Lane within an explicit model envelope; investigate null-imposed, studentized wild bootstrap for heteroskedastic regression, with its own validation. [Winkler et al.](https://pmc.ncbi.nlm.nih.gov/articles/PMC4010955/), [Davidson–Flachaire](https://russell-davidson.research.mcgill.ca/articles/wild8-euro.pdf)

   My initial *candidate* envelopes would be:

   | Procedure | Conservative starting envelope |
   |---|---|
   | Exact assignment-based test | Verified assignment mechanism and sharp null; sufficient attainable p-value resolution |
   | Weak-null two-group means | ≥30 units/arm; imbalance ≤2:1; validate variance ratios through 4:1 and specified skew/tail families |
   | Stratified weak-null means | Initially ≥20/arm/stratum, fixed weights; sparse strata require separate theory |
   | Adjusted/continuous regression | ≥100 independent units; ≤10 fitted coefficients; maximum leverage ≤0.2; full rank |
   | Weak-null paired means | ≥30 independent contrasts; smaller samples require defensible symmetry/randomization |
   | Frozen prediction | Initially ≥50 events and ≥50 non-events; metric-specific support and precision checks |

   These are release candidates, **not sufficient mathematical conditions**. Unknown tail behavior and dependence cannot be certified from sample diagnostics. Small-arm heteroskedasticity, skewed contrasts, high leverage, sparse logistic outcomes, separation, and rare discordant events remain hazards.

   Register tests **and intervals together**. Current [`linearEntry`](../../packages/omb-certify/src/linear.ts:36) can supply homoskedastic Student intervals alongside robust/permutation decisions. Correct p-values do not validate coverage.

   Removing Bonferroni is appropriate for the single intersection-union claim “beats every fixed baseline,” provided each component test is valid. It does not grant simultaneous coverage for every displayed interval or protect threshold selection.

   Defer survival, count-model, and general clustered-outcome registrations. Represent clustering now; admit narrowly justified cluster-level randomization tests. Survival needs censoring/risk-set semantics; count models need offsets and dispersion; clustered models need cluster-level degrees of freedom and imbalance validation.

3. **Keep substantial V2d infrastructure.**

   Retain `GateAuthority`, binding checks, signed staging receipts, snapshot hashing, frozen-code inventory, sandbox isolation, shared census supervisor, externally owned gate restrictions, and the pure decision/gate architecture.

   Keep [`numericAgreement`](../../packages/omb-certify/src/numeric.ts:26), supported by the forgery fuzz, separately from inference tie handling. Keep Monte Carlo’s plus-one calculation and maximum-of-stage decision rule, conditional on a valid resampling scheme. Preserve Holm/Bonferroni machinery, explicit unresolved outcomes, regression fixtures, and mutation tests.

   Refactor identity and procedure interfaces incrementally. Do not rewrite the security boundary alongside the statistical kernel.

4. **Several material risks remain unaddressed.**

   The proposal explicitly allows Tentative after a contract contradiction. That preserves unsafe outcomes already demonstrated. [`labelClaim`](../../packages/omb-gauntlet/src/labels.ts:157) broadly converts missing confirmation requirements into Tentative. Separate missing corroboration from invalid evidence: known leakage, pseudoreplication, or invalid inference must block supportive labels while retaining descriptive results.

   High-dimensional correlation is evidence for investigation, not proof of identity. K fields may contain little independent information. Define specificity, unresolved findings, and appeal/review behavior; never silently merge.

   A trusted partition plus frozen artifact does not establish honest training provenance. Labels may already be embedded in code, features, preprocessing, or public-data memorization. Enforce held-out access isolation and preprocessing lineage; fix G1b’s inappropriate cross-validation-fold requirement too.

   Address cross-run selection, execution-ID seed shopping, family redefinition, and repeated contract revisions. G7’s same-data computational agreement does not supply independent biological evidence. Refutation also needs family/look-aware interval guarantees.

   Explicitly repair nonzero-null cancellation and scale-dependent ties: the verified decimal-shift example changes from rejection to p=1 under unit conversion. Measurement magnitudes alone are an inadequate numerical grid.

   Finally, D4 misdescribes the reaper: it already rehashes the cached binary each run. The remaining problem is binding cached bytes to the currently approved source/build version.

5. **Build order and my ownership.**

   First: K0, invalid-evidence label rules, numerical invariance fixes, and regression coverage for every probe. Second: K1 with author contracts and one canonical verified data representation. Third: a minimal registry, then adjusted and held-out procedures. Defer K3 until human-reviewed curation works.

   Replace “nulls never confirm” with calibrated error-rate requirements. Use independent validation seeds, 10,000–50,000 simulations at difficult boundary cells, and simultaneous upper confidence bounds against a preregistered tolerance—say 0.06 at nominal 0.05. Liveness should measure eligibility and power, not demand every planted dataset confirm.

   Correct the evidence summary: the G5b skeptic found roughly 5% honest failures, not established 7.5%. R7/forgery findings appear in `perTarget`, without entries in the independently confirmed list.

   I would own K1, provenance bindings, label propagation, and adversarial integration tests, and review K2’s statistical specification independently. I would defer dual-curator automation.

**Verdict: proceed with changes.**