"""Tabular parsing and keyed blinding (HMAC tokens and permutations from discovery/blinding.py).

Sources are parsed as streams. A `Table` re-reads its verified private copy on every pass and
never holds the table in memory: `plan` makes one pass to build every keyed map from the host key
and the closed universes found in the kept rows; `blind` makes a second pass and writes only
blinded rows to a file (keyed row order goes through a byte-offset index, not materialized rows).
The projection writer never receives an original table.

Size gates match what this streaming build can process: decoded bytes per source are capped for
every compression (an uncompressed file is refused before parsing), and so are kept rows per
table, kept cells per case and distinct identifiers per namespace, because the keyed maps live in
memory. A larger source is sliced declaratively with a `rows` filter (a genomic region or a value
list) applied while streaming the verified file, so the projection stays tied to the pinned
public download.
"""
from __future__ import annotations

import csv
import gzip
import hashlib
import io
import mmap
import os
import re
import shutil
import zlib
from array import array
from contextlib import ExitStack
from decimal import Decimal, InvalidOperation, ROUND_HALF_EVEN, localcontext
from pathlib import Path

from ..discovery.blinding import coordinates, keyed, permutation

DECIMAL = re.compile(r'^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]{1,4})?$')
INTEGER = re.compile(r'^[+-]?[0-9]{1,18}$')
# Gates (see module docstring; measured figures in packages/bio-tasks/oneshot/BUILD-NOTES.md).
MAX_DECODED = 2 << 30          # decoded bytes streamed from one source, any compression
MAX_ROWS = 2_000_000           # kept rows per projected table (after the rows filter)
MAX_CELLS = 30_000_000         # kept cells across the case (rows x projected columns)
MAX_IDENTIFIERS = 2_000_000    # distinct identifiers per namespace
MAX_PROTECTED = 2_000_000      # pre-filter originals per protection category
LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
# blinding.permutation emits these prefixes; a namespace may re-prefix its tokens.
KIND_PREFIX = {'gene': 'G', 'protein': 'P', 'sample': 'S', 'snp': 'rs', 'compound': 'D'}
SLICE = 'declare a rows filter (a genomic region or a value list) to project a slice'


class TableError(ValueError):
    pass


class _Meter(io.RawIOBase):
    """Counts and hashes the decoded bytes as they stream; refuses past the cap."""

    def __init__(self, raw, limit: int, name: str):
        self.raw, self.limit, self.name = raw, limit, name
        self.total = 0
        self.sha = hashlib.sha256()

    def readable(self):
        return True

    def readinto(self, buffer):
        n = self.raw.readinto(buffer)
        if n:
            self.total += n
            if self.total > self.limit:
                raise TableError(f'source {self.name}: decoded size over the {self.limit} byte limit; {SLICE}, '
                                 'or pre-filter the file')
            self.sha.update(memoryview(buffer)[:n])
        return n


