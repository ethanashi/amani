"""Nelson snapshot joins. Original similarity and modern roll-up are separate estimands."""
from __future__ import annotations
import csv
import gzip
from collections import defaultdict, Counter
from datetime import date
from pathlib import Path
from .backtest_data import verify_sources

PHASE = {'Phase I Clinical Trial': 1, 'Phase II Clinical Trial': 2,
         'Phase III Clinical Trial': 3, 'Pre-registration': 4}
# External event dates establish a LOWER BOUND for pp.tsv's horizon, not its query timestamp.
SENTINELS = (
    ('SOD1', 'D000690', '2023-04-25', 'https://www.fda.gov/drugs/novel-drug-approvals-fda/novel-drug-approvals-2023'),
    ('PCSK9', 'D006937', '2015-07-24', 'https://www.fda.gov/drugs/new-drugs-fda-cders-new-molecular-entities-and-new-therapeutic-biological-products/novel-drug-approvals-2015'),
    ('CFTR', 'D003550', '2012-01-31', 'https://www.accessdata.fda.gov/drugsatfda_docs/nda/2012/203188Orig1s000TOC.cfm'),
)


def tsv(path):
    path = Path(path)
    with (gzip.open(path, 'rt') if path.suffix == '.gz' else path.open()) as f:
        yield from csv.DictReader(f, delimiter='\t')


def sentinel_horizon(pp, sentinels=SENTINELS):
    if len(sentinels) < 3 or len({(s[0], s[1]) for s in sentinels}) < 3:
        raise ValueError('three distinct approval sentinels required')
    dates = []
    for target, indication, when, url in sentinels:
        if pp.get(target+'-'+indication, {}).get('ccat') != 'Launched' or not url.startswith('https://'):
            raise ValueError('sentinel absent or not launched')
        dates.append(date.fromisoformat(when))
    return max(dates).isoformat()


def outcome(p, *, one_target=False, snapshot_year=2013):
    if p is None:
        return 'unmatched'
    if p['year_launch'] not in ('', 'NA') and int(p['year_launch']) <= snapshot_year:
        return 'conflicting-date'
    prefix = 'oto_' if one_target else ''
    if p.get(prefix+'ccat') in ('', 'NA', None):
        return 'unmatched'
    if p[prefix+'ccat'] == 'Launched':
        return 'approved'
    return 'negative' if p.get(prefix+'acat') in ('', 'NA') else 'censored'


def snapshot_outcome(snapshot, program, target, indication):
    if snapshot.get('lApprovedUS.EU', '').upper() == 'TRUE':
        return 'pre-snapshot-approved'
    # Dated first indication approvals override incomplete/late year_launch annotations.
    if any(t == target and i == indication and when <= '2013-12-31' for t,i,when,url in SENTINELS):
        return 'pre-snapshot-approved'
    return outcome(program)


