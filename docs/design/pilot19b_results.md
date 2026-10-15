# Pilot 19b results: baseline arms on the 19-task trap suite

Written for: the builders, the system paper (PW11), and the owner.

**Study.** Locked 2026-10-11 at 00:0x UTC.
- Settings `add2cb31…`, commit fc62160, run from a pinned worktree, toolpack `f7724f7a…`.
- Arms (Amani v1 was retired, and v2 arms join later by amendment):
  - plain Claude Code (Opus 5.5, no-fallback), 3 attempts per task;
  - plain Codex (GPT-6 Astra, effort high), 1 attempt;
  - Codex plus the Amani check/sim toolpack ("codex-tools", arm B), 1 attempt.
- 19 tasks, each a public-data analysis with a planted trap (duplicates, pseudo-replication, leakage, confounding, citation errors and so on).
- Start and end sentinel runs (p1, p9, w0) measure drift.
- Finished 2026-10-11 18:03 UTC: 113 recorded executions; the controller exited 0.

## Main phase (94 runs)

| Arm | Runs | Graded | Passed | Pass rate (graded) | Not graded |
|---|---|---|---|---|---|
| plain Claude (Opus 5.5) | 57 | 39 | 32 | 82% | 18 blocked by the usage classifier |
| plain Codex (GPT-6 Astra) | 19 | 18 | 14 | 78% | 1 provenance-unverified |
| Codex + toolpack | 18 | 18 | 14 | 78% | 0 (no p16 cell, by design) |

**Per task, main phase** (passed/graded):

| Task | Claude | Codex | Codex+tools |
|---|---|---|---|
| iad1-brady-audit | 1/3 | 0/1 | 1/1 |
| iad2-brady-twin | 1/1 | 1/1 | 1/1 |
| iad3-browning-count | 2/2 | 0/1 | 0/1 |
| p1-esr1 | 2/2 | 1/1 | 1/1 |
| p10-pseudorep | 1/3 | 1/1 | 1/1 |
| p10b-pseudorep-hidden | 2/2 | 1/1 | 1/1 |
| p11-confounding | 2/2 | 1/1 | 1/1 |
| p12-quality | 2/2 | 1/1 | 1/1 |
| p13-endpoint | 2/2 | 1/1 | 1/1 |
| **p14-citation** | **0/2** | **0/1** | **0/1** |
| p16-recovery | 3/3 | – | – |
| p2-erbb2 | 3/3 | 1/1 | 1/1 |
| p4-bixbench | 3/3 | 1/1 | 1/1 |
| p5-permuted | 2/2 | 1/1 | 1/1 |
| p6-subgroups | 2/2 | 1/1 | 0/1 |
| p7-nosignal | – (3/3 blocked) | 1/1 | 1/1 |
| p8-underpowered | 2/2 | 1/1 | 1/1 |
| p9-leakage | 2/2 | 1/1 | 1/1 |
| **w0-venet** | **0/1** | **0/1** | **0/1** |

## Findings

1. **Plain frontier models already pass most single-trap tasks, at about 80%.** A harness can't win by "being careful" in general. Its value has to show on the tasks every arm fails, and on never certifying a wrong result.
2. **Every arm failed the citation task (p14) and the duplicate-patients task (w0).** w0's endpoint includes always-needs-review items, so use item-level results; the duplicate trap itself was caught in earlier runs. These are where Amani's checks are aimed: the PW4 citation verifier and the G1 duplicate detector.
3. **The toolpack (arm B) did not change Codex's pass rate** (78% vs 78%, n = 18 each). Tools alone aren't enough; structure and verification are the hypothesis to test with the v2 arms.
4. **Anthropic's usage classifier blocked 18 of 57 plain-Claude main runs (32%)** before any work. The runs lasted under 3 s, with 0 output tokens, stop_reason refusal and category "cyber". All 3 p7 runs were blocked. These are infrastructure events, not science results. This drives the worker-model rule (Codex default; refused Claude runs reroute) and an official false-positive report.
5. **Speed:** median graded run time was 3.3 min for Claude, 7.4 min for Codex, and 8.2 min for Codex+tools.

## Sentinels and deviations

- **End-sentinel p1 runs (3) are excluded as infrastructure.** A network/DNS outage started at about 17:57 UTC. The Codex logs show "Connection failed: error sending request", and the Claude run never reached the API. The pilot controller graded two of them as "rejected" (exit 1 after about 1 min, no work done). That is a controller defect: connection failures must be infrastructure retries. Fix it in the next study's harness (V10).
- **Remaining sentinels** (p9 and w0 at start vs end):
  - **p9:** passed at start by Codex and Codex+tools. At end, Codex+tools passed, Codex was rejected, and Claude was rejected (Claude's start p9 was blocked).
  - **w0:** failed at both start and end for every arm.
  - With n = 1 per cell, no drift conclusion is possible.
- **Earlier deviation:** the first lock (94d2f01c) was abandoned after a silent Claude model fallback to claude-opus-5. The fix was CLAUDE_CODE_NO_MODEL_FALLBACK=1, then a re-lock.

## Next

- v2 arms (B+G, Amani v2) are added by amendment on the same 19 tasks, on a quiet machine, with OS-user separation for any Confirmed claims.
- The harness fix (connection failure means infrastructure) goes into V10.
- Report Claude classifier blocks separately in every comparison.
