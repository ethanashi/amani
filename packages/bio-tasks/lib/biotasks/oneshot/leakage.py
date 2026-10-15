"""Leakage scan of the analyst projection. Fail closed; findings are redacted.

Construction is the primary defence (the projection writer only receives blinded values). This
scan is defence in depth over the exact bytes an analyst will receive. It refuses when it finds:

- any original identifier from a blinding namespace, dataset name, renamed/dropped column name,
  changed categorical level, chromosome label, source filename or URL, the case id, or an
  author `redact` term (category per finding, never the term itself);
- any expected answer value in prose (TASK.md, string values of DATA-CONTRACT.json/manifest.json),
  and numeric JSON leaves except schema-pinned integer structural counts,
  including blinded tokens that are answers, and high-precision answer floats as data cells;
  numbers are compared by value (Decimal), so every spelling of the same number matches;
- a projected file whose bytes equal a source file (raw or decompressed) or the answer output;
- the sealed canary anywhere.

Term matching (documented limits, see README): a term with a letter and at least four characters
matches ASCII-case-insensitively at alphanumeric boundaries anywhere; three-character terms match
case-sensitively; shorter terms ("weak") match only as an entire TSV cell or JSON string, or
case-sensitively at boundaries in TASK.md when they contain a letter. Purely numeric originals
cannot be told apart from measurements and are protected only by structural replacement.
"""
from __future__ import annotations

import hashlib
import io
import json
import os
import re
import stat
import string
import urllib.parse
from decimal import Decimal, InvalidOperation
from pathlib import Path

from . import jsonio

ALNUM = re.compile(r'[^\W_]+')
LETTER = re.compile(r'[^\W\d_]')
NUMBER = r'[+-]?(?:(?:[0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?'
NUMERIC = re.compile(r'^' + NUMBER + r'$')
ASCII_LOWER = str.maketrans(string.ascii_uppercase, string.ascii_lowercase)
CHUNK = 4 << 20


class LeakageError(ValueError):
    def __init__(self, findings):
        self.findings = sorted(set(findings))
        super().__init__('leakage scan refused: ' + '; '.join(f'{c} in {p}' for c, p in self.findings))


def classify(term: str) -> str:
    if NUMERIC.match(term.strip()):
        return 'numeric'
    if not ALNUM.search(term):
        return 'weak'
    if LETTER.search(term) and len(term) >= 4:
        return 'ci'
    if LETTER.search(term) and len(term) == 3:
        return 'cs'
    return 'weak'


ACCESSION = re.compile(r'(?<![A-Za-z])[A-Za-z]{1,10}_?[0-9]{3,}(?![0-9])')


def _filenames(source: dict) -> list[str]:
    """File names, accession-like stems and accession-like segments of the local path and URL
    (e.g. GSE12345, PRJNA123456, phs000123 from a folder or query, not only the last segment)."""
    names = []
    url = urllib.parse.urlsplit(source['url']) if source.get('url') else None
    for raw in (source.get('path'), url.path if url else None):
        if raw:
            base = raw.rstrip('/').rsplit('/', 1)[-1]
            if base:
                names.append(base)
                stem = base.split('.', 1)[0]
                if stem != base and re.search(r'[0-9]', stem):
                    names.append(stem)
    for raw in (source.get('path') or '', url.path if url else '', url.query if url else ''):
        names += ACCESSION.findall(urllib.parse.unquote(raw))
    return names


def shown(original: str, public: str) -> bool:
    """True when the public spelling shows the original anyway: equal up to ASCII case, or the
    original as a whole alphanumeric word inside it."""
    o, p = original.translate(ASCII_LOWER), public.translate(ASCII_LOWER)
    return o == p or re.search(r'(?<![^\W_])' + re.escape(o) + r'(?![^\W_])', p) is not None


