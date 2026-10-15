# Genre profile: SR/MA of adverse events from randomized trials

`sr-ma-adverse-events-rct` · built 2026-10-13 · schema genre-profile/1 · full contract in `sr-ma-adverse-events-rct.json`

**Scope.** A systematic review that pools harm or adverse-event outcomes, or an unintended benefit used as a repurposing signal, for a drug or drug class across RCTs. It reports pooled RR/OR/rate ratios, heterogeneity, risk of bias and (ideally) certainty. The core design is a pairwise aggregate-data MA (6/8). Covered variants: one network MA of harms (E3), one IPD MA of double-blind trials (E4) and one benefit-harm review (E8). Not covered: observational or pharmacovigilance MAs, single-arm incidence pooling, Cochrane reviews.

## Exemplars

| ID | Journal | Year | DOI | Licence | Main words | Figs/Tabs | Refs |
|---|---|---|---|---|---|---|---|
| E1 | JAMA Netw Open | 2022 | 10.1001/jamanetworkopen.2022.7722 | CC BY | 3288 | 3/2 | 65 |
| E2 | JAMA Netw Open | 2024 | 10.1001/jamanetworkopen.2024.49017 | CC BY | 2296 | 4/1 | 33 |
| E3 | The BMJ (NMA) | 2025 | 10.1136/bmj-2024-082834 | CC BY-NC | 5221 | 6/0 | 81 |
| E4 | The Lancet (CTT, IPD) | 2022 | 10.1016/S0140-6736(22)01545-8 | CC BY | 5104 | 4/2 | 53 |
| E5 | eClinicalMedicine | 2026 | 10.1016/j.eclinm.2026.104113 | CC BY-NC-ND | 5139 | 3/2 | 32 |
| E6 | J Am Heart Assoc | 2024 | 10.1161/JAHA.123.032390 | CC BY-NC | 2286 | 4/1 | 40 |
| E7 | Eur Heart J Cardiovasc Pharmacother | 2025 | 10.1093/ehjcvp/pvaf040 | CC BY | 2647 | 5/2 | 35 |
| E8 | PLOS Medicine | 2025 | 10.1371/journal.pmed.1004568 | CC BY | 5394 | 5/5 | 46 |

Topics: ICI neurologic AEs; DOAC vs aspirin intracranial bleeding; EGFR-TKI cardiotoxicity; statin muscle symptoms; ICI infections; omega-3 bleeding; SGLT2i and AF (unintended benefit); anti-amyloid ARIA.

## Canonical section order (words: min / typical / max)

1. Title: names the drug or class, the harm and the design (8/8); says "randomised" in 4/8
2. Structured abstract: 250 / 350 / 500
3. Venue summary layer (7/8): Key Points, Research in context, What this study adds, Clinical Perspective or Author summary
4. Introduction: 150 / 300 / 600 (harm signal and uncertainty; objective in the last paragraph, 8/8)
5. Methods: 500 / 850 / 1900. Registration; search and selection; extraction; AE definitions; RoB; certainty; statistics; subgroups/meta-regression; sensitivity
6. Results: 500 / 1400 / 1850. Selection and characteristics; RoB; primary harm; secondary harms; subgroups; sensitivity and reporting bias
7. Discussion: 600 / 1200 / 1950, with limitations inside it (100 / 200 / 300)
8. Conclusions: a separate section in 3/8, nested in 1/8 (BMJ); 50 / 100 / 100
9. Back matter: data availability (7/8), funding (7/8), competing interests (8/8), contributions (6/8), ethics (5/8), references, supplement

Main text 2300 / 4200 / 5400 words. Length splits by venue: JAMA, AHA and ESC papers run 2.3-3.3k words; BMJ, Lancet, eClinicalMedicine and PLOS run 5.1-5.4k.

## Abstract

Structured in 8/8, 259-489 words. Heading sets: JAMA (8 headings), BMJ (8, ends with "Systematic review registration"), Lancet family (Background/Methods/Findings/Interpretation/Funding), AHA (Background / Methods and Results / Conclusions), ESC (Aims / Methods and results / Conclusion), PLOS (Background / Methods and findings / Conclusions). Always present (8/8): number of trials, number of participants, and the pooled ratio with its 95% CI. Often missing PRISMA-A items: risk of bias (2/8), registration (2/8), funding (2/8), limitations of the evidence (4/8). Checklist: PRISMA 2020 for Abstracts.

## Display items (priority order)

