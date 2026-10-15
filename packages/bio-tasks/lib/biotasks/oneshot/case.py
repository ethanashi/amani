"""case.json: the host-held definition of one real-data case.

Validation is strict and fails closed: unknown keys, missing keys, wrong types and
ambiguous declarations refuse the case before any data is read. The returned dict is a
normalized deep copy with every default filled in, so later stages never guess.
"""
from __future__ import annotations

import copy
import re
from pathlib import Path, PurePosixPath

from . import jsonio

SCHEMA = 'omb-oneshot-case/v1'
CASE_ID = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$')
SOURCE_NAME = re.compile(r'^[a-z][a-z0-9_-]{0,31}$')
# Namespace ids name public registry files (data/<ns>-aliases.tsv): no hyphen, so the
# suffix stays unambiguous and never collides with an upper-case dataset-letter table file.
NAMESPACE = re.compile(r'^[a-z][a-z0-9]{0,23}$')
PUBLIC_NAME = re.compile(r'^[a-z][a-z0-9-]{0,39}$')
COLUMN_NAME = re.compile(r'^[A-Za-z][A-Za-z0-9_.-]{0,63}$')
LEVEL_NAME = re.compile(r'^[A-Za-z0-9][A-Za-z0-9_.+-]{0,39}$')
CRITERION_NAME = re.compile(r'^[a-z][a-z0-9-]{0,39}$')
SHA256 = re.compile(r'^[0-9a-f]{64}$')
PREFIX = re.compile(r'^[A-Z]{1,3}$')
ID_KINDS = ('gene', 'protein', 'sample', 'snp', 'compound')
# blinding.permutation prefixes; snp defaults to V so tokens never look like real rsIDs.
DEFAULT_PREFIX = {'gene': 'G', 'protein': 'P', 'sample': 'S', 'snp': 'V', 'compound': 'D'}
ROLES = ('drop', 'id', 'decimal', 'integer', 'categorical', 'text', 'chromosome', 'position')
CRITERION_KINDS = ('exact', 'verdict', 'band', 'set', 'sign')
# Placeholder kinds and criterion answer maps besides identifier namespaces.
RESERVED = ('dataset', 'level', 'chromosome', 'position')
TRUTH_CLASSES = {'established-control': 'reproduction', 'frozen-backtest': 'frozen-backtest'}
MAX_CASE_BYTES = 4 << 20


class CaseError(ValueError):
    pass


def need(condition, message):
    if not condition:
        raise CaseError(message)


def _keys(obj, required, optional=(), what='object'):
    need(isinstance(obj, dict), f'{what} must be a JSON object')
    keys = set(obj)
    need(set(required) <= keys, f'{what} is missing {sorted(set(required) - keys)}')
    need(keys <= set(required) | set(optional), f'{what} has unknown keys {sorted(keys - set(required) - set(optional))}')


def _string(value, what, *, limit=200, pattern=None):
    need(isinstance(value, str) and 0 < len(value) <= limit and '\x00' not in value, f'{what} must be a non-empty string')
    if pattern is not None:
        need(bool(pattern.match(value)), f'{what} has invalid characters')
    return value


def _int(value, lo, hi, what):
    need(type(value) is int and lo <= value <= hi, f'{what} must be an integer in [{lo}, {hi}]')
    return value


def _number(value, what, lo=None):
    need(jsonio.is_number(value) and (lo is None or value >= lo), f'{what} must be a finite number')
    return value


def load_case(case_dir) -> dict:
    case_dir = Path(case_dir)
    try:
        raw = jsonio.read_regular(case_dir / 'case.json', limit=MAX_CASE_BYTES)
        case = jsonio.loads(raw)
    except (OSError, ValueError) as e:
        raise CaseError(f'case.json unreadable: {type(e).__name__}') from None
    return validate_case(case)


