"""Kernel-held operation lease: arms and answer-bearing operations never overlap.

The supervisor and trusted arm shell/capped wrapper share the flock, so killing any
one of them cannot release the lease while the other owners are alive. No stale-age heuristic or persistent PID lock.
"""
from __future__ import annotations
import contextlib
import contextvars
import fcntl
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time


_held = contextvars.ContextVar("operation_lease", default=None)


def root() -> Path:
    p = Path(os.environ.get('BIO_GRADING_ROOT', str(Path.home() / '.omerta-bio/grading'))).resolve()
    # Overrides are for isolated tests, but must still be under the denied home root.
    if not p.is_relative_to(Path.home().resolve()):
        raise RuntimeError('grading root must be under the denied home root')
    p.mkdir(parents=True, exist_ok=True, mode=0o700)
    return p


@contextlib.contextmanager
def lease(kind='grading'):
    if os.environ.get('BIO_OPERATION') == kind or _held.get() == kind:
        yield None
        return
    with (root() / 'operations.lock').open('a+') as f:
        try:
            fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError('arm/grading operation active; refusing concurrent answer access') from None
        token = _held.set(kind)
        try:
            yield f.fileno()
        finally:
            _held.reset(token)


def guarded(fn):
    def call(*args, **kwargs):
        with lease():
            return fn(*args, **kwargs)
    return call


def reap_session(identity: dict) -> None:
    """Kill the recorded group and all groups still in its session, regardless of cwd."""
    try:
        os.killpg(identity['pgid'], signal.SIGKILL)
    except ProcessLookupError:
        pass
    census = subprocess.check_output(['ps', '-axo', 'pid='], text=True)
    for value in census.split():
        pid = int(value)
        try:
            if os.getsid(pid) == identity['sid']:
                os.kill(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass


def interrupted(result: Path) -> None:
    import armlib
    import shutil
    meta_path = result / 'meta.json'
    if not meta_path.exists():
        return
    m = json.loads(meta_path.read_text())
    if m.get('status') not in ('preparing', 'running'):
        return
    identity = result / 'agent-process.json'
    if identity.exists():
        reap_session(json.loads(identity.read_text()))
    # Also stop the capped wrapper if the shell did not already reap it.
    pid = m.get('capped_pid')
    if pid:
        try:
            os.kill(int(pid), signal.SIGTERM)
        except ProcessLookupError:
            pass
    work = Path(m['worktmp']) if m.get('worktmp') else None
    if work and work.name.startswith('bba.'):
        # Detached descendants are caught by their working directory as well as argv.
        census = subprocess.run(['lsof', '-d', 'cwd', '-Fpn'], capture_output=True, text=True).stdout
        current = None
        for line in census.splitlines():
            if line.startswith('p'):
                current = int(line[1:])
            elif line.startswith('n') and (line[1:] == str(work) or line[1:].startswith(str(work) + '/')):
                if current and current != os.getpid():
                    try:
                        os.kill(current, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
        for name in ('transcript.jsonl', 'stderr.log', 'run_status.json'):
            if (work / name).is_file():
                shutil.copy2(work / name, result / name)
        if m.get('arm') == 'omerta':
            adapter = Path(__file__).resolve().parents[2] / 'src/omerta-arm.ts'
            try:
                collected = subprocess.run(['node', str(adapter), 'collect', str(work), str(result)], capture_output=True, timeout=30)
                failed = collected.returncode != 0
            except (OSError, subprocess.TimeoutExpired):
                failed = True
            if failed:
                armlib.meta(meta_path, ['host_evidence_complete=false', 'evidence_error=true'])
        subprocess.run(['chmod', '-R', 'u+w', str(work)], capture_output=True)
        shutil.rmtree(work)
    armlib.meta(meta_path, ['status=interrupted', 'tmp_deleted=' + json.dumps(not work or not work.exists()),
                           'end=' + time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                           'lease_lost=true'])


def supervise(owner=None):
    kind, *cmd = sys.argv[1:]
    if cmd and cmd[0] == '--':
        cmd = cmd[1:]
    with lease(kind) as lease_fd:
        # flock's open-file description is shared with the arm shell and capped wrapper.
        # Killing only the watchdog cannot unlock a still-live arm.
        env = dict(os.environ, BIO_OPERATION=kind, BIO_LEASE_FD=str(lease_fd))
        child = subprocess.Popen(cmd, env=env, start_new_session=True, pass_fds=(lease_fd,))
        def forward(sig, _):
            try:
                os.kill(child.pid, sig)
            except ProcessLookupError:
                pass
        for sig in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
            signal.signal(sig, forward)
        while True:
            try:
                rc = child.wait(timeout=0.05)
                break
            except subprocess.TimeoutExpired:
                if owner is not None and os.getppid() != owner:
                    os.kill(child.pid, signal.SIGKILL)
                    rc = child.wait()
                    break
        if kind == 'arm' and rc < 0:
            # Kill setup/proxy descendants still in the shell session immediately.
            try:
                os.killpg(child.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            arm = Path(cmd[1]).name.split('-')[1]
            args = cmd[2:]
            results = os.environ.get('ARM_RESULTS_ROOT', str(Path(__file__).resolve().parents[2] / 'results'))
            if '--results-root' in args:
                results = args[args.index('--results-root') + 1]
            interrupted(Path(results) / f'{arm}-{args[0]}')
        return rc if rc >= 0 else 128 - rc


def main():
    if sys.argv[1] != 'arm':
        return supervise()
    # A detached watchdog survives SIGKILL of the CLI-facing runner. Its parent's
    # existence is a 50 ms renewable kernel lease, independent of wall-cap duration.
    owner = os.getpid()
    watcher = os.fork()
    if watcher == 0:
        os.setsid()
        return supervise(owner)
    def forward(sig, _):
        try:
            os.kill(watcher, sig)
        except ProcessLookupError:
            pass
    for sig in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
        signal.signal(sig, forward)
    _, status = os.waitpid(watcher, 0)
    return os.waitstatus_to_exitcode(status)


if __name__ == '__main__':
    sys.exit(main())
