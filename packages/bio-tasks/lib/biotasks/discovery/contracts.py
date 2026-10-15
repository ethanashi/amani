"""Produce K1a contracts and validate through the real TypeScript implementation."""
import copy
import hashlib
import json
import os
import re
import subprocess
from .families import decode, HEADER, FLOATS, INTS
from .blinding import canonical, digest
from ..paths import PKG


def evidence(obj, pointer):
    if isinstance(obj, (dict, list)) and obj and not re.fullmatch(r'/structure/alias_registries/[0-9]+', pointer):
        items = obj.items() if isinstance(obj, dict) else enumerate(obj)
        return [e for k, v in items for e in evidence(v, pointer + '/' + str(k).replace('~', '~0').replace('/', '~1'))]
    return [{'pointer': pointer, 'status': 'author', 'producer_ids': ['author', 'stager'] if pointer.startswith('/structure/source_files/') else ['author'], 'citations': [], 'note': None}]


def producers(name, files, *, author_outcome_blind):
    base = {'version': '1', 'model_family': None, 'source_bundle_hash': digest(files)}
    return [{**base, 'id': 'author', 'kind': 'task-author', 'name': name, 'outcome_blind': author_outcome_blind},
            {**base, 'id': 'stager', 'kind': 'stager', 'name': 'Public byte inventory stager', 'outcome_blind': True}]


def namespace(name, kind, level=None):
    return {'id': name, 'entity_kind': kind, 'level': level, 'preserve_originals': True,
            'collision_policy': 'merge-with-limitation', 'rules': []}


def alias_registry(name, values, *, targets=None):
    """K1a TSV: JSON string cells, sorted identity mappings from public tokens only."""
    values = sorted(set(values))
    if not values or any(not isinstance(v, str) or not v for v in values):
        raise ValueError('nonempty registry identities required')
    raw = 'namespace\tencoding\toriginal\tcanonical\ttarget\n'
    for value in values:
        cells = [value, value, targets[value] if targets is not None else value]
        raw += name + '\ttoken\t' + '\t'.join(canonical(v).decode() for v in cells) + '\n'
    raw = raw.encode()
    descriptor = {'namespace': name, 'file': {'path': f'data/{name}-aliases.tsv', 'sha256': hashlib.sha256(raw).hexdigest()},
                  'format': 'omb-alias-registry-tsv/v1', 'entry_count': len(values), 'coverage': 'verify-against-data'}
    return descriptor, raw


def summary_registries(files):
    rows = decode(files['summary.tsv'])
    return [alias_registry(name, (r[name] for r in rows)) for name in ('gene', 'variant')]


def public_files(files):
    return {**files, **{d['file']['path'].removeprefix('data/'): raw for d, raw in summary_registries(files)}}


def bridge(public, private=None):
    payload = {'publicLayer': public}
    if private is not None:
        payload['privateLayer'] = private
    node = os.environ.get('BIO_DISCOVERY_NODE', '/opt/homebrew/opt/node@24/bin/node')
    result = subprocess.run([node, str(PKG / 'discovery/contract-bridge.ts')], input=canonical(payload),
                            capture_output=True, env={'PATH': '/usr/bin:/bin'})
    if result.returncode:
        raise ValueError('host contract validation refused')
    return json.loads(result.stdout)


