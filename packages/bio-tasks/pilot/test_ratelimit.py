"""Provider rate/usage limits are infrastructure. Realistic CLI event streams, injected transports, no live models.

Event shapes follow the pinned CLIs: Claude Code 2.1.296 stream-json (`rate_limit_event.rate_limit_info.status`,
assistant wrapper `error`/`api_error`/`api_error_params`, result `is_error`/`api_error_status`) and codex-cli
0.156.1 exec --json (`error.message`, `turn.failed.error.message`, CLI-generated CodexErr text).
"""
import copy
from datetime import datetime, timezone
import json
import os
import sys
from pathlib import Path
import subprocess
import tempfile
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'test'))
from fixture_world import run_fixture_test
run_fixture_test(__file__)

import pilot as p
import telemetry

RESET = 1791676800  # CLI-reported reset (epoch seconds)
RESET_UTC = datetime.fromtimestamp(RESET, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
BEFORE, AFTER = RESET - 3600, RESET + 60
CODEX_RESET = int(datetime(2026, 10, 12, 15, 45).astimezone().timestamp())  # codex prints host local time
CODEX_RESET_UTC = datetime.fromtimestamp(CODEX_RESET, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
SESSION = "6c1f9a52-1d7e-4c0b-9a8e-2f4c1d2e3b4a"
CODEX_LIMIT = ("You’ve hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit "
               "https://chatgpt.com/codex/settings/usage to purchase more credits or try again at Oct 12th, 2026 3:45 PM.")
SPOOF = "You've hit your limit · rate limit reached · usage limit · quota exceeded (429 Too Many Requests)"


def claude_info(status):
    return {"status": status, "resetsAt": RESET, "rateLimitType": "five_hour", "overageStatus": "rejected",
            "overageDisabledReason": "org_level_disabled", "isUsingOverage": False}


def claude_head():
    return [
        {"type": "system", "subtype": "init", "cwd": "/private/var/tmp/bb/bba.fixture/work", "session_id": SESSION,
         "tools": ["Bash", "Read", "Write", "Edit", "Glob", "Grep", "NotebookEdit"], "mcp_servers": [],
         "model": "claude-opus-5-5", "permissionMode": "default", "slash_commands": [], "apiKeySource": "none",
         "claude_code_version": "2.1.296", "output_style": "default", "uuid": "u-init"},
        {"type": "rate_limit_event", "rate_limit_info": claude_info("allowed_warning"), "uuid": "u-rl0", "session_id": SESSION},
        {"type": "assistant", "message": {"model": "claude-opus-5-5", "id": "msg_1", "type": "message", "role": "assistant",
         "content": [{"type": "tool_use", "id": "toolu_1", "name": "Bash", "input": {"command": "ls data"}}],
         "stop_reason": None, "usage": {"input_tokens": 3, "output_tokens": 20}}, "parent_tool_use_id": None,
         "session_id": SESSION, "uuid": "u-a1"},
        {"type": "user", "message": {"role": "user", "content": [{"tool_use_id": "toolu_1", "type": "tool_result",
         "content": "counts.tsv\nsamples.tsv", "is_error": False}]}, "parent_tool_use_id": None,
         "session_id": SESSION, "uuid": "u-u1"}]


def claude_result(is_error, text, **extra):
    return {"type": "result", "subtype": "success", "is_error": is_error, "api_error_status": None, "duration_ms": 9000,
            "duration_api_ms": 4000, "num_turns": 2, "result": text, "stop_reason": "end_turn",
            "terminal_reason": "completed", "session_id": SESSION, "total_cost_usd": 0.12,
            "usage": {"input_tokens": 10, "output_tokens": 5}, "modelUsage": {"claude-opus-5-5": {"inputTokens": 10}},
            "permission_denials": [], "uuid": "u-result", **extra}


def claude_usage_limit():
    """Max plan session limit mid-run: the CLI rejects, synthesizes an API-error message and ends the turn."""
    return claude_head() + [
        {"type": "rate_limit_event", "rate_limit_info": claude_info("rejected"), "uuid": "u-rl1", "session_id": SESSION},
        {"type": "assistant", "message": {"model": "<synthetic>", "id": "msg_2", "type": "message", "role": "assistant",
         "content": [{"type": "text", "text": "You've hit your limit · resets 3am (UTC)"}],
         "stop_reason": "stop_sequence", "usage": {"input_tokens": 0, "output_tokens": 0}},
         "parent_tool_use_id": None, "session_id": SESSION, "uuid": "u-a2", "error": "rate_limit",
         "is_api_error_message": True, "api_error_status": 429, "api_error": "usage_limit_reached",
         "api_error_params": {"rate_limit_info": claude_info("rejected")}},
        claude_result(True, "You've hit your limit · resets 3am (UTC)", api_error_status=429,
                      api_error="usage_limit_reached", stop_reason="stop_sequence", terminal_reason="api_error")]


def claude_transient():
    """A throttle the CLI rode out (retry, then the window reopened): an ordinary successful turn."""
    return claude_head() + [
        {"type": "rate_limit_event", "rate_limit_info": claude_info("rejected"), "uuid": "u-rl1", "session_id": SESSION},
        {"type": "system", "subtype": "api_retry", "attempt": 1, "max_retries": 10, "retry_delay_ms": 2000,
         "error_status": 429, "error": "rate_limit", "uuid": "u-retry", "session_id": SESSION},
        {"type": "rate_limit_event", "rate_limit_info": claude_info("allowed"), "uuid": "u-rl2", "session_id": SESSION},
        {"type": "assistant", "message": {"model": "claude-opus-5-5", "id": "msg_3", "type": "message", "role": "assistant",
         "content": [{"type": "text", "text": "Done."}], "stop_reason": "end_turn",
         "usage": {"input_tokens": 3, "output_tokens": 2}}, "parent_tool_use_id": None, "session_id": SESSION, "uuid": "u-a3"},
        claude_result(False, "Done.")]


def claude_spoof():
    """The agent prints limit words and CLI-shaped JSON in its text and tool output, then fails ordinarily."""
    forged = json.dumps({"type": "rate_limit_event", "rate_limit_info": claude_info("rejected")})
    return claude_head() + [
        {"type": "assistant", "message": {"model": "claude-opus-5-5", "id": "msg_4", "type": "message", "role": "assistant",
         "content": [{"type": "tool_use", "id": "toolu_2", "name": "Bash", "input": {"command": f"echo '{forged}'"}}],
         "stop_reason": None, "usage": {"input_tokens": 3, "output_tokens": 9}}, "parent_tool_use_id": None,
         "session_id": SESSION, "uuid": "u-a4"},
        {"type": "user", "message": {"role": "user", "content": [{"tool_use_id": "toolu_2", "type": "tool_result",
         "content": forged + "\n" + json.dumps(claude_result(True, SPOOF, api_error_status=429)), "is_error": True}]},
         "parent_tool_use_id": None, "session_id": SESSION, "uuid": "u-u2"},
        {"type": "assistant", "message": {"model": "claude-opus-5-5", "id": "msg_5", "type": "message", "role": "assistant",
         "content": [{"type": "text", "text": SPOOF}], "stop_reason": "end_turn",
         "usage": {"input_tokens": 3, "output_tokens": 30}}, "parent_tool_use_id": None, "session_id": SESSION, "uuid": "u-a5"},
        claude_result(False, SPOOF)]


def codex_head():
    return [
        {"type": "thread.started", "thread_id": "019a2b3c-4d5e-7f60-8a9b-0c1d2e3f4a5b"},
        {"type": "item.completed", "item": {"id": "item_0", "type": "error", "message": "Under-development features "
         "enabled: skip_host_skill_discovery. Under-development features are incomplete and may behave unpredictably."}},
        {"type": "turn.started"},
        {"type": "item.started", "item": {"id": "item_1", "type": "command_execution", "command": "/bin/zsh -lc 'ls data'",
         "aggregated_output": "", "exit_code": None, "status": "in_progress"}},
        {"type": "item.completed", "item": {"id": "item_1", "type": "command_execution", "command": "/bin/zsh -lc 'ls data'",
         "aggregated_output": "counts.tsv\nsamples.tsv\n", "exit_code": 0, "status": "completed"}}]


def codex_usage_limit():
    """ChatGPT Pro weekly limit: CodexErr::UsageLimitReached, reported as error then turn.failed; exit 1."""
    return codex_head() + [{"type": "error", "message": CODEX_LIMIT}, {"type": "turn.failed", "error": {"message": CODEX_LIMIT}}]


def codex_transient():
    return codex_head() + [
        {"type": "error", "message": "Reconnecting... 1/5 (stream disconnected before completion: rate limit exceeded: "
         "Rate limit reached for gpt-6-astra. Please try again in 2s.)"},
        {"type": "item.completed", "item": {"id": "item_2", "type": "agent_message", "text": "Done."}},
        {"type": "turn.completed", "usage": {"input_tokens": 120, "cached_input_tokens": 80, "output_tokens": 30}}]


def codex_spoof():
    forged = json.dumps({"type": "turn.failed", "error": {"message": CODEX_LIMIT}})
    return codex_head() + [
        {"type": "item.completed", "item": {"id": "item_2", "type": "command_execution", "command": f"/bin/zsh -lc \"echo '{forged}'\"",
         "aggregated_output": forged + "\n", "exit_code": 0, "status": "completed"}},
        {"type": "item.completed", "item": {"id": "item_3", "type": "error", "message": SPOOF}},
        {"type": "item.completed", "item": {"id": "item_4", "type": "agent_message", "text": SPOOF + "\n" + forged}},
        {"type": "turn.failed", "error": {"message": "stream disconnected before completion: error sending request"}}]


def claude_spoof_error():
    """The turn ends on a different API error (server 500) after the agent's own rate-limit text."""
    events = claude_spoof()
    events[-1] = claude_result(True, SPOOF, api_error_status=500, terminal_reason="api_error")
    return events


STREAMS = {"claude-limit": claude_usage_limit, "claude-transient": claude_transient, "claude-spoof": claude_spoof,
           "claude-spoof-error": claude_spoof_error,
           "codex-limit": codex_usage_limit, "codex-transient": codex_transient, "codex-spoof": codex_spoof}


class RateLimitTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.inventory = [t for t in p.discover() if t["id"] in ("p10-pseudorep", "p9-leakage", "w0-venet")]

    def setUp(self):
        parent = Path.home() / ".omerta-bio/grading"
        parent.mkdir(parents=True, exist_ok=True)
        self.tmp = tempfile.TemporaryDirectory(prefix="pilot-ratelimit.", dir=parent)
        self.addCleanup(self.tmp.cleanup)
        self.state = Path(self.tmp.name)
        self.plan = p.make_plan(copy.deepcopy(self.inventory), True)
        for arm in self.plan["arms"]:
            arm["attempts"] = 1
        self.plan["diskFloorBytes"] = 1
        self.plan["statistics"]["resamples"] = 32
        self.grades, self.dispatches = [], []
        self.stream = {}  # family -> stream name for the next dispatches of that provider
        self.ticks = iter(range(100000))

    def manifest(self, task):
        return next(t["card"]["datasetManifestHash"] for t in self.plan["tasks"] if t["id"] == task)

    def transport(self, cmd, **kwargs):
        if cmd[1].endswith("run-task.sh"):
            task, runner, attempt = cmd[2:5]
            arm = next(a for a, r in p.ARMS.items() if r == runner)
            family = p.arm_registry()[arm]["family"]
            name = self.stream.get(family, family + "-transient")
            target = Path(cmd[cmd.index("--results-root") + 1]) / task / f"{runner}-{attempt}"
            (target / "workdir").mkdir(parents=True)
            self.dispatches.append((arm, attempt, name))
            limited, timeout = name.endswith("-limit"), name.endswith("-timeout")
            events = STREAMS[name.replace("-timeout", "-limit")]()
            (target / "transcript.jsonl").write_text("\n".join(map(json.dumps, events)) + "\n")
            failed = limited or "-spoof" in name
            meta = {"start": "fixture-start", "end": "fixture-end", "status": "timed-out" if timeout else "agent-error" if failed else "finished",
                    "agent_exit": 1 if failed else 0, "tmp_deleted": True, "task_id": task, "dry_run": True,
                    "task_manifest_sha256": self.manifest(task), "model": "fake", "effort": "fake", "cli_version": "fake"}
            if arm == "codex-tools":
                meta.update(toolpack_profile="checks", toolpack_sha256=p.toolpack_settings()["sha256"],
                            toolpack_check="verified", toolpack_intact_after_run=True)
            p.atomic(target / "meta.json", meta)
            p.atomic(target / "run_status.json", {"exit_code": meta["agent_exit"], "signal": None, "timed_out": timeout})
            if not limited:
                p.atomic(target / "workdir/results.json", {"claims": []})
            return subprocess.CompletedProcess(cmd, 1 if failed or timeout else 0)
        self.assertTrue(cmd[1].endswith("grade-task.sh"))
        task, target = cmd[2], Path(cmd[3])
        self.grades.append(target.name)
        (target / "grade").mkdir()
        p.atomic(target / "grade/task-summary.json", {"task": task, "attempt": target.name, "credited": True,
            "task_passed": True, "reproduced": True, "contamination": "none-found", "check": {"items": []},
            "rerun": {"ran": True, "exit_code": 0, "timed_out": False, "tmp_deleted": True}})
        return subprocess.CompletedProcess(cmd, 0)

    def run_plan(self, wall=AFTER, plan=None, **kwargs):
        report = {}
        rows = p.run(plan or self.plan, self.state, "fixture-hash", -1, now=lambda: next(self.ticks), free=lambda _: 100,
                     wall_now=lambda: wall, report=report,
                     executor=lambda *a: p.execute(*a, transport=self.transport, free=lambda _: 100), **kwargs)
        return rows, report

    def execute_one(self, arm, stream, wall=AFTER):
        family = p.arm_registry()[arm]["family"]
        self.stream[family] = stream
        rows, _ = self.run_plan(wall=wall, max_runs=1, only=f"p10-pseudorep/{arm}")
        return rows[-1]

    def test_cli_event_parser_reads_only_structured_cli_fields(self):
        cases = {"claude-limit": ("claude", True, True), "claude-transient": ("claude", True, False),
                 "claude-spoof": ("claude", False, False), "claude-spoof-error": ("claude", False, False),
                 "codex-limit": ("codex", True, True),
                 "codex-transient": ("codex", True, False), "codex-spoof": ("codex", False, False)}
        for name, (family, signal, terminal) in cases.items():
            with self.subTest(stream=name):
                (self.state / "transcript.jsonl").write_text("\n".join(map(json.dumps, STREAMS[name]())))
                limit = telemetry.rate_limit(self.state, family)
                self.assertEqual(bool(limit["signals"]), signal, limit)
                self.assertEqual(limit["terminal"], terminal, limit)
                self.assertEqual(telemetry.telemetry(self.state, {}, family)["rateLimited"], signal)
                # Another provider's stream shapes never count for this arm's family.
                other = "codex" if family == "claude" else "claude"
                self.assertFalse(telemetry.rate_limit(self.state, other)["terminal"])
        (self.state / "transcript.jsonl").write_text("\n".join(map(json.dumps, claude_usage_limit())))
        limit = telemetry.rate_limit(self.state, "claude")
        self.assertEqual((limit["resetsAt"], limit["resetsAtUtc"]), (RESET, RESET_UTC))
        self.assertIn("result:is_error:rate_limit", limit["signals"])
        self.assertIn("rate_limit_event:rejected", limit["signals"])
        (self.state / "transcript.jsonl").write_text("\n".join(map(json.dumps, codex_usage_limit())))
        limit = telemetry.rate_limit(self.state, "codex")
        self.assertEqual((limit["resetHint"], limit["resetsAt"], limit["resetsAtUtc"]),
                         ("at Oct 12th, 2026 3:45 PM", CODEX_RESET, CODEX_RESET_UTC))
        # Same-day form: a time alone, on the local day the CLI wrote the error. "later" gives no time.
        written = datetime(2026, 10, 12, 9, 30).astimezone().timestamp()
        for tail, resets, hint in ((" or try again at 3:45 PM.", CODEX_RESET, "at 3:45 PM"), (" or try again later.", None, None)):
            message = CODEX_LIMIT.split(" or try again")[0] + tail
            events = codex_head() + [{"type": "turn.failed", "error": {"message": message}}]
            (self.state / "transcript.jsonl").write_text("\n".join(map(json.dumps, events)))
            os.utime(self.state / "transcript.jsonl", (written, written))
            limit = telemetry.rate_limit(self.state, "codex")
            self.assertEqual((limit["terminal"], limit["resetsAt"], limit["resetHint"]), (True, resets, hint))
        # The result fields alone or the wrapper error alone each tie the terminal failure to the limit.
        for drop in ("api_error_status", "api_error"):
            events = claude_usage_limit()
            for event in events:
                event.pop(drop, None)
            events[-1]["api_error_status"] = None
            (self.state / "transcript.jsonl").write_text("\n".join(map(json.dumps, events)))
            self.assertTrue(telemetry.rate_limit(self.state, "claude")["terminal"])
        events = claude_usage_limit()
        events[-2].pop("error")
        events[-2].pop("api_error")
        events[-1].update(api_error_status=None, api_error=None)
        (self.state / "transcript.jsonl").write_text("\n".join(map(json.dumps, events)))
        self.assertFalse(telemetry.rate_limit(self.state, "claude")["terminal"], "a rejected event alone is not terminal")
        # Codex: a limit message followed by more CLI work, or with extra fields, is not the terminal outcome.
        for events in (codex_usage_limit()[:-1] + [{"type": "turn.completed", "usage": {"input_tokens": 1, "output_tokens": 1}}],
                       codex_transient() + [{"type": "error", "message": CODEX_LIMIT}],
                       codex_usage_limit()[:-2] + [{"type": "turn.failed", "error": {"message": CODEX_LIMIT}, "item": {}}]):
            (self.state / "transcript.jsonl").write_text("\n".join(map(json.dumps, events)))
            self.assertFalse(telemetry.rate_limit(self.state, "codex")["terminal"])

    def test_refused_model_substitution_is_infrastructure_and_arms_forbid_fallback(self):
        # CLAUDE_CODE_NO_MODEL_FALLBACK makes the CLI error with model_substitution_disabled instead of silently
        # switching models (two warm-up runs silently ran claude-opus-5). That refusal is an infrastructure pause.
        stream = [{"type": "system", "subtype": "init", "model": "claude-opus-5-5", "session_id": "s"},
                  {"type": "assistant", "error": None, "api_error": "model_substitution_disabled", "message": {"model": "claude-opus-5-5", "content": []}},
                  {"type": "result", "is_error": True, "api_error": "model_substitution_disabled", "api_error_status": None, "result": "x"}]
        (self.state / "transcript.jsonl").write_text("\n".join(map(json.dumps, stream)))
        limit = telemetry.rate_limit(self.state, "claude")
        self.assertTrue(limit["terminal"], limit)
        self.assertIn("assistant.api_error:model_substitution_disabled", limit["signals"])
        repo = Path(__file__).resolve().parents[3]
        self.assertIn('"CLAUDE_CODE_NO_MODEL_FALLBACK=1"', (repo / "packages/bio-baseline/arms/run-claude-arm.sh").read_text())
        self.assertIn('env.CLAUDE_CODE_NO_MODEL_FALLBACK = "1"', (repo / "packages/bio-runner/src/claude-worker.ts").read_text())

    def test_realistic_usage_limit_streams_are_infrastructure_and_never_graded(self):
        for arm, stream in (("plain-claude", "claude-limit"), ("plain-codex", "codex-limit"), ("codex-tools", "codex-limit")):
            with self.subTest(arm=arm):
                if arm == "codex-tools":
                    # The plain-codex limit pauses every Codex arm until its CLI-reported reset.
                    rows, report = self.run_plan(wall=CODEX_RESET - 60, max_runs=1, only="p10-pseudorep/codex-tools")
                    self.assertEqual(len(rows), 2)
                    self.assertEqual(report["paused"]["codex"]["resetsAtUtc"], CODEX_RESET_UTC)
                    self.assertIn(f"codex arms paused (CLI-reported reset {CODEX_RESET_UTC}; CLI says try again at Oct 12th, "
                                  "2026 3:45 PM (local time))", p.rate_limit_message(report, self.plan))
                row = self.execute_one(arm, stream, wall=CODEX_RESET + 60)
                self.assertEqual(row["status"], "rate-limited")
                self.assertEqual(row["infrastructure"], "rate-limited")
                self.assertEqual(row["executionStatus"], "failed")
                self.assertIsNone(row["graded"])
                self.assertFalse(row["taskPassed"])
                self.assertTrue(row["rateLimited"])
                self.assertEqual(row["rateLimit"]["family"], p.arm_registry()[arm]["family"])
                self.assertNotIn(p.attempt_path(self.state, row).name, self.grades)
        rows = p.read(self.state / "runs.json")
        self.assertEqual(rows[0]["rateLimit"]["resetsAtUtc"], RESET_UTC)
        self.assertEqual((rows[1]["rateLimit"]["resetHint"], rows[1]["rateLimit"]["resetsAt"]), ("at Oct 12th, 2026 3:45 PM", CODEX_RESET))
        self.assertEqual(self.grades, [])

    def test_assistant_or_tool_text_saying_rate_limit_is_an_ordinary_charged_failure(self):
        for arm, stream in (("plain-claude", "claude-spoof"), ("plain-codex", "codex-spoof"),
                            ("plain-claude", "claude-spoof-error"), ("plain-claude", "codex-limit")):
            with self.subTest(arm=arm, stream=stream):
                row = self.execute_one(arm, stream)
                self.assertEqual(row["status"], "failed")
                self.assertFalse(row["rateLimited"])
                self.assertNotIn("infrastructure", row)
                self.assertTrue(row["graded"])
                self.assertIn(p.attempt_path(self.state, row).name, self.grades)
        # The old free-text scan treated Claude's final `result` text as an error field.
        (self.state / "transcript.jsonl").write_text("\n".join(map(json.dumps, claude_spoof())))
        self.assertFalse(p.telemetry(self.state, {})["rateLimited"])
        scored = p.score(self.plan, self.state, "fixture-hash")  # p10 rows here are start sentinels
        self.assertEqual(scored["rateLimited"], [])
        self.assertEqual([(r["status"], r["success"]) for r in scored["records"]], [("failed", False)] * 4)

    def test_completed_run_with_transient_limit_stays_completed(self):
        for arm, stream in (("plain-claude", "claude-transient"), ("plain-codex", "codex-transient")):
            with self.subTest(arm=arm):
                row = self.execute_one(arm, stream)
                self.assertEqual(row["status"], "completed")
                self.assertTrue(row["taskPassed"])
                self.assertTrue(row["rateLimited"])  # reported as a transient signal only
                self.assertNotIn("infrastructure", row)
        scored = p.score(self.plan, self.state, "fixture-hash")  # p10 rows here are start sentinels
        self.assertEqual([(r["status"], r["success"]) for r in scored["records"]], [("completed", True)] * 2)
        self.assertEqual(scored["rateLimited"], [])

    def test_timeout_with_limit_stream_stays_an_arm_timeout(self):
        # The agent controls when a run hangs; only a CLI that exited on its own can be reclassified.
        row = self.execute_one("plain-codex", "codex-timeout")
        self.assertEqual(row["status"], "timeout")
        self.assertTrue(row["graded"])

    def test_provider_pause_other_providers_continue_and_single_requeue_after_reset(self):
        self.stream["claude"] = "claude-limit"
        rows, report = self.run_plan(wall=BEFORE)
        claude = [r for r in rows if r["arm"] == "plain-claude"]
        self.assertEqual([r["status"] for r in claude], ["rate-limited"])  # no further Claude launch this run
        codex = [r for r in rows if r["arm"] != "plain-claude"]
        expected = [s for s in p.schedule(self.plan) if s["arm"] != "plain-claude"]
        self.assertEqual([r["id"] for r in codex], [s["id"] for s in expected])
        self.assertTrue(all(r["status"] == "completed" for r in codex))
        self.assertEqual(report["paused"], {"claude": {"resetsAt": RESET, "resetsAtUtc": RESET_UTC, "resetHint": None}})
        self.assertEqual([x["id"] for x in report["pending"]], [claude[0]["id"]])
        self.assertTrue(report["finished"])
        message = p.rate_limit_message(report, self.plan)
        self.assertIn(f"claude arms paused (CLI-reported reset {RESET_UTC})", message)
        self.assertIn("Nothing else is runnable now", message)
        self.assertIn("never charged to an arm", message)
        # Before the CLI-reported reset nothing relaunches, so no retry is spent.
        self.stream["claude"] = "claude-transient"
        again, report = self.run_plan(wall=BEFORE)
        self.assertEqual(again, rows)
        self.assertIn("claude", report["paused"])
        # After the reset: the limited slot is re-queued exactly once, then Claude continues in order.
        final, report = self.run_plan(wall=AFTER)
        self.assertEqual(report["paused"], {})
        self.assertEqual(report["pending"], [])
        retried = [r for r in final if r["id"] == claude[0]["id"]]
        self.assertEqual([(r["status"], r["retry"], r["executionRetry"], r["rateLimitRetry"]) for r in retried],
                         [("rate-limited", 0, 0, 0), ("completed", 1, 0, 1)])
        self.assertEqual(len(final), len(p.schedule(self.plan)) + 1)
        self.assertEqual(self.run_plan()[0], final)  # nothing re-queued twice
        scored = p.score(self.plan, self.state, "fixture-hash")
        self.assertTrue(scored["complete"] and scored["scheduleComplete"])
        self.assertTrue(scored["orderValid"])
        self.assertGreater(scored["orderDeferredByRateLimit"], 0)
        self.assertIn("deferred behind other providers", scored["markdown"])
        arm = next(a for a in scored["arms"] if a["arm"] == "plain-claude")
        self.assertEqual((arm["denominator"], arm["crashes"], arm["retries"]), (3, 0, 0))
        self.assertEqual((arm["rateLimitExcludedRuns"], arm["rateLimitUnresolvedRuns"]), (int(retried[0]["phase"] == "main"), 0))
        self.assertEqual([x["resolved"] for x in scored["rateLimited"]], [True])
        self.assertFalse(any("rate/usage limit" in r for c in scored["comparisons"] for r in c["incompleteReasons"]))

    def test_retry_bound_exhaustion_is_infrastructure_failure_never_arm_failure(self):
        self.plan["retryRule"]["rateLimitRetries"] = 2
        target = next(s["id"] for s in p.schedule(self.plan) if s["arm"] == "plain-claude" and s["phase"] == "main")
        limited = {"status": "rate-limited", "infrastructure": "rate-limited", "dispatched": True, "graded": None,
                   "taskPassed": False, "gradeOutcome": "unavailable", "claims": [], "claimsAvailable": False,
                   "provenance": None, "provenanceOk": False, "rateLimited": True,
                   "rateLimit": {"family": "claude", "signals": ["result:is_error:rate_limit"], "resetsAt": None,
                                 "resetsAtUtc": None, "resetHint": None}}
        def executor(plan, row, state, fd):
            if row["id"] == target:
                return dict(limited)
            return {"status": "completed", "exit": 0, "gradeExit": 0, "timedOut": False, "crashed": False,
                    "provenance": {"modelId": "fake", "cliVersion": "fake", "effort": "fake"}, "provenanceOk": True,
                    "taskPassed": True, "gradeOutcome": "accepted", "claims": [], "claimsAvailable": True}
        for _ in range(6):
            report = {}
            rows = p.run(self.plan, self.state, "fixture-hash", -1, now=lambda: next(self.ticks), free=lambda _: 100,
                         wall_now=lambda: next(self.ticks), executor=executor, report=report)
        attempts = [r for r in rows if r["id"] == target]
        self.assertEqual(len(attempts), 3)  # first event + rateLimitRetries re-queues
        self.assertEqual([r["rateLimitEvents"] for r in attempts], [1, 2, 3])
        self.assertEqual([r.get("infrastructure") for r in attempts], ["rate-limited"] * 2 + ["rate-limit-exhausted"])
        self.assertEqual([x["id"] for x in report["exhausted"]], [target])
        self.assertIn("exceeded rateLimitRetries", p.rate_limit_message(report, self.plan))
        scored = p.score(self.plan, self.state, "fixture-hash")
        self.assertFalse(scored["complete"])
        arm = next(a for a in scored["arms"] if a["arm"] == "plain-claude")
        self.assertEqual((arm["denominator"], arm["successes"], arm["crashes"], arm["timeouts"]), (2, 2, 0, 0))
        self.assertEqual((arm["rateLimitExcludedRuns"], arm["rateLimitUnresolvedRuns"], arm["rateLimitExhaustedRuns"]), (3, 1, 1))
        for pair in scored["comparisons"]:
            affected = "plain-claude" in (pair["b"], pair["c"])
            self.assertEqual(any("rate/usage limit" in r for r in pair["incompleteReasons"]), affected)
            if affected:
                self.assertEqual(pair["status"], "incomplete")
        self.assertIn("retry bound exhausted", scored["markdown"])
        self.assertEqual(scored["infrastructureUnknowns"], [])
        self.assertEqual(scored["provenanceUnavailable"], [])

    def test_limit_events_spend_no_interruption_retry(self):
        self.assertEqual(self.plan["retryRule"]["interruptedRetries"], 1)
        only = "p10-pseudorep/plain-claude"
        self.stream["claude"] = "claude-limit"
        self.run_plan(max_runs=1, only=only)
        class Crash(BaseException):
            pass
        def crash(boundary):
            if boundary == "after-start":
                raise Crash()
        with self.assertRaises(Crash):  # the re-queued run is then interrupted after its agent started
            self.run_plan(max_runs=1, only=only, fault=crash)
        interrupted = p.read(self.state / "runs.json")[-1]
        p.attempt_path(self.state, interrupted).mkdir(parents=True)
        p.atomic(p.attempt_path(self.state, interrupted) / "meta.json", {"start": "start", "status": "running"})
        self.stream["claude"] = "claude-transient"
        rows, _ = self.run_plan(max_runs=1, only=only)
        self.assertEqual([(r["status"], r["executionRetry"], r["rateLimitRetry"]) for r in rows],
                         [("rate-limited", 0, 0), ("interrupted", 0, 1), ("completed", 1, 1)])

    def test_rate_limit_retries_is_validated_and_hash_locked(self):
        for value in (None, -1, 11, True, 1.5, "3"):
            bad = copy.deepcopy(self.plan)
            if value is None:
                del bad["retryRule"]["rateLimitRetries"]
            else:
                bad["retryRule"]["rateLimitRetries"] = value
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, "retry rule"):
                p.validate(bad)
        bad = copy.deepcopy(self.plan)
        bad["retryRule"] = [1, 2, 3]
        with self.assertRaisesRegex(ValueError, "retry rule"):
            p.validate(bad)
        self.assertEqual(p.make_plan(copy.deepcopy(self.inventory))["retryRule"]["rateLimitRetries"], 3)
        p.locked(self.plan, self.state, True)
        changed = copy.deepcopy(self.plan)
        changed["retryRule"]["rateLimitRetries"] = 4
        with self.assertRaisesRegex(ValueError, "locked"):
            p.locked(changed, self.state)
        with self.assertRaisesRegex(ValueError, "cannot change retryRule"):
            p.amend(changed, self.state, "raise the rate-limit bound")


if __name__ == "__main__":
    unittest.main()
