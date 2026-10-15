## Title

MarkerA and ALS&#58; a pre-registered analysis

## Authors

Ethan Ashihundu &#40;corresponding author&#41; — Independent researcher

## Structured abstract

**Question.** The question concerns MarkerA and ALS.

**Data and design.** Synthetic repository&#58; SYN001; release fixture-v1; SHA-256 cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc

**Pre-registration.** Plan dda77735c666bc20d467e6f22fe1b09f2abb6c6ca9ebfb1f5b2339632a1bfcc4; locked 2026-01-01; recorded looks&#58; 1.

**Primary result.** MarkerA and ALS&#58; The finding is tentative; required checks remain incomplete odds ratio 1.42 &#40;95% CI 1.08 to 1.87; adjusted for age; n &#61; 4,210; p &#61; 0.05, adjusted for 4 tests; effective alpha &#61; 0.025&#41; &#40;pre-registered; 1 of 2 required checks passed; validation not established; tentative&#41;.

Of 4 pre-registered claims, 0 passed every required check, 4 were supported without passing every check, 0 were ruled out at the smallest effect of interest and 0 could not be decided; 0 further results are exploratory.

**Conclusion.** supported, but not every required check passed.

**Reproducibility.** run&#95;all.sh.

Study design in the abstract&#58; cohort.

## Plain summary

MarkerA and ALS&#58; The finding is tentative; required checks remain incomplete odds ratio 1.42 &#40;95% CI 1.08 to 1.87; adjusted for age; n &#61; 4,210; p &#61; 0.05, adjusted for 4 tests; effective alpha &#61; 0.025&#41; &#40;pre-registered; 1 of 2 required checks passed; validation not established; tentative&#41;.

## Summary of findings

| Claim | Result | Evidence label |
| --- | --- | --- |
| MarkerA and ALS | odds ratio 1.42 &#40;95% CI 1.08 to 1.87; adjusted for age; n &#61; 4,210; p &#61; 0.05, adjusted for 4 tests; effective alpha &#61; 0.025&#41; | pre-registered &#40;plan locked date unavailable, OSF synthetic&#41;; 1 of 2 required checks passed &#40;not passed&#58; independently re-implemented &#40;a second AI system, from a different developer, re-analysed from the locked plan&#41;&#41;; validation not established; supported, but not every required check passed |
| MarkerB and ALS | odds ratio 1.12 &#40;95% CI 0.96 to 1.21; adjusted for age; n &#61; 4,210; p &#61; 0.05, adjusted for 4 tests; effective alpha &#61; 0.025&#41; | pre-registered &#40;plan locked date unavailable, OSF synthetic&#41;; 1 of 2 required checks passed &#40;not passed&#58; independently re-implemented &#40;a second AI system, from a different developer, re-analysed from the locked plan&#41;&#41;; validation not established; supported, but not every required check passed |
| MarkerC and ALS | odds ratio 1.12 &#40;95% CI 0.96 to 1.21; adjusted for age; n &#61; 4,210; p &#61; 0.05, adjusted for 4 tests; effective alpha &#61; 0.025&#41; | pre-registered &#40;plan locked date unavailable, OSF synthetic&#41;; 1 of 2 required checks passed &#40;not passed&#58; independently re-implemented &#40;a second AI system, from a different developer, re-analysed from the locked plan&#41;&#41;; validation not established; supported, but not every required check passed |
| MarkerD and ALS | odds ratio 1.12 &#40;95% CI 0.96 to 1.21; adjusted for age; n &#61; 4,210; p &#61; 0.05, adjusted for 4 tests; effective alpha &#61; 0.025&#41; | pre-registered &#40;plan locked date unavailable, OSF synthetic&#41;; 1 of 2 required checks passed &#40;not passed&#58; independently re-implemented &#40;a second AI system, from a different developer, re-analysed from the locked plan&#41;&#41;; validation not established; supported, but not every required check passed |

## Introduction

A useful research question must distinguish molecular description from explanation of disease mechanisms. The present inquiry concerns that distinction and the interpretive responsibilities that follow from it. Readers need an account of the scientific motivation as well as an honest description of uncertainty. The introduction therefore moves from broad biological questions toward the narrower question that can be asked of the available material. Its purpose is to explain the motivation without presuming an answer. A molecular measurement may invite an appealing biological story, yet an appealing story is only a starting point for inquiry. A measurement and a proposed mechanism deserve separate consideration. It is useful to ask what kind of observation would inform the question and what kind would leave it unresolved. Such questions can guide the organisation of a research account without implying that a preferred explanation is inevitable. A substantive rationale should leave room for competing explanations throughout that account. The purpose of the introduction is also to make the scope of inquiry intelligible to readers with different scientific backgrounds. A reader interested in biological mechanisms may bring different questions from a reader interested in the interpretation of measurements. Both perspectives deserve space in the rationale. The account should describe where their questions overlap and where they require different kinds of evidence. Keeping these purposes explicit can help the reader understand why a narrow question belongs within a broader scientific programme. Conceptual precision matters when the material available for research cannot answer every question that motivated the inquiry. It would be misleading to let the breadth of the motivation determine the breadth of the interpretation. Instead, the rationale can explain why an operational question is worth asking while leaving its wider meaning open. This approach calls for attention to terminology, to the distinction between description and explanation, and to the responsibilities involved in communicating uncertainty to a reader outside the immediate research setting. The following account therefore separates the scientific motivation from the operational description and from the closing interpretation. Each part serves a different purpose in evaluating the research question. Readers should be able to inspect the account without needing to accept a particular mechanistic story at the outset. Open questions about scope and meaning belong in the scientific discussion rather than being hidden behind an attractive narrative. The software supplied aims state the precise question, while the surrounding prose explains why careful consideration of that question may be useful. Owner review required before endorsement&#58; AI-use/Methods prose flags 3451cbefc0a2116575bff69383d0c0393152f893a45fb4d915f524133b0cf3e9, 2daa30becbf2258748b910e02793158b67840e737412d8797d89d1ae6981cd73 &#40;PaperInput e5cffac0fd820e9f72d5262bf783a4b65ff2c27ded44bb2cc5e085de4b3ac530; draft df854b81cc53d0c85ceccbe6906ad9d5ff413ae448d793cc9c0eadef40962bcb&#41;.

Primary aim&#58; MarkerA and ALS; two-sided hypothesis. Secondary aim&#58; MarkerB and ALS; two-sided hypothesis. Secondary aim&#58; MarkerC and ALS; two-sided hypothesis. Secondary aim&#58; MarkerD and ALS; two-sided hypothesis. These aims were fixed on 2026-01-01 &#40;plan dda77735c666bc20d467e6f22fe1b09f2abb6c6ca9ebfb1f5b2339632a1bfcc4&#41; before the confirming data were analysed.