def protected_terms(case: dict, plan, expected: dict, criteria: list[dict], plaintext: set, canary: str) -> dict:
    """Everything the projection must not contain. Sealed with the key; never written in plaintext."""
    terms = {k: set() for k in ('identifier', 'dataset', 'level', 'column', 'chromosome', 'filename', 'case', 'url', 'redact')}
    for category, originals in plan.protected.items():
        terms[category].update(originals)
    for mapping in plan.namespaces.values():
        terms['identifier'].update(mapping)
    terms['dataset'].update(s['dataset'] for s in case['sources'])
    terms['dataset'].update(a for s in case['sources'] for a in ACCESSION.findall(s['dataset']))
    terms['case'].add(case['id'])
    terms['case'].update(ACCESSION.findall(case['id']))
    terms['chromosome'].update(plan.chromosomes)
    from .projection import vocabulary
    fixed = vocabulary()
    for spec in case['blinding']['tables'].values():
        for col in spec['columns']:
            # A rename that only changes letter case, or keeps the original as a whole word
            # (beta -> beta_discovery), prints the original anyway: protecting it could only
            # refuse the build against the public header itself.
            if (col['protect_name'] and (col['role'] == 'drop' or not shown(col['header'], col['public']))
                    and col['header'].lower() not in fixed):
                terms['column'].add(col['header'])
            if col['role'] == 'categorical' and col.get('protect_levels', True):
                if col['levels'] == 'keyed':
                    terms['level'].update(plan.levels.get(col['public'], {}))
                else:
                    terms['level'].update(o for o, p in col['levels'].items() if not shown(o, p))
    for source in case['sources']:
        terms['filename'].update(_filenames(source))
        if source.get('url'):
            terms['url'].add(source['url'])
            parts = urllib.parse.urlsplit(source['url'])
            terms['url'].add(parts.netloc + parts.path)
    terms['redact'].update(case['blinding']['redact'])
    strings, numbers, cells, cell_strings = set(), set(), set(), set()

    def collect(value, in_data):
        if isinstance(value, bool) or value is None:
            return
        if isinstance(value, str):
            strings.add(value)
            if NUMERIC.match(value.strip()) and not in_data:
                cell_strings.add(value.strip())
        elif jsonio.is_number(value):
            numbers.add(value)
            if not in_data:
                cells.add(value)
        elif isinstance(value, list):
            for v in value:
                collect(v, in_data)
        elif isinstance(value, dict):
            for v in value.values():
                collect(v, in_data)
    from .case import closed_set_map
    for c in criteria:
        # Allowed verdicts, dataset letters and category levels are small public sets printed by
        # design; naming every option reveals nothing about which one is expected.
        if c['kind'] != 'verdict' and not closed_set_map(c.get('namespace')):
            # A mapped position is a projected data value by construction (never a data-cell finding).
            collect(expected[c['name']], c.get('in_data', False) or c.get('namespace') == 'position')
    return {'terms': {k: sorted(t for t in v if t.strip()) for k, v in terms.items()},
            'answer_strings': sorted(strings), 'answer_numbers': sorted(numbers, key=repr),
            'answer_cell_numbers': sorted(cells, key=repr), 'answer_cell_strings': sorted(cell_strings),
            'plaintext': sorted(plaintext), 'canary': canary,
            'public_letters': sorted(plan.datasets.values())}


def _significant(s: str) -> int:
    mantissa = re.split('[eE]', s)[0].replace('-', '').replace('+', '').replace('.', '')
    return len(mantissa.lstrip('0'))


# A number as written in prose or a cell: optional sign, digits (optionally grouped in thousands
# with commas) or a decimal fraction, optional exponent in either case. Alphanumeric boundaries,
# so digits inside hashes, tokens or words never count.
NUMBER_RUN = re.compile(r'(?<![0-9A-Za-z.])' + NUMBER + r'(?![0-9A-Za-z]|\.[0-9])')


def _decimal(text: str):
    try:
        return Decimal(text.replace(',', '')).copy_abs()
    except (InvalidOperation, ValueError):
        return None


def answer_values(x, min_significant: int, *, integers: bool = True) -> set:
    """Unsigned values (Decimal, compared by value, so any spelling matches) an answer number is
    refused as: integers of two or more digits (when `integers`), and roundings of a float to
    `min_significant`..17 significant digits that keep at least that many significant digits."""
    out = set()
    x = abs(x)
    if isinstance(x, int) or (float(x).is_integer() and x < 1e16):
        if integers and int(x) >= 10:
            out.add(Decimal(int(x)))
        if isinstance(x, int):
            return out
    for s in {repr(x), *(f'{x:.{k}g}' for k in range(min_significant, 18))}:
        if _significant(s) >= min_significant:
            out.add(Decimal(s))
    return out


