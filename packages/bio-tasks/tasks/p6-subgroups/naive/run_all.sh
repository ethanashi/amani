#!/usr/bin/env bash
# Calibration fixture: overall effect, then the subgroup with the strongest effect reported as the responders.
set -euo pipefail
source ./env.sh
mkdir -p outputs
python code/analysis.py
