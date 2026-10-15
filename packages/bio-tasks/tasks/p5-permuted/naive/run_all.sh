#!/usr/bin/env bash
set -euo pipefail
source ./env.sh
python code/analysis.py p5-permuted --naive
