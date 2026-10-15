# PW7 drafter orchestration

Local manuscript drafting and review over authenticated `PaperInput`. The package does not publish, endorse, contact authors, run reviewer-requested analyses, or use model transcripts as scientific evidence.

## Host integration

1. At a new plan lock, call `draftAtPlanLock` with `BlindSource`, a signed `Stage1Authority`, a `DraftRuntime`, and a `BlindStore`. The package verifies the host-signed empty-look snapshot and Introduction append receipt. Freeze the literature index at this point. Put the returned `sha256` in the existing `TimestampRecord.stage1IntroductionHash` **before permitting the confirming look**. Do not run the results stage until PW0 has built its authenticated `PaperInput`.
2. Build `ReportContext`, `MethodsDocument`, and `MatterDocument` with PW0/PW5. Supply authenticated study-specific pieces, PW4 citation rows and owner sign-off, checklist slots, and optional PW3 specs/stores. `sign`/`verify` are host authority functions, never accessible to a drafter. They bind all payloads to `PaperInput.sha256` using the PW5 receipt contract.
3. Construct real adapters with `createLiveAdapters`, then pass them to `DraftRuntime`. Supply actual model IDs/families from run provenance and explicit call/token/time/byte budgets. Adapter schema `omb-json` is the existing V7 JSON schema. No tool-specific provider clients are implemented here.
4. Construct `DrafterSession` and call `start(stage1Artifact)`. Older PW0 inputs marked `blind pass applies` may call `start()`; a fresh isolated blind turn receives only the locked plan and frozen index. A modern input cannot backfill Stage-1 prose after results.
5. Owner edits use `ownerEdit` and a host receipt for `omb-drafter/owner-edit@1`, containing `{actor,beforeHash,draft}`. Journal review uses `revise` with `omb-drafter/revision@1`, containing `{actor,beforeHash,report}`. Both rebuild the manuscript, re-run lints, and obtain a final diff review.
6. A correction uses `correct(nextInputs, receipt)` with fresh certified facts and `omb-drafter/correction@1`: `{actor,beforeHash,reason}`. The locked plan and claim set remain fixed. The erratum lists changed facts. Author notification remains a recorded owner task.
7. `assertReviewed()` proves the current version has a completed diff review. `assertReadyForEndorsement()` additionally refuses unresolved manuscript slots and major review issues without an exact-version owner resolution. PW9 still owns human endorsement, contact, policy, output conversion and packaging gates.

## Trust boundaries

Model output is a small JSON object whose prose always passes the existing report grammar, number/binding/wording/AI-name lints. The current grammar accepts `[claim:id].` as a request for a software sentence; software expands the result and label tokens. It does not accept a model's free-written result assertion with attached metric tokens. Blind prose cannot contain a claim, metric, result procedure or hypothesis assertion.

`ManuscriptInputs.pieces` has domain `omb-drafter/study-pieces@1`. Each `{id,text,sourceHash}` must come from an upstream trusted producer and name an authenticated source in the input. Never sign model prose as a study piece. The required IDs are exported in `VARIANTS`; a missing piece fails the build. PW3 display specs are independently rendered and verified; their CSVs and dictionaries are included in review context. `citations` has domain `omb-drafter/citations@1` and contains PW4 `{rows,signoff,keys}` mapping frozen report keys to bibliography keys. Each frozen index entry must pin its `auditRowHash`, `bibliographyKey`, and exact quote; an authenticated but unrelated citation row is refused. PW4 metadata/audit is reused; fresh reference checks remain a packaging requirement.

Findings are add-only. The referee family differs from the drafter; a judge from the drafter family adds spin findings too. Lean mode has one referee round and at most one prose repair, then the final diff review. Full mode separates Methods, statistics, domain and outsider roles. A prework refusal is retried in a fresh directory within the same eligible referee family and budget; there is no same-family fallback. Missing usage/provenance or failed containment blocks acceptance. Token limits are validated after each adapter call (WorkerSpec has no provider output-token cap); an overrun fails closed and cannot produce an accepted manuscript.

Reviewer analysis requests pass V7 `normalizeProposal` and become `v7-proposals/*.json`, with a new investigation identity, parent hashes and `requiresNewPlan`. A V7 host consumes this queue through its existing proposal selection/registration flow. PW7 does not execute or describe those analyses as completed. Added analyses need a separately certified PaperInput; they cannot be injected into a prose revision. The initial version and facts remain in the immutable version history.

