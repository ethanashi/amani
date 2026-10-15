# Directed mutation results

45/45 killed. Invalid runs count against the denominator. Source restored after every run.

| Mutation | Outcome | Killing tests |
| --- | --- | --- |
| budget-calls | killed | adapter bounds calls, tokens, elapsed time, provenance and usage |
| budget-tokens | killed | adapter bounds calls, tokens, elapsed time, provenance and usage |
| budget-time | killed | budget checks time before dispatch and output bytes before parsing |
| usage-required | killed | adapter bounds calls, tokens, elapsed time, provenance and usage |
| model-provenance | killed | adapter bounds calls, tokens, elapsed time, provenance and usage |
| containment | killed | adapter bounds calls, tokens, elapsed time, provenance and usage |
| output-size | killed | budget checks time before dispatch and output bytes before parsing |
| adapter-status | killed | failed final review leaves owner edit unreviewed |
| blind-auth | killed | host-signed stage-1 receipt rejects forgery, stale heads, races and non-strict timing |
| blind-prelook | killed | host-signed stage-1 receipt rejects forgery, stale heads, races and non-strict timing |
| blind-exclusive | killed | host-signed stage-1 receipt rejects forgery, stale heads, races and non-strict timing |
| blind-hash | killed | host-signed stage-1 receipt rejects forgery, stale heads, races and non-strict timing |
| blind-timestamp | killed | host-signed stage-1 receipt rejects forgery, stale heads, races and non-strict timing |
| blind-hypothesis | killed | blind hypothesis guard is enforced before ordinary narrative checks |
| venue-section | killed | venue limits and missing sections fail closed |
| venue-total | killed | venue limits and missing sections fail closed |
| venue-displays | killed | venue limits and missing sections fail closed |
| venue-references | killed | venue limits and missing sections fail closed |
| venue-required | killed | venue limits and missing sections fail closed |
| study-pieces | killed | missing required variant pieces, checklist slots and altered frozen intro refuse |
| render-integrity | killed | post-render edits cannot launder a changed number or label |
| family-separation | killed | same-family or unrecorded reviewer is refused before dispatch |
| proposal-queue | killed | analysis requests become normalized V7 proposals and never prose; structured requests route indirect language to V7 and missing field refuses |
| edit-invalidates-review | killed | bad owner edits invalidate review and cannot move or invent facts |
| edit-facts | killed | bad owner edits invalidate review and cannot move or invent facts |
| latest-review | killed | bad owner edits invalidate review and cannot move or invent facts; failed final review leaves owner edit unreviewed |
| review-anchor | killed | new analysis disguise, invalid proposals, clearing keys and bad review anchors refuse |
| limitation-major | killed | new analysis disguise, invalid proposals, clearing keys and bad review anchors refuse; structured requests route indirect language to V7 and missing field refuses |
| proposal-normalize | killed | new analysis disguise, invalid proposals, clearing keys and bad review anchors refuse |
| spin-taxonomy | killed | full mode dispatches every referee role and keeps spin issues add-only |
| response-diff | killed | revision mode preserves original facts and derives response changes from text |
| correction-facts | killed | correction rebuilds from fresh facts, records erratum and reviews every changed fact |
| budget-final-render | killed | rendering after the last model call still counts against the final budget |
| section-floor | killed | production profiles reject the undersized fixture and repeated padding |
| narrative-diversity | killed | production profiles reject the undersized fixture and repeated padding |
| genre-schema | killed | genre projection checks schema and binds required elements to host evidence |
| temporal-strict | killed | host-signed stage-1 receipt rejects forgery, stale heads, races and non-strict timing |
| temporal-ledger-head | killed | host-signed stage-1 receipt rejects forgery, stale heads, races and non-strict timing |
| validator-wiring | killed | real constructors receive JSON validator and missing wiring fails before dispatch |
| identity-family | killed | version patterns accept dated versions while enforcing provider family |
| rate-backoff | killed | rate limits park then resume with bounded exponential delays and retained spend |
| rate-retries | killed | rate-limit retry exhaustion and excessive resets fail closed |
| partb-free-guard | killed | Part B guards free narrative: A total of 99 participants was available.; Part B guards free narrative: Claude assessed this limitation.; Part B guards free narrative: MarkerA causes ALS.; Part B guards free narrative: <span>hidden</span>.; Part B guards free narrative: [claim:c2].; settling-data prose may describe a prospective resolution without claiming mitigation |
| partb-claim-binding | killed | Part B guards free narrative: [claim:c2]. |
| pre-freeze-floor | killed | Introduction lower bound is checked before immutable storage |