def validate_case(case) -> dict:
    case = copy.deepcopy(case)
    _keys(case, ('schema', 'id', 'prompt', 'synthetic', 'sources', 'blinding', 'criteria'),
          ('card', 'answer_key', 'public_files', 'attachment_schemas'), 'case')
    need(case['schema'] == SCHEMA, f'schema must be {SCHEMA}')
    _string(case['id'], 'case id', limit=128, pattern=CASE_ID)
    _string(case['prompt'], 'prompt', limit=20000)
    need(type(case['synthetic']) is bool, 'synthetic must be a boolean')
    case['sources'] = _sources(case['sources'], case['id'])
    public_files = case.get('public_files', {})
    need(isinstance(public_files, dict), 'public_files must be an object')
    by_name = {s['name']: s for s in case['sources']}
    for name, filename in public_files.items():
        need(case['synthetic'] and name in by_name and not by_name[name]['project'],
             'public_files require synthetic, nonprojected sources')
        need(isinstance(filename, str) and re.fullmatch(r'[a-z][a-z0-9-]*\.(xlsx|csv|csv\.gz|zip|parquet|xpt|sav|dta|json)', filename),
             'invalid public file name')
    need(len(set(public_files.values())) == len(public_files), 'duplicate public file name')
    case['public_files'] = public_files
    schemas=case.get('attachment_schemas', {})
    need(isinstance(schemas,dict) and set(schemas)<=set(public_files), 'attachment schemas require declared public files')
    for name,columns in schemas.items():
        need(isinstance(columns,list) and columns, 'attachment columns required')
        seen=set()
        for c in columns:
            _keys(c,('name','role','storage'),('namespace','encoding'), 'attachment column')
            _string(c['name'],'attachment column name',limit=128)
            need(c['name'] not in seen,'duplicate attachment column');seen.add(c['name'])
            need(c['role'] in ('id','integer','decimal','text','categorical'),'invalid attachment role')
            need(c['storage'] in ('integer','number','string'),'invalid attachment storage')
            if 'namespace' in c:_string(c['namespace'],'attachment namespace',limit=128)
            if 'encoding' in c:need(c['encoding']=='decimal' and c['role']=='id','decimal encoding requires an identifier')
    case['attachment_schemas']=schemas
    projected = {s['name'] for s in case['sources'] if s['project']}
    need(projected, 'at least one source must be projected to the analyst')
    case['blinding'] = _blinding(case['blinding'], case['sources'])
    case['criteria'] = _criteria(case['criteria'], answer_maps(case['blinding']))
    case['card'] = _card(case.get('card', {}))
    case['answer_key'] = _answer_key(case.get('answer_key', {}))
    return case


def _sources(sources, case_id):
    need(isinstance(sources, list) and 0 < len(sources) <= 64, 'sources must be a list of 1..64 entries')
    out, seen = [], set()
    for i, s in enumerate(sources):
        what = f'source {i}'
        _keys(s, ('name', 'sha256', 'format'), ('size', 'path', 'url', 'compression', 'quoting', 'dataset', 'project'), what)
        _string(s['name'], f'{what} name', limit=32, pattern=SOURCE_NAME)
        need(s['name'] not in seen, f'duplicate source name {s["name"]}')
        seen.add(s['name'])
        need(isinstance(s['sha256'], str) and SHA256.match(s['sha256']), f'{what} sha256 must be 64 lowercase hex characters')
        need(s['format'] in ('tsv', 'csv', 'opaque'), f'{what} format must be tsv, csv or opaque')
        need('path' in s or 'url' in s, f'{what} needs a local path, a URL, or both')
        if 'path' in s:
            _string(s['path'], f'{what} path', limit=4096)
            p = PurePosixPath(s['path'])
            need(p.is_absolute() or '..' not in p.parts, f'{what} relative path must stay inside the case directory')
        if 'url' in s:
            _string(s['url'], f'{what} url', limit=2048)
            need('size' in s, f'{what} URL source needs its byte size')
        if 'size' in s:
            _int(s['size'], 0, 2 ** 53, f'{what} size')
        compression = s.get('compression', 'none')
        need(compression in ('none', 'gzip'), f'{what} compression must be none or gzip')
        quoting = s.get('quoting', 'none' if s['format'] == 'tsv' else 'minimal')
        need(quoting in ('none', 'minimal'), f'{what} quoting must be none or minimal')
        dataset = s.get('dataset', case_id)
        _string(dataset, f'{what} dataset', limit=128)
        project = s.get('project', True)
        need(type(project) is bool, f'{what} project must be a boolean')
        need(s['format'] != 'opaque' or project is False, 'opaque sources cannot be tabular projections')
        out.append({'name': s['name'], 'sha256': s['sha256'], 'format': s['format'], 'size': s.get('size'),
                    'path': s.get('path'), 'url': s.get('url'), 'compression': compression, 'quoting': quoting,
                    'dataset': dataset, 'project': project})
    return out


