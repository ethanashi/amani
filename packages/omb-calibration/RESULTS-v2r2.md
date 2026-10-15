# V3 calibration results (generated from records/)

Calibration: 88 certifications (19 tasks x analyses x {adopt, locked}), 54 mismatches against the pre-registration, wall 848 s, git ec8b62e.
Earlier run on the V2 round-1 kernel (records/calibration-v2r1.json): 15 mismatches, wall 444 s, git 97d745a.

## Labels per task (locked mode; adopt mode is exploratory for every claim)

| Task | Staged | Claim | Reference | Naive analyses | Reference gates (G1a; G1c; G3; G4; G5a) | Naive gates (G1a; G1c; G3; G4; G5a) |
|---|---|---|---|---|---|---|
| iad1-brady-audit | no | fit_for_use | insufficient-evidence | naive: insufficient-evidence<br>lazy_skeptic: insufficient-evidence<br>zero_trap: insufficient-evidence | G1a not-run (staging-unavailable); G1c not-run; G3 failed (not-executed); G4 failed (no-recorded-outputs); G5a failed | G1a not-run (staging-unavailable); G1c not-run; G3 failed (not-executed); G4 failed (no-recorded-outputs); G5a failed<br>G1a not-run (staging-unavailable); G1c not-run; G3 failed (not-executed); G4 failed (no-recorded-outputs); G5a failed<br>G1a not-run (staging-unavailable); G1c not-run; G3 failed (not-executed); G4 failed (no-recorded-outputs); G5a failed |
| iad2-brady-twin | no | fit_for_use | insufficient-evidence | naive: insufficient-evidence<br>lazy_skeptic: insufficient-evidence<br>zero_trap: insufficient-evidence | G1a not-run (staging-unavailable); G1c not-run; G3 failed (not-executed); G4 failed (no-recorded-outputs); G5a failed | G1a not-run (staging-unavailable); G1c not-run; G3 failed (not-executed); G4 failed (no-recorded-outputs); G5a failed<br>G1a not-run (staging-unavailable); G1c not-run; G3 failed (not-executed); G4 failed (no-recorded-outputs); G5a failed<br>G1a not-run (staging-unavailable); G1c not-run; G3 failed (not-executed); G4 failed (no-recorded-outputs); G5a failed |
| iad3-browning-count | no | cohort_size | insufficient-evidence | naive: insufficient-evidence<br>strict_more_than_five: insufficient-evidence<br>visits_not_measurements: insufficient-evidence | G1a not-run (staging-unavailable); G1c -; G3 not-run (not-executed); G4 not-run (no-recorded-outputs); G5a - | G1a not-run (staging-unavailable); G1c -; G3 not-run (not-executed); G4 not-run (no-recorded-outputs); G5a -<br>G1a not-run (staging-unavailable); G1c -; G3 not-run (not-executed); G4 not-run (no-recorded-outputs); G5a -<br>G1a not-run (staging-unavailable); G1c -; G3 not-run (not-executed); G4 not-run (no-recorded-outputs); G5a - |
| p1-esr1 | yes | primary | insufficient-evidence | naive: insufficient-evidence | G1a pass; G1c pass; G3 failed; G4 failed; G5a failed | G1a pass; G1c pass; G3 failed; G4 failed; G5a failed |
| p10-pseudorep | yes | dlg4_effect | insufficient-evidence | naive: insufficient-evidence | G1a failed (count-mismatch); G1c not-run; G3 failed; G4 failed; G5a failed | G1a pass; G1c not-run; G3 failed; G4 failed; G5a failed |
| p10b-pseudorep-hidden | yes | dlg4_effect | insufficient-evidence | naive: insufficient-evidence | G1a failed (units-missing); G1c not-run; G3 failed (missing-recomputed); G4 failed; G5a failed | G1a pass; G1c not-run; G3 failed; G4 failed; G5a failed |
| p11-confounding | yes | primary | insufficient-evidence | naive: insufficient-evidence | G1a pass; G1c failed (aligned); G3 failed (missing-recomputed); G4 failed; G5a failed | G1a pass; G1c failed (aligned); G3 failed; G4 failed; G5a failed |
| p12-quality | yes | primary | insufficient-evidence | naive: insufficient-evidence | G1a pass; G1c pass; G3 failed; G4 failed; G5a failed | G1a pass; G1c pass; G3 failed; G4 failed; G5a failed |
| p13-endpoint | no | headline | exploratory | naive: exploratory | G1a not-run (staging-unavailable); G1c not-run; G3 failed (not-executed); G4 failed (no-recorded-outputs); G5a failed | G1a not-run (staging-unavailable); G1c not-run; G3 failed (not-executed); G4 failed (no-recorded-outputs); G5a failed |
|  |  | primary_efficacy | insufficient-evidence | naive: insufficient-evidence | G1a not-run (staging-unavailable); G1c not-run; G3 failed (not-executed); G4 failed (no-recorded-outputs); G5a failed | G1a not-run (staging-unavailable); G1c not-run; G3 failed (not-executed); G4 failed (no-recorded-outputs); G5a failed |
| p14-citation | no | ref-1 | insufficient-evidence | naive: insufficient-evidence | G1a not-run (staging-unavailable); G1c -; G3 not-run (not-executed); G4 not-run (no-recorded-outputs); G5a - | G1a not-run (staging-unavailable); G1c -; G3 not-run (not-executed); G4 not-run (no-recorded-outputs); G5a - |
|  |  | ref-10 | insufficient-evidence | naive: insufficient-evidence | G1a not-run (staging-unavailable); G1c -; G3 not-run (not-executed); G4 not-run (no-recorded-outputs); G5a - | G1a not-run (staging-unavailable); G1c -; G3 not-run (not-executed); G4 not-run (no-recorded-outputs); G5a - |
|  |  | ref-2 | insufficient-evidence | naive: insufficient-evidence | G1a not-run (staging-unavailable); G1c -; G3 not-run (not-executed); G4 not-run (no-recorded-outputs); G5a - | G1a not-run (staging-unavailable); G1c -; G3 not-run (not-executed); G4 not-run (no-recorded-outputs); G5a - |
|  |  | ref-3 | insufficient-evidence | naive: insufficient-evidence | G1a not-run (staging-unavailable); G1c -; G3 not-run (not-executed); G4 not-run (no-recorded-outputs); G5a - | G1a not-run (staging-unavailable); G1c -; G3 not-run (not-executed); G4 not-run (no-recorded-outputs); G5a - |
|  |  | ref-4 | insufficient-evidence | naive: insufficient-evidence | G1a not-run (staging-unavailable); G1c -; G3 not-run (not-executed); G4 not-run (no-recorded-outputs); G5a - | G1a not-run (staging-unavailable); G1c -; G3 not-run (not-executed); G4 not-run (no-recorded-outputs); G5a - |
|  |  | ref-5 | insufficient-evidence | naive: insufficient-evidence | G1a not-run (staging-unavailable); G1c -; G3 not-run (not-executed); G4 not-run (no-recorded-outputs); G5a - | G1a not-run (staging-unavailable); G1c -; G3 not-run (not-executed); G4 not-run (no-recorded-outputs); G5a - |
|  |  | ref-6 | insufficient-evidence | naive: insufficient-evidence | G1a not-run (staging-unavailable); G1c -; G3 not-run (not-executed); G4 not-run (no-recorded-outputs); G5a - | G1a not-run (staging-unavailable); G1c -; G3 not-run (not-executed); G4 not-run (no-recorded-outputs); G5a - |
|  |  | ref-7 | insufficient-evidence | naive: insufficient-evidence | G1a not-run (staging-unavailable); G1c -; G3 not-run (not-executed); G4 not-run (no-recorded-outputs); G5a - | G1a not-run (staging-unavailable); G1c -; G3 not-run (not-executed); G4 not-run (no-recorded-outputs); G5a - |
|  |  | ref-8 | insufficient-evidence | naive: insufficient-evidence | G1a not-run (staging-unavailable); G1c -; G3 not-run (not-executed); G4 not-run (no-recorded-outputs); G5a - | G1a not-run (staging-unavailable); G1c -; G3 not-run (not-executed); G4 not-run (no-recorded-outputs); G5a - |
|  |  | ref-9 | insufficient-evidence | naive: insufficient-evidence | G1a not-run (staging-unavailable); G1c -; G3 not-run (not-executed); G4 not-run (no-recorded-outputs); G5a - | G1a not-run (staging-unavailable); G1c -; G3 not-run (not-executed); G4 not-run (no-recorded-outputs); G5a - |
| p16-recovery | yes | primary | insufficient-evidence | naive: insufficient-evidence | G1a pass; G1c pass; G3 failed; G4 failed; G5a failed | G1a pass; G1c pass; G3 failed; G4 failed; G5a failed |
| p2-erbb2 | yes | primary | insufficient-evidence | naive: insufficient-evidence | G1a pass; G1c pass; G3 failed; G4 failed; G5a failed | G1a pass; G1c pass; G3 failed; G4 failed; G5a failed |
| p5-permuted | yes | primary | insufficient-evidence | naive: insufficient-evidence | G1a pass; G1c pass; G3 failed; G4 failed; G5a failed | G1a pass; G1c pass; G3 failed; G4 failed; G5a failed |
| p6-subgroups | no | primary_efficacy | insufficient-evidence | naive: insufficient-evidence | G1a not-run (staging-unavailable); G1c not-run; G3 failed (not-executed); G4 failed (no-recorded-outputs); G5a failed | G1a not-run (staging-unavailable); G1c not-run; G3 failed (not-executed); G4 failed (no-recorded-outputs); G5a failed |
|  |  | subgroup_benefit | exploratory | naive: exploratory | G1a not-run (staging-unavailable); G1c not-run; G3 failed (not-executed); G4 failed (no-recorded-outputs); G5a failed | G1a not-run (staging-unavailable); G1c not-run; G3 failed (not-executed); G4 failed (no-recorded-outputs); G5a failed |
| p7-nosignal | no | gene_region | insufficient-evidence | naive: insufficient-evidence | G1a not-run (staging-unavailable); G1c not-run; G3 failed (not-executed); G4 failed (no-recorded-outputs); G5a failed | G1a not-run (staging-unavailable); G1c not-run; G3 failed (not-executed); G4 failed (no-recorded-outputs); G5a failed |
|  |  | reported_variant | insufficient-evidence | naive: insufficient-evidence | G1a not-run (staging-unavailable); G1c not-run; G3 failed (not-executed); G4 failed (no-recorded-outputs); G5a failed | G1a not-run (staging-unavailable); G1c not-run; G3 failed (not-executed); G4 failed (no-recorded-outputs); G5a failed |
| p8-underpowered | no | maximal_respiration | insufficient-evidence | naive: insufficient-evidence | G1a not-run (staging-unavailable); G1c not-run; G3 failed (not-executed); G4 failed (no-recorded-outputs); G5a failed | G1a not-run (staging-unavailable); G1c not-run; G3 failed (not-executed); G4 failed (no-recorded-outputs); G5a failed |
| p9-leakage | no | cell_auc | insufficient-evidence | naive: insufficient-evidence | G1a not-run (staging-unavailable); G1c not-run; G3 failed (not-executed); G4 failed (no-recorded-outputs); G5a failed | G1a not-run (staging-unavailable); G1c not-run; G3 failed (not-executed); G4 failed (no-recorded-outputs); G5a failed |
| w0-venet | yes | duplicate_profiles | refuted | naive: insufficient-evidence | G1a failed (count-mismatch); G1c -; G3 pass; G4 pass; G5a - | G1a failed (count-mismatch); G1c -; G3 pass; G4 pass; G5a - |