def public_layer(files):
    # Only blinded observations enter this function. No pack/truth argument exists.
    rows = decode(files['summary.tsv'])
    registries = summary_registries(files)
    files = public_files(files)
    files = [{'path': 'data/' + name, 'sha256': hashlib.sha256(raw).hexdigest()} for name, raw in sorted(files.items())]
    cohort = rows[0]['cohort']
    unique_variants = len({r['variant'] for r in rows}) == len(rows)
    # PL1 repeats one locus across genes: composite-key cohort records. PL4 has
    # disjoint variant rows. Neither representation makes features independent units.
    columns = []
    for name in HEADER:
        ns = {'gene': 'gene', 'variant': 'variant', 'cohort': 'cohort'}.get(name)
        numeric = name in FLOATS | INTS
        columns.append({'name': name, 'storage': 'decimal' if numeric else 'string',
                        'structural_kind': 'unit' if name == 'cohort' else 'identifier' if ns else 'measurement' if numeric else 'annotation',
                        'namespace': ns, 'decimal_resolution': '0.00000001' if name in FLOATS else '1' if numeric else None,
                        'measurement': {'type': 'continuous' if name in FLOATS else 'count', 'unit': 'standardized' if name in FLOATS else 'count', 'bounds': None, 'categories': []} if numeric else None,
                        'missingness_codes': []})
    aliases = [{'namespace': 'cohort', 'encoding': 'canonical-json-array', 'original': json.dumps([cohort], separators=(',', ':')),
                'canonical': json.dumps([cohort], separators=(',', ':')), 'node': 'population'}]
    structure = {k: [] for k in ('collision_merges', 'joins', 'batch', 'time', 'assignments', 'replicate_groups', 'partitions', 'forbidden_uses', 'survival', 'row_exclusions', 'transformations')}
    structure.update(dataset_id='discovery-pack', dataset_type='summary-statistic', source_files=files,
        namespaces=[namespace('cohort', 'unit', 'cohort'), namespace('gene', 'feature'), namespace('variant', 'variant')],
        alias_registries=[d for d, _ in registries],
        graph={'nodes': [{'id': 'population', 'kind': 'target-population', 'level': 'cohort', 'namespace': 'cohort', 'original_id': cohort}], 'edges': []},
        unit_hierarchy=[{'id': 'cohort', 'coarser_level': None, 'minimum_independent': True}], aliases=aliases,
        tables=[{'id': 'summary', 'file': next(f for f in files if f['path'].endswith('summary.tsv')), 'row_key': ['variant'] if unique_variants else ['gene', 'variant'], 'columns': columns,
                 'unit_derivation': {'kind': 'column-tuple', 'columns': ['cohort'], 'encoding': 'canonical-json-array', 'namespace': 'cohort', 'level': 'cohort'},
                 'orientation': {'layout': 'records', 'unit_axis': 'rows', 'row_entity': 'variants' if unique_variants else 'units', 'header_namespace': None},
                 'alias_coverage': {'rows': 'all', 'matrix_headers': 'all', 'unresolved': 'refuse', 'ambiguous_axis': 'refuse'}}],
        dependence=[{'id': 'ld', 'kind': 'unknown', 'unit_level': 'cohort', 'cluster_nodes': [], 'description': 'Variants are dependent features, never independent subjects; LD is pinned.'}],
        summary_statistics={'cohorts': [{'id': cohort, 'accession': 'synthetic:' + cohort, 'trait_type': 'binary', 'cases': 27205, 'controls': 110881, 'ancestry': 'synthetic'}],
            'genome_build': 'synthetic-remapped', 'per_snp_n': {'table': 'summary', 'column': 'n'},
            'variant_id': {'table': 'summary', 'column': 'variant'}, 'effect_allele': {'table': 'summary', 'column': 'effect_allele'},
            'other_allele': {'table': 'summary', 'column': 'other_allele'},
            'ld_reference': {'accession': 'synthetic:ld', 'file': next(f for f in files if f['path'].endswith('ld.tsv')), 'ancestry': 'synthetic', 'genome_build': 'synthetic-remapped'}},
        limitations=['Synthetic benchmark only; no real-evidence admission. Burden counts repeat across variant rows and must not be summed. n is effective outcome N; n_x is exposure N. LD order follows ascending remapped coordinates.'])
    public = {'schema_version': 'omb-data-contract/v3.1', 'structure': structure,
              'producers': producers('KA0 synthetic task author', files, author_outcome_blind=True),
              'evidence': evidence(structure, '/structure')}
    return public


def sealable_contract(public, truth, *, private_canary):
    private = copy.deepcopy(public)
    private.update(schema_version='omb-data-contract-private/v3.1', public_hash='0' * 64,
                   planted_defects=[{'id': 'sealed-truth', 'description': canonical({'canary': private_canary, 'answerKey': truth}).decode(), 'affected_nodes': ['population']}])
    private['evidence'] += evidence(private['planted_defects'], '/planted_defects')
    return bridge(public, private)


def contract_for(pack, *, private_canary):
    return sealable_contract(public_layer(pack['files']), pack['truth'], private_canary=private_canary)
