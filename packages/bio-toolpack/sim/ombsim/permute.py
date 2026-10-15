"""`null-calibration` and `planted-effect`: run the user's own analysis command on K modified
fresh copies of the working directory and summarise what it reports.

Permutation (both tools): the declared label column of one row-axis table is permuted with a
seeded numpy Generator -- among all rows, within strata (`--within`), and/or at the unit level
(`--unit`: each unit keeps one label and units exchange labels). Missing labels stay in place.
Copy k uses numpy.random.SeedSequence([seed, k]).
"""
from __future__ import annotations

import math
from pathlib import Path

from .common import (InputError, Runner, Table, UsageError, binomial_summary, format_number, is_missing, parse_number,
                     read_table, software, write_table, local_path)


def _rng(seed: int, k: int):
    import numpy as np
    return np.random.default_rng(np.random.SeedSequence([seed, k]))


class Scheme:
    """Validated permutation scheme over a label table."""

    def __init__(self, table: Table, label: str, within: str | None, unit: str | None):
        self.table, self.label, self.within, self.unit = table, label, within, unit
        labels = table.column(label)
        strata = table.column(within) if within else ["(all)"] * len(labels)
        self.eligible = [i for i, v in enumerate(labels) if not is_missing(v)]
        if len(self.eligible) < 2:
            raise InputError(f"column {label!r} has fewer than two non-missing labels")
        if len({labels[i] for i in self.eligible}) < 2:
            raise InputError(f"column {label!r} has a single label level; nothing to permute")
        if within and any(is_missing(strata[i]) for i in self.eligible):
            raise InputError("missing stratum: exchangeability is undefined")
        if unit:
            units = table.column(unit)
            if any(is_missing(u) for u in units):
                raise InputError("missing unit: exchangeability is undefined")
            members: dict[str, list[int]] = {}
            for i in self.eligible:
                members.setdefault(units[i], []).append(i)
            self.groups = []
            for name in sorted(members):
                rows = members[name]
                if len({labels[i] for i in rows}) != 1:
                    raise InputError(f"label varies within unit {name!r}; unit-level permutation needs one label per unit")
                if len({strata[i] for i in rows}) != 1:
                    raise InputError(f"stratum varies within unit {name!r}; units must nest within strata")
                self.groups.append(rows)
        else:
            self.groups = [[i] for i in self.eligible]
        self.strata: dict[str, list[int]] = {}
        for g, rows in enumerate(self.groups):
            self.strata.setdefault(strata[rows[0]], []).append(g)
        if not any(len({labels[self.groups[g][0]] for g in gs}) > 1 for gs in self.strata.values()):
            raise InputError("no stratum holds two different labels; every permutation would be the identity")

    def describe(self) -> dict:
        return {"label": self.label, "within": self.within, "unit": self.unit, "exchangeableUnits": len(self.groups),
                "strata": len(self.strata), "missingLabelsKept": len(self.table.rows) - len(self.eligible)}

    def permuted(self, rng) -> list[str]:
        labels = self.table.column(self.label)
        out = list(labels)
        for stratum in sorted(self.strata):
            groups = self.strata[stratum]
            order = rng.permutation(len(groups))
            for g, source in zip(groups, order):
                value = labels[self.groups[groups[int(source)]][0]]
                for i in self.groups[g]:
                    out[i] = value
        return out


def _relative(path: str, flag: str) -> str:
    p = Path(path)
    if p.is_absolute() or ".." in p.parts:
        raise UsageError(f"{flag} must be a path relative to the working directory")
    return str(p)


def _common(a, command: list[str]) -> tuple[Path, str]:
    if not command:
        raise UsageError("missing analysis command after `--`")
    source = Path(a.dir).resolve()
    if not source.is_dir():
        raise InputError(f"{a.dir} is not a directory")
    if a.jobs < 1 or a.timeout_sec <= 0:
        raise UsageError("--jobs must be >= 1 and --timeout-sec > 0")
    return source, _relative(a.result, "--result")


