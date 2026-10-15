"""KA1 host cards: explicit analyst projection, authenticated sealing and semantic contracts."""
from __future__ import annotations
import copy
import csv
import io
import json
import math
import os
import shutil
import subprocess
from pathlib import Path
from .blinding import canonical, digest, keyed, permutation
from .card import validate_card
from .contracts import evidence, namespace, alias_registry, bridge, producers
from .staging import host_root as strict_host_root
from .policy import FORBIDDEN, forbidden_feature
from .backtest_data import sha
from . import sealing
from .metadata import normalize, verify_metadata, copy_analyst, entries
from ..paths import PKG

def host_root():
    # Package-local ignored research runs are permitted explicitly; production stays external.
    root = Path(os.environ.get('BIO_GRADING_ROOT', '')).resolve()
    local = (PKG/'.ka1-private').resolve()
    key = Path(os.environ.get('BIO_SEALING_KEY', '')).resolve()
    if root.is_relative_to(local) and key.is_relative_to(local) and key.is_file() and len(key.read_bytes()) >= 32:
        return root
    return strict_host_root()


LEAKS = {'outcome_max_phase': 'outcome-date ChEMBL phase', 'l2g': 'outcome-trained gene mapping',
         'clinical_precedence': 'clinical outcomes', 'approved_drug': 'approval-derived tractability',
         'advanced_clinical': 'clinical-stage-derived tractability', 'literature': 'undated literature'}


def reject_features(features, snapshot):
    from datetime import date
    if not isinstance(features, list) or not features:
        return {'passed': False, 'flags': ['features-unavailable']}
    flags = []
    for f in features:
        name = f.get('name', '')
        try:
            valid_date = date.fromisoformat(f['date']) <= date.fromisoformat(snapshot)
        except (KeyError, TypeError, ValueError):
            valid_date = False
        if forbidden_feature(name) or name.lower().replace('-', '_') in LEAKS or f.get('archived') is not True or not __import__('re').fullmatch('[a-f0-9]{64}', f.get('source_hash','')) or f.get('kind') not in ('raw-genetics', 'snapshot-phase') or not valid_date or f.get('outcome_blind') is not True:
            flags.append(name or 'unnamed-feature')
    return {'passed': not flags, 'flags': sorted(set(flags))}


def blind(rows, key, context):
    maps = {}
    for name, kind in [('target', 'gene'), ('drug', 'compound'), ('indication', 'sample')]:
        values = sorted({r[name] for r in rows if r.get(name)})
        maps[name] = permutation(key, context+':'+name, kind, values) if values else {}
    out = [{**r, **{name: m.get(r.get(name), '') for name, m in maps.items()}} for r in rows]
    out.sort(key=lambda r: keyed(key, 'ka1-row-order', context, r['target'], r['drug'], r['indication']))
    return out, maps


def table(rows):
    if not rows:
        raise ValueError('no analyst rows')
    columns = list(rows[0])
    if any(set(r) != set(columns) for r in rows):
        raise ValueError('ragged table')
    out = io.StringIO(); w = csv.DictWriter(out, fieldnames=columns, delimiter='\t', lineterminator='\n')
    w.writeheader(); w.writerows(rows)
    return out.getvalue().encode()


def pair_registries(rows):
    # Missing drug IDs in Nelson are absent, never fabricated canonical identities.
    return [alias_registry(name, values) for name in ('pair', 'target', 'drug', 'indication')
            if (values := {r[name] for r in rows if r.get(name)})]


