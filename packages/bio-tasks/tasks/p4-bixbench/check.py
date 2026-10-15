import sys
from pathlib import Path
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE.parents[1]/'lib'))
sys.path.insert(0,str(HERE.parent/'p1-esr1'))
from biotasks import checks
from check_support import ITEMS,evaluate as check
TASK='p4-bixbench'
ITEMS=ITEMS+(['recovery'] if TASK=='p16-recovery' else [])
def evaluate(work,key,rerun=None): return check(TASK,work,key,rerun)
def load_key(path):
    import re
    from biotasks import sealing
    key=checks.load_key(path,TASK)
    source=sealing.load_json(HERE/'SOURCE-KEY.json.enc')
    bounds=[float(x) for x in re.findall(r'\d+(?:\.\d+)?',source['published_ideal'])]
    valid=(len(bounds)==2 and 0<=min(bounds)<=key['estimate']<=max(bounds)<=1
           and abs(key['estimate']-source['reproduced']['mean_circularity'])<1e-12
           and key['selection']['genotype']==source['reproduced']['genotype_with_largest_mean_area']
           and key['source_ciphertext_sha256']==sealing.ciphertext_sha256(HERE/'SOURCE-KEY.json.enc'))
    if not valid: raise ValueError('official original source key does not reproduce')
    return key
if __name__=='__main__': sys.exit(checks.run_check(TASK,ITEMS,evaluate,key_loader=load_key))
