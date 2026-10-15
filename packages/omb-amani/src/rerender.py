"""Rebind a source-only pilot report to freshly computed outputs (stdlib only)."""
import json
from pathlib import Path

config = json.loads(Path('code/amani/config/report.json').read_text())
report = config['skeleton']
for target, ref in config['refs'].items():
    file = Path(ref['file'])
    if file.is_absolute() or '..' in file.parts:
        raise ValueError('invalid frozen output reference')
    value = json.loads((Path('outputs') / file).read_text())
    for part in ref['pointer'].split('/')[1:]:
        part = part.replace('~1', '/').replace('~0', '~')
        value = value[int(part)] if isinstance(value, list) else value[part]
    parts = [p.replace('~1', '/').replace('~0', '~') for p in target.split('/')[1:]]
    dest = report
    for part in parts[:-1]:
        dest = dest[int(part)] if isinstance(dest, list) else dest[part]
    dest[int(parts[-1]) if isinstance(dest, list) else parts[-1]] = value
Path('results.json').write_text(json.dumps(report, allow_nan=False, indent=2) + '\n')
