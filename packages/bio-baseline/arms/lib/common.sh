# shellcheck shell=bash
# Shared logic for the Block 0 arm runners. Sourced by run-claude-arm.sh / run-codex-arm.sh.
# Compatible with macOS /bin/bash 3.2. Not executable on its own.
#
# Lifecycle of one attempt:
#   parse args -> acquire supervised operation lease -> refuse if results/<arm>-<attempt> exists ->
#   fresh mktemp dir -> copy ONLY arm-facing data + TASK.md + ENVIRONMENT.md + a fresh pixi env ->
#   build a throwaway HOME and start a loopback egress proxy (only the model API is allowlisted) ->
#   abort if the operator already cancelled ->
#   run the agent under a wall-clock cap, in its own process group, with a SCRUBBED environment,
#   and (Codex) inside an OS seatbelt that denies reads/writes/network outside the work dir ->
#   collect the agent's outputs -> delete the temp dir (also on error, cancel, timeout) ->
#   write meta.json. Exit 0 only when the agent exited 0, outputs were collected, and the temp
#   dir is gone (fail closed).

ARM_LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
PKG="$(cd "$ARM_LIB/../.." && pwd -P)"
PY="${ARM_PYTHON:-python3}"
DATA_FILES="clinical_patient.tsv clinical_sample.tsv clinical_attributes.tsv expression_mrna.tsv"
TMP_PREFIX="bba"
# Supervisor holds the operation lock through cleanup, including shell SIGKILL.
if [ "${BIO_OPERATION:-}" != arm ]; then
  exec "$PY" "$ARM_LIB/operation.py" arm -- bash "$0" "$@"
fi

PROMPT_TEXT='Read TASK.md and ENVIRONMENT.md in the current directory and carry out the task completely, on your own, without asking questions. Work only inside the current directory. There is no internet access. Before you finish, make sure REPORT.md, results.json and run_all.sh exist as TASK.md specifies.'

[ -z "${ARM_PROMPT_TEXT:-}" ] || PROMPT_TEXT="$ARM_PROMPT_TEXT"

WORKTMP=""
RESULT=""
CAPPED_PID=""
PROXY_PID=""
PROXY_PORT=""
CANCELLED=0
FINALIZED=0
# Set by the per-arm runner before arm_run:
ARM_PROXY_ALLOW="${ARM_PROXY_ALLOW:-}"     # comma list of hosts the proxy may tunnel to
ARM_SANDBOX_PROFILE=""                       # path to an OS seatbelt profile, or empty
AGENT_ENV_EXTRA=()                           # extra K=V for the scrubbed agent environment

arm_usage() {
  echo "usage: $0 <attempt-id> [--dry-run] [--cap-sec N] [--data-dir DIR] [--results-root DIR]" >&2
  echo "       [--task STAGED_DIR --task-id ID --task-manifest-sha256 HEX]   (default task: the warm-up)" >&2
  exit 2
}

arm_now() {
  if [ -n "${ARM_FAKE_NOW:-}" ]; then printf '%s\n' "$ARM_FAKE_NOW"; else date -u +%Y-%m-%dT%H:%M:%SZ; fi
}

