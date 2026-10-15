# Genre profile: trial-level surrogate endpoint evaluation

Slug `trial-level-surrogate-evaluation` · genre-profile/1 · built 2026-10-13 · JSON: `trial-level-surrogate-evaluation.json`

**Scope.** Meta-analyses that test whether treatment effects on a candidate surrogate (PFS, PFS2, RFS, ORR, pCR, MRD, proteinuria, LDL-C, KCCQ) predict treatment effects on the final endpoint (OS, kidney failure, CV events) across randomised trials.

- Covered: aggregate-data systematic reviews with weighted trial-level regression (6/9); IPD two-level designs with copula or Bayesian models (3/9).
- Excluded: single-trial mediation, prognostic-marker studies without randomised contrasts, reviews of surrogacy methods.

## Exemplars

| ID | Journal | Year | DOI | Licence | Main words | Figs/Tables | Refs |
| --- | --- | --- | --- | --- | --- | --- | --- |
| E1 | JAMA Netw Open (rectal pCR) | 2025 | 10.1001/jamanetworkopen.2025.21197 | CC BY | 2990 | 4/1 | 73 |
| E2 | eClinicalMedicine (pan-tumour ICI) | 2023 | 10.1016/j.eclinm.2023.102156 | CC BY-NC-ND | 3723 | 2/2 | 190 |
| E3 | J Clin Oncol (CLL, IPD) | 2025 | 10.1200/jco.24.01192 | CC BY | 3326 | 3/2 | 58 |
| E4 | ESMO Open (breast PFS2) | 2026 | 10.1016/j.esmoop.2026.106062 | CC BY | 4826 | 4/1 | 49 |
| E5 | J Immunother Cancer (melanoma, IPD) | 2026 | 10.1136/jitc-2026-016440 | CC BY-NC | 4940 | 4/2 | 61 |
| E6 | JNCI (adjuvant ICI RFS) | 2023 | 10.1093/jnci/djad125 | CC BY-NC | 2687 | 4/1 | 39 |
| E7 | Eur Heart J Cardiovasc Pharmacother (statins) | 2025 | 10.1093/ehjcvp/pvaf016 | CC BY-NC | 2962 | 2/1 | 27 |
| E8 | Adv Ther (IgA nephropathy, IPD) | 2026 | 10.1007/s12325-025-03402-5 | CC BY-NC | 3373 | 3/3 | 40 |
| E9 | Int J Cardiol Heart Vasc (heart failure, KCCQ) | 2026 | 10.1016/j.ijcha.2026.101881 | CC BY | 2240 | 2/1 | 27 |

Six exemplars are oncology and three are not. Seven publisher families appear: JAMA, Lancet/Elsevier, ASCO, ESMO, BMJ, Oxford, Springer. Counts come from the fixed `jats_structure.py`; each exemplar's `measured.corrections` lists the fixes.

## Canonical order and word ranges (min / typical / max)

1. Title: names surrogate and final endpoint (9/9); uses "surrogate/surrogacy" (7/9).
2. Abstract, structured (8/9): 250 / 300 / 400.
3. Venue summary box (6/9): 50 / 125 / 250.
4. Introduction: 250 / 450 / 800.
5. Methods: 600 / 800 / 1300.
   - Search and selection (8/9); data extraction (5/9); endpoint definitions (9/9); risk of bias (5/9).
   - Statistical analysis (8/9): 250 / 350 / 900.
6. Results: 350 / 650 / 1950. Characteristics; trial-level surrogacy (R² with CI, slope, strength label); individual- or arm-level association (5/9); subgroup/sensitivity (7/9); validation (7/9); STE (2/9).
7. Discussion: 750 / 1150 / 1800, with a limitations paragraph (9/9).
8. Conclusions as a separate section (optional, 4/9): 50-100 words.
9. Back matter: data availability, funding, competing interests (8/9 each); ethics (5/9); contributions (7/9). Then references and supplement.

Main text: 2250 / 3350 / 4950 words; 1450 / 2450 / 3950 without Methods. Methods always come before Results.

## Abstract

Headings by venue:

- JAMA: 8 headings.
- Lancet family: Background, Methods, Findings, Interpretation, Funding.
- JCO: Purpose, Patients and Methods, Results, Conclusion.
- Elsevier, BMJ, Oxford: Background, Methods, Results, Conclusion.
- Springer: Introduction, Methods, Results, Conclusions.

Must contain: number of trials (9/9, often spelled out, e.g. "Eighteen RCTs"), number of patients (7/9), R² with 95% CI (7/9), and an explicit surrogacy verdict (9/9). The STE appears in only 2/9 abstracts.

## Display items (priority order)

