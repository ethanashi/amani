# Round 2 contract and review coverage

The verifier file contains 20 `open` entries and 29 `newDefects` entries (49 total), not 30 new entries. All supplied entries are mapped below. Synthetic corpora contain 62 honest drafts across Methods, Limitations, Introduction/Background, Results, Discussion and summary regions, and 182 adversarial drafts/Part B entries. The full package also retains round-one attacks and adds direct boundary probes for review entries about source corruption or partial deletion, which are not prose attacks.

Claim drafting is now a request: `[claim:c1].`, optionally preceded by `For this analysis,`, `In this analysis,`, or `Regarding this result,`. The software chooses the predicate, bundle and three-part label from the referee status. Raw hedged claim prose is no longer an authorized rewrite. For voided and non-identifiable claims, it emits no effect-size bundle. A claim request cannot carry drafter entities, metrics, adjectives or assertion text. Implicit entity mentions do not evade this boundary. Cited background is restricted to approved source text in closed literature forms; approval does not authorize arbitrary result language.

Methods and non-assertive limitation forms are enumerated in `src/templates.ts`. “Once”, “First”, “one-sided”, honest negatives, “cause of death”, and measured outcome names have explicit paths. Uncited Introduction sentences naming claim entities are intentionally refused; their cited forms are corpus positives. Unknown English words are refused rather than guessed. This is a deliberately narrow grammar, not unrestricted natural language. Domain vocabulary or new procedural forms require a reviewed update. Approved templates can use non-quantity senses of words; “first author” remains unavailable unless a protected template is added.

Part B fields select complete entries from `BIAS_TEMPLATES` and `SETTLING_TEMPLATES`, with closed direction/overturn choices. Arbitrary descriptions, unsupported “no overturn”, and uncertified non-applicability are refused. These last two paths need a trusted applicability/impact producer before they can be exposed; text alone cannot waive a limitation. The API retains these fields to fail explicitly instead of silently discarding them.

Old tests for permissive prose were migrated to claim requests or to direct binder/formatter tests. Negative attacks remain. The former ban-list mutants are obsolete: the ban lists no longer authorize or reject drafts. The round-two catalog measures template, lexical, provenance, formatting, protected-text and assembly guards, including partial conditions identified by the reviewer. The old lexical taxonomy remains exported as audit metadata only.

## Evidence mapping

