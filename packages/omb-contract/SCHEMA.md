# Data contract v3.1 — K1a

The static validator guarantees **structural consistency + identity closure of the supplied
declarations**, within the documented resource bounds. It checks shapes, references, provenance
declarations, canonical JSON hashes, and all declared public/private unit equalities together.
Any declared shared identity that crosses dev/held-out, changes allocation, resets a burn, or
loses a recorded look is refused. It does not establish that declarations match real data,
that a producer is authentic, or that an omitted identity relationship does not exist.

This package freezes a structural interchange format. `validateDataContract` returns either
`{ok:false, errors}` or `{ok:true, value, verification:"structure-only"}`. The latter is
**never a G1a/G1b pass, authority approval, verified citation, or eligibility for Confirmed**.
No files are opened by the library, no analyst data is inspected, and no certification is run.
K1b must verify the statements against host-pinned immutable bytes. K3 supplies provenance.

`src/schema.ts` is the single source of TypeScript types and the exported Draft 2020-12 JSON
Schema. `data-contract.schema.json` is the generated portable shape schema. JSON Schema checks
shape; the TypeScript validator additionally checks references, graph consistency, evidence
coverage, normalization declarations, and content hashes. Consumers must run both layers of
checks (the TypeScript validator already does this). They must not use a third-party shape
validator alone as equivalent to `validateDataContract`.

## Envelope and visibility

| Field | Meaning |
|---|---|
| `public.content` | Analyst-visible `PublicLayer`: version, structural facts, producers, evidence. |
| `public.hash` | Lowercase SHA-256 of canonical UTF-8 `public.content`, without this envelope. This is the contract hash bound by the plan. |
| `sealed_private` | Optional **host-only** envelope, not an analyst artifact or an encryption container. |
| `sealed_private.content` | Complete checker truth, independently interpretable, not a partial overlay. Uses the same structural schema and its own evidence/producers. |
| `sealed_private.content.public_hash` | Exact public hash this private version accompanies. Dataset IDs must match. |
| `sealed_private.content.planted_defects` | Private records: unique `id`, description, and existing `affected_nodes`. Never copied into analyst limitations or reports. |
| `sealed_private.hash` | Independent SHA-256 of the complete private content. The public hash contains neither this hash nor a private reference. |
| `schema_version` | `omb-data-contract/v3.1` publicly; `omb-data-contract-private/v3.1` privately. Unknown versions are rejected. |

The full `DataContract` is a **checker/host transport type**. Naming a property `sealed_private`
does not secure plaintext. The host stores contracts, resolutions and locks under the separate
`_ombcert` authority account with authority MACs. Without that OS-user setup, curated contracts
cannot support Confirmed. A hash authenticates no producer and grants no access control.

The analyst process receives only `analystView(publicEnvelope)` or its canonical bytes. This
helper accepts a public envelope, rejects extra keys, validates it, and returns a detached copy.
The host must never give the analyst a full `DataContract`, private hash, private pathname,
private error, or object whose serialization can include private data. Store private bytes
outside every analyst mount and read root; deny raw/work directories as contract sources;
exclude private data from prompts, tool responses, env vars, debug logs, traces, crash reports,
source maps, caches, exported ledgers and report bundles. Do not symlink the private store into
an allowed root. Public projection is performed in the host before IPC. The certifier receives
both layers directly from the host with expected hashes; it must not discover them by scanning
`rawDir` or the worker's output. Private validation and reconciliation return generic errors without private IDs or values; route even these categories only to the host.

For benchmarks, the checker uses the complete private truth for verification, while the plan
binds the analyst-visible public hash. Both hashes must enter host look/gate bindings. The
private layer may add conservative truth. Hierarchies and shared node identities must agree;
shared partition/group IDs must describe the same records. The trusted validator combines both
graphs, normalized node originals, aliases, collision merges, groups and partition histories, so private burns, technical identity and prior dev exposure
constrain public partitions and L2. Conflicts are refused with generic errors. Absence of private truth is acceptable
for ordinary public-data contracts, but a benchmark host requiring private truth must refuse
its absence. K1a does not implement OS isolation, MACs, encryption, or gate wiring.

## Structural fields

All fields below are required, except the outer `sealed_private`. Empty arrays explicitly say
that no declarations have been recorded; they never prove the absence of unknown replicates,
dependence, leakage, missingness, or defects. Nullable fields are explicit unknown/not-applicable
slots; downstream claims using missing facts remain unverified. An uncertain value may instead
be recorded conservatively with `assumed` or `contested` evidence and a note.

