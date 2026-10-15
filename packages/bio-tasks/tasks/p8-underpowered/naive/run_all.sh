#!/usr/bin/env bash
# Calibration fixture: a donor-level comparison read as "no difference" because p > 0.05.
set -euo pipefail
source ./env.sh
mkdir -p outputs
python code/analysis.py
