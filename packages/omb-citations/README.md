# @omerta-bio/citations

A deterministic citation checker with permanent owner review. Automated `pass` means the implemented
checks passed; it is **not permission to publish**. `paperBundle()` remains `ready: false` until
`finalizeBundle()` checks an authenticated owner's complete sign-off and freshly retrieves the sources.
No LLM judge is used.

```sh
export PATH=/opt/homebrew/opt/node@24/bin:$PATH
pnpm exec vitest run packages/omb-citations/test
OMB_LIVE_CITATIONS=1 pnpm exec vitest run packages/omb-citations/test/live.test.ts
node packages/omb-citations/src/cli.ts public                 # small, cached API requests
node packages/omb-citations/src/cli.ts public --fresh         # bypass cache
node packages/omb-citations/src/cli.ts identity
node packages/omb-citation-suite/src/cli.ts score \
  --results packages/omb-citations/reports/public-results.jsonl --split public
```

Coordinator interface (inputs are JSONL `{id, sentence, quote, citation}`):

```sh
node packages/omb-citations/src/cli.ts verify --inputs INPUT.jsonl --out OUTPUT.jsonl \
  --verifier-id FROZEN_ID
```

The CLI resumes its persistent, hash-validated HTTP snapshot by default: resolved URLs are reused
across restarts even after 24 hours. Add `--fresh` for a deliberate new retrieval; packaging always
requires fresh retrieval. Resuming old evidence does not establish current registry status. Each
request has at most five attempts within 60 seconds, with exponential jitter for DNS/socket/timeouts,
429 and 5xx, and Retry-After respected. Outages are never cached as absence or converted into passes.

`verify` writes `OUTPUT.jsonl.run.json` beside its results; public runs write `reports/public-run.json`.
Both include `infrastructureIncomplete`, `infrastructureStatus` and `unavailable`. A scorer should
report `infrastructure-incomplete` separately from scientific verdicts and resume retrieval before
claiming a complete evaluation. Individual unavailable rows still project to `needs-owner` and an
`unavailable` flag, as required by the suite's accepted status vocabulary.

The generic `verify` command does not load any benchmark file or gold label. The public runner reads
only `suite/public.jsonl`, projects `id` + `input`, and invokes the same verifier. Scoring is a separate
invocation of the existing suite scorer, with `--split public`. The CLI rejects a mismatch with
`FREEZE.json` or an explicitly supplied verifier ID. `identity` can inspect a modified build without
running it. No private scorer is invoked here.

`public-retrieve.ts` is a public-only development utility that saves software-resolved snapshots in
the ignored package-local `.cache`. `public --offline` uses those snapshots only within their 24-hour
TTL; an absent/expired snapshot produces `needs-owner` with `unavailable` in flags. `--offline` and
`--fresh` cannot be combined. `--reparse` on the retrieval utility rebuilds parsed records from valid
HTTP caches. Production verification uses the resolver, not development snapshots.

Main APIs are exported from `src/index.ts`:

- `lockQueries`, `retrieveResearchIndex`: lock neutral entity-pair queries and software retrieval;
  search receipts and model-suggested queries are recorded separately. Searches exceeding the bounded
  result limit are unavailable, not silently truncated.
- `ScholarlyResolver`, `HttpClient`, `MemoryCache`, `FileCache`: injected clock and fetch, 24-hour TTL,
  bounded response sizes, no redirects, allowlisted hosts, unavailable/absent distinction.
- `freezeIndex`, `verify`: hash-bound source index; per-row checks, evidence windows and reasons.
- `blindOwnerForm`, `ownerSignoff`, `persistOwnerSignoff`: L1-L4/evidence only in the blind form;
  complete per-row decisions, bound to the row hashes; exclusive durable record creation.
- `paperBundle`, `finalizeBundle`: CSL-JSON, concordance, provenance, disagreements and fresh replay.
  Owner approval cannot override a software block. Any changed source requires new verification and
  owner sign-off. The embedding host must authenticate the human, show the blind form before L5a,
  keep sign-offs permanently, and prevent the drafter from modifying trusted code/index/storage.

See `BUILD-NOTES.md` for requirements, limitations, tests and the public calibration result. Public
scores are development measurements, not held-out admission. The present build is not admission-ready.