`pass*`: reported passed but its evidence rule refused it.

## Mismatches against the pre-registration

| Rule | Task | Analysis | Mode | Claim | Expected | Actual |
|---|---|---|---|---|---|---|
| E6 | iad1-brady-audit | reference | locked | fit_for_use | G3 not failed | G3 failed (not-executed) |
| E6 | iad1-brady-audit | reference | locked | fit_for_use | G4 not failed | G4 failed (no-recorded-outputs) |
| E6 | iad1-brady-audit | reference | locked | accuracy_vs_always_responsive | G4 not failed | G4 failed (no-recorded-outputs) |
| E6 | iad1-brady-audit | reference | locked | heldout_auc | G4 not failed | G4 failed (no-recorded-outputs) |
| E3 | iad2-brady-twin | reference | locked | fit_for_use | tentative | insufficient-evidence |
| E6 | iad2-brady-twin | reference | locked | fit_for_use | G3 not failed | G3 failed (not-executed) |
| E6 | iad2-brady-twin | reference | locked | fit_for_use | G4 not failed | G4 failed (no-recorded-outputs) |
| E6 | iad2-brady-twin | reference | locked | accuracy_vs_always_responsive | G4 not failed | G4 failed (no-recorded-outputs) |
| E6 | iad2-brady-twin | reference | locked | heldout_auc | G4 not failed | G4 failed (no-recorded-outputs) |
| E3 | iad3-browning-count | reference | locked | cohort_size | confirmed | insufficient-evidence |
| E3 | p1-esr1 | reference | locked | primary | tentative | insufficient-evidence |
| E6 | p1-esr1 | reference | locked | primary | G3 not failed | G3 failed |
| E6 | p1-esr1 | reference | locked | primary | G4 not failed | G4 failed |
| E6 | p10-pseudorep | reference | locked | dlg4_effect | G1a not failed | G1a failed (count-mismatch) |
| E6 | p10-pseudorep | reference | locked | dlg4_effect | G3 not failed | G3 failed |
| E6 | p10-pseudorep | reference | locked | dlg4_effect | G4 not failed | G4 failed |
| E5 | p10-pseudorep | naive | locked | - | G1a failed | G1a passed |
| E6 | p10b-pseudorep-hidden | reference | locked | dlg4_effect | G1a not failed | G1a failed (units-missing) |
| E6 | p10b-pseudorep-hidden | reference | locked | dlg4_effect | G3 not failed | G3 failed (missing-recomputed) |
| E6 | p10b-pseudorep-hidden | reference | locked | dlg4_effect | G4 not failed | G4 failed |
| E5 | p10b-pseudorep-hidden | naive | locked | - | G1a failed | G1a passed |
| E6 | p11-confounding | reference | locked | primary | G3 not failed | G3 failed (missing-recomputed) |
| E6 | p11-confounding | reference | locked | primary | G4 not failed | G4 failed |
| E6 | p12-quality | reference | locked | primary | G3 not failed | G3 failed |
| E6 | p12-quality | reference | locked | primary | G4 not failed | G4 failed |
| E5 | p12-quality | naive | locked | - | G1c failed (strong-unhandled) | G1c passed |
| E6 | p13-endpoint | reference | locked | headline | G3 not failed | G3 failed (not-executed) |
| E6 | p13-endpoint | reference | locked | headline | G4 not failed | G4 failed (no-recorded-outputs) |
| E6 | p13-endpoint | reference | locked | primary_efficacy | G3 not failed | G3 failed (not-executed) |
| E6 | p13-endpoint | reference | locked | primary_efficacy | G4 not failed | G4 failed (no-recorded-outputs) |
| E5 | p14-citation | naive | locked | - | CIT failed | CIT absent |
| E3 | p16-recovery | reference | locked | primary | tentative | insufficient-evidence |
| E6 | p16-recovery | reference | locked | primary | G3 not failed | G3 failed |
| E6 | p16-recovery | reference | locked | primary | G4 not failed | G4 failed |
| E3 | p2-erbb2 | reference | locked | primary | tentative | insufficient-evidence |
| E6 | p2-erbb2 | reference | locked | primary | G3 not failed | G3 failed |
| E6 | p2-erbb2 | reference | locked | primary | G4 not failed | G4 failed |
| E6 | p5-permuted | reference | locked | primary | G3 not failed | G3 failed |
| E6 | p5-permuted | reference | locked | primary | G4 not failed | G4 failed |
| E6 | p6-subgroups | reference | locked | primary_efficacy | G3 not failed | G3 failed (not-executed) |
| E6 | p6-subgroups | reference | locked | primary_efficacy | G4 not failed | G4 failed (no-recorded-outputs) |
| E6 | p6-subgroups | reference | locked | subgroup_benefit | G3 not failed | G3 failed (not-executed) |
| E6 | p6-subgroups | reference | locked | subgroup_benefit | G4 not failed | G4 failed (no-recorded-outputs) |
| E6 | p7-nosignal | reference | locked | gene_region | G3 not failed | G3 failed (not-executed) |
| E6 | p7-nosignal | reference | locked | gene_region | G4 not failed | G4 failed (no-recorded-outputs) |
| E6 | p7-nosignal | reference | locked | reported_variant | G3 not failed | G3 failed (not-executed) |
| E6 | p7-nosignal | reference | locked | reported_variant | G4 not failed | G4 failed (no-recorded-outputs) |
| E6 | p8-underpowered | reference | locked | maximal_respiration | G3 not failed | G3 failed (not-executed) |
| E6 | p8-underpowered | reference | locked | maximal_respiration | G4 not failed | G4 failed (no-recorded-outputs) |
| E6 | p9-leakage | reference | locked | cell_auc | G3 not failed | G3 failed (not-executed) |
| E6 | p9-leakage | reference | locked | cell_auc | G4 not failed | G4 failed (no-recorded-outputs) |
| E5 | p9-leakage | naive | locked | - | G1b failed | G1b not-run (staging-unavailable) |
| E3 | w0-venet | reference | locked | duplicate_profiles | confirmed | refuted |
| E6 | w0-venet | reference | locked | duplicate_profiles | G1a not failed | G1a failed (count-mismatch) |

