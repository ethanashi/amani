# Amani Studio

Tauri 2 desktop workspace connected to the real investigation engine. Production never falls back to fixtures. See [BUILD-NOTES.md](BUILD-NOTES.md) for evidence and limits and [engine/CONTRACT.md](engine/CONTRACT.md) for the presentation adapter.

Use Node 24. From this directory:

```sh
export PATH=/opt/homebrew/opt/node@24/bin:$PATH
pnpm dev                  # real engine; starting research can invoke configured models
pnpm typecheck
pnpm test                 # offline unit/service/lifetime tests
pnpm test:e2e             # explicit screenshot fixture, 200-record regression
pnpm test:e2e:real         # real service with offline provider/executor/certifier doubles
```

The desktop launches a Node stdio bridge to an engine owner over a private Unix socket, with no TCP engine listener. The engine owns ongoing investigations after the window closes, and automatically exits when all clients have detached and work has settled. Reopening attaches to the same owner. After an actual engine crash, journals are recovered and interrupted investigations require explicit resume. Never blindly repeat a mutation whose connection failed.

Durable state defaults to `~/.omerta-bio/studio`. Providers use `~/.omerta-bio/config/providers.json`; only Keychain references go in that file. Secrets are written by a dedicated native command to service `amani`. Tests use separate worktree-local `.runtime` roots and fake secrets. `AMANI_ENGINE_ROOT` and `AMANI_PROVIDERS_CONFIG` override these paths for isolated validation. `AMANI_ENGINE_ENTRY` is an explicit stdio adapter override, never a fallback. `AMANI_DAEMON_ENTRY` selects an explicit test owner; the fake owner source is not shipped.

The Paper tab previews and downloads hash-verified engine reports and paper inputs. This merged engine does not include the manuscript renderer/endorsement pipeline. It cannot produce PDF/Word/arXiv manuscripts or accept endorsement; Studio does not invent those outputs. Amendment requests are durable owner-authored inbox drafts, never automatic changes to accepted results. Scientific contract checks occur in the engine; the New Investigation file check only pins selected bytes for staging.

For a local release, install the frozen analysis environment and pinned OpenCode runtime first:

```sh
pixi install --frozen --offline --manifest-path ../../packages/bio-baseline/pixi.toml
(cd ../../.tools/opencode && npm ci --offline --ignore-scripts --no-audit --no-fund)
python3 scripts/prepare-runtime.py  # only if a verified standalone Node is not already available
node scripts/release.mjs
```

The builder stops below 50 GiB free. It bundles Node and the engine's source/assets, and records absolute host-owned paths to this worktree's locked Python/R environment and hash-pinned OpenCode executable. Those installations, Codex/Claude sign-ins, the native compiler and certification launcher remain local prerequisites. The delivered app is intentionally local, not a portable distribution. No analysis environment or GPL R runtime is bundled. The app is ad-hoc signed, not notarized. Build output first appears under `src-tauri/target/release/bundle/macos/`; the retained artifact is `release/Amani Studio.app`.

Native compilation defaults to two jobs. `CARGO_BUILD_JOBS` may select another
positive integer; it does not change the 50 GiB free-space requirement.

Container and statistical formats also require the pinned host codec environment
at `packages/omb-investigate/format-runtime/.pixi/envs/default`. Set
`AMANI_CODEC_RUNTIME` when packaging to select a durable installation with the
same `pixi.lock` and `pixi.toml`. Packaging records that canonical host path and
the interpreter hash; the engine verifies the shipped and external pins and
interpreter bytes before using it. Codec dependencies stay outside the app.

Keyboard: ⌘K commands; N new investigation; J/K or arrow keys in lists; G then B/I/N/S navigation. Window geometry/diagnostics remain in `.runtime/` for this local build. Engine preferences persist with the workspace; scheduler resource limits are read-only.

Native window/startup state lives under the engine workspace in `desktop/`, so a built app survives deletion of its build checkout. Native diagnostic scripts explicitly set `AMANI_STUDIO_RUNTIME` to their local `.runtime` directory.