arm_parse_args() {
  ATTEMPT="${1:-}"
  [ -n "$ATTEMPT" ] || arm_usage
  shift
  case "$ATTEMPT" in
    *[!A-Za-z0-9._-]*|.*) echo "attempt id must match [A-Za-z0-9._-]+ and not start with a dot" >&2; exit 2 ;;
  esac
  DRY_RUN=0
  CAP_SEC="${ARM_WALL_CAP_SEC:-5400}"
  CAP_MS=""
  DATA_DIR="${ARM_DATA_DIR:-$HOME/.omerta-bio/datasets/metabric/arm}"
  RESULTS_ROOT="${ARM_RESULTS_ROOT:-$PKG/results}"
  # Task parameter (bio-tasks). Empty = the warm-up: DATA_FILES from DATA_DIR + task/TASK.md.
  TASK_DIR=""
  TASK_ID=""
  TASK_MANIFEST_SHA=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --dry-run) DRY_RUN=1 ;;
      --cap-sec) CAP_SEC="$2"; shift ;;
      --cap-ms) CAP_MS="$2"; shift ;;
      --data-dir) DATA_DIR="$2"; shift ;;
      --results-root) RESULTS_ROOT="$2"; shift ;;
      --task) TASK_DIR="$2"; shift ;;
      --task-id) TASK_ID="$2"; shift ;;
      --task-manifest-sha256) TASK_MANIFEST_SHA="$2"; shift ;;
      *) arm_usage ;;
    esac
    shift
  done
  if [ "$DRY_RUN" != 1 ] && [ -n "${ARM_DRY_AGENT:-}" ]; then
    echo 'ARM_DRY_AGENT requires --dry-run' >&2; exit 2
  fi
  [ -n "$CAP_MS" ] || CAP_MS=$((CAP_SEC * 1000))
  case "$CAP_MS" in *[!0-9]*|"") echo 'invalid cap milliseconds' >&2; exit 2 ;; esac
  [ "$CAP_MS" -gt 0 ] && [ "$CAP_MS" -le 2147483647 ] || { echo 'invalid cap milliseconds' >&2; exit 2; }
  PROMPT_TEXT="$PROMPT_TEXT Overall wall-clock cap: $CAP_MS milliseconds from arm launch, shared by all work, including checking and repairs; turns never reset this budget."
  if [ -n "$TASK_DIR$TASK_ID$TASK_MANIFEST_SHA" ]; then
    # All three or none: a staged task is only ever run against its pinned manifest hash.
    [ -n "$TASK_DIR" ] && [ -n "$TASK_ID" ] && [ -n "$TASK_MANIFEST_SHA" ] || arm_usage
    case "$TASK_ID" in
      *[!a-z0-9-]*|-*) echo "task id must match [a-z0-9-]+" >&2; exit 2 ;;
    esac
    case "$TASK_MANIFEST_SHA" in
      *[!0-9a-f]*) echo "task manifest sha256 must be lowercase hex" >&2; exit 2 ;;
    esac
    [ "${#TASK_MANIFEST_SHA}" = 64 ] || { echo "task manifest sha256 must be 64 hex characters" >&2; exit 2; }
    [ -d "$TASK_DIR" ] || { echo "staged task directory missing: $TASK_DIR" >&2; exit 3; }
    TASK_DIR="$(cd "$TASK_DIR" && pwd -P)"
  fi
}

# JSON array of the arguments (pure bash, so no interpreter start-up per call).
arm_json_array() {
  local out="[" sep="" s
  for s in "$@"; do
    s=${s//\\/\\\\}; s=${s//\"/\\\"}; s=${s//$'\n'/\\n}; s=${s//$'\t'/\\t}
    out="$out$sep\"$s\""; sep=", "
  done
  printf '%s]\n' "$out"
}

# Meta fields are queued with arm_meta_add and written (merged into meta.json) by arm_meta.
META_PENDING=()
arm_meta_add() { META_PENDING+=("$@"); }
arm_meta() {
  "$PY" "$ARM_LIB/armlib.py" meta "$RESULT/meta.json" ${META_PENDING[@]+"${META_PENDING[@]}"} "$@"
  META_PENDING=()
}

arm_stop_proxy() {
  [ -n "$PROXY_PID" ] || return 0
  kill "$PROXY_PID" 2>/dev/null || true
  wait "$PROXY_PID" 2>/dev/null || true
  PROXY_PID=""
}

arm_delete_tmp() {
  [ -n "$WORKTMP" ] || return 0
  [ -e "$WORKTMP" ] || return 0
  case "$WORKTMP" in
    */$TMP_PREFIX.*) ;;
    *) echo "refusing to delete unexpected path: $WORKTMP" >&2; return 1 ;;
  esac
  # Kill anything still running from inside the temp dir (agent subprocesses that left the group).
  local pids
  pids="$( { pgrep -f "$WORKTMP" 2>/dev/null
            lsof -d cwd -Fpn 2>/dev/null | awk -v p="$WORKTMP" \
              '/^p/ { pid = substr($0, 2) } /^n/ { if (index(substr($0, 2), p) == 1) print pid }'
          } | sort -u | grep -v "^$$\$" || true)"
  if [ -n "$pids" ]; then
    # shellcheck disable=SC2086
    kill -9 $pids 2>/dev/null || true
  fi
  chmod -R u+w "$WORKTMP" 2>/dev/null || true
  rm -rf "$WORKTMP"
  [ ! -e "$WORKTMP" ]
}

