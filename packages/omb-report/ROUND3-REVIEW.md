# Round 3 review resolution

The round-two 62-sentence acceptance claim did not measure general drafting:
it largely repeated the authorized sentence list. It is superseded by the
independent corpus in `test/corpus/honest.json`. Its authoring script contains
manually written synthetic biomedical sentences and never reads renderer sources.
No held-out or real patient data were used.

## Current drafting boundary

- A claim request is `[claim:c1].`, with an optional `CONNECTIVES` prefix.
  Software supplies the predicate, hedge, bundle, and referee label. A sentence
  mentioning both the exposure and outcome, or asserting a result about a study
  entity, cannot use that mention as a free predicate slot. Copular predicates
  about study entities also bind when their adjective is unfamiliar; neutral
  topic/mention frames remain available.
- Other narrative is free text across regions. There is no English dictionary or
  exact-sentence authorization list. Numeric, grammar, entity-binding, literature,
  protected-region and repetition checks remain. Neutral Methods outcome mentions
  and hypothetical context do not automatically become claim sentences.
- Literature may appear in Discussion and other regions. It must reproduce the canonical text of a
  frozen source quote with a verified status and approved sentence hash, must not
  insert result slots, and must not present the quote as this study's finding.
  Exploratory entities remain excluded from the blind Introduction/Background.
- `[proc:c1.sidedness]`, `.measurement`, `.adjustment`, `.exclusions`,
  `.controls-source`, `.registration`, `.validation`, and `.archiving` request
  software procedure statements. Each is a complete sentence request. Plan
  statements explicitly say what the plan specifies; they do not certify execution.
  Missing exclusions/control source/archive evidence refuses. Archive statements
  require a completed provenance record and digest. No completed validation result
  is not stated as proof that validation data did not exist. Validation/archive
  procedure slots cannot disclose post-analysis information in blind prose.
- Plan exposure/outcome/adjustment/one-sided justification are validated before
  interpolation. They are plain fragments, cannot contain sentence punctuation,
  markup, predicates, quantities or result assertions. Estimands use a closed
  measure list. Lock ordering selects pre-registered versus post hoc wording in
  both the outcome and label.
- Numeric slots are atomic. Drafter-supplied units and numerical modifiers cannot
  relabel raw counts as people. Final sentence numbers are audited in source order.
  Numeric-looking metadata (including Arabic/Devanagari digits, count words and
  decorated numbers) is derived, except explicit identifier/date/hash/URL formats.
- Text is normalized before checking and canonical values are emitted. Invisible
  fillers and controls refuse; noncanonical confusable characters refuse. ASCII
  prose is not silently rewritten through the confusable skeleton. NFKC-compatible
  letters become canonical letters. Skeletons remain additional lexical checks.
- Part B still uses closed uncertainty/settling choices and now adds a
  checklist-specific uncertainty statement. Factual bias choices are removed.
  Direction is unknown without a certified producer. Unsupported no-overturn and
  non-applicability claims also refuse.

## Review evidence and regression mapping

| Review evidence | Regression coverage |
| --- | --- |
| Plan interpolation attacks (all eight supplied variants) | `round3-plan`, expanded adversarial corpus |
| Fact/status-blind procedure strings | `round3-narrative`, expanded adversarial corpus |
| Pre-registration versus post hoc mismatch | `round3-plan`: confirmed/refuted, late/unplanned |
| Unicode numeric and count-bearing metadata | PW0 `derivations`, expanded adversarial corpus |
| Braille blank, Hangul fillers, C0 controls, compatibility letters | `round3-plan`, `round2-normalise` |
| Unknown-adjective predicates about study entities | `round3-narrative`, expanded adversarial corpus |
| Honest prose and Discussion citations | independent 130-sentence corpus; `round3-narrative` |
| Data-slot noun relabelling | expanded adversarial corpus; numeric modifier tests |
| Part B direction and unsupported factual bias | `round3-narrative`, `round2-limitations` |
| Roman cue/unit/case/normalization branches | `round3-partials`: two probes per branch |
| Mixed scripts, URL branches, markup, brackets, split boundaries | `round3-partials` |
| Formatter validators, safe look sequence, digest budgets | `round3-partials`, `round2-partial` |
| Gate plain twins and normalized repetition | existing `round2-limitations`, `round2-guards` |

## Independent acceptance and refusal policy

126/130 independent sentences render (96.92%). The four retained refusals are:

| Sentence | Reason and required rewrite |
| --- | --- |
| We enrolled adults aged 18 to 65 years. | Typed quantities; obtain certified numeric slots. |
| Confidence intervals are 95% intervals. | Typed number/percent; use the formatted result bundle. |
| The analysis was adjusted for age and sex. | Unsupported procedure assertion; use `.adjustment`, which prints the actual locked covariates. |
| Participants were excluded if their data were incomplete. | Unsupported exclusion assertion; use `.exclusions` only with the locked criteria. |

These refusals count against acceptance. The corpus does not establish universal
semantic classification. It covers the listed cases, including ordinary Methods,
Limitations, cited Discussion, structured abstract headings and summary context.
Ambiguous quantitative expressions remain conservative refusals. “First,” as a
sentence transition and temporal “Once the…” are not counts; a factual assertion
about lock timing still needs the registration procedure. “First author” remains
unavailable as author-generated prose without a protected producer.

## Mutation accounting

`round3-mutants.json` is the pinned run catalog. Source-site mismatches fail the
runner. `round3-retired-mutants.json` records 15 replaced source-policy sites;
removed whole-English/exact-procedure policies are not resurrected merely to keep
old mutants. Their replacements cover free-prose, procedure, and normalization
boundaries. Direct guard tests isolate redundant checks, so another refusal cannot
hide a deleted branch. Raw uppercase-only confusable skeleton probes exercise the Roman case flag
independently of the earlier display-normalization refusal. Timeout, import failure, skipped baseline, and missing tests
are unavailable, never a kill. See the final kill table for actual outcomes.

## Limits

These deterministic checks are syntactic and lexical, not a proof of arbitrary
English semantics. Context, domain and spin review are still needed; the corpus
is finite and synthetic. Procedure records are supplied through authenticated PW0,
not trusted because a model supplies a digest. Production registry packs, final
artifact signatures/conversion, and additional procedure producers remain separate
integration work. A missing producer is an explicit refusal, never success.

## Final validation

| Check | Result | Runtime |
| --- | --- | --- |
| omb-report | 1,214 passed; zero skipped | 1.95 s |
| omb-paper | 136 passed; zero skipped | 6.31 s |
| Independent honest corpus | 126/130 rendered (96.92%); four refusals listed above | included |
| Adversarial corpus | 241/241 refused (100%) | included |
| Root typecheck | passed after mutation restoration | — |
| Root suite | failed: 2 tests and a worker timeout; 15 skipped | 158.52 s |

| Mutation group | Killed | Total | Invalid |
| --- | --- | --- | --- |
| Retained core/round-one guards | 74 | 74 | 0 |
| Round-two guards | 64 | 64 | 0 |
| Round-three guards and partial deletions | 67 | 67 | 0 |
| Total | **205** | **205** | **0** |

The final mutation score is 100%; no survivors remain. The raw Roman skeleton
regressions distinguish uppercase-only confusables from their lowercase mappings.
See [MUTATION-KILL-TABLE.md](./MUTATION-KILL-TABLE.md) for every edit and killing
assertion, and [ROOT-VALIDATION.md](./ROOT-VALIDATION.md) for the root failures and
isolated retries. Skips are not passes.
