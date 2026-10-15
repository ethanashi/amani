"""Read retained host diagnostics; never inspect fixture keys or sealed expectations."""
import json
from pathlib import Path
import sqlite3
import sys


def summarize(root):
    root = Path(root)
    journal = root / 'journal.sqlite'
    if not journal.exists():
        return {'available': False, 'phases': [], 'dryRuns': []}
    with sqlite3.connect(f'file:{journal}?mode=ro', uri=True) as db:
        rows = [(kind, json.loads(payload)) for kind, payload in db.execute('SELECT event_type,payload_json FROM kernel_events ORDER BY sequence')]
    phases, dry_runs, refusals, parks, replans = [], [], [], [], []
    for kind, envelope in rows:
        row = envelope['data']
        if kind == 'phase-started':
            phases.append({'phase': row['phase'], 'at': envelope['at']})
        if kind == 'step-completed' and str(row.get('scope', '')).startswith('dry-run') and str(row.get('name', '')).startswith('exec-'):
            out = row.get('output', {})
            dry_runs.append({'scope': row['scope'], 'attempt': row['name'], 'at': envelope['at'], 'status': out.get('status'), 'category': out.get('category'), 'syntheticError': out.get('errorText')})
        if kind == 'refusal-record' and str(row.get('scope', '')).startswith(('plan', 'code', 'dry-run')):
            refusals.append(row)
        if kind in ('triage-parked', 'paused'):
            parks.append(row)
        if kind == 'plan-replanned':
            replans.append(row)
    return {'available': True, 'phases': phases, 'dryRuns': dry_runs, 'refusals': refusals, 'parks': parks, 'replans': replans}


if __name__ == '__main__':
    print(json.dumps(summarize(sys.argv[1]), indent=2))
