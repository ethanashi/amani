"""omb-sim entry point (tool pack profile `full`). Run through bin/omb-sim with the analysis
environment's Python (numpy, scipy, statsmodels, lifelines). See TOOLS.md for semantics."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from ombsim.cli import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
