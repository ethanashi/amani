# Literature and ideas (V8)

`PlanningResearch` implements `omb-investigate`'s `PlanLiteraturePort`. Supply it as
`InvestigationDeps.literature` and classify the host's `InvestigationSpec.literatureMode`
as `discovery` or `als`. Missing classification is search-off; task cards force benchmark
mode. No mode enables an analysis worker's web search or shell network access.

Construction requires:

- The **same host journal as the lock ledger** (`ledger.literatureJournal`). Native V5
  ledgers accept a host `StoreJournal` as their third constructor argument.
- An injected clock and an entity-pair extractor for the fixed, direction-neutral queries.
- A dedicated `ResearchWorkerPort`. Its `draft` context contains the question, public
  search snapshots, and one restricted `search` tool. It receives no data path, metrics,
  analysis session, shell tool, or download capability. Use a fresh contained model session.
- A `NoveltyReviewPort` for the final check: two separately wired model families and
  a host port reading the author's recorded verdicts. Family/actor identities come from
  this wiring, not model-generated JSON. Missing reviewers block the paper path.

`RoleNetwork` is the host retrieval boundary. It fixes role/mode at construction, uses an
exact HTTPS host allowlist, refuses redirects and dataset file downloads in the literature
role, caps and scans source text before exposure, and tags preprints/finder/news pages.
Model providers' unrestricted built-in web search stays disabled: the host broker makes
academic lookup enforceable at the URL boundary. Dataset retrieval is a different capability,
requiring a trusted accession/licence/size/SHA-256 grant and owner approval for controlled or
>1 GB data. It is never passed to the research model.

`LiteratureResearch` resolves cited statements with the existing PW4 scholarly resolver and
verifier. A frozen brief includes DOI/PMID metadata as CSL-JSON, source sections, quote audit
records and receipts. Every row must pass before freezing; publication still requires PW4's
owner sign-off. The ledger uses content hashes, copy isolation and compare-and-append guards.
Search-off runs freeze an explicitly empty brief. After freeze, only post-look novelty queries
are accepted. Final Europe PMC novelty retrieval paginates (maximum 50 pages), requires a
judgment for every returned record, and records disagreements and the missed-work caveat.
Other allowed sources can be searched during brief preparation; unsupported final novelty
source parsers fail closed.

New investigator plans require six distinct candidates, four angles and the prior-knowledge
box. Discovery candidates must refer to the frozen brief or recorded public-data availability.
Scoring combines explicit subjective impact/testability ratings and public-data availability;
it confers no statistical label. The lateral reviewer has a fresh session and schema-only
mounts, including on route H. Each suggestion is accepted as an exploratory item or rejected
with a reason. Candidate records are stripped from the executable kernel plan. Literature
is never mounted as analysis data or supplied to the label kernel.

Frozen code may write `outputs/exploratory/*.json` containing
`{idea, angle, dataNeeded: string[], priority: 0..5}`. Software overwrites provenance and rung,
ignores proposed labels, and records exploratory idea cards. `publicQueue(ledger)` reads only
authenticated public-scope cards; caller-edited copies and held-out cards cannot enter it.

PaperInput reads brief/hash/prior knowledge/novelty from the authenticated ledger. The
`stage1LiteratureInput` projection and blind report digest contain only the locked plan and
frozen brief; Introduction rendering refuses later citation quotes. Legacy pre-V8 records
retain their existing frozen-index path.

Validation uses PW4's existing SHA-256-pinned public HTTP recordings plus protocol fixtures,
fake workers and local sandbox tests. No literature test uses the live network. Run:

```sh
pnpm exec vitest run packages/omb-literature packages/omb-investigate packages/omb-paper packages/omb-report packages/omb-citations --maxWorkers=2
python3 packages/omb-literature/scripts/mutate.py
```

See BUILD-NOTES.md for the exact build's validation results, runtime prerequisites and root
suite load gate. Fixture judgments and scores are not scientific claims or owner approvals.
