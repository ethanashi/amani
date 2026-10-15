#!/usr/bin/env bash
# Deliberately reserved. HOST_CONFIG is a host-only smoke/integration entry, not a task dispatcher.
set -euo pipefail
if [[ "${1:-}" != run-host-config || "$#" != 2 ]]; then
  echo 'codex-tools-gauntlet is reserved: V10 must wire task staging/lease/grading and amend the study' >&2
  exit 2
fi
exec /opt/homebrew/opt/node@24/bin/node "$(cd "$(dirname "$0")/.." && pwd -P)/src/cli.ts" "$@"
