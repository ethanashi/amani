# PW9: local paper packaging

`@omerta-bio/package` builds an endorsed manuscript into a local submission and
reproduction directory. It never posts, emails, reserves a DOI or registers a plan.

```sh
pixi install --locked --manifest-path packages/omb-package/pixi.toml
pnpm --filter @omerta-bio/package test
pnpm --filter @omerta-bio/package sample
packages/omb-package/examples/sample/bundles/twocol/reproduce
```

Node >=24 is required. The cached Chromium revision and executable hash are in
`chromium.lock.json`; `PW9_CHROMIUM` may point to an identical binary elsewhere.
There is no Homebrew pandoc fallback. All fonts and CSL bytes are licensed and
pinned in `vendor/manifest.json`. Linux has a locked analysis environment, but the
current document renderer pin is the Mac ARM Playwright cache. The sample uses
synthetic data, model IDs, owner receipts and PW5–PW8 fixtures; it is not a real
owner endorsement. Existing output directories are refused. Remove or rename a
previous fixture output explicitly before rebuilding it.

## Host integration

Import `packagePaper`, `Ed25519Authority`, `signRecord`, `submissionHash` and the
interfaces from `src/index.ts`. The trusted host supplies these capabilities;
they must never be populated from drafter JSON or made available as LLM tools.

1. `paperInputAuthenticator(lineage, options)` rebuilds PW0 from the authenticated
   V5 store and refuses a differing PaperInput. A hash alone is not authentication.
2. `displayVerifier` regenerates every PW3 figure/table against the host's frozen
   specs and authenticated FactStore; checks bytes, CSVs, dictionaries, captions,
   placement and the complete manuscript reference inventory.
3. `citationVerifier` retains `FrozenBibliography`'s issued selections, freshly
   rebuilds API metadata/status, compares immutable CSL, and calls the permanent
   owner L6 verifier. The packager checks actual final PDF reference text against
   the exact citeproc text. PW4's older bounded-style parser is not misused as a
   Vancouver parser. Unsupported/missing references fail; the local fixture is
   explicitly synthetic and uses a separate fixture port.
4. `verifySource` is the **required PW5–PW8 adapter**. It must authenticate PW5's
   complete checklist registry and procedure strings, PW6's five human answers,
   PW7's closed review and final diff, and PW8's source skeleton, must-appear set,
   signed spans, number grades, study metadata and complete analytical-number
   inventory. It must compare these to the exact Submission it receives, including
   contact discrepancies, private-identifier inventory, analysis code/lockfiles
   and data provenance. Never implement it as an unconditional success callback.
5. `verifyRendered` is the **required PW8 output adapter**. It receives exact bytes
   of regenerated PDFs/DOCX/HTML and all public sidecar text. Check sentence/fact
   binding, protected regions, number grades, metadata/alt text and wording on
   these artifacts. PDF `text` is extracted from the actual bytes; DOCX `text`
   includes every XML part. Missing upstream ports block before any renderer runs.

PW5–PW8 do not exist on this branch's base, so this package deliberately does not
claim to implement their closed-world semantic checks. Their fixture capabilities
live only in `test/fixture.ts`; the production API has no fixture bypass flag.

The PW7 provenance bridge is explicit: PW0 `runMetadata.modelUsage` holds the
journal-derived model records (all `ModelProvenance` fields except `sourceHash`);
`modelsFromProvenance` derives hashes and requires exact identity. The same metadata
holds `framework` (version, commit, gauntlet version, calibration ID). PW0 must
freeze this evidence into PaperInput, not accept it from a manuscript authoring
model. Unknown training cutoffs are printed as unknown, never guessed. Conda
software citations are generated from the analysis lockfile into
`software-citations.json`; unrecorded package DOIs are not invented.

The host signs an `OwnerRecord`, then a `ReviewRecord` over `submissionHash`, then
an `Endorsement` over the PaperInput hash, submission hash and review receipt hash.
Only explicit owner actions may create those signatures. Private keys stay with
the host. The final certificate signs every upstream gate result (including
failures), every packaging gate and the bundle manifest, using Ed25519. Consumers
must obtain the public-key fingerprint independently from the author; a bundled
public key alone does not establish identity.

Contact logs in PW0 bind the prior host-receipted draft hash; the final PaperInput
includes those logs and gets its own endorsement. This avoids an impossible
self-referential hash. Every implicated recipient must have a reply summary or a
completed wait. A `reply` without quote permission is treated as an owner-written
summary; the host adapter must not insert unpermitted verbatim correspondence.

## Profiles and policies