class Table:
    """One projected table: the verified private copy of its source, streamed on every pass.

    `rows()` yields every kept row (width-checked, rows filter applied). `decoded` maps the source
    name to the sha256 of its decoded bytes once a pass has read it to the end."""

    def __init__(self, name: str, parts: list[tuple[Path, dict]], spec: dict | None = None):
        self.name = name
        self.parts = [(Path(p), s) for p, s in parts]
        spec = spec or {}
        self.missing = set(spec.get('missing', ['', 'NA']))
        self.filter = spec.get('rows')
        self.comment, self.begin, self.end = spec.get('comment_prefix'), spec.get('begin'), spec.get('end')
        self.row_names = spec.get('row_names')
        self.decoded: dict[str, str] = {}
        for path, source in self.parts:
            if source['compression'] == 'none' and path.stat().st_size > MAX_DECODED:
                raise TableError(f'source {source["name"]}: over the {MAX_DECODED} byte decoded limit; {SLICE}, '
                                 'or pre-filter the file')
        self.header = self._first_header()

    # ---------------------------------------------------------------- streaming
    def _records(self, path: Path, source: dict):
        """Every CSV record of one source, header first. Hashes the decoded stream to the end."""
        name = source['name']
        with ExitStack() as stack:
            try:
                raw = stack.enter_context(open(path, 'rb'))
                if source['compression'] == 'gzip':
                    if raw.read(2) != b'\x1f\x8b':
                        raise TableError('declared gzip source is not gzip')
                    raw.seek(0)
                    stream = stack.enter_context(gzip.GzipFile(fileobj=raw))
                else:
                    stream = raw
                meter = _Meter(stream, MAX_DECODED, name)
                text = io.TextIOWrapper(io.BufferedReader(meter, 1 << 20), encoding='utf-8', errors='strict', newline='')
                stack.callback(text.detach)
                reader = csv.reader(self._lines(text, source), delimiter='\t' if source['format'] == 'tsv' else ',',
                                    quoting=csv.QUOTE_NONE if source['quoting'] == 'none' else csv.QUOTE_MINIMAL, strict=True)
                header = next(reader, None)
                if header is not None:
                    pending = []
                    if self.row_names:
                        first = next(reader, None)
                        header = self._named(header, first, name)
                        pending = [first] if first is not None else []
                    yield header
                    yield from pending
                    yield from reader
                while meter.readinto(bytearray(1 << 20)):  # hash past an end marker too
                    pass
                self.decoded[name] = meter.sha.hexdigest()
            except csv.Error:
                raise TableError(f'source {name}: malformed {source["format"]}') from None
            except (OSError, EOFError, UnicodeDecodeError, zlib.error):
                raise TableError(f'source {name}: not decodable as {source["compression"]} UTF-8 text') from None

    def _lines(self, text, source: dict, passthrough=lambda line: None):
        """Physical lines that belong to the table: after the `begin` marker, before the `end`
        marker, without `comment_prefix` lines (and blank lines with them) or leading blank lines.
        Lines continuing a quoted field (an odd number of quotes so far) are never skipped."""
        inside, quoted, started = self.begin is None, False, False
        minimal = source['quoting'] == 'minimal'
        for n, line in enumerate(text):
            if n == 0 and line.startswith('\ufeff'):
                line = line[1:]
            if not quoted:
                bare = line.rstrip('\r\n')
                if not inside:
                    inside = bare == self.begin
                    passthrough(line)
                    continue
                if self.end is not None and bare == self.end:
                    passthrough(line)
                    return
                if self.comment is not None and (not bare or bare.startswith(self.comment)):
                    passthrough(line)
                    continue
                if not started and not bare:
                    passthrough(line)
                    continue
                started = True
            if minimal and line.count('"') % 2:
                quoted = not quoted
            yield line
        if not inside:
            raise TableError(f'source {source["name"]}: begin marker not found')
        if self.end is not None:
            raise TableError(f'source {source["name"]}: end marker not found')

    def _named(self, header: list, first, name: str) -> list:
        """R write.table: the row-label column has an empty header cell, or no header cell at all."""
        if header and header[0] == '':
            return [self.row_names, *header[1:]]
        if first is not None and len(first) == len(header) + 1:
            return [self.row_names, *header]
        raise TableError(f'source {name}: row_names declared, but the header has neither an empty first cell '
                         'nor one cell fewer than the rows')

    def _first_header(self) -> list[str]:
        path, source = self.parts[0]
        records = self._records(path, source)
        try:
            header = next(records, None)
            if header is None or next(records, None) is None:
                raise TableError(f'source {source["name"]}: needs a header and at least one row')
        finally:
            records.close()
        if len(set(header)) != len(header) or any(not h for h in header):
            raise TableError(f'source {source["name"]}: header names must be unique and non-empty')
        return header

    def rows(self, before_filter=None):
        width, index = len(self.header), {h: i for i, h in enumerate(self.header)}
        keep = self._keep(index)
        kept = 0
        for path, source in self.parts:
            records = self._records(path, source)
            try:
                header = next(records, None)
                if header != self.header:
                    raise TableError(f'table {self.name}: source {source["name"]} has a different header')
                for row in records:
                    if len(row) != width:
                        raise TableError(f'source {source["name"]}: ragged row')
                    if before_filter is not None:
                        before_filter(row)
                    if keep is None or keep(row):
                        kept += 1
                        if kept > MAX_ROWS:
                            raise TableError(f'table {self.name}: more than {MAX_ROWS} kept rows; {SLICE}')
                        yield row
            finally:
                records.close()
        if not kept:
            raise TableError(f'table {self.name}: no rows kept' + (' by its rows filter' if self.filter else ''))

    def _keep(self, index: dict):
        f = self.filter
        if not f:
            return None
        missing, name = self.missing, self.name
        if 'region' in f:
            r = f['region']
            ci, pi, lo, hi = index[r['chromosome_column']], index[r['position_column']], r['start'], r['end']
            chromosomes = set(r['chromosome']) if isinstance(r['chromosome'], list) else {r['chromosome']}

            def region(row):
                if row[ci] not in chromosomes or row[pi] in missing:
                    return False
                if not INTEGER.match(row[pi]):
                    raise TableError(f'table {name}: region filter position is not an integer')
                return lo <= int(row[pi]) <= hi
            return region
        ci, values = index[f['in']['column']], set(f['in']['values'])
        return lambda row: row[ci] in values


