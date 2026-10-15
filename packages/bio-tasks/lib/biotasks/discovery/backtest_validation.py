"""Host-only simulation and CI calibration. All random seeds derive from supplied keys."""
import numpy as np
from . import backtest_stats as stats
from .blinding import generator_seed, digest
from .tier_a import cp


def coverage_study(rows, *, key, replicates=200, keys=3):
    a=stats.arrays(rows);groups=[];all_log=[];all_se=[]
    for k in range(keys):
        rng=np.random.default_rng(generator_seed(key,'BT3-coverage',k));covered=crude_covered=unavailable=0
        estimates=[];ses=[]
        for _ in range(replicates):
            x=stats.planted_feature(a,rng);b={**a,'support':x}
            result=stats.bootstrap(b,rng,300)['relative_success']
            coarse={**b,'stratum':np.zeros(len(x),int)};naive=stats.bootstrap(coarse,rng,300)['relative_success']
            covered+=bool(result['available'] and result['ci'][0]<=2<=result['ci'][1])
            crude_covered+=bool(naive['available'] and naive['ci'][0]<=2<=naive['ci'][1])
            unavailable+=not result['available']
            if result['available']:
                estimates.append(np.log(result['estimate']));ses.append(result['se'])
        all_log.extend(estimates);all_se.extend(ses)
        groups.append({'key_index':k,'n':replicates,'reference_count':covered,'reference_bounds':list(cp(covered,replicates)),
                       'crude_count':crude_covered,'crude_bounds':list(cp(crude_covered,replicates)), 'unavailable':unavailable,
                       'empirical_log_se':float(np.std(estimates,ddof=1)),'mean_estimated_log_se':float(np.mean(ses))})
    return {'groups':groups,'n':replicates*keys,'reference_bounds':list(cp(sum(g['reference_count'] for g in groups),replicates*keys)),
            'crude_bounds':list(cp(sum(g['crude_count'] for g in groups),replicates*keys)),
            'valid':keys>=3 and replicates>=100 and all(g['reference_bounds'][0]>=.8 and g['crude_bounds'][1]<=.2 for g in groups),
            'empirical_log_se':float(np.std(all_log,ddof=1)), 'mean_estimated_log_se':float(np.mean(all_se)),
            'truth':2., 'estimand':'ratio-of-expected-finite-stratum-MH-components',
            'criteria':'at least 3 keyed streams, 100 draws each; reference lower CP >= .8; crude upper CP <= .2',
            'certified':False}


def variance_validation(rows, *, seed, replicates=2000):
    """Independent one-way pairs bootstrap vs analytic log-MH gradient CGM."""
    a=stats.arrays(rows);rng=np.random.default_rng(seed);components=[]
    pair=np.unique(np.column_stack([c[1] for c in a['_clusters']]),axis=0,return_inverse=True)[1]
    for groups in [c[1] for c in a['_clusters']]+[pair]:
        m=int(groups.max())+1;values=[]
        for _ in range(replicates):
            counts=rng.multinomial(m,np.full(m,1/m));v=stats.mh(a,weights=counts[groups])
            if v is not None and v>0:values.append(np.log(v))
        components.append(float(np.var(values,ddof=1)))
    variance,analytic=stats.cluster_variance(a,stats.mh_influence(a))
    bootstrap=components[0]+components[1]-components[2]
    return {'replicates_per_component':replicates,'analytic_components':analytic,'bootstrap_components':components,
            'analytic_se':float(np.sqrt(variance)),'one_way_bootstrap_combined_se':float(np.sqrt(bootstrap)) if bootstrap>0 else None,
            'method':'target + indication - target-indication intersection; independent nonlinear bootstrap cross-check'}
