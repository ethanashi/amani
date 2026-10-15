# Getting started

Amani is an early public release. It runs from a clone, from the command line, on macOS. This page covers
requirements, install, tests, a first investigation, where the outputs appear and the certification
launcher. For what Amani is, start with the [README](../README.md).

## Requirements

- **macOS on Apple silicon.** The sandbox is macOS Seatbelt and the analysis environment is pinned to
  `osx-arm64`. A Linux backend is planned, not built.
- **Node 24** (`.nvmrc` says `24`) and **pnpm 11** (`packageManager` is `pnpm@11.4.0`). `node` must be
  Node 24 on your `PATH`; the repository uses Node's built-in `node:sqlite` and type stripping.
- **pixi**, which installs the pinned R (4.4 or newer) and Python 3.13 analysis environment from
  `packages/bio-baseline/pixi.toml` (single-threaded OpenBLAS, for reproducible numbers).
- **For real-model investigations only:** a logged-in [Codex CLI](https://github.com/openai/codex)
  and/or [Claude Code](https://claude.com/claude-code). The Claude adapter checks that the CLI is the
  pinned version (`2.1.296`, see `PINNED_CLAUDE_VERSION` in `packages/omb-adapters/src/claude-settings.ts`).
  Point `OMB_CLAUDE_CLI` at a Claude Code binary of that version. Point `OMB_CODEX_CLI` at your Codex
  binary if it is not at `/opt/homebrew/bin/codex`. `OMB_CODEX_MODEL` overrides the default Codex model.
  Multi-provider support (OpenRouter, OpenCode, API keys) is in development; see
  [providers.md](providers.md).

The machine can be shared. Run heavy commands under `nice -n 10`, and check `uptime` before long runs:
the scheduler refuses to admit new workers above a load ceiling (default 9, set by `OMB_LOAD_CEILING`).

## Install

```sh
git clone https://github.com/ethanashi/amani.git
cd amani

# Node 24 must come first on PATH. With Homebrew:
export PATH=/opt/homebrew/opt/node@24/bin:$PATH
node --version        # v24.x

pnpm install --frozen-lockfile
pixi install --frozen --manifest-path packages/bio-baseline/pixi.toml
pixi install --frozen --manifest-path packages/omb-investigate/format-runtime/pixi.toml
```

The first `pixi install` downloads the analysis environment, about 1.3 GB (it took about 15 minutes on a
slow connection); later installs reuse the cache and take seconds. The repository is private while it is
a preview, so cloning needs a GitHub account with access.

## Check the install

```sh
# Typecheck every package
pnpm typecheck

# A fast subset of the tests: the claim gauntlet, the data contract and the statistical
# procedures. About 1,000 tests; around half a minute.
nice -n 10 pnpm exec vitest run packages/omb-gauntlet packages/omb-contract packages/omb-procedures --maxWorkers=2
```

Run a single package with `pnpm exec vitest run packages/<name>`. The pixi Python suites are wrapped
in Vitest tests, and you can run the `bio-tasks` Python suite directly:

```sh
packages/bio-baseline/.pixi/envs/default/bin/python packages/bio-tasks/test/run.py [test_module ...]
```

**Not every test can pass from a clean clone.** Some Python tests need private host-side material that
is deliberately not in the repository (the sealing key and cached benchmark datasets under
`~/.omerta-bio/`). Without it they fail as "not verified", never as a silent pass. A missing pixi
environment is also a failure, not a skip. Do not read this as a regression. See
[validation.md](validation.md#what-a-clean-clone-can-and-cannot-run).

## A first synthetic investigation

Both commands build a small **synthetic** sealed benchmark card, serve it to Amani as an analyst would
receive it, run Amani on it and grade the result with the host-side grader. No real data is used.

**1. Plumbing check (no models, a few seconds).** It uses fake, unavailable workers, so the run parks
after staging and planning. It exercises staging, parking, the report writer and the grader. The expected
result is a valid report with `"verdict": "fail"`, `"status": "paused"` and `"passed": 0`. Fake workers
can never earn scientific credit.

```sh
pnpm --dir packages/omb-amani test:oneshot
```

**2. A real run (about 15 minutes, uses your model allowance).** This runs all phases with your
logged-in CLIs through all twelve phases: question, stage, plan, plan-lock, code, dry-run, freeze, look,
certify, replicate, interpret and deliverable. Codex leads; Claude Code does the replication and the
methods review. On the maintainer's machine it finished in about 15 minutes with `"verdict": "pass"`,
`"status": "complete"` and 5 of 5 criteria passed.

```sh
OMB_LIVE=1 nice -n 10 packages/bio-baseline/.pixi/envs/default/bin/python -B \
  packages/omb-amani/test/oneshot-e2e.py --live --full --keep
```

`--live` requires `OMB_LIVE=1` explicitly. Without `--full` the run uses a three-minute plumbing cap
instead of 75 minutes. Add `--case gwas` for the GWAS-shaped synthetic case. If you set
`AMANI_QUOTA_SCRIPT` to an executable that exits non-zero when your model allowance is too low, the run
refuses to start in that case. The script also refuses to start while another live smoke is running.

### Where outputs appear

Each command prints one line of JSON (report validity, verdict, criteria and how many passed, run status,
wall time, phases reached). With `--keep` (or `AMANI_KEEP=1`), these are kept under
`packages/omb-amani/.live-runs/<UTC time>/`:

- `analysts/served/`: the card exactly as the analyst received it (`TASK.md`, `data/`,
  `DATA-CONTRACT.json`, `manifest.json`);
- `analysts/result/report.json`: the report. Software wrote its numbers, statuses and labels;
- `analysts/result/amani-run.json`: completeness, investigation ID, timing, parks, labels and the source
  of every field;
- `analysts/result/.amani/`: the private host evidence (journal, store, frozen code, outputs). Keep it
  private;
- `diagnostics.json`: a trusted-side summary.

Synthetic sealing keys and fixtures are always deleted. Without `--keep` nothing is retained.

## Running Amani on a task directory

The `amani` command runs one investigation over a **served task directory** (`TASK.md`, `data/`,
`DATA-CONTRACT.json`, `manifest.json`):

```sh
OMB_LIVE=1 nice -n 10 node --experimental-transform-types --no-warnings \
  packages/omb-amani/src/cli.ts run \
  --task /absolute/path/to/served-card --out /absolute/path/to/new-attempt \
  --mode card --cap-minutes 75
```

`--out` must be empty and separate from the task. Without `OMB_LIVE=1` the workers are fake and the
result is marked simulated and incomplete. The served-card format and the host-side one-shot harness
that builds cards are described in
[`packages/bio-tasks/oneshot/README.md`](../packages/bio-tasks/oneshot/README.md) and
[`packages/omb-amani/README.md`](../packages/omb-amani/README.md). A friendlier entry point for your
own questions is part of the Studio work.

Host-side state (sealing keys, cached datasets, benchmark grading roots) lives outside the repository
under `~/.omerta-bio/`, the project's earlier name; a later pass will rename it. Keep it out of every
analyst-visible directory.

## Certification launcher (OS-account separation)

Confirmed requires that the checker's records and the analyst's code belong to different operating-system
accounts. The OS-user launcher provides that: the store and seal key belong to a service account
(`_ombcert`), and worker code runs as another (`_ombrun`), reached through exact `sudo` delegation. Without
it, runs complete but every claim is capped at Tentative.

> **Not in this snapshot.** The launcher (`packages/omb-launcher`) is built on its own branch and has not
> been merged into the snapshot published here. The steps below are taken from that build's scripts and
> notes so you know what the install involves. **Installing it needs `sudo`, which only the machine's
> owner should run.** Read the scripts first: they are short and written to be audited.

1. **Build the release as your normal user (never as root).** It is about 2 GB, built into a new, empty,
   absolute staging directory, and the build is reproducible. `check-reproducible-release.sh` builds
   twice and compares the manifest hash.

   ```sh
   packages/omb-launcher/scripts/build-release.sh /absolute/path/to/new-staging-dir
   ```

2. **Record three hashes:** `staging-dir/MANIFEST`, `scripts/install-launcher.sh` and
   `scripts/install-release.pl`.

3. **Install as root, from a separate administrator account.** An interactive shell that an agent can
   write to is not a safe place to type `sudo`: its shell files can shadow it. Use Fast User Switching to
   a separate admin account. The installer's three files are copied into a root-owned temporary
   directory and checked against the hashes from step 2, then the installer runs:

   ```sh
   sudo /bin/sh <root-owned-temp>/install-launcher.sh <absolute-staging-dir> <root-owned-temp>/MANIFEST <manifest-sha256>
   ```

   It installs the content-addressed release under `/usr/local/libexec/omb`, the authority data under
   `/var/db/omb-authority`, and a sudoers drop-in under `/etc/sudoers.d`, which it validates with
   `visudo`. It stops with exit code 77 unless it is running as root. Afterwards run `/usr/bin/sudo -k`
   and log out of the admin account.

4. **Verify the install as your normal user**, with the expected manifest hash:

   ```sh
   sh packages/omb-launcher/scripts/verify-install.sh <manifest-sha256>
   ```

5. **Uninstall** (as root) with `scripts/uninstall-launcher.sh`. It removes the sudoers delegation and the
   release. It leaves the authority data and the service users in place for inspection.

Details, the line-by-line sudoers rationale and what the launcher does not defend against (a compromised
OS, root, or an owner who installs a malicious release) are in that package's `BUILD-NOTES.md`.
