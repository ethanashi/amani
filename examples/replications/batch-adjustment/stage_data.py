"""Host-only helper: derive the per-sample label table (sample column -> chip, group) from the
GEO per-GSM records saved in this directory. Deterministic; run with the pixi python.

Inputs (both fetched from GEO acc.cgi, view=brief, form=text, targ=gsm; hashes in CURATION.md):
  GSE40566_gsm_brief.soft  (105 records; title == column name in the non-normalized file)
  GSE61901_gsm_brief.soft  (214 strip-level records; 'Reanalysis of: GSM...' links to the above;
                            characteristics 'batch:' = chip, 'batchcovar:' = group)
Output: labels_from_geo.tsv (sample, chip, group) in the column order of the non-normalized file.
"""
import collections
import gzip
import sys
from pathlib import Path

here = Path(__file__).resolve().parent


def records(path):
    out, cur = [], None
    for line in path.read_text(encoding='utf-8').splitlines():
        if line.startswith('^SAMPLE = '):
            cur = {'acc': line.split(' = ', 1)[1].strip(), 'char': {}, 'rel': []}
            out.append(cur)
        elif cur is None:
            continue
        elif line.startswith('!Sample_title = '):
            cur['title'] = line.split(' = ', 1)[1].strip()
        elif line.startswith('!Sample_characteristics_ch1 = '):
            k, _, v = line.split(' = ', 1)[1].partition(':')
            cur['char'].setdefault(k.strip(), []).append(v.strip())
        elif line.startswith('!Sample_relation = '):
            cur['rel'].append(line.split(' = ', 1)[1].strip())
    return out


def main():
    a = records(here / 'GSE40566_gsm_brief.soft')
    b = records(here / 'GSE61901_gsm_brief.soft')
    by_acc = {r['acc']: r for r in a}
    strips = collections.defaultdict(list)
    for r in b:
        parents = [x.split(':', 1)[1].strip() for x in r['rel'] if x.startswith('Reanalysis of')]
        if len(parents) != 1:
            print("no single parent link:", r["acc"], r.get("title"), file=sys.stderr)
            continue
        strips[parents[0]].append(r)
    with gzip.open(here / 'GSE40566_non_normalized.txt.gz', 'rt') as fh:
        header = fh.readline().rstrip('\n').split('\t')
    cols = header[1:]
    title_to_acc = {r['title']: r['acc'] for r in a}
    assert len(title_to_acc) == len(a) == 105
    rows, problems = [], []
    for col in cols:
        acc = title_to_acc[col]
        ss = strips.get(acc, [])
        chips = {s['char']['batch'][0] for s in ss}
        groups = {s['char']['batchcovar'][0] for s in ss}
        if len(chips) != 1 or len(groups) != 1:
            problems.append((col, acc, sorted(chips), sorted(groups), len(ss)))
        rows.append((col, sorted(chips)[0] if chips else 'NA', sorted(groups)[0] if groups else 'NA', len(ss)))
    if problems:
        print('PROBLEMS', problems, file=sys.stderr)
    with open(here / 'labels_from_geo.tsv', 'w', encoding='utf-8', newline='\n') as fh:
        fh.write('sample\tchip\tgroup\n')
        for col, chip, group, _ in rows:
            fh.write(f'{col}\t{chip}\t{group}\n')
    n_strips = collections.Counter(n for *_, n in rows)
    print('strips per sample', dict(n_strips), file=sys.stderr)
    print('unmatched GSE61901 parents', sorted(set(strips) - set(by_acc)), file=sys.stderr)


if __name__ == '__main__':
    main()
