# Genre profiles and the structural lint

Built 2026-10-13. This folder adds **genre profiles** to the paper writer
(`internal design notes (not published)`, sections 3 and 5). A venue profile says what a journal *allows*:
word caps, abstract format, display-item cap, citation style. A genre profile says what a real
published paper of *this design* *contains*: the sections, the standard figures and tables, the
statements, the checklist, the supplement, typical lengths. The **structural lint** compares a
rendered draft against both and blocks packaging when the draft does not look like a real paper
of its type.

Profiles hold structure only. No exemplar prose is stored, only headings and counts.

## 1. Files

| Path | What |
|---|---|
| `<slug>.json` | the profile (schema `genre-profile/1`, section 3) |
| `<slug>.md` | short human summary of the same profile |
| `_measurements/<slug>/E<n>.json` | per-exemplar measurement (headings, word counts, item counts; no prose) |
| `_tools/jats_structure.py` | measures an open-access paper from Europe PMC JATS XML; defines the word-count convention |
| `_tools/validate_profiles.py` | schema, range, regex and contamination validator; `--check-dois` resolves DOIs |

Profiles:

| Slug | Genre | Main Amani claim kind |
|---|---|---|
| `sr-ma-adverse-events-rct` | Systematic review and meta-analysis of adverse events from RCTs (drug-safety signal / repurposing screen) | literature synthesis (harms) |
| `trial-level-surrogate-evaluation` | Meta-analytic surrogate endpoint evaluation (R² trial, R² individual, STE) | literature synthesis (surrogacy) |
| `cis-mr-colocalisation-drug-target` | Cis-Mendelian randomisation plus colocalisation of a protein or drug target | `causal-genetic` L1–L3 |
| `crispr-dependency-target-selectivity` | Cancer dependency / drug-target selectivity from CRISPR screens (DepMap-style) | discovery mode, functional genomics |
| `single-cell-atlas-drug-sensitivity` | Single-cell atlas analysis of cell states and drug sensitivity | discovery mode, single-cell |
| `ai-research-agent-methods` | Methods / system paper on an AI research agent and its validation | the system paper (11.5, PW11) |

Not covered yet (the lint prints WARN `P4`, section 6): `out-of-sample` prediction notes (TRIPOD+AI,
e.g. the PSA audit), diagnostic accuracy, `data-integrity` letters, `reproduction` reports.

