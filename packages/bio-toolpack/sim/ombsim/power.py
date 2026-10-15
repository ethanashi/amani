"""`power`: sample size, power or minimum detectable effect for four standard designs.

Analytic engines: statsmodels TTestIndPower / TTestPower / FTestPowerF2 and Schoenfeld's events
formula (scipy normal quantiles). Simulation draws data from the stated model and applies the
standard test (scipy t tests, statsmodels OLS F test, lifelines log-rank) with a fixed seed.
"""
from __future__ import annotations

import math

from .common import UsageError, binomial_summary, software

DESIGNS = ("two-group", "paired", "regression", "survival")


def _check(a) -> None:
    if not 0 < a.alpha < 1:
        raise UsageError("--alpha must be in (0, 1)")
    if a.power is not None and not 0 < a.power < 1:
        raise UsageError("--power must be in (0, 1)")
    if a.power is not None and a.power <= a.alpha:
        raise UsageError("target power must exceed alpha for sizing or MDE")
    if a.design == "survival":
        if a.n is not None:
            raise UsageError("survival designs are sized in events: use --events, not --n")
        if a.effect is not None and (a.effect <= 0 or a.effect == 1):
            raise UsageError("--effect for survival is a hazard ratio > 0 and != 1")
        if not 0 < a.allocation < 1:
            raise UsageError("--allocation must be in (0, 1)")
        if a.event_prob is not None and not 0 < a.event_prob <= 1:
            raise UsageError("--event-prob must be in (0, 1]")
        if a.events is not None and (a.events < 2 or a.events != int(a.events)):
            raise UsageError("--events must be an integer >= 2")
    else:
        if a.events is not None:
            raise UsageError("--events applies only to --design survival")
        if a.n is not None and (a.n != int(a.n) or a.n < 2):
            raise UsageError("--n must be an integer >= 2")
        if a.effect is not None and (a.effect == 0 or not math.isfinite(a.effect)):
            raise UsageError("--effect must be a non-zero finite number")
        if a.design == "regression" and a.effect is not None and a.effect <= 0:
            raise UsageError("--effect for regression is Cohen's f2 > 0")
    if a.sides == "one" and a.effect is not None and a.design in ("two-group", "paired") and a.effect < 0:
        raise UsageError("one-sided: give the effect in the tested (positive) direction")
    if a.ratio <= 0:
        raise UsageError("--ratio must be > 0")
    if a.sd_ratio <= 0:
        raise UsageError("--sd-ratio must be > 0")
    if a.design == "regression":
        if a.tested < 1 or a.predictors < a.tested:
            raise UsageError("need 1 <= --tested <= --predictors")
        if a.sides == "one":
            raise UsageError("the regression F test has no one-sided form")


def _unknown(a) -> str:
    size = a.events if a.design == "survival" else a.n
    missing = [name for name, value in (("effect", a.effect), ("size", size), ("power", a.power)) if value is None]
    if len(missing) != 1:
        raise UsageError("analytic mode solves for exactly one of --effect, --n/--events, --power: omit exactly one")
    return missing[0]


