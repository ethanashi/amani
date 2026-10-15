"""omb-sim command line: strict argparse; every outcome is one JSON document plus a summary.
Exit codes: 0 computed / no problem found; 1 problem found or not established; 2 usage or input error."""
from __future__ import annotations

import argparse
import math
import sys

from . import VERSION
from .common import InputError, UsageError, emit, split_command


class _Parser(argparse.ArgumentParser):
    def error(self, message):  # never exit from inside argparse: report as a usage error
        raise UsageError(message)


def _names(value: str) -> list[str]:
    items = value.split(",")
    if any(not x.strip() for x in items) or len(set(items)) != len(items):
        raise argparse.ArgumentTypeError("expected a comma-separated list of distinct non-blank names")
    return items


def _parser() -> argparse.ArgumentParser:
    p = _Parser(prog="omb-sim", add_help=True, allow_abbrev=False)
    p.add_argument("--version", action="version", version=f"omb-sim {VERSION}")
    sub = p.add_subparsers(dest="command", parser_class=_Parser)

    pw = sub.add_parser("power", allow_abbrev=False)
    pw.add_argument("--design", required=True, choices=["two-group", "paired", "regression", "survival"])
    pw.add_argument("--method", default="analytic", choices=["analytic", "simulate"])
    pw.add_argument("--effect", type=float)
    pw.add_argument("--n", type=float)
    pw.add_argument("--events", type=float)
    pw.add_argument("--power", type=float)
    pw.add_argument("--alpha", type=float, default=0.05)
    pw.add_argument("--sides", default="two", choices=["two", "one"])
    pw.add_argument("--ratio", type=float, default=1.0)
    pw.add_argument("--sd-ratio", type=float, default=1.0)
    pw.add_argument("--tested", type=int, default=1)
    pw.add_argument("--predictors", type=int)
    pw.add_argument("--allocation", type=float, default=0.5)
    pw.add_argument("--event-prob", type=float)
    pw.add_argument("--simulations", type=int, default=2000)
    pw.add_argument("--seed", type=int, default=0)
    pw.add_argument("--json-out")

    def runner_flags(sp):
        sp.add_argument("--result", required=True)
        sp.add_argument("--dir", default=".")
        sp.add_argument("--format", choices=["csv", "tsv", "json"])
        sp.add_argument("--within")
        sp.add_argument("--unit")
        sp.add_argument("--alpha", type=float, default=0.05)
        sp.add_argument("--seed", type=int, default=0)
        sp.add_argument("--jobs", type=int, default=1)
        sp.add_argument("--timeout-sec", type=float, default=600.0)
        sp.add_argument("--json-out")

    nc = sub.add_parser("null-calibration", allow_abbrev=False)
    nc.add_argument("--table", required=True)
    nc.add_argument("--label", required=True)
    nc.add_argument("--p-key", required=True)
    nc.add_argument("--permutations", type=int, default=100)
    nc.add_argument("--no-observed", dest="observed", action="store_false")
    runner_flags(nc)

    pe = sub.add_parser("planted-effect", allow_abbrev=False)
    pe.add_argument("--table", required=True)
    pe.add_argument("--label", default="group")
    pe.add_argument("--treated", default="treated")
    pe.add_argument("--control", default="control")
    pe.add_argument("--outcome", default="outcome")
    pe.add_argument("--effect", type=float, required=True)
    pe.add_argument("--mode", default="add", choices=["add", "multiply"])
    pe.add_argument("--truth", type=float)
    pe.add_argument("--outcome-table")
    pe.add_argument("--id")
    pe.add_argument("--estimate-key", required=True)
    pe.add_argument("--ci-keys")
    pe.add_argument("--ci-level", type=float, default=0.95)
    pe.add_argument("--p-key")
    pe.add_argument("--seeds", type=int, default=50)
    pe.add_argument("--generate", choices=["two-group"])
    pe.add_argument("--units-per-group", type=int)
    pe.add_argument("--replicates", type=int, default=1)
    pe.add_argument("--between-sd", type=float, default=0.0)
    pe.add_argument("--within-sd", type=float, default=1.0)
    runner_flags(pe)

    mt = sub.add_parser("multiplicity", allow_abbrev=False)
    mt.add_argument("--table", required=True)
    mt.add_argument("--p-column", required=True)
    mt.add_argument("--method", required=True, choices=["bh", "holm", "bonferroni"])
    mt.add_argument("--family-column")
    mt.add_argument("--single-family", action="store_true")
    mt.add_argument("--id-column")
    mt.add_argument("--alpha", type=float, default=0.05)
    mt.add_argument("--format", choices=["csv", "tsv", "json"])
    mt.add_argument("--out")
    mt.add_argument("--json-out")

    cf = sub.add_parser("confound-check", allow_abbrev=False)
    cf.add_argument("--table", required=True)
    cf.add_argument("--exposure", required=True)
    cf.add_argument("--columns", type=_names)
    cf.add_argument("--exclude", type=_names, default=[])
    cf.add_argument("--id-column")
    cf.add_argument("--categorical", type=_names, default=[])
    cf.add_argument("--numeric", type=_names, default=[])
    cf.add_argument("--max-levels", type=int, default=10)
    cf.add_argument("--strong", type=float, default=0.5)
    cf.add_argument("--format", choices=["csv", "tsv", "json"])
    cf.add_argument("--json-out")
    return p


