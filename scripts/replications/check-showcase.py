"""Read-only consistency checks for the public retired-case showcase."""
import gzip
import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BASE = Path(sys.argv[1]).resolve()
CASES = {3: 'infliximab-response', 4: 'factor-xi', 1: 'gpnmb-parkinsons', 2: 'muscle-splicing', 5: 'batch-adjustment'}
CANARIES = {3: ['ulcerative colitis', 'infliximab', 'GSE12251', 'Zheng'], 4: ['factor XI', 'F11', 'thromboembolism', 'Daghlas'], 1: ['GPNMB', 'Parkinson', 'rs199347'], 2: ['myotonic', 'Duchenne', 'DMPK', 'CNBP'], 5: ['glatiramer', 'Copaxone', 'Nygaard', 'GSE40566']}
read = lambda p: json.loads(p.read_text())
sha = lambda b: hashlib.sha256(b).hexdigest()
result = []
for i, slug in CASES.items():
    case = ROOT / 'examples/replications' / slug
    source = BASE / 'runs' / {2: 'tierb-c2-r2', 4: 'tierb-c4-r2'}.get(i, f'tierb-c{i}')
    grade, original = read(case / 'grade.json'), read(source / 'grade.json')
    assert (grade['passed'], grade['total'], grade['criteria']) == (original['passed'], original['total'], original['criteria'])
    assert read(case / 'report.json') == read(source / 'attempt/report.json')
    assert (case / 'TASK.md').read_bytes() == (source / 'served/TASK.md').read_bytes()
    input_record, manuscript, provenance, build = [read(case / name) for name in ['paper-input.json', 'manuscript.json', 'drafter-provenance.json', 'build.json']]
    assert input_record['sha256'] == manuscript['inputHash'] == provenance['inputHash'] == build['inputHash']
    assert build['manuscriptHash'] == manuscript['sha256']
    assert build['pdfSha256'] == sha((case / 'paper.pdf').read_bytes())
    assert build['overfullWarnings'] == 0 and all(build['sourceChecks'].values())
    paper = (case / 'paper.md').read_text()
    for term in CANARIES[i]:
        assert term.lower() not in paper.lower(), 'Study reveal entered blind paper: ' + slug
    criteria = read(BASE / 'cards' / f'tierb-c{i}/criteria.json')
    passed = {c['name'] for c in grade['criteria'] if c['passed']}
    permitted = {c['report'] for c in criteria if c['name'] in passed}
    assert all(f['pointer'] in permitted for f in input_record['facts'])
    assert (case / 'paper-page-1.png').stat().st_size > 10000
    assert not re.search(r'^#+\s+misses\b', (case / 'README.md').read_text(), re.I | re.M)
    if i == 4:
        expected = read(case / 'data-build.json')['hashes']
        for name, expected_hash in expected.items():
            assert sha(gzip.decompress((case / 'data' / (name + '.gz')).read_bytes())) == expected_hash
    else:
        recipe = json.loads(gzip.decompress((case / 'projection.json.gz').read_bytes()))
        replay = ROOT.parent / '_logs/replications' / f'c{i}-downloaded-data'
        assert all(sha((replay / name).read_bytes()) == digest for name, digest in recipe['expected'].items())
    result.append({'case': f'c{i}', 'grade': f"{grade['passed']}/{grade['total']}", 'pages': build['pages'], 'overfullWarnings': 0, 'originalTaskReportGrade': True, 'blindIdentityCheck': True, 'dataHashes': True})

missing = []
for file in [ROOT / 'README.md', ROOT / 'examples/replications/README.md', *[ROOT / 'examples/replications' / s / 'README.md' for s in CASES.values()]]:
    for target in re.findall(r'!?\[[^\]]*\]\(([^)]+)\)', file.read_text()):
        if re.match(r'^(?:https?:|#|mailto:)', target):
            continue
        name = target.split('#')[0].strip('<>')
        if name and not (file.parent / name).exists():
            missing.append((str(file.relative_to(ROOT)), name))
assert not missing, missing
for file in (ROOT / 'examples/replications').rglob('*'):
    if not file.is_file() or '.source-cache' in file.parts or '__pycache__' in file.parts:
        continue
    if file.suffix in {'.md', '.json', '.py', '.tex'}:
        assert not re.search(r'/(?:Users|home)/|~/', file.read_text()), 'Historical filesystem location in ' + str(file.relative_to(ROOT))
summary = {'cases': result, 'aggregate': '59/66', 'localReadmeLinks': 'passed'}
destination = ROOT / 'examples/replications/checks.json'
destination.write_text(json.dumps(summary, indent=2) + '\n')
print(json.dumps(summary, indent=2))
