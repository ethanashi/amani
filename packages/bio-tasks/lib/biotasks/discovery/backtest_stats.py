"""Frozen estimators. Pair-weighted stratified AUC; CGM-calibrated two-way Gaussian multiplier bootstrap.

All random streams are caller supplied. Missing strata/zero denominators stay unavailable.
The all-snapshot estimand is launch by horizon (censored rows are nonlaunches), NOT failure risk.
"""
from __future__ import annotations
import numpy as np
from scipy.special import ndtr, ndtri


def arrays(rows):
    if not rows or any(r['status'] not in ('approved', 'negative', 'censored') for r in rows):
        raise ValueError('nonempty matched cohort required')
    out = {k: np.asarray([r[k] for r in rows]) for k in ('target', 'indication', 'phase', 'area', 'support')}
    out['y'] = np.asarray([r['status'] == 'approved' for r in rows], dtype=float)
    out['_clusters'] = [np.unique(out[k], return_inverse=True) for k in ('target', 'indication')]
    out['stratum'] = np.unique([f"{r['phase']}:{r['area']}" for r in rows], return_inverse=True)[1]
    return out


def mh(a, exposure=None, weights=None):
    y = a['y']; x = a['support'] if exposure is None else np.asarray(exposure)
    if len(x) != len(y) or not np.isin(x, [0, 1]).all():
        raise ValueError('binary exposure required')
    w = np.ones(len(y)) if weights is None else weights
    g = a['stratum']; n = np.bincount(g, weights=w)
    n1 = np.bincount(g, weights=w*x, minlength=len(n)); n0 = n-n1
    s1 = np.bincount(g, weights=w*x*y, minlength=len(n))
    s0 = np.bincount(g, weights=w*(1-x)*y, minlength=len(n))
    keep = n > 0
    num = np.sum(s1[keep]*n0[keep]/n[keep]); den = np.sum(s0[keep]*n1[keep]/n[keep])
    return float(num/den) if den > 0 else None


def auc_plan(score, y, strata=None):
    score, y = np.asarray(score, dtype=float), np.asarray(y, dtype=float)
    if len(score) != len(y) or not np.isfinite(score).all() or not np.isin(y, [0, 1]).all():
        raise ValueError('finite scores and binary outcomes required')
    groups = np.zeros(len(y)) if strata is None else np.asarray(strata)
    plans = []
    for group in np.unique(groups):
        idx = np.flatnonzero(groups == group)
        idx = idx[np.argsort(score[idx], kind='stable')]
        _, bins = np.unique(score[idx], return_inverse=True)
        plans.append((idx, bins))
    return y, plans


def auc_eval(plan, weights=None):
    y, plans = plan
    w = np.ones(len(y)) if weights is None else weights
    numerator = denominator = 0.
    for idx, bins in plans:
        pos = np.bincount(bins, weights=w[idx]*y[idx])
        neg = np.bincount(bins, weights=w[idx]*(1-y[idx]), minlength=len(pos))
        numerator += np.sum(pos*(np.cumsum(neg)-.5*neg))
        denominator += pos.sum()*neg.sum()
    return float(numerator/denominator) if denominator > 0 else None


def cluster_variance(a, influence):
    """CGM inclusion–exclusion: target + indication - target×indication intersection.

    Influence values are derivatives with respect to row multiplicities (already /N).
    No positive-variance fallback: nonpositive estimates are unavailable.
    Reference: Cameron, Gelbach & Miller (2011), doi:10.1198/jbes.2010.07136.
    """
    u = np.asarray(influence, dtype=float)
    groups = [c[1] for c in a['_clusters']]
    groups.append(np.unique(np.column_stack(groups), axis=0, return_inverse=True)[1])
    components = []
    for g in groups:
        sums = np.bincount(g, weights=u)
        m = len(sums)
        if m < 2: return None, None
        components.append(float(sums@sums)*m/(m-1))
    variance = components[0]+components[1]-components[2]
    return (variance if np.isfinite(variance) and variance > 0 else None), components