arm_on_signal() {
  CANCELLED=1
  # Durable cancellation also covers fork -> Python handler installation.
  [ -z "$RESULT" ] || : > "$RESULT/cancel.request"
  if [ -n "$CAPPED_PID" ] && [ -e "$RESULT/capped.ready" ]; then
    kill -TERM "$CAPPED_PID" 2>/dev/null || true
  fi
}

arm_on_exit() {
  local rc=$?
  if [ -n "$CAPPED_PID" ] && kill -0 "$CAPPED_PID" 2>/dev/null; then
    kill -TERM "$CAPPED_PID" 2>/dev/null || true
    wait "$CAPPED_PID" 2>/dev/null || true
  fi
  arm_stop_proxy
  if declare -F arm_collect_evidence >/dev/null; then arm_collect_evidence || true; fi
  local deleted=true
  arm_delete_tmp || deleted=false
  if [ "$FINALIZED" != 1 ] && [ -n "$RESULT" ] && [ -d "$RESULT" ]; then
    arm_meta "status=runner-error" "runner_exit=$rc" "tmp_deleted=$deleted" "end=$(arm_now)" || true
  fi
}

# arm_prepare: fresh temp dir with only the arm-facing inputs. Sets WORK, WORKTMP, RESULT,
# AGENT_TMP, AGENT_HOME; starts the egress proxy. On any abort here, nothing partial is credited.
arm_prepare() {
  local tmp_root="${ARM_TMP_ROOT:-/private/var/tmp/bb}"
  mkdir -p "$tmp_root"

  RESULT="$RESULTS_ROOT/$ARM-$ATTEMPT"
  if [ -e "$RESULT" ]; then
    echo "refusing: $RESULT already exists (attempt ids are single-use)" >&2
    RESULT=""
    exit 3
  fi
  local f
  if [ -n "$TASK_DIR" ]; then
    # Refuse before anything is created: the staged task must match its pinned manifest exactly.
    "$PY" "$ARM_LIB/armlib.py" verify-task "$TASK_DIR" "$TASK_MANIFEST_SHA" \
      || { echo "refusing: staged task $TASK_ID failed manifest verification" >&2; RESULT=""; exit 3; }
  else
    for f in $DATA_FILES; do
      [ -f "$DATA_DIR/$f" ] || { echo "missing arm-facing data file: $DATA_DIR/$f" >&2; exit 3; }
    done
    [ -f "$PKG/task/TASK.md" ] || { echo "missing task/TASK.md" >&2; exit 3; }
  fi
  mkdir -p "$RESULT"
  trap arm_on_exit EXIT
  trap arm_on_signal INT TERM HUP
  arm_meta "arm=$ARM" "attempt=$ATTEMPT" "dry_run=$([ "$DRY_RUN" = 1 ] && echo true || echo false)" \
    "status=preparing" "data_dir=$([ -n "$TASK_DIR" ] && echo "$TASK_DIR/data" || echo "$DATA_DIR")" \
    "wall_cap_ms=$CAP_MS"
  if [ -n "$TASK_DIR" ]; then
    arm_meta "task_id=$TASK_ID" "task_dir=$TASK_DIR" "task_manifest_sha256=$TASK_MANIFEST_SHA"
  fi

  WORKTMP="$(mktemp -d "${tmp_root%/}/$TMP_PREFIX.XXXXXXXX")" || exit 4
  WORKTMP="$(cd "$WORKTMP" && pwd -P)"
  printf '%s\n' "$$" > "$WORKTMP/runner.pid"   # so a later sweep can tell a live run from a leaked one
  arm_meta "worktmp=$WORKTMP" "runner_pid=$$"
  WORK="$WORKTMP/work"
  AGENT_TMP="$WORKTMP/t"
  AGENT_HOME="$WORKTMP/home"
  mkdir -p "$WORK/data" "$AGENT_TMP" "$AGENT_HOME"
  if [ -n "$TASK_DIR" ]; then
    # Copy TASK.md + data/* and re-verify the copies (closes the verify-then-copy window).
    "$PY" "$ARM_LIB/armlib.py" copy-task "$TASK_DIR" "$TASK_MANIFEST_SHA" "$WORK" \
      || { echo "refusing: staged task copy failed manifest verification" >&2; exit 4; }
  else
    for f in $DATA_FILES; do
      cp -c "$DATA_DIR/$f" "$WORK/data/$f" 2>/dev/null || cp "$DATA_DIR/$f" "$WORK/data/$f" || exit 4
      chmod a-w "$WORK/data/$f"
    done
  fi
  if [ -n "$TASK_DIR" ]; then
    :   # TASK.md came from the staged task above.
  elif [ "$ARM" = omerta ] && [ "${BIO_LIVE_ARMC:-0}" = 1 ]; then
    cp "$PKG/test/fixtures/armc-smoke/TASK.md" "$WORK/TASK.md"
    arm_meta_add 'fixture=synthetic-armc-smoke' 'benchmark_eligible=false'
  else
    cp "$PKG/task/TASK.md" "$WORK/TASK.md"
  fi
  cp "$ARM_LIB/ENVIRONMENT.md" "$WORK/ENVIRONMENT.md"
  arm_setup_env || { echo "analysis environment setup failed" >&2; exit 5; }
  printf '%s\n' "$PROMPT_TEXT" > "$RESULT/prompt.txt"
  "$PY" "$ARM_LIB/armlib.py" hash-tree "$WORK" "$RESULT/inputs.sha256"
  arm_meta "task_sha256=$(shasum -a 256 "$WORK/TASK.md" | cut -d' ' -f1)" "worktmp=$WORKTMP"

  arm_start_proxy
  # Test seam: a bounded window during which an operator cancel can arrive mid-preparation. Short
  # sleeps so the deferred signal trap runs between them and the window ends as soon as it fires.
  if [ -n "${ARM_PREPARE_PAUSE_MS:-}" ]; then
    local waited=0
    while [ "$waited" -lt "$ARM_PREPARE_PAUSE_MS" ] && [ "$CANCELLED" != 1 ]; do
      sleep 0.05; waited=$((waited + 50))
    done
  fi
}

