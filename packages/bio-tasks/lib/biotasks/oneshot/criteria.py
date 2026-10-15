"""Criteria: the public view, expected values mapped into the blinded namespace, grading and
calibration controls.

Expected values (from answer_key.py output or author literals) exist only inside the seal.
criteria.json (host-only, hash-bound into the seal) carries names, kinds, report pointers and
tolerances, never an expected value. The analyst sees the public view: names, kinds, report
pointers, namespaces, allowed verdicts and descriptions; tolerances are not published.
"""
from __future__ import annotations

import copy
import math

from . import jsonio

PUBLIC_KEYS = ('name', 'kind', 'report', 'namespace', 'allowed', 'description')
HOST_KEYS = PUBLIC_KEYS + ('absolute', 'relative', 'min_jaccard', 'in_data')


class CriteriaError(ValueError):
    pass


def public_view(criteria: list[dict]) -> list[dict]:
    return [{k: c[k] for k in PUBLIC_KEYS if c.get(k) is not None} for c in criteria]


def host_view(criteria: list[dict]) -> list[dict]:
    return [{k: c[k] for k in HOST_KEYS if c.get(k) is not None} for c in criteria]


def validate_host_view(view) -> list[dict]:
    """Re-validate a criteria.json document read back from a card directory."""
    from .case import _criteria
    if not isinstance(view, list):
        raise CriteriaError('criteria document must be a list')
    probe = []
    for c in view:
        if not isinstance(c, dict) or set(c) - set(HOST_KEYS):
            raise CriteriaError('criteria document has unknown keys')
        probe.append({**c, 'answer': '/x'})
    namespaces = {c['namespace'] for c in view if isinstance(c.get('namespace'), str)}
    try:
        checked = _criteria(probe, namespaces)
    except ValueError:
        raise CriteriaError('criteria document refused') from None
    if host_view(checked) != view:
        raise CriteriaError('criteria document is not normalized')
    return checked


def map_value(value, namespace, maps, *, strict: bool):
    if namespace is None:
        return value
    m = maps.get(namespace, {})
    if namespace == 'position':
        # Original coordinate -> projected coordinate; None marks a coordinate that maps
        # differently on two chromosomes (ambiguous without the chromosome).
        if type(value) is int and m.get(value) is not None:
            return m[value]
        if strict:
            raise CriteriaError('expected position is absent from the projected coordinates or ambiguous across chromosomes')
        return value
    if isinstance(value, str):
        if value in m:
            return m[value]
        if strict:
            raise CriteriaError('expected identifier is absent from its namespace')
        return value
    if isinstance(value, list) and all(isinstance(v, str) for v in value):
        return [map_value(v, namespace, maps, strict=strict) for v in value]
    if strict:
        raise CriteriaError('namespaced expected value must be a string or a list of strings')
    return value


def _typed(c: dict, raw):
    name, kind = c['name'], c['kind']
    if kind == 'band':
        if isinstance(raw, dict) and set(raw) == {'lo', 'hi'} and jsonio.is_number(raw['lo']) and jsonio.is_number(raw['hi']) and raw['lo'] <= raw['hi']:
            return {'lo': raw['lo'], 'hi': raw['hi']}
        if jsonio.is_number(raw):
            return {'value': raw}
        raise CriteriaError(f'criterion {name}: band expects a number or {{lo, hi}}')
    if kind == 'sign':
        if not jsonio.is_number(raw):
            raise CriteriaError(f'criterion {name}: sign expects a number')
        return raw
    if kind == 'set':
        if not (isinstance(raw, list) and all(isinstance(v, str) and v for v in raw) and len(set(raw)) == len(raw)):
            raise CriteriaError(f'criterion {name}: set expects a list of unique strings')
        return list(raw)
    if kind == 'verdict':
        if raw not in c['allowed']:
            raise CriteriaError(f'criterion {name}: expected verdict is not an allowed value')
        return raw
    if c.get('namespace') == 'position':
        if type(raw) is not int:
            raise CriteriaError(f'criterion {name}: a position value must be one integer')
    elif c.get('namespace') is not None and not isinstance(raw, str):
        raise CriteriaError(f'criterion {name}: a namespaced exact value must be one identifier')
    return copy.deepcopy(raw)


def resolve_expected(criteria: list[dict], answer: dict, maps: dict) -> dict:
    expected = {}
    for c in criteria:
        raw = c['expect'] if c['literal'] else jsonio.get(answer, c['answer'])
        if jsonio.missing(raw):
            raise CriteriaError(f'criterion {c["name"]}: the answer key has no value at its pointer')
        value = _typed(c, raw)
        if c['kind'] in ('exact', 'set'):
            value = map_value(value, c.get('namespace'), maps, strict=True)
            if c['kind'] == 'set' and len(set(value)) != len(value):
                raise CriteriaError(f'criterion {c["name"]}: mapped set has duplicates')
        expected[c['name']] = value
    return expected