**Contamination rule.** No exemplar is about osteoarthritis or other joint disease, ALS or motor
neuron disease, neurofilament, or pancreatic cancer (Amani's own topics). The extractor records
matched terms from each exemplar's title, abstract and keywords, and the validator rejects any hit
in a citation or disease-area field.

## 2. How profiles were built

1. 6–10 open-access exemplars per genre, 2022–2026, from leading journals, mixed across publisher
   families so the ranges reflect real variation rather than one house style.
2. Each exemplar with a PMCID is measured by `jats_structure.py` from Europe PMC full-text XML
   (all 53 current exemplars have one). A future non-PMC exemplar (arXiv, publisher HTML) is
   counted by hand with the same convention and marked `estimated`.
3. **Word-count convention** (the lint must use the same one, section 5.3):
   prose words in paragraphs and list items; tokens match `[A-Za-z0-9][A-Za-z0-9'.,%/\-]*`;
   figure and table wraps (captions and table footnotes included), boxed text, display formulas,
   numeric citations, headings and footnotes are excluded; nested lists count once.
   Main text = Introduction + Methods + Results + Discussion (+ Limitations and Conclusions when
   they are separate top-level sections). `main_text_words_excluding_methods` is kept for
   Nature/Cell-style venues that leave Methods out of their cap.
   VERIFIED 2026-10-13 against an independent pandoc-AST counter (`pandoc -f jats`): on Nat Commun
   PMC11380676, Introduction, Results and Discussion agree exactly and Methods within 1%; on BMJ
   PMC10540836, Introduction, Methods and Results agree exactly, and Discussion differs only by a
   117-word box that pandoc flattens into paragraphs (hence the box step in test 10.2).
4. **Levels.** `required` = mandated by the genre's reporting guideline as an item reviewers check,
   or present in ≥ 80% of exemplars. `typical` = 50–79%. `optional` = < 50% but in ≥ 2 exemplars.
   Each entry carries its `frequency` (e.g. "7/8").
   Each levelled entry also carries a machine-readable **`basis`**: `frequency` (≥ 80% of
   exemplars have it), `both` (≥ 80% and a guideline item), or `guideline` (required by the
   genre's reporting guideline although fewer than 80% of exemplars comply, e.g. PROSPERO
   registration in 4/8 harms reviews, a STROBE-MR statement in 3/8 MR papers). `guideline` items are
   where Amani is meant to beat the published norm; the positive control (10.3) expects them to
   fire on some exemplars.
   Subsection *headings* are levelled by how often the heading itself appears, never by the
   guideline, since no guideline mandates a heading; the content a guideline mandates is a section
   `element` instead (normalisation pass, 2026-10-13).
5. **Ranges.** `min` and `max` are the observed extremes across exemplars (words rounded to 50,
   counts exact); `typical` is the median.

## 3. Profile schema (`genre-profile/1`)

Every key exists in every profile; `validate_profiles.py` enforces this.

| Key | Type | Meaning |
|---|---|---|
| `schema_version` | `"genre-profile/1"` | |
| `genre`, `genre_name`, `scope` | string | slug (= file name), human name, what the profile covers and does not |
| `built_on`, `word_count_convention` | string | build date; the counting rule above |
| `exemplars[]` | object | `id` (E1…), `citation`, `doi` (bare), `url`, `pmcid`, `licence`, `journal`, `year`, `article_type`, `disease_area`, `guideline_cited[]`, `measurement_file`, `measurement_method`, `measured{}` (main and section words, section order, abstract format/headings/words, figure and table counts, item kinds, references, supplement types, limitations placement, statements, corrections) |
| `sections[]` | object | `id` (vocabulary below), `heading`, `aliases[]`, `order` (unique, canonical position), `level`, `basis`, `venue_governed` (true for `key_points`, `plain_summary`), `words{min,typical,max}` or null, `subsections[]` (`heading`, `aliases[]`, `aliases_regex[]`, `level`, `basis`, `frequency`, `words`), `elements[]` (`id`, `description`, `level`, `basis`, `frequency`, `detect[]`) |
| `section_order_variants[]` | object | `name`, `order[]` of section ids, `seen_in[]` exemplar ids (e.g. IMRaD vs Methods-last) |
| `main_text_words` | range + `counted[]`, `methods_counted`, `notes` | |
| `abstract` | object | `format` (structured, unstructured, either), `words`, `heading_sets[]` (`family`, `headings[]`, `seen_in[]`), `elements[]` (as in sections), `extra_summaries[]` (Key Points, Highlights...), `checklist` |
| `display_items[]` | object | `id` (shared vocabulary below), `type` (figure, table, box), `kind`, `level`, `basis`, `venue_governed` (key-points and highlights boxes), `count` range, `placement` (main, main-or-supplement, supplement), `priority` (1 = keep in main first), `frequency`, `detect[]` (caption regexes), `omerta_kind` (the figure kind in design section 5, or null), `notes` |
| `display_items_main_total` | range | figures + tables (+ boxes if the venue counts them) in the main text |
| `required_statements[]` | object | `id`, `label`, `level`, `placement[]` (section ids or `back_matter`, `title_page`, `figure_legend`), `frequency`, `detect[]` |
| `checklists[]` | object | `name`, `kind`, `level`, `basis`, `citation`, `doi`, `where`, `frequency`. `kind` is one of `reporting_guideline` (PRISMA 2020, ReSEEM, STROBE-MR, TRIPOD-LLM...: needs a completed checklist file), `appraisal_tool` (RoB 2, GRADE, CINeMA: checked through Methods elements and display items), `methods_guidance` (Cochrane Handbook, IQWiG thresholds, coloc priors...: informational), `venue_form` (Nature Reporting Summary, Cell Press STAR Methods, MDAR, NeurIPS checklist: the venue profile decides), `venue_policy` (data-deposition and editorial policies: checked through statements), `none` (no guideline exists) |
| `supplement[]` | object | `id`, `item`, `level`, `frequency`, `detect[]` (regexes on supplement file titles/headings) |
| `references` | range | entries in the reference list |
| `limitations` | object | `placement`, `words` range or null, `conventions[]`, `standard_items[]` (`id`, `text`, `level`, `frequency`) |
| `applies_when` (optional, on any levelled entry) | string | design condition under which the entry applies (section 4, point 4); absent means always |
| `variation_notes`, `lint_notes[]`, `notes[]` | | free text; `lint_notes` are hints the builder may promote to rules |

**Section id vocabulary:** `title, abstract, key_points, plain_summary, introduction, methods,
results, results_discussion, discussion, limitations, conclusions, data_availability,
code_availability, ethics, funding, competing_interests, contributions, acknowledgements,
ai_disclosure, registration, references, supplement, other`.

**Display-item id vocabulary** (shared across genres so the renderer can tag items once):
figures `study_design_schematic, architecture_schematic, prisma_flow, data_flow, forest_plot,
funnel_plot, rob_summary_figure, network_geometry, tsa_plot, meta_regression_bubble,
surrogacy_scatter, km_curve, mr_scatter, mr_leave_one_out, regional_association_plot,
volcano_plot, manhattan_plot, phewas_plot, embedding_umap, marker_dotplot, heatmap,
composition_bar, trajectory_plot, cnv_heatmap, cell_communication_plot, drug_sensitivity_plot,
dependency_distribution, biomarker_association_plot, dependency_drug_scatter, network_plot,
validation_panel, benchmark_comparison, ablation_plot, case_study_figure, human_eval_plot,
cost_runtime_plot, error_taxonomy`, plus genre-specific additions `arm_level_scatter`
(surrogacy), `target_prioritisation_plot` (CRISPR), `bulk_cohort_projection`, `spatial_map`
(single-cell), `agent_prompt_figure`, `safety_guardrail_example` (agent papers); tables `characteristics_table, sof_table, rob_table,
results_table, sensitivity_table, instrument_table, coloc_table, surrogacy_results_table,
benchmark_table, ablation_table, cost_table, top_hits_table, dataset_table`; boxes
`key_points_box, glossary_box, highlights_box, algorithm_box`. A profile may add an id for a kind not listed; the
validator warns, and the id must then be added here and to the renderer's tag list.

**Regex dialect.** `detect` and `aliases_regex` patterns must compile identically in Python `re`
and ECMAScript `RegExp` (the paper writer is TypeScript). Allowed: literals, classes, `\b`, `\d`,
`\s`, groups, alternation, `?`, `*`, `+`, `{m,n}`, lookahead. Not allowed: inline flags such as
`(?i)`, named groups, lookbehind, `\Z`, possessive quantifiers. The lint always matches
case-insensitively. VERIFIED 2026-10-13: all 2,041 patterns in the six profiles compile in Node 22
with flags `i` and `iu`, and none uses a forbidden construct. Builder task: keep a JavaScript compile
check beside the Python validator. Note that `\w` and `\b` are ASCII-only in JavaScript without the
`u` flag but Unicode-aware in Python; the lint should run in JavaScript with `i` only, so profiles
must not rely on non-ASCII word characters.

## 4. Choosing the genre

1. The locked plan's `paper_set` entry gets a field `genre: <slug>` at plan lock (the plan-lock
   step in design 15.11). The drafter cannot change it.
