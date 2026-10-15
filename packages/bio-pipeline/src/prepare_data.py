#!/usr/bin/env python3
"""Recreate the exact analysed inputs from the raw data.

Generated and owned by Omerta Bio software, never by the AI analyst. It runs no analysis
code: it keeps only the effective units the validity gate journaled (explicit IDs per file,
in order), applies the recorded layout transform, and refuses to write anything that
differs by a single byte from the inputs the analysis actually used.

Python 3.8+ standard library only.

  python -I -B prepare_data.py --spec spec.json --data DATA_DIR --out NEW_DIR

Exit status 0 on success, 3 when the raw data, the spec or the result does not match.
"""
import argparse
import hashlib
import json
import operator
import os
import re
import sys
import shutil
import stat
import tempfile

POLICY = "omerta-bio-effective-input-v1"
INDEX_KEY = re.compile(r"(?:0|[1-9][0-9]*)\Z")
JSON_ESCAPES = {'"': '\\"', "\\": "\\\\", "\b": "\\b", "\f": "\\f", "\n": "\\n", "\r": "\\r", "\t": "\\t"}
JSON_NEEDS_ESCAPE = re.compile('[\\x00-\\x1f"\\\\\\ud800-\\udfff]')
CHUNK_COLUMNS = 128


class PreparationError(Exception):
    pass


def digest(data):
    return hashlib.sha256(data).hexdigest()


def js_order(names):
    """Indices of names in ECMAScript own-property order (array indices first, ascending)."""
    index = [i for i, k in enumerate(names) if INDEX_KEY.match(k) and int(k) < 4294967295]
    if not index:
        return list(range(len(names)))
    hoisted = set(index)
    return sorted(index, key=lambda i: int(names[i])) + [i for i in range(len(names)) if i not in hoisted]


def js_number(value):
    """ECMAScript Number::toString for a finite double (JSON.stringify of a number)."""
    if isinstance(value, bool):
        raise PreparationError("boolean is not a number")
    try:
        value = float(value)
    except OverflowError:
        raise PreparationError("JSON number out of range")
    if value != value or value in (float("inf"), float("-inf")):
        raise PreparationError("non-finite JSON number")
    if value == 0:
        return "0"
    if value < 0:
        return "-" + js_number(-value)
    text = repr(value)
    mantissa, _, exponent = text.partition("e")
    whole, _, fraction = mantissa.partition(".")
    digits = whole + fraction
    point = len(whole) + (int(exponent) if exponent else 0)
    stripped = digits.lstrip("0")
    point -= len(digits) - len(stripped)
    digits = stripped.rstrip("0")
    k, n = len(digits), point
    if k <= n <= 21:
        return digits + "0" * (n - k)
    if 0 < n <= 21:
        return digits[:n] + "." + digits[n:]
    if -6 < n <= 0:
        return "0." + "0" * (-n) + digits
    e = n - 1
    sign = "+" if e >= 0 else "-"
    if k == 1:
        return digits + "e" + sign + str(abs(e))
    return digits[0] + "." + digits[1:] + "e" + sign + str(abs(e))


def js_string(value):
    def escape(match):
        char = match.group(0)
        return JSON_ESCAPES.get(char) or "\\u%04x" % ord(char)
    return '"' + JSON_NEEDS_ESCAPE.sub(escape, value) + '"'


def canonical_json(value):
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, str):
        return js_string(value)
    if isinstance(value, (int, float)):
        return js_number(value)
    if isinstance(value, list):
        return "[" + ",".join(canonical_json(item) for item in value) + "]"
    if isinstance(value, dict):
        keys = sorted(value, key=lambda key: key.encode("utf-16-be", "surrogatepass"))
        return "{" + ",".join(js_string(key) + ":" + canonical_json(value[key]) for key in keys) + "}"
    raise PreparationError("unsupported JSON value")


def parse_delimited(text, delimiter):
    """The software's strict delimited reader: quoted separators/newlines, doubled quotes."""
    rows, row, field = [], [], []
    quoted = closed = False
    i, n = 0, len(text)
    while i < n:
        c = text[i]
        if quoted:
            if c != '"':
                field.append(c)
            elif i + 1 < n and text[i + 1] == '"':
                field.append('"')
                i += 1
            else:
                quoted, closed = False, True
        elif c == delimiter:
            row.append("".join(field))
            field, closed = [], False
        elif c == "\n" or c == "\r":
            if c == "\r" and i + 1 < n and text[i + 1] == "\n":
                i += 1
            row.append("".join(field))
            field, closed = [], False
            rows.append(row)
            row = []
        elif c == '"' and not field and not closed:
            quoted = True
        else:
            if closed or c == '"':
                raise PreparationError("malformed quoted table")
            field.append(c)
        i += 1
    if quoted:
        raise PreparationError("unterminated quoted table")
    if field or closed or row:
        row.append("".join(field))
        rows.append(row)
    if len(rows) < 2 or any(len(r) != len(rows[0]) for r in rows):
        raise PreparationError("empty or ragged table")
    return rows