def read(path: Path, source: dict, spec: dict | None = None) -> Table:
    """One verified source as a streamed table (spec: missing codes and an optional rows filter)."""
    return Table(source['name'], [(path, source)], spec)


def open_tables(case: dict, paths: dict) -> dict[str, Table]:
    """Every projected table of a case, from the verified private copies {source name: path}."""
    by_name = {s['name']: s for s in case['sources']}
    out = {}
    for name, spec in case['blinding']['tables'].items():
        try:
            parts = [(paths[m], by_name[m]) for m in spec.get('sources', [name])]
        except KeyError:
            raise TableError(f'table {name}: source not staged') from None
        out[name] = Table(name, parts, spec)
    return out


def dataset_of(case: dict, name: str) -> str:
    """The original dataset of a projected table (its sources share one)."""
    by_name = {s['name']: s for s in case['sources']}
    return by_name[case['blinding']['tables'][name].get('sources', [name])[0]]['dataset']


def _layout(name: str, spec: dict, table: Table):
    declared = {c['header']: c for c in spec['columns']}
    missing = [h for h in declared if h not in table.header]
    if missing:
        raise TableError(f'table {name}: declared columns absent from the data')
    extra = [h for h in table.header if h not in declared]
    if spec['layout'] == 'records' and extra:
        raise TableError(f'table {name}: every column must be declared (undeclared columns found)')
    if spec['layout'] == 'matrix' and not extra:
        raise TableError(f'table {name}: matrix has no header-identifier columns')
    return declared, extra


def round_decimals(text: str, k: int) -> str:
    with localcontext() as ctx:
        ctx.prec, ctx.rounding = 80, ROUND_HALF_EVEN
        s = format(Decimal(text).quantize(Decimal(1).scaleb(-k)), 'f')
    return s[1:] if s.startswith('-') and not s.strip('-0.') else s


def round_significant(text: str, k: int) -> str:
    with localcontext() as ctx:
        ctx.prec, ctx.rounding = 80, ROUND_HALF_EVEN
        d = Decimal(text)
        if d == 0:
            return '0'
        return format(d, f'.{k - 1}e')


def numeric(precision, missing):
    """Validate a decimal cell; pass through byte-exactly or re-round deterministically."""
    def apply(v):
        if v in missing:
            return v
        if not DECIMAL.match(v):
            raise TableError('decimal column holds a non-decimal value')
        if precision == 'exact':
            return v
        try:
            (mode, k), = precision.items()
            return round_decimals(v, k) if mode == 'decimals' else round_significant(v, k)
        except InvalidOperation:
            raise TableError('decimal value cannot be rounded') from None
    return apply