2. Software checks the genre against the paper's claim kinds with the table in section 1. A
   mismatch (e.g. a `causal-genetic` claim set under `single-cell-atlas-drug-sensitivity`) is
   FAIL-W `P5`.
3. One primary genre per paper. A plan may list `secondary_genres[]` (e.g. a cis-MR paper with a
   single-cell expression check). Secondary genres add only their `required` checklists (as
   required) and their `required` display items (as WARN when missing). Their sections, word ranges
   and statements are ignored.
4. **Design flags.** Some requirements depend on the design variant, not the genre. The plan's
   `paper_set` entry declares boolean flags, and an entry with `applies_when: <flag>` is checked
   only when that flag is true (INFO `X1` when false; WARN `X2` and checked anyway when the flag
   is not declared). Vocabulary: `systematic_search` (trials or
   studies found by a literature search: PRISMA flow, search strategy, registration),
   `ipd` (individual participant data: PRISMA-IPD), `network_ma` (network geometry, PRISMA-NMA,
   CINeMA), `multi_instrument` (more than two instruments: MR scatter), `proteome_wide` (volcano
   plot of the protein screen), `drug_selectivity_claim` (gene-effect vs drug-response scatter),
   `new_wet_lab_data` (reserved; Amani never sets it). Flags are fixed at plan lock, like `genre`.

