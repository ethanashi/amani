"""Disabled arms, per-arm attempts and hash-chained amendments. Injected executor/CLI probes, no live models."""
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

FIXTURE_TASKS = ("p1-esr1", "p10-pseudorep", "p9-leakage", "w0-venet")
QUOTA = "Codex weekly quota reset: A-prime and B attempts 2-3"
STAMP = "2026-10-17T09:00:00Z"


class AmendTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.all_tasks = p.discover()
        cls.inventory = [t for t in cls.all_tasks if t["id"] in FIXTURE_TASKS]

    def setUp(self):
        parent = Path.home() / ".omerta-bio/grading"
        parent.mkdir(parents=True, exist_ok=True)
        self.tmp = tempfile.TemporaryDirectory(prefix="pilot-amend.", dir=parent)
        self.addCleanup(self.tmp.cleanup)
        self.state = Path(self.tmp.name)
        # Approved shape: A x3, A-prime x1, B x1, v1 C retired.
        self.plan = p.make_plan(copy.deepcopy(self.inventory), True)
        self.plan["diskFloorBytes"] = 1
        self.plan["statistics"]["resamples"] = 32
        self.calls = []
        self.clock = iter(range(100000))

    def fake(self, plan, row, state, fd):
        self.calls.append(row["id"])
        return {"status": "completed", "exit": 0, "gradeExit": 0, "timedOut": False, "crashed": False,
                "provenance": {"modelId": "fake", "cliVersion": "fake", "effort": "fake"}, "provenanceOk": True,
                "taskPassed": True, "gradeOutcome": "accepted", "claims": [], "claimsAvailable": True}

    def run_plan(self, plan, digest, history=(), **kwargs):
        return p.run(plan, self.state, digest, -1, now=lambda: next(self.clock), free=lambda _: 100,
                     executor=self.fake, wall_now=lambda: 1000 + len(self.calls), history=history, **kwargs)

    def score(self, plan):
        study = p.open_study(plan, self.state)
        return p.score(plan, self.state, study["head"], history=study["plans"][:-1], chain=study["chain"],
                       amendments=study["amendments"])

    @staticmethod
    def with_attempts(plan, attempts):
        new = copy.deepcopy(plan)
        for arm in new["arms"]:
            arm["attempts"] = attempts.get(arm["id"], arm["attempts"])
        return new

    def registration(self):
        return p.read(self.state / "registration.json")

    def fixture_registry(self, extra=None, edit=None):
        data = p.read(p.REGISTRY)
        if extra:
            data["arms"].update(extra)
        if edit:
            edit(data["arms"])
        path = self.state / "arms-fixture.json"
        p.atomic(path, data)
        return path

    def test_disabled_arm_gets_no_rows_and_is_excluded_from_scoring(self):
        self.assertEqual(self.plan["disabledArms"], {"omerta-bio": p.RETIRED_C})
        self.assertFalse(any(r["arm"] == "omerta-bio" for r in p.schedule(self.plan)))
        digest = p.locked(self.plan, self.state, True)
        self.run_plan(self.plan, digest)
        self.assertFalse(any("omerta-bio" in c for c in self.calls))
        scored = self.score(self.plan)
        self.assertNotIn("omerta-bio", [a["arm"] for a in scored["arms"]])
        self.assertFalse(any(c["arm"] == "omerta-bio" for c in scored["cells"]))
        self.assertFalse(any("omerta-bio" in (c["b"], c["c"]) for c in scored["comparisons"]))
        self.assertEqual(scored["disabledArms"], [{"arm": "omerta-bio", "reason": p.RETIRED_C,
                                                   "availability": "disabled: " + p.RETIRED_C}])
        self.assertTrue(all(c["availability"].startswith("disabled: ") for c in scored["disabledCells"]))
        self.assertIn(f"| omerta-bio | disabled: {p.RETIRED_C} |", scored["markdown"])
        self.assertIn(f"| codex-tools vs omerta-bio | disabled: omerta-bio: {p.RETIRED_C} |", scored["markdown"])
        self.assertEqual(scored["decision"], "unavailable")
        self.assertIn(f"treatment omerta-bio disabled: {p.RETIRED_C}", scored["decisionReason"])
        # The controller itself refuses to dispatch a disabled arm, even when handed a forged row.
        forged = {"id": "main-p9-leakage-omerta-bio-1", "task": "p9-leakage", "arm": "omerta-bio", "attempt": 1,
                  "phase": "main", "window": 0, "retry": 0}
        with self.assertRaisesRegex(ValueError, "never dispatched"):
            p.execute(self.plan, forged, self.state, -1, transport=lambda *a, **k: self.fail("dispatched"))
        with self.assertRaisesRegex(ValueError, "another plan"):
            p.atomic(self.state / "runs.json", [*p.read(self.state / "runs.json"),
                                                {**forged, "settingsHash": digest, "status": "completed"}])
            self.score(self.plan)

    def test_disabled_arm_settings_are_validated(self):
        for change, message in ((lambda x: x["disabledArms"].update({"plain-codex": " "}), "non-empty reason"),
                                (lambda x: x["disabledArms"].update({"unknown-arm": "x"}), "disabled arms"),
                                (lambda x: x["disabledArms"].pop("omerta-bio"), "retired"),
                                (lambda x: x["disabledArms"].update({a: "x" for a in p.BASE_ARMS}), "at least one")):
            bad = copy.deepcopy(self.plan)
            change(bad)
            with self.assertRaisesRegex(ValueError, message):
                p.validate(bad)
        quota = copy.deepcopy(self.plan)
        quota["disabledArms"]["plain-codex"] = "Codex quota exhausted"
        self.assertEqual({r["arm"] for r in p.schedule(quota)}, {"plain-claude", "codex-tools"})

    def test_per_arm_attempts_interleave_and_are_recorded_in_the_lock(self):
        rows = p.schedule(self.plan)
        main = [r for r in rows if r["phase"] == "main"]
        expected = {"plain-claude": 3, "plain-codex": 1, "codex-tools": 1}
        for task in FIXTURE_TASKS:
            for arm, n in expected.items():
                self.assertEqual(sorted(r["attempt"] for r in main if (r["task"], r["arm"]) == (task, arm)),
                                 list(range(1, n + 1)))
        # Each (phase, task, attempt) block is contiguous and holds exactly the arms with that many attempts.
        blocks = []
        for r in rows:
            key = (r["phase"], r["task"], r["attempt"])
            if not blocks or blocks[-1][0] != key:
                blocks.append((key, []))
            blocks[-1][1].append(r["arm"])
        self.assertEqual(len(blocks), len({k for k, _ in blocks}))
        for (phase, _, attempt), arms in blocks:
            want = {a for a, n in expected.items() if (n if phase == "main" else 1) >= attempt}
            self.assertEqual(set(arms), want)
            self.assertEqual(len(arms), len(want))
        # Omitted attempts default to attemptsPerArm; the locked settings record each arm explicitly.
        loose = copy.deepcopy(self.plan)
        del loose["arms"][0]["attempts"]
        with self.assertRaises(ValueError):
            p.validate(loose)
        resolved = p.normalize(loose)
        self.assertEqual(resolved["arms"][0]["attempts"], resolved["attemptsPerArm"])
        p.locked(resolved, self.state, True)
        self.assertEqual({a["id"]: a["attempts"] for a in self.registration()["plan"]["arms"]},
                         {"plain-claude": 3, "plain-codex": 1, "omerta-bio": 3, "codex-tools": 1})

    def test_raise_attempts_appends_rows_after_existing_and_never_reruns(self):
        base_digest = p.locked(self.plan, self.state, True)
        base_schedule = self.registration()["schedule"]
        first = copy.deepcopy(self.run_plan(self.plan, base_digest))
        executed = list(self.calls)
        amended = self.with_attempts(self.plan, {"plain-codex": 3, "codex-tools": 3})
        record = p.amend(amended, self.state, QUOTA, now=lambda: STAMP)
        self.assertEqual(record["diff"], [
            {"op": "raise-attempts", "arm": "plain-codex", "from": 1, "to": 3},
            {"op": "raise-attempts", "arm": "codex-tools", "from": 1, "to": 3}])
        self.assertEqual((record["index"], record["timestamp"], record["reason"], record["previous"]),
                         (1, STAMP, QUOTA, base_digest))
        schedule = self.registration()["schedule"]
        self.assertEqual(schedule[:len(base_schedule)], base_schedule)
        added = schedule[len(base_schedule):]
        self.assertEqual(len(added), len(FIXTURE_TASKS) * 2 * 2)
        self.assertEqual({(r["phase"], r["window"]) for r in added}, {("main", 1)})
        self.assertEqual({r["arm"] for r in added}, {"plain-codex", "codex-tools"})
        self.assertEqual({r["attempt"] for r in added}, {2, 3})
        for i in range(0, len(added), 2):  # same interleaving rule: both arms per (task, attempt) block
            self.assertEqual({r["arm"] for r in added[i:i + 2]}, {"plain-codex", "codex-tools"})
            self.assertEqual(len({(r["task"], r["attempt"]) for r in added[i:i + 2]}), 1)
        with self.assertRaisesRegex(ValueError, "pre-registered settings are locked"):
            p.locked(self.plan, self.state)
        study = p.open_study(amended, self.state)
        self.assertEqual(study["head"], record["hash"])
        self.assertEqual(study["chain"], [base_digest, record["hash"]])
        rows = self.run_plan(amended, study["head"], history=study["plans"][:-1])
        self.assertEqual(rows[:len(first)], first)
        self.assertEqual(self.calls[len(executed):], [r["id"] for r in added])
        self.assertEqual({r["settingsHash"] for r in rows[len(first):]}, {record["hash"]})
        self.run_plan(amended, study["head"], history=study["plans"][:-1])
        self.assertEqual(len(self.calls), len(executed) + len(added))
        scored = self.score(amended)
        self.assertTrue(scored["complete"])
        pairs = {(c["b"], c["c"]): c for c in scored["comparisons"]}
        same = pairs[("plain-codex", "codex-tools")]
        self.assertEqual((same["status"], same["windowConfounded"], same["windows"]), ("available", False, {"b": [0, 1], "c": [0, 1]}))
        mixed = pairs[("plain-claude", "plain-codex")]
        self.assertEqual((mixed["status"], mixed["windowConfounded"], mixed["windows"]), ("available", True, {"b": [0], "c": [0, 1]}))
        self.assertIn(f"- Amendment 1 ({STAMP} UTC): {QUOTA} Changes: raise plain-codex attempts 1 to 3; "
                      "raise codex-tools attempts 1 to 3.", scored["markdown"])
        self.assertIn("WINDOW-CONFOUNDED (plain-claude 0 vs plain-codex 0+1)", scored["markdown"])
        self.assertEqual(scored["amendments"][0]["hash"], record["hash"])

    def test_amendment_chain_and_rows_are_tamper_evident(self):
        digest = p.locked(self.plan, self.state, True)
        amended = self.with_attempts(self.plan, {"plain-codex": 2, "codex-tools": 2})
        record = p.amend(amended, self.state, QUOTA, now=lambda: STAMP)
        original = self.registration()
        for path, value in ((("reason",), "edited"), (("timestamp",), "2026-10-18T09:00:00Z"),
                            (("diff", 0, "to"), 9), (("previous",), "0" * 64)):
            with self.subTest(field=path):
                bad = copy.deepcopy(original)
                target = bad["amendments"][0]
                for key in path[:-1]:
                    target = target[key]
                target[path[-1]] = value
                p.atomic(self.state / "registration.json", bad)
                with self.assertRaisesRegex(ValueError, "amendment chain broken"):
                    p.locked(amended, self.state)
        # A forged record whose own hash is recomputed still breaks the link to the previous head.
        bad = copy.deepcopy(original)
        forged = bad["amendments"][0]
        forged["previous"] = "0" * 64
        forged["hash"] = p.hashes([{k: v for k, v in forged.items() if k != "hash"}])[0]
        p.atomic(self.state / "registration.json", bad)
        with self.assertRaisesRegex(ValueError, "amendment chain broken"):
            p.locked(amended, self.state)
        bad = copy.deepcopy(original)
        bad["schedule"] = bad["schedule"][1:] + bad["schedule"][:1]
        p.atomic(self.state / "registration.json", bad)
        with self.assertRaisesRegex(ValueError, "locked schedule changed"):
            p.locked(amended, self.state)
        p.atomic(self.state / "registration.json", original)
        self.assertEqual(p.locked(amended, self.state), record["hash"])
        # A window-1 row cannot carry the pre-amendment hash, nor any hash outside the chain.
        study = p.open_study(amended, self.state)
        spec = next(r for r in study_schedule(amended, study) if r["window"] == 1)
        for stamp, message in ((digest, "predates its amendment"), ("f" * 64, "another plan")):
            p.atomic(self.state / "runs.json", [{**spec, "retry": 0, "settingsHash": stamp, "status": "completed"}])
            with self.assertRaisesRegex(ValueError, message):
                self.score(amended)

    def test_forbidden_amendments_are_refused(self):
        digest = p.locked(self.plan, self.state, True)
        self.run_plan(self.plan, digest, max_runs=3)
        before = (self.state / "registration.json").read_bytes()
        def edit(change):
            plan = copy.deepcopy(self.plan)
            change(plan)
            return plan
        refused = {
            "task removed": (edit(lambda x: x["tasks"].pop(1)), "cannot change tasks"),
            "task calibration changed": (edit(lambda x: x["tasks"][0].update(calibrationSha256="0" * 64)), "cannot change tasks"),
            "cap changed": (edit(lambda x: x["tasks"][1].update(capSec=x["tasks"][1]["capSec"] - 60)), "cannot change tasks"),
            "grader cap changed": (edit(lambda x: x.update(gradingCapSec=600)), "cannot change gradingCapSec"),
            "grader retries changed": (edit(lambda x: x["retryRule"].update(gradingRetries=3)), "cannot change retryRule"),
            "statistics changed": (edit(lambda x: x["statistics"].update(resamples=64)), "cannot change statistics"),
            "seed changed": (edit(lambda x: x.update(seed=1)), "cannot change seed"),
            "sentinels changed": (edit(lambda x: x.update(sentinelTasks=x["sentinelTasks"][:2])), "cannot change sentinelTasks"),
            "attempts lowered": (self.with_attempts(self.plan, {"plain-claude": 2}), "cannot lower attempts"),
            "arms reordered": (edit(lambda x: x["arms"].insert(0, x["arms"].pop(1))), "remove or reorder"),
            "arm settings changed": (edit(lambda x: [a.update(effort="medium") for a in x["arms"] if a["id"] in ("plain-codex", "codex-tools")]),
                                     "cannot change plain-codex settings"),
            "arm disabled": (edit(lambda x: x["disabledArms"].update({"plain-codex": "quota"})), "cannot disable an arm"),
            "retired arm enabled": (edit(lambda x: x["disabledArms"].pop("omerta-bio")), "retired arm cannot be enabled"),
            "reserved arm added": (edit(lambda x: x["arms"].append({**x["arms"][0], "id": "omerta-v2"})), "reserved arm"),
            "base arm removed": (edit(lambda x: x["arms"].pop(1)), "registered pilot arms are required"),
            "nothing changed": (copy.deepcopy(self.plan), "changes nothing"),
        }
        for name, (plan, message) in refused.items():
            with self.subTest(name):
                with self.assertRaisesRegex(ValueError, message):
                    p.amend(plan, self.state, "fixture", now=lambda: STAMP)
        raised = self.with_attempts(self.plan, {"plain-codex": 3})
        with patch.object(p, "grader_sha256", return_value="0" * 64):
            with self.assertRaisesRegex(ValueError, "grader changed"):
                p.amend(raised, self.state, "fixture", now=lambda: STAMP)
        for reason in ("", "   ", "x" * 2001):
            with self.assertRaisesRegex(ValueError, "reason"):
                p.amend(raised, self.state, reason, now=lambda: STAMP)
        self.assertEqual((self.state / "registration.json").read_bytes(), before)
        self.assertEqual(p.locked(self.plan, self.state), digest)

    def test_enable_disabled_arm_and_add_registered_arm_by_amendment(self):
        base = copy.deepcopy(self.plan)
        base["disabledArms"]["plain-codex"] = "Codex quota exhausted until reset"
        digest = p.locked(base, self.state, True)
        self.run_plan(base, digest)
        self.assertFalse(any("plain-codex" in c for c in self.calls))
        enabled = copy.deepcopy(base)
        del enabled["disabledArms"]["plain-codex"]
        record = p.amend(enabled, self.state, "Codex quota available", now=lambda: STAMP)
        self.assertEqual(record["diff"], [{"op": "enable-arm", "arm": "plain-codex",
                                           "previousReason": "Codex quota exhausted until reset"}])
        added = [r for r in self.registration()["schedule"] if r["window"] == 1]
        self.assertEqual({r["arm"] for r in added}, {"plain-codex"})
        self.assertEqual([r["phase"] for r in added], ["start"] * 3 + ["main"] * len(FIXTURE_TASKS) + ["end"] * 3)
        # A new arm needs only a registry entry (here a fixture copy of the registry) and an amendment.
        entry = {"label": "fixture v2 arm", "runner": "fixture-v2", "dispatch": "packages/bio-tasks/run-task.sh",
                 "family": "claude", "efforts": ["cli-default"], "parityWith": "plain-claude", "toolpack": None,
                 "unsupportedTasks": {}, "retired": None, "reserved": None}
        with patch.object(p, "REGISTRY", self.fixture_registry({"fixture-v2": entry})):
            grown = copy.deepcopy(enabled)
            grown["arms"].append({**copy.deepcopy(grown["arms"][0]), "id": "fixture-v2"})
            second = p.amend(grown, self.state, "v2 arm dispatch landed", now=lambda: "2026-11-02T10:00:00Z")
            self.assertEqual(second["diff"], [{"op": "add-arm", "arm": "fixture-v2", "settings": grown["arms"][-1]}])
            self.assertEqual(second["previous"], record["hash"])
            study = p.open_study(grown, self.state)
            self.assertEqual(study["chain"], [digest, record["hash"], second["hash"]])
            count = len(self.calls)
            self.run_plan(grown, study["head"], history=study["plans"][:-1])
            new_rows = [r["id"] for r in self.registration()["schedule"] if r["window"] >= 1]
            self.assertEqual(self.calls[count:], new_rows)
            scored = self.score(grown)
            pair = next(c for c in scored["comparisons"] if (c["b"], c["c"]) == ("plain-claude", "fixture-v2"))
            self.assertEqual((pair["status"], pair["windowConfounded"]), ("available", True))
            self.assertEqual(len(scored["amendments"]), 2)
            shrunk = copy.deepcopy(grown)
            shrunk["arms"].pop()
            with self.assertRaisesRegex(ValueError, "remove or reorder"):
                p.amend(shrunk, self.state, "drop arm", now=lambda: STAMP)
        # Editing a locked arm's registry entry stops the study.
        drift = self.fixture_registry({"fixture-v2": {**entry, "efforts": ["cli-default", "high"]}})
        with patch.object(p, "REGISTRY", drift):
            with self.assertRaisesRegex(ValueError, "arm registry changed"):
                p.open_study(grown, self.state)
        with self.assertRaisesRegex(ValueError, "unregistered arm"):
            p.open_study(grown, self.state)

    def test_registry_blocked_cell_is_explicit_and_only_amendable_after_the_registry_allows_it(self):
        plan = p.make_plan(copy.deepcopy(self.all_tasks), True)
        reason = p.arm_registry()["codex-tools"]["unsupportedTasks"]["p16-recovery"]
        self.assertEqual(plan["disabledCells"], {"codex-tools": {"p16-recovery": reason}})
        rows = p.schedule(plan)
        self.assertFalse(any((r["task"], r["arm"]) == ("p16-recovery", "codex-tools") for r in rows))
        self.assertEqual({r["arm"] for r in rows if r["task"] == "p16-recovery"}, {"plain-claude", "plain-codex"})
        for cells in ({}, {"codex-tools": {"p16-recovery": reason}, "plain-claude": {"p9-leakage": "operator choice"}}):
            bad = copy.deepcopy(plan)
            bad["disabledCells"] = cells
            with self.assertRaisesRegex(ValueError, "disabledCells"):
                p.validate(bad)
        digest = p.locked(plan, self.state, True)
        enabled = copy.deepcopy(plan)
        enabled["disabledCells"] = {}
        with self.assertRaisesRegex(ValueError, "disabledCells"):
            p.amend(enabled, self.state, "recovery adapter landed", now=lambda: STAMP)
        allowed = self.fixture_registry(edit=lambda arms: arms["codex-tools"].update(unsupportedTasks={}))
        with patch.object(p, "REGISTRY", allowed):
            with self.assertRaisesRegex(ValueError, "arm registry changed"):
                p.open_study(plan, self.state)
            record = p.amend(enabled, self.state, "recovery adapter landed", now=lambda: STAMP)
            self.assertEqual(record["diff"], [{"op": "enable-cell", "arm": "codex-tools", "task": "p16-recovery",
                                               "previousReason": reason}])
            added = [r for r in self.registration()["schedule"] if r["window"] == 1]
            self.assertEqual([(r["task"], r["arm"], r["attempt"]) for r in added], [("p16-recovery", "codex-tools", 1)])
            self.assertEqual(p.open_study(enabled, self.state)["chain"][0], digest)

    def test_unequal_attempts_mark_comparisons_incomplete(self):
        digest = p.locked(self.plan, self.state, True)
        self.run_plan(self.plan, digest)
        scored = self.score(self.plan)
        self.assertTrue(scored["complete"])
        pairs = {(c["b"], c["c"]): c for c in scored["comparisons"]}
        for pair in (("plain-claude", "plain-codex"), ("plain-claude", "codex-tools")):
            c = pairs[pair]
            self.assertEqual(c["status"], "incomplete")
            self.assertEqual(c["incompleteReasons"], [f"unequal planned attempts ({pair[0]} 3, {pair[1]} 1)"])
            self.assertIsNone(c["mcnemar"])
            self.assertIsNone(c["taskPassBootstrap95"])
            self.assertEqual(c["equivalence"]["decision"], "insufficient")
            self.assertFalse(c["evidenceComplete"])
        self.assertEqual(pairs[("plain-codex", "codex-tools")]["status"], "available")
        self.assertIsNotNone(pairs[("plain-codex", "codex-tools")]["mcnemar"])
        self.assertIn("incomplete: unequal planned attempts (plain-claude 3, plain-codex 1)", scored["markdown"])

    def test_disabling_the_comparator_makes_the_decision_unavailable(self):
        plan = copy.deepcopy(self.plan)
        plan["disabledArms"]["codex-tools"] = "fixture: comparator unavailable"
        self.assertEqual(plan["disabledCells"], {})
        digest = p.locked(plan, self.state, True)
        self.run_plan(plan, digest)
        scored = self.score(plan)
        self.assertEqual(scored["decision"], "unavailable")
        self.assertIn("comparator codex-tools disabled: fixture: comparator unavailable", scored["decisionReason"])
        self.assertNotIn("codex-tools", [a["arm"] for a in scored["arms"]])

    def test_live_cli_preflight_requires_the_pinned_builds(self):
        live = copy.deepcopy(self.plan)
        live["dryRun"] = False
        live["diskFloorBytes"] = 12 * 1024**3
        for arm in live["arms"]:
            arm["cliVersion"] = "2.1.296 (Claude Code)" if arm["identitySource"] == "claude-events" else "codex-cli 0.156.1"
        p.validate(live)
        seen = []
        def probe(version_of):
            def run(cmd, **kwargs):
                seen.append(cmd)
                return subprocess.CompletedProcess(cmd, 0, stdout=version_of(cmd[0]) + "\n", stderr="")
            return run
        pinned = lambda binary: "2.1.296 (Claude Code)" if "claude" in binary else "codex-cli 0.156.1"
        with patch.dict(os.environ, {"CLAUDE_BIN": "/pinned/claude-2.1.296", "CODEX_BIN": ""}):
            p.cli_preflight(live, run=probe(pinned), which=lambda name: f"/usr/bin/{name}")
            self.assertIn(["/pinned/claude-2.1.296", "--version"], seen)
            self.assertIn(["/usr/bin/codex", "--version"], seen)
            with self.assertRaisesRegex(ValueError, "pinned CLI version mismatch"):
                p.cli_preflight(live, run=probe(lambda b: "2.1.300 (Claude Code)" if "claude" in b else pinned(b)),
                                which=lambda name: f"/usr/bin/{name}")
            with self.assertRaisesRegex(ValueError, "not found"):
                p.cli_preflight(live, run=probe(pinned), which=lambda name: None if name == "codex" else name)
        p.cli_preflight(self.plan, run=lambda *a, **k: self.fail("dry plans never probe CLIs"))

    def test_checked_in_plan_is_the_approved_configuration(self):
        plan = p.normalize(p.read(p.HERE / "plan.json"))
        # plan.json is the record of the LOCKED study (LOCKED-STUDY.json). Main's bundled tool-pack sources may
        # move on after the lock; then pilot.py must refuse this plan here (the study runs only from its pinned worktree).
        locked = p.read(p.HERE / "LOCKED-STUDY.json")
        self.assertEqual(next(a for a in plan["arms"] if a["id"] == "codex-tools")["toolpack"], locked["toolpack"])
        current = p.read(p.REPO / "packages/bio-toolpack/toolpack.lock.json")["profiles"]["checks"]["sha256"]
        if current == locked["toolpack"]["sha256"]:
            p.validate(plan, self.all_tasks)
        else:
            with self.assertRaisesRegex(ValueError, "tool pack changed after registration"):
                p.validate(plan, self.all_tasks)
        self.assertEqual(plan, p.read(p.HERE / "plan.json"))
        self.assertFalse(plan["dryRun"])
        self.assertEqual([t["id"] for t in plan["tasks"]], [t["id"] for t in self.all_tasks])
        self.assertEqual(len(plan["tasks"]), 19)  # 16 pilot tasks + 3 PSA known-answer tasks
        self.assertEqual(plan["tasks"], self.all_tasks)
        arms = {a["id"]: a for a in plan["arms"]}
        self.assertEqual(list(arms), list(p.BASE_ARMS))
        self.assertEqual({k: a["attempts"] for k, a in arms.items() if k != "omerta-bio"},
                         {"plain-claude": 3, "plain-codex": 1, "codex-tools": 1})
        self.assertEqual(plan["disabledArms"], {"omerta-bio": "v1 retired 2026-10-10; v2 arms added by amendment"})
        self.assertEqual(arms["codex-tools"]["toolpack"], {"profile": "checks", "sha256": locked["toolpack"]["sha256"]})
        self.assertEqual(arms["plain-claude"]["cliVersion"], "2.1.296 (Claude Code)")
        self.assertRegex(arms["plain-codex"]["cliVersion"], r"^codex-cli \d+\.\d+\.\d+$")
        self.assertEqual(list(plan["disabledCells"]), ["codex-tools"])
        self.assertEqual(plan["sentinelTasks"], list(p.DEFAULT_SENTINELS))
        self.assertEqual(plan["statistics"]["comparator"], "codex-tools")
        # Locked retry rule: rateLimitRetries (default 3) re-queues provider usage-limit failures.
        self.assertEqual(plan["retryRule"], {"interruptedRetries": 1, "gradingRetries": 2, "rateLimitRetries": 3})
        # Locked before refusal support: no refusalRetries, read as 0. New studies register it (default 2).
        self.assertEqual(p.refusal_retries(plan), 0)
        self.assertEqual(p.make_plan(self.all_tasks)["retryRule"], {**plan["retryRule"], "refusalRetries": 2})
        # The run-count arithmetic does not depend on the pack bytes; evaluate it against the locked pack.
        from unittest.mock import patch as _patch
        with _patch.object(p, "toolpack_settings", lambda *_a, **_k: dict(locked["toolpack"])):
            rows = p.schedule(plan)
        self.assertEqual(sum(r["phase"] == "main" for r in rows), 19 * 3 + 19 + 18)  # B has no p16 cell
        self.assertEqual(sum(r["phase"] != "main" for r in rows), 3 * 3 * 2)
        reserved = [k for k, e in p.arm_registry().items() if e["reserved"]]
        self.assertEqual(set(reserved), {"codex-tools-gauntlet", "omerta-v2", "omerta-v2-nog7", "omerta-v2-claude-lead"})
        self.assertFalse(set(reserved) & set(arms))

    def test_cli_lock_amend_run_score(self):
        planfile = self.state / "plan.json"
        def cli(*args, plan=planfile):
            return subprocess.run([sys.executable, str(p.HERE / "pilot.py"), *args, "--plan", str(plan),
                                   "--state", str(self.state)], capture_output=True, text=True)
        for args in (["discover", "--dry-run"], ["lock"], ["run", "--dry-run", "--max-runs", "0"]):
            result = cli(*args)
            self.assertEqual(result.returncode, 0, result.stderr)
        plan = p.read(planfile)
        amended = self.with_attempts(plan, {"plain-codex": 3, "codex-tools": 3})
        amended_file = self.state / "plan-amended.json"
        p.atomic(amended_file, amended)
        self.assertEqual(cli("amend", plan=amended_file).returncode, 2)  # --reason is required
        result = cli("amend", "--reason", QUOTA, plan=amended_file)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(cli("run", "--dry-run", "--max-runs", "0").returncode, 2)  # stale plan file refused
        schedule = cli("schedule", plan=amended_file)
        self.assertEqual(schedule.returncode, 0, schedule.stderr)
        self.assertEqual(json.loads(schedule.stdout), self.registration()["schedule"])
        result = cli("score", plan=amended_file)
        self.assertEqual(result.returncode, 0, result.stderr)
        markdown = (self.state / "scoreboard.md").read_text()
        self.assertIn("- Amendment 1 (", markdown)
        self.assertIn(QUOTA, markdown)


def study_schedule(plan, study):
    return p.schedule(plan, study["plans"][:-1])


if __name__ == "__main__":
    unittest.main()
