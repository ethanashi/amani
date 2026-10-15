# KB0 one-shot benchmark cards

A generic, host-side harness that turns one real public-data case into a **sealed, blinded,
one-shot benchmark card**: an untrusted analyst model receives only a keyed-token projection of
the data and a neutral prompt, gets exactly one look and one grade, and learns nothing back but
each criterion name with pass or fail. The trusted side (case directory, answer key, keyed maps,
sealed expectations) never enters the analyst's tree.

It reuses the KA0/KA1 machinery in `lib/biotasks/discovery/` by import: `blinding.py` (HMAC
seeds, keyed permutations, coordinate remapping), `sealing.py` (seal v2 with a PATH-only OpenSSL
child), `metadata.py` (normalized copies, lstat allowlist, xattrs), `card.py` (TaskCard
validation, `CardRegistry`), `staging.py` (`host_root` rules), `policy.py`
(`forbidden_feature`), and `contracts.py` (`alias_registry`). Code: `lib/biotasks/oneshot/`.
Tests: `test/test_oneshot*.py`. No real case content, answer or dataset is in this repository;
every fixture is synthetic.

## Quick start

```sh
export BIO_GRADING_ROOT=$HOME/.omerta-bio/oneshot/host     # explicit, dedicated, outside the repository
export BIO_SEALING_KEY=$HOME/.omerta-bio/keys/oneshot.key  # >= 32 random bytes, outside the repository
OS="sh packages/bio-tasks/oneshot/oneshot.sh"               # pixi python; see the wrapper header

$OS dry-run    CASE_DIR                                     # validate everything; never seals, never downloads
$OS build-card CASE_DIR $BIO_GRADING_ROOT/cards/my-card     # verify, blind, run answer key, scan, seal, calibrate
$OS serve      $BIO_GRADING_ROOT/cards/my-card ANALYST_DIR --context-id AGENT_CONTEXT
$OS grade      $BIO_GRADING_ROOT/cards/my-card ANALYST_DIR/report.json --context-id AGENT_CONTEXT
$OS verify     $BIO_GRADING_ROOT/cards/my-card              # every byte, binding and the seal
$OS scan       $BIO_GRADING_ROOT/cards/my-card AGENT_OUTPUT # recalled originals / canary in agent output
```

The equivalent module form is `PYTHONPATH=packages/bio-tasks/lib packages/bio-baseline/.pixi/envs/default/bin/python -m biotasks.oneshot ...`.
Every command prints one JSON object; exit 0 = success (grade: verdict pass), 1 = refused or
failed, 2 = usage. Each card directory also carries the KA0-style entrypoints:

```sh
python3 CARD/stage.py --out ANALYST_DIR --context-id AGENT_CONTEXT    # = serve
python3 CARD/check.py --report REPORT --context-id AGENT_CONTEXT      # = grade (or --audit)
```

Interpreter: the harness runs on the bio-baseline pixi python
(`packages/bio-baseline/.pixi/envs/default/bin/python`; numpy is on the import path). Any
`python3` may start `stage.py`/`check.py`: they re-execute themselves as the pixi python. Without
it, and for `python -m biotasks.oneshot` under an interpreter missing the dependencies, the
command still prints one JSON refusal (`grade`: `"reason": "interpreter"`), never a traceback.

`grade` requires `--context-id` (one-shot: the context must have been served this card and gets
one grade) or `--audit` (host calibration only; outside the registry). The card directory name
becomes the card id (`^[a-z0-9][a-z0-9-]{1,62}$`) and must sit inside `BIO_GRADING_ROOT`. The
analyst directory must sit outside it. Keep the context id stable across agent resumes.

## The case directory (host-held, outside the repository)

```
CASE_DIR/case.json        definition (below; schema: schemas/case.schema.json)
CASE_DIR/answer_key.py    computes the answer key FROM THE DATA at sealing time
CASE_DIR/<data files>     local or pre-downloaded sources named in case.json
CASE_DIR/naive/*.json     optional: reports that must FAIL (unblinded namespace; mapped at build)
```