## 5. Lint inputs and normalisation

### 5.1 Inputs
- the rendered `paper.md` after placeholder resolution, read as a pandoc JSON AST
  (`pandoc -f markdown -t json`);
- the genre profile (validated; its sha256 goes into the certificate);
- the venue profile (design 3.2);
- `package/<venue>/supplement/manifest.json`: one entry per supplement file or section, with
  `title`, optional `genre_item` (a profile `supplement[].id`) and, for supplementary figures and
  tables, `kind` (display-item id);
- `package/<venue>/checklists/*.json` (design 3.4);
- the structured Limitations Part B record (design 6.5);
- `package/<venue>/structure_waivers.json` if present (section 8).

### 5.2 Finding sections
1. Top-level sections are level-1 headings; subsections are level-2 and level-3 headings beneath.
2. The renderer writes the section id as a heading attribute: `# Methods {#sec-methods section-id="methods"}`.
   The lint uses `section-id` first.
3. Fallback when the attribute is missing (an owner-edited heading): normalise the heading
   (lower-case, strip numbering such as "2." or "II.", collapse spaces, drop a trailing colon) and
   match, in order, the profile section's `heading`, its `aliases`, then the default alias table
   (`CANON` in `_tools/jats_structure.py`). A fallback match is reported as INFO `S7`.
4. The abstract is the Div with class `abstract` (or `section-id="abstract"`); Key Points and
   other summaries are Divs with `section-id` values from the vocabulary.
5. Amani-only sections are mapped by the table in 5.5 and never reported as unknown.
6. Prose between the abstract (and any summary Divs) and the first level-1 heading is the
   `introduction`. Nature-family and AHA papers have no Introduction heading; the renderer still
   emits one with `section-id="introduction"` unless the venue profile sets
   `untitled_introduction: true`, in which case it emits the lead paragraphs in a Div with that
   `section-id` and no heading.
7. A merged "Results and Discussion" section (`results_discussion`) satisfies both `results` and
   `discussion` when any `section_order_variants[]` entry of the profile contains
   `results_discussion`; otherwise it satisfies neither (S1).

### 5.3 Counting words
Port the convention in section 2.3 to the AST:
- count `Str` tokens in `Para` and `Plain` blocks, including those inside `BulletList`,
  `OrderedList` and `BlockQuote`, with the token regex above;
- skip `Figure`, `Table`, `CodeBlock`, `RawBlock`, `Math` of type `DisplayMath`, `Cite`, `Note`,
  `RawInline`, `Image`, `Header`, and any `Div` whose classes include `figure`, `table`, `box`,
  `glossary`, `caption`, `references` or `protected-part-a`;
- a section's count includes its subsections.
Main-text words for genre comparison are the **comparable words**: the sum over sections mapped
to `main_text_words.counted`, excluding Amani extension sections (5.5). The venue lint counts the
full main text, extensions included.

### 5.4 Finding display items, statements and supplement items
- **Display items.** The renderer tags every figure, table and box with its vocabulary id:
  `{#fig-forest kind="forest_plot"}`, `{#tbl-sof kind="sof_table"}`, `::: {.box kind="glossary_box"}`.
  The lint matches `kind` to profile `display_items[].id`. Fallback for an untyped item: the first
  profile item whose `detect` regex matches the caption (WARN `D7` for every untyped item).
  Supplementary figures and tables come from the manifest's `kind`.
