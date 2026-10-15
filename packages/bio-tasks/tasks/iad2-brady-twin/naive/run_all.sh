#!/usr/bin/env bash
# Calibration fixture (claim_echo): a naive audit that must fail the checker. See code/analysis.py.
# naive/variants/<name>/ hold the other naive audits; calibrate_iad.py runs every one of them.
set -euo pipefail
source ./env.sh
mkdir -p outputs
python code/analysis.py claim_echo
