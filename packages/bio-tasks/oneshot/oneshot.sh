#!/bin/sh
# KB0 one-shot cards CLI (host-side only; never mount this repository into an analyst sandbox).
#   oneshot.sh build-card CASE_DIR OUT_DIR [--variant N] [--offline]
#   oneshot.sh dry-run CASE_DIR
#   oneshot.sh serve CARD_DIR ANALYST_DIR --context-id ID
#   oneshot.sh grade CARD_DIR REPORT (--context-id ID | --audit)
#   oneshot.sh verify CARD_DIR
#   oneshot.sh scan CARD_DIR TREE
# Requires explicit BIO_GRADING_ROOT and BIO_SEALING_KEY outside the repository (see README.md).
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
pkg=$(dirname -- "$here")
repo=$(dirname -- "$(dirname -- "$pkg")")
python="$repo/packages/bio-baseline/.pixi/envs/default/bin/python"
[ -x "$python" ] || { echo "missing pixi env: pixi install --frozen --manifest-path packages/bio-baseline/pixi.toml" >&2; exit 2; }
PYTHONPATH="$pkg/lib" PYTHONDONTWRITEBYTECODE=1 exec "$python" -B -m biotasks.oneshot "$@"