def quote_cell(value, delimiter):
    if '"' in value or "\r" in value or "\n" in value or delimiter in value:
        return '"' + value.replace('"', '""') + '"'
    return value


def raw_lines(raw):
    """Quote-free files only: the same row boundaries as the strict reader."""
    if b"\r" in raw:
        raw = raw.replace(b"\r\n", b"\n").replace(b"\r", b"\n")
    lines = raw.split(b"\n")
    if lines and lines[-1] == b"":
        lines.pop()
    if len(lines) < 2:
        raise PreparationError("empty or ragged table")
    return lines


def unit_ids(entry):
    keep = entry["keep"]
    if not isinstance(keep, list) or not keep or not all(isinstance(k, str) for k in keep):
        raise PreparationError("spec lacks the kept unit IDs for " + entry["file"])
    return keep


def rows_fast(raw, entry, sep):
    lines = raw_lines(raw)
    del raw
    header = lines[0].split(sep)
    names = [h.decode("utf-8") for h in header]
    order = js_order(names)
    identity = order == list(range(len(names)))
    if entry["idField"] not in names:
        raise PreparationError("ID field absent from " + entry["file"])
    id_index = names.index(entry["idField"])
    by_id = {}
    for line in lines[1:]:
        if line.count(sep) != len(header) - 1:
            raise PreparationError("empty or ragged table")
        by_id[line.split(sep, id_index + 1)[id_index]] = line
    yield sep.join(header[i] for i in order) + b"\n"
    for key in unit_ids(entry):
        line = by_id.get(key.encode("utf-8"))
        if line is None:
            raise PreparationError("a kept unit is absent from the raw data: " + entry["file"])
        if identity:
            yield line + b"\n"
        else:
            cells = line.split(sep)
            yield sep.join(cells[i] for i in order) + b"\n"


def columns_fast(raw, entry, sep):
    lines = raw_lines(raw)
    del raw
    header = lines[0].split(sep)
    annotations = entry.get("featureFields") or [entry["idField"]]
    if header[0].decode("utf-8") != entry["idField"] or len(annotations) >= len(header):
        raise PreparationError("column layout differs from the analysed layout: " + entry["file"])
    body = lines[1:]
    features = []
    for line in body:
        if line.count(sep) != len(header) - 1:
            raise PreparationError("empty or ragged table")
        features.append(line.split(sep, 1)[0])
    names = [entry["idField"]] + [f.decode("utf-8") for f in features]
    encoded = [entry["idField"].encode("utf-8")] + features
    order = js_order(names)
    identity = order == list(range(len(names)))
    samples = {header[i]: i for i in range(len(annotations), len(header))}
    columns = []
    for key in unit_ids(entry):
        index = samples.get(key.encode("utf-8"))
        if index is None:
            raise PreparationError("a kept unit is absent from the raw data: " + entry["file"])
        columns.append(index)
    yield sep.join(encoded[i] for i in order) + b"\n"
    for start in range(0, len(columns), CHUNK_COLUMNS):
        chunk = columns[start:start + CHUNK_COLUMNS]
        getter = operator.itemgetter(*chunk)
        picked = [getter(line.split(sep)) for line in body]
        if len(chunk) == 1:
            picked = [(value,) for value in picked]
        for offset, values in enumerate(zip(*picked)):
            cells = (header[chunk[offset]],) + values
            if not identity:
                cells = [cells[i] for i in order]
            yield sep.join(cells) + b"\n"


def delimited_general(raw, entry, delimiter):
    """Files containing quotes: full strict reader on decoded text, re-quoted output."""
    rows = parse_delimited(raw.decode("utf-8"), delimiter)
    header = rows[0]
    if entry["sampleAxis"] == "rows":
        names = header
        if entry["idField"] not in names:
            raise PreparationError("ID field absent from " + entry["file"])
        id_index = names.index(entry["idField"])
        records = {row[id_index]: row for row in rows[1:]}
        lookup = lambda key: records.get(key)
    else:
        annotations = entry.get("featureFields") or [entry["idField"]]
        if header[0] != entry["idField"] or len(annotations) >= len(header):
            raise PreparationError("column layout differs from the analysed layout: " + entry["file"])
        body = rows[1:]
        names = [entry["idField"]] + [row[0] for row in body]
        samples = {header[i]: i for i in range(len(annotations), len(header))}

        def lookup(key):
            index = samples.get(key)
            return None if index is None else [key] + [row[index] for row in body]
    order = js_order(names)
    yield (delimiter.join(quote_cell(names[i], delimiter) for i in order) + "\n").encode("utf-8")
    for key in unit_ids(entry):
        cells = lookup(key)
        if cells is None:
            raise PreparationError("a kept unit is absent from the raw data: " + entry["file"])
        yield (delimiter.join(quote_cell(cells[i], delimiter) for i in order) + "\n").encode("utf-8")


