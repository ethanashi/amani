#!/usr/bin/env bash
set -eu -o pipefail
HERE="$(cd "$(dirname "$0")" && pwd -P)"
exec "${BIO_TASKS_PYTHON:?pilot must supply grading Python}" "$HERE/grading.py" "$@"
