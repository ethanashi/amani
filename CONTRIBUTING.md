# Contributing to Amani

Start with a focused issue or patch. Explain the behavior you want to change and include the
relevant build and test results. Keep public test examples synthetic. Do not submit credentials,
private run logs, personal paths or sealed benchmark material. Keep copyright and license notices
with third-party code. Use GitHub issues or discussions for contribution and licensing enquiries.

## Contributor licence agreement (CLA), version 1

The project requires this agreement before accepting a contribution. It grants the project permission to distribute and relicense contributions; you retain ownership of your work.

By explicitly agreeing to this CLA for a contribution to Amani, you agree with Ethan Ashihundu (the Maintainer) that:

1. **Authority.** You created the contribution or have the legal right to submit it and grant these rights. If an employer or another party owns relevant rights, you have obtained their permission. You identify third-party material and its licence when submitting it.
2. **Copyright licence.** You grant the Maintainer and recipients of software distributed by the Maintainer a perpetual, worldwide, non-exclusive, royalty-free, irrevocable copyright licence to reproduce, prepare derivative works of, publicly display, publicly perform, distribute and sublicense your contribution. This includes distribution under the AGPL and under other open-source or proprietary licences.
3. **Patent licence.** You grant the same parties a perpetual, worldwide, non-exclusive, royalty-free patent licence to make, have made, use, offer to sell, sell, import and otherwise transfer the contribution, covering patent claims you can license that are necessarily infringed by your contribution alone or by its combination with the project to which it was submitted. If a recipient brings patent litigation alleging that your contribution infringes a patent, the patent licence granted to that recipient for the contribution terminates when that litigation is filed.
4. **No transfer or support obligation.** You keep ownership. You provide the contribution as-is, without warranties or a duty to provide support. This agreement does not grant rights in your trademarks or waive any rights that cannot legally be waived.
5. **Scope.** The agreement covers the contribution identified in your acceptance statement and subsequent contributions you explicitly identify as covered by this agreement. It does not change the licences of pre-existing third-party material.

In your pull request description or a signed contribution record, include:

> I agree to the Amani Contributor Licence Agreement, version 1, in CONTRIBUTING.md, and I have authority to submit this contribution under it.

State your contributor name or organization and the commits covered. Maintainers record acceptance before merging. A Git sign-off alone is not CLA acceptance. No external CLA service is configured in this local release candidate.

## Ground rules (from [`CONTRACT.md`](CONTRACT.md))

- **Stay in your package.** Change the package your issue is about; cross-package changes need a
  conversation first.
- **Tests are fast and deterministic.** Injected clocks, no sleep-and-hope, no network.
- **Every test cleans up after itself**, including processes, temporary directories and keys.
- **Fail closed.** A missing, skipped or unavailable check never counts as passed.
- **Strict TypeScript.** The workspace typechecks with `pnpm typecheck`.
- **Honest notes.** Each package keeps a `BUILD-NOTES.md` that maps each requirement to the test that
  covers it, and records failures and limitations, not only successes.
- **Fix with a failing test first.** Each fixed defect gets a regression test that you have seen fail
  before the fix.

## Do not weaken the checker

The point of the project is that the checker is hard to talk around. Pull requests that make a gate
easier to pass, add a hard stop, let a model see a trusted path, or let a missing check raise a label
will get close scrutiny. If you believe a rule is wrong, open an issue describing the case instead.

## Sealed material

Never add benchmark keys, held-out data, answer keys or sealed cards to a pull request, and never try to
read them. Tests that need them fail as "not verified" without them; that is intended.

## Setting up

See [`docs/getting-started.md`](docs/getting-started.md): Node 24, pnpm 11 and pixi, then
`pnpm install --frozen-lockfile`, `pnpm typecheck` and the test subset for the package you changed.
Use `nice -n 10` on a shared machine.

## Pull requests

1. Open an issue first for anything beyond a small fix.
2. Keep changes small and focused, with tests.
3. Fill in the pull request template, including the checks you ran.
4. Expect a review that may ask for more tests. Significant changes get an independent review by someone
   other than the author.

## Reporting problems

- Bugs and ideas: open an issue using the templates.
- Security issues: do **not** open a public issue. See [`SECURITY.md`](SECURITY.md).

## Conduct

Everyone taking part is expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Credit

Contributors are credited in acknowledgements. AI systems that assist are credited in acknowledgements
too, not as authors, and any AI assistance in a contribution should be stated in the pull request.
