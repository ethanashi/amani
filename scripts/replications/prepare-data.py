"""Export retired-case data or deterministic public-source fetch recipes.

Usage: nice -n 10 python3 scripts/replications/prepare-data.py SOURCE_ROOT CASE
No original secret key is needed. Disguises are reconstructed by matching the
curated source tables to the retired served tables and exporting their explicit
row/column permutations and name maps. Numerical cells stay in the public source.
"""
import ast
import collections
import csv
import gzip
import hashlib
import io
import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'examples/replications'))
from fetch_utils import table, sha, rounded, project

BASE = Path(sys.argv[1]).resolve()
CASE = int(sys.argv[2])
SLUG = {1: 'gpnmb-parkinsons', 2: 'muscle-splicing', 3: 'infliximab-response', 4: 'factor-xi', 5: 'batch-adjustment'}
C = BASE / 'cases' / f'tb{CASE}'
RUN = BASE / 'runs' / {2: 'tierb-c2-r2', 4: 'tierb-c4-r2'}.get(CASE, f'tierb-c{CASE}')
OUT = ROOT / 'examples/replications' / SLUG[CASE]
OUT.mkdir(parents=True, exist_ok=True)
CONFIG = json.loads((C / 'case.json').read_text())
SOURCES = {s['name']: (C / s['path']).read_bytes() for s in CONFIG['sources']}
SERVED = RUN / 'served/data'
RECIPE = {'schema': 'amani-retired-projection/1', 'tables': [], 'registries': {}, 'licensed_annotations': [], 'expected': {p.name: sha(p.read_bytes()) for p in SERVED.iterdir()}}
MAPS = collections.defaultdict(dict)


def save_stage_ast(source, names, imports, constants=''):
    parsed = ast.parse(source.read_text())
    functions = '\n\n'.join(ast.get_source_segment(source.read_text(), node) for node in parsed.body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in names)
    (OUT / 'stage_data.py').write_text('"""Retired-case source staging functions; no analysis or answer-key logic."""\n' + imports + '\n' + constants + '\n\n' + functions + '\n')


def matrix(name, target, types=None):
    h, rows = table(SOURCES[name])
    th, tr = table(SERVED / target)
    # Column histograms are invariant to the keyed row permutation. Resolve
    # those first so equal row histograms cannot scramble their sample values.
    hist = collections.defaultdict(list)
    for col in range(1, len(h)):
        hist[sha('\t'.join(sorted(r[col] for r in rows)).encode())].append(col)
    cols = [0]
    for col in range(1, len(th)):
        cols.append(hist[sha('\t'.join(sorted(r[col] for r in tr)).encode())].pop())
    def signature(r, kind=''):
        return sha(('\t'.join(r[1:]) + '\t' + kind).encode())
    buckets = collections.defaultdict(list)
    for n, r in enumerate(rows):
        reordered = [r[c] for c in cols]
        buckets[signature(reordered, types[0].get(r[0], '') if types else '')].append(n)
    row_ids = []
    for r in tr:
        key = signature(r, types[1].get(r[0], '') if types else '')
        if not buckets[key]:
            raise RuntimeError('Source matrix row not found: ' + name)
        row_ids.append(buckets[key].pop())
    id_kind = 'event' if CASE == 2 else 'probe'
    for n, r in zip(row_ids, tr):
        MAPS[id_kind][rows[n][0]] = r[0]
    for source_col, target_col in zip(cols[1:], th[1:]):
        MAPS['sample'][h[source_col]] = target_col
    RECIPE['tables'].append({'file': target, 'source': name, 'header': th, 'rows': row_ids, 'columns': cols, 'ids': [r[0] for r in tr], 'sha256': sha((SERVED / target).read_bytes())})
    print('Matched matrix', name, '->', target, len(tr), 'rows')


def records(name, target, id_kind, key_col=0, column_names=None):
    h, rows = table(SOURCES[name]); th, tr = table(SERVED / target)
    by_id = {MAPS[id_kind][r[key_col]]: n for n, r in enumerate(rows)}
    indices = [by_id[r[0]] for r in tr]
    cols = [h.index((column_names or {}).get(col, col)) for col in th]
    rules = {}
    for col, source_col in enumerate(cols):
        mapping = {}
        for n, r in zip(indices, tr):
            old, new = rows[n][source_col], r[col]
            if old in mapping and mapping[old] != new:
                raise RuntimeError('Nonfunctional curation map: ' + name + '/' + h[source_col])
            mapping[old] = new
        if any(k != v for k, v in mapping.items()):
            rules[str(col)] = {'map': mapping}
    RECIPE['tables'].append({'file': target, 'source': name, 'header': th, 'rows': indices, 'columns': cols, 'rules': rules, 'sha256': sha((SERVED / target).read_bytes())})