def contract(rows, raw, answer, *, canary, synthetic, source_hash, public_only=False):
    registries = pair_registries(rows)
    registered = {d['namespace'] for d, _ in registries}
    columns = []
    for name, value in rows[0].items():
        numeric = isinstance(value, (int, float))
        ns = name if name in registered else None
        columns.append({'name': name, 'storage': 'decimal' if numeric else 'string',
                        'structural_kind': 'unit' if ns == 'target' else 'identifier' if ns else 'measurement' if numeric else 'annotation',
                        'namespace': ns, 'decimal_resolution': '0.00000001' if numeric else None,
                        'measurement': {'type': 'continuous', 'unit': 'score', 'bounds': None, 'categories': []} if numeric else None,
                        'missingness_codes': ['']})
    files = [{'path': 'data/pairs.tsv', 'sha256': __import__('hashlib').sha256(raw).hexdigest()}] + [d['file'] for d, _ in registries]
    units = sorted({r['target'] for r in rows})
    structure = {k: [] for k in ('collision_merges', 'joins', 'batch', 'time', 'assignments', 'replicate_groups', 'partitions', 'forbidden_uses', 'survival', 'row_exclusions', 'transformations')}
    structure.update(dataset_id='backtest-pairs', dataset_type='feature-level', source_files=files,
        namespaces=[namespace(d['namespace'], 'unit' if d['namespace'] == 'target' else 'feature',
                              'target' if d['namespace'] == 'target' else None) for d, _ in registries],
        alias_registries=[d for d, _ in registries],
        graph={'nodes': [{'id': v, 'kind': 'dependence-cluster', 'level': 'target', 'namespace': 'target', 'original_id': v} for v in units], 'edges': []},
        unit_hierarchy=[{'id': 'target', 'coarser_level': None, 'minimum_independent': True}],
        aliases=[],
        tables=[{'id': 'pairs', 'file': files[0], 'row_key': ['pair'], 'columns': columns,
                 'unit_derivation': {'kind': 'column-tuple', 'columns': ['target'], 'encoding': 'canonical-json-array', 'namespace': 'target', 'level': 'target'},
                 'orientation': {'layout': 'records', 'unit_axis': 'rows', 'row_entity': 'features', 'header_namespace': None},
                 'alias_coverage': {'rows': 'all', 'matrix_headers': 'all', 'unresolved': 'refuse', 'ambiguous_axis': 'refuse'}}],
        dependence=[{'id': 'crossed', 'kind': 'crossed', 'unit_level': 'target', 'cluster_nodes': units,
                     'description': 'Rows are target-indication or drug-indication pairs; use target + indication - intersection score covariance. No independent-row inference.'}],
        summary_statistics=None, limitations=[
            'Synthetic feature benchmark; not real biological evidence.' if synthetic else 'Previously inspected public development data; not a certification holdout.',
            'Matched nonlaunch at horizon differs from resolved failure. Unmatched rows are never failures.',
            'Source identity and blinded mappings are host-only. No drug identity exists in Nelson target-indication data.'])
    public = {'schema_version': 'omb-data-contract/v3.1', 'structure': structure,
              'producers': producers('KA1 backtest stager', files, author_outcome_blind=False),
              'evidence': evidence(structure, '/structure')}
    if public_only: return public
    private = copy.deepcopy(public)
    private.update(schema_version='omb-data-contract-private/v3.1', public_hash='0'*64,
                   planted_defects=[{'id': 'sealed-key', 'description': canonical({'answer': answer, 'canary': canary}).decode(), 'affected_nodes': [rows[0]['target']]}])
    private['evidence'] += evidence(private['planted_defects'], '/planted_defects')
    return bridge(public, private)


def grade(answer, key, *, execution=None):
    """Host recomputation is required; caller-provided claimed numbers alone never suffice."""
    if not isinstance(answer, dict) or not isinstance(execution, dict) or execution.get('executed') is not True or execution.get('exit_code') != 0:
        return False
    recomputed = execution.get('recomputed')
    if not isinstance(recomputed, dict) or not matches(answer, key) or not matches(recomputed, key):
        return False
    comparison = {**key, 'numeric': {k: {**spec, 'value': recomputed.get(k)} for k,spec in key.get('numeric', {}).items()}, 'ci': recomputed.get('ci')}
    return matches(answer, comparison)


