#!/usr/bin/env python3
"""Validate complete local receipts; no git fetch and no permissive fallbacks."""
import json
from pathlib import Path
import subprocess
import sys

FAST = ['preflight', 'checkout-install', 'typecheck', 'lint', 'unit-suites', 'publish-audit', 'diff-secrets-email', 'cleanup']
FULL = FAST + ['pixi-environments', 'development-suites', 'mutation-smoke', 'reference-c01-c24', 'integrity', 'blinding', 'replays', 'c1-acceptance', 'publish-audit-sealed', 'licences', 'engine-release', 'studio-release', 'paper-pdf']
OPTIONAL = {'lint': None, 'mutation-smoke': 'packages/omb-amani', 'reference-c01-c24': 'packages/omb-amani',
            'integrity': 'packages/omb-amani', 'blinding': 'packages/omb-amani', 'replays': 'packages/omb-amani',
            'c1-acceptance': 'packages/omb-amani', 'engine-release': 'packages/omb-amani',
            'studio-release': 'apps/amani-studio', 'paper-pdf': 'packages/omb-package'}

def validate(repo, commit, mode, directory=None):
    def require(condition):
        if not condition: raise ValueError('invalid CI receipt')
    if mode not in ('fast', 'full'): raise RuntimeError('invalid CI mode')
    def git(*args):
        return subprocess.check_output(['git', '-C', str(repo), *args], text=True, stderr=subprocess.DEVNULL).strip()
    commit = git('rev-parse', '--verify', commit+'^{commit}')
    file = (directory or Path.home()/'.omerta-bio/ci/receipts') / f'{commit}-{mode}.json'
    try:
        r = json.loads(file.read_text())
        require(r['schema'] == 'amani-ci/v1' and r['commit'] == commit and r['mode'] == mode)
        require(r['tree'] == git('rev-parse', commit+'^{tree}') and r['status'] == 'passed')
        require(isinstance(r['duration_seconds'], (float,int)) and r['duration_seconds'] >= 0)
        stages = {s['name']: s for s in r['stages']}
        require(len(stages) == len(r['stages']))
        for name in FULL if mode == 'full' else FAST:
            s = stages[name]
            require(s['duration_seconds'] >= 0)
            if s['status'] == 'not present':
                require(name in OPTIONAL and s.get('reason'))
                if OPTIONAL[name]:
                    require(not git('ls-tree', commit, '--', OPTIONAL[name]))
            else:
                require(s['status'] == 'passed')
        require(all(s['status'] in ('passed','not present') for s in stages.values()))
        return file
    except (OSError, ValueError, KeyError, TypeError, AssertionError) as e:
        raise RuntimeError(f'green {mode} receipt required for {commit}: {file}') from e

if __name__ == '__main__':
    try:
        print(validate(Path(sys.argv[1]), sys.argv[2], sys.argv[3]))
    except Exception as e:
        sys.exit(f'STOP: {e}')
