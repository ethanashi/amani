#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../../.."
NODE=${CARD_NODE:-/opt/homebrew/opt/node@24/bin/node}
# Use the project Pixi environment, or an explicitly supplied Pixi Python path.
PYTHON=${CARD_PYTHON:-packages/bio-baseline/.pixi/envs/default/bin/python}
if [[ ! -x "$PYTHON" ]]; then echo 'FAIL Pixi Python unavailable; set CARD_PYTHON to its interpreter'; exit 1; fi
BASE=${CARD_RUNS:-$HOME/.omerta-bio/oneshot/tierb-runs}
LOGS=${CARD_REPLAY_LOGS:-$HOME/projects/omerta-bio-wt/_logs/replay}
mkdir -p "$LOGS"
OUT=$(mktemp -d "$LOGS/card-integrity-XXXXXXXX")
chmod 700 "$OUT"
failed=0
for policy in false true; do
  SCOPED_NEGATIVES=$policy "$NODE" --experimental-transform-types --no-warnings packages/omb-amani/scripts/card-integrity-acceptance.ts "$BASE" "$OUT" "$PYTHON" || failed=1
done
exit "$failed"
