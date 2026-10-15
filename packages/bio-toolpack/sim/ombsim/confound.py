"""`confound-check`: association between a declared exposure and every other supplied column,
with an identifiability warning when a column is aligned with the exposure.

Measures (0-1 scale): categorical x categorical -> Cramer's V (scipy chi2_contingency);
numeric x categorical -> correlation ratio eta (scipy f_oneway gives the p-value);
numeric x numeric -> |Pearson r| (scipy pearsonr; Spearman reported too).
"""
from __future__ import annotations

import math
from pathlib import Path

from .common import InputError, UsageError, is_missing, read_table, software


def _numeric(values: list[str]) -> list[float] | None:
    out = []
    for v in values:
        try:
            x = float(v)
        except ValueError:
            return None
        if not math.isfinite(x):
            return None
        out.append(x)
    return out


def _kind(name: str, values: list[str], a) -> str:
    if name in a.categorical:
        return "categorical"
    nums = _numeric(values)
    if name in a.numeric:
        if nums is None:
            raise InputError(f"--numeric column {name!r} has non-numeric values")
        return "numeric"
    return "numeric" if nums is not None and len(set(nums)) > a.max_levels else "categorical"


def _eta(numeric: list[float], groups: list[str]):
    import numpy as np
    from scipy.stats import f_oneway
    x = np.array(numeric)
    levels = sorted(set(groups))
    total = float(np.sum((x - x.mean()) ** 2))
    if total == 0 or len(levels) < 2:
        return None, None
    between = sum(float(np.sum(np.array(groups) == lv)) * (float(x[np.array(groups) == lv].mean()) - float(x.mean())) ** 2 for lv in levels)
    samples = [x[np.array(groups) == lv] for lv in levels]
    p = float(f_oneway(*samples).pvalue) if all(len(s) > 1 for s in samples) and any(np.var(s) > 0 for s in samples) else None
    return math.sqrt(min(1.0, between / total)), p



def _design(values, kind):
    import numpy as np
    if kind == "numeric":
        x = np.asarray(_numeric(values), dtype=float)
        return ((x - x.mean()) / x.std()).reshape(-1, 1)
    levels = sorted(set(values))
    return np.column_stack([np.asarray(values) == lv for lv in levels[1:]]).astype(float)

