#!/usr/bin/env bash
# Calibration fixture (lazy_skeptic): a naive audit that must fail the checker. See code/analysis.py.
set -euo pipefail
source ./env.sh
mkdir -p outputs
python code/analysis.py lazy_skeptic
