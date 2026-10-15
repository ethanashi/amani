# Showcase validation

Validated on 2026-10-15 on `showcase/replications`, descended from `docs/readme-v2`.
All heavy commands ran at `nice -n 10`. Dependencies were copied with APFS
`cp -cR`; the paper environment came from the integration checkout because the
main checkout did not contain it. No push, sudo or Claude call was made.

## Tests and typecheck

| Check | Result |
|---|---|
| omb-report and omb-paper, including PW8 | **4,156 passed, 102 files; no failures or skips** |
| PW9 package suite, including conversion and PW8 render integrations | **158 passed, 17 files; no failures or skips** |
| Root TypeScript typecheck | **Passed** |
| New archive-path regression coverage | **12 tests**, included in the totals above |

Commands used Node 24.19.0:

```sh
nice -n 10 node node_modules/vitest/vitest.mjs run \
  packages/omb-report packages/omb-paper --maxWorkers=1 --no-file-parallelism
nice -n 10 node node_modules/vitest/vitest.mjs run \
  --config packages/omb-package/vitest.config.ts --maxWorkers=1 --no-file-parallelism
nice -n 10 node node_modules/typescript/bin/tsc -p tsconfig.json
```

The package suite includes actual two-column preprint, arXiv-source and journal
review rendering. Archive tests cover source digest changes, unavailable facts,
numeric slots, scientific overclaims, duplicate-identity terminology, public
provenance export, explicit pre-look replans, TeX escaping and layout selection.

## Papers and data

All five papers have **two pages and zero overfull warnings**. Tectonic logs also
passed missing-glyph/error checks. Every paragraph was checked against extracted
PDF text, and every rendered page was visually inspected. Each case contains its
page-one PNG, manuscript source, PDF hash and build record.

| Case | Grade preserved | Data route | Exact served files checked |
|---|---|---|---|
| C3 | 8/8 | Real public-source downloads; Hallmark annotation CC BY 4.0 | 12 |
| C4 | 18/18 | Bundled CC0 summary statistics, deterministic gzip | 9 |
| C1 | 14/16 | Real public-source regional downloads and reference-panel reconstruction | 5 |
| C2 | 12/15 | Real public-source downloads and final retired-case staging | 6 |
| C5 | 7/9 | Real public-source downloads and sample-label reconstruction | 4 |

All four fetchers were executed against their original public URLs, then checked
against the original served-file hashes. The C4 gzip files were decompressed and
checked against those hashes too. No original investigation was rerun or regraded.
[Consistency checks](checks.json) additionally verify unchanged tasks/reports/grades,
paper-input and PDF hash bindings, selected facts belonging to passed criteria,
absence of study-name canaries from the blind papers, and local README links.

## Build and preview commands

Set `REPLICATIONS_SOURCE` to the owner-provided retired-case archive. Historical
paths inside records are never opened; collection uses this explicit root.

```sh
nice -n 10 node --experimental-transform-types scripts/replications/build-papers.ts \
  "$REPLICATIONS_SOURCE"
nice -n 10 python3 scripts/replications/check-showcase.py "$REPLICATIONS_SOURCE"
nice -n 10 node --experimental-transform-types scripts/replications/render-readme-previews.ts
```

The paper builder reuses saved, checked narrative drafts. Deleting a case's
`narrative.json` explicitly requests another live Codex draft. The existing
Codex adapter and DraftRuntime enforce containment, model identity and usage
accounting. [Drafting accounting](drafting-accounting.json) records all live
drafting calls, including superseded drafts, without exposing worker paths.

Self-contained HTML and top-of-page PNG previews are in the sibling worktree
log directory `readme-previews/`, with names `amani-replications-main.html`,
`amani-replications-main.png`, `amani-replications-index.html` and
`amani-replications-index.png`. Both previews were visually inspected.

These are retrospective reading preprints. The archived V7 certification summaries
retain their native scientific labels, distinct from the sealed benchmark grades.
The archive path does not manufacture modern PW0 authentication, cross-family
manuscript review, human endorsement or a PW9 submission certificate.
