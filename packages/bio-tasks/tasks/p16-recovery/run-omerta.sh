#!/usr/bin/env bash
# Same Block 0 inputs, exclusive operation lease, cap and cleanup as the plain arms.
# bash packages/bio-baseline/arms/run-omerta-arm.sh <attempt> [--cap-sec 5400]
set -u -o pipefail
ARM=omerta
ARM_PROXY_ALLOW="${CLAUDE_PROXY_ALLOW:-anthropic.com,claude.ai}"
. "$(cd "$(dirname "$0")/../../../bio-baseline/arms/lib" && pwd -P)/common.sh"
. "$(cd "$(dirname "$0")" && pwd -P)/recovery-common.sh"
arm_parse_args "$@"
if [ -n "$TASK_DIR" ]; then
  [ "${BIO_LIVE_ARMC:-0}" != 1 ] || { echo 'live arm C smoke refuses --task' >&2; exit 2; }
fi
if [ "${BIO_LIVE_ARMC:-0}" = 1 ]; then
  [ "$DRY_RUN" = 0 ] || { echo 'live arm C smoke refuses --dry-run' >&2; exit 2; }
  DATA_DIR="$PKG/test/fixtures/armc-smoke/data"
fi
# Fake hosts must be selected explicitly; --dry-run never calls a real agent.
NODE_BIN="$(command -v node)"
ADAPTER="$PKG/src/omerta-arm.ts"
HOST_CLI="$PKG/../bio-host/src/cli.ts"
if [ "$DRY_RUN" = 1 ]; then
  [ -n "${ARM_FAKE_HOST:-}" ] || { echo '--dry-run requires ARM_FAKE_HOST' >&2; exit 2; }
  [ -n "${CLAUDE_BIN:-}" ] && [ -x "$CLAUDE_BIN" ] || { echo '--dry-run requires an explicit fake CLAUDE_BIN' >&2; exit 2; }
  "$NODE_BIN" --input-type=module -e 'import {realpathSync} from "node:fs";
    const [fake, installed] = process.argv.slice(1);
    if (installed && realpathSync(fake) === realpathSync(installed)) process.exit(2);' \
    "$CLAUDE_BIN" "$(command -v claude || true)" || { echo '--dry-run refuses the installed claude CLI' >&2; exit 2; }
  HOST_CLI="$ARM_FAKE_HOST"
fi
arm_collect_evidence() {
  [ -n "$WORKTMP" ] && [ -f "$WORKTMP/investigation/investigation.json" ] || return 0
  "$NODE_BIN" "$ADAPTER" collect "$WORKTMP" "$RESULT"
}
arm_prepare
if [ "$DRY_RUN" != 1 ]; then
  case "$WORKTMP" in
    "$HOME"|"$HOME"/*) echo 'real investigations must live outside the denied home root' >&2; exit 5 ;;
  esac
fi
arm_abort_if_cancelled
MODEL="${CLAUDE_ARM_MODEL:-claude-opus-5-5}"
"$NODE_BIN" "$ADAPTER" prepare "$WORKTMP" "$HOME" "$MODEL" "$CAP_MS" "${BIO_LIVE_ARMC:-0}" "${TASK_DIR:+$TASK_DIR/manifest.json}" "$TASK_MANIFEST_SHA" "$TASK_ID" || exit 5
# Keep host state, worker scratch, auth HOME, and investigation under this one arm root.
mkdir -p "$AGENT_HOME/Library"
[ ! -d "$HOME/Library/Keychains" ] || ln -s "$HOME/Library/Keychains" "$AGENT_HOME/Library/Keychains"
CLAUDE_BIN="${CLAUDE_BIN:-$(command -v claude || true)}"
[ "$DRY_RUN" = 1 ] || [ -x "$CLAUDE_BIN" ] || { echo 'claude CLI not found' >&2; exit 5; }
AGENT_ENV_EXTRA=("OMERTA_BIO_HOME=$WORKTMP/state" "OMERTA_BIO_CLAUDE_BIN=$CLAUDE_BIN"
  "CLAUDE_CODE_TMPDIR=${AGENT_TMP#/private}" "CLAUDE_CONFIG_DIR=$AGENT_HOME/.claude"
  "PATH=$(dirname "$NODE_BIN"):/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
  "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1" "DISABLE_AUTOUPDATER=1")
# Current host spells auto-exploratory-or-refuse as 'auto'; it checks BOTH host intent and plan.
arm_meta_add "model=$MODEL" 'effort=host-default' "node_version=$($NODE_BIN --version)" \
  "host_cli_sha256=$(shasum -a 256 "$HOST_CLI" | cut -d' ' -f1)" \
  'network_mode=confirm' 'approval_policy=auto-exploratory-or-refuse'
arm_recovery_run "$NODE_BIN" "$HOST_CLI" investigate "$WORKTMP/investigation" --mode confirm --approve auto
arm_meta "host_cli_exit=$AGENT_RC"
arm_collect_evidence || { arm_meta 'host_evidence_complete=false' 'evidence_error=true'; AGENT_RC=6; }
# Missing receipts cannot make a successful CLI exit into a verified attempt.
grep -q '"host_evidence_complete": true' "$RESULT/meta.json" || AGENT_RC=6
recovery_finalize
arm_finish
