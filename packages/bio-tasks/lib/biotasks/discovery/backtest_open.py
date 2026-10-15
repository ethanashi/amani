"""Open Targets window B and ChEMBL MeSH joins; phase four is never an approval event."""
from __future__ import annotations
import csv
import gzip
import json
import sqlite3
import tarfile
from collections import defaultdict, Counter
from datetime import date
from pathlib import Path
from .backtest_data import floor, sha
from .blinding import canonical


def jsonlines(path):
    with gzip.open(path, 'rt') as f:
        for line in f:
            yield json.loads(line)


def load_ot(path, vintage):
    pairs = {}
    for r in jsonlines(path):
        if vintage == 2019:
            drug = r['drug']['id'].rsplit('/', 1)[-1]; dis = r['disease']['id'].rsplit('/', 1)[-1]
            ev = r['evidence']['drug2clinic']; phase = ev['max_phase_for_disease']['numeric_index']
            target = r['target']['id'].rsplit('/', 1)[-1]
            urls = [u['url'] for u in ev.get('urls', [])]; stopped = False
        else:
            drug = r['drugId']; dis = r.get('diseaseFromSourceMappedId') or ''
            phase = r.get('clinicalPhase', 0); target = r.get('targetId') or r.get('targetFromSourceId') or ''
            urls = [u.get('url', '') for u in r.get('urls', [])]
            stopped = any(c in ('Negative', 'Safety_Sideeffects') for c in r.get('studyStopReasonCategories', []))
        key = drug, dis
        item = pairs.setdefault(key, {'phase': 0, 'targets': set(), 'urls': set(), 'stopped_evidence': False})
        item['phase'] = max(item['phase'], phase or 0); item['targets'].add(target)
        item['urls'].update(urls); item['stopped_evidence'] |= stopped
    return pairs


def extract_mesh_dump(archive, out, *, work, fault_at=lambda p: None):
    """One archive at a time; delete archive AND extracted database even after SQL/fault failure.

    Caller downloads only after the previous call returns. Output is the small derived join,
    including all indication references. No extraction of arbitrary archive members.
    """
    archive, out, work = Path(archive), Path(out), Path(work)
    work.mkdir(parents=True, exist_ok=True)
    db = work/'chembl.sqlite'; partial = out.with_suffix('.partial')
    if db.exists() or partial.exists() or out.exists():
        raise ValueError('fresh sequential extraction required')
    archive_hash = sha(archive)
    try:
        with tarfile.open(archive) as tf:
            members = [m for m in tf if m.name.endswith('.db') and m.isfile()]
            if len(members) != 1:
                raise ValueError('one SQLite database required')
            floor(work, members[0].size)
            with tf.extractfile(members[0]) as src, db.open('xb') as dest:
                import shutil
                shutil.copyfileobj(src, dest, 1024*1024)
        fault_at('database-extracted')
        with sqlite3.connect(f'file:{db}?mode=ro', uri=True) as conn, partial.open('w') as dest:
            writer = csv.writer(dest, delimiter='\t', lineterminator='\n')
            writer.writerow(['drug', 'efo', 'mesh', 'ref_type', 'ref_id', 'ref_url'])
            query = '''SELECT m.chembl_id,d.efo_id,d.mesh_id,r.ref_type,r.ref_id,r.ref_url
              FROM drug_indication d JOIN molecule_dictionary m ON m.molregno=d.molregno
              LEFT JOIN indication_refs r ON r.drugind_id=d.drugind_id
              WHERE d.mesh_id IS NOT NULL'''
            writer.writerows(conn.execute(query))
        fault_at('join-written')
        partial.replace(out)
        return {'archive_sha256': archive_hash, 'derived_sha256': sha(out), 'bytes': out.stat().st_size,
                'licence': 'CC-BY-SA-3.0', 'archive_deleted': True}
    finally:
        db.unlink(missing_ok=True); archive.unlink(missing_ok=True); partial.unlink(missing_ok=True)


def mapping(rows):
    out = defaultdict(set)
    for r in rows:
        if r.get('mesh') and r.get('efo'):
            out[r['drug'], r['efo'].replace(':', '_')].add(r['mesh'])
    return out


def dated_approval(events, drug, mesh, snapshot='2019-02-01', horizon='2024-09-30'):
    """KH9: neither ATC, DailyMed, a phase delta nor an undated reference dates approval."""
    for e in events:
        if e.get('drug') != drug or e.get('mesh') != mesh:
            continue
        if e.get('regulator') not in ('FDA', 'EMA') or e.get('event') != 'indication-approval' or not e.get('url', '').startswith('https://'):
            continue
        try:
            when = date.fromisoformat(e['date'])
        except (KeyError, TypeError, ValueError):
            continue
        if date.fromisoformat(snapshot) < when <= date.fromisoformat(horizon):
            return True
    return False


# Release dates are ChEMBL dump README 'Prepared on' dates, not download dates.
CHEMBL_RELEASE_DATES = {25:'2018-12-10',26:'2020-01-10',27:'2020-05-18',28:'2021-01-15',29:'2021-07-01',30:'2022-02-22',31:'2022-07-12',32:'2023-01-26',33:'2023-05-31',34:'2024-03-28',35:'2024-12-01',36:'2025-07-28'}


from dataclasses import dataclass


@dataclass(frozen=True)
class RecordedMapping:
    """Immutable mapping plus authenticated-by-file inventory, created by load_mapping."""
    def __init__(self, rows, release, source_hash):
        from types import MappingProxyType
        object.__setattr__(self, '_rows', MappingProxyType({k:frozenset(v) for k,v in rows.items()}))
        object.__setattr__(self, 'release', release)
        object.__setattr__(self, 'release_date', CHEMBL_RELEASE_DATES[release])
        object.__setattr__(self, 'source_hash', source_hash)

    def get(self, key, default=()):
        return self._rows.get(key, default)


