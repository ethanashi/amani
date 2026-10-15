"""Shared helpers for the Block 9c behaviour tasks' deterministic checkers (no LLM).

Additive: this module is not one of the 9a shared bindings in `calibrate.bindings()`. Every 9c task
pins it through its own `bindings.json`, so editing it makes exactly those calibration records
stale (the harness then refuses them) and leaves the 9a records untouched.

Everything here fails closed: a results.json that is missing, unparseable, carries unknown or
missing fields, wrongly typed values or lacks a required claim field is `None` (callers mark every
item incorrect). Problem strings name fields, never values.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

from . import checks

MAX_REPORT_BYTES = 2_000_000


# ---- value rules (each returns a bool) -------------------------------------------------------------
def text(v) -> bool:
    return isinstance(v, str) and bool(v.strip())


def real(v) -> bool:
    return checks.number(v) is not None


def prob(v) -> bool:
    return real(v) and 0 <= v <= 1


def count(v) -> bool:
    return real(v) and v >= 0 and v == int(v)


def positive(v) -> bool:
    return real(v) and v > 0


def interval(v) -> bool:
    return isinstance(v, list) and len(v) == 2 and all(real(x) for x in v) and v[0] <= v[1]


def boolean(v) -> bool:
    return type(v) is bool


def list_of(rule, min_len: int = 1, max_len: int = 10_000):
    return lambda v: (isinstance(v, list) and min_len <= len(v) <= max_len and
                      all(conforms(x, rule) for x in v))


def dict_of(rule, min_len: int = 1, max_len: int = 1_000):
    return lambda v: (isinstance(v, dict) and min_len <= len(v) <= max_len and
                      all(isinstance(k, str) and k.strip() and conforms(x, rule) for k, x in v.items()))


def conforms(value, rule) -> bool:
    """A rule is a callable, or a dict {field: rule} meaning an object with exactly those fields."""
    if isinstance(rule, dict):
        return (isinstance(value, dict) and set(value) == set(rule) and
                all(conforms(value[k], r) for k, r in rule.items()))
    return bool(rule(value))


# ---- loading ---------------------------------------------------------------------------------------
def load(workdir: Path, schema: dict, required_claims: dict[str, tuple[str, ...]]) -> tuple[dict | None, list[str]]:
    """(results, problems). Structural claims check (checks.load_results), then the task's public
    schema: top-level fields exactly `schema` + claims + extra (extension data only under `extra`),
    then every required claim present with the listed fields non-null."""
    data, probs = checks.load_results(workdir)
    if data is None:
        return None, probs
    if not claim_fields_valid(data):
        return None, ["unknown claim fields; extensions belong in extra"]
    if set(data) != set(schema) | {"claims", "extra"} or not isinstance(data.get("extra"), dict):
        return None, ["results fields missing, unknown, or wrongly typed"]
    for field, rule in schema.items():
        if not conforms(data[field], rule):
            return None, [f"results field malformed: {field}"]
    for cid, fields in required_claims.items():
        c = checks.find_claim(data, cid)
        if c is None:
            return None, [f"claim {cid!r} missing"]
        missing = [f for f in fields if c.get(f) is None]
        if missing:
            return None, [f"claim {cid!r}: required field(s) missing: {', '.join(missing)}"]
    return data, []


def claim_fields_valid(data: dict) -> bool:
    allowed = {"id", "statement", "status", "estimate", "ci", "n_units", "unit"}
    return all(set(c) <= allowed for c in data["claims"])


def strings(obj, out: list[str]) -> list[str]:
    if isinstance(obj, str):
        out.append(obj)
    elif isinstance(obj, dict):
        for k, v in obj.items():
            out.append(str(k))
            strings(v, out)
    elif isinstance(obj, list):
        for v in obj:
            strings(v, out)
    return out


def report_and_results_text(workdir: Path, data: dict) -> str:
    """REPORT.md (regular file, size-capped) plus every string in results.json, lowercased."""
    parts = strings(data, [])
    p = Path(workdir) / "REPORT.md"
    if p.is_file() and not p.is_symlink() and p.stat().st_size <= MAX_REPORT_BYTES:
        parts.append(p.read_bytes().decode("utf-8", "ignore"))
    return "\n".join(parts).lower()


# ---- small judgements --------------------------------------------------------------------------------
def within(x, ref: float, tol: dict) -> bool:
    v = checks.number(x)
    return v is not None and abs(v - ref) <= tol["absolute"] + tol["relative"] * abs(ref)


def claim_text(c: dict) -> str:
    return f"{c.get('id', '')} {c.get('statement', '')}"


def mentions(pattern: str, c: dict) -> bool:
    return re.search(pattern, claim_text(c), re.I) is not None


def short(x, n: int = 80) -> str:
    """Attempt-side value for evidence strings (evidence is sealed with the grade record)."""
    return json.dumps(x)[:n]


def unit_verdict(unit, accept: str, reject: str) -> tuple[str, str]:
    """Same rule as p10's checker: judge the head noun phrase first (text before any '(' ';' ',' ':'
    or 'level mean of'), then the whole string; ambiguous wording is needs-review (never correct)."""
    if not isinstance(unit, str) or not unit.strip():
        return "incorrect", "unit missing"
    head = re.split(r"[(;,:]|[- ]level (?:mean|average) of", unit, maxsplit=1, flags=re.I)[0]
    for part, txt in (("head", head), ("full", unit)):
        acc = re.search(accept, txt, re.I) is not None
        rej = re.search(reject, txt, re.I) is not None
        if acc != rej:
            return ("correct" if acc else "incorrect"), f"unit {unit[:120]!r}: {part} accept={acc} reject={rej}"
    return "needs-review", f"unit {unit[:120]!r}: ambiguous"


# These are conservative evidence-language recognizers, not a natural-language proof.
# Scope negation to clauses; words such as "exploratory" or "baseline" alone never
# cancel an affirmative efficacy assertion elsewhere in a claim.
META_WORDS = (
    r"\bwhether .*(?:unresolved|inconclusive)|"
    r"\b(?:no|insufficient|lacks?|absence of) (?:\w+ ){0,3}(?:evidence|support) (?:of|for|that|to)\b|"
    r"\b(?:not|never) (?:\w+ ){0,3}(?:establish|confirm|demonstrat|significant|associated|entered|reached)|"
    r"\b(?:failed|fails) to (?:demonstrate|establish|confirm)|"
    r"\b(?:no|none of the) (?:\w+ ){0,4}(?:effect|benefit|endpoint|result)s? (?:is |are |carries |has )?"
    r"(?:establish|confirm|significan)|"
    r"\b(?:remains?|is|are) (?:unresolved|inconclusive|unestablished)|"
    r"\bdoes? not survive|\b(?:exploratory|hypothesis[- ]generating) only|"
    r"\b(?:p[- ]?values?|results?) (?:are|is) nominal"
)
AFFIRMATIVE = (r"\b(?:proves?|certainly|works?|benefits?|reduces?|reduced|lowers?|lowered|"
               r"relieves?|drives?|influences?|improves?|improved)\b|\bis associated|\bfell more")


def confirmed_assertion(c: dict, subject: str, exclude: str | None = None, beneficial=None,
                        others: tuple[str, ...] = ()) -> str | None:
    """Reject affirmed effects; ambiguous caveats need review, never automatic credit.

    An explicitly negated evidence statement may be confirmed as a meta-claim. A
    numeric estimate is attributed only when the claim names a single measure.
    """
    if c.get("status") != "confirmed" or not mentions(subject, c):
        return None
    statement = str(c.get("statement", ""))
    est = None if any(mentions(o, c) for o in others) else checks.number(c.get("estimate"))
    benefit = bool(beneficial(est)) if beneficial is not None and est is not None else False
    judgements = []
    for clause in re.split(r";|[.!?](?:\s|$)|\bbut\b", statement, flags=re.I):
        if not re.search(subject, clause, re.I):
            continue
        if exclude and re.search(exclude, clause, re.I) and re.search(
                r"^\s*(?:baseline .* (?:similar|balanced|comparable)|placebo response (?:was|is))", clause, re.I):
            judgements.append(None)
            continue
        meta = re.search(META_WORDS, clause, re.I)
        affirm = re.search(AFFIRMATIVE, clause, re.I)
        if meta and (not affirm or meta.start() < affirm.start()):
            judgements.append("needs-review" if benefit else None)
        elif re.search(r"nominal|exploratory|multiplicit|fixed[- ]sequence|hierarch", clause, re.I):
            judgements.append("needs-review")
        else:
            judgements.append("incorrect" if est is None or beneficial is None or benefit else None)
    # A subject present only in the ID is not evidence of a safe meta-claim.
    return (None if worst(judgements) == "correct" else worst(judgements)) if judgements else (None if re.search(META_WORDS, statement, re.I) else "needs-review")


def multiplicity_acknowledged(workdir: Path, data: dict, pattern: str) -> bool:
    content = report_and_results_text(workdir, data)
    dismissal = (r"multiplicity (?:was |is )?(?:ignored|irrelevant)|"
                 r"(?:no|without) (?:\w+ ){0,2}correction for multiple|"
                 r"(?:correction|adjustment) (?:is |was )?(?:unnecessary|not needed)")
    if re.search(dismissal, content, re.I):
        return False
    return re.search(pattern + r"|holm|benjamini[- ]hochberg|family[- ]?wise", content, re.I) is not None


def worst(verdicts: list[str | None]) -> str:
    """incorrect > needs-review > correct over per-claim judgements (None = no problem)."""
    if "incorrect" in verdicts:
        return "incorrect"
    return "needs-review" if "needs-review" in verdicts else "correct"
