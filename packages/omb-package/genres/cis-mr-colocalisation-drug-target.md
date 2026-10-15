# Genre profile: cis-MR plus colocalisation of a protein or drug target

Slug `cis-mr-colocalisation-drug-target` · built 2026-10-13 · schema genre-profile/1 · JSON: `cis-mr-colocalisation-drug-target.json`

**Scope.** Drug-target / cis-MR papers. Each perturbs a protein or drug target using variants in or near its gene (cis-pQTL, cis-eQTL, or gene-region variants weighted by a downstream biomarker), estimates the effect on disease outcomes, and uses Bayesian colocalisation to rule out confounding by LD. Covers single- or multi-target papers and proteome-wide drug-target MR + coloc screens. It does not cover polygenic lifestyle MR, single-cell transcriptome-wide MR, GWAS-discovery papers, methods papers or reviews.

## Exemplars (8; 5 single/multi-target, 3 proteome-wide)

| ID | Journal (family) | Year | DOI | Licence | Main words (excl. Methods) | Figs/Tables | Refs |
|---|---|---|---|---|---|---|---|
| E1 | PLOS Medicine | 2022 | 10.1371/journal.pmed.1003897 | CC0 | 6045 (3960) | 8/4 | 86 |
| E2 | BMC Medicine | 2023 | 10.1186/s12916-023-03227-5 | CC BY | 3660 (2349) | 3/1 | 70 |
| E3 | Nature Communications | 2024 | 10.1038/s41467-024-49109-z | CC BY | 5417 (3234) | 5/0 | 59 |
| E4 | Cell Reports Medicine | 2023 | 10.1016/j.xcrm.2023.101174 | CC BY-NC-ND | 4842 (3455) | 3/1 | 50 |
| E5 | eBioMedicine (Lancet family) | 2023 | 10.1016/j.ebiom.2023.104803 | CC BY | 4599 (3076) | 3/1 | 57 |
| E6 | JAMA Psychiatry (author manuscript) | 2025 | 10.1001/jamapsychiatry.2025.0033 | CC BY | 3370 (3015) | 4/1 | 57 |
| E7 | J Am Heart Assoc | 2025 | 10.1161/jaha.124.038193 | CC BY-NC-ND | 3558 (2412) | 4/1 | 53 |
| E8 | European Respiratory Journal | 2022 | 10.1183/13993003.03979-2020 | CC BY-NC | 3712 (3027) | 4/4 | 61 |

Disease areas covered: oncology (non-pancreatic), renal, cardiometabolic, type 2 diabetes, psychiatric, vascular and respiratory. Targets: ACE/ADRB1/SLC12A3, SLC13A5, CETP, metformin targets, and proteome-wide screens (deCODE, UKB-PPP, Fenland, INTERVAL).

## Canonical order and word ranges (min / typical / max)

1. Title: names MR (8/8), names the target or says "proteome-wide" (8/8), and has a colon subtitle naming the design (7/8)
2. Abstract: 150 / 300 / 450 words
3. Venue summary box (optional; the venue decides which)
4. Introduction: 250 / 500 / 650, no subsections, ends with an aims paragraph
5. Methods: 350 / 1350 / 2200. Usual blocks: data sources, instrument selection, MR, colocalisation, sensitivity, multiple testing, downstream biology
6. Results: 700 / 1100 / 1550. Primary MR, then coloc, sensitivity, replication and downstream biology
7. Discussion: 900 / 1350 / 1900 (includes limitations). A strengths paragraph comes just before the limitations (5/8)
8. Limitations: 250 / 500 / 600 (required content; has its own heading in only 3/8)
9. Conclusions: 50 / 80 / 100 (has a heading in 4/8)
10. Back matter: data availability, code availability, ethics, funding, competing interests, contributions, acknowledgements, references (50 / 58 / 86), supplement

Main text 3350 / 4150 / 6050 words; excluding Methods 2350 / 3050 / 3950.
Order variants: IMRaD(+C) in E1, E2, E5, E7, E8; separate Limitations + Conclusions in E6; Methods last in E3 (Nature) and E4 (Cell Press STAR Methods).

## Abstract

Structured in 6/8: PLOS (Background / Methods and findings / Conclusions), BMC and ERS (IMRC), Lancet (adds Findings / Interpretation / Funding), JAMA (Importance ... Conclusions and Relevance), AHA (Background / Methods and Results / Conclusions). Unstructured in 2/8 (Nature Communications, Cell Press).
Required content: names MR (8/8), names the target and genetic proxy (8/8), and gives sample size or number of proteins (7/8).
Typical content: an effect estimate (4/8), a coloc result (4/8), replication (4/8), and a drug-development framing (7/8).
Extra summary layers depend on the venue (7/8 have one): Key Points (JAMA), Research in context (Lancet), Clinical Perspective (AHA), Author summary (PLOS), Highlights/eTOC (Cell), short abstract (ERJ).

## Display items, in priority order (main total 4 / 5 / 12)

