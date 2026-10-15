# V3 calibration results on the V2d kernel (generated from records/)

Calibration: 88 certifications, 49 mismatches against the pre-registration, wall 3210 s (slowest of the parallel parts), git f33c80b.
V2c record (records/v2c/calibration.json): 49 mismatches. Round-2 record (records/calibration-v2r2.json): 54 mismatches; round-2 tables: RESULTS-v2r2.md.

## Labels per task (locked mode; adopt mode is exploratory for every claim)

| Task | Staging | Claim | Reference | Naive analyses | Reference gates | Naive gates |
|---|---|---|---|---|---|---|
| iad1-brady-audit | refused | fit_for_use | insufficient-evidence | naive: insufficient-evidence<br>lazy_skeptic: insufficient-evidence<br>zero_trap: insufficient-evidence | G1 -; G1a not-run (staging-unavailable); G1c not-run; G3 failed (not-executed); G4 failed; G5a failed; G5b-recovery failed; G6 not-run (not-executed) | G1 -; G1a not-run (staging-unavailable); G1c not-run; G3 failed (not-executed); G4 failed; G5a failed; G5b-recovery failed; G6 not-run (not-executed)<br>G1 -; G1a not-run (staging-unavailable); G1c not-run; G3 failed (not-executed); G4 failed; G5a failed; G5b-recovery failed; G6 not-run (not-executed)<br>G1 -; G1a not-run (staging-unavailable); G1c not-run; G3 failed (not-executed); G4 failed; G5a failed; G5b-recovery failed; G6 not-run (not-executed) |
| iad2-brady-twin | refused | fit_for_use | insufficient-evidence | naive: insufficient-evidence<br>lazy_skeptic: insufficient-evidence<br>zero_trap: insufficient-evidence | G1 -; G1a not-run (staging-unavailable); G1c not-run; G3 failed (not-executed); G4 failed; G5a failed; G5b-recovery failed; G6 not-run (not-executed) | G1 -; G1a not-run (staging-unavailable); G1c not-run; G3 failed (not-executed); G4 failed; G5a failed; G5b-recovery failed; G6 not-run (not-executed)<br>G1 -; G1a not-run (staging-unavailable); G1c not-run; G3 failed (not-executed); G4 failed; G5a failed; G5b-recovery failed; G6 not-run (not-executed)<br>G1 -; G1a not-run (staging-unavailable); G1c not-run; G3 failed (not-executed); G4 failed; G5a failed; G5b-recovery failed; G6 not-run (not-executed) |
| iad3-browning-count | refused | cohort_size | insufficient-evidence | naive: insufficient-evidence<br>strict_more_than_five: insufficient-evidence<br>visits_not_measurements: insufficient-evidence | G1 -; G1a not-run (staging-unavailable); G1c -; G3 not-run (not-executed); G4 not-run; G5a -; G5b-recovery -; G6 - | G1 -; G1a not-run (staging-unavailable); G1c -; G3 not-run (not-executed); G4 not-run; G5a -; G5b-recovery -; G6 -<br>G1 -; G1a not-run (staging-unavailable); G1c -; G3 not-run (not-executed); G4 not-run; G5a -; G5b-recovery -; G6 -<br>G1 -; G1a not-run (staging-unavailable); G1c -; G3 not-run (not-executed); G4 not-run; G5a -; G5b-recovery -; G6 - |
| p1-esr1 | raw | primary | insufficient-evidence | naive: insufficient-evidence | G1 failed; G1a failed; G1c pass; G3 failed; G4 failed; G5a pass; G5b-recovery failed; G6 pass | G1 failed; G1a failed; G1c pass; G3 failed; G4 failed; G5a pass; G5b-recovery failed; G6 pass |
| p10-pseudorep | refused | dlg4_effect | insufficient-evidence | naive: insufficient-evidence | G1 -; G1a not-run (staging-unavailable); G1c not-run; G3 failed (not-executed); G4 failed; G5a failed; G5b-recovery failed; G6 not-run (not-executed) | G1 -; G1a not-run (staging-unavailable); G1c not-run; G3 failed (not-executed); G4 failed; G5a failed; G5b-recovery failed; G6 not-run (not-executed) |
| p10b-pseudorep-hidden | refused | dlg4_effect | insufficient-evidence | naive: insufficient-evidence | G1 -; G1a not-run (staging-unavailable); G1c not-run; G3 failed (not-executed); G4 failed; G5a failed; G5b-recovery failed; G6 not-run (not-executed) | G1 -; G1a not-run (staging-unavailable); G1c not-run; G3 failed (not-executed); G4 failed; G5a failed; G5b-recovery failed; G6 not-run (not-executed) |
| p11-confounding | raw | primary | insufficient-evidence | naive: insufficient-evidence | G1 failed; G1a pass; G1c failed (aligned); G3 failed (missing-recomputed); G4 failed; G5a failed; G5b-recovery failed; G6 failed (incomplete-family) | G1 failed; G1a failed; G1c failed (aligned); G3 failed; G4 failed; G5a pass; G5b-recovery failed; G6 pass |
| p12-quality | raw | primary | insufficient-evidence | naive: tentative | G1 failed; G1a failed; G1c pass; G3 pass; G4 pass; G5a pass; G5b-recovery failed; G6 pass | G1 failed; G1a failed; G1c pass; G3 pass; G4 pass; G5a pass; G5b-recovery failed; G6 pass |
| p13-endpoint | refused | headline | exploratory | naive: exploratory | G1 -; G1a not-run (staging-unavailable); G1c not-run; G3 failed (not-executed); G4 failed; G5a failed; G5b-recovery failed; G6 - | G1 -; G1a not-run (staging-unavailable); G1c not-run; G3 failed (not-executed); G4 failed; G5a failed; G5b-recovery failed; G6 - |
|  |  | primary_efficacy | insufficient-evidence | naive: insufficient-evidence | G1 -; G1a not-run (staging-unavailable); G1c not-run; G3 failed (not-executed); G4 failed; G5a failed; G5b-recovery failed; G6 not-run (not-executed) | G1 -; G1a not-run (staging-unavailable); G1c not-run; G3 failed (not-executed); G4 failed; G5a failed; G5b-recovery failed; G6 not-run (not-executed) |
| p14-citation | refused | ref-1 | insufficient-evidence | naive: insufficient-evidence | G1 -; G1a not-run (staging-unavailable); G1c -; G3 not-run (not-executed); G4 not-run; G5a -; G5b-recovery -; G6 - | G1 -; G1a not-run (staging-unavailable); G1c -; G3 not-run (not-executed); G4 not-run; G5a -; G5b-recovery -; G6 - |
|  |  | ref-10 | insufficient-evidence | naive: insufficient-evidence | G1 -; G1a not-run (staging-unavailable); G1c -; G3 not-run (not-executed); G4 not-run; G5a -; G5b-recovery -; G6 - | G1 -; G1a not-run (staging-unavailable); G1c -; G3 not-run (not-executed); G4 not-run; G5a -; G5b-recovery -; G6 - |
|  |  | ref-2 | insufficient-evidence | naive: insufficient-evidence | G1 -; G1a not-run (staging-unavailable); G1c -; G3 not-run (not-executed); G4 not-run; G5a -; G5b-recovery -; G6 - | G1 -; G1a not-run (staging-unavailable); G1c -; G3 not-run (not-executed); G4 not-run; G5a -; G5b-recovery -; G6 - |
|  |  | ref-3 | insufficient-evidence | naive: insufficient-evidence | G1 -; G1a not-run (staging-unavailable); G1c -; G3 not-run (not-executed); G4 not-run; G5a -; G5b-recovery -; G6 - | G1 -; G1a not-run (staging-unavailable); G1c -; G3 not-run (not-executed); G4 not-run; G5a -; G5b-recovery -; G6 - |
|  |  | ref-4 | insufficient-evidence | naive: insufficient-evidence | G1 -; G1a not-run (staging-unavailable); G1c -; G3 not-run (not-executed); G4 not-run; G5a -; G5b-recovery -; G6 - | G1 -; G1a not-run (staging-unavailable); G1c -; G3 not-run (not-executed); G4 not-run; G5a -; G5b-recovery -; G6 - |
|  |  | ref-5 | insufficient-evidence | naive: insufficient-evidence | G1 -; G1a not-run (staging-unavailable); G1c -; G3 not-run (not-executed); G4 not-run; G5a -; G5b-recovery -; G6 - | G1 -; G1a not-run (staging-unavailable); G1c -; G3 not-run (not-executed); G4 not-run; G5a -; G5b-recovery -; G6 - |
|  |  | ref-6 | insufficient-evidence | naive: insufficient-evidence | G1 -; G1a not-run (staging-unavailable); G1c -; G3 not-run (not-executed); G4 not-run; G5a -; G5b-recovery -; G6 - | G1 -; G1a not-run (staging-unavailable); G1c -; G3 not-run (not-executed); G4 not-run; G5a -; G5b-recovery -; G6 - |
|  |  | ref-7 | insufficient-evidence | naive: insufficient-evidence | G1 -; G1a not-run (staging-unavailable); G1c -; G3 not-run (not-executed); G4 not-run; G5a -; G5b-recovery -; G6 - | G1 -; G1a not-run (staging-unavailable); G1c -; G3 not-run (not-executed); G4 not-run; G5a -; G5b-recovery -; G6 - |
|  |  | ref-8 | insufficient-evidence | naive: insufficient-evidence | G1 -; G1a not-run (staging-unavailable); G1c -; G3 not-run (not-executed); G4 not-run; G5a -; G5b-recovery -; G6 - | G1 -; G1a not-run (staging-unavailable); G1c -; G3 not-run (not-executed); G4 not-run; G5a -; G5b-recovery -; G6 - |
|  |  | ref-9 | insufficient-evidence | naive: insufficient-evidence | G1 -; G1a not-run (staging-unavailable); G1c -; G3 not-run (not-executed); G4 not-run; G5a -; G5b-recovery -; G6 - | G1 -; G1a not-run (staging-unavailable); G1c -; G3 not-run (not-executed); G4 not-run; G5a -; G5b-recovery -; G6 - |
| p16-recovery | raw | primary | insufficient-evidence | naive: insufficient-evidence | G1 failed; G1a failed; G1c pass; G3 failed; G4 failed; G5a pass; G5b-recovery failed; G6 pass | G1 failed; G1a failed; G1c pass; G3 failed; G4 failed; G5a pass; G5b-recovery failed; G6 pass |
| p2-erbb2 | raw | primary | insufficient-evidence | naive: insufficient-evidence | G1 failed; G1a failed; G1c pass; G3 failed; G4 failed; G5a pass; G5b-recovery failed; G6 pass | G1 failed; G1a failed; G1c pass; G3 failed; G4 failed; G5a pass; G5b-recovery failed; G6 pass |
| p5-permuted | raw | primary | insufficient-evidence | naive: insufficient-evidence | G1 failed; G1a failed; G1c pass; G3 pass; G4 pass; G5a pass; G5b-recovery failed; G6 pass | G1 failed; G1a failed; G1c pass; G3 pass; G4 pass; G5a pass; G5b-recovery failed; G6 pass |
| p6-subgroups | refused | primary_efficacy | insufficient-evidence | naive: insufficient-evidence | G1 -; G1a not-run (staging-unavailable); G1c not-run; G3 failed (not-executed); G4 failed; G5a failed; G5b-recovery failed; G6 not-run (not-executed) | G1 -; G1a not-run (staging-unavailable); G1c not-run; G3 failed (not-executed); G4 failed; G5a failed; G5b-recovery failed; G6 not-run (not-executed) |
|  |  | subgroup_benefit | exploratory | naive: exploratory | G1 -; G1a not-run (staging-unavailable); G1c not-run; G3 failed (not-executed); G4 failed; G5a failed; G5b-recovery failed; G6 - | G1 -; G1a not-run (staging-unavailable); G1c not-run; G3 failed (not-executed); G4 failed; G5a failed; G5b-recovery failed; G6 - |
| p7-nosignal | refused | gene_region | insufficient-evidence | naive: insufficient-evidence | G1 -; G1a not-run (staging-unavailable); G1c not-run; G3 failed (not-executed); G4 failed; G5a failed; G5b-recovery failed; G6 not-run (not-executed) | G1 -; G1a not-run (staging-unavailable); G1c not-run; G3 failed (not-executed); G4 failed; G5a failed; G5b-recovery failed; G6 not-run (not-executed) |
|  |  | reported_variant | insufficient-evidence | naive: insufficient-evidence | G1 -; G1a not-run (staging-unavailable); G1c not-run; G3 failed (not-executed); G4 failed; G5a failed; G5b-recovery failed; G6 not-run (not-executed) | G1 -; G1a not-run (staging-unavailable); G1c not-run; G3 failed (not-executed); G4 failed; G5a failed; G5b-recovery failed; G6 not-run (not-executed) |
| p8-underpowered | refused | maximal_respiration | insufficient-evidence | naive: insufficient-evidence | G1 -; G1a not-run (staging-unavailable); G1c not-run; G3 failed (not-executed); G4 failed; G5a failed; G5b-recovery failed; G6 not-run (not-executed) | G1 -; G1a not-run (staging-unavailable); G1c not-run; G3 failed (not-executed); G4 failed; G5a failed; G5b-recovery failed; G6 not-run (not-executed) |
| p9-leakage | refused | cell_auc | insufficient-evidence | naive: insufficient-evidence | G1 -; G1a not-run (staging-unavailable); G1c not-run; G3 failed (not-executed); G4 failed; G5a failed; G5b-recovery failed; G6 not-run (not-executed) | G1 -; G1a not-run (staging-unavailable); G1c not-run; G3 failed (not-executed); G4 failed; G5a failed; G5b-recovery failed; G6 not-run (not-executed) |
| w0-venet | refused | duplicate_profiles | insufficient-evidence | naive: insufficient-evidence | G1 -; G1a not-run (staging-unavailable); G1c -; G3 not-run (not-executed); G4 not-run; G5a -; G5b-recovery -; G6 - | G1 -; G1a not-run (staging-unavailable); G1c -; G3 not-run (not-executed); G4 not-run; G5a -; G5b-recovery -; G6 - |