def finish(fetch_body):
    for p in SERVED.glob('*aliases.tsv'):
        RECIPE['registries'][p.name] = p.read_text()
    (OUT / 'projection.json.gz').write_bytes(gzip.compress(json.dumps(RECIPE, separators=(',', ':')).encode(), mtime=0))
    for name in ['DATA-CONTRACT.json', 'manifest.json']:
        shutil.copyfile(RUN / 'served' / name, OUT / name)
    preamble = '''#!/usr/bin/env python3
"""Download original public sources and recreate the retired blinded inputs."""
import gzip
import importlib.util
import json
import sys
from pathlib import Path
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
from fetch_utils import download, project, load_recipe, sha
spec = importlib.util.spec_from_file_location('stage_data', HERE / 'stage_data.py')
stage = importlib.util.module_from_spec(spec)
spec.loader.exec_module(stage)
cache = HERE / '.source-cache'
cache.mkdir(exist_ok=True)
'''
    footer = "\nproject(load_recipe(HERE), sources, Path(sys.argv[1]) if len(sys.argv) > 1 else HERE / 'data', HERE)\n"
    (OUT / 'fetch_data.py').write_text(preamble + fetch_body + footer)
    # Independently replay every instruction against the already archived public
    # source bytes. The fetcher verifies the same download and served-file hashes.
    verify = ROOT.parent / '_logs/replications' / f'c{CASE}-data-replay'
    project(RECIPE, SOURCES, verify, OUT)
    (OUT / 'data-build.json').write_text(json.dumps({'source': 'original public sources', 'servedFiles': len(RECIPE['expected']), 'exactServedHashesVerified': True}, indent=2) + '\n')


if CASE == 3:
    for name, letter in [('m_expr', 'A'), ('l_expr', 'C'), ('a_expr', 'D')]:
        matrix(name, letter + '-expression.tsv')
    for name, letter in [('m_samples', 'A'), ('l_samples', 'C'), ('a_samples', 'D')]:
        records(name, letter + '-samples.tsv', 'sample', column_names={'patient': 'subject', 'outcome_definition': 'response_definition'})
    records('probe_genes', 'B-probe-genes.tsv', 'probe', column_names={'genes': 'symbols'})
    # Hallmark membership is explicitly CC BY 4.0. Keep attribution in the README.
    asset = 'hallmark-disguised.tsv.gz'
    data = (SERVED / 'B-gene-sets.tsv').read_bytes()
    (OUT / asset).write_bytes(gzip.compress(data, mtime=0))
    RECIPE['licensed_annotations'].append({'file': 'B-gene-sets.tsv', 'asset': asset, 'sha256': sha(data), 'licence': 'CC-BY-4.0'})
    save_stage_ast(C / 'answer_key.py', {'series', 'char', 'round3', 'cohort_bytes', 'rederive'}, 'import csv, gzip, io\nfrom decimal import Decimal, ROUND_HALF_EVEN', "Q3 = Decimal('0.001')\nDEF = {'m':'mucosal healing (endoscopic and histologic)','l':'mucosal healing (endoscopic and histologic)','a':'clinical response'}")
    downloads = {s['name']: {'url': s['url'], 'sha256': s['sha256']} for s in CONFIG['sources'] if s['name'].startswith('pub_')}
    finish('downloads = ' + repr(downloads) + "\nfor name, info in downloads.items():\n    download(info['url'], cache / name, info['sha256'])\nsources = stage.rederive(cache)\n")