def mh_influence(a, exposure=None):
    y = a['y']; x = a['support'] if exposure is None else np.asarray(exposure)
    g = a['stratum']; n = np.bincount(g); n1 = np.bincount(g, weights=x); n0 = n-n1
    s1 = np.bincount(g, weights=x*y); s0 = np.bincount(g, weights=(1-x)*y)
    num = np.sum(s1*n0/n); den = np.sum(s0*n1/n)
    if num <= 0 or den <= 0: return None
    dn = x*y*n0[g]/n[g]+s1[g]*(1-x)/n[g]-s1[g]*n0[g]/n[g]**2
    dd = (1-x)*y*n1[g]/n[g]+s0[g]*x/n[g]-s0[g]*n1[g]/n[g]**2
    return dn/num-dd/den


def auc_influence(plan):
    y, plans = plan; dn = np.zeros(len(y)); dd = np.zeros(len(y)); numerator = denominator = 0.
    for idx, bins in plans:
        pos = np.bincount(bins, weights=y[idx]); neg = np.bincount(bins, weights=1-y[idx])
        below = np.cumsum(neg)-.5*neg; above = pos.sum()-np.cumsum(pos)+.5*pos
        dn[idx] = y[idx]*below[bins]+(1-y[idx])*above[bins]
        dd[idx] = y[idx]*neg.sum()+(1-y[idx])*pos.sum()
        numerator += np.sum(pos*below); denominator += pos.sum()*neg.sum()
    if denominator <= 0: return None
    return (dn-(numerator/denominator)*dd)/denominator


def jackknife_cgm(a):
    """Delete-cluster CGM sensitivity; unavailable if any deletion is unidentified.

    Finite-cluster jackknife centering is applied to each of target, indication and
    their intersection, then the intersection contribution is subtracted once.
    This is a sensitivity, not an asserted finite-sample coverage guarantee.
    """
    estimate=mh(a)
    if estimate is None or estimate<=0: return {'available':False}
    target=np.asarray(a['target']); indication=np.asarray(a['indication'])
    _,intersection=np.unique(np.column_stack((target,indication)),axis=0,return_inverse=True)
    parts=[]
    for cluster in (target,indication,intersection):
        levels=np.unique(cluster)
        if len(levels)<2:return {'available':False}
        deleted=[]
        for level in levels:
            value=mh(a,weights=(cluster!=level).astype(float))
            if value is None or not np.isfinite(value) or value<=0:return {'available':False}
            deleted.append(np.log(value))
        values=np.asarray(deleted)
        parts.append(float((len(values)-1)/len(values)*np.sum((values-values.mean())**2)))
    variance=parts[0]+parts[1]-parts[2]
    if not np.isfinite(variance) or variance<=0:return {'available':False}
    se=float(np.sqrt(variance))
    return {'available':True,'estimate':estimate,'se':se,'variance_components':parts,
            'ci':np.exp(np.log(estimate)+np.array([-1,1])*ndtri(.975)*se).tolist(),
            'method':'delete-cluster-jackknife-CGM-sensitivity'}


def multiplier_interval(a, influence, estimate, rng, n, *, log=False):
    """Scalar Gaussian score bootstrap with exact CGM covariance calibration.

    Gaussian multiplier draws have known quantiles: use those rather than Monte Carlo
    endpoint noise. Draws are retained through bootstrap_se to validate the sampler.
    This is first-order inference, not a finite-sample exact confidence interval.
    """
    variance, components = cluster_variance(a, influence) if influence is not None else (None, None)
    if variance is None or estimate is None or (log and estimate <= 0):
        return {'estimate': estimate, 'ci': None, 'available': False, 'valid': 0, 'attempted': n,
                'reason': 'unidentified or nonpositive two-way variance'}
    se = np.sqrt(variance); draws = rng.normal(0, se, n)
    center = np.log(estimate) if log else estimate
    ci = center + np.array([-1, 1])*ndtri(.975)*se
    return {'estimate': estimate, 'ci': (np.exp(ci) if log else ci).tolist(), 'available': True,
            'valid': n, 'attempted': n, 'se': float(se), 'bootstrap_se': float(np.std(draws, ddof=1)),
            'variance_components': components, 'method': 'CGM-two-way-Gaussian-score-bootstrap',
            'scale': 'log' if log else 'identity'}