def _digits(d: Decimal) -> str:
    """Significant digits of a value without leading or trailing zeros (spelling-independent)."""
    return ''.join(map(str, d.as_tuple().digits)).strip('0') or '0'


def number_forms(x) -> set:
    """Unsigned spellings of an answer number refused in prose: integers of two or more digits, and
    float spellings with at least three significant digits (also without a leading zero). Signs and
    trailing zeros are handled by the pattern (number_pattern)."""
    forms = set()
    x = abs(x)
    if isinstance(x, int) or (x == int(x) and x < 1e16):
        if int(x) >= 10:
            forms.add(str(int(x)))
        if isinstance(x, int):
            return forms
    for s in {repr(x), *(f'{x:.{k}g}' for k in range(3, 18))}:
        if _significant(s) >= 3:
            forms.add(s)
            if s.startswith('0.'):
                forms.add(s[1:])
    return forms


def cell_values(x) -> set:
    """High-precision answer floats (six or more significant digits) refused as a data cell, by value."""
    return answer_values(x, 6, integers=False)


class _Matcher:
    """Boundary-aware term matching: set intersection over alphanumeric runs, then positional checks."""

    def __init__(self, *, hashes: bool = False):
        self.hashes = hashes
        self.entries: dict[tuple[str, str], list] = {}
        self.weak_cells: dict[str, str] = {}
        self.weak_tsv: dict[str, str] = {}
        self.weak_prose: list[tuple[re.Pattern, str]] = []
        self._patterns: dict[tuple[str, str], re.Pattern] = {}

    def add(self, term: str, category: str, mode: str | None = None, *, tsv_only: bool = False):
        if self.hashes:
            category = (category, hashlib.sha256(term.encode('utf-8')).hexdigest())
        mode = mode or classify(term)
        if mode == 'numeric':
            return
        if mode == 'weak' and tsv_only:
            self.weak_tsv.setdefault(term, set()).add(category)
            return
        if mode == 'weak':
            self.weak_cells.setdefault(term, set()).add(category)
            if LETTER.search(term):
                self.weak_prose.append((re.compile(r'(?<![^\W_])' + re.escape(term) + r'(?![^\W_])'), category))
            return
        first = ALNUM.search(term)
        norm = term.translate(ASCII_LOWER) if mode == 'ci' else term
        key = first.group().translate(ASCII_LOWER) if mode == 'ci' else first.group()
        self.entries.setdefault((mode, key), []).append((norm, first.start(), category))

    def _positional(self, mode, hay, norm):
        pattern = self._patterns.get((mode, norm))
        if pattern is None:
            pattern = self._patterns[(mode, norm)] = re.compile(r'(?<![^\W_])' + re.escape(norm) + r'(?![^\W_])')
        return pattern.search(hay) is not None

    def find(self, text: str, *, prose: bool) -> set:
        found = set()
        if not text:
            return found
        low = text.translate(ASCII_LOWER)
        for mode, hay in (('ci', low), ('cs', text)):
            runs = set(ALNUM.findall(hay))
            for run in runs:
                for norm, offset, category in self.entries.get((mode, run), ()):
                    if (norm == run and offset == 0) or self._positional(mode, hay, norm):
                        found.add(category)
        if prose:
            for pattern, category in self.weak_prose:
                if pattern.search(text):
                    found.add(category)
        return found

    def cells(self, cells, *, tsv: bool = False) -> set:
        found = {label for c in cells for label in self.weak_cells.get(c, ())}
        if tsv:
            found |= {label for c in cells for label in self.weak_tsv.get(c, ())}
        return found