Three profiles ship: `preprint` (default; one of bioRxiv/medRxiv), `plos-one`, and
`research-note` (<=1,500 words, <=2 displays). Each declares project word/display/
reference caps, CSL, summary layers, study checklists, dated policy rules and a
fee note. Main display titles/captions/table cells also share a separate display-text
budget (1000 words preprint/PLOS, 300 research note); each caption is capped at
250/150 words respectively, including supplementary captions.

Every display must have an explicit body link, for example
`[Figure 1](#fig-study-design)` or `[Table 1](#tab-summary-of-findings)`.
Numbers follow display inventory order (main before supplement, separately for
figures and tables). Abstracts, captions, code, headings, lists and table cells
cannot supply the first citation; use a prose paragraph. Main displays require a
main-body citation; supplementary displays require a main or supplement body
citation. PW9 rejects missing, unknown and misnumbered links. The first main body
section must be Introduction. Preprint and research-note profiles place displays
after the first citing paragraph; the PLOS submission profile places them after
the complete reference list. Supplementary displays stay in the supplement.

Project caps are explicitly distinguished from publisher requirements.
PLOS MR requires replicated status, independent data and a literature search.
Frontiers, uncontrolled posting targets, restricted data and unreviewed rung 3/4
preprint dossiers are blocked. The research-note profile is a local template,
not permission to submit to an arbitrary journal. A venue-specific short-format
policy profile must be reviewed before actual submission.

A signed `PolicyReceipt` must cover every profile rule on the UTC packaging day,
with its URL, quote, source hash and permission verdict. Fetch/review policies in
the trusted host before calling the packager; failed or blocked retrieval cannot
be treated as approval. bioRxiv/medRxiv archived rules are marked unverified until
that fresh check. No emails, ORCIDs, affiliations or conflict declarations are
invented; the owner's default affiliation is Independent researcher, and his email
requires explicit recorded consent.

## Reproduction and deterministic artifacts

`./reproduce` provisions the hash-locked conda environment, verifies the Ed25519
certificate and every manifest file, and executes only the bundled analysis code
in a fresh Seatbelt/bubblewrap sandbox. The analysis sees code/data and the pinned
runtime; it cannot read expected outputs or the private repository and has no
network. Missing, extra or different analytical values fail exact comparison.
All referenced data must be staged with hashes before offline packaging; URLs
remain in `data-pointers.json`. Production Python entrypoints can invoke other
analysis tools from their pinned environment. This version requires Python
3.13.9 in that environment. No fallback to an unpinned interpreter is allowed.

Two independent document builds must have byte-identical normalized outputs.
`regenerate-and-hash.json` preserves raw/final hashes and explains normalization
of PDF dates, trailer/accessibility IDs and DOCX ZIP dates/local paths. Fonts are
embedded; SVG originals and font-embedded/PNG derivatives are separate. A changed
output cannot be re-used or silently blessed. Checklists are validated against
actual final HTML anchors and excerpts. Internal AI review is escaped and confined
to `internal/`, never either PDF.

The analysis script reproduces every analytical number enumerated by PW8. It is
not PW10's forthcoming independent recomputation of the scientific gate algorithms.
The signed ledger preserves every gate result without claiming scientific validity.

## Validation

`pnpm --filter @omerta-bio/package test` runs unit and actual conversion/sandbox
integration tests, including PDF text goldens, DOCX hidden-run mutations, altered
analysis/data, reference read-back and final checklist-anchor checks. The ordinary
root suite includes the fast `*.test.ts` tests; the package config additionally
runs `*.integration.ts` with the real toolchain. `pnpm --filter
@omerta-bio/package mutations` deletes individual production guards in temporary
modules and measures adversarial acceptance. Those modules are always removed.
Native Word/LibreOffice layout has not been visually validated on this host;
DOCX XML, fonts, line spacing and read-back are checked. See BUILD-NOTES for exact
commands, results, policy retrieval limitations and visual QA.

## Genre structure lint

The six pinned `genre-profile/1` profiles live in `genres/`. Packaging parses the
actual manuscript and supplement through the pinned pandoc and runs structural
lint before PDF/DOCX generation. FAIL and unwaived FAIL-W stop packaging. WARN and
INFO are retained in `lint/structure.json` and `lint/structure.md`. Venue caps
remain separate, non-waivable failures. Legacy/uncovered genres emit P4.

The authenticated `PaperInput.paperSet` and `lockedPlan.paper_set` (or `paperSet`)
must contain the same record, for example:

