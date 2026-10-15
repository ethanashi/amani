# Models and providers

> **Status: in development.** This page describes a specification (roles, fallback chains and a typed
> failure policy) that is being built. The engine merged into this repository today drives the **Codex
> CLI** and **Claude Code** through their own command-line tools; configuration is by environment
> variables (`OMB_CODEX_CLI`, `OMB_CLAUDE_CLI`, `OMB_CODEX_MODEL`, `OMB_CLAUDE_MODEL`; see
> [getting-started.md](getting-started.md#requirements)). The provider configuration file, API-key
> providers and the settings UI are not yet in the snapshot.

The engine owns behaviour. The desktop app (Amani Studio) will only read and write this configuration
through the engine service and show its events.

## Roles and fallback chains

Models are assigned to roles. Each role has an ordered chain: `chain[0]` is the primary and the rest are
fallbacks, tried in order.

| Role | Does |
|---|---|
| `worker` | Investigation analysis: plan, code, interpretation. |
| `reviewer` | The independent replicator and the methods-validity review. |
| `drafter` | Paper prose. |
| `referee` | The cross-family referee of a manuscript. |
| `assistant` | Studio's read-only question-and-answer panel. |

A chain entry names a provider, a model (free text; any identifier is allowed) and, where the backend
supports it, an effort level. The planned configuration file is `providers.json` under the host state
directory, with permissions `600`. **It never contains secrets.**

## Providers

| Provider | How it is reached | Credentials |
|---|---|---|
| Codex CLI | The official CLI (`codex exec`) | Your subscription; no key. |
| Claude Code | The official CLI (`claude -p`) | Your subscription; no key. |
| OpenRouter | HTTPS API | An API key. |
| OpenCode | The OpenCode CLI (`opencode run`), with a chosen upstream provider | A key passed by environment, or OpenCode's own auth store. |
| Anthropic API | HTTPS API | An API key. |
| OpenAI API | HTTPS API | An API key. |

## Model families and the cross-family rule

The model family is derived from the model identifier, including `vendor/model` forms used by OpenRouter
and OpenCode (Claude → Anthropic, GPT and the o-series → OpenAI, Gemini → Google, Llama → Meta, Qwen →
Alibaba, DeepSeek, Mistral, Grok → xAI; an unknown model is its own family).

With `crossFamily: "require"`, the reviewer and the referee must be a different family from the worker
or drafter whose work they check, **on every fallback as well**. A chain that cannot satisfy this is a
configuration error. This is what keeps the independent re-implementation independent.

## Secrets

API keys live only in the macOS Keychain. The engine reads one at call time and passes it by environment
to the child process or HTTP client. It is never placed in argv, files, logs, the ledger, crash reports
or anything a model receives.

## Failures

Every attempt produces a typed outcome, recorded as a ledger event with the role, provider, model,
outcome, duration and the retry or failover decision.

| Outcome | Action |
|---|---|
| Transport error or server error | Retry with backoff and jitter, then fail over. |
| Rate limit or exhausted plan quota | Wait if the reset is short and known, else fail over; trip the circuit breaker. |
| Authentication error | Disable the provider for this run, raise a "needs you" item, fail over. |
| **Refusal** | Record it verbatim and fail over to the next configured provider. **The request is never reworded or split to get past a refusal.** If every eligible provider refuses, pause with the refusal texts. |
| Non-compliance (required artifacts missing, schema invalid, empty output) | Send a structured repair message listing exactly what is missing (a small number of times), then fail over. |
| Stall or loop | Stop the exact child process only; continue once in a fresh session with a handoff summary, then fail over. |
| Context overflow | Compact or hand off to a fresh session, then continue. |
| Disagreement (a model objects to the locked plan, or a reviewer disputes the worker) | Never silently overridden and never silently obeyed: it goes to the triage path with closed verdicts and a standby reviewer. The deterministic referee still decides every label. |

Each provider has a circuit breaker (default: 3 failures, a 15-minute cooldown), and fallback stays
bound by the cross-family rule. When a chain is exhausted, the investigation **pauses** in a "needs you"
state with a plain-language reason and the attempt log. It never produces results from a failed or
partial run. Retries, failovers and every attempt's tokens and time count in the per-investigation cost
log.

## Why failover is safe

Switching providers changes who writes the plan, the code or the prose. It never changes who decides.
Labels, gates and numbers belong to the deterministic checker whichever model produced the files.