## V2 round-1 kernel vs round-2 kernel (same deliverables)

Label changes: 0. Claims with any gate outcome/code change: 100. Locked-mode changes on staged tasks:

| Task | Analysis | Claim | Gate changes |
|---|---|---|---|
| p1-esr1 | reference | primary | G3: passed -> failed; G4: passed -> failed; G5b-recovery: failed -> passed |
| p1-esr1 | naive | primary | G3: passed -> failed; G4: passed -> failed |
| p10-pseudorep | reference | dlg4_effect | G3: passed -> failed; G4: passed -> failed |
| p10-pseudorep | naive | dlg4_effect | G3: passed -> failed; G4: passed -> failed |
| p10b-pseudorep-hidden | reference | dlg4_effect | G3: not-run -> failed; G4: not-run -> failed |
| p10b-pseudorep-hidden | naive | dlg4_effect | G3: passed -> failed; G4: passed -> failed |
| p11-confounding | reference | primary | G4: passed -> failed |
| p11-confounding | naive | primary | G3: passed -> failed; G4: passed -> failed; G5b-recovery: failed -> passed |
| p12-quality | reference | primary | G3: passed -> failed; G4: passed -> failed; G5b-recovery: failed -> passed |
| p12-quality | naive | primary | G3: passed -> failed; G4: passed -> failed; G5b-recovery: failed -> passed |
| p16-recovery | reference | primary | G3: passed -> failed; G4: passed -> failed; G5b-recovery: failed -> passed |
| p16-recovery | naive | primary | G3: passed -> failed; G4: passed -> failed |
| p2-erbb2 | reference | primary | G3: passed -> failed; G4: passed -> failed; G5b-recovery: failed -> passed |
| p2-erbb2 | naive | primary | G3: passed -> failed; G4: passed -> failed |
| p5-permuted | reference | primary | G3: passed -> failed; G4: passed -> failed; G5b-recovery: failed -> passed |
| p5-permuted | naive | primary | G3: passed -> failed; G4: passed -> failed; G5b-recovery: failed -> passed |