def _blinding(blinding, sources):
    by_name = {s['name']: s for s in sources}
    projected = {s['name'] for s in sources if s['project']}
    _keys(blinding, ('namespaces', 'tables'), ('redact', 'row_order'), 'blinding')
    namespaces = blinding['namespaces']
    need(isinstance(namespaces, dict) and len(namespaces) <= 32, 'blinding.namespaces must be an object')
    out_ns, prefixes = {}, set()
    for name, spec in namespaces.items():
        _string(name, 'namespace name', limit=24, pattern=NAMESPACE)
        need(name not in RESERVED, f'namespace name {name} is reserved for prompt placeholders and criteria')
        _keys(spec, ('kind',), ('prefix',), f'namespace {name}')
        need(spec['kind'] in ID_KINDS, f'namespace {name} kind must be one of {ID_KINDS}')
        prefix = spec.get('prefix', DEFAULT_PREFIX[spec['kind']])
        _string(prefix, f'namespace {name} prefix', limit=3, pattern=PREFIX)
        need(prefix not in prefixes, f'namespace {name} reuses a token prefix')
        prefixes.add(prefix)
        out_ns[name] = {'kind': spec['kind'], 'prefix': prefix}
    redact = blinding.get('redact', [])
    need(isinstance(redact, list) and len(redact) <= 10000, 'blinding.redact must be a list')
    for term in redact:
        _string(term, 'redact term', limit=200)
    row_order = blinding.get('row_order', 'keyed')
    need(row_order in ('keyed', 'keep'), 'row_order must be keyed or keep')
    tables = blinding['tables']
    need(isinstance(tables, dict) and 0 < len(tables) <= 64, 'blinding.tables must be an object')
    out_tables, owner = {}, {}
    for name, spec in tables.items():
        _string(name, 'table name', limit=32, pattern=SOURCE_NAME)
        need(isinstance(spec, dict), f'table {name} must be a JSON object')
        # A table is one projected source (keyed by its name) or, with `sources`, several sources
        # with one header concatenated in the listed order (per-chromosome or per-sample files).
        members = spec.get('sources', [name])
        need(isinstance(members, list) and 0 < len(members) <= 64 and len(set(members)) == len(members) and
             all(isinstance(m, str) for m in members), f'table {name} sources must list 1..64 distinct source names')
        need(name not in by_name or name in members, f'table {name} shares its name with a source it does not include')
        for m in members:
            need(m in projected, f'table {name} includes a source that is not a projected source')
            need(m not in owner, f'a source belongs to two tables ({owner.get(m)} and {name})')
            owner[m] = name
        need(len({by_name[m]['dataset'] for m in members}) == 1, f'table {name}: its sources must share one dataset')
        out_tables[name] = _table(name, spec, out_ns, row_order)
        out_tables[name]['sources'] = list(members)
    need(set(owner) == projected, 'blinding.tables must cover every projected source exactly once')
    return {'namespaces': out_ns, 'tables': out_tables, 'redact': sorted(set(redact)), 'row_order': row_order}


def _precision(value, what):
    if value == 'exact':
        return 'exact'
    need(isinstance(value, dict) and len(value) == 1, f'{what} precision must be "exact", {{"decimals": k}} or {{"significant": k}}')
    (mode, k), = value.items()
    need(mode in ('decimals', 'significant'), f'{what} precision mode must be decimals or significant')
    _int(k, 0 if mode == 'decimals' else 1, 15 if mode == 'decimals' else 17, f'{what} precision digits')
    return {mode: k}


TABLE_KEYS = (('public_name', 'columns'),
              ('layout', 'header_namespace', 'cells', 'row_order', 'column_order', 'missing', 'rows', 'sources',
               'comment_prefix', 'begin', 'end', 'row_names'))
ROLE_KEYS = {
    'drop': ((), ('protect_name',)),
    'id': (('namespace',), ('as', 'protect_name', 'separator', 'list_order')),
    'decimal': (('precision',), ('as', 'protect_name', 'perturb')),
    'integer': ((), ('as', 'protect_name')),
    'categorical': (('levels',), ('as', 'protect_name', 'protect_levels')),
    'text': ((), ('as', 'protect_name')),
    'chromosome': ((), ('as', 'protect_name')),
    'position': (('chromosome',), ('as', 'protect_name', 'mode')),
}