class Scanner:
    def __init__(self, protected: dict):
        self.protected = protected
        self.originals = _Matcher()
        # Dataset letters are printed in file names, the contract and the prompt. A short original
        # equal to one can only be told apart inside data cells, so it is checked there only.
        letters = set(protected.get('public_letters', []))
        for category, terms in protected['terms'].items():
            for term in terms:
                self.originals.add(term, category, 'ci' if category == 'redact' and ALNUM.search(term) else None,
                                   tsv_only=term in letters)
        self.answers = _Matcher()
        numbers = list(protected['answer_numbers'])
        # Answer numbers are matched by VALUE (Decimal equality), never by spelling: exponent
        # forms in either case, padded or trailing zeros, a leading '+' or no leading zero all match.
        self.prose_values, self.cell_numbers = set(), set()
        for s in protected['answer_strings']:
            if NUMERIC.match(s.strip()):
                # A number carried as a string: refused in prose like a number (and as a data cell
                # unless its criterion declares a lookup, see answer_cell_strings).
                value = float(s.replace(',', ''))
                numbers.append(int(value) if value == int(value) and abs(value) < 1e16 and '.' not in s and 'e' not in s.lower() else value)
                if _significant(s.strip().lstrip('+-')) >= 2:
                    self.prose_values.add(_decimal(s.strip().lstrip('+-')))
            else:
                self.answers.add(s, 'answer')
        for x in numbers:
            self.prose_values |= answer_values(x, 3)
        for x in protected['answer_cell_numbers']:
            self.cell_numbers |= cell_values(x)
        self.cell_numbers |= {_decimal(s.strip().lstrip('+-')) for s in protected.get('answer_cell_strings', [])}
        self.cell_numbers.discard(None)
        self.prose_values.discard(None)
        # JSON metadata is not prose: even single-digit numeric answers must be checked.
        # Keep exact string-carried values too, without a round trip through binary floats.
        self.json_numbers = self.prose_values | {_decimal(str(x)) for x in numbers}
        self.json_numbers |= {_decimal(s.strip()) for s in protected['answer_strings'] if NUMERIC.fullmatch(s.strip())}
        self.json_numbers.discard(None)
        # Prefilter for data blocks: with the decimal points removed, any spelling of a value
        # contains its significant digits contiguously. Keep only the minimal substrings.
        digits = sorted({_digits(d) for d in self.cell_numbers}, key=len)
        self.cell_digits = [d for i, d in enumerate(digits) if not any(e in d for e in digits[:i])]
        self.plaintext = set(protected['plaintext'])
        self.canary = protected['canary'].encode()

    def _prose(self, text: str, answers: bool) -> set:
        found = self.originals.find(text, prose=True)
        if answers:
            found |= self.answers.find(text, prose=True)
            if self.prose_values and self._has_value(text, self.prose_values):
                found.add('answer')
        return found

    @staticmethod
    def _has_value(text: str, values: set) -> bool:
        for match in NUMBER_RUN.finditer(text):
            if _decimal(match.group().lstrip('+-')) in values:
                return True
        return False

    def _answer_cells(self, block: str) -> bool:
        """True when a cell of this TSV block holds an answer value (any spelling)."""
        flat = block.replace('.', '').replace(',', '')
        if not any(d in flat for d in self.cell_digits):
            return False
        for line in block.split('\n'):
            flat = line.replace('.', '').replace(',', '')
            if any(d in flat for d in self.cell_digits):
                for cell in line.split('\t'):
                    cell = cell.strip()
                    if NUMERIC.match(cell) and _decimal(cell.lstrip('+-')) in self.cell_numbers:
                        return True
        return False

    @staticmethod
    def _structural_count(path: tuple, value) -> bool:
        """Only these integer leaves of the public contract describe observable data shape."""
        if type(value) is not int or value < 0 or path[:2] != ('public', 'content'):
            return False
        if len(path) == 5 and type(path[3]) is int:
            return (path[2], path[4]) in (('namespaces', 'entries'), ('tables', 'rows'))
        return (len(path) == 6 and path[2] == 'tables' and type(path[3]) is int and
                path[4:] == ('matrix', 'columns'))

    def _json(self, raw: bytes, *, contract: bool = False) -> set:
        found = set()
        try:
            value = jsonio.loads(raw)
        except (ValueError, UnicodeDecodeError):
            return {'unparseable JSON'}
        from .projection import CONTRACT_SCHEMA
        content = value.get('public', {}).get('content', {}) if isinstance(value, dict) and isinstance(value.get('public'), dict) else {}
        contract = contract and isinstance(content, dict) and content.get('schema_version') == CONTRACT_SCHEMA
        stack = [((), value)]
        while stack:
            path, v = stack.pop()
            if isinstance(v, dict):
                for k, x in v.items():
                    found |= self._prose(k, True) | self.originals.cells([k]) | self.answers.cells([k])
                    stack.append(((*path, k), x))
            elif isinstance(v, list):
                stack.extend(((*path, i), x) for i, x in enumerate(v))
            elif isinstance(v, str):
                found |= self._prose(v, True) | self.originals.cells([v]) | self.answers.cells([v])
            elif type(v) in (int, float) and not (contract and self._structural_count(path, v)):
                if _decimal(str(v)) in self.json_numbers:
                    found.add('answer')
        return found

    def _tsv_block(self, block: str) -> set:
        found = self.originals.find(block, prose=False)
        for line in block.split('\n'):
            found |= self.originals.cells(line.split('\t'), tsv=True)
        if self.cell_numbers and self._answer_cells(block):
            found.add('answer')
        return found

    def _tsv_stream(self, f) -> tuple[set, str]:
        """Scan a TSV stream in newline-aligned blocks (never the whole file in memory). Returns
        the findings (canary included) and the sha256 of every byte read."""
        found, digest, pending = set(), hashlib.sha256(), b''
        while True:
            chunk = f.read(CHUNK)
            digest.update(chunk)
            data = pending + chunk
            if chunk:
                cut = data.rfind(b'\n')
                if cut < 0:
                    pending = data
                    continue
                block, pending = data[:cut + 1], data[cut + 1:]
            else:
                block, pending = data, b''
            if block:
                # A block ends at a newline, so neither the hex canary nor a UTF-8 sequence is split.
                if self.canary and self.canary in block:
                    found.add('canary')
                found |= self._tsv_block(block.decode('utf-8', 'replace'))
            if not chunk:
                return found, digest.hexdigest()

    def _tsv(self, raw: bytes) -> set:
        return self._tsv_stream(io.BytesIO(raw))[0]

    def scan_projection(self, root: Path, files: set) -> list[tuple[str, str]]:
        """Scan the exact analyst file set (paths come from the pinned manifest allowlist). Tables
        are streamed; the small JSON and Markdown files are read whole."""
        root = Path(root)
        findings = []
        for name in sorted(files):
            found = self.originals.find(name, prose=True)
            # Explicit synthetic attachments are original development data, not prose
            # or a blinded projection. Bind the exemption to both path and exact bytes.
            attachment = self.protected.get('synthetic_attachments', {}).get(name)
            if attachment:
                raw = jsonio.read_regular(root / name, limit=150 << 20)
                if hashlib.sha256(raw).hexdigest() != attachment:
                    findings.append(('changed synthetic attachment', name))
                if self.canary and self.canary in raw:
                    findings.append(('canary', name))
                continue
            if name.endswith('.tsv'):
                path = root / name
                if not stat.S_ISREG(path.lstat().st_mode):
                    raise ValueError('not a regular file')
                fd = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
                with os.fdopen(fd, 'rb') as f:
                    more, digest = self._tsv_stream(f)
                found |= more
            else:
                raw = jsonio.read_regular(root / name, limit=64 << 20)
                digest = hashlib.sha256(raw).hexdigest()
                if self.canary and self.canary in raw:
                    found.add('canary')
                found |= (self._json(raw, contract=name == 'DATA-CONTRACT.json') if name.endswith('.json') else
                          self._prose(raw.decode('utf-8', 'replace'), True))
            if digest in self.plaintext:
                found.add('plaintext copy of a source or answer')
            findings += [(category, name) for category in found]
        return sorted(set(findings))

    def scan_tree(self, root: Path, *, limit: int = 64 << 20, card: str | None = None,
                  detailed: bool = False) -> list:
        """Scan any tree (e.g. agent outputs) for originals and the canary. Answers are expected there."""
        root = Path(root)
        matcher = self.originals
        if detailed:
            matcher = _Matcher(hashes=True)
            letters = set(self.protected.get('public_letters', []))
            for category, terms in self.protected['terms'].items():
                for term in terms:
                    matcher.add(term, category, 'ci' if category == 'redact' and ALNUM.search(term) else None,
                                tsv_only=term in letters)
        findings = set()

        def add(label, rel):
            category, digest = label if isinstance(label, tuple) else (label, None)
            findings.add((category, rel, digest))

        pending = [root]
        while pending:
            path = pending.pop()
            rel = path.relative_to(root).as_posix()
            st = path.lstat()
            if path.is_symlink():
                add('symlink (not followed)', rel)
            elif path.is_dir():
                pending.extend(sorted(path.iterdir()))
                if rel != '.':
                    for label in matcher.find(path.name, prose=True):
                        add(label, rel)
            elif path.is_file():
                if st.st_size > limit:
                    add('unscannable (over size limit)', rel)
                    continue
                raw = path.read_bytes()
                found = matcher.find(path.name, prose=True)
                if self.canary and self.canary in raw:
                    add(('canary', hashlib.sha256(self.canary).hexdigest()), rel)
                text = raw.decode('utf-8', 'replace')
                found |= matcher.find(text, prose=True)
                found |= matcher.cells(re.split(r'[\t\n,]', text))
                for label in found:
                    add(label, rel)
            else:
                add('special file (not read)', rel)
        if detailed:
            # Structural refusals have no matched term; null cannot match a term allowlist.
            return [dict(category=c, path=p, card=card, term_sha256=h)
                    for c, p, h in sorted(findings)]
        return sorted({(c, p) for c, p, _ in findings})



