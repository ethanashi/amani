"""Provider safety refusals are infrastructure; the supplement re-runs only refused slots. Injected transports,
hand-built synthetic stream-json (structural CLI fields only, no task text or identifiers), no live models.

Shapes follow Claude Code 2.1.296 stream-json: a refused turn is a CLI api-error assistant event (`error`,
`is_api_error_message`, `message.model` "<synthetic>", `stop_reason` "refusal", `stop_details.category`, zero
usage); without CLAUDE_CODE_NO_MODEL_FALLBACK the CLI emits `system` `model_refusal_fallback` instead.
"""
import argparse
import contextlib
import copy
import hashlib
import io
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'test'))
from fixture_world import run_fixture_test
run_fixture_test(__file__)

import pilot as p
import telemetry

MODEL, FALLBACK, CODEX = "claude-opus-5-5", "claude-opus-5", "gpt-6-astra"
SESSION = "00000000-0000-4000-8000-000000000000"
REFUSAL_TEXT = "API Error: Opus 5.5's safeguards flagged this session as a potential cyber risk."
ZERO = {"input_tokens": 0, "output_tokens": 0, "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0}
COMMIT = {"sha": "c" * 40, "dirty": False}
REASON = "Provider refusals were charged to arms"
LOCKED_AT = "fc62160"


def init(model=MODEL):
    return {"type": "system", "subtype": "init", "model": model, "session_id": SESSION}


def turn(model=MODEL, content=None):
    return {"type": "assistant", "session_id": SESSION, "message": {"model": model, "role": "assistant", "stop_reason": "end_turn",
            "usage": {"input_tokens": 3, "output_tokens": 2}, "content": content or [{"type": "text", "text": "fixture"}]}}


def refusal(content=None, **wrapper):
    return {"type": "assistant", "error": "invalid_request", "is_api_error_message": True, "request_id": "req_fixture",
            "session_id": SESSION, "message": {"model": "<synthetic>", "role": "assistant", "stop_reason": "refusal",
            "stop_details": {"type": "refusal", "category": "cyber", "explanation": "fixture"}, "usage": dict(ZERO),
            "content": [{"type": "text", "text": REFUSAL_TEXT}] if content is None else content}, **wrapper}


def limit_message():
    return {"type": "assistant", "error": "rate_limit", "is_api_error_message": True, "session_id": SESSION,
            "message": {"model": "<synthetic>", "role": "assistant", "stop_reason": "stop_sequence", "usage": dict(ZERO),
                        "content": [{"type": "text", "text": "fixture limit"}]}}


def api_error(error="authentication_failed"):
    """A CLI api-error message for an error that is no refusal or limit (auth lapse, server error, overload)."""
    return {"type": "assistant", "error": error, "is_api_error_message": True, "session_id": SESSION,
            "message": {"model": "<synthetic>", "role": "assistant", "stop_reason": "stop_sequence", "usage": dict(ZERO),
                        "content": [{"type": "text", "text": "fixture api error"}]}}


def fallback():
    return {"type": "system", "subtype": "model_refusal_fallback", "trigger": "refusal", "scope": "session",
            "original_model": MODEL, "fallback_model": FALLBACK, "api_refusal_category": "cyber", "session_id": SESSION}


def result(is_error, models=(MODEL,), **extra):
    return {"type": "result", "subtype": "error_during_execution" if is_error else "success", "is_error": is_error,
            "api_error_status": None, "result": "fixture", "session_id": SESSION, "usage": {"input_tokens": 5, "output_tokens": 1},
            "modelUsage": {m: {"inputTokens": 5, "outputTokens": 1} for m in models}, **extra}


def tool_result(text):
    return {"type": "user", "session_id": SESSION, "message": {"role": "user", "content": [
        {"type": "tool_result", "tool_use_id": "toolu_fixture", "content": text, "is_error": False}]}}


def unflagged():
    event = refusal()
    del event["is_api_error_message"]
    return event


STREAMS = {
    "clean": lambda: [init(), turn(), result(False)],
    # (A) blocked on the first request; the CLI exits 1; no deliverables.
    "shape-a": lambda: [init(), refusal(), result(True)],
    # (B) one refused turn, then the CLI carries on and finishes.
    "shape-b": lambda: [init(), turn(), refusal(), turn(), result(False)],
    # No CLAUDE_CODE_NO_MODEL_FALLBACK: the CLI silently continues on another model.
    "fallback": lambda: [init(), turn(), fallback(),
                         turn(FALLBACK, [{"type": "fallback", "from": MODEL, "to": FALLBACK}, {"type": "text", "text": "fixture"}]),
                         result(False, (MODEL, FALLBACK))],
    # The agent prints the refusal sentence and a tool prints CLI-shaped refusal JSON lines; the run then fails ordinarily.
    "spoof": lambda: [init(), turn(content=[{"type": "text", "text": REFUSAL_TEXT}]),
                      tool_result("\n".join(json.dumps(e) for e in (refusal(), result(True), fallback()))),
                      turn(content=[{"type": "text", "text": REFUSAL_TEXT + "\n" + json.dumps(refusal())}]), result(True)],
    # "<synthetic>" without the CLI api-error wrapper flag.
    "synthetic-unflagged": lambda: [init(), turn(), unflagged(), turn(), result(False)],
    # Precedence fixtures.
    "rate-then-refusal": lambda: [init(), {"type": "system", "subtype": "api_retry", "attempt": 1, "error": "rate_limit",
                                           "error_status": 429, "session_id": SESSION}, turn(), refusal(), result(True)],
    "refusal-then-rate": lambda: [init(), turn(), refusal(), turn(), limit_message(), result(True, api_error_status=429)],
    "both-terminal": lambda: [init(), turn(), refusal(error="rate_limit"), result(True, api_error_status=429)],
    # A refusal fallback, or a silent model switch, and then a terminal refusal: the wrong model did work.
    "fallback-terminal": lambda: [init(), turn(), fallback(), turn(FALLBACK), refusal(), result(True, (MODEL, FALLBACK))],
    "switch-terminal": lambda: [init(), turn(FALLBACK), refusal(), result(True, (MODEL, FALLBACK))],
    # The agent worked (three real turns, results.json written), then its last turn was refused.
    "late-refusal": lambda: [init(), turn(), turn(), turn(), refusal(), result(True)],
    # Non-refusal CLI api errors (the checked-in auth-failure shape: zero usage, empty modelUsage).
    "auth-fail": lambda: [init(), api_error(), {**result(True), "modelUsage": {}}],
    "server-error": lambda: [init(), turn(), api_error("server_error"), result(True)],
    "refusal-then-auth": lambda: [init(), turn(), refusal(), api_error(), result(True)],
    # A rate-limit message the CLI rode out: no refusal, so a refusal supplement never touches it.
    "limit-transient": lambda: [init(), turn(), limit_message(), turn(), result(False)],
}
FAILS = {"shape-a", "spoof", "rate-then-refusal", "refusal-then-rate", "both-terminal", "fallback-terminal", "switch-terminal",
         "late-refusal", "auth-fail", "server-error", "refusal-then-auth"}
NO_DELIVERABLES = {"shape-a", "rate-then-refusal", "refusal-then-rate", "both-terminal", "auth-fail"}
# A real-shaped zero-usage modelUsage entry: token/cost fields 0, capacity fields not.
ZERO_MODEL_USAGE = {"inputTokens": 0, "outputTokens": 0, "cacheReadInputTokens": 0, "cacheCreationInputTokens": 0,
                    "webSearchRequests": 0, "costUSD": 0, "contextWindow": 200000, "maxOutputTokens": 32000}


def pinned_telemetry(path, meta, family=None, legacy=False):
    """telemetry() exactly as the pinned fc62160 controller computed it (copied): every message.model and modelUsage
    key counts, "<synthetic>" included, and token completeness compares against that model list."""
    models, usages, costs = [], [], []
    terminal_events = 0
    for event in telemetry.events(path):
        kind = event.get("type")
        if kind == "system" and event.get("subtype") == "init":
            models.append(event.get("model"))
        if kind == "assistant" and isinstance(event.get("message"), dict) and event["message"].get("model"):
            models.append(event["message"]["model"])
        if kind == "result" and isinstance(event.get("modelUsage"), dict):
            models.extend(event["modelUsage"])
        if kind in ("thread.started", "turn.started") and event.get("model"):
            models.append(event["model"])
        if kind in ("result", "turn.completed"):
            terminal_events += 1
            usage = event.get("usage")
            if isinstance(usage, dict):
                keys = ("input_tokens", "output_tokens")
                if all(type(usage.get(k)) is int and usage[k] >= 0 for k in keys):
                    extra = sum(usage.get(k, 0) for k in ("cache_creation_input_tokens", "cache_read_input_tokens")
                                if type(usage.get(k, 0)) is int and usage.get(k, 0) >= 0)
                    usages.append((usage["input_tokens"] + extra, usage["output_tokens"]))
            cost = event.get("total_cost_usd")
            if type(cost) in (int, float) and math.isfinite(cost) and cost >= 0:
                costs.append(cost)
    limited = any(telemetry.rate_limit(path, f)["signals"] for f in ((family,) if family else ("claude", "codex")))
    if not models:
        reported = meta.get("model_reported")
        models = reported if isinstance(reported, list) else [reported] if reported else []
    models = [m for m in models if isinstance(m, str) and m]
    efforts = meta.get("effort_reported", [])
    return {"reportedModels": models, "reportedEfforts": efforts,
            "reportedEffort": efforts[0] if isinstance(efforts, list) and len(efforts) == 1 else None, "tokens": {"inputTokens": sum(u[0] for u in usages),
            "outputTokens": sum(u[1] for u in usages)} if usages else None,
            "costUsd": sum(costs) if costs else None, "rateLimited": limited,
            "tokenUsageComplete": bool(usages) and len(usages) == terminal_events and terminal_events >= len(models)}


def legacy(plan):
    """`plan` as registered before refusal support: no refusalRetries (pilot16)."""
    old = copy.deepcopy(plan)
    del old["retryRule"]["refusalRetries"]
    return old


class FakeGit:
    """pilot.Git with fixed answers: HEAD, its dirty flag, harness/code comparisons and files committed at HEAD."""
    def __init__(self, sha=COMMIT["sha"], dirty=False, same=True):
        self.sha, self.dirty, self.same_, self.files, self.compared = sha, dirty, same, {}, []

    def head(self):
        return {"sha": self.sha, "dirty": self.dirty}

    def same(self, since, paths, exclude=()):
        self.compared.append((since, tuple(paths), tuple(exclude)))
        return self.same_(since, tuple(paths)) if callable(self.same_) else self.same_

    def show(self, rel):
        return self.files.get(rel)


def tree(root):
    """Every file under root with its bytes hash and mode: proves a directory was never written."""
    return {str(f.relative_to(root)): (hashlib.sha256(f.read_bytes()).hexdigest(), f.stat().st_mode, f.stat().st_mtime_ns)
            for f in sorted(Path(root).rglob("*")) if f.is_file()}


class RefusalTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.inventory = [t for t in p.discover() if t["id"] in ("p10-pseudorep", "p9-leakage", "w0-venet")]

    def setUp(self):
        parent = Path.home() / ".omerta-bio/grading"
        parent.mkdir(parents=True, exist_ok=True)
        self.tmp = tempfile.TemporaryDirectory(prefix="pilot-refusal.", dir=parent)
        self.addCleanup(self.tmp.cleanup)
        self.state = Path(self.tmp.name) / "study"
        self.state.mkdir()
        self.out = Path(self.tmp.name) / "study-supplement-1"
        self.git = FakeGit()
        self.plan = p.make_plan(copy.deepcopy(self.inventory), True)
        for arm in self.plan["arms"]:
            arm["attempts"] = 1
        self.plan["diskFloorBytes"] = 1
        self.plan["statistics"]["resamples"] = 32
        self.streams = {}  # attempt row id -> stream names for its successive sessions
        self.dispatches, self.grades = [], []
        self.ticks = iter(range(100000))

    def live_plan(self, plan=None):
        live = copy.deepcopy(plan or self.plan)
        live["dryRun"] = False
        live["diskFloorBytes"] = 12 * 1024**3
        for arm in live["arms"]:
            arm["cliVersion"] = "fixture-1"
        return live

    def write(self, name, where=None):
        (where or self.state).mkdir(parents=True, exist_ok=True)
        events = STREAMS[name]() if isinstance(name, str) else name
        ((where or self.state) / "transcript.jsonl").write_text("\n".join(map(json.dumps, events)) + "\n")

    def transport(self, plan):
        def send(cmd, **kwargs):
            if cmd[1].endswith("run-task.sh"):
                task, runner, attempt = cmd[2:5]
                arm = next(a for a, r in p.ARMS.items() if r == runner)
                config = next(a for a in plan["arms"] if a["id"] == arm)
                queue = self.streams.get(attempt.rsplit("-r", 1)[0], [])
                name = queue.pop(0) if queue and p.arm_registry()[arm]["family"] == "claude" else "clean"
                timeout, name = name.endswith("-timeout"), name.removesuffix("-timeout")
                contaminated, name = name.endswith("-contaminated"), name.removesuffix("-contaminated")
                target = Path(cmd[cmd.index("--results-root") + 1]) / task / f"{runner}-{attempt}"
                (target / "workdir").mkdir(parents=True)
                self.dispatches.append((attempt, name))
                if p.arm_registry()[arm]["family"] == "claude":
                    self.write(name, target)
                else:
                    self.write([{"type": "thread.started", "thread_id": "t"}, {"type": "turn.started"},
                                {"type": "turn.completed", "usage": {"input_tokens": 1, "output_tokens": 1}}], target)
                failed = name in FAILS
                card = next(t["card"] for t in plan["tasks"] if t["id"] == task)
                meta = {"start": "fixture-start", "end": "fixture-end",
                        "status": "timed-out" if timeout else "agent-error" if failed else "finished",
                        "agent_exit": int(failed), "tmp_deleted": True, "task_id": task, "dry_run": plan["dryRun"],
                        "task_manifest_sha256": card["datasetManifestHash"], "model": config["modelId"],
                        "effort": config["effort"], "cli_version": config["cliVersion"],
                        "contaminated": "CONTAMINATED:fixture" if contaminated else "clean"}
                if p.arm_registry()[arm]["family"] == "codex":
                    meta.update(model_reported=[CODEX], effort_reported=["high"])
                if arm == "codex-tools":
                    meta.update(toolpack_profile="checks", toolpack_sha256=config["toolpack"]["sha256"],
                                toolpack_check="verified", toolpack_intact_after_run=True)
                p.atomic(target / "meta.json", meta)
                p.atomic(target / "run_status.json", {"exit_code": int(failed), "signal": None, "timed_out": timeout})
                if name not in NO_DELIVERABLES:
                    p.atomic(target / "workdir/results.json", {"claims": []})
                return subprocess.CompletedProcess(cmd, int(failed))
            self.assertTrue(cmd[1].endswith("grade-task.sh"))
            task, target = cmd[2], Path(cmd[3])
            self.grades.append(target.name)
            (target / "grade").mkdir()
            dirty = str(p.read(target / "meta.json").get("contaminated")).startswith("CONTAMINATED")
            ok = (target / "workdir/results.json").exists() and not dirty
            p.atomic(target / "grade/task-summary.json", {"task": task, "attempt": target.name, "credited": ok,
                "task_passed": ok, "reproduced": True, "contamination": "CONTAMINATED" if dirty else "none-found", "check": {"items": []},
                "rerun": {"ran": True, "exit_code": 0, "timed_out": False, "tmp_deleted": True}})
            return subprocess.CompletedProcess(cmd, 0)
        return send

    def run_plan(self, plan=None, state=None, digest="fixture-hash", **kwargs):
        plan = plan or self.plan
        report = {}
        rows = p.run(plan, state or self.state, digest, -1, now=lambda: next(self.ticks), free=lambda _: 2**50,
                     wall_now=lambda: 1000 + next(self.ticks), report=report,
                     executor=lambda *a: p.execute(*a, transport=self.transport(plan), free=lambda _: 2**50), **kwargs)
        return rows, report

    def execute(self, name, plan=None, retry=0, arm="plain-claude"):
        plan = plan or self.plan
        spec = next(r for r in p.schedule(plan) if r["arm"] == arm and r["phase"] == "main")
        self.streams[spec["id"]] = [name]
        return p.execute(plan, {**spec, "retry": retry}, self.state, -1, transport=self.transport(plan), free=lambda _: 2**50)

    def slot(self, plan, phase, task, arm="plain-claude"):
        return next(r["id"] for r in p.schedule(plan) if (r["phase"], r["task"], r["arm"]) == (phase, task, arm))

    # 1. Parser discipline -------------------------------------------------------------------------------------------
    def test_parser_reads_only_structured_cli_fields(self):
        expected = {"shape-a": (["assistant.api_error:refusal", "result:is_error:refusal"], ["cyber"], 1, 0, True, False),
                    "shape-b": (["assistant.api_error:refusal"], ["cyber"], 1, 1, False, False),
                    "fallback": (["system:model_refusal_fallback"], ["cyber"], 1, 1, False, True),
                    "spoof": ([], [], 0, 0, False, False), "clean": ([], [], 0, 0, False, False),
                    "synthetic-unflagged": ([], [], 0, 0, False, False)}
        keys = ("signals", "categories", "refusals", "transient", "terminal", "fallback")
        for name, want in expected.items():
            with self.subTest(stream=name):
                self.write(name)
                found = telemetry.provider_refusal(self.state, "claude")
                self.assertEqual(tuple(found[k] for k in keys), want, found)
                # Codex has no refusal mechanism here: never a signal, even for a Claude-shaped stream.
                self.assertEqual(tuple(telemetry.provider_refusal(self.state, "codex")[k] for k in keys), ([], [], 0, 0, False, False))
                self.assertEqual(telemetry.telemetry(self.state, {}, "claude")["providerRefusals"], want[2])
        # message.content is never read: emptied or contradicting content still refuses, a content-only block does nothing.
        for content in ([], [{"type": "text", "text": "Task complete; no refusal occurred."}]):
            self.write([init(), refusal(content), result(True)])
            self.assertTrue(telemetry.provider_refusal(self.state, "claude")["terminal"])
        self.write([init(), turn(content=[{"type": "fallback", "from": MODEL, "to": FALLBACK}]), result(False)])
        self.assertEqual(telemetry.provider_refusal(self.state, "claude")["signals"], [])
        # The wrapper decides: no flag, a real model, non-zero usage or another stop reason is no refused turn.
        edits = (lambda e: e.pop("is_api_error_message"), lambda e: e["message"].update(model=MODEL),
                 lambda e: e["message"]["usage"].update(output_tokens=7), lambda e: e["message"].update(stop_reason="end_turn"),
                 lambda e: e.update(is_api_error_message="true"))
        for edit in edits:
            event = refusal()
            edit(event)
            self.write([init(), event, result(True)])
            self.assertEqual(telemetry.provider_refusal(self.state, "claude")["signals"], [])
        # Terminal needs the CLI's own error result right after the refused turn; later CLI work makes it transient.
        self.write([init(), refusal(), result(False)])
        self.assertFalse(telemetry.provider_refusal(self.state, "claude")["terminal"])
        self.write([init(), refusal(), turn(), result(True)])
        self.assertEqual(telemetry.provider_refusal(self.state, "claude")["transient"], 1)
        # Identity: the CLI api-error "<synthetic>" entry is no model; the fallback model is.
        self.write("shape-b")
        observed = telemetry.telemetry(self.state, {}, "claude")
        self.assertEqual((observed["reportedModels"], observed["syntheticMessages"]), ([MODEL] * 4, 1))
        self.write("fallback")
        self.assertEqual(telemetry.telemetry(self.state, {}, "claude")["reportedModels"], [MODEL, MODEL, FALLBACK, FALLBACK, MODEL, FALLBACK])
        self.assertTrue(telemetry.telemetry(self.state, {}, "claude")["refusalFallback"])
        # A Codex arm never gets Claude CLI semantics: "<synthetic>" stays an observed model there.
        self.write("shape-b")
        self.assertIn("<synthetic>", telemetry.telemetry(self.state, {}, "codex")["reportedModels"])
        self.assertEqual(telemetry.telemetry(self.state, {}, "codex")["providerRefusals"], 0)

    # 2. Shape A ------------------------------------------------------------------------------------------------------
    def test_shape_a_is_provider_refused_requeued_in_a_fresh_session_then_exhausted(self):
        exhausted, resolved = self.slot(self.plan, "main", "p10-pseudorep"), self.slot(self.plan, "main", "p9-leakage")
        self.streams = {exhausted: ["shape-a"] * 3, resolved: ["shape-a", "clean"]}
        rows, report = self.run_plan()
        spent = [r for r in rows if r["id"] == exhausted]
        self.assertEqual([(r["status"], r["retry"], r["providerRefusalEvents"], r["refusalRetry"], r["executionRetry"],
                           r["infrastructure"], r["failure"], r["graded"]) for r in spent],
                         [("provider-refused", 0, 1, 0, 0, "provider-refused", "provider-refused", None),
                          ("provider-refused", 1, 2, 1, 0, "provider-refused", "provider-refused", None),
                          ("provider-refused", 2, 3, 2, 0, "provider-refused-exhausted", "provider-refused", None)])
        self.assertTrue(all(r["providerRefusal"]["categories"] == ["cyber"] and r["deliverables"] is False and
                            r["taskPassed"] is False and r["provenanceOk"] is False for r in spent))
        retried = [r for r in rows if r["id"] == resolved]
        self.assertEqual([(r["status"], r["retry"], r["refusalRetry"], r["executionRetry"]) for r in retried],
                         [("provider-refused", 0, 0, 0), ("completed", 1, 1, 0)])
        self.assertTrue(retried[-1]["taskPassed"])
        # Fresh sessions run at once, at the same schedule position (consecutive rows).
        sequence = [r["id"] for r in rows]
        self.assertEqual(sequence[sequence.index(exhausted):sequence.index(exhausted) + 3], [exhausted] * 3)
        self.assertEqual(len(rows), len(p.schedule(self.plan)) + 3)
        self.assertFalse(any(p.attempt_path(self.state, r).name in self.grades for r in spent + retried[:1]))
        self.assertEqual([x["id"] for x in report["refusalExhausted"]], [exhausted])
        self.assertEqual(report["refusalPending"], [])
        message = p.refusal_message(report, self.plan)
        self.assertIn("4 session(s) ended on a provider safety refusal", message)
        self.assertIn("exceeded refusalRetries: provider-refused-exhausted", message)
        self.assertEqual(self.run_plan()[0], rows)  # never relaunched
        scored = p.score(self.plan, self.state, "fixture-hash")
        self.assertTrue(scored["orderValid"])
        self.assertFalse(scored["complete"])
        claude = next(a for a in scored["arms"] if a["arm"] == "plain-claude")
        self.assertEqual((claude["denominator"], claude["successes"], claude["crashes"], claude["providerRefusedRuns"],
                          claude["providerRefusedUnresolvedRuns"], claude["providerRefusedExhaustedRuns"]), (2, 2, 0, 4, 1, 1))
        self.assertAlmostEqual(claude["providerRefusalRate"], 4 / 6)
        self.assertEqual(claude["availability"], "available")
        for pair in scored["comparisons"]:
            self.assertEqual(any(r.startswith("provider refusal: 1 unresolved") for r in pair["incompleteReasons"]),
                             "plain-claude" in (pair["b"], pair["c"]))
        self.assertEqual(sorted((x["retry"], x["resolved"]) for x in scored["providerRefused"] if x["id"] == exhausted),
                         [(0, False), (1, False), (2, False)])
        self.assertEqual([x["resolved"] for x in scored["providerRefused"] if x["id"] == resolved], [True])
        self.assertEqual(scored["infrastructureUnknowns"], [])
        self.assertEqual(scored["provenanceUnavailable"], [])
        self.assertIn("Provider refusals: 4 refused session(s) excluded as infrastructure", scored["markdown"])
        self.assertIn(f"Provider-refused {exhausted}/r2 (plain-claude): refusal retries exhausted", scored["markdown"])
        self.assertIn("| plain-claude | 4 (1, 1) | 0.6667 | 0 | 0 |", scored["markdown"])

    def test_stopped_run_requeues_the_refused_slot_first_on_resume(self):
        first = next(r for r in p.schedule(self.plan) if r["arm"] == "plain-claude")
        target = first["id"]
        self.streams = {target: ["shape-a", "clean"]}
        rows, report = self.run_plan(max_runs=1 + p.schedule(self.plan).index(first))
        self.assertEqual(rows[-1]["status"], "provider-refused")
        self.assertEqual([x["id"] for x in report["refusalPending"]], [target])
        rows, _ = self.run_plan()
        self.assertEqual([r["status"] for r in rows if r["id"] == target], ["provider-refused", "completed"])
        self.assertTrue(p.score(self.plan, self.state, "fixture-hash")["orderValid"])

    def test_timeout_with_refusal_stream_stays_an_arm_timeout(self):
        # Like rate limits: only a CLI that exited by itself can be reclassified; the agent controls a hang.
        row = self.execute("shape-a-timeout")
        self.assertEqual((row["status"], row["graded"]), ("timeout", True))
        self.assertNotIn("infrastructure", row)

    # 3. Shape B ------------------------------------------------------------------------------------------------------
    def test_shape_b_is_graded_normally_with_provider_refusals(self):
        live = self.live_plan()
        row = self.execute("shape-b", live, retry=7)
        self.assertEqual((row["status"], row["graded"], row["provenanceOk"], row["taskPassed"], row["gradeOutcome"], row["failure"]),
                         ("completed", True, True, True, "accepted", None))
        self.assertEqual((row["providerRefusals"], row["syntheticMessages"], row["provenanceFailure"]), (1, 1, None))
        self.assertNotIn("<synthetic>", row["provenance"]["reportedModels"])
        self.assertNotIn("infrastructure", row)
        self.streams[self.slot(self.plan, "main", "p9-leakage")] = ["shape-b"]
        rows, _ = self.run_plan()
        scored = p.score(self.plan, self.state, "fixture-hash")
        claude = next(a for a in scored["arms"] if a["arm"] == "plain-claude")
        self.assertEqual((claude["denominator"], claude["successes"], claude["providerRefusedRuns"], claude["providerRefusalTransientRuns"]),
                         (3, 3, 0, 1))
        self.assertTrue(scored["complete"])
        self.assertIn("1 graded run(s) rode out a refused turn", scored["markdown"])

    # 4. Fallback -----------------------------------------------------------------------------------------------------
    def test_refusal_fallback_stays_a_provenance_failure_labelled_refusal_fallback(self):
        row = self.execute("fallback", self.live_plan())
        self.assertEqual((row["status"], row["graded"], row["provenanceOk"], row["failure"], row["provenanceFailure"],
                          row["gradeOutcome"], row["taskPassed"]),
                         ("completed", True, False, "provenance-unverified", "refusal-fallback", "unavailable", False))
        self.assertIn(FALLBACK, row["provenance"]["reportedModels"])
        self.assertEqual(row["providerRefusals"], 1)
        self.assertNotIn("infrastructure", row)

    # 5. Agent-printed text --------------------------------------------------------------------------------------------
    def test_agent_text_or_tool_output_with_refusal_shapes_produces_no_signal(self):
        self.write("spoof")
        self.assertEqual(telemetry.provider_refusal(self.state, "claude")["signals"], [])
        self.assertEqual(telemetry.telemetry(self.state, {}, "claude")["syntheticMessages"], 0)
        row = self.execute("spoof", self.live_plan())
        self.assertEqual((row["status"], row["graded"], row["provenanceOk"], row["providerRefusals"]), ("failed", True, True, 0))
        self.assertNotIn("infrastructure", row)
        # Nor can agent text suppress a real terminal refusal written by the CLI.
        stream = STREAMS["shape-a"]()
        stream[1]["message"]["content"] = [{"type": "text", "text": "No refusal; analysis finished."}]
        STREAMS["suppressed"] = lambda: copy.deepcopy(stream)
        FAILS.add("suppressed")
        NO_DELIVERABLES.add("suppressed")
        self.addCleanup(lambda: (STREAMS.pop("suppressed"), FAILS.discard("suppressed"), NO_DELIVERABLES.discard("suppressed")))
        self.assertEqual(self.execute("suppressed", retry=1)["status"], "provider-refused")

    # 6. "<synthetic>" without the CLI api-error flag ------------------------------------------------------------------
    def test_synthetic_model_without_the_cli_api_error_flag_fails_provenance(self):
        live = self.live_plan()
        nonzero = refusal()
        nonzero["message"]["usage"]["output_tokens"] = 4
        cases = {"synthetic-unflagged": STREAMS["synthetic-unflagged"](),
                 "nonzero-usage": [init(), turn(), nonzero, turn(), result(False)],
                 "init-synthetic": [init("<synthetic>"), turn(), refusal(), turn(), result(False)],
                 "model-usage-only": [init(), turn(), {**result(False), "modelUsage": {MODEL: {"inputTokens": 5},
                                                                                   "<synthetic>": {"inputTokens": 0, "outputTokens": 0}}}]}
        for retry, (name, events) in enumerate(cases.items()):
            with self.subTest(case=name):
                STREAMS[name] = lambda events=events: copy.deepcopy(events)
                self.addCleanup(STREAMS.pop, name)
                row = self.execute(name, live, retry)
                self.assertEqual((row["status"], row["provenanceOk"], row["failure"], row["provenanceFailure"]),
                                 ("completed", False, "provenance-unverified", None))
                self.assertIn("<synthetic>", row["provenance"]["reportedModels"])
                self.assertEqual(row["syntheticMessages"], int(name == "init-synthetic"))
        # A zero-usage "<synthetic>" modelUsage entry next to a CLI refusal message is dropped consistently, in the
        # real CLI shape (capacity fields contextWindow/maxOutputTokens are never usage) ...
        def flagged(entry):
            return lambda: [init(), turn(), refusal(), turn(), {**result(False), "modelUsage": {MODEL: {"inputTokens": 5}, "<synthetic>": entry}}]
        cases = {"model-usage-flagged": (ZERO_MODEL_USAGE, True), "model-usage-minimal": ({"inputTokens": 0}, True),
                 # ... but any token or cost, or an unknown non-numeric field, keeps it: provenance fails closed.
                 "model-usage-tokens": ({**ZERO_MODEL_USAGE, "outputTokens": 3}, False),
                 "model-usage-cost": ({**ZERO_MODEL_USAGE, "costUSD": 0.01}, False),
                 "model-usage-nested": ({**ZERO_MODEL_USAGE, "breakdown": {"inputTokens": 0}}, False)}
        for retry, (name, (entry, ok)) in enumerate(cases.items(), 9):
            with self.subTest(case=name):
                STREAMS[name] = flagged(entry)
                self.addCleanup(STREAMS.pop, name)
                row = self.execute(name, live, retry)
                self.assertEqual((row["provenanceOk"], "<synthetic>" in row["provenance"]["reportedModels"]), (ok, not ok), row["provenance"])
        # Without a CLI refusal/limit message in the stream, even a zero entry stays a model.
        STREAMS["model-usage-auth"] = lambda: [init(), api_error(), {**result(True), "modelUsage": {MODEL: {"inputTokens": 5}, "<synthetic>": ZERO_MODEL_USAGE}}]
        self.addCleanup(STREAMS.pop, "model-usage-auth")
        self.write("model-usage-auth")
        self.assertEqual(telemetry.telemetry(self.state, {}, "claude")["reportedModels"], [MODEL, "<synthetic>", MODEL, "<synthetic>"])

    # 7. Precedence ---------------------------------------------------------------------------------------------------
    def test_terminal_rate_limit_takes_precedence_over_refusal(self):
        cases = {"rate-then-refusal": ("provider-refused", True, 1), "refusal-then-rate": ("rate-limited", True, 1),
                 "both-terminal": ("rate-limited", True, 1)}
        for retry, (name, (status, limited, refusals)) in enumerate(cases.items()):
            with self.subTest(stream=name):
                row = self.execute(name, retry=retry)
                self.assertEqual((row["status"], row["rateLimited"], row["providerRefusals"], row["graded"]),
                                 (status, limited, refusals, None))
                self.assertEqual(row["infrastructure"], status)
                self.assertEqual("rateLimit" in row, status == "rate-limited")
        self.write("both-terminal")
        self.assertTrue(telemetry.provider_refusal(self.state, "claude")["terminal"])
        self.assertTrue(telemetry.rate_limit(self.state, "claude")["terminal"])

    # 7b. Fallback / foreign model, then a terminal refusal ---------------------------------------------------------
    def test_fallback_or_model_switch_then_terminal_refusal_stays_a_provenance_failure(self):
        live = self.live_plan()
        for retry, (name, label) in enumerate((("fallback-terminal", "refusal-fallback"), ("switch-terminal", None))):
            with self.subTest(stream=name):
                self.write(name)
                self.assertTrue(telemetry.provider_refusal(self.state, "claude")["terminal"])
                row = self.execute(name, live, retry)
                self.assertEqual((row["status"], row["graded"], row["provenanceOk"], row["failure"], row["provenanceFailure"],
                                  row["gradeOutcome"], row["taskPassed"]),
                                 ("failed", True, False, "provenance-unverified", label, "unavailable", False))
                self.assertIn(FALLBACK, row["provenance"]["reportedModels"])
                self.assertNotIn("infrastructure", row)
        self.assertEqual(len(self.grades), 2)  # graded, never recycled as infrastructure
        # Never re-queued: the arm stays provenance-unavailable instead of getting a fresh session.
        self.reset_study("study-run")
        target = self.slot(live, "main", "p10-pseudorep")
        self.streams = {target: ["fallback-terminal", "clean"]}
        rows, report = self.run_plan(live)
        self.assertEqual([r["status"] for r in rows if r["id"] == target], ["failed"])
        self.assertEqual(report["providerRefusals"], 0)
        self.assertIn("plain-claude", p.score(live, self.state, "fixture-hash")["provenanceUnavailable"])
        # A fallback is a provenance failure on a dry plan too (a dry plan checks no declared model).
        self.assertNotEqual(self.execute("fallback-terminal", retry=5)["status"], "provider-refused")

    def test_supplement_never_reruns_fallback_or_model_switch_refusals(self):
        live = self.live_plan()
        a, b = self.slot(live, "main", "p10-pseudorep"), self.slot(live, "main", "p9-leakage")
        plan, head, original = self.original_study({a: ["fallback-terminal"], b: ["switch-terminal"]})
        by_id = {r["id"]: r for r in original}
        self.assertEqual([by_id[x]["failure"] for x in (a, b)], ["provenance-unverified"] * 2)
        study = p.verify_registration(p.read(self.state / "registration.json"), frozen=True)
        self.assertEqual(p.supplement_candidates(plan, self.state, study, original), ([], []))

    # 7c. A session that worked before its refusal ---------------------------------------------------------------
    def test_contaminated_session_ending_on_a_refusal_is_graded_and_worked_sessions_are_shown(self):
        live = self.live_plan()
        row = self.execute("late-refusal-contaminated", live)
        self.assertEqual((row["status"], row["graded"], row["provenanceOk"], row["gradeOutcome"], row["credited"], row["taskPassed"]),
                         ("failed", True, True, "rejected", False, False))
        self.assertNotIn("infrastructure", row)
        self.assertEqual(len(self.grades), 1)  # contamination reaches the grader; no fresh draw
        clean = self.execute("late-refusal", live, retry=1)
        self.assertEqual((clean["status"], clean["deliverables"], clean["contamination"], clean["providerRefusal"]["agentMessages"]),
                         ("provider-refused", True, "clean", 3))
        self.assertEqual(self.execute("shape-a", live, retry=2)["providerRefusal"]["agentMessages"], 0)
        # In a study: the worked, refused session is excluded but listed with its work; the slot gets a fresh session.
        self.reset_study("study-run")
        target = self.slot(self.plan, "main", "p10-pseudorep")
        self.streams = {target: ["late-refusal", "clean"]}
        rows, _ = self.run_plan()
        self.assertEqual([r["status"] for r in rows if r["id"] == target], ["provider-refused", "completed"])
        scored = p.score(self.plan, self.state, "fixture-hash")
        self.assertEqual([(x["agentMessages"], x["deliverables"]) for x in scored["providerRefused"]], [(3, True)])
        self.assertIn("1 refused session(s) ended after agent work.", scored["markdown"])
        self.assertIn(f"Provider-refused after agent work {target}/r0 (plain-claude): 3 agent message(s), deliverables present.",
                      scored["markdown"])

    def test_supplement_reassesses_a_contaminated_refused_session_as_graded(self):
        live = self.live_plan()
        a = self.slot(live, "main", "p10-pseudorep")
        plan, head, original = self.original_study({a: ["late-refusal-contaminated"]})
        self.assertEqual(next(r for r in original if r["id"] == a)["failure"], "provenance-unverified")
        record, study, added, _ = self.supplement(plan)
        self.assertEqual((record["rerun"], [e["id"] for e in record["regrade"]]), ([], [a]))
        self.assertEqual(self.dispatches, [])
        self.assertEqual([(r["status"], r["gradeOutcome"], r["provenanceOk"], r["supplement"]["kind"]) for r in added],
                         [("failed", "rejected", True, "regrade")])

    # 7d. Other CLI api errors ----------------------------------------------------------------------------------------
    def test_api_errors_other_than_refusals_or_limits_keep_synthetic_and_are_never_selected(self):
        live = self.live_plan()
        for retry, name in enumerate(("auth-fail", "server-error")):
            with self.subTest(stream=name):
                row = self.execute(name, live, retry)
                self.assertEqual((row["status"], row["failure"], row["provenanceOk"], row["gradeOutcome"]),
                                 ("failed", "provenance-unverified", False, "unavailable"))
                self.assertIn("<synthetic>", row["provenance"]["reportedModels"])
                self.assertEqual((row["providerRefusals"], row["syntheticMessages"]), (0, 1))
        # Another CLI api error after a refused turn is no model work: the refusal stays terminal in the parser ...
        self.write("refusal-then-auth")
        self.assertTrue(telemetry.provider_refusal(self.state, "claude")["terminal"])
        # ... and its kept "<synthetic>" is a foreign model, so the live controller grades it: provenance unavailable.
        row = self.execute("refusal-then-auth", live, 2)
        self.assertEqual((row["status"], row["failure"]), ("failed", "provenance-unverified"))
        self.assertEqual(self.execute("refusal-then-auth", retry=3)["status"], "provider-refused")  # dry: no identity check
        # A rate-limit message's "<synthetic>" is dropped like a refusal's.
        self.write([init(), turn(), limit_message(), turn(), result(False)])
        self.assertEqual(telemetry.telemetry(self.state, {}, "claude")["reportedModels"], [MODEL, MODEL, MODEL, MODEL])
        # The supplement selects only rows with real refused turns: auth/server failures stay unavailable.
        self.reset_study("supplement")
        a, b, c = (self.slot(live, "main", t) for t in ("p10-pseudorep", "p9-leakage", "w0-venet"))
        plan, head, original = self.original_study({a: ["auth-fail"], b: ["server-error"], c: ["shape-b"]})
        study = p.verify_registration(p.read(self.state / "registration.json"), frozen=True)
        rerun, regrade = p.supplement_candidates(plan, self.state, study, original)
        self.assertEqual((rerun, [e["id"] for e in regrade]), ([], [c]))
        record, study, added, _ = self.supplement(plan)
        without, with_, merged = self.scoreboards(plan)
        self.assertIn("plain-claude", with_["provenanceUnavailable"])
        self.assertIn("0 provider-refused slot(s) re-run, 1 refused-turn row(s) re-assessed", with_["markdown"])

    # 8. Old registrations --------------------------------------------------------------------------------------------
    def test_old_registration_keeps_the_pinned_rules_and_new_studies_need_refusal_retries(self):
        old = legacy(self.live_plan())
        self.assertEqual(p.validate(old), old)  # an existing legacy registration still verifies
        self.assertEqual(p.refusal_retries(old), 0)
        self.assertFalse(p.refusal_aware(old))
        self.assertTrue(p.refusal_aware(self.plan))
        for value in (-1, 11, True, 1.5, "2", None):
            bad = copy.deepcopy(self.plan)
            bad["retryRule"]["refusalRetries"] = value
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, "retry rule"):
                p.validate(bad)
        # A NEW study cannot be locked without refusalRetries (a copied plan.json would silently disable re-queues).
        with self.assertRaisesRegex(ValueError, "must register retryRule.refusalRetries"):
            p.locked(old, self.state, True)
        self.assertFalse((self.state / "registration.json").exists())
        head = self.legacy_lock(old)
        self.assertEqual(p.locked(old, self.state, True), head)  # verifying an existing one is fine
        registration = p.read(self.state / "registration.json")
        self.assertNotIn("refusalRetries", registration["plan"]["retryRule"])
        fp = p.fingerprint(old)
        explicit = {**old, "retryRule": {**old["retryRule"], "refusalRetries": 0}}
        self.assertNotEqual(head, p.hashes([p.settings_object(explicit, fp["armRegistry"], fp["grader"])])[0])
        with self.assertRaisesRegex(ValueError, "cannot change retryRule"):
            p.amend(explicit, self.state, "add refusal retries")
        with self.assertRaisesRegex(ValueError, "locked"):
            p.locked(explicit, self.state)
        # Resumed from this code, every row classifies exactly as the pinned controller (simulated: fc62160 telemetry).
        streams = ("shape-a", "shape-b", "fallback", "fallback-terminal", "late-refusal", "auth-fail", "rate-then-refusal",
                   "synthetic-unflagged", "spoof")
        claude = [r["id"] for r in p.schedule(old) if r["arm"] == "plain-claude"]
        self.streams = {slot: [name, "clean"] for slot, name in zip(claude, streams)}
        rows, report = self.run_plan(old, digest=head)
        pinned_state = Path(self.tmp.name) / "pinned"
        pinned_state.mkdir()
        pinned_head = self.legacy_lock(old, pinned_state)
        self.streams = {slot: [name, "clean"] for slot, name in zip(claude, streams)}
        with patch.object(p, "telemetry", pinned_telemetry):
            pinned, _ = self.run_plan(old, pinned_state, digest=pinned_head)
        verdict = lambda rs: [(r["id"], r["retry"], r["status"], r.get("failure"), r.get("graded"), r["gradeOutcome"], r["provenanceOk"],
                               r["taskPassed"], (r["provenance"] or {}).get("reportedModels"), r.get("tokenUsageComplete")) for r in rs]
        self.assertEqual(verdict(rows), verdict(pinned))
        self.assertEqual(len(rows), len(p.schedule(old)))  # no re-queue, no provider-refused row
        by_id = {r["id"]: r for r in rows}
        self.assertEqual([(by_id[s]["status"], by_id[s]["failure"], by_id[s]["gradeOutcome"]) for s in claude[:2]],
                         [("failed", "provenance-unverified", "unavailable"), ("completed", "provenance-unverified", "unavailable")])
        self.assertIn("<synthetic>", by_id[claude[1]]["provenance"]["reportedModels"])
        self.assertFalse(any(r["status"] == "provider-refused" for r in rows))
        self.assertEqual((report["refusalPending"], report["refusalExhausted"], report["providerRefusals"]), ([], [], 0))
        # The pinned telemetry itself: identical models and token completeness for every stream.
        for name in STREAMS:
            self.write(name)
            self.assertEqual({k: telemetry.telemetry(self.state, {}, "claude", legacy=True)[k] for k in ("reportedModels", "tokenUsageComplete")},
                             {k: pinned_telemetry(self.state, {}, "claude")[k] for k in ("reportedModels", "tokenUsageComplete")}, name)
        # The checked-in locked plan has no key and validates as recorded.
        locked = p.normalize(p.read(p.HERE / "plan.json"))
        self.assertNotIn("refusalRetries", locked["retryRule"])
        self.assertFalse(p.refusal_aware(locked))
        p.validate(locked, p.discover(), frozen=True)

    # 9. Supplement ---------------------------------------------------------------------------------------------------
    def legacy_lock(self, plan, state=None):
        """Register `plan` exactly as the pinned fc62160 controller did (this code refuses new legacy locks), and
        commit its LOCKED-STUDY.json record in the fake repository."""
        state = state or self.state
        p.validate(plan)
        fp = p.fingerprint(plan)
        digest = p.hashes([p.settings_object(plan, fp["armRegistry"], fp["grader"])])[0]
        p.atomic(state / "registration.json", {"settingsHash": digest, "plan": plan, **fp, "schedule": p.schedule(plan),
                                               "amendments": []})
        self.git.files[p.STUDY_LOCK] = json.dumps({"studyId": plan["studyId"], "settingsHash": digest, "lockedAtCommit": LOCKED_AT})
        return p.locked(plan, state)

    def reset_study(self, name):
        self.state = Path(self.tmp.name) / name
        self.state.mkdir()
        self.out = p.supplement_dir(self.state)
        self.git = FakeGit()
        self.streams, self.dispatches, self.grades = {}, [], []

    def original_study(self, streams, plan=None, **kwargs):
        """A finished study locked before refusal support and recorded under its (pinned) rules."""
        plan = plan or legacy(self.live_plan())
        head = self.legacy_lock(plan)
        self.streams = {k: list(v) for k, v in streams.items()}
        rows, _ = self.run_plan(plan, digest=head, **kwargs)
        self.dispatches.clear()
        self.grades.clear()
        return plan, head, rows

    def anchor(self, record, study, git=None):
        """Commit the supplement's hash to LOCKED-SUPPLEMENT.json (in the fake repository)."""
        (git or self.git).files[p.SUPPLEMENT_LOCK] = json.dumps({"schema": "bio-pilot/locked-supplements@1", "supplements": [
            {"studyId": study["plan"]["studyId"], "studyHead": study["head"], "hash": record["hash"]}]})

    def register(self, plan, retries=2, git=None, **kwargs):
        return p.open_supplement(plan, self.state, self.out, REASON, retries, create=True, resume=True,
                                 now=lambda: "2026-10-12T00:00:00Z", git=git or self.git, **kwargs)

    def supplement(self, plan, streams=(), retries=2, max_runs=None, anchor=True):
        self.streams.update({k: list(v) for k, v in dict(streams).items()})
        record, study, rows = self.register(plan, retries)
        if anchor:
            self.anchor(record, study)
        report = {}
        added = p.supplement_run(plan, self.state, self.out, record, study, rows, -1, max_runs, git=self.git,
                                 now=lambda: next(self.ticks), free=lambda _: 2**50, wall_now=lambda: 5000 + next(self.ticks),
                                 report=report, executor=lambda *a: p.execute(*a, transport=self.transport(plan), free=lambda _: 2**50))
        return record, study, added, report

    def scoreboards(self, plan):
        record, study, rows = p.open_supplement(plan, self.state, self.out, git=self.git)
        merged = p.supplement_rows(self.state, self.out, record)
        common = {"history": study["plans"][:-1], "amendments": study["amendments"], "frozen": True}
        without = p.score(plan, self.state, study["head"], chain=study["chain"], **common)
        with_ = p.score(plan, self.state, study["head"], chain=[*study["chain"], record["hash"]], rows=merged,
                        supplement=p.supplement_info(record), **common)
        return without, with_, merged

    def test_supplement_selects_only_eligible_slots_and_never_rewrites_originals(self):
        live = self.live_plan()
        a, b = self.slot(live, "main", "p10-pseudorep"), self.slot(live, "main", "p9-leakage")
        others = {self.slot(live, "main", "w0-venet"): ["fallback"], self.slot(live, "start", "p10-pseudorep"): ["spoof"],
                  self.slot(live, "start", "p9-leakage"): ["synthetic-unflagged"], self.slot(live, "end", "p10-pseudorep"): ["limit-transient"]}
        plan, head, original = self.original_study({a: ["shape-a"], b: ["shape-b"], **others})
        # The pinned rules charged both refusal shapes as provenance failures.
        by_id = {r["id"]: r for r in original}
        self.assertEqual([(by_id[x]["status"], by_id[x]["failure"]) for x in (a, b, self.slot(live, "end", "p10-pseudorep"))],
                         [("failed", "provenance-unverified"), ("completed", "provenance-unverified"), ("completed", "provenance-unverified")])
        before = tree(self.state)
        with patch.object(p, "toolpack_settings", lambda *_a, **_k: {"profile": "checks", "sha256": "f" * 64}):
            # Main moved the tool pack: the study itself is refused there, its supplement still verifies as recorded.
            with self.assertRaisesRegex(ValueError, "tool pack changed"):
                p.open_study(plan, self.state)
            record, study, added, report = self.supplement(plan, {a: ["shape-a", "clean"]})
        self.assertEqual(tree(self.state), before)
        self.assertEqual([(e["id"], e["retry"], e["categories"]) for e in record["rerun"]], [(a, 0, ["cyber"])])
        self.assertEqual([(e["id"], e["retry"], e["summarySha256"]) for e in record["regrade"]], [(b, 0, by_id[b]["summarySha256"])])
        self.assertEqual((record["previous"], record["original"]["settingsHash"], record["commit"], record["refusalRetries"],
                          record["studyCommit"]), (head, head, COMMIT, 2, LOCKED_AT))
        self.assertEqual(record["original"]["runsSha256"], p.sha(self.state / "runs.json"))
        self.assertEqual(self.git.compared[0], (LOCKED_AT, p.HARNESS, p.CONTROLLER))  # harness bound to the study's commit
        self.assertEqual([d[0] for d in self.dispatches], [f"{a}-r1", f"{a}-r2"])  # only the refused slot, fresh sessions
        self.assertEqual(self.grades, [f"{p.runner_of('plain-claude')}-{a}-r2"])  # re-assessment never re-runs the grader
        self.assertEqual([(r["id"], r["retry"], r["status"], r["supplement"]["kind"]) for r in added],
                         [(a, 0, "provider-refused", "reclassified"), (b, 0, "completed", "regrade"),
                          (a, 1, "provider-refused", "rerun"), (a, 2, "completed", "rerun")])
        reclassified, regraded = added[0], added[1]
        self.assertEqual((reclassified["supersedes"]["status"], reclassified["supersedes"]["failure"], reclassified["sequence"],
                          reclassified["providerRefusalEvents"], reclassified["infrastructure"]),
                         ("failed", "provenance-unverified", by_id[a]["sequence"], 1, "provider-refused"))
        self.assertEqual((regraded["provenanceOk"], regraded["taskPassed"], regraded["gradeOutcome"], regraded["providerRefusals"],
                          regraded["summarySha256"], regraded["supersedes"]["gradeOutcome"]),
                         (True, True, "accepted", 1, by_id[b]["summarySha256"], "unavailable"))
        self.assertTrue(all(r["settingsHash"] == record["hash"] for r in added[2:]))
        self.assertEqual(report["refusalExhausted"], [])
        # Resume launches nothing more and duplicates nothing.
        self.assertEqual(self.supplement(plan)[2], added)
        self.assertEqual(tree(self.state), before)
        without, with_, merged = self.scoreboards(plan)
        self.assertEqual(len(merged), len(original) + 2)
        self.assertEqual([r for r in merged if "supplement" not in r], [r for r in original if r["id"] not in (a, b)])
        self.assertEqual(with_["supplement"]["rerunSlots"], [a])
        self.assertEqual(with_["supplement"]["regradedRows"], [f"{b}/r0"])
        self.assertTrue(with_["orderValid"] and with_["supplement"]["orderValid"])
        self.assertEqual([(x["retry"], x["resolved"], x["supplement"]) for x in with_["providerRefused"]],
                         [(0, True, "reclassified"), (1, True, "rerun")])
        # The unselected fallback and unflagged-synthetic rows still fail provenance: the arm stays unavailable.
        self.assertIn("plain-claude", with_["provenanceUnavailable"])
        self.assertIsNone(without["supplement"])
        self.assertIn("Supplement 1 (", with_["markdown"])

    def test_supplement_with_and_without_and_refusal_budget(self):
        live = self.live_plan()
        a, b = self.slot(live, "main", "p10-pseudorep"), self.slot(live, "main", "p9-leakage")
        plan, head, original = self.original_study({a: ["shape-a"], b: ["shape-b"]})
        record, study, added, _ = self.supplement(plan, {a: ["clean"]})
        without, with_, merged = self.scoreboards(plan)
        self.assertIn("plain-claude", without["provenanceUnavailable"])
        self.assertEqual(with_["provenanceUnavailable"], [])
        self.assertTrue(with_["complete"] and with_["orderValid"])
        claude = next(x for x in with_["arms"] if x["arm"] == "plain-claude")
        self.assertEqual((claude["availability"], claude["denominator"], claude["successes"], claude["providerRefusedRuns"],
                          claude["providerRefusalTransientRuns"], claude["supplementRuns"]), ("available", 3, 3, 1, 1, 1))
        pair = next(x for x in with_["comparisons"] if "plain-claude" in (x["b"], x["c"]))
        self.assertEqual(pair["supplementRuns"], 1)
        self.assertIn("SUPPLEMENTED: 1 run(s) re-run after the study", with_["markdown"])
        # Refusal budget counts the original refusal: refusalRetries 2 allows two fresh sessions in all (a new study:
        # a study has exactly one supplement).
        self.reset_study("budget")
        plan, head, original = self.original_study({a: ["shape-a"]})
        record, study, added, report = self.supplement(plan, {a: ["shape-a", "shape-a"]})
        self.assertEqual([(r["retry"], r.get("infrastructure")) for r in added if r["id"] == a],
                         [(0, "provider-refused"), (1, "provider-refused"), (2, "provider-refused-exhausted")])
        self.assertEqual([x["id"] for x in report["refusalExhausted"]], [a])
        self.assertFalse(self.scoreboards(plan)[1]["complete"])
        # refusalRetries 0: the reclassified refusal is already exhausted; nothing is launched.
        self.reset_study("zero")
        plan, head, original = self.original_study({a: ["shape-a"]})
        record, study, added, report = self.supplement(plan, {a: ["clean"]}, retries=0)
        self.assertEqual([(r["retry"], r["infrastructure"], r["providerRefusalEvents"]) for r in added if r["id"] == a],
                         [(0, "provider-refused-exhausted", 1)])
        self.assertEqual(self.dispatches, [])

    def test_supplement_is_one_per_study_and_runs_only_once_its_hash_is_committed(self):
        live = self.live_plan()
        a = self.slot(live, "main", "p10-pseudorep")
        plan, head, original = self.original_study({a: ["shape-a"]})
        # Only the directory next to the study state.
        for other in (self.out.with_name("study-supplement-2"), self.state / "inside"):
            with self.subTest(out=other), self.assertRaisesRegex(ValueError, "one supplement"):
                p.open_supplement(plan, self.state, other, REASON, create=True, resume=True, git=self.git)
        # Registration seals the record and its seed rows and launches nothing; the session waits for the anchor.
        self.streams = {a: ["clean"]}
        record, study, rows = self.register(plan)
        self.assertEqual([r["supplement"]["kind"] for r in p.read(self.out / "runs.json")], ["reclassified"])
        with self.assertRaisesRegex(ValueError, "commit the supplement hash"):
            p.supplement_run(plan, self.state, self.out, record, study, rows, -1, git=self.git)
        self.assertEqual(self.dispatches, [])
        args = argparse.Namespace(command="score", adjudications=None)
        with patch.object(p, "GIT", self.git), self.assertRaisesRegex(ValueError, "scored only once"):
            p.supplement_command(args, plan, self.state, self.out, -1)
        # Two registrations never share a hash, even at the same second and commit.
        twin = copy.deepcopy(record)
        twin["nonce"] = "0" * 32
        self.assertNotEqual(p.hashes([{k: v for k, v in twin.items() if k != "hash"}])[0], record["hash"])
        with self.assertRaisesRegex(ValueError, "already registered"):
            p.exclusive(self.out / "supplement.json", {})
        self.anchor(record, study)
        _, _, added, _ = self.supplement(plan)
        self.assertEqual([d[0] for d in self.dispatches], [f"{a}-r1"])
        with patch.object(p, "GIT", self.git), contextlib.redirect_stdout(io.StringIO()):
            p.supplement_command(args, plan, self.state, self.out, -1)
        self.assertTrue((self.out / "scoreboard.json").is_file())
        # Re-rolling is refused: a deleted and re-registered supplement while the anchor stands ...
        saved = {f: f.read_bytes() for f in self.out.rglob("*") if f.is_file()}
        import shutil
        shutil.rmtree(self.out)
        with self.assertRaisesRegex(ValueError, "already locks a supplement"):
            self.register(plan)
        # ... and, with the anchor dropped, a second registration that can neither run nor be scored once it is restored.
        dropped = FakeGit()
        dropped.files[p.STUDY_LOCK] = self.git.files[p.STUDY_LOCK]
        second, _, _ = self.register(plan, git=dropped)
        self.assertNotEqual(second["hash"], record["hash"])
        with self.assertRaisesRegex(ValueError, "locks another supplement"):
            p.open_supplement(plan, self.state, self.out, git=self.git)
        shutil.rmtree(self.out)
        for f, data in saved.items():
            f.parent.mkdir(parents=True, exist_ok=True)
            f.write_bytes(data)
        p.open_supplement(plan, self.state, self.out, git=self.git)
        # Removing the supplement's rows voids it: runs.json gone, or attempts left without their rows.
        runs = p.read(self.out / "runs.json")
        (self.out / "runs.json").unlink()
        with self.assertRaisesRegex(ValueError, "rows missing"):
            p.open_supplement(plan, self.state, self.out, git=self.git)
        p.atomic(self.out / "runs.json", runs[:1])
        with self.assertRaisesRegex(ValueError, "attempt without its row"):
            p.open_supplement(plan, self.state, self.out, git=self.git)
        p.atomic(self.out / "runs.json", runs)
        p.open_supplement(plan, self.state, self.out, git=self.git)

    def test_supplement_rows_accept_only_the_registered_selections(self):
        live = self.live_plan()
        a, b = self.slot(live, "main", "p10-pseudorep"), self.slot(live, "main", "p9-leakage")
        plan, head, original = self.original_study({a: ["shape-a"], b: ["shape-b"]})
        record, study, added, _ = self.supplement(plan, {a: ["clean"]})
        self.assertEqual(len(p.supplement_rows(self.state, self.out, record)), len(original) + 1)
        codex = next(r for r in original if r["arm"] == "codex-tools" and r["phase"] == "main")
        marker = lambda kind: {"supplement": p.supplement_marker(record, kind)}
        forged = {"unregistered regrade": ([*added, {**codex, "taskPassed": not codex["taskPassed"], **marker("regrade")}], "registered selections"),
                  "missing copy": ([r for r in added if r["supplement"]["kind"] != "regrade"], "registered selections"),
                  "kind swapped": ([{**added[0], **marker("regrade")}, *added[1:]], "registered selections"),
                  "identity changed": ([{**added[0], "sequence": 999}, *added[1:]], "registered selections"),
                  "unregistered slot": ([*added, {**codex, "retry": 1, "settingsHash": record["hash"], **marker("rerun")}], "registered slots"),
                  "wrong hash": ([*added[:-1], {**added[-1], "settingsHash": head}], "registered slots"),
                  "retry gap": ([*added[:-1], {**added[-1], "retry": 5}], "out of order"),
                  "other registration": ([*added[:-1], {**added[-1], "supplement": {**added[-1]["supplement"], "hash": "0" * 64}}], "another registration")}
        for name, (rows, message) in forged.items():
            with self.subTest(case=name):
                p.atomic(self.out / "runs.json", rows)
                with self.assertRaisesRegex(ValueError, message):
                    p.supplement_rows(self.state, self.out, record)
        p.atomic(self.out / "runs.json", added)

    def test_supplement_refuses_refusal_aware_registrations(self):
        # A study locked with refusalRetries already re-queued its refused slots under that locked budget.
        for retries in (0, 2):
            with self.subTest(refusalRetries=retries):
                self.reset_study(f"aware-{retries}")
                live = self.live_plan()
                live["retryRule"]["refusalRetries"] = retries
                a = self.slot(live, "main", "p10-pseudorep")
                head = p.locked(live, self.state, True)
                self.streams = {a: ["shape-a"] * (retries + 1)}
                rows, report = self.run_plan(live, digest=head)
                self.assertEqual([x["id"] for x in report["refusalExhausted"]], [a])
                self.dispatches.clear()
                with self.assertRaisesRegex(ValueError, "registered refusalRetries"):
                    self.register(live, retries=10)
                self.assertFalse((self.out / "supplement.json").exists())
                self.assertEqual(self.dispatches, [])
        # A provider-refused row inside a legacy study (only an unreleased build could write one) is refused too.
        self.reset_study("legacy")
        live = self.live_plan()
        a = self.slot(live, "main", "p10-pseudorep")
        plan, head, original = self.original_study({a: ["shape-a"]})
        study = p.verify_registration(p.read(self.state / "registration.json"), frozen=True)
        rows = [{**r, "status": "provider-refused"} if r["id"] == a else r for r in original]
        with self.assertRaisesRegex(ValueError, "provider-refused row in a study locked before refusal support"):
            p.supplement_candidates(plan, self.state, study, rows)

    def test_supplement_requires_every_slot_final_under_the_study_rules(self):
        live = self.live_plan()
        a = self.slot(live, "main", "p10-pseudorep")
        # A study stopped early (--max-runs, SIGINT or a provider pause) is unfinished: slots never ran.
        plan, head, original = self.original_study({a: ["shape-a"]}, max_runs=3)
        self.assertLess(len(original), len(p.schedule(plan)))
        with self.assertRaisesRegex(ValueError, "study unfinished"):
            self.register(plan)
        self.assertFalse(self.out.exists() and (self.out / "supplement.json").exists())
        self.reset_study("finished")
        plan, head, original = self.original_study({a: ["shape-a"]})
        study = p.verify_registration(p.read(self.state / "registration.json"), frozen=True)
        last = next(r for r in original if r["id"] == a)
        limited = {"status": "rate-limited", "dispatched": True, "graded": None}
        cases = {"no row": ([r for r in original if r["id"] != a], True),
                 "running": ([*original, {**last, "retry": 1, "status": "running", "dispatched": False}], True),
                 "ungraded": ([*[r for r in original if r["id"] != a], {**last, "graded": False}], True),
                 "not started": ([*[r for r in original if r["id"] != a], {**last, "status": "not-started"}], True),
                 "interrupted, retry left": ([*[r for r in original if r["id"] != a], {**last, "status": "interrupted"}], True),
                 "rate-limited, retry left": ([*[r for r in original if r["id"] != a], {**last, **limited}], True),
                 "rate-limited, exhausted": ([*[r for r in original if r["id"] != a],
                                              *({**last, **limited, "retry": k} for k in range(plan["retryRule"]["rateLimitRetries"] + 1))], False)}
        for name, (rows, unfinished) in cases.items():
            with self.subTest(case=name):
                if unfinished:
                    with self.assertRaisesRegex(ValueError, "study unfinished"):
                        p.supplement_candidates(plan, self.state, study, rows)
                else:
                    p.supplement_candidates(plan, self.state, study, rows)

    def test_supplement_skips_a_crashed_transport_row_without_exit_code(self):
        live = self.live_plan()
        a, b = self.slot(live, "main", "p10-pseudorep"), self.slot(live, "main", "p9-leakage")
        plan = legacy(live)
        head = self.legacy_lock(plan)
        self.streams = {a: ["shape-a"]}
        send = self.transport(plan)
        def crashing(cmd, **kwargs):
            done = send(cmd, **kwargs)
            if cmd[1].endswith("run-task.sh") and cmd[4].startswith(b):
                raise RuntimeError("transport fault after the agent started")
            return done
        run = lambda: p.run(plan, self.state, head, -1, now=lambda: next(self.ticks), free=lambda _: 2**50,
                            wall_now=lambda: 1000 + next(self.ticks),
                            executor=lambda *x: p.execute(*x, transport=crashing, free=lambda _: 2**50))
        with self.assertRaises(RuntimeError):
            run()
        rows = run()
        crashed = next(r for r in rows if r["id"] == b)
        self.assertEqual((crashed["status"], crashed["failure"], crashed["graded"], "exit" in crashed), ("crashed", "adapter-error", True, False))
        self.assertIsNone(p.infrastructure(crashed, p.attempt_path(self.state, crashed), "claude", True))
        study = p.verify_registration(p.read(self.state / "registration.json"), frozen=True)
        rerun, regrade = p.supplement_candidates(plan, self.state, study, rows)
        self.assertEqual(([e["id"] for e in rerun], regrade), ([a], []))

    def test_supplement_refuses_unfinished_changed_or_drifted_studies(self):
        live = self.live_plan()
        a, b = self.slot(live, "main", "p10-pseudorep"), self.slot(live, "main", "p9-leakage")
        plan, head, original = self.original_study({a: ["shape-a"], b: ["shape-b"]})
        with p.lease(self.state):
            with self.assertRaisesRegex(ValueError, "still active"):
                self.supplement(plan)
        with patch.object(p, "grader_sha256", lambda: "0" * 64), self.assertRaisesRegex(ValueError, "grader changed"):
            self.supplement(plan)
        self.assertFalse(self.out.exists())
        rows = p.read(self.state / "runs.json")
        for edit in ({"status": "running", "dispatched": False}, {"dispatched": True, "graded": False}):
            p.atomic(self.state / "runs.json", [*rows[:-1], {**rows[-1], **edit}])
            with self.subTest(edit=edit), self.assertRaisesRegex(ValueError, "unfinished"):
                self.supplement(plan)
        p.atomic(self.state / "runs.json", rows)
        # A live registration needs a committed tree, the study's LOCKED-STUDY.json record and the study's harness.
        study_lock = self.git.files.pop(p.STUDY_LOCK)
        refusals = ((FakeGit(dirty=True), "commit the controller"), (FakeGit(), "LOCKED-STUDY.json record"),
                    (FakeGit(same=lambda since, paths: paths != p.HARNESS), "arm harness changed"))
        for git, message in refusals:
            if message != "LOCKED-STUDY.json record":
                git.files[p.STUDY_LOCK] = study_lock
            with self.subTest(message=message), self.assertRaisesRegex(ValueError, message):
                self.register(plan, git=git)
            self.assertFalse((self.out / "supplement.json").exists())
        self.git.files[p.STUDY_LOCK] = study_lock
        record, study, added, _ = self.supplement(plan, {a: ["clean"]}, max_runs=0)
        self.assertEqual(sorted(record["armRegistry"]), ["plain-claude"])
        # Resume: the registered commit, or a later one that changes only LOCKED-SUPPLEMENT.json; never a dirty tree.
        resume = lambda git: p.open_supplement(plan, self.state, self.out, resume=True, git=git)
        for git, message in ((FakeGit(sha="d" * 40, same=False), "registered commit"), (FakeGit(dirty=True), "commit the controller")):
            git.files = dict(self.git.files)
            with self.subTest(message=message), self.assertRaisesRegex(ValueError, message):
                resume(git)
        later = FakeGit(sha="d" * 40)
        later.files = dict(self.git.files)
        resume(later)
        self.assertEqual(later.compared, [(COMMIT["sha"], ("packages",), (p.SUPPLEMENT_LOCK,))])
        record = p.read(self.out / "supplement.json")
        for edit, message in ((lambda r: r.update(refusalRetries=5), "registration broken"),
                              (lambda r: r["rerun"].clear(), "registration broken"),
                              (lambda r: r.update(nonce="0" * 32), "registration broken")):
            forged = copy.deepcopy(record)
            edit(forged)
            p.atomic(self.out / "supplement.json", forged)
            with self.assertRaisesRegex(ValueError, message):
                p.open_supplement(plan, self.state, self.out, git=self.git)
        p.atomic(self.out / "supplement.json", record)
        rows = p.read(self.state / "runs.json")
        p.atomic(self.state / "runs.json", rows[:-1])
        with self.assertRaisesRegex(ValueError, "original study changed"):
            p.open_supplement(plan, self.state, self.out, git=self.git)
        p.atomic(self.state / "runs.json", rows)
        p.open_supplement(plan, self.state, self.out, git=self.git)
        # Selection follows execute(): a stream whose terminal outcome is also a rate limit is never re-run as refused.
        transcript = p.attempt_path(self.state, next(r for r in rows if r["id"] == a)) / "transcript.jsonl"
        transcript.write_text("\n".join(map(json.dumps, STREAMS["both-terminal"]())))
        study = p.verify_registration(p.read(self.state / "registration.json"), frozen=True)
        self.assertEqual([e["id"] for e in p.supplement_candidates(plan, self.state, study, rows)[0]], [])
        # Re-assessed arms are bound to the study's registry entry too (assess reads the current one): a study whose
        # only selection is a regrade row is refused when that arm's entry changed.
        self.reset_study("regrade-only")
        plan, head, original = self.original_study({b: ["shape-b"]})
        changed = {**p.arm_registry(), "plain-claude": {**p.arm_registry()["plain-claude"], "label": "changed"}}
        with patch.object(p, "arm_registry", lambda path=None: changed), self.assertRaisesRegex(ValueError, "arm registry changed"):
            self.register(plan)
        record, _, _ = self.register(plan)
        self.assertEqual((record["rerun"], [e["id"] for e in record["regrade"]], sorted(record["armRegistry"])), ([], [b], ["plain-claude"]))

    def test_cli_supplement_and_scores_with_and_without(self):
        a = self.slot(self.plan, "main", "p10-pseudorep")
        plan, head, original = self.original_study({a: ["shape-a"]}, legacy(self.plan))
        planfile = Path(self.tmp.name) / "plan.json"
        p.atomic(planfile, plan)
        def cli(*args, out=self.out):
            return subprocess.run([sys.executable, str(p.HERE / "pilot.py"), *args, "--plan", str(planfile), "--state",
                                   str(self.state), "--supplement", str(out)], capture_output=True, text=True)
        self.assertEqual(cli("supplement", "--max-runs", "0").returncode, 2)  # --reason is required on first use
        for other in (self.state / "inside", self.out.with_name("study-supplement-2")):
            self.assertEqual(cli("supplement", "--max-runs", "0", "--reason", "x", out=other).returncode, 2)
            self.assertFalse(other.exists() and (other / "supplement.json").exists())
        self.assertEqual(cli("run", "--max-runs", "0").returncode, 2)
        before = tree(self.state)
        result = cli("supplement", "--max-runs", "0", "--reason", REASON)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("1 provider-refused slot(s) to re-run", result.stdout)
        result = cli("score")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(tree(self.state), before)
        for name in ("scoreboard", "scoreboard-original"):
            self.assertTrue((self.out / f"{name}.json").is_file() and (self.out / f"{name}.md").is_file())
        self.assertEqual(p.read(self.out / "scoreboard.json")["supplement"]["rerunSlots"], [a])
        self.assertIsNone(p.read(self.out / "scoreboard-original.json")["supplement"])


if __name__ == "__main__":
    unittest.main()
