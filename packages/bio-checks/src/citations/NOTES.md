# Block 4 citation checker — build and repair notes

Implementation and tests are confined to `packages/bio-checks/src/citations/`
and `packages/bio-checks/test/citations/`. Public exports remain in `index.ts`.
No runtime dependencies were added. Tests use no network, sleeps or temporary
directories. The shipped HTTP orchestration is now exercised with stubbed fetch
responses and stubbed deadline creation.

## API and result semantics

`checkCitations({ claims, citations, resolver })` checks explicit citation IDs.
Each citation supplies exactly one DOI or PMID and a nonempty quote. Resolver
results contain `exists`, `title`, `retracted`, and optional plain-text `fullText`
and `abstract`. Null existence/retraction means unknown; runtime responses are
validated. Missing optional `resolvePmid` means unverified, never DOI routing.

Per-citation statuses: `verified`, `abstract-only`, `fabricated`, `retracted`,
`quote-not-found`, `unverified`. Per-claim and overall statuses: `verified`,
`abstract-only`, `failed`, `refused`, `unverified`. Aggregate priority is refused,
failed, unverified, abstract-only, verified. Only verified has `passed: true`.
Empty claim batches are unverified. Missing, null and empty citation references
are uncited/refused. Invalid or duplicate catalog IDs invalidate the overall
check even when all claims cite valid entries and independently verify.

Quotes and source text receive Unicode NFC normalization, whitespace collapsing
and locale-independent lowercasing. Punctuation, numbers and wording remain
literal. NFC deliberately does not fold compatibility ligatures. Matching is
contiguous substring provenance, not an entailment judgment. A match confined to
an abstract has reason `abstract-only support` and does not pass. Full-text
matching takes precedence. Quote absence concerns available text only.

## Resolver and text extraction fixes

`createCitationResolver({ timeoutMs?: number })` obtains Crossref metadata and
an exact Europe PMC DOI or MED/PMID core-record match. Multiple hits are ambiguous.
OA full text comes from `/PMC…/fullTextXML`. The deadline defaults to 5 seconds
(configurable 1–60,000 ms); responses are capped at 8 MiB. Redirects are rejected,
requests share the deadline and fixed polite User-Agent, and there are no retries.

A Crossref 404 is no longer proof of fabrication. It triggers a DOI Handle API
lookup. Only a numeric `responseCode: 100` with a matching echoed handle
establishes absence, including when delivered with HTTP 404. Existing handles,
malformed responses, mismatched identities and service failures remain unknown.
Non-Crossref metadata/full-text retrieval is not implemented. An empty exact PMID
search still establishes PMID absence; an existing PMID with no usable DOI
mapping remains unknown unless Europe PMC already establishes retraction.

Retraction evidence is combined from Crossref update-to/updated-by (including
relation fields), either provider's RETRACTED title prefix, Europe PMC publication
types (`Retracted Publication`, `Retraction of Publication`) and comment corrections
(`Retraction in`, `Retraction of`). Positive evidence wins over malformed or unknown
companion metadata and is returned before text fetching. Unknown Crossref update
types or malformed supplied Europe PMC lists remain unknown. A false status
requires all retrieved sources to have no reported retraction. Absent optional
lists mean no reported flag, not a guarantee of complete publisher deposits.

The XML reader now skips well-formed processing instructions at any depth,
retaining validation of XML declarations. It parses tags with a forward scanner
instead of an ambiguous backtracking regex. External DTD identifiers are ignored,
never fetched; internal subsets and unsupported entities are refused. Attributes,
comments and PI data never become prose. Nesting and entities are checked even
inside excluded sections.

Bibliographic `xref ref-type="bibr"` markers are dropped. Citation-only `sup`
wrappers also lose their comma/range punctuation; scientific superscripts and
figure/table xrefs remain. Back matter, ref-list/ref, journal-meta, permissions,
license and processing-meta are excluded. Article title/abstract and body prose
remain available. This avoids treating another paper's bibliography title as
support from the current paper. The policy deliberately excludes all back matter,
including any otherwise useful appendices placed there.

Europe PMC abstract fragments preserve bare comparison signs before whitespace,
numbers, `=` or end-of-text and parse simple inline/block markup. Unparseable or
non-string abstracts are discarded independently, so available valid full text
can still verify. An unusable abstract alone never passes. Full-text failures
still fail closed; they do not silently become passing abstract results.

## Requirement-to-test map

