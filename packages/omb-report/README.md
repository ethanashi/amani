# @omerta-bio/paper-report

Deterministic PW1/PW2 manuscript core. The trusted host calls
`createReportContext(buildPaperInput(...))`; never accept an AI-supplied PaperInput
or registry pack as the trusted host's input. A SHA-256 digest detects changes but
is not an authority signature. PW0 verifies the underlying signatures and lineage.

```ts
import { createReportContext, buildRegistry, renderDraft } from './src/index.ts';

const context = createReportContext(paperInput); // PW0's frozen, authenticated output
const registry = buildRegistry(hostPinnedRegistryPacks);
const draft = renderDraft(context,
  'For this analysis, [claim:c1].',
  'discussion', registry);
```

Sentence tags precede terminal punctuation. Supported grammar is paragraphs,
balanced `*emphasis*`/`**emphasis**`, and the design's placeholders. Digits can occur
only in a resolved slot or a whole-token match from the host's pinned registries.
Registry packs carry source, version, entries and the canonical SHA-256 of entries;
HGNC entries support aliases and previous symbols. The tests use synthetic packs.
Accessions, rsIDs and genome builds require explicit `[d:]`/`[e:]` slots.

`renderDraft` returns plain text, escaped HTML, ordered facts and a sentence
skeleton hash. `assertSameFacts` rejects movement or replacement of facts. These
HTML spans are typed **but not HMAC-signed**: signing and final PDF/DOCX checks belong
to PW8. `matchSpanlessNumbers` checks numbers against their ordered expected
renderings; the permissive legacy matcher helpers are never used for drafter lint.

`renderReport`, `renderResults`, `renderTitle`, `compileDigest`, `threePartLabel`,
`limitationsPartA/B`, `renderProtected` and `verifyProtectedText` are independent
trusted producers/checkers. Missing facts remain unavailable; explicitly citing an
unavailable fact throws `ReportRefusal`. Labels are copied from the referee, never
recomputed from prose. Unknown required checks never count as passed.

The PW0 grade vocabulary currently has no authenticated exec-only prose grade.
Consequently those values remain unavailable through `createReportContext`.
`displayFact` supports the exec dagger/footnote convention for a future trusted
producer; it is not an alternative constructor for a report context.

Integration seams fail closed: PW4 supplies approved sentence hashes and verified
quote records; PW5 can add further typed procedure producers; PW3/PW6
supply display-reference/glossary registries. Unknown slots do not resolve. No
artifact conversion, orchestration, network request, publication, or agent runs
occur in this package.

Run from the repo root with Node 24:

```sh
pnpm --filter @omerta-bio/paper-report test
nice -n 10 node packages/omb-report/scripts/mutate.ts
```

The mutation runner temporarily edits this package's sources, one mutant at a time,
and restores them in `finally`. Do not run it concurrently with another suite in
this worktree. `MUTATION-KILL-TABLE.md` records results, including survivors.

Final-round drafting is structural. `title`, `abstract`, `abstract-results`,
`abstract-conclusions`, `results`, `key-points`, `conclusion`, `plain-summary`, and
`plain-summary-results` accept only generated claim requests. They cannot accept
free narrative or citation sentences. The legacy `abstract` and `plain-summary`
names default to this strict behavior.

Use `abstract-background`, `abstract-methods`, and `plain-summary-context` for
narrative subregions. Introduction, Methods, Discussion and Limitations also allow
free prose, subject to numeric, procedure and result-reference checks. Results in
these regions require a standalone `[claim:c1].` request. Names, synonyms,
abbreviations and symbols declared by the locked plan participate in binding.
There is no whole-English vocabulary allow-list. Vague quantifiers and standard
method names are permitted; count assertions require software values.

Fact-bearing procedures use standalone `[proc:c1.sidedness].` and related requests.
They resolve from locked-plan or provenance fields and describe their actual
source. Missing records refuse. Rendered plan fragments must match frozen PW0
entity/variable names or the pinned common noun registry. New labels require a
host registry entry; a free prose plan field cannot authorize itself. Generic
Limitations have a narrowly parsed hedge class; Part B remains template-selected.

Default-ignorable code points are refused, including combining grapheme joiners
and variation selectors. Latin diacritics and common scientific Greek letters
are supported; mixing scripts within a token remains refused. Numeric slots,
including versions and registration values, are atomic. Drafter-added units are
refused; software values carry their own formatting. Numeric citation indices
allow a free preceding quote span, but not a free following unit.

See [ROUND4-REVIEW.md](./ROUND4-REVIEW.md) for evidence, corpus coverage and known
limits. Free-prose semantic completeness is not claimed: the PW7 spin-judge panel
and the owner's endorsement lock are required downstream safeguards. This package
does not implement or simulate those integrations.