| Path under `structure` | Meaning and constraints |
|---|---|
| `dataset_id`, `dataset_type` | Stable dataset ID; exactly `subject-level`, `feature-level`, or `summary-statistic`. |
| `source_files[]` | Immutable source snapshot inventory, each `{path, sha256}`. Paths are relative logical artifact names: no absolute paths, traversal, empty components, backslashes or NUL. File existence and hash verification belong to K1b. |
| `namespaces[]` | Unique namespace IDs, `entity_kind` unit/feature/variant, `level` (required hierarchy level for units, null otherwise), normalization rule set `rules`, literal `preserve_originals:true`, literal `collision_policy:"merge-with-limitation"`. No ambient/default normalization. |
| `graph.nodes[]` | Unique `id`, `kind`, hierarchy `level`, source `namespace`, and `original_id`. Namespace/normalized-original pairs are unique; duplicates are conservatively unified by the resolver and the redundant node declaration is refused. Nodes represent concrete entities, not the count of independent observations. |
| `graph.nodes[].kind` | `specimen/sample`, `donor/subject`, `randomization-unit`, `dependence-cluster`, or `target-population`. |
| `graph.edges[]` | Existing distinct `from`/`to` node IDs plus `relation`: `sample-of`, `assigned-with`, `dependent-with`, `member-of-population`, `derived-from`. Every edge points to a strictly coarser hierarchy level. The graph is acyclic; sample-of has a specimen source and donor target. Other typed membership relations require the corresponding target kind. Crossed dependence is represented by multiple cluster memberships, not cycles. |
| `unit_hierarchy[]` | Unique level `id`, nullable `coarser_level`, `minimum_independent` boolean. One rooted, acyclic parent hierarchy and exactly one marked independent floor. Multiple dependence groupings remain in the graph. The floor must be at or above every sample-of donor/subject target, including across hierarchy branches. A specimen at the floor with coarser declared ancestry is refused, even if the parent was relabelled. Marking a floor still is not a proof of independence. |
| `tables[]` | Unique `id`, hashed `file`, nonempty ordered `row_key` column names, `columns`, `unit_derivation`, `orientation`, and fixed `alias_coverage` policy. Table paths and column names must be unique in their scopes. Every row-key column has a resolvable namespace (declared aliases or a registry, plus graph nodes for unit namespaces). Every feature/variant-oriented table has matching registered feature/variant row keys; an unrelated table cannot satisfy this requirement. |
| `tables[].orientation` | `layout`: records/matrix; `unit_axis`: rows/columns; `row_entity`: units/samples/features/variants; nullable `header_namespace`. Records require row units and no header namespace. Matrices require a registered header namespace. Column units require feature/variant rows. This is a declaration; K1b resolves both axes and refuses both/neither unit axes. |
| `tables[].alias_coverage` | Literal `{rows:"all", matrix_headers:"all", unresolved:"refuse", ambiguous_axis:"refuse"}`. Every row key and every matrix entity header must resolve. Ordinary column labels such as `gene` or `age` are schema labels, not entity headers. |
| `aliases[]` | Closed-world unit-only `{namespace, encoding, original, canonical, node}`. Encoding is token/canonical-json-array. The graph node must match the namespace and its declared level. Feature/variant aliases live exclusively in registry sidecars. Namespace/encoding/original must be unique. No unknown-token fallback, guessed ID, or row-number identity. |
| `alias_registries[]` | One pinned canonical TSV per namespace, `{namespace,file,format:"omb-alias-registry-tsv/v1",entry_count,coverage:"verify-against-data"}`. One evidence entry covers each complete descriptor. Required for feature/variant resolution; optional for units. Inline aliases and a sidecar cannot coexist in one namespace. |
| `collision_merges[]` | `{namespace, encoding, canonical, originals, merged_node, limitation}`. Token and tuple aliases are keyed by normalized component tuples (token X means [X]); representation alone is not a collision. All distinct original component tuples that normalize to a common canonical value must resolve to the same existing node and have an exact merge record listing all original spellings. An orphan merge is invalid. Merge membership needs provenance. Identity closure always unifies declared equalities conservatively; contradictory alias declarations are still refused. |
| `joins[]` | Unique `id`; `from_table/from_columns` and `to_table/to_columns` ordered tuples of equal arity and matching namespaces component by component; cardinality exactly one-to-one, many-to-one, one-to-many or many-to-many; `unmatched`: refuse/exclude-with-lineage. K1b checks actual cardinalities, consistency, exclusions and row inflation. A declared many-to-many join never establishes independent n. |
| `batch[]` | Table/column references to structural batch columns. Every batch column needs this annotation. |
| `time[]` | `column` reference, ASCII-ID `index_event`, `relation` (pre-index/at-index/post-index/mixed/unknown), and time `unit`. Exactly one annotation per (column, normalized index_event), where events are lowercase ASCII IDs matching `[a-z][a-z0-9-]{0,63}`. Human labels, Unicode homoglyphs, ignorable characters and alternate punctuation spellings are refused; different registered annotation IDs remain allowed. Every structural time column needs an annotation; unknown time cannot support time-sensitive certification. |
| `dependence[]` | Unique `id`, kind independent/nested/repeated/crossed/unknown, `unit_level`, cluster-node IDs, description. At least one declaration required. Dependent designs require declared dependence-cluster nodes; independent/unknown may have none. |
| `assignments[]` | Unique exposure-column metadata and an `assignment_unit` **hierarchy-level ID**. This is a fact about collection/assignment for a candidate exposure, not selection of an analysis role. Mechanisms below. |
| `replicate_groups[]` | Unique `id`, technical/biological `kind`, at least two distinct existing member nodes, existing `grouping_node`, `handling` (collapse/model-dependence/retain-distinct), rationale. Members share a level, exclude the grouping node, and descend from it. Technical groups cannot retain-distinct and always share material identity even with model-dependence. Biological groups also share partition/burn dependence regardless of handling; this does not itself determine their scientific effective N. A target-population node cannot attest a shared replicate source. |
| `partitions[]` | Unit-level snapshots, described below. An empty list does not establish a held-out claim. |
| `forbidden_uses[]` | Column reference, nonempty uses drawn from outcome/exposure/covariate/identifier/split/feature, and reason. Forbids uses only. No selected outcome, exposure, covariate, procedure or test name belongs here. Those choices live in `plan.json`. |
| `survival[]` | Unique endpoint metadata IDs with risk-set and event semantics below. These structural facts do not choose an inferential procedure. |
| `row_exclusions[]` | Source `row:{table,key}` (ordered original string tuple, matching row-key arity), reason, producer ID, literal `outcome_blind:true`, and existing `lineage_id`. Duplicate exclusions are rejected. The producer must be outcome-blind stager/task-author and must appear in evidence for every exclusion field. Lineage must be an outcome-blind-filter, complete-case, or join transformation consuming the excluded row’s table. An exclude-with-lineage join requires a join transformation consuming exactly both declared tables and exclusions bound to that transformation. Curator-only provenance is refused, also for unmatched join exclusions and transformations. |
| `transformations[]` | Unique `id`, operation, pinned `implementation_hash`, `registry_version`, literal `row_lineage_format:"omb-row-lineage/v1"`, input table IDs, output table ID, parent transformation IDs, hashed `row_lineage` artifact, additional `output_files`, `producer_id`, and literal `outcome_blind:true`. The producer must be outcome-blind stager/task-author and attest every transformation field and every output-table field (including file path/hash and columns), with neither assumed nor contested status. Worker-defined operations are forbidden; both parent and table dataflow graphs must be acyclic. Parent IDs must exactly match the transformations producing the input tables. Filter/complete-case operations require explicit row exclusions. Each output row must eventually be verified back to immutable source rows. |
| `summary_statistics` | Null except for summary-statistic datasets, where complete GWAS metadata is required. |
| `limitations[]` | Explicit structural limitations, never a way to waive a required check. No private defect text is permitted in an analyst-visible layer by host policy. |

