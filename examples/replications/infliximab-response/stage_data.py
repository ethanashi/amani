"""Retired-case source staging functions; no analysis or answer-key logic."""
import csv, gzip, io
from decimal import Decimal, ROUND_HALF_EVEN
Q3 = Decimal('0.001')
DEF = {'m':'mucosal healing (endoscopic and histologic)','l':'mucosal healing (endoscopic and histologic)','a':'clinical response'}

def series(path):
    meta, chars, header, rows = {}, [], None, []
    with gzip.open(path, 'rt', encoding='utf-8', newline='') as fh:
        intable = False
        for line in fh:
            if line.startswith('!series_matrix_table_begin'):
                intable = True
                continue
            if line.startswith('!series_matrix_table_end'):
                break
            parts = next(csv.reader([line.rstrip('\n')], delimiter='\t'), None)
            if not parts:
                continue
            if not intable:
                if parts[0] == '!Sample_characteristics_ch1':
                    chars.append(parts[1:])
                elif parts[0].startswith('!Sample_'):
                    meta.setdefault(parts[0], parts[1:])
                continue
            if header is None:
                header = parts[1:]
                continue
            rows.append(parts)
    if header != meta['!Sample_geo_accession']:
        raise SystemExit('series header mismatch')
    return meta, chars, header, rows

def char(chars, key):
    for c in chars:
        if c[0].startswith(key + ': '):
            return [x.split(': ', 1)[1] for x in c]
    raise SystemExit('missing characteristic')

def round3(v):
    if '.' in v and len(v.split('.', 1)[1]) > 3:
        return str(Decimal(v).quantize(Q3, rounding=ROUND_HALF_EVEN))
    return v

def cohort_bytes(tag, header, rows, keep, samples, annotated):
    idx = [header.index(g) for g in keep]
    e = io.StringIO()
    e.write('probe\t' + '\t'.join(keep) + '\n')
    for r in rows:
        if r[0] in annotated:
            e.write(r[0] + '\t' + '\t'.join(round3(r[1 + i]) for i in idx) + '\n')
    s = io.StringIO()
    s.write('sample\tsubject\tresponse\tresponse_definition\n')
    for gsm, subj, resp in samples:
        s.write(f'{gsm}\t{subj}\t{resp}\t{DEF[tag]}\n')
    return e.getvalue().encode(), s.getvalue().encode()

def rederive(src):
    ann = {}
    with gzip.open(src / 'pub_annot', 'rt', encoding='utf-8', newline='') as fh:
        intable, hdr = False, None
        for line in fh:
            if line.startswith('!platform_table_begin'):
                intable = True
                continue
            if line.startswith('!platform_table_end'):
                break
            if not intable:
                continue
            parts = line.rstrip('\n').split('\t')
            if hdr is None:
                hdr = parts
                isym = hdr.index('Gene symbol')
                continue
            sym = parts[isym].strip() if len(parts) > isym else ''
            syms = []
            for s in sym.split('///'):
                s = s.strip()
                if s and s not in syms:
                    syms.append(s)
            ann[parts[0]] = syms
    annotated = {p for p, s in ann.items() if s}
    out = {}
    meta, chars, header, rows = series(src / 'pub_m')
    lab = char(chars, 'WK8RSPHM')
    samples = [(g, meta['!Sample_title'][i].split('/')[0], 'responder' if lab[i] == 'Yes' else 'non-responder')
               for i, g in enumerate(header)]
    out['m_expr'], out['m_samples'] = cohort_bytes('m', header, rows, list(header), samples, annotated)
    probes = [r[0] for r in rows if r[0] in annotated]
    meta, chars, header, rows = series(src / 'pub_l')
    srcn, title = meta['!Sample_source_name_ch1'], meta['!Sample_title']
    keep, samples = [], []
    for i, g in enumerate(header):
        if 'before first infliximab treatment' not in srcn[i] or not title[i].startswith('UC'):
            continue
        resp = 'responder' if 'UC responder' in srcn[i] else ('non-responder' if 'UC non-responder' in srcn[i] else None)
        if resp is None:
            raise SystemExit('unlabelled biopsy')
        keep.append(g)
        samples.append((g, g, resp))
    out['l_expr'], out['l_samples'] = cohort_bytes('l', header, rows, keep, samples, annotated)
    meta, chars, header, rows = series(src / 'pub_a')
    subj, time, dose, wk8 = (char(chars, k) for k in ('subject', 'time', 'dose', 'wk8 response'))
    keep, samples = [], []
    for i, g in enumerate(header):
        if time[i] != 'W0' or dose[i] == 'placebo':
            continue
        keep.append(g)
        samples.append((g, subj[i], 'responder' if wk8[i] == 'Yes' else 'non-responder'))
    out['a_expr'], out['a_samples'] = cohort_bytes('a', header, rows, keep, samples, annotated)
    b = io.StringIO()
    b.write('probe\tsymbols\n')
    for p in probes:
        b.write(p + '\t' + ';'.join(ann[p]) + '\n')
    out['probe_genes'] = b.getvalue().encode()
    g = io.StringIO()
    g.write('gene_set\tgene\n')
    with open(src / 'pub_sets', encoding='utf-8') as fh:
        for line in fh:
            parts = line.rstrip('\n').split('\t')
            for gene in dict.fromkeys(x for x in parts[2:] if x):
                g.write(f'{parts[0].lower()}\t{gene}\n')
    out['gene_sets'] = g.getvalue().encode()
    return out
