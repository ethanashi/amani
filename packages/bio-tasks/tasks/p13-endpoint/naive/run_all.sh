#!/usr/bin/env bash
# Calibration fixture: the analysis that leads with whichever endpoint is most significant.
set -euo pipefail
source ./env.sh
mkdir -p outputs
python code/analysis.py