- **Statements.** Software-generated statements carry `statement-id="<id>"` on their Div or
  paragraph. Fallback: a `detect` regex hit in the prose of an allowed `placement` section.
- **Supplement items.** A manifest entry satisfies a profile `supplement[]` item when its
  `genre_item` equals the item's `id`, or when its title matches the item's `detect`.

### 5.5 Amani sections mapped to genre sections

The paper writer's default structure (design 3.1) has sections real papers do not. They are kept
(trust rules win over genre norms) and mapped like this:

| Design 3.1 section | Lint treatment |
|---|---|
| Title, Structured abstract | `title`, `abstract` |
| Plain summary; Key Points | `plain_summary`, `key_points` (extra summaries; venue decides; never compared with genre ranges) |
| Summary of findings | display item `results_table`. It also satisfies `sof_table` in `sr-ma-adverse-events-rct` only when it carries GRADE certainty and absolute-effect columns and is tagged `kind="sof_table"` |
| The idea in brief; glossary | `glossary_box`; Figure 1 counts as `study_design_schematic` (or `architecture_schematic` in the system paper) |
| Introduction, Methods, Results, Discussion | same ids |
| Verification and robustness analyses | **extension**: must sit after Results and before Discussion; its words are `omerta_extension_words`, not comparable words |
| Analyses abandoned, and why | **extension**, same placement rule as above (or supplement) |
| Limitations | `limitations`; Part B words are comparable words; protected Part A text (Div `protected-part-a`) is extension text |
| Data and code availability | `data_availability`, `code_availability` |
| Declarations | `ai_disclosure`, `contributions`, `competing_interests`, `funding`, `ethics` (statement ids inside) |
| References, Supplement | `references`, `supplement` |

## 6. Rules

Severity classes:
- **FAIL**: blocks packaging; cannot be waived.
- **FAIL-W**: blocks packaging unless a valid waiver exists (section 8). Used where a regex can
  miss legitimate wording or where a real paper can reasonably differ.
- **WARN**: printed in the lint report; does not block.
- **INFO**: printed only in the JSON report.

Bands. For a profile range `[min, max]`, the **hard band** is `[0.5 × min, 1.5 × max]` for
section words, reference counts and display-item counts, and `[0.67 × min, 1.33 × max]` for
comparable main-text words and abstract words. Inside `[min, max]` is silent; outside it but
inside the hard band is WARN; outside the hard band is FAIL-W. Venue caps are separate and always
FAIL (design 3.2).