```json
[{"claim_ids":["primary-claim"],"genre":"cis-mr-colocalisation-drug-target",
  "study_variant":"causal-genetic","secondary_genres":[],
  "design_flags":{"multi_instrument":true,"proteome_wide":false}}]
```

Only the locked record controls genre selection. Display `genreKind` values use
the profile vocabulary; supplement sections may declare `genreItem`. Completed
checklists map through `genre-checklists.json`. `manuscript.limitationsPartB`
records addressed text or `not-applicable:<reason>`; the lint verifies the text
in rendered Limitations or the printed supplementary applicability table.

`structureWaivers` use the README section 8 schema in `genres/`. The associated
owner declaration has action `structure-waiver`, the recorded owner actor, and
`evidence: waiverHash(waiver)`; `owner_action_receipt` is the canonical SHA-256 of
that action. PW0 authenticates the action as part of PaperInput. Waivers bind the
profile hash, rule and target, require a printed reason, and never waive FAIL.
They appear in the supplement's departures table. No package fixture represents
actual owner approval. The certificate records `genreProfiles`; re-verification
passes that map to `reverifyGenre` or `packagePaper({expectedGenreProfiles: ...})`.
Removing a genre or changing its pin fails P2.

Run `pnpm --filter @omerta-bio/package genre:mutations` for production-guard
mutations. `pnpm --filter @omerta-bio/package genre:calibrate` fetches/caches the
53 JATS exemplars, converts them and audits the supplied acceptance thresholds.
It returns nonzero when acceptance fails. Exemplar prose remains in ignored
`.cache/`; versioned reports contain only counts, rule ids, metadata and hashes.
The six synthetic AST fixtures exercise structural rules, not scientific quality.

**Round 3 qualification:** the owner's CONVENTION / AMANI-STANDARD split is
implemented. Each genre passes the convention positive control (median zero,
maximum two FAILs); all 53 counter checks and 223/228 leave-one-out checks pass.
Amani-standard rules still block packaging and their exemplar rates are reported
separately. See `reports/genre-calibration-round3.json` and
`reports/genre-calibration-issues.md` for before/after results and normalization
provenance. Original profile files remain pinned and unchanged.

## Reading PDFs and arXiv source

`Submission.outputProfile` is optional and endorsement-bound. Preprint and note
venues default to `preprint-two-column`; PLOS ONE defaults to `journal-review`.
The third option, `arxiv-source`, generates the same LaTeX reading PDF plus
`paper-arxiv.tar.gz`. An output format does not grant permission to post to a new
target; the existing target and fresh policy-receipt gates remain authoritative.

LaTeX uses pinned pandoc → owned `latex/article.tex` / `latex/structure.lua` →
Tectonic 0.15.0 with a 3.6 MB frozen offline bundle and fixed SOURCE_DATE_EPOCH.
Latin Modern is GUST/LPPL licensed. Figures are vector PDF derivatives of the
host-authenticated PW3 SVG, with a renamed Latin Modern TrueType derivative to
avoid Chromium's Type 3 CFF font output. Original source SVG/CSV provenance is
retained. `Display.floatWidth` selects `column` (default) or `page`; floats follow
the first citation and the final PDF ordering is checked. Overfull boxes and
missing glyphs fail. Journal review remains the existing Chromium path.

The deterministic arXiv tarball contains self-contained TeX, citeproc's .bbl and
preconverted vector figures. Its documented 00README.json selects XeLaTeX on
TeX Live 2025 without a stamp. Fontspec loads standard TeX fonts by filename.
Archive-only recompilation is tested with Tectonic; remote arXiv submission has
not been performed. See reports/arxiv-policy-round3.json for current official
policy sources. arXiv normally expects source for TeX-produced work and rejects
PDF-only TeX submissions except case-by-case exceptions.

All public PDFs retain a checked text layer passed to the required PW8 host
adapter. The pypdf 6.1.1 readback corrects its positive-TJ kerning-space bug only
in memory; delivered PDF glyphs/spacing remain intact. Regeneration compares every
artifact byte. Reports retain raw hashes and explain metadata normalization.

The sample command builds all three profiles in `examples/sample/bundles/` and
copies `paper-twocol.pdf`, `paper-arxiv.pdf` + `.tar.gz`, `paper-review.pdf` and
matching `*-page-1.png` previews to the sample directory. `paper.pdf`/`paper.docx`
are default-reading convenience copies. Complete signed inventories remain in
those per-profile bundles. Page previews use an existing Poppler executable
(`PW9_PDFTOPPM`, default `/opt/homebrew/bin/pdftoppm`) for QA only.
