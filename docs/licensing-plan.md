# Licensing plan

**Release status:** the first public release uses the licenses below. See [`LICENSE`](../LICENSE)
and component license files for the grants. Copyright 2026 Ethan Ashihundu.

The owner retains the publication review checklist below.

## Release structure

| Part | Licence | Why |
|---|---|---|
| The core: the orchestrator, scheduler, certifier, procedures, store and paper writer | **AGPL-3.0** | Keeps improvements to a hosted service open, and leaves room for a commercial licence. |
| A commercial licence for the same core | Separate, by agreement | For organisations that cannot use AGPL-3.0. Possible because the owner holds, or is assigned, the copyright. |
| The independent signed-bundle verifier (`packages/omb-verifier`) and **certificate format** (`packages/omb-certificate`) | **Apache-2.0** | A verifier that others can embed and audit without copyleft obligations builds trust in the labels. |
| Documentation | AGPL-3.0-only unless a file states otherwise | Follows the engine license. |
| Amani Studio | MIT | Existing component-specific grant. |
| Third-party code | Its own licence, listed in third-party notices | See below. |

## Contributions

- A **contributor licence agreement (CLA)** is required before a contribution is merged, so that the
  project can offer both AGPL-3.0 and a commercial licence. See [`CONTRIBUTING.md`](../CONTRIBUTING.md).
- Contributors keep their copyright and grant the project the rights the CLA describes.

## Third-party notices

- Each third-party component keeps its own licence file next to it (`third_party/`, and `vendor/` inside
  packages). The publish audit fails if a file under `third_party/` has no licence file beside it.
- [`NOTICE`](../NOTICE) and [`third-party-licenses.md`](third-party-licenses.md) record the actual
  installed npm inventory, pinned conda/Python/R packages and vendored notices.
- Reference software used only to validate results (for example R packages run in a separate reference
  process) is not linked into or imported by the Node engine; its pinned environment is installed separately, and its licence terms are
  not inherited.

## Checks before the release

1. **Provenance.** Confirm the origin and the owner's right to license every file, including code that
   was adapted from the author's earlier private projects (recorded in
   [`PROVENANCE.md`](../PROVENANCE.md)).
2. **Dependencies.** Review every runtime and build-time licence, and the pinned environment, for
   compatibility with AGPL-3.0 and Apache-2.0.
3. **Third-party and data licences.** Confirm that every dataset reference and every redistributed fixture
   may be redistributed.
4. **Sealed and benchmark material.** Decide which pilot tasks and fixtures are published and which stay
   private, and re-seal held-out sets so that publishing does not contaminate future evaluations.
5. **Clean history.** The release comes from a scrubbed tree with fresh history.
6. **Employer and affiliation check.** Confirm that no employer or other third party has a claim on the
   work.
7. **Trademark.** Check the name "Amani" for conflicts before public use.
8. **Legal review** of the final licence texts, the CLA and the dual-licensing arrangement.

## Enforced Apache boundary

The plan did not previously map these roles to standalone packages. The release extracts the existing
`omb-package` signed-bundle verifier into `omb-verifier` and the wire types, canonical encoding and
path/digest primitives into `omb-certificate`. Both have their own Apache-2.0 LICENSE and manifest.
The producer uses these packages; neither imports the AGPL engine. `pnpm lint` checks production
imports (including reexports, type and dynamic imports) and manifest dependencies. Regression tests
introduce escaping imports and require rejection. Standalone synthetic verification tests import only
these two packages and Node built-ins. Gate evidence is opaque transport data; the scientific certifier,
HMAC host authority and report re-execution code remain AGPL-3.0-only.
