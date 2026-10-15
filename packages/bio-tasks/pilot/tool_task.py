"""Reuse the calibrated run-task script, adapting only arm B dispatch.

The original file is a p16 calibration binding. Keep it byte-identical: this host-owned
adapter adds an arm name without changing staging or grading. Native recovery requires
a separately reviewed adapter; it is refused before staging or launching an arm.
"""
import os
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
ORIGINAL = HERE.parent / 'run-task.sh'


def adapted_source():
    source = ORIGINAL.read_text()
    case = 'case "$ARM" in claude|codex|omerta)'
    if source.count(case) != 1:
        raise ValueError('task runner changed; review tools dispatch adapter')
    return source.replace(case, 'case "$ARM" in claude|codex|omerta|codex-tools)')


if __name__ == '__main__':
    if len(sys.argv) < 4 or sys.argv[2] != 'codex-tools':
        raise SystemExit('tools task adapter requires TASK codex-tools ATTEMPT')
    if sys.argv[1] == 'p16-recovery':
        raise SystemExit('codex-tools native recovery is unavailable; refusing ordinary-task fallback')
    os.execv('/bin/bash', ['bash', '-c', adapted_source(), str(ORIGINAL), *sys.argv[1:]])
