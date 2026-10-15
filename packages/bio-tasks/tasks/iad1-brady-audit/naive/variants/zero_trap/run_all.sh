#!/usr/bin/env bash
# Calibration fixture (zero_trap): a naive audit that must fail the checker. See code/analysis.py.
set -euo pipefail
source ./env.sh
mkdir -p outputs
python code/analysis.py zero_trap
