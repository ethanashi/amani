"""The analyst projection: blinded data files, alias registries, TASK.md, DATA-CONTRACT.json and
manifest.json, normalized and verified with KA0's metadata/lstat rules (discovery/metadata.py).

`write` receives public structures only (blinded rows, public column descriptors, the rendered
prompt, the public criteria view). It never sees the case, the keyed maps or the answer key, so
nothing private can be serialized by construction; the leakage scan is defence in depth.
`render_task` is the one host-side step that touches keyed maps: it resolves {{ns:original}}
placeholders into tokens and reports exactly which tokens it introduced.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
from pathlib import Path

from ..discovery.contracts import alias_registry
from ..discovery.metadata import normalize, verify_metadata
from . import jsonio
from .tables import shape, TableError

CONTRACT_SCHEMA = 'omb-oneshot-contract/v1'
PROJECTION_PATH = re.compile(r'^(?:TASK\.md|DATA-CONTRACT\.json|data/[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.(?:tsv|csv|csv\.gz|xlsx|zip|parquet|xpt|sav|dta|json))$')
PLACEHOLDER = re.compile(r'\{\{([a-z][a-z0-9]{0,23}):([^{}\n]{1,200})\}\}')
LIMITATIONS = [
    'Identifiers, dataset names, categorical levels and chromosome labels are keyed tokens; originals are host-only.',
    'Row order, matrix column order and the order inside list cells are keyed permutations of the source order unless the contract says source; never infer meaning from order.',
    'A table marked subset holds the rows of its public source selected by a declared filter (for example a genomic region), not the whole source.',
    'Remapped genomic coordinates preserve order within a chromosome token but not distances; shifted coordinates preserve distances.',
    'Decimal columns are byte-exact copies of the source unless a rounding precision is declared for that column.',
    'Decimal columns or matrix cells marked perturb carry keyed noise of the stated scale (absolute, or relative to the value) before rounding.',
]


FILES_NOTE = '- `DATA-CONTRACT.json` (columns, roles, precision and identifier namespaces)'
REPORT_INTRO = ['Write `report.json`: a single JSON object. Only these fields are graded; each field is a JSON',
                'pointer into that object.']
CLOSING = ['Identifiers, dataset names and category levels are keyed tokens. Report identifiers exactly as',
           'they appear in the data files. Grading returns only each criterion name with pass or fail.']
# Every fixed word the projection itself prints (contract keys and enum values, registry header,
# file names, generated TASK.md text). A renamed or dropped column called e.g. `gene` or `id`
# says nothing about the case, so it is not protected against these words.
CONTRACT_WORDS = '''schema_version synthetic datasets namespaces tables report limitations id kind entries registry
    path sha256 dataset layout rows columns matrix row_order missing name role storage namespace separator precision
    decimals significant levels chromosome coordinates header_namespace cells order allowed description content hash
    public files publicContractHash records keyed source exact string decimal integer text categorical position
    remapped shifted drop gene protein sample snp compound verdict band set sign encoding original canonical target
    list_order subset perturb absolute relative
    token data aliases tsv json md manifest task contract omb oneshot v1 true false null'''


class ProjectionError(ValueError):
    pass


def table_path(letter: str, public_name: str) -> str:
    return f'data/{letter}-{public_name}.tsv'


def render_task(prompt: str, *, namespaces: dict, datasets: dict, levels: dict, files: list[str], report: list[dict]) -> tuple[str, set]:
    """Resolve placeholders; return TASK.md text and the set of tokens it introduced."""
    introduced = set()

    def replace(match):
        kind, value = match.group(1), match.group(2)
        if kind == 'dataset':
            if value not in datasets:
                raise ProjectionError('prompt names an unknown dataset placeholder')
            return datasets[value]
        if kind == 'level':
            column, _, original = value.partition('/')
            mapping = levels.get(column)
            if mapping is None or original not in mapping:
                raise ProjectionError('prompt names an unknown level placeholder')
            return mapping[original]
        if kind not in namespaces or value not in namespaces[kind]:
            raise ProjectionError('prompt names an unknown identifier placeholder')
        introduced.add(namespaces[kind][value])
        return namespaces[kind][value]

    body = PLACEHOLDER.sub(replace, prompt)
    if '{{' in body or '}}' in body:
        raise ProjectionError('prompt has a malformed placeholder')
    lines = [body.rstrip(), '', '## Files', '']
    for path in files:
        lines.append(f'- `{path}`')
    lines += [FILES_NOTE, '', '## Report', '', *REPORT_INTRO, '']
    for c in report:
        lines.append(f'- `{c["report"]}` (criterion `{c["name"]}`): {describe(c)}' +
                     (f' {c["description"]}' if c.get('description') else ''))
    lines += ['', *CLOSING, '']
    return '\n'.join(lines), introduced


def describe(c: dict) -> str:
    ns = c.get('namespace')
    if ns == 'dataset':
        return 'one dataset letter.' if c['kind'] == 'exact' else 'a list of distinct dataset letters.'
    if ns == 'chromosome':
        return ('one chromosome label as it appears in the data.' if c['kind'] == 'exact' else
                'a list of distinct chromosome labels as they appear in the data.')
    if ns == 'position':
        return 'one genomic position as it appears in the data.'
    if isinstance(ns, str) and ns.startswith('level/'):
        column = ns.split('/', 1)[1]
        return f'one level of column `{column}`.' if c['kind'] == 'exact' else f'a list of distinct levels of column `{column}`.'
    if c['kind'] == 'verdict':
        return 'exactly one of ' + ', '.join(f'`{a}`' for a in c['allowed']) + '.'
    if c['kind'] == 'band':
        return 'a number.'
    if c['kind'] == 'sign':
        return 'a number; its sign is graded.'
    if c['kind'] == 'set':
        return f'a list of distinct identifiers from namespace `{ns}`.' if ns else 'a list of distinct strings.'
    return f'one identifier from namespace `{ns}`.' if ns else 'one JSON string, number or boolean.'


def write(dest: Path, *, tables: list[dict], registries: dict, task_md: str, report: list[dict],
          datasets: list[str], synthetic: bool, attachments: list | None = None) -> tuple[str, set]:
    """Write the projection into a fresh dest. Return (manifest sha256, file set).

    tables: [{path, file, sha256, dataset, layout, rows, columns, matrix, row_order, missing, subset}]
            (file: an already blinded TSV written by tables.blind, moved into place)
    registries: {namespace: {kind, tokens}} (tokens only)
    """
    dest = Path(dest)
    dest.mkdir(mode=0o700)
    (dest / 'data').mkdir(mode=0o700)
    payloads: dict[str, bytes] = {}
    hashes: dict[str, str] = {}
    described_tables, described_ns = [], []
    for t in tables:
        if t['path'] in hashes or not PROJECTION_PATH.match(t['path']):
            raise ProjectionError('two tables share one projected path, or a path is outside the allowlist')
        os.replace(t['file'], dest / t['path'])
        hashes[t['path']] = t['sha256']
        described_tables.append({'path': t['path'], 'sha256': t['sha256'], 'dataset': t['dataset'],
                                 'layout': t['layout'], 'rows': t['rows'], 'columns': t['columns'],
                                 'matrix': t['matrix'], 'row_order': t['row_order'], 'missing': t['missing'],
                                 'subset': t['subset']})
    for ns in sorted(registries):
        descriptor, raw = alias_registry(ns, registries[ns]['tokens'])
        path = descriptor['file']['path']
        if path in hashes:
            raise ProjectionError('registry path collides with a table')
        payloads[path] = raw
        described_ns.append({'id': ns, 'kind': registries[ns]['kind'], 'entries': descriptor['entry_count'],
                             'registry': descriptor['file']})
    content = {'schema_version': CONTRACT_SCHEMA, 'synthetic': synthetic, 'datasets': sorted(datasets),
               'namespaces': described_ns, 'tables': described_tables, 'report': report, 'limitations': LIMITATIONS}
    if attachments:
        if not synthetic:
            raise ProjectionError('raw attachments are synthetic development data only')
        content['attachments'] = []
        for item in attachments:
            name = item['path']
            if name in hashes or not PROJECTION_PATH.fullmatch(name):
                raise ProjectionError('invalid or duplicate attachment path')
            os.replace(item['file'], dest / name)
            hashes[name] = item['sha256']
            content['attachments'].append({'path': name, 'sha256': item['sha256'], 'blinding': 'none-synthetic-development', **({'columns':item['columns']} if 'columns' in item else {})})
        content['limitations'] = [*LIMITATIONS, 'Declared attachments are synthetic development inputs preserved byte for byte; their identifiers are not blinded.']
    public = {'content': content, 'hash': jsonio.digest(content)}
    payloads['DATA-CONTRACT.json'] = jsonio.canonical_line({'public': public})
    payloads['TASK.md'] = task_md.encode('utf-8')
    for name in payloads:
        if not PROJECTION_PATH.match(name):
            raise ProjectionError('projected path outside the allowlist')
    hashes.update({name: hashlib.sha256(raw).hexdigest() for name, raw in payloads.items()})
    manifest = {'synthetic': synthetic, 'files': dict(sorted(hashes.items())), 'publicContractHash': public['hash']}
    payloads['manifest.json'] = jsonio.canonical_line(manifest)
    for name, raw in payloads.items():
        with open(dest / name, 'xb') as f:
            f.write(raw)
    files = set(payloads) | set(hashes)
    normalize(dest, files)
    verify_metadata(dest, files)
    return hashlib.sha256(payloads['manifest.json']).hexdigest(), files


def files_of(root: Path, expected_manifest_hash: str) -> tuple[dict, set]:
    """Read and pin manifest.json; return (manifest, exact file allowlist) before any other read."""
    root = Path(root)
    raw = jsonio.read_regular(root / 'manifest.json', limit=8 << 20)
    if hashlib.sha256(raw).hexdigest() != expected_manifest_hash:
        raise ProjectionError('manifest changed')
    m = jsonio.loads(raw)
    if not isinstance(m, dict) or set(m) != {'synthetic', 'files', 'publicContractHash'} or raw != jsonio.canonical_line(m):
        raise ProjectionError('manifest not canonical')
    if type(m['synthetic']) is not bool or not isinstance(m['files'], dict):
        raise ProjectionError('manifest malformed')
    names = set(m['files'])
    if not {'TASK.md', 'DATA-CONTRACT.json'} <= names or any(not PROJECTION_PATH.match(n) for n in names):
        raise ProjectionError('manifest names a path outside the allowlist')
    return m, names | {'manifest.json'}


def _count_lines(path: Path) -> int:
    fd = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
    with os.fdopen(fd, 'rb') as f:
        return sum(block.count(b'\n') for block in iter(lambda: f.read(1 << 20), b''))


def _hash_nofollow(path: Path) -> str:
    h = hashlib.sha256()
    fd = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
    with os.fdopen(fd, 'rb') as f:
        for block in iter(lambda: f.read(1 << 20), b''):
            h.update(block)
    return h.hexdigest()


def verify(root: Path, expected_manifest_hash: str, *, deep: bool = True) -> tuple[dict, dict, set]:
    """KA0-style verification: pinned manifest, exact lstat allowlist and metadata, every byte
    hashed, the public contract envelope re-hashed, and (deep) every table/registry re-parsed
    against the contract. Serving and grading use deep=False: the build already parsed those
    exact bytes and the manifest hash pins them. Returns (manifest, contract content, files)."""
    root = Path(root)
    m, files = files_of(root, expected_manifest_hash)
    verify_metadata(root, files)
    for name in sorted(files - {'manifest.json'}):
        if _hash_nofollow(root / name) != m['files'][name]:
            raise ProjectionError('staged bytes changed')
    contract_raw = jsonio.read_regular(root / 'DATA-CONTRACT.json', limit=64 << 20)
    if hashlib.sha256(contract_raw).hexdigest() != m['files']['DATA-CONTRACT.json']:
        raise ProjectionError('staged bytes changed')
    envelope = jsonio.loads(contract_raw)
    if (not isinstance(envelope, dict) or set(envelope) != {'public'} or not isinstance(envelope['public'], dict) or
            set(envelope['public']) != {'content', 'hash'} or contract_raw != jsonio.canonical_line(envelope)):
        raise ProjectionError('public contract not canonical')
    public = envelope['public']
    content = public['content']
    if public['hash'] != jsonio.digest(content) or public['hash'] != m['publicContractHash']:
        raise ProjectionError('public contract hash binding refused')
    if not isinstance(content, dict) or content.get('schema_version') != CONTRACT_SCHEMA or content.get('synthetic') is not m['synthetic']:
        raise ProjectionError('public contract schema refused')
    described = {}
    try:
        for t in content['tables']:
            described[t['path']] = t['sha256']
            if deep:
                header, rows, digest = shape(root / t['path'])
                if digest != t['sha256']:
                    raise ProjectionError('staged bytes changed')
                names = [c['name'] for c in t['columns']]
                width = len(names) + (t['matrix']['columns'] if t['matrix'] else 0)
                if header[:len(names)] != names or len(header) != width or rows != t['rows']:
                    raise ProjectionError('public contract disagrees with a table')
        for item in content.get('attachments', []):
            if not content['synthetic'] or item['path'] in described:
                raise ProjectionError('invalid synthetic attachment')
            described[item['path']] = item['sha256']
        for ns in content['namespaces']:
            described[ns['registry']['path']] = ns['registry']['sha256']
            if deep and _count_lines(root / ns['registry']['path']) != ns['entries'] + 1:
                raise ProjectionError('public contract disagrees with a registry')
    except (KeyError, TypeError, TableError, UnicodeDecodeError, json.JSONDecodeError):
        raise ProjectionError('public contract does not describe the files') from None
    data = {n: h for n, h in m['files'].items() if n.startswith('data/')}
    if described != data:
        raise ProjectionError('public contract does not cover exactly the data files')
    return m, content, files


def vocabulary() -> frozenset:
    words = set(CONTRACT_WORDS.split())
    probes = [{'kind': k, 'namespace': ns, 'allowed': ['x', 'y']} for k in ('exact', 'verdict', 'band', 'set', 'sign')
              for ns in (None, 'x', 'dataset', 'level/x', 'chromosome', 'position')]
    text = ' '.join([FILES_NOTE, *REPORT_INTRO, *CLOSING, *LIMITATIONS, '## Files ## Report', *map(describe, probes)])
    words |= set(re.findall(r'[^\W_]+', text))
    return frozenset(w.lower() for w in words) - {'x', 'y'}
