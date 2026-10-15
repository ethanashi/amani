#!/usr/bin/env bash
# Block 0 arm runner: plain `claude -p` on the arm-facing METABRIC copy, no web access.
#
#   bash arms/run-claude-arm.sh <attempt-id> [--dry-run] [--cap-sec 5400] [--data-dir DIR]
#
# Model: the CLI default (no --model) unless CLAUDE_ARM_MODEL is set. "Plain" means no user
# settings, plugins, hooks or MCP servers (--setting-sources "" in an empty work dir,
# a throwaway HOME and CLAUDE_CONFIG_DIR, --strict-mcp-config with no servers).
#
# Containment (layers, so no single mechanism is load-bearing):
#  * Claude's own sandbox: Bash runs sandboxed with an empty strict network allowlist and no
#    unsandboxed escape; the repo, dataset store and secrets are deny-read; WebSearch/WebFetch
#    denied. (Verified live: a probe asking it to curl/read sealed paths is blocked -- BUILD-NOTES.)
#  * Scrubbed environment + throwaway HOME: nothing from the launching shell leaks in; writes to
#    "home" land in the temp dir, not the real home.
#  * Egress proxy: every outbound is forced through a loopback proxy that only tunnels to the
#    Anthropic API, and is logged.
#  * Encryption at rest supplements containment; historical git objects may still hold plaintext.
#  * Post-run transcript audit: any reference to a sealed path marks the attempt CONTAMINATED.
# We do NOT also wrap Claude in an OS seatbelt: that would nest inside Claude's own per-command
# seatbelt and make it refuse to run Bash. Codex, whose sandbox cannot deny reads, is wrapped.
# --dry-run swaps the agent for arms/lib/echo-agent.sh (no model call).
set -u -o pipefail
ARM=claude
ARM_PROXY_ALLOW="${CLAUDE_PROXY_ALLOW:-anthropic.com,claude.ai}"
# shellcheck source=lib/common.sh
. "$(cd "$(dirname "$0")/../../../bio-baseline/arms/lib" && pwd -P)/common.sh"
. "$(cd "$(dirname "$0")" && pwd -P)/recovery-common.sh"
arm_parse_args "$@"
arm_prepare

# Empty configuration HOME; CLI authentication uses the login keychain. The real
# keychain remains beneath the home deny root for agent file and Bash tools.
mkdir -p "$AGENT_HOME/Library"
[ ! -d "$HOME/Library/Keychains" ] || ln -s "$HOME/Library/Keychains" "$AGENT_HOME/Library/Keychains"
SETTINGS="$RESULT/claude-settings.json"
"$PY" "$ARM_LIB/armlib.py" claude-settings "$WORKTMP" "$HOME" "$SETTINGS"
"$PY" - "$SETTINGS" "$RESULT" <<'PYSETTINGS'
import json,sys
from pathlib import Path
p=Path(sys.argv[1]);s=json.loads(p.read_text());root=sys.argv[2]
for field in ('denyRead','denyWrite'): s['sandbox']['filesystem'][field].append(root)
s['permissions']['deny'] += [f'{tool}(/{root}/**)' for tool in ('Read','Edit','Write','NotebookEdit')]
p.write_text(json.dumps(s))
PYSETTINGS
chmod 400 "$SETTINGS"
RECOVERY_PROTECTED=("$SETTINGS")

CLAUDE_BIN="${CLAUDE_BIN:-$(command -v claude || true)}"
EXTRA=()
[ -n "${CLAUDE_ARM_MODEL:-}" ] && EXTRA+=(--model "$CLAUDE_ARM_MODEL")
[ -n "${CLAUDE_ARM_EFFORT:-}" ] && EXTRA+=(--effort "$CLAUDE_ARM_EFFORT")
REAL_CMD=("$CLAUDE_BIN" -p "$PROMPT_TEXT"
  --output-format stream-json --verbose
  --permission-mode default --permission-prompts none
  --restricted --tools "Bash,Read,Write,Edit,Glob,Grep,NotebookEdit"
  --no-chrome --disable-slash-commands
  --setting-sources ""
  --settings "$SETTINGS"
  --strict-mcp-config --mcp-config '{"mcpServers":{}}'
  --disallowedTools "WebSearch,WebFetch,Task,Agent,SendMessage,Workflow,Skill,RemoteTrigger,CronCreate,CronDelete,CronList,ScheduleWakeup,EnterWorktree,ExitWorktree,Monitor,PushNotification,Artifact*,mcp__*"
  ${EXTRA[@]+"${EXTRA[@]}"})

AGENT_ENV_EXTRA=(
  "CLAUDE_CODE_TMPDIR=${AGENT_TMP#/private}"
  "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1" "DISABLE_AUTOUPDATER=1"
)
ARM_SANDBOX_PROFILE=""   # Claude keeps its own per-command seatbelt; do not nest.

arm_abort_if_cancelled

if [ "$DRY_RUN" = 1 ]; then
  # ARM_DRY_AGENT (dry-run only): a test-supplied stand-in agent script instead of the echo agent.
  cp "${ARM_DRY_AGENT:-$ARM_LIB/echo-agent.sh}" "$WORKTMP/echo-agent.sh"
  [ -z "${ARM_DRY_AGENT:-}" ] || arm_meta_add "dry_agent=$ARM_DRY_AGENT"
  arm_meta_add "model=echo-agent" "effort=n/a" "cli_version=echo-agent" \
    "real_command=$(arm_json_array "${REAL_CMD[@]}")"
  arm_recovery_run bash "$WORKTMP/echo-agent.sh" "$PROMPT_TEXT"
else
  [ -x "$CLAUDE_BIN" ] || { echo "claude CLI not found" >&2; exit 5; }
  arm_abort_if_cancelled
  CLI_VERSION="$("$CLAUDE_BIN" --version 2>/dev/null | head -1)"
  arm_abort_if_cancelled
  arm_meta_add "model=${CLAUDE_ARM_MODEL:-cli-default}" "effort=${CLAUDE_ARM_EFFORT:-cli-default}" \
    "cli_version=$CLI_VERSION"
  arm_recovery_run "${REAL_CMD[@]}"
fi

# Final message + init event (actual model id, tool list, MCP servers) -> meta.no_web_check.
"$PY" "$ARM_LIB/armlib.py" final-claude "$RESULT/transcript.jsonl" "$RESULT/final_message.md" || true
recovery_finalize
arm_finish
