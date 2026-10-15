# Genre profile: CRISPR-screen dependency / drug-target selectivity (DepMap-style)

Slug `crispr-dependency-target-selectivity` · built 2026-10-13 · schema genre-profile/1 · JSON: `crispr-dependency-target-selectivity.json`

**Scope.** Papers that analyse CRISPR knockout (and RNAi) screens across many cancer cell lines (DepMap/Achilles, Project Score, DRIVE) using gene-effect scores. They look for selective dependencies, synthetic-lethal or paralog pairs, biomarkers that predict dependency, target-priority scores, or agreement between gene dependency and drug response (PRISM, GDSC, CTRP) as a test of on-target selectivity. Out of scope: single-line screen papers with no cross-line analysis, in vivo screens, library or tool design papers, and reviews. There is no EQUATOR guideline for this design.

## Exemplars (10; 4 computational only, 6 with wet-lab work)

| ID | Journal | Year | DOI | Licence | Main words (excl. Methods) | Figs/Tables | Refs | Wet lab |
|---|---|---|---|---|---|---|---|---|
| E1 | Genome Biology | 2023 | 10.1186/s13059-023-03020-w | CC BY | 8681 (4649) | 4/1 | 64 | no |
| E2 | Cell Genomics | 2022 | 10.1016/j.xgen.2022.100099 | CC BY | 14483 (6326) | 7/0 | 124 | no |
| E3 | Nature Communications | 2022 | 10.1038/s41467-022-35378-z | CC BY | 9478 (4831) | 5/0 | 73 | yes |
| E4 | Cell Reports | 2024 | 10.1016/j.celrep.2024.114775 | CC BY-NC-ND | 11280 (6400) | 7/0 | 75 | yes |
| E5 | NAR Cancer | 2023 | 10.1093/narcan/zcad056 | CC BY | 6307 (4981) | 5/0 | 53 | no |
| E6 | Molecular Systems Biology | 2023 | 10.15252/msb.202311657 | CC BY | 7327 (4798) | 5/0 (+5 EV) | 65 | no |
| E7 | npj Precision Oncology | 2025 | 10.1038/s41698-025-01111-4 | CC BY-NC-ND | 8061 (4552) | 6/2 | 19 | yes |
| E8 | PLOS Genetics | 2025 | 10.1371/journal.pgen.1011685 | CC BY | 6484 (4737) | 6/0 | 79 | yes (heavy) |
| E9 | Nature Genetics | 2025 | 10.1038/s41588-025-02221-2 | CC BY | 7651 (4040) | 7/0 (+8 ED) | 98 | yes (heavy) |
| E10 | Cell Reports | 2022 | 10.1016/j.celrep.2022.110400 | CC BY-NC-ND | 10377 (5027) | 7/0 | 79 | yes (light) |

For the Cell Press papers, STAR Methods are counted as Methods, minus Resource availability. This was a hand correction to the extractor output. Key Resources Tables and graphical abstracts are not counted as main display items.

## Canonical section order and words (min / median / max, rounded to 50)

1. Title: 8-16 words. Usually a declarative finding ("X is a synthetic lethal target in Y").
2. Abstract: 150 / 150 / 250 (exact 146-251). One unstructured paragraph in 9/10; only BMC uses Background/Results/Conclusions.
3. Highlights and In brief: Cell Press only (3/10). Graphical abstract in 4/10.
4. Introduction: 300 / 550 / 850. Introduces the screen resource (8/10), states the gap (9/10) and ends with "Here, we..." (8/10).
5. Results: 3100 / 3400 / 4700. Split into 4-7 subsections with declarative headings. Usual flow: approach overview, then dependency landscape, then biomarker associations (8/10), then lineage-specific results (6/10), then benchmark against known positives (6/10), then a deep dive on a top hit (6/10). Validation follows in wet-lab papers (6/10).
6. Discussion: 500 / 800 / 1250. Cell Press adds a "Limitations of the study" subsection.
7. Methods: 1300 / 3800 / 8150. Comes last in 9/10. Usual subsections: data sources with release and gene-effect model (9/10), association or prediction model (9/10), dependency definitions and thresholds (6/10), benchmarking (6/10), statistics (6/10), replication in an independent screen (5/10), drug-response integration (4/10).
8. Back matter: data availability (10/10), code availability (9/10), acknowledgements (10/10), funding (10/10), author contributions (9/10), competing interests (10/10), ethics (3/10), references, supplement.

Order variants: Methods last in 8/10. One BMC paper (E1) has Methods last with a separate Conclusions section. One OUP paper (E5) uses IMRaD with Methods second.

**Main text:** 6300 / 8350 / 14500 words. Excluding Methods: 4050 / 4800 / 6400. Nature-family word caps exclude Methods.

## Abstract
- Unstructured, about 150 words. Cell Press caps it at 150; OUP, npj and BMC allow up to about 250.
- Names the resource or screen type (7/10) and states the association or prediction (9/10).
- Mentions validation in 6/10 and links to drugs in 4/10.
- Only 2/10 report a number.

