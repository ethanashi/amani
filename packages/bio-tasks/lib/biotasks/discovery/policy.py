"""Host admission seams. Inputs must come from the trusted stager/poller, never an analyst."""
from copy import deepcopy
from datetime import date
import re


class EvidenceStore:
    """Minimal harness evidence sink; integrates through the same admission method for every row."""
    def __init__(self):
        self.rows = []

    def ingest(self, artifact, *, provenance):
        if (not isinstance(provenance, dict) or provenance.get('synthetic') is not False or
                isinstance(artifact, dict) and artifact.get('synthetic') is True):
            raise ValueError('synthetic or unknown provenance cannot enter real evidence')
        self.rows.append(deepcopy(artifact))


def admit_forecast(row, *, now, poll, used_drugs):
    """KC1/CR1: inspect each filing afresh, including press releases; never a trial deny list.

    poll is a host-owned offline/live adapter; its evidence is retained in the receipt.
    Unknown search status cannot establish a clean prospective stream.
    """
    EvidenceStore().ingest(row, provenance=row)
    if not row.get('drug') or row['drug'] in used_drugs:
        raise ValueError('cross-registry/backtest drug reuse')
    receipt = poll(row['id'], now)
    if not isinstance(receipt, dict):
        raise ValueError('poll unavailable')
    if receipt.get('checked_at') != now or receipt.get('id') != row['id']:
        raise ValueError('stale or mismatched filing poll')
    for source in ('registry', 'press', 'literature'):
        check = receipt.get(source, {})
        if check.get('status') != 'checked' or not check.get('url') or type(check.get('public_result')) is not bool:
            raise ValueError('prospective status unavailable')
        if check['public_result']:
            raise ValueError('already-resolved stream')
    if receipt.get('hasResults') is not False or 'resolved_at' not in receipt or receipt['resolved_at'] is not None:
        raise ValueError('already resolved or unknown results')
    if receipt.get('phase') != row.get('phase') or not row.get('phase') or receipt.get('primary') != row.get('primary') or not row.get('primary'):
        raise ValueError('phase/endpoint mismatch')
    if type(receipt.get('safety_only')) is not bool:
        raise ValueError('endpoint type unavailable')
    if receipt['safety_only'] and not (row.get('forecast_kind') == 'biomarker' and row.get('prespecified') is True):
        raise ValueError('safety-only trial requires prespecified biomarker forecast')
    return deepcopy(receipt)


def pharmacology_vote(measurement, action):
    """CR2: abundance cannot support activity direction (nor can an unknown line)."""
    target = {'ASO': 'abundance', 'inhibitor': 'activity', 'activator': 'activity',
              'abundance': 'abundance', 'activity': 'activity'}.get(action)
    return measurement in ('abundance', 'activity') and target == measurement


def backtest_rows(rows, *, registry_drugs):
    """CR3: group targets at the drug×indication unit; preserve unmatched/censored rows."""
    grouped = {}
    for row in rows:
        if not row.get('drug') or not row.get('indication') or row['drug'] in registry_drugs:
            raise ValueError('missing drug unit or registry overlap')
        if row.get('outcome') not in ('approved', 'negative', 'censored', 'unmatched'):
            raise ValueError('unknown backtest outcome')
        key = row['drug'], row['indication']
        if key in grouped and grouped[key]['outcome'] != row['outcome']:
            raise ValueError('conflicting drug-level outcomes')
        grouped.setdefault(key, {'drug': key[0], 'indication': key[1], 'outcome': row['outcome'], 'targets': []})
        grouped[key]['targets'].append(row['target'])
    return list(grouped.values())


FORBIDDEN = {'l2g', 'reported_gene', 'overall_score', 'datatype_score', 'clinical_precedence',
             'approved_drug', 'advanced_clinical', 'literature', 'epmc', 'known_drug', 'max_phase', 'tractability'}


def forbidden_feature(name):
    # Collapse case, camelCase, spaces and separators, then catch decorated names.
    compact = re.sub('[^a-z0-9]', '', str(name).casefold())
    return any(re.sub('[^a-z0-9]', '', token) in compact for token in FORBIDDEN)


def check_snapshot(features, *, snapshot, outcome_snapshot, sentinel_date, code_hash, frozen_hash, outcomes_seen):
    """CR4/KC2: dated immutable features and outcome-blind code, no feature-name-only bypass."""
    snap = date.fromisoformat(snapshot)
    if outcomes_seen is not False or not re.fullmatch('[a-f0-9]{64}', code_hash) or code_hash != frozen_hash:
        raise ValueError('development look or code changed')
    if not snap < date.fromisoformat(sentinel_date) <= date.fromisoformat(outcome_snapshot):
        raise ValueError('outcome horizon lacks a valid sentinel')
    if not features:
        raise ValueError('no dated features')
    for f in features:
        if f.get('kind') not in ('raw-genetics', 'coding', 'positional', 'mendelian') or f.get('outcome_blind') is not True:
            raise ValueError('outcome-trained or unknown feature')
        if forbidden_feature(f.get('name', '')):
            raise ValueError('forbidden feature')
        if not re.fullmatch('[a-f0-9]{64}', f.get('source_hash', '')) or f.get('archived') is not True:
            raise ValueError('immutable archived source required')
        if date.fromisoformat(f['source_date']) > snap:
            raise ValueError('future feature')
    return True