def integer(missing):
    def apply(v):
        if v in missing:
            return v
        if not INTEGER.match(v):
            raise TableError('integer column holds a non-integer value')
        return v
    return apply


class Plan:
    """Every keyed map for one case build. Originals never leave the host; tokens are public."""

    def __init__(self):
        self.context = ''
        self.namespaces: dict[str, dict[str, str]] = {}
        self.datasets: dict[str, str] = {}
        self.levels: dict[str, dict[str, str]] = {}           # public column -> keyed level map
        self.chromosomes: dict[str, str] = {}
        self.positions: dict[str, dict[int, int]] = {}         # original chromosome -> position map
        self.columns: dict[tuple[str, str], list[str]] = {}    # (table, header) -> header tokens order
        self.rows: dict[str, int] = {}                         # table -> kept rows
        self.protected = {kind: set() for kind in ('identifier', 'level', 'chromosome')}
        self.original_positions: set[int] = set()

    def coordinates(self) -> set:
        """Every original coordinate of a position column (any chromosome)."""
        return self.original_positions | {pos for mapping in self.positions.values() for pos in mapping}

    def position_map(self) -> dict:
        """Original coordinate -> projected coordinate, None where two chromosomes disagree."""
        out: dict[int, int | None] = {}
        for mapping in self.positions.values():
            for pos, new in mapping.items():
                out[pos] = new if out.get(pos, new) == new else None
        return out


def _ids(value: str, sep):
    parts = value.split(sep) if sep else [value]
    if any(not p for p in parts):
        raise TableError('empty identifier inside a separated cell')
    return parts


def _protection_collector(spec, index, missing, plan):
    """Collect private originals before a slice discards rows; never mint tokens from this set.

    Unfiltered tables already contribute their entire universes through the keyed maps. Keep
    these extra sets only for filtered tables, and bound them while streaming, not afterwards.
    """
    columns = []
    for col in spec['columns']:
        role = col['role']
        if role == 'id':
            columns.append((index[col['header']], plan.protected['identifier'], col['separator'], False))
        elif role == 'categorical' and col['levels'] == 'keyed' and col.get('protect_levels', True):
            columns.append((index[col['header']], plan.protected['level'], None, False))
        elif role == 'chromosome':
            columns.append((index[col['header']], plan.protected['chromosome'], None, False))
        elif role == 'position':
            columns.append((index[col['header']], plan.original_positions, None, True))

    def collect(row):
        for i, universe, separator, position in columns:
            value = row[i]
            if value in missing:
                continue
            if position:
                if INTEGER.fullmatch(value) and int(value) >= 0:
                    universe.add(int(value))
            else:
                universe.update(_ids(value, separator))
            if len(universe) > MAX_PROTECTED:
                raise TableError(f'pre-filter protection universe exceeds {MAX_PROTECTED} originals; '
                                 'pre-filter the source file (a rows filter cannot reduce this universe)')
    return collect


def _collectors(name, spec, table, index, missing, universes, keyed_levels, chromosomes, positions, modes):
    """One function per declared column, all fed from a single streamed pass."""
    out = []
    for col in spec['columns']:
        i, role = index[col['header']], col['role']
        if role == 'id':
            universe, sep = universes[col['namespace']], col['separator']

            def ident(row, i=i, universe=universe, sep=sep):
                if row[i] not in missing:
                    universe.update(_ids(row[i], sep))
            out.append(ident)
        elif role == 'categorical' and col['levels'] == 'keyed':
            seen = keyed_levels.setdefault(col['public'], set())

            def level(row, i=i, seen=seen):
                if row[i] not in missing:
                    seen.add(row[i])
            out.append(level)
        elif role == 'categorical':
            allowed = set(col['levels'])

            def declared(row, i=i, allowed=allowed):
                if row[i] not in missing and row[i] not in allowed:
                    raise TableError(f'table {name}: categorical column has undeclared levels')
            out.append(declared)
        elif role == 'chromosome':
            def chromosome(row, i=i):
                if row[i] not in missing:
                    chromosomes.add(row[i])
            out.append(chromosome)
        elif role == 'position':
            c, mode = index[col['chromosome']], col['mode']

            def position(row, i=i, c=c, mode=mode):
                v = row[i]
                if v in missing:
                    return
                if row[c] in missing or not INTEGER.match(v) or int(v) < 0:
                    raise TableError(f'table {name}: position needs a non-negative integer and a chromosome')
                positions.setdefault(row[c], set()).add(int(v))
                if modes.setdefault(row[c], mode) != mode:
                    raise TableError('one chromosome cannot mix remap and shift coordinates')
            out.append(position)
    return out