`pass*`: reported passed but its evidence rule refused it.

## Amendment A1: generated staging declarations

| Task | Declared tables (mode, identity column, unit column) | Not declarable / diagnostics | Certify staging |
|---|---|---|---|
| iad1-brady-audit | predictions.csv: analysis-table, subject<br>psa_history.csv: analysis-table, subject<br>training_roc.csv: analysis-table, held_out_subject | README.md: not a csv/tsv/json table: declared staging cannot declare it, and every file in the batch must be declared<br>predictions.csv: declared idColumn subject does not identify rows uniquely (the dictionary names no single-column row key)<br>psa_history.csv: declared idColumn subject does not identify rows uniquely (the dictionary names no single-column row key)<br>training_roc.csv: declared idColumn held_out_subject does not identify rows uniquely (the dictionary names no single-column row key) | staging unavailable: missing or repeated declared row identity |
| iad2-brady-twin | predictions.csv: analysis-table, subject<br>psa_history.csv: analysis-table, subject | README.md: not a csv/tsv/json table: declared staging cannot declare it, and every file in the batch must be declared<br>predictions.csv: declared idColumn subject does not identify rows uniquely (the dictionary names no single-column row key)<br>psa_history.csv: declared idColumn subject does not identify rows uniquely (the dictionary names no single-column row key) | staging unavailable: missing or repeated declared row identity |
| iad3-browning-count | psa_series.csv: analysis-table, subject | README.md: not a csv/tsv/json table: declared staging cannot declare it, and every file in the batch must be declared<br>psa_series.csv: declared idColumn subject does not identify rows uniquely (the dictionary names no single-column row key) | staging unavailable: missing or repeated declared row identity |
| p13-endpoint | outcomes.tsv: analysis-table, participant_id<br>participants.tsv: analysis-table, participant_id | protocol.md: not a csv/tsv/json table: declared staging cannot declare it, and every file in the batch must be declared | staging unavailable: outcomes.tsv: declared unit splits a detected biological unit (sbp_bl) |
| p14-citation | literature_index.tsv: analysis-table, record_id | draft_introduction.md: not a csv/tsv/json table: declared staging cannot declare it, and every file in the batch must be declared<br>literature_records.jsonl: not a csv/tsv/json table: declared staging cannot declare it, and every file in the batch must be declared | staging unavailable: literature_index.tsv: declared unit splits a detected biological unit (year) |
| p4-bixbench | Swarm_1.csv: analysis-table, DishNumber | - | staging unavailable: ambiguous identity; staging declaration required |
| p6-subgroups | participants.tsv: analysis-table, participant_id<br>subgroups.tsv: analysis-table, factor | - | staging unavailable: participants.tsv: declared unit splits a detected biological unit (site) |
| p7-nosignal | genotypes.tsv: analysis-table, sample_id<br>samples.tsv: analysis-table, sample_id<br>variants.tsv: analysis-table, variant_id | - | staging unavailable: identical content under distinct units requires locked acknowledgeContentDuplicates |
| p8-underpowered | donors.tsv: analysis-table, donor_id<br>wells.tsv: repeated-measures, plate, unit donor_id | wells.tsv: declared idColumn plate does not identify rows uniquely (the dictionary names no single-column row key) | staging unavailable: donors.tsv: declared unit splits a detected biological unit (group) |
| p9-leakage | cells.tsv: repeated-measures, cell_id, unit donor_id<br>donors.tsv: analysis-table, donor_id<br>expression.tsv: analysis-table, cell_id | - | staging unavailable: identical content under distinct units requires locked acknowledgeContentDuplicates |