def analytic(a) -> dict:
    import numpy as np
    unknown = _unknown(a)
    alternative = "two-sided" if a.sides == "two" else "larger"
    if a.design in ("two-group", "paired"):
        from statsmodels.stats.power import TTestIndPower, TTestPower
        if a.design == "two-group" and a.sd_ratio != 1:
            raise UsageError("unequal SDs have no standard analytic solution; use --method simulate")
        effect = None if a.effect is None else (abs(a.effect) if a.sides == "two" else a.effect)
        if a.design == "two-group":
            engine, name = TTestIndPower(), "statsmodels.stats.power.TTestIndPower.solve_power"
            kwargs = {"effect_size": effect, "nobs1": a.n, "alpha": a.alpha, "power": a.power, "ratio": a.ratio,
                      "alternative": alternative}
        else:
            engine, name = TTestPower(), "statsmodels.stats.power.TTestPower.solve_power"
            kwargs = {"effect_size": effect, "nobs": a.n, "alpha": a.alpha, "power": a.power, "alternative": alternative}
        solved = float(np.asarray(engine.solve_power(**kwargs)).item())
        if unknown == "size":
            n1 = math.ceil(solved - 1e-9)
            res = {"nExact": solved, "n": n1}
            if a.design == "two-group":
                res.update({"n1": n1, "n2": math.ceil(n1 * a.ratio - 1e-9), "total": n1 + math.ceil(n1 * a.ratio - 1e-9)})
        elif unknown == "effect":
            res = {"effect": solved}
        else:
            res = {"power": solved}
        return {"engine": name, "solvedFor": unknown, "result": res}
    if a.design == "regression":
        from statsmodels.stats.power import FTestPowerF2
        k, u = a.predictors, a.tested
        df_denom = None if a.n is None else a.n - k - 1
        if df_denom is not None and df_denom < 1:
            raise UsageError("--n must exceed --predictors + 1")
        solved = float(np.asarray(FTestPowerF2().solve_power(effect_size=a.effect, df_num=u, df_denom=df_denom, alpha=a.alpha,
                                                  power=a.power, ncc=k - u + 1)).item())
        if unknown == "size":
            exact = solved + k + 1
            res = {"nExact": exact, "n": math.ceil(exact - 1e-9), "dfDenominator": solved}
        elif unknown == "effect":
            res = {"effect": solved}
        else:
            res = {"power": solved}
        return {"engine": "statsmodels.stats.power.FTestPowerF2.solve_power (noncentrality f2 * n)", "solvedFor": unknown,
                "result": res}
    from scipy.stats import norm
    za = norm.ppf(1 - a.alpha / 2) if a.sides == "two" else norm.ppf(1 - a.alpha)
    v = a.allocation * (1 - a.allocation)
    if unknown == "size":
        zb = norm.ppf(a.power)
        exact = (za + zb) ** 2 / (v * math.log(a.effect) ** 2)
        res = {"eventsExact": exact, "events": math.ceil(exact - 1e-9)}
        if a.event_prob is not None:
            res["subjects"] = math.ceil(res["events"] / a.event_prob - 1e-9)
    elif unknown == "power":
        mu = math.sqrt(a.events * v) * abs(math.log(a.effect))
        res = {"power": float(norm.cdf(mu - za) + (norm.cdf(-mu - za) if a.sides == "two" else 0))}
    else:
        zb = norm.ppf(a.power)
        log_hr = (za + zb) / math.sqrt(a.events * v)
        res = {"hazardRatioBelow1": math.exp(-log_hr), "hazardRatioAbove1": math.exp(log_hr), "absLogHazardRatio": log_hr}
    return {"engine": "Schoenfeld (1983) events formula: d = (z_alpha + z_power)^2 / (p (1 - p) ln(HR)^2)", "solvedFor": unknown,
            "result": res}