### Unit derivation and namespaces

`unit_derivation` is exactly one tagged variant:

* `column-tuple`: nonempty ordered `columns`, `encoding:"canonical-json-array"`, namespace,
  level. After per-namespace normalization of component tokens, serialize the ordered tuple as
  a JSON array with `canonicalTuple`. Never concatenate with a delimiter. Register its encoded
  original and normalized forms explicitly. This variant requires row units.
* `row-key-regex`: anchored `pattern`, `capture_group:1`, namespace, level; one row-key column
  and row unit axis. Maximum 512 pattern characters and 512 matched ASCII characters. One
  unquantified capture; ASCII literals, escaped `-_.`, and explicit positive ASCII character
  classes using letters/digits/underscore/colon/hyphen only. Repetitions are `{n}` or `{n,m}`
  with 1 ≤ n ≤ m ≤ 256. At most ONE variable-width atom in the whole pattern; this prevents
  combinatorial backtracking even for overlapping classes. No `+`, `*`, `?`, wildcard,
  complementary/negated classes, alternation, nested groups, backreferences or lookarounds.
  K1b must enforce the 512-character input bound and full-match semantics. Unsupported IDs
  use column-tuples or a pinned unit map. K1a never executes a pattern against data.
* `sidecar`: hashed `map`, `key_encoding:"canonical-json-array"`, namespace, level. The proposed
  sidecar encoding is an object mapping canonical JSON arrays of original axis-key components
  to original unit ID tokens. For a matrix with column units, keys describe entity headers;
  row features resolve separately in the alias registry. K1b verifies map bytes and exhaustive,
  unique coverage before following aliases. Sidecar files cannot be worker replacements.

All derivations must use a **unit** namespace at `unit_derivation.level`. Every inline node
alias agrees with that level. Tuple component columns use the same namespace. Matrix header
and derivation namespaces must agree. Sidecar node targets/levels are checked against bytes by
K1b before use; the declaration alone never resolves a unit.

Identity hygiene is unconditional: remove every Unicode `Default_Ignorable_Code_Point`
and normalize canonical equivalents to NFC before namespace rules. `remove-zero-width` remains
an accepted rule name for compatibility but cannot disable this baseline. Namespace rules are
a set: ASCII folding decomposes first (so NFC/NFD and ASCII base-letter case agree), then
NFKC if requested, ASCII trimming, ASCII folding again, and strict canonical decimal conversion.
Repeat to a demonstrated fixed point, at most eight passes. `007` and `+7` are not strict
decimals and remain strings; `7` becomes `7e0` with canonical-decimal. No universal Unicode
case folding or permissive numeric coercion is implied. Original wire strings are retained.