## Display items (main total 5 / 6.5 / 8; figures 4-7)
**Required:**
- Overview schematic (8/10; Figure 1 in 6/10).
- Biomarker-association plot: a volcano, a score-vs-P bubble or rank plot, or a feature-vs-gene-effect correlation (8/10).

**Typical:**
- Gene-effect distribution, waterfall or box plot by biomarker (6/10).
- Deep-dive figure on one top hit (6/10).
- Heatmap across lineages (5/10).
- Key Resources or data-resources table in Methods (5/10).
- Wet-lab validation panels (6/10). These do not apply to Amani.

**Optional:**
- Gene dependency vs drug response (4/10). Treat this as required whenever the paper claims drug-target selectivity.
- Benchmark ROC/PR (4/10).
- Network or circos plot (3/10).
- UMAP (2/10).
- Target-priority score figure (2/10).
- Highlights box (3/10).

**Tables:** no exemplar puts a top-hits table in the main text. Full ranked results go in supplementary spreadsheets (9/10). The main text holds 0-2 tables.

## Required statements
- **Data availability (10/10):** names the screen release with its version, e.g. DepMap 23Q4 (8/10). 5/10 also give a figshare DOI.
- **Code availability (9/10):** GitHub in 8/10, Zenodo DOI in 7/10.
- **Funding and competing interests:** 10/10. **Author contributions:** 9/10.
- **Wet-lab papers only:** cell-line authentication (3/10), mycoplasma testing (4/10), accessions for new data (4/10).
- **Venue-specific:** Nature Reporting Summary (2/10); Cell Press Key Resources Table and Lead contact (3/10); EMBO Reagents and Tools table (1/10); BMC ethics line "not applicable" (1/10).
- **AI-use disclosure:** 0/10. Amani adds one by design.

## Checklists
- No EQUATOR or CRISPR-screen checklist is cited by any exemplar.
- **MDAR framework** (Macleod et al., PNAS 2021, 10.1073/pnas.2103238118) underlies the Nature Reporting Summary and Cell Press STAR Methods. No exemplar cites it by name.
- **Cell Press STAR Methods:** Marcus, Cell 2016, 10.1016/j.cell.2016.08.021.
- **MIACARM** was checked. It is a regenerative-medicine cellular-assay standard, not a CRISPR one, so do not cite it.

## Supplement
- **Required:** full ranked result tables as xlsx (9/10); supplementary figures, or Extended Data / Expanded View (10/10).
- **Typical:** peer review file (5/10).
- **Optional:** cell-line list with DepMap IDs, source data, Reporting Summary, supplementary note or appendix, gold-standard sets, reagent sequences (wet-lab only); 2/10 each.

## References
19 / 74 / 124. The low end is npj Precision Oncology at 19; without it the range is 53-124.

## Limitations
**Where they sit:** Cell Press uses a "Limitations of the study" subsection (168-274 words). Elsewhere they are Discussion paragraphs of about 150-450 words. E1 has no explicit limitations text.

**Standard concessions:**
- cell lines are not tumours, and the work is in vitro (5/10);
- screen artefacts such as copy-number cutting toxicity, off-target effects, or CRISPR-RNAi discordance (4/10);
- few cell lines per lineage, so low power (3/10);
- only some feature classes tested (3/10);
- the predictions are computational and need validation (3/10);
- sensitivity to thresholds (2/10);
- no healthy-tissue models, so the therapeutic window is unknown (2/10).

## Variation
- Most structural variation comes from house style:
  - **Cell Press:** STAR Methods, Key Resources Table, Highlights, In brief, Limitations subsection.
  - **Nature family:** Methods last, separate code statement, Reporting Summary, Extended Data.
  - **BMC:** structured abstract and a Conclusions section.
  - **EMBO:** Expanded View figures and a Synopsis.
  - **OUP:** IMRaD order.
  - **PLOS:** Author summary, with statements in the front matter.
- Design drives the rest. Computational-only papers replace validation figures with benchmarks against known positives and independent screens.

## Three most important structural requirements
1. Name and version the screen data and its scoring model: release (e.g. DepMap 23Q4) with DOI, plus Chronos/CERES/DEMETER2. Also give the multiple-testing method. Back it with data and code availability statements (GitHub plus Zenodo).
2. Make the core claim a biomarker-to-dependency association with lineage handled. Show it with a schematic, an association plot (volcano or score-vs-P with an FDR line) and a gene-effect distribution figure. Put the full ranked results in supplementary spreadsheets.
3. Show credibility by recovering known positives and replicating in an independent screen. When drug-target selectivity is claimed, add a gene-dependency vs drug-response figure (PRISM/GDSC/CTRP). Computational-only papers must concede the lack of experimental validation and the cell-line vs tumour gap in Limitations.

---
Normalisation pass (coordinator, 2026-10-13): every levelled entry in `crispr-dependency-target-selectivity.json` now carries `basis` (frequency, both, or guideline; guideline means required by the reporting guideline although fewer than 80% of exemplars comply). Subsection headings are levelled by how often the heading itself appears, and guideline content is enforced by section elements. Checklists carry a `kind`, Key Points and highlights items are flagged `venue_governed`, and design-dependent items carry `applies_when`. See README.md.