def plan(case: dict, tables: dict[str, Table], key: bytes, variant: int) -> Plan:
    p = Plan()
    p.context = f'oneshot/v1/{case["id"]}/{variant}'
    blinding = case['blinding']
    universes = {ns: set() for ns in blinding['namespaces']}
    keyed_levels: dict[str, set] = {}
    chromosomes: set = set()
    positions: dict[str, set] = {}
    modes: dict[str, str] = {}
    cells = 0
    for name, spec in blinding['tables'].items():
        table = tables[name]
        declared, extra = _layout(name, spec, table)
        index = {h: i for i, h in enumerate(table.header)}
        if spec['layout'] == 'matrix':
            universes[spec['header_namespace']].update(extra)
        collectors = _collectors(name, spec, table, index, set(spec['missing']), universes, keyed_levels,
                                 chromosomes, positions, modes)
        n = 0
        protect = _protection_collector(spec, index, set(spec['missing']), p) if spec.get('rows') else None
        for row in table.rows(before_filter=protect):
            n += 1
            for collect in collectors:
                collect(row)
        p.rows[name] = n
        width = sum(c['role'] != 'drop' for c in spec['columns']) + (len(extra) if spec['layout'] == 'matrix' else 0)
        cells += n * width
        if cells > MAX_CELLS:
            raise TableError(f'more than {MAX_CELLS} projected cells across the case; {SLICE}')
    for ns, spec in blinding['namespaces'].items():
        universe = sorted(universes[ns])
        if len(universe) > MAX_IDENTIFIERS:
            raise TableError(f'namespace {ns}: more than {MAX_IDENTIFIERS} distinct identifiers; {SLICE}')
        if not universe:
            p.namespaces[ns] = {}  # declared but only missing values: nothing to map, no registry
            continue
        tokens = permutation(key, p.context + '/ns/' + ns, spec['kind'], universe)
        base = KIND_PREFIX[spec['kind']]
        p.namespaces[ns] = {old: spec['prefix'] + tok[len(base):] for old, tok in tokens.items()}
    datasets = sorted({s['dataset'] for s in case['sources'] if s['project']})
    if len(datasets) > len(LETTERS):
        raise TableError('at most 26 projected datasets')
    order = sorted(datasets, key=lambda d: keyed(key, 'oneshot-dataset', p.context, d))
    p.datasets = {d: LETTERS[i] for i, d in enumerate(order)}
    for public, values in keyed_levels.items():
        ranked = sorted(values, key=lambda v: keyed(key, 'oneshot-level', p.context, public, v))
        p.levels[public] = {v: f'L{i + 1}' for i, v in enumerate(ranked)}
    ranked = sorted(chromosomes, key=lambda v: keyed(key, 'oneshot-chromosome', p.context, v))
    p.chromosomes = {v: f'c{i + 1}' for i, v in enumerate(ranked)}
    for chrom, values in positions.items():
        values = sorted(values)
        if modes[chrom] == 'remap':
            mapped, _ = coordinates(key, p.context + '/pos/' + chrom, values, preserve_order=True)
            p.positions[chrom] = {pos: mapped[pos][1] for pos in values}
        else:
            offset = 1_000_000 + int.from_bytes(keyed(key, 'oneshot-shift', p.context, chrom)[:4], 'big') % 50_000_000
            p.positions[chrom] = {pos: pos - values[0] + offset for pos in values}
    for name, spec in blinding['tables'].items():
        if spec['layout'] == 'matrix':
            _, extra = _layout(name, spec, tables[name])
            tokens = [p.namespaces[spec['header_namespace']][h] for h in extra]
            if spec['column_order'] == 'keyed':
                tokens.sort(key=lambda t: keyed(key, 'oneshot-column-order', p.context, name, t))
            p.columns[(name, '*')] = tokens
    return p