# A loopback CONNECT proxy that only tunnels to the arm's model API; the seatbelt denies every
# other outbound. Fail closed: if the proxy will not start, the run aborts before the agent.
arm_start_proxy() {
  local allow="${ARM_PROXY_ALLOW:-localhost}"
  "$PY" "$ARM_LIB/egress_proxy.py" --allow "$allow" --log "$RESULT/proxy.log" \
    --port 0 --portfile "$WORKTMP/proxy.port" >"$WORKTMP/proxy.stdout" 2>>"$RESULT/proxy.log" &
  PROXY_PID=$!
  arm_meta "proxy_pid=$PROXY_PID"
  local i
  for i in $(seq 1 250); do
    [ -s "$WORKTMP/proxy.port" ] && break
    kill -0 "$PROXY_PID" 2>/dev/null || { echo "egress proxy failed to start" >&2; exit 5; }
    sleep 0.02
  done
  PROXY_PORT="$(cat "$WORKTMP/proxy.port" 2>/dev/null || true)"
  [ -n "$PROXY_PORT" ] || { echo "egress proxy produced no port" >&2; exit 5; }
  arm_meta_add "egress_allow=$allow" "egress_proxy=127.0.0.1:$PROXY_PORT"
}

# Abort cleanly if the operator cancelled during preparation, BEFORE launching the agent.
arm_abort_if_cancelled() {
  [ "$CANCELLED" = 1 ] || return 0
  arm_stop_proxy
  local deleted=true
  arm_delete_tmp || deleted=false
  arm_meta "status=cancelled" "end=$(arm_now)" "agent_exit=null" "cancelled_before_agent=true" \
    "tmp_deleted=$deleted"
  FINALIZED=1
  trap - EXIT INT TERM HUP
  echo "result: $RESULT (cancelled before agent started, tmp deleted: $deleted)"
  exit 130
}

