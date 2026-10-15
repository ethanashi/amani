# Off-record development replay

Use Node 24 from the repository root. No command below grades or submits a result.

```sh
export PATH=/opt/homebrew/opt/node@24/bin:$PATH
node --experimental-transform-types packages/omb-amani/src/cli.ts dev-fork \
  --from /path/to/attempt --at dry-run --out .replays/fix-check
node --experimental-transform-types packages/omb-amani/src/cli.ts dev-replay \
  --dir .replays/fix-check
```

`dev-fork` creates a **new** directory and investigation chain. `--at` accepts any
phase reached by the source: question, stage, plan, plan-lock, code, dry-run,
freeze, look, certify, replicate, interpret, deliverable. Only completed outputs
before that phase are seeded. Current host steps execute from that phase onward.
The original no-going-back state machine is unchanged. A nested fork uses the
retained phase's ledger receipts, so a future lock, freeze or look cannot leak
back into an earlier boundary.

The genesis links the source journal head, preceding phase hash, fork phase and
unique fork ID. Source SQLite databases use read-only `?immutable=1`; use saved,
checkpointed attempts. The source journal and phase chains are verified. Artifacts
are copied without following symlinks. Forks never mutate source attempts or
served data. Official/served/source destinations and existing output directories
are refused, including filesystem aliases. Each fork has `OFF-RECORD`, immutable
creation metadata, an off-record engine checkpoint, and marked deliverable
manifest/paper/report. There is no grading/submission operation and no official
`report.json` export: the result is an off-record envelope in `dev-result.json`.
One continuation is allowed per fork; make another fork for each experiment.

## Cassettes and divergence

For future source runs, set `AMANI_RECORD_TURNS=1` on the normal Amani run command.
This opt-in writes `host/cassette` and `host/dev-snapshots` beneath `.amani`.
Recording includes the enriched model prompt, family/model/effort/harness,
expected files, mounted content hashes, writable input files, session history,
adapter result and output files. Cassettes are keyed by canonical input hashes.
Only the attempt/task root prefixes are normalized; changed data, prompt, model,
worker files or session history are divergences. Binary files remain byte-exact.
Wall-clock timeout allowances are execution controls, not model-input keys.
Snapshots refuse symlinks and nonregular files and have a 64 MiB workdir limit;
recording failures are explicit. Mount hashing includes regular file contents.
Do not modify a runtime or attempt while recording/replaying it.

A hit restores the worker's saved files, returns its recorded adapter result, and
records the reused turn in the new fork. Host computation is never cached. The
default `--on-divergence stop` halts at the first missing or changed input and
reports turn, phase, job and changed fields. No model is called. Input/output hash
corruption is refused. Historical runs without full snapshots are explicit misses;
archived prompts alone do not establish a cassette hit.

```sh
node --experimental-transform-types packages/omb-amani/src/cli.ts dev-check \
  --from /path/to/attempt --at dry-run --out .replays/live-check \
  --on-divergence live --cap-minutes 20
```

`dev-check` combines fork and replay. `live` checks `_logs/codex-quota.sh` (repository
or worktree-parent `_logs`) before the first backend call and requires the live
HOME, USER and LOGNAME. It sets OMB_LIVE=1, gpt-6-astra and claude-sonnet-5-5.
Once an input diverges, all following turns use the configured live backends.
Imported adapter sessions are not resumed against source state: the first live
use starts a fresh session with the current prompt/files; later live sessions
belong to the fork. A private local execution root replaces BIO_GRADING_ROOT for
host sandbox plumbing; no grader is invoked. All temporary environment changes
are restored on return.

`--cassette /path/to/.amani/host/cassette` selects recordings from a previous
development continuation. This makes a legacy failure reusable after its first
live continuation. Otherwise the source attempt's recordings are used. Earlier
legacy plan boundaries seed the authoritative locked plan; a legacy dry-run
boundary uses candidate-0, never the source's final repaired workdir. Missing
later workdir snapshots are refused rather than guessed.

## Fault injection