def _transform(col: dict, plan: Plan, missing: set):
    role = col['role']
    if role == 'id':
        m, sep, keyed_list = plan.namespaces[col['namespace']], col['separator'], col.get('list_order') == 'keyed'

        def ids(v):
            if v in missing:
                return v
            if not sep:
                return m[v]
            tokens = [m[x] for x in _ids(v, sep)]
            # Tokens are numbered in keyed order, so token order is a keyed permutation.
            return sep.join(sorted(tokens) if keyed_list else tokens)
        return ids
    if role == 'decimal':
        return numeric(col['precision'], missing)
    if role == 'integer':
        return integer(missing)
    if role == 'categorical':
        m = plan.levels[col['public']] if col['levels'] == 'keyed' else col['levels']
        return lambda v: v if v in missing else m[v]
    if role == 'text':
        return lambda v: v
    if role == 'chromosome':
        return lambda v: v if v in missing else plan.chromosomes[v]
    raise TableError('unsupported role')


class _Encoder:
    """One TSV record at a time (csv quoting rules identical to a whole-file writer)."""

    def __init__(self):
        self.buffer = io.StringIO()
        self.writer = csv.writer(self.buffer, delimiter='\t', lineterminator='\n', quoting=csv.QUOTE_MINIMAL)

    def __call__(self, row) -> bytes:
        self.buffer.seek(0)
        self.buffer.truncate()
        self.writer.writerow(row)
        return self.buffer.getvalue().encode('utf-8')


def _row_order(key: bytes, plan: Plan, name: str, n: int):
    """Keyed permutation of n row indexes: a per-table subkey, a keyed 64-bit PRF per index, sorted."""
    import numpy as np
    subkey = keyed(key, 'oneshot-row-order', plan.context, name)
    sort_keys = array('Q', (int.from_bytes(hashlib.blake2b(r.to_bytes(8, 'big'), key=subkey, digest_size=8).digest(), 'big')
                            for r in range(n)))
    return np.argsort(np.frombuffer(sort_keys, dtype=np.uint64), kind='stable') if n else np.empty(0, dtype=np.int64)


def blind(name: str, spec: dict, table: Table, plan: Plan, key: bytes, out: Path) -> tuple[list[str], int, str]:
    """Stream the blinded table into `out`; return (public header, row count, sha256 of the file)."""
    declared, extra = _layout(name, spec, table)
    index = {h: i for i, h in enumerate(table.header)}
    missing = set(spec['missing'])
    kept = [declared[h] for h in table.header if h in declared and declared[h]['role'] != 'drop']
    header = [c['public'] for c in kept]
    state = [0]  # index of the kept row being blinded (perturbation PRF input)
    try:
        funcs = _row_functions(name, spec, kept, index, extra, missing, plan, key, state)
    except KeyError:
        raise TableError(f'table {name}: a column has no keyed mapping') from None
    if spec['layout'] == 'matrix':
        header += plan.columns[(name, '*')]
    if len(set(header)) != len(header):
        raise TableError(f'table {name}: blinded header names collide')
    encode, out = _Encoder(), Path(out)
    keyed_rows = spec['row_order'] == 'keyed'
    staging = out.with_name(out.name + '.source-order') if keyed_rows else out
    offsets, digest, n = array('Q', [0]), hashlib.sha256(), 0
    try:
        with open(staging, 'xb', buffering=1 << 20) as f:
            first = encode(header)
            f.write(first)
            digest.update(first)
            position = 0
            for row in table.rows():
                state[0] = n
                try:
                    raw = encode([fn(row) for fn in funcs])
                except KeyError:
                    raise TableError(f'table {name}: a value has no keyed mapping') from None
                except TableError as e:
                    raise TableError(f'table {name}: {e}') from None
                f.write(raw)
                n += 1
                if keyed_rows:
                    position += len(raw)
                    offsets.append(position)
                else:
                    digest.update(raw)
        if keyed_rows:
            order = _row_order(key, plan, name, n)
            with open(staging, 'rb') as src, open(out, 'xb', buffering=1 << 20) as f:
                f.write(first)
                body = len(first)
                if n:
                    with mmap.mmap(src.fileno(), 0, access=mmap.ACCESS_READ) as mm:
                        for r in order.tolist():
                            chunk = mm[body + offsets[r]:body + offsets[r + 1]]
                            f.write(chunk)
                            digest.update(chunk)
    finally:
        if keyed_rows and staging.exists():
            staging.unlink()
    return header, n, digest.hexdigest()


