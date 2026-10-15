# Recovery harness

`run-task.sh p16-recovery <codex|claude|omerta> <attempt>` dispatches to the
local recovery adapters, which source the unchanged baseline `common.sh`.
Re-execution still uses baseline `grade.py`.

The controller interrupts at the first observed tool event or output-file write
(for the host arm, its trusted authority tool-audit log is the progress marker),
SIGKILLs and reaps the process session, and resumes within the original monotonic
deadline. Startup, capture, cleanup and resume all consume that budget. This
intentionally replaces the contract's half-cap trigger, per the defect-fix design
instruction: a generous cap must not disqualify efficient agents.

A first phase that exits 0 before the trigger is `not-exercised` only if it actually
completed: `WORK/results.json` passes the task's public schema and `REPORT.md` and
`run_all.sh` are present (regular, non-empty files). The receipt records `first_exit`
and `completed`. A zero-exit early exit without those deliverables is an ordinary
failed (unverified) attempt that counts in the denominator, as is an early crash,
unavailable session, failed resume, expired deadline, missing evidence, or integrity error.

For a not-exercised attempt the runner returns nonzero, retains a bound receipt, and
cleans up. Every grading path (`grade-task.sh`, `python -m biotasks grade`, and
`python -m biotasks.recovery_grade`) runs the same implementation in
`lib/biotasks/recovery_grade.py` with the shared `recovery.excluded_candidate`
predicate. It re-verifies the collected deliverables, input provenance, untouched
data and absence of contamination, and re-runs `run_all.sh` in grade.py's sandbox.
Only when that exits 0 and reproduces the claimed results does it report
`excluded: true`, `rerun_required: true`, and null task/science scores; otherwise
the attempt is graded as an ordinary failure. The p16 `check.py` refuses (nonzero,
no verdict file) for an exclusion candidate, so a not-exercised attempt never
becomes a recovery or science verdict. The pilot operator must rerun with a new
attempt ID; no model calls or automatic retry loop are hidden in grading.

- Codex resumes only the emitted `thread.started` ID. All explicit configuration
  and model flags are retained; user configuration/rules remain disabled.
- Claude resumes only the emitted init ID, with the original restricted settings.
  Project/local setting sources are disabled as well.
- Arm C re-enters the same host investigation. Its verified journal must contain
  an interrupted step, unique events/records and no contradictory active claims.

Codex's profile and Claude's settings are generated under RESULT, outside the
worker write root, made read-only, and hashed before phase one. Each launch checks
those hashes and the launch command. Codex runs under the pinned profile; Claude
retains its per-command sandbox. The recorded `os_seatbelt` describes the child,
even though the controller itself needs host access.

Both stdout and stderr travel through pipes to the controller. Only the controller
writes phase logs under RESULT; workers never receive writable file descriptors
for these logs. Captured-byte hashes are checked before session-ID extraction,
resume, and transcript publication. Phase-one logs become read-only after reaping.
Changed configuration or audit bytes refuse phase two. Claude's result directory
is explicitly denied for both native tools and its Bash sandbox.

Receipts bind attempt ID, requested model, cap, arm/resume mode, and the exact audit
transcript hash. Metadata pins the receipt hash. Host collection may replace host
stdout with an artifact-derived worker transcript only with verified host evidence;
the original host stdout must still match its controller hash. Grading checks the
binding before granting recovery credit. Calibration fixtures are explicitly tagged
and accepted only inside the private calibration scratch path without a rerun;
normal attempt grading refuses them.

Known limitation (Codex): `codex exec resume` replays the rollout under
`CODEX_HOME/sessions`, and `CODEX_HOME` lives in the worker's own temp tree. Codex's
sandbox is bypassed because it cannot nest inside the OS seatbelt, so the model's
shell commands share the seatbelt's write scope with the CLI that must write that
rollout. A phase-one worker can therefore edit the conversation history its own
resumed session sees. Hashing the rollout before resume would not detect this,
because the edit happens before the host can snapshot it. Moving it outside the write
root would stop the CLI from recording it. This does not reach host-owned evidence:
the receipt, phase logs, profile and grading inputs stay outside the write root and
are hashed, and credit still requires reproduced, correct, unique records. It does
mean resume fidelity is not proven against an adversarial worker.

Tests inject clocks and faults at exact boundaries, exercise `drive` with the real
process backend, attempt actual seatbelt writes to host files, and inject config/log
rewrites before resume. A model-free test runs the controller CLI with a stand-in
Claude: the stream-json session ID resumes with `--resume`, and a settings rewrite
refuses phase two. Fake-arm harness tests cover a successful early completion
excluded on every grading path, an early exit without deliverables, and a candidate
whose sandboxed re-run fails. They also check provenance, secret-free output and
cleanup. Native live model resume, Claude's own sandbox and live host recovery remain
unverified; these tests make no claim that a live model was resumed.
