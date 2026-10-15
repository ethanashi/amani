"""Read CLI-owned event streams, never the agent's results.json, for telemetry."""
from datetime import datetime, timezone
import json
import math
import re


def model_id(value):
    if not isinstance(value, str):
        return None
    return re.sub(r"-\d{8}$", "", re.sub(r"\[\d+[mk]\]$", "", value))


def events(path):
    transcript = path / "transcript.jsonl"
    out = []
    for line in transcript.read_text(errors="replace").splitlines() if transcript.is_file() else []:
        try:
            event = json.loads(line)
        except ValueError:
            continue
        if isinstance(event, dict):
            out.append(event)
    return out


# Codex exec --json has no structured error code: its CLI-generated error text is the only field.
# Templates from codex-cli 0.156.1 (CodexErr Display): "You've hit your usage limit. ... try again at
# <time>.", "Quota exceeded. Check your plan and billing details.", "exceeded retry limit, last status:
# 429 Too Many Requests", and ApiError "rate limit exceeded: ..." / "rate limit: ...".
CODEX_LIMIT = re.compile(r"usage limit|rate[ _]limit|too many requests|status: 429|insufficient_quota|"
                         r"(?<!disk )quota exceeded", re.I)
CODEX_RESET = re.compile(r"try again (at|in) ([0-9A-Za-z ,:]{1,60})", re.I)
# codex-cli renders the reset in host local time: "%-I:%M %p" on the same local day, else
# "%b %-d<st|nd|rd|th>, %Y %-I:%M %p".
CODEX_CLOCK = re.compile(r"(?:([A-Z][a-z]{2}) (\d{1,2})(?:st|nd|rd|th), (\d{4}) )?(\d{1,2}):(\d{2}) ([AP]M)")


def epoch(value):
    return value if type(value) is int and 10**9 <= value < 10**10 else None


def codex_reset(text, written):
    """Epoch seconds of a Codex local-time reset hint; a time alone is on the local day the CLI wrote it."""
    found = CODEX_CLOCK.fullmatch(text)
    if not found:
        return None
    month, day, year, hour, minute, half = found.groups()
    try:
        date = (datetime.strptime(f"{month} {day} {year}", "%b %d %Y").date() if month else
                datetime.fromtimestamp(written).date())
        clock = datetime.strptime(f"{hour}:{minute} {half}", "%I:%M %p").time()
        return epoch(int(datetime.combine(date, clock).astimezone().timestamp()))
    except (ValueError, OverflowError, OSError):
        return None


def codex_error(event):
    """The CLI's own error text, from the exact pinned exec --json error shapes only.
    Agent messages and command output are `item.*` events and are never read."""
    if event.get("type") == "error" and set(event) == {"type", "message"}:
        message = event["message"]
    elif (event.get("type") == "turn.failed" and set(event) == {"type", "error"} and
          isinstance(event["error"], dict) and set(event["error"]) == {"message"}):
        message = event["error"]["message"]
    else:
        return None
    return message if isinstance(message, str) and len(message) <= 4000 else None