## Methods

### Prior knowledge

Frozen literature index: 7b563832c777f4f8940ffcb47498a9de435d4a3e8964000cc7b2fc413816f913. Previous data access: no. Prior analyses: 0.

### c1

Population&#58; Synthetic adults; exposure contrast&#58; MarkerA; units&#58; synthetic units; outcome&#58; ALS; summary measure&#58; odds ratio; horizon&#58; cross-sectional

adjusted for age, as fixed in the plan

The regression procedure uses the fitted linear contrast with HC2 variance adjustment, Bell–McCaffrey degrees of freedom and registered wild-bootstrap calibration. The registered statistic and locked decision rule determine the decision; narrative interpretation does not change that rule. Synthetic calibration guarantee. Seed&#58; synthetic-seed; resamples&#58; 99. References&#58; method-ref.

A two-sided test was specified.

### c2

Population&#58; Synthetic adults; exposure contrast&#58; MarkerB; units&#58; synthetic units; outcome&#58; ALS; summary measure&#58; odds ratio; horizon&#58; cross-sectional

adjusted for age, as fixed in the plan

The regression procedure uses the fitted linear contrast with HC2 variance adjustment, Bell–McCaffrey degrees of freedom and registered wild-bootstrap calibration. The registered statistic and locked decision rule determine the decision; narrative interpretation does not change that rule. Synthetic calibration guarantee. Seed&#58; synthetic-seed; resamples&#58; 99. References&#58; method-ref.

A two-sided test was specified.

### c3

Population&#58; Synthetic adults; exposure contrast&#58; MarkerC; units&#58; synthetic units; outcome&#58; ALS; summary measure&#58; odds ratio; horizon&#58; cross-sectional

adjusted for age, as fixed in the plan

The regression procedure uses the fitted linear contrast with HC2 variance adjustment, Bell–McCaffrey degrees of freedom and registered wild-bootstrap calibration. The registered statistic and locked decision rule determine the decision; narrative interpretation does not change that rule. Synthetic calibration guarantee. Seed&#58; synthetic-seed; resamples&#58; 99. References&#58; method-ref.

A two-sided test was specified.

### c4

Population&#58; Synthetic adults; exposure contrast&#58; MarkerD; units&#58; synthetic units; outcome&#58; ALS; summary measure&#58; odds ratio; horizon&#58; cross-sectional

adjusted for age, as fixed in the plan

The regression procedure uses the fitted linear contrast with HC2 variance adjustment, Bell–McCaffrey degrees of freedom and registered wild-bootstrap calibration. The registered statistic and locked decision rule determine the decision; narrative interpretation does not change that rule. Synthetic calibration guarantee. Seed&#58; synthetic-seed; resamples&#58; 99. References&#58; method-ref.

A two-sided test was specified.

### data-sources

Synthetic repository&#58; SYN001; release fixture-v1; SHA-256 cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc

### sample-size-power

sample-size-power&#58; fixed-secondary-sample.

### missing-data

missing-data&#58; complete-case.

### preprocessing-within-folds

preprocessing-within-folds&#58; within-training-folds.

### batch-handling

c1&#58; adjusted for age, as fixed in the plan; c2&#58; adjusted for age, as fixed in the plan; c3&#58; adjusted for age, as fixed in the plan; c4&#58; adjusted for age, as fixed in the plan

### feature-selection-within-folds

feature-selection-within-folds&#58; none.

### literature-search

Frozen literature index&#58; 7b563832c777f4f8940ffcb47498a9de435d4a3e8964000cc7b2fc413816f913.

### sex-and-ancestry

sex-and-ancestry&#58; recorded-strata.

### hardware

Execution architecture&#58; arm64; cores&#58; 8.

### runtime

Recorded runtime&#58; 123 milliseconds.

### data-fetching-checksums

Synthetic repository&#58; SYN001; release fixture-v1; SHA-256 cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc

### software-versions

R 4.3.1 &#40;R&#41;

### exploratory-analysis-count

Recorded exploratory analyses&#58; 3.

### exclusion-order

exclusion-order&#58; before-splitting.

### tie-breaking

tie-breaking&#58; stable-input-order.

### instrument-selection

instrument-selection&#58; not-an-instrument-study.

The operational account should be read alongside the scientific rationale. The distinction between a planned question and an account of its execution matters for interpreting the manuscript. Detailed procedural statements belong to the authenticated record and should be examined on those terms. Narrative explanation can orient the reader to that account without supplying additional procedural facts. Questions about the scope of interpretation remain separate from the description of the work.

See Verification and robustness analyses for the software checks.

### Use of AI systems

Omerta Bio used Synthetic Claude fixture-1.2 &#40;Anthropic; model-a&#41; for analysis, drafting; Synthetic Codex fixture-3.4 &#40;OpenAI; model-b&#41; for review. AI review rounds were not peer review. See the Methods GAMER table for stage-specific use and human roles.

| GAMER item | hypothesis | design-and-implementation | analysis-and-interpretation | writing |
| --- | --- | --- | --- | --- |
| Contribution tier | D&#58; at least 95% AI | D&#58; at least 95% AI | D&#58; at least 95% AI | D&#58; at least 95% AI |
| declaration | Omerta Bio; AI use is recorded by stage | Omerta Bio; AI use is recorded by stage | Omerta Bio; AI use is recorded by stage | Omerta Bio; AI use is recorded by stage |
| tool-and-version | Synthetic Claude fixture-1.2 &#40;Anthropic; model-a&#41; | Synthetic Claude fixture-1.2 &#40;Anthropic; model-a&#41; | Synthetic Claude fixture-1.2 &#40;Anthropic; model-a&#41; | Synthetic Claude fixture-1.2 &#40;Anthropic; model-a&#41;; Synthetic Codex fixture-3.4 &#40;OpenAI; model-b&#41; |
| prompting | Prompts are retained in the run log | Prompts are retained in the run log | Prompts are retained in the run log | Prompts are retained in the run log |
| role | Synthetic Claude fixture-1.2 &#40;Anthropic; model-a&#41;&#58; analysis, drafting; human&#58; Owner reviewed the recorded output | Synthetic Claude fixture-1.2 &#40;Anthropic; model-a&#41;&#58; analysis, drafting; human&#58; Owner reviewed the recorded output | Synthetic Claude fixture-1.2 &#40;Anthropic; model-a&#41;&#58; analysis, drafting; human&#58; Owner reviewed the recorded output | Synthetic Claude fixture-1.2 &#40;Anthropic; model-a&#41;&#58; analysis, drafting; Synthetic Codex fixture-3.4 &#40;OpenAI; model-b&#41;&#58; review; human&#58; Owner reviewed the recorded output |
| new-models | No new models were developed in this run | No new models were developed in this run | No new models were developed in this run | No new models were developed in this run |
| ai-assisted-sections | Assisted sections follow the recorded stages | Assisted sections follow the recorded stages | Assisted sections follow the recorded stages | Assisted sections follow the recorded stages |
| content-verification | Content was checked by deterministic software | Content was checked by deterministic software | Content was checked by deterministic software | Content was checked by deterministic software |
| data-privacy | Only public de-identified data were used | Only public de-identified data were used | Only public de-identified data were used | Only public de-identified data were used |
| impact-on-conclusions | The locked decision rule determines conclusions | The locked decision rule determines conclusions | The locked decision rule determines conclusions | The locked decision rule determines conclusions |