def _perturb(value, what, precision):
    """Optional keyed noise for a decimal column or decimal matrix cells: {"absolute": a} adds
    u*a, {"relative": r} multiplies by (1 + u*r), u uniform in [-1, 1) from a keyed PRF per card
    variant, before the declared rounding. It breaks exact-value joins across variants (not
    approximate matching), so tolerances must absorb it."""
    if value is None:
        return None
    need(precision != 'exact', f'{what} perturb needs a rounding precision (decimals or significant), not exact')
    need(isinstance(value, dict) and len(value) == 1 and set(value) <= {'absolute', 'relative'},
         f'{what} perturb must be {{"absolute": a}} or {{"relative": r}}')
    (mode, scale), = value.items()
    need(jsonio.is_number(scale) and scale > 0 and (mode == 'absolute' or scale <= 0.5),
         f'{what} perturb scale must be a positive number (relative at most 0.5)')
    return {mode: scale}


def _column(table, header, spec, namespaces):
    what = f'table {table} column {header!r}'
    need(isinstance(spec, dict) and spec.get('role') in ROLES, f'{what} role must be one of {ROLES}')
    required, optional = ROLE_KEYS[spec['role']]
    _keys(spec, ('role', *required), optional, what)
    out = {'role': spec['role'], 'header': header}
    protect = spec.get('protect_name', True)
    need(type(protect) is bool, f'{what} protect_name must be a boolean')
    out['protect_name'] = protect
    if spec['role'] == 'drop':
        return out
    public = spec.get('as', header)
    need(isinstance(public, str) and bool(COLUMN_NAME.match(public)),
         f'{what} public name must match {COLUMN_NAME.pattern}; rename it with "as"')
    out['public'] = public
    if spec['role'] == 'id':
        need(spec['namespace'] in namespaces, f'{what} uses an undeclared namespace')
        out['namespace'] = spec['namespace']
        sep = spec.get('separator')
        need(sep is None or (isinstance(sep, str) and len(sep) == 1 and sep not in '\t\r\n"'), f'{what} separator must be one character')
        out['separator'] = sep
        # List cells are written in keyed (token) order: public lists are usually sorted
        # alphabetically, and source order would rank the tokens back to the originals.
        list_order = spec.get('list_order', 'keyed' if sep else None)
        need(sep is not None or 'list_order' not in spec, f'{what} list_order needs a separator')
        need(sep is None or list_order in ('keyed', 'keep'), f'{what} list_order must be keyed or keep')
        out['list_order'] = list_order
    elif spec['role'] == 'decimal':
        out['precision'] = _precision(spec['precision'], what)
        out['perturb'] = _perturb(spec.get('perturb'), what, out['precision'])
    elif spec['role'] == 'categorical':
        protect_levels = spec.get('protect_levels', True)
        need(type(protect_levels) is bool, f'{what} protect_levels must be a boolean')
        out['protect_levels'] = protect_levels
        levels = spec['levels']
        if levels == 'keyed':
            out['levels'] = 'keyed'
        else:
            need(isinstance(levels, dict) and 0 < len(levels) <= 1000, f'{what} levels must be "keyed" or a non-empty mapping')
            for original, public_level in levels.items():
                _string(original, f'{what} level', limit=200)
                need(isinstance(public_level, str) and bool(LEVEL_NAME.match(public_level)), f'{what} public level has invalid characters')
            need(len(set(levels.values())) == len(levels), f'{what} public levels must be unique')
            out['levels'] = dict(levels)
    elif spec['role'] == 'position':
        _string(spec['chromosome'], f'{what} chromosome', limit=200)
        out['chromosome'] = spec['chromosome']
        mode = spec.get('mode', 'remap')
        need(mode in ('remap', 'shift'), f'{what} mode must be remap or shift')
        out['mode'] = mode
    return out