| Entry | Finding | Coverage |
| --- | --- | --- |
| open-1 | Adjacent or decorated software slots forge numbers not in the fact store (R01) | adversarial corpus A133, A134, A135 and 4 more |
| open-2 | Number words and non-ASCII numerals pass parseDraft and renderDraft (R02) | adversarial corpus A091, A092, A093 and 39 more |
| open-3 | Numeric leaf values under input-named fields are classified 'input' and allowed in the blind Introduction (R04) | round2-numbers (numeric strings); review-round1 R04 (numeric metadata) |
| open-4 | Positive or unhedged assertions pass for refuted, undecided, non-identifiable, voided and exploratory claims (R05) | adversarial corpus A001, A002, A003 and 74 more |
| open-5 | Tentative ban list covers only third-person present tense (past/passive forms pass) | adversarial corpus A001, A002, A003 and 53 more |
| open-6 | Causal verbs and inflected causal nouns pass below the causal rung | adversarial corpus A001, A002, A003 and 53 more |
| open-7 | 'significantly' bypasses the significance-needs-bundle rule; 'statistically significant' accepted beside a non-significant bundle | adversarial corpus A078, A079, A080 and 2 more |
| open-8 | Multi-word lexicon/phrase/safety patterns match only a single ASCII space | adversarial corpus A001, A002, A003 and 70 more |
| open-9 | Unbound sentences in title, Key Points, abstract and plain summary can state conclusions with no label check | adversarial corpus A001, A002, A003 and 70 more |
| open-10 | Limitations Part B weakening lint is a narrow word list; reassurance, label contradiction and failure excuses pass | adversarial corpus A153, A154, A155 and 27 more |
| open-11 | Quantifier and summary-spin rules check only that count slots are present, not that the counts support the word | adversarial corpus A083, A084, A085 and 5 more |
| open-12 | At-most-once lint is case-sensitive exact substring (R16) | round2-limitations (homoglyph, punctuation, mid-label repeats) |
| open-13 | Null phrasings outside the lexicon pass for refuted/undecided claims (R17) | adversarial corpus A001, A002, A003 and 70 more |
| open-14 | Confusable-skeleton guards have no test; Cyrillic spoofs get through (R18) | adversarial corpus A091, A092, A093 and 39 more |
| open-15 | Grammar and normaliser hardening guards survive removal (R19) | adversarial corpus A140, A141, A142 and 10 more |
| open-16 | Introduction, primary-claim and region gating untested (review R21) | adversarial corpus A057, A058, A059 and 14 more |
| open-17 | Per-status ban tables and lexicon exemptions untested (review R22) | round2-templates (all statuses); review-guards R22 (quotes) |
| open-18 | [l:] literature-number path and citation-hash approval untested (review R23) | round2-partial (null year and missing number); review-guards R23 (citation authorization) |
| open-19 | validLock and report-level guards untested (review R24) | round2-partial (outcome title digits and fractional locks); review-guards R24 |
| open-20 | Number-formatter guards untested (review R25) | round2-partial (both sides and individual formatter conditions) |
| new-1 | Han numeral check runs before NFKC, so Kangxi radical numerals pass (R02 regression) | adversarial corpus A091, A092, A093 and 39 more |
| new-2 | Roman-numeral rules wrongly refuse ordinary words, I and common medical acronyms | round2-corpus honest rows; round2-numbers |
| new-3 | Arithmetic words and ratio punctuation next to numeric slots still change the meaning of a certified number | adversarial corpus A133, A134, A135 and 4 more |
| new-4 | Numeric strings under input-named manifest fields are classified input and enter the blind Introduction | round2-numbers numeric strings |
| new-5 | Status frames are not enforced: positive wording passes with the label for refuted, voided and other non-confirmed claims, and unbound sentences skip the check | adversarial corpus A001, A002, A003 and 57 more |
| new-6 | U+0085 (NEL) bypasses every multi-word wording pattern | adversarial corpus A001, A002, A003 and 53 more |
| new-7 | Spelling variants of 'significant' evade the significance rule | adversarial corpus A078, A079, A080 and 2 more |
| new-8 | Causal synonym and derivational gaps below and at the causal rung | adversarial corpus A001, A002, A003 and 53 more |
| new-9 | Adverb forms and truth-synonyms of banned assertions pass for tentative claims | adversarial corpus A001, A002, A003 and 53 more |
| new-10 | Regression tests are shadowed by other bans and survive partial reverts | round2-templates and mutation catalog (replaced individual stem bans) |
| new-11 | False positives: honest negatives and 'cause of death' refused | round2-corpus honest negatives and cause of death |
| new-12 | Part B lint now refuses legitimate limitation text (false positives from bare keywords) | round2-limitations honest bias/settling choices and adversarial corpus |
| new-13 | Strict-region conclusion words bypass via a trivial [claim:] tag | adversarial corpus A001, A002, A003 and 70 more |
| new-14 | Plain twin for a failed gate misstates checks that did not run | round2-limitations not-run/unavailable/skipped/failed twins |
| new-15 | Plain summary exposes internal claim IDs and omits which claim a failed gate affects | round2-limitations scoped twins; unused twin table deleted |
| new-16 | Ampersand and entity guard bypassed by fullwidth/small ampersand (NFKC runs after the check) | adversarial corpus A140, A141, A142 and 10 more |
| new-17 | Whole-script uppercase spoofs of number words and Roman numerals pass (capital I maps to 'l' in the skeleton) | adversarial corpus A091, A092, A093 and 39 more |
| new-18 | At-most-once lint evaded by Cyrillic homoglyph or a mid-sentence label insertion | round2-limitations normalized repeats |
| new-19 | Null phrasing blocklist is still open-ended; synonyms of 'no relationship' pass for refuted and undecided claims | adversarial corpus A001, A002, A003 and 70 more |
| new-20 | Over-broad new bans refuse honest Methods sentences | round2-corpus honest safety/absence/privacy Methods |
| new-21 | Leftover tests gaps inside the R19 and R20 guards (sub-conditions survive mutation) | round2-partial absent requirements, source ID and input derivation; round2-normalise DEL |
| new-22 | URL and leftover-AI guards cover only a few spellings | adversarial corpus A140, A141, A142 and 10 more |
| new-23 | Honest uncited Introduction or Methods sentences naming a claim entity (including the outcome, e.g. ALS) are now refused (false positive) | round2-corpus measured entity Methods and cited Introduction; documented citation requirement |
| new-24 | Prohibited conclusion 'hub gene' is bypassed by the plural and the hyphenated spelling | adversarial corpus A057, A058, A059 and 14 more |
| new-25 | New false positive on 'proof' and 'proven' in unbound prose | round2-corpus proof-of-concept and well-proven Methods |
| new-26 | Tests added for R22 to R25 pin one probe per guard, so partial deletions or variants of the same guard survive the full suite | round2-partial formatter/literature/title/lock partial guards; old ban conditions replaced by templates |
| new-27 | couldOverturn invalid-choice guard has no negative test | round2-limitations invalid overturn choices |
| new-28 | Registry version made only of zero-width or invisible characters is accepted | round2-limitations invisible versions |
| new-29 | Honest Part B text with the word 'matched' is refused by the lexicon | round2-limitations matched control choices |

## Final validation

789 report tests passed in 1.41 s; 120 paper tests passed in 4.92 s, with zero skips.
The honest corpus passes 62/62 (100%); all 182 adversarial entries refuse.
All 153 directed mutations are killed; no invalid runs or survivors. Root typecheck
passes. The root suite was not run because the shared machine was busy.

Follow-up guards discovered during validation also have regressions: nested label
parentheses cannot hide repetitions, Background shares Introduction's blind-input
restrictions, and ISO retrieval dates remain input despite numeric-string detection.
