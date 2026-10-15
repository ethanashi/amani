#!/usr/bin/env python3
"""Trusted, serial pilot controller. Never opens a sealed key or prints subprocess output."""
from __future__ import annotations

import argparse
import contextlib
import copy
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import random
import re
import shutil
import signal
import subprocess
import sys
import time

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
PKG = HERE.parent
REPO = PKG.parents[1]
BASE = REPO / "packages/bio-baseline"
sys.path.insert(0, str(PKG / "lib"))
from biotasks.card import load_card
from biotasks.calibrate import check_record
from telemetry import telemetry, model_id, rate_limit, provider_refusal

BRIDGE = REPO / "packages/bio-bench/src/pilot-cli.ts"
REGISTRY = HERE / "arms.json"
# Every new study registers these; the 9e decision rule compares codex-tools against omerta-bio.
BASE_ARMS = ("plain-claude", "plain-codex", "omerta-bio", "codex-tools")
RETIRED_C = "v1 retired 2026-10-10; v2 arms added by amendment"
DEFAULT_SENTINELS = ("p1-esr1", "p9-leakage", "w0-venet")  # v2 design section 7 drift sentinels
PHASES = ("start", "main", "end")
# Family-level (never arm-level) facts: observed identity receipt, harness env prefix, CLI binary.
FAMILIES = {"claude": {"identitySource": "claude-events", "env": "CLAUDE", "bin": "CLAUDE_BIN", "cli": "claude"},
            "codex": {"identitySource": "codex-session", "env": "CODEX", "bin": "CODEX_BIN", "cli": "codex"}}
ENTRY_KEYS = {"label", "runner", "dispatch", "family", "efforts", "parityWith", "toolpack",
              "unsupportedTasks", "retired", "reserved"}
ARM_KEYS = {"id", "modelId", "cliVersion", "effort", "networkMode", "identitySource", "attempts"}
PARITY_KEYS = ("modelId", "effort", "cliVersion", "identitySource")
PLAN_KEYS = {"schema", "studyId", "dryRun", "tasks", "arms", "disabledArms", "disabledCells", "attemptsPerArm",
             "seed", "sentinelTasks", "sentinelAttempts", "retryRule", "diskFloorBytes", "gradingCapSec", "statistics"}
STATISTICS_KEYS = {"resamples", "equivalenceMargin", "minPairedTasks", "comparator", "pilotImprovement",
                   "minConfirmationTasks", "maxDroppedBootstrapShare", "endpoint", "ratioBootstrap"}
# Pilot grading entry and the shared grader it drives. Calibration already binds most of these;
# the lock binds all of them so every amendment window is graded by identical code.
GRADER_FILES = ("packages/bio-tasks/pilot/grade-task.sh", "packages/bio-tasks/pilot/grading.py",
                "packages/bio-tasks/lib/biotasks/cli.py", "packages/bio-tasks/lib/biotasks/grading.py",
                "packages/bio-tasks/lib/biotasks/recovery_grade.py", "packages/bio-tasks/lib/biotasks/checks.py",
                "packages/bio-tasks/lib/biotasks/calibrate.py", "packages/bio-tasks/lib/biotasks/staging.py",
                "packages/bio-tasks/lib/biotasks/sealing.py", "packages/bio-tasks/lib/biotasks/card.py",
                "packages/bio-tasks/lib/biotasks/paths.py", "packages/bio-baseline/grading/grade.py")
# rateLimitRetries: re-queues of one slot after provider rate/usage-limit failures (one per limit event).
# refusalRetries: fresh-session re-queues of one slot after terminal provider safety refusals (one per refusal).
RETRY_KEYS = {"interruptedRetries", "gradingRetries", "rateLimitRetries", "refusalRetries"}
# Registrations locked before refusal support (pilot16 at fc62160) lack refusalRetries: they verify as recorded
# and keep the pinned rules (see refusal_aware); a new registration must carry the key.
LEGACY_RETRY_KEYS = RETRY_KEYS - {"refusalRetries"}
REGISTRATION_KEYS = {"settingsHash", "plan", "armRegistry", "grader", "schedule", "amendments"}
SUPPLEMENT_KEYS = {"schema", "index", "timestamp", "reason", "commit", "studyCommit", "nonce", "original",
                   "refusalRetries", "grader", "armRegistry", "rerun", "regrade", "previous", "hash"}
# Checked-in anchors, read as committed at HEAD: the study's locked commit, and the one supplement per study.
STUDY_LOCK = "packages/bio-tasks/pilot/LOCKED-STUDY.json"
SUPPLEMENT_LOCK = "packages/bio-tasks/pilot/LOCKED-SUPPLEMENT.json"
# A supplement re-runs slots with the study's arm harness: every file here must be unchanged since the study's
# locked commit, except the controller files whose new rules are the reason the supplement exists.
HARNESS = ("packages/bio-tasks", "packages/bio-baseline/arms", "packages/bio-baseline/grading")
CONTROLLER = tuple("packages/bio-tasks/pilot/" + f for f in (
    "pilot.py", "telemetry.py", "test_pilot.py", "test_amend.py", "test_ratelimit.py", "test_refusal.py",
    "smoke_pilot.py", "BUILD-NOTES.md", "LOCKED-STUDY.json", "LOCKED-SUPPLEMENT.json", ".gitignore"))
AMENDMENT_KEYS = {"index", "timestamp", "reason", "diff", "plan", "armRegistry", "settingsHash", "previous", "hash"}
ARM_ID = r"[a-z0-9][a-z0-9-]{1,62}"


def need(ok, message):
    if not ok:
        raise ValueError(message)


def parse(raw):
    def unique(pairs):
        out = {}
        for k, v in pairs:
            need(k not in out, "duplicate JSON key")
            out[k] = v
        return out
    return json.loads(raw, object_pairs_hook=unique,
                      parse_constant=lambda _: (_ for _ in ()).throw(ValueError("nonfinite JSON")))


def read(path):
    return parse(Path(path).read_text())


def atomic(path, value):
    path = Path(path)
    tmp = path.with_name(path.name + ".tmp")
    try:
        with tmp.open("w") as f:
            json.dump(value, f, sort_keys=True, indent=2, allow_nan=False)
            f.write("\n")
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
        fd = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    finally:
        tmp.unlink(missing_ok=True)


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def bridge(command, value):
    r = subprocess.run(["node", str(BRIDGE), command], input=json.dumps(value),
                       capture_output=True, text=True, check=False)
    need(r.returncode == 0, "bio-bench bridge refused input (Node 24 required)")
    return json.loads(r.stdout)


def hashes(values):
    """Canonical bio-core hashes of several values in one bridge call."""
    out = bridge("hashes", list(values))
    need(isinstance(out, list) and len(out) == len(values), "bio-bench bridge refused input (Node 24 required)")
    return out


def text(value, limit=2000):
    return isinstance(value, str) and bool(value.strip()) and len(value) <= limit


def arm_registry(path=None):
    """Load and check the arm registry. Reserved entries are placeholders that no plan may use."""
    data = read(path or REGISTRY)
    need(isinstance(data, dict) and set(data) <= {"schema", "notes", "arms"} and
         data.get("schema") == "bio-pilot/arm-registry@1" and isinstance(data.get("arms"), dict), "invalid arm registry")
    runners = set()
    for arm, e in data["arms"].items():
        need(re.fullmatch(ARM_ID, arm) and isinstance(e, dict) and set(e) == ENTRY_KEYS and text(e["label"], 200),
             "invalid arm registry entry")
        if e["reserved"] is not None:
            need(text(e["reserved"], 500), "reserved arm needs a reason")
            continue
        need(isinstance(e["runner"], str) and re.fullmatch(ARM_ID, e["runner"]) and e["runner"] not in runners,
             "invalid or duplicate arm runner")
        runners.add(e["runner"])
        dispatch = REPO / e["dispatch"] if isinstance(e["dispatch"], str) else None
        need(dispatch is not None and not Path(e["dispatch"]).is_absolute() and ".." not in Path(e["dispatch"]).parts and
             dispatch.is_file() and dispatch.resolve().is_relative_to(REPO / "packages"), "invalid arm dispatch script")
        need(e["family"] in FAMILIES, "unknown arm family")
        need(isinstance(e["efforts"], list) and e["efforts"] and all(text(x, 40) for x in e["efforts"]), "invalid arm efforts")
        need(e["parityWith"] is None or (e["parityWith"] in data["arms"] and e["parityWith"] != arm), "invalid arm parity")
        need(e["toolpack"] is None or (isinstance(e["toolpack"], str) and re.fullmatch(ARM_ID, e["toolpack"])), "invalid arm tool pack")
        need(isinstance(e["unsupportedTasks"], dict) and all(re.fullmatch(ARM_ID, t) and text(r, 500)
             for t, r in e["unsupportedTasks"].items()), "invalid unsupported tasks")
        need(e["retired"] is None or text(e["retired"], 500), "invalid retirement reason")
    return data["arms"]


def runner_of(arm, registry=None):
    return (registry or arm_registry())[arm]["runner"]


# Arm id -> harness runner name for every dispatchable registered arm (retired included).
ARMS = {arm: e["runner"] for arm, e in arm_registry().items() if e["reserved"] is None}


def discover(root=PKG / "tasks"):
    tasks = []
    for path in sorted(Path(root).glob("*/card.json")):
        card = load_card(path.parent)
        need(not check_record(path.parent, card), f"uncalibrated or stale task: {card['id']}")
        tasks.append({"id": card["id"], "card": card,
                      "calibrationSha256": sha(path.parent / "calibration.json"),
                      "capSec": card["capMinutes"] * 60})
    need(tasks, "no calibrated tasks discovered")
    return tasks


def toolpack_settings(profile="checks"):
    lock = read(REPO / "packages/bio-toolpack/toolpack.lock.json")
    digest = lock["profiles"][profile]["sha256"]
    need(re.fullmatch(r"[0-9a-f]{64}", digest), "invalid tool pack hash")
    return {"profile": profile, "sha256": digest}


def toolpack_receipt(arm, meta, registry=None):
    return (registry or arm_registry())[arm["id"]]["toolpack"] is None or (
        meta.get("toolpack_profile") == arm["toolpack"]["profile"] and
        meta.get("toolpack_sha256") == arm["toolpack"]["sha256"] and
        meta.get("toolpack_check") == "verified" and meta.get("toolpack_intact_after_run") is True)


def enabled_arms(plan):
    return [a["id"] for a in plan["arms"] if a["id"] not in plan["disabledArms"]]


def derived_cells(plan, registry):
    """Registry-declared undispatchable task cells of enabled arms. Never operator-chosen."""
    tasks = {t["id"] for t in plan["tasks"]}
    out = {}
    for arm in enabled_arms(plan):
        cells = {t: r for t, r in registry[arm]["unsupportedTasks"].items() if t in tasks}
        if cells:
            out[arm] = cells
    return out