## Amendment A5: the A1 tasks with raw staging (no declarations)

| Task | Analysis | Mode | Staging | Labels | Staging warning |
|---|---|---|---|---|---|
| iad1-brady-audit | reference | adopt | refused | fit_for_use: exploratory | staging unavailable: ambiguous identity; staging declaration required |
| iad1-brady-audit | reference | locked | refused | fit_for_use: insufficient-evidence | staging unavailable: ambiguous identity; staging declaration required |
| iad1-brady-audit | naive | adopt | refused | fit_for_use: exploratory | staging unavailable: ambiguous identity; staging declaration required |
| iad1-brady-audit | naive | locked | refused | fit_for_use: insufficient-evidence | staging unavailable: ambiguous identity; staging declaration required |
| iad1-brady-audit | naive/variants/lazy_skeptic | adopt | refused | fit_for_use: exploratory | staging unavailable: ambiguous identity; staging declaration required |
| iad1-brady-audit | naive/variants/lazy_skeptic | locked | refused | fit_for_use: insufficient-evidence | staging unavailable: ambiguous identity; staging declaration required |
| iad1-brady-audit | naive/variants/zero_trap | adopt | refused | fit_for_use: exploratory | staging unavailable: ambiguous identity; staging declaration required |
| iad1-brady-audit | naive/variants/zero_trap | locked | refused | fit_for_use: insufficient-evidence | staging unavailable: ambiguous identity; staging declaration required |
| iad2-brady-twin | reference | adopt | refused | fit_for_use: exploratory | staging unavailable: ambiguous identity; staging declaration required |
| iad2-brady-twin | reference | locked | refused | fit_for_use: insufficient-evidence | staging unavailable: ambiguous identity; staging declaration required |
| iad2-brady-twin | naive | adopt | refused | fit_for_use: exploratory | staging unavailable: ambiguous identity; staging declaration required |
| iad2-brady-twin | naive | locked | refused | fit_for_use: insufficient-evidence | staging unavailable: ambiguous identity; staging declaration required |
| iad2-brady-twin | naive/variants/lazy_skeptic | adopt | refused | fit_for_use: exploratory | staging unavailable: ambiguous identity; staging declaration required |
| iad2-brady-twin | naive/variants/lazy_skeptic | locked | refused | fit_for_use: insufficient-evidence | staging unavailable: ambiguous identity; staging declaration required |
| iad2-brady-twin | naive/variants/zero_trap | adopt | refused | fit_for_use: exploratory | staging unavailable: ambiguous identity; staging declaration required |
| iad2-brady-twin | naive/variants/zero_trap | locked | refused | fit_for_use: insufficient-evidence | staging unavailable: ambiguous identity; staging declaration required |
| iad3-browning-count | reference | adopt | refused | cohort_size: exploratory | staging unavailable: ambiguous identity; staging declaration required |
| iad3-browning-count | reference | locked | refused | cohort_size: insufficient-evidence | staging unavailable: ambiguous identity; staging declaration required |
| iad3-browning-count | naive | adopt | refused | cohort_size: exploratory | staging unavailable: ambiguous identity; staging declaration required |
| iad3-browning-count | naive | locked | refused | cohort_size: insufficient-evidence | staging unavailable: ambiguous identity; staging declaration required |
| iad3-browning-count | naive/variants/strict_more_than_five | adopt | refused | cohort_size: exploratory | staging unavailable: ambiguous identity; staging declaration required |
| iad3-browning-count | naive/variants/strict_more_than_five | locked | refused | cohort_size: insufficient-evidence | staging unavailable: ambiguous identity; staging declaration required |
| iad3-browning-count | naive/variants/visits_not_measurements | adopt | refused | cohort_size: exploratory | staging unavailable: ambiguous identity; staging declaration required |
| iad3-browning-count | naive/variants/visits_not_measurements | locked | refused | cohort_size: insufficient-evidence | staging unavailable: ambiguous identity; staging declaration required |
| p13-endpoint | reference | adopt | refused | headline: exploratory<br>primary_efficacy: exploratory | staging unavailable: outcomes.tsv: ambiguous biological identity requires a locked declaration |
| p13-endpoint | reference | locked | refused | headline: exploratory<br>primary_efficacy: insufficient-evidence | staging unavailable: outcomes.tsv: ambiguous biological identity requires a locked declaration |
| p13-endpoint | naive | adopt | refused | headline: exploratory<br>primary_efficacy: exploratory | staging unavailable: outcomes.tsv: ambiguous biological identity requires a locked declaration |
| p13-endpoint | naive | locked | refused | headline: exploratory<br>primary_efficacy: insufficient-evidence | staging unavailable: outcomes.tsv: ambiguous biological identity requires a locked declaration |
| p14-citation | reference | adopt | refused | ref-1: exploratory<br>ref-10: exploratory<br>ref-2: exploratory<br>ref-3: exploratory<br>ref-4: exploratory<br>ref-5: exploratory<br>ref-6: exploratory<br>ref-7: exploratory<br>ref-8: exploratory<br>ref-9: exploratory | staging unavailable: literature_index.tsv: ambiguous biological identity requires a locked declaration |
| p14-citation | reference | locked | refused | ref-1: insufficient-evidence<br>ref-10: insufficient-evidence<br>ref-2: insufficient-evidence<br>ref-3: insufficient-evidence<br>ref-4: insufficient-evidence<br>ref-5: insufficient-evidence<br>ref-6: insufficient-evidence<br>ref-7: insufficient-evidence<br>ref-8: insufficient-evidence<br>ref-9: insufficient-evidence | staging unavailable: literature_index.tsv: ambiguous biological identity requires a locked declaration |
| p14-citation | naive | adopt | refused | ref-1: exploratory<br>ref-10: exploratory<br>ref-2: exploratory<br>ref-3: exploratory<br>ref-4: exploratory<br>ref-5: exploratory<br>ref-6: exploratory<br>ref-7: exploratory<br>ref-8: exploratory<br>ref-9: exploratory | staging unavailable: literature_index.tsv: ambiguous biological identity requires a locked declaration |
| p14-citation | naive | locked | refused | ref-1: insufficient-evidence<br>ref-10: insufficient-evidence<br>ref-2: insufficient-evidence<br>ref-3: insufficient-evidence<br>ref-4: insufficient-evidence<br>ref-5: insufficient-evidence<br>ref-6: insufficient-evidence<br>ref-7: insufficient-evidence<br>ref-8: insufficient-evidence<br>ref-9: insufficient-evidence | staging unavailable: literature_index.tsv: ambiguous biological identity requires a locked declaration |
| p4-bixbench | reference | adopt | refused |  | staging unavailable: ambiguous identity; staging declaration required |
| p4-bixbench | reference | locked | refused |  | staging unavailable: ambiguous identity; staging declaration required |
| p4-bixbench | naive | adopt | refused |  | staging unavailable: ambiguous identity; staging declaration required |
| p4-bixbench | naive | locked | refused |  | staging unavailable: ambiguous identity; staging declaration required |
| p6-subgroups | reference | adopt | refused | primary_efficacy: exploratory<br>subgroup_benefit: exploratory | staging unavailable: participants.tsv: ambiguous biological identity requires a locked declaration |
| p6-subgroups | reference | locked | refused | primary_efficacy: insufficient-evidence<br>subgroup_benefit: exploratory | staging unavailable: participants.tsv: ambiguous biological identity requires a locked declaration |
| p6-subgroups | naive | adopt | refused | primary_efficacy: exploratory<br>subgroup_benefit: exploratory | staging unavailable: participants.tsv: ambiguous biological identity requires a locked declaration |
| p6-subgroups | naive | locked | refused | primary_efficacy: insufficient-evidence<br>subgroup_benefit: exploratory | staging unavailable: participants.tsv: ambiguous biological identity requires a locked declaration |
| p7-nosignal | reference | adopt | refused | gene_region: exploratory<br>reported_variant: exploratory | staging unavailable: genotypes.tsv: ambiguous biological identity requires a locked declaration |
| p7-nosignal | reference | locked | refused | gene_region: insufficient-evidence<br>reported_variant: insufficient-evidence | staging unavailable: genotypes.tsv: ambiguous biological identity requires a locked declaration |
| p7-nosignal | naive | adopt | refused | gene_region: exploratory<br>reported_variant: exploratory | staging unavailable: genotypes.tsv: ambiguous biological identity requires a locked declaration |
| p7-nosignal | naive | locked | refused | gene_region: insufficient-evidence<br>reported_variant: insufficient-evidence | staging unavailable: genotypes.tsv: ambiguous biological identity requires a locked declaration |
| p8-underpowered | reference | adopt | refused | maximal_respiration: exploratory | staging unavailable: donors.tsv: ambiguous biological identity requires a locked declaration |
| p8-underpowered | reference | locked | refused | maximal_respiration: insufficient-evidence | staging unavailable: donors.tsv: ambiguous biological identity requires a locked declaration |
| p8-underpowered | naive | adopt | refused | maximal_respiration: exploratory | staging unavailable: donors.tsv: ambiguous biological identity requires a locked declaration |
| p8-underpowered | naive | locked | refused | maximal_respiration: insufficient-evidence | staging unavailable: donors.tsv: ambiguous biological identity requires a locked declaration |
| p9-leakage | reference | adopt | refused | cell_auc: exploratory | staging unavailable: cells.tsv: ambiguous biological identity requires a locked declaration |
| p9-leakage | reference | locked | refused | cell_auc: insufficient-evidence | staging unavailable: cells.tsv: ambiguous biological identity requires a locked declaration |
| p9-leakage | naive | adopt | refused | cell_auc: exploratory | staging unavailable: cells.tsv: ambiguous biological identity requires a locked declaration |
| p9-leakage | naive | locked | refused | cell_auc: insufficient-evidence | staging unavailable: cells.tsv: ambiguous biological identity requires a locked declaration |

