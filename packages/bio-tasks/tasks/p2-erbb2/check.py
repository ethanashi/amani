import sys
from pathlib import Path
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE.parents[1]/'lib'))
sys.path.insert(0,str(HERE.parent/'p1-esr1'))
from biotasks import checks
from check_support import ITEMS,evaluate as check
TASK='p2-erbb2'
ITEMS=ITEMS+(['recovery'] if TASK=='p16-recovery' else [])
def evaluate(work,key,rerun=None): return check(TASK,work,key,rerun)
if __name__=='__main__': sys.exit(checks.run_check(TASK,ITEMS,evaluate))
