"""Retired-case source staging functions; no analysis or answer-key logic."""
import gzip, io
import numpy as np
SSF = {'pos': 'base_pair_location', 'ea': 'effect_allele', 'oa': 'other_allele', 'beta': 'beta', 'se': 'standard_error',
       'eaf': 'effect_allele_frequency', 'p': 'p_value', 'id': 'rsid'}
FG = {'pos': 'pos', 'ea': 'alt', 'oa': 'ref', 'beta': 'beta', 'se': 'sebeta', 'eaf': 'af_alt', 'p': 'pval', 'id': 'rsids'}
STD_HEADER = ['chromosome', 'base_pair_location', 'effect_allele', 'other_allele', 'beta', 'standard_error',
              'effect_allele_frequency', 'p_value', 'rsid']
STD_FROM_FG = ['#chrom', 'pos', 'alt', 'ref', 'beta', 'sebeta', 'af_alt', 'pval', 'rsids']

def text_lines(path):
    raw = open(path, 'rb').read()
    if raw[:2] == b'\x1f\x8b':
        raw = gzip.decompress(raw)
    return [l[:-1] if l.endswith('\r') else l for l in raw.decode('utf-8').split('\n')]

def table(path):
    lines = [l for l in text_lines(path) if l]
    header = lines[0].split('\t')
    return header, [l.split('\t') for l in lines[1:]]

def num(x):
    return float('nan') if x in ('', 'NA') else float(x)

def load(path, cols):
    h, rows = table(path)
    i = {k: n for n, k in enumerate(h)}
    out = []
    for r in rows:
        out.append({'pos': int(r[i[cols['pos']]]), 'ea': r[i[cols['ea']]], 'oa': r[i[cols['oa']]],
                    'beta': num(r[i[cols['beta']]]), 'se': num(r[i[cols['se']]]), 'eaf': num(r[i[cols['eaf']]]),
                    'p': num(r[i[cols['p']]]), 'id': r[i[cols['id']]]})
    return out

def build_outcome2_std(raw_path):
    """The projected cohort-2 table: the raw slice's cells, byte for byte, in the cohort-1 column order and
    names (drops nearest_genes, mlogp, af_alt_cases, af_alt_controls). LF line endings."""
    h, rows = table(raw_path)
    i = [h.index(c) for c in STD_FROM_FG]
    out = io.StringIO()
    out.write('\t'.join(STD_HEADER) + '\n')
    for r in rows:
        out.write('\t'.join(r[n] for n in i) + '\n')
    return out.getvalue().encode('utf-8')

def vkey(pos, a, b):
    return (pos,) + tuple(sorted((a, b)))

def eur_samples(path):
    h, rows = table(path)
    return {r[0] for r in rows if len(r) > 2 and r[2] == 'EUR'}

def panel_records(vcf_path, eur):
    """(header sample names in VCF order, list of (pos, ref, alt, dosage-of-alt array)) for EUR."""
    names, recs = None, []
    for line in gzip.open(vcf_path, 'rt', encoding='utf-8', newline='\n'):
        line = line.rstrip('\n')
        if not line or line.startswith('##'):
            continue
        f = line.split('\t')
        if line.startswith('#CHROM'):
            idx = [n for n, c in enumerate(f) if c in eur]
            if len(idx) != len(eur):
                raise SystemExit(3)
            names = [f[n] for n in idx]
            continue
        if ',' in f[4]:
            continue
        g = np.fromiter((int(f[n][0]) + int(f[n][2]) for n in idx), dtype=np.int64, count=len(idx))
        recs.append((int(f[1]), f[3], f[4], g))
    return names, recs

def build_refdosage(vcf_path, samples_path, sumstat_keys):
    """The projected reference table: EUR-polymorphic biallelic records whose (position, allele pair)
    occurs in any summary-statistics table; dosage of the ALT allele (counted_allele)."""
    names, recs = panel_records(vcf_path, eur_samples(samples_path))
    count = {}
    for pos, ref, alt, g in recs:
        count[vkey(pos, ref, alt)] = count.get(vkey(pos, ref, alt), 0) + 1
    out = io.StringIO()
    out.write('\t'.join(['chromosome', 'position', 'counted_allele', 'other_allele'] + names) + '\n')
    kept = {}
    for pos, ref, alt, g in recs:
        k = vkey(pos, ref, alt)
        if count[k] != 1 or k not in sumstat_keys:
            continue
        s = int(g.sum())
        if s == 0 or s == 2 * len(g):
            continue
        out.write('\t'.join(['7', str(pos), alt, ref] + [str(int(x)) for x in g]) + '\n')
        kept[k] = (ref, alt, g)
    return out.getvalue().encode('utf-8'), kept
