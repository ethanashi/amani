#!/usr/bin/env python3
"""Deterministic checker for iad2-brady-twin (no LLM): the iad1 checker (../iad1-brady-audit/iad_common.py,
evaluate_loo) against this card's sealed key. Items and expectations come from the key: the twin's correct
verdict is tentative predictive support or insufficient evidence for the clinical decision, the model's difference from the co-primary comparators has
an interval above 0, and auc_source is not scored (the training ROC cannot be regenerated for counterfactual
outcomes). Missing or malformed results make every item incorrect.
"""
from __future__ import annotations

import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "lib"))
sys.path.insert(0, str(HERE.parent / "iad1-brady-audit"))

import iad_common as ic  # noqa: E402

TASK = "iad2-brady-twin"
ITEMS = [i for i in ic.LOO_ITEMS if i != "auc_source"]

if __name__ == "__main__":
    sys.exit(ic.run_loo_check(TASK, ITEMS))
