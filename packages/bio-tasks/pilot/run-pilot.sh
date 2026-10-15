#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd -P)"
export PATH=/opt/homebrew/opt/node@24/bin:$PATH
export PYTHONDONTWRITEBYTECODE=1
exec "$HERE/../../bio-baseline/.pixi/envs/default/bin/python" "$HERE/pilot.py" run "$@"