def _perturber(key: bytes, plan: Plan, table: str, header: str, perturb: dict, precision, missing):
    """Keyed noise then the declared rounding, per cell: u in [-1, 1) from a PRF of the kept-row
    index under a subkey of (card context, table, original header); differs per variant and key."""
    subkey = keyed(key, 'oneshot-perturb', plan.context, table, header)
    (mode, scale), = perturb.items()
    scale = Decimal(repr(scale))
    rounding = numeric(precision, missing)

    def apply(v, r):
        if v in missing:
            return v
        if not DECIMAL.match(v):
            raise TableError('decimal column holds a non-decimal value')
        x = int.from_bytes(hashlib.blake2b(r.to_bytes(8, 'big'), key=subkey, digest_size=8).digest(), 'big')
        with localcontext() as ctx:
            ctx.prec = 80
            u = Decimal(x) / Decimal(1 << 63) - 1
            out = Decimal(v) + u * scale if mode == 'absolute' else Decimal(v) * (1 + u * scale)
        return rounding(str(out))
    return apply


def _row_functions(name, spec, kept, index, extra, missing, plan, key, state):
    funcs = []
    for col in kept:
        i = index[col['header']]
        if col['role'] == 'position':
            c = index[col['chromosome']]

            def position(row, i=i, c=c):
                v = row[i]
                return v if v in missing else str(plan.positions[row[c]][int(v)])
            funcs.append(position)
        elif col['role'] == 'decimal' and col.get('perturb'):
            p = _perturber(key, plan, name, col['header'], col['perturb'], col['precision'], missing)
            funcs.append(lambda row, i=i, p=p: p(row[i], state[0]))
        else:
            f = _transform(col, plan, missing)
            funcs.append(lambda row, i=i, f=f: f(row[i]))
    if spec['layout'] == 'matrix':
        tokens = plan.namespaces[spec['header_namespace']]
        original = {tokens[h]: h for h in extra}
        cells = spec['cells']
        cell = numeric(cells['precision'], missing) if cells['role'] == 'decimal' else integer(missing)
        for t in plan.columns[(name, '*')]:
            if cells.get('perturb'):
                p = _perturber(key, plan, name, original[t], cells['perturb'], cells['precision'], missing)
                funcs.append(lambda row, i=index[original[t]], p=p: p(row[i], state[0]))
            else:
                funcs.append(lambda row, i=index[original[t]]: cell(row[i]))
    return funcs


