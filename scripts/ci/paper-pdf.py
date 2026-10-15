#!/usr/bin/env python3
"""Run the existing CI paper-pdf stage alone, in the clean current checkout.
This scoped receipt never claims a fast/full CI pass or satisfies publishing gates.
"""
import hashlib,json,os,subprocess,time
from pathlib import Path
from pipeline import Pipeline,REPO,HERE,capture

def main():
    if capture(['git','status','--porcelain','--untracked-files=no']):
        raise SystemExit('Commit tracked edits before running the paper-pdf stage.')
    commit=capture(['git','rev-parse','HEAD'])
    root=REPO/'.bio-scratch/ci-paper-pdf'/time.strftime('%Y%m%d-%H%M%S')
    root.mkdir(parents=True)
    runner=object.__new__(Pipeline)
    runner.checkout=REPO;runner.logs=root;runner.harness=HERE
    runner.env={k:v for k,v in os.environ.items() if k in ('HOME','USER','LOGNAME','TMPDIR','LANG','SHELL','TERM','PATH')}
    runner.env['PAPER_CI_REPORT']=str(root/'regenerate-sample.json')
    runner.env.update(CI='true',AMANI_MEDIC='',PYTHONDONTWRITEBYTECODE='1',OPENBLAS_NUM_THREADS='1',OMP_NUM_THREADS='1')
    started=time.monotonic();receipt={'scope':'paper-pdf only; not full CI','commit':commit,'status':'running'}
    try:
        with (root/'paper-pdf.log').open('wb') as log:Pipeline.paper(runner,log)
        if capture(['git','rev-parse','HEAD'])!=commit or capture(['git','status','--porcelain','--untracked-files=no']):
            raise RuntimeError('tracked source changed during CI stage')
        receipt.update(status='passed',artifacts={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in root.glob('*.pdf')})
    except Exception as exc:
        receipt.update(status='failed',error=str(exc))
    receipt['duration_seconds']=round(time.monotonic()-started,3)
    (root/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
    print(json.dumps(dict(receipt,logs=str(root)),indent=2))
    return 0 if receipt['status']=='passed' else 1
if __name__=='__main__':raise SystemExit(main())