# A fresh pixi env inside the temp dir, installed from the committed lock (offline-capable from
# the package cache). env.sh is a static activation script the agent sources.
arm_setup_env() {
  if [ "${ARM_SKIP_ENV:-0}" = 1 ]; then
    printf '# test stub: no analysis env\nexport OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1\n' > "$WORK/env.sh"
    return 0
  fi
  local pixi_bin
  pixi_bin="$(command -v pixi)" || return 1
  mkdir -p "$WORK/env"
  cp "$PKG/pixi.toml" "$PKG/pixi.lock" "$WORK/env/"
  (cd "$WORK/env" && "$pixi_bin" install --frozen >"$RESULT/env_install.log" 2>&1) || return 1
  "$PY" "$ARM_LIB/armlib.py" env-sh "$WORK/env/pixi.toml" "$WORK/env.sh" 2>>"$RESULT/env_install.log" || return 1
  # The env must work from a strict-mode script in a clean shell (as run_all.sh will be run).
  (cd "$WORK" && env -i HOME="$HOME" PATH=/usr/bin:/bin bash -c \
    'set -euo pipefail; source ./env.sh; Rscript -e "suppressPackageStartupMessages(library(survival))"; python -c "import lifelines"' \
    >>"$RESULT/env_install.log" 2>&1) || return 1
  "$pixi_bin" --version >> "$RESULT/env_install.log" 2>&1 || true
}

# The scrubbed environment the agent runs in: start from nothing, hand it only what it needs.
# Nothing from this (orchestrating) shell leaks in -- no CLAUDE_CODE_*, no secrets on the env.
arm_agent_env() {
  local proxy="http://127.0.0.1:$PROXY_PORT"
  AGENT_ENV=(
    "HOME=$AGENT_HOME" "TMPDIR=$AGENT_TMP" "PATH=/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
    "USER=${USER:-arm}" "LOGNAME=${LOGNAME:-${USER:-arm}}" "LANG=en_US.UTF-8" "TERM=dumb"
    "HTTPS_PROXY=$proxy" "HTTP_PROXY=$proxy" "https_proxy=$proxy" "http_proxy=$proxy"
    "ALL_PROXY=$proxy"
  )
  AGENT_ENV+=(${AGENT_ENV_EXTRA[@]+"${AGENT_ENV_EXTRA[@]}"})
  # Dry-run only: the echo agent's mode is a test control, so forward it past the env scrub.
  if [ "${DRY_RUN:-0}" = 1 ] && [ -n "${ECHO_AGENT_MODE:-}" ]; then
    AGENT_ENV+=("ECHO_AGENT_MODE=$ECHO_AGENT_MODE")
  fi
}