| Pri | id | Level | Seen |
|---|---|---|---|
| 1 | study_design_schematic (flowchart or DAG) | required | 7/8 main |
| 2 | forest_plot of MR estimates | typical | 5/8 main (the others use results tables) |
| 3 | regional_association_plot (LocusZoom + coloc) | typical | 4/8 (3 main, 1 supplement) |
| 4 | coloc_table (PP.H0-H4) | typical | 5/8 (1 main) |
| 5 | volcano_plot / Manhattan-style protein screen | optional | 2/8 (2 of 3 proteome-wide) |
| 6 | results_table | typical | 4/8 main |
| 7 | instrument_table (per-variant, F-stat) | required | 1/8 main, 6/8 supplement |
| 8 | dataset_table (GWAS sources) | typical | 6/8 (3 main) |
| 9 | sensitivity_table | required | 1/8 main, 7/8 supplement |
| 10 | heatmap | optional | 3/8 |
| 11 | mr_scatter / leave-one-out | optional | 2/8 supplement |
| 12 | validation_panel (tissue / single-cell expression) | optional | 2/8 |
| 13 | key_points_box (venue box) | optional | 3/8 |

No exemplar has a PheWAS figure or a plot of how coloc results change with the prior.

## Required statements

- **STROBE-MR statement plus checklist.** Required by the guideline and by the PLOS ONE editorial. Only 3/8 cite STROBE-MR and 2/8 attach the checklist.
- **Data availability, with an accession for each GWAS/pQTL source.** 6/8 have an explicit statement.
- **Code availability.** Only 4/8 have one.
- **Ethics** (approvals from the original studies; no new approval needed): 7/8.
- **Funding:** 8/8. **Competing interests:** 8/8. **Author contributions:** 7/8.
- **Software and versions:** 8/8 name the software, but only 2/8 give versions.
- **Pre-registration statement** (STROBE-MR item 9b): 0/8.

## Checklists and method references

- **STROBE-MR** (Skrivankova et al., JAMA 2021, doi 10.1001/jama.2021.18236; E&E in BMJ 2021;375:n2233). Required.
- **coloc** (Giambartolomei et al., PLoS Genet 2014, doi 10.1371/journal.pgen.1004383). Cited by 5/8. Priors are stated in 3/8, all with p12 = 1e-5. The PP.H4 threshold is usually 0.8. Only E4 uses coloc-SuSiE.
- **Optional references:** PLOS ONE MR editorial (2025: checklist plus a second independent dataset); Burgess MR guidelines (2/8); drug-target MR guidance, Schmidt 2020 or Gill 2021 (2/8).

## Supplement contents

- **Required:** STROBE-MR checklist; per-variant instrument list; full MR results, including nulls; sensitivity analyses.
- **Typical:** coloc posterior-probability tables; data-source details; PheWAS / PhenoScanner look-ups; extended methods; enrichment and druggability tables.
- **Optional:** regional plots; reverse-MR / Steiger results; scatter / leave-one-out.

## Limitations conventions

- **Placement:** unheaded paragraph(s) near the end of the Discussion (5/8). They usually follow a strengths paragraph and are listed as "First ... Last", each with a mitigation.
- **Standard items:**
  - genetic vs pharmacological perturbation (lifelong and small vs late and large): 4/8
  - ancestry: 5/8
  - power: 5/8
  - pleiotropy: 4/8
  - coloc assumptions (single causal variant, low power): 4/8
  - protein assay / epitope effects: 4/8 of all papers, all 3 proteome-wide ones among them
  - optional: outcome-definition heterogeneity, need for trials or functional work, selection/collider bias, tissue relevance, sample overlap, linearity

## Variation

There are two sub-designs on one skeleton:
- **Single-target papers:** the instrument is weighted by a biomarker, a few outcomes are tested, the evidence is triangulated against trials, and the main displays are forest and regional plots.
- **Proteome-wide papers:** 1,000-3,000 proteins are tested, cis and trans instruments are reported separately, Bonferroni or FDR correction is applied, and hits are tiered by MR + coloc + SMR/HEIDI + replication. They add enrichment and druggability, and their displays are a workflow figure, a volcano plot, a heatmap and a tiered table.

Venue house style sets where Methods go (last in Nature and Cell; eMethods in JAMA) and which summary layer is added. Replication in a second dataset appears in 6/8, positive controls in 4/8, and directionality checks (Steiger or reverse MR) in 3/8.

## Three most important structural requirements

1. **Colocalisation for every MR-significant pair.** Each significant pair needs a colocalisation result (PP.H4, with priors and threshold stated in Methods), plus a regional plot in the main text or supplement.
2. **Full instrument specification.** Methods must give the exposure source with N and ancestry, the cis window, the clumping r² and LD panel, and F-statistics. A per-variant instrument table goes in the main text or supplement (STROBE-MR items 4-6 and 10-11).
3. **Scaled MR estimates with sensitivity and limitations.** Estimates are scaled to a stated unit and signed as target inhibition, and shown in a forest plot or results table. Pleiotropy-robust sensitivity analyses are required. Limitations must state the genetic-vs-pharmacological and ancestry caveats.

---
Normalisation pass (coordinator, 2026-10-13): every levelled entry in `cis-mr-colocalisation-drug-target.json` now carries `basis` (frequency, both, or guideline; guideline means required by the reporting guideline although fewer than 80% of exemplars comply). Subsection headings are levelled by how often the heading itself appears, and guideline content is enforced by section elements. Checklists carry a `kind`, Key Points and highlights items are flagged `venue_governed`, and design-dependent items carry `applies_when`. See README.md.
