"""Deterministic controller tests; exact fault hooks, injected clock/disk, no live models."""
import copy
import json
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


class Crash(BaseException):
    pass


class PilotTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.inventory = [t for t in p.discover() if t["id"] in ("p10-pseudorep", "p9-leakage", "w0-venet")]

    def setUp(self):
        parent = Path.home() / ".omerta-bio/grading"
        parent.mkdir(parents=True, exist_ok=True)
        self.tmp = tempfile.TemporaryDirectory(prefix="pilot-unit.", dir=parent)
        self.addCleanup(self.tmp.cleanup)
        self.state = Path(self.tmp.name)
        self.plan = p.make_plan(copy.deepcopy(self.inventory), True)
        # Uniform fixture: every enabled arm gets attemptsPerArm, mirroring the pre-amendment block shape.
        # Per-arm attempts and the retired v1 arm are covered by test_amend.py.
        for arm in self.plan["arms"]:
            arm["attempts"] = self.plan["attemptsPerArm"]
        self.arms = p.enabled_arms(self.plan)
        self.plan["diskFloorBytes"] = 1
        self.plan["statistics"]["resamples"] = 32
        self.ticks = iter(range(1000))
        self.calls = []

    def fake(self, plan, row, state, fd):
        self.calls.append(row["id"])
        return {"status": "completed", "exit": 0, "gradeExit": 0, "timedOut": False, "crashed": False,
                "provenance": {"modelId": "fake", "cliVersion": "fake", "effort": "fake"}, "provenanceOk": True,
                "taskPassed": True, "gradeOutcome": "accepted", "claims": [], "claimsAvailable": True}

    def run_plan(self, **kwargs):
        return p.run(self.plan, self.state, "fixture-hash", -1, now=lambda: next(self.ticks),
                     free=lambda _: 100, executor=self.fake, wall_now=lambda: 1000 + len(self.calls), **kwargs)

    def test_schedule_deterministic_interleaved_and_seeded(self):
        s = p.schedule(self.plan)
        self.assertEqual(s, p.schedule(copy.deepcopy(self.plan)))
        for i in range(0, len(s), len(self.arms)):
            block = s[i:i+len(self.arms)]
            self.assertEqual({r["arm"] for r in block}, set(self.arms))
            self.assertEqual(len({(r["task"], r["attempt"], r["phase"]) for r in block}), 1)
        self.plan["seed"] += 1
        self.assertNotEqual(s, p.schedule(self.plan))

    def live_plan(self):
        plan = copy.deepcopy(self.plan)
        plan["dryRun"] = False
        plan["diskFloorBytes"] = 12 * 1024**3
        for arm in plan["arms"]:
            arm["cliVersion"] = "fixture-1"
        return plan

    def test_claude_model_effort_parity_and_default_omits_flag(self):
        live = self.live_plan()
        p.validate(live)
        for key in ("modelId", "effort"):
            bad = copy.deepcopy(live)
            bad["arms"][0][key] = "different"
            with self.assertRaisesRegex(ValueError, "parity"):
                p.validate(bad)
        with patch.dict(os.environ, {"CLAUDE_ARM_EFFORT": "high"}):
            env = p.execution_env(live, live["arms"][0])
        self.assertEqual(env["CLAUDE_ARM_EFFORT"], "")
        # The real runner's array expansion omits --effort for the empty env value.
        script = (p.BASE / "arms/run-claude-arm.sh").read_text()
        self.assertIn('[ -n "${CLAUDE_ARM_EFFORT:-}" ] && EXTRA+=(--effort "$CLAUDE_ARM_EFFORT")', script)

    def test_live_disk_floor_and_only_refused(self):
        live = self.live_plan()
        with self.assertRaisesRegex(ValueError, "--only"):
            p.run(live, self.state, "h", -1, only="p10-pseudorep/plain-claude")
        live["diskFloorBytes"] = 0
        with self.assertRaisesRegex(ValueError, "12 GiB"):
            p.validate(live)

    def test_results_and_scratch_filesystems_checked(self):
        roots = [self.state / name for name in ("results", "arms", "grading")]
        for root in roots:
            root.mkdir()
        with patch.dict(os.environ, {"ARM_TMP_ROOT": str(roots[1]), "BIO_GRADING_ROOT": str(roots[2])}):
            for low in roots:
                with self.assertRaisesRegex(ValueError, "disk floor"):
                    p.disk_floor(self.plan, self.state, lambda root: 0 if root == low else 100)

    def test_seed_changes_arm_order_within_same_block(self):
        first = p.schedule(self.plan)
        self.assertGreater(len({r["arm"] for r in first[::len(self.arms)]}), 1)
        changed = copy.deepcopy(self.plan)
        changed["seed"] += 1
        def blocks(rows):
            return {(r["task"], r["attempt"], r["phase"]): [s["arm"] for s in rows[i:i+len(self.arms)]]
                    for i, r in enumerate(rows) if i % len(self.arms) == 0}
        self.assertNotEqual(blocks(first), blocks(p.schedule(changed)))

    def test_settings_hash_without_schedule_change_before_and_after_run(self):
        p.locked(self.plan, self.state, True)
        for started in (False, True):
            if started:
                self.run_plan(max_runs=1)
            changed = copy.deepcopy(self.plan)
            changed["statistics"]["resamples"] += 1
            self.assertEqual(p.schedule(changed), p.schedule(self.plan))
            with self.assertRaisesRegex(ValueError, "pre-registered settings are locked"):
                p.locked(changed, self.state)

    def test_resume_checks_only_registered_tasks(self):
        visited = []
        real = p.load_card
        def load(path):
            visited.append(path.name)
            return real(path)
        with patch.object(p, "load_card", side_effect=load), patch.object(p, "discover", side_effect=AssertionError("full discovery")):
            p.check_tasks(self.plan)
        self.assertEqual(visited, [t["id"] for t in self.plan["tasks"]])

    def test_arm_by_arm_is_nonconfirmatory_and_start_order_recorded(self):
        for arm in self.arms:
            for task in self.plan["tasks"]:
                self.run_plan(only=task["id"] + "/" + arm)
        rows = p.read(self.state / "runs.json")
        self.assertEqual([r["sequence"] for r in rows], list(range(1, len(rows) + 1)))
        self.assertTrue(all(isinstance(r["startedAt"], (int, float)) for r in rows))
        score = p.score(self.plan, self.state, "fixture-hash")
        self.assertTrue(score["complete"])
        self.assertFalse(score["orderValid"])
        self.assertIn("NON-CONFIRMATORY", score["markdown"])

    def test_mid_session_refusal_halts_and_resume_retries_without_charging(self):
        dispatches = []
        def executor(plan, row, state, fd):
            if len(dispatches) == 4:
                raise ValueError("task changed after registration")
            dispatches.append(row["id"])
            return self.fake(plan, row, state, fd)
        with self.assertRaisesRegex(ValueError, "changed"):
            p.run(self.plan, self.state, "fixture-hash", -1, executor=executor, free=lambda _: 100)
        rows = p.read(self.state / "runs.json")
        self.assertEqual(len(rows), 5)
        self.assertEqual(rows[-1]["status"], "not-started")
        self.assertEqual(len(p.score(self.plan, self.state, "fixture-hash")["records"]), 4)
        resumed = self.run_plan(max_runs=1)
        self.assertEqual(resumed[-1]["id"], rows[-1]["id"])
        self.assertEqual(resumed[-1]["status"], "completed")
        self.assertEqual(resumed[-1]["executionRetry"], 0)

    def test_actual_execute_predispatch_refusals_halt(self):
        for reason in ("stale", "environment", "existing"):
            with self.subTest(reason=reason):
                row = {**p.schedule(self.plan)[0], "retry": 0}
                task = next(t for t in self.plan["tasks"] if t["id"] == row["task"])
                path = self.state / "results" / row["task"] / f"{p.ARMS[row['arm']]}-{row['id']}-r0"
                if reason == "existing":
                    path.mkdir(parents=True)
                with patch.object(p, "check_record", return_value=["stale"] if reason == "stale" else []), \
                     patch.dict(os.environ, {"BIO_OPERATION": "arm"} if reason == "environment" else {}):
                    with self.assertRaises(ValueError):
                        p.execute(self.plan, row, self.state, -1,
                                  transport=lambda *a, **k: self.fail("transport called"))

    def test_infrastructure_refusal_no_result_or_agent_start_is_not_charged(self):
        for kind in ("missing-dir", "setup-failed"):
            def transport(cmd, **kwargs):
                if kind == "setup-failed":
                    path = Path(cmd[cmd.index("--results-root") + 1]) / cmd[2] / f"{cmd[3]}-{cmd[4]}"
                    path.mkdir(parents=True)
                    p.atomic(path / "meta.json", {"status": "preflight-failed"})
                return subprocess.CompletedProcess(cmd, 1)
            with self.assertRaisesRegex(ValueError, "before agent start"):
                p.run(self.plan, self.state, "fixture-hash", -1, free=lambda _: 100,
                      executor=lambda *a: p.execute(*a, transport=transport, free=lambda _: 100))
        self.assertEqual([r["status"] for r in p.read(self.state / "runs.json")], ["not-started"] * 2)
        self.assertEqual(p.score(self.plan, self.state, "fixture-hash")["records"], [])

    def test_transient_grade_failure_resumes_grade_only_and_noncredit_is_rejected(self):
        calls = []
        fail_grade = ["exit"]
        def transport(cmd, **kwargs):
            calls.append(Path(cmd[1]).name)
            if cmd[1].endswith("run-task.sh"):
                path = Path(cmd[cmd.index("--results-root") + 1]) / cmd[2] / f"{cmd[3]}-{cmd[4]}"
                (path / "workdir").mkdir(parents=True)
                p.atomic(path / "meta.json", {"start": "start", "status": "finished", "agent_exit": 0,
                    "task_id": cmd[2], "dry_run": True,
                    "task_manifest_sha256": next(t["card"]["datasetManifestHash"] for t in self.plan["tasks"] if t["id"] == cmd[2])})
                p.atomic(path / "workdir/results.json", {"claims": []})
            elif fail_grade[0] == "exit":
                return subprocess.CompletedProcess(cmd, 1)
            else:
                path = Path(cmd[3]); (path / "grade").mkdir(exist_ok=True)
                p.atomic(path / "grade/task-summary.json", {"task": cmd[2], "attempt": path.name,
                    "check": {"error": fail_grade[0] == "checker"}, "credited": False, "task_passed": False,
                    "reproduced": False, "contamination": "unknown", "rerun": {"ran": False}})
            return subprocess.CompletedProcess(cmd, 0)
        def execute(*args):
            return p.execute(*args, transport=transport, free=lambda _: 100)
        with self.assertRaisesRegex(ValueError, "grading unavailable"):
            p.run(self.plan, self.state, "fixture-hash", -1, executor=execute, free=lambda _: 100)
        original = p.read(self.state / "runs.json")[0]
        self.assertFalse(original["graded"])
        fail_grade[0] = "checker"
        with self.assertRaisesRegex(ValueError, "grading unavailable"):
            p.run(self.plan, self.state, "fixture-hash", -1, executor=execute, free=lambda _: 100)
        fail_grade[0] = False
        rows = p.run(self.plan, self.state, "fixture-hash", -1, max_runs=1, executor=execute, free=lambda _: 100)
        self.assertEqual(calls, ["run-task.sh", "grade-task.sh", "grade-task.sh", "grade-task.sh"])
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["sequence"], original["sequence"])
        self.assertTrue(rows[0]["graded"])
        self.assertEqual(rows[0]["gradeOutcome"], "rejected")

    def test_observed_model_missing_or_mismatched_fails_live_provenance(self):
        live = self.live_plan()
        for index, models in enumerate((["claude-opus-5-5[1m]"], [], ["other"],
                                        ["claude-opus-5-5", "other"])):
            row = {**next(r for r in p.schedule(live) if r["arm"] == "plain-claude"), "retry": index}
            arm = next(a for a in live["arms"] if a["id"] == row["arm"])
            card = next(t["card"] for t in live["tasks"] if t["id"] == row["task"])
            def transport(cmd, **kwargs):
                if cmd[1].endswith("run-task.sh"):
                    path = Path(cmd[cmd.index("--results-root") + 1]) / cmd[2] / f"{cmd[3]}-{cmd[4]}"
                    (path / "workdir").mkdir(parents=True)
                    p.atomic(path / "meta.json", {"start": "started", "status": "finished", "agent_exit": 0,
                        "task_id": row["task"], "task_manifest_sha256": card["datasetManifestHash"], "dry_run": False,
                        "model": arm["modelId"], "effort": arm["effort"], "cli_version": arm["cliVersion"]})
                    (path / "transcript.jsonl").write_text("\n".join(json.dumps({"type": "system", "subtype": "init", "model": m}) for m in models))
                    p.atomic(path / "workdir/results.json", {"claims": []})
                else:
                    path = Path(cmd[3]); (path / "grade").mkdir()
                    p.atomic(path / "grade/task-summary.json", {"task": cmd[2], "attempt": path.name,
                        "credited": True, "task_passed": True, "reproduced": True, "contamination": "none-found", "check": {"items": []},
                        "rerun": {"ran": True, "exit_code": 0, "timed_out": False, "tmp_deleted": True}})
                return subprocess.CompletedProcess(cmd, 0)
            result = p.execute(live, row, self.state, -1, transport=transport, free=lambda _: 2**50)
            self.assertEqual(result["provenanceOk"], index == 0)
            self.assertEqual(result["taskPassed"], index == 0)
            self.assertEqual(result["provenance"]["reportedModels"], models)

    def test_disk_refusal_before_grade_preserves_dispatch_for_resume(self):
        checks, dispatches = [], []
        def floor(*args):
            checks.append(1)
            if len(checks) == 3:  # run preflight, execute preflight, then grading boundary
                raise ValueError("disk floor")
        def transport(cmd, **kwargs):
            dispatches.append(cmd[1])
            self.assertTrue(cmd[1].endswith("run-task.sh"))
            path = Path(cmd[cmd.index("--results-root") + 1]) / cmd[2] / f"{cmd[3]}-{cmd[4]}"
            path.mkdir(parents=True)
            p.atomic(path / "meta.json", {"start": "start", "status": "finished", "agent_exit": 0})
            return subprocess.CompletedProcess(cmd, 0)
        with patch.object(p, "disk_floor", side_effect=floor):
            with self.assertRaisesRegex(ValueError, "disk floor"):
                p.run(self.plan, self.state, "fixture-hash", -1, executor=lambda *a: p.execute(*a, transport=transport))
        rows = p.read(self.state / "runs.json")
        self.assertEqual(len(rows), 1)
        self.assertTrue(rows[0]["dispatched"])
        self.assertFalse(rows[0]["graded"])
        self.assertEqual(len(dispatches), 1)

    def test_adapter_exception_after_dispatch_is_crashed_and_halts(self):
        def transport(cmd, **kwargs):
            path = Path(cmd[cmd.index("--results-root") + 1]) / cmd[2] / f"{cmd[3]}-{cmd[4]}"
            path.mkdir(parents=True)
            p.atomic(path / "meta.json", {"start": "start"})
            raise RuntimeError("adapter failed after dispatch")
        with self.assertRaises(RuntimeError):
            p.run(self.plan, self.state, "fixture-hash", -1, free=lambda _: 100,
                  executor=lambda *a: p.execute(*a, transport=transport, free=lambda _: 100))
        rows = p.read(self.state / "runs.json")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["status"], "crashed")
        self.assertEqual(rows[0]["failure"], "adapter-error")
        self.assertEqual(p.score(self.plan, self.state, "fixture-hash")["records"][0]["status"], "crashed")

    def test_observed_model_and_claude_codex_omerta_usage(self):
        events = [
            {"type": "system", "subtype": "init", "model": "claude-opus-5-5[1m]"},
            {"type": "result", "usage": {"input_tokens": 10, "output_tokens": 3,
                "cache_read_input_tokens": 2}, "total_cost_usd": 0.1},
            {"type": "system", "subtype": "init", "model": "claude-opus-5-5-20261010"},
            {"type": "result", "usage": {"input_tokens": 20, "output_tokens": 4}, "total_cost_usd": 0.2},
            {"type": "turn.completed", "usage": {"input_tokens": 5, "output_tokens": 1, "cached_input_tokens": 3}},
            {"type": "turn.failed", "error": {"message": "quota exceeded"}}]
        (self.state / "transcript.jsonl").write_text("\n".join(json.dumps(e) for e in events))
        result = p.telemetry(self.state, {"model": "requested-is-not-observed"})
        self.assertEqual(result["tokens"], {"inputTokens": 37, "outputTokens": 8})
        self.assertTrue(result["rateLimited"])
        self.assertEqual([p.model_id(m) for m in result["reportedModels"]], ["claude-opus-5-5"] * 2)
        self.assertNotEqual(p.model_id("claude-opus-5-5[unknown]"), "claude-opus-5-5")
        (self.state / "transcript.jsonl").unlink()
        self.assertEqual(p.telemetry(self.state, {"model": "requested"})["reportedModels"], [])

    def test_sentinels_both_ends_separate_attempt_ids(self):
        s = p.schedule(self.plan)
        n = len(self.plan["sentinelTasks"]) * len(self.arms)
        self.assertEqual({r["phase"] for r in s[:n]}, {"start"})
        self.assertEqual({r["phase"] for r in s[-n:]}, {"end"})
        self.assertEqual({r["task"] for r in s[:n]}, set(self.plan["sentinelTasks"]))
        self.assertEqual(len({r["id"] for r in s}), len(s))

    def test_unequal_network_refused(self):
        self.plan["arms"][0]["networkMode"] = "explore"
        with self.assertRaisesRegex(ValueError, "network"):
            p.schedule(self.plan)

    def test_uncalibrated_task_refused(self):
        with patch.object(p, "check_record", return_value=["missing calibration"]):
            with self.assertRaisesRegex(ValueError, "uncalibrated"):
                p.discover()

    def test_stale_inventory_refused(self):
        self.plan["tasks"][0]["calibrationSha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "changed"):
            p.validate(self.plan, self.inventory)

    def test_lock_immutable_even_before_first_run(self):
        h = p.locked(self.plan, self.state, True)
        self.assertEqual(h, p.locked(self.plan, self.state, True))
        self.run_plan(max_runs=1)
        self.plan["seed"] += 1
        with self.assertRaisesRegex(ValueError, "locked"):
            p.locked(self.plan, self.state, True)

    def test_resume_skips_completed_runs(self):
        first = self.run_plan(max_runs=2)
        second = self.run_plan(max_runs=2)
        self.assertEqual(len(second), 4)
        self.assertEqual(len(set(self.calls)), 4)
        self.assertEqual(second[:2], first)

    def test_never_launched_interruption_is_not_started_and_retryable(self):
        def crash(boundary):
            if boundary == "after-start":
                raise Crash()
        with self.assertRaises(Crash):
            self.run_plan(max_runs=1, fault=crash)
        rows = self.run_plan(max_runs=1)
        self.assertEqual(rows[0]["status"], "not-started")
        self.assertFalse(rows[0]["taskPassed"])
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["id"], self.calls[0])
        scored = p.score(self.plan, self.state, "fixture-hash")
        self.assertEqual(len(scored["records"]), 1)
        self.assertEqual(scored["records"][0]["status"], "completed")

    def test_uncheckpointed_fake_execution_without_launch_evidence_cannot_grant_credit(self):
        def crash(boundary):
            if boundary == "after-execution":
                raise Crash()
        with self.assertRaises(Crash):
            self.run_plan(max_runs=1, fault=crash)
        rows = self.run_plan(max_runs=0)
        self.assertEqual(rows[0]["status"], "not-started")
        self.assertFalse(rows[0]["taskPassed"])

    def test_registered_retry_preserves_interruption_audit(self):
        self.plan["retryRule"]["interruptedRetries"] = 1
        with self.assertRaises(Crash):
            self.run_plan(max_runs=1, fault=lambda _: (_ for _ in ()).throw(Crash()))
        row = p.read(self.state / "runs.json")[0]
        path = p.attempt_path(self.state, row)
        path.mkdir(parents=True)
        p.atomic(path / "meta.json", {"start": "start", "status": "running"})
        rows = self.run_plan(max_runs=1)
        self.assertEqual([r["status"] for r in rows], ["interrupted", "completed"])
        self.assertEqual([r["retry"] for r in rows], [0, 1])
        self.assertEqual(rows[0]["id"], rows[1]["id"])

    def test_disk_floor_before_dispatch(self):
        self.plan["diskFloorBytes"] = 101
        with self.assertRaisesRegex(ValueError, "disk floor"):
            self.run_plan()
        self.assertEqual(self.calls, [])
        self.assertEqual(p.read(self.state / "runs.json"), [])

    def test_task_change_between_runs_refuses_before_dispatch(self):
        row = {**p.schedule(self.plan)[0], "retry": 0}
        card = copy.deepcopy(next(t["card"] for t in self.plan["tasks"] if t["id"] == row["task"]))
        card["capMinutes"] += 1
        with patch.object(p, "load_card", return_value=card):
            with self.assertRaisesRegex(ValueError, "changed after registration"):
                p.execute(self.plan, row, self.state, -1, transport=lambda *a, **k: self.fail("dispatched stale task"))

    def test_timeout_crash_and_unknown_exit_classification(self):
        self.assertEqual(p.execution_status(1, {"agent_exit": 137}, {}), "crashed")
        self.assertEqual(p.execution_status(1, {}, {"signal": 9}), "crashed")
        self.assertEqual(p.execution_status(1, {"agent_exit": 137}, {"timed_out": True}), "timeout")
        self.assertEqual(p.execution_status(0, {}, {}), "failed")
        self.assertEqual(p.execution_status(0, {"status": "finished"}, {}), "completed")

    def test_fake_path_impossible_live(self):
        self.plan["dryRun"] = False
        with patch.dict(os.environ, {"ARM_DRY_AGENT": "forbidden"}):
            with self.assertRaisesRegex(ValueError, "fake arms"):
                p.execution_env(self.plan, self.plan["arms"][0])

    def test_operation_lock_bypass_refused(self):
        with patch.dict(os.environ, {"BIO_OPERATION": "arm"}):
            with self.assertRaisesRegex(ValueError, "unsafe"):
                p.execution_env(self.plan, self.plan["arms"][0])

    def test_live_cannot_replace_shared_operation_lock_root(self):
        self.plan["dryRun"] = False
        with patch.dict(os.environ, {"BIO_GRADING_ROOT": str(self.state)}):
            with self.assertRaisesRegex(ValueError, "fake arms"):
                p.execution_env(self.plan, self.plan["arms"][0])

    def test_single_writer(self):
        with p.lease(self.state):
            with self.assertRaisesRegex(ValueError, "active"):
                with p.lease(self.state):
                    self.fail("duplicate owner")

    def test_inherited_lock_survives_controller_release(self):
        with p.lease(self.state) as fd:
            child = subprocess.Popen([sys.executable, "-c", "import sys; print('ready', flush=True); sys.stdin.read()"],
                pass_fds=(fd,), stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
            def cleanup():
                if child.poll() is None:
                    child.kill()
                child.communicate()
            self.addCleanup(cleanup)
            self.assertEqual(child.stdout.readline().strip(), "ready")
        with self.assertRaisesRegex(ValueError, "active"):
            with p.lease(self.state):
                self.fail("surviving child lost lease")
        child.communicate("")
        with p.lease(self.state):
            pass

    def test_whole_dry_schedule_scores_and_resumes(self):
        rows = self.run_plan()
        self.assertEqual(len(rows), len(p.schedule(self.plan)))
        count = len(self.calls)
        self.run_plan()
        self.assertEqual(len(self.calls), count)
        scored = p.score(self.plan, self.state, "fixture-hash")
        self.assertTrue(scored["complete"])
        self.assertEqual(scored["decision"], "unavailable")
        self.assertEqual(sum(a["denominator"] for a in scored["arms"]), len(self.plan["tasks"]) * len(self.arms) * self.plan["attemptsPerArm"])
        self.assertEqual(len(scored["sentinels"]), len(self.plan["sentinelTasks"]) * 2 * len(self.arms) * self.plan["sentinelAttempts"])

    def test_only_and_graceful_stop(self):
        selected = self.plan["tasks"][0]["id"] + "/plain-codex"
        rows = self.run_plan(only=selected, max_runs=1)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["arm"], "plain-codex")
        self.assertEqual(len(self.run_plan(stopped=lambda: True)), 1)


    def test_execute_transport_whole_schedule_and_score(self):
        calls = []
        def transport(cmd, **kwargs):
            self.assertIn("ARM_DRY_AGENT", kwargs["env"])
            self.assertTrue(kwargs["start_new_session"])
            self.assertIn("pass_fds", kwargs)
            calls.append(cmd[1])
            if cmd[1].endswith("run-task.sh"):
                self.assertIn("--dry-run", cmd)
                task, arm, attempt = cmd[2:5]
                root = Path(cmd[cmd.index("--results-root") + 1])
                target = root / task / f"{arm}-{attempt}"
                (target / "workdir").mkdir(parents=True)
                p.atomic(target / "meta.json", {"status": "finished", "start": "fixture-start", "agent_exit": 0, "model": "fake", "cli_version": "fake", "effort": "fake", "dry_run": True,
                    "task_id": task, "task_manifest_sha256": next(t["card"]["datasetManifestHash"] for t in self.plan["tasks"] if t["id"] == task)})
                if arm == "codex-tools":
                    meta = p.read(target / "meta.json")
                    meta.update(toolpack_profile="checks", toolpack_sha256=p.toolpack_settings()["sha256"],
                                toolpack_check="verified", toolpack_intact_after_run=True)
                    p.atomic(target / "meta.json", meta)
                p.atomic(target / "workdir/results.json", {"claims": []})
            else:
                self.assertTrue(cmd[1].endswith("grade-task.sh"))
                task, target = cmd[2], Path(cmd[3])
                (target / "grade").mkdir()
                p.atomic(target / "grade/task-summary.json", {"task": task, "attempt": target.name,
                    "credited": True, "task_passed": True, "reproduced": True, "contamination": "none-found", "check": {"items": []},
                    "rerun": {"ran": True, "exit_code": 0, "timed_out": False, "tmp_deleted": True}})
            return subprocess.CompletedProcess(cmd, 0)
        rows = p.run(self.plan, self.state, "fixture-hash", -1, now=lambda: next(self.ticks), free=lambda _: 100,
                     executor=lambda *args: p.execute(*args, transport=transport, free=lambda _: 100))
        self.assertEqual(len(calls), len(rows) * 2)
        self.assertTrue(all(r["status"] == "completed" and r["taskPassed"] for r in rows))
        scored = p.score(self.plan, self.state, "fixture-hash")
        self.assertTrue(scored["complete"])
        self.assertEqual(scored["decision"], "unavailable")
        self.assertTrue(all(a["falseVerifiedRate"] is None for a in scored["arms"]))

    def test_cli_dry_discover_lock_zero_runs_score(self):
        planfile = self.state / "plan.json"
        for args in (["discover", "--dry-run"], ["lock"], ["run", "--dry-run", "--max-runs", "0"], ["score"]):
            result = subprocess.run([sys.executable, str(p.HERE / "pilot.py"), *args,
                "--plan", str(planfile), "--state", str(self.state)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
        score = p.read(self.state / "scoreboard.json")
        self.assertTrue(score["dryRun"])
        self.assertFalse(score["complete"])
        self.assertIn("unavailable", (self.state / "scoreboard.md").read_text())

    def prepared_row(self, status="finished", arm=None, live=False):
        plan = self.live_plan() if live else self.plan
        spec = next(r for r in p.schedule(plan) if arm is None or r["arm"] == arm)
        row = {**spec, "retry": 0, "status": "running", "settingsHash": "fixture-hash",
               "sequence": 1, "startedAt": 100, "claims": [], "claimsAvailable": False,
               "taskPassed": False, "gradeOutcome": "unavailable", "provenance": None,
               "provenanceOk": False, "wallClockMs": None}
        path = p.attempt_path(self.state, row)
        (path / "workdir").mkdir(parents=True)
        task = next(t for t in plan["tasks"] if t["id"] == row["task"])
        config = next(a for a in plan["arms"] if a["id"] == row["arm"])
        meta = {"start": "start", "status": status, "task_id": row["task"],
                "dry_run": not live, "task_manifest_sha256": task["card"]["datasetManifestHash"],
                "model": config["modelId"], "cli_version": config["cliVersion"], "effort": config["effort"]}
        if status not in ("running", "preparing"):
            meta.update(end="end", agent_exit=0, tmp_deleted=True)
        p.atomic(path / "meta.json", meta)
        p.atomic(path / "workdir/results.json", {"claims": []})
        p.atomic(self.state / "runs.json", [row])
        return plan, row, path, meta

    def grade_transport(self, rc=0, credited=True):
        def transport(cmd, **kwargs):
            self.assertTrue(cmd[1].endswith("pilot/grade-task.sh"))
            path = Path(cmd[3])
            (path / "grade").mkdir(exist_ok=True)
            p.atomic(path / "grade/task-summary.json", {"task": cmd[2], "attempt": path.name,
                "credited": credited, "task_passed": credited, "reproduced": True, "contamination": "none-found", "check": {"items": []},
                "rerun": {"ran": True, "exit_code": 0, "timed_out": False, "tmp_deleted": rc != 3}})
            return subprocess.CompletedProcess(cmd, rc)
        return transport

    def test_recovery_finalized_child_resumes_grading_without_relaunch(self):
        for terminal, deleted, expected in (("finished", True, "completed"), ("finished", False, "failed"),
                                           ("timed-out", True, "timeout")):
            with self.subTest(terminal=terminal, deleted=deleted):
                if (self.state / "runs.json").exists():
                    import shutil
                    shutil.rmtree(self.state / "results")
                plan, row, path, meta = self.prepared_row(terminal)
                meta["tmp_deleted"] = deleted
                p.atomic(path / "meta.json", meta)
                rows = p.run(plan, self.state, "fixture-hash", -1, max_runs=1, free=lambda _: 100,
                    executor=lambda *a: p.execute(*a, transport=self.grade_transport(), free=lambda _: 100))
                self.assertEqual(len(rows), 1)
                self.assertEqual(rows[0]["status"], expected)
                self.assertTrue(rows[0]["graded"])

    def test_recovery_cancelled_before_agent_excluded(self):
        _, row, path, meta = self.prepared_row()
        meta["cancelled_before_agent"] = True
        p.atomic(path / "meta.json", meta)
        rows = self.run_plan(max_runs=0)
        self.assertEqual(rows[0]["status"], "not-started")
        self.assertEqual(p.score(self.plan, self.state, "fixture-hash")["records"], [])

    def test_running_child_metadata_is_infrastructure_unknown_not_crash(self):
        self.prepared_row("running")
        self.plan["retryRule"]["interruptedRetries"] = 0
        rows = self.run_plan(max_runs=0)
        self.assertEqual(rows[0]["status"], "interrupted")
        self.assertFalse(rows[0]["crashed"])
        result = p.score(self.plan, self.state, "fixture-hash")
        self.assertEqual(result["records"], [])
        self.assertEqual(len(result["infrastructureUnknowns"]), 1)

    def test_exit_three_determinate_summary_rejected_with_cleanup_warning(self):
        plan, row, path, _ = self.prepared_row()
        row.update(dispatched=True, graded=False, exit=0, dispatchMs=17)
        result = p.execute(plan, row, self.state, -1, transport=self.grade_transport(3),
                           free=lambda _: 100, now=iter([10, 10.025]).__next__)
        self.assertTrue(result["graded"])
        self.assertFalse(result["taskPassed"])
        self.assertEqual(result["gradeOutcome"], "rejected")
        self.assertEqual(result["infrastructureWarnings"], ["grader-cleanup"])
        self.assertEqual(result["wallClockMs"], 17)
        self.assertEqual(result["gradingMs"], 25)

    def test_regrade_does_not_accumulate_failed_grading_time(self):
        plan, row, path, _ = self.prepared_row()
        row.update(dispatched=True, graded=False, exit=0, dispatchMs=17, wallClockMs=17)
        p.atomic(self.state / "runs.json", [row])
        with self.assertRaisesRegex(ValueError, "grading unavailable"):
            p.run(plan, self.state, "fixture-hash", -1, max_runs=1, free=lambda _: 100,
                  executor=lambda *a: p.execute(*a, transport=lambda *a, **k: subprocess.CompletedProcess([], 1),
                    free=lambda _: 100, now=iter([0, 90]).__next__))
        rows = p.run(plan, self.state, "fixture-hash", -1, max_runs=1, free=lambda _: 100,
            executor=lambda *a: p.execute(*a, transport=self.grade_transport(), free=lambda _: 100,
                                          now=iter([100, 100.005]).__next__))
        self.assertEqual(rows[0]["wallClockMs"], 17)
        self.assertEqual(rows[0]["gradingMs"], 5)
        self.assertEqual(rows[0]["gradingAttempts"], 2)

    def test_grading_retry_exhaustion_halts_without_relaunch_or_loop(self):
        plan, row, path, _ = self.prepared_row()
        plan["retryRule"]["gradingRetries"] = 0
        row.update(dispatched=True, graded=False, exit=0)
        p.atomic(self.state / "runs.json", [row])
        calls = []
        def transport(*args, **kwargs):
            calls.append(1)
            raise OSError("grader infrastructure")
        with self.assertRaises(OSError):
            p.run(plan, self.state, "fixture-hash", -1, free=lambda _: 100,
                  executor=lambda *a: p.execute(*a, transport=transport, free=lambda _: 100))
        self.assertEqual(p.read(self.state / "runs.json")[0]["status"], "grading-failed")
        with self.assertRaisesRegex(ValueError, "retry limit"):
            p.run(plan, self.state, "fixture-hash", -1, free=lambda _: 100,
                  executor=lambda *a: self.fail("exhausted grading dispatched"))
        self.assertEqual(calls, [1])

    def test_exhausted_grading_with_complete_summary_records_rejection(self):
        plan, row, path, _ = self.prepared_row()
        plan["retryRule"]["gradingRetries"] = 0
        self.grade_transport()(["bash", str(p.HERE / "grade-task.sh"), row["task"], str(path)])
        row.update(dispatched=True, graded=False, exit=0, gradingAttempts=1)
        p.atomic(self.state / "runs.json", [row])
        rows = p.run(plan, self.state, "fixture-hash", -1, max_runs=1, free=lambda _: 100,
            executor=lambda *a: p.execute(*a, transport=lambda *a, **k: self.fail("exhausted retry launched"), free=lambda _: 100))
        self.assertTrue(rows[0]["graded"])
        self.assertEqual(rows[0]["gradeOutcome"], "rejected")
        self.assertEqual(rows[0]["infrastructureWarnings"], ["grader-retries-exhausted"])

    def test_partial_summary_is_infrastructure_unknown(self):
        _, row, path, _ = self.prepared_row()
        self.assertFalse(p.determinate_summary({"task": row["task"], "attempt": path.name,
            "credited": False, "task_passed": False}, row["task"], path.name))

    def test_dispatch_clock_persisted_on_adapter_exception(self):
        row = {**p.schedule(self.plan)[0], "retry": 0}
        def transport(cmd, **kwargs):
            path = p.attempt_path(self.state, row)
            path.mkdir(parents=True)
            p.atomic(path / "meta.json", {"start": "start"})
            raise RuntimeError("adapter-error")
        with self.assertRaises(RuntimeError):
            p.execute(self.plan, row, self.state, -1, transport=transport, free=lambda _: 100,
                      now=iter([0, 0.011]).__next__)
        self.assertEqual(row["dispatchMs"], 11)
        self.assertEqual(row["wallClockMs"], 11)

    def test_sparsity_retry_and_identity_source_settings_validated_and_hash_locked(self):
        live = self.live_plan()
        mutations = [lambda x: x["statistics"].update(minConfirmationTasks=7),
                     lambda x: x["statistics"].update(maxDroppedBootstrapShare=0.02),
                     lambda x: x["statistics"].update(maxDroppedBootstrapShare=float("nan")),
                     lambda x: x["retryRule"].update(gradingRetries=-1),
                     lambda x: x["arms"][1].update(identitySource="unavailable"),
                     lambda x: x["arms"][2].update(cliVersion="different")]
        for change in mutations:
            bad = copy.deepcopy(live); change(bad)
            with self.assertRaises(ValueError):
                p.validate(bad)
        p.locked(self.plan, self.state, True)
        for field, value in (("minConfirmationTasks", 9), ("maxDroppedBootstrapShare", 0)):
            bad = copy.deepcopy(self.plan); bad["statistics"][field] = value
            with self.assertRaisesRegex(ValueError, "locked"):
                p.locked(bad, self.state)
        bad = copy.deepcopy(self.plan); bad["retryRule"]["gradingRetries"] += 1
        with self.assertRaisesRegex(ValueError, "locked"):
            p.locked(bad, self.state)

    def test_realistic_codex_events_session_receipt_and_provenance_unavailable_score(self):
        from codex_identity import observed_identity
        plan, row, path, meta = self.prepared_row(arm="plain-codex", live=True)
        events = [{"type": "thread.started", "thread_id": "thread-123"}, {"type": "turn.started"},
                  {"type": "turn.completed", "usage": {"input_tokens": 12, "output_tokens": 3}}]
        transcript = path / "transcript.jsonl"
        transcript.write_text("\n".join(map(json.dumps, events)))
        row.update(dispatched=True, graded=False, exit=0)
        result = p.execute(plan, row, self.state, -1, transport=self.grade_transport(), free=lambda _: 2**50)
        self.assertFalse(result["provenanceOk"])
        self.assertEqual(result["gradeOutcome"], "unavailable")
        self.assertEqual(result["failure"], "provenance-unverified")
        p.atomic(self.state / "runs.json", [{**row, **result}])
        scoreboard = p.score(plan, self.state, "fixture-hash")
        arm = next(a for a in scoreboard["arms"] if a["arm"] == "plain-codex")
        self.assertIsNone(arm["taskPassRate"])
        self.assertEqual(arm["availability"], "provenance unavailable")
        self.assertFalse(scoreboard["confirmatory"])
        home = self.state / "codex-home"
        (home / "sessions").mkdir(parents=True)
        rollout = home / "sessions/rollout.jsonl"
        def receipt(model="gpt-6-astra", effort="high", thread="thread-123"):
            rollout.write_text("\n".join(map(json.dumps, [
                {"type": "session_meta", "payload": {"id": thread}},
                {"type": "turn_context", "payload": {"model": model, "effort": effort}}])))
            meta.update(observed_identity(home, transcript))
            p.atomic(path / "meta.json", meta)
        receipt(thread="wrong-thread")
        self.assertEqual(meta["model_reported"], [])
        for model, effort, expected in (("gpt-6-astra", "high", True), ("other", "high", False),
                                         ("gpt-6-astra", "low", False)):
            receipt(model, effort)
            row["gradingAttempts"] = 0
            result = p.execute(plan, row, self.state, -1, transport=self.grade_transport(), free=lambda _: 2**50)
            self.assertEqual(result["provenanceOk"], expected)
            self.assertEqual(result["taskPassed"], expected)
        runner = (p.BASE / "arms/run-codex-arm.sh").read_text()
        self.assertNotIn("--ephemeral", runner)
        self.assertLess(runner.index('"$PY" "$PKG/../bio-tasks/pilot/codex_identity.py"'), runner.rindex("arm_finish"))

    def test_agent_output_errors_write_full_determinate_summary(self):
        import grading as hardened
        shared = hardened.shared
        plan, row, path, meta = self.prepared_row()
        work = path / "workdir"
        (work / "run_all.sh").write_text("exit 0")
        (work / "REPORT.md").write_text("fixture")
        p.atomic(work / "results.json", {"estimate": 10 ** 400, "claims": []})
        def rerun(attempt, data, cap, output):
            output.mkdir(parents=True, exist_ok=True)
            p.atomic(output / "results.json", {"estimate": 1, "claims": []})
            return {"ran": True, "exit_code": 0, "timed_out": False, "tmp_deleted": True}
        # Fault injection at the comparison boundary: numeric overflow is now a
        # determinate mismatch, so do not rely on it accidentally throwing here.
        with patch.object(shared, "inputs_match", return_value=[]), \
             patch.object(shared.grade, "rerun", side_effect=rerun), \
             patch.object(shared.grade, "compare_numbers", side_effect=OverflowError("fixture content")):
            with hardened.hardened():
                rec = shared.grade_one(p.PKG, {"id": row["task"], "datasetManifestHash": meta["task_manifest_sha256"]},
                                       path, self.state, self.state / "key", self.state, 1)
                summary = shared.summary(rec)
                self.assertFalse(summary["credited"])
                self.assertFalse(summary["task_passed"])
                self.assertTrue(summary["agent_output_failure"])
                self.assertEqual(summary["not_credited_reasons"], ["agent-output-failure"])
        # Exercise the real shared persistence/summary and CLI exit path with sealed I/O stubs.
        # All content here is synthetic; no actual answer key is opened.
        from contextlib import ExitStack, nullcontext, redirect_stdout
        from io import StringIO
        from biotasks import cli
        card = {"id": row["task"], "datasetManifestHash": meta["task_manifest_sha256"]}
        def seal_stub(plain, tmp):
            enc = plain.with_suffix(".enc")
            enc.write_text("fixture ciphertext")
            enc.with_name(enc.name + ".sha256").write_text("fixture hash")
            plain.unlink()
            return enc
        with ExitStack() as stack:
            for obj, name, value in ((shared, "load_card", card), (shared.calibrate, "check_record", []),
                    (shared.staging, "run_stage", card["datasetManifestHash"]), (shared.staging, "verify", []),
                    (shared, "inputs_match", []), (shared, "key_path", self.state / "key.enc")):
                stack.enter_context(patch.object(obj, name, return_value=value))
            stack.enter_context(patch.object(shared.sealing, "scratch", side_effect=lambda *a: nullcontext(self.state)))
            stack.enter_context(patch.object(shared.sealing, "opened", side_effect=lambda *a: nullcontext(self.state / "key")))
            stack.enter_context(patch.object(shared.sealing, "seal_file", side_effect=seal_stub))
            stack.enter_context(patch.object(shared.grade, "rerun", side_effect=rerun))
            stack.enter_context(patch.object(shared.grade, "compare_numbers", side_effect=OverflowError("fixture content")))
            with hardened.hardened(), redirect_stdout(StringIO()):
                self.assertEqual(cli.cmd_grade(row["task"], [path], 1), 0)
            written = p.read(path / "grade/task-summary.json")
            self.assertTrue(written["agent_output_failure"])
            self.assertFalse(written["credited"])
            self.assertTrue(p.determinate_summary(written, row["task"], path.name))
        # Exact content boundaries: all convert hostile values to a bounded rejection.
        for name in ("compare_numbers", "scan_transcript"):
            with patch.object(shared.grade, name, side_effect=TypeError("agent content")):
                with hardened.hardened(), self.assertRaises(hardened.AgentOutputError):
                    getattr(shared.grade, name)()
        with patch.object(shared, "claims_view", side_effect=RecursionError()):
            with hardened.hardened(), self.assertRaises(hardened.AgentOutputError):
                shared.claims_view({})
        with patch.object(Path, "rglob", side_effect=PermissionError(13, "agent output tree")):
            with hardened.hardened(), self.assertRaises(hardened.AgentOutputError):
                list(work.rglob("*"))
        import errno
        with self.assertRaises(OSError):
            hardened.content_call(lambda: (_ for _ in ()).throw(OSError(errno.ENOSPC, "host full")))()

    def test_unreadable_rerun_result_is_agent_failure_but_destination_failure_is_infra(self):
        import grading as hardened
        source = self.state / "biobase-grade.fixture/run/results.json"
        destination = self.state / "grade/results.json"
        for blocked in (source, destination):
            with patch.object(hardened.shutil, "copy2", side_effect=PermissionError(13, "unreadable", str(blocked))):
                with hardened.hardened(), self.assertRaises(hardened.AgentOutputError if blocked == source else OSError):
                    hardened.shutil.copy2(source, destination)

    def test_grader_infrastructure_failure_is_not_agent_output_failure(self):
        import grading as hardened
        with patch.object(hardened.shared.grade, "rerun", return_value={"ran": False, "reason": "pixi or sandbox-exec unavailable"}):
            with hardened.hardened(), self.assertRaisesRegex(RuntimeError, "infrastructure"):
                hardened.shared.grade.rerun()
        root = self.state / "biobase-grade.unknown"
        root.mkdir()
        with self.assertRaises(OSError):
            hardened.prepare_delete(root, command=lambda cmd, **kw:
                subprocess.CompletedProcess(cmd, 1, stdout="", stderr="census unavailable"))

    def test_claude_assistant_and_result_identity_mismatches_are_retained(self):
        (self.state / "transcript.jsonl").write_text("\n".join(map(json.dumps, [
            {"type": "system", "subtype": "init", "model": "expected"},
            {"type": "assistant", "message": {"model": "other"}},
            {"type": "result", "modelUsage": {"third": {}}}])))
        self.assertEqual(p.telemetry(self.state, {})["reportedModels"], ["expected", "other", "third"])

    def test_cleanup_traverses_mode_zero_directories_and_reaps_escaped_processes(self):
        import grading as hardened
        import shutil
        root = self.state / "biobase-grade.fixture"
        child = root / "hidden/nested"
        child.mkdir(parents=True)
        (child / "output").write_text("fixture")
        child.chmod(0)
        child.parent.chmod(0)
        calls, killed = [], []
        def command(cmd, **kwargs):
            calls.append(cmd)
            return subprocess.CompletedProcess(cmd, 0, stdout="999999\n" if cmd[0] == "lsof" else "", stderr="")
        hardened.prepare_delete(root, command=command, kill=lambda *args: killed.append(args))
        self.assertEqual(killed, [(999999, 9)])
        self.assertTrue(any(c[0] == "lsof" for c in calls))
        if sys.platform == "darwin":
            self.assertEqual(calls[0][:4], ["chflags", "-R", "-P", "nouchg"])
        shutil.rmtree(root)
        self.assertFalse(root.exists())



if __name__ == "__main__":
    unittest.main()