A5 mismatches against E1-E6: 24.


## Mismatches against the pre-registration

| Rule | Task | Analysis | Mode | Claim | Expected | Actual |
|---|---|---|---|---|---|---|
| E6 | iad1-brady-audit | reference | locked | fit_for_use | G3 not failed | G3 failed (not-executed) |
| E6 | iad1-brady-audit | reference | locked | fit_for_use | G4 not failed | G4 failed |
| E3 | iad2-brady-twin | reference | locked | fit_for_use | tentative | insufficient-evidence |
| E6 | iad2-brady-twin | reference | locked | fit_for_use | G3 not failed | G3 failed (not-executed) |
| E6 | iad2-brady-twin | reference | locked | fit_for_use | G4 not failed | G4 failed |
| E3 | iad3-browning-count | reference | locked | cohort_size | confirmed | insufficient-evidence |
| E3 | p1-esr1 | reference | locked | primary | tentative | insufficient-evidence |
| E6 | p1-esr1 | reference | locked | primary | G1a not failed | G1a failed |
| E6 | p1-esr1 | reference | locked | primary | G3 not failed | G3 failed |
| E6 | p1-esr1 | reference | locked | primary | G4 not failed | G4 failed |
| E6 | p10-pseudorep | reference | locked | dlg4_effect | G3 not failed | G3 failed (not-executed) |
| E6 | p10-pseudorep | reference | locked | dlg4_effect | G4 not failed | G4 failed |
| E5 | p10-pseudorep | naive | locked | - | G1a failed | G1a not-run (staging-unavailable) |
| E6 | p10b-pseudorep-hidden | reference | locked | dlg4_effect | G3 not failed | G3 failed (not-executed) |
| E6 | p10b-pseudorep-hidden | reference | locked | dlg4_effect | G4 not failed | G4 failed |
| E5 | p10b-pseudorep-hidden | naive | locked | - | G1a failed | G1a not-run (staging-unavailable) |
| E6 | p11-confounding | reference | locked | primary | G3 not failed | G3 failed (missing-recomputed) |
| E6 | p11-confounding | reference | locked | primary | G4 not failed | G4 failed |
| E6 | p12-quality | reference | locked | primary | G1a not failed | G1a failed |
| E5 | p12-quality | naive | locked | - | G1c failed (strong-unhandled) | G1c passed |
| E6 | p13-endpoint | reference | locked | headline | G3 not failed | G3 failed (not-executed) |
| E6 | p13-endpoint | reference | locked | headline | G4 not failed | G4 failed |
| E6 | p13-endpoint | reference | locked | primary_efficacy | G3 not failed | G3 failed (not-executed) |
| E6 | p13-endpoint | reference | locked | primary_efficacy | G4 not failed | G4 failed |
| E5 | p14-citation | naive | locked | - | CIT failed | CIT absent |
| E3 | p16-recovery | reference | locked | primary | tentative | insufficient-evidence |
| E6 | p16-recovery | reference | locked | primary | G1a not failed | G1a failed |
| E6 | p16-recovery | reference | locked | primary | G3 not failed | G3 failed |
| E6 | p16-recovery | reference | locked | primary | G4 not failed | G4 failed |
| E3 | p2-erbb2 | reference | locked | primary | tentative | insufficient-evidence |
| E6 | p2-erbb2 | reference | locked | primary | G1a not failed | G1a failed |
| E6 | p2-erbb2 | reference | locked | primary | G3 not failed | G3 failed |
| E6 | p2-erbb2 | reference | locked | primary | G4 not failed | G4 failed |
| E6 | p5-permuted | reference | locked | primary | G1a not failed | G1a failed |
| E6 | p6-subgroups | reference | locked | primary_efficacy | G3 not failed | G3 failed (not-executed) |
| E6 | p6-subgroups | reference | locked | primary_efficacy | G4 not failed | G4 failed |
| E6 | p6-subgroups | reference | locked | subgroup_benefit | G3 not failed | G3 failed (not-executed) |
| E6 | p6-subgroups | reference | locked | subgroup_benefit | G4 not failed | G4 failed |
| E6 | p7-nosignal | reference | locked | gene_region | G3 not failed | G3 failed (not-executed) |
| E6 | p7-nosignal | reference | locked | gene_region | G4 not failed | G4 failed |
| E6 | p7-nosignal | reference | locked | reported_variant | G3 not failed | G3 failed (not-executed) |
| E6 | p7-nosignal | reference | locked | reported_variant | G4 not failed | G4 failed |
| E6 | p8-underpowered | reference | locked | maximal_respiration | G3 not failed | G3 failed (not-executed) |
| E6 | p8-underpowered | reference | locked | maximal_respiration | G4 not failed | G4 failed |
| E6 | p9-leakage | reference | locked | cell_auc | G3 not failed | G3 failed (not-executed) |
| E6 | p9-leakage | reference | locked | cell_auc | G4 not failed | G4 failed |
| E5 | p9-leakage | naive | locked | - | G1b failed | G1b not-run (staging-unavailable) |
| E3 | w0-venet | reference | locked | duplicate_profiles | confirmed | insufficient-evidence |
| E5 | w0-venet | naive | locked | - | G1a failed | G1a not-run (staging-unavailable) |