def _table(name, spec, namespaces, default_order):
    what = f'table {name}'
    _keys(spec, TABLE_KEYS[0], TABLE_KEYS[1], what)
    _string(spec['public_name'], f'{what} public_name', limit=40, pattern=PUBLIC_NAME)
    layout = spec.get('layout', 'records')
    need(layout in ('records', 'matrix'), f'{what} layout must be records or matrix')
    missing = spec.get('missing', ['', 'NA'])
    need(isinstance(missing, list) and len(missing) <= 16 and len(set(missing)) == len(missing) and
         all(isinstance(m, str) and len(m) <= 32 and '\t' not in m and '\n' not in m for m in missing), f'{what} missing codes invalid')
    row_order = spec.get('row_order', default_order)
    need(row_order in ('keyed', 'keep'), f'{what} row_order must be keyed or keep')
    columns = spec['columns']
    need(isinstance(columns, dict) and 0 < len(columns) <= 10000, f'{what} columns must be a non-empty object')
    out_cols = []
    for header, col in columns.items():
        need(isinstance(header, str) and 0 < len(header) <= 200 and '\t' not in header and '\n' not in header, f'{what} has an invalid header')
        out_cols.append(_column(name, header, col, namespaces))
    publics = [c['public'] for c in out_cols if c['role'] != 'drop']
    need(publics, f'{what} keeps no columns')
    need(len(set(publics)) == len(publics), f'{what} public column names must be unique')
    roles = {c['header']: c['role'] for c in out_cols}
    for c in out_cols:
        if c['role'] == 'position':
            need(roles.get(c['chromosome']) == 'chromosome', f'{what} position column needs a chromosome-role partner')
    out = {'public_name': spec['public_name'], 'layout': layout, 'columns': out_cols, 'missing': missing,
           'row_order': row_order, 'header_namespace': None, 'cells': None, 'column_order': None,
           'rows': _rows_filter(what, spec['rows'], set(roles)) if 'rows' in spec else None,
           **_parsing(what, spec, set(roles))}
    if layout == 'matrix':
        need('header_namespace' in spec and 'cells' in spec, f'{what} matrix needs header_namespace and cells')
        need(spec['header_namespace'] in namespaces, f'{what} header_namespace is undeclared')
        cells = spec['cells']
        need(isinstance(cells, dict) and cells.get('role') in ('decimal', 'integer'), f'{what} cells role must be decimal or integer')
        _keys(cells, ('role',), ('precision', 'perturb'), f'{what} cells')
        need((cells['role'] == 'decimal') == ('precision' in cells), f'{what} decimal cells need a precision; integer cells take none')
        need(cells['role'] == 'decimal' or 'perturb' not in cells, f'{what} only decimal cells take perturb')
        column_order = spec.get('column_order', 'keyed')
        need(column_order in ('keyed', 'keep'), f'{what} column_order must be keyed or keep')
        need(any(c['role'] == 'id' for c in out_cols), f'{what} matrix needs at least one id-role row column')
        need(not any(c['role'] in ('position', 'chromosome') for c in out_cols), f'{what} matrix cannot remap coordinates')
        precision = _precision(cells['precision'], f'{what} cells') if cells['role'] == 'decimal' else None
        out.update(header_namespace=spec['header_namespace'], column_order=column_order,
                   cells={'role': cells['role'], 'precision': precision,
                          'perturb': _perturb(cells.get('perturb'), f'{what} cells', precision)})
    else:
        need(not ({'header_namespace', 'cells', 'column_order'} & set(spec)), f'{what} records layout takes no matrix keys')
    return out


def _parsing(what: str, spec: dict, headers: set) -> dict:
    """Raw-format options for every source of a table: `comment_prefix` (metadata lines such as
    GEO series-matrix `!Series_...`; blank lines are skipped with them), `begin`/`end` marker lines
    around the table, and `row_names` (R write.table: an empty or missing first header cell names
    the row-label column)."""
    out = {}
    prefix = spec.get('comment_prefix')
    need(prefix is None or (isinstance(prefix, str) and 0 < len(prefix) <= 8 and not set(prefix) & set('\t\r\n"')),
         f'{what} comment_prefix must be 1..8 characters without tabs, newlines or quotes')
    out['comment_prefix'] = prefix
    for marker in ('begin', 'end'):
        value = spec.get(marker)
        need(value is None or (isinstance(value, str) and 0 < len(value) <= 200 and not set(value) & set('\r\n')),
             f'{what} {marker} marker must be one line of 1..200 characters')
        out[marker] = value
    row_names = spec.get('row_names')
    need(row_names is None or (isinstance(row_names, str) and row_names in headers),
         f'{what} row_names must name a declared column (the row-label column)')
    out['row_names'] = row_names
    return out


