"""V3 generic primary wrapper (identical bytes for every task and analysis).

Runs after the analysis inside the software execution. Reads the analysis' own results.json and
the task-level mapping in code/omb/primary_spec.py, then writes:

* outputs/primary.json - one block per mapped claim: the claim's own estimate / ci / n_units /
  se, plus the p-value from the task's results.json path. Top-level n_units is the first mapped
  claim's n_units. Nothing is computed here; numbers are copied verbatim.
* outputs/units.tsv - the full software effective unit set (unique unit_id of data/units.tsv,
  which only the software prepare step writes). The deliverable therefore asserts that the
  analysis used every effective unit; G1a's count checks decide whether the analysis' own n agrees.

Missing results.json means the analysis failed: exit 2, so the execution is not ok.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from primary_spec import SPEC  # noqa: E402

NUMBER_FIELDS = ("estimate", "n_units", "se")


def resolve(doc, pointer):
    cur = doc
    for step in pointer:
        if isinstance(step, dict):
            key = resolve(doc, step["from"])
            if not isinstance(key, str):
                return None
            step = key
        if isinstance(cur, dict) and isinstance(step, str) and step in cur:
            cur = cur[step]
        elif isinstance(cur, list) and isinstance(step, int) and 0 <= step < len(cur):
            cur = cur[step]
        else:
            return None
    return cur


def number(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def block(results: dict, spec: dict) -> dict:
    claims = results.get("claims") if isinstance(results.get("claims"), list) else []
    claim = next((c for c in claims if isinstance(c, dict) and c.get("id") == spec["id"]), None)
    out = {}
    if claim is not None:
        for field in NUMBER_FIELDS:
            if number(claim.get(field)) is not None:
                out[field] = claim[field]
        ci = claim.get("ci")
        if isinstance(ci, list) and len(ci) == 2 and all(number(v) is not None for v in ci):
            out["ci"] = ci
    for field, key in (("estimate", "estimateFrom"), ("n_units", "nUnitsFrom")):
        if field not in out and spec.get(key):
            v = number(resolve(results, spec[key]))
            if v is not None:
                out[field] = v
    if spec.get("p"):
        p = number(resolve(results, spec["p"]))
        if p is not None:
            out["p"] = p
    return out


def main() -> int:
    try:
        results = json.loads(Path("results.json").read_text())
    except (OSError, ValueError):
        print("omb_primary: the analysis wrote no readable results.json", file=sys.stderr)
        return 2
    if not isinstance(results, dict):
        return 2
    blocks = {}
    top = None
    for spec in SPEC["claims"]:
        b = block(results, spec)
        if b:
            blocks[spec["id"]] = b
            if top is None and "n_units" in b:
                top = b["n_units"]
    primary = {"claims": blocks}
    if top is not None:
        primary["n_units"] = top
    Path("outputs").mkdir(exist_ok=True)
    Path("outputs/primary.json").write_text(json.dumps(primary, sort_keys=True, indent=2) + "\n")
    units_map = Path("data/units.tsv")
    if units_map.is_file():
        lines = units_map.read_text().splitlines()
        head = lines[0].split("\t")
        col = head.index("unit_id")
        seen = []
        known = set()
        for line in lines[1:]:
            u = line.split("\t")[col]
            if u and u not in known:
                known.add(u)
                seen.append(u)
        Path("outputs/units.tsv").write_text("unit_id\n" + "".join(u + "\n" for u in seen))
    return 0


if __name__ == "__main__":
    sys.exit(main())
