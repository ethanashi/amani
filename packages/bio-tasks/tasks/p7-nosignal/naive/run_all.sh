#!/usr/bin/env bash
# Calibration fixture: p > 0.05 read as "no effect"; the smallest p in the region read as a hit.
set -euo pipefail
source ./env.sh
mkdir -p outputs
python code/analysis.py
