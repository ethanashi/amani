# Genre profile: single-cell atlas analysis of cell states and drug sensitivity

Slug `single-cell-atlas-drug-sensitivity`, built 2026-10-13, schema `genre-profile/1`. The full profile is in the `.json` file next to this one.

**Scope.** Papers that build or reuse a single-cell atlas (scRNA-seq, snRNA-seq, CITE-seq or multiome, often with spatial data), define cell types and states, and then link those states to drug sensitivity, therapy response or druggable targets. Most validate the link in bulk cohorts, cell lines, spatial data or the wet lab. Pure tool benchmarks, perturbation-technology papers, reviews and database-only papers are out of scope.

## Exemplars (9; words = I+M+R+D, prose only)

| ID | Journal | Year | DOI | Licence | Words (excl. Methods) | Figs/Tables | Refs |
|---|---|---|---|---|---|---|---|
| E1 | Cancer Cell | 2022 | 10.1016/j.ccell.2022.10.008 | CC BY | 9837 (5768) | 6/0 | 133 |
| E2 | Nature | 2023 | 10.1038/s41586-023-06311-1 | CC BY | 12338 (6155) | 5/0 (+12 ED) | 93 |
| E3 | Nature Communications | 2022 | 10.1038/s41467-022-29358-6 | CC BY | 9212 (5281) | 3/0 | 88 |
| E4 | Genome Biology | 2022 | 10.1186/s13059-022-02677-z | CC BY | 7909 (5021) | 8/1 | 114 |
| E5 | Cell Reports Medicine | 2024 | 10.1016/j.xcrm.2024.101511 | CC BY-NC-ND | 10084 (5513) | 4/3 | 121 |
| E6 | Cancer Cell | 2024 | 10.1016/j.ccell.2024.03.003 | CC BY-NC-ND (AAM) | 7478 (4206) | 6/0 | 92 |
| E7 | Nature Cancer | 2022 | 10.1038/s43018-022-00475-x | CC BY | 8785 (5808) | 8/0 (+8 ED) | 61 |
| E8 | eLife | 2024 | 10.7554/elife.92074 | CC BY | 8043 (6141) | 6/0 (+10 fig. suppl.) | 80 |
| E9 | Nature Communications | 2024 | 10.1038/s41467-024-49885-8 | CC BY | 5879 (4529) | 5/0 | 126 |

Topics: lung, heart, breast cancer cell lines, colorectal, breast, B-ALL, glioblastoma, CML and pan-cancer macrophages. Seven of nine add new single-cell data and 8/9 do some wet-lab work. Only E9 is purely computational on public data, and E5 relies on public single-cell data plus a small coculture assay.

## Canonical section order (Methods last in 9/9)

| Section | Level | Words (min / typical / max) |
|---|---|---|
| Title (7-17 words; tissue/disease + single-cell; therapy term 6/9) | required | - |
| Abstract (unstructured 8/9; BMC structured) | required | 150 / 164 / 250 |
| Highlights + In brief + graphical abstract | optional (Cell Press 3/9) | 36-41 / 51-53 |
| Introduction (3-4 paragraphs; ends "here we ...") | required | 300 / 482 / 650 |
| Results (5-11 headed subsections, median 7) | required | 2850 / 3864 / 5350 |
| Discussion | required | 300 / 887 / 1700 |
| Limitations (heading 1/9, paragraph 2/9) | optional | 100 / 200 / 200 |
| Methods (STAR Methods / Methods / Materials and methods) | required | 1350 / 3272 / 6200 |
| Data availability | required | 50 / 118 / 150 |
| Code availability (separate heading in Nature family only) | required | 10 / 22 / 29 |
| Ethics (conditional on new human material, 6/6) | typical | - |
| Acknowledgements, Funding, Contributions, Competing interests | required | - |

**Main text:** 5900 / 8785 / 12350 words with Methods; 4200 / 5513 / 6150 without.

**Results pattern.** The first subsection presents the atlas (8/9) and gives counts of cells, samples and datasets. Then come per-compartment state subsections (9/9), the drug or therapy link (8/9), bulk or clinical validation (6/9), cell-cell communication (5/9), and atlas-as-reference (3/9).

**Methods blocks.** Every exemplar describes data sources, QC, clustering and annotation, and the drug or response analysis. Integration is described in 8/9. Typical blocks are signature/regulon scoring, bulk projection or deconvolution, wet-lab methods (7/9 each), statistics (6/9), cell-cell communication, spatial analysis and differential expression (5/9 each). Optional blocks are CNV inference and survival (4/9 each), trajectory (3/9) and the Key Resources Table (3/9). Every exemplar gives software versions and multiple-testing correction (9/9) and names its toolkit (8/9). Integration metrics (LISI, kBET, scIB) appear in 0/9.

## Abstract

Required: names the single-cell modality (9/9), the states defined (8/9) and the drug or therapy link (9/9). Typical: names the validation (7/9), gives atlas scale in numbers (5/9) and offers the atlas as a resource (5/9). No abstract checklist exists.

