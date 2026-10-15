#!/usr/bin/env bash
# Calibration fixture (zeros_counted): a naive application of the rule that must not pass. See code/analysis.py.
# naive/variants/<name>/ hold the other naive answers; calibrate_iad.py runs every one of them.
set -euo pipefail
source ./env.sh
mkdir -p outputs
python code/analysis.py zeros_counted
