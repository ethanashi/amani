"""Task cards: the bio-bench `TaskCard` fields plus `seed`, `capMinutes`, `contaminated`.

Validation is strict and fails closed: unknown, missing or mistyped fields refuse the card.
`plantedFlaws` holds opaque `sealed:<id>` references only; the flaw descriptions live in the
sealed key, never in a committed plaintext file.
"""
from __future__ import annotations

import json
import math
import re
from pathlib import Path, PurePosixPath

from .paths import REPO, TASK_ID

FAMILIES = ("reproduction", "negative", "planted-flaw", "held-out", "recovery")
FIELDS = ("id", "family", "datasetManifestHash", "prompt", "sealedAnswerKeyRef", "tolerance",
          "plantedFlaws", "negativeControl", "positiveControl", "heldOut", "seed", "capMinutes",
          "contaminated")
SHA256 = re.compile(r"^[0-9a-f]{64}$")
FLAW_REF = re.compile(r"^sealed:[A-Za-z0-9._-]{1,64}$")


class CardError(ValueError):
    pass


def _number(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) and v >= 0


def _integer(v, lo: int, hi: int) -> bool:
    return isinstance(v, int) and not isinstance(v, bool) and lo <= v <= hi


def validate_card(card, task_dir: Path | None = None) -> dict:
    def need(cond, msg):
        if not cond:
            raise CardError(msg)
    need(isinstance(card, dict), "card is not a JSON object")
    need(set(card) == set(FIELDS), f"card fields must be exactly {sorted(FIELDS)}; "
                                    f"missing {sorted(set(FIELDS) - set(card))}, unknown {sorted(set(card) - set(FIELDS))}")
    need(isinstance(card["id"], str) and TASK_ID.match(card["id"]), "invalid id")
    if task_dir is not None:
        need(Path(task_dir).name == card["id"], "card id must equal its task directory name")
    need(card["family"] in FAMILIES, f"family must be one of {FAMILIES}")
    need(isinstance(card["datasetManifestHash"], str) and SHA256.match(card["datasetManifestHash"]),
         "datasetManifestHash must be 64 lowercase hex characters")
    need(card["prompt"] == "TASK.md", 'prompt must be "TASK.md"')
    ref = card["sealedAnswerKeyRef"]
    need(isinstance(ref, str) and ref.endswith(".enc"), "sealedAnswerKeyRef must name a .enc file")
    parts = PurePosixPath(ref).parts
    need(not PurePosixPath(ref).is_absolute() and ".." not in parts and parts and parts[0] == "packages",
         "sealedAnswerKeyRef must be a repo-relative path under packages/")
    tol = card["tolerance"]
    need(isinstance(tol, dict) and set(tol) == {"absolute", "relative"} and
         _number(tol["absolute"]) and _number(tol["relative"]), "tolerance must be {absolute, relative} >= 0")
    flaws = card["plantedFlaws"]
    need(isinstance(flaws, list) and all(isinstance(f, str) and FLAW_REF.match(f) for f in flaws) and
         len(set(flaws)) == len(flaws), "plantedFlaws must be unique opaque 'sealed:<id>' references")
    for flag in ("negativeControl", "positiveControl", "heldOut", "contaminated"):
        need(isinstance(card[flag], bool), f"{flag} must be a boolean")
    need(not (card["negativeControl"] and card["positiveControl"]), "a task cannot be both a negative and a positive control")
    need(_integer(card["seed"], 0, 2**32 - 1), "seed must be an integer in [0, 2^32)")
    need(_integer(card["capMinutes"], 1, 600), "capMinutes must be an integer in [1, 600]")
    return card


def key_path(card: dict) -> Path:
    p = (REPO / card["sealedAnswerKeyRef"]).resolve()
    if not p.is_relative_to(REPO.resolve()):
        raise CardError("sealed key path escapes the repository")
    return p


def load_card(task_dir: Path, require_key: bool = True) -> dict:
    task_dir = Path(task_dir)
    try:
        card = json.loads((task_dir / "card.json").read_text())
    except (OSError, ValueError) as e:
        raise CardError(f"card.json unreadable: {type(e).__name__}") from None
    validate_card(card, task_dir)
    for name in ("TASK.md", "stage.py", "reference.py", "check.py"):
        if not (task_dir / name).is_file():
            raise CardError(f"task file missing: {name}")
    if not (task_dir / "naive").is_dir():
        raise CardError("task file missing: naive/")
    kp = key_path(card)
    if require_key and (not kp.is_file() or not kp.with_name(kp.name + ".sha256").is_file()):
        raise CardError("sealed answer key or its integrity sidecar is missing")
    return card


def write_card(task_dir: Path, card: dict) -> None:
    validate_card(card, task_dir)
    ordered = {k: card[k] for k in FIELDS}
    (Path(task_dir) / "card.json").write_text(json.dumps(ordered, indent=2) + "\n")