## Display items (priority order; main total 3 / 6 / 9)

| # | id | Level | Frequency |
|---|---|---|---|
| 1 | embedding_umap | required | 9/9 |
| 2 | study_design_schematic | required | 9/9 any schematic panel; 6/9 as a Fig. 1 overview |
| 3 | drug_sensitivity_plot | required | 8/9 |
| 4 | marker_dotplot | required | 8/9 |
| 5 | composition_bar | required | 8/9 |
| 6 | heatmap | required | 9/9 |
| 7 | bulk_cohort_projection (new id) | typical | 7/9 |
| 8 | validation_panel (wet lab) | typical | 7/9 |
| 9 | km_curve | typical | 5/9 |
| 10 | cell_communication_plot | typical | 5/9 |
| 11 | spatial_map (new id) | typical | 5/9 |
| 12-15 | trajectory_plot, cnv_heatmap, benchmark_comparison, top_hits_table | optional | 1-3/9 in main |
| 16 | dataset_table | required | 9/9, in the supplement |
| 17 | highlights_box | optional | 3/9 (Cell Press) |

## Required statements

- Data availability with accessions for new data (9/9).
- An accession for every reused dataset (8/9; E2 reused none).
- A processed atlas object or portal (Zenodo, figshare, CELLxGENE, portal or OSF; 9/9).
- Code availability (GitHub 8/9, OSF 1/9; Zenodo DOI 3/9).
- Funding, competing interests and author contributions (9/9 each).
- Ethics approval and consent whenever there are new human samples (6/6).
- Optional: lead contact and materials availability (Cell Press), Reporting Summary (3/9), animal approval (2/9).

## Checklists

There is no EQUATOR guideline for this design. What the exemplars actually use:

- Journal data-deposition policy (9/9).
- Cell Press STAR Methods with Key Resources Table (3/9).
- Nature Portfolio Reporting Summary (3/9).
- MDAR checklist (1/9, eLife).
- minSCe (Füllgrabe 2020, doi 10.1038/s41587-020-00744-z) is cited by 0/9.

## Supplement

- Required: supplementary or Extended Data figures (9/9), a dataset/sample/patient table (9/9) and marker/DEG/signature lists (8/9).
- Optional: reagent lists (4/9), drug-target or drug-prediction tables (3/9), source data (3/9), peer-review file (4/9) and Reporting Summary (3/9).
- Counts: 5-15 files (median 8).

## References

61 / 93 / 133.

## Limitations

There is no fixed home. Explicit limitations appear in 3/9 papers: one has a "Limitations of the study" subsection, two have an unheaded Discussion paragraph of 115-210 words. Five scatter caveats through the Discussion, and one states none. The standard items are:

- Needs functional or prospective validation (8/9).
- Technical limits of scRNA-seq (4/9).
- Sampling and intratumour heterogeneity (3/9).
- Sparse public metadata (2/9).
- Association is not causation (2/9).
- Small or imperfect response cohorts (2/9).
- Cell-line drug data may not transfer to patients (2/9).

## Variation

House style decides most of the structure:

- **Cell Press:** Summary, Highlights, In brief, graphical abstract; STAR Methods with KRT, where the data and code statements also sit; "Limitations of the study" in 1/3.
- **Nature family:** unheaded lead, separate Data and Code availability, Reporting Summary, Extended Data, source data.
- **Genome Biology:** structured abstract, Background, a separate Conclusions section, Declarations.
- **eLife:** figure supplements, MDAR checklist, editor-written assessment.

The design also varies. The drug link may be drug-target scoring per state (3/9), immunotherapy response through bulk signatures (3/9), clinical TKI response (1/9) or experimental targeting (1/9). E4 links states to prognosis only.

## The three most important structural requirements

1. **Atlas first, with numbers.** Methods come last. Results open with the integrated atlas (cells, samples, datasets, platforms; UMAP coloured by cell type), then cell-state subsections with marker dot plots, heatmaps and composition plots.
2. **An explicit state-to-drug link plus outside validation.** A drug-sensitivity or therapy-response figure per state must name its drug resource (ChEMBL, GDSC, CTRP, PRISM, CMap or an ex vivo screen). It must be backed by bulk-cohort projection, survival curves, spatial data or experiments. Public-data-only papers must say that the experimental arm is missing.
3. **Full data provenance.** Give an accession for every new and reused dataset (KRT, data statement or dataset table), a deposited atlas object or portal, and a code repository (GitHub or OSF, ideally with a Zenodo DOI). Add an ethics statement when new human samples are used.

---
Normalisation pass (coordinator, 2026-10-13): every levelled entry in `single-cell-atlas-drug-sensitivity.json` now carries `basis` (frequency, both, or guideline; guideline means required by the reporting guideline although fewer than 80% of exemplars comply). Subsection headings are levelled by how often the heading itself appears, and guideline content is enforced by section elements. Checklists carry a `kind`, Key Points and highlights items are flagged `venue_governed`, and design-dependent items carry `applies_when`. See README.md.