| Requirement / repaired finding | Regression coverage |
| --- | --- |
| Real JATS reaches full-text verification; processing instructions | `resolver.test.ts`: real body sentence via DOI and PMID; `metadata.test.ts`: PI at every depth, malformed targets/termination/declarations |
| Inline citation markers do not spoil quotes | Real body sentence fixture; unit test drops bibr superscripts but keeps scientific exponents and figure xrefs |
| Bare `<` in abstracts; abstract failure isolation | HTML-like comparison yields abstract-only; malformed/non-string abstract with independent full text verifies; malformed abstract alone is unverified |
| Crossref miss does not mean fabricated | Handle codes 1/200 remain unknown; code 100 plus matching identity establishes absence; HTTP/JSON/identity/type failures stay unknown |
| Europe PMC and title retraction evidence | Four isolated evidence sources with otherwise verifying text; known evidence survives bad full text/missing PMID DOI mapping; positive beats unknown/malformed; one clear source cannot clear unknown metadata |
| Catalog-level invalidation | Valid referenced paper verifies while each unreferenced null/id-less/duplicate entry makes overall result unverified with the catalog-specific reason |
| Unicode and uncited null | Canonically equivalent quote/source in both directions; null references refused specifically as `Uncited claim` |
| PMID validation | Capable DOI/PMID spies remain uncalled for 0, 00, 12a and -1; specific identifier-validation reason asserted |
| Bibliography and administrative prose excluded | Checker-level bibliography/license-only quotes fail with quote-absence reason; every excluded element and CDATA covered in parser tests |
| Bounded malformed-tag parsing | Real parser runs in a VM with 100k trailing spaces and a 50 ms interruption budget; must throw `Invalid XML tag`, not a timeout |
| Fail-closed parser/identity guards | Rootless CDATA, malformed relation, PMC-vs-MED mismatch, excluded malformed nesting, plus existing XML/entity/attribute/identity tests |
| Existing acceptance rules | Original checker cases cover fabricated DOI, absent/changed quote, abstract-only, unknown/unavailable data, every cited span, memoization and immutable caller input |

Fixture provenance: `test/citations/fixtures/pmc7095418.xml` contains a trimmed
body sentence, title and processing instructions from the Europe PMC response
retrieved 2026-10-09. The PUBLIC DTD, small MathML example, and exclusion-only
sentences are explicit synthetic additions. It is not an unmodified full paper.
Retraction and Handle responses are controlled fixtures, not current live-service
assertions. No live end-to-end resolver success is claimed.

Before repair, the new regression suite produced 39 failures against the old
implementation. The later bounded-parser test also failed against the original
parser (50 ms VM timeout). Targeted mutations proved that removing catalog-level
invalidation fails all three new catalog tests, and accepting zero PMIDs fails
two PMID tests. Those mutations were restored immediately. Two additional PMID
retraction/missing-mapping regressions were observed failing before their fix.

## Validation and remaining limits

Validation on Node v24.19.0:

- Citation/package suite: **140 tests**, 3 files, **386 ms** total (106 ms test bodies).
- Root `pnpm typecheck`: passed.
- Root `pnpm test`: **185 tests**, 10 files, **3.22 seconds** total.
- `git diff --check`: passed. All changed/created files are within the two allowed
  directories; no temporary files or directories were created outside them.

- Per the explicit two-directory scope, package.json, parent exports and
  package-level BUILD-NOTES.md are outside this repair's write permission.
  This NOTES.md serves as the scoped build report. No bio-core change was needed.
- No confirmed finding was deferred. Duplicate findings were fixed once.
- HTTP deadline expiry, response-size enforcement and all provider variants are
  not exhaustively tested. Fetch orchestration is tested offline; no automated
  test makes a live network request. The VM budget is an interrupt guard, not a
  microbenchmark or a claim that the whole XML parser has a CPU deadline.
- This remains a restricted XML/text extractor, not a complete HTML/XML/JATS or
  mathematical layout parser. Unsupported entities/markup, ambiguous identities,
  unavailable services, unsupported DOI agencies and oversized articles may
  remain unverified. Full MathML mathematical equivalence is not implemented.
- Retraction metadata completeness depends on the providers. A negative status
  only means no flag was reported by the retrieved records.
- Literal text matching cannot determine whether a quote supports the claim,
  is negated by context or describes sound research. Injected resolvers remain
  trusted asynchronous dependencies that must settle.

References: [Europe PMC REST service](https://europepmc.org/RestfulWebService),
[fixture source](https://www.ebi.ac.uk/europepmc/webservices/rest/PMC7095418/fullTextXML),
[Handle REST response codes](https://www.handle.net/proxy_servlet.html),
[Crossref Retraction Watch](https://www.crossref.org/documentation/retrieve-metadata/retraction-watch/).
