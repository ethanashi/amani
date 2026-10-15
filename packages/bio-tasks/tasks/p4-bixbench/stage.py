import sys
from pathlib import Path
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE.parents[1]/'lib'))
sys.path.insert(0,str(HERE.parent/'p1-esr1'))
from biotasks import staging
from stage_support import stage
if __name__=='__main__': stage(HERE,staging.stage_args())
