#!/usr/bin/env python3
"""Remove identifier surface cues from as-written citations before verification (PW4s v2).

    python3 tools/identifier_policy.py IN.jsonl... --out OUT.jsonl

The v1 review showed two shortcuts: fabricated references kept publisher letter case while real DOIs
were lower case, and only fabricated references lacked a PMID. This tool, deterministically per row:
  * lower-cases every DOI (citations and candidate truth);
  * omits the PMID from about 35% of real references whose DOI is given (legitimate missing-PMID
    controls; reference lists often omit PMIDs). PMID-only references keep theirs;
  * gives about two thirds of the fabricated DOI references a real PMID that belongs to an unrelated paper
    (as invented references often do), verified to exist in PubMed.
Committed suite rows are accepted as input and converted to candidate form (id and split kept).
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import scholarly as S  # noqa: E402
from verify_rows import from_suite_row  # noqa: E402

OMIT_PMID_PERCENT = 35
FABRICATED_PMID_PERCENT = 65


def bucket(row: dict, salt: str) -> int:
    key = salt + '\0' + S.norm(row['sentence'])
    return int(hashlib.sha256(key.encode()).hexdigest()[:8], 16)


def unrelated_pmid(seed: int, taken: set[str]) -> str:
    candidate = 20_000_000 + seed % 18_000_000
    for _ in range(40):
        p = str(candidate)
        if p not in taken and S.pubmed_summary(p) is not None:
            return p
        candidate += 7919
    raise S.Unavailable('could not find an existing unrelated PMID')


def apply(rows: list[dict]) -> list[dict]:
    taken = {str(r['citation'].get('pmid')) for r in rows if r['citation'].get('pmid')}
    out = []
    for r in rows:
        c = dict(r['citation'])
        if c.get('doi'):
            c['doi'] = c['doi'].strip().lower()
        t = dict(r.get('truth') or {})
        if t.get('doi'):
            t['doi'] = t['doi'].strip().lower()
        if r['class'] == 'fabricated-doi':
            if c.get('doi') and not c.get('pmid') and bucket(r, 'fabricated-pmid') % 100 < FABRICATED_PMID_PERCENT:
                c['pmid'] = unrelated_pmid(bucket(r, 'pmid-value'), taken)
                taken.add(c['pmid'])
        elif c.get('doi') and r['class'] != 'wrong-metadata' and bucket(r, 'omit-pmid') % 100 < OMIT_PMID_PERCENT:
            c['pmid'] = None
        out.append({**r, 'citation': c, 'truth': t or r.get('truth')})
    return out


def main(argv: list[str]) -> int:
    out = Path(argv[argv.index('--out') + 1])
    rows = []
    for path in [a for i, a in enumerate(argv[1:], 1) if a.endswith('.jsonl') and argv[i - 1] != '--out']:
        for line in Path(path).read_text().splitlines():
            if line.strip():
                r = json.loads(line)
                rows.append(from_suite_row(r) if 'input' in r else r)
    res = apply(rows)
    out.write_text(''.join(json.dumps(r, ensure_ascii=False) + '\n' for r in res))
    real = [r for r in res if r['class'] != 'fabricated-doi']
    fab = [r for r in res if r['class'] == 'fabricated-doi']
    print(json.dumps({'rows': len(res), 'realWithoutPmid': sum(1 for r in real if not r['citation'].get('pmid')), 'real': len(real),
                      'fabricatedWithoutPmid': sum(1 for r in fab if not r['citation'].get('pmid')), 'fabricated': len(fab)}))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