## Null calibration (E8) and planted checks (E9)

Verdicts: E8 pass, E9_mei fail, E9_liveness fail, sandboxValidation pass. Wall 2110 s, git ec8b62e.

| Task | Variant | Re-stagings | Confirmed | Rate (95% Clopper-Pearson) | P(X >= k \| alpha) | Kernel decided | Kernel rejected | Kernel rejected and G5a passed |
|---|---|---|---|---|---|---|---|---|
| p1-esr1 | null | 200 | 0 | 0.0% (0.0%-1.8%) | 1.000 | 200 | 10 | 10 |
| p1-esr1 | mei | 40 | 0 | 0.0% (0.0%-8.8%) | - | 40 | 6 | 6 |
| p1-esr1 | large | 20 | 0 | 0.0% (0.0%-16.8%) | - | 20 | 20 | 19 |
| p2-erbb2 | null | 200 | 0 | 0.0% (0.0%-1.8%) | 1.000 | 200 | 10 | 10 |
| p2-erbb2 | mei | 40 | 0 | 0.0% (0.0%-8.8%) | - | 40 | 8 | 8 |
| p2-erbb2 | large | 20 | 0 | 0.0% (0.0%-16.8%) | - | 20 | 20 | 20 |
| p12-quality | null | 200 | 0 | 0.0% (0.0%-1.8%) | 1.000 | 200 | 9 | 9 |
| p12-quality | mei | 40 | 0 | 0.0% (0.0%-8.8%) | - | 40 | 23 | 19 |
| p12-quality | large | 20 | 0 | 0.0% (0.0%-16.8%) | - | 20 | 20 | 17 |
| pooled | null | 600 | 0 | 0.0% (0.0%-0.6%) | 1.000 | 600 | 29 | 29 |