def load_forward(root, matrix, *, threshold=.7):
    root = Path(root); verify_sources(root); verify_sources(Path(matrix).parent)
    d = root/'data'
    vocab = {}
    for r in tsv(d/'mesh_all_vocab.tsv.gz'):
        vocab.setdefault(r['labeltext'].lower(), r['id'])
    rollup = {}
    for r in tsv(d/'mesh_scr_to_best.tsv.gz'):
        if r['priority'] == 'preferredMappedTo':
            rollup.setdefault(r['scr'], r['main'])
    programs = list(tsv(d/'nelson_2015_supplementary_dataset_3.tsv'))
    genetics = list(tsv(d/'nelson_2015_supplementary_dataset_2.tsv'))
    pp = {r['ti_uid']: r for r in tsv(d/'pp.tsv')}
    areas = {r['indication_mesh_id']: r['areas'] or 'unknown' for r in tsv(d/'indic.tsv')}
    original = defaultdict(set); modern = defaultdict(set); unrolled = defaultdict(set)
    for r in genetics:
        original[r['Gene']].add(r['MSH'].lower())
        mid = vocab.get(r['MSH'].lower())
        if mid:
            modern[r['Gene']].add(rollup.get(mid, mid)); unrolled[r['Gene']].add(mid)
    inds = {vocab.get(r['MSH'].lower()) for r in programs}
    traits = set().union(*modern.values(), *unrolled.values())
    sim = {}
    for r in tsv(d/'sim.tsv.gz'):
        if r['meshcode_a'] in inds and r['meshcode_b'] in traits:
            sim[r['meshcode_a'], r['meshcode_b']] = float(r['comb_norm'])
    wanted = {r['MSH'].lower() for r in programs}
    needed = set().union(*original.values())
    orig_sim = defaultdict(set)
    with Path(matrix).open() as f:
        reader = csv.reader(f, delimiter='\t'); header = next(reader)
        # R write.table matrix: header omits the row-name field.
        selected = [(i+1, name.lower()) for i, name in enumerate(header) if name.lower() in needed]
        for row in reader:
            name = row[0].lower()
            if name in wanted:
                orig_sim[name].update(trait for i, trait in selected if row[i] not in ('NA', '') and float(row[i]) >= threshold)
    rows = []; counts = Counter(); seen = set()
    for r in programs:
        if r['Phase.Latest'] not in PHASE:
            continue
        counts['eligible_snapshot_rows'] += 1
        target = r['Gene']; term = r['MSH'].lower(); mid = vocab.get(term)
        if mid is None:
            counts['unmapped_indication'] += 1
            continue
        pair = target+'-'+mid
        if pair in seen:
            raise ValueError('ambiguous duplicate target-indication snapshot join')
        seen.add(pair)
        p = pp.get(pair)
        status = snapshot_outcome(r, p, target, mid)
        if status == 'approved' and p.get('year_launch') in ('', 'NA', None):
            counts['scored_approvals_blank_year_launch'] += 1
        def supported(source, cutoff):
            return any(m == mid or sim.get((mid, m), 0) >= cutoff for m in source.get(target, ()))
        entry = {'target': target, 'drug': '', 'indication': mid, 'phase': PHASE[r['Phase.Latest']],
                 'area': areas.get(mid, 'unknown'), 'status': status,
                 'support': int(bool(original[target] & (orig_sim.get(term, set()) | {term}))),
                 'modern_support': int(supported(modern, threshold)),
                 'support_08': int(supported(modern, .8)), 'unrolled_support': int(supported(unrolled, threshold)),
                 'original_support': int(bool(original[target] & (orig_sim.get(term, set()) | {term}))),
                 'oto_status': status if status == 'pre-snapshot-approved' else outcome(p, one_target=True)}
        rows.append(entry); counts[status] += 1
    counts['all_launched_blank_year_launch'] = sum(p['ccat'] == 'Launched' and p.get('year_launch') in ('', 'NA', None) for p in pp.values())
    return rows, {'accounting': dict(counts), 'horizon_at_least': sentinel_horizon(pp),
                  'sentinels': [{'date': r[2], 'url': r[3]} for r in SENTINELS],
                  'original_similarity': 'Nelson Supplementary Data Set 4 (not Data Set 1)',
                  'label_definition': 'Pharmaprojects Launched may include markets beyond US/EU',
                  'asof_certified': False, 'registry_drug_exclusion': 'unavailable: target-indication data has no drug IDs',
                  'ontology': 'Primary genetics: original Nelson 2013 terms and similarity matrix. 2023 vocabulary joins outcomes/areas only; 2023 genetic roll-up is a named sensitivity. year_launch is neither complete nor sufficient to establish first approval.'}


def score_forward(rows, *, seed, n=1000, permutations=300):
    from .backtest_stats import summarize
    matched = [r for r in rows if r['status'] in ('approved', 'negative', 'censored')]
    out = {'original_nelson': summarize(matched, seed=seed, n=n, permutations=permutations)}
    for name, sub in (
        ('resolved_only', [r for r in matched if r['status'] != 'censored']),
        ('modern_rollup_sensitivity', [dict(r, support=r['modern_support']) for r in matched]),
        ('threshold_08_sensitivity', [dict(r, support=r['support_08']) for r in matched]),
        ('one_target_only', [dict(r, status=r['oto_status']) for r in matched if r['oto_status'] in ('approved', 'negative', 'censored')]),
    ):
        out[name] = summarize(sub, seed=seed, n=n, permutations=0) if sub else {'available': False}
    rs = out['original_nelson']['relative_success']
    out['development_band_passed'] = bool(rs['estimate'] is not None and 1.6 <= rs['estimate'] <= 3.2 and rs['available'] and rs['ci'][0] > 1.3)
    out['d1_certified'] = False
    out['ranker_R'] = {'available': False, 'reason': 'Window A lacks direction, action, effect and coloc inputs; outcomes previously inspected'}
    out['masked_positive'] = [{'rollup': bool(r['modern_support']), 'without_rollup': bool(r['unrolled_support']),
                               'original_nelson': bool(r['original_support'])} for r in matched if r['target'] == 'SOD1' and r['indication'] == 'D000690']
    return out
