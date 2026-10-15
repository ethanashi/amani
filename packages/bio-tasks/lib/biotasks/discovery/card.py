"""Discovery extension, isolated from the byte-pinned pilot card module.

Task cards: the bio-bench `TaskCard` fields plus `seed`, `capMinutes`, `contaminated`.

Validation is strict and fails closed: unknown, missing or mistyped fields refuse the card.
`plantedFlaws` holds opaque `sealed:<id>` references only; the flaw descriptions live in the
sealed key, never in a committed plaintext file.
"""
from __future__ import annotations

import json
import math
import re
from pathlib import Path, PurePosixPath

from ..paths import REPO, TASK_ID

FAMILIES = ("reproduction", "negative", "planted-flaw", "held-out", "recovery",
            "planted-discovery", "frozen-backtest", "forecast")
FIELDS = ("id", "family", "datasetManifestHash", "prompt", "sealedAnswerKeyRef", "tolerance",
          "plantedFlaws", "negativeControl", "positiveControl", "heldOut", "seed", "capMinutes",
          "contaminated")
SHA256 = re.compile(r"^[0-9a-f]{64}$")
DISCOVERY_FIELDS = ("truthClass", "recallExposure", "rungTarget", "gateTargets", "stratum",
                    "powerAtTruth", "twinOf", "synthetic")
TRUTH_CLASSES = ("planted", "established-control", "frozen-backtest", "prospective")
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
    discovery = bool(set(card) & set(DISCOVERY_FIELDS))
    expected = set(FIELDS) | (set(DISCOVERY_FIELDS) if discovery else set())
    need(set(card) == expected, "card fields must match the complete legacy or discovery schema")
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
    need((discovery and ref == "SEALED-KEY.json.enc") or
         (not discovery and not PurePosixPath(ref).is_absolute() and ".." not in parts and parts and parts[0] == "packages"),
         "legacy key refs are repo-relative; discovery keys must be host-task-relative SEALED-KEY.json.enc")
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
    need(discovery or card["family"] not in FAMILIES[5:], "discovery family requires discovery fields")
    if discovery:
        need(card["truthClass"] in TRUTH_CLASSES, "unknown truth class")
        need(card["recallExposure"] in ("none", "low", "medium", "high"), "unknown recall exposure")
        need(card["rungTarget"] in ("0", "1", "1b", "2a", "2b", "3", "4", "5", "6"), "unknown rung")
        gates = card["gateTargets"]
        need(isinstance(gates, list) and len(gates) > 0 and
             all(isinstance(g, str) and re.fullmatch(r"[CFGDR][0-9]+[ab]?", g) for g in gates) and
             len(gates) == len(set(gates)), "invalid gate targets")
        need(isinstance(card["stratum"], str) and bool(TASK_ID.fullmatch(card["stratum"])), "invalid stratum")
        power = card["powerAtTruth"]
        need(power is None or (_number(power) and power <= 1), "invalid analytic power")
        need(card["twinOf"] is None or (isinstance(card["twinOf"], str) and
             bool(TASK_ID.fullmatch(card["twinOf"])) and card["twinOf"] != card["id"]), "invalid twin")
        need(type(card["synthetic"]) is bool, "synthetic must be boolean")
        families = {"planted": "planted-discovery", "established-control": "reproduction",
                    "frozen-backtest": "frozen-backtest", "prospective": "forecast"}
        need(card["family"] == families[card["truthClass"]], "truth class/family mismatch")
        if card["truthClass"] == "planted":
            need(card["synthetic"] and power is not None, "planted truth requires synthetic flag and power")
        if card["truthClass"] == "prospective":
            need(not card["synthetic"] and power is None, "prospective cannot be synthetic")
        if card["recallExposure"] == "high":
            need(card["contaminated"], "high recall exposure must be contaminated")
    return card


def key_path(card: dict, task_dir: Path | None = None) -> Path:
    if "truthClass" in card:
        if task_dir is None or card["sealedAnswerKeyRef"] != "SEALED-KEY.json.enc":
            raise CardError("discovery key resolution requires the trusted host task directory")
        return Path(task_dir) / "SEALED-KEY.json.enc"
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
    kp = key_path(card, task_dir)
    if require_key and (not kp.is_file() or not kp.with_name(kp.name + ".sha256").is_file()):
        raise CardError("sealed answer key or its integrity sidecar is missing")
    if card.get('truthClass') == 'planted':
        from .staging import validate_bindings
        try:
            validate_bindings(task_dir, card)
        except (Exception, SystemExit):
            raise CardError('card calibration binding refused') from None
    return card


def write_card(task_dir: Path, card: dict) -> None:
    validate_card(card, task_dir)
    ordered = {k: card[k] for k in (*FIELDS, *DISCOVERY_FIELDS) if k in card}
    (Path(task_dir) / "card.json").write_text(json.dumps(ordered, indent=2) + "\n")


class CardRegistry:
    """Host-owned, durable reservations keyed by the agent's entire retained context.

    Conservatively isolate all forward/reversed PL4 cards, not merely matching twin IDs.
    The caller must preserve the context ID across agent resumes. Reserve before copying.
    """
    def __init__(self, path):
        self.path = Path(path)

    def reserve(self, context_id, card):
        import sqlite3
        validate_card(card)
        if not isinstance(context_id, str) or not re.fullmatch(r'[A-Za-z0-9._-]{1,128}', context_id):
            raise CardError('agent context required')
        if card.get('stratum') not in ('forward', 'reversed') or card.get('gateTargets') != ['C7', 'C7b']:
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(self.path) as db:
            db.execute('CREATE TABLE IF NOT EXISTS contexts (id TEXT PRIMARY KEY, stratum TEXT NOT NULL)')
            db.execute('BEGIN IMMEDIATE')
            prior = db.execute('SELECT stratum FROM contexts WHERE id=?', (context_id,)).fetchone()
            if prior and prior[0] != card['stratum']:
                raise CardError('twin agent context refused')
            db.execute('INSERT OR IGNORE INTO contexts VALUES (?, ?)', (context_id, card['stratum']))