Tokens/intermediates are limited to 1,024 UTF-16 units, 32 consecutive marks (linear scan),
and at most 4x Unicode expansion. Each resolver/layer has an 8-million-unit weighted Unicode
work budget (non-ASCII scans charge 8 units per UTF-16 unit, ASCII scans 1). ICU input and output
both count. Public/private reconciliation uses a bounded number of these passes. Paths share
the layer budget and are cached. Exhaustion deterministically refuses; no production clock
is consulted. Tuple aliases count embedded components against aggregate MAX_JSON_VALUES,
and each tuple is limited to 65,536 components before normalization. `normalizeAlias` checks
canonical tuple spelling and normalizes components; K1b must reuse it with a shared UnicodeBudget
for streamed cells, not allocate an unlimited succession of independent budgets.
A token literally containing `["X"]` remains distinct from the tuple containing `X`.
Collision records may use either encoding, with originals expressed in that record's encoding.

### Hashed alias registries and file provenance

Every feature or variant row-key namespace resolves through exactly one pinned registry.
Unit namespaces may instead choose a registry for larger cohorts; graph nodes and floor identity
remain closed-world contract facts. `entry_count` is a positive count of alias rows, not effective N. Unit registries require graph
nodes in their namespace and a declared count of at least the graph node count. There is
no fabricated upper bound based on merge spellings: exact counts, target coverage, and actual
normalization collisions are K1b byte checks. Single-component merge targets must agree with
normalized node originals; multi-component registry merges may declare a tuple targeting a
node, with exact tuple-to-node contents left explicitly unverified until K1b reads the registry.
Registry paths are unique after NFC plus conservative Unicode case folding, and registry
hashes cannot equal any table, unit-map, allocation, sequence, LD, citation, transformation
output, or other registry hash. Source and table path uniqueness uses the same folded form;
source-table references must retain the pinned source spelling. Paths have a 1,024-code-unit
and 32-consecutive-mark limit before normalization. Exact file bytes remain K1b checks.
The format `omb-alias-registry-tsv/v1` has UTF-8 without BOM, LF line endings, a final LF, and
this literal header: `namespace\tencoding\toriginal\tcanonical\ttarget` (tabs between fields).
Namespace and encoding are bare ASCII identifiers; the last three cells are each a **canonical
JSON string** (including quotes). Thus tabs/newlines/backslashes in identifiers are escaped and
cannot create extra TSV fields. A tuple original is a JSON-array string inside that JSON string.
Rows sort by UTF-8 bytes of (encoding, original) after cell decoding; duplicate original keys are
forbidden. Each row's namespace equals its descriptor's namespace. A unit target is an existing
node ID at the namespace level; a feature/variant target is an opaque nonempty feature ID and
never a subject. Token/tuple equivalence and normalization/collision rules are identical to inline
aliases. Unit collisions need exact contract `collision_merges` with a limitation; feature/variant
ambiguity must be resolved explicitly before verification.

`sha256` hashes the **raw canonical TSV bytes** (not JSON serialization of the file).
`evidencePointers` emits just `/structure/alias_registries/i` for each descriptor, covering its
entire pinned file declaration, rather than one entry per alias. No other ancestor evidence is
allowed. K1b must verify canonical bytes, hash, count, namespaces, normalization, collision rules,
unit targets, and exhaustive row/header/data coverage. Missing or unavailable registry bytes
cannot count as verified. K1a deliberately does not open registry files.

Every table must match the path and hash of either a source file or exactly one transformation's
`output_table`. An output cannot also be a source, including equal bytes under a different path; output and lineage hashes cannot reuse other output/source artifacts. The only auxiliary output is that
transformation's dedicated `row_lineage` file, listed exactly once in `output_files`. Registries,
unit maps, allocations, sequence allocations and LD references must match source files; an
auxiliary output cannot establish their provenance. Inputs reach source tables through acyclic
dataflow. Every source-file leaf needs non-assumed, non-contested attestation by an outcome-blind
stager or owner. Every producer's `source_bundle_hash` equals `contentHash(source_files)`.

Transformations are refused unless the caller supplies a trusted `ValidationContext` with
`derivationRegistry:{version,implementations:{[operation]:implementationHash}}`. Both the version
and operation hash must match. There are no default registrations, and contract-provided
software producers cannot substitute for an eligible stager/task-author. The host constructs
this context from its pinned implementations, never from analyst or contract bytes. Pass it as
the second argument to validators/parsers and `analystView`, or the third argument to
`buildContract(publicLayer, privateLayer, context)` / `validatePartitionArtifact(l1, value, context)`.
This is a pre-integration v3.1 tightening; existing transformation records need the two new
required fields and host registration. No code execution or implementation authentication occurs
inside this package.

