#!/bin/sh
set -eu
export PATH="/opt/homebrew/opt/node@24/bin:$PATH"
if [ "${1:-}" = "paper-pdf" ]; then
  [ "$#" -eq 1 ] || { echo "usage: ci.sh paper-pdf" >&2; exit 2; }
  exec python3 "$(dirname "$0")/paper-pdf.py"
fi
exec python3 "$(dirname "$0")/pipeline.py" "$@"