elif CASE == 2:
    _, er = table(SOURCES['events']); _, et = table(SERVED / 'A-events.tsv')
    matrix('psi', 'A-psi.tsv', ({r[0]: r[1] for r in er}, {r[0]: r[1] for r in et}))
    records('events', 'A-events.tsv', 'event')
    records('samples', 'A-samples.tsv', 'sample')
    # The source staging module is the final retired-case implementation.
    text = (C / 'prepare.py').read_text().replace("HERE = Path(__file__).resolve().parent", "HERE = Path(__file__).resolve().parent")
    (OUT / 'stage_data.py').write_text(text)
    downloads = {s['path'].split('/')[-1]: {'url': s['url'], 'sha256': s['sha256']} for s in CONFIG['sources'] if s['name'].endswith('_public')}
    body = 'downloads = ' + repr(downloads) + "\nstage.SRC = cache\nfor name, info in downloads.items():\n    download(info['url'], cache / name, info['sha256'])\nstage.main()\nsources = {name: cache / filename for name, filename in {'psi':'psimat.tsv.gz','events':'evtype.tsv','samples':'sampmeta.tsv'}.items()}\n"
    finish(body)
elif CASE == 5:
    matrix('expr', 'A-expression.tsv')
    records('samples', 'A-samples.tsv', 'sample', column_names={'batch': 'chip', 'condition': 'group'})
    (OUT / 'stage_data.py').write_text((C / 'build_labels.py').read_text())
    downloads = {
        'GSE40566_non_normalized.txt.gz': ('https://ftp.ncbi.nlm.nih.gov/geo/series/GSE40nnn/GSE40566/suppl/GSE40566_non_normalized.txt.gz', sha((C / 'GSE40566_non_normalized.txt.gz').read_bytes())),
        'GSE40566_gsm_brief.soft': ('https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GSE40566&targ=gsm&form=text&view=brief', sha((C / 'GSE40566_gsm_brief.soft').read_bytes())),
        'GSE61901_gsm_brief.soft': ('https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GSE61901&targ=gsm&form=text&view=brief', sha((C / 'GSE61901_gsm_brief.soft').read_bytes())),
    }
    finish('downloads = ' + repr(downloads) + "\nfor name, (url, expected) in downloads.items():\n    download(url, cache / name, expected)\nstage.here = cache\nstage.main()\nsources = {'expr': cache / 'GSE40566_non_normalized.txt.gz', 'samples': cache / 'labels_from_geo.tsv'}\n")
elif CASE == 4:
    data = OUT / 'data'; data.mkdir(exist_ok=True)
    for p in SERVED.iterdir():
        (data / (p.name + '.gz')).write_bytes(gzip.compress(p.read_bytes(), mtime=0))
    for name in ['DATA-CONTRACT.json', 'manifest.json']:
        shutil.copyfile(RUN / 'served' / name, OUT / name)
    (OUT / 'data-build.json').write_text(json.dumps({'licence': 'CC0-1.0', 'servedFiles': len(RECIPE['expected']), 'hashes': RECIPE['expected']}, indent=2) + '\n')
    print('Exported CC0 summary-statistic tables')