def make_plan(tasks, dry=False, registry=None):
    """The 2026-10-10 approved baseline: A x3, A-prime x1, B x1; v1 C retired. CLI versions start UNSET."""
    ids = [t["id"] for t in tasks]
    sentinels = [t for t in DEFAULT_SENTINELS if t in ids]
    sentinels += [t for t in ids if t not in sentinels][:max(0, 3 - len(sentinels))]
    plan = {"schema": "bio-pilot/plan@1", "studyId": "pilot16", "dryRun": dry,
            "tasks": tasks, "arms": [
                {"id": "plain-claude", "modelId": "claude-opus-5-5", "cliVersion": "UNSET", "attempts": 3,
                 "effort": "cli-default", "networkMode": "confirm", "identitySource": "claude-events"},
                {"id": "plain-codex", "modelId": "gpt-6-astra", "cliVersion": "UNSET", "attempts": 1,
                 "effort": "high", "networkMode": "confirm", "identitySource": "codex-session"},
                {"id": "omerta-bio", "modelId": "claude-opus-5-5", "cliVersion": "UNSET", "attempts": 3,
                 "effort": "cli-default", "networkMode": "confirm", "identitySource": "claude-events"},
                {"id": "codex-tools", "modelId": "gpt-6-astra", "cliVersion": "UNSET", "attempts": 1,
                 "effort": "high", "networkMode": "confirm", "identitySource": "codex-session",
                 "toolpack": toolpack_settings("checks")}],
            "disabledArms": {"omerta-bio": RETIRED_C}, "disabledCells": {},
            "attemptsPerArm": 3, "seed": 20261010,
            "sentinelTasks": sentinels, "sentinelAttempts": 1,
            "retryRule": {"interruptedRetries": 1, "gradingRetries": 2, "rateLimitRetries": 3, "refusalRetries": 2},
            "diskFloorBytes": 12 * 1024**3,
            "gradingCapSec": 900,
            "statistics": {"resamples": 10000, "equivalenceMargin": 0.15, "minPairedTasks": 16,
                           "comparator": "codex-tools", "pilotImprovement": 0.10,
                           "minConfirmationTasks": 8, "maxDroppedBootstrapShare": 0.01,
                           "endpoint": "all-attempts-task-passed", "ratioBootstrap": "conditional-defined"}}
    plan["disabledCells"] = derived_cells(plan, registry or arm_registry())
    return plan


def normalize(plan):
    """Resolve each arm's attempts (default attemptsPerArm) so the lock records them explicitly."""
    if not (isinstance(plan, dict) and isinstance(plan.get("arms"), list)):
        return plan
    out = copy.deepcopy(plan)
    for arm in out["arms"]:
        if isinstance(arm, dict) and "attempts" not in arm:
            arm["attempts"] = out.get("attemptsPerArm")
    return out


def cli_version(family, *, run=subprocess.run, which=shutil.which):
    """First line of `<cli> --version`, resolved exactly as the arm runners resolve their binary."""
    spec = FAMILIES[family]
    binary = os.environ.get(spec["bin"]) or which(spec["cli"])
    need(bool(binary), "agent CLI not found")
    try:
        result = run([binary, "--version"], capture_output=True, text=True, timeout=60, check=False)
    except (OSError, subprocess.SubprocessError):
        raise ValueError("agent CLI version unavailable") from None
    line = (result.stdout.splitlines() or [""])[0]
    need(result.returncode == 0 and line.strip() and line not in ("UNSET", "unavailable"), "agent CLI version unavailable")
    return line


def cli_preflight(plan, arms=None, **probe):
    """Live runs refuse before the first record unless each enabled arm's CLI (or each of `arms`) is the pinned build."""
    if plan["dryRun"]:
        return
    registry = arm_registry()
    for arm in plan["arms"]:
        if arm["id"] in plan["disabledArms"] or (arms is not None and arm["id"] not in arms):
            continue
        need(cli_version(registry[arm["id"]]["family"], **probe) == arm["cliVersion"],
             "pinned CLI version mismatch; point CLAUDE_BIN/CODEX_BIN at the pinned binaries")


def integer(value, low, high):
    return type(value) is int and low <= value <= high


def refusal_retries(plan):
    """Registrations without the key (locked before refusal support) read as 0: nothing is re-queued, as before."""
    return plan["retryRule"].get("refusalRetries", 0)


def refusal_aware(plan):
    """A registration with refusalRetries gets the refusal rules (provider-refused rows, refusal/limit "<synthetic>"
    is no identity). One locked before refusal support keeps the pinned fc62160 rules exactly, so resuming it from
    this code never scores one study under two rule sets; the supplement applies the new rules afterwards."""
    return "refusalRetries" in plan["retryRule"]


def validate(plan, current=None, registry=None, frozen=False):
    """`frozen` checks a registration as recorded: the hash binds its tool pack, so the current
    bundle is not compared (a finished study read from a later commit; see `supplement`)."""
    registry = arm_registry() if registry is None else registry
    need(isinstance(plan, dict) and plan.get("schema") == "bio-pilot/plan@1", "invalid plan")
    need(set(plan) == PLAN_KEYS, "unknown or missing plan setting")
    need(isinstance(plan["studyId"], str) and re.fullmatch(r"[a-zA-Z0-9-]{1,64}", plan["studyId"]), "invalid study ID")
    need(type(plan["dryRun"]) is bool, "dryRun must be boolean")
    need(integer(plan["attemptsPerArm"], 1, 100), "invalid attempts")
    need(integer(plan["seed"], 0, 2**32-1), "invalid seed")
    need(integer(plan["sentinelAttempts"], 1, 100), "invalid sentinel attempts")
    need(integer(plan["diskFloorBytes"], 0, 2**53-1), "invalid disk floor")
    need(plan["dryRun"] or plan["diskFloorBytes"] >= 12 * 1024**3, "live disk floor must be at least 12 GiB")
    need(integer(plan["gradingCapSec"], 1, 36000), "invalid grading cap")
    rule = plan["retryRule"]
    need(isinstance(rule, dict) and set(rule) in (RETRY_KEYS, LEGACY_RETRY_KEYS) and integer(rule["gradingRetries"], 0, 5) and
         integer(rule["interruptedRetries"], 0, 5) and integer(rule["rateLimitRetries"], 0, 10) and
         integer(rule.get("refusalRetries", 0), 0, 10), "invalid retry rule")
    tasks = plan["tasks"]
    need(isinstance(tasks, list) and tasks, "empty task inventory")
    ids = [t["id"] for t in tasks]
    need(len(ids) == len(set(ids)), "duplicate task")
    for t in tasks:
        need(set(t) == {"id", "card", "calibrationSha256", "capSec"}, "invalid task setting")
        need(t["id"] == t["card"]["id"] and re.fullmatch(r"[a-z0-9][a-z0-9-]{1,62}", t["id"]), "invalid task ID")
        need(integer(t["capSec"], 1, t["card"]["capMinutes"] * 60), "cap exceeds card")
        if current is not None:
            match = next((c for c in current if c["id"] == t["id"]), None)
            need(match is not None and match["card"] == t["card"] and
                 match["calibrationSha256"] == t["calibrationSha256"], "task/calibration changed; create a new study")
    arms = plan["arms"]
    need(isinstance(arms, list) and arms and all(isinstance(a, dict) and isinstance(a.get("id"), str) for a in arms),
         "invalid arm settings")
    arm_ids = [a["id"] for a in arms]
    need(len(arm_ids) == len(set(arm_ids)) and set(BASE_ARMS) <= set(arm_ids),
         "the registered pilot arms are required (each at most once)")
    for a in arms:
        entry = registry.get(a["id"])
        need(entry is not None, "unregistered arm; add an arm registry entry first")
        need(entry["reserved"] is None, "reserved arm; complete its registry entry before adding it")
        need(set(a) == ARM_KEYS | ({"toolpack"} if entry["toolpack"] else set()), "invalid arm settings")
        need(integer(a["attempts"], 1, 100), "invalid attempts")
    need({a["networkMode"] for a in arms} == {"confirm"}, "unequal or unsupported network modes; all arms must be confirm")
    by_id = {a["id"]: a for a in arms}
    for a in arms:
        entry = registry[a["id"]]
        if entry["toolpack"] and not frozen:
            need(a["toolpack"] == toolpack_settings(entry["toolpack"]), "tool pack changed after registration; create a new study")
        need(all(isinstance(a[k], str) and a[k] for k in ("modelId", "cliVersion", "effort")), "missing provenance declaration")
        if not plan["dryRun"]:
            need(a["identitySource"] == FAMILIES[entry["family"]]["identitySource"], "live arm has no model identity source")
            need(a["cliVersion"] not in ("UNSET", "unavailable"), "pin exact CLI versions before locking a live plan")
    for a in arms:
        partner = registry[a["id"]]["parityWith"]
        if partner is not None:
            need(partner in by_id and all(a[k] == by_id[partner][k] for k in PARITY_KEYS),
                 f"{a['id']} must match {partner} model, effort, CLI version and identity source (parity required)")
    for a in arms:
        need(a["effort"] in registry[a["id"]]["efforts"], "unsupported effort for this arm")
    disabled = plan["disabledArms"]
    need(isinstance(disabled, dict) and set(disabled) <= set(arm_ids) and all(text(r, 500) for r in disabled.values()),
         "invalid disabled arms: map a registered arm to a non-empty reason")
    need(len(disabled) < len(arm_ids), "at least one arm must be enabled")
    for a in arms:
        need(not registry[a["id"]]["retired"] or a["id"] in disabled, "retired arm cannot be enabled")
    need(isinstance(plan["disabledCells"], dict) and plan["disabledCells"] == derived_cells(plan, registry),
         "disabledCells must list exactly the registry's undispatchable tasks of enabled arms")
    need(isinstance(plan["sentinelTasks"], list) and plan["sentinelTasks"] and
         len(set(plan["sentinelTasks"])) == len(plan["sentinelTasks"]) and set(plan["sentinelTasks"]) <= set(ids), "invalid sentinels")
    s = plan["statistics"]
    need(set(s) == STATISTICS_KEYS, "unknown statistics setting")
    need(integer(s["resamples"], 2, 1000000) and integer(s["minPairedTasks"], 2, 10000), "invalid statistics")
    need(integer(s["minConfirmationTasks"], math.ceil(s["minPairedTasks"] / 2), 10000), "invalid confirmation sparsity limit")
    need(type(s["maxDroppedBootstrapShare"]) in (int, float) and 0 <= s["maxDroppedBootstrapShare"] <= 0.01, "invalid bootstrap sparsity limit")
    need(type(s["equivalenceMargin"]) in (int, float) and 0 < s["equivalenceMargin"] <= 0.15, "invalid margin")
    need(s["comparator"] == "codex-tools" and s["pilotImprovement"] == 0.1 and
         s["endpoint"] == "all-attempts-task-passed" and s["ratioBootstrap"] == "conditional-defined", "decision rule changed")
    return plan


