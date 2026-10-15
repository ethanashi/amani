# Root validation, round 3

Root `pnpm typecheck` passed. Both owned package suites passed under Node 24 and
`nice -n 10`, within ten seconds each. See `validation.json` for final timings.

Root `nice -n 10 pnpm test` was attempted after checking that INTEGRATING was absent
and the machine was quiet (10 logical CPUs, load 3.22, CPU idle 63.10%). It failed:

- 6,451 tests passed, 2 failed, 15 skipped; 365 files passed, 2 failed, 7 skipped.
- Runtime: 158.52 seconds. This exceeds the contract's root runtime budget; no
  root-suite success or root runtime compliance is claimed.
- `bio-replicator/test/integration.test.ts`: the fake Codex exact-prompt test returned
  cleanup status `unproven` and verdict `failed` instead of `observed-clean`/`agrees`.
- `bio-tasks/test/test_recovery.py`: `test_drive_kills_real_backend_at_host_tool_log_boundary`
  failed `valid_receipt(r)` at line 172, under the root Python-suite wrapper.
- Vitest also reported an unhandled worker RPC timeout calling `onTaskUpdate`.

The two failing tests were rerun individually after the root run finished. The
replicator test passed (one test, 0.704-second Vitest run; the four filtered tests
were not run). The Python recovery test passed (one test, 0.058 seconds). These
isolated passes do not turn the failed root run into a pass or account for its
worker timeout. Neither package imports the changed report code. Their sources
were not edited: they are outside this worktree builder's write authorization.

All temporary validation logs were removed after recording these results. No
process was killed by name or pattern, and no task-created external temporary
file was retained. Test fixtures manage their own temporary directories.
