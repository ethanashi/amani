# Final review round: structural result ownership

The final coordinator decision supersedes the round-three permission to write
free prose in every region. Results belong to software; narrative remains free
within explicit context regions. The earlier review files record historical runs.

## Changes and regression coverage

| Requirement | Implementation | Regression evidence |
| --- | --- | --- |
| Generated-only result regions | `boundaries.ts`, called from public binding; explicit abstract and plain-summary subregions | `round4-structure`, `round4-partials`; every result region has two independent free-prose probes |
| Result frames and plan aliases | First-person, definite result references, names, synonyms, abbreviations and symbols; no hedge-based exemption for a result frame | `round4-structure`, `round4-partials`, review repro corpus |
| Plan noun phrases | Exposure, outcome, adjustment, justification, exclusions and control source resolve to PW0 names or pinned noun phrases before interpolation | `round4-plan`: 24 regression failures before fix, all pass after; independent noun-registry probes |
| Procedure producers | Standalone `proc` slots; no trailing hedge/method exemption; procedure facts cannot be laundered through a quote | `round4-narrative`, `round4-structure`; registration, validation, exclusions, adjustment, sidedness, control source and archive probes |
| Unicode and atomic values | Default-ignorables refused before lexical normalization; all resolved numeric values and v/r slots get atomic checks; closed adjacent-token policy | `round4-technical`: 24 failures before fix; isolated slot-neighbour probes |
| Honest narrative | Vague quantities and multiple imputation allowed; generic hedged Limitations class; plan-entity measurement requires a slot; ancillary measurement remains free | Fresh independent corpus and `round4-narrative` |
| Surviving mutations | Division decoration, signed modifiers, exact lowercase hexadecimal archive hash; earlier Roman/script/URL/markup/formatter/digest guards retained | `round4-technical`, `round4-partials`, historical isolated tests, kill table |

The fresh honest corpus is written from biomedical manuscript conventions in
`build-round4-corpus.py`. It does not read renderer source or template lists and
contains no claim-template requests. It contains narrative Methods, Introduction,
Discussion, Limitations, plain-summary context, abstract context and cited prose.
Result-region restrictions are tested independently with generated claim requests
and free-prose attacks. All fixtures are synthetic.

## Corpus coverage and reproducibility

`test/corpus/round4-review-extract.json` pins the supplied verification file's SHA-256
and records every explicitly quoted sentence repro extracted from its defects.
The file **does not contain complete 50-sentence or 76-attack row sets**. It gives
11 exact main-set honest sentences, all included here, and seven exact supplementary
honest sentences, also included. The other 39 main-set honest sentences cannot be
replayed verbatim from the supplied file. The free-prose lens gives 55 quoted repro
occurrences (53 distinct strings); all are included. We do not claim to have
reconstructed the missing A01–Bxx rows.

The new attack corpus contains those quoted repros, procedure/plan/Unicode repros,
and explicit additional region variants. All 241 historical attack rows remain
in the denominator. The bare `[claim:c1].` quoted as an invocation in a plan-field
exploit is represented with its malicious plan fields, not misclassified as an
attack on an otherwise valid context.

Run `nice -n 10 node packages/omb-report/scripts/corpus-report.ts` to regenerate
`corpus-results.json`. Every refusal and every rendered residual is stored there.
Both acceptance rates use the complete respective denominator, including intended
refusals and historical cases whose policy has changed.

## Known gaps and integration contract

- Free prose is not a proof of semantic correctness. An arbitrary unseen synonym,
  pronoun construction or unsupported ancillary procedural fact can still need
  review. Remaining free-prose risk is covered by the **PW7 spin-judge panel and
  the owner's endorsement lock**. Those are downstream required integrations,
  not checks implemented or claimed to have passed by this package.
- The three rendered historical attacks concern LDL/DM/CD ancillary measurements
  outside the synthetic plan. The final policy deliberately permits these. Moving
  such a name into the plan's exposure/outcome/covariate registry makes it subject
  to the claim/procedure boundary. This does not certify ancillary facts as true.
- Plan labels outside the frozen registry refuse, even if linguistically innocent.
  Hosts must supply approved noun names through PW0. The common fallback registry
  is deliberately small; this package does not infer arbitrary noun phrases.
- A numeric slot cannot acquire a typed unit, including in a literature sentence.
  Published unit-bearing values need a software producer with the correct display.
- `renderReport.summary` retains the strict result-only `plain-summary` contract.
  Context prose can be rendered separately through `plain-summary-context`.
  Conversion/layout orchestration must preserve region identities; changing a
  heading in free text does not change a region's authorization.
- The full root suite was not rerun for this final round, whose requested root
  check is typecheck. The historical root-suite failures and successful isolated
  retries remain recorded honestly in `ROOT-VALIDATION.md`.

Final validation results are recorded below.

## Honest refusals and rendered attack residuals

Honest corpus: **130/134 rendered (97.01%)**. Every refusal is included in the rate:

| Sentence | Reason |
| --- | --- |
| Table 1 summarizes baseline characteristics of the cohort. | Typed number; table references need a software producer. |
| Participants who completed follow-up resembled those who did not in most baseline respects. | Free prose was supplied to Results, now a generated-only region. |
| Our observations are compatible with several mechanisms. | Evaluation of this study's observations needs a claim token, even when hedged. |
| Other studies have linked plasma markers to disease risk. | A literature assertion needs a frozen-library citation. |

Adversarial corpus: **436/439 refused (99.32%)**. These three render and remain in
the denominator rather than being deleted as inconvenient historical cases:

| ID | Rendered text | Explanation |
| --- | --- | --- |
| R3A014 | LDL was not measured. | LDL is not an exposure, outcome or covariate in the synthetic plan. |
| R3A015 | DM and CD were recorded. | Neither acronym is a study-plan entity in this fixture. |
| R4A073 | Serum LDL was assayed in fasting samples. | Ancillary measurement allowed by final policy; no factual certification is implied. |

The 198 new round-four attack cases refuse 197/198 (99.49%). The single rendered
round-four case is R4A073 above. All original corpus files and repro provenance
remain auditable alongside the expanded catalog.

## Final-round validation

| Check | Result | Runtime |
| --- | --- | --- |
| omb-report | 1,700 passed; zero skipped | 2.21 s |
| omb-paper | 136 passed; zero skipped | 8.01 s |
| Fresh independent honest corpus | 130/134 rendered (97.01%) | included |
| Adversarial corpus, including historical repros | 436/439 refused (99.32%) | included |
| Root typecheck after mutation restoration | passed | 3.68 s wall time |
| Root suite | not rerun this round; previous failed run retained in ROOT-VALIDATION.md | — |

| Mutation group | Killed | Total | Invalid |
| --- | --- | --- | --- |
| Retained core/round-one guards | 73 | 73 | 0 |
| Round-two guards | 64 | 64 | 0 |
| Round-three guards | 63 | 63 | 0 |
| Round-four structural guards | 52 | 52 | 0 |
| **Total** | **252** | **252** | **0** |

The final run killed **100%** of the directed mutants. The first run had three
survivors hidden by earlier refusals; each now has two independent boundary probes.
Every source was restored after each mutation. `MUTATION-KILL-TABLE.md` gives the
per-mutant killing tests. The mutation campaign takes minutes; each ordinary
package suite remains below the required ten seconds.
