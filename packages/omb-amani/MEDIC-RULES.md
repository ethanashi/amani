# Amani medic rules — v3

The medic repairs plumbing. It cannot change the scientific protocol or improve a result.
A scientific abstention, failed assumption, insufficient evidence, refutation or null result
never authorizes a medic. Hard stops and look-ledger refusals require the owner.

1. Reproduce the host-recorded failure on the supplied practice/synthetic reproduction.
   Never read an official attempt, real data, outputs, prompts, cassettes, credentials or keys.
   A raw dev-fork of an official attempt is NOT a safe medic input: it copies served data.
2. Write the smallest plumbing repair and a NEW regression test. Never delete, skip, weaken
   or replace existing tests, checks or thresholds. Leave the patch for host staging; do not commit or push.
3. Only `packages/omb-amani/src/transport/checkpoint-io.ts` and new
   `packages/omb-amani/test/medic-regression-*.test.ts` are eligible for automatic repair.
   Everything else requires owner review. In particular, referee/certification, procedures and
   decision rules, blinding/leak guards, plan lock/look accounting, labels, integrity binding,
   classifiers, medic gates/policy and this file are protected. The allowlist is deliberately
   narrower than all possible plumbing; being a plausible plumbing fix grants no exception.
   The registered API is `persistCheckpoint(write: () => void): void`, with no imports or
   executable dependencies. Its parsed executable grammar permits the original callback
   and the bounded ENOSPC retry only. New transport files, type-only protected references,
   reexports, side effects, global/prototype writes and control bypasses require owner review.
   New regressions may import only Vitest and that adapter; lexical checks warn about
   loader internals and global mutation, but are not a security grammar. Arbitrary future plumbing mechanisms are not auto-approved.
4. All gates are required: the same failing reproduction must fail before and pass after the
   patch; every touched package suite; a configured gauntlet regression subset (reference/fake
   by default); typecheck; and a read-only Claude Sonnet 5.5 review against these rules.
   The agent runs the reproduction and new regression tests; the host then executes every
   authored regressions in their own disposable process, then each authoritative gate
   in a fresh process with base-commit tests and configuration against the patched source. Agent assertions, process exit alone
   for a replay, missing receipts and skipped host gates fail.
5. At most two attempts per investigation and one per phase, counted durably before dispatch.
   Any refusal, exhausted limit, unsafe reproduction, missing isolation or failed gate creates
   a needs-you item with the full host report. No automatic broadening of the allowlist.
6. Resume the SAME investigation and chain with unchanged plan, served data, frozen analysis,
   practice data, environment, sandbox and model routing. Record old/new commits, diff digest,
   failure, gate receipts and reviewer verdict in a hash-chained code-version-changed event.
7. Never invalidate completed steps or reset ledger, scheduler, refusal or appeal budgets.
   An existing successful look is reused. A look may reuse its existing receipt only with
   a durable host receipt recording zero output files AND a null outputs hash, plus
   worker-not-started or a clean census-fault receipt. The shared permanent investigate
   guard checks the execution/retry, spent and unspent boundaries. Contradictory receipts
   and missing fields are spent; a failed receipt write cannot authorize another look.
   An ambiguous interrupted execution stays charged; missing files alone prove nothing.
8. After any possible real-data exposure, all medic diagnostics are closed host categories,
   never error text, output, model prose or transcripts. Tests use practice/synthetic data only.
   A resumed repair is a `protocol-deviation: mid-run code change after exposure`; the paper
   must disclose it. The deviation never changes claim labels or certification requirements.
9. Retain a sanitized failure signature and reproduction recipe for card-factory variants and
   keep the patch as a pending permanent fix for ordinary review. Never merge or push it.
   The factory imports the sanitized failure JSON PATH via `factory/loop.py --from-failure`;
   only registered synthetic mechanisms are allowed, never raw checkpoints or official data.
10. A real run never requires or automatically runs a rehearsal. The stand-in generator is
    an optional development utility only. The medic is temporary scaffolding, disabled by
    default; only an explicit development opt-in may activate it.

Implementation and acceptance evidence, including limitations, live in BUILD-NOTES.md.

## Development switch and stability criterion

