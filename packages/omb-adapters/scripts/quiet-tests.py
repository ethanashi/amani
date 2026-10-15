#!/usr/bin/env python3
"""Acquire the existing operation lock read-only before running checks. Never reads pilot state.
Exit 75 means busy: the caller should wait, not run tests outside the lease.
Use --wait for a kernel-blocking wait with no polling or sleep. No files are created.
"""
import fcntl
import os
from pathlib import Path
import subprocess
import sys
lock = Path.home() / '.omerta-bio/grading/operations.lock'
if not lock.is_file():
    raise SystemExit('existing arm/grading lock missing; quiet-machine check unavailable')
args = sys.argv[1:]
wait = bool(args and args[0] == '--wait')
if wait:
    args.pop(0)
with lock.open('r') as handle:
    try:
        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        print('arm/grading operation active; waiting required', file=sys.stderr, flush=True)
        if not wait:
            raise SystemExit(75)
        fcntl.flock(handle, fcntl.LOCK_EX)
    raise SystemExit(subprocess.call(args))