### case.json

| Field | Meaning |
|---|---|
| `schema` | `"omb-oneshot-case/v1"` |
| `id` | host-only case identity; protected from the projection; the one-look registry keys on it |
| `prompt` | neutral public wording. Placeholders render as tokens: `{{gene:SOD1}}` (any namespace), `{{dataset:GSE1}}` (dataset letter), `{{level:group/disease}}` (public column / original level) |
| `synthetic` | `true` only for synthetic fixtures |
| `sources[]` | `name`, `sha256`, `format` (`tsv`/`csv`); `path` (local or pre-downloaded) and/or `url` + `size`; optional `compression` (`none`/`gzip`), `quoting` (`none`/`minimal`), `dataset` (original dataset name), `project` (`false` = answer-key input only) |
| `blinding` | `namespaces`, `tables`, optional `redact`, `row_order` (below) |
| `criteria[]` | named pass criteria (below) |
| `card` | optional TaskCard overrides: `truthClass` (`established-control` default, or `frozen-backtest`), `recallExposure`, `contaminated` (default `true`), `rungTarget`, `gateTargets`, `stratum`, `capMinutes`, `negativeControl`, `positiveControl`, `tolerance` |
| `answer_key` | optional `timeout_seconds` (default 600, max 3600), `runs` (1 or 2, default 2) |

Sources: a local `path` is always preferred. A `url` is fetched only when no local copy exists,
only over https (plain http only to loopback), never above **1,000,000,000 bytes** (refused before
any request, again if `Content-Length` says so, and the stream is cut the moment it exceeds the
declared size), into `BIO_GRADING_ROOT/oneshot-downloads/<sha256>` (never into the case
directory). Every byte the build uses is a private scratch copy hashed while it was written;
symlinked sources refuse. `--offline` forbids downloads and `dry-run` never downloads; both
still use a source already in the verified download cache.

### Blinding spec

`namespaces`: `{"gene": {"kind": "gene"}, "sample": {"kind": "sample"}}`. Kinds are
`gene|protein|sample|snp|compound`; tokens are `<prefix><8 digits>` from
`blinding.permutation` (prefixes default `G P S V D`, overridable, unique). The universe is every
value seen across all tables, so one original maps to one token everywhere (tables and datasets
line up). Context: `oneshot/v1/<case id>/<variant>`.

**Variants and linkability.** A different `--variant` or key changes every token, every keyed
order, the dataset letters, keyed levels and chromosome labels, so those are unlinkable across
variants. The data values are not: decimals are copied byte for byte unless rounded or perturbed,
so joining two variants' tables on their values links every row and column (31 of 31 features in
the synthetic expression fixture), and an answer token learned from one variant's report or
transcript carries straight over to the other. Only the registry (one look per context per case,
any variant, any key) keeps one context from seeing two variants; variants give no protection
once an answer has leaked from another context or a published report. Two optional levers make
values less linkable: a coarser `precision` (fewer distinct values; identical rounding still
links) and `perturb` on decimal columns or matrix cells (keyed noise that differs per variant and
key, which breaks exact-value joins). Neither stops approximate matching of whole rows or columns,
and both change the numbers the analyst works with: keep criteria tolerances wider than their
effect.

`tables`: every projected source belongs to exactly one table. A table keyed by a source name
projects that source; a table with `"sources": ["chr1", "chr2", ...]` concatenates several
sources with one header and one dataset, in that order (per-chromosome summary statistics,
per-sample files from a GSE `_RAW.tar` unpacked by the author, each still pinned by sha256):

```json
{"public_name": "expression", "layout": "matrix", "header_namespace": "sample",
 "cells": {"role": "decimal", "precision": "exact"},
 "columns": {"gene_symbol": {"role": "id", "namespace": "gene", "as": "feature"},
             "description": {"role": "drop", "protect_name": false}}}
```

