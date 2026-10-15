# PW5b record and template interface

The public API is exported by `src/index.ts`. This module is a reporting consumer;
it does not perform searches, screen studies, assess bias or implement statistical
kernels. Synthetic fixtures are examples of the serialization contract, not real
evidence for Amani's papers.

## Trusted input and capabilities

Use an authenticated PW0 `PaperInput` to create the report context. The host must
load records from its archived journal and independently authenticate the complete
payload. Do not attest agent-written JSON, owner narrative or a SHA-256 alone.

| Capability | PaperInput source | Additional binding |
| --- | --- | --- |
| `buildPrismaFlow` | `runMetadata.prismaSelection` | host receipt `omb-report/prisma-flow@1` |
| `buildReview` | `runMetadata.systematicReview` | lockedPlan.systematicReview; flow capability; host receipt `omb-report/systematic-review@1` |
| `buildMRReporting` | `runMetadata.mrReporting` | lockedPlan.mrReporting; host receipt `omb-report/mr-reporting@1` |

A review analysis must exactly match an entry in the selected certificate's
`systematicReviewExecutions`, omitting only its `certificateHash` field. Its
software name/version must match `environmentLock.packages`. The analysis claim
must use the recorded outcome (for surrogacy: surrogate exposure, overall-survival
outcome, `r squared` estimand), and certified n must equal its trial membership.
MR executions match certificate `mrExecutions` entries shaped as
`{policy, execution}`, also omitting `certificateHash` from the execution.
These are new host/certifier integration contracts; existing kernels do not
implicitly populate them. Unavailable capabilities leave checklist rows pending.

`ReviewRecords` deliberately has closed vocabularies. Current support is aggregate
data from randomized trials, adverse-event screens and trial-level surrogacy with
overall survival as the definitive endpoint. Richer queries, other endpoints,
individual-participant analyses and other model families require typed producers.
A field containing arbitrary prose is rejected even if a host receipt exists.
The host must only populate explicit absence values (for example `not-assessed`,
`none`, `not-estimated`) when its journal actually records that absence.

Synthesis claim sentences use the existing certified PW5 result renderer. PRISMA
20b additionally requires kernel-recomputed, claim/certificate-bound `i2` and `q`
facts, or `residualVariance` for trial-level surrogacy. Missing facts do not acquire
zero defaults. Exec-only facts cannot satisfy a result item. Human judgments,
registration, funding and scientific interpretations have no new verified path.

## Checklist to manuscript

1. Build the appropriate sealed producer(s).
2. Call `prepareChecklist(ctx, name, {review})` or `{mr}`. This returns every
   required slot and only the available software sentence assignments.
3. The trusted manuscript renderer places each sentence in its registered section.
   Preserve exact text. PRISMA abstract Results use `abstract-results`, not a free
   narrative section. No drafter-authored wrappers, additions or rearranged claims
   can supply the excerpt.
4. Authenticate the actual rendered manuscript with `PAPER_RENDER_DOMAIN`, then
   call `renderFinalAnchors`. Authenticate that output with `ANCHOR_DOMAIN`.
5. Pass slots, anchor receipt, authority verifier and the same sealed producers to
   `fillChecklist` or `exportChecklistAnchors`.

`complete` and `verified` remain false while any required row is pending.
`owner-supplied / not verified` is an explicit missing-evidence state, not a claim
that the owner has already provided the information. An owner's assertion or
reviewer's judgment does not become software-verified through these producers.
A manuscript cannot claim a complete PRISMA abstract while its required owner
rows are unresolved. An extension's completeness does not imply the base
checklist is complete. PRISMA harms retains the published 2009 extension numbers.

## PRISMA figure handoff to PW3/PW9

Consume `PrismaFlowData` with `schema: prisma-2020-flow@1`, version `2020`, the
source URL, paper hash and ledger hash. `variant` selects one of the four official
new/updated and database-only/other-source template variants. Both branches expose
identification by source, removals, screening, retrieval, assessment, exclusions
by reason and included reports/studies. `previous` and `included` provide the
updated-review totals. `trace` preserves the exact IDs behind those counts.

Counts are derived from records, never accepted as diagram box inputs. Reports
and studies have different IDs; several reports may describe one study. In an
updated review a newly found report of an existing study increases report counts
without increasing `newStudies`. Total study counts use the union across branches
and previous studies. The other-sources branch bypasses title/abstract screening.

The future template renderer can serialize the data as a figure artifact; it must
bind the output to `paperHash` and `ledgerHash`. A reloaded plain JSON object is
not a live verification capability: rebuild via the authenticated ledger if it
will be passed back to the checklist producer. This work does not render the
figure, a forest plot or a surrogacy bubble plot. ReSEEM item 22 stays pending
because it also requires those graphical and interpretive elements.
