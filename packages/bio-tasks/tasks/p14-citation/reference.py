#!/usr/bin/env python3
"""Arm D for p14-citation: the scripted reference check (positive control).

    reference.py --data STAGED_DIR --truth TRUTH.json --out KEYDIR

Parses the draft's reference list, looks every DOI up in the staged literature index, and combines
that with generator truth (which cited record does not support its sentence) into the answer key.
Writes KEYDIR/key.json (sealed by `biotasks seal`) and KEYDIR/workdir/ (the reference answer used by
calibration). KEYDIR must be inside the grading root. Design guards fail by name, never by value.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "lib"))

from biotasks.paths import require_under_grading_root  # noqa: E402

TASK = "p14-citation"
REF_LINE = re.compile(r"^(\d+)\. (.+) \((\d{4})\)\. (.+?)\. (.+) (\d+):(\d+-\d+)\. doi:(\S+)$")


def parse_draft(stage: Path) -> tuple[dict[int, str], dict[int, str]]:
    """({ref number: DOI}, {ref number: title}) from the draft's reference list."""
    text = (stage / "data" / "draft_introduction.md").read_text()
    dois, titles = {}, {}
    for line in text.split("## References", 1)[1].splitlines():
        m = REF_LINE.match(line.strip())
        if m:
            dois[int(m.group(1))], titles[int(m.group(1))] = m.group(8), m.group(4)
    return dois, titles


def load_index(stage: Path) -> dict[str, dict]:
    recs = [json.loads(ln) for ln in (stage / "data" / "literature_records.jsonl").read_text().splitlines() if ln]
    rows = (stage / "data" / "literature_index.tsv").read_text().splitlines()
    tsv_dois = [r.split("\t")[1] for r in rows[1:]]
    if tsv_dois != [r["doi"] for r in recs]:
        raise SystemExit("design guard failed: index_files_consistent")
    return {r["doi"]: r for r in recs}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True, type=Path)
    ap.add_argument("--truth", required=True, type=Path)
    ap.add_argument("--out", required=True, type=Path)
    a = ap.parse_args()
    require_under_grading_root(a.out, "reference output")
    require_under_grading_root(a.truth, "generator truth")
    truth = json.loads(a.truth.read_text())
    refs, titles = parse_draft(a.data)
    index = load_index(a.data)
    f1, f2 = truth["unsupportive_ref"], truth["absent_ref"]
    found = {n: doi in index for n, doi in refs.items()}
    guards = {
        "ten_references": sorted(refs) == list(range(1, 11)),
        "dois_match_truth": {r["ref"]: r["doi"] for r in truth["refs"]} == refs,
        "unique_index_dois": len(index) == len((a.data / "data" / "literature_records.jsonl").read_text().splitlines()),
        "absent_doi_not_indexed": not found.get(f2, True),
        "absent_title_not_indexed": f2 in titles and all(r["title"] != titles[f2] for r in index.values()),
        "other_dois_indexed": all(found[n] for n in refs if n != f2),
        "unsupportive_is_distinct": f1 != f2,
    }
    failed = sorted(k for k, ok in guards.items() if not ok)
    if failed:
        print("design guard failed: " + ", ".join(failed), file=sys.stderr)
        return 3
    record_id = {n: index[d]["record_id"] if d in index else "" for n, d in refs.items()}
    key = {
        "schema": "bio-tasks/key@1", "task": TASK, "n_refs": len(refs),
        "dois": {str(n): d for n, d in refs.items()}, "record_ids": {str(n): record_id[n] for n in refs},
        "unsupportive_ref": f1, "absent_ref": f2,
        "status_unsupportive": ["refuted"], "status_absent": ["insufficient-evidence", "refuted"],
        "status_supported": ["confirmed"],
        "tolerance": {"absolute": 0, "relative": 0},
        "flaws": {"F1": "one cited record exists in the index but its findings do not support the sentence citing it",
                  "F2": "one cited DOI (with a complete-looking reference) is absent from the index: fabricated"},
    }
    a.out.mkdir(parents=True, exist_ok=True)
    (a.out / "key.json").write_text(json.dumps(key, indent=2, sort_keys=True) + "\n")
    work = a.out / "workdir"
    work.mkdir(exist_ok=True)
    claims, references = [], []
    for n in sorted(refs):
        status = "refuted" if n == f1 else "insufficient-evidence" if n == f2 else "confirmed"
        claims.append({"id": f"ref-{n}", "status": status,
                       "statement": {"refuted": "The indexed record does not support the sentence",
                                     "insufficient-evidence": "No record with this DOI exists in the index",
                                     "confirmed": "The indexed record supports the sentence"}[status]})
        references.append({"ref": n, "doi": refs[n], "found_in_index": found[n], "record_id": record_id[n]})
    (work / "results.json").write_text(json.dumps({"claims": claims, "references": references, "extra": {}},
                                                  indent=2) + "\n")
    (work / "REPORT.md").write_text("# Reference check (arm D)\n\nEvery DOI was looked up in the literature index and "
                                    "each indexed abstract was compared with the sentence citing it.\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