def matches(answer, key):
    if answer.get('available') is not True or not key.get('available'):
        return False
    required = key.get('required', {})
    if not required or not all(answer.get(k) == v for k, v in required.items()):
        return False
    if key.get('numeric'):
        for k, spec in key['numeric'].items():
            value = answer.get(k)
            if type(value) not in (float, int) or not math.isfinite(value) or abs(value-spec['value']) > spec['tolerance']:
                return False
    if key.get('require_ci'):
        ci = answer.get('ci')
        if not isinstance(ci, list) or len(ci) != 2 or any(type(x) not in (int, float) or not math.isfinite(x) for x in ci) or ci[0] > ci[1]:
            return False
        if key.get('ci') is not None and (ci[0] <= 0 or ci[1] <= ci[0] or any(abs(math.log(x/y)) > .15 for x,y in zip(ci,key['ci']))):
            return False
        if key.get('truth') is not None and not ci[0] <= key['truth'] <= ci[1]:
            return False
    return True


def write_analyst(analyst, rows, prompt, *, synthetic):
    # Reconstruct all public fields solely from public observations, before sealer invocation.
    if not rows or any(forbidden_feature(name) for name in rows[0]):
        raise ValueError('forbidden feature in public ranker inputs')
    raw = table(rows)
    public = contract(rows, raw, None, canary=None, synthetic=synthetic,
                      source_hash=digest({'pairs': raw.decode()}), public_only=True)
    public = bridge(public)['public']['content']
    payload = {'publicLayer': public, 'pairs': raw.decode(), 'prompt': prompt,
               'registries': {d['file']['path']: raw.decode() for d, raw in pair_registries(rows)},
               'features': sorted(k for k in rows[0] if k == 'support' or k.startswith('f_')),
               'synthetic': synthetic}
    analyst.parent.mkdir(parents=True, exist_ok=True)
    result = subprocess.run([os.environ.get('BIO_DISCOVERY_NODE', '/opt/homebrew/opt/node@24/bin/node'),
        str(PKG/'discovery/analyst-writer.ts'), str(analyst)], input=canonical(payload),
        capture_output=True, env={'PATH': '/usr/bin:/bin'})
    if result.returncode: raise ValueError('public projection refused')
    normalize(analyst, analyst_files(analyst))
    verify_metadata(analyst, analyst_files(analyst))
    return json.loads((analyst/'DATA-CONTRACT.json').read_bytes())['public']


def candidate_features(rows, key, context):
    """Neutral names and identical metadata for honest and noisy outcome proxies."""
    import numpy as np
    from .blinding import generator_seed
    rng = np.random.default_rng(generator_seed(key, context, 7))
    names = ['f_'+keyed(key, 'candidate-name', context, str(i)).hex()[:12] for i in range(8)]
    leaks = names[:6]
    result = [dict(r) for r in rows]
    for row in result:
        y = row['status'] == 'approved'
        for j,name in enumerate(names):
            # Overlapping distributions, never a label copy. Two honest negative controls.
            row[name] = float(rng.normal((1.2+0.15*j)*y if j<6 else .2*row['support'], 1.))
    order = sorted(names, key=lambda name: keyed(key, "candidate-column-order", context, name))
    result = [{**{k:v for k,v in row.items() if k not in names}, **{name:row[name] for name in order}} for row in result]
    return result, leaks


def keyed_subset(rows, key, context):
    chosen = [dict(r) for r in rows if int.from_bytes(keyed(key, 'challenge-subset', context, r['pair'])[:4], 'big') % 5 != 0]
    if not chosen: raise ValueError('empty challenge')
    return chosen


def permute_candidates(rows, names, key, context):
    import numpy as np
    from .blinding import generator_seed
    rng = np.random.default_rng(generator_seed(key, context, 8))
    result = [dict(r) for r in rows]
    for name in names:
        values = rng.permutation([r[name] for r in rows])
        for row,value in zip(result, values): row[name] = float(value)
    return result


