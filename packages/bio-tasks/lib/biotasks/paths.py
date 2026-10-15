"""Fixed locations. bio-tasks reuses bio-baseline's arm/sealing/grading machinery in place."""
from __future__ import annotations

import re
import sys
from pathlib import Path

PKG = Path(__file__).resolve().parents[2]          # packages/bio-tasks
REPO = PKG.parents[1]
BASELINE = REPO / "packages" / "bio-baseline"
ARM_LIB = BASELINE / "arms" / "lib"
GRADING = BASELINE / "grading"
TASKS = PKG / "tasks"
LIB = PKG / "lib"
RESOURCES = Path(__file__).resolve().parent / "resources"
TASK_ID = re.compile(r"^[a-z0-9][a-z0-9-]{1,62}$")


def use_baseline() -> None:
    """Make bio-baseline's `armlib`, `seal`, `operation` and `grade` importable (not forked)."""
    for p in (ARM_LIB, GRADING):
        if str(p) not in sys.path:
            sys.path.insert(0, str(p))


def task_dir(task_id: str) -> Path:
    if not isinstance(task_id, str) or not TASK_ID.match(task_id):
        raise SystemExit(f"invalid task id: {task_id!r}")
    d = TASKS / task_id
    if not (d / "card.json").is_file():
        raise SystemExit(f"unknown task: {task_id}")
    return d


def grading_root() -> Path:
    """The denied answer-handling root (default ~/.omerta-bio/grading). Plaintext keys, generator
    truth and checker evidence only ever live in temp dirs beneath it."""
    use_baseline()
    import operation
    return operation.root()


def require_under_grading_root(p: Path, what: str) -> Path:
    p = Path(p)
    resolved = p.resolve()
    if not resolved.is_relative_to(grading_root()):
        raise SystemExit(f"refusing: {what} must be inside the grading root, not {p}")
    return p
