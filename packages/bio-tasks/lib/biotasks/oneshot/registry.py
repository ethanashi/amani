"""Host-owned, durable one-shot reservations (KA0 CardRegistry style: reserve before copy).

One look per agent context: a context may receive at most one card of a given case (any
variant, any key), exactly once. Grading is one-shot too: a context gets one graded report per
card, and only for a card it was served. A reservation is written before the copy starts and
is never released, so a crash mid-copy burns the look rather than granting a second one. The
caller must keep the context id stable across agent resumes.

Builds are pinned too: each build registers (card id -> ciphertext hash, random build id) after
it verifies, replacing any earlier build of that card id. Verification refuses a card whose
ciphertext and sealed build id are not the latest registered pair, so an earlier build's seal (or
a whole earlier card directory, which is self-consistent) cannot be replayed into a rebuild. The
pin lives outside the card directory; whoever can rewrite this registry can roll it back too.
"""
from __future__ import annotations

import re
import sqlite3
from pathlib import Path

CONTEXT = re.compile(r'^[A-Za-z0-9._-]{1,128}$')


class RegistryError(ValueError):
    pass


class OneShotRegistry:
    def __init__(self, path: Path):
        self.path = Path(path)

    def _connect(self):
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        db = sqlite3.connect(self.path, isolation_level=None, timeout=5)
        # Cards are identified by their ciphertext hash (unique per build), never by directory name.
        db.execute('CREATE TABLE IF NOT EXISTS oneshot_looks (context TEXT NOT NULL, case_id TEXT NOT NULL, card TEXT NOT NULL, '
                   'card_key TEXT NOT NULL, PRIMARY KEY (context, case_id))')
        db.execute('CREATE TABLE IF NOT EXISTS oneshot_grades (context TEXT NOT NULL, card_key TEXT NOT NULL, '
                   'PRIMARY KEY (context, card_key))')
        db.execute('CREATE TABLE IF NOT EXISTS oneshot_builds (card_id TEXT PRIMARY KEY, ciphertext TEXT NOT NULL, '
                   'build_id TEXT NOT NULL)')
        return db

    def register_build(self, card_id: str, ciphertext: str, build_id: str) -> None:
        """The latest build of a card id wins; every earlier build of that id is revoked."""
        db = self._connect()
        try:
            db.execute('BEGIN IMMEDIATE')
            db.execute('INSERT OR REPLACE INTO oneshot_builds VALUES (?, ?, ?)', (card_id, ciphertext, build_id))
            db.execute('COMMIT')
        finally:
            db.close()

    def latest_build(self, card_id: str) -> tuple[str, str] | None:
        db = self._connect()
        try:
            row = db.execute('SELECT ciphertext, build_id FROM oneshot_builds WHERE card_id=?', (card_id,)).fetchone()
        finally:
            db.close()
        return (row[0], row[1]) if row else None

    @staticmethod
    def _check(context_id):
        if not isinstance(context_id, str) or not CONTEXT.match(context_id):
            raise RegistryError('agent context id required')

    def reserve_look(self, context_id: str, case_id: str, card_id: str, card_key: str) -> None:
        self._check(context_id)
        db = self._connect()
        try:
            db.execute('BEGIN IMMEDIATE')
            if db.execute('SELECT 1 FROM oneshot_looks WHERE context=? AND case_id=?', (context_id, case_id)).fetchone():
                db.execute('ROLLBACK')
                raise RegistryError('this agent context already had its one look at this case')
            db.execute('INSERT INTO oneshot_looks VALUES (?, ?, ?, ?)', (context_id, case_id, card_id, card_key))
            db.execute('COMMIT')
        finally:
            db.close()

    def burn_grade(self, context_id: str, case_id: str, card_key: str) -> None:
        self._check(context_id)
        db = self._connect()
        try:
            db.execute('BEGIN IMMEDIATE')
            if not db.execute('SELECT 1 FROM oneshot_looks WHERE context=? AND case_id=? AND card_key=?',
                              (context_id, case_id, card_key)).fetchone():
                db.execute('ROLLBACK')
                raise RegistryError('card was never served to this agent context')
            if db.execute('SELECT 1 FROM oneshot_grades WHERE context=? AND card_key=?', (context_id, card_key)).fetchone():
                db.execute('ROLLBACK')
                raise RegistryError('this agent context already used its one grade for this card')
            db.execute('INSERT INTO oneshot_grades VALUES (?, ?)', (context_id, card_key))
            db.execute('COMMIT')
        finally:
            db.close()
