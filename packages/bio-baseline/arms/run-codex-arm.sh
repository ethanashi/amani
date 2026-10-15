#!/usr/bin/env bash
# Block 0 arm runner: plain `codex exec` on the arm-facing METABRIC copy, no web access.
#
#   bash arms/run-codex-arm.sh <attempt-id> [--dry-run] [--cap-sec 5400] [--data-dir DIR]
#
# Model gpt-6-astra, reasoning effort high (override: CODEX_ARM_MODEL / CODEX_ARM_EFFORT).
# "Plain" means: --ignore-user-config (no user config.toml, plugins, MCP servers or project
# trust), --ignore-rules (no user/project execpolicy .rules), a throwaway CODEX_HOME, and the
# browser/computer-use/apps/plugins/image features disabled.
#
# Containment: Codex's own sandbox only restricts writes and network, NOT reads -- a probe
# confirmed it could read the sealed answer and the clean data (BUILD-NOTES). So we do not rely on
# it. Instead the whole `codex` process runs inside an OS seatbelt (sandbox-exec) that denies
# reads, writes and network outside the work dir, and Codex's own (non-nestable) sandbox is
# bypassed. Network is allowed only to a loopback egress proxy that tunnels to the model API and
# logs every request. The scrubbed env + throwaway HOME, encryption at rest of the sealed
# artifacts, and the post-run transcript audit are the same as the Claude arm.
# --dry-run swaps the agent for arms/lib/echo-agent.sh (no model call).
set -u -o pipefail
ARM=codex
ARM_PROXY_ALLOW="${CODEX_PROXY_ALLOW:-chatgpt.com,openai.com}"
# shellcheck source=lib/common.sh
. "$(cd "$(dirname "$0")" && pwd -P)/lib/common.sh"
arm_parse_args "$@"
arm_prepare

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
arm_finish
