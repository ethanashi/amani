"""Rebuild the answer-free METABRIC projection; authentic sample-list membership only."""
import csv
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
BASE = HERE.parents[2] / 'bio-baseline'
SOURCE = Path.home() / '.omerta-bio/datasets/metabric'
GENES = ('ESR1', 'ERBB2', 'ACTB', 'MKI67')


def extract():
    manifest = json.loads((BASE / 'data/metabric.manifest.json').read_text())
    names = ['arm/expression_mrna.tsv', 'arm/clinical_sample.tsv', 'arm/clinical_patient.tsv',
             'raw/sample_list_mrna.json']
    records = []
    for name in names:
        record = next(f for f in manifest['files'] if f['path'] == name)
        p = SOURCE / name
        if hashlib.sha256(p.read_bytes()).hexdigest() != record['sha256']:
            raise SystemExit('source checksum mismatch')
        records.append(record)
    original = set(json.loads((SOURCE / names[-1]).read_text())['sampleIds'])
    def table(name, index):
        with (SOURCE / 'arm' / name).open() as f:
            return {r[index]: r for r in csv.DictReader(f, delimiter='\t')}
    samples = table('clinical_sample.tsv', 'SAMPLE_ID')
    patients = table('clinical_patient.tsv', 'PATIENT_ID')
    expr = {}
    with (SOURCE / names[0]).open() as f:
        reader = csv.reader(f, delimiter='\t'); header = next(reader)
        for row in reader:
            if row[0] in GENES:
                if row[0] in expr:
                    raise SystemExit('nonunique target gene')
                expr[row[0]] = dict(zip(header[2:], row[2:]))
    if set(expr) != set(GENES):
        raise SystemExit('missing target gene')
    seen = set()
    with (HERE / 'source-data.tsv').open('w', newline='') as f:
        w = csv.writer(f, delimiter='\t', lineterminator='\n')
        w.writerow(['sample_id', 'cohort', 'er_status', 'her2_snp6', *GENES])
        for sid in sorted(original & set(samples) & set(expr['ESR1'])):
            s = samples[sid]; pid = s['PATIENT_ID']
            if pid in seen:
                raise SystemExit('multiple authentic samples per patient')
            seen.add(pid)
            p = patients[pid]
            vals = [expr[g][sid] for g in GENES]
            if any(v in ('', 'NA') for v in vals):
                continue
            w.writerow([sid, p['COHORT'], ('Positive' if p['ER_IHC']=='Positve' else p['ER_IHC']), p['HER2_SNP6'], *vals])
    provenance = {'source': manifest['source'], 'study': manifest['study_id'], 'terms': manifest['terms'],
                  'source_files': records, 'recipe': 'Authentic mRNA sample-list intersection; unique patient; four complete target genes; ER_IHC Positve spelling normalized to Positive; HER2_SNP6 independent copy-number assay retained; sorted sample ID.',
                  'projection_sha256': hashlib.sha256((HERE / 'source-data.tsv').read_bytes()).hexdigest()}
    (HERE / 'provenance.json').write_text(json.dumps(provenance, sort_keys=True, indent=2)+'\n')


if __name__ == '__main__':
    extract()