| Pri | id | Level | Freq | Placement |
|---|---|---|---|---|
| 1 | forest_plot (2-4 per paper) | required | 8/8 | main |
| 2 | prisma_flow | required | 7/8 (main 6, supp 1) | main-or-supplement |
| 3 | characteristics_table | required | 8/8 (main 7) | main-or-supplement |
| 4 | key_points_box (venue form) | required | 7/8 | main, not counted in caps |
| 5 | sof_table (GRADE) | optional | 2/8 | main (recommended) |
| 6 | results_table | typical | 4/8 | main |
| 7 | meta_regression_bubble | optional | 3/8 | main-or-supplement |
| 8 | rob_summary_figure | required | 5/8 | supplement |
| 9 | funnel_plot | required | 7/8 | supplement |
| 10 | network_geometry (NMA only) | optional | 1/8 | main |

Main-text figures + tables: 5 / 5.5 / 10.

## Required statements

Registration with ID (required by PRISMA; present in 4/8) · PRISMA adherence (7/8) · data availability (7/8) · funding (7/8) · competing interests (8/8) · role of funder (typical, 5/8) · ethics "not required" (typical, 5/8) · contributions (typical, 6/8) · code repository (optional, 3/8) · patient and public involvement (BMJ only).

## Checklists

PRISMA 2020 (required; 7/8 say they follow PRISMA, but only 2/8 cite the 2020 statement and 2/8 still cite 2009) · PRISMA 2020 for Abstracts · RoB 2 (4/8; 6/8 use some RoB tool) · GRADE (required by PRISMA items 15 and 22; done in 1/8, plus CINeMA in 1/8) · PRISMA harms 2016 (cited by 0/8; recommended) · Cochrane Handbook ch. 19 (the Handbook is cited by 2/8, chapter 19 by none) · PRISMA-NMA and CINeMA for networks.

## Supplement

Required: full search strategy (published in 5/8) · funnel plots (7/8) · per-trial RoB (5/8) · PRISMA checklist (published in 3/8; journals require it at submission). Typical: included-trial details with per-arm events · extra forest plots · sensitivity analyses · AE definitions and term lists. Optional: meta-regression and subgroup figures. Usually one bundled file; PLOS uses 52 files.

## References

32 / 43 / 81.

## Limitations conventions

Always inside the Discussion. It is a headed subsection in 4/8 (JAMA, BMJ, ESC) and an unheaded paragraph in 4/8 (Lancet family, AHA, PLOS). The paragraph opens with a stock phrase and enumerates "First... Second..." (6/8), with a mitigation after each item. Standard items:
- heterogeneous, non-systematic AE ascertainment (required, 7/8)
- trial-level data only (typical, 5/8)
- clinical heterogeneity (typical, 5/8)
- sparse events and imprecision (typical, 4/8)
- agents or doses pooled (optional, 3/8)
- missing or unpublished data (optional, 3/8)
- exposure-time bias (optional, 2/8)
- trial populations not generalisable (optional, 2/8)

## Variation

House style drives most differences: length, Results subheadings (JAMA/BMJ/PLOS yes; Lancet/AHA/ESC no), Conclusions placement, the form of the summary box, and where the role-of-funder statement sits. Reporting rigour varies independently of journal tier. Registration, RoB 2 and GRADE are each missing from half or more of the exemplars, so the profile marks guideline-mandated items required even where exemplars skip them. The design variants add items: NMA brings network geometry and CINeMA; IPD drops PRISMA, the flow diagram and RoB, and adds ethics approval and absolute excess per 1000 person-years; the benefit-harm review adds efficacy forest plots and NNT/NNH.

## The 3 most important structural requirements

1. **Harm forest plots plus pooled numbers.** Each harm outcome gets a forest plot showing per-arm events and totals, a log-ratio axis with a line at 1, a pooled diamond, the model and I2. The abstract gives the number of trials and participants and the pooled ratio with its 95% CI.
2. **Defined, traceable harms.** Methods name the AE dictionary and grade (CTCAE, MedDRA, ISTH, or trial definitions; serious vs any grade; treatment-related vs treatment-emergent), list databases and registries with search dates, and give the registration ID. A PRISMA flow diagram (main or supplement) and per-trial RoB 2 are required, and the Limitations must concede heterogeneous AE ascertainment.
3. **Relative plus absolute effects, with certainty.** Report a risk difference, events per 1000 or NNH next to each ratio, with GRADE certainty per outcome. A summary-of-findings table covers both, and it is the item most exemplars miss.

---
Normalisation pass (coordinator, 2026-10-13): every levelled entry in `sr-ma-adverse-events-rct.json` now carries `basis` (frequency, both, or guideline; guideline means required by the reporting guideline although fewer than 80% of exemplars comply). Subsection headings are levelled by how often the heading itself appears, and guideline content is enforced by section elements. Checklists carry a `kind`, Key Points and highlights items are flagged `venue_governed`, and design-dependent items carry `applies_when`. See README.md.