`omb-row-lineage/v1` declares a JSON array of `{output:string[], inputs:{table:string,key:string[]}[]}`
records using original ordered row keys. The dedicated generated artifact must be produced by the
registered implementation. K1b must open it, validate every record, and verify complete input/output
and exclusion coverage against actual tables. Merely naming a format is never byte verification.

### Columns and exact decimals

Each column has `name`, `storage` (string/decimal/boolean), `structural_kind`
(identifier/unit/batch/time/feature/measurement/annotation), nullable namespace,
nullable decimal_resolution, nullable measurement, and a list of exact lexical
`missingness_codes` (an empty string is allowed as a missing code). Identifier/unit columns
require a namespace. Every decimal column requires a strictly positive decimal resolution;
nondecimal columns cannot declare one. Resolution means a quantum such as `0.01`, not a binary
floating-point tolerance. K1b checks that observed nonmissing values fit the declared lattice.

The grammar is `-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?(0|[1-9][0-9]*))?`, full-string only:
no leading plus, whitespace, hex, NaN, infinity, separators, leading-zero integers, incomplete
fraction/exponent, or leading-zero exponent. Negative zero is valid as a **decimal string**. Decimal tokens (including exponents) are capped at 1,024 characters in helpers and schema. A canonical-decimal namespace also rejects longer ID tokens. Trailing zeros are stripped from strings before BigInt conversion, avoiding repeated large-integer division.
`decimalParts` stores exact bigint coefficient/exponent; `canonical-decimal` emits normalized
`coefficient e exponent` (zero is `0`). `compareDecimals` never converts to floating point.
Numeric data tokens are strings; JSON numeric metadata uses nonnegative safe integers only.

`measurement` records type (continuous, positive-concentration, bounded-score, count, binary,
ordinal, time-to-event), unit string, nullable bounds `{lower,upper}` in exact decimal strings,
and ordered categories. Bounded scores need increasing bounds. Binary needs exactly two
categories; ordinal needs at least two. Numeric measurement types require decimal storage.
A structural `measurement` column must have measurement metadata. A time or other column can
also have it. K1b must reject a plan-selected outcome without appropriate measurement metadata;
renaming an annotation does not upgrade it. Missing codes are checked before decimal parsing;
K1b checks code/value ambiguity rather than silently treating a valid zero as missing.

### Assignment, survival and summary statistics

`observational` records exposure and assignment_unit. `randomized-unit` adds the mechanism
text and a hashed allocation artifact. `randomized-within-unit-order` adds an order_column,
hashed sequence_allocation, and carryover status (excluded-by-design/modeled/unknown).
`blocked/stratified` adds nonempty block-column references, randomized boolean and nullable
allocation (required for randomized blocks). Cited allocation provenance does not itself prove
that randomization was implemented. Finer-than-biological assignment is representable; K2 may
admit only the specified sharp-null within-unit scope with its non-generalization limitation.

A survival record has `time` and `event` column references; `event_codes[]` with exact code,
meaning and event/censored/competing-event status (at least event and censoring meanings);
`time_origin:{index_event,column|null}`; nullable `entry_time`; `event_type` either
`{kind:"single",name}` or `{kind:"composite",components}`; nullable `censoring_reason` column.
Time must have time-to-event measurement metadata, an annotation relative to its own normalized
time-origin index event with post-index or at-index relation, and event must refer to a different column. A declared entry-time column needs an annotation against that same origin event. Unknown entry/censoring/origin details
remain explicit nulls, not defaults to independent censoring or entry zero. K1b checks complete
code coverage, time ordering, risk sets, and competing/composite semantics; K2 applies envelopes.

GWAS summary metadata has unique cohort IDs/accessions and ancestry. Each cohort declares
`trait_type:"binary"` with cases/controls, or `trait_type:"quantitative"` with positive sample_size.
A binary case-only cohort remains distinct from a quantitative population. Additional metadata:
genome_build; per_snp_n, variant_id, effect_allele and other_allele column references; and an
LD reference with accession, hashed file, ancestry and matching genome_build. Binary counts cannot both be zero. N must refer to a numeric count measurement. All cohorts share one trait_type. The four column
roles are distinct and belong to the same table; allele roles require string annotation columns without namespaces; variant_id is a row-key column in a variant registry namespace. Cohort IDs and provenance, not the number of
SNP rows, determine candidate independent sources. Cohort overlap is computed by K1b and cannot
be supplied as an analyst-controlled “no overlap” boolean. LD, allele alignment and per-SNP N
checks remain verification work.

### Partitions and burn state

