#!/usr/bin/env bash
# Unscheduled arm dispatch. The coordinator must first register a locked amendment.
set -euo pipefail
[ "${OMB_AMANI_PILOT_ENABLED:-}" = 1 ] || { echo "amani pilot arm is disabled; coordinator registration required" >&2; exit 2; }
HERE="$(cd "$(dirname "$0")" && pwd -P)"
export PATH="/opt/homebrew/opt/node@24/bin:$PATH"
exec nice -n 10 node --experimental-transform-types --no-warnings "$HERE/../../omb-amani/src/pilot.ts" "$@"