def slots(plan):
    """Every (phase, task, arm, attempt) the plan requires. Disabled arms and cells have none."""
    attempts = {a["id"]: a["attempts"] for a in plan["arms"]}
    out = set()
    for phase in PHASES:
        tasks = [t["id"] for t in plan["tasks"]] if phase == "main" else plan["sentinelTasks"]
        for arm in enabled_arms(plan):
            n = attempts[arm] if phase == "main" else plan["sentinelAttempts"]
            for task in tasks:
                if task not in plan["disabledCells"].get(arm, {}):
                    out.update((phase, task, arm, k) for k in range(1, n + 1))
    return out


def interleave(plan, wanted, rng, window):
    """Seeded rule: shuffle tasks per phase, then arms within each (task, attempt) block."""
    rows = []
    for phase in PHASES:
        ids = [t["id"] for t in plan["tasks"]] if phase == "main" else list(plan["sentinelTasks"])
        rng.shuffle(ids)
        for task in ids:
            for attempt in sorted({k for ph, t, _, k in wanted if (ph, t) == (phase, task)}):
                arms = sorted(a for ph, t, a, k in wanted if (ph, t, k) == (phase, task, attempt))
                rng.shuffle(arms)
                rows += [{"id": f"{phase}-{task}-{arm}-{attempt}", "task": task, "arm": arm,
                          "attempt": attempt, "phase": phase, "window": window} for arm in arms]
    return rows


def schedule(plan, history=(), registry=None, frozen=False):
    """Window 0 is the locked plan; amendment k appends only its new slots, after every earlier row."""
    validate(plan, registry=registry, frozen=frozen)
    plans = [*history, plan]
    rows, done = [], set()
    for window, current in enumerate(plans):
        required = slots(current)
        need(done <= required, "amendment removed scheduled rows; create a new study")
        wanted = required - done
        rng = random.Random(current["seed"] if window == 0 else f"{current['seed']}:amendment:{window}")
        rows += interleave(current, wanted, rng, window)
        done |= wanted
    return rows


def grader_sha256():
    h = hashlib.sha256()
    for rel in GRADER_FILES:
        h.update(rel.encode() + b"\0" + sha(REPO / rel).encode() + b"\n")
    return h.hexdigest()


def fingerprint(plan, registry=None):
    """Study-defining settings outside plan.json: the arms' registry entries and the grader code."""
    registry = arm_registry() if registry is None else registry
    need(all(a["id"] in registry for a in plan["arms"]), "unregistered arm; add an arm registry entry first")
    return {"armRegistry": {a["id"]: registry[a["id"]] for a in plan["arms"]}, "grader": grader_sha256()}


def settings_object(plan, snapshot, grader):
    return {"plan": plan, "armRegistry": snapshot, "grader": grader}


def amendment_diff(old, old_registry, new, new_registry):
    """The only permitted amendments: raise attempts, enable a disabled arm or registry-blocked cell,
    add a registered arm. Same tasks, caps, grader, statistics and schedule rules; else a new study."""
    for key in sorted(set(old) - {"arms", "disabledArms", "disabledCells"}):
        need(new.get(key) == old[key], f"amendment cannot change {key}; create a new study")
    before = old["arms"]
    need([a["id"] for a in new["arms"][:len(before)]] == [a["id"] for a in before],
         "amendment cannot remove or reorder arms; create a new study")
    diff = []
    for old_arm, new_arm in zip(before, new["arms"]):
        arm = old_arm["id"]
        fixed = lambda a: {k: v for k, v in a.items() if k != "attempts"}
        need(fixed(old_arm) == fixed(new_arm), f"amendment cannot change {arm} settings; create a new study")
        need(new_arm["attempts"] >= old_arm["attempts"], "amendment cannot lower attempts; create a new study")
        if new_arm["attempts"] > old_arm["attempts"]:
            diff.append({"op": "raise-attempts", "arm": arm, "from": old_arm["attempts"], "to": new_arm["attempts"]})
        was, now = old_registry[arm], new_registry[arm]
        kept = {k: v for k, v in was.items() if k != "unsupportedTasks"} == {k: v for k, v in now.items() if k != "unsupportedTasks"}
        shrunk = all(was["unsupportedTasks"].get(t) == r for t, r in now["unsupportedTasks"].items())
        need(kept and shrunk, f"arm registry entry for {arm} changed; create a new study")
    for added in new["arms"][len(before):]:
        need(added["id"] not in new["disabledArms"], "an added arm must be enabled")
        diff.append({"op": "add-arm", "arm": added["id"], "settings": added})
    for arm in sorted(new["disabledArms"]):
        need(old["disabledArms"].get(arm) == new["disabledArms"][arm], "amendment cannot disable an arm; create a new study")
    for arm in sorted(old["disabledArms"]):
        if arm not in new["disabledArms"]:
            diff.append({"op": "enable-arm", "arm": arm, "previousReason": old["disabledArms"][arm]})
    was_enabled = set(enabled_arms(old))
    for arm in sorted(new["disabledCells"]):
        for task in sorted(new["disabledCells"][arm]):
            need(arm not in was_enabled or task in old["disabledCells"].get(arm, {}),
                 "amendment cannot disable a task for an arm; create a new study")
    for arm in sorted(old["disabledCells"]):
        for task in sorted(old["disabledCells"][arm]):
            if task not in new["disabledCells"].get(arm, {}):
                diff.append({"op": "enable-cell", "arm": arm, "task": task,
                             "previousReason": old["disabledCells"][arm][task]})
    need(diff, "amendment changes nothing")
    return diff


def public_amendment(record):
    return {k: record[k] for k in ("index", "timestamp", "reason", "diff", "settingsHash", "previous", "hash")}


def verify_registration(reg, frozen=False):
    """Recompute every settings hash, amendment hash link, diff and the appended schedule."""
    need(isinstance(reg, dict) and set(reg) == REGISTRATION_KEYS and isinstance(reg["amendments"], list),
         "registration predates amendment support or is malformed; create a new study")
    records = reg["amendments"]
    for k, a in enumerate(records, 1):
        need(isinstance(a, dict) and set(a) == AMENDMENT_KEYS and a["index"] == k and text(a["reason"]) and
             isinstance(a["timestamp"], str) and re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ", a["timestamp"]),
             "amendment chain broken")
    plans = [reg["plan"], *(a["plan"] for a in records)]
    snapshots = [reg["armRegistry"], *(a["armRegistry"] for a in records)]
    for plan, snapshot in zip(plans, snapshots):
        need(isinstance(snapshot, dict) and isinstance(plan, dict) and isinstance(plan.get("arms"), list) and
             set(snapshot) == {a.get("id") for a in plan["arms"] if isinstance(a, dict)}, "registration is malformed")
        validate(plan, registry=snapshot, frozen=frozen)
    digests = hashes([settings_object(p, s, reg["grader"]) for p, s in zip(plans, snapshots)] +
                     [{k: v for k, v in a.items() if k != "hash"} for a in records])
    need(reg["settingsHash"] == digests[0], "pre-registered settings are locked; registration hash mismatch")
    chain = [reg["settingsHash"]]
    for k, a in enumerate(records):
        need(a["settingsHash"] == digests[k + 1] and a["previous"] == chain[-1] and a["hash"] == digests[len(plans) + k],
             "amendment chain broken")
        need(a["diff"] == amendment_diff(plans[k], snapshots[k], plans[k + 1], snapshots[k + 1]), "amendment chain broken")
        chain.append(a["hash"])
    need(reg["schedule"] == schedule(plans[-1], plans[:-1], registry=snapshots[-1], frozen=frozen), "locked schedule changed")
    return {"plans": plans, "plan": plans[-1], "armRegistry": snapshots[-1], "grader": reg["grader"],
            "chain": chain, "head": chain[-1], "amendments": [public_amendment(a) for a in records]}


def utc_now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def amend(plan, state, reason, *, now=utc_now):
    """Append one hash-chained amendment. New rows run after all existing rows; none is reordered."""
    need(text(reason), "amendment needs a non-empty reason (at most 2000 characters)")
    path = state / "registration.json"
    need(path.exists(), "no locked study to amend")
    registration = read(path)
    study = verify_registration(registration)
    validate(plan)
    fp = fingerprint(plan)
    need(fp["grader"] == study["grader"], "grader changed after registration; create a new study")
    diff = amendment_diff(study["plan"], study["armRegistry"], plan, fp["armRegistry"])
    record = {"index": len(registration["amendments"]) + 1, "timestamp": now(), "reason": reason, "diff": diff,
              "plan": plan, "armRegistry": fp["armRegistry"], "previous": study["head"],
              "settingsHash": hashes([settings_object(plan, fp["armRegistry"], study["grader"])])[0]}
    record["hash"] = hashes([record])[0]
    rows = schedule(plan, study["plans"])
    need(rows[:len(registration["schedule"])] == registration["schedule"], "amendment would reorder locked rows")
    atomic(path, {**registration, "amendments": [*registration["amendments"], record], "schedule": rows})
    return record


@contextlib.contextmanager
def lease(state):
    state.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (state / "controller.lock").open("a+") as f:
        try:
            fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ValueError("pilot still active (including a surviving child); retry after it exits") from None
        yield f.fileno()


def open_study(plan, state, create=False):
    """Lock on first use; afterwards `plan` must be the latest (amended) registered plan."""
    path = state / "registration.json"
    if not path.exists():
        need(create and not (state / "runs.json").exists(), "plan must be locked before any run")
        validate(plan)
        need(isinstance(plan["retryRule"], dict) and set(plan["retryRule"]) == RETRY_KEYS,
             "a new study must register retryRule.refusalRetries (legacy rules are only for studies already locked)")
        fp = fingerprint(plan)
        digest = hashes([settings_object(plan, fp["armRegistry"], fp["grader"])])[0]
        atomic(path, {"settingsHash": digest, "plan": plan, **fp, "schedule": schedule(plan), "amendments": []})
    study = verify_registration(read(path))
    need(study["plan"] == plan, "pre-registered settings are locked (pass the latest amended plan)")
    current = fingerprint(plan)
    need(current["grader"] == study["grader"], "grader changed after registration; create a new study")
    need(current["armRegistry"] == study["armRegistry"], "arm registry changed after registration; amend or create a new study")
    return study


def locked(plan, state, create=False):
    """Hash chain head: the base settings hash, or the latest amendment hash."""
    return open_study(plan, state, create)["head"]


def read_optional(path):
    try:
        value = read(path)
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


