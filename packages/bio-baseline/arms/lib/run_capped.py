#!/usr/bin/env python3
"""Run one command under a wall-clock cap, in its own process group.

  run_capped.py --cap-ms N --cwd DIR --stdout F --stderr F --status F [--grace-ms 5000] -- cmd ...

* stdin is /dev/null; stdout/stderr go to files (outside the agent's working dir).
* On cap expiry the whole process group gets SIGTERM, then SIGKILL after --grace-ms.
* SIGTERM/SIGINT/SIGHUP sent to this wrapper are forwarded to the group (operator cancel).
* After the leader exits, any process still in the group is SIGKILLed (stragglers).
* --status receives JSON: exit_code, signal, timed_out, cancelled, cap_ms, wall_ms.
Exit code: the child's exit code; 124 on timeout; 130 on cancel. Standard library only.
"""
from __future__ import annotations

import argparse
import json
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

from operation import reap_session


def killpg(pgid: int, sig: int) -> bool:
    try:
        os.killpg(pgid, sig)
        return True
    except (ProcessLookupError, PermissionError):
        return False


def main() -> int:
    # The bootstrap cannot execute agent code until its session identity is durable.
    if len(sys.argv) > 1 and sys.argv[1] == '--gate-exec':
        fd = int(sys.argv[2])
        allowed = os.read(fd, 1)
        os.close(fd)
        if allowed != b'G':
            return 130
        os.execvp(sys.argv[3], sys.argv[3:])
    ap = argparse.ArgumentParser()
    ap.add_argument("--cap-ms", type=int, required=True)
    ap.add_argument("--grace-ms", type=int, default=5000)
    ap.add_argument("--cwd", required=True)
    ap.add_argument("--stdout", required=True)
    ap.add_argument("--stderr", required=True)
    ap.add_argument("--status", required=True)
    ap.add_argument("--control", type=Path)
    ap.add_argument("cmd", nargs=argparse.REMAINDER)
    a = ap.parse_args()
    cmd = a.cmd[1:] if a.cmd and a.cmd[0] == "--" else a.cmd
    if not cmd:
        print("run_capped: no command", file=sys.stderr)
        return 2

    owner = os.getppid()
    state = {"cancelled": False}
    pgid = None
    def forward(signum, _frame):
        state["cancelled"] = True
        if pgid is not None:
            killpg(pgid, signal.SIGTERM)
    for sig in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
        signal.signal(sig, forward)
    t0 = time.monotonic()
    control = a.control
    def cancelled():
        return (state['cancelled'] or os.getppid() != owner or
                bool(control and (control / 'cancel.request').exists()))
    if control:
        (control / 'capped.ready').touch()
        while not (control / 'launch.ready').exists() and not cancelled():
            time.sleep(0.002)
    if os.environ.get('ARM_CAPPED_FAULT_AT') == 'handlers-installed':
        os.kill(os.getpid(), signal.SIGTERM)
    if cancelled():
        Path(a.stdout).touch()
        Path(a.stderr).touch()
        Path(a.status).write_text(json.dumps({'cancelled': True, 'timed_out': False,
                                             'exit_code': None, 'agent_started': False}))
        return 130
    gate_read, gate_write = os.pipe()
    # Keep the lease in this trusted wrapper and the arm shell. Never pass it to
    # untrusted code, which could otherwise unlock the shared flock description.
    with open(a.stdout, "wb") as out, open(a.stderr, "wb") as err:
        child = subprocess.Popen([sys.executable, __file__, '--gate-exec', str(gate_read), *cmd],
                                 cwd=a.cwd, stdin=subprocess.DEVNULL, stdout=out, stderr=err,
                                 start_new_session=True, pass_fds=(gate_read,))
    os.close(gate_read)
    pgid = child.pid
    identity = {'pid': child.pid, 'pgid': os.getpgid(child.pid), 'sid': os.getsid(child.pid)}
    if control:
        temporary = control / 'agent-process.json.tmp'
        temporary.write_text(json.dumps(identity))
        os.replace(temporary, control / 'agent-process.json')
    if os.environ.get('ARM_CAPPED_FAULT_AT') == 'child-gated':
        os.kill(os.getpid(), signal.SIGTERM)
    if not cancelled():
        try:
            os.write(gate_write, b'G')
        except BrokenPipeError:
            if not cancelled():
                raise
    os.close(gate_write)
    timed_out = False
    deadline = t0 + a.cap_ms / 1000.0
    while True:
        # Parent liveness is a kernel-backed lease; losing it cancels within 50 ms.
        if cancelled():
            state['cancelled'] = True
        if state['cancelled']:
            break
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            timed_out = True
            break
        try:
            child.wait(timeout=min(remaining, 0.05))
            break
        except subprocess.TimeoutExpired:
            if state["cancelled"]:
                break
    if timed_out or state["cancelled"]:
        killpg(pgid, signal.SIGTERM)
        try:
            child.wait(timeout=a.grace_ms / 1000.0)
        except subprocess.TimeoutExpired:
            killpg(pgid, signal.SIGKILL)
            child.wait()
    stragglers = killpg(pgid, signal.SIGKILL)  # leader gone; anything left in the group dies
    reap_session(identity)
    rc = child.returncode
    status = {
        "exit_code": rc if rc is not None and rc >= 0 else None,
        "signal": -rc if rc is not None and rc < 0 else None,
        "timed_out": timed_out,
        "cancelled": state["cancelled"],
        "cap_ms": a.cap_ms,
        "wall_ms": int((time.monotonic() - t0) * 1000),
        "stragglers_killed": stragglers,
    }
    with open(a.status, "w") as fh:
        json.dump(status, fh, sort_keys=True)
        fh.write("\n")
    if timed_out:
        return 124
    if state["cancelled"]:
        return 130
    return rc if rc is not None and rc >= 0 else 128 + (-rc if rc else 0)


if __name__ == "__main__":
    sys.exit(main())