Synthetic Claude fixture-1.2 &#40;Anthropic; model-a&#41;; used&#58; 2026-01-02; training cutoff&#58; unavailable; cutoff after original publication&#58; unknown; recall probe&#58; No recall detected in synthetic probe

Synthetic Codex fixture-3.4 &#40;OpenAI; model-b&#41;; used&#58; 2026-01-03; training cutoff&#58; 2025-01-01; cutoff after original publication&#58; yes; recall probe&#58; Synthetic unknown

Every reported number was produced and checked by deterministic software. Author endorsement is pending.

## Results

### c1 &#40;pre-registered; 1 of 2 required checks passed; validation not established; tentative&#41;
odds ratio 1.42 &#40;95% CI 1.08 to 1.87; adjusted for age; n &#61; 4,210; p &#61; 0.05, adjusted for 4 tests; effective alpha &#61; 0.025&#41; [facts](sha256:458add5c17ac9d31c841289f7a01c74c2ef73b8277bc6fcdee4580897a97fcf9), [code](sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa), [certificate](sha256:d88b1f9e96bbe5167f98f84d72cc504b6d4f04181e8ab698a73f4ebef2a74972)
supported, but not every required check passed.

### c2 &#40;pre-registered; 1 of 2 required checks passed; validation not established; tentative&#41;
odds ratio 1.12 &#40;95% CI 0.96 to 1.21; adjusted for age; n &#61; 4,210; p &#61; 0.05, adjusted for 4 tests; effective alpha &#61; 0.025&#41; [facts](sha256:377e3f4130db761035e4917353493697ad75da25726e20b637770e6d60f19653), [code](sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa), [certificate](sha256:d88b1f9e96bbe5167f98f84d72cc504b6d4f04181e8ab698a73f4ebef2a74972)
supported, but not every required check passed.

### c3 &#40;pre-registered; 1 of 2 required checks passed; validation not established; tentative&#41;
odds ratio 1.12 &#40;95% CI 0.96 to 1.21; adjusted for age; n &#61; 4,210; p &#61; 0.05, adjusted for 4 tests; effective alpha &#61; 0.025&#41; [facts](sha256:ef603d8cc00fb6dde234c8b4a92b8bdbee5dc7bc02f94fdde768854ca7a68132), [code](sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa), [certificate](sha256:d88b1f9e96bbe5167f98f84d72cc504b6d4f04181e8ab698a73f4ebef2a74972)
supported, but not every required check passed.

### c4 &#40;pre-registered; 1 of 2 required checks passed; validation not established; tentative&#41;
odds ratio 1.12 &#40;95% CI 0.96 to 1.21; adjusted for age; n &#61; 4,210; p &#61; 0.05, adjusted for 4 tests; effective alpha &#61; 0.025&#41; [facts](sha256:66c9f93dbf8190f2ccd44496acd7b0d6d8abb73bfc99485a4e5056f8eb5df43d), [code](sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa), [certificate](sha256:d88b1f9e96bbe5167f98f84d72cc504b6d4f04181e8ab698a73f4ebef2a74972)
supported, but not every required check passed.

MarkerA and ALS&#58; The finding is tentative; required checks remain incomplete odds ratio 1.42 &#40;95% CI 1.08 to 1.87; adjusted for age; n &#61; 4,210; p &#61; 0.05, adjusted for 4 tests; effective alpha &#61; 0.025&#41; &#40;pre-registered; 1 of 2 required checks passed; validation not established; tentative&#41;. MarkerB and ALS&#58; The finding is tentative; required checks remain incomplete odds ratio 1.12 &#40;95% CI 0.96 to 1.21; adjusted for age; n &#61; 4,210; p &#61; 0.05, adjusted for 4 tests; effective alpha &#61; 0.025&#41; &#40;pre-registered; 1 of 2 required checks passed; validation not established; tentative&#41;. MarkerC and ALS&#58; The finding is tentative; required checks remain incomplete odds ratio 1.12 &#40;95% CI 0.96 to 1.21; adjusted for age; n &#61; 4,210; p &#61; 0.05, adjusted for 4 tests; effective alpha &#61; 0.025&#41; &#40;pre-registered; 1 of 2 required checks passed; validation not established; tentative&#41;. MarkerD and ALS&#58; The finding is tentative; required checks remain incomplete odds ratio 1.12 &#40;95% CI 0.96 to 1.21; adjusted for age; n &#61; 4,210; p &#61; 0.05, adjusted for 4 tests; effective alpha &#61; 0.025&#41; &#40;pre-registered; 1 of 2 required checks passed; validation not established; tentative&#41;.

## Verification and robustness analyses

MarkerA: 1 of 2 required checks passed &#40;not passed&#58; independently re-implemented &#40;a second AI system, from a different developer, re-analysed from the locked plan&#41;&#41;. Passing these checks does not establish biological importance or remove uncertainty.

MarkerB: 1 of 2 required checks passed &#40;not passed&#58; independently re-implemented &#40;a second AI system, from a different developer, re-analysed from the locked plan&#41;&#41;. Passing these checks does not establish biological importance or remove uncertainty.

MarkerC: 1 of 2 required checks passed &#40;not passed&#58; independently re-implemented &#40;a second AI system, from a different developer, re-analysed from the locked plan&#41;&#41;. Passing these checks does not establish biological importance or remove uncertainty.

MarkerD: 1 of 2 required checks passed &#40;not passed&#58; independently re-implemented &#40;a second AI system, from a different developer, re-analysed from the locked plan&#41;&#41;. Passing these checks does not establish biological importance or remove uncertainty.

## Analyses abandoned, and why

No abandoned analyses were recorded.

Programme-wide registered hypotheses&#58; 4.

## Discussion