def interval(values):
    finite = [v for v in values if v is not None and np.isfinite(v)]
    return {'ci': np.quantile(finite, [.025, .975]).tolist() if finite else None,
            'valid': len(finite), 'attempted': len(values),
            'available': bool(finite) and len(finite) >= .95*len(values)}


def bootstrap(a, rng, n=1000, *, exposure=None, ranker=None):
    if type(n) is not int or n < 2:
        raise ValueError('at least two bootstrap replicates required')
    out = {'relative_success': multiplier_interval(a, mh_influence(a, exposure), mh(a, exposure), rng, n, log=True)}
    if ranker is not None:
        out['gain'] = gain_bootstrap(a, rng, n, ranker)
    return out


def probabilities(a):
    """Target-disjoint five folds, phase-specific training rates with fixed Laplace smoothing.

    This is descriptive cross-validation, not a frozen external calibration model.
    """
    levels, inv = np.unique(a['target'], return_inverse=True)
    folds = inv % 5
    p = np.zeros(len(inv))
    for fold in range(5):
        for ph in np.unique(a['phase']):
            train = (folds != fold) & (a['phase'] == ph)
            p[(folds == fold) & (a['phase'] == ph)] = (a['y'][train].sum()+1)/(train.sum()+2)
    return {'brier': float(np.mean((p-a['y'])**2)),
            'log_score': float(-np.mean(a['y']*np.log(p)+(1-a['y'])*np.log1p(-p))),
            'kind': 'descriptive-target-held-out-phase-baseline'}


def summarize(rows, *, seed, n=1000, permutations=300):
    a = arrays(rows); rng = np.random.default_rng(seed)
    out = bootstrap(a, rng, n)
    out.update(pairs=len(rows), targets=len(set(a['target'])), indications=len(set(a['indication'])),
               launches=int(a['y'].sum()), supported=int(a['support'].sum()),
               auc_genetics=auc_eval(auc_plan(a['support'], a['y'])),
               auc_phase=auc_eval(auc_plan(a['phase'], a['y'])),
               auc_phase_genetics=auc_eval(auc_plan(2*a['phase']+a['support'], a['y'])),
               within_phase_auc=auc_eval(auc_plan(a['support'], a['y'], a['phase'])),
               phase_baseline=probabilities(a))
    null = []
    for _ in range(permutations):
        b = dict(a); b['y'] = a['y'].copy()
        for s in np.unique(a['stratum']):
            idx = np.flatnonzero(a['stratum'] == s)
            b['y'][idx] = rng.permutation(b['y'][idx])
        null.append(mh(b))
    finite = [v for v in null if v is not None]
    out['permutation_null'] = {'attempted': permutations, 'valid': len(finite),
        'median': float(np.median(finite)) if finite else None,
        'q975': float(np.quantile(finite, .975)) if finite else None,
        'p': (1+sum(v >= mh(a) for v in finite))/(1+len(finite)) if finite and mh(a) is not None else None}
    return out


def plant_prevalence(a, idx, fraction):
    # Confound exposure with baseline risk. Normalize expected total prevalence to 3%.
    sizes = np.array([len(i) for i in idx]); p = np.array([a['y'][i].mean() for i in idx])
    f = .15 + 8*p
    f *= fraction*sizes.sum()/np.sum(sizes*f)
    if np.max(f) >= .8: raise ValueError('infeasible confounded prevalence')
    return f


def plant_probabilities(a, fraction=.03, rr=2.):
    """Solve exact ratio of expected finite-stratum MH numerator/denominator.

    A success cannot also be an unexposed success: the n_pos-1 terms explicitly
    remove self-pairs. This target is a ratio of expectations, not E[the ratio].
    """
    if not 0 < fraction < 1 or rr < 1: raise ValueError('invalid plant parameters')
    idx = [np.flatnonzero(a['stratum'] == s) for s in np.unique(a['stratum'])]
    sizes = np.array([len(i) for i in idx]); p = np.array([a['y'][i].mean() for i in idx])
    f = plant_prevalence(a, idx, fraction); np1 = sizes*p; np0 = sizes-np1
    def risks(multiplier):
        return np.minimum(multiplier*p/(1+f*(multiplier-1)), np.minimum(1., p/f))
    def expected(q):
        A = np.divide(f*q,p,out=np.zeros(len(p)),where=p>0)
        B = np.divide(f*(1-q),1-p,out=np.zeros(len(p)),where=p<1)
        num = np.sum(np1*A*((np1-1)*(1-A)+np0*(1-B))/sizes)
        den = np.sum(np1*(1-A)*((np1-1)*A+np0*B)/sizes)
        return num/den if den > 0 else float('inf')
    lo, hi = .00001, 1e6
    if not np.any((p>0)&(p<1)) or expected(risks(hi)) < rr: raise ValueError('planted aggregate relative success infeasible')
    for _ in range(80):
        mid = (lo+hi)/2
        if expected(risks(mid)) < rr: lo = mid
        else: hi = mid
    q = risks((lo+hi)/2)
    return idx, p, q, float(expected(q))