Kernel columns are descriptive (not pre-registered): how often the trusted permutation decision rejected, before G3/G4 and the other gates.

Sandbox validation (in-process simulation program vs the real sandboxed program, same re-staging):

- p1-esr1 null 0: identical outcome fingerprint (sandbox 37 s, in-process 4 s)
- p1-esr1 null 1: identical outcome fingerprint (sandbox 37 s, in-process 5 s)
- p1-esr1 null 2: identical outcome fingerprint (sandbox 41 s, in-process 3 s)
- p2-erbb2 null 0: identical outcome fingerprint (sandbox 37 s, in-process 4 s)
- p2-erbb2 null 1: identical outcome fingerprint (sandbox 37 s, in-process 5 s)
- p2-erbb2 null 2: identical outcome fingerprint (sandbox 41 s, in-process 3 s)
- p12-quality null 0: identical outcome fingerprint (sandbox 28 s, in-process 12 s)
- p12-quality null 1: identical outcome fingerprint (sandbox 29 s, in-process 10 s)
- p12-quality null 2: identical outcome fingerprint (sandbox 29 s, in-process 9 s)

## Load invariance (E7)

FAIL: 86/88 certifications identical under 8 busy workers (load 3.94/4.29/6.23 -> 15.82/16.2/13.66). Quiet wall 848 s, loaded 1045 s.

