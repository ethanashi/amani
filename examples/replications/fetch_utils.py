"""Deterministic public-source downloads and replay of retired-case disguises.

The recipe contains row/column permutations and identifier/category renamings;
quantitative measurements are read from downloaded source tables, never embedded.
"""
import csv
import gzip
import hashlib
import io
import json
import shutil
import urllib.request
from decimal import Decimal, localcontext, ROUND_HALF_EVEN
from pathlib import Path


def sha(data):
    return hashlib.sha256(data).hexdigest()


def download(url, dest, expected=None):
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    if not dest.exists():
        req = urllib.request.Request(url, headers={'User-Agent': 'Amani-retired-replications/1'})
        with urllib.request.urlopen(req, timeout=120) as response, dest.with_suffix(dest.suffix + '.part').open('wb') as out:
            shutil.copyfileobj(response, out)
        dest.with_suffix(dest.suffix + '.part').replace(dest)
    if expected and sha(dest.read_bytes()) != expected:
        raise RuntimeError('Source checksum differs: ' + dest.name)
    return dest


def table(data):
    if isinstance(data, (Path, str)):
        data = Path(data).read_bytes()
    if data[:2] == b'\x1f\x8b':
        data = gzip.decompress(data)
    rows = list(csv.reader(io.StringIO(data.decode()), delimiter='\t'))
    return rows[0], [r for r in rows[1:] if r]


def rounded(value, places):
    if value in ('', 'NA', 'n/a'):
        return value
    with localcontext() as context:
        context.prec, context.rounding = 80, ROUND_HALF_EVEN
        value = format(Decimal(value).quantize(Decimal(1).scaleb(-places)), 'f')
    return value[1:] if value.startswith('-') and not value.strip('-0.') else value


def project(recipe, sources, destination, here):
    """Replay a published curation recipe; verify every original served-file hash."""
    destination = Path(destination)
    destination.mkdir(parents=True, exist_ok=True)
    for spec in recipe['tables']:
        _, rows = table(sources[spec['source']])
        out = io.StringIO()
        out.write('\t'.join(spec['header']) + '\n')
        for n, source_index in enumerate(spec['rows']):
            original = rows[source_index]
            cells = []
            for col, source_col in enumerate(spec['columns']):
                value = original[source_col]
                rule = spec.get('rules', {}).get(str(col), {})
                if 'decimals' in rule:
                    value = rounded(value, rule['decimals'])
                if 'offset' in rule:
                    value = str(int(value) + rule['offset'])
                if 'map' in rule:
                    value = rule['map'][value]
                cells.append(value)
            if 'ids' in spec:
                cells[0] = spec['ids'][n]
            out.write('\t'.join(cells) + '\n')
        data = out.getvalue().encode()
        if sha(data) != spec['sha256']:
            raise RuntimeError('Projection checksum differs: ' + spec['file'])
        (destination / spec['file']).write_bytes(data)
    for name, text in recipe.get('registries', {}).items():
        (destination / name).write_text(text)
    for spec in recipe.get('licensed_annotations', []):
        data = gzip.decompress((here / spec['asset']).read_bytes())
        if sha(data) != spec['sha256']:
            raise RuntimeError('Annotation checksum differs')
        (destination / spec['file']).write_bytes(data)
    for name, expected in recipe['expected'].items():
        if sha((destination / name).read_bytes()) != expected:
            raise RuntimeError('Served-data checksum differs: ' + name)
    print('Recreated and verified', len(recipe['expected']), 'disguised input files in', destination)


def load_recipe(here):
    return json.loads(gzip.decompress((here / 'projection.json.gz').read_bytes()))