def rate_limit(path, family):
    """Provider rate/usage-limit evidence from CLI-level event fields only.

    `signals` lists every limit marker the CLI emitted (transient ones included). `terminal` is true
    only when the CLI's own terminal outcome is the limit failure: an agent's text, tool output or
    final message is never read, so printing "rate limit" cannot produce either.
    """
    stream = events(path)
    signals, terminal, resets, hint = [], False, None, None
    if family == "claude":
        result, assistant_error, result_assistant_error = None, None, None
        for e in stream:
            kind = e.get("type")
            if kind == "rate_limit_event":
                info = e.get("rate_limit_info")
                if isinstance(info, dict) and info.get("status") == "rejected":
                    signals.append("rate_limit_event:rejected")
                    resets = epoch(info.get("resetsAt")) or resets
            elif kind == "assistant":
                # Wrapper-level fields set by the CLI; message.content is never inspected.
                assistant_error = e.get("error")
                if assistant_error == "rate_limit":
                    signals.append("assistant.error:rate_limit")
                if e.get("api_error") == "model_substitution_disabled":
                    # CLAUDE_CODE_NO_MODEL_FALLBACK refused a model switch the CLI wanted (limits/overload).
                    signals.append("assistant.api_error:model_substitution_disabled")
                if e.get("api_error") == "usage_limit_reached":
                    signals.append("assistant.api_error:usage_limit_reached")
                    params = e.get("api_error_params")
                    info = params.get("rate_limit_info") if isinstance(params, dict) else None
                    if isinstance(info, dict):
                        resets = epoch(info.get("resetsAt")) or resets
            elif kind == "system" and e.get("subtype") == "api_retry" and (
                    e.get("error") == "rate_limit" or e.get("error_status") == 429):
                signals.append("api_retry:429")
            elif kind == "result":
                result, result_assistant_error, assistant_error = e, assistant_error, None
        if result is not None and result.get("is_error") is True and (
                result.get("api_error_status") == 429 or result.get("api_error") in ("usage_limit_reached", "model_substitution_disabled") or
                result_assistant_error == "rate_limit"):
            terminal = True
            signals.append("result:is_error:rate_limit")
    elif family == "codex":
        last, turn_open = None, False
        for e in stream:
            kind = e.get("type")
            if not isinstance(kind, str):
                continue
            last = e
            if kind == "turn.started":
                turn_open = True
            elif kind in ("turn.completed", "turn.failed"):
                turn_open = False
            message = codex_error(e)
            if message is not None and CODEX_LIMIT.search(message):
                signals.append(kind + ":limit")
        message = codex_error(last) if last is not None else None
        if message is not None and CODEX_LIMIT.search(message) and (last["type"] == "turn.failed" or turn_open):
            terminal = True
            found = CODEX_RESET.search(message)
            hint = f"{found.group(1).lower()} {found.group(2).strip(' ,')}" if found else None
            if found and found.group(1).lower() == "at":
                resets = codex_reset(found.group(2).strip(" ,"), (path / "transcript.jsonl").stat().st_mtime)
    return {"family": family, "signals": sorted(set(signals)), "terminal": terminal, "resetsAt": resets,
            "resetsAtUtc": datetime.fromtimestamp(resets, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") if resets else None,
            "resetHint": hint}


SYNTHETIC = "<synthetic>"
REFUSAL_CATEGORY = re.compile(r"[a-z][a-z0-9_-]{0,39}")


def zero_usage(usage):
    """CLI-synthesized messages carry all-zero token counts; nested usage objects are not counted."""
    return (isinstance(usage, dict) and all(usage.get(k) == 0 and type(usage[k]) is int for k in ("input_tokens", "output_tokens"))
            and all(v == 0 for v in usage.values() if type(v) in (int, float)))


# modelUsage capacity fields (never usage): a real CLI entry always carries them, non-zero.
MODEL_USAGE_CAPACITY = ("contextWindow", "maxOutputTokens")
# Wrapper `api_error` codes of CLI-synthesized limit messages (see rate_limit).
LIMIT_API_ERRORS = ("usage_limit_reached", "model_substitution_disabled")


def zero_model_usage(use):
    """A result.modelUsage entry with no usage: every token/cost field is 0; capacity fields are ignored. Any
    other value (a non-number, a nested object) keeps the entry, so an unknown shape fails provenance closed."""
    return isinstance(use, dict) and all(type(v) in (int, float) and (k in MODEL_USAGE_CAPACITY or v == 0)
                                         for k, v in use.items())


def api_error_message(event):
    """An assistant event the Claude CLI synthesized for an API error: wrapper `is_api_error_message: true`,
    `message.model` "<synthetic>" and zero usage. Wrapper/metadata fields only; message.content is never read."""
    message = event.get("message")
    return (event.get("type") == "assistant" and event.get("is_api_error_message") is True and isinstance(message, dict)
            and message.get("model") == SYNTHETIC and zero_usage(message.get("usage")))


def infrastructure_api_error(event):
    """A CLI api-error message for a provider safety refusal or a rate/usage limit: its "<synthetic>" model is no
    identity. Other API errors (authentication, billing, overload, server errors) are not: their "<synthetic>"
    stays a reported model, so the run stays provenance-unverified (unavailable, never charged), as before."""
    return api_error_message(event) and (event["message"].get("stop_reason") == "refusal" or
                                         event.get("error") == "rate_limit" or event.get("api_error") in LIMIT_API_ERRORS)


def category(value):
    return value if isinstance(value, str) and REFUSAL_CATEGORY.fullmatch(value) else None


def provider_refusal(path, family):
    """Provider safety-classifier refusals from CLI-level event fields only (same discipline as rate_limit).

    A refused turn is a CLI api-error message whose `message.stop_reason` is "refusal" (category from
    `message.stop_details.category`). `terminal` is true only when the CLI's own terminal outcome is that
    refusal: the last result is an error and no real (non-synthetic) assistant message follows the last refused
    turn; another CLI api-error message in between is no model work. A `system` event `model_refusal_fallback`
    means the CLI continued on another model (`fallback`). `agentMessages` counts the real assistant messages.
    message.content, tool output and final_message.md are never read, so agent-printed text can neither
    create nor suppress a signal. Codex has no such mechanism here: no signals.
    """
    signals, categories, refusals, terminal, fallback, agent = [], [], 0, False, False, 0
    if family == "claude":
        result, refused_last, result_refused = None, False, False
        for e in events(path):
            kind = e.get("type")
            if kind == "assistant" and api_error_message(e):
                if e["message"].get("stop_reason") == "refusal":
                    refused_last = True
                    refusals += 1
                    signals.append("assistant.api_error:refusal")
                    details = e["message"].get("stop_details")
                    categories.append(category(details.get("category")) if isinstance(details, dict) else None)
            elif kind == "assistant":
                refused_last = False
                agent += isinstance(e.get("message"), dict)
            elif kind == "system" and e.get("subtype") == "model_refusal_fallback":
                refusals += 1
                fallback = True
                signals.append("system:model_refusal_fallback")
                categories.append(category(e.get("api_refusal_category")))
            elif kind == "result":
                result, result_refused, refused_last = e, refused_last, False
        if result is not None and result.get("is_error") is True and result_refused:
            terminal = True
            signals.append("result:is_error:refusal")
    return {"family": family, "signals": sorted(set(signals)), "categories": sorted({c for c in categories if c}),
            "refusals": refusals, "transient": refusals - terminal, "terminal": terminal, "fallback": fallback,
            "agentMessages": agent}


def telemetry(path, meta, family=None, legacy=False):
    """`legacy` reproduces the pinned fc62160 identity rules for registrations locked before refusal support:
    every message.model and modelUsage key counts ("<synthetic>" included) and no fallback event adds a model."""
    models, usages, costs = [], [], []
    terminal_events, synthetic, api_errors, dropped = 0, [], 0, 0
    for event in events(path):
        kind = event.get("type")
        if kind == "system" and event.get("subtype") == "init":
            models.append(event.get("model"))
        if not legacy and kind == "system" and event.get("subtype") == "model_refusal_fallback":
            models.append(event.get("fallback_model"))  # the model the CLI switched to did the work
        if kind == "assistant" and isinstance(event.get("message"), dict) and event["message"].get("model"):
            if family != "codex" and api_error_message(event):
                api_errors += 1
            if not legacy and family != "codex" and infrastructure_api_error(event):
                dropped += 1  # "<synthetic>" from a CLI refusal/limit message is no model identity
            else:
                models.append(event["message"]["model"])
        if kind == "result" and isinstance(event.get("modelUsage"), dict):
            for name, use in event["modelUsage"].items():
                # A zero-usage "<synthetic>" entry is dropped only if the stream has CLI refusal/limit messages.
                if not legacy and name == SYNTHETIC and family != "codex" and zero_model_usage(use):
                    synthetic.append(len(models))
                models.append(name)
        if kind in ("thread.started", "turn.started") and event.get("model"):
            models.append(event["model"])
        if kind in ("result", "turn.completed"):
            terminal_events += 1
            usage = event.get("usage")
            if isinstance(usage, dict):
                keys = ("input_tokens", "output_tokens")
                if all(type(usage.get(k)) is int and usage[k] >= 0 for k in keys):
                    # Claude cache writes/reads are additional input; Codex cached input is a subset.
                    extra = sum(usage.get(k, 0) for k in ("cache_creation_input_tokens", "cache_read_input_tokens")
                                if type(usage.get(k, 0)) is int and usage.get(k, 0) >= 0)
                    usages.append((usage["input_tokens"] + extra, usage["output_tokens"]))
            cost = event.get("total_cost_usd")
            if type(cost) in (int, float) and math.isfinite(cost) and cost >= 0:
                costs.append(cost)
    # Structured CLI fields only (the old free-text scan included Claude's `result`, the final assistant text).
    limited = any(rate_limit(path, f)["signals"] for f in ((family,) if family else ("claude", "codex")))
    refusal = provider_refusal(path, "claude" if family in (None, "claude") else family)
    if dropped:
        models = [m for i, m in enumerate(models) if i not in synthetic]
    if not models:
        reported = meta.get("model_reported")
        models = reported if isinstance(reported, list) else [reported] if reported else []
    models = [m for m in models if isinstance(m, str) and m]
    efforts = meta.get("effort_reported", [])
    return {"reportedModels": models, "reportedEfforts": efforts,
            "reportedEffort": efforts[0] if isinstance(efforts, list) and len(efforts) == 1 else None, "tokens": {"inputTokens": sum(u[0] for u in usages),
            "outputTokens": sum(u[1] for u in usages)} if usages else None,
            "costUsd": sum(costs) if costs else None, "rateLimited": limited,
            "providerRefusals": refusal["refusals"], "syntheticMessages": api_errors, "refusalFallback": refusal["fallback"],
            "tokenUsageComplete": bool(usages) and len(usages) == terminal_events and terminal_events >= len(models)}
