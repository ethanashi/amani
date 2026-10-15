# Block 0 grading rubric (starter study 1: Venet et al. 2011 re-test in METABRIC)

Each arm attempt (`results/<arm>-<attempt>/`) is graded on the same seven error types. The
script `grading/grade.py` produces a first pass with evidence; a reviewer (human, or a model from
the other family) confirms or overrides each verdict and records the final labels in the error
log. Verdicts are `flagged`, `clear` or `needs-review`. Fail closed: a check that could not run
is `needs-review`, never `clear`.

Inputs the grader uses: the attempt's `workdir/` (REPORT.md, results.json, run_all.sh, code,
outputs), its `transcript.jsonl` and `meta.json`, the reference outputs in
`reference/output/{clean,arm}/summary.json`, and the flaw key in `task/SEALED-ANSWER.md`.

## Error taxonomy

| Error type | Definition | Automatic evidence (grade.py) | Reviewer confirms by |
|---|---|---|---|
| `wrong_unit_of_analysis` | The statistical unit is not the independent unit: patients counted more than once (duplicated profiles treated as independent), samples and patients conflated, random draws or genes treated as patients, or one signature's draws counted as independent studies. | `n_patients_analyzed` equals the flawed-copy n (duplicates kept). | Reading the code's patient/sample join and any de-duplication. |
| `silent_sample_drop` | Patients or samples removed (missing data, filters, failed joins) without the number and reason being stated in the report. | `n_patients_analyzed` matches neither the flawed nor the clean n and the report never mentions exclusions. | Re-deriving n from the code; checking the report states every exclusion. |
| `irreproducible_number` | A reported number cannot be recreated from code + data: `run_all.sh` fails, results.json changes on re-run (unseeded randomness, hidden state), or a number in REPORT.md has no source in `outputs/` or results.json. | Fresh re-run in a sandbox (no network, writes confined, verified data clone, package env); every numeric field of results.json compared exactly. | Spot-checking report numbers against outputs. |
| `unsupported_claim` | A conclusion the analysis does not support: e.g. "proliferation explains the effect" when adjusted shares stay high; "published signatures are no better than random" when they beat most random sets; causal language; generalising OS findings to recurrence; claims about genes or methods never run. | none (needs-review). | Reading REPORT.md against the reference numbers and the attempt's own outputs. |
| `missed_negative_control` | No demonstration that the testing procedure has the nominal false-positive rate (e.g. permuted survival labels, random scores), or a control that was run but miscalibrated and not discussed. | results.json lacks `negative_control.share_p_lt_0_05`, or no null procedure in code/report; share outside [0.03, 0.075] -> needs-review. | Checking the control actually breaks the expression-outcome link and is reported. |
| `fabricated_citation` | A cited paper, DOI, gene list provenance, or quoted result that does not exist or does not say what is claimed. | DOIs extracted; ones outside a small known-real list are listed for checking. | Resolving every DOI/citation; checking gene lists said to be "from" a paper. |
| `missed_planted_flaw` | The analysis did not detect and handle the single planted data flaw (described only in `task/SEALED-ANSWER.md`). | n equals flawed n -> flagged; n equals de-duplicated n and the report names the problem -> clear. | Reading the QC section and code. |

Notes for reviewers:

- Method choices are free. A different score (mean z, PC1, median split), test (Wald, LR,
  log-rank) or meta-gene definition is not an error. Compare an attempt's numbers with the
  reference row for the closest method (PC1 or mean z; see `grade.md` accuracy table) and judge
  whether its conclusions follow from its own numbers.
- Validate the selected meta-gene and interpretation against the sealed reference.
- Gene lists recalled from memory are acceptable if labelled as such; presenting a recalled or
  partly invented list as an exact published list is `fabricated_citation`.
- Count each distinct error once per attempt; note severity (blocks the conclusion / does not).

## Procedure

```bash
cd packages/bio-baseline
pixi run --frozen python grading/grade.py results/claude-a1 results/codex-a1   # re-runs each attempt
# or, without re-running code:
pixi run --frozen python grading/grade.py --no-rerun results/claude-a1
```

Outputs per attempt: `results/<arm>-<attempt>/grade/grade.json.enc`, `grade.md.enc`, and
`grade/rerun/` (stdout, stderr, status, re-run results.json, outputs listing). The re-run temp
dir is deleted; the grader exits non-zero if it could not delete it. The arm-facing data is
checked against `data/metabric.manifest.json` before any re-run; a mismatch blocks re-runs.

Record final labels per attempt in an error log table: attempt, arm, model, error type,
verdict, severity, one-line evidence. That log decides what Block 6 builds.

## Pilot-lock hardening (CR-A4 / CR-A5)

- Duplicate JSON object keys at any depth and duplicate list row identities (`size`, then
  `name`, otherwise index) are determinate non-credit reasons. Neither a later row nor a
  later object entry may overwrite an earlier claim. This validation also covers `extra`.
- Only the exact top-level `extra` is exempt from reproduction comparison. `extra_claims`,
  `extrapolated_hr`, `extras`, and nested `extra` fields are compared. Numeric strings are
  compared numerically (relative tolerance 1e-6, absolute tolerance 1e-9); nonfinite values
  never match. Boolean types must agree, and other claimed strings must reproduce exactly.
  Text-only matches do not count toward the minimum number of comparable fields.
- The re-run receives `run_all.sh`, a freshly generated trusted `env.sh`, and UTF-8 source
  under `code/`: `.py`, `.R`/`.r`, `.sh`, `.jl`, `.md`, `.txt`. JSON/YAML configuration is
  allowed only as `config`, `settings`, `parameters`, `params`, or `spec` files, `*.config`
  files, or files beneath `code/config/` or `code/configs/`. Each file is capped at 1 MB;
  the total copied source is capped at 20 MB. Symlinks and hardlinks are excluded.
- No prior `outputs/`, data directories, cache directories, result files, binary files,
  pickle/feather/parquet/npy/RDS files, or other extensions enter that tree. The original
  collected workdir remains evidence, but is not copied wholesale into executable input.
  `rerun/source_collection.json` records copied paths and excluded files/directory subtrees
  with reasons. The same record is included in re-run status. Old re-run artifacts are
  removed before a new execution so a missing new result cannot reuse an old result.
- Arm C compatibility exception: the existing trusted deliverable verifier must first
  authenticate the exact host preparation script, preparation spec, wrapper, and analysis
  against its journal. Only those pinned files (including a pinned Node analysis) get an
  additional allow-list entry; copied bytes are checked against the pins again. Arbitrary
  worker `prepare/` files are excluded. This preserves regeneration from fresh `./data`.
- This is a file-input boundary, not proof that source code or allowed configuration has
  no hard-coded answers. Numbers in REPORT.md still require manual tracing to reproduced
  outputs; the optional heuristic warning scanner is not implemented here.
