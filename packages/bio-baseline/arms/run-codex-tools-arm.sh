#!/usr/bin/env bash
# Block 10 arm runner (arm B): plain `codex exec` PLUS the Omerta Bio tool pack, no web access.
#
#   TOOLPACK_PROFILE=checks|full bash arms/run-codex-tools-arm.sh <attempt-id> [run-codex-arm.sh options]
#
# This file is run-codex-arm.sh line for line (same model, effort, CLI flags, OS seatbelt, egress
# proxy, caps, prompt, cleanup) plus the blocks marked ">>> tools-arm". Those blocks only:
#   * check the tool pack sources against packages/bio-toolpack/toolpack.lock.json (profile
#     `checks` by default; an unknown profile is refused) before anything is created;
#   * append the one fixed sentence in packages/bio-toolpack/prompt-sentence.txt to the prompt;
#   * build the pinned bundle into $WORKTMP/toolpack (inside the seatbelt's allowed tree, outside
#     the work dir), verify its tree hash independently, and copy its TOOLS.md into the work dir;
#   * put $WORKTMP/toolpack/bin first on the agent's PATH (profile `full` also sets OMB_PYTHON to
#     the work dir's analysis environment); and record profile, hashes and post-run integrity.
# packages/bio-toolpack/test/runner.test.ts fails if any other line differs from run-codex-arm.sh.
set -u -o pipefail
ARM=codex-tools
ARM_PROXY_ALLOW="${CODEX_PROXY_ALLOW:-chatgpt.com,openai.com}"
# >>> tools-arm: shared supervised lease, with the hyphenated arm-name finalizer
if [ "${BIO_OPERATION:-}" != arm ]; then
  exec "${ARM_PYTHON:-python3}" "$(cd "$(dirname "$0")/../../bio-toolpack/scripts" && pwd -P)/supervise.py" arm -- bash "$0" "$@"
fi
# <<< tools-arm
# shellcheck source=lib/common.sh
. "$(cd "$(dirname "$0")" && pwd -P)/lib/common.sh"
arm_parse_args "$@"
# >>> tools-arm: profile, source pin and prompt sentence (refused before anything is created)
TOOLPACK_PKG="$(cd "$PKG/../bio-toolpack" && pwd -P)"
TOOLPACK_NODE=/opt/homebrew/opt/node@24/bin/node
TOOLPACK_PROFILE="${TOOLPACK_PROFILE:-checks}"
case "$TOOLPACK_PROFILE" in
  checks|full) ;;
  *) echo "refusing: unknown tool pack profile '$TOOLPACK_PROFILE' (checks|full)" >&2; exit 2 ;;
esac
[ -x "$TOOLPACK_NODE" ] || { echo "refusing: pinned node missing: $TOOLPACK_NODE" >&2; exit 5; }
"$TOOLPACK_NODE" "$TOOLPACK_PKG/src/build.ts" check --profile "$TOOLPACK_PROFILE" >/dev/null \
  || { echo "refusing: tool pack sources do not match the pinned hash (profile $TOOLPACK_PROFILE)" >&2; exit 3; }
PROMPT_TEXT="$PROMPT_TEXT $(cat "$TOOLPACK_PKG/prompt-sentence.txt")"
# <<< tools-arm
arm_prepare
# >>> tools-arm: install the pinned tool pack (outside the work dir) and TOOLS.md (inside it)
toolpack_refuse() { arm_meta "toolpack_check=refused" "toolpack_refusal=$1"; echo "refusing: $1" >&2; exit 5; }
TOOLPACK_DIR="$WORKTMP/toolpack"
"$TOOLPACK_NODE" "$TOOLPACK_PKG/src/build.ts" build --profile "$TOOLPACK_PROFILE" --out "$TOOLPACK_DIR" >/dev/null \
  || toolpack_refuse "tool pack build does not match the pinned hash"
TOOLPACK_SHA="$("$PY" "$TOOLPACK_PKG/scripts/verify_toolpack.py" "$TOOLPACK_DIR" "$TOOLPACK_PROFILE")" \
  || toolpack_refuse "installed tool pack failed independent hash verification"
{ cp "$TOOLPACK_DIR/TOOLS.md" "$WORK/TOOLS.md" && chmod a-w "$WORK/TOOLS.md"; } || toolpack_refuse "cannot place TOOLS.md"
"$PY" "$ARM_LIB/armlib.py" hash-tree "$WORK" "$RESULT/inputs.sha256"
arm_meta "toolpack_check=verified" "toolpack_profile=$TOOLPACK_PROFILE" "toolpack_sha256=$TOOLPACK_SHA" \
  "tools_md_sha256=$(shasum -a 256 "$WORK/TOOLS.md" | cut -d' ' -f1)" "toolpack_node=$TOOLPACK_NODE" \
  "toolpack_node_version=$("$TOOLPACK_NODE" --version)" "prompt_tools_sentence=$(cat "$TOOLPACK_PKG/prompt-sentence.txt")"
# <<< tools-arm

