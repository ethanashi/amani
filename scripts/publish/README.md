# Publishing snapshots

The development history stays in the private development repository. The Amani repository receives
**squashed snapshots**: one commit per publish, on top of the previous one. Pushed history is never
rewritten and nothing is force-pushed.

```sh
scripts/publish/publish.sh <git-ref> [--dry-run] [--allow-cleanup-findings]
```

A green **full local CI receipt for the exact source commit** is required, including for
`--dry-run`. Run `scripts/ci/ci.sh full <git-ref>` first; see [local CI](../../docs/CI.md)
for receipt locations and sealed-leakage configuration. A push-hook emergency override
or `--allow-cleanup-findings` cannot bypass the publish receipt gate.

What it does:

0. Resolve the source commit and validate its full receipt, before export or network work.

1. `git archive` the ref from the development repository into a staging directory under
   `_publish/` (removed at the end).
2. Remove everything listed in [`exclude.txt`](exclude.txt) (`apply-exclusions.mjs`).
3. Run [`audit.mjs`](audit.mjs) on the result. Secrets, personal email addresses, oversized files,
   `third_party/` files without a licence and sealed-benchmark leakage always stop the publish. Absolute
   home paths and the names of other private projects stop it unless `--allow-cleanup-findings` is given,
   which is only honoured while the target repository is private.
4. Commit the tree in a local clone (`_publish/amani-clone`) as one snapshot commit, authored with the
   GitHub no-reply identity, with the source ref and commit hash in the message body, and push to `main`.
   If one large push is cut off (HTTP 408 on a slow link), [`push-chunked.py`](push-chunked.py) uploads the
   objects in small pieces as temporary tags, the branch is pushed, and the tags are removed.

The script never changes repository visibility.

## Audit on its own

```sh
node scripts/publish/audit.mjs TREE [--json FILE] [--rename-debt FILE]
```

Matched secret values are never printed. To include the sealed-leakage check, point it at the host-held
benchmark cards; it calls the existing one-shot scanner, which loads its protected tokens itself and
reports only categories and paths:

Set `AMANI_LEAK_CARDS` to a colon-separated list of card directories, set `BIO_GRADING_ROOT` and
`BIO_SEALING_KEY` as the one-shot harness requires (see
[`packages/bio-tasks/oneshot/README.md`](../../packages/bio-tasks/oneshot/README.md)), and set
`AMANI_LEAK_SCANNER` to the `oneshot.sh` of a checkout that has the pixi environment installed (a staged
export does not), then run the audit as above.

Without `AMANI_LEAK_CARDS` the audit reports the hook as "not run". Run it before a repository is made
public.

The export excludes development runs, selection notes, held-out trees and local
validation evidence. Development cards remain in the development repository.
The audit permits upstream author emails only in the exact licence-notice bytes
pinned by `upstream-notices.json`; changed notices lose that exception. Secrets,
home paths and private project names are still checked in those files. Review and
refresh the hashes when upgrading dependencies, retaining upstream attribution.
`/Users/Shared` is a system shared directory, not a personal home directory.
The openpyxl notice is accompanied by its upstream MIT licence text.