| ID | Check | Severity |
|---|---|---|
| **P1** | profile missing or fails `validate_profiles.py` | FAIL (the lint refuses to run) |
| P2 | profile sha256 differs from the one in the certificate at re-verification (design 8) | FAIL |
| P3 | profile `built_on` older than 24 months | WARN |
| P4 | no `genre` in the plan's `paper_set`, or no profile for the genre | WARN; the report says "structural lint not applied" |
| P5 | genre incompatible with the paper's claim kinds (section 4) | FAIL-W |
| X1 | an entry whose `applies_when` flag is false in the plan | INFO (skipped) |
| X2 | an `applies_when` flag the plan does not declare | WARN; the entry is checked as if the flag were true (fail closed) |
| V1 | an entry flagged `venue_governed` (Key Points, plain summary, highlights or key-points box) is checked only when the venue profile's summary layers (design 3.2) ask for it; then it is required by the venue lint, not here | INFO |
| **S1** | a `required` section is missing | FAIL |
| S2 | a `typical` section is missing | WARN |
| **S3** | section order, main text only (algorithm below). Extensions are checked by the placement rule in 5.5 | FAIL |
| S4 | top-level section maps to no profile section, extension or back-matter id | WARN |
| S5 | a `required` subsection of a present section is missing (no level-2/3 heading under it matches `heading`, `aliases` or `aliases_regex`) | FAIL-W; `typical`: WARN |
| S6 | a section `element` has no `detect` hit in that section's prose | `required`: FAIL-W; `typical`: WARN |
| S7 | section found only by fallback heading matching | INFO |
| **W1** | section words outside the profile range | WARN; outside hard band: FAIL-W |
| W2 | comparable main-text words outside `main_text_words` | WARN; outside hard band: FAIL-W |
| W3 | `omerta_extension_words` exceed 25% of the full main text | WARN (suggest moving verification detail to the supplement) |
| **A1** | abstract structured vs unstructured differs from the profile, and the venue profile does not set the format | FAIL (venue format wins and turns this into INFO) |
| A2 | abstract headings: when the venue profile names a heading family present in `heading_sets`, the headings must equal that set in order (case-insensitive) | FAIL-W; with no family match, compared with the first set: WARN |
| A3 | abstract `element` has no `detect` hit | `required`: FAIL-W; `typical`: WARN |
| A4 | abstract words outside the genre range | WARN; outside hard band: FAIL-W |
| **D1** | a `required` display item is in neither the main text nor the supplement | FAIL |
| D2 | a `required` item with `placement: main` is only in the supplement | FAIL-W; WARN when the venue display-item cap is binding (cap ≤ number of required main items with a higher priority) |
| D3 | a `typical` display item is missing everywhere | WARN |
| D4 | per-item count outside `count` | WARN; outside hard band: FAIL-W |
| D5 | main display-item total outside `display_items_main_total` | WARN (the venue cap is the FAIL) |
| D6 | priority inversion: a lower-priority item is in the main text while a higher-priority `required` item was moved to the supplement | FAIL-W |
| D7 | display item without a `kind` attribute | WARN |
| D8 | display item kind not listed in the profile | INFO |
| **T1** | a `required` statement is missing (no `statement-id`, no `detect` hit in any allowed placement) | FAIL |
| T2 | a statement is found only outside its allowed placements | WARN |
| T3 | a `typical` statement is missing | WARN |
| **C1** | a `required` checklist of kind `reporting_guideline` is missing from `checklists/`, or has an empty slot (design 3.4) | FAIL |
| C2 | a `typical` `reporting_guideline` checklist is missing | WARN |
| C3 | a `reporting_guideline` named in a profile has no file mapping in the lint config | FAIL until the builder adds the checklist JSON |
| C4 | entries of other kinds are never checked as files: `appraisal_tool` through S6 elements (e.g. `rob_tool`, `certainty_method`) and D rules (RoB figure, summary-of-findings table); `venue_form` by the venue profile; `venue_policy` through T rules; `methods_guidance` and `none` are listed in the report | INFO |
| **U1** | a `required` supplement item is missing from the manifest | FAIL; `typical`: WARN |
| **R1** | reference count outside `references` | WARN; outside hard band: FAIL-W; venue cap: FAIL |
| **L1** | no Limitations section or subsection | FAIL (design 6.5 also requires it) |
| L2 | Limitations placement differs from `limitations.placement` (e.g. top-level vs Discussion subsection) and the venue does not fix it | WARN |
| L3 | a `standard_items[]` entry has no Part B slot. Each slot must be `addressed` or `not-applicable:<reason>`; not-applicable reasons are printed in the supplement | `required`: FAIL; `typical`: WARN |
| L4 | Limitations words outside range | WARN |
| G1 | each profile `lint_notes[]` entry not yet promoted to a rule | listed as a manual check in the report (INFO) |

**S3 algorithm.** Let `M = {introduction, methods, results, results_discussion, discussion,
limitations, conclusions}`. Let `D` be the draft's top-level section ids in `M`, in order
(Limitations counts only when it is a top-level section). Back-matter ids in a profile's variants
are informational and ignored, because Amani's back matter has its own fixed order.
1. If the venue profile fixes an order, `D` must equal it (restricted to `M`).
2. Otherwise a variant `V` (restricted to `M`) is a candidate when every id in `D` other than
   `limitations` and `conclusions` appears in `V`. So a variant without Methods can never match a
   draft that has Methods.