def behavioral_audit(before, after, rows, leak_columns):
    """Measure actual submitted scores under intervention, not declared flags or names."""
    import numpy as np
    from .backtest_stats import auc_eval, auc_plan
    try:
        ids = [r['pair'] for r in rows if r['status'] in ('approved','negative','censored')]
        y = np.array([r['status']=='approved' for r in rows if r['pair'] in set(ids)])
        b = np.array([before['scores'][i] for i in ids], dtype=float)
        a = np.array([after['scores'][i] for i in ids], dtype=float)
        if not len(ids) or not np.isfinite(b).all() or not np.isfinite(a).all(): raise ValueError('scores')
        original, permuted = auc_eval(auc_plan(b,y)), auc_eval(auc_plan(a,y))
        changed = float(np.max(np.abs(b-a)))
        return {'passed': bool(changed <= 1e-10), 'max_score_change': changed,
                'auc_before': original, 'auc_after': permuted, 'auc_drop': original-permuted,
                'intervened_columns': len(leak_columns)}
    except (KeyError, TypeError, ValueError):
        return {'passed': False, 'reason': 'complete finite per-pair scores required'}


def stage(rows, answer_key, *, host, analyst, card_number, source_manifest, criteria_hash, power=None, calibration_report=None, fault_at=lambda p: None):
    root = host_root(); host, analyst = Path(host).resolve(), Path(analyst).resolve()
    keypath = Path(os.environ['BIO_SEALING_KEY']).resolve()
    if not host.is_relative_to(root) or analyst.is_relative_to(root) or root.is_relative_to(analyst) or keypath.is_relative_to(analyst) or host.exists() or analyst.exists():
        raise ValueError('fresh disjoint host and analyst directories required')
    key = keypath.read_bytes(); rows, mappings = blind(rows, key, host.name)
    # Pair IDs depend on blinded entity identities, never outcome, feature values or old order.
    for r in rows:
        r['pair'] = 'U'+keyed(key, 'ka1-pair', host.name, r['target'], r['drug'], r['indication']).hex()[:20]
    from .backtest_cli import reference, key_for, PROMPT
    leak_columns = []
    if card_number == 3: rows, leak_columns = candidate_features(rows, key, host.name)
    challenge = keyed_subset(rows, key, host.name) if card_number in (2,3) else rows
    truth = answer_key.get('truth')
    if answer_key.get('available'):
        answer_key = key_for(reference(rows), truth=truth)
        answer_key['challenge'] = key_for(reference(challenge))
        answer_key['challenge_rows'] = challenge
        answer_key['leak_columns'] = leak_columns
    raw = table(rows); canary = keyed(key, 'ka1-private-canary', host.name).hex()
    prompt = PROMPT
    try:
        public = write_analyst(analyst, rows, prompt, synthetic=card_number == 3)
        manifest_hash = sha(analyst/'manifest.json')
        dc = contract(rows, raw, answer_key, canary=canary, synthetic=card_number == 3,
                      source_hash=digest({'pairs': raw.decode()}))
        if public != dc['public']: raise ValueError('sealer changed public bytes')
        host.mkdir(parents=True, mode=0o700)
        sealing.seal_json({'answerKey': answer_key, 'dataContract': dc, 'canary': canary, 'mappings': mappings,
                           'taskId': host.name}, host/'SEALED-KEY.json.enc')
        fault_at('private-sealed')
        card = {'id': host.name, 'family': 'planted-discovery' if card_number == 3 else 'frozen-backtest',
            'datasetManifestHash': manifest_hash, 'prompt': 'TASK.md', 'sealedAnswerKeyRef': 'SEALED-KEY.json.enc',
            'tolerance': {'absolute': .05, 'relative': 0}, 'plantedFlaws': ['sealed:ka1'], 'negativeControl': False,
            'positiveControl': False, 'heldOut': False, 'seed': 1, 'capMinutes': 60, 'contaminated': card_number != 3,
            'truthClass': 'planted' if card_number == 3 else 'frozen-backtest', 'recallExposure': 'none' if card_number == 3 else 'high',
            'rungTarget': '4', 'gateTargets': ['D1'], 'stratum': 'development',
            'powerAtTruth': power if card_number == 3 else None, 'twinOf': None, 'synthetic': card_number == 3}
        validate_card(card)
        (host/'card.json').write_bytes(canonical(card)); (host/'TASK.md').write_text(prompt)
        (host/'DATA-CONTRACT.json').write_bytes(canonical({'public': dc['public']}))
        (host/'sources.json').write_bytes(canonical(source_manifest))
        (host/'bindings.json').write_bytes(canonical({'criteria_sha256': criteria_hash, 'manifest_hash': card['datasetManifestHash'],
                                                    'taskId': host.name, 'cardHash': digest(card), 'publicContractHash': dc['public']['hash'],
                                                    'privateContractHash': dc['sealed_private']['hash'], 'ciphertextHash': sha(host/'SEALED-KEY.json.enc'),
                                                    'sources_sha256': digest(source_manifest), 'code_sha256': sha(__file__), 'implementation': implementation_bindings()}))
        copy_analyst(analyst, host/'inputs', analyst_files(analyst))
        (host/'naive').mkdir()
        for command in ('stage', 'reference', 'check'):
            (host/(command+'.py')).write_text('import sys\nfrom pathlib import Path\nsys.path.insert(0, '+repr(str(PKG/'lib'))+')\nfrom biotasks.discovery.backtest_cli import dispatch\nraise SystemExit(dispatch('+repr(command)+',Path(__file__).parent,sys.argv[1:]))\n')
        for name in ('recall-only', 'crude', 'unmatched-as-failure', 'all-columns', 'phase4-is-approval', 'always-abstain'):
            (host/'naive'/(name+'.py')).write_text('import sys\nfrom pathlib import Path\nsys.path.insert(0, '+repr(str(PKG/'lib'))+')\nfrom biotasks.discovery.backtest_cli import dispatch\nraise SystemExit(dispatch('+repr(name)+',Path(__file__).parent.parent,sys.argv[1:]))\n')
        from .backtest_cli import reference
        controls = {}
        applicable = ('reference', 'recall-only', 'crude', 'unmatched-as-failure', 'all-columns', 'always-abstain') + (('phase4-is-approval',) if card_number == 4 else ())
        for arm in applicable:
            result = reference(rows, arm=arm)
            controls[arm] = grade(result, answer_key, execution={'executed': True, 'exit_code': 0, 'recomputed': result})
        controls['empty'] = grade({}, answer_key, execution=None)
        if leak_columns:
            changed = permute_candidates(rows, leak_columns, key, host.name)
            honest_audit = behavioral_audit(reference(rows), reference(changed), rows, leak_columns)
            leaky_audit = behavioral_audit(reference(rows,arm='all-columns'), reference(changed,arm='all-columns'), rows, leak_columns)
        else:
            honest_audit = leaky_audit = None
        calibrated = bool(calibration_report and calibration_report.get('valid') is True)
        (host/'calibration.json').write_bytes(canonical({'outcomes': controls,
            'valid': controls['reference'] and not any(v for k,v in controls.items() if k!='reference') and calibrated,
            'report':calibration_report, 'reportHash':digest(calibration_report),
            'taskId':host.name,'cardHash':digest(card),'manifestHash':card['datasetManifestHash'],
            'ciphertextHash':sha(host/'SEALED-KEY.json.enc'),
            'behavioral_audit':honest_audit,'leaky_positive_control':leaky_audit,
            'independent_key_agreement':False,'certified':False}))
        fault_at('public-staged')
        verify_stage(analyst, card['datasetManifestHash'])
        return card
    except BaseException:
        shutil.rmtree(host, ignore_errors=True); shutil.rmtree(analyst, ignore_errors=True)
        raise