Interpretation requires caution and an explicit distinction between an operational answer and a biological explanation. The central responsibility of this discussion is to keep the broader narrative proportionate to the question under consideration. Mechanistic plausibility can motivate further inquiry, but it cannot settle a question merely by making an account sound persuasive. A useful discussion should explain why uncertainty matters and where additional information might sharpen the conceptual account. It should remain readable even to a reader who does not share the investigator's initial intuition. The scientific motivation and the scope of interpretation deserve separate attention. A broad biological question may remain open after a narrower analytical question has been addressed. That distinction need not make the narrower question uninteresting. It does mean that the manuscript should give the reader enough context to judge what kind of explanation is being considered. An interpretation can be informative while leaving the practical meaning of an observation unresolved. The discussion should preserve that distinction throughout its account of the remaining questions. Competing explanations deserve consideration on their own terms. A preferred mechanism should not become the default merely because it is easy to describe or familiar to the reader. Further inquiry could ask which observations would distinguish different accounts and which would leave the disagreement intact. The choice of a future question may therefore require conceptual work before further empirical work begins. Making that possibility explicit helps communicate why repetition alone may not resolve the underlying uncertainty about mechanism and scope. The relevance of an explanation may also depend on the purpose for which it is being considered. A question about biological understanding is different from a question about practical action. The present discussion should not collapse those purposes into an implied recommendation. Readers need to see where additional reasoning would be required before moving between them. Maintaining that separation is a responsibility of scientific communication, particularly when a concise account is read without the surrounding operational detail or the full discussion of uncertainty. The limitations should remain visible when the manuscript is read outside its immediate research setting. An attractive narrative can encourage a reader to supply connections that remain open to question. The discussion should make those open connections explicit and describe them as questions for further consideration. It is appropriate to leave a mechanistic account incomplete when further information would be needed to evaluate it. That restraint can coexist with an explanation of why the broader biological question remains worth pursuing. A future programme of inquiry could consider whether different kinds of observations would clarify the relationship between description and explanation. Such a programme would need its own questions, its own operational account and a separate interpretation. Proposed work should be described prospectively so that the reader can distinguish an invitation to investigate from an account of work already completed. The closing perspective is therefore an invitation to examine unresolved questions carefully. Scientific communication is most useful here when it makes the remaining uncertainty intelligible and keeps the reasoning open to scrutiny. MarkerA and ALS&#58; The finding is tentative; required checks remain incomplete odds ratio 1.42 &#40;95% CI 1.08 to 1.87; adjusted for age; n &#61; 4,210; p &#61; 0.05, adjusted for 4 tests; effective alpha &#61; 0.025&#41; &#40;pre-registered; 1 of 2 required checks passed; validation not established; tentative&#41;.

Further work is needed to understand the mechanism.

## Limitations

<!-- protected:association sha256=40ccd8dde4301ae6035cc2798b232cf7c09dc4285f1c19a12e58e488ebc9a3df -->
Associational: no result here shows that an exposure changes an outcome.
<!-- endprotected:association -->
<!-- protected:confounding sha256=061a788ed5b66cb6ef8bb6ce6044e87c8c41ffc27d6edbd51bcbae76112368f3 -->
Unmeasured confounding is not addressed; results depend on the stated adjustment assumptions.
<!-- endprotected:confounding -->
<!-- protected:system sha256=7af6b699a7cbfd525067dcb7689268f1daa20e6cd6f4efc954821c08dbd607f6 -->
Software checks have limits; see the system methods and full system limitations in the supplement.
<!-- endprotected:system -->
<!-- protected:multiplicity sha256=310402492a06accf9b01d8927edf889f061338e13e1f04d5f9e879d317c8bc5f -->
The number of hypotheses previously tested on these data is not known.
<!-- endprotected:multiplicity -->
<!-- protected:failure-G7 sha256=33c4f914847dffa371d6d01355d4bc234893a67090ddc6596516bde758a39f11 -->
For MarkerA and ALS: The independently re-implemented (a second AI system, from a different developer, re-analysed from the locked plan) check was not completed successfully; its result remains unavailable. For MarkerB and ALS: The independently re-implemented (a second AI system, from a different developer, re-analysed from the locked plan) check was not completed successfully; its result remains unavailable. For MarkerC and ALS: The independently re-implemented (a second AI system, from a different developer, re-analysed from the locked plan) check was not completed successfully; its result remains unavailable. For MarkerD and ALS: The independently re-implemented (a second AI system, from a different developer, re-analysed from the locked plan) check was not completed successfully; its result remains unavailable.
<!-- endprotected:failure-G7 -->

- case definition and diagnostic criteria (MarkerA and ALS): Potential limitation: Differences in diagnostic criteria may change case classification. Sampling may vary. Possible direction: unknown. Could overturn the conclusion: unknown. Settling data: Additional observations are needed.
- control source (MarkerA and ALS): Potential limitation: The control source may not represent the intended comparison population. Sampling may vary. Possible direction: unknown. Could overturn the conclusion: unknown. Settling data: Additional observations are needed.
- cell composition (MarkerA and ALS): Potential limitation: Cell composition may affect the interpretation of biological measurements. Sampling may vary. Possible direction: unknown. Could overturn the conclusion: unknown. Settling data: Additional observations are needed.
- sampling frame (MarkerA and ALS): Potential limitation: The sampling frame may limit representativeness. Sampling may vary. Possible direction: unknown. Could overturn the conclusion: unknown. Settling data: Additional observations are needed.
- case definition and diagnostic criteria (MarkerB and ALS): Potential limitation: Differences in diagnostic criteria may change case classification. Sampling may vary. Possible direction: unknown. Could overturn the conclusion: unknown. Settling data: Additional observations are needed.
- control source (MarkerB and ALS): Potential limitation: The control source may not represent the intended comparison population. Sampling may vary. Possible direction: unknown. Could overturn the conclusion: unknown. Settling data: Additional observations are needed.
- cell composition (MarkerB and ALS): Potential limitation: Cell composition may affect the interpretation of biological measurements. Sampling may vary. Possible direction: unknown. Could overturn the conclusion: unknown. Settling data: Additional observations are needed.
- sampling frame (MarkerB and ALS): Potential limitation: The sampling frame may limit representativeness. Sampling may vary. Possible direction: unknown. Could overturn the conclusion: unknown. Settling data: Additional observations are needed.
- case definition and diagnostic criteria (MarkerC and ALS): Potential limitation: Differences in diagnostic criteria may change case classification. Sampling may vary. Possible direction: unknown. Could overturn the conclusion: unknown. Settling data: Additional observations are needed.
- control source (MarkerC and ALS): Potential limitation: The control source may not represent the intended comparison population. Sampling may vary. Possible direction: unknown. Could overturn the conclusion: unknown. Settling data: Additional observations are needed.
- cell composition (MarkerC and ALS): Potential limitation: Cell composition may affect the interpretation of biological measurements. Sampling may vary. Possible direction: unknown. Could overturn the conclusion: unknown. Settling data: Additional observations are needed.
- sampling frame (MarkerC and ALS): Potential limitation: The sampling frame may limit representativeness. Sampling may vary. Possible direction: unknown. Could overturn the conclusion: unknown. Settling data: Additional observations are needed.
- case definition and diagnostic criteria (MarkerD and ALS): Potential limitation: Differences in diagnostic criteria may change case classification. Sampling may vary. Possible direction: unknown. Could overturn the conclusion: unknown. Settling data: Additional observations are needed.
- control source (MarkerD and ALS): Potential limitation: The control source may not represent the intended comparison population. Sampling may vary. Possible direction: unknown. Could overturn the conclusion: unknown. Settling data: Additional observations are needed.
- cell composition (MarkerD and ALS): Potential limitation: Cell composition may affect the interpretation of biological measurements. Sampling may vary. Possible direction: unknown. Could overturn the conclusion: unknown. Settling data: Additional observations are needed.
- sampling frame (MarkerD and ALS): Potential limitation: The sampling frame may limit representativeness. Sampling may vary. Possible direction: unknown. Could overturn the conclusion: unknown. Settling data: Additional observations are needed.