| Certification | Quiet | Loaded |
|---|---|---|
| p1-esr1 naive locked | {"task":"p1-esr1","analysis":"naive","mode":"locked","plan":"accepted","locked":true,"staging":true,"executions":["ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","failed","ok"],"claims":[{"id":"primary","status":"insufficient-evidence","taskStatus":"insufficient-evidence","outcome":"unevaluable","kernel":"unresolved","gates":{"G1":["passed",true,null],"G1a":["passed",true,null],"G1c":["passed",true,null],"G2":["passed",true,null],"G3":["failed",false,null],"G4":["failed",false,null],"G5a":["failed",false,null],"G5b-power":["failed",false,null],"G5b-recovery":["failed",false,null],"G6":["failed",false,"incomplete-family"]}}]} | {"task":"p1-esr1","analysis":"naive","mode":"locked","plan":"accepted","locked":true,"staging":true,"executions":["ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok"],"claims":[{"id":"primary","status":"insufficient-evidence","taskStatus":"insufficient-evidence","outcome":"unevaluable","kernel":"unresolved","gates":{"G1":["passed",true,null],"G1a":["passed",true,null],"G1c":["passed",true,null],"G2":["passed",true,null],"G3":["failed",false,null],"G4":["failed",false,null],"G5a":["failed",false,null],"G5b-power":["failed",false,null],"G5b-recovery":["failed",false,null],"G6":["failed",false,"incomplete-family"]}}]} |
| p1-esr1 reference locked | {"task":"p1-esr1","analysis":"reference","mode":"locked","plan":"accepted","locked":true,"staging":true,"executions":["ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok"],"claims":[{"id":"primary","status":"insufficient-evidence","taskStatus":"insufficient-evidence","outcome":"unevaluable","kernel":"unresolved","gates":{"G1":["passed",true,null],"G1a":["passed",true,null],"G1c":["passed",true,null],"G2":["passed",true,null],"G3":["failed",false,null],"G4":["failed",false,null],"G5a":["failed",false,null],"G5b-power":["failed",false,null],"G5b-recovery":["passed",true,null],"G6":["failed",false,"incomplete-family"]}}]} | {"task":"p1-esr1","analysis":"reference","mode":"locked","plan":"accepted","locked":true,"staging":true,"executions":["ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","ok","failed","ok"],"claims":[{"id":"primary","status":"insufficient-evidence","taskStatus":"insufficient-evidence","outcome":"unevaluable","kernel":"unresolved","gates":{"G1":["passed",true,null],"G1a":["passed",true,null],"G1c":["passed",true,null],"G2":["passed",true,null],"G3":["failed",false,null],"G4":["failed",false,null],"G5a":["failed",false,null],"G5b-power":["failed",false,null],"G5b-recovery":["failed",false,null],"G6":["failed",false,"incomplete-family"]}}]} |

