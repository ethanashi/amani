# PW5 fix round 2

Input: coordinator's `pw5-fix1-verify.json` (12 open findings and 18 new findings; several new findings duplicate open ones). Synthetic fixtures only.

| Review finding | Implementation / regression evidence |
| --- | --- |
| Open 0; new relabeled/junk anchors | Separate paper-render receipt, exact section/sentence lookup, verbatim excerpt containment, registered per-item keyword evidence, normalized token similarity. `checklists.test.ts` reproduces formerly accepted junk; paper/section substitutions and near duplicates are refused. |
| Open 2; new missing N/A actor | Exact approval keys; nonempty owner and actor; all four applicability predicates tested independently. Before-fix missing actor was accepted. |
| Open 4; new cross-region leak | Adjustment identifier/alias fence applies to all regions; 56 region/phrase regressions. |
| Open 10; new base-context AI attribution | Attribution guard runs without model provenance. Ordinary prior-author/biomarker prose has positive controls. |
| Open 11; new human collaborator false positives | Separator-insensitive author keys, provenance and known-model deny names, vendor affiliation checks, punctuation-insensitive duplicates, positive human-name cases. All 30 initial new cases failed before correction. |
| New honest checklist conditional items | Explicit related-item shared mappings; certified/owner-gated conditional N/A entries in all six registries, with core items still requiring evidence. Four new conditional-registry regressions failed before correction. |
| New honest record punctuation/logs/runtime (three overlapping findings) | Safe closed punctuation set, scoped package names, installation records explicitly distinguished from analyses, nonnegative fractional milliseconds. Eleven new positive cases failed before correction. Unknown log kinds still refuse. |
| New dead normalized caution and closed connectives | Normalize both sides of the comparison and reuse core CONNECTIVES. Both regressions failed before correction. |
| New acknowledgment markup | Escape the entire generated acknowledgment region; adversarial model markup regression failed before correction. |
| New version inventory bypass | `[v:]` checks package/version agreement when both inventories are present; malformed inventory values refuse. Four regressions failed before correction. Legacy PW1 version-only locks retain their existing API. |
| Open 16; fixed disclosure drift | Snapshot default/pending complete generated matter; literal figure and clinical text; all contribution tiers; omitted figure flags refuse. |
| Open 17/18; new equality and provenance guard gaps | Specific-message tests for both owner identity halves, owner action equality, GRABDROP, funding/interests, ethics, all usage enums, related-study keys, email shape and ORCID X. |
| Open 19; new Methods guard gaps | Exact count/policy/procedure refusals; unsorted locked adjustment order preserved; all nine procedure paragraphs and Methods branches pinned. |
| Open 20; new checklist guard gaps | Registry contents pinned; runtime registry fault injection; owner-kind and reversed-range cases; literal N/A text and result identity. |
| Open 21 | Replace bare refusal assertions in the original PW5 suites with domain-specific messages. |
| Open 14; remaining mutation gaps | AST-generated no-op inventory for every requireThat and validation-helper site in the four requested modules; receipt-validation bypasses audited separately in the same runner. Final table records kills, invalid runs and independently justified equivalent survivors. |

The host must issue the `omb-report/rendered-paper@1` receipt only for the actual software-rendered manuscript. The final anchor receipt does not substitute for that separate receipt. Keyword sets are original registry evidence requirements; they are deterministic matching rules, not an independent scientific assessment of a sentence. Evidence and applicability still depend on authenticated host records.

No network or live research data were used. No files were created outside the allowed package. Validation counts, timings and final mutation outcome are recorded in BUILD-NOTES after the final run.