## Data availability

Synthetic repository&#58; SYN001; release fixture-v1; CC0; SHA-256 cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc; public-deidentified

## Code availability

Bundle DOI&#58; 10.1234/synthetic; SHA-256 dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd; rerun&#58; run&#95;all.sh; open verifier&#58; bundled; fetch script SHA-256 eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee

## AI-use disclosure

Omerta Bio used Synthetic Claude fixture-1.2 &#40;Anthropic; model-a&#41; for analysis, drafting; Synthetic Codex fixture-3.4 &#40;OpenAI; model-b&#41; for review. AI review rounds were not peer review. See the Methods GAMER table for stage-specific use and human roles.

## Acknowledgments

The author acknowledges Synthetic Claude fixture-1.2 &#40;Anthropic; model-a&#41;; Synthetic Codex fixture-3.4 &#40;OpenAI; model-b&#41; for assistance through Omerta Bio. AI systems are not authors; their recorded roles and exact model identities are disclosed in Methods.

## Author contributions (CRediT)

Ethan Ashihundu&#58; Conceptualization; Project administration; Supervision; Validation; Writing – review &#38; editing

## Competing interests

Payments in the last 36 months&#58; No payments declared in the last 36 months. Omerta Bio commercial intent&#58; No commercial intent declared.

## Funding

No funding was received

## Ethics statement

Only openly available, de-identified data were analysed; no participants were contacted

## Research scope

Research use only; not a clinical recommendation

## References

&#91;1&#93; Smith; Jones &#40;2024&#41;. Drug treatment in a randomized trial. Nature Medicine. DOI&#58; 10.1234/trial; PMID&#58; 1234.

Ashihundu E. Omerta Bio &#40;version synthetic-0.1; commit aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&#41; &#91;software&#93;. 2026. DOI pending release; see this paper’s reproducibility package &#40;dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd&#41;.

R &#40;version 4.3.1; R&#41; &#91;software&#93;

## Supplement

### study-design

Recorded study-design evidence for the synthetic fixture.

### unadjusted-and-adjusted

Recorded unadjusted-and-adjusted evidence for the synthetic fixture.

### e-value

Recorded e-value evidence for the synthetic fixture.

### Deviations

| Amendment | Reason | After unblinding |
| --- | --- | --- |


### Changes to the introduction after results

The frozen Introduction is unchanged.

