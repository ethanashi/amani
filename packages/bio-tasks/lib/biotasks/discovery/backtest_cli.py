"""Generated KA1 host entrypoints. Analyst re-execution reuses the existing sandboxed rerunner."""
import argparse
import json
import shutil
from pathlib import Path
from .backtest_cards import LEAKS, grade, verify_stage
from .backtest_data import sha
from .backtest_forward import tsv
from .backtest_stats import arrays, mh, bootstrap
from .blinding import canonical
from .backtest_cards import host_root
from . import sealing
from .metadata import copy_analyst
from ..paths import BASELINE as BASE
import numpy as np


PROMPT = """Estimate the Mantel–Haenszel relative success for support, stratified by phase and area.
Count every status: approved, negative, censored, unmatched, conflicting-date, pre-snapshot-approved.
Only approved/negative/censored enter the all-snapshot estimate; censored means nonlaunch by horizon.
n_targets and n_indications count distinct IDs in those evaluable rows, including on each subsample.
Use target + indication - target×indication cluster covariance on log relative success (or a justified
asymptotically equivalent two-way interval). A nonpositive variance is unavailable. Report a 95% CI.
Endpoints are graded within 0.15 log units, estimates within 0.05; no fixed RNG seed is required.
Candidate features have unverified provenance. Do not use outcome proxies; the host intervenes on
candidate values and tests the actual scores. Anonymous candidates include honest negative controls.
Write results.json with {available:boolean, relative_success:number, ci:[lower,upper],
counts:{approved:n,negative:n,censored:n,unmatched:n,"conflicting-date":n,"pre-snapshot-approved":n},
d1_certified:false,n_targets:n,n_indications:n,scores:{pair_id:number},flags:[string]}.
Scores must cover every evaluable pair. Provide run_all.sh sourcing ./env.sh and code/.
The host reruns your program on these inputs, a secret subsample and candidate interventions;
do not hard-code observations. CI truth coverage is additionally required on the planted card.
This development/reproduction benchmark cannot certify a ranking.
"""


def read_rows(path):
    rows = list(tsv(path))
    for r in rows:
        for k in ('phase', 'support', *LEAKS, *[n for n in r if n.startswith('f_')]):
            if k in r and r[k] != '':
                r[k] = int(r[k]) if k in ('phase', 'support') else float(r[k])
    return rows


def reference(rows, *, arm='reference', n=1000):
    if arm in ('recall-only', 'always-abstain', 'always-conflict'):
        return {'available': False, 'method': arm}
    counts = {s: sum(r['status'] == s for r in rows) for s in ('approved', 'negative', 'censored', 'unmatched', 'conflicting-date', 'pre-snapshot-approved')}
    eligible = [dict(r) for r in rows if r['status'] in ('approved', 'negative', 'censored')]
    if arm == 'unmatched-as-failure':
        eligible += [dict(r, status='negative') for r in rows if r['status'] == 'unmatched']
        counts['negative'] += counts['unmatched']; counts['unmatched'] = 0
    if not eligible or any(r['support'] == '' for r in eligible):
        return {'available': False, 'reason': 'no evaluable genetic support cohort'}
    flags = []
    candidates = [name for name in rows[0] if name in LEAKS or name.startswith('f_')]
    scores = {r['pair']:float(r['support']) for r in eligible if 'pair' in r}
    if arm == 'all-columns':
        for r in eligible:
            r['support'] = int(any(float(r.get(name, 0)) > 0 for name in candidates))
        scores = {r['pair']:float(np.mean([r[c] for c in candidates])) for r in eligible if 'pair' in r} if candidates else scores
        flags = []
    a = arrays(eligible)
    rs = bootstrap(a, np.random.default_rng(932019), n)['relative_success']
    if arm == 'crude':
        a['stratum'] = np.zeros(len(eligible), dtype=int)
        rs = bootstrap(a, np.random.default_rng(932019), n)['relative_success']
    if arm == 'phase4-is-approval':
        flags = []
        for r in eligible:
            if float(r.get('outcome_max_phase', 0)) == 4:
                r['status'] = 'approved'
        a = arrays(eligible); rs = bootstrap(a, np.random.default_rng(932019), n)['relative_success']
    return {'available': rs['available'], 'method': 'crude' if arm == 'crude' else 'mh-phase-area',
            'relative_success': rs['estimate'], 'ci': rs['ci'], 'counts': counts,
            'flags': flags, 'scores': scores, 'd1_certified': False, 'n_targets': len(set(a['target'])), 'n_indications': len(set(a['indication']))}


