"""Arm B adapter over the shared operation lease and SIGKILL finalizer.

Keep the calibrated baseline source unchanged. The only specialization is parsing the
hyphenated arm name when a killed shell must be finalized. All lease, process, signal and
cleanup behavior comes from the shared implementation; refuse if that boundary changes.
"""
import inspect
from pathlib import Path
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'bio-baseline/arms/lib'))
import operation

source = inspect.getsource(operation.supervise)
before = "arm = Path(cmd[1]).name.split('-')[1]"
after = "arm = Path(cmd[1]).name.removeprefix('run-').removesuffix('-arm.sh')"
if source.count(before) != 1:
    raise SystemExit('operation supervisor changed; review arm B finalizer adapter')
# Compile in the shared module globals: its __file__, roots, lease, finalizer and signal code
# remain exactly those of the baseline. No shared file is modified or copied at runtime.
exec(compile(source.replace(before, after), operation.__file__, 'exec'), operation.__dict__)

if __name__ == '__main__':
    raise SystemExit(operation.main())
