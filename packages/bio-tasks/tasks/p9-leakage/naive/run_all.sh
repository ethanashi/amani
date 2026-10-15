#!/usr/bin/env bash
# Calibration fixture: a cell-level classifier evaluated on a random split of cells.
set -euo pipefail
source ./env.sh
mkdir -p outputs
python code/analysis.py
