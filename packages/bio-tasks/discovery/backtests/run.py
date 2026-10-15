#!/usr/bin/env python3
"""One host command for BT1–BT4. Public data acquisition is explicit; tests never fetch.

No D1 certification can be emitted by this development build. See README for invocation.
"""
from __future__ import annotations
import argparse
import json
import os
import sys
import time
from pathlib import Path
sys.dont_write_bytecode = True
PKG = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PKG/'lib'))
from biotasks.discovery import backtest_cards as cards, backtest_stats as stats
from biotasks.discovery.backtest_data import CACHE, sha, verify_sources, download_minikel, fetch, floor
from biotasks.discovery.backtest_forward import load_forward, score_forward
from biotasks.discovery.backtest_freeze import freeze, verify
from biotasks.discovery.backtest_minikel import execute, verify_receipt
from biotasks.discovery.backtest_open import load_ot, fetch_mesh_subset, mapping, mesh_window, genetics19
from biotasks.discovery.backtest_cli import reference, key_for
from biotasks.discovery.blinding import canonical, generator_seed, digest
import numpy as np


def run(args):
    if args.fetch:
        from prepare import prepare
        prepare(args.as_of)
    from biotasks.discovery.backtest_lock import verify_locked
    verify_locked(CACHE, Path(__file__).resolve().parent/'sources.lock.json')
    root = args.out.resolve()
    if not root.is_relative_to((PKG/'.ka1-private').resolve()):
        raise ValueError('run output must be under the ignored package .ka1-private directory')
    if root.exists():
        raise ValueError('fresh dedicated run directory required; previous look is spent')
    root.mkdir(parents=True, mode=0o700); floor(root)
    # A dedicated key and grading lease, never the pilot/default key or lease.
    keyfile = root/'host.key'; keyfile.write_bytes(args.seed_key.read_bytes() if args.seed_key else os.urandom(48)); keyfile.chmod(0o600)
    os.environ['BIO_SEALING_KEY'] = str(keyfile)
    os.environ['BIO_GRADING_ROOT'] = str(root/'grading')
    os.environ['TMPDIR'] = str(root/'grading/tmp'); (root/'grading/tmp').mkdir(parents=True)
    key = keyfile.read_bytes()
    source = CACHE/'dm-bt1-minikel-repro'; matrix = CACHE/'dm-bt2-forward-2013/nelson_similarity.tsv'
    ot = CACHE/'dm-bt4-open-chembl-2019'
    subset_manifest = json.loads((ot/'mesh-subset-sources.json').read_bytes())
    subset = []
    for item in subset_manifest['files']:
        if sha(ot/item['path']) != item['sha256']:
            raise ValueError('subset source changed')
        for r in json.loads((ot/item['path']).read_bytes())['drug_indications']:
            subset.append({'drug':r['molecule_chembl_id'],'mesh':r.get('mesh_id'),'efo':r.get('efo_id')})
    subset_sources = subset_manifest['files']
    source_manifest = verify_sources(source); matrix_manifest = verify_sources(matrix.parent); ot_manifest = verify_sources(ot)
    here = Path(__file__).resolve().parent; criteria = here/'criteria-v5.json'
    pin = criteria.with_suffix('.json.sha256').read_text().split()[0]
    files = sorted((PKG/'lib/biotasks/discovery').glob('*.py')) + [PKG/'discovery/backtest-policy.ts', PKG/'discovery/contract-bridge.ts', here/'sources.lock.json']+[Path(__file__), source/'sources.json', matrix.parent/'sources.json', ot/'sources.json', ot/'mesh-subset-sources.json', here/'runtime/pixi.lock']
    from biotasks.discovery.backtest_twin import prepare_twin
    if args.bt1_execution:
        if args.bt1_twin_source is None: raise ValueError('attached BT1 receipt requires its keyed source')
        twin_source = args.bt1_twin_source.resolve()
        twin_manifest = verify_sources(twin_source)
    else:
        twin_source = root/'bt1-twin-source'
        twin_manifest = prepare_twin(source,twin_source,key)
    files += [twin_source/i['path'] for i in twin_manifest['files']] + [twin_source/'sources.json']
    if args.bt1_execution:
        files += [args.bt1_execution/name for name in ('PRECOMMIT.json','receipt.json','execution.log','reexecuted-table_s22.tsv')]
    plan = freeze(criteria, pin, files, root, now=lambda: args.as_of)
    spec = plan['criteria']; result = {'criteria_sha256': pin, 'd1_certified': False, 'output': 'unranked evidence cards'}
    def progress(message):
        print(message, flush=True)
    if args.bt1_execution:
        previous = json.loads((args.bt1_execution/'PRECOMMIT.json').read_bytes())
        result['BT1'] = verify_receipt(args.bt1_execution,key,previous,twin_source,here/'runtime')
        result['BT1_attachment'] = {'precommit':digest(previous),'bound_into_current_freeze':True}
    elif not args.defer_bt1:
        progress('BT1: fresh keyed-twin R re-execution')
        result['BT1'] = execute(twin_source, here/'runtime', out=root/'bt1-execution', now=time.monotonic, precommit=plan, auth_key=key, derive_twin=True)
    else:
        result['BT1'] = {'passed': False, 'executed': False, 'reason': 'explicitly deferred; attach separately pinned execution receipt'}
    progress('BT2: join original Nelson and modern roll-up development variants')
    rows, metadata = load_forward(source, matrix)
    seed = generator_seed(key, 'BT2', 1)
    bt2 = score_forward(rows, seed=seed, n=spec['bt2']['bootstrap'], permutations=spec['bt2']['permutations'])
    result['BT2'] = {**metadata, **bt2}
    result['BT2']['jackknife_cgm_sensitivity'] = stats.jackknife_cgm(stats.arrays([r for r in rows if r['status'] in ('approved','negative','censored')]))
    public_rows = [{k: r[k] for k in ('target', 'drug', 'indication', 'phase', 'area', 'status', 'support')} for r in rows]
    ref2 = reference(public_rows)
    from biotasks.discovery.backtest_validation import coverage_study, variance_validation
    matched = [r for r in public_rows if r['status'] in ('approved','negative','censored')]
    progress('Validate two-way SE and three-key planted coverage')
    validation = variance_validation(matched, seed=generator_seed(key,'variance-validation',1), replicates=2000)
    coverage = coverage_study(matched,key=key,replicates=200,keys=3)
    result['variance_validation'] = validation; result['coverage_validation'] = coverage
    sources2 = {'files': source_manifest['files']+matrix_manifest['files']}
    cards.stage(public_rows, key_for(ref2), host=root/'grading/dm-bt2-forward-2013', analyst=root/'analyst/bt2', card_number=2, source_manifest=sources2, criteria_hash=pin, calibration_report=coverage)
    progress('BT3: HMAC-seeded sparse feature and paired gain power curve')
    matched = [r for r in public_rows if r['status'] in ('approved', 'negative', 'censored')]
    a = stats.arrays(matched); seed3 = generator_seed(key, 'BT3', 1); rng = np.random.default_rng(seed3)
    planted = stats.planted_feature(a, rng)
    estimate = stats.bootstrap(a, rng, spec['bt2']['bootstrap'], exposure=planted)['relative_success']
    plant_rows = []; index = 0
    for r in public_rows:
        support = int(planted[index]) if r['status'] in ('approved', 'negative', 'censored') else 0
        if r['status'] in ('approved', 'negative', 'censored'):
            index += 1
        p = dict(r, support=support)
        plant_rows.append(p)
    # Offered OT column names are modeled synthetic columns, not illicit real outcome-trained inputs.
    study = stats.power_study(matched, seed=generator_seed(key, 'BT3-power', 1),
                             gains=(0., *spec['bt3']['gain_curve']), replicates=spec['bt3']['power_replicates'], resamples=spec['bt3']['bootstrap'])
    result['BT3'] = {'relative_success': estimate, 'planted_fraction_realized': float(planted.mean()),
                    'covered_truth': bool(estimate['available'] and estimate['ci'][0] <= 2 <= estimate['ci'][1]),
                    'power': study, 'real_ot_values_offered': False, 'true_finite_stratum_estimand':2.}
    ref3 = reference(plant_rows)
    cards.stage(plant_rows, key_for(ref3, truth=2.), host=root/'grading/dm-bt3-planted-time-travel', analyst=root/'analyst/bt3', card_number=3,
                source_manifest=sources2, criteria_hash=pin, calibration_report=coverage, power=next(r['power'] for r in study['curve'] if r['expected_gain'] == .02))
    progress('BT4: archived Open Targets evidence and verified small ChEMBL mapping subset')
    before = load_ot(ot/'chembl-29-01-2019.json.gz', 2019); after = load_ot(ot/'chembl-24.09.json.gz', 2024)
    mp = mapping(subset)
    # Current REST mappings fail the historical release gate. Count unavailable, never join.
    window = [{'target':'unavailable','drug':'unavailable','indication':'unavailable','phase':0,'area':'unknown','status':'unmatched','support':''}]
    counts = {'snapshot_pairs':len(before),'joined':0,'mapping_unavailable':True}
    try:
        mesh_window(before,after,mp,mp,before_release='2026-10-11',after_release='2026-10-11')
        raise AssertionError('future mapping accepted')
    except ValueError:
        pass
    genetics, gc = genetics19([ot/name for name in ('gwas-28-01-2019.json.gz', 'eva-29-01-2019.json.gz', 'gene2phenotype-30-01-2019.json.gz', 'genomics_england-02-10-2018.json.gz')])
    for r in window:
        r['support'] = ''  # Uniprot/Ensembl mapping unavailable: never invent a zero genetics value.
    result['BT4'] = {'available': False, 'accounting': counts, 'subset_mapping_rows': len(subset), 'subset_drugs': len({r['drug'] for r in subset}),
                     'archived_genetic_evidence_rows': gc, 'genetic_pairs': len(genetics),
                     'snapshot_phase4_pairs': sum(r['phase'] == 4 for r in before.values()),
                     'phase4_ctgov_only': sum(r['phase'] == 4 and bool(r['urls']) and all('clinicaltrials' in u.lower() for u in r['urls']) for r in before.values()),
                     'gaps': ['REST MeSH mapping is current, not historical', 'No dated indication approval event file supplied',
                              'Genetics target-ID crosswalk unavailable', 'Arm C not run; April 2022 genetics cannot establish 2021 as-of evidence'],
                     'source_bytes': sum(r['bytes'] for r in ot_manifest['files']+subset_sources)}
    if window:
        cards.stage(window, {'available': False, 'required': {}, 'reason': 'dated labels and as-of mapping unavailable'},
                    host=root/'grading/dm-bt4-open-chembl-2019', analyst=root/'analyst/bt4', card_number=4,
                    source_manifest={'files': ot_manifest['files']+subset_sources}, criteria_hash=pin)
    from biotasks.discovery.backtest_reproduction import stage_reproduction
    reproduction = stage_reproduction(twin_source, here/'runtime', result['BT1'], host=root/'grading/dm-bt1-minikel-repro',
                                      analyst=root/'analyst/bt1', manifest=twin_manifest, criteria_hash=pin)
    result['BT1']['naive_python'] = reproduction['naive_estimates']
    verify(plan, criteria)
    result['calibration'] = {f'BT{i}': json.loads((root/'grading'/name/'calibration.json').read_bytes()) for i, name in [(1,'dm-bt1-minikel-repro'),(2,'dm-bt2-forward-2013'),(3,'dm-bt3-planted-time-travel'),(4,'dm-bt4-open-chembl-2019')]}
    result['source_bytes'] = sum(r['bytes'] for r in source_manifest['files']+matrix_manifest['files']+ot_manifest['files']+subset_sources)
    # Private full precision result stays outside the worktree. Public report is rounded aggregates.
    (root/'results.json').write_bytes(canonical(result)+b'\n')
    progress('Finished; full results retained in dedicated private run root. D1 remains unverified.')
    return result


if __name__ == '__main__':
    p = argparse.ArgumentParser(); p.add_argument('--out', type=Path, required=True); p.add_argument('--as-of', required=True); p.add_argument('--fetch', action='store_true')
    p.add_argument('--seed-key', type=Path, help='reuse the same private seed after a pipeline repair, never select seeds by outcome')
    p.add_argument('--bt1-execution', type=Path, help='reuse a separately frozen, hash-verified fresh R execution')
    p.add_argument('--bt1-twin-source', type=Path, help='keyed source bundle bound by the attached receipt')
    p.add_argument('--defer-bt1', action='store_true', help='explicitly report BT1 unavailable in this run')
    args = p.parse_args()
    run(args)
