## What and why

<!-- One or two sentences. Link the issue. -->

## Package(s) changed

## Checks run

- [ ] `pnpm typecheck`
- [ ] Tests for the changed package(s), e.g. `nice -n 10 pnpm exec vitest run packages/<name>`
- [ ] A regression test that I saw fail before the fix (for bug fixes)

## The checker

- [ ] This change does not make any gate easier to pass, let a model read a trusted path, add a hard stop, or let a missing check raise a label.
- [ ] If it touches the checker, I explain above why that is safe.

## Hygiene

- [ ] No secrets, keys, benchmark or held-out material, personal data or absolute home paths.
- [ ] Docs and the package's `BUILD-NOTES.md` are updated where behaviour changed.
- [ ] AI assistance used in this change is stated here: <!-- tool and what it did, or "none" -->

## Licence

- [ ] I have signed the contributor licence agreement (see CONTRIBUTING.md) and have the right to license this work.