def _rows_filter(what: str, spec, headers: set) -> dict:
    """A declarative slice applied while streaming the verified source (so the projection stays
    tied to the pinned public file): a genomic region, or the rows whose cell is in a value list."""
    what = f'{what} rows filter'
    need(isinstance(spec, dict) and len(spec) == 1 and set(spec) <= {'region', 'in'}, f'{what} must be {{"region": ...}} or {{"in": ...}}')
    if 'region' in spec:
        r = spec['region']
        _keys(r, ('chromosome_column', 'position_column', 'chromosome', 'start', 'end'), (), f'{what} region')
        need(r['chromosome_column'] in headers and r['position_column'] in headers, f'{what} names an undeclared column')
        chromosome = r['chromosome']
        if isinstance(chromosome, list):
            need(0 < len(chromosome) <= 64, f'{what} chromosome list must hold 1..64 labels')
            for c in chromosome:
                _string(c, f'{what} chromosome', limit=64)
        else:
            _string(chromosome, f'{what} chromosome', limit=64)
        _int(r['start'], 0, 2 ** 53, f'{what} start')
        _int(r['end'], r['start'], 2 ** 53, f'{what} end')
        return {'region': {k: copy.deepcopy(r[k]) for k in ('chromosome_column', 'position_column', 'chromosome', 'start', 'end')}}
    f = spec['in']
    _keys(f, ('column', 'values'), (), f'{what} in')
    need(f['column'] in headers, f'{what} names an undeclared column')
    values = f['values']
    need(isinstance(values, list) and 0 < len(values) <= 100000 and len(set(values)) == len(values) and
         all(isinstance(v, str) and len(v) <= 200 for v in values), f'{what} values must be 1..100000 unique strings')
    return {'in': {'column': f['column'], 'values': list(values)}}


def answer_maps(blinding: dict) -> set:
    """Names a criterion may map expected originals through: identifier namespaces, `dataset`
    (dataset letters), `level/<public column>` (categorical levels), `chromosome` (keyed
    chromosome labels) and `position` (remapped or shifted coordinates), the last two only when
    the case has columns of that role."""
    names = set(blinding['namespaces']) | {'dataset'}
    for spec in blinding['tables'].values():
        names |= {f'level/{c["public"]}' for c in spec['columns'] if c['role'] == 'categorical'}
        names |= {c['role'] for c in spec['columns'] if c['role'] in ('chromosome', 'position')}
    return names


def closed_set_map(namespace) -> bool:
    """Dataset letters, category levels and chromosome labels come from small public sets (like
    verdicts)."""
    return namespace in ('dataset', 'chromosome') or (isinstance(namespace, str) and namespace.startswith('level/'))


def _literal(kind, value, criterion):
    what = f'criterion {criterion}'
    if kind == 'band':
        if isinstance(value, dict):
            _keys(value, ('lo', 'hi'), (), f'{what} band')
            _number(value['lo'], f'{what} lo')
            _number(value['hi'], f'{what} hi')
            need(value['lo'] <= value['hi'], f'{what} band lo must not exceed hi')
        else:
            _number(value, f'{what} expected value')
    elif kind == 'sign':
        _number(value, f'{what} expected value')
    elif kind == 'set':
        need(isinstance(value, list) and all(isinstance(v, str) and v for v in value) and len(set(value)) == len(value),
             f'{what} expected set must be a list of unique strings')
    elif kind == 'verdict':
        need(isinstance(value, str), f'{what} expected verdict must be a string')