3. A candidate matches when `D` restricted to ids in `V` equals `V` restricted to ids in `D`.
4. Anchors in `D`, whatever the variant: `conclusions` comes immediately after `discussion`,
   `results_discussion` or a top-level `limitations`; a top-level `limitations` comes immediately
   after `discussion` (or after `results` when there is no Discussion).
S3 passes when at least one candidate matches and the anchors hold.

Short formats (venue type "short format" in design 3.2): W1, W2, A4, D4 and D5 become INFO; D2
becomes INFO (required items may sit in the supplement); S1 applies only to sections the venue's
short format keeps; everything else is unchanged.

## 7. Where it runs

- In the packaging step (design 12), after rendering and before the other packaging lints, as the
  "Genre structure" lint. It runs again in every re-verification after an edit (design 8).
- It reads only rendered artefacts and records; it never edits the draft. Fixes go back through
  the renderer or the drafter, then the whole check chain re-runs.
- Exit status is non-zero when any FAIL or unwaived FAIL-W exists. The packager refuses to build
  on a non-zero exit, as for every other packaging lint.
- Determinism: the same inputs give a byte-identical report (sorted findings; no timestamps
  inside the hashed part).
- Suggested home: `packages/omb-paper/src/lint/structure.ts`, with the profiles copied into
  `packages/omb-paper/genres/` and pinned by sha256; a test fails if the copy differs from this
  folder.

## 8. Waivers

`package/<venue>/structure_waivers.json`:

```json
[{"rule": "W1", "target": "sections[methods].words", "profile_sha256": "...",
  "reason": "methods include the registered-procedure paragraphs required by design 3.1",
  "owner_action_receipt": "<receipt id from design 11.1>", "date": "2026-10-20"}]
```

- Only FAIL-W findings can be waived. A waiver for a FAIL is ignored and reported.
- A waiver is valid only for the profile hash it names, so it lapses when the profile changes.
- Every applied waiver is rendered in the supplement table "Departures from the usual structure
  of <genre name> papers" (rule, what differs, reason).
- The drafter cannot write waivers; they come from a recorded owner action.

## 9. Report

`package/<venue>/lint/structure.json` (canonical) and `structure.md` (human):

```json
{"profile": {"genre": "cis-mr-colocalisation-drug-target", "schema_version": "genre-profile/1", "sha256": "..."},
 "venue": "medrxiv",
 "comparable_words": 3412, "omerta_extension_words": 610,
 "summary": {"fail": 0, "fail_w_unwaived": 1, "fail_w_waived": 1, "warn": 4, "info": 6},
 "findings": [
  {"rule": "D1", "severity": "FAIL", "target": "display_items[regional_association_plot]",
   "expected": "required, count 1-4, placement main-or-supplement",
   "observed": "absent from main text and supplement manifest",
   "location": null, "hint": "render the colocalisation regional plot (design 5, C5)", "waiver": null}
 ]}
```

`target` is a JSON-pointer-like path into the profile; `location` is the heading path or figure id
in the draft. The Markdown report groups findings by severity and lists G1 manual checks last.

## 10. Acceptance tests for the builder

1. **Schema.** `python3 _tools/validate_profiles.py --check-dois` reports 0 errors.
2. **Counter calibration.** For every exemplar with a PMCID: fetch the JATS XML, wrap each
   `<boxed-text>` as a `Div.box` (pandoc's JATS reader otherwise flattens boxes into paragraphs,
   VERIFIED on PMC10540836), convert with `pandoc -f jats -t json`, and run the lint's counter.
   Each of Introduction, Methods, Results and Discussion must be within ±3% or ±15 words of the
   measurement file, and the abstract within ±5%.