def _same(a, b) -> bool:
    if isinstance(a, bool) or isinstance(b, bool):
        return type(a) is type(b) and a == b
    if jsonio.is_number(a) and jsonio.is_number(b):
        return a == b
    if isinstance(a, str) and isinstance(b, str):
        return a == b
    if a is None or b is None:
        return a is None and b is None
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(_same(x, y) for x, y in zip(a, b))
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(_same(a[k], b[k]) for k in a)
    return False


def _sign(x) -> int:
    return (x > 0) - (x < 0)


def check(c: dict, expected, value) -> bool:
    if jsonio.missing(value):
        return False
    kind = c['kind']
    if kind == 'exact':
        return _same(value, expected)
    if kind == 'verdict':
        return isinstance(value, str) and value in c['allowed'] and value == expected
    if kind == 'band':
        if not jsonio.is_number(value):
            return False
        if 'lo' in expected:
            return expected['lo'] <= value <= expected['hi']
        v = expected['value']
        bound = max(c['absolute'], c['relative'] * abs(v))
        return math.isfinite(value - v) and abs(value - v) <= bound
    if kind == 'sign':
        return jsonio.is_number(value) and _sign(value) == _sign(expected)
    if kind == 'set':
        if not isinstance(value, list) or not all(isinstance(v, str) for v in value) or len(set(value)) != len(value):
            return False
        a, b = set(value), set(expected)
        union = a | b
        return (len(a & b) / len(union) if union else 1.0) >= c['min_jaccard']
    return False


def evaluate(criteria: list[dict], expected: dict, report) -> list[dict]:
    """Per-criterion pass/fail. The result carries criterion names and booleans, nothing else."""
    if set(expected) != {c['name'] for c in criteria}:
        raise CriteriaError('sealed expectations do not match the criteria')
    out = []
    for c in criteria:
        value = jsonio.get(report, c['report']) if isinstance(report, dict) else jsonio._MISSING
        try:
            passed = check(c, expected[c['name']], value)
        except (TypeError, ValueError, OverflowError):
            passed = False
        out.append({'name': c['name'], 'passed': bool(passed)})
    return out


def reference_value(c: dict, expected):
    if c['kind'] == 'band':
        return expected['value'] if 'value' in expected else (expected['lo'] + expected['hi']) / 2
    if c['kind'] == 'set':
        return sorted(expected)
    return copy.deepcopy(expected)


def reference_report(criteria: list[dict], expected: dict) -> dict:
    report = {}
    for c in criteria:
        if jsonio.missing(jsonio.get(report, c['report'])):
            jsonio.put(report, c['report'], reference_value(c, expected[c['name']]))
    return report


def _replace(report: dict, pointer: str, value) -> dict:
    out = copy.deepcopy(report)
    parts = jsonio.pointer_parts(pointer)
    current = out
    for part in parts[:-1]:
        if not isinstance(current, dict) or not isinstance(current.get(part), dict):
            return out
        current = current[part]
    if isinstance(current, dict) and parts[-1] in current:
        current[parts[-1]] = value
    return out


def map_report(criteria: list[dict], report, maps: dict):
    """Map an author's unblinded naive report into tokens (unknown originals stay unmatched)."""
    if not isinstance(report, dict):
        return report
    for c in criteria:
        if c.get('namespace') is not None:
            value = jsonio.get(report, c['report'])
            if not jsonio.missing(value):
                report = _replace(report, c['report'], map_value(value, c['namespace'], maps, strict=False))
    return report


def calibrate(criteria: list[dict], expected: dict, naive: dict) -> tuple[dict, bool]:
    """Reference must pass; the empty report, every verdict flip and every naive report must fail."""
    reference = reference_report(criteria, expected)
    controls = {'reference': reference, 'empty': {}}
    for c in criteria:
        if c['kind'] == 'verdict':
            # Opaque control names: naming the flipped value would reveal the expected one by omission.
            alternatives = [alt for alt in c['allowed'] if alt != expected[c['name']]]
            for n, alt in enumerate(alternatives, 1):
                controls[f'flip:{c["name"]}:{n}'] = _replace(reference, c['report'], alt)
    for name, report in sorted(naive.items()):
        controls[f'naive:{name}'] = report
    outcomes = {k: all(r['passed'] for r in evaluate(criteria, expected, v)) for k, v in controls.items()}
    valid = outcomes['reference'] and not any(v for k, v in outcomes.items() if k != 'reference')
    return outcomes, valid
