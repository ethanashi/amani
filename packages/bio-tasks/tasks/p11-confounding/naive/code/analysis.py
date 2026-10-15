"""Pinned numerical recipe: OLS on complete cases, classical t intervals; conditional permutation."""
import csv
import json
from pathlib import Path
import os
os.environ["OPENBLAS_NUM_THREADS"]="1"
os.environ["OMP_NUM_THREADS"]="1"
import numpy as np
from scipy import stats


def fit(y, x, nuisance):
    design = np.column_stack([np.ones(len(y)), x, *nuisance])
    rank = int(np.linalg.matrix_rank(design))
    if rank != design.shape[1]:
        return None, None, None, rank
    beta = np.linalg.lstsq(design, y, rcond=None)[0]
    resid = y - design @ beta
    df = len(y) - rank
    se = float(np.sqrt((resid @ resid / df) * np.linalg.inv(design.T @ design)[1, 1]))
    est = float(beta[1]); critical = stats.t.ppf(.975, df)
    return est, [float(est-critical*se), float(est+critical*se)], float(2*stats.t.sf(abs(est/se), df)), rank


def analyze(task, data, naive=False):
    if task == 'p4-bixbench':
        with (Path(data)/'Swarm_1.csv').open() as f:
            rows = list(csv.DictReader(f))
        groups = sorted({r['Genotype'] for r in rows})
        chosen = max(groups, key=lambda g: np.mean([float(r['Area']) for r in rows if r['Genotype']==g]))
        selected = rows if naive else [r for r in rows if r['Genotype']==chosen]
        est = float(np.mean([float(r['Circularity']) for r in selected]))
        return {'claims': [{'id':'primary','statement':'Mean circularity for the genotype with the largest mean area.',
                            'status':'confirmed','estimate':est,'n_units':len(selected),'unit':'dish'}],
                'selection':{'genotype':chosen,'mean_area':float(np.mean([float(r['Area']) for r in rows if r['Genotype']==chosen]))},
                'extra':{}}
    with (Path(data)/'observations.tsv').open() as f:
        rows = list(csv.DictReader(f, delimiter='\t'))
    y = np.array([float(r['expression']) for r in rows]); x = np.array([float(r['exposure']) for r in rows])
    cohort = np.array([r['cohort'] for r in rows])
    levels = sorted(set(cohort)); nuisance = [(cohort==v).astype(float) for v in levels[1:]]
    covariates = ['cohort'] if nuisance else []
    if task in ('p11-confounding','p12-quality') and not naive:
        name = 'batch' if task=='p11-confounding' else 'quality'
        nuisance += [np.array([float(r[name]) for r in rows])]; covariates += [name]
    est, ci, p, rank = fit(y, x, nuisance)
    null = None
    if task == 'p5-permuted':
        rng = np.random.default_rng(519901)
        z = np.column_stack([np.ones(len(y)), *nuisance]); ry = y-z@np.linalg.lstsq(z,y,rcond=None)[0]
        draws = []
        for _ in range(499):
            xp=x.copy()
            for level in levels:
                mask=cohort==level; xp[mask]=rng.permutation(xp[mask])
            rx=xp-z@np.linalg.lstsq(z,xp,rcond=None)[0]
            draws.append(float(rx@ry/(rx@rx)))
        null={'p_value':float((1+sum(abs(v)>=abs(est) for v in draws))/500),
              'mean':float(np.mean(draws)), 'sd':float(np.std(draws,ddof=1)), 'draws':499,'seed':519901,'coefficients':draws}
    status = 'insufficient-evidence' if est is None or p>=.05 else 'confirmed'
    if naive and task=='p5-permuted':
        status='confirmed'  # over-claims an observed finite-sample contrast
    if naive and task in ('p1-esr1','p2-erbb2','p16-recovery'):
        est=-est; ci=[-ci[1],-ci[0]]  # reversed exposure coding
    return {'claims':[{'id':'primary','statement':'Association between exposure and target expression in this dataset.',
                       'status':status,'estimate':est,'ci':ci,'n_units':len(rows),'unit':'patient'}],
            'analysis':{'estimate':est,'ci95':ci,'p_value':p,'n_units':len(rows),'covariates':covariates,
                        'identifiable':est is not None,'method':'OLS with intercept and stated covariates'},
            'null':null,'extra':{}}


if __name__ == '__main__':
    import sys
    result=analyze(sys.argv[1], Path('data'), '--naive' in sys.argv)
    Path('outputs').mkdir(exist_ok=True)
    for p in (Path('results.json'),Path('outputs/analysis.json')):
        p.write_text(json.dumps(result,sort_keys=True,indent=2)+'\n')
