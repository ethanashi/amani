"""Pilot-scoped hardening around the shared grader; task calibration sources stay untouched."""
import contextlib
import errno
import os
from pathlib import Path
import shutil
import signal
import stat
import subprocess
import sys
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lib"))
from biotasks import grading as shared


class AgentOutputError(Exception):
    pass


def content_call(fn):
    def wrapped(*args, **kwargs):
        try:
            return fn(*args, **kwargs)
        except OSError as exc:
            # Storage/host failures are infrastructure unknowns, never arm losses.
            if exc.errno not in (errno.EACCES, errno.EPERM, errno.ELOOP, errno.ENAMETOOLONG, errno.ENOENT):
                raise
            raise AgentOutputError() from None
        except Exception:
            raise AgentOutputError() from None
    return wrapped


def prepare_delete(root, *, command=subprocess.run, kill=os.kill):
    root = Path(root)
    if root.is_symlink() or not root.exists():
        return
    # Top-down chmod runs BEFORE traversal; chmod -R u+w alone cannot enter mode-000 dirs.
    if sys.platform == "darwin":
        command(["chflags", "-R", "-P", "nouchg", str(root)], capture_output=True)
    def traversable(path):
        if hasattr(os, "chflags"):
            os.chflags(path, path.stat().st_flags & ~stat.UF_IMMUTABLE, follow_symlinks=False)
        os.chmod(path, 0o700)
    traversable(root)
    for directory, dirs, _ in os.walk(root, topdown=True, followlinks=False):
        traversable(Path(directory))
        for name in dirs:
            child = Path(directory) / name
            if not child.is_symlink():
                traversable(child)
    if sys.platform == "darwin":
        command(["chflags", "-R", "-P", "nouchg", str(root)], capture_output=True)
    # A process that escaped the original group can still hold this private run tree.
    # lsof only identifies PIDs with files/cwd under this exact trusted scratch root.
    if root.name.startswith("biobase-grade."):
        found = command(["lsof", "-t", "+D", str(root)], capture_output=True, text=True)
        if found.returncode not in (0, 1) or found.stderr:
            raise OSError("cannot inspect grading stragglers")
        for value in found.stdout.splitlines():
            pid = int(value)
            if pid != os.getpid():
                try:
                    kill(pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass


def rejected_record(card, attempt):
    return {"task": card["id"], "attempt": attempt.name, "meta": {},
            "credited": False, "task_passed": False, "agent_output_failure": True,
            "not_credited_reasons": ["agent-output-failure"],
            "rerun": {"ran": False}, "reproduced": {"ok": False, "why": "agent-output-failure"},
            "contamination": "unknown", "check": {"items": [], "passed": False, "score": 0}}


@contextlib.contextmanager
def hardened():
    original_one, original_summary = shared.grade_one, shared.summary
    original_rerun = shared.grade.rerun
    original_remove, original_rglob = shutil.rmtree, Path.rglob
    original_copy = shutil.copy2

    def remove(path, *args, **kwargs):
        prepare_delete(path)
        return original_remove(path, *args, **kwargs)

    def copy2(source, destination, *args, **kwargs):
        try:
            return original_copy(source, destination, *args, **kwargs)
        except OSError as exc:
            src = Path(source)
            # The re-executed agent can chmod its results unreadable. A read failure
            # there is an output failure; a failure writing the trusted destination is not.
            if (src.name == "results.json" and src.parent.name == "run" and
                    src.parent.parent.name.startswith("biobase-grade.") and
                    exc.filename == str(src)):
                def fail():
                    raise exc
                return content_call(fail)()
            raise

    def rglob(path, *args, **kwargs):
        # Iteration itself can fail on attacker-written output trees.
        return iter(content_call(lambda: list(original_rglob(path, *args, **kwargs)))())

    def grade_one(task_dir, card, attempt, *args, **kwargs):
        try:
            return original_one(task_dir, card, attempt, *args, **kwargs)
        except AgentOutputError:
            return rejected_record(card, attempt)

    def rerun(*args, **kwargs):
        result = original_rerun(*args, **kwargs)
        if result.get("ran") is not True and result.get("reason") != "no run_all.sh":
            raise RuntimeError("grading infrastructure unavailable")
        return result

    def summary(rec):
        return {**original_summary(rec), "agent_output_failure": rec.get("agent_output_failure", False)}

    with contextlib.ExitStack() as stack:
        for obj, name in ((shared.grade, "compare_numbers"), (shared.grade, "scan_transcript"),
                          (shared, "claims_view")):
            stack.enter_context(patch.object(obj, name, content_call(getattr(obj, name))))
        stack.enter_context(patch.object(shared.grade, "rerun", rerun))
        stack.enter_context(patch.object(Path, "rglob", rglob))
        stack.enter_context(patch.object(shutil, "rmtree", remove))
        stack.enter_context(patch.object(shutil, "copy2", copy2))
        stack.enter_context(patch.object(shared, "grade_one", grade_one))
        stack.enter_context(patch.object(shared, "summary", summary))
        yield


if __name__ == "__main__":
    from biotasks.cli import main
    with hardened():
        sys.exit(main(["grade", *sys.argv[1:]]))
