"""Real shell dry integration smoke; fake agent, real staging and grading."""
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import sys
import subprocess
if not os.environ.get('BIO_TEST_KEY'):
    sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'test'))
    from fixture_world import fixture_world
    with fixture_world() as (repo,env):
        result=subprocess.run([sys.executable,str(repo/'packages/bio-tasks/pilot/smoke_pilot.py')],cwd=repo,env=env)
    raise SystemExit(result.returncode)
import pilot as p

class SmokeTest(unittest.TestCase):
    def setUp(self):
        self.plan = p.make_plan(p.discover(), True)
        self.plan["statistics"]["resamples"] = 32

    def test_real_harness_fake_arm(self):
        # Real task scripts and operation lock, fake arm. Scratch is outside the worktree,
        # inside the denied home root; no answer is ever copied into this package.
        parent = Path.home() / ".omerta-bio/grading"
        with tempfile.TemporaryDirectory(prefix="pilot-test.", dir=parent) as temp:
            state = Path(temp)
            env = {"BIO_GRADING_ROOT": str(state / "grading"), "ARM_TMP_ROOT": str(state / "arms"),
                   "PYTHONDONTWRITEBYTECODE": "1", "ARM_GRACE_MS": "5"}
            (state / "arms").mkdir()
            with patch.dict(os.environ, env):
                with p.lease(state) as fd:
                    arms = p.enabled_arms(self.plan) if os.environ.get("PILOT_SMOKE_ALL") else ["plain-claude"]
                    for arm in arms:
                        rows = p.run(self.plan, state, "fixture-hash", fd, max_runs=1,
                                     only="p10-pseudorep/" + arm, free=lambda _: 2**50,
                                     executor=lambda *a: p.execute(*a, free=lambda _: 2**50))
                        self.assertEqual(rows[-1]["status"], "completed", rows[-1])
                        self.assertEqual(rows[-1]["gradeExit"], 0)
                        self.assertFalse(rows[-1]["taskPassed"])
                    self.assertEqual(len(rows), len(arms))
                    self.assertEqual(list((state / "arms").iterdir()), [])
                    scored = p.score(self.plan, state, "fixture-hash")
                    self.assertTrue(scored["dryRun"])
                    self.assertEqual(scored["decision"], "unavailable")
                    self.assertFalse(any(x.name.startswith("biotasks-") for x in (state / "grading").iterdir()))


if __name__ == "__main__":
    unittest.main()
