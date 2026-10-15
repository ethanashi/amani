import sys
from pathlib import Path
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE.parents[1]/'lib'))
sys.path.insert(0,str(HERE.parent/'p1-esr1'))
from reference_support import reference
if __name__=='__main__': reference(HERE)
