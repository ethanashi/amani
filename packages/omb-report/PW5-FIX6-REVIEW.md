# Final PW5 lexical round: local closure

Review input: `_logs/pw5r5-pw5b-verify.json`, complete `pw5r5` section.
The eight previously closed findings remain covered by the passing package suite.
There are no new issues in that review. This records implementation and local
validation; it does not claim a new independent reviewer verdict.

| Item | Status | Evidence |
| --- | --- | --- |
| Repeated-letter and near-name attribution bypass; summary/work-noun dependence | Fixed | `pw5-round6-ai.test.ts`: verifier examples, 20+ further cases, edit operations, passive attribution, repeat padding, normalization, length and whole-token boundaries, scientific exceptions. Other fuzzy mentions flag. |
| Verb-gated Methods contradictions | Fixed | `pw5-round6-methods.test.ts`: 21 paraphrases refuse against records in six narrative regions; 16 honest controls pass; negation and unknown/uncertain techniques are pinned. |
| PRISMA merge boundary | Preserved | No edits to `checklists.ts` or `checklist-evidence.ts`. |
| Mutation validation | Complete | 39/41 killed, two proved equivalent shortcuts; 100% of non-equivalent mutants killed. See `PW5-FIX6-KILL-TABLE.md`. |
| Package validation and root typecheck | Passed | 3,355 report + 136 paper tests; zero failures/skips. Runtime target exceeded under shared-host load. |
| Root suite | Skipped, not passed | Load 19.38 exceeded 12; disk 62.00 GiB passed its floor. |

Corpus results: 100 honest AI sentences = 66 clear / 34 flagged / zero refused;
272 AI evasions = 212 blocked / 60 flagged / zero silent. Methods = all 21
contradictions refused, 16 honest controls accepted (one conservative review flag).
See `PW5-FIX6-CORPUS-RESULTS.json` for each sentence and outcome.

This is the last lexical round. Residual semantic/evasion risk is handled by
**PW7's cross-family referee, PaperInput-bound owner-review flags, and the owner's
endorsement**, not by claiming lexical checks exhaust natural language. The
package exposes and tests the acknowledgment gate; PW9 must enforce it over all
final drafter regions. CONSORT/PRISMA coverage remains separately assigned.