# Throwaway CODEX_HOME; the auth file is linked in read-only so the authenticated CLI can start.
mkdir -p "$AGENT_HOME/.codex"
[ -f "$HOME/.codex/auth.json" ] && ln -sfn "$HOME/.codex/auth.json" "$AGENT_HOME/.codex/auth.json"

# OS seatbelt: deny reads of the real home and the broad temp/volume roots; allow back only the
# arm's own temp tree (built in arm_prepare) and the one auth file Codex must read.
DENY="/private/var/tmp/bb:/private/var/tmp/biobase-arms:$HOME:/private/tmp:/private/var/folders:/var/folders:/Volumes:/Users/Shared"
READ_BACK="$HOME/.codex/auth.json"
ARM_SANDBOX_PROFILE="$WORKTMP/arm.sb"
"$PY" "$ARM_LIB/armlib.py" sandbox-profile "$WORKTMP" "$PROXY_PORT" "$ARM_SANDBOX_PROFILE" "$DENY" "$READ_BACK"
cp "$ARM_SANDBOX_PROFILE" "$RESULT/arm.sb"

AGENT_ENV_EXTRA=("CODEX_HOME=$AGENT_HOME/.codex")
# >>> tools-arm: the tool pack first on PATH; the rest of PATH exactly as common.sh sets it
AGENT_ENV_EXTRA+=("PATH=$TOOLPACK_DIR/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin")
[ "$TOOLPACK_PROFILE" != full ] || AGENT_ENV_EXTRA+=("OMB_PYTHON=$WORK/env/.pixi/envs/default/bin/python")
# <<< tools-arm

CODEX_BIN="${CODEX_BIN:-$(command -v codex || true)}"
MODEL="${CODEX_ARM_MODEL:-gpt-6-astra}"
EFFORT="${CODEX_ARM_EFFORT:-high}"
# Codex's own sandbox cannot nest inside ours, so it is bypassed; OUR seatbelt is the containment.
REAL_CMD=("$CODEX_BIN" exec
  --ignore-user-config --ignore-rules --skip-git-repo-check --json --color never
  -m "$MODEL" -c "model_reasoning_effort=\"$EFFORT\""
  --dangerously-bypass-approvals-and-sandbox
  -c 'web_search="disabled"'
  --disable browser_use --disable browser_use_external --disable in_app_browser
  --disable computer_use --disable apps --disable plugins --disable remote_plugin
  --disable multi_agent --disable multi_agent_v2 --disable agent_message_board
  --disable hooks --disable in_app_local_automation --disable artifact --disable goals
  --disable tool_suggest --enable skip_host_skill_discovery
  --disable image_generation --disable skill_mcp_dependency_install
  -C "$WORK" -o "$WORKTMP/final_message.md"
  "$PROMPT_TEXT")

arm_abort_if_cancelled

if [ "$DRY_RUN" = 1 ]; then
  # The echo agent is a repo file; copy it into the allowed temp tree so it runs under the seatbelt.
  # ARM_DRY_AGENT (dry-run only): a test-supplied stand-in agent script instead of the echo agent.
  cp "${ARM_DRY_AGENT:-$ARM_LIB/echo-agent.sh}" "$WORKTMP/echo-agent.sh"
  [ -z "${ARM_DRY_AGENT:-}" ] || arm_meta_add "dry_agent=$ARM_DRY_AGENT"
  arm_meta_add "model=echo-agent" "effort=n/a" "cli_version=echo-agent" \
    "real_command=$(arm_json_array "${REAL_CMD[@]}")"
  arm_run bash "$WORKTMP/echo-agent.sh" "$PROMPT_TEXT"
else
  [ -x "$CODEX_BIN" ] || { echo "codex CLI not found" >&2; exit 5; }
  arm_abort_if_cancelled
  CLI_VERSION="$("$CODEX_BIN" --version 2>/dev/null | head -1)"
  arm_abort_if_cancelled
  arm_meta_add "model=$MODEL" "effort=$EFFORT" "cli_version=$CLI_VERSION"
  arm_run "${REAL_CMD[@]}"
fi
# Codex's -o target is inside the (writable) temp tree; bring it out before the temp dir is deleted.
[ -f "$WORKTMP/final_message.md" ] && cp "$WORKTMP/final_message.md" "$RESULT/final_message.md" || true
# Preserve observed model/effort receipts before arm_finish deletes the throwaway home.
if [ "$DRY_RUN" != 1 ]; then
  "$PY" "$PKG/../bio-tasks/pilot/codex_identity.py" "$AGENT_HOME/.codex" \
    "$RESULT/transcript.jsonl" "$RESULT/meta.json"
fi
# >>> tools-arm: was the tool pack intact when the agent finished? (recorded, not enforced)
if "$PY" "$TOOLPACK_PKG/scripts/verify_toolpack.py" "$TOOLPACK_DIR" "$TOOLPACK_PROFILE" >/dev/null 2>&1; then
  arm_meta_add "toolpack_intact_after_run=true"
else
  arm_meta_add "toolpack_intact_after_run=false"
fi
# <<< tools-arm
arm_finish