def analyst_files(path):
    base = {'TASK.md','DATA-CONTRACT.json','FEATURES.json','manifest.json','data/pairs.tsv',
            'data/pair-aliases.tsv','data/target-aliases.tsv','data/indication-aliases.tsv'}
    if os.path.lexists(Path(path)/'data/drug-aliases.tsv'):
        base.add('data/drug-aliases.tsv')
    return frozenset(base)


def verify_stage(path, expected):
    from .backtest_cli import read_rows, PROMPT
    path = Path(path)
    files = analyst_files(path)
    verify_metadata(path, files)  # lstat every allowed entry before opening any bytes.
    if sha(path/'manifest.json') != expected:
        raise ValueError('staged manifest changed')
    m = json.loads((path/'manifest.json').read_bytes())
    if set(m) != {'synthetic','files','publicContractHash'} or type(m['synthetic']) is not bool:
        raise ValueError('manifest protocol')
    actual = {name:sha(path/name) for name in files if name != 'manifest.json'}
    if actual != m['files']:
        raise ValueError('staged content changed, missing or extra')
    rows = read_rows(path/'data/pairs.tsv'); raw = table(rows)
    content = contract(rows,raw,None,canary=None,synthetic=m['synthetic'],source_hash=None,public_only=True)
    public = {'content':content,'hash':digest(content)}
    payloads = {'data/pairs.tsv':raw,'TASK.md':PROMPT.encode(),
                'DATA-CONTRACT.json':canonical({'public':public})+b'\n',
                'FEATURES.json':canonical([{'name':k,'storage':'numeric','provenance':'unverified candidate; audit use empirically'}
                                          for k in sorted(rows[0]) if k == 'support' or k.startswith('f_')])+b'\n',
                **{d['file']['path']:raw for d,raw in pair_registries(rows)}}
    if (set(payloads) != files-{'manifest.json'} or m['publicContractHash'] != public['hash'] or
        any((path/name).read_bytes() != raw for name,raw in payloads.items()) or
        (path/'manifest.json').read_bytes() != canonical(m)+b'\n'):
        raise ValueError('public byte parity refused')
    return m