1. **Surrogacy scatter** (required, 9/9, 1-4 per paper): log effect on the surrogate vs on the final endpoint, bubbles sized by weight, weighted regression line. Only 3/9 draw the 95% prediction band and 1/9 marks the STE; ReSEEM item 22 asks for both.
2. **Trial characteristics table** (required, 8/9, main or supplement).
3. **PRISMA flow** (required whenever a systematic search was run; 7/9).
4. Typical: R² results table (5/9); supplementary leave-one-out or sensitivity tables (5/9).
5. Optional: arm-level scatter (3/9, new id); Kaplan-Meier curves by surrogate status (IPD only); risk-of-bias figure; forest plots; funnel plot; venue box.

Main-text display items: 3 / 5 / 6.

## Required statements

- Registration (PROSPERO or OSF, or "not registered"): PRISMA 2020 item 24a requires it. Present in 4/9; 4/6 aggregate-data reviews.
- Data availability, funding, competing interests: 8/9 each.
- Typical: reporting-guideline statement (6/9); ethics (5/9; "not required" for published aggregate data); contributions (7/9).
- Optional: patient and public involvement (2/9).

## Checklists (verified citations)

- **ReSEEM**: Xie W et al. JNCI Cancer Spectr 2019;3(1):pkz002 (doi 10.1093/jncics/pkz002). The genre's 28-item guideline; no 2024 update exists. Cited by 3/9; 1/9 states adherence.
- **PRISMA 2020**: Page MJ et al. BMJ 2021;372:n71. Cited by 2/9; 6/9 cite some PRISMA version (2009 by 3/9, PRISMA-P by 1/9).
- **PRISMA-IPD**: JAMA 2015;313:1657. Cited by 0/9.
- **IQWiG A10-05 (2011)**: cited by 3/9. Uses the 95% CI of r: lower bound ≥0.85 means high validity, upper bound ≤0.7 means low.
- **Ciani framework**: Value Health 2017;20:487. Some version cited by 3/9; the 2023 eClinicalMedicine framework by 0/9.
- **[author omitted] 2000 meta-analytic framework**: cited by 7/9.
- **NICE DSU TSD 20** (Bujkiewicz 2019, updated 2022): cited by 0/9.
- **CONSORT-Surrogate and SPIRIT-Surrogate** (BMJ 2024;386:e078524 and e078525): cited by 0/9. They cover trial reports and protocols, not this design.

## Supplement

- Required: per-trial effect estimates on both endpoints (ReSEEM item 21); full search strategy.
- Typical: sensitivity analyses (leave-one-out, alternative models, subgroup scatters).
- Optional: risk-of-bias table, characteristics table, excluded studies, funnel plot, extended copula or Bayesian methods, individual-level detail.

## References

27 / 49 / 190. E2's 190 is an outlier; the next highest is 73.

## Limitations

- **Placement:** usually an unheaded paragraph near the end of the Discussion that opens "This study has several limitations" (8/9). Only JAMA (E1) gives it a heading.
- **Length:** 150 / 200 / 600 words, often after or merged with a strengths paragraph.
- **Standard items:** trial-level data only or partial IPD (9/9); few trials and wide CIs (5/9); between-trial heterogeneity (5/9); immature final endpoint (5/9); specific to a drug class or setting (3/9); endpoint definitions differ across trials (3/9); crossover or post-progression therapy (3/9); risk of bias in included trials (3/9); selection or publication bias (2/9).

## Variation

The type of data drives the structure. Aggregate-data reviews include the PRISMA material (registration, flow diagram, risk of bias) and report arm-level association. IPD papers drop the flow diagram and registration, and add copula or Bayesian models and Kaplan-Meier curves.

The venue sets the abstract headings, the summary box and whether Conclusions is a separate section. Interpretation thresholds also vary: ReSEEM R² bands, the IQWiG CI rule, or ad hoc bands.

## Three most important structural requirements

1. **The surrogacy scatter in the main text.** One bubble per trial or comparison, sized by weight, with the weighted regression line, a 95% prediction band and the STE when one is reported. R² with its CI and the number of trials must support it in both the abstract and the Results.
2. **Methods that pin down the analysis.** They state the unit of analysis and the weighting, the effect metrics on a log scale, the trial-level model, the prespecified surrogacy thresholds (ReSEEM R² bands or IQWiG), validation (leave-one-out or external trials) and the subgroup/sensitivity plans. The abstract's verdict must match those thresholds.
3. **The evidence trail for the design.**
   - Aggregate data: PRISMA flow, registration, search strategy, risk of bias, and per-trial effect estimates.
   - IPD: trial provenance, ethics and consent, and the individual-level method.
   - Both: a limitations paragraph naming the data level, the number of trials and endpoint maturity.

---
Normalisation pass (coordinator, 2026-10-13): every levelled entry in `trial-level-surrogate-evaluation.json` now carries `basis` (frequency, both, or guideline; guideline means required by the reporting guideline although fewer than 80% of exemplars comply). Subsection headings are levelled by how often the heading itself appears, and guideline content is enforced by section elements. Checklists carry a `kind`, Key Points and highlights items are flagged `venue_governed`, and design-dependent items carry `applies_when`. See README.md.