- `records`: every header must be declared. `matrix`: declare the `id` row column or columns
  (for example `gene_id` and `gene_name`, each in its own namespace) and any other
  non-identifier columns; every other header is an identifier in `header_namespace` and its cells
  follow `cells`.
- Raw public formats: `comment_prefix` skips metadata lines (and blank lines), for example `"!"`
  for a GEO series matrix (`!Series_title ...`, quoted `"ID_REF"` headers with `quoting:
  "minimal"`); `begin`/`end` keep only the lines between two exact marker lines
  (`!series_matrix_table_begin` / `!series_matrix_table_end`; a missing marker refuses);
  `row_names: "<column>"` names the row-label column of an R `write.table` file whose first header
  cell is empty (`col.names = NA`) or missing (`row.names = TRUE`). Leading blank lines are always
  skipped; a line continuing a quoted field is never treated as a comment.
- Column roles: `drop`; `id` (`namespace`, optional one-character `separator` for lists, whose
  tokens are written in keyed order inside each cell unless `list_order: "keep"`);
  `decimal` (`precision`: `"exact"` byte-exact copy, `{"decimals": k}` or `{"significant": k}`,
  round-half-even; optional `perturb`: `{"absolute": a}` adds `u*a`, `{"relative": r}` multiplies
  by `1 + u*r` (r <= 0.5), with `u` uniform in [-1, 1) from a keyed PRF per card variant, applied
  before the rounding, which it requires; matrix `cells` take the same `perturb`; the contract
  states each perturbed column and its scale); `integer`; `categorical` (`levels`: an explicit `{original: public}` map
  covering every value, or `"keyed"` for `L1..Ln` in keyed order, shared by every column with the
  same public name); `text` (passthrough, scanned); `chromosome` (keyed labels `c1..cn`);
  `position` (`chromosome`: its partner column; `mode`: `remap` = order kept, spacing keyed via
  `blinding.coordinates`; `shift` = keyed offset, distances kept). One coordinate map per original
  chromosome across all tables.
- `as` renames a column; renamed and dropped originals become protected terms unless
  `protect_name: false` (for generic headers such as `description`). Headers that are fixed words
  the projection prints anyway (`gene`, `id`, `name`, `rows`, ...) are never protected, nor is a
  rename that shows the original anyway: a case-only change (`BETA` -> `beta`) or the original as a
  whole word inside the new name (`beta` -> `beta_discovery`).
- Category levels: originals of keyed levels and of explicitly remapped levels are protected
  terms; a level mapped to itself up to case (`disease` -> `Disease`) is not. `protect_levels:
  false` on a categorical column opts its originals out (for everyday words such as `healthy` or
  `male` that the prompt or a text column legitimately uses); the levels are still remapped.
- `missing` codes (default `["", "NA"]`) pass through unchanged in every role.
- `rows` slices a table while the verified source streams, so a region of a whole-genome file
  stays tied to the pinned public download (its sha256), not to a hand-made derivative:
  `{"region": {"chromosome_column": "CHR", "position_column": "BP", "chromosome": "2", "start":
  1000000, "end": 2000000}}` (inclusive; `chromosome` may be a list of spellings; rows with a
  missing position are dropped, a non-integer position refuses) or `{"in": {"column": "SNP",
  "values": [...]}}`. Columns are original headers (any role, `drop` included). The filter is
  host-only and sealed (`filters` in the seal); the contract marks the table `subset: true`.
  Original identifiers, protected keyed levels, chromosome labels and positions are collected
  before filtering for leakage and expressibility checks. Only retained identifiers receive
  public tokens. Each additional pre-filter protection category is capped at 2,000,000 distinct
  values; exceeding it refuses early and requires pre-filtering the source file.
  `answer_key.py` still receives the whole source and must apply the same slice when the answer
  should come from the slice.
