#!/usr/bin/env python3
"""nice -n 15 <pixi-python> packages/bio-tasks/discovery/smoke.py [--replicates 50]

Ephemeral random keys, isolated lease, all scratch removed. Only aggregate results are exported.
The pinned criteria predate this script's first run. This is a smoke, not certification.
"""
import argparse
import json
import os
from pathlib import Path
import sys
import tempfile
import time

os.environ.update(OPENBLAS_NUM_THREADS='1', OMP_NUM_THREADS='1', VECLIB_MAXIMUM_THREADS='1', PYTHONDONTWRITEBYTECODE='1')
sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / 'lib'))
from biotasks.discovery.tier_a import run
from biotasks.discovery.staging import stage, verify
from biotasks.discovery.families import STRATA
from biotasks.discovery.leakage import DiscoveryScanner, discovery_tokens
from biotasks.discovery import sealing
import hashlib


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--replicates', type=int, default=2000)
    ap.add_argument('--keys', type=int, default=5)
    ap.add_argument('--out', type=Path)
    args = ap.parse_args()
    started = time.monotonic()
    # Under denied home root, never the default grading lease or any live pilot root.
    with tempfile.TemporaryDirectory(prefix='ka0-smoke.', dir=Path.home()) as td:
        root = Path(td)
        if args.keys < 1:
            raise ValueError('key count')
        keys = [os.urandom(48) for _ in range(args.keys)]
        key = keys[0]
        kp = root / 'host.key'
        kp.write_bytes(key)
        kp.chmod(0o400)
        os.environ['BIO_SEALING_KEY'] = str(kp)
        os.environ['BIO_GRADING_ROOT'] = str(root / 'grading')
        criteria = HERE / 'criteria-v3.json'
        pinned = criteria.with_suffix('.json.sha256').read_text().split()[0]
        result = run(criteria, pinned, root / 'grading' / 'run', key=key, keys=keys, replicates=args.replicates, now=lambda: time.time_ns() // 1000000)
        # Exercise actual K1a + seal-v2 + analyst staging as well as the numerical run.
        for ki, key in enumerate(keys):
            kp.chmod(0o600); kp.write_bytes(key); kp.chmod(0o400)
            for family, strata in STRATA.items():
                for stratum in strata:
                    host = root / 'grading' / f'dm-{family.lower()}-{stratum}-{ki}'
                    analyst = root / 'analyst' / str(ki) / family / stratum
                    receipt = stage(family, stratum, 1, 0, host=host, analyst=analyst, calibration_report=result)
                    with sealing.opened(host / 'SEALED-KEY.json.enc') as plain:
                        raw = plain.read_bytes()
                    private = json.loads(raw)
                    scanner = DiscoveryScanner(discovery_tokens(private), set(), {hashlib.sha256(raw).hexdigest()})
                    verify(analyst, receipt['card']['datasetManifestHash'])
                    if scanner.scan_tree(analyst) or scanner.hits(json.dumps(result)):
                        raise ValueError('private content in smoke output')
                    result.setdefault('staging', {})[f'{ki}/{family}/{stratum}'] = {'contract': 'K1a-validated',
                        'sealing': 'v2', 'manifest': 'verified', 'leakageScan': 'passed',
                        'cardValid': json.loads((host / 'calibration.json').read_bytes())['valid']}
        result['runtimeSeconds'] = round(time.monotonic() - started, 3)
        output = json.dumps(result, indent=2) + '\n'
        if args.out:
            if not args.out.resolve().is_relative_to(HERE):
                raise ValueError('aggregate report must stay inside discovery/')
            args.out.write_text(output)
        # IDs, keys, private truth and per-instance answers are never printed.
        print(json.dumps({'runtimeSeconds': result['runtimeSeconds'], 'certified': False,
                          'groups': {g: r['armPassCounts'] for g, r in result['groups'].items()}}))


if __name__ == '__main__':
    main()
