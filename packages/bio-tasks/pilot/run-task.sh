#!/usr/bin/env bash
# Arm B adapter over the calibrated task runner. No model calls outside the arm runner.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd -P)"
PY="${BIO_TASKS_PYTHON:-$HERE/../../bio-baseline/.pixi/envs/default/bin/python}"
exec "$PY" -B "$HERE/tool_task.py" "$@"