def simulate(a) -> dict:
    import numpy as np
    size = a.events if a.design == "survival" else a.n
    if a.effect is None or size is None:
        raise UsageError("simulation needs --effect and --n (or --events); it estimates power")
    if a.power is not None:
        raise UsageError("simulation estimates power; do not pass --power")
    k_sims = a.simulations
    rng = np.random.default_rng(np.random.SeedSequence([a.seed]))
    alternative = "two-sided" if a.sides == "two" else "greater"
    if a.design == "two-group":
        from scipy.stats import ttest_ind
        n1, n2 = int(a.n), int(math.ceil(a.n * a.ratio - 1e-9))
        if n2 < 2:
            raise UsageError("--ratio leaves group 2 with fewer than 2 subjects")
        x = rng.normal(0.0, 1.0, (k_sims, n1))
        y = rng.normal(a.effect, a.sd_ratio, (k_sims, n2))
        p = ttest_ind(y, x, axis=1, equal_var=a.sd_ratio == 1, alternative=alternative).pvalue
        engine = "scipy.stats.ttest_ind (" + ("Student" if a.sd_ratio == 1 else "Welch") + ") on N(0,1) vs N(effect, sd_ratio)"
    elif a.design == "paired":
        from scipy.stats import ttest_1samp
        p = ttest_1samp(rng.normal(a.effect, 1.0, (k_sims, int(a.n))), 0.0, axis=1, alternative=alternative).pvalue
        engine = "scipy.stats.ttest_1samp on N(effect, 1) differences"
    elif a.design == "regression":
        import statsmodels.api as sm
        n, k, u = int(a.n), a.predictors, a.tested
        if n <= k + 1:
            raise UsageError("--n must exceed --predictors + 1")
        beta = np.r_[np.full(u, math.sqrt(a.effect / u)), np.zeros(k - u)]
        restriction = np.zeros((u, k + 1))
        restriction[np.arange(u), np.arange(u) + 1] = 1.0
        p = np.empty(k_sims)
        for i in range(k_sims):
            x = rng.normal(size=(n, k))
            y = x @ beta + rng.normal(size=n)
            p[i] = float(sm.OLS(y, sm.add_constant(x, has_constant="add")).fit().f_test(restriction).pvalue)
        engine = "statsmodels OLS F test of the tested coefficients; independent N(0,1) predictors, unit error variance"
    else:
        if a.sides != "two":
            raise UsageError("the log-rank simulation is two-sided only")
        from lifelines.statistics import logrank_test
        n = int(a.events)
        n1 = int(round(n * a.allocation))
        if n1 < 1 or n - n1 < 1:
            raise UsageError("--allocation leaves a group empty")
        p = np.empty(k_sims)
        for i in range(k_sims):
            t0 = rng.exponential(1.0, n - n1)
            t1 = rng.exponential(1.0 / a.effect, n1)
            p[i] = logrank_test(t1, t0).p_value
        engine = "lifelines.statistics.logrank_test; exponential times, every subject an event"
    if not np.all(np.isfinite(p)) or np.any((np.asarray(p) < 0) | (np.asarray(p) > 1)):
        raise UsageError("simulation returned invalid p-values; power is unavailable")
    rejections = int(np.sum(np.asarray(p) < a.alpha))
    return {"engine": engine, "solvedFor": "power", "simulations": k_sims, "seed": a.seed,
            "result": {"power": binomial_summary(rejections, k_sims)}}


def run(a) -> tuple[int, str, str, dict]:
    _check(a)
    import warnings
    from statsmodels.tools.sm_exceptions import ConvergenceWarning
    with warnings.catch_warnings():
        warnings.simplefilter("error", ConvergenceWarning)
        out = analytic(a) if a.method == "analytic" else simulate(a)
    if a.method == "analytic" and any(not math.isfinite(v) or v < 0 for v in out["result"].values()):
        raise UsageError("power solver returned an invalid result")
    inputs = {"design": a.design, "method": a.method, "alpha": a.alpha, "sides": a.sides, "effect": a.effect,
              "power": a.power}
    if a.design == "survival":
        inputs.update({"events": a.events, "allocation": a.allocation, "eventProb": a.event_prob})
    else:
        inputs["n"] = a.n
    if a.design == "two-group":
        inputs.update({"ratio": a.ratio, "sdRatio": a.sd_ratio})
    if a.design == "regression":
        inputs.update({"tested": a.tested, "predictors": a.predictors})
    effect_scale = {"two-group": "Cohen's d (difference / SD)", "paired": "d_z (mean difference / SD of differences)",
                    "regression": "Cohen's f2 of the tested predictors", "survival": "hazard ratio"}[a.design]
    res = out["result"]
    if a.method == "simulate":
        pw = res["power"]
        summary = f"{a.design}: simulated power {pw['rate']:.3f} (95% CI {pw['ci95'][0]:.3f}-{pw['ci95'][1]:.3f}) over {pw['trials']} draws"
    elif out["solvedFor"] == "size":
        if a.design == "survival":
            summary = f"survival: {res['events']} events" + (f" ({res['subjects']} subjects)" if "subjects" in res else "")
        elif a.design == "two-group":
            summary = f"two-group: n1 = {res['n1']}, n2 = {res['n2']} (total {res['total']})"
        else:
            summary = f"{a.design}: n = {res['n']}"
    elif out["solvedFor"] == "power":
        summary = f"{a.design}: power {res['power']:.4f}"
    else:
        summary = (f"{a.design}: minimum detectable hazard ratio {res['hazardRatioBelow1']:.4f} or {res['hazardRatioAbove1']:.4f}"
                   if a.design == "survival" else f"{a.design}: minimum detectable effect {res['effect']:.4f}")
    return 0, "computed", summary, {"inputs": inputs, "effectScale": effect_scale, **out, "software": software()}