ORIGINAL_VALUE = 'expected value is an original; declare its namespace'
ORIGINAL_COORDINATE = ('an expected number equals an original genomic coordinate (the projection remaps or shifts '
                       'coordinates); use namespace "position", or in_data when that number is printed in the data')


def _walk(value, strings: list, numbers: list) -> None:
    if isinstance(value, bool) or value is None:
        return
    if isinstance(value, str):
        strings.append(value)
    elif jsonio.is_number(value):
        numbers.append(value)
    elif isinstance(value, list):
        for v in value:
            _walk(v, strings, numbers)
    elif isinstance(value, dict):
        for k, v in value.items():
            strings.append(k)
            _walk(v, strings, numbers)


def inexpressible(criteria: list[dict], expected: dict, protected: dict, coordinates: set, visible) -> list[str]:
    """Refusal messages for expected values the analyst cannot produce from the projection.

    A criterion without an answer map whose expected value is (or contains) a protected original
    (identifier, level, dataset name, chromosome, column, filename, case id, URL, redact term)
    could only be passed by someone who already knows the originals, so calibration would be
    meaningless. Integral numbers equal to an original coordinate are refused unless the criterion
    maps them (`position`) or declares in_data and the number is printed in a projected
    non-coordinate cell (`visible(strings) -> printed subset`). Messages name the criterion only."""
    from .case import closed_set_map
    matcher = _Matcher()
    exact_cs, exact_ci = set(), set()
    for category, terms in protected['terms'].items():
        for term in terms:
            matcher.add(term, category, 'ci' if category == 'redact' and ALNUM.search(term) else None)
            if classify(term) == 'ci' or category == 'redact':
                exact_ci.add(term.translate(ASCII_LOWER))
            else:
                exact_cs.add(term)
    problems, lookups = {}, {}
    for c in criteria:
        if c['kind'] == 'verdict' or closed_set_map(c.get('namespace')):
            continue
        strings, numbers = [], []
        _walk(expected[c['name']], strings, numbers)
        for s in strings:
            if s in exact_cs or s.translate(ASCII_LOWER) in exact_ci or matcher.find(s, prose=True):
                problems.setdefault(c['name'], ORIGINAL_VALUE)
        if c['kind'] in ('exact', 'band') and c.get('namespace') != 'position' and coordinates:
            for x in numbers:
                if float(x).is_integer() and int(x) in coordinates:
                    if c.get('in_data'):
                        lookups.setdefault(c['name'], set()).add(str(int(x)))
                    else:
                        problems.setdefault(c['name'], ORIGINAL_COORDINATE)
    if lookups:
        printed = visible(set().union(*lookups.values()))
        for name, wanted in lookups.items():
            if not wanted <= printed:
                problems.setdefault(name, ORIGINAL_COORDINATE)
    return [f'criterion {c["name"]}: {problems[c["name"]]}' for c in criteria if c['name'] in problems]


def collisions(protected: dict, public_tokens) -> bool:
    """True when a keyed token equals an original value (the scan could not tell them apart)."""
    lowered = {t.translate(ASCII_LOWER) for terms in protected['terms'].values() for t in terms}
    return any(t.translate(ASCII_LOWER) in lowered for t in public_tokens)


def dumps_findings(findings) -> str:
    return json.dumps([{'category': c, 'path': p} for c, p in findings])
