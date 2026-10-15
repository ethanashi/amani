"""`multiplicity`: Benjamini-Hochberg, Holm or Bonferroni adjustment (statsmodels multipletests)
within each declared family of p-values."""
from __future__ import annotations

from pathlib import Path

from .common import InputError, UsageError, is_missing, parse_number, read_table, software, write_table

METHODS = {"bh": "fdr_bh", "holm": "holm", "bonferroni": "bonferroni"}


def run(a) -> tuple[int, str, str, dict]:
    from statsmodels.stats.multitest import multipletests
    import numpy as np
    if (a.family_column is None) == (not a.single_family):
        raise UsageError("declare the family: exactly one of --family-column COL or --single-family")
    if not 0 < a.alpha < 1:
        raise UsageError("--alpha must be in (0, 1)")
    table = read_table(Path(a.table), a.format)
    raw = table.column(a.p_column)
    families = table.column(a.family_column) if a.family_column else ["all"] * len(raw)
    ids = table.column(a.id_column) if a.id_column else [str(i + 1) for i in range(len(raw))]
    if any(is_missing(f) for f in families):
        raise InputError("every test needs a non-missing family")
    if any(is_missing(i) for i in ids) or len(set(ids)) != len(ids):
        raise InputError("test IDs must be non-missing and unique")
    pvals = []
    for i, value in enumerate(raw):
        if is_missing(value):
            raise InputError(f"row {i + 1}: missing p-value (every test in a family must be counted)")
        p = parse_number(value, f"row {i + 1} {a.p_column!r}")
        if not 0 <= p <= 1:
            raise InputError(f"row {i + 1}: p-value {p} outside [0, 1]")
        pvals.append(p)
    adjusted = [0.0] * len(pvals)
    rejected = [False] * len(pvals)
    summary_rows = []
    for family in sorted(set(families)):
        idx = [i for i, f in enumerate(families) if f == family]
        reject, corrected, _, _ = multipletests(np.array([pvals[i] for i in idx]), alpha=a.alpha, method=METHODS[a.method])
        for j, i in enumerate(idx):
            adjusted[i] = float(corrected[j])
            rejected[i] = bool(reject[j])
        summary_rows.append({"family": family, "tests": len(idx), "rejected": int(np.sum(reject))})
    rows = [{"id": ids[i], "family": families[i], "p": pvals[i], "pAdjusted": adjusted[i], "reject": rejected[i]}
            for i in range(len(pvals))]
    if a.out:
        out_path = Path(a.out)
        table.header = table.header + ["p_adjusted", "reject"]
        table.rows = [r + [repr(adjusted[i]), "true" if rejected[i] else "false"] for i, r in enumerate(table.rows)]
        table.fmt = out_path.suffix.lower().lstrip(".") if out_path.suffix.lower() in (".csv", ".tsv", ".json") else table.fmt
        write_table(table, out_path)
    total = sum(r["rejected"] for r in summary_rows)
    summary = (f"{a.method} at alpha {a.alpha}: {total} of {len(pvals)} test(s) rejected across {len(summary_rows)} family(ies): "
               + "; ".join(f"{r['family']} {r['rejected']}/{r['tests']}" for r in summary_rows))
    return 0, "computed", summary, {"method": a.method, "engine": f"statsmodels.stats.multitest.multipletests(method={METHODS[a.method]!r})",
                                    "alpha": a.alpha, "familyColumn": a.family_column, "families": summary_rows,
                                    "tests": rows, **({"out": a.out} if a.out else {}), "software": software()}
