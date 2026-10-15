"""BT1 executes the upstream R script in an empty output tree; values alone never earn credit."""
import json
import hmac
import hashlib
import math
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from .backtest_data import sha, verify_sources, floor
from .backtest_forward import tsv
from .blinding import canonical, digest


def environment_hash(runtime):
    prefix = Path(runtime)/'.pixi/envs/default'
    return digest({str(p.relative_to(prefix)): sha(p) for p in sorted(prefix.rglob('*')) if p.is_file()})


def authenticate(record, key):
    return hmac.new(key, canonical({k:v for k,v in record.items() if k != 'hmac'}), hashlib.sha256).hexdigest()


def scored_estimates(path):
    values = {}
    for row in tsv(path):
        area = row['area']
        if area not in ('all', 'neurology'):
            continue
        if area in values:
            raise ValueError('duplicate scored R area')
        value = float(row['rs_filtered'])
        if not math.isfinite(value) or value <= 0:
            raise ValueError('unavailable scored R estimate')
        values[area] = value
    if set(values) != {'all', 'neurology'}:
        raise ValueError('missing scored R area')
    return values


def verify_receipt(out, key, plan, source, runtime):
    from .backtest_freeze import verify
    out, source, runtime = map(Path, (out, source, runtime))
    record = json.loads((out/'receipt.json').read_bytes())
    if not hmac.compare_digest(record.get('hmac', ''), authenticate(record, key)):
        raise ValueError('unauthenticated R receipt')
    if record.get('precommit') != digest(plan) or any(sha(p) != h for p,h in plan['files'].items()):
        raise ValueError('R freeze changed')
    if (record.get('log_hash') != sha(out/'execution.log') or record.get('output_hash') != sha(out/'reexecuted-table_s22.tsv') or
        record.get('source_manifest_hash') != sha(source/'sources.json') or record.get('script_hash') != sha(source/'src/gensup_analysis.R') or
        record.get('lock_hash') != sha(runtime/'pixi.lock') or record.get('environment_hash') != environment_hash(runtime)):
        raise ValueError('R execution binding changed')
    manifest = verify_sources(source)
    twin = record.get('key_origin') == 'keyed-transition-twin-v1'
    if twin and manifest.get('derivation', {}).get('kind') != 'keyed-transition-twin-v1':
        raise ValueError('twin source binding changed')
    actual = scored_estimates(out/'reexecuted-table_s22.tsv')
    expected = actual if twin else scored_estimates(source/'display_items/table_s22.tsv')
    for area in ('all', 'neurology'):
        if record['comparisons'][area]['estimate'] != actual[area] or not __import__('math').isfinite(actual[area]) or (not twin and abs(actual[area]-expected[area]) > .05):
            raise ValueError('R comparison changed')
    return record


def execute(root, runtime, *, out, now, timeout=3600, run=subprocess.run, precommit=None, auth_key=None, derive_twin=False):
    root, runtime, out = Path(root), Path(runtime), Path(out)
    manifest = verify_sources(root)
    if derive_twin and manifest.get('derivation', {}).get('kind') != 'keyed-transition-twin-v1':
        raise ValueError('twin derivation required')
    executable = runtime/'.pixi/envs/default/bin/Rscript'
    lock = runtime/'pixi.lock'
    if not executable.is_file() or not lock.is_file():
        return {'executed': False, 'passed': False, 'reason': 'pinned R environment unavailable'}
    version = run([str(executable), '-e', 'cat(as.character(getRversion()))'], capture_output=True, text=True, timeout=60)
    if version.returncode or not version.stdout.startswith('4.2.'):
        return {'executed': False, 'passed': False, 'reason': 'R 4.2 required'}
    if not precommit or not auth_key or len(auth_key) < 32:
        raise ValueError('host freeze and authentication key required')
    env_hash = environment_hash(runtime)
    out.mkdir(parents=True, exist_ok=False); floor(out)
    (out/'PRECOMMIT.json').write_bytes(canonical(precommit))
    with tempfile.TemporaryDirectory(prefix='fresh-r-', dir=out) as scratch:
        work = Path(scratch)
        shutil.copytree(root/'src', work/'src')
        (work/'data').symlink_to(root/'data', target_is_directory=True)
        (work/'display_items').mkdir(); (work/'oto').mkdir()
        started = now()
        env = {**os.environ, 'OPENBLAS_NUM_THREADS': '1', 'OMP_NUM_THREADS': '1', 'VECLIB_MAXIMUM_THREADS': '1'}
        with (out/'execution.log').open('w') as log:
            try:
                result = run(['nice', '-n', '15', str(executable), 'src/gensup_analysis.R'], cwd=work, env=env,
                             stdout=log, stderr=log, timeout=timeout)
            except subprocess.TimeoutExpired:
                return {'executed': True, 'passed': False, 'reason': 'execution timeout', 'seconds': now()-started}
        produced = work/'display_items/table_s22.tsv'
        if produced.is_file():
            shutil.copyfile(produced, out/'reexecuted-table_s22.tsv')
        if result.returncode or not produced.is_file():
            return {'executed': True, 'passed': False, 'reason': 'R execution failed or output absent', 'exit_code': result.returncode, 'seconds': now()-started}
        try:
            actual = scored_estimates(produced)
            expected = actual if derive_twin else scored_estimates(root/'display_items/table_s22.tsv')
        except (KeyError, ValueError) as error:
            return {'executed': True, 'passed': False, 'reason': 'scored R areas unavailable: '+str(error),
                    'seconds': now()-started, 'output_hash': sha(produced)}
        comparisons = {k: {'estimate': actual.get(k), 'expected': expected[k],
                         'difference': abs(actual[k]-expected[k]) if k in actual else None,
                         'passed': k in actual and __import__('math').isfinite(actual[k]) and actual[k] > 0 and abs(actual[k]-expected[k]) <= .05} for k in ('all', 'neurology')}
        record = {'executed': True, 'passed': all(r['passed'] for r in comparisons.values()),
                  'key_origin': 'keyed-transition-twin-v1' if derive_twin else 'published-reproduction',
                  'precommit': digest(precommit), 'environment_hash': env_hash, 'log_hash': sha(out/'execution.log'),
                  'seconds': now()-started, 'comparisons': comparisons, 'output_hash': sha(produced),
                  'script_hash': sha(root/'src/gensup_analysis.R'), 'lock_hash': sha(lock),
                  'source_manifest_hash': sha(root/'sources.json'), 'r_version': version.stdout,
                  'one_target_only': {'executed': False, 'reason': 'separate upstream --oto execution required'}}
        record['hmac'] = authenticate(record, auth_key)
        (out/'receipt.json').write_bytes(canonical(record)+b'\n')
        return record
