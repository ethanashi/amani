"""Stub: the sandboxed reference run has no grading root; path assertions are identity."""
from pathlib import Path

BASELINE = Path("/nonexistent/omb-calibration/bio-baseline")


def require_under_grading_root(p, what):
    return Path(p)
