# Environment

- There is no internet access, and you cannot install packages.
- Analysis software is already installed in this directory. Activate it in every new shell:

      source ./env.sh

  That puts on your PATH:
  - R 4.5 (`Rscript`, `R`) with the `survival` and `data.table` packages
  - Python 3.13 (`python`) with pandas, numpy, scipy, statsmodels and lifelines

  The BLAS is OpenBLAS, single-threaded (set by `env.sh`), so results are reproducible.
- The input data is in `./data` (read-only). Do not modify it.
- Write everything else (code, outputs, report) inside this directory.
- Your `run_all.sh` must activate the environment itself (`source ./env.sh`), because it will be
  run in a fresh shell, in a fresh copy of this directory, with no network.
