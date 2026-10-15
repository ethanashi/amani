"""Code pin prevents an edited criteria file/sidecar or a v1 report from masquerading as v2."""
import hashlib
import json
from pathlib import Path
from ..paths import PKG

CRITERIA_HASH = 'cd3356c44aff7004ae185f6a9e6b27768b0f7954aea4f3e18aeeba784502f55d'


def load_criteria(path=None, expected_hash=CRITERIA_HASH):
    path = Path(path) if path is not None else PKG / 'discovery/criteria-v3.json'
    raw = path.read_bytes()
    sidecar = path.with_suffix('.json.sha256').read_text().split()[0]
    if hashlib.sha256(raw).hexdigest() != CRITERIA_HASH or expected_hash != CRITERIA_HASH or sidecar != CRITERIA_HASH:
        raise ValueError('unregistered criteria')
    criteria = json.loads(raw)
    if criteria['version'] != 'ka0-proof-v3':
        raise ValueError('unsupported criteria version')
    return criteria


def source_hashes():
    paths = sorted(Path(__file__).parent.glob('*.py')) + sorted((PKG / 'discovery').glob('*.ts'))
    paths += [PKG / 'discovery/criteria-v3.json', PKG / 'discovery/criteria-v3.json.sha256']
    return {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
