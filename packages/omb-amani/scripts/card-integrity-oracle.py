#!/usr/bin/env python3
"""Independent served-byte oracle. Standard library only; stdout contains hashes only."""
import hashlib
import itertools
import json
import pathlib
import sys


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False)


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def facts(served):
    contract = json.loads((served / 'DATA-CONTRACT.json').read_text())['public']['content']
    kinds = {n['id']: n['kind'] for n in contract['namespaces']}
    matrices = [t for t in contract['tables'] if t['layout'] == 'matrix']
    entities = {t['matrix']['header_namespace'] for t in matrices if kinds[t['matrix']['header_namespace']] == 'sample'}
    if len(entities) != 1:
        raise ValueError('oracle requires one matrix entity namespace')
    entity = next(iter(entities))
    parsed = {}
    for table in contract['tables']:
        raw = (served / table['path']).read_bytes()
        if hashlib.sha256(raw).hexdigest() != table['sha256']:
            raise ValueError('oracle table hash mismatch')
        lines = raw.decode('utf8').splitlines()
        parsed[table['path']] = (lines[0].split('\t'), [line.split('\t') for line in lines[1:]])
    parent = {}
    parent_ns = set()
    for table in contract['tables']:
        if table['layout'] != 'records':
            continue
        ids = [c for c in table['columns'] if c['role'] == 'id' and not c.get('separator')]
        e = [c for c in ids if c.get('namespace') == entity]
        if not e:
            continue
        header, rows = parsed[table['path']]
        for c in ids:
            if c.get('namespace') != entity and kinds.get(c.get('namespace')) == 'sample':
                parent_ns.add(c['namespace'])
                for row in rows:
                    a, b = row[header.index(e[0]['name'])], row[header.index(c['name'])]
                    if a in parent and parent[a] != b:
                        raise ValueError('oracle conflicting parent')
                    parent[a] = b
    if len(parent_ns) > 1:
        raise ValueError('oracle ambiguous parent')
    records = {}
    for table in contract['tables']:
        header, rows = parsed[table['path']]
        ids = [c for c in table['columns'] if c['role'] == 'id' and not c.get('separator')]
        dataset = table['dataset']
        if table['layout'] == 'matrix':
            if table['matrix']['header_namespace'] != entity:
                continue
            key_cols = [header.index(c['name']) for c in ids]
            ordered = sorted(rows, key=lambda row: tuple(row[j] for j in key_cols))
            frame = (tuple(c['namespace'] for c in ids), tuple(tuple(row[j] for j in key_cols) for row in ordered))
            for j, identifier in enumerate(header):
                if j in key_cols:
                    continue
                record = records.setdefault((dataset, identifier), {'unit': parent.get(identifier, identifier), 'profiles': set()})
                cells = tuple(row[j] for row in ordered)
                if any(cell and cell not in table['missing'] for cell in cells):
                    # Direct tuples, with no shared TS hash/candidate code.
                    record['profiles'].add((frame, cells))
        else:
            e = [c for c in ids if c.get('namespace') == entity]
            if e:
                for row in rows:
                    identifier = row[header.index(e[0]['name'])]
                    records.setdefault((dataset, identifier), {'unit': parent.get(identifier, identifier), 'profiles': set()})
    pairs = {name: [] for name in ['exact-profile', 'shared-unit', 'repeated-observation', 'union']}
    for a, b in itertools.combinations(sorted(records), 2):
        left, right = records[a], records[b]
        reasons = []
        if left['profiles'] & right['profiles']:
            reasons.append('exact-profile')
        if a[1] != b[1] and left['unit'] == right['unit']:
            reasons.append('shared-unit')
        if a[1] == b[1] and a[0] != b[0]:
            reasons.append('repeated-observation')
        for reason in reasons + (['union'] if reasons else []):
            pairs[reason].append([list(a), list(b)])
    hashes = {}
    for reason, values in pairs.items():
        involved = {tuple(record) for pair in values for record in pair}
        fact = {'count': len(values), 'pairs': sorted(values), 'datasets': sorted({r[0] for r in involved}), 'identifiers': sorted({r[1] for r in involved})}
        for name, value in fact.items():
            hashes[reason + '.' + name] = digest(value)
    return hashes


if __name__ == '__main__':
    print(canonical(facts(pathlib.Path(sys.argv[1]))))