## V2c vs V2d (identical deliverables)

Label changes: 5.

| Task | Analysis | Mode | Claim | V2c | V2d |
|---|---|---|---|---|---|
| p1-esr1 | reference | locked | primary | tentative | insufficient-evidence |
| p11-confounding | naive | locked | primary | non-identifiable | insufficient-evidence |
| p16-recovery | reference | locked | primary | tentative | insufficient-evidence |
| p2-erbb2 | reference | locked | primary | tentative | insufficient-evidence |
| w0-venet | reference | locked | duplicate_profiles | confirmed | insufficient-evidence |

## Amendment A4: omit-p ablation (locked, tasks that stage)

12 certifications; 0 E10/E1 mismatches.

| Task | Analysis | Claim | Pre-registered wrapper | omit-p wrapper | omit-p G3 / G4 (disagreement keys) |
|---|---|---|---|---|---|
| p1-esr1 | reference | primary | insufficient-evidence | tentative | passed / passed |
| p1-esr1 | naive | primary | insufficient-evidence | insufficient-evidence | failed / failed (claimed.estimate, claimed.ci.0, claimed.ci.1, look.B7:CI/SE inconsistency, look.estimate, look.ci.0, look.ci.1, rerun.B7:CI/SE inconsistency, rerun.estimate, rerun.ci.0, rerun.ci.1) |
| p11-confounding | reference | primary | insufficient-evidence | insufficient-evidence | failed / failed |
| p11-confounding | naive | primary | insufficient-evidence | non-identifiable | passed / passed |
| p12-quality | reference | primary | insufficient-evidence | insufficient-evidence | passed / passed |
| p12-quality | naive | primary | tentative | tentative | passed / passed |
| p16-recovery | reference | primary | insufficient-evidence | tentative | passed / passed |
| p16-recovery | naive | primary | insufficient-evidence | insufficient-evidence | failed / failed (claimed.estimate, claimed.ci.0, claimed.ci.1, look.B7:CI/SE inconsistency, look.estimate, look.ci.0, look.ci.1, rerun.B7:CI/SE inconsistency, rerun.estimate, rerun.ci.0, rerun.ci.1) |
| p2-erbb2 | reference | primary | insufficient-evidence | tentative | passed / passed |
| p2-erbb2 | naive | primary | insufficient-evidence | insufficient-evidence | failed / failed (claimed.estimate, claimed.ci.0, claimed.ci.1, look.B7:CI/SE inconsistency, look.estimate, look.ci.0, look.ci.1, rerun.B7:CI/SE inconsistency, rerun.estimate, rerun.ci.0, rerun.ci.1) |
| p5-permuted | reference | primary | insufficient-evidence | insufficient-evidence | passed / passed |
| p5-permuted | naive | primary | insufficient-evidence | insufficient-evidence | passed / passed |

