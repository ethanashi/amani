"""Host-only: derive the three projected tables from the two pinned public downloads.

  src/psi.txt.gz            public PSI matrix (pinned sha256 in case.json)
  src/series_matrix.txt.gz  public series matrix (pinned sha256 in case.json)
->
  src/psimat.tsv.gz    PSI matrix minus comma-valued (multi-isoform) rows, restricted to the events with a PSI
                       value in >= 75% of each discovery group (site A tibialis biopsies, subtype 1 and
                       control; revision 1: no later step can use any other event, and the public file's
                       row count is no longer exposed); header '#Event' -> 'event'; values byte-exact
  src/evtype.tsv       event -> event type (from the ID shape only; no coordinates, no exon lengths)
  src/sampmeta.tsv     sample -> donor, group, muscle, tissue_class, site, collection

Deterministic (gzip mtime 0, sorted output). answer_key.py re-derives everything from the public
files and refuses if these derived tables disagree.
Run: <pixi python> prepare.py   (from anywhere)
"""
import csv
import gzip
import io
from pathlib import Path

HERE = Path(__file__).resolve().parent
SRC = HERE / 'src'

MUSCLE = {  # source tissue -> original level (remapped to M-codes by case.json)
    'Bicep muscle': 'bicep', 'Deltoid muscle': 'deltoid', 'Diaphragm muscle': 'diaphragm',
    'Digitorum muscle': 'digitorum', 'Gastrocnemius muscle': 'gastrocnemius', 'Heart': 'myocardium',
    'Muscle': 'skeletal_unspecified', 'Pectoral muscle': 'pectoral', 'Quadriceps muscle': 'quadriceps',
    'Rectus femoris muscle': 'rectusfemoris', 'Soleus muscle': 'soleus', 'Tibialis anterior muscle': 'tibialis',
    'Tricep muscle': 'tricep',
}
DISEASE = {'None': 'CTRL', 'myotonic dystrophy type 1': 'DM1', 'myotonic dystrophy type 2': 'DM2',
           'Duchenne muscular dystrophy': 'DMD'}
COV = 0.75
DM2_DONOR = '35'  # all of this donor's samples are subtype 2 (title + paper), whatever the characteristics field says


def event_type(event: str) -> str:
    n = event.count('@') + 1
    if n == 3:
        return 'SE'
    if n == 4:
        return 'MXE'
    if n == 2:
        return 'ALTSS' if '|' in event else 'RI'
    raise SystemExit(f'unexpected event shape ({n} segments)')


def samples():
    rows, chars = {}, []
    with gzip.open(SRC / 'series_matrix.txt.gz', 'rt', encoding='utf-8') as f:
        for line in f:
            if not line.startswith('!Sample_'):
                continue
            parts = next(csv.reader([line.rstrip('\n')], delimiter='\t'))
            if parts[0] == '!Sample_characteristics_ch1':
                chars.append(parts[1:])
            else:
                rows[parts[0]] = parts[1:]
    out = []
    for i, title in enumerate(rows['!Sample_title']):
        d = {}
        for c in chars:
            k, _, v = c[i].partition(': ')
            d[k] = v
        donor = d['anonymized patient identifier']
        group = 'DM2' if donor == DM2_DONOR else DISEASE[d['disease classification']]
        tissue = d['tissue']
        out.append({'sample': title, 'donor': donor, 'group': group, 'muscle': MUSCLE[tissue],
                    'tissue_class': 'cardiac' if tissue == 'Heart' else 'skeletal',
                    'site': 'centre_' + d['anonymized center identifier'], 'collection': d['source']})
    return sorted(out, key=lambda r: r['sample'])


def main():
    meta = samples()
    byname = {r['sample']: r for r in meta}
    cols = ['sample', 'donor', 'group', 'muscle', 'tissue_class', 'site', 'collection']
    with open(SRC / 'sampmeta.tsv', 'w', encoding='utf-8', newline='') as f:
        f.write('\t'.join(cols) + '\n')
        for r in meta:
            f.write('\t'.join(r[c] for c in cols) + '\n')
    buf = io.StringIO()
    types = []
    with gzip.open(SRC / 'psi.txt.gz', 'rt', encoding='utf-8') as f:
        header = f.readline().rstrip('\n').split('\t')
        assert header[0] == '#Event' and len(header) == 127
        assert sorted(header[1:]) == sorted(r['sample'] for r in meta)
        buf.write('\t'.join(['event'] + header[1:]) + '\n')
        disc = {g: [i for i, s in enumerate(header[1:]) if byname[s]['group'] == g and byname[s]['site'] == 'centre_A'
                    and byname[s]['muscle'] == 'tibialis' and byname[s]['collection'] == 'biopsy'] for g in ('DM1', 'CTRL')}
        assert (len(disc['DM1']), len(disc['CTRL'])) == (45, 11)
        kept = dropped = uncovered = 0
        for line in f:
            parts = line.rstrip('\n').split('\t')
            assert len(parts) == 127
            if any(',' in v for v in parts[1:]):
                dropped += 1
                continue
            for v in parts[1:]:
                if v != 'n/a':
                    x = float(v)
                    assert 0.0 <= x <= 1.0
            vals = parts[1:]
            if not all(sum(vals[i] != 'n/a' for i in idx) / len(idx) >= COV for idx in disc.values()):
                uncovered += 1
                continue
            buf.write('\t'.join(parts) + '\n')
            types.append((parts[0], event_type(parts[0])))
            kept += 1
    with open(SRC / 'psimat.tsv.gz', 'wb') as raw:
        with gzip.GzipFile(filename='', mode='wb', fileobj=raw, mtime=0, compresslevel=6) as g:
            g.write(buf.getvalue().encode('utf-8'))
    with open(SRC / 'evtype.tsv', 'w', encoding='utf-8', newline='') as f:
        f.write('event\tevent_type\n')
        for e, t in sorted(types):
            f.write(f'{e}\t{t}\n')
    print(f'samples {len(meta)} events kept {kept} dropped(comma) {dropped} dropped(discovery coverage) {uncovered}')


if __name__ == '__main__':
    main()