def _failures(records: list[dict]) -> list[dict]:
    return [{"index": r["index"], "error": r["error"], **({"stderrTail": r["stderrTail"]} if "stderrTail" in r else {})}
            for r in records if "error" in r]


def null_calibration(a, command: list[str]) -> tuple[int, str, str, dict]:
    source, result = _common(a, command)
    if not 0 < a.alpha < 1 or a.permutations < 1:
        raise UsageError("--alpha must be in (0, 1) and --permutations >= 1")
    table_rel = _relative(a.table, "--table")
    table = read_table(local_path(source, table_rel), a.format)
    scheme = Scheme(table, a.label, a.within, a.unit)

    def prepare_for(k: int):
        def prepare(copy: Path) -> dict:
            if k == 0:
                return {"copy": "observed (unmodified)"}
            t = read_table(local_path(copy, table_rel), a.format)
            t.set_column(a.label, scheme.permuted(_rng(a.seed, k)))
            write_table(t, local_path(copy, table_rel))
            return {"copy": f"permutation {k}"}
        return prepare

    runner = Runner(source, command, result, {"p": a.p_key}, a.timeout_sec, a.jobs)
    try:
        indices = ([0] if a.observed else []) + list(range(1, a.permutations + 1))
        records = runner.run_all([prepare_for(k) for k in indices])
    finally:
        deleted = runner.close()
    perm = records[1:] if a.observed else records
    failures = _failures(records)
    pvalues = [r["values"]["p"] for r in perm if "values" in r]
    bad = [r["values"]["p"] for r in records if "values" in r and not 0 <= r["values"]["p"] <= 1]
    payload = {"scheme": scheme.describe(), "table": table_rel, "result": result, "pKey": a.p_key, "alpha": a.alpha,
               "permutations": a.permutations, "seed": a.seed, "command": command, "scratchDeleted": deleted,
               "software": software()}
    if failures or bad:
        payload["failures"] = failures + [{"error": f"p-value {p} outside [0, 1]"} for p in bad]
        return 1, "incomplete", f"{len(failures) + len(bad)} run(s) failed or reported an invalid p-value; no rate is claimed", payload
    fp = sum(1 for p in pvalues if p < a.alpha)
    rate = binomial_summary(fp, len(pvalues), a.alpha)
    payload["falsePositive"] = rate
    payload["permutationPValues"] = pvalues
    if a.observed:
        p_obs = records[0]["values"]["p"]
        payload["observed"] = {"p": p_obs, "permutationP": (1 + sum(1 for p in pvalues if p <= p_obs)) / (len(pvalues) + 1)}
    lo, hi = rate["ci95"]
    if lo > a.alpha:
        verdict, code = "anti-conservative", 1
    elif hi < a.alpha:
        verdict, code = "conservative", 1
    else:
        verdict, code = "consistent-with-nominal", 0
    summary = (f"empirical false-positive rate {fp}/{len(pvalues)} = {rate['rate']:.3f} at alpha {a.alpha} "
               f"(exact 95% CI {lo:.3f}-{hi:.3f}): {verdict}")
    return code, verdict, summary, payload


def _plant(values: list[str], treated: list[bool], effect: float, mode: str, column: str) -> list[str]:
    out = []
    for value, hit in zip(values, treated):
        if not hit or is_missing(value):
            out.append(value)
            continue
        x = parse_number(value, f"outcome column {column!r}")
        out.append(format_number(x + effect if mode == "add" else x * effect))
    return out