def execution_env(plan, arm):
    # Environment overrides must not bypass the existing operation lease or alter the registered controls.
    blocked = ("BIO_OPERATION", "BIO_LEASE_FD", "ARM_PROMPT_TEXT", "ARM_DATA_DIR", "ARM_WALL_CAP_SEC",
               "ARM_PREPARE_PAUSE_MS", "ARM_FAULT_AT", "BIO_LIVE_ARMC", "CLAUDE_PROXY_ALLOW", "CODEX_PROXY_ALLOW")
    need(not any(os.environ.get(k) for k in blocked), "unsafe harness override in environment")
    fake_keys = ("ARM_DRY_AGENT", "ARM_FAKE_HOST", "ARM_FAKE_NOW", "ARM_SKIP_ENV", "ECHO_AGENT_MODE", "BIO_GRADING_ROOT")
    need(plan["dryRun"] or not any(os.environ.get(k) for k in fake_keys), "fake arms require a locked dry-run plan")
    env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1", BIO_TASKS_PYTHON=sys.executable, ARM_PYTHON=sys.executable)
    entry = arm_registry()[arm["id"]]
    prefix = FAMILIES[entry["family"]]["env"]
    env[prefix + "_ARM_MODEL"] = arm["modelId"]
    env[prefix + "_ARM_EFFORT"] = "" if arm["effort"] == "cli-default" else arm["effort"]
    if entry["toolpack"]:
        profile = entry["toolpack"]
        need(arm["toolpack"] == toolpack_settings(profile), "tool pack changed before launch")
        need(os.environ.get("TOOLPACK_PROFILE", profile) == profile, "pilot requires the registered tool pack profile")
        env["TOOLPACK_PROFILE"] = profile
    if plan["dryRun"]:
        env.update(ARM_DRY_AGENT=str(HERE / "fake-agent.sh"), ARM_FAKE_HOST=str(HERE / "fake-host.mjs"),
                   CLAUDE_BIN=str(HERE / "fake-cli.sh"), ARM_SKIP_ENV="1", ECHO_AGENT_MODE="fast")
    return env


def execution_status(rc, meta, run_status):
    if meta.get("status") == "timed-out" or run_status.get("timed_out") is True:
        return "timeout"
    agent_exit = meta.get("agent_exit")
    crashed = (rc < 0 or rc >= 128 or run_status.get("signal") is not None or
               (type(agent_exit) is int and (agent_exit < 0 or agent_exit >= 128)))
    if crashed:
        return "crashed"
    return "completed" if rc == 0 and meta.get("status") == "finished" else "failed"


def check_tasks(plan, frozen=False):
    current = []
    for task in plan["tasks"]:
        task_dir = PKG / "tasks" / task["id"]
        card = load_card(task_dir)
        need(not check_record(task_dir, card), "task changed after registration")
        current.append({"id": task["id"], "card": card, "calibrationSha256": sha(task_dir / "calibration.json")})
    validate(plan, current, frozen=frozen)


def disk_floor(plan, state, free=lambda p: shutil.disk_usage(p).free):
    for path in (state, state / "results", Path(os.environ.get("ARM_TMP_ROOT", "/private/var/tmp/bb")),
                 Path(os.environ.get("BIO_GRADING_ROOT", str(Path.home() / ".omerta-bio/grading")))):
        while not path.exists():
            path = path.parent
        need(free(path) >= plan["diskFloorBytes"], "disk floor reached; no operation dispatched")


def checkpoint(state, row):
    path = state / "runs.json"
    if path.exists():
        rows = read(path)
        for i, old in enumerate(rows):
            if old["id"] == row["id"] and old["retry"] == row["retry"]:
                rows[i] = row
        atomic(path, rows)


def attempt_path(state, row, registry=None):
    return state / "results" / row["task"] / f"{runner_of(row['arm'], registry)}-{row['id']}-r{row['retry']}"


def determinate_summary(summary, task, attempt):
    rr, check = summary.get("rerun"), summary.get("check")
    return (summary.get("task") == task and summary.get("attempt") == attempt
            and type(summary.get("credited")) is bool and type(summary.get("task_passed")) is bool
            and type(summary.get("reproduced")) is bool
            and summary.get("contamination") in ("none-found", "CONTAMINATED", "unknown")
            and isinstance(rr, dict) and type(rr.get("ran")) is bool
            and isinstance(check, dict)
            and (check.get("error") is not True or summary.get("agent_output_failure") is True))


def rate_limited(row, path, family, legacy=False):
    """`infrastructure: rate-limited` when the provider CLI's own terminal outcome is a rate/usage-limit
    failure (CLI event fields only, see telemetry.rate_limit) and the CLI exited by itself. Timeouts and
    signals stay arm outcomes: an agent controls when a run hangs or dies. A completed CLI turn with a
    transient limit message is never terminal, so it stays an ordinary completed run."""
    limit = rate_limit(path, family)
    return infrastructure(row, path, family, limit["terminal"], legacy, status="rate-limited", infrastructure="rate-limited",
                          failure=None, rateLimit={k: limit[k] for k in ("family", "signals", "resetsAt", "resetsAtUtc", "resetHint")})


def contamination(meta):
    """The arm runner's transcript audit verdict, without its hit list: CONTAMINATED, clean or unknown."""
    flag = str(meta.get("contaminated") or "")
    return "CONTAMINATED" if flag.startswith("CONTAMINATED") else "clean" if flag == "clean" else "unknown"


def foreign_models(path, family, declared):
    """Reported models (refusal rules) other than the arm's declared model; none when `declared` is None (dry)."""
    if declared is None:
        return []
    return [m for m in telemetry(path, read_optional(path / "meta.json"), family)["reportedModels"]
            if model_id(m) != model_id(declared)]


def provider_refused(row, path, family, declared=None):
    """`status: provider-refused` when the provider CLI's own terminal outcome is a safety-classifier refusal
    (CLI event fields only, see telemetry.provider_refusal) under the same exit rules as rate limits. Not
    credited, never graded: infrastructure. A refused turn the CLI moved past (transient) is graded normally.
    Called after rate_limited: a terminal rate limit takes precedence (it pauses the provider; its refusals are
    still counted). A terminal refusal is NOT reclassified, so the row is graded and assess() rules, when the
    CLI fell back to another model after a refusal, when any reported model is not `declared` (the arm's
    modelId; None for dry plans), or when the transcript audit found contamination: a model switch or a
    contaminated session is the arm's outcome, never a fresh draw. The row records what the session did
    before the refusal (agent messages, deliverables, audit verdict) so the scoreboard can show it."""
    refusal = provider_refusal(path, family)
    if not refusal["terminal"]:
        return None
    meta = read_optional(path / "meta.json")
    if refusal["fallback"] or foreign_models(path, family, declared) or contamination(meta) == "CONTAMINATED":
        return None
    return infrastructure(row, path, family, True, status="provider-refused", infrastructure="provider-refused",
                          failure="provider-refused", deliverables=(path / "workdir/results.json").is_file(),
                          contamination=contamination(meta), providerRefusal={k: refusal[k] for k in (
                              "family", "signals", "categories", "refusals", "transient", "fallback", "agentMessages")})


def infrastructure(row, path, family, terminal, legacy=False, **fields):
    """The never-graded infrastructure row, only when the CLI exited by itself after the agent started. A row
    without an exit code (a transport that raised after the agent started: adapter-error) is never one."""
    meta = read_optional(path / "meta.json")
    run_status = read_optional(path / "run_status.json")
    if not terminal or type(row.get("exit")) is not int:
        return None
    status = execution_status(row["exit"], meta, run_status)
    if not (status in ("failed", "completed") and meta.get("start")):
        return None
    return {"executionStatus": status, "dispatched": True, "graded": None, "credited": None, "gradeExit": None,
            "gradingMs": None, "dispatchMs": row.get("dispatchMs"), "wallClockMs": row.get("dispatchMs"),
            "infrastructureWarnings": [], **telemetry(path, meta, family, legacy), "exit": row["exit"], "timedOut": False,
            "crashed": False, "agentExit": meta.get("agent_exit"), "signal": run_status.get("signal"), "provenance": None,
            "provenanceOk": False, "taskPassed": False, "gradeOutcome": "unavailable", "claims": [],
            "claimsAvailable": False, "resultSha256": None, "summarySha256": None, **fields}


def execute(plan, row, state, lock_fd, *, transport=subprocess.run, now=time.monotonic,
            free=lambda p: shutil.disk_usage(p).free):
    arm = next(a for a in plan["arms"] if a["id"] == row["arm"])
    task = next(t for t in plan["tasks"] if t["id"] == row["task"])
    task_dir = PKG / "tasks" / task["id"]
    card = load_card(task_dir)
    need(card == task["card"] and not check_record(task_dir, card) and
         sha(task_dir / "calibration.json") == task["calibrationSha256"], "task changed after registration")
    env = execution_env(plan, arm)
    entry = arm_registry()[row["arm"]]
    need(row["arm"] not in plan["disabledArms"] and row["task"] not in plan["disabledCells"].get(row["arm"], {}),
         "disabled arm or task cell is never dispatched")
    root = state / "results"
    attempt = f"{row['id']}-r{row['retry']}"
    path = root / row["task"] / f"{entry['runner']}-{attempt}"
    pending = row.get("dispatched") is True and row.get("graded") is False
    need(pending or not path.exists(), "attempt directory already exists; refusing overwrite")
    cmd = ["bash", str(REPO / entry["dispatch"]), row["task"], entry["runner"], attempt,
           "--results-root", str(root), "--cap-sec", str(task["capSec"])]
    if plan["dryRun"]:
        cmd += ["--dry-run"]
    # Child inherits the controller lease: a killed controller cannot race a still-running arm.
    # Output is deliberately discarded: sealed checker evidence must never reach pilot logs.
    if not pending:
        dispatch_start = now()
        disk_floor(plan, state, free)
        try:
            rc = transport(cmd, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                           pass_fds=(lock_fd,), start_new_session=True).returncode
        except Exception:
            row["dispatchMs"] = round((now() - dispatch_start) * 1000, 3)
            row["wallClockMs"] = row["dispatchMs"]
            meta = read_optional(path / "meta.json")
            if meta.get("start") and meta.get("cancelled_before_agent") is not True:
                row.update(dispatched=True, graded=True, status="crashed", crashed=True, failure="adapter-error")
            raise
        row["dispatchMs"] = round((now() - dispatch_start) * 1000, 3)
        row["wallClockMs"] = row["dispatchMs"]
        meta = read_optional(path / "meta.json")
        need(path.is_dir() and bool(meta.get("start")) and meta.get("cancelled_before_agent") is not True,
             "infrastructure refusal before agent start")
        row.update(dispatched=True, graded=False, exit=rc,
                   status=execution_status(rc, meta, read_optional(path / "run_status.json")))
        checkpoint(state, row)  # Resume grading without launching the agent again.
    rc = row["exit"]
    legacy = not refusal_aware(plan)
    limited = rate_limited(row, path, entry["family"], legacy)
    if limited:
        return limited  # Infrastructure: never graded, never charged to the arm.
    if not legacy:  # a study locked before refusal support keeps the pinned rules (graded as it always was)
        refused = provider_refused(row, path, entry["family"], None if plan["dryRun"] else arm["modelId"])
        if refused:
            return refused  # Infrastructure too; run() re-queues a fresh session (refusalRetries).
    disk_floor(plan, state, free)
    exhausted = row.get("gradingAttempts", 0) > plan["retryRule"]["gradingRetries"]
    if exhausted:
        # A controller may die after a complete summary but before its final checkpoint.
        need(determinate_summary(read_optional(path / "grade/task-summary.json"), row["task"], path.name),
             "grading retry limit exhausted; operator intervention required")
        grc, grading_ms = 3, None
    else:
        # Clear stale evidence BEFORE checkpointing a grading invocation.
        (path / "grade/task-summary.json").unlink(missing_ok=True)
        row["gradingAttempts"] = row.get("gradingAttempts", 0) + 1
        checkpoint(state, row)
        grading_start = now()
        grc = transport(["bash", str(HERE / "grade-task.sh"), row["task"], str(path),
                         "--rerun-cap-sec", str(plan["gradingCapSec"])], env=env,
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                        pass_fds=(lock_fd,), start_new_session=True).returncode
        grading_ms = round((now() - grading_start) * 1000, 3)
    return assess(plan, row, path, grc, grading_ms, exhausted)