- `row_order` (`keyed` default, or `keep`), `column_order` (matrix identifiers) and `list_order`
  (identifiers inside one list cell) permute order with HMAC keys, so source order (often
  alphabetical: sorted gene lists, sorted feature rows) cannot rank tokens back to originals.
  `keep` is recorded in the contract as `source`; use it only when order carries meaning.
- Columns whose original or public name is an outcome-derived feature
  (`policy.forbidden_feature`, e.g. `reported_gene`, `l2g`, `max_phase`) must be dropped.

Each projected dataset gets a keyed letter (`A`, `B`, ...); tables land at
`data/<letter>-<public_name>.tsv`.

### answer_key.py protocol

`python -I -B answer_key.py SOURCES_DIR` on private **unblinded source-format copies**
(`SOURCES_DIR/<source name>`, retaining the declared compression). Retained decimal cells
contain exactly the rounded and perturbed values used in the projection. Original identifiers,
headers, coordinates, metadata and file boundaries are retained so the same parser works.
Excluded rows remain unchanged; the answer script must still apply the declared slice.
Expectations are computed from these transformed copies, never from the pre-perturbation
measurements. This applies to numeric values, sets, rankings, signs and verdicts alike.
Literal `expect` criteria remain trusted author assertions; use `answer` for data-derived results. It must print one canonical JSON object
(`json.dumps(obj, sort_keys=True, separators=(",", ":"))`, optional trailing newline) and exit 0.
It runs with a fixed minimal environment (no host variables; private HOME, TMPDIR and cwd under
the host root's scratch), no stdin, and a seatbelt profile that denies all network, denies
reading the host sealing key and anything else in the host root (other cards, the registry, the
download cache) except its own sources, and denies writes outside its own run directory. It runs twice by
default; differing output, a non-zero exit, a timeout (the whole process group is killed),
non-canonical or non-strict JSON (duplicate keys, NaN) all refuse the build. Its stderr is never
shown. Interpreter: the pixi python (stdlib, numpy, scipy, pandas, statsmodels available).

### Criteria

| kind | report value | expected value | passes when |
|---|---|---|---|
| `verdict` | a string | one of `allowed` | report is in `allowed` and equals expected (use for "this does not hold up") |
| `exact` | any JSON | any JSON (with `namespace`: one original identifier) | strict JSON equality (bool is never a number) |
| `band` | a number | a number (with `absolute`/`relative`) or `{"lo","hi"}` | inside the band |
| `sign` | a number | a number | same sign (zero only matches zero) |
| `set` | list of distinct strings | list of strings (with `namespace`: originals) | Jaccard >= `min_jaccard` (default 1) |

Each criterion has `name`, `kind`, `report` (JSON pointer into report.json) and exactly one of
`answer` (pointer into answer_key.py output) or `expect` (author literal). `namespace` maps
expected originals to their public form (an unknown original refuses the build): an identifier
namespace (keyed tokens), `dataset` (dataset letters), `level/<public column>` (category
levels), `chromosome` (keyed chromosome labels `c1..`) or `position` (exact only: one original
coordinate to its remapped or shifted coordinate; refused when the coordinate maps differently on
two chromosomes). Dataset letters, levels and chromosome labels are small public sets, so like
verdicts they are not refused when they appear in the prompt; identifier tokens and positions
that are answers always are. `in_data: true` declares that an expected number is a raw data value
(a lookup) so the leakage scan does not refuse it as a data cell; it is still refused in prose.
`description` is public. All criteria are required for a total `pass`.

**Expressibility.** A card must be passable from the projection alone. The build refuses
(`criterion <name>: expected value is an original; declare its namespace`) when a criterion
without an answer map expects a string, set member, object key or nested string that is or
contains a protected original (identifier, level, dataset name, chromosome, renamed column,
filename, case id, URL, redact term): the analyst only ever sees tokens, letters and `c1..`
labels, so such a card would calibrate yet fail every honest solver. An integral expected number
(exact or band) equal to an original coordinate of a position column is refused the same way,
unless it uses `position`, or declares `in_data` and that number is printed in a projected
non-coordinate cell (for example a sample-size column).

Public (TASK.md, DATA-CONTRACT.json): names, kinds, report pointers, namespaces, allowed
verdicts, descriptions. Host-only (`criteria.json`, hash-bound into the seal): tolerances and
`in_data`. Sealed only: every expected value.

## What the analyst receives

Exactly these files (KA0 metadata rules: modes 0644/0755, mtime 2000-01-01, no user xattrs or
flags, single-link regular files, lstat before every read):

- `data/<letter>-<table>.tsv` — blinded tables (tab-separated, csv-quoted only where needed);
- `data/<namespace>-aliases.tsv` — K1a-format alias registry of every token (`contracts.alias_registry`);
- `TASK.md` — the rendered prompt, the file list, and a generated report section;
- `DATA-CONTRACT.json` — `{"public": {"content", "hash"}}`, schema `omb-oneshot-contract/v1`:
  datasets, namespaces (kind, entries, registry hash), tables (path, sha256, layout, rows,
  public column roles/storage/precision/levels, matrix description, order, missing codes), the
  public criteria view and fixed limitations;
- `manifest.json` — `{synthetic, files: {path: sha256}, publicContractHash}` (KA0 shape).

## The host card

```
CARD/card.json                 discovery TaskCard (validate_card); datasetManifestHash pins the projection
CARD/criteria.json             host criteria view (no expected values)
CARD/calibration.json          reference passes; empty, verdict flips and naive reports fail
CARD/oneshot.json              bindings: card, manifest, criteria, public contract, ciphertext, calibration, key id, build id
CARD/SEALED-KEY.json.enc(.sha256)  seal v2: expected values, mapped naive reports, protected terms,
                               canary, answer/answer_key/source hashes, all binding hashes, build id
CARD/stage.py, CARD/check.py   entrypoints (byte-pinned)
CARD/inputs/                   the analyst projection
```

`serve` and `grade` re-verify the card first: exact directory allowlist (an extra file
refuses), canonical JSON, card/criteria/manifest/calibration/ciphertext hashes, the full
projection (manifest pin, metadata, every byte, contract envelope), then decrypt the seal, check
that it names this card, manifest, criteria and contract, and re-run calibration from the sealed
expectations. Any failure refuses (`grade` returns `{"status": "refused", "reason":
"card-integrity", "criteria": []}` and does not burn the context).

**Build pin (revocation).** Rebuilds are deterministic (same key, case and variant give a
byte-identical card.json and criteria.json), so the seal alone cannot tell an earlier build from
the current one. Every build therefore draws a random build id, seals it, writes it to
`oneshot.json`, and, only after the new card verifies, registers `(card id -> ciphertext hash,
build id)` in `BIO_GRADING_ROOT/oneshot-registry.sqlite`, replacing any earlier build of that card
id in any directory. `verify`, `serve`, `grade` and `scan` refuse a card that is not the latest
registered build of its id ("revoked or unregistered"): an earlier seal replayed into a rebuild, a
whole earlier card directory restored, or a card copied in from another host root. Card ids are
therefore unique per host root. The pin lives outside the card directory; someone who can also
rewrite the registry can roll it back (keep the host root itself write-protected).

`serve` then reserves `(context, case id)` in `BIO_GRADING_ROOT/oneshot-registry.sqlite`
**before copying** (also passing through KA0's `CardRegistry`), copies with `copy_analyst`,
re-verifies the copy and re-runs the leakage scan with the sealed protected terms. A context gets
one card of a case (any variant, any key), once; a crash mid-copy burns the look. `grade
--context-id` requires that this context was served exactly this card (bound by case id and
ciphertext hash, never by directory name) and burns the one grade before reading the report.

Grade output: `{status, card, mode, report: valid|invalid, verdict: pass|fail, criteria: [{name,
passed}], passed, total}`. Malformed reports (bad JSON, duplicate keys, NaN, non-object, symlink,
over 1 MiB) are graded with every criterion failed. No expected or reported value, tolerance or
distance ever appears.

## Build pipeline

1. Validate case.json strictly; validate card overrides with `validate_card`.
2. Stage sources (local preferred; downloads <= 1 GB) into a private scratch under
   `BIO_GRADING_ROOT` (operation lease held), hashing every byte.
3. Stream tables (with any `rows` slice); refuse undeclared columns, undeclared levels,
   non-numeric numbers, ragged rows, outcome-derived feature columns, and anything over a size gate.
4. Build keyed maps (namespaces, dataset letters, levels, chromosomes, coordinates, orders).
5. Write the projection from blinded values only; normalize and deep-verify it.
6. Run answer_key.py (sandboxed, twice); resolve and map expected values; map naive reports.
7. Calibrate (reference passes; empty, verdict flips, naive fail) or refuse.
8. Leakage scan (below) and token/original collision check, or refuse.
9. Write the card, seal, bind, verify; any failure (or injected fault) removes the card directory.
   Scratch is always removed.

## Threat model

**Assets.** The expected values; the identity of the case (dataset, genes, samples, levels,
files) whose recognition enables recall instead of analysis; the host sealing key.

**Adversaries.** (1) The analyst model: reads everything in its projection, may know the public
literature and try to de-blind, may try to get several looks or grades to hill-climb. (2) A
careless case author: a prompt or kept column that names a gene, an accession, a filename or the
answer. (3) Anyone with write access to a card directory but not the key: swapping ciphertexts,
editing manifests, criteria, calibration or entrypoints, adding files.

| Threat | Defence | Tests |
|---|---|---|
| analyst sees originals | keyed tokens for every declared identifier, level, chromosome, dataset; renamed/dropped headers; keyed row/column order; construction from blinded values only | `test_oneshot` e2e, `test_oneshot_leakage` |
| author leaks via prompt/text columns/filenames/accessions/redact terms | leakage scan of the exact projection, fail closed, redacted findings; accession-like tokens (`GSE12345`, `PRJNA123456`, ...) from source paths, URL folders and queries, dataset names and the case id are protected | `test_oneshot_leakage` (build-level positives; mutation-checked) |
| answer leaks into the projection | expected strings/tokens refused in prose; expected numbers compared by **value** (Decimal), never by spelling, so any sign, leading or padded/trailing zeros, exponent form in either case (`6.7283E-02`, `6.7283e-2`), thousands commas and numbers carried as strings all match: refused in prose when a rounding to 3+ significant digits (or an integer of 2+ digits) appears, and as a data cell (unless `in_data`) when a rounding to 6+ significant digits appears; numeric JSON metadata checked too (including single-digit answers), exempting only non-negative integer table row counts, namespace entry counts and matrix widths at their exact public-contract paths; plaintext copies of sources/answer refused; canary | `test_oneshot_leakage` |
| answer leaks on the host side | expected values live only in the seal; calibration control names are opaque (no flipped verdict named); build/dry-run output carries outcomes only | `test_oneshot_grade` |
| second look / hill-climbing | registry: one look per context per case, one grade per context per card, reserve before copy | `test_oneshot` |
| linking two variants of one case | tokens, orders, letters, levels and chromosome labels differ per variant and key; **data values do not** (identical values link variants), so the per-context registry is the defence; optional `perturb` breaks exact-value joins | `test_oneshot_leakage` (`test_variants_link_by_identical_values_unless_perturbed`) |
| grade output reveals the key | only names and booleans; identical output across keys; refusals carry nothing | `test_oneshot_grade` |
| card tampering | allowlist, canonical JSON, hash bindings, seal v2 MAC, sealed bindings to card/manifest/criteria/contract/build id, calibration re-run, pinned entrypoints, host build pin (an earlier build's seal or directory is revoked by a rebuild) | `test_oneshot_tamper` |
| bad or hostile inputs | sha256 pins, size caps, https-only downloads, strict JSON, sandboxed answer key | `test_oneshot_sources`, `test_oneshot_answer` |

**Limits (not defended; documented).**

- This is a **data-flow boundary, not an OS sandbox.** Production must give the analyst its own
  account/mount with no access to `BIO_GRADING_ROOT`, the case directory, the key or this
  repository (as for KA0).
- **Numerical fingerprinting.** Exact measurements, row counts, column counts and distributions
  can identify a public dataset (and its paper) without any name. Use rounding `precision` where
  exactness is not needed, keep `recallExposure`/`contaminated` honest on the card, and prefer
  post-cutoff data for held-out claims. No scanner can prove de-identification.
- **Variants link by values.** Projections of one case under different variants or keys are
  linkable through their data values (see "Variants and linkability"); a variant is a fresh
  token space, not a fresh case. `perturb` defeats exact joins only.
- **Term matching rules.** Terms with a letter and >= 4 characters match ASCII-case-insensitively
  at alphanumeric boundaries; 3-character terms match case-sensitively; shorter terms match only
  as a whole TSV cell / JSON string (and case-sensitively in TASK.md); purely numeric originals
  (e.g. sample IDs `101`) are protected only by structural replacement, never by the scan. A
  short original equal to a dataset letter (`A`, `B`, ...) is checked only inside data cells,
  because the letters are printed in file names, the contract and the prompt. Free `text`
  columns are passed through and only scanned. Non-ASCII case folding is not applied.
- **False refusals are possible by design** (fail closed): an original that equals a public
  word or a keyed token refuses the build. The message names the token class: identifier tokens
  (rebuild with another variant or key, or set a prefix), level tokens `L1..` (map those levels
  explicitly), chromosome tokens `c1..`.
- `answer_key.py` is trusted host code; the sandbox is defence in depth, not containment of a
  malicious author. Steganography in the data cannot be excluded by scanning.
- `DATA-CONTRACT.json` is the oneshot public layer, not a K1a v3.1 contract: a generic harness
  cannot author unit graphs, dependence or summary-statistic semantics for arbitrary cases. A
  case that needs K1a semantics needs an author-written contract (see `contracts/`).
- **Size gates** (`tables.py`), set to what the streaming build processes on a 16 GB workstation.
  Sources are parsed as streams (two passes: keyed maps, then blinded rows written through a
  byte-offset index for keyed row order); the leakage scan, deep verification and serving stream
  too. What stays in memory are the keyed maps, so the gates bound them: at most 2 GiB of decoded
  bytes per source (any compression; an uncompressed file over it is refused before parsing),
  2,000,000 kept rows per table, 30,000,000 projected cells per case and 2,000,000 distinct
  identifiers per namespace. Measured on synthetic 8-column summary statistics: a region slice of a
  4,000,000-row (220 MiB) gzip source builds in 9 s at 117 MiB peak RSS; a whole 2,000,000-row
  table builds in 64 s at 1.9 GiB (serve 14 s, 1.3 GiB); one row more is refused after 2.5 s with
  a hint to declare a `rows` filter. Downloads stay capped at 1 GB.

## Tests

```sh
export PATH=/opt/homebrew/opt/node@24/bin:$PATH
packages/bio-baseline/.pixi/envs/default/bin/python packages/bio-tasks/test/run.py \
  test_oneshot test_oneshot_tamper test_oneshot_leakage test_oneshot_sources test_oneshot_grade test_oneshot_answer \
  test_oneshot_expressible test_oneshot_scale test_oneshot_formats
```

Each test gets a private temp tree with its own `HOME` (so seal v2's operation root never
touches the real `~/.omerta-bio`), host root and key, and deletes it afterwards. Network: only a
loopback HTTP server the source tests start.