| Slot | Formula | Input fact IDs | Value |
| --- | --- | --- | --- |
| c1.n&#95;agree | identity | 3dc96e237e307addf4e20e13b1e764c2055e6beb813d395092d10d248b8e932f | 1 |
| c1.n&#95;total | identity | c2115b408e153eef3b03f7f8700619380d559991420fdcbb04d037246207f111 | 2 |
| c1.ci&#95;width | upper &#45; lower | 2819a8dc9684d3dd0e0c5da2ffd2d2d6be63c95ebe906a8a264e219eaf4b1342, 0b324b1cdc167046565eee69e7ad55bd7a65fa16fc9028515de5bdaf7a5133cf | 0.79 |
| c1.direction | direction&#40;lower, upper, null&#41; | 2819a8dc9684d3dd0e0c5da2ffd2d2d6be63c95ebe906a8a264e219eaf4b1342, 0b324b1cdc167046565eee69e7ad55bd7a65fa16fc9028515de5bdaf7a5133cf, cef31e5839399241f3e056030c0d3fb69b3ce148089a5f108132a813d741fb24 | higher |
| c1.magnitude | magnitude&#40;estimate, null, mei&#41; | 8e754f0aabb596f08b551ab54264306c66fb7d05988359bd9460598d92100fbe, cef31e5839399241f3e056030c0d3fb69b3ce148089a5f108132a813d741fb24, 917edcb28278ae7c7716ad6b33f5e2811b7cdc80210c626347045312151baf20 | at least the smallest effect of interest |
| c1.mei | identity | 917edcb28278ae7c7716ad6b33f5e2811b7cdc80210c626347045312151baf20 | 0.2 |
| c1.family&#95;size | identity | 7bedc3a1449f5f9dbf561eac5f965561d238b9ddd8e4be127314e66579aa9674 | 4 |
| c1.sens&#95;agree | identity | b5fd0b157aafa44bbf82fd62a8ba225dfcd6b24a92b11d991a1a67b03f5fd184 | 4 |
| c1.sens&#95;total | identity | 36d05554c428fbc1a09c565931d3536efdc5964d1d632ba15d8b1ef4a8dca003 | 6 |
| c1.power&#95;n | identity | 8f5c5385fb811373325bb399247d0d03d6fb3dd80441562bb2268518f14cd2e2 | 9000 |
| c1.expected&#95;false | family&#95;size &#42; alpha | 69382729781ce9f107e0dac333a5d11c6c939837e538fff4e7cdfbca69bf7605, 3d7d94f28d9ebb94a80a7aff3ed4e75d41701a2ab080144eb328f8478455fbd1 | 0.1 |
| c2.n&#95;agree | identity | 840e45f5649e62df537715be2b807b50da50fc18172c4a864172485b85ab8760 | 1 |
| c2.n&#95;total | identity | 5aa468830b76e6ce4a5d5d28d78a86e38af0e99fdb8b6bd11f7c6963dd54179b | 2 |
| c2.ci&#95;width | upper &#45; lower | f24c045c6f0573eb27f2b1022a4ef70ef99201189831ee9381986b30495d69f9, c0729df55ea8f9ab04292cce05fe9053353f1c47f66606d3c22109f7fd5eeafe | 0.25 |
| c2.direction | direction&#40;lower, upper, null&#41; | f24c045c6f0573eb27f2b1022a4ef70ef99201189831ee9381986b30495d69f9, c0729df55ea8f9ab04292cce05fe9053353f1c47f66606d3c22109f7fd5eeafe, bf19b3bde5d0717a33f8b52d23a33d47df067ce93ad28b3944ec63a3fc9b4140 | no clear difference |
| c2.magnitude | magnitude&#40;estimate, null, mei&#41; | d1de709e5f302848b751aa4d859bdaf055e04b7b0a33ee94ec83b9639b24a179, bf19b3bde5d0717a33f8b52d23a33d47df067ce93ad28b3944ec63a3fc9b4140, bb34a0547df66d6925a13fe3d0a8a1e5e792dddcc1dc4d6352659db0546f2e07 | below the smallest effect of interest |
| c2.mei | identity | bb34a0547df66d6925a13fe3d0a8a1e5e792dddcc1dc4d6352659db0546f2e07 | 0.2 |
| c2.family&#95;size | identity | ff436f240b98ac2e1705ac77cd8750c71c3d675ce711f82eb881c5257fc1a534 | 4 |
| c2.sens&#95;agree | identity | 9e8c569dae21be5a3756ffd056eeb12a1c0b3a602f31233550a293dcc0ffa1d7 | 4 |
| c2.sens&#95;total | identity | cd7db30d2ffca1c7c4b7a2839f2371ba2dd6d5332903d0c43d8db9500979cbd7 | 6 |
| c2.power&#95;n | identity | 8ae43ea095c37e44a9e5018edee051a46c462389ee37729001e19167ce1f8899 | 9000 |
| c2.expected&#95;false | family&#95;size &#42; alpha | 6c0f295cd86f7c4293ea925120cd6385b6d0d471ebcd52515dfd0e1f3c99c067, 08d5cb3b53ce9db8bab14c2c036aa7f5010f9e05288921d7a1dd38ff6fc9c889 | 0.1 |
| c3.n&#95;agree | identity | 240c9b0f94eff1ed6a5cbc883cbbc6d8c915fa1154d886619e4703154d2d3f27 | 1 |
| c3.n&#95;total | identity | bb9c10fe29fc4e0018277da9a09d03d067b0dc5425afcbc13362a53da49140df | 2 |
| c3.ci&#95;width | upper &#45; lower | 26cf23e9bb56bf8a36e47fda243f294be0f1ac99a3ff4b947fd8e22ecc461bdb, 246cd7a71b9cd89d14f69758833ce85d0a74a8f24a6574cc6ced36aa1de24875 | 0.25 |
| c3.direction | direction&#40;lower, upper, null&#41; | 26cf23e9bb56bf8a36e47fda243f294be0f1ac99a3ff4b947fd8e22ecc461bdb, 246cd7a71b9cd89d14f69758833ce85d0a74a8f24a6574cc6ced36aa1de24875, d667fbf72c55c119155d3e1aa885e5c54e5d1cd9746af5b9baaeb6faf3b2fb5a | no clear difference |
| c3.magnitude | magnitude&#40;estimate, null, mei&#41; | 78a64d42aea40416015216a906bcbb9e6210ccd353d71f3423cbd3660c3306b2, d667fbf72c55c119155d3e1aa885e5c54e5d1cd9746af5b9baaeb6faf3b2fb5a, 12741771910687fc6a20ce76f9dde27b72c625ba71d6a38875ccac4685e7b887 | below the smallest effect of interest |
| c3.mei | identity | 12741771910687fc6a20ce76f9dde27b72c625ba71d6a38875ccac4685e7b887 | 0.2 |
| c3.family&#95;size | identity | 4867b33ac506574779ff9aea14f67c938bbe0e070ffa6fe546921f53f818e6aa | 4 |
| c3.sens&#95;agree | identity | 52ed9343b8ce09012b245452e18dc3ae752fdf94587818256e5c2d52e0751360 | 4 |
| c3.sens&#95;total | identity | 13709a50cdcedcf9aebf85b8aa3633611ae7c3e6cdfcc32e181d97682cd5df62 | 6 |
| c3.power&#95;n | identity | 9054d99a02c77182ebca7767e6f52d11d592a23deda7a222f63c4ac66202c320 | 9000 |
| c3.expected&#95;false | family&#95;size &#42; alpha | 5c89abdb659c220a059f6bb803d4f936dc519d6b37cbc26ae2d9cbaf1a1e6428, 9c5df923aa96f11ebb04275becbc1cee288dcf3bdec4e33953e3906d37e13505 | 0.1 |
| c4.n&#95;agree | identity | 58ce22c02e707560906d1238ca449314f9a66560e9241b95ce2c6ac9cb6b0394 | 1 |
| c4.n&#95;total | identity | 3cbe4b5a07dab798fc0d703881b12b82b158a1c52a6227f138952065c8179904 | 2 |
| c4.ci&#95;width | upper &#45; lower | b942407a748af6ee7269b6ae030baf7dcc32b71873a5df1dc7962d9a823153c8, f5758a59db4f923d50b67a10b8397168bef4c2cb2ad765d05427d306c9816749 | 0.25 |
| c4.direction | direction&#40;lower, upper, null&#41; | b942407a748af6ee7269b6ae030baf7dcc32b71873a5df1dc7962d9a823153c8, f5758a59db4f923d50b67a10b8397168bef4c2cb2ad765d05427d306c9816749, b6c6744dd7cfbdde493a7ad6da06055d2abd6c86575153b904c5a24fe744b4f8 | no clear difference |
| c4.magnitude | magnitude&#40;estimate, null, mei&#41; | 1dd26693b1c6bd61a8046a403785744d2e91ee0c39738e19c28ae3ae0085b8f9, b6c6744dd7cfbdde493a7ad6da06055d2abd6c86575153b904c5a24fe744b4f8, 24452f1c78b99dcc1be99e53b4a66d53c2e3d56a0a24c24b88f8006e207433d6 | below the smallest effect of interest |
| c4.mei | identity | 24452f1c78b99dcc1be99e53b4a66d53c2e3d56a0a24c24b88f8006e207433d6 | 0.2 |
| c4.family&#95;size | identity | 79801de75b20e7d7d1e2b45dab37ce3e983f6af0b701672c6aa5fb6a6dd1a683 | 4 |
| c4.sens&#95;agree | identity | 135cd488e61958a24d08c49c3779a81f434e057eb5a06868b6c45947c89007e4 | 4 |
| c4.sens&#95;total | identity | 08ebdf73b799348d72a743fcf902c50145561cbd903b29f8b2fb428fa264d3bd | 6 |
| c4.power&#95;n | identity | e5a6580cea84af1c146c8a896ddd33702e6ff65247b67f1e86d45e647af92509 | 9000 |
| c4.expected&#95;false | family&#95;size &#42; alpha | 3ee40e797c8f674cdd29e6ccbb125e66bcda337bcd636ff3d251141b34ecef79, 3d6c4d7cc114a86ad349097a8406cb5e435f2ad6b3dea7a4c9067d9023f0e1f8 | 0.1 |
| manifest.0.accessClass | identity | a20a1f2671fac881a8392ebefd90bc0c2737e128feb27602b5eacae1e38bdfd4 | public-deidentified |
| manifest.0.licence | identity | a107e62d3e31f87728702ee534618359d49c66e6c8995eb24b793dedcfd720d5 | CC0 |
| manifest.0.release | identity | b3ac8e0001708fa2b9364b61a44549306e94ceece583cda7f8515eaf4560ccbc | fixture-v1 |