def assess(plan, row, path, grc, grading_ms, exhausted=False):
    """Outcome of a dispatched, graded attempt from its evidence. Reads only, so a supplement can re-assess
    a finished study's immutable attempt under the current provenance rules without grading it again."""
    arm = next(a for a in plan["arms"] if a["id"] == row["arm"])
    task = next(t for t in plan["tasks"] if t["id"] == row["task"])
    card = task["card"]
    entry = arm_registry()[row["arm"]]
    rc = row["exit"]
    meta = read_optional(path / "meta.json")
    summary = read_optional(path / "grade/task-summary.json")
    result = read_optional(path / "workdir/results.json")
    claims = result.get("claims")
    normalized = []
    claims_ok = isinstance(claims, list)
    if claims_ok:
        for c in claims:
            if not isinstance(c, dict) or not isinstance(c.get("id"), str) or c.get("status") not in (
                    "confirmed", "tentative", "refuted", "insufficient-evidence"):
                claims_ok = False
                break
            # Claim text, estimates and identities never enter the scoreboard.
            normalized.append({"id": c["id"], "label": "insufficient" if c["status"] == "insufficient-evidence" else c["status"]})
        claims_ok = claims_ok and len({c["id"] for c in normalized}) == len(normalized)
    run_status = read_optional(path / "run_status.json")
    status = execution_status(rc, meta, run_status)
    timed = status == "timeout"
    observed = telemetry(path, meta, entry["family"], not refusal_aware(plan))
    models = observed["reportedModels"]
    declared_effort = "cli-default" if meta.get("effort") == "host-default" else meta.get("effort")
    provenance = {"modelId": models[0] if models else None, "declaredModel": meta.get("model"), "reportedModels": models,
                  "cliVersion": meta.get("cli_version"), "effort": observed.get("reportedEffort") or declared_effort, "networkMode": "confirm"}
    provenance_ok = (meta.get("task_id") == task["id"] and meta.get("task_manifest_sha256") == card["datasetManifestHash"]
                     and meta.get("dry_run") is plan["dryRun"] and
                     (plan["dryRun"] or (bool(models) and all(model_id(m) == model_id(arm["modelId"]) for m in models)
                      and all(provenance[k] == arm[k] for k in ("cliVersion", "effort"))
                      and all(e == arm["effort"] for e in observed["reportedEfforts"]))))
    rr = summary.get("rerun", {})
    graded = determinate_summary(summary, row["task"], path.name)
    grade_ok = (graded and grc == 0 and summary.get("credited") is True and summary.get("reproduced") is True
                and summary.get("contamination") == "none-found" and rr.get("ran") is True
                and rr.get("exit_code") == 0 and rr.get("timed_out") is False and rr.get("tmp_deleted") is True)
    # A launched failure needs no identity receipt unless one contradicts the plan.
    if status in ("timeout", "failed", "crashed", "blocked") and not models:
        provenance_ok = True
    provenance_ok = provenance_ok and toolpack_receipt(arm, meta)
    passed = claims_ok and status == "completed" and provenance_ok and grade_ok and summary.get("task_passed") is True
    return {"status": status if graded else "grading-failed" if row.get("gradingAttempts", 0) > plan["retryRule"]["gradingRetries"] else status,
            "executionStatus": status, "dispatchMs": row.get("dispatchMs"), "wallClockMs": row.get("dispatchMs"),
            "gradingMs": grading_ms if graded else None,
            "infrastructureWarnings": ["grader-retries-exhausted"] if exhausted else ["grader-cleanup"] if graded and grc == 3 else [],
            "failure": "provenance-unverified" if not provenance_ok else None,
            # The CLI switched models after a refusal: the wrong model did (part of) the work.
            "provenanceFailure": "refusal-fallback" if not provenance_ok and observed.get("refusalFallback") else None, "dispatched": True, "graded": graded, "credited": grade_ok if graded else None, **observed, "exit": rc, "gradeExit": grc, "timedOut": timed, "crashed": status == "crashed",
            "agentExit": meta.get("agent_exit"), "signal": run_status.get("signal"),
            "toolpack": {k: meta.get("toolpack_" + k) for k in ("profile", "sha256", "check", "intact_after_run")} if entry["toolpack"] else None,
            "provenance": provenance, "provenanceOk": provenance_ok, "taskPassed": passed,
            "gradeOutcome": "accepted" if passed else "rejected" if graded and provenance_ok else "unavailable",
            "claims": normalized if claims_ok else [], "claimsAvailable": claims_ok,
            "claimsState": "available" if claims_ok else "malformed" if (path / "workdir/results.json").exists() else "missing",
            "resultSha256": sha(path / "workdir/results.json") if (path / "workdir/results.json").is_file() else None,
            "summarySha256": sha(path / "grade/task-summary.json") if (path / "grade/task-summary.json").is_file() else None}


def limit_events(rows, row_id):
    return sum(r["id"] == row_id and r["status"] == "rate-limited" for r in rows)


def refusal_events(rows, row_id):
    return sum(r["id"] == row_id and r["status"] == "provider-refused" for r in rows)


def runnable(plan, prior, seen, row_id):
    """Whether `run` would launch, re-launch or resume grading this slot (provider pauses aside). `prior` is the
    slot's rows, `seen` every row its retry budgets count. A finished study has no runnable slot."""
    if not prior or (prior[-1].get("dispatched") and prior[-1].get("graded") is False):
        return True
    last = prior[-1]["status"]
    # Not-started refusals and provider limit/refusal events are infrastructure: they spend no interruption retry.
    launched = [r for r in prior if r["status"] not in ("not-started", "rate-limited", "provider-refused")]
    if last == "interrupted":
        return len(launched) <= plan["retryRule"]["interruptedRetries"]
    # Each rate-limited row is re-queued exactly once (a new row replaces it as the newest),
    # at most rateLimitRetries times per slot; beyond that the slot stays an infrastructure failure.
    if last == "rate-limited":
        return limit_events(seen, row_id) <= plan["retryRule"]["rateLimitRetries"]
    # A provider-refused slot gets a fresh session at most refusalRetries times (0 for old registrations).
    if last == "provider-refused":
        return refusal_events(seen, row_id) <= refusal_retries(plan)
    return last == "not-started"


def refusal_backlog(plan, rows, specs):
    """Slots whose newest row is provider-refused: retryable (the run stopped or its provider paused before
    the fresh session) or exhausted (more refusals than refusalRetries: infrastructure, study incomplete)."""
    pending, exhausted = [], []
    for spec in specs:
        prior = [r for r in rows if r["id"] == spec["id"]]
        if prior and prior[-1]["status"] == "provider-refused":
            info = {"id": spec["id"], "arm": spec["arm"], "events": refusal_events(rows, spec["id"]),
                    "categories": (prior[-1].get("providerRefusal") or {}).get("categories", [])}
            (exhausted if info["events"] > refusal_retries(plan) else pending).append(info)
    return pending, exhausted


def rate_limit_backlog(plan, rows, history=(), registry=None, specs=None):
    """Slots whose newest row is rate-limited: retryable (re-queued by the next run, once per limit
    event) or exhausted (more limit events than rateLimitRetries: infrastructure, study incomplete)."""
    registry = arm_registry() if registry is None else registry
    pending, exhausted = [], []
    for spec in schedule(plan, history) if specs is None else specs:
        prior = [r for r in rows if r["id"] == spec["id"]]
        if prior and prior[-1]["status"] == "rate-limited":
            info = {"id": spec["id"], "arm": spec["arm"], "family": registry[spec["arm"]]["family"],
                    "events": limit_events(rows, spec["id"]), **{k: (prior[-1].get("rateLimit") or {}).get(k)
                    for k in ("resetsAt", "resetsAtUtc", "resetHint")}}
            (exhausted if info["events"] > plan["retryRule"]["rateLimitRetries"] else pending).append(info)
    return pending, exhausted


def pause(paused, family, info):
    """Merge one limit event into its provider's pause; keep the latest CLI-reported reset."""
    old = paused.get(family, {})
    later = (info.get("resetsAt") or 0) >= (old.get("resetsAt") or 0)
    paused[family] = {k: (info.get(k) if later and info.get(k) is not None else old.get(k))
                      for k in ("resetsAt", "resetsAtUtc", "resetHint")}