def implementation_bindings():
    files = sorted(Path(__file__).parent.glob('*.py')) + [PKG/'discovery/backtest-analyst-writer.ts', PKG/'discovery/analyst-writer.ts', PKG/'discovery/public-json.ts'] + [PKG/'discovery/contract-bridge.ts', PKG/'lib/biotasks/sealing.py']
    return {str(p.resolve()): sha(p) for p in files}


def validate_private(private, bindings, card):
    if (private.get('taskId') != card['id'] or private['dataContract']['public']['hash'] != bindings['publicContractHash'] or
        private['dataContract']['sealed_private']['hash'] != bindings['privateContractHash']):
        raise ValueError('private key/card binding refused')


def validate_bindings(host, card):
    bindings = json.loads((host/'bindings.json').read_bytes())
    if (bindings.get('taskId') != card['id'] or bindings.get('cardHash') != digest(card) or
        bindings.get('manifest_hash') != card['datasetManifestHash'] or
        bindings.get('ciphertextHash') != sha(host/'SEALED-KEY.json.enc')):
        raise ValueError('card/key binding refused')
    public = json.loads((host/'inputs/DATA-CONTRACT.json').read_bytes())['public']
    if public['hash'] != bindings['publicContractHash']: raise ValueError('public contract binding refused')
    return bindings


def validate_calibration(host, card):
    from .tier_a import cp
    report=json.loads((host/'calibration.json').read_bytes())
    if (report.get('valid') is not True or report.get('taskId') != card['id'] or
        report.get('cardHash') != digest(card) or report.get('manifestHash') != card['datasetManifestHash'] or
        report.get('ciphertextHash') != sha(host/'SEALED-KEY.json.enc') or
        report.get('reportHash') != digest(report.get('report'))):
        raise ValueError('calibration binding refused')
    groups=report['report']['groups']
    if len(groups)<3 or len({g['key_index'] for g in groups}) != len(groups): raise ValueError('independent keyed streams required')
    for g in groups:
        n=g['n'];ref=g['reference_count'];naive=g['crude_count']
        if (type(n) is not int or n<100 or type(ref) is not int or type(naive) is not int or
            not 0<=ref<=n or not 0<=naive<=n or cp(ref,n)[0]<.8 or cp(naive,n)[1]>.2):
            raise ValueError('CI calibration refused')
    controls=report['outcomes']
    if controls.get('reference') is not True or not controls or any(v is not False for k,v in controls.items() if k!='reference'):
        raise ValueError('naive control passed or unavailable calibration')
    return report
