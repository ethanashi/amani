"""Run the host-authored answer_key.py on UNBLINDED source-format copies with projected numeric values, in a scrubbed environment.

Protocol: `python -I -B answer_key.py SOURCES_DIR`, where SOURCES_DIR holds each source
under its case name (retained decimals already rounded/perturbed as in the projection). The script prints one canonical JSON object (sorted keys, compact
separators, optional single trailing newline) and exits 0. Anything else refuses the build.

The child gets a fixed minimal environment (no host variables), a private HOME/TMPDIR/cwd in the
grading-root scratch, no stdin, and on macOS a seatbelt profile that denies all network, denies
reading the host sealing key and denies writes outside its own run directory. It runs `runs`
times; differing output refuses (a nondeterministic key cannot grade anything). Its stderr is
never echoed, because a debugging print could carry answer values.
"""
from __future__ import annotations

import os
import signal
import subprocess
import sys
from pathlib import Path

from . import jsonio

MAX_OUTPUT = 8 << 20
SEATBELT = '/usr/bin/sandbox-exec'


class AnswerKeyError(ValueError):
    pass


def _quote(path: Path) -> str:
    return '"' + str(path).replace('\\', '\\\\').replace('"', '\\"') + '"'


def profile(run_dir: Path, denied_reads: list[Path], *, private_root: Path | None = None,
            readable: tuple[Path, ...] = ()) -> str:
    """Seatbelt rules (later rules win): no network; no reads of the host key; no reads anywhere in
    the private host root (other cards, registry, downloads) except this run's own sources and
    answer directory; writes only inside the run directory."""
    rules = ['(version 1)', '(allow default)', '(deny network*)']
    if private_root is not None:
        rules.append(f'(deny file-read* (subpath {_quote(private_root)}))')
        rules += [f'(allow file-read* (subpath {_quote(p)}))' for p in readable]
    rules += [f'(deny file-read* (literal {_quote(p)}))' for p in denied_reads]
    rules += ['(deny file-write*)', f'(allow file-write* (subpath {_quote(run_dir)}) (literal "/dev/null"))']
    return ''.join(rules)


def environment(run_dir: Path) -> dict:
    return {'PATH': '/usr/bin:/bin', 'HOME': str(run_dir / 'home'), 'TMPDIR': str(run_dir / 'tmp'),
            'LANG': 'C', 'LC_ALL': 'C', 'PYTHONHASHSEED': '0', 'PYTHONDONTWRITEBYTECODE': '1',
            'OPENBLAS_NUM_THREADS': '1', 'OMP_NUM_THREADS': '1', 'MKL_NUM_THREADS': '1', 'VECLIB_MAXIMUM_THREADS': '1'}


def _command(script: Path, sources: Path, run_dir: Path, denied_reads: list[Path], private_root: Path | None) -> list[str]:
    base = [sys.executable, '-I', '-B', str(script), str(sources)]
    if sys.platform == 'darwin':
        if not Path(SEATBELT).is_file():
            raise AnswerKeyError('answer key sandbox unavailable')
        rules = profile(run_dir, denied_reads, private_root=private_root, readable=(sources, script.parent))
        return [SEATBELT, '-p', rules, *base]
    raise AnswerKeyError('answer key sandbox unavailable on this platform')


def _run_once(script: Path, sources: Path, run_dir: Path, timeout: float, denied_reads: list[Path],
              private_root: Path | None) -> bytes:
    for sub in ('home', 'tmp', 'work'):
        (run_dir / sub).mkdir(parents=True, mode=0o700)
    proc = subprocess.Popen(_command(script, sources, run_dir, denied_reads, private_root), cwd=run_dir / 'work',
                            env=environment(run_dir), stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                            stderr=subprocess.DEVNULL, start_new_session=True)
    try:
        out, _ = proc.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        try:
            # Only the group this function started; the leader is unreaped, so the id is ours.
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        proc.communicate()
        raise AnswerKeyError('answer key timed out') from None
    if proc.returncode != 0:
        raise AnswerKeyError(f'answer key exited with status {proc.returncode}')
    if len(out) > MAX_OUTPUT:
        raise AnswerKeyError('answer key output over the size limit')
    return out


def parse(out: bytes) -> dict:
    try:
        value = jsonio.loads(out)
    except (ValueError, UnicodeDecodeError):
        raise AnswerKeyError('answer key output is not strict JSON') from None
    if not isinstance(value, dict) or not value:
        raise AnswerKeyError('answer key must print a non-empty JSON object')
    canonical = jsonio.canonical(value)
    if out not in (canonical, canonical + b'\n'):
        raise AnswerKeyError('answer key output is not canonical JSON')
    return value


def run(case_dir: Path, sources_dir: Path, scratch: Path, *, timeout: float, runs: int, denied_reads: list[Path],
        private_root: Path | None = None) -> tuple[dict, str, str]:
    """Return (answer, sha256 of its canonical bytes, sha256 of answer_key.py). The caller removes scratch.

    sources_dir holds the verified private source copies (named by source); the sandbox lets the
    script read them but write only inside its own run directory."""
    script_src = Path(case_dir) / 'answer_key.py'
    scratch = Path(scratch)
    scratch.mkdir(parents=True, mode=0o700)
    try:
        raw = jsonio.read_regular(script_src, limit=4 << 20)
    except (OSError, ValueError):
        raise AnswerKeyError('answer_key.py missing or not a regular file') from None
    script = (scratch / 'answer_key.py').resolve()
    script.write_bytes(raw)
    outputs = []
    for i in range(runs):
        outputs.append(_run_once(script, Path(sources_dir).resolve(), (scratch / f'run-{i}').resolve(), timeout,
                                 denied_reads, Path(private_root).resolve() if private_root else None))
    if len(set(outputs)) != 1:
        raise AnswerKeyError('answer key is nondeterministic across runs')
    answer = parse(outputs[0])
    return answer, jsonio.sha256_bytes(jsonio.canonical(answer)), jsonio.sha256_bytes(raw)