def run(plan, state, digest, lock_fd, max_runs=None, only=None, *, now=time.monotonic,
        free=lambda p: shutil.disk_usage(p).free, executor=execute, wall_now=time.time, fault=lambda _: None, stopped=lambda: False,
        history=(), report=None, specs=None, base=()):
    """`specs` replaces the schedule and `base` holds read-only rows recorded elsewhere that count as those
    slots' history (retry numbering, retry budgets); both only for a supplement. Never written here."""
    need(not only or plan["dryRun"], "--only is restricted to dry plans")
    specs = schedule(plan, history) if specs is None else specs
    path = state / "runs.json"
    rows = read(path) if path.exists() else []
    # The inherited lease guarantees no surviving child is still writing metadata.
    for row in rows:
        if row["status"] == "running" and not row.get("dispatched"):
            meta = read_optional(attempt_path(state, row) / "meta.json")
            if not meta.get("start") or meta.get("cancelled_before_agent") is True:
                row.update(status="not-started", failure="controller-interrupted-before-agent")
            elif meta.get("status") not in (None, "preparing", "running") and (
                    meta.get("end") is not None or meta.get("agent_exit") is not None):
                rc = 0 if meta["status"] == "finished" and meta.get("tmp_deleted") is True else 1
                row.update(dispatched=True, graded=False, exit=rc,
                           status=execution_status(rc, meta, read_optional(attempt_path(state, row) / "run_status.json")))
            else:
                row.update(status="interrupted", taskPassed=False, gradeOutcome="unavailable",
                           exit=None, timedOut=False, crashed=False, wallClockMs=None, interruption="controller-interrupted")
    atomic(path, rows)
    count = 0
    registry = arm_registry()
    # A provider whose CLI-reported reset is still ahead stays paused: relaunching would only spend a retry.
    paused = {}
    for info in rate_limit_backlog(plan, [*base, *rows], history, registry, specs)[0]:
        if info["resetsAt"] is not None and info["resetsAt"] > wall_now():
            pause(paused, info["family"], info)
    finished = True
    # Amendment rows follow every earlier row, so completed rows are skipped, never re-run or reordered.
    queue = list(specs)
    while queue:
        spec = queue.pop(0)
        if stopped() or (max_runs is not None and count >= max_runs):
            finished = False
            break
        if only and (spec["task"], spec["arm"]) != tuple(only.split("/")):
            continue
        seen = [*base, *rows]
        prior = [r for r in seen if r["id"] == spec["id"]]
        pending = prior and prior[-1].get("dispatched") and prior[-1].get("graded") is False
        launched = [r for r in prior if r["status"] not in ("not-started", "rate-limited", "provider-refused")]
        if not runnable(plan, prior, seen, spec["id"]):
            continue
        family = registry[spec["arm"]]["family"]
        if family in paused and not pending:
            continue  # Provider paused: nothing launched or recorded; other providers continue in order.
        if pending:
            need(prior[-1].get("gradingAttempts", 0) <= plan["retryRule"]["gradingRetries"] or
                 determinate_summary(read_optional(attempt_path(state, prior[-1]) / "grade/task-summary.json"),
                                     spec["task"], attempt_path(state, prior[-1]).name),
                 "grading retry limit exhausted; operator intervention required")
        disk_floor(plan, state, free)
        start = now()
        row = {**spec, "retry": len(prior), "settingsHash": digest, "status": "running", "taskPassed": False,
               "gradeOutcome": "unavailable", "claims": [], "claimsAvailable": False,
               "provenance": None, "provenanceOk": False, "wallClockMs": None,
               "sequence": len(rows) + 1, "startedAt": wall_now(),
               "executionRetry": len(launched), "rateLimitRetry": limit_events(seen, spec["id"]),
               "refusalRetry": refusal_events(seen, spec["id"])}
        if pending:
            need(any(r is prior[-1] for r in rows), "base rows are read-only")
            row = prior[-1]
        else:
            rows.append(row)
            atomic(path, rows)
            fault("after-start")
        try:
            result = executor(plan, row, state, lock_fd)
            row.update(result)
            row.setdefault("dispatched", True)
            fault("after-execution")
        except Exception:
            if not row.get("dispatched"):
                row.update(status="not-started", failure="controller-refusal", taskPassed=False)
            elif row.get("graded") is not False:
                row.update(status="crashed", gradeOutcome="unavailable", taskPassed=False,
                           timedOut=False, crashed=True, failure="adapter-error")
            if row.get("graded") is False and row.get("gradingAttempts", 0) > plan["retryRule"]["gradingRetries"]:
                row["status"] = "grading-failed"
            atomic(path, rows)
            raise
        # Production execute checkpoints dispatch time before grading, including exceptions.
        # Injected executors may supply their own elapsed time; never charge grading on resume.
        elapsed = now() - start
        if "dispatchMs" not in row and not pending:
            row["dispatchMs"] = round(elapsed * 1000, 3) if math.isfinite(elapsed) and elapsed >= 0 else None
        row["wallClockMs"] = row.get("dispatchMs")
        if row["status"] == "rate-limited":
            row["rateLimitEvents"] = limit_events([*base, *rows], spec["id"])
            if row["rateLimitEvents"] > plan["retryRule"]["rateLimitRetries"]:
                row["infrastructure"] = "rate-limit-exhausted"
            pause(paused, family, row.get("rateLimit") or {})
        requeue = False
        if row["status"] == "provider-refused":
            row["providerRefusalEvents"] = refusal_events([*base, *rows], spec["id"])
            if row["providerRefusalEvents"] > refusal_retries(plan):
                row["infrastructure"] = "provider-refused-exhausted"
            else:
                requeue = True
        atomic(path, rows)
        need(row.get("graded") is not False, "grading unavailable; resume to re-grade immutable attempt")
        count += 1
        if requeue:
            queue.insert(0, spec)  # Fresh session now, at the same schedule position: the locked order holds.
    if report is not None:
        pending, exhausted = rate_limit_backlog(plan, [*base, *rows], history, registry, specs)
        refusing, refused = refusal_backlog(plan, [*base, *rows], specs)
        report.update(paused=paused, pending=pending, exhausted=exhausted, finished=finished,
                      refusalPending=refusing, refusalExhausted=refused,
                      providerRefusals=sum(r["status"] == "provider-refused" for r in rows))
    return rows


def rate_limit_message(report, plan):
    """Operator summary after `run`; never echoes CLI or agent text beyond the bounded reset hint."""
    lines = []
    for family, info in sorted(report["paused"].items()):
        when = "; ".join([f"CLI-reported reset {info['resetsAtUtc']}"] * bool(info.get("resetsAtUtc")) +
                         [f"CLI says try again {info['resetHint']} (local time)"] * bool(info.get("resetHint"))) or "reset time not reported"
        lines.append(f"Provider usage limit: {family} arms paused ({when}); other providers' runs continued.")
    if report["pending"]:
        lines.append(f"{len(report['pending'])} rate-limited run(s) will be re-queued by the next `run` (once per limit "
                     f"event, at most rateLimitRetries={plan['retryRule']['rateLimitRetries']} per run slot). They are "
                     "infrastructure, excluded from scoring and never charged to an arm.")
    if report["exhausted"]:
        lines.append(f"{len(report['exhausted'])} run slot(s) exceeded rateLimitRetries: infrastructure failure; the study "
                     "is incomplete (never an arm failure).")
    if report["paused"] and report["finished"]:
        lines.append("Nothing else is runnable now; run again after the reset.")
    return "\n".join(lines)


def refusal_message(report, plan):
    """Operator summary of provider safety refusals; only counts are printed, never CLI or agent text."""
    lines = []
    if report.get("providerRefusals"):
        lines.append(f"Provider refusals: {report['providerRefusals']} session(s) ended on a provider safety refusal; each "
                     f"slot is re-queued in a fresh session (at most refusalRetries={refusal_retries(plan)}). They are "
                     "infrastructure, excluded from scoring and never charged to an arm.")
    if report.get("refusalPending"):
        lines.append(f"{len(report['refusalPending'])} provider-refused run slot(s) get a fresh session on the next `run`.")
    if report.get("refusalExhausted"):
        lines.append(f"{len(report['refusalExhausted'])} run slot(s) exceeded refusalRetries: provider-refused-exhausted; "
                     "infrastructure failure, the study is incomplete (never an arm failure).")
    return "\n".join(lines)


def score(plan, state, digest, adjudications=None, *, history=(), chain=None, amendments=(), rows=None, supplement=None,
          frozen=False):
    """`rows`/`supplement` score a finished study overlaid by its supplement (see supplement_rows)."""
    if rows is None:
        rows = read(state / "runs.json") if (state / "runs.json").exists() else []
    # Validate identities before statistics; never let duplicate/cross-study records pad results.
    rows_spec = schedule(plan, history, frozen=frozen)
    specs = {r["id"]: r for r in rows_spec}
    chain = list(chain) if chain else [digest]
    seen = set()
    for row in rows:
        need(row["settingsHash"] in chain and row["id"] in specs, "run belongs to another plan")
        spec = specs[row["id"]]
        need(all(row[k] == spec[k] for k in ("task", "arm", "attempt", "phase")) and
             row.get("window", 0) == spec["window"], "run identity mismatch")
        # A row runs under the chain head of its time; it cannot predate the amendment that added it.
        need(chain.index(row["settingsHash"]) >= spec["window"], "run predates its amendment")
        ident = (row["id"], row["retry"])
        need(ident not in seen, "duplicate execution")
        seen.add(ident)
    registry = arm_registry()
    # Provider family per arm lets the scorer recognize runs deferred by a provider usage-limit pause.
    providers = {a["id"]: registry[a["id"]]["family"] for a in plan["arms"]}
    return bridge("score", {"plan": plan, "settingsHash": digest, "schedule": rows_spec, "providers": providers,
                            "rows": rows, "adjudications": adjudications or [], "amendments": list(amendments),
                            **({"supplement": supplement} if supplement else {})})


# Supplement: after a study locked before refusal support finishes, re-run only its provider-refused slots and
# re-assess its refused-turn rows under the refusal rules. The study's state is only read. A study has one
# supplement, in the directory next to its state; registration seals the record and its seed rows and launches
# nothing. A live supplement runs and is scored only once its hash is committed in LOCKED-SUPPLEMENT.json, so a
# second registration (a new directory, or a deleted one) can neither run nor be scored without a visible commit.
IDENTITY_KEYS = ("id", "task", "arm", "attempt", "phase", "window", "retry", "settingsHash", "sequence", "startedAt",
                 "executionRetry", "rateLimitRetry", "exit", "dispatchMs", "wallClockMs")


class Git:
    """The controller's git facts a supplement relies on (tests inject a fake)."""

    @staticmethod
    def run(*args, ok=(0,)):
        r = subprocess.run(["git", "-C", str(REPO), *args], capture_output=True, text=True, check=False)
        need(r.returncode in ok, "supplement needs the controller's git commit")
        return r

    def head(self):
        """HEAD's sha and whether packages/ has uncommitted changes."""
        return {"sha": self.run("rev-parse", "HEAD").stdout.strip(),
                "dirty": bool(self.run("status", "--porcelain", "--", "packages").stdout.strip())}

    def same(self, since, paths, exclude=()):
        """No committed difference under `paths` (bar `exclude`) between commit `since` and HEAD."""
        return self.run("diff", "--quiet", since, "HEAD", "--", *paths, *(f":(exclude){x}" for x in exclude),
                        ok=(0, 1)).returncode == 0

    def show(self, rel):
        """A repository file as committed at HEAD (never the working tree), or None when HEAD has none."""
        if self.run("cat-file", "-e", f"HEAD:{rel}", ok=(0, 1, 128)).returncode != 0:
            return None
        return self.run("show", f"HEAD:{rel}").stdout


GIT = Git()


def supplement_dir(state):
    """A study's one supplement directory, next to the study state."""
    return state.with_name(state.name + "-supplement-1")


def supplement_plan(plan, record):
    """The study plan with the supplement's registered refusal budget: its sessions and re-assessments get the
    refusal rules (refusal_aware). Only a study that registered no budget of its own takes a supplement."""
    return {**plan, "retryRule": {**plan["retryRule"], "refusalRetries": record["refusalRetries"]}}


def study_commit(registration, git):
    """The commit the study was locked at, from the committed LOCKED-STUDY.json; None if that records another study."""
    raw = git.show(STUDY_LOCK)
    lock = parse(raw) if raw is not None else {}
    commit = lock.get("lockedAtCommit") if isinstance(lock, dict) and lock.get("settingsHash") == registration["settingsHash"] else None
    return commit if isinstance(commit, str) and re.fullmatch(r"[0-9a-f]{7,40}", commit) else None


def supplement_anchor(study, git):
    """The supplement hash committed for this study (keyed by its chain head) in LOCKED-SUPPLEMENT.json, or None."""
    raw = git.show(SUPPLEMENT_LOCK)
    if raw is None:
        return None
    lock = parse(raw)
    need(isinstance(lock, dict) and lock.get("schema") == "bio-pilot/locked-supplements@1" and
         isinstance(lock.get("supplements"), list) and all(isinstance(e, dict) and isinstance(e.get("studyHead"), str) and
                                                           isinstance(e.get("hash"), str) for e in lock["supplements"]),
         "invalid LOCKED-SUPPLEMENT.json")
    found = [e["hash"] for e in lock["supplements"] if e["studyHead"] == study["head"]]
    need(len(found) <= 1, "LOCKED-SUPPLEMENT.json locks more than one supplement for this study")
    return found[0] if found else None