def load_mapping(path, manifest_path):
    """Use the dump extraction manifest; never accept a caller-supplied release date."""
    from .backtest_forward import tsv
    from .backtest_data import sha
    path, manifest_path = Path(path), Path(manifest_path)
    record = json.loads(manifest_path.read_bytes())
    release = record.get('release')
    if (release not in CHEMBL_RELEASE_DATES or record.get('release_date') != CHEMBL_RELEASE_DATES[release] or
        record.get('derived_sha256') != sha(path) or record.get('bytes') != path.stat().st_size):
        raise ValueError('mapping manifest binding refused')
    return RecordedMapping(mapping(tsv(path)),release,record['derived_sha256'])


def mesh_window(before, after, map_before, map_after, *, before_release=None, after_release=None,
                snapshot='2019-02-01', horizon='2024-09-30', events=(), registry_drugs=()):
    # Legacy date arguments can only tighten consistency checks, never confer provenance.
    for table, declared, cutoff in ((map_before,before_release,snapshot),(map_after,after_release,horizon)):
        if (not isinstance(table, RecordedMapping) or
            table.release_date != CHEMBL_RELEASE_DATES.get(table.release) or
            (declared is not None and declared != table.release_date) or
            date.fromisoformat(table.release_date) > date.fromisoformat(cutoff)):
            raise ValueError('mapping release missing, mismatched, or after its snapshot')
    def join(pairs, table):
        result = {}
        for (drug, disease), info in pairs.items():
            for mesh in table.get((drug, disease), ()):
                row = result.setdefault((drug, mesh), {'phase': 0, 'targets': set(), 'urls': set()})
                row['phase'] = max(row['phase'], info['phase'])
                row['targets'].update(info['targets']); row['urls'].update(info['urls'])
        return result
    b, a = join(before, map_before), join(after, map_after)
    rows = []; counts = Counter()
    for (drug, mesh), info in b.items():
        if not 1 <= info['phase'] <= 3:
            continue
        if drug in registry_drugs or drug == 'CHEMBL1908391':
            counts['excluded_registry_or_masitinib'] += 1
            continue
        prior = [e for e in events if e.get('drug') == drug and e.get('mesh') == mesh and e.get('regulator') in ('FDA', 'EMA') and e.get('event') == 'indication-approval' and e.get('url', '').startswith('https://')]
        prior_dates = []
        for e in prior:
            try: prior_dates.append(date.fromisoformat(e['date']))
            except (KeyError, TypeError, ValueError): pass
        if any(d <= date(2019, 2, 1) for d in prior_dates):
            counts['excluded_preexisting_approval'] += 1
            continue
        status = 'unmatched' if (drug, mesh) not in a else 'approved' if dated_approval(events, drug, mesh) else 'censored'
        # A stopped trial is not evidence that every programme for this drug/indication failed.
        counts[status] += 1
        rows.append({'drug': drug, 'indication': mesh, 'target': '|'.join(sorted(info['targets'])),
                     'phase': info['phase'], 'area': 'unknown', 'status': status, 'support': 0})
    counts['snapshot_pairs_before_mesh'] = sum(1 <= p['phase'] <= 3 for p in before.values())
    counts['snapshot_pairs_without_mesh'] = sum(1 <= p['phase'] <= 3 and not map_before.get(k) for k, p in before.items())
    return rows, dict(counts)


def genetics19(paths):
    """Retain raw as-of evidence existence; never consume OT aggregate or L2G scores."""
    pairs = set(); counts = Counter()
    for path in paths:
        for r in jsonlines(path):
            if not r.get('target', {}).get('id') or not r.get('disease', {}).get('id'):
                counts['unusable'] += 1; continue
            pairs.add((r['target']['id'].rsplit('/', 1)[-1], r['disease']['id'].rsplit('/', 1)[-1]))
            counts[Path(path).name] += 1
    return pairs, dict(counts)


def fetch_mesh_subset(root, before, *, limit=100, retrieved_at):
    """Verified small REST join fallback. Current mappings are explicitly NOT as-of mappings.

    Dated snapshots cannot be reconstructed with this fallback; outputs remain diagnostic.
    Every page is SHA-pinned and share-alike. No ChEMBL SQLite dump is downloaded here.
    """
    import urllib.parse
    from .backtest_data import fetch, write_manifest
    root = Path(root); drugs = sorted({d for (d, _), r in before.items() if 1 <= r['phase'] <= 3})[:limit]
    sources = []; rows = []
    for batch in range(0, len(drugs), 25):
        query = urllib.parse.urlencode({'molecule_chembl_id__in': ','.join(drugs[batch:batch+25]), 'limit': 1000})
        url = 'https://www.ebi.ac.uk/chembl/api/data/drug_indication.json?'+query
        page = 0
        while url:
            dest = root/f'mesh-subset-{batch}-{page}.json'
            sources.append(fetch(url, dest, licence='CC-BY-SA-3.0', retrieved_at=retrieved_at))
            body = json.loads(dest.read_bytes())
            for r in body['drug_indications']:
                rows.append({'drug': r['molecule_chembl_id'], 'mesh': r.get('mesh_id'), 'efo': r.get('efo_id')})
            next_url = body['page_meta'].get('next')
            url = urllib.parse.urljoin('https://www.ebi.ac.uk', next_url) if next_url else None
            if url and not url.startswith('https://www.ebi.ac.uk/chembl/api/data/'):
                raise ValueError('unexpected pagination host')
            page += 1
    write_manifest(root/'mesh-subset-sources.json', {'files': sources, 'asof': False, 'drugs': len(drugs), 'licence': 'CC-BY-SA-3.0'})
    return rows, sources