elif CASE == 1:
    # The summary-statistic cells identify the shared coordinate shift; every
    # other row is then matched by position and ordered alleles, including LD.
    _, src_rows = table(SOURCES['exposure'])
    sh, src_rows = table(SOURCES['exposure'])
    th, target_rows = table(SERVED / 'C-protein-gwas.tsv')
    beta, se, pval = [sh.index(k) for k in ['beta', 'standard_error', 'p_value']]
    matching = collections.defaultdict(list)
    for row in src_rows:
        matching[(row[beta], row[se], row[pval])].append(row)
    offsets = collections.Counter(int(row[th.index('position')]) - int(original[sh.index('base_pair_location')]) for row in target_rows for original in matching[(row[th.index('beta')], row[th.index('standard_error')], row[th.index('p_value')])])
    offset = offsets.most_common(1)[0][0]
    for name, filename in [('exposure', 'C-protein-gwas.tsv'), ('outcome1', 'B-outcome-gwas.tsv'), ('outcome2std', 'D-outcome-gwas.tsv'), ('refdosage', 'A-reference-genotypes.tsv')]:
        h, rows = table(SOURCES[name]); oh, rr = table(SERVED / filename)
        pos = h.index('position' if name == 'refdosage' else 'base_pair_location')
        ea, oa = [h.index(k) for k in (['counted_allele', 'other_allele'] if name == 'refdosage' else ['effect_allele', 'other_allele'])]
        lookup = {(int(r[pos]) + offset, r[ea], r[oa]): n for n, r in enumerate(rows)}
        ip, ie, ioa = [oh.index(k) for k in (['position', 'counted_allele', 'other_allele'] if name == 'refdosage' else ['position', 'effect_allele', 'other_allele'])]
        indices = [lookup[(int(r[ip]), r[ie], r[ioa])] for r in rr]
        spec = CONFIG['blinding']['tables'][name]['columns']
        original = {v.get('as', k): k for k, v in spec.items() if v['role'] != 'drop'}
        cols = [h.index(original[col]) for col in oh]
        rules = {}
        for col, source_col in enumerate(cols):
            rule = spec[h[source_col]]
            if rule['role'] == 'position':
                rules[str(col)] = {'offset': offset}
            elif rule['role'] == 'decimal' and isinstance(rule['precision'], dict):
                rules[str(col)] = rule['precision']
            elif rule['role'] in ('id', 'chromosome'):
                mapping = {rows[n][source_col]: r[col] for n, r in zip(indices, rr)}
                rules[str(col)] = {'map': mapping}
        RECIPE['tables'].append({'file': filename, 'source': name, 'header': oh, 'rows': indices, 'columns': cols, 'rules': rules, 'sha256': sha((SERVED / filename).read_bytes())})
    names = {'text_lines', 'table', 'num', 'load', 'build_outcome2_std', 'vkey', 'eur_samples', 'panel_records', 'build_refdosage'}
    parsed = ast.parse((C / 'answer_key.py').read_text())
    constants = '\n'.join(ast.get_source_segment((C / 'answer_key.py').read_text(), n) for n in parsed.body if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id in {'SSF', 'FG', 'STD_HEADER', 'STD_FROM_FG'} for t in n.targets))
    save_stage_ast(C / 'answer_key.py', names, 'import gzip, io\nimport numpy as np', constants)
    shutil.copyfile(C / 'fetch/rtabix.py', OUT / 'rtabix.py')
    jobs = {
        'exposure': 'https://ftp.ebi.ac.uk/pub/databases/gwas/summary_statistics/GCST90059001-GCST90060000/GCST90059975/harmonised/GCST90059975.h.tsv.gz',
        'outcome1': 'https://ftp.ebi.ac.uk/pub/databases/gwas/summary_statistics/GCST009001-GCST010000/GCST009325/harmonised/GCST009325.h.tsv.gz',
        'outcome2': 'https://storage.googleapis.com/finngen-public-data-r12/summary_stats/release/finngen_R12_G6_PARKINSON.gz',
        'refvcf': 'https://ftp.1000genomes.ebi.ac.uk/vol1/ftp/data_collections/1000_genomes_project/release/20190312_biallelic_SNV_and_INDEL/ALL.chr7.shapeit2_integrated_snvindels_v2a_27022019.GRCh38.phased.vcf.gz',
    }
    expected = {n: sha(SOURCES[n]) for n in ['exposure', 'outcome1', 'outcome2', 'refsamples']}
    vcf_hash = sha(gzip.decompress(SOURCES['refvcf']))
    body = 'jobs = ' + repr(jobs) + '\nexpected = ' + repr(expected) + '''
import subprocess
for name, url in jobs.items():
    dest = cache / name
    if not dest.exists():
        subprocess.run([sys.executable, str(HERE / 'rtabix.py'), url, url + '.tbi', '7', '22735967', '23775111', str(dest)], check=True)
    if name in expected and sha(dest.read_bytes()) != expected[name]:
        raise RuntimeError('Region checksum differs: ' + name)
ref = cache / 'refvcf'
if sha(ref.read_bytes()) != ''' + repr(vcf_hash) + ''':
    raise RuntimeError('Reference region checksum differs')
(cache / 'refvcf.gz').write_bytes(gzip.compress(ref.read_bytes(), mtime=0))
download('https://ftp.1000genomes.ebi.ac.uk/vol1/ftp/release/20130502/integrated_call_samples_v3.20130502.ALL.panel', cache / 'refsamples', expected['refsamples'])
(cache / 'outcome2std').write_bytes(stage.build_outcome2_std(cache / 'outcome2'))
exp = stage.load(cache / 'exposure', stage.SSF)
o1 = stage.load(cache / 'outcome1', stage.SSF)
o2 = stage.load(cache / 'outcome2', stage.FG)
keys = {stage.vkey(v['pos'], v['ea'], v['oa']) for v in exp + o1 + o2}
dosages, _ = stage.build_refdosage(cache / 'refvcf.gz', cache / 'refsamples', keys)
sources = {'exposure': cache / 'exposure', 'outcome1': cache / 'outcome1', 'outcome2std': cache / 'outcome2std', 'refdosage': dosages}
'''
    finish(body)
else:
    raise SystemExit('Case not implemented')
