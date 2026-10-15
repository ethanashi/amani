#!/usr/bin/env bash
# Calibration fixture (strict_more_than_five): a naive application of the rule that must fail. See code/analysis.py.
set -euo pipefail
source ./env.sh
mkdir -p outputs
python code/analysis.py strict_more_than_five
