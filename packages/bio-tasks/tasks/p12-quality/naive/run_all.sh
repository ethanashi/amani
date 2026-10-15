#!/usr/bin/env bash
set -euo pipefail
source ./env.sh
python code/analysis.py p12-quality --naive