def key_for(result, *, truth=None):
    if not result.get('available') or result.get('relative_success') is None:
        return {'available': False, 'required': {}, 'key_origin': 'single-implementation-unverified'}
    return {'available': True, 'key_origin': 'single-implementation-unverified',
            'independent_agreement': False,
            'required': {k: result[k] for k in ('counts', 'd1_certified', 'n_targets', 'n_indications')},
            'numeric': {'relative_success': {'value': result['relative_success'], 'tolerance': .05}},
            'truth': truth, 'require_ci': True, 'ci': result['ci']}


def dispatch(command, host, argv):
    parser = argparse.ArgumentParser(); parser.add_argument('--out', type=Path); parser.add_argument('--attempt', type=Path)
    parser.add_argument('--data', type=Path); args = parser.parse_args(argv)
    try:
        host_root()
        card = json.loads((host/'card.json').read_bytes())
        bindings = json.loads((host/'bindings.json').read_bytes())
        from . import backtest_cards
        if sha(backtest_cards.__file__) != bindings['code_sha256'] or not bindings.get('implementation') or any(sha(p)!=h for p,h in bindings['implementation'].items()):
            raise ValueError('trusted card implementation changed')
        backtest_cards.validate_bindings(host, card)
        verify_stage(host/'inputs', card['datasetManifestHash'])
        if command == 'stage':
            if args.out is None or args.out.exists():
                raise ValueError('fresh output required')
            # Public projection only; keys, bindings, calibration and source manifests stay on host.
            copy_analyst(host/'inputs', args.out, backtest_cards.analyst_files(host/'inputs'))
            verify_stage(args.out, card['datasetManifestHash'])
            return 0
        if command == 'reference' or command in ('recall-only', 'crude', 'unmatched-as-failure', 'all-columns', 'phase4-is-approval', 'always-abstain'):
            if args.out is None or not args.out.resolve().is_relative_to(host_root()):
                raise ValueError('reference outputs require private host root')
            if args.data is None:
                raise ValueError('data required')
            verify_stage(args.data.parent, card['datasetManifestHash'])
            result = reference(read_rows(args.data/'pairs.tsv'), arm=command)
            args.out.mkdir(parents=True, exist_ok=True)
            (args.out/'results.json').write_bytes(canonical(result))
            return 0
        if command == 'check':
            backtest_cards.validate_calibration(host, card)
            if args.attempt is None:
                raise ValueError('attempt required')
            # Existing host sandbox, caps, source collection and cleanup; never run worker code directly.
            import sys
            sys.path.insert(0, str(BASE/'grading'))
            import grade as rerunner
            with sealing.scratch('ka1-rerun.') as scratch:
                status = rerunner.rerun(args.attempt, host/'inputs/data', 30, scratch/'rerun')
                answer, _ = rerunner.load_results(args.attempt/'workdir/results.json')
                recomputed, _ = rerunner.load_results(scratch/'rerun/results.json')
                private = sealing.load_json(host/'SEALED-KEY.json.enc')
                if private['canary'] in canonical([answer, recomputed]).decode():
                    raise ValueError('private canary in worker output')
                backtest_cards.validate_private(private, bindings, card)
                key = private['answerKey']
                passed = grade(answer, key, execution={'executed': rerunner.successful_rerun(status), 'exit_code': 0 if rerunner.successful_rerun(status) else None, 'recomputed': recomputed})
                if passed:
                    def execute_rows(rows, tag):
                        data = scratch/tag; data.mkdir()
                        (data/'pairs.tsv').write_bytes(backtest_cards.table(rows))
                        st = rerunner.rerun(args.attempt, data, 30, scratch/(tag+'-output'))
                        result, _ = rerunner.load_results(scratch/(tag+'-output/results.json'))
                        return result, {'executed': rerunner.successful_rerun(st), 'exit_code': 0 if rerunner.successful_rerun(st) else None, 'recomputed': result}
                    hidden, evidence = execute_rows(key['challenge_rows'], 'challenge')
                    passed = grade(hidden, key['challenge'], execution=evidence)
                    if key.get('leak_columns') and passed:
                        import os
                        changed = backtest_cards.permute_candidates(key['challenge_rows'], key['leak_columns'], Path(os.environ['BIO_SEALING_KEY']).read_bytes(), card['id'])
                        intervened, evidence = execute_rows(changed, 'intervention')
                        passed = evidence['executed'] and backtest_cards.behavioral_audit(hidden, intervened, key['challenge_rows'], key['leak_columns'])['passed']
                print(json.dumps({'passed': passed, 'certified': False})); return 0 if passed else 1
        raise ValueError('unknown command')
    except (ValueError, OSError, KeyError, TypeError):
        print('{"passed":false,"status":"unavailable"}'); return 1
