# Controller is unsandboxed; only its children run inside the pinned containment.
arm_recovery_run() {
  local saved_profile="$ARM_SANDBOX_PROFILE"
  local recovery_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
  local sandbox_args=() protected_args=() file
  [ -z "$saved_profile" ] || sandbox_args=(--sandbox "$saved_profile")
  for file in ${RECOVERY_PROTECTED[@]+"${RECOVERY_PROTECTED[@]}"}; do protected_args+=(--protected "$file"); done
  ARM_SANDBOX_PROFILE=""
  arm_run "$PY" "$recovery_dir/recovery.py" --arm "$ARM" --cap-ms "$CAP_MS" \
    --work "$WORK" --logs "$RESULT/recovery-logs" --receipt "$RESULT/recovery.json" --meta "$RESULT/meta.json" \
    ${sandbox_args[@]+"${sandbox_args[@]}"} ${protected_args[@]+"${protected_args[@]}"} -- "$@"
  ARM_SANDBOX_PROFILE="$saved_profile"
  arm_meta_add "os_seatbelt=${saved_profile:-claude-per-command}" 'recovery_controller=host-owned'
}
recovery_finalize() {
  local recovery_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
  "$PY" "$recovery_dir/recovery.py" finalize "$RESULT" || AGENT_RC=7
}