The medic is OFF by default. `AMANI_MEDIC=1 amani-dev run ...` (or the development
`src/cli.ts`) and explicit engine config `medic: true` request this temporary facility.
Every executable entry uses `medic-authorization.ts`; direct runtime/protocol calls need
the same authorization. The ordinary `amani` bin is the release launcher. `AMANI_MEDIC_INJECT=write:disk-full` additionally
injects the registered synthetic checkpoint fault at dry-run start; it has no effect
when the medic is off. Production, any truthy CI setting (including `CI=1`, `CI=yes`, `GITHUB_ACTIONS`,
GitLab, Buildkite, Azure, Jenkins, TeamCity and other recognized CI markers), Electron,
and release/desktop/GitHub launcher identities fail closed even with explicit config.
`src/release-cli.ts` is the standalone release entry and has no repair dispatch.
Desktop has its own packager and bridge; it must apply the same exclusion manifest and
unconditional desktop launcher marker. No GitHub release workflow is currently tracked;
launcher identity tests alone are not evidence of an integrated GitHub release pipeline.
Build with `node packages/omb-amani/scripts/build-release.mjs REPO NEW_OUTPUT_DIR`.
The artifact excludes `src/medic/`, removes the engine import seam and replaces the CLI
with the release entry. The artifact test exercises direct config and CLI attempts.
`medic-history.ts` retains only read-only historical readers, with no repair imports.

`amani medic-stats` reads host-owned `.amani-medic/records/` (override with
`AMANI_MEDIC_STATS_DIR` for a shared development campaign). Each invocation, including
refusals, writes a durable invocation/heal record before dispatch; accepted patches get
an additional healed record. Every finished enabled run records its outcome, and a
completed run with zero invocations additionally records `no-heal`. An unfinished,
failed, or healed run breaks the streak. Counts distinguish invocations by class from
successful repairs. These records contain identifiers, commits and closed fault classes,
never real-data outputs. They are host records, not model-writable claims.

The release target is about **50 consecutive enabled runs without a heal**, across
varied development cards **and real problems**, with **zero open permanent-fix items**.
A count alone does not prove workload diversity. Then remove the medic.
After ordinary human review and merge of an exact repair (or equivalent cherry-pick),
record `amani medic-resolve --heal ID --commit MERGED_COMMIT --review-reference URL`.
The host verifies ancestry and patch equality; the owner supplies the normal review
reference. Cross-family medic approval alone does not close a permanent-fix item.

## Removing the medic

1. Remove the marked temporary development `if` block in `src/engine.ts`. The default
   `create(); return await execute(() => inv.run())` path remains unchanged. Remove the
   `medic` engine config field and its `AMANI_MEDIC` assignment in `src/run.ts`.
2. Delete `src/medic/` and `src/medic-authorization.ts`, its `test/medic-*.test.ts` and `test/medic-mutations.py`, the
   mutation receipt (preserve/rename permanent regression tests FIRST), and the medic-specific parking test at the end of `test/run.test.ts`.
   Remove development CLI dispatches for `medic-resolve`, `dev-stand-in`, and the
   `dev-replay --medic-practice` route. Ordinary dev-fork/dev-replay and the read-only `medic-stats`/`medic-history.ts` remain intact.
   Remove the development bin and release-builder seam stripping once the seam is deleted;
   keep the release artifact exclusion test. Remove authorization imports/calls from run,
   engine and the development CLI as part of removing the capability.
3. Archive `.amani-medic` records, pending branches, failure signatures and owner reports.
   Keep reviewed permanent transport fixes and regression tests (rename any
   `medic-regression-*` tests before removing medic tests). No pending fix may be discarded.
4. Historical `medicHeals` sidecar fields, hash-chained code-change events, retained
   `needs-medic` artifacts and paper disclosure readers remain readable. Keep the
   investigator/paper writer disclosure code: removing repair capability cannot erase
   deviations in historical evidence. Keep the generic `io.persist` adapter and its
   ordinary transport import: reviewed permanent checkpoint fixes must still operate
   when the medic is disabled or removed. Only the medic swaps that adapter mid-run.
5. Remove development switches from local launch environments. Run Amani, investigate,
   certify and paper suites and typecheck with Node 24. No release or desktop build may
   package or enable the removed runtime; confirm a cold real run has no prerequisites.

The default native gauntlet regression subset is the deterministic decision, labels and
gates suites in `packages/omb-gauntlet/test/` (62 checks); `nativePorts.gauntletFiles`
configures the host-owned selection. This gate is distinct from the live c01 development
card demonstration. Gate output must be complete and containment successful even on a
zero exit. Before/after replay logs are retained separately. Completed results never
inherit a historical pause's classification.


## Recorded development validation