Each partition has unique `id`, unit_level, seed_provenance and units. Seed provenance records
`method:"hmac-sha256"`, trusted stager producer ID, public key identifier (never the secret),
contract_hash and seed_commitment. Only the host sealer can actually establish this provenance.
The partition level must be the minimum-independent floor or an ancestor on the hierarchy.
Each unit has an existing node at unit_level and canonical commitment fields:
`identity_scope` is always the minimum-independent floor. `identity_key` names the normalized
original of the public floor node; aliases and sub-floor specimens never select it. Multiple
public floor nodes already unified in that public view select the least original tuple. A coarse
container uses the sorted JSON array of its covered floor tuple strings (one uses that tuple
directly). `coveredFloorIdentities(layer,node)` exports those strings individually for burn ledgers.
Use `IdentityResolver.commitment(layer,node)` to derive both fields; results are cached per root.
Public L2 commitments use only the PUBLIC identity view. Private-only unions constrain duplicate,
allocation and burn closure but do not change public commitment spellings. Private embedded
snapshots are checked in their own view and reconciled jointly. Benign aliases and finer specimens
leave commitments unchanged. A real change to floor membership can change commitments; compare
versioned snapshots through the resolver rather than trusting hash/key equality across datasets.
Arbitrary alternate scopes/keys
are refused, including when burns happen to agree. Allocation is dev/held-out/excluded; burn
is unseen or burned with nonempty unique look_record_hashes. Burned/unseen conflicts and
allocation flips are refused. Burn history may grow by a superset, but cannot shrink. Array
order is snapshot order (public embedded, private embedded, then new L2); K1b authenticates
chronology. Node/identity duplicates within one partition are refused.

`src/identity.ts` is the only identity authority. One union-find over canonical level-qualified
component tuples combines public and private node originals, token/tuple aliases, explicit
collision merges, overlapping same-level namespaces, shared sub-floor material, sample-of,
derived-from, dependent-with, and all replicate dependence. Same-level namespace rule sets
must agree; joined columns and same-level table/derivation columns need identical resolved identity domains (or the same declared namespace).
Private changes to shared rules, alias targets or node declarations fail generically; private
additions still contribute to the union. There is no distinct-entities escape hatch in v3.1:
ambiguous overlapping namespaces require a corrected, evidenced declaration before acceptance.
`resolve(layer, namespace, raw, encoding)` returns the union's canonical identity or throws.
It resolves explicit inline aliases and declared registry originals/merges. It never invents a
lookup for an unknown registry row or a bare graph original without aliases/registry coverage.

Coarser population/randomization containment is directional: its constraints propagate to
material descendants without equating unrelated donors merely sharing a population. Hierarchy
intervals distinguish ancestor levels from sibling branches. Derived units must reach a floor
identity; every unit-column namespace must also be floor-covered. The floor cannot be below a declared donor/subject or a coarser grouping target of a floor node, including relabelled specimens. Allocation/burn propagation uses the same condensed graph. Replicate ancestry and
burn-history propagation have deterministic 100,000-visit work limits; exhaustion is refusal,
never a passed or skipped check. No validator reads a clock. K1b/ledger still enforce external
cross-contract/cross-dataset exposure histories and authenticate actual looks and aliases.

Avoid a hash cycle: the HMAC input is the **antecedent L1 contract hash**, before assignment.
For a fresh run L1 has `partitions:[]`; L2 seals a separate `PartitionArtifact` and binds its hash in the timeline. Do not insert L2 assignments back into the already locked L1 bytes. An
embedded partition is a later snapshot whose seed points to an earlier immutable contract,
never its own enclosing content hash. The plan and gates bind both the unchanged L1 public hash
and the L2 partition hash. K1b must resolve and verify antecedent pins. Hash placeholders in
synthetic rich test fixtures are declarations only.

`PartitionArtifact` is `{content,hash}` with content `{schema_version:"omb-partition-artifact/v3.1",
dataset_id,antecedent_public_contract_hash,partitions,producers,evidence}`. `partition_hash` is
exactly `contentHash(content)`. `validatePartitionArtifact(l1, unknown)` validates the unchanged
L1 DataContract, artifact shape/hash, dataset and antecedent pin, every seed pin against L1, each L2 producer’s source_bundle_hash against L1 source_files,
producer/evidence references and all shared partition invariants. Evidence covers each leaf of
`/partitions` (no new L1 evidence). Embedded public and private historical burns, allocations and replicate identities must also agree with L2.
`partitionArtifactJsonSchema` and `partition-artifact.schema.json` define the closed wire format.

## Evidence and producers

`producers[]`: unique id, kind (task-author/curator/owner/stager/software), accountable name,
version, nullable model_family, source_bundle_hash, outcome_blind boolean. Curators require a
model family and outcome blindness. The host authenticates these records against its source
lock/MAC and records any owner approvals; self-declared kind is not authority. Different names
from one model family count as one curator. Agreement is corroboration, never ground truth.

`evidence[]` uses RFC 6901 pointers to every primitive leaf and empty container under `/structure`
(and private `/planted_defects`). Exactly one entry per leaf is required, except the explicitly atomic registry descriptor
`/structure/alias_registries/i`. Other ancestor entries cannot stand in for descendants. Each entry has status, nonempty producer_ids, citations and nullable
note. Envelope/version/hash/producers/evidence bookkeeping is not recursively self-cited.

