"""Only answer-free data leave this author-only source tree."""
import csv
import hashlib
import json
from pathlib import Path
import os
os.environ["OPENBLAS_NUM_THREADS"]="1"
os.environ["OMP_NUM_THREADS"]="1"
import numpy as np
from biotasks import staging

HERE=Path(__file__).resolve().parent


def stage(task_dir, args):
    card=json.loads((task_dir/'card.json').read_text()); task=card['id']
    truth=staging.guard_truth(args.truth_out,args.out)
    data=staging.prepare_out(args.out)
    if task=='p4-bixbench':
        source=task_dir/'Swarm_1.csv'
        pin=json.loads((task_dir/'provenance.json').read_text())['sha256']
        if staging.sha256_file(source)!=pin: raise SystemExit('source checksum mismatch')
        (data/source.name).write_bytes(source.read_bytes())
    else:
        pin=json.loads((HERE/'provenance.json').read_text())['projection_sha256']
        if staging.sha256_file(HERE/'source-data.tsv')!=pin: raise SystemExit('source checksum mismatch')
        with (HERE/'source-data.tsv').open() as f:
            rows=list(csv.DictReader(f,delimiter='\t'))
        field='her2_snp6' if task=='p2-erbb2' else 'er_status'
        positive,negative=('GAIN','NEUTRAL') if task=='p2-erbb2' else ('Positive','Negative')
        rows=[r for r in rows if r[field] in (positive,negative) and r['cohort'] in ('1','2')]
        if task=='p16-recovery': rows=rows[::2]  # independent seeded-task target subset
        if task in ('p11-confounding','p12-quality'):
            # Disjoint deterministic halves keyed by sample, so holding one stage reveals nothing
            # about the other's records (no cross-task oracle between the two planted designs).
            half=0 if task=='p11-confounding' else 1
            rows=[r for r in rows if hashlib.sha256(('p11-p12-split:'+r['sample_id']).encode()).digest()[0]&1==half]
        if not rows: raise SystemExit('empty source projection')
        gene='ERBB2' if task=='p2-erbb2' else 'ACTB' if task in ('p11-confounding','p12-quality') else 'ESR1'
        x=np.array([int(r[field]==positive) for r in rows]); y=np.array([float(r[gene]) for r in rows])
        cohort=np.array([r['cohort'] for r in rows]); rng=np.random.default_rng(card['seed'])
        extra=[]; names=[]
        if task=='p5-permuted':
            for level in sorted(set(cohort)):
                mask=cohort==level; x[mask]=rng.permutation(x[mask])
        if task in ('p11-confounding','p12-quality'):
            # Unbalanced allocation from a plausible process: cohort-specific exposure prevalence.
            prevalence={c:rng.uniform(.27,.43) for c in ('1','2')}
            x=(rng.random(len(rows))<np.array([prevalence[c] for c in cohort])).astype(int)
            if task=='p11-confounding':
                # Every exposed tumor was processed in batch 2: continuous non-round batch shift,
                # independent assay noise, source-scale rounding (no exact integer cancellation).
                shift=rng.uniform(.55,.95)
                y=np.round(y+shift*x+rng.normal(0,.03,len(rows)),4)
                extra=[[str(1+int(v))] for v in x]; names=['batch']
            else:
                # RNA-integrity-like score: bounded 1-10, left-skewed, exposure-dependent handling,
                # recorded at instrument precision (0.1). Expression responds to the true score.
                scale=np.where(x==1,rng.uniform(1.15,1.35),rng.uniform(.55,.7))
                quality=np.clip(10-rng.gamma(2.,scale),1.,10.)
                slope=rng.uniform(.42,.6)
                y=np.round(y+slope*(quality-8)+rng.normal(0,.03,len(rows)),4)
                extra=[[f'{v:.1f}'] for v in np.round(quality,1)]; names=['quality']
        staging.write_tsv(data/'observations.tsv',['sample_id','cohort','exposure','expression',*names],
            ([r['sample_id'],r['cohort'],str(int(x[i])),f'{y[i]:.4f}',*(extra[i] if extra else [])] for i,r in enumerate(rows)))
    staging.write_truth(truth,{'task':task,'seed':card['seed']})
    staging.finalize(args.out,task_dir,task,card['seed'])