The 2026-10-14 c01 live demonstration healed an injected pre-look checkpoint fault and
completed with audit grade 3/3. The exact timeline, patch, gates, reviewer scope and resume
identity checks are in [integration/medic-live-c01.json](integration/medic-live-c01.json)
and [BUILD-NOTES.md](BUILD-NOTES.md). The owner-requested reviewed repair `7c766048` was cherry-picked as `f2bd7cdd` on
`build/medic-fix1`; `checkpoint-enospc.test.ts` is permanent and survives medic removal.
The equivalent `b0ccf40e` was not merged. Historical external stability records were not
rewritten by this source-code repair.
This single card does not satisfy full gauntlet coverage or the release stability target.
The currently registered automatic repair mechanism is checkpoint I/O; other plumbing
faults remain parked for owner escalation until a safe synthetic reproduction is registered.
Persistent storage failures still escalate. Durable checkpoints support audit and safe
parking; automatic continuation currently keeps the same live process and memory-only
authority, and does not escrow that authority for unattended restart recovery.

## Threat model, executable provenance and process isolation

The medic's author (our own Codex agent) is **fallible, not adversarial**. We do not
attempt to prove arbitrary JavaScript safe by expanding a static grammar. The guarantee
is structural:

1. Only allow-listed plumbing files and new regression paths may change. Existing path,
   diff, protected-test and dependency checks stay. The single registered checkpoint API
   still has no imports; its two explicit implementations are a bounded API contract,
   not a general JavaScript grammar. Expanding this API requires ordinary owner review.
2. Authored regressions execute in their own disposable process, pristine environment,
   private dependency copy, HOME and scratch. They may damage their own process. No global,
   Vitest loader mutation, generated file or module cache is reused by a gate or resume.
   Seatbelt prevents writes outside that disposable tree and protects committed inputs.
3. Every protected suite, typecheck, replay and gauntlet invocation gets a fresh archive
   of the **base commit's** files and test configuration, overlaid only with the accepted
   checkpoint adapter. Neither new nor previously accepted `medic-regression-*` test files, nor authored configuration, are loaded
   by those gates. Regression-only files are added exclusively to their separate runner.
   Each tree is destroyed after its process and descendants have been reaped. The base
   commit and accepted identity are recorded in gate receipts. Missing isolation fails.
   Trusted base tests run without an outer Seatbelt sandbox so their native worker probes
   can establish their own sandboxes (macOS disallows nesting). Source files, Git metadata
   and installed JavaScript dependencies are sealed with user immutable flags before launch;
   those flags are removed only during host cleanup after all descendants are reaped.
   Authored regressions always use Seatbelt; they never reach the trusted test process.
4. The host commits the inspected patch and creates a clean accepted checkout. The reviewed
   SHA-256 binds the diff, complete committed source and installed JavaScript runtime bytes.
   Links, untracked executable dependencies and imports outside the registered API refuse.
   Identities are rechecked between gates, after review and immediately before loading.
   Resume evaluates only the exact revalidated adapter bytes in a fresh context with no
   module resolution, scratch search paths or shared module cache. The Node loader hash
   check is defense in depth; it does **not** intercept Vitest's transformed importer.
5. Cross-family review, post-exposure deviation disclosure and ordinary review-and-merge
   for permanent fixes remain mandatory. A passing authored test never substitutes for
   a protected gate, review, successful callback or recorded evidence.

Cheap lexical rejections cover `__vite_ssr_import__`, `__defineGetter__`,
`__defineSetter__`, `__proto__`, and `globalThis` writes as early warnings. The real pipeline
regressions deliberately bypass those warnings to run QA's importer and JSON getter
payloads: mutations can occur inside the disposable regression process, while the next
base gate and the resumed adapter remain pristine. This is containment of fallible tests,
not a claim of a sandbox secure against an actively hostile author or OS/runtime exploit.

The 2026-10-14 fix-first follow-up uses synthetic tests and mocked model/reviewer ports
only. It does not call Claude, launch a live investigation or replace the independent
review requirement for future automatic repairs. See BUILD-NOTES.md for exact evidence.

Second-pass acceptance evidence (2026-10-14, executable source `3dfaf873`): the real
base-owned native gates passed **1,908 package tests** (7 opt-in skips), typecheck and
**62 gauntlet checks**. **42 medic and 6 permanent look mutants** were killed. Both QA
payloads and a Reflect global mutation were contained even when lexical warnings were
bypassed in the test harness. Full native synthetic heals exercised successful resume
and post-gate byte substitution refusal; no model or live run was started. Studio's
actual packager excludes all 14 current repair-runtime files and the engine seam;
both native and bridge launch boundaries force the desktop marker. Its 16 unit tests
pass. See [integration/medic-review2-validation.json](integration/medic-review2-validation.json)
for exact receipts, commits and scope. This does not establish the live stability target.