| Status | Structural condition | Trust meaning |
|---|---|---|
| author | At least one task-author producer | Benchmark author assertion; must be host-sealed to carry authority. Citations may be empty for synthetic author truth. |
| cited | At least one citation | Citation is declared; K1b still verifies the immutable bytes and entailment policy. |
| assumed | Nonempty note | Unestablished conservative assertion. Two curators agreeing cannot upgrade it. |
| contested | Nonempty note | Unresolved readings; consequential dependencies remain restricted until safe coarsening or outcome-blind resolution. |

Every citation records file_sha256 from source_files, zero-based byte_start, exclusive byte_end,
and the exact UTF-8 quote. Spans must be positive and quote byte length must equal span width.
K1a cannot check whether the bytes at that location actually equal the quote. Uncited non-author
facts must be assumed/contested; “cited with zero citations” is invalid. An authenticated benchmark
author assertion is the explicit exception for synthetic truth.

K3 reads owner-admitted immutable sources through sandboxed templates, screens metadata for
injected instructions, and never sees analyst text or outcome–exposure associations. It compares
induced partitions, not column names: finest common coarsening for units, union for replicate
groups, intersection for held-out units, dropping cross-split merges. Auto-coarsening may allow
Confirmed after verification; unsafe-direction fields such as time zero or assignment need
claim-specific resolution. Free text can tighten, never loosen without structured spans.

## Canonical bytes, locks and amendments

`canonicalJson` delegates sorted-key serialization to read-only bio-core after rejecting
non-JSON values, nonplain objects, getters, sparse/decorated arrays, symbols, unsafe prototype
keys, nonfinite/unsafe integer numbers, JS negative zero, cycles and malformed Unicode. Arrays
keep order; string bytes are not normalized. `contentHash` is SHA-256 of those UTF-8 bytes.
`canonicalTuple` preserves tuple boundaries. `parseStrictJson` additionally rejects duplicate
keys including escape-equivalent keys, trailing material and lossy JSON numbers. Parsing is
bounded to 16,000,000 UTF-8 bytes, depth 100, one million visited values, and 65,536 keys in any one object. The text scanner counts values
before JSON.parse, and object validation counts own keys before visiting individual descriptors (never allocates a descriptor object for every property). Shape errors are bounded to 100 per returned subtree and never appended using unbounded argument spreads. Object validation, building and
hashing apply the same compact-JSON byte and value limits. Bulk feature/variant registries live
in sidecars; 20k/60k genes, 850k probes, 1M variants and 2k cited inline subjects are regression
fixtures. Limits remain DoS protection, never a truncation rule. Hashes are reproducibility identifiers, not signatures.

`LockTimeline` is a nonempty hash-linked prefix of these stages; no clock reads occur in logic.
The host supplies safe integer `time_ms`, zero-based sequence, previous_hash (null only at L0),
and hash of each `record`. Timestamps cannot decrease. Bindings change only through an explicit linked L7 amendment.

| Stage | Locked payload |
|---|---|
| L0-source-lock | source_hash |
| L1-contract-lock | public_contract_hash, nullable private_contract_hash |
| L2-partition-lock | partition_hash, public_contract_hash |
| L3-schema-view | schema_view_hash, partition_hash, literal dev_only:true |
| L4-plan-lock | plan_hash, public_contract_hash, partition_hash, registry_version, calibration_result_hash |
| L5-training | artifact_hash, frozen_code_hash, plan_hash, literal dev_only:true |
| L7-post-look-amendment | Complete amendment plus amendment_hash; previous pins and look must match current ledger state |
| L6-look-record | All plan/contract/public+private/partition/artifact/code/registry/calibration pins; attempt starting at 1; literal fsynced_before_execution:true; durability_receipt_hash |

Further attempts append L6 with consecutive attempt numbers; L7 does not reset the counter.
L7 must immediately follow the L6 identified by amendment.look_record_hash. It updates only
public/private contract and partition pins after validating the amendment hash and previous
pins. Subsequent L6 records use amended pins while the original L1/L4 entries and all plan/code/
artifact/registry/calibration bindings stay intact. An L7 prefix records intent, never a successful
dual evaluation; only a subsequent evaluation can supply evidence under the new pins. Crashes spend the look. K1a
validates these declarations and order, not fsync, first-look eligibility, software ownership,
or durable attempt recording. K2/host verifies receipts and G7/G8 binding. `LockRecord`,
`LockTimeline`, `lockTimelineJsonSchema` and `validateLockTimeline` are exported.

`PostLookAmendment` has version `omb-post-look-amendment/v3.1`, previous/amended_contract_hash,
previous/amended_partition_hash and nullable previous/amended_private_contract_hash,
look_record_hash, producer_id, reason, literal post_look:true and outcome_blind:true. Changes
are exclusively coarsen-units (explicit from_nodes → to_node/coarser_level/limitation),
add-replicate-groups (complete group records), or remove-held-out-units (partition_id/node list).
At least one bound artifact must change. Partition-only removal permits equal contract hashes
and requires different partition hashes. Coarsening/replicate additions require a changed public
contract hash. The literal acceptance policy is `must-pass-under-both-locked-and-amended-contracts`.
`validatePostLookAmendment(amendment, artifacts, context)` requires previousContract,
amendedContract, previousPartition and amendedPartition; absence is refusal. It checks all pins,
validates both versions, resolves amendment node references, checks coarsening coverage,
refuses aliases counted twice, undeclared/non-held-out removals, allocation flips and burn resets.
`validateLockTimeline(timeline, artifactsByAmendmentHash, context)` requires the same artifacts
for each L7 entry. `validateAmendmentDeclaration` checks wire syntax only and cannot authorize
an amendment. Replacement of private identity history is conservatively refused in this API.

