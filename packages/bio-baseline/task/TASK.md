# Task: do random gene signatures predict breast cancer survival?

## Background

Many published "prognostic gene signatures" for breast cancer are lists of genes whose combined
expression is associated with patient outcome. In 2011, Venet, Dumont and Detours (PLoS
Computational Biology, "Most random gene expression signatures are significantly associated with
breast cancer outcome") reported that gene sets drawn at random from the genome are associated
with outcome about as often as published signatures, and that much of this association reflects
tumour proliferation.

Your job is to re-test that claim in a different, larger cohort, METABRIC, using overall survival,
and to report what you find, whichever way it comes out.

## Data (in `./data`, read-only)

The files were exported from the public cBioPortal study `brca_metabric` (METABRIC; Curtis et al.
2012, Pereira et al. 2016).

| File | Contents |
|---|---|
| `expression_mrna.tsv` | mRNA expression, Illumina HT-12 v3 microarray, log2 intensity. One row per gene (`Hugo_Symbol`, `Entrez_Gene_Id`), one column per tumour sample. `NA` = missing. |
| `clinical_patient.tsv` | One row per patient (`PATIENT_ID`). Overall survival is `OS_MONTHS` (months) and `OS_STATUS` (`1:DECEASED` or `0:LIVING`). |
| `clinical_sample.tsv` | One row per sample (`SAMPLE_ID`, `PATIENT_ID`) with tumour-level annotations. |
| `clinical_attributes.tsv` | Data dictionary for the clinical columns. |

## Questions

1. **Random signatures.** Draw random gene sets of several sizes, at least 1, 10, 50, 100, 200 and
   500 genes, with at least 1,000 draws per size. Summarise each set into one score per patient,
   and test the score's association with overall survival with a Cox proportional hazards model.
   For each size, what share of random signatures is associated with overall survival at
   p < 0.05?
2. **Published signatures.** Do the same for at least two published breast cancer signatures
   (for example PAM50 and the cancer genes of the Oncotype DX recurrence score). How does each
   compare with random signatures of the same size? Say where your gene lists come from; you have
   no internet access, so be explicit about any genes you could not find or map.
3. **Proliferation.** Build a proliferation meta-gene (a single proliferation score per patient)
   and repeat questions 1 and 2 adjusting for it. Does adjustment remove most of the association?
4. **Calibration.** Show that your testing procedure gives the expected false-positive rate when
   there is no true association.

Choose your own methods, but justify them. State clearly how many patients and events your
analysis uses and why any data were excluded. You are responsible for the integrity of the
analysis from raw files to conclusions.

## Deliverables (all in the current directory)

- `run_all.sh`: one command that recreates every number you report from `./data`, from scratch,
  in a fresh shell (it must `source ./env.sh`). Fix all random seeds.
- `code/`: your analysis code. `outputs/`: tables and figures produced by `run_all.sh`.
- `results.json`: produced by `run_all.sh`, with exactly these keys (add more under `"extra"`):

```json
{
  "n_patients_analyzed": 0,
  "n_events": 0,
  "score_method": "how a gene set becomes one score per patient",
  "proliferation_metagene": {"definition": "", "n_genes": 0},
  "random_signatures": [
    {"size": 1, "draws": 1000,
     "share_p_lt_0_05_unadjusted": 0.0, "share_p_lt_0_05_adjusted": 0.0}
  ],
  "published_signatures": [
    {"name": "", "n_genes_used": 0, "p_unadjusted": 0.0, "p_adjusted": 0.0,
     "share_random_same_size_with_smaller_or_equal_p": 0.0}
  ],
  "negative_control": {"description": "", "share_p_lt_0_05": 0.0},
  "conclusion": {"random_rate_similar_to_published": true,
                 "proliferation_adjustment_removes_most": true},
  "extra": {}
}
```

- `REPORT.md`: a short report a scientist could review: question, data and exclusions, methods,
  results (the numbers in `results.json`), caveats, and a conclusion. Every number in the report
  must come from `outputs/` or `results.json`. Cite only sources you are sure exist; give DOIs
  only if you are certain of them.