# arm_run CMD...: run the agent in $WORK under the cap, in a scrubbed env, optionally inside the
# OS seatbelt. Sets AGENT_RC, START, END.
arm_run() {
  arm_abort_if_cancelled
  if [ "${ARM_FAULT_AT:-}" = before-agent ]; then arm_on_signal; fi
  arm_abort_if_cancelled
  arm_agent_env
  local wrapped=(/usr/bin/env -i "${AGENT_ENV[@]}")
  if [ -n "$ARM_SANDBOX_PROFILE" ]; then
    wrapped+=(/usr/bin/sandbox-exec -f "$ARM_SANDBOX_PROFILE")
    arm_meta_add "os_seatbelt=$ARM_SANDBOX_PROFILE"
  else
    arm_meta_add "os_seatbelt=none"
  fi
  wrapped+=("$@")

  # Under the OS seatbelt (Codex) the agent may only write inside its temp tree, and even inherited
  # fds pointing at a denied path are refused (Node aborts); so its stdout/stderr/status go into the
  # temp tree and are copied to $RESULT after the run. With no seatbelt (Claude) they go straight to
  # $RESULT so the operator-cancel path can watch the live marker.
  local outdir="$RESULT"
  [ -n "$ARM_SANDBOX_PROFILE" ] && outdir="$WORKTMP"

  START="$(arm_now)"
  arm_meta_add "start=$START" "command=$(arm_json_array "$@")" "wrapped_command=$(arm_json_array "${wrapped[@]}")"
  "$PY" "$ARM_LIB/run_capped.py" --cap-ms "$CAP_MS" --grace-ms "${ARM_GRACE_MS:-5000}" \
    --cwd "$WORK" --stdout "$outdir/transcript.jsonl" --stderr "$outdir/stderr.log" \
    --status "$outdir/run_status.json" --control "$RESULT" -- "${wrapped[@]}" &
  CAPPED_PID=$!
  [ "${ARM_FAULT_AT:-}" != after-pid ] || arm_on_signal
  arm_meta "status=running" "capped_pid=$CAPPED_PID"
  : > "$RESULT/launch.ready"
  AGENT_RC=0
  while :; do
    wait "$CAPPED_PID"
    AGENT_RC=$?
    if kill -0 "$CAPPED_PID" 2>/dev/null; then continue; fi
    break
  done
  CAPPED_PID=""
  END="$(arm_now)"
  arm_stop_proxy
  if [ "$outdir" != "$RESULT" ]; then
    local f
    for f in transcript.jsonl stderr.log run_status.json; do
      [ -f "$outdir/$f" ] && cp "$outdir/$f" "$RESULT/$f" 2>/dev/null || true
    done
  fi
}

# arm_finish: collect outputs, delete the temp dir, audit the transcript, write final meta.
# Fail closed: if collection fails the run is NOT reported as finished, and the exit code is
# non-zero. Exit 0 only when the agent exited 0, outputs were collected, and the temp dir is gone.
arm_finish() {
  local modified collected=true
  modified="$("$PY" "$ARM_LIB/armlib.py" finish "$WORK" "$RESULT" "${ARM_COLLECT_LIMIT_MB:-50}")" \
    || { collected=false; modified=unknown; }
  # Transcript audit: did the agent touch a sealed path, the key, the repo or the data store?
  local contaminated
  contaminated="$("$PY" "$ARM_LIB/armlib.py" audit "$RESULT/transcript.jsonl" "$WORKTMP" "$PKG" "$HOME" \
                  2>/dev/null || echo audit-error)"
  local deleted=true
  arm_delete_tmp || deleted=false
  local status=finished
  [ "$collected" = true ] || status=collect-failed
  [ "$CANCELLED" = 1 ] && status=cancelled
  grep -q '"timed_out": true' "$RESULT/run_status.json" 2>/dev/null && status=timed-out
  [ "$AGENT_RC" = 0 ] || [ "$status" != finished ] || status=agent-error
  if [ "$ARM" = claude ] && [ "$status" = finished ]; then
    grep -q '"baseline_tools_check": "pass"' "$RESULT/meta.json" || status=tool-policy-failed
  fi
  arm_meta "status=$status" "end=$END" "agent_exit=$AGENT_RC" "data_modified=$modified" \
    "collected=$collected" "contaminated=$contaminated" \
    "tmp_deleted=$deleted" "run_status=$(cat "$RESULT/run_status.json" 2>/dev/null || echo null)"
  FINALIZED=1
  trap - EXIT INT TERM HUP
  echo "result: $RESULT ($status, agent exit $AGENT_RC, tmp deleted: $deleted, contaminated: $contaminated)"
  [ "$deleted" = true ] || exit 6
  [ "$collected" = true ] || exit 6
  [ "$status" = finished ] || exit 1
  exit 0
}
