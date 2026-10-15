#!/usr/bin/env python3
"""Five fresh five-key cohorts, no retries or key selection. Retain aggregate receipts only."""
import concurrent.futures
import json
from pathlib import Path
import subprocess
import sys
import time

HERE = Path(__file__).resolve().parent


def one(index):
    output = HERE / f'smoke-fix3-cohort-{index}.json'
    run = subprocess.run([sys.executable, str(HERE/'smoke.py'), '--replicates', '2000',
                          '--keys', '5', '--out', str(output)], capture_output=True, text=True)
    if run.returncode:
        raise RuntimeError(f'cohort {index} failed: {run.stderr}')
    report = json.loads(output.read_text())
    result = {'cohort': index, 'runtimeSeconds': report['runtimeSeconds'], 'report': output.name,
              'criteriaHash': report['receipt']['criteriaHash'], 'planHash': report['receipt']['planHash'],
              'groups': {g: {'calibration': r['calibration'], 'validKeys': r['validKeys'],
                              'reference': r['reference']['count'], 'n': r['reference']['n'],
                              'auc': r['artefactClassifier']['auc'],
                              'aucUpper': r['artefactClassifier']['bounds'][1],
                              'worstLeaveOneKeyOutUpper': max(x['bounds'][1] for x in r['leaveOneKeyOutAuc'])}
                         for g,r in report['groups'].items()}}
    print(json.dumps(result), flush=True)
    return result


if __name__ == '__main__':
    started = time.monotonic()
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        cohorts = list(pool.map(one, range(1,6)))
    summary = {'certified': False, 'scope': 'synthetic Tier A smoke; twins are not independent',
               'runtimeSeconds': round(time.monotonic()-started,3), 'cohorts': cohorts}
    (HERE/'smoke-fix3-summary.json').write_text(json.dumps(summary,indent=2)+'\n')
    if any(c['groups'][f'PL4/{s}']['calibration'] != 'valid' for c in cohorts for s in ('forward','reversed')):
        raise SystemExit('At least one fresh cohort refused; all results retained, no retries.')