## Null calibration, pre-registered design (E8, E9)

Verdicts: E8 pass, E9_mei fail, E9_liveness fail, sandboxValidation pass. Sizes: p1-esr1 n = 12, p2-erbb2 n = 12, p12-quality n = 7. Wall 2522 s (slowest parallel part).

| Task | Variant | Re-stagings | Confirmed | Rate (95% Clopper-Pearson) | P(X >= k \| alpha) | Kernel decided | Kernel rejected | Kernel rejected and G5a passed |
|---|---|---|---|---|---|---|---|---|
| p1-esr1 | null | 200 | 0 | 0.0% (0.0%-1.8%) | 1.000 | 200 | 10 | 10 |
| p1-esr1 | mei | 40 | 0 | 0.0% (0.0%-8.8%) | - | 40 | 6 | 6 |
| p1-esr1 | large | 20 | 0 | 0.0% (0.0%-16.8%) | - | 20 | 20 | 19 |
| p2-erbb2 | null | 200 | 0 | 0.0% (0.0%-1.8%) | 1.000 | 200 | 10 | 10 |
| p2-erbb2 | mei | 40 | 0 | 0.0% (0.0%-8.8%) | - | 40 | 8 | 8 |
| p2-erbb2 | large | 20 | 0 | 0.0% (0.0%-16.8%) | - | 20 | 20 | 20 |
| p12-quality | null | 200 | 0 | 0.0% (0.0%-1.8%) | 1.000 | 200 | 9 | 9 |
| p12-quality | mei | 40 | 0 | 0.0% (0.0%-8.8%) | - | 40 | 23 | 23 |
| p12-quality | large | 20 | 0 | 0.0% (0.0%-16.8%) | - | 20 | 20 | 20 |
| pooled | null | 600 | 0 | 0.0% (0.0%-0.6%) | 1.000 | 600 | 29 | 29 |

Sandbox validation (in-process simulation program vs the real sandboxed program, same re-staging):

- p1-esr1 null 0: identical outcome fingerprint (sandbox 4 s, in-process 3 s)
- p1-esr1 null 1: identical outcome fingerprint (sandbox 4 s, in-process 3 s)
- p1-esr1 null 2: identical outcome fingerprint (sandbox 4 s, in-process 3 s)
- p2-erbb2 null 0: identical outcome fingerprint (sandbox 5 s, in-process 3 s)
- p2-erbb2 null 1: identical outcome fingerprint (sandbox 4 s, in-process 3 s)
- p2-erbb2 null 2: identical outcome fingerprint (sandbox 5 s, in-process 3 s)
- p12-quality null 0: identical outcome fingerprint (sandbox 9 s, in-process 8 s)
- p12-quality null 1: identical outcome fingerprint (sandbox 9 s, in-process 8 s)
- p12-quality null 2: identical outcome fingerprint (sandbox 9 s, in-process 11 s)

## Null calibration, amendment A2 (Monte Carlo sizes, omit-p wrapper), V2d

