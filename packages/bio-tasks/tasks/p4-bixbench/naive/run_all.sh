#!/usr/bin/env bash
set -euo pipefail
source ./env.sh
python code/analysis.py p4-bixbench --naive
