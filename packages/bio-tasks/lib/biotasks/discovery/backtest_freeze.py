"""Exclusive local plan receipts. Not an external timestamp or proof of an unseen window."""
import json
import os
from pathlib import Path
from .backtest_data import sha
from .blinding import canonical, digest


def freeze(criteria, expected, files, root, *, now, fault_at=lambda p: None):
    criteria, root = Path(criteria), Path(root)
    if sha(criteria) != expected:
        raise ValueError('criteria changed before scoring')
    plan = {'criteria_sha256': expected, 'criteria': json.loads(criteria.read_bytes()),
            'files': {str(Path(p).resolve()): sha(p) for p in files}, 'created_at': now(),
            'external_timestamp': False}
    root.mkdir(parents=True, exist_ok=True)
    # A crash after this exclusive write spends this attempt, before any labels are read.
    with (root/'PRECOMMIT.json').open('xb') as f:
        f.write(canonical(plan)); f.flush(); os.fsync(f.fileno())
    fault_at('precommitted')
    return plan


def verify(plan, criteria):
    if sha(criteria) != plan['criteria_sha256'] or any(sha(p) != h for p, h in plan['files'].items()):
        raise ValueError('frozen code, criteria or inputs changed')
    return digest(plan)