def _json_out(argv: list[str]) -> str | None:
    head, _ = split_command(argv)
    for i, arg in enumerate(head):
        if arg == "--json-out" and i + 1 < len(head):
            return head[i + 1]
        if arg.startswith("--json-out="):
            return arg.split("=", 1)[1]
    return None


def main(argv: list[str]) -> int:
    options, command = split_command(argv)
    name = next((a for a in options if not a.startswith("-")), "omb-sim")
    try:
        try:
            import numpy  # noqa: F401
            import scipy  # noqa: F401
            import statsmodels  # noqa: F401
        except ImportError as exc:
            raise InputError(f"omb-sim needs numpy, scipy and statsmodels from the analysis environment ({exc}); "
                             "set OMB_PYTHON to that Python or source ./env.sh") from None
        args = _parser().parse_args(options)
        if args.command is None:
            raise UsageError("missing command: power, null-calibration, planted-effect, multiplicity, confound-check")
        name = args.command
        bad = sorted(k for k, v in vars(args).items() if isinstance(v, float) and not math.isfinite(v))
        if bad:
            raise UsageError(f"non-finite value for --{bad[0].replace('_', '-')}")
        if command and name not in ("null-calibration", "planted-effect"):
            raise UsageError("unexpected `--`")
        if name == "power":
            if args.predictors is None:
                args.predictors = args.tested
            from .power import run
            code, status, summary, payload = run(args)
        elif name == "null-calibration":
            from .permute import null_calibration
            code, status, summary, payload = null_calibration(args, command)
        elif name == "planted-effect":
            from .permute import planted_effect
            code, status, summary, payload = planted_effect(args, command)
        elif name == "multiplicity":
            from .multiplicity import run
            code, status, summary, payload = run(args)
        else:
            from .confound import run
            code, status, summary, payload = run(args)
    except UsageError as exc:
        code, status, summary, payload = 2, "usage-error", str(exc), {}
    except InputError as exc:
        code, status, summary, payload = 2, "input-error", str(exc), {}
    except Exception as exc:  # an unexpected failure is never a result
        code, status, summary, payload = 2, "error", f"{type(exc).__name__}: {exc}", {}
    try:
        return emit(name, code, status, summary, payload, _json_out(argv))
    except OSError as exc:
        sys.stderr.write(f"omb-sim {name}: cannot write output: {exc}\n")
        return 2