def finished(state):
    """Read-only probe: no controller (or surviving child) still holds the study's lease."""
    path = state / "controller.lock"
    if path.exists():
        with path.open("r") as f:
            try:
                fcntl.flock(f, fcntl.LOCK_SH | fcntl.LOCK_NB)
            except BlockingIOError:
                raise ValueError("study still active; a supplement starts only after it finishes") from None


def supplement_candidates(plan, state, study, rows):
    """Apply the refusal rules to each slot's newest row, from CLI evidence only. Selection never looks at an outcome:
    a terminal refusal is re-run; a graded row judged provenance-unverified whose stream has CLI refused turns is
    re-assessed. Rows those rules leave to provenance (a refusal fallback, any reported model other than the declared
    one, including another CLI api error's "<synthetic>") or to grading (contamination) are never re-run, and rows
    with a foreign model are never re-assessed. Codex arms have no refusal mechanism here, so none is selected.
    Every slot must be final under the study's own rules: nothing `run` would still launch, re-launch or grade."""
    registry, rerun, regrade = study["armRegistry"], [], []
    specs = schedule(plan, study["plans"][:-1], registry=registry, frozen=True)
    for spec in specs:
        prior = [r for r in rows if r["id"] == spec["id"]]
        need(not any(r["status"] == "running" for r in prior) and not runnable(plan, prior, rows, spec["id"]),
             "study unfinished; a supplement starts only after every slot is final under the study's own rules")
    declared = {a["id"]: None if plan["dryRun"] else a["modelId"] for a in plan["arms"]}
    for spec in specs:
        if registry[spec["arm"]]["family"] != "claude":
            continue
        last = [r for r in rows if r["id"] == spec["id"]][-1]
        ident = {k: spec[k] for k in ("id", "task", "arm", "attempt", "phase", "window")}
        # The pinned controller never writes one: it could only come from an unreleased refusal-aware build.
        need(last["status"] != "provider-refused", "provider-refused row in a study locked before refusal support")
        if not last.get("dispatched") or last.get("graded") is not True or type(last.get("exit")) is not int:
            continue  # never graded, or the transport raised after the agent started (adapter-error, no exit code)
        path = attempt_path(state, last, registry)
        if rate_limited(last, path, "claude"):
            continue  # a terminal rate limit takes precedence, as in execute()
        refused = provider_refused(last, path, "claude", declared[spec["arm"]])
        refusal = provider_refusal(path, "claude")
        if refused:
            rerun.append({**ident, "retry": last["retry"], "categories": refused["providerRefusal"]["categories"]})
        elif (last.get("failure") == "provenance-unverified" and refusal["refusals"] and not refusal["fallback"] and
              not foreign_models(path, "claude", declared[spec["arm"]])):
            regrade.append({**ident, "retry": last["retry"], "summarySha256": last.get("summarySha256"),
                            "resultSha256": last.get("resultSha256")})
    return rerun, regrade


def exclusive(path, value):
    """Write a JSON file that must not exist yet: a synced temp file hard-linked into place (never replaced)."""
    tmp = path.with_name(path.name + ".new")
    try:
        with tmp.open("w") as f:
            json.dump(value, f, sort_keys=True, indent=2, allow_nan=False)
            f.write("\n")
            f.flush()
            os.fsync(f.fileno())
        try:
            os.link(tmp, path)
        except FileExistsError:
            raise ValueError("supplement already registered") from None
    finally:
        tmp.unlink(missing_ok=True)
    fd = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def open_supplement(plan, state, out, reason=None, retries=2, *, create=False, resume=False, now=utc_now, git=None):
    """Register (first use) or verify the study's supplement. It is hash-chained to the study's head and binds the
    exact registration and runs.json bytes it read, so any later change to the original study is refused.
    Registration writes the sealed record, then its seed rows, and launches nothing."""
    git = git or GIT
    need(out == supplement_dir(state), "a study has one supplement, in <study state>-supplement-1")
    registration = read(state / "registration.json")
    study = verify_registration(registration, frozen=True)
    need(study["plan"] == plan, "pre-registered settings are locked (pass the latest amended plan)")
    need(not refusal_aware(plan), "this study registered refusalRetries: its locked refusal budget already governed "
                                  "its provider-refused slots, so it takes no supplement")
    rows = read(state / "runs.json")
    original = {"studyId": plan["studyId"], "settingsHash": registration["settingsHash"], "head": study["head"],
                "registrationSha256": sha(state / "registration.json"), "runsSha256": sha(state / "runs.json")}
    path = out / "supplement.json"
    if create and not path.exists():
        need(not (out / "runs.json").exists() and not (out / "results").exists(), "supplement state already has rows")
        need(text(reason), "supplement needs a non-empty --reason (at most 2000 characters)")
        need(integer(retries, 0, 10), "invalid refusalRetries")
        finished(state)
        need(grader_sha256() == study["grader"], "grader changed after registration; create a new study")
        need(supplement_anchor(study, git) is None, "LOCKED-SUPPLEMENT.json already locks a supplement for this study")
        head = git.head()
        need(plan["dryRun"] or not head["dirty"], "commit the controller before a live supplement")
        locked_at = study_commit(registration, git)
        need(plan["dryRun"] or locked_at is not None,
             "a live supplement needs the study's LOCKED-STUDY.json record (settingsHash and lockedAtCommit)")
        need(locked_at is None or git.same(locked_at, HARNESS, CONTROLLER),
             "arm harness changed since the study's locked commit; a supplement re-runs slots only with the study's harness")
        rerun, regrade = supplement_candidates(plan, state, study, rows)
        # Re-run and re-assessed arms alike: assess() reads the current registry entry.
        arms = sorted({e["arm"] for e in rerun + regrade})
        registry = arm_registry()
        need(all(registry.get(a) == study["armRegistry"][a] for a in arms), "arm registry changed after registration; create a new study")
        record = {"schema": "bio-pilot/supplement@1", "index": 1, "timestamp": now(), "reason": reason, "commit": head,
                  "studyCommit": locked_at, "nonce": os.urandom(16).hex(), "original": original, "refusalRetries": retries,
                  "grader": study["grader"], "armRegistry": {a: registry[a] for a in arms}, "rerun": rerun,
                  "regrade": regrade, "previous": study["head"]}
        record["hash"] = hashes([record])[0]
        seed = supplement_seed(plan, state, record, study, rows)
        out.mkdir(parents=True, exist_ok=True, mode=0o700)
        exclusive(path, record)
        atomic(out / "runs.json", seed)
    need(path.exists(), "no supplement registered")
    record = read(path)
    need(isinstance(record, dict) and set(record) == SUPPLEMENT_KEYS and record["schema"] == "bio-pilot/supplement@1" and
         record["index"] == 1 and integer(record["refusalRetries"], 0, 10) and
         hashes([{k: v for k, v in record.items() if k != "hash"}])[0] == record["hash"], "supplement registration broken")
    need(record["previous"] == study["head"] and record["original"]["head"] == study["head"] and
         record["original"]["settingsHash"] == registration["settingsHash"], "supplement belongs to another study")
    need(record["original"] == original, "original study changed after the supplement was registered")
    need(supplement_anchor(study, git) in (None, record["hash"]), "LOCKED-SUPPLEMENT.json locks another supplement for this study")
    # Rows are append-only: a removed runs.json, or an attempt directory without its row, voids the supplement.
    need((out / "runs.json").exists(), "supplement rows missing; the supplement is void")
    kept = {attempt_path(out, r, study["armRegistry"]) for r in read(out / "runs.json")
            if isinstance(r, dict) and (r.get("supplement") or {}).get("kind") == "rerun"}
    need(all(d in kept for d in (out / "results").glob("*/*")), "supplement attempt without its row; the supplement is void")
    if resume:
        finished(state)
        head = git.head()
        need(plan["dryRun"] or not head["dirty"], "commit the controller before a live supplement")
        need(head["sha"] == record["commit"]["sha"] or git.same(record["commit"]["sha"], ("packages",), (SUPPLEMENT_LOCK,)),
             "run a supplement from its registered commit (only LOCKED-SUPPLEMENT.json may change)")
        need(grader_sha256() == record["grader"], "grader changed after registration; create a new study")
        need(all(arm_registry().get(a) == e for a, e in record["armRegistry"].items()), "arm registry changed after registration")
        need(list(supplement_candidates(plan, state, study, rows)) == [record["rerun"], record["regrade"]],
             "supplement selection no longer matches the original evidence")
    return record, study, rows


def supplement_marker(record, kind):
    return {"index": record["index"], "kind": kind, "hash": record["hash"]}


def supplement_seed(plan, state, record, study, rows):
    """Reclassified copies of the re-run slots' refused rows and re-assessed refused-turn rows, written at registration.
    Re-assessment reuses the immutable, hash-bound grade summary: the grader is not run again (no second chance)."""
    registry, out, budget = study["armRegistry"], [], supplement_plan(plan, record)
    declared = {a["id"]: None if plan["dryRun"] else a["modelId"] for a in plan["arms"]}
    verdict = lambda r: {k: r.get(k) for k in ("status", "failure", "gradeOutcome", "provenanceOk", "taskPassed")}
    for e in record["rerun"]:
        last = next(r for r in rows if (r["id"], r["retry"]) == (e["id"], e["retry"]))
        refused = provider_refused(last, attempt_path(state, last, registry), "claude", declared[e["arm"]])
        need(refused is not None, "original evidence changed after the supplement was registered")
        events = refusal_events(rows, e["id"]) + 1
        out.append({**{k: last[k] for k in IDENTITY_KEYS if k in last}, **refused, "providerRefusalEvents": events,
                    **({"infrastructure": "provider-refused-exhausted"} if events > record["refusalRetries"] else {}),
                    "supplement": supplement_marker(record, "reclassified"), "supersedes": verdict(last)})
    for e in record["regrade"]:
        last = next(r for r in rows if (r["id"], r["retry"]) == (e["id"], e["retry"]))
        path = attempt_path(state, last, registry)
        result = path / "workdir/results.json"
        need(sha(path / "grade/task-summary.json") == e["summarySha256"] and
             (sha(result) if result.is_file() else None) == e["resultSha256"], "original evidence changed after the supplement was registered")
        exhausted = "grader-retries-exhausted" in (last.get("infrastructureWarnings") or [])
        out.append({**last, **assess(budget, last, path, last.get("gradeExit"), last.get("gradingMs"), exhausted),
                    "supplement": supplement_marker(record, "regrade"), "supersedes": verdict(last)})
    return out


