#!/usr/bin/env bash
# Grade arm attempts on one pilot task.
#
#   bash packages/bio-tasks/grade-task.sh <task-id> <attempt-dir> [<attempt-dir> ...] [--rerun-cap-sec N]
#
# Refuses unless the task is calibrated against its current artifacts. Under the exclusive grading
# lease: stages the task afresh and verifies it against the card; re-runs each attempt's run_all.sh
# with bio-baseline grade.py's sandboxed re-run (no network, home and scratch roots denied, writes
# confined, verified data); compares claimed vs re-run numbers and claims; then runs the task's
# check.py against the sealed key (decrypted only inside the grading root, deleted afterwards).
# Writes <attempt>/grade/task-grade.json.enc (sealed, with evidence) and task-summary.json
# (plaintext, verdict ids and scores only). Exit 3 if a re-run temp dir could not be deleted.
set -u -o pipefail
HERE="$(cd "$(dirname "$0")" && pwd -P)"
REPO="$(cd "$HERE/../.." && pwd -P)"
TPY="${BIO_TASKS_PYTHON:-$REPO/packages/bio-baseline/.pixi/envs/default/bin/python}"
[ $# -ge 2 ] || { echo "usage: $0 <task-id> <attempt-dir>... [--rerun-cap-sec N]" >&2; exit 2; }
[ -x "$TPY" ] || { echo "bio-baseline pixi env missing: pixi install --frozen --manifest-path packages/bio-baseline/pixi.toml" >&2; exit 5; }
export PYTHONPATH="$HERE/lib"
# p16-recovery is dispatched inside `biotasks grade` (lib/biotasks/recovery_grade.py), so this
# script and `python -m biotasks grade` share one implementation of not-exercised exclusion.
exec "$TPY" -m biotasks grade "$@"
