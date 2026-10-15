"""Public-source cache with streaming hashes, disk floor and atomic publication. No test network."""
from __future__ import annotations
import hashlib
import json
import os
import shutil
import urllib.request
from pathlib import Path
from .blinding import canonical

COMMIT = 'b84cf0580b7df1af14b2c72068ed42b5aa0c52a4'
MINIKEL = f'https://raw.githubusercontent.com/ericminikel/genetic_support/{COMMIT}/'
FLOOR = 60 * 1024**3
CACHE = Path(os.environ.get('BIO_BACKTEST_CACHE', str(Path.home() / '.omerta-bio/datasets/discovery')))


def sha(path):
    with Path(path).open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()


def floor(path, reserve=0, free=lambda p: shutil.disk_usage(p).free):
    if free(path) - reserve < FLOOR:
        raise ValueError('60 GiB disk floor')


def fetch(url, dest, *, licence, retrieved_at, expected=None, opener=urllib.request.urlopen, free=lambda p: shutil.disk_usage(p).free):
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    if not url.startswith('https://') or licence not in ('CC-BY-4.0', 'CC0-1.0', 'CC-BY-SA-3.0', 'publisher-supplement-public-analysis-only'):
        raise ValueError('public HTTPS source with licensed use required')
    existed = dest.exists()
    if not existed:
        partial = dest.with_name(dest.name + '.partial')
        try:
            floor(dest.parent, free=free)
            with opener(url) as response, partial.open('xb') as out:
                for chunk in iter(lambda: response.read(1024*1024), b''):
                    floor(dest.parent, len(chunk), free)
                    out.write(chunk)
                out.flush()
                os.fsync(out.fileno())
            if expected and sha(partial) != expected:
                raise ValueError('source hash mismatch')
            partial.replace(dest)
        finally:
            partial.unlink(missing_ok=True)
    digest = sha(dest)
    if expected and digest != expected:
        raise ValueError('source hash mismatch')
    item = {'url': url, 'path': dest.name, 'sha256': digest, 'bytes': dest.stat().st_size,
            'licence': licence, 'retrievedAt': retrieved_at}
    sidecar = dest.with_name(dest.name+'.retrieval.json')
    if existed:
        candidates = []
        if sidecar.exists(): candidates.append(json.loads(sidecar.read_bytes()))
        for parent in list(dest.parents)[:4]:
            for name in ('sources.json', 'mesh-subset-sources.json'):
                manifest = parent/name
                if manifest.is_file(): candidates.extend(json.loads(manifest.read_bytes()).get('files', []))
        prior = next((r for r in candidates if r.get('url') == url and r.get('sha256') == digest and r.get('bytes') == item['bytes'] and r.get('licence') == licence and r.get('retrievedAt')), None)
        if prior is None: raise ValueError('cached source lacks retrieval provenance')
        item['retrievedAt'] = prior['retrievedAt']
    else:
        sidecar.write_bytes(canonical(item))
    return item


def write_manifest(path, value):
    path = Path(path)
    if path.exists() and json.loads(path.read_bytes()) == value: return
    partial = path.with_name(path.name+'.partial')
    try:
        partial.write_bytes(canonical(value)+b'\n'); partial.replace(path)
    finally:
        partial.unlink(missing_ok=True)


def download_minikel(*, retrieved_at):
    """Pin all public inputs and source, including supporting R files, never upstream outputs."""
    root = CACHE / 'dm-bt1-minikel-repro'
    tree = json.load(urllib.request.urlopen(f'https://api.github.com/repos/ericminikel/genetic_support/git/trees/{COMMIT}?recursive=1'))['tree']
    paths = [r['path'] for r in tree if r['type'] == 'blob' and (r['path'].startswith(('data/', 'src/')) or r['path'] in ('README.md', 'LICENSE.md', 'display_items/table_s22.tsv', 'oto/table_s22.tsv'))]
    manifest = []
    for path in paths:
        item = fetch(MINIKEL + path, root / path, licence='CC-BY-4.0', retrieved_at=retrieved_at)
        item['path'] = path
        manifest.append(item)
    write_manifest(root/'sources.json', {'commit': COMMIT, 'files': manifest})
    return root


def verify_sources(root):
    m = json.loads((Path(root) / 'sources.json').read_bytes())
    if not m.get('files'):
        raise ValueError('missing source manifest')
    for r in m['files']:
        path = Path(root) / r['path']
        if not path.resolve().is_relative_to(Path(root).resolve()) or path.is_symlink() or not path.is_file() or sha(path) != r['sha256'] or path.stat().st_size != r['bytes']:
            raise ValueError('source bytes changed')
    return m
