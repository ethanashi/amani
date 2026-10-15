# Amani arm adapter

Run a **served** card directory (TASK.md, data/, DATA-CONTRACT.json, manifest.json):

```sh
export PATH=/opt/homebrew/opt/node@24/bin:$PATH
OMB_LIVE=1 OMB_LOAD_CEILING=36 nice -n 10 node --experimental-transform-types --no-warnings \
  packages/omb-amani/src/cli.ts run \
  --task /absolute/path/to/served-card --out /absolute/path/to/new-attempt \
  --mode card --cap-minutes 75
```

The output must be empty and separate from the task. `report.json` is directly under the output
directory. `amani-run.json` records completeness, investigation ID, timing, parks, labels and
per-field evidence sources. `.amani/` retains the host journal, store, frozen code and outputs;
its grading root is private to this attempt. Mutable worker directories and credentials are
removed. Keep the host evidence directory private.

Released engines accept served tasks and output paths in user projects. Setting
`OMB_DEVELOPMENT=1` additionally restricts paths beneath `~/projects` to this
checkout or its sibling worktrees. Protected research and key directories remain
unavailable in both modes, including paths reached through symbolic links.

Codex defaults to `gpt-6-astra`; `OMB_CODEX_MODEL` overrides it. Existing `OMB_CODEX_CLI`,
`OMB_CLAUDE_CLI`, `OMB_CLAUDE_MODEL` and `BIO_SEALING_KEY` settings are honored. Without
`OMB_LIVE=1`, fake unavailable workers exercise staging/parking/report plumbing and the result
is marked simulated/incomplete. This mode never claims to have done scientific analysis.
Both modes use model-API-only worker networking; Codex web search is disabled by the existing
adapter. One call creates one V7 investigation. The wrapper bounds the entire engine process,
including provider waits and checker threads, with bio-core's recorded process-family runner.

For cards, the adapter checks the public contract envelope and manifest. Declared identifier
columns and matrix axes are used in synthetic staging. This is not K1 authentication: absent
contract gates remain unavailable. The final interpretation turn writes an evidence-reference
draft; software supplies the numbers and scientific labels. Frozen `outputs/task-results.json`
is also usable if interpretation parks. Missing fields stay missing/null and the attempt is
marked incomplete; no default zero can earn credit.

Use `--mode pilot` for a staged pilot task. Its grader-facing layout is
`OUT/workdir/results.json`, `run_all.sh`, `code/`, and `REPORT.md`, with metadata and input hashes
at `OUT`. The exported wrapper reruns frozen code and resolves numeric references from its new
outputs. Derived kernel metrics without an ordinary output mapping cannot be rerendered and
are noted. Pilot transcript provenance is not yet exported, so credited pilot grading is not
claimed. The completed registry entry is absent from the unchanged pilot plan; the dispatcher additionally requires
`OMB_AMANI_PILOT_ENABLED=1`. Native p16 recovery is not implemented.

Checks:

```sh
pnpm --dir packages/omb-amani test
pnpm --dir packages/omb-amani test:oneshot
```

The separate synthetic integration command builds and serves a tiny fixture with the actual
one-shot harness, runs fake V7 workers, and invokes `oneshot.sh grade --audit`. When this checkout
lacks the harness, it uses local Git snapshot `db6a40d` in a temporary overlay. It does not fetch
or touch any real sealed cards. Its Python scientific-stack cold import can exceed the fast
unit-suite budget. The historical snapshot has no uniform integrity section; a supplied JSON
template's integrity fields are preserved, but validation against the newer template is pending.

The opt-in synthetic live acceptance command checks quota and refuses while any live smoke is
running, before creating a fixture or spending model quota:

```sh
OMB_LIVE=1 OMB_LOAD_CEILING=36 nice -n 10 packages/bio-baseline/.pixi/envs/default/bin/python -B \
  packages/omb-amani/test/oneshot-e2e.py --live --full --keep
```

`--full` uses a 75 minute wall cap; omit it for the three-minute plumbing check. `--keep`
(or `AMANI_KEEP=1`) retains the served card, complete attempt, augmented prompts and
`diagnostics.json` in `.live-runs/<UTC stamp>/`. Synthetic sealed cases and fixture keys
are deleted. `AMANI_KEEP_DIAGNOSTICS=1` enables scratch retention for direct CLI runs;
adapter authentication/session state is always removed. Use a private output directory.

The coordinator must apply `integration/prelook-replan.patch` to omb-investigate at merge;
it is applied in this worktree for testing. It permits two audited replans before any
freeze/look, with the same investigation ID and look ledger.

`OMB_LOAD_CEILING` optionally sets the same scheduler admission ceiling as live-smoke's
`--load-ceiling`; the default remains 9. This changes resource admission only, not checker gates.

Current live acceptance: the first renewed full synthetic attempt passed **5/5**, completed all
12 phases in 613,378 ms, and needed no repairs or replans. See `integration/live-followup.json`.
The served metadata still does not authenticate K1; missing gates never count as passed.