def json_records(raw, entry):
    def refuse(name):
        raise PreparationError("non-finite JSON number")
    rows = json.loads(raw.decode("utf-8"), parse_constant=refuse)
    if not isinstance(rows, list) or not rows or not all(isinstance(row, dict) for row in rows):
        raise PreparationError("JSON table must be a nonempty array of records")
    by_id = {row.get(entry["idField"]): row for row in rows}
    selected = []
    for key in unit_ids(entry):
        if key not in by_id:
            raise PreparationError("a kept unit is absent from the raw data: " + entry["file"])
        selected.append(by_id[key])
    yield canonical_json(selected).encode("utf-8")


def transform(raw, entry):
    if entry["format"] == "json":
        if entry["sampleAxis"] != "rows":
            raise PreparationError("column-axis JSON is unsupported")
        return json_records(raw, entry)
    if entry["format"] not in ("csv", "tsv") or entry["sampleAxis"] not in ("rows", "columns"):
        raise PreparationError("unsupported layout for " + entry["file"])
    delimiter = "," if entry["format"] == "csv" else "\t"
    if b'"' in raw:
        return delimited_general(raw, entry, delimiter)
    sep = delimiter.encode("ascii")
    return rows_fast(raw, entry, sep) if entry["sampleAxis"] == "rows" else columns_fast(raw, entry, sep)


def safe_relative(name):
    if not isinstance(name, str) or not name or name.startswith("/") or "\\" in name or \
            any(part in ("", ".", "..") for part in name.split("/")):
        raise PreparationError("unsafe file name in spec")
    return name


def write_verified(target, chunks, expected_sha256, expected_bytes, label):
    """Stream to a partial file; publish only when every byte matches the analysed input."""
    os.makedirs(os.path.dirname(target), exist_ok=True)
    partial = target + ".partial"
    hasher, size = hashlib.sha256(), 0
    try:
        with open(partial, "xb") as handle:
            for chunk in chunks:
                hasher.update(chunk)
                size += len(chunk)
                handle.write(chunk)
        if size != expected_bytes or hasher.hexdigest() != expected_sha256:
            raise PreparationError("prepared input differs from the analysed input: " + label)
        os.chmod(partial, 0o444)
        os.rename(partial, target)
    finally:
        if os.path.exists(partial):
            os.remove(partial)


def read_regular(root, name):
    """Open each component without following links; hash and transform the same bytes."""
    parts = safe_relative(name).split("/")
    fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for part in parts[:-1]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = child
        leaf = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
        with os.fdopen(leaf, "rb") as handle:
            info = os.fstat(handle.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
                raise PreparationError("non-regular or linked input refused")
            return handle.read()
    finally:
        os.close(fd)


def prepare_into(spec_path, data_dir, out_dir):
    with open(spec_path, "rb") as handle:
        spec = json.loads(handle.read().decode("utf-8"))
    if not isinstance(spec, dict) or spec.get("version") != 1 or spec.get("policy") != POLICY:
        raise PreparationError("unsupported preparation spec")
    files = spec.get("files")
    if not isinstance(files, list) or not files:
        raise PreparationError("preparation spec lists no inputs")
    for entry in files:
        name = safe_relative(entry["file"])
        raw = read_regular(data_dir, name)
        if len(raw) != entry["rawBytes"] or digest(raw) != entry["rawSha256"]:
            raise PreparationError("raw input differs from the analysed data: " + name)
        chunks = transform(raw, entry)
        del raw  # the generator owns the only reference; it drops it after splitting lines
        write_verified(os.path.join(out_dir, name), chunks, entry["sha256"], entry["bytes"], name)
    manifest = spec["manifest"].encode("utf-8")
    write_verified(os.path.join(out_dir, "manifest.json"), [manifest], spec["manifestSha256"], len(manifest), "manifest.json")


def prepare(spec_path, data_dir, out_dir):
    # No partially valid directory is ever published. Existing directories (including
    # symlinks and their contents) are not reused. The host owns this parent directory.
    if os.path.lexists(out_dir):
        raise PreparationError("preparation output already exists")
    temporary = tempfile.mkdtemp(prefix=".prepare-", dir=os.path.dirname(os.path.abspath(out_dir)))
    try:
        prepare_into(spec_path, data_dir, temporary)
        if os.path.lexists(out_dir):
            raise PreparationError("preparation output appeared during preparation")
        os.rename(temporary, out_dir)
    finally:
        if os.path.exists(temporary):
            shutil.rmtree(temporary)


def main(argv=None):
    parser = argparse.ArgumentParser(description="Recreate the analysed inputs from the raw data.")
    parser.add_argument("--spec", required=True)
    parser.add_argument("--data", required=True)
    parser.add_argument("--out", default=os.environ.get("BIO_PREPARED_DIR"))
    args = parser.parse_args(argv)
    if not args.out:
        parser.error("--out or BIO_PREPARED_DIR is required")
    try:
        prepare(args.spec, args.data, args.out)
    except (PreparationError, OSError, ValueError, KeyError, TypeError, UnicodeDecodeError) as error:
        sys.stderr.write("prepare_data: refused: %s\n" % (error,))
        return 3
    return 0


if __name__ == "__main__":
    sys.exit(main())
