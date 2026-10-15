"""Strict JSON in and canonical JSON out. Duplicate keys, NaN/Infinity and non-finite floats refuse."""
from __future__ import annotations

import hashlib
import json
import math
import os
import re
import stat
from pathlib import Path

from ..discovery.blinding import canonical, digest  # noqa: F401  (re-exported: one canonical form)


class StrictJSONError(ValueError):
    pass


POINTER = re.compile(r'^(?:/[A-Za-z0-9_.-]{1,64}){1,8}$')
MAX_DEPTH = 64


def _pairs(pairs):
    out = {}
    for k, v in pairs:
        if k in out:
            raise StrictJSONError('duplicate JSON key')
        out[k] = v
    return out


def _constant(_name):
    raise StrictJSONError('non-finite JSON number')


def _finite(value, depth=0):
    if depth > MAX_DEPTH:
        raise StrictJSONError('JSON nesting limit')
    if isinstance(value, float) and not math.isfinite(value):
        raise StrictJSONError('non-finite JSON number')
    if isinstance(value, dict):
        for v in value.values():
            _finite(v, depth + 1)
    elif isinstance(value, list):
        for v in value:
            _finite(v, depth + 1)


def loads(text):
    if isinstance(text, (bytes, bytearray)):
        text = bytes(text).decode('utf-8')
    try:
        value = json.loads(text, object_pairs_hook=_pairs, parse_constant=_constant)
    except RecursionError:
        raise StrictJSONError('JSON nesting limit') from None
    _finite(value)
    return value


def read_regular(path, *, limit: int) -> bytes:
    """lstat first, never follow a symlink, never read a FIFO, never read past the cap."""
    path = Path(path)
    s = path.lstat()
    if not stat.S_ISREG(s.st_mode):
        raise StrictJSONError('not a regular file')
    if s.st_size > limit:
        raise StrictJSONError('file over size limit')
    fd = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
    with os.fdopen(fd, 'rb') as f:
        raw = f.read(limit + 1)
    if len(raw) > limit:
        raise StrictJSONError('file over size limit')
    return raw


def load_file(path, *, limit: int = 1 << 20):
    return loads(read_regular(path, limit=limit))


def canonical_line(value) -> bytes:
    return canonical(value) + b'\n'


def sha256_bytes(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def sha256_file(path) -> str:
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for block in iter(lambda: f.read(1 << 20), b''):
            h.update(block)
    return h.hexdigest()


def pointer_parts(pointer: str) -> list[str]:
    if not isinstance(pointer, str) or not POINTER.match(pointer):
        raise StrictJSONError('invalid pointer')
    return pointer.split('/')[1:]


_MISSING = object()


def get(obj, pointer: str):
    """Return the value at pointer or _MISSING. Lists are indexed by decimal segments."""
    current = obj
    for part in pointer_parts(pointer):
        if isinstance(current, dict):
            if part not in current:
                return _MISSING
            current = current[part]
        elif isinstance(current, list) and re.fullmatch(r'0|[1-9][0-9]{0,5}', part):
            index = int(part)
            if index >= len(current):
                return _MISSING
            current = current[index]
        else:
            return _MISSING
    return current


def missing(value) -> bool:
    return value is _MISSING


def put(obj: dict, pointer: str, value) -> None:
    parts = pointer_parts(pointer)
    current = obj
    for part in parts[:-1]:
        nxt = current.setdefault(part, {})
        if not isinstance(nxt, dict):
            raise StrictJSONError('pointer prefix conflict')
        current = nxt
    if parts[-1] in current and isinstance(current[parts[-1]], dict):
        raise StrictJSONError('pointer prefix conflict')
    current[parts[-1]] = value


def is_number(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)