3. **Positive control.** Run the lint on every converted exemplar against its own profile, with
   heading fallback and caption-regex typing, and with venue-governed, checklist-file (C1–C3),
   supplement (U1) and Part B (L3) rules switched off, since exemplars have no Amani package, and
   with each exemplar's design flags set from its profile notes (e.g. surrogacy E5 is IPD with no
   literature search).
   Count findings separately by the `basis` of the profile entry:
   - entries with basis `frequency` or `both`: median FAIL count 0, no exemplar above 2 FAIL, and
     each FAIL explained by that exemplar's `frequency` entry (for example, the one exemplar in
     eight without the item);
   - entries with basis `guideline`: findings are expected (exemplars below the guideline) and are
     reported per exemplar as "below guideline"; they must match the profile's frequency strings
     (a 4/8 registration rate should give 4 exemplars with T1).
   Report FAIL-W and WARN rates per rule. A rule that fires on more than a quarter of exemplars on
   `frequency`/`both` entries has a bad pattern or a mis-set level, and must be fixed before the
   lint ships.
4. **Band calibration (leave one out).** Rebuild each range without exemplar i and check
   exemplar i against it. At least 90% of section word counts must fall inside the hard band.
5. **Negative controls.** Mutate a passing fixture; each mutation must raise exactly the expected
   rule: delete Limitations → L1; swap Results and Discussion → S3; remove the PRISMA flow figure
   (SR genre) → D1; delete the registration sentence → T1; triple Methods → W1 FAIL-W; make the
   abstract unstructured → A1; remove the STROBE-MR checklist (MR genre) → C1; rename "Methods" to
   "Approach" with no attribute → S1; drop `kind` from a figure → D7; delete the code-availability
   statement in the system-paper genre → T1.
6. **Amani fixture.** The PSA audit (no genre profile) gives exactly one WARN `P4` and no FAIL.
7. **Determinism.** Two runs on the same inputs give identical report bytes.

## 11. Maintenance

- Re-derive a profile when its guideline changes (e.g. a PRISMA or STROBE-MR update) or after 24
  months (P3). Re-run `jats_structure.py --out` for each exemplar, swap stale exemplars, recompute
  ranges and levels with the rules in section 2, bump nothing in the schema unless keys change.
- A schema change bumps `schema_version` (e.g. `genre-profile/2`), and the lint supports one
  version at a time.
- Keep the contamination rule when adding exemplars; the validator enforces it on citation and
  disease-area text, and the extractor reports title/abstract/keyword hits.
- Licences: exemplars are cited, not redistributed. Measurement files hold headings and numbers
  only.

## 12. Known limits

- Regex `detect` patterns find wording, not meaning; that is why elements are FAIL-W, not FAIL,
  and why the positive control in 10.3 must pass before shipping.
- Exemplars were chosen by hand from leading journals. Ranges describe those papers, not every
  venue. The venue profile, not the genre profile, sets hard length limits.
- Most exemplars of the CRISPR and single-cell genres include wet-lab or new-data components that
  Amani's computational papers will not have: 6/10 CRISPR exemplars include wet-lab work, and 8/9
  single-cell exemplars do (7/9 generate new single-cell data; only one is purely computational on
  public data). In 4/9 agent papers a case study is confirmed in the wet lab. The profiles mark the
  validation panels `typical` or `optional`, and each has a Part B limitation item for the missing
  experimental arm.
- Guideline compliance in real papers is patchy: PROSPERO registration in 4/8 harms reviews,
  GRADE in 1/8, STROBE-MR cited by 3/8 MR papers, ReSEEM by 3/9 surrogacy papers. Those items are
  `required` with `basis: guideline`, so Amani is held above the published norm on them.
- All 53 exemplars come from PMC open-access full text (including the 2026 Nature agent papers),
  so every count is measured, not estimated. Measurement files are raw extractor output; the
  profiles' `measured` blocks hold hand-corrected values with the reason in `corrections`. Known
  extractor blind spots, corrected by hand: unlabeled graphical or visual abstracts counted as
  figures, Cell Press key resources tables and MSB reagent tables counted as tables, eLife figure
  supplements counted as figures, statement subsections (ethics, funding, code) inside Methods,
  Europe PMC XML that nests Results inside Methods.
- Topic exclusions removed some of the best-fitting papers (several GLP-1 harms reviews that
  report pancreatitis, the AI co-scientist paper whose worked example is ALS, Biomni and Kosmos),
  so no profile includes trial sequential analysis, and the agent profile has no preprint
  exemplar.
