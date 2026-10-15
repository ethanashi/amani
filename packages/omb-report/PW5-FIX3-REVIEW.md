# PW5 fix round 3

Review input: `_logs/pw5-fix2-verify.json`. Synthetic fixtures only.

## Trust boundaries

- Author names and affiliations are copied from the authenticated owner configuration. Every profile must be marked human; candidate profiles/actions require canonical equality with that configuration. Names are normalized only for duplicate identity detection. No AI/vendor substring denylist remains. Owner actors used for N/A approval must contain non-whitespace text.
- Free-prose contribution checks use normalized verbs and manuscript/section/code/analysis objects, independent of subject identity. Standalone author bylines have an implicit manuscript object. CRediT and AI-use disclosures remain protected software output. The cited honest tool-use sentences pass the narrative fence; factual Methods retain their separate typed-template requirement. Both fences accept residual-confounding caution.
- Checklist verification requires a deterministic producer mapping, its digest and exact output text, as well as inclusion in the authenticated paper at the claimed section/sentence. Arbitrary host-receipted prose and keyword padding do not qualify. Keyword matches are advisory hints with synonyms.

## Review variants and regression coverage

| Review finding | Regression evidence |
| --- | --- |
| Affiliation/name false positives; owner authority; whitespace owner | `pw5-round3-owner.test.ts` |
| Unlisted model, machine, bot and human contribution sentences; honest tool use; residual confounding | `pw5-round3-narrative.test.ts` |
| Keyword salad; STROBE 2/4/5/10/12a/20/21; forged/missing/foreign producer references | `pw5-round3-checklist.test.ts` |
| Full-renderer ordinary tool use; added biological assertion still refused | `pw5-round3-render-use.test.ts` |
| Typed producer fields, pending funding, sealed source documents | `pw5-round3-producers.test.ts` |
| Foreign matter paper; owner state/value; outcome equality; N/A hash/strict applicability; action content; each CRediT role; multi-date use | `pw5-round3-survivors.test.ts` |
| ORCID/email/date anchors and character classes; related-study key/status; authenticated duplicate-name normalization | `pw5-round3-survivors.test.ts` |
| Evidence-group/mutual sharing; 23/24 excerpt boundary; Dice 0.84/0.85 boundary | `pw5-round3-survivors.test.ts` |
| Shadowed Unicode author tests | `matter.test.ts` now asserts exact allow-list refusal; authenticated duplicate cases exercise normalization separately |

The old `requiredKeywords.every` acceptance clause and padding-count boundary no longer exist. Their safety role is replaced by exact producer binding; the advisory `every`/`some` distinction has a separate mutation test. An old keywordless excerpt now fails for lacking a software producer, while valid generated wording does not depend on keyword vocabulary.

## Mutation methodology

The runner enumerates every assertion/validation helper and receipt call in `pw5-records.ts`, `matter.ts`, `methods.ts`, `checklists.ts` and `checklist-evidence.ts`, plus 34 directed clause mutations including name normalization. It mutates one site at a time and restores the source in `finally`. Only assertion failures count as kills; missing tests, skips, load errors and timeouts are invalid. The table distinguishes equivalent checks from non-equivalent survivors. Diagnostic-specific tests also pin which boundary rejects an input; a diagnostic kill is not a claim that removing that clause would otherwise admit the input.

## Deliberate fail-closed limitation

The six registries retain all item-level slots. The current typed source schema cannot establish every reporting item (for example specimen handling, trial allocation, or participant-flow details). Such items stay unresolved, and `complete` remains false. The old all-complete fixtures used registry prompts plus padding and were invalid evidence. Supported automatic producer coverage is listed in BUILD-NOTES. Additional reporting domains require typed host records and audited software templates; free prose cannot substitute for them.

The interrupted exhaustive audit is resumed from completed kills only. Invalid timeouts are rerun. The recovery journal records original and mutated bytes before writing a mutation; startup restores only an exact recorded state and refuses externally changed source. The structure-prediction adaptation is covered by an additional directed mutant.

## Recorded results

The final table contains 280 mutations: 275 killed, five equivalent, zero non-equivalent survivors and zero invalid runs. All 34 directed clause mutants were killed. The additional equivalent producer check is redundant because a sealed Methods document contains an estimand and procedure slot for every context claim. Report tests: 2,252 passed in 5.12 s. Paper tests: 136 passed in 5.64 s. Root typecheck passes. Root suite passed after the one-shot and integration gates cleared: 7,875 passed, 15 pre-existing skips, 180.56 s. Skips are not counted as passed. Final root typecheck passed again. All seven audited source hashes match; temporary logs and the mutation journal are absent.
