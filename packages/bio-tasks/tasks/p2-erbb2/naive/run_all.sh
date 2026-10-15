#!/usr/bin/env bash
set -euo pipefail
source ./env.sh
python code/analysis.py p2-erbb2 --naive