Verdicts: E8 pass, E9_mei fail, E9_liveness fail, sandboxValidation pass. Sizes: p1-esr1 n = 16, p2-erbb2 n = 16. Wall 3578 s (slowest parallel part).

| Task | Variant | Re-stagings | Confirmed | Rate (95% Clopper-Pearson) | P(X >= k \| alpha) | Kernel decided | Kernel rejected | Kernel rejected and G5a passed |
|---|---|---|---|---|---|---|---|---|
| p1-esr1 | null | 200 | 0 | 0.0% (0.0%-1.8%) | 1.000 | 200 | 10 | 10 |
| p1-esr1 | mei | 40 | 0 | 0.0% (0.0%-8.8%) | - | 40 | 11 | 11 |
| p1-esr1 | large | 20 | 0 | 0.0% (0.0%-16.8%) | - | 20 | 20 | 20 |
| p2-erbb2 | null | 200 | 0 | 0.0% (0.0%-1.8%) | 1.000 | 200 | 10 | 10 |
| p2-erbb2 | mei | 40 | 0 | 0.0% (0.0%-8.8%) | - | 40 | 16 | 15 |
| p2-erbb2 | large | 20 | 0 | 0.0% (0.0%-16.8%) | - | 20 | 20 | 20 |
| pooled | null | 400 | 0 | 0.0% (0.0%-0.9%) | 1.000 | 400 | 20 | 20 |

Sandbox validation (in-process simulation program vs the real sandboxed program, same re-staging):

- p1-esr1 null 0: identical outcome fingerprint (sandbox 12 s, in-process 10 s)
- p1-esr1 null 1: identical outcome fingerprint (sandbox 13 s, in-process 11 s)
- p1-esr1 null 2: identical outcome fingerprint (sandbox 13 s, in-process 10 s)
- p2-erbb2 null 0: identical outcome fingerprint (sandbox 12 s, in-process 13 s)
- p2-erbb2 null 1: identical outcome fingerprint (sandbox 12 s, in-process 12 s)
- p2-erbb2 null 2: identical outcome fingerprint (sandbox 12 s, in-process 12 s)

## Null calibration, amendment A9 (A2 with a locked MEI of one outcome unit), V2d

Verdicts: E8 pass, E9_mei fail, E9_liveness fail, sandboxValidation pass. Sizes: p1-esr1 n = 16, p2-erbb2 n = 16, p12-quality n = 8. Wall 5147 s (slowest parallel part).

| Task | Variant | Re-stagings | Confirmed | Rate (95% Clopper-Pearson) | P(X >= k \| alpha) | Kernel decided | Kernel rejected | Kernel rejected and G5a passed |
|---|---|---|---|---|---|---|---|---|
| p1-esr1 | null | 200 | 7 | 3.5% (1.4%-7.1%) | 0.876 | 200 | 9 | 9 |
| p1-esr1 | mei | 40 | 7 | 17.5% (7.3%-32.8%) | - | 40 | 10 | 10 |
| p1-esr1 | large | 20 | 17 | 85.0% (62.1%-96.8%) | - | 20 | 20 | 20 |
| p2-erbb2 | null | 200 | 6 | 3.0% (1.1%-6.4%) | 0.938 | 200 | 10 | 10 |
| p2-erbb2 | mei | 40 | 10 | 25.0% (12.7%-41.2%) | - | 40 | 16 | 15 |
| p2-erbb2 | large | 20 | 13 | 65.0% (40.8%-84.6%) | - | 20 | 20 | 20 |
| p12-quality | null | 200 | 0 | 0.0% (0.0%-1.8%) | 1.000 | 200 | 6 | 6 |
| p12-quality | mei | 40 | 0 | 0.0% (0.0%-8.8%) | - | 40 | 30 | 30 |
| p12-quality | large | 20 | 0 | 0.0% (0.0%-16.8%) | - | 20 | 20 | 19 |
| pooled | null | 600 | 13 | 2.2% (1.2%-3.7%) | 1.000 | 600 | 25 | 25 |

Sandbox validation (in-process simulation program vs the real sandboxed program, same re-staging):

- p1-esr1 null 0: identical outcome fingerprint (sandbox 59 s, in-process 16 s)
- p1-esr1 null 1: identical outcome fingerprint (sandbox 61 s, in-process 16 s)
- p1-esr1 null 2: identical outcome fingerprint (sandbox 55 s, in-process 15 s)
- p2-erbb2 null 0: identical outcome fingerprint (sandbox 65 s, in-process 16 s)
- p2-erbb2 null 1: identical outcome fingerprint (sandbox 60 s, in-process 14 s)
- p2-erbb2 null 2: identical outcome fingerprint (sandbox 57 s, in-process 15 s)
- p12-quality null 0: identical outcome fingerprint (sandbox 69 s, in-process 7 s)
- p12-quality null 1: identical outcome fingerprint (sandbox 64 s, in-process 6 s)
- p12-quality null 2: identical outcome fingerprint (sandbox 74 s, in-process 6 s)

## Null calibration, amendment A9 on the V2c kernel (records/v2c/)

Verdicts: E8 pass, E9_mei fail, E9_liveness pass, sandboxValidation pass. Sizes: p1-esr1 n = 16, p2-erbb2 n = 16. Wall 3305 s (slowest parallel part).

| Task | Variant | Re-stagings | Confirmed | Rate (95% Clopper-Pearson) | P(X >= k \| alpha) | Kernel decided | Kernel rejected | Kernel rejected and G5a passed |
|---|---|---|---|---|---|---|---|---|
| p1-esr1 | null | 200 | 9 | 4.5% (2.1%-8.4%) | 0.673 | 200 | 9 | 9 |
| p1-esr1 | mei | 40 | 10 | 25.0% (12.7%-41.2%) | - | 40 | 10 | 10 |
| p1-esr1 | large | 20 | 20 | 100.0% (83.2%-100.0%) | - | 20 | 20 | 20 |
| p2-erbb2 | null | 200 | 10 | 5.0% (2.4%-9.0%) | 0.545 | 200 | 10 | 10 |
| p2-erbb2 | mei | 40 | 15 | 37.5% (22.7%-54.2%) | - | 40 | 16 | 15 |
| p2-erbb2 | large | 20 | 20 | 100.0% (83.2%-100.0%) | - | 20 | 20 | 20 |
| pooled | null | 400 | 19 | 4.8% (2.9%-7.3%) | 0.623 | 400 | 19 | 19 |

