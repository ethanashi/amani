# KA0 discovery harness (final hardening)

This is a host-only synthetic proof, not gate certification. **PL1 is deprecated and cannot
be served, validate or grade**, even with a perfect report. KA3 replaces its toy LD generator.

```sh
export PATH=/opt/homebrew/opt/node@24/bin:$PATH
packages/bio-baseline/.pixi/envs/default/bin/python packages/bio-tasks/test/run.py test_discovery test_discovery_fix2 test_discovery_fix3
packages/bio-baseline/.pixi/envs/default/bin/python packages/bio-tasks/discovery/smoke-cohorts.py
```

The smoke draws five independent ephemeral host keys without selecting successful keys, runs
both strata of both families, and destroys keys and scratch after scanning. Only aggregate
reports survive. Numerical twins share scientific draws and are analyzed separately; they are
never pooled as independent observations. Each stratum pools **independent keys**.

## Public construction and sealing

`write_analyst(analyst, files)` constructs the public contract from blinded observations and
launches `analyst-writer.ts` with a scrubbed environment. Its stdin protocol accepts exactly
`publicLayer`, `files`, and the public prompt; neither the writer nor public-layer constructor
receives a pack, truth, theta, private layer, canary, key, or host path. The TypeScript writer imports only filesystem/path/crypto and strict JSON/canonical helpers.
The host regenerates the exact public contract, then a separate bridge applies the full K1a
validator while building the private layer. Both bridge and OpenSSL receive only PATH. The host
checks that the sealer's public envelope equals the already-written public envelope.

Every family/stratum has exactly five analyst files:

- `data/summary.tsv` and `data/ld.tsv` (canonical codecs, including row order/precision)
- `DATA-CONTRACT.json` (public layer only; deterministic alias order and source hashes)
- `TASK.md` (fixed public prompt)
- `manifest.json` (canonical inventory and public-contract hash)

Verification regenerates public metadata and checks every byte, including `source_files` and
`source_bundle_hash`, against the actual staged observations. Extra files, including `*.enc`,
refuse even if a writer added them to the manifest. Every entry is lstat-checked before reads: only
the root and data/ directories, and the five single-link regular files are legal. Files use mode
0644, directories 0755, and every mtime is 2000-01-01 UTC. Copies use copyfile and normalize
metadata. Removable xattrs are stripped; macOS kernel-owned com.apple.provenance, when
unremovable, must exactly equal the trusted writer attribute (a documented platform exception). Scanning additionally checks plaintext
hashes, filenames, prose/TSV gene-truth assertions, embedded JSON, gates, and positive-ID lists.
The smoke scans all staged strata using their actual decrypted keys before disposal. Tier A
scans its receipts/results with tokens from every generated pack, rather than an unrelated key.

This is a **data-flow boundary**, not an OS sandbox. Production must deny host filesystem/IPC
access through separate accounts/mounts. Arbitrary steganography inserted into the generator's
numerical observations still requires code review; a scanner cannot prove its absence.

## Serving and grading

Set explicit `BIO_GRADING_ROOT` and `BIO_SEALING_KEY` outside the repository. Use
`staging.stage(..., calibration_report=report)` to prepare a host card and a public projection.
That projection is a preparation artifact; serve it through the registry-backed entrypoint:

```sh
python HOST_CARD/stage.py --out ANALYST_DIR --context-id STABLE_AGENT_CONTEXT
python HOST_CARD/check.py --attempt ATTEMPT_DIR
```

The host SQLite registry reserves before copying and refuses forward/reversed PL4 cards in the
same retained agent context (including resumes). Both twins have separate ID and coordinate
contexts. The host must preserve the context ID across resumes; generating a fresh context ID
for an existing conversation violates this interface. Registry identity is never an analyst input.

Grading binds card, ciphertext, criteria/code snapshot, manifest-bound public contract and private
contract. Same-task-ID key substitution cannot replace the manifest-bound inputs. Each card must
also pass its reference and fail **every own registered naive control**. Cohort validity does not
override a locally vacuous card. `load_card(require_key=False)` still validates calibration bindings. PL1 diagnostic preparation
remains available to host audits, but dispatch cannot serve it.

## Statistical rules

The revised v3 criteria and SHA sidecar are also pinned by `criteria.py`. V1, V2 and edited bytes are
refused before generation. An exclusive, fsynced version receipt burns a run before work starts;
source hashes cover numerical code, the public writer/bridge, and criterion bytes/sidecar.

- Reference calibration: one-sided 95% Clopper–Pearson lower bound >= **.98**, in every key as well
  as pooled. This explicitly replaces 200/200 equality; .98 lies below the former perfect-200
  lower bound (.98513). It cannot require a lower bound of 1 at finite n.
- At least **five keys**, **2,000 packs/key/stratum**, and passing P1/P2 denominators per key.
  Every key must meet its reference and two-sided selector audits. A failed key stays in the report.
- Artefact AUC: dev/test split by pack within each key; feature/direction selected only on dev.
  Held-out placement influences are clustered by pack (genes are dependent), with Student-t
  bounds. Pool equal-weight key AUCs using the larger within-key and between-key standard error
  and a t bound over keys. The **upper bound <= .55**, both pooled and leaving out each key.
  These are approximate cluster intervals, not exact binomial or simultaneous confidence bounds.
- Selectors: two-sided exact Poisson-binomial tails, Bonferroni familywise alpha .01 over six
  selectors, keys plus pooled, and all four strata, minimum power .8 in both directions at a .20 difference. A perfect
  anti-selector fails. Unknown/underpowered never means clean.
- P5: one mean error per replicate before computing MCSE. Duplicating correlated entity rows
  cannot increase the denominator or shrink MCSE. Coverage is reported over replicate means.
- Every gate reports full key agreement including non-positive labels; P1–P4 alone do not
  establish agreement. Missing P4 strata remain explicitly unavailable and never pass.

PL4 labels use realized burden evidence. Packs are unconditioned; a pack may contain no
direction-relevant gene. Compatibility is sampled before measurement and action.
Direction-blind agreement/conflict baselines retain observable burden/modality decisions but
never compare MR and rare-variant direction; their full-card rates and CIs appear beside the
reference. No scientific claim about an AI analyst follows from scripted calibration.

P7 real/simulated realism, the blind judge, and genome-wide matching remain unavailable;
**certified is always false**. There is no live agent or external timestamp in this smoke.
Keep task/generator/checker sources and host artifacts out of public releases and analyst mounts.


## Final-hardening calibration (criteria v3)

PL4 draws each pack once, without conditioning on the existence of a direction-relevant gene.
Per-gene compatibility, strength and the four signs are independent of pack size. Some packs
therefore have no direction-relevant genes; the cohort includes them without resampling.
Gene IDs must be contiguous; disjoint PL4 loci require identity LD.

The frozen v3 plan uses 2,000 replicates per key and five keys, retains the 0.55 upper-bound
ceiling for pooled and every leave-one-key-out AUC, and corrects selector audits across arms,
keys (plus pooled), and all four strata. Versions 1 and 2 cannot validate new cards.
`smoke-cohorts.py` runs five independent cohorts with no retries/key selection and saves all
aggregate results. Forward/reversed twins share random draws and are not independent cohorts.
The results remain synthetic smoke evidence, not certification or realism validation.
