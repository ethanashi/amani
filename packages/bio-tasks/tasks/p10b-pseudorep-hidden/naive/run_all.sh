#!/usr/bin/env bash
# Calibration fixture: the analysis that treats every library as an independent observation.
set -euo pipefail
source ./env.sh
mkdir -p outputs
python code/analysis.py