def _criteria(criteria, namespaces):
    need(isinstance(criteria, list) and 0 < len(criteria) <= 64, 'criteria must be a list of 1..64 entries')
    out, names = [], set()
    optional = {'exact': ('namespace',), 'verdict': ('allowed',), 'band': ('absolute', 'relative'),
                'set': ('namespace', 'min_jaccard'), 'sign': ()}
    for i, c in enumerate(criteria):
        need(isinstance(c, dict) and c.get('kind') in CRITERION_KINDS, f'criterion {i} kind must be one of {CRITERION_KINDS}')
        kind = c['kind']
        _keys(c, ('name', 'kind', 'report'), ('answer', 'expect', 'description', 'in_data', *optional[kind]), f'criterion {i}')
        _string(c['name'], f'criterion {i} name', limit=40, pattern=CRITERION_NAME)
        need(c['name'] not in names, f'duplicate criterion {c["name"]}')
        names.add(c['name'])
        try:
            jsonio.pointer_parts(c['report'])
            if 'answer' in c:
                jsonio.pointer_parts(c['answer'])
        except ValueError:
            raise CaseError(f'criterion {c["name"]} pointers must match {jsonio.POINTER.pattern}') from None
        need(('answer' in c) != ('expect' in c), f'criterion {c["name"]} needs exactly one of answer or expect')
        item = {'name': c['name'], 'kind': kind, 'report': c['report'], 'answer': c.get('answer'),
                'description': c.get('description')}
        if item['description'] is not None:
            _string(item['description'], f'criterion {c["name"]} description', limit=500)
        # in_data: the expected number is legitimately a raw data value (a lookup), so the leakage
        # scan must not refuse it as a data cell. It is still refused in prose.
        in_data = c.get('in_data', False)
        need(type(in_data) is bool, f'criterion {c["name"]} in_data must be a boolean')
        item['in_data'] = in_data
        if kind in ('exact', 'set'):
            ns = c.get('namespace')
            need(ns is None or ns in namespaces, f'criterion {c["name"]} uses an undeclared namespace')
            need(ns != 'position' or kind == 'exact', f'criterion {c["name"]}: namespace position takes one integer (exact only)')
            item['namespace'] = ns
        if kind == 'verdict':
            allowed = c.get('allowed')
            need(isinstance(allowed, list) and 2 <= len(allowed) <= 16 and len(set(allowed)) == len(allowed) and
                 all(isinstance(a, str) and LEVEL_NAME.match(a) for a in allowed), f'criterion {c["name"]} needs 2..16 unique allowed verdicts')
            item['allowed'] = list(allowed)
        if kind == 'band':
            item['absolute'] = _number(c.get('absolute', 0), f'criterion {c["name"]} absolute', 0)
            item['relative'] = _number(c.get('relative', 0), f'criterion {c["name"]} relative', 0)
        if kind == 'set':
            mj = c.get('min_jaccard', 1)
            need(jsonio.is_number(mj) and 0 < mj <= 1, f'criterion {c["name"]} min_jaccard must be in (0, 1]')
            item['min_jaccard'] = mj
        if 'expect' in c:
            _literal(kind, c['expect'], c['name'])
            if kind == 'verdict':
                need(c['expect'] in item['allowed'], f'criterion {c["name"]} expected verdict is not allowed')
            item['expect'] = c['expect']
            item['literal'] = True
        else:
            item['literal'] = False
        out.append(item)
    pointers = [jsonio.pointer_parts(c['report']) for c in out]
    for a in pointers:
        for b in pointers:
            need(not (len(a) < len(b) and b[:len(a)] == a), 'one report pointer is a prefix of another')
    return out


CARD_DEFAULTS = {'truthClass': 'established-control', 'recallExposure': 'medium', 'rungTarget': '1',
                 'gateTargets': ['R1'], 'stratum': 'oneshot', 'capMinutes': 60, 'contaminated': True,
                 'negativeControl': False, 'positiveControl': False, 'tolerance': {'absolute': 0, 'relative': 0}}


def _card(card):
    need(isinstance(card, dict) and set(card) <= set(CARD_DEFAULTS), f'card overrides must be a subset of {sorted(CARD_DEFAULTS)}')
    out = {**copy.deepcopy(CARD_DEFAULTS), **copy.deepcopy(card)}
    need(out['truthClass'] in TRUTH_CLASSES, f'card truthClass must be one of {sorted(TRUTH_CLASSES)}')
    return out


def _answer_key(spec):
    _keys(spec, (), ('timeout_seconds', 'runs'), 'answer_key')
    timeout = _number(spec.get('timeout_seconds', 600), 'answer_key timeout_seconds', 0.001)
    need(timeout <= 3600, 'answer_key timeout_seconds must be at most 3600')
    return {'timeout_seconds': timeout, 'runs': _int(spec.get('runs', 2), 1, 2, 'answer_key runs')}
