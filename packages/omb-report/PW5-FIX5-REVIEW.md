# PW5 round-five closure map

The independent input was `pw5-fix4-verify.json` at reviewed head `bf174f7`.
Policy changes follow the round-five coordinator decision, not the superseded
round-four rule forbidding every scientific AI mention.

| Verify finding | Implementation / regression evidence | Status |
| --- | --- | --- |
| open-a / idx10 accent, combining-mark, small-cap, product and generic evasions | `ai-prose.ts`: two tiers; independently pinned catalog; verifier corpus1/2/5/7; normalized split-name tests | Fixed; corpus totals in companion JSON |
| open-a / biomedical false positives | Whole-name boundaries; contextual scientific homonyms and defined abbreviations; scientific generic terms nonblocking; corpus6 plus vitamin/type/blood-group A | Fixed under refined policy |
| open-a / provider and model-ID bans | Only exact provenance model names extend BLOCK; company mentions FLAG; opaque IDs excluded | Fixed |
| open-a / authenticated site clauses | Exact name/city/country fields, proper-name grammar, clause/verb checks, AI review checks; authenticated and unreceipted regressions | Fixed within restricted structured-name grammar |
| open-b / mutant12 adjustment clause | Literal clause mutation and independent correction/regress noun tests; TR39 adjustment-noun fix | Closed; final audit: 412 killed / 417, five equivalent, no other survivors |
| open-b / vocabulary, substring and joined-text test gaps | Every catalog entry pinned; left/right boundaries, normalization and all-region join mutants; sealed acknowledgment gate mutants | Closed; final audit: 412 killed / 417, five equivalent, no other survivors |
| new / invisible owner IDs | At least two visible Unicode letters/digits; Cf/default-ignorable/filler refusals; all exact reported variants | Fixed |
| open-a / seven previously closed findings | AI-role/use, nonblocking honest writing, all-region contradictory-Methods refusal (now with free narrative), unauthenticated site, distinct producer mapping, structure exemption, correct/future wording | Retained regression tests |
| new / cosmetic leftovers and earlier idx0/idx11 | Exact excerpt sentence; estimand separators; receipt-only human authors; keyword-salad refusal | Retained regression tests |
| open-b / five equivalent guards | Retain source-specific proof records; re-evaluate current inventory | Closed; final audit: 412 killed / 417, five equivalent, no other survivors |

Known integration limit: PW9 is absent from this worktree. Its final assembly must
supply every drafter region to `buildAIProseReview` and call
`requireAIReviewAcknowledged` before setting `endorsed`. Report renderings expose
pending flags in metadata and visible text/HTML; no model-written acknowledgment
can satisfy the exported gate. Acknowledgments are bound to the PaperInput, full
submitted region set/draft hash, exact flag set and authenticated owner.

Scientific exceptions are intentionally narrow. Claude Monet remains a documented
BLOCK false positive. High-recall flags may include honest human/tool statements;
these remain renderable and require owner acknowledgment. Corpus counts concern
the AI prose boundary, not permission to bypass independent fact/Methods gates.
Site names outside the restrictive schema need a reviewed schema extension.
CONSORT and PRISMA coverage remains 0/42 each here; PRISMA is a separate branch.

PW7 blocker: **closed**. The three-sentence restriction is removed. Twelve realistic
honest paragraphs and cited sections above 300 words render; sixteen contradictory
paragraphs and their factual variants refuse. Missing/unknown Methods evidence
creates visible owner-review items rather than verified facts. Sealed proofs keep
claim, number, label and AI checks active. See `PW5-FIX5-VALIDATION.json` for exact
validation results and limits.