### STROBE

Study design in the abstract&#58; cohort.

The scientific background motivated testing the hypothesis recorded before data access.

The pre-specified objective was to examine MarkerA in relation to ALS. The pre-specified objective was to examine MarkerB in relation to ALS. The pre-specified objective was to examine MarkerC in relation to ALS. The pre-specified objective was to examine MarkerD in relation to ALS.

This was an observational cohort study.

Population&#58; Synthetic adults; exposure contrast&#58; MarkerA; units&#58; synthetic units; outcome&#58; ALS; summary measure&#58; odds ratio; horizon&#58; cross-sectional. Population&#58; Synthetic adults; exposure contrast&#58; MarkerB; units&#58; synthetic units; outcome&#58; ALS; summary measure&#58; odds ratio; horizon&#58; cross-sectional. Population&#58; Synthetic adults; exposure contrast&#58; MarkerC; units&#58; synthetic units; outcome&#58; ALS; summary measure&#58; odds ratio; horizon&#58; cross-sectional. Population&#58; Synthetic adults; exposure contrast&#58; MarkerD; units&#58; synthetic units; outcome&#58; ALS; summary measure&#58; odds ratio; horizon&#58; cross-sectional.

Synthetic repository&#58; SYN001; release fixture-v1; SHA-256 cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc

The available secondary dataset determined the sample size; no prospective power calculation was used.

The regression procedure uses the fitted linear contrast with HC2 variance adjustment, Bell–McCaffrey degrees of freedom and registered wild-bootstrap calibration. The registered statistic and locked decision rule determine the decision; narrative interpretation does not change that rule. Synthetic calibration guarantee. Seed&#58; synthetic-seed; resamples&#58; 99. References&#58; method-ref. The regression procedure uses the fitted linear contrast with HC2 variance adjustment, Bell–McCaffrey degrees of freedom and registered wild-bootstrap calibration. The registered statistic and locked decision rule determine the decision; narrative interpretation does not change that rule. Synthetic calibration guarantee. Seed&#58; synthetic-seed; resamples&#58; 99. References&#58; method-ref. The regression procedure uses the fitted linear contrast with HC2 variance adjustment, Bell–McCaffrey degrees of freedom and registered wild-bootstrap calibration. The registered statistic and locked decision rule determine the decision; narrative interpretation does not change that rule. Synthetic calibration guarantee. Seed&#58; synthetic-seed; resamples&#58; 99. References&#58; method-ref. The regression procedure uses the fitted linear contrast with HC2 variance adjustment, Bell–McCaffrey degrees of freedom and registered wild-bootstrap calibration. The registered statistic and locked decision rule determine the decision; narrative interpretation does not change that rule. Synthetic calibration guarantee. Seed&#58; synthetic-seed; resamples&#58; 99. References&#58; method-ref.

missing-data&#58; complete-case.

MarkerA and ALS&#58; The finding is tentative; required checks remain incomplete odds ratio 1.42 &#40;95% CI 1.08 to 1.87; adjusted for age; n &#61; 4,210; p &#61; 0.05, adjusted for 4 tests; effective alpha &#61; 0.025&#41; &#40;pre-registered; 1 of 2 required checks passed; validation not established; tentative&#41;. MarkerB and ALS&#58; The finding is tentative; required checks remain incomplete odds ratio 1.12 &#40;95% CI 0.96 to 1.21; adjusted for age; n &#61; 4,210; p &#61; 0.05, adjusted for 4 tests; effective alpha &#61; 0.025&#41; &#40;pre-registered; 1 of 2 required checks passed; validation not established; tentative&#41;. MarkerC and ALS&#58; The finding is tentative; required checks remain incomplete odds ratio 1.12 &#40;95% CI 0.96 to 1.21; adjusted for age; n &#61; 4,210; p &#61; 0.05, adjusted for 4 tests; effective alpha &#61; 0.025&#41; &#40;pre-registered; 1 of 2 required checks passed; validation not established; tentative&#41;. MarkerD and ALS&#58; The finding is tentative; required checks remain incomplete odds ratio 1.12 &#40;95% CI 0.96 to 1.21; adjusted for age; n &#61; 4,210; p &#61; 0.05, adjusted for 4 tests; effective alpha &#61; 0.025&#41; &#40;pre-registered; 1 of 2 required checks passed; validation not established; tentative&#41;.

The findings warrant caution&#58; an observational association does not establish causality.

External validity is restricted to the source population; extension to other settings remains uncertain.

Funding&#58; No funding was received.