No freeform patch is allowed. The type/schema rejects refining units, adding held-out units,
changing assignment or one-version-only evaluation. It does **not** establish that a supplied
new hash makes no unrelated nonidentity metadata changes or proves outcome blindness. The
host still authenticates the full diff and requires two successful scientific claim evaluations. Any other actual
post-look change voids Confirmed. Amendment and timeline schemas are also checked in as JSON.

## Open integration questions

K1b must settle and test:

* Host transport and authority-MAC binding, secure projection and host handling of generic private error categories, antecedent L1/L2 resolution and externally pinned hashes.
* Exhaustive row/header/sidecar alias coverage, normalized tuple-component lookup, matrix-axis
  ambiguity, join cardinality, cross-table identity and lineage through filters and missingness.
* Byte-backed identity discovery beyond the static closure, cross-dataset namespace correspondence,
  externally stored burn reconciliation, and scientific effective-N handling of dependence.
* Artifact byte/hash checks, cited span equality, missing code ambiguity, exact integer-scaled
  decimal lattice checks, allocation evidence and survival/summary-statistic consistency.
* Streaming canonical TSV verification and resource limits for very large registries; bounded
  regex full-match execution. No fallback on unsupported size/grammar.
* Outcome-blind amendment diffs and dual evaluation; no supportive label from known leakage,
  pseudoreplication or invalid inference. Contradiction detectors need calibrated admission.

K3 must settle accountable approval/producer identity, source snapshot manifest format,
citation entailment rules (a matching quote alone does not prove a fact), provisional assumed
unit-count bounds, unsafe-direction contests, and cross-family independence. It must evaluate
wrong-agreement rates and the conservative merge on adversarial/real metadata without access
to sealed pilot defects. No K3 curation or K1b data verification is implemented here.


## K1b obligations (explicitly unverified by K1a)

These are the byte/host obligations originally recorded as TODOs in `test/fix3.test.ts`.
K1b executable coverage is in `test/k1b-byte.test.ts` and omb-certify/test/contract-verifier.test.ts.
The static validator still does not perform these operations. Report indexes here are
zero-based indexes into `k1a-verify2.json.newIssues` or `.notFixed`.

| Obligation | Report item / TODO | Why bytes or host state are required |
|---|---|---|
| Exhaustive rows:'all' and headers:'all' coverage, tuple/regex/sidecar targets, join cardinality and cross-table mappings | notFixed[1], newIssues[23]; K1b-NF9 | K1a knows declarations, not any actual row or header. Structurally empty namespaces are already refused. |
| Registry canonical TSV syntax, exact entry counts, target graph coverage and true tuple collisions | newIssues[26,27]; K1b-I28/I29 | A multi-component tuple cannot be reconstructed from a node’s single original_id; synthetic merge spellings cannot prove registry contents or data coverage. No heuristic count upper bound is presented as verification. |
| Every source/table/sidecar hash, registry namespace and file format | notFixed[2], newIssues[24,31]; K1b-NF12/N3 | Static path/content reuse is refused; existence and byte equality require opening immutable host-pinned files. |
| Exact citation quote at the pinned byte span | K1b-citations | Matching hash declarations and span lengths do not demonstrate the quoted bytes exist. |
| Re-execute the registered transformation and compare output values/hash; exhaustively verify row lineage, filtering and join exclusions | newIssues[29,36]; K1b-N1/N8 | K1a now requires certain trusted output-table and transformation attestations and correct join bindings; it cannot prove execution or actual row coverage. |
| Authenticate chronology, producer outcome blindness, nonidentity metadata diffs and scientific dual evaluations | Host integration | Static predecessor/amended L1/L2 identity reconciliation is implemented in K1a-fix4. The remaining checks need external authority, execution and exposure history. |

Host authentication of producers/registry versions and K2/K3 scientific checks remain required.
A successful static result always says `verification:"structure-only"` and cannot satisfy any
of these TODOs, grant Confirmed, or imply an absent/skipped byte check passed.

### Trusted private pin for L2

`validatePartitionArtifact(l1, artifact, context)` checks
`context.expectedPrivateContractHash` against `l1.sealed_private?.hash`. Supply the nullable
private hash from the trusted L1 lock. With no sealed layer and no explicit pin the call refuses;
a public-only contract requires explicit `null`. A nonnull pin requires the matching sealed
layer. If a sealed layer is present without a pin, it is reconciled, never silently omitted.
This context is host input, not a value taken from untrusted L2 bytes.