def run(a) -> tuple[int, str, str, dict]:
    import numpy as np
    from scipy.stats import chi2_contingency, pearsonr, spearmanr
    if not 0 < a.strong <= 1:
        raise UsageError("--strong must be in (0, 1]")
    table = read_table(Path(a.table), a.format)
    exposure_values = table.column(a.exposure)
    if len(set(v for v in exposure_values if not is_missing(v))) < 2:
        raise InputError("exposure has no estimable contrast")
    if set(a.numeric) & set(a.categorical):
        raise UsageError("numeric and categorical declarations overlap")
    for name in set(a.numeric + a.categorical + a.exclude + ([a.id_column] if a.id_column else [])):
        table.column(name)
    for name in table.header:
        for value in table.column(name):
            if is_missing(value):
                continue
            try:
                number = float(value)
            except ValueError:
                continue
            if not math.isfinite(number):
                raise InputError(f"{name!r} contains a non-finite value")
    skip = {a.exposure} | ({a.id_column} if a.id_column else set()) | set(a.exclude)
    columns = a.columns if a.columns else [c for c in table.header if c not in skip]
    for c in columns:
        table.column(c)
        if c in skip:
            raise UsageError(f"column {c!r} is the exposure, the id column or excluded")
    if not columns:
        raise UsageError("no columns to check")
    rows = []
    flagged = []
    for c in columns:
        values = table.column(c)
        keep = [i for i in range(len(values)) if not is_missing(values[i]) and not is_missing(exposure_values[i])]
        e = [exposure_values[i] for i in keep]
        v = [values[i] for i in keep]
        entry = {"column": c, "n": len(keep), "missingDropped": len(values) - len(keep)}
        if len(keep) < 3:
            entry.update({"status": "insufficient", "reason": "fewer than 3 rows with both values"})
            rows.append(entry)
            flagged.append(entry)
            continue
        ek, vk = _kind(a.exposure, e, a), _kind(c, v, a)
        entry.update({"exposureType": ek, "columnType": vk})
        if len(set(e)) < 2:
            entry.update({"status": "insufficient", "reason": "no exposure contrast in usable rows"})
            rows.append(entry)
            flagged.append(entry)
            continue
        if len(set(v)) < 2:
            entry.update({"status": "constant", "association": None, "reason": "one side has a single value"})
            rows.append(entry)
            continue
        aligned = False
        if ek == "categorical" and vk == "categorical":
            levels_e, levels_v = sorted(set(e)), sorted(set(v))
            counts = np.zeros((len(levels_v), len(levels_e)))
            ie, iv = {x: i for i, x in enumerate(levels_e)}, {x: i for i, x in enumerate(levels_v)}
            for x, y in zip(e, v):
                counts[iv[y], ie[x]] += 1
            chi2, p, _, _ = chi2_contingency(counts, correction=False)
            assoc = math.sqrt(chi2 / (len(keep) * (min(counts.shape) - 1)))
            aligned = all(int(np.count_nonzero(row)) == 1 for row in counts)
            entry.update({"measure": "cramers_v", "association": min(1.0, assoc), "p": p, "levels": [len(levels_v), len(levels_e)],
                          "exposureDeterminedByColumn": aligned})
        elif ek == "numeric" and vk == "numeric":
            x, y = _numeric(e), _numeric(v)
            r = pearsonr(x, y)
            rho = spearmanr(x, y)
            entry.update({"measure": "abs_pearson_r", "association": abs(float(r.statistic)), "r": float(r.statistic),
                          "p": float(r.pvalue), "spearmanRho": float(rho.statistic)})
        else:
            numeric, groups = (_numeric(e), v) if ek == "numeric" else (_numeric(v), e)
            eta, p = _eta(numeric, groups)
            entry.update({"measure": "correlation_ratio_eta", "association": eta, "p": p})
        # Identifiability is a rank property, not a high-correlation threshold.
        nuisance = np.column_stack([np.ones(len(e)), _design(v, vk)])
        exposure = _design(e, ek)
        aligned = np.linalg.matrix_rank(np.column_stack([nuisance, exposure])) < np.linalg.matrix_rank(nuisance) + exposure.shape[1]
        assoc = entry.get("association")
        if aligned:
            entry["status"] = "aligned"
            entry["warning"] = (f"exposure {a.exposure!r} is aligned with {c!r}: their effects are not separately identifiable "
                                f"(adjusting for {c!r} removes the exposure contrast)")
        elif assoc is not None and assoc >= a.strong:
            entry["status"] = "strong"
        else:
            entry["status"] = "weak"
        rows.append(entry)
        if entry["status"] in ("aligned", "strong"):
            flagged.append(entry)
    complete = [i for i in range(len(exposure_values)) if all(not is_missing(table.column(c)[i]) for c in [a.exposure] + columns)]
    joint = {"n": len(complete), "status": "insufficient"}
    if len(complete) >= 3:
        e = [exposure_values[i] for i in complete]
        if len(set(e)) > 1:
            blocks = [np.ones((len(e), 1))]
            for c in columns:
                values = [table.column(c)[i] for i in complete]
                if len(set(values)) > 1:
                    blocks.append(_design(values, _kind(c, values, a)))
            nuisance = np.column_stack(blocks)
            exposure = _design(e, _kind(a.exposure, e, a))
            deficient = np.linalg.matrix_rank(np.column_stack([nuisance, exposure])) < np.linalg.matrix_rank(nuisance) + exposure.shape[1]
            joint["status"] = "aligned" if deficient else "estimable"
    if joint["status"] != "estimable":
        flagged.append(joint)
    aligned = [r["column"] for r in rows if r["status"] == "aligned"]
    strong = [r["column"] for r in rows if r["status"] == "strong"]
    insufficient = [r["column"] for r in rows if r["status"] == "insufficient"]
    summary = (f"exposure {a.exposure!r} vs {len(rows)} column(s): aligned {aligned or 'none'}; strong (>= {a.strong}) {strong or 'none'}"
               + (f"; insufficient data {insufficient}" if insufficient else ""))
    status = "aligned" if aligned or joint["status"] == "aligned" else "strong-association" if strong else "insufficient" if insufficient or joint["status"] == "insufficient" else "no-strong-association"
    return (1 if flagged else 0), status, summary, {"exposure": a.exposure, "strongThreshold": a.strong,
                                                    "alignmentRule": "rank deficiency of intercept + covariate + exposure", "columns": rows, "jointDesign": joint, "software": software()}
