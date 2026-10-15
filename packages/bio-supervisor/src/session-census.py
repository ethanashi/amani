"""macOS ps does not expose getsid(2); use the system Python stdlib, fail closed."""
import errno
import json
import os
import sys

rows = json.load(sys.stdin)
result = []
for row in rows:
    try:
        row["session"] = os.getsid(row["pid"])
    except OSError as error:
        if error.errno == errno.ESRCH:
            # ps can still list a zombie after getsid returns ESRCH. Keep its group
            # so cleanup cannot certify absence until the parent has reaped it.
            row["session"] = 0
        else:
            raise
    result.append(row)
json.dump(result, sys.stdout)