Sandbox validation (in-process simulation program vs the real sandboxed program, same re-staging):

- p1-esr1 null 0: identical outcome fingerprint (sandbox 54 s, in-process 35 s)
- p1-esr1 null 1: identical outcome fingerprint (sandbox 54 s, in-process 16 s)
- p1-esr1 null 2: identical outcome fingerprint (sandbox 56 s, in-process 13 s)
- p2-erbb2 null 0: identical outcome fingerprint (sandbox 55 s, in-process 37 s)
- p2-erbb2 null 1: identical outcome fingerprint (sandbox 55 s, in-process 14 s)
- p2-erbb2 null 2: identical outcome fingerprint (sandbox 50 s, in-process 13 s)

## Null calibration, amendment A2 on the V2b kernel (records/v2b/)

Verdicts: E8 pass, E9_mei fail, E9_liveness pass, sandboxValidation pass. Sizes: p1-esr1 n = 16, p2-erbb2 n = 16. Wall 3483 s (slowest parallel part).

| Task | Variant | Re-stagings | Confirmed | Rate (95% Clopper-Pearson) | P(X >= k \| alpha) | Kernel decided | Kernel rejected | Kernel rejected and G5a passed |
|---|---|---|---|---|---|---|---|---|
| p1-esr1 | null | 200 | 10 | 5.0% (2.4%-9.0%) | 0.545 | 200 | 10 | 10 |
| p1-esr1 | mei | 40 | 11 | 27.5% (14.6%-43.9%) | - | 40 | 11 | 11 |
| p1-esr1 | large | 20 | 19 | 95.0% (75.1%-99.9%) | - | 19 | 19 | 19 |
| p2-erbb2 | null | 200 | 10 | 5.0% (2.4%-9.0%) | 0.545 | 200 | 10 | 10 |
| p2-erbb2 | mei | 40 | 15 | 37.5% (22.7%-54.2%) | - | 40 | 16 | 15 |
| p2-erbb2 | large | 20 | 19 | 95.0% (75.1%-99.9%) | - | 19 | 19 | 19 |
| pooled | null | 400 | 20 | 5.0% (3.1%-7.6%) | 0.532 | 400 | 20 | 20 |

Sandbox validation (in-process simulation program vs the real sandboxed program, same re-staging):

- p1-esr1 null 0: identical outcome fingerprint (sandbox 74 s, in-process 9 s)
- p1-esr1 null 1: identical outcome fingerprint (sandbox 76 s, in-process 8 s)
- p1-esr1 null 2: identical outcome fingerprint (sandbox 73 s, in-process 8 s)
- p2-erbb2 null 0: identical outcome fingerprint (sandbox 71 s, in-process 8 s)
- p2-erbb2 null 1: identical outcome fingerprint (sandbox 77 s, in-process 7 s)
- p2-erbb2 null 2: identical outcome fingerprint (sandbox 65 s, in-process 8 s)

## Amendment A8: repeated-measures null designs (V2d)

Kernel level (trusted kernelDecision only):

| Design | Description | Direction | Nulls | Rejected | Rate (Wilson 95%) | Stopping | Guarantee |
|---|---|---|---|---|---|---|---|
| S1 | heteroskedastic unbalanced repeated measures: 12 units, 1 treated (sd 5) : 5 control (sd 1) rows, equal means | greater | 2000 | 173 | 8.6% (7.5%-10.0%) | monte-carlo-extended, monte-carlo-fixed | model-based: studentized mean null; finite-sample exchangeability and independent units unverified |
| S2 | heteroskedastic unbalanced repeated measures: 30 units, 1 treated (sd 3) : 3 control (sd 1) rows, equal means | two-sided | 2000 | 90 | 4.5% (3.7%-5.5%) | monte-carlo-extended, monte-carlo-fixed | model-based: studentized mean null; finite-sample exchangeability and independent units unverified |
| S3 | large-magnitude integer ties: rows 1e6 + Bernoulli(0.1), 5 units, 1 treated : 3 control rows (sharp null) | greater | 2000 | 12 | 0.6% (0.3%-1.0%) | exhaustive | model-based: studentized mean null; finite-sample exchangeability and independent units unverified |

S4 constant outcomes: 0 of 30 shapes rejected.

Full certify path (declared repeated-measures staging, generic analysis, omit-p, G7/G8 stand-ins):

| Design | Re-stagings | Confirmed | Rate (Wilson 95%) | Kernel rejected | Kernel rate (Wilson 95%) |
|---|---|---|---|---|---|
| S1 | 200 | 0 | 0.0% (0.0%-1.9%) | 32 | 16.0% (11.6%-21.7%) |
| S3 | 200 | 0 | 0.0% (0.0%-1.9%) | 0 | 0.0% (0.0%-1.9%) |

Kernel columns are descriptive (not pre-registered).

## Load invariance (E7, amendment A3)

PASS: 76/76 certifications identical under 4 busy workers (load 3.41/3.57/3.67 -> 16.03/17.52/16.42). Quiet wall 3210 s (full run), loaded 3371 s (subset).


## Sandboxed execution failures (all V2d calibration, ablation and loaded records)

182 executions; failed: 0; supervisor exit 90 (detached survivor): 0; exit 80 (analysis exited non-zero): 0; other: 0.

## Timing (locked mode, quiet run)

| Task | Analysis | Certify (s) | Executions | Execution total (s) | Loaded certify (s) |
|---|---|---|---|---|---|
| p1-esr1 | reference | 323.2 | 4 | 6.1 | 305.4 |
| p1-esr1 | naive | 269.3 | 4 | 5.3 | 323.5 |
| p11-confounding | reference | 3.6 | 2 | 2.8 | 3.8 |
| p11-confounding | naive | 126.3 | 4 | 3.8 | 180.4 |
| p12-quality | reference | 391.4 | 4 | 4.2 | 620.9 |
| p12-quality | naive | 134.4 | 4 | 3.9 | 212.2 |
| p16-recovery | reference | 116.8 | 4 | 4.2 | - |
| p16-recovery | naive | 110.6 | 4 | 3.8 | - |
| p2-erbb2 | reference | 232.4 | 4 | 4.2 | - |
| p2-erbb2 | naive | 218.9 | 4 | 4.2 | - |
| p5-permuted | reference | 236.4 | 4 | 4.3 | - |
| p5-permuted | naive | 235.6 | 4 | 4.0 | - |

Unstaged: 64 certifications, median 645 ms each.