def shape(path: Path) -> tuple[list[str], int, str]:
    """Header, row count and sha256 of a projected TSV, streamed and parsed exactly as written."""
    digest = hashlib.sha256()

    class _Hashing(io.RawIOBase):
        def __init__(self, raw):
            self.raw = raw

        def readable(self):
            return True

        def readinto(self, buffer):
            n = self.raw.readinto(buffer)
            if n:
                digest.update(memoryview(buffer)[:n])
            return n
    fd = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
    with os.fdopen(fd, 'rb') as raw:
        text = io.TextIOWrapper(io.BufferedReader(_Hashing(raw), 1 << 20), encoding='utf-8', newline='')
        try:
            reader = csv.reader(text, delimiter='\t', strict=True)
            header = next(reader, None)
            if header is None:
                raise TableError('projected table malformed')
            rows = 0
            for row in reader:
                if len(row) != len(header):
                    raise TableError('projected table malformed')
                rows += 1
        except (csv.Error, UnicodeDecodeError):
            raise TableError('projected table malformed') from None
        finally:
            text.detach()
    return header, rows, digest.hexdigest()


def answer_sources(case: dict, tables: dict[str, Table], plan: Plan, key: bytes,
                   staged: dict, dest: Path) -> Path:
    """Private source-format copies with precisely the projection's numeric transformations.

    Retain original identifiers, headers, coordinates, metadata, compression, source boundaries
    and excluded rows, so the existing answer-key parser and declared slice still apply. Only
    retained decimal cells change. The PRF index counts retained rows across all source parts,
    exactly as blind(). No host key or map is supplied to the answer-key process.
    """
    dest.mkdir(mode=0o700)
    transformed = set()
    for name, spec in case['blinding']['tables'].items():
        table = tables[name]
        declared, extra = _layout(name, spec, table)
        index = {h: i for i, h in enumerate(table.header)}
        missing = set(spec['missing'])
        funcs = {}
        decimals = [(c['header'], c) for c in spec['columns'] if c['role'] == 'decimal']
        if spec['layout'] == 'matrix' and spec['cells']['role'] == 'decimal':
            decimals += [(h, spec['cells']) for h in extra]
        for header, col in decimals:
            if col['precision'] == 'exact' and not col.get('perturb'):
                continue
            if col.get('perturb'):
                fn = _perturber(key, plan, name, header, col['perturb'], col['precision'], missing)
            else:
                rounding = numeric(col['precision'], missing)
                fn = lambda v, r, rounding=rounding: rounding(v)
            funcs[index[header]] = fn
        if not funcs:
            continue
        keep, row_index = table._keep(index), 0
        for path, source in table.parts:
            transformed.add(source['name'])
            with ExitStack() as stack:
                raw = stack.enter_context(open(dest / source['name'], 'xb'))
                if source['compression'] == 'gzip':
                    sink = stack.enter_context(gzip.GzipFile(filename='', mode='wb', fileobj=raw, mtime=0))
                    text = stack.enter_context(gzip.open(path, 'rt', encoding='utf-8', newline=''))
                else:
                    sink = raw
                    text = stack.enter_context(open(path, encoding='utf-8', newline=''))
                out = stack.enter_context(io.TextIOWrapper(sink, encoding='utf-8', newline=''))
                quoting = csv.QUOTE_NONE if source['quoting'] == 'none' else csv.QUOTE_MINIMAL
                delimiter = '\t' if source['format'] == 'tsv' else ','
                reader = csv.reader(table._lines(text, source, out.write), delimiter=delimiter,
                                    quoting=quoting, strict=True)
                writer = csv.writer(out, delimiter=delimiter, lineterminator='\n', quoting=quoting,
                                    quotechar=None if quoting == csv.QUOTE_NONE else '"')
                # Preserve the raw header shape, including R's empty/missing row-name cell.
                writer.writerow(next(reader))
                for row in reader:
                    if len(row) != len(table.header):
                        raise TableError('answer source has a ragged row')
                    if keep is None or keep(row):
                        for i, fn in funcs.items():
                            row[i] = fn(row[i], row_index)
                        row_index += 1
                    writer.writerow(row)
                out.writelines(text)  # preserve metadata after an end marker
            if row_index > plan.rows[name]:
                raise TableError('answer source disagrees with projected rows')
        if row_index != plan.rows[name]:
            raise TableError('answer source disagrees with projected rows')
    for name, info in staged.items():
        if name not in transformed:
            shutil.copyfile(info['path'], dest / name)
    return dest
