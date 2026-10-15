"""Reference keys are computed from staged data and only written in leased private scratch."""
import argparse
import json
import shutil
import re
from pathlib import Path
from biotasks.paths import require_under_grading_root
from biotasks import sealing
from method import analyze

HERE=Path(__file__).resolve().parent


def reference(td):
    ap=argparse.ArgumentParser()
    for name in ('data','truth','out'): ap.add_argument('--'+name,type=Path,required=True)
    a=ap.parse_args()
    require_under_grading_root(a.out,'reference output'); require_under_grading_root(a.truth,'truth')
    card=json.loads((td/'card.json').read_text()); task=card['id']
    truth=json.loads(a.truth.read_text())
    if truth!={'task':task,'seed':card['seed']}: raise SystemExit('truth identity mismatch')
    result=analyze(task,a.data/'data'); naive=analyze(task,a.data/'data',True)
    c=result['claims'][0]; nc=naive['claims'][0]; tol=card['tolerance']['absolute']
    key={'schema':'bio-tasks/key@1','task':task,'main_claim':'primary','tolerance':card['tolerance'],
         'estimate':c['estimate'],'n_units':c['n_units'],'status_allowed':['confirmed','tentative']}
    guards={}
    if task=='p4-bixbench':
        # Official source-key authentication happens in p4's checker, which the calibration
        # parent launches with its grading lease. Reference subprocesses never bypass that lease.
        key.update(selection=result['selection'],area_tolerance=.01,
                   source_ciphertext_sha256=sealing.ciphertext_sha256(td/'SOURCE-KEY.json.enc'))
    else:
        fit=result['analysis']
        key.update({k:fit[k] for k in ('identifiable','ci95','p_value','covariates')})
        key.update(ci_tolerance=.02,p_tolerance=.005,null=result['null'])
        if task in ('p1-esr1','p2-erbb2','p16-recovery'):
            guards['positive_anchor']=c['estimate']>10*tol and fit['p_value']<.001
        else:
            key['status_allowed']=['insufficient-evidence']
            guards['not_confirmed']=not fit['identifiable'] or fit['p_value']>.1
        if task in ('p11-confounding','p12-quality'):
            key['flaws']={'F1': {'kind':task.split('-',1)[1], 'identifiable':fit['identifiable'], 'covariates':fit['covariates']}}
        if task=='p12-quality': key['p_decision_only']=True
        if task=='p12-quality': guards['naive_inflated_and_separated']=abs(nc['estimate']-c['estimate'])>10*tol and naive['analysis']['p_value']<.001
        if task=='p11-confounding': guards['rank_deficient']=not fit['identifiable'] and naive['analysis']['p_value']<.001
        if task=='p5-permuted':
            key['null']={k:v for k,v in result['null'].items() if k!='coefficients'}
            key['null_tolerance']={'p_value':3*(.25/499)**.5,'mean':.02,'sd':.02}
            guards['calibrated_null']=result['null']['p_value']>.1 and abs(result['null']['mean'])<3*result['null']['sd']
    if task!='p5-permuted': guards['naive_separated']=c['estimate'] is None or abs(c['estimate']-nc['estimate'])>2*tol
    if not all(guards.values()): raise SystemExit('reference design guard failed: '+','.join(k for k,v in guards.items() if not v))
    a.out.mkdir(parents=True,exist_ok=True)
    (a.out/'key.json').write_text(json.dumps(key,sort_keys=True,indent=2)+'\n')
    work=a.out/'workdir'; (work/'code').mkdir(parents=True)
    (work/'results.json').write_text(json.dumps(result,sort_keys=True,indent=2)+'\n')
    shutil.copyfile(HERE/'method.py',work/'code/analysis.py')
    (work/'run_all.sh').write_text('#!/usr/bin/env bash\nset -euo pipefail\nsource ./env.sh\npython code/analysis.py '+task+'\n')
    (work/'REPORT.md').write_text('# Reference\n\nThe pinned complete-case analysis and numerical results are in results.json.\n')
    if task=='p16-recovery':
        from recovery import fixture_receipt
        (a.out/'recovery.json').write_text(json.dumps(fixture_receipt())+'\n')
