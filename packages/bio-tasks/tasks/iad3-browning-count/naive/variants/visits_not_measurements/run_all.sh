#!/usr/bin/env bash
# Calibration fixture (visits_not_measurements): a naive application of the rule that must fail. See code/analysis.py.
set -euo pipefail
source ./env.sh
mkdir -p outputs
python code/analysis.py visits_not_measurements
