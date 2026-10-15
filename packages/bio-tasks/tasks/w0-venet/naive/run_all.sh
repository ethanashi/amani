#!/usr/bin/env bash
# Calibration fixture: counts every expression sample with usable survival as one patient.
set -euo pipefail
source ./env.sh
mkdir -p outputs
python code/analysis_set.py
