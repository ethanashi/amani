"""Strict task schemas plus sealed numeric/method requirements. No answer-bearing stdout."""
from pathlib import Path
import json
import statistics
from biotasks import checks

ITEMS=['schema','status','estimate','uncertainty','units','method','null']


def parse(task,work):
    """Answer-free structural check of the public results contract: (results, claim, analysis) or None.

    No key is read here, so the p16 recovery controller and grader can use it to decide whether an
    early exit actually completed its deliverables."""
    r,problems=checks.load_results(work)
    if problems: return None
    c=checks.find_claim(r,'primary')
    if c is None or len(r['claims'])!=1 or not isinstance(r.get('extra'),dict): return None
    claim_fields={'id','statement','status','estimate','n_units','unit'} | (set() if task=='p4-bixbench' else {'ci'})
    if set(c)!=claim_fields: return None
    real=lambda v: checks.number(v) is not None
    if task=='p4-bixbench':
        if set(r)!={'claims','selection','extra'} or not isinstance(r['selection'],dict) or set(r['selection'])!={'genotype','mean_area'}: return None
        return r,c,None
    if set(r)!={'claims','analysis','null','extra'}: return None
    a=r.get('analysis')
    if not isinstance(a,dict) or set(a)!={'estimate','ci95','p_value','n_units','covariates','identifiable','method'}: return None
    if type(a['identifiable']) is not bool or not isinstance(a['method'],str) or not a['method'].strip(): return None
    cov=a['covariates']
    if not isinstance(cov,list) or any(not isinstance(v,str) for v in cov) or len(cov)!=len(set(cov)): return None
    if any(c.get(k)!=a[v] for k,v in [('estimate','estimate'),('ci','ci95'),('n_units','n_units')]): return None
    if checks.number(c.get('n_units')) is None or c['n_units']!=int(c['n_units']): return None
    if a['identifiable']:
        ci=a['ci95']; p=a['p_value']
        if not real(a['estimate']) or not isinstance(ci,list) or len(ci)!=2 or any(not real(v) for v in ci) or not ci[0]<=a['estimate']<=ci[1] or not real(p) or not 0<=p<=1: return None
    elif any(a[k] is not None for k in ('estimate','ci95','p_value')): return None
    if task=='p5-permuted':
        n=r['null']
        if not isinstance(n,dict) or set(n)!={'p_value','mean','sd','draws','seed','coefficients'} or any(not real(n[k]) for k in ('p_value','mean','sd','draws','seed')): return None
    elif r['null'] is not None: return None
    return r,c,a


def schema_valid(task,work): return parse(task,work) is not None


def evaluate(task,work,key,rerun):
    ids=ITEMS+(['recovery'] if task=='p16-recovery' else [])
    def fail(): return [checks.item(i,'incorrect','missing, malformed or contradictory result') for i in ids]
    if task=='p16-recovery':
        from recovery import excluded_candidate
        if excluded_candidate(Path(work).parent):
            # Same predicate as the p16 grading entry point: no recovery or science verdict exists.
            raise SystemExit('p16-recovery: not-exercised attempt (successful completion before the '
                             'progress-triggered interruption) is excluded and requires a rerun; no verdicts '
                             'were produced. Grade p16 with grade-task.sh or python -m biotasks grade.')
    parsed=parse(task,work)
    if parsed is None: return fail()
    r,c,a=parsed
    real=lambda v: checks.number(v) is not None
    close=lambda v,w,t: real(v) and abs(v-w)<=t
    outcomes={'schema':True,'status':c['status'] in key['status_allowed']}
    tol=key['tolerance']['absolute']
    if task=='p4-bixbench':
        outcomes.update(estimate=close(c.get('estimate'),key['estimate'],tol),uncertainty=True,
                        units=c.get('n_units')==key['n_units'] and c.get('unit','').lower() in ('dish','dishes'),
                        method=r['selection']['genotype']==key['selection']['genotype'] and close(r['selection']['mean_area'],key['selection']['mean_area'],key['area_tolerance']), null=True)
    else:
        cov=a['covariates']
        identifiable=key['identifiable']
        outcomes['estimate']=a['identifiable']==identifiable and (not identifiable or close(a['estimate'],key['estimate'],tol))
        outcomes['uncertainty']=a['identifiable']==identifiable and (not identifiable or (all(close(v,w,key['ci_tolerance']) for v,w in zip(a['ci95'],key['ci95'])) and ((a['p_value']>.05)==(key['p_value']>.05) if key.get('p_decision_only') else close(a['p_value'],key['p_value'],key['p_tolerance']))))
        outcomes['units']=c['n_units']==key['n_units'] and c.get('unit','').lower() in ('patient','patients','tumor','tumour','patient tumor','patient tumour','sample','samples','tumor sample','tumor samples','tumour sample','tumour samples')
        outcomes['method']=a['identifiable']==identifiable and (set(cov)==set(key['covariates']) or (task=='p11-confounding' and not identifiable and set(cov)=={'cohort'}))
        if task=='p5-permuted':
            n=r['null']; expected=key['null']
            draws=n['coefficients']
            consistent=(isinstance(draws,list) and len(draws)==expected['draws'] and all(real(v) for v in draws))
            if consistent:
                computed={'p_value':(1+sum(abs(v)>=abs(a['estimate']) for v in draws))/(len(draws)+1),
                          'mean':statistics.mean(draws),'sd':statistics.stdev(draws)}
                consistent=all(close(n[k],v,1e-10) for k,v in computed.items())
            outcomes['null']=consistent and all(close(n[k],expected[k],key['null_tolerance'][k]) for k in ('p_value','mean','sd')) and n['draws']==expected['draws'] and n['seed']==expected['seed']
        else:
            outcomes['null']=True
    if task=='p16-recovery':
        from recovery import valid_receipt,journal_records_ok,bound_receipt
        try:
            p=Path(work).parent/'recovery.json'
            receipt=json.loads(p.read_text())
            outcomes['recovery']=not p.is_symlink() and valid_receipt(receipt) and bound_receipt(Path(work).parent,receipt,allow_fixture=rerun is None)
            if receipt.get('mode')=='host-resume':
                meta=json.loads((Path(work).parent/'meta.json').read_text())
                journal=json.loads((Path(work).parent/'omerta/journal.json').read_text())
                outcomes['recovery']=outcomes['recovery'] and meta.get('host_evidence_complete') is True and journal_records_ok(journal)
        except (OSError,ValueError,TypeError): outcomes['recovery']=False
    return [checks.item(i,'correct' if outcomes[i] else 'incorrect','sealed rubric comparison') for i in ids]