def supplement_run(plan, state, out, record, study, rows, lock_fd, max_runs=None, *, git=None, **kwargs):
    """Give each re-run slot fresh sessions through the ordinary controller loop; a live supplement only once its
    hash is committed in LOCKED-SUPPLEMENT.json. The original rows are read-only history (retry numbers and the
    refusal budget); rows land only in `out`, after the seed written at registration."""
    need(plan["dryRun"] or supplement_anchor(study, git or GIT) == record["hash"],
         "commit the supplement hash to LOCKED-SUPPLEMENT.json before its first session")
    seeded = {(r["id"], r["retry"]) for r in read(out / "runs.json") if r["supplement"]["kind"] == "reclassified"}
    ids = {e["id"] for e in record["rerun"]}
    base = [r for r in rows if r["id"] in ids and (r["id"], r["retry"]) not in seeded]
    specs = [{**{k: e[k] for k in ("id", "task", "arm", "attempt", "phase", "window")},
              "supplement": supplement_marker(record, "rerun")} for e in record["rerun"]]
    return run(supplement_plan(plan, record), out, record["hash"], lock_fd, max_runs, specs=specs, base=base, **kwargs)


def supplement_rows(state, out, record):
    """Original rows, never modified, overlaid by the supplement. The copies must be exactly the registered
    selections (a reclassified copy per re-run slot's refused row, a re-assessed copy per regrade row), each with
    the identity of the original row it replaces. Sessions must belong to the registered re-run slots, carry the
    supplement hash and continue each slot's retry numbers in order; they follow every original row."""
    original = read(state / "runs.json")
    added = read(out / "runs.json") if (out / "runs.json").exists() else []
    need(all(isinstance(r, dict) and isinstance(r.get("supplement"), dict) and r["supplement"].get("hash") == record["hash"] and
             r["supplement"].get("index") == record["index"] and r["supplement"].get("kind") in ("reclassified", "regrade", "rerun")
             for r in added), "supplement row from another registration")
    by_key = {(r["id"], r["retry"]): r for r in original}
    expected = {**{(e["id"], e["retry"]): "reclassified" for e in record["rerun"]},
                **{(e["id"], e["retry"]): "regrade" for e in record["regrade"]}}
    copies = [r for r in added if r["supplement"]["kind"] != "rerun"]
    over = {(r["id"], r["retry"]): r for r in copies}
    need(len(over) == len(copies) and {k: r["supplement"]["kind"] for k, r in over.items()} == expected and
         all(k in by_key and all(r.get(f) == by_key[k].get(f) for f in IDENTITY_KEYS) for k, r in over.items()),
         "supplement rows do not match its registered selections")
    sessions = [r for r in added if r["supplement"]["kind"] == "rerun"]
    slot_ids = {e["id"] for e in record["rerun"]}
    need(all(r["id"] in slot_ids and r["settingsHash"] == record["hash"] for r in sessions),
         "supplement session outside its registered slots")
    for slot in slot_ids:
        first = 1 + max(r["retry"] for r in original if r["id"] == slot)
        retries = [r["retry"] for r in sessions if r["id"] == slot]
        need(retries == list(range(first, first + len(retries))), "supplement sessions out of order")
    return [over.get((r["id"], r["retry"]), r) for r in original] + sessions


def supplement_info(record):
    return {"index": record["index"], "hash": record["hash"], "previous": record["previous"], "reason": record["reason"],
            "commit": record["commit"], "refusalRetries": record["refusalRetries"],
            "rerunSlots": [e["id"] for e in record["rerun"]], "regradedRows": [f"{e['id']}/r{e['retry']}" for e in record["regrade"]]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("discover", "lock", "amend", "schedule", "run", "score", "supplement"))
    parser.add_argument("--plan", type=Path, default=HERE / "plan.json")
    parser.add_argument("--state", type=Path, help="default ~/.omerta-bio/pilots/<studyId>")
    parser.add_argument("--dry-run", action="store_true", help="discover: generate a separate dry-run plan; run: require dry plan")
    parser.add_argument("--pin-cli", action="store_true",
                        help="discover: pin each arm's CLI version from CLAUDE_BIN/CODEX_BIN (or PATH) --version")
    parser.add_argument("--reason", help="amend: why the amendment is made (recorded in the hash chain)")
    parser.add_argument("--max-runs", type=int)
    parser.add_argument("--only", help="task-id/arm-id (enabled arm)")
    parser.add_argument("--adjudications", type=Path, help="trusted claim adjudications bound to result + summary hashes")
    parser.add_argument("--supplement", type=Path,
                        help="supplement: its state directory, always <study state>-supplement-1; score: score the "
                             "finished study with and without it")
    parser.add_argument("--refusal-retries", type=int, default=2,
                        help="supplement: fresh sessions per provider-refused slot (registered on first use)")
    args = parser.parse_args()
    if args.command == "discover":
        need(not args.plan.exists(), "plan already exists; use a new filename")
        plan = make_plan(discover(), args.dry_run)
        if args.pin_cli:
            registry = arm_registry()
            versions = {f: cli_version(f) for f in sorted({registry[a["id"]]["family"] for a in plan["arms"]})}
            for arm in plan["arms"]:
                arm["cliVersion"] = versions[registry[arm["id"]]["family"]]
        atomic(args.plan, plan)
        print("Plan discovered; check CLI pins and settings before lock." if args.pin_cli else
              "Plan discovered; pin CLI versions and settings before lock.")
        return
    plan = normalize(read(args.plan))
    need(args.command != "supplement" or args.supplement, "supplement requires --supplement <state dir>")
    need(not args.supplement or args.command in ("supplement", "score"), "--supplement is only for supplement and score")
    # A supplement reads a finished registration as recorded (its hash binds the tool pack it ran with).
    frozen = args.supplement is not None
    validate(plan, discover() if args.command in ("lock", "amend") else None, frozen=frozen)
    if args.command in ("run", "supplement"):
        check_tasks(plan, frozen)
    need(not args.dry_run or plan["dryRun"], "--dry-run requires a separately locked dry plan")
    need(args.command != "amend" or text(args.reason), "amend requires --reason")
    state = (args.state or Path.home() / ".omerta-bio/pilots" / plan["studyId"]).expanduser().resolve()
    # Real state must remain in a denied root, outside agent work directories.
    need(state.is_relative_to(Path.home().resolve()), "pilot state must be under the denied home root")
    need(args.max_runs is None or args.max_runs >= 0, "max-runs must be nonnegative")
    if args.only:
        need(args.only in {f"{t['id']}/{a}" for t in plan["tasks"] for a in enabled_arms(plan)}, "invalid --only task/arm")
    if args.supplement:
        out = args.supplement.expanduser().resolve()
        need(out.is_relative_to(Path.home().resolve()) and out == supplement_dir(state),
             "a study has one supplement, in <study state>-supplement-1 under the denied home root")
        need(not args.only, "--only is not available for a supplement")
        # Only the supplement's own lease is taken: the study's state is never opened for writing.
        with lease(out) as fd:
            supplement_command(args, plan, state, out, fd)
        return
    with lease(state) as fd:
        if args.command == "amend":
            record = amend(plan, state, args.reason)
            print(f"Amendment {record['index']} recorded; chain head {record['hash']}")
            return
        study = open_study(plan, state, args.command == "lock")
        digest, history = study["head"], study["plans"][:-1]
        if args.command == "schedule":
            print(json.dumps(schedule(plan, history), indent=2))
        elif args.command == "run":
            # Refuse unsafe environment or an unpinned CLI before writing the first started record.
            for arm in plan["arms"]:
                if arm["id"] not in plan["disabledArms"]:
                    execution_env(plan, arm)
            cli_preflight(plan)
            stop = [False]
            for sig in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
                signal.signal(sig, lambda *_: stop.__setitem__(0, True))
            report = {}
            rows = run(plan, state, digest, fd, args.max_runs, args.only, stopped=lambda: stop[0], history=history,
                       report=report)
            print(f"{len(rows)} recorded executions; {'dry-run' if plan['dryRun'] else 'live'}; stop resumes at the next run")
            for message in (rate_limit_message(report, plan), refusal_message(report, plan)):
                if message:
                    print(message)
        elif args.command == "score":
            result = score(plan, state, digest, read(args.adjudications) if args.adjudications else None,
                           history=history, chain=study["chain"], amendments=study["amendments"])
            markdown = result.pop("markdown")
            atomic(state / "scoreboard.json", result)
            (state / "scoreboard.md").write_text(markdown)
            print("Wrote scoreboard.json and scoreboard.md (no sealed contents).")
        else:
            print(f"Locked {digest}")


def supplement_command(args, plan, state, out, fd):
    adjudications = read(args.adjudications) if args.adjudications else []
    if args.command == "score":
        record, study, rows = open_supplement(plan, state, out)
        need(plan["dryRun"] or supplement_anchor(study, GIT) == record["hash"],
             "a live supplement is scored only once its hash is committed in LOCKED-SUPPLEMENT.json")
        merged = supplement_rows(state, out, record)
        common = {"history": study["plans"][:-1], "amendments": study["amendments"], "frozen": True}
        known = lambda rs: [a for a in adjudications if any((r["id"], r["retry"]) == (a.get("id"), a.get("retry")) for r in rs)]
        for name, result in (("scoreboard-original", score(plan, state, study["head"], known(rows), chain=study["chain"], **common)),
                             ("scoreboard", score(plan, state, study["head"], known(merged), chain=[*study["chain"], record["hash"]],
                                                  rows=merged, supplement=supplement_info(record), **common))):
            markdown = result.pop("markdown")
            atomic(out / f"{name}.json", result)
            (out / f"{name}.md").write_text(markdown)
        print("Wrote scoreboard.json/.md (with supplement) and scoreboard-original.json/.md (without) in the supplement state.")
        return
    record, study, rows = open_supplement(plan, state, out, args.reason, args.refusal_retries, create=True, resume=True)
    if not plan["dryRun"] and supplement_anchor(study, GIT) != record["hash"]:
        print(f"Supplement {record['index']} registered ({record['hash']}): {len(record['rerun'])} provider-refused "
              f"slot(s) to re-run, {len(record['regrade'])} refused-turn row(s) re-assessed. Nothing launched: record "
              f"studyId {plan['studyId']}, studyHead {study['head']} and hash {record['hash']} in {SUPPLEMENT_LOCK}, "
              "commit it, then run `supplement` again.")
        return
    arms = sorted({e["arm"] for e in record["rerun"]})
    for arm in plan["arms"]:
        if arm["id"] in arms:
            execution_env(plan, arm)
    cli_preflight(plan, arms)
    stop = [False]
    for sig in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
        signal.signal(sig, lambda *_: stop.__setitem__(0, True))
    report = {}
    added = supplement_run(plan, state, out, record, study, rows, fd, args.max_runs, stopped=lambda: stop[0], report=report)
    print(f"Supplement {record['index']} ({record['hash']}): {len(record['rerun'])} provider-refused slot(s) to re-run, "
          f"{len(record['regrade'])} refused-turn row(s) re-assessed; {len(added)} supplement row(s). Original rows unchanged.")
    for message in (rate_limit_message(report, plan), refusal_message(report, supplement_plan(plan, record))):
        if message:
            print(message)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, KeyError, TypeError):
        # Do not echo external JSON or exception contents (may contain grader/agent data).
        print("Pilot refused: invalid/stale plan, lock, environment, evidence, or disk floor. See pilot/BUILD-NOTES.md.", file=sys.stderr)
        sys.exit(2)
