"""Shared plumbing for omb-sim: output contract, strict table I/O, fresh-copy execution of the
user's own command, and result extraction. No statistics live here."""
from __future__ import annotations

import csv
import io
import json
import math
import os
import shutil
import signal
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from . import VERSION

# Same markers as bio-checks `standardMissingMarkers` (compared trimmed, case-insensitively).
STANDARD_MISSING = ("", "NA", "N/A", "NaN", "null", "[Not Available]", "[Unknown]", "[Not Applicable]")
_MISSING_KEYS = {m.lower() for m in STANDARD_MISSING}
LINKED = ("env", ".pixi")
TAIL = 4096


class UsageError(Exception):
    """Bad invocation: nothing was computed (exit 2)."""


class InputError(Exception):
    """Unreadable or malformed input: nothing was computed (exit 2)."""


def is_missing(value: object) -> bool:
    return isinstance(value, str) and value.strip().lower() in _MISSING_KEYS


def clean_json(value):
    """Plain JSON: numpy scalars to Python, non-finite floats to null (strict JSON)."""
    if isinstance(value, dict):
        return {str(k): clean_json(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [clean_json(v) for v in value]
    if hasattr(value, "item") and not isinstance(value, (str, bytes)):
        value = value.item()
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    return value


def emit(command: str, exit_code: int, status: str, summary: str, payload: dict, json_out: str | None) -> int:
    doc = {"tool": "omb-sim", "version": VERSION, "command": command, "status": status, "exitCode": exit_code,
           "verified": exit_code == 0, "summary": summary, **payload}
    text = json.dumps(clean_json(doc), indent=2, allow_nan=False) + "\n"
    line = f"omb-sim {command}: {status} - {summary}\n"
    if json_out:
        Path(json_out).write_text(text)
        sys.stdout.write(line)
    else:
        sys.stdout.write(text)
        sys.stderr.write(line)
    return exit_code


def software() -> dict:
    import numpy
    import scipy
    out = {"numpy": numpy.__version__, "scipy": scipy.__version__}
    try:
        import statsmodels
        out["statsmodels"] = statsmodels.__version__
    except ImportError:  # pragma: no cover - environment check reports it
        pass
    return out


# ------------------------------------------------------------------ tables

class Table:
    """A row-axis table: header order, rows as lists of strings, and its on-disk format."""

    def __init__(self, path: Path, fmt: str, header: list[str], rows: list[list[str]]):
        self.path, self.fmt, self.header, self.rows = path, fmt, header, rows
        self.index = {name: i for i, name in enumerate(header)}

    def column(self, name: str) -> list[str]:
        if name not in self.index:
            raise InputError(f"{self.path.name} has no column {name!r}")
        i = self.index[name]
        return [row[i] for row in self.rows]

    def set_column(self, name: str, values: list[str]) -> None:
        i = self.index[name]
        for row, value in zip(self.rows, values):
            row[i] = value


def table_format(path: Path, fmt: str | None) -> str:
    fmt = fmt or path.suffix.lower().lstrip(".")
    if fmt not in ("csv", "tsv", "json"):
        raise UsageError(f"cannot tell the table format of {path.name}; pass --format csv|tsv|json")
    return fmt


def strict_json(text):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError(f"duplicate JSON key: {key}")
            result[key] = value
        return result
    def invalid(value):
        raise ValueError(f"non-finite JSON: {value}")
    def finite_float(value):
        number = float(value)
        if not math.isfinite(number):
            raise ValueError("non-finite JSON number")
        return number
    return json.loads(text, object_pairs_hook=unique, parse_constant=invalid, parse_float=finite_float)


def local_path(root: Path, relative: str) -> Path:
    """Declared data/result paths cannot traverse links (including the linked runtime)."""
    p = Path(relative)
    if p.is_absolute() or not p.parts or ".." in p.parts or p.parts[0] in LINKED:
        raise InputError("data/result path must stay in the copied work directory")
    target = root
    for part in p.parts:
        target = target / part
        if target.is_symlink():
            raise InputError("data/result path traverses a symlink")
    return target


def read_table(path: Path, fmt: str | None = None) -> Table:
    fmt = table_format(path, fmt)
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        raise InputError(f"cannot read {path}: {exc}") from None
    if fmt == "json":
        try:
            data = strict_json(text)
        except ValueError as exc:
            raise InputError(f"{path.name}: invalid JSON ({exc})") from None
        if not isinstance(data, list) or not data or not all(isinstance(r, dict) for r in data):
            raise InputError(f"{path.name}: JSON table must be a non-empty array of objects")
        header = list(data[0].keys())
        if not header or any(not name.strip() for name in header):
            raise InputError(f"{path.name}: blank or missing header")
        if any(list(r.keys()) != header and sorted(r.keys()) != sorted(header) for r in data):
            raise InputError(f"{path.name}: inconsistent record schema")
        rows = []
        for r in data:
            row = []
            for k in header:
                v = r[k]
                if isinstance(v, (dict, list)) or isinstance(v, bool):
                    raise InputError(f"{path.name}: field {k!r} holds a non-scalar or boolean value")
                row.append("" if v is None else (repr(v) if isinstance(v, float) else str(v)))
            rows.append(row)
        return Table(path, fmt, header, rows)
    try:
        reader = csv.reader(io.StringIO(text, newline=""), delimiter="," if fmt == "csv" else "\t", strict=True)
        records = [r for r in reader]
    except csv.Error as exc:
        raise InputError(f"{path.name}: malformed delimited table ({exc})") from None
    if len(records) < 2:
        raise InputError(f"{path.name}: table needs a header and at least one row")
    header, rows = records[0], records[1:]
    if any(not h.strip() for h in header) or len(set(header)) != len(header):
        raise InputError(f"{path.name}: blank or duplicate header")
    if any(len(r) != len(header) for r in rows):
        raise InputError(f"{path.name}: ragged table")
    return Table(path, fmt, header, rows)


def write_table(table: Table, path: Path) -> None:
    if table.fmt == "json":
        path.write_text(json.dumps([dict(zip(table.header, r)) for r in table.rows], indent=1) + "\n")
        return
    buf = io.StringIO()
    writer = csv.writer(buf, delimiter="," if table.fmt == "csv" else "\t", lineterminator="\n",
                        quoting=csv.QUOTE_MINIMAL)
    writer.writerow(table.header)
    writer.writerows(table.rows)
    if path.exists():
        path.chmod(0o644)
    path.write_text(buf.getvalue(), encoding="utf-8")


def parse_number(value: str, what: str) -> float:
    try:
        x = float(value)
    except (TypeError, ValueError):
        raise InputError(f"{what}: {value!r} is not a number") from None
    if not math.isfinite(x):
        raise InputError(f"{what}: {value!r} is not finite")
    return x


def format_number(x: float) -> str:
    """Shortest round-trip text; integers stay integral."""
    if float(x).is_integer() and abs(x) < 1e15:
        return str(int(x))
    return repr(float(x))


# ------------------------------------------------------------------ binomial

def binomial_summary(successes: int, trials: int, nominal: float | None = None) -> dict:
    """Proportion with the exact (Clopper-Pearson) 95% interval from scipy."""
    from scipy.stats import binomtest
    if trials == 0:
        return {"count": 0, "trials": 0, "rate": None, "ci95": None}
    test = binomtest(successes, trials, nominal if nominal is not None else 0.5)
    ci = test.proportion_ci(confidence_level=0.95, method="exact")
    out = {"count": successes, "trials": trials, "rate": successes / trials, "ci95": [ci.low, ci.high]}
    if nominal is not None:
        out["nominal"] = nominal
        out["binomialTestP"] = test.pvalue
    return out


# ------------------------------------------------------------------ fresh copies

def split_command(argv: list[str]) -> tuple[list[str], list[str]]:
    if "--" not in argv:
        return argv, []
    i = argv.index("--")
    return argv[:i], argv[i + 1:]


CLONE_THRESHOLD = 64 * 1024 * 1024


def _size(path: Path) -> int:
    if path.is_symlink() or not path.is_dir():
        return path.lstat().st_size
    return sum(_size(child) for child in path.iterdir())


def copy_tree(src: Path, dst: Path) -> None:
    """Fresh copy of SRC (modes, mtimes and symlinks kept; entries of 64 MB or more as APFS clones
    via `cp -c` when available); the analysis environment entries are linked, not copied."""
    dst.mkdir(parents=True)
    for entry in sorted(src.iterdir(), key=lambda p: p.name):
        target = dst / entry.name
        if entry.name in LINKED:
            target.symlink_to(entry)
            continue
        if _size(entry) < CLONE_THRESHOLD:
            if entry.is_symlink():
                target.symlink_to(os.readlink(entry))
            elif entry.is_dir():
                shutil.copytree(entry, target, symlinks=True)
            else:
                shutil.copy2(entry, target)
            continue
        r = subprocess.run(["/bin/cp", "-c", "-R", "-p", str(entry), str(target)], capture_output=True)
        if r.returncode != 0:
            if target.exists() or target.is_symlink():
                remove_tree(target)
            if entry.is_symlink():
                target.symlink_to(os.readlink(entry))
            elif entry.is_dir():
                shutil.copytree(entry, target, symlinks=True)
            else:
                shutil.copy2(entry, target)


def remove_tree(path: Path) -> None:
    if path.is_symlink() or path.is_file():
        path.unlink()
        return
    for root, dirs, _ in os.walk(path):
        for d in dirs:
            p = Path(root) / d
            if not p.is_symlink():
                p.chmod(0o700)
    path.chmod(0o700)
    shutil.rmtree(path)


def run_command(command: list[str], cwd: Path, timeout_sec: float) -> dict:
    try:
        proc = subprocess.Popen(command, cwd=str(cwd), stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                stdin=subprocess.DEVNULL, start_new_session=True)
    except OSError as exc:
        return {"exitCode": None, "timedOut": False, "stderrTail": str(exc)}
    timed_out = False
    try:
        out, err = proc.communicate(timeout=timeout_sec)
    except subprocess.TimeoutExpired:
        timed_out = True
        os.killpg(proc.pid, signal.SIGKILL)
        out, err = proc.communicate()
    try:
        os.killpg(proc.pid, signal.SIGKILL)  # stragglers must not keep writing
    except (ProcessLookupError, PermissionError):
        pass
    return {"exitCode": proc.returncode, "timedOut": timed_out,
            "stderrTail": err[-TAIL:].decode("utf-8", "replace")}


def extract(doc, key: str):
    """Dotted path into JSON: object keys and list indices (e.g. `effect.ci.0`)."""
    value = doc
    for part in key.split("."):
        if isinstance(value, dict) and part in value:
            value = value[part]
        elif isinstance(value, list) and part.isdigit() and int(part) < len(value):
            value = value[int(part)]
        else:
            raise KeyError(key)
    return value


def read_numbers(result_path: Path, keys: dict[str, str]) -> dict[str, float]:
    """Finite numbers at each dotted key of the result JSON; any problem raises ValueError."""
    try:
        doc = strict_json(result_path.read_text())
    except (OSError, ValueError) as exc:
        raise ValueError(f"result file unreadable: {exc}") from None
    out = {}
    for name, key in keys.items():
        try:
            value = extract(doc, key)
        except KeyError:
            raise ValueError(f"result has no {key!r}") from None
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            raise ValueError(f"result {key!r} is not a finite number")
        out[name] = float(value)
    return out


class Runner:
    """Runs the user's command in fresh copies of a directory, one per job index, in parallel,
    with results returned in index order (determinism does not depend on scheduling)."""

    def __init__(self, source: Path, command: list[str], result: str, keys: dict[str, str], timeout_sec: float,
                 jobs: int):
        self.source, self.command, self.result, self.keys = source, command, result, keys
        self.timeout_sec, self.jobs = timeout_sec, jobs
        self.scratch = Path(tempfile.mkdtemp(prefix="omb-sim-"))

    def one(self, index: int, prepare) -> dict:
        copy = self.scratch / f"run{index}"
        try:
            copy_tree(self.source, copy)
            info = prepare(copy) or {}
            result_file = local_path(copy, self.result)
            if result_file.exists():
                result_file.unlink()  # a stale result must never be read as this run's output
            outcome = run_command(self.command, copy, self.timeout_sec)
            record = {"index": index, **info, "exitCode": outcome["exitCode"], "timedOut": outcome["timedOut"]}
            if outcome["exitCode"] != 0 or outcome["timedOut"]:
                record["error"] = "command timed out" if outcome["timedOut"] else f"command exited {outcome['exitCode']}"
                record["stderrTail"] = outcome["stderrTail"]
                return record
            try:
                record["values"] = read_numbers(local_path(copy, self.result), self.keys)
            except ValueError as exc:
                record["error"] = str(exc)
            return record
        except (InputError, OSError) as exc:
            return {"index": index, "error": f"preparation failed: {exc}"}
        finally:
            if copy.exists() or copy.is_symlink():
                remove_tree(copy)

    def run_all(self, prepares: list) -> list[dict]:
        with ThreadPoolExecutor(max_workers=self.jobs) as pool:
            return list(pool.map(lambda pair: self.one(*pair), list(enumerate(prepares))))

    def close(self) -> bool:
        if self.scratch.exists():
            remove_tree(self.scratch)
        return not self.scratch.exists()
