#!/usr/bin/env python3
"""Public-input-only numerical-delta reference for a real sandbox check.

No biotasks imports, host seed, generator, key or reference interval. Deliberately uses
numerical derivatives rather than the host's analytic influence implementation.
Run from a worker directory containing data/pairs.tsv; writes results.json.
"""
import csv
import json
import math
from collections import Counter
from pathlib import Path
import numpy as np


def analyze(path):
    with Path(path).open() as f: rows=list(csv.DictReader(f,delimiter='\t'))
    statuses=('approved','negative','censored','unmatched','conflicting-date','pre-snapshot-approved')
    if any(r['status'] not in statuses for r in rows): return {'available':False}
    counts={s:sum(r['status']==s for r in rows) for s in statuses}
    rows=[r for r in rows if r['status'] in statuses[:3]]
    if not rows: return {'available':False}
    y=np.array([r['status']=='approved' for r in rows],float);x=np.array([float(r['support']) for r in rows])
    groups=np.unique([(r['phase'],r['area']) for r in rows],axis=0,return_inverse=True)[1]
    def log_ratio(w):
        n=np.bincount(groups,weights=w);ex=np.bincount(groups,weights=w*x)
        hits=np.bincount(groups,weights=w*x*y);other=np.bincount(groups,weights=w*(1-x)*y)
        numerator=np.sum(hits*(n-ex)/n);denominator=np.sum(other*ex/n)
        return math.log(numerator/denominator) if numerator>0 and denominator>0 else None
    w=np.ones(len(rows));theta=log_ratio(w)
    if theta is None:return {'available':False}
    eps=1e-5;influence=np.empty(len(rows))
    for i in range(len(rows)):
        w[i]=1+eps;hi=log_ratio(w);w[i]=1-eps;lo=log_ratio(w);w[i]=1
        influence[i]=(hi-lo)/(2*eps)
    variances=[]
    for labels in ([r['target'] for r in rows],[r['indication'] for r in rows],[(r['target'],r['indication']) for r in rows]):
        _,inv=np.unique(labels,axis=0,return_inverse=True)
        sums=np.bincount(inv,weights=influence);m=len(sums)
        if m<2:return {'available':False}
        variances.append(sum(v*v for v in sums)*m/(m-1))
    variance=variances[0]+variances[1]-variances[2]
    if variance<=0:return {'available':False}
    delta=1.959963984540054*math.sqrt(variance)
    return {'available':True,'relative_success':math.exp(theta),'ci':[math.exp(theta-delta),math.exp(theta+delta)],
            'counts':counts,'d1_certified':False,'n_targets':len({r['target'] for r in rows}),
            'n_indications':len({r['indication'] for r in rows}),
            'scores':{r['pair']:float(r['support']) for r in rows},'flags':[]}


if __name__=='__main__':
    Path('results.json').write_text(json.dumps(analyze('data/pairs.tsv'),sort_keys=True))
