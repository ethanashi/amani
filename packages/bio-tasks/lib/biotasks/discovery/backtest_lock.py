"""Bind downloaded manifests and raw bytes to the reviewed public source lock, not a rehash."""
import json
from pathlib import Path
from .backtest_data import sha


def verify_locked(cache, lock):
    locked=json.loads(Path(lock).read_bytes())
    for name in ('dm-bt1-minikel-repro','dm-bt2-forward-2013','dm-bt4-open-chembl-2019','bt4-current-mesh-subset'):
        root=Path(cache)/('dm-bt4-open-chembl-2019' if name=='bt4-current-mesh-subset' else name)
        manifest=json.loads((root/('mesh-subset-sources.json' if name=='bt4-current-mesh-subset' else 'sources.json')).read_bytes())
        def identity(r):return (r['path'],r['url'],r['sha256'],r['bytes'],r['licence'])
        if sorted(map(identity,manifest['files']))!=sorted(map(identity,locked[name]['files'])):
            raise ValueError('source manifest differs from pinned public lock')
        for item in locked[name]['files']:
            p=root/item['path']
            if not p.resolve().is_relative_to(root.resolve()) or p.is_symlink() or sha(p)!=item['sha256'] or p.stat().st_size!=item['bytes']:
                raise ValueError('pinned raw source changed')
    return True