Review text, prompts and receipts stay in the local bundle, separate from manuscript and supplement. The HTML review log escapes content and carries the internal-AI-review banner. Response rows and reply letters are generated from actual sentence diffs; no model-authored claim of a performed analysis is accepted.

## Output and known integration limits

Each version contains `paper.md`, `manuscript.json`, `response-log.json`, `change-log.json`, `reply-letter.md` and `review-internal.html`. Append-only events link to their predecessor hash. The API is fail-closed for concurrent edits and stale versions. There is no automatic crash-resume API; retain the event and adapter directories for audit and explicitly restore the frozen Stage-1 artifact when starting a new host run.

The example manuscript is synthetic and is not a scientific report or an endorsed package. Final PW5 guards permit ordinary narrative, compare recognized Methods facts with authenticated records, and preserve visible owner-review flags for uncertain or unrecorded details. The end-to-end example uses the production preprint word floors; many checklist evidence producers remain unavailable. Such rows explicitly remain `needs-owner` and block endorsement. Unsupported study kinds fail rather than receiving a guessed checklist. Reproduction requires the original paper’s guideline in the locked plan’s `originalChecklist`; missing or unsupported guidelines fail rather than defaulting to a different study type.

Draft profiles are local build constraints, not verified current venue policies. Short-note mode retains complete Methods and detailed limitations in the supplement. PW8 owns signed converter spans and PDF/DOCX read-back; PW9 must recheck publisher policies, reference freshness, contact and endorsement before packaging. The `numberTrace` is source attribution for generated sections plus PW1's ordered per-sentence fact IDs; it is not a substitute for PW8's converter-level closed-world check.

## Validation

Use Node 24 or newer:

```sh
pnpm exec vitest run packages/omb-drafter --maxWorkers=1 --no-file-parallelism
node packages/omb-drafter/scripts/mutate.ts
```

All tests use deterministic local adapter doubles. `PW7_WRITE_SAMPLE=1` during the package suite refreshes the synthetic manuscript and its section counts under `examples/`. Mutation runs restore source bytes after every mutant and distinguish assertion failures from invalid runs. See BUILD-NOTES and MUTATION-KILL-TABLE for recorded results.

Round-1 integration: `draftAtPlanLock` now takes a `Stage1Authority` with a pinned Ed25519 public key/key ID, a signed empty-look snapshot, and `recordIntroduction(hash)`. The host must atomically append the hash in the store/V5 look ledger before releasing any look capability and return its signed receipt. At assembly, `ManuscriptInputs.temporal` supplies a fresh signed ledger receipt and the same configured trust anchor. PW7 verifies signatures, plan/index/lineage/hash bindings, every PaperInput look hash, the ledger snapshot hash, and a strictly earlier Introduction timestamp. The signing bridge is not yet implemented in omb-store; until host wiring lands modern stage-1 assembly fails without these receipts. The private key must stay outside worker mounts. `firstLookAt` is descriptive legacy input, not temporal authority.

`loadGenreProfile(path)` accepts the supplied `genre-profile/1` files; pass its validated result to `withGenreProfile`. Required elements become signed study-piece IDs. Production article and short profiles enforce section floors and sentence diversity; the old example is an undersized integration fixture and now fails those production profiles.

Live setup: use `createLiveAdapters(codexOptions, claudeOptions, models)`; both real constructors receive V7's `WORKER_SCHEMAS['omb-json']`. `DraftRuntime` rejects missing wiring before dispatch. Optional `Model.versionPattern` is a full-match host-configured regex for dated/versioned identities; family must still match the provider telemetry source and provenance provider. Claude's adapter-level alias gate receives the same pattern. Defaults are 30 minutes, 24 calls and 180,000 total tokens; callers may override them. These are conservative starting budgets, not timings measured from paid live calls.

Verified rate limits park the in-flight call, persist `park-*.json`, await bounded exponential backoff (5/10/20 seconds by default, or the provider reset time), persist a resume record and retry in a fresh context. The existing session continuation stays alive, so a review is not restarted. Delay, retries, tokens and attempts all count against the original budget. `runtime.parked` exposes scheduler status; `RetryPolicy.wait` permits a host scheduler to hold and release the continuation. Excessive resets/retries and unknown usage fail closed. Park/resume is in-process; cross-process crash recovery remains a host integration task.

Review JSON requires both `issues` and `requested_analyses` arrays. Requested analyses contain `{issue, anchor, proposal}` and always enter the V7 new-plan queue. Prose regex matches only raise a major owner audit flag. Part B bias and settling-data fields accept guarded free text; optional existing software choices remain available. PW5's pending narrative fix is still required for free narrative when procedure execution records exist.
