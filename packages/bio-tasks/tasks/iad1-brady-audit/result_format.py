"""IAD format policy: project onto defined fields before scoring; never infer claims from extensions.

Warnings contain schema locations and counts only, never untrusted field names or values.
The shared loader still rejects invalid JSON, duplicate keys and malformed defined claim fields.
"""
from __future__ import annotations

import json
from pathlib import Path

CLAIM = dict.fromkeys(("id", "statement", "status", "estimate", "ci", "n_units", "unit"))
ENTRY = dict.fromkeys(("reproduced", "value", "how"))
LOO = {
    "claims": [CLAIM],
    "recomputed": {**dict.fromkeys(("unit", "n_scored", "n_patients", "tp", "fn", "fp", "tn",
                                   "sensitivity", "specificity", "accuracy", "auc")),
                   "auc_by_cycle": dict.fromkeys(("2", "3", "4"))},
    "reported_numbers": dict.fromkeys(("accuracy", "sensitivity", "specificity", "auc"), ENTRY),
    "flagged_records": [dict.fromkeys(("subject", "cycle", "reason"))],
    "comparators": [dict.fromkeys(("id", "definition", "auc", "auc_model_minus_comparator", "ci95", "scores_file"))],
    "adopt_model": None, "extra": {},
}
COHORT = {"claims": [CLAIM], "n_series": None, "n_kept": None, "kept_subjects": None, "extra": {}}


def project(value, schema, warnings: list[str], path: str = "results"):
    """Remove extensions without supplying missing fields or repairing wrong types."""
    if isinstance(schema, dict) and isinstance(value, dict):
        count = len(value.keys() - schema.keys())
        if count:
            warnings.append(f"{path}: ignored {count} extension field(s)")
        return {k: project(v, schema[k], warnings, f"{path}.{k}") for k, v in value.items() if k in schema}
    if isinstance(schema, list) and isinstance(value, list):
        return [project(v, schema[0], warnings, f"{path}[{i}]") for i, v in enumerate(value)]
    return value


def load_results(workdir: Path, schema, warnings: list[str] | None = None):
    from biotasks import checks
    res, problems = checks.load_results(workdir)
    if res is None:
        return None, problems
    return project(res, schema, warnings if warnings is not None else []), []


def record_warnings(out: Path, warnings: list[str]) -> None:
    result = json.loads(out.read_text())
    result["format_policy"] = "ignore-extensions-validate-defined-fields@1"
    result["warnings"] = warnings
    out.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")
