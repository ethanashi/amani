# README verification record

Source base: `c08c03a341b44a352a90aa83a6f2a84d89886bab`. <!-- Source: git rev-parse HEAD before the documentation commit. -->

Checks ran in a newly created isolated checkout. This record describes observed scope and failures; it is not a release receipt or a claim of full-suite success. Dependency/build outputs and preview tooling remain outside the committed documentation.

| Check | Outcome |
|---|---|
| Pinned dependency install | Passed with the manifest-pinned pnpm, using the required Node runtime. |
| `pnpm typecheck` | Passed. |
| `pnpm exec vitest run packages/omb-contract --maxWorkers=2` | 692 tests passed across 10 files; no failures. <!-- Source: packages/omb-contract/test/; captured Vitest summary from this command. --> |

This was a focused offline check. The full integration suite, native analysis environment, live providers, OS-account launcher, publication pipeline and real paper generation were not run. Historical integration and evaluation figures in the README remain attributed to their original repository records. The Studio image is copied byte-for-byte from the fixture screenshot into an asset path retained by the public export policy.

## Owner review revision — 2026-10-15

Rechecked main at `c08c03a341b44a352a90aa83a6f2a84d89886bab`, whose parent is `058cf48cfaccee45f50e2758a237763289a721fb`. The permitted integration report and summary record three consecutive reference runs, each with 22 complete-correct results and two scientific abstentions. The report's receipt is for `058cf48c`; the owner confirms the result and CI status on integrated main. The successor changes publication-audit tooling only. The receipt itself was not opened. README wording uses “publication audit pending” and marks both live-model gauntlet and comparative race as in progress, per owner review.

Copied `paper-layout-sample-01.png` from the permitted paper outputs into `assets/paper-tutorial-page-1.png`. The page explicitly identifies itself as a synthetic tutorial using synthetic records and fixture prose. Its SHA-256 is `610eb956adb8070622cea9500d7b774e544b2972c5df34d0b826efa1372ce893`; the committed copy matches the source bytes.

This follow-up changes documentation and, for Amani, a synthetic example image. Previous executable-check results above are retained as the initial validation record; no model session or release pipeline was rerun. Updated README links, content, diagrams and preview layouts are checked separately in `_logs/readme-previews/`.
