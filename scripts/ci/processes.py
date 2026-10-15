"""Subprocess lifetime tracking. Signals only exact child/descendant PIDs with matching births."""
import os
import signal
import subprocess
import time


def census():
    result = {}
    text = subprocess.check_output(['/bin/ps', '-axo', 'pid=,ppid=,pgid=,lstart='], text=True)
    for line in text.splitlines():
        pid, parent, group, birth = line.strip().split(None, 3)
        result[int(pid)] = (int(parent), int(group), birth)
    return result


def run(args, **kwargs):
    timeout = kwargs.pop('timeout')
    proc = subprocess.Popen(args, start_new_session=True, **kwargs)
    owned = {}
    started = time.monotonic()

    def discover():
        current = census()
        # A new session's process group is unique to our child. Also retain children
        # which create their own sessions while the observed parent identity matches.
        changed = True
        while changed:
            changed = False
            for pid, (parent, group, birth) in current.items():
                if pid in owned: continue
                if pid == proc.pid or group == proc.pid or (parent in owned and parent in current and current[parent][2] == owned[parent]):
                    owned[pid] = birth; changed = True
        return current

    def send(sig):
        current = discover()
        for pid, birth in list(owned.items()):
            if current.get(pid, (None, None, None))[2] == birth:
                try: os.kill(pid, sig)
                except ProcessLookupError: pass

    try:
        while proc.poll() is None:
            discover()
            if time.monotonic() - started > timeout:
                raise subprocess.TimeoutExpired(args, timeout)
            time.sleep(.2)
        return proc.returncode
    finally:
        send(signal.SIGTERM)
        # Give owned descendants time to exit before the checkout can be removed.
        deadline = time.monotonic() + 2
        while time.monotonic() < deadline:
            current = census()
            if not any(current.get(pid, (None, None, None))[2] == birth for pid, birth in owned.items()): break
            time.sleep(.1)
        send(signal.SIGKILL)
        proc.wait()