Add one `--inject point:fault` to `dev-replay` or `dev-check`. Faults are host-owned
and recorded in the result. They do not really sign out, exhaust quota, fill disk,
or sleep indefinitely. Provider/stall faults emulate the adapter's terminal
refusal/watchdog boundary; malformed output is written to the expected worker
files; practice corruption reaches the real structure verifier; executor crash
reaches the existing host retry path; disk-full raises ENOSPC at a checkpoint.

| Injection | Test outcome | Mechanism |
|---|---|---|
| `practice:structure` | system-fault | Corrupt practice header; host verifier pauses before execution/look |
| `executor:crash` | recovered | One executor census crash, then ordinary host retry; one look |
| `worker:provider-refusal` | infra | Provider refusal before work |
| `worker:stall` | system-fault | Terminal no-progress watchdog event |
| `worker:malformed` | system-fault | Invalid required JSON, bounded normal repair/terminal handling |
| `worker:claude-signin` | infra | Claude authentication unavailable at its turn |
| `worker:quota` | infra | Provider quota refusal |
| `write:disk-full` | system-fault | Host checkpoint ENOSPC; native infrastructure pause |

Classification follows race/gauntlet's documented precedence. Native
`infrastructure` alone does not prove provider failure. Scientific abstention
requires completed certification, explicit scientific reasons and no result
issues. `recovered` means complete with no result issues; it does not assert a
grade. Thus a repaired practice step can coexist with an overall `system-fault`
when the saved scientific plan leaves required report fields unavailable.

## Card-factory hook

```ts
import { replayFailure } from './packages/omb-amani/src/dev-replay.ts';
const result = await replayFailure(
  { attemptDir: failure.attemptDir, phase: failure.phase },
  '.replays/unique-fix-check',
  { onDivergence: 'stop', cassette: previousCassetteDir },
);
// Consume result.status, phases, outcomeClass, faults, wallMs, cassette,
// issues and reportPath. The caller/orchestrator owns any off-record grading.
```

Run calls in separate processes when parallelizing: the engine temporarily sets
process environment variables. CLI errors exit 2; scientific terminals and
recorded divergences return a JSON result whose status must be checked.

## Card-1 evidence

Source: permitted race-tierb2-c01-amani attempt, pre-fix `look-withheld` (seven
failed dry runs, no look), 11 recorded worker calls; comparison wall time 18 min.

- First live continuation: `.replays/c01-live/dev-result.json`, 191.041 s,
  3 live backend calls, no cassette hits. The original run never reached those turns.
- Current-code cached continuation: `.replays/c01-final/dev-result.json`, 8.662 s,
  3 exact cassette hits, **zero** backend calls; all host phases reran. Another
  current-code sample took 5.848 s. Both passed practice on attempt 0 and reached
  dry-run → freeze → look → certify → replicate → interpret → deliverable.
- Nested look fork: `.replays/c01-look/dev-result.json`, 6.907 s, 3 hits, no calls.
- Default-stop proof: `.replays/c01-stop-final/dev-result.json`, 2.198 s, no calls;
  stopped at methods-validity in replicate because the legacy run has no cassette.
- All twelve phase boundaries were forked and inspected under `.replays/boundary-*`.

The saved plan lacks a certified procedure for the two required double-zero
counts. Both fields remain withheld and listed in `issues`; overall outcome is
therefore `system-fault`, despite execution status `complete` and successful
practice recovery. No grade was requested or run. Artifacts with card data remain
in ignored `.replays`; only timing/classification/test summaries are committed.

Validation: Node 24.19.0 package suites **803 passed / 5 skipped**; typecheck passed.
The single admitted root run had **8,234 passed / 20 skipped / 1 failed**. The
failure is the unchanged `omb-figures/test/determinism.test.ts` gallery snapshot:
`ae-funnel.svg` certificate/CSV metadata differs. No fixture was regenerated and
no root rerun was made. Full commands and admission/results are in
[integration/dev-replay-validation.json](integration/dev-replay-validation.json).