| Item | Anchor | Section | Sentence | Verbatim excerpt | Status |
| --- | --- | --- | --- | --- | --- |
| STROBE 1a | item-1a | abstract | item-1a | Study design in the abstract&#58; cohort. | software |
| STROBE 1b |  |  |  | owner-supplied / not verified | needs-owner |
| STROBE 2 | item-2 | checklist-STROBE | item-2 | The scientific background motivated testing the hypothesis recorded before data access. | software |
| STROBE 3 | item-3 | checklist-STROBE | item-3 | The pre-specified objective was to examine MarkerA in relation to ALS. The pre-specified objective was to examine MarkerB in relation to ALS. The pre-specified objective was to examine MarkerC in relation to ALS. The pre-specified objective was to examine MarkerD in relation to ALS. | software |
| STROBE 4 | item-4 | checklist-STROBE | item-4 | This was an observational cohort study. | software |
| STROBE 5 |  |  |  | owner-supplied / not verified | needs-owner |
| STROBE 6a |  |  |  | owner-supplied / not verified | needs-owner |
| STROBE 6b |  |  |  | owner-supplied / not verified | needs-owner |
| STROBE 7 | item-7 | checklist-STROBE | item-7 | Population&#58; Synthetic adults; exposure contrast&#58; MarkerA; units&#58; synthetic units; outcome&#58; ALS; summary measure&#58; odds ratio; horizon&#58; cross-sectional. Population&#58; Synthetic adults; exposure contrast&#58; MarkerB; units&#58; synthetic units; outcome&#58; ALS; summary measure&#58; odds ratio; horizon&#58; cross-sectional. Population&#58; Synthetic adults; exposure contrast&#58; MarkerC; units&#58; synthetic units; outcome&#58; ALS; summary measure&#58; odds ratio; horizon&#58; cross-sectional. Population&#58; Synthetic adults; exposure contrast&#58; MarkerD; units&#58; synthetic units; outcome&#58; ALS; summary measure&#58; odds ratio; horizon&#58; cross-sectional. | software |
| STROBE 8 | item-8 | checklist-STROBE | item-8 | Synthetic repository&#58; SYN001; release fixture-v1; SHA-256 cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc | software |
| STROBE 9 |  |  |  | owner-supplied / not verified | needs-owner |
| STROBE 10 | item-10 | checklist-STROBE | item-10 | The available secondary dataset determined the sample size; no prospective power calculation was used. | software |
| STROBE 11 |  |  |  | owner-supplied / not verified | needs-owner |
| STROBE 12a | item-12a | checklist-STROBE | item-12a | The regression procedure uses the fitted linear contrast with HC2 variance adjustment, Bell–McCaffrey degrees of freedom and registered wild-bootstrap calibration. The registered statistic and locked decision rule determine the decision; narrative interpretation does not change that rule. Synthetic calibration guarantee. Seed&#58; synthetic-seed; resamples&#58; 99. References&#58; method-ref. The regression procedure uses the fitted linear contrast with HC2 variance adjustment, Bell–McCaffrey degrees of freedom and registered wild-bootstrap calibration. The registered statistic and locked decision rule determine the decision; narrative interpretation does not change that rule. Synthetic calibration guarantee. Seed&#58; synthetic-seed; resamples&#58; 99. References&#58; method-ref. The regression procedure uses the fitted linear contrast with HC2 variance adjustment, Bell–McCaffrey degrees of freedom and registered wild-bootstrap calibration. The registered statistic and locked decision rule determine the decision; narrative interpretation does not change that rule. Synthetic calibration guarantee. Seed&#58; synthetic-seed; resamples&#58; 99. References&#58; method-ref. The regression procedure uses the fitted linear contrast with HC2 variance adjustment, Bell–McCaffrey degrees of freedom and registered wild-bootstrap calibration. The registered statistic and locked decision rule determine the decision; narrative interpretation does not change that rule. Synthetic calibration guarantee. Seed&#58; synthetic-seed; resamples&#58; 99. References&#58; method-ref. | software |
| STROBE 12b |  |  |  | owner-supplied / not verified | needs-owner |
| STROBE 12c | item-12c | checklist-STROBE | item-12c | missing-data&#58; complete-case. | software |
| STROBE 12d |  |  |  | owner-supplied / not verified | needs-owner |
| STROBE 12e |  |  |  | owner-supplied / not verified | needs-owner |
| STROBE 13a |  |  |  | owner-supplied / not verified | needs-owner |
| STROBE 13b |  |  |  | owner-supplied / not verified | needs-owner |
| STROBE 13c |  |  |  | owner-supplied / not verified | needs-owner |
| STROBE 14a |  |  |  | owner-supplied / not verified | needs-owner |
| STROBE 14b |  |  |  | owner-supplied / not verified | needs-owner |
| STROBE 14c |  |  |  | owner-supplied / not verified | needs-owner |
| STROBE 15 |  |  |  | owner-supplied / not verified | needs-owner |
| STROBE 16a |  |  |  | owner-supplied / not verified | needs-owner |
| STROBE 16b |  |  |  | owner-supplied / not verified | needs-owner |
| STROBE 16c |  |  |  | owner-supplied / not verified | needs-owner |
| STROBE 17 |  |  |  | owner-supplied / not verified | needs-owner |
| STROBE 18 | item-18 | checklist-STROBE | item-18 | MarkerA and ALS&#58; The finding is tentative; required checks remain incomplete odds ratio 1.42 &#40;95% CI 1.08 to 1.87; adjusted for age; n &#61; 4,210; p &#61; 0.05, adjusted for 4 tests; effective alpha &#61; 0.025&#41; &#40;pre-registered; 1 of 2 required checks passed; validation not established; tentative&#41;. MarkerB and ALS&#58; The finding is tentative; required checks remain incomplete odds ratio 1.12 &#40;95% CI 0.96 to 1.21; adjusted for age; n &#61; 4,210; p &#61; 0.05, adjusted for 4 tests; effective alpha &#61; 0.025&#41; &#40;pre-registered; 1 of 2 required checks passed; validation not established; tentative&#41;. MarkerC and ALS&#58; The finding is tentative; required checks remain incomplete odds ratio 1.12 &#40;95% CI 0.96 to 1.21; adjusted for age; n &#61; 4,210; p &#61; 0.05, adjusted for 4 tests; effective alpha &#61; 0.025&#41; &#40;pre-registered; 1 of 2 required checks passed; validation not established; tentative&#41;. MarkerD and ALS&#58; The finding is tentative; required checks remain incomplete odds ratio 1.12 &#40;95% CI 0.96 to 1.21; adjusted for age; n &#61; 4,210; p &#61; 0.05, adjusted for 4 tests; effective alpha &#61; 0.025&#41; &#40;pre-registered; 1 of 2 required checks passed; validation not established; tentative&#41;. | software |
| STROBE 19 |  |  |  | owner-supplied / not verified | needs-owner |
| STROBE 20 | item-20 | checklist-STROBE | item-20 | The findings warrant caution&#58; an observational association does not establish causality. | software |
| STROBE 21 | item-21 | checklist-STROBE | item-21 | External validity is restricted to the source population; extension to other settings remains uncertain. | software |
| STROBE 22 | item-22 | checklist-STROBE | item-22 | Funding&#58; No funding was received. | software |

| Sentence | Citation | Status | Evidence span and context | Owner |
| --- | --- | --- | --- | --- |
| The treatment reduced disease progression among adult patients in the trial. | doi:10.1234/trial | fulltext-verified | [results] The treatment reduced disease progression among adult patients in the trial. | pass |