def _generate(a, rng) -> Table:
    import numpy as np
    header = [a.unit or "unit", a.label, a.outcome]
    rows = []
    for g, level in enumerate((a.control, a.treated)):
        for u in range(a.units_per_group):
            unit_effect = rng.normal(0.0, a.between_sd)
            shift = a.effect if g == 1 else 0.0
            for _ in range(a.replicates):
                value = shift + unit_effect + rng.normal(0.0, a.within_sd)
                rows.append([f"u{g}_{u + 1:04d}", level, format_number(float(np.round(value, 12)))])
    path = Path(a.table)
    return Table(path, "csv" if path.suffix.lower() == ".csv" else "tsv", header, rows)


def planted_effect(a, command: list[str]) -> tuple[int, str, str, dict]:
    source, result = _common(a, command)
    if a.seeds < 2 or not 0 < a.alpha < 1 or not 0 < a.ci_level < 1:
        raise UsageError("--seeds must be >= 2, --alpha and --ci-level in (0, 1)")
    if a.mode == "multiply" and a.effect <= 0:
        raise UsageError("--mode multiply needs --effect > 0")
    table_rel = _relative(a.table, "--table")
    truth = a.truth if a.truth is not None else a.effect
    keys = {"estimate": a.estimate_key}
    if a.ci_keys:
        lo_key, hi_key = a.ci_keys.split(",") if a.ci_keys.count(",") == 1 else (None, None)
        if not lo_key or not hi_key:
            raise UsageError("--ci-keys takes LOWER,UPPER")
        keys.update({"ciLow": lo_key, "ciHigh": hi_key})
    if a.p_key:
        keys["p"] = a.p_key
    if a.generate:
        if a.generate != "two-group":
            raise UsageError("--generate supports two-group")
        if a.mode != "add":
            raise UsageError("--generate plants an additive effect; --mode multiply is not supported")
        if a.units_per_group is None or a.units_per_group < 2 or a.replicates < 1 or a.between_sd < 0 or a.within_sd <= 0:
            raise UsageError("--generate needs --units-per-group >= 2, --replicates >= 1, --between-sd >= 0, --within-sd > 0")
        if a.control == a.treated:
            raise UsageError("--control and --treated must differ")
        if Path(table_rel).suffix.lower() not in (".csv", ".tsv"):
            raise UsageError("--generate writes a .csv or .tsv --table")
        design = {"model": "two-group", "unitsPerGroup": a.units_per_group, "replicates": a.replicates,
                  "betweenSd": a.between_sd, "withinSd": a.within_sd,
                  "columns": [a.unit or "unit", a.label, a.outcome], "levels": [a.control, a.treated]}
        scheme = None
    else:
        if a.outcome_table and not a.id:
            raise UsageError("--outcome-table needs --id (the column joining the two tables)")
        label_table = read_table(local_path(source, table_rel), a.format)
        scheme = Scheme(label_table, a.label, a.within, a.unit)
        if a.treated not in {label_table.column(a.label)[i] for i in scheme.eligible}:
            raise InputError(f"--treated {a.treated!r} is not a level of {a.label!r}")
        outcome_rel = _relative(a.outcome_table, "--outcome-table") if a.outcome_table else table_rel
        outcome_table = read_table(local_path(source, outcome_rel), a.format) if a.outcome_table else label_table
        for value in outcome_table.column(a.outcome):
            if not is_missing(value):
                parse_number(value, "outcome")
        if a.id:
            ids = label_table.column(a.id)
            if len(set(ids)) != len(ids):
                raise InputError(f"--id {a.id!r} is not unique in {table_rel}")
            other_ids = outcome_table.column(a.id)
            if any(is_missing(i) for i in ids + other_ids) or len(set(other_ids)) != len(other_ids) or set(ids) != set(other_ids):
                raise InputError("joined tables need unique, non-missing, matching IDs")
        design = {"model": "planted into permuted copies", "mode": a.mode, "outcomeTable": outcome_rel,
                  "scheme": scheme.describe()}

    def prepare_for(k: int):
        def prepare(copy: Path) -> dict:
            rng = _rng(a.seed, k)
            if a.generate:
                generated = _generate(a, rng)
                local_path(copy, table_rel).parent.mkdir(parents=True, exist_ok=True)
                write_table(generated, local_path(copy, table_rel))
                return {"seedIndex": k}
            t = read_table(local_path(copy, table_rel), a.format)
            labels = scheme.permuted(rng)
            t.set_column(a.label, labels)
            if a.outcome_table:
                write_table(t, local_path(copy, table_rel))
                outcome_path = local_path(copy, outcome_rel)
                o = read_table(outcome_path, a.format)
                by_id = dict(zip(t.column(a.id), labels))
                hits = [by_id.get(i) == a.treated for i in o.column(a.id)]
                o.set_column(a.outcome, _plant(o.column(a.outcome), hits, a.effect, a.mode, a.outcome))
                write_table(o, outcome_path)
            else:
                hits = [v == a.treated for v in labels]
                t.set_column(a.outcome, _plant(t.column(a.outcome), hits, a.effect, a.mode, a.outcome))
                write_table(t, local_path(copy, table_rel))
            return {"seedIndex": k}
        return prepare

    runner = Runner(source, command, result, keys, a.timeout_sec, a.jobs)
    try:
        records = runner.run_all([prepare_for(k) for k in range(1, a.seeds + 1)])
    finally:
        deleted = runner.close()
    payload = {"design": design, "effect": a.effect, "truth": truth, "result": result, "keys": keys, "seeds": a.seeds,
               "seed": a.seed, "alpha": a.alpha, "ciLevel": a.ci_level, "command": command, "scratchDeleted": deleted,
               "software": software()}
    failures = _failures(records)
    if failures:
        payload["failures"] = failures
        return 1, "incomplete", f"{len(failures)} of {a.seeds} run(s) failed; nothing is claimed", payload
    import numpy as np
    est = np.array([r["values"]["estimate"] for r in records])
    mean = float(est.mean())
    sd = float(est.std(ddof=1))
    se = sd / math.sqrt(len(est))
    out = {"meanEstimate": mean, "bias": mean - truth, "sdEstimate": sd, "seMean": se,
           "rmse": float(math.sqrt(np.mean((est - truth) ** 2))), "estimates": est.tolist()}
    if not all(math.isfinite(value) for value in (mean, sd, se, out["bias"], out["rmse"])):
        raise InputError("recovery statistics are non-finite; unavailable")
    problems = []
    if abs(mean - truth) > 2 * se + 1e-12 * max(1.0, abs(truth)):
        problems.append("biased")
    if "ciLow" in keys:
        lows = np.array([r["values"]["ciLow"] for r in records])
        highs = np.array([r["values"]["ciHigh"] for r in records])
        if np.any(lows > highs):
            payload["recovery"] = out
            return 1, "incomplete", "a reported interval has lower bound above upper bound", payload
        covered = int(np.sum((lows <= truth) & (truth <= highs)))
        out["coverage"] = binomial_summary(covered, len(est), a.ci_level)
        lo, hi = out["coverage"]["ci95"]
        if not lo <= a.ci_level <= hi:
            problems.append("miscalibrated-interval")
    if "p" in keys:
        ps = np.array([r["values"]["p"] for r in records])
        if np.any((ps < 0) | (ps > 1)):
            payload["recovery"] = out
            return 1, "incomplete", "a reported p-value is outside [0, 1]", payload
        out["power"] = binomial_summary(int(np.sum(ps < a.alpha)), len(est))
    payload["recovery"] = out
    verdict = "recovered" if not problems else "+".join(problems)
    summary = (f"planted {truth}: mean estimate {mean:.4g} (bias {mean - truth:+.4g}, SE {se:.2g}, RMSE {out['rmse']:.3g})"
               + (f", coverage {out['coverage']['rate']:.3f}" if "coverage" in out else "")
               + (f", power {out['power']['rate']:.3f}" if "power" in out else "") + f": {verdict}")
    return (0 if not problems else 1), verdict, summary, payload