## Timing (locked mode, quiet run)

| Task | Analysis | Certify (s) | Executions | Execution total (s) | Loaded certify (s) |
|---|---|---|---|---|---|
| p1-esr1 | reference | 29.6 | 104 | 56.7 | 12.6 |
| p1-esr1 | naive | 12.2 | 39 | 21.6 | 36.9 |
| p10-pseudorep | reference | 1.9 | 2 | 1.9 | 2.5 |
| p10-pseudorep | naive | 1.3 | 2 | 1.3 | 1.6 |
| p10b-pseudorep-hidden | reference | 1.2 | 2 | 1.2 | 1.7 |
| p10b-pseudorep-hidden | naive | 1.2 | 2 | 1.2 | 1.6 |
| p11-confounding | reference | 1.1 | 2 | 1.1 | 1.7 |
| p11-confounding | naive | 29.7 | 104 | 57.3 | 36.6 |
| p12-quality | reference | 29.7 | 104 | 57.2 | 44.5 |
| p12-quality | naive | 29.4 | 104 | 56.5 | 38.6 |
| p16-recovery | reference | 29.7 | 104 | 57.1 | 39.2 |
| p16-recovery | naive | 35.1 | 104 | 67.5 | 38.5 |
| p2-erbb2 | reference | 34.9 | 104 | 67.1 | 38.3 |
| p2-erbb2 | naive | 36.0 | 104 | 69.3 | 39.5 |
| p5-permuted | reference | 36.5 | 104 | 70.3 | 40.7 |
| p5-permuted | naive | 32.8 | 104 | 62.8 | 42.6 |
| w0-venet | reference | 21.8 | 2 | 15.3 | 32.8 |
| w0-venet | naive | 17.8 | 2 | 11.6 | 21.5 |

Unstaged tasks: 52 certifications, median 6 ms each (staging refused before any execution).
