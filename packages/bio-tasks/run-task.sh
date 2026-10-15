#!/usr/bin/env bash
# Run one arm attempt on one pilot task.
#
#   bash packages/bio-tasks/run-task.sh <task-id> <claude|codex|omerta> <attempt-id>
#        [--dry-run] [--cap-sec N] [--results-root DIR] [--stage-dir DIR]
#
# 1. Refuses unless the task card is valid and calibration.json is valid AND bound to the current
#    card, staged manifest, sealed key and task code (a stale calibration means: recalibrate first).
# 2. Stages the task into a fresh directory under the results root (or verifies --stage-dir).
# 3. Verifies every staged byte against the card's datasetManifestHash; any tampered, missing or
#    extra file refuses before an arm is launched.
# 4. Runs the existing bio-baseline arm runner with its task parameter: same deny-by-root
#    containment, scrubbed env, egress proxy, wall-clock cap (card capMinutes unless --cap-sec),
#    operation lease and cleanup as the warm-up. The runner re-verifies the copy it hands the arm.
# Results: <results-root>/<task-id>/<arm>-<attempt>/ (default root ~/.omerta-bio/task-results,
# outside the repository and the arm-readable tree).
set -u -o pipefail
HERE="$(cd "$(dirname "$0")" && pwd -P)"
REPO="$(cd "$HERE/../.." && pwd -P)"
BASE="$REPO/packages/bio-baseline"
TPY="${BIO_TASKS_PYTHON:-$BASE/.pixi/envs/default/bin/python}"

usage() { echo "usage: $0 <task-id> <claude|codex|omerta> <attempt-id> [--dry-run] [--cap-sec N] [--results-root DIR] [--stage-dir DIR]" >&2; exit 2; }
[ $# -ge 3 ] || usage
TASK_ID="$1"; ARM="$2"; ATTEMPT="$3"; shift 3
case "$TASK_ID" in *[!a-z0-9-]*|-*|"") echo "invalid task id" >&2; exit 2 ;; esac
case "$ARM" in claude|codex|omerta) ;; *) usage ;; esac
case "$ATTEMPT" in *[!A-Za-z0-9._-]*|.*|"") echo "attempt id must match [A-Za-z0-9._-]+ and not start with a dot" >&2; exit 2 ;; esac
DRY=()
CAP=""
RESULTS_ROOT="${BIO_TASK_RESULTS_ROOT:-$HOME/.omerta-bio/task-results}"
STAGE_DIR=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=(--dry-run) ;;
    --cap-sec) CAP="$2"; shift ;;
    --results-root) RESULTS_ROOT="$2"; shift ;;
    --stage-dir) STAGE_DIR="$2"; shift ;;
    *) usage ;;
  esac
  shift
done
[ -x "$TPY" ] || { echo "bio-baseline pixi env missing: pixi install --frozen --manifest-path packages/bio-baseline/pixi.toml" >&2; exit 5; }
export PYTHONPATH="$HERE/lib"

PRE="$("$TPY" -m biotasks preflight "$TASK_ID")" || exit 3
HASH="${PRE%% *}"
[ -n "$CAP" ] || CAP="${PRE##* }"

TASK_RESULTS="$RESULTS_ROOT/$TASK_ID"
mkdir -p "$TASK_RESULTS" || exit 4
TASK_RESULTS="$(cd "$TASK_RESULTS" && pwd -P)"
OWN_STAGE=""
cleanup() { [ -z "$OWN_STAGE" ] || rm -rf "$OWN_STAGE"; }
trap cleanup EXIT
if [ -z "$STAGE_DIR" ]; then
  OWN_STAGE="$(mktemp -d "$TASK_RESULTS/.stage-$ARM-$ATTEMPT.XXXXXX")" || exit 4
  STAGE_DIR="$OWN_STAGE/staged"
  "$TPY" -m biotasks stage "$TASK_ID" --out "$STAGE_DIR" >/dev/null || { echo "staging failed for $TASK_ID" >&2; exit 4; }
fi
"$TPY" -m biotasks verify-stage "$TASK_ID" "$STAGE_DIR" || { echo "refusing: staged $TASK_ID does not match its card manifest" >&2; exit 3; }

RUNNER="$BASE/arms/run-$ARM-arm.sh"
# Recovery must never silently run as an uninterrupted ordinary task.
if [ "$TASK_ID" = p16-recovery ]; then RUNNER="$HERE/tasks/p16-recovery/run-$ARM.sh"; fi
bash "$RUNNER" "$ATTEMPT" --task "$STAGE_DIR" --task-id "$TASK_ID" \
  --task-manifest-sha256 "$HASH" --results-root "$TASK_RESULTS" --cap-sec "$CAP" ${DRY[@]+"${DRY[@]}"}
exit $?
