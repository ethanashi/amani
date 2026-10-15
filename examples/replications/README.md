# Blind replications

Amani received a research question and public data with the study identity hidden. Disease, gene and variable names were replaced with consistent codes; row and column orders were permuted. Case-specific rounding and coordinate transforms removed numeric fingerprints while preserving the statistical structure needed for the analysis.

Across these **retired Tier B cases**, Amani met **59 of 66 grading criteria on sealed one-shot cases**. The papers keep the disguised names Amani saw. Each reveal connects its blind result to the real study and documents the source data, licence decision and exact task.

| Case | Real study | Field | What Amani reproduced | Grade | Blind paper |
|---|---|---|---|---|---|
| [C3: Infliximab response](infliximab-response/README.md) | [A reproducible pretreatment mucosal-inflammatory-remodeling state is associated with induction-phase anti-tumor necrosis factor non-response in ulcerative colitis](https://doi.org/10.3389/fgene.2026.1845510) — Hongwei Zheng et al., 2026 | Transcriptomics / ulcerative colitis | Higher expression in non-responders; detected cohort overlap and loss of adjusted specificity | **8/8 criteria** | [PDF](infliximab-response/paper.pdf) · [page 1](infliximab-response/paper-page-1.png) |
| [C4: Factor XI](factor-xi/README.md) | [Leveraging genetic predictors of factor XI levels to anticipate results from clinical trials](https://doi.org/10.1111/ene.15820) — Iyas Daghlas and Dipender Gill, 2023 | Human genetics / thrombosis | FXI outcome ordering: strongest protection for VTE, then cardioembolic stroke; bleeding arms inconclusive | **18/18 criteria** | [PDF](factor-xi/paper.pdf) · [page 1](factor-xi/paper-page-1.png) |
| [C1: GPNMB and Parkinson’s](gpnmb-parkinsons/README.md) | [Integrative clinical and genomic analyses reveal a causal role of GPNMB in the bone-brain axis of Parkinson’s disease](https://doi.org/10.1038/s41531-026-01325-8) — Xingzhi Guo et al., 2026 | Human genetics / Parkinson’s disease | Higher GPNMB associated with higher Parkinson’s risk in both cohorts, with a weaker replication estimate | **14/16 criteria** | [PDF](gpnmb-parkinsons/paper.pdf) · [page 1](gpnmb-parkinsons/paper-page-1.png) |
| [C2: Muscle splicing](muscle-splicing/README.md) | [Transcriptome alterations in myotonic dystrophy skeletal muscle and heart](https://doi.org/10.1093/hmg/ddy432) — Eric T. Wang et al., 2019 | RNA splicing / neuromuscular disease | Cross-muscle splicing concordance, comparator overlap and appropriate limits on generalisation | **12/15 criteria** | [PDF](muscle-splicing/paper.pdf) · [page 1](muscle-splicing/paper-page-1.png) |
| [C5: Batch adjustment](batch-adjustment/README.md) | [Methods that remove batch effects while retaining group differences may lead to exaggerated confidence in downstream analyses](https://doi.org/10.1093/biostatistics/kxv027) — Vegard Nygaard et al., 2016 | Statistical genomics / batch effects | Both published discovery counts: 2,011 after pre-adjustment; 11 with batch in the model | **7/9 criteria** | [PDF](batch-adjustment/paper.pdf) · [page 1](batch-adjustment/paper-page-1.png) |

The suite includes positive associations, replication audits and a published statistical-artifact reanalysis. A full case grade means every case criterion passed; it does not endorse every conclusion in the source publication. For cases with partial grades, the reveals highlight only reproduced findings.

## Read the papers and reproduce the inputs

Every case provides a PDF, first-page PNG, manuscript source, evaluated report and unchanged grade. Papers were drafted retrospectively through Amani’s Codex drafting runtime using only blinded task, frozen executed code and selected run facts. The original investigation and grade were retained. The reveal and grading answer were not supplied to the manuscript model.

The archived certification summaries retain their native scientific claim labels. Those labels are separate from the benchmark criteria. These are reading preprints, with cross-family manuscript review and owner endorsement pending; no submission or endorsement certificate was fabricated.

Factor XI’s disguised summary-statistic inputs are bundled under CC0. The other measurement inputs are fetched from their original public sources and reconstructed with the retired staging code, explicit name maps and deterministic permutations. The Hallmark annotation included with C3 is attributed under CC BY 4.0. Each data route verifies the exact original served-file hashes; no controlled-access data are included.

See [validation and build instructions](VALIDATION.md) and return to [Amani](../../README.md).