def planted_feature(a, rng, fraction=.03, rr=2.):
    idx, prevalence, exposed_risk, _ = plant_probabilities(a, fraction, rr)
    f = plant_prevalence(a, idx, fraction); x = np.zeros(len(a['y']), dtype=int)
    for ids, p, q, freq in zip(idx, prevalence, exposed_risk, f):
        pos = ids[a['y'][ids] == 1]; neg = ids[a['y'][ids] == 0]
        pp = freq*q/p if p else 0; pn = freq*(1-q)/(1-p) if p<1 else 0
        if not 0 <= pp <= 1+1e-12 or not 0 <= pn <= 1+1e-12: raise ValueError('invalid plant probability')
        x[pos] = rng.random(len(pos)) < pp; x[neg] = rng.random(len(neg)) < pn
    return x


def gain_signal(a, rng, gain):
    """KH10: independently calibrated score distribution, not selection on realized gain.

    Break only ties in B_gen, with Gaussian signal whose expected stratified AUC gain
    equals gain. The 3% RR plant is a separate experiment, never used as an MEI proxy.
    """
    pair_total = tie_pairs = 0.
    for ph in np.unique(a['phase']):
        idx = a['phase'] == ph; y = a['y'][idx]; b = a['support'][idx]
        pair_total += y.sum()*(len(y)-y.sum())
        for val in (0, 1):
            yy = y[b == val]; tie_pairs += yy.sum()*(len(yy)-yy.sum())
    if pair_total <= 0 or tie_pairs <= 0 or not 0 <= gain < .5*tie_pairs/pair_total:
        raise ValueError('unidentifiable incremental gain')
    shift = np.sqrt(2)*ndtri(.5+gain*pair_total/tie_pairs)
    # Monotone bounded perturbation ensures no B_gen order reversals.
    return a['support'] + .49*ndtr(rng.normal(size=len(a['y'])) + shift*a['y'])


def power_study(rows, *, seed, gains=(0., .01, .02, .04), replicates=200, resamples=300):
    a = arrays(rows); rng = np.random.default_rng(seed); curve = []
    for gain in gains:
        detected = 0; observed = []
        for _ in range(replicates):
            r = gain_signal(a, rng, gain)
            result = gain_bootstrap(a, rng, resamples, r)
            observed.append(result['estimate'])
            detected += bool(result['available'] and result['ci'][0] > 0)
        from .tier_a import cp
        curve.append({'expected_gain': gain, 'mean_realized_gain': float(np.mean(observed)),
                      'detected': detected, 'replicates': replicates, 'power': detected/replicates,
                      'one_sided_95_bounds': list(cp(detected, replicates))})
    at_mei = next((r for r in curve if r['expected_gain'] == .02), None)
    return {'curve': curve, 'mei_power_sufficient': bool(at_mei and at_mei['power'] >= .8),
            'gain_at_80_percent': next((r['expected_gain'] for r in curve if r['power'] >= .8), None),
            'design': 'conditional-on-observed-cohort-synthetic-score-operating-characteristic',
            'd1_certified': False}


def gain_bootstrap(a, rng, n, ranker):
    base = auc_plan(a['support'], a['y'], a['phase']); rank = auc_plan(ranker, a['y'], a['phase'])
    b, r = auc_eval(base), auc_eval(rank)
    ib, ir = auc_influence(base), auc_influence(rank)
    return multiplier_interval(a, None if ib is None or ir is None else ir-ib,
                               None if b is None or r is None else r-b, rng, n)
