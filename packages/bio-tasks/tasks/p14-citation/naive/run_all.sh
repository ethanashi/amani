#!/usr/bin/env bash
# Calibration fixture: a reference check that trusts the draft (complete-looking references pass).
set -euo pipefail
source ./env.sh
mkdir -p outputs
python code/check_refs.py
