"""Precommitted, code-only Tier A; one-sided exact binomial bounds, per gate/stratum.

Smoke n<200 and absent realism/timestamp receipts never certify. No failed replicate is dropped.
"""
import hashlib
import json
import math
import os
from pathlib import Path
from scipy.stats import beta, t as student_t, rankdata
import numpy as np
from .criteria import load_criteria, source_hashes
from .blinding import canonical, digest, diverse, keyed
from .leakage import DiscoveryScanner, discovery_tokens
from .families import generate, reference, naive, recall_only, grade, STRATA, structural_features, FEATURES

SELECTION_ARMS = ('recall-only', 'id-order', 'variance', 'variance-min', 'ld-score', 'composition')
ARMS = (*SELECTION_ARMS, 'mr-only', 'always-abstain', 'always-conflict')
BASELINES = ('direction-blind', 'direction-blind-conflict')


def cp(k, n, confidence=.95):
    if type(n) is not int or type(k) is not int or n < 1 or not 0 <= k <= n or not 0 < confidence < 1:
        raise ValueError('invalid binomial counts')
    alpha = 1 - confidence
    return [0.0 if k == 0 else float(beta.ppf(alpha, k, n - k + 1)),
            1.0 if k == n else float(beta.ppf(confidence, k + 1, n - k))]


def rate(k, n, criteria):
    return {'count': k, 'n': n, 'rate': k / n if n else None,
            'bounds': cp(k, n, criteria['confidence']) if n else None}


def summarize(records, criteria):
    """One row per independently generated replicate; all requested gates must be present.

    Missing output is a failed detection/abstention and an unknown safety outcome. It never
    becomes an observed zero-error pass. The safety denominator includes every planned row.
    """
    n = len(records)
    positives, bad, weak, critical, unknown = [], [], [], [], 0
    coverage, bias, matches = [], [], []
    for row in records:
        truth, answer = row['truth'], row.get('answer')
        complete = isinstance(answer, dict) and set(answer) == set(truth) and all(
            isinstance(answer[g], dict) and answer[g].get('label') in
            ('L2', 'L3', 'dossier', 'insufficient', 'locus-level', 'direction-conflict', 'pharmacology-mismatch', 'no-effect') for g in truth)
        unknown += not complete
        matches.append(complete and grade(answer, truth))
        powered = [g for g, t in truth.items() if t['kind'] == 'positive' and t['power'] >= criteria['P1']['minimumPower']]
        decoys = [g for g, t in truth.items() if t['kind'] in ('decoy', 'null', 'conflict')]
        under = [g for g, t in truth.items() if t['kind'] == 'positive' and t['power'] < criteria['P1']['minimumPower']]
        if powered:
            positives.append(complete and all(answer[g]['label'] in truth[g]['labels'] and ('sign' not in truth[g] or answer[g].get('sign') == truth[g]['sign']) for g in powered))
        if decoys:
            bad.append(complete and any(answer[g]['label'] in ('L2', 'L3', 'dossier') and
                       (not row.get('gate') or answer[g]['label'] not in truth[g]['labels']) for g in decoys))
        if under:
            weak.append(complete and all(answer[g]['label'] == 'insufficient' for g in under))
        critical.append(complete and (any(answer[g]['label'] in ('L3', 'dossier') and
                        (not row.get('gate') or answer[g]['label'] not in truth[g]['labels']) for g in decoys) or any(answer[g]['label'] == 'no-effect' for g in under)))
        # P5 is enabled only on registered coverage families, never silently inferred.
        if row.get('coverage_required'):
            cluster_coverage, cluster_bias = [], []
            for g, t in truth.items():
                value = answer.get(g, {}) if isinstance(answer, dict) else {}
                interval, estimate, se = value.get('ci'), value.get('estimate'), value.get('se')
                valid = (isinstance(interval, list) and len(interval) == 2 and all(type(x) in (int, float) and math.isfinite(x) for x in interval)
                         and interval[0] <= interval[1] and type(estimate) in (float, int) and math.isfinite(estimate)
                         and type(se) in (float, int) and math.isfinite(se) and se > 0)
                cluster_coverage.append(valid and interval[0] <= t['theta'] <= interval[1])
                cluster_bias.append(estimate - t['theta'] if valid else None)
            coverage.append(float(np.mean(cluster_coverage)) if cluster_coverage else 0.)
            bias.append(float(np.mean(cluster_bias)) if cluster_bias and None not in cluster_bias else None)
    enough = n >= criteria['minimumReplicates']
    def metric(values):
        return rate(sum(values), len(values), criteria)
    p1, p2, p3, p4 = metric(positives), metric(bad), metric(critical), metric(weak)
    def present(m):
        return m['n'] >= criteria['minimumReplicates'] and unknown == 0
    p1['passed'] = present(p1) and p1['rate'] >= criteria['P1']['minimumRate'] and round(p1['bounds'][0], 3) >= criteria['P1']['minimumLowerRounded']
    p2['passed'] = present(p2) and p2['rate'] <= criteria['P2']['maximumRate'] and p2['bounds'][1] <= criteria['P2']['maximumUpper']
    p3['passed'] = enough and unknown == 0 and p3['count'] <= criteria['P3']['maximumErrors'] and round(p3['bounds'][1], 3) <= criteria['P3']['maximumUpperRounded']
    p4['passed'] = present(p4) and p4['rate'] >= criteria['P4']['minimumRate']
    p4['status'] = 'measured' if weak else 'unavailable-no-underpowered-positive-stratum'
    p5 = {'n': len(coverage), 'rate': float(np.mean(coverage)) if coverage else None, 'bounds': None, 'unit': 'replicate'}
    available = len(bias) >= 2 and None not in bias
    mean_bias = float(np.mean(bias)) if available else None
    mcse = float(np.std(bias, ddof=1) / math.sqrt(len(bias))) if available else None
    p5.update(bias=mean_bias, biasMCSE=mcse,
              standardizedBias=(mean_bias / mcse if mcse else 0.0 if mean_bias == 0 else None),
              biasMethod='replicate-cluster-monte-carlo-se')
    p5['passed'] = bool(present(p5) and available and
                    criteria['P5']['coverage'][0] <= p5['rate'] <= criteria['P5']['coverage'][1] and
                    abs(mean_bias) <= criteria['P5'].get('maximumBiasMCSE', 2) * mcse)
    return {'replicates': n, 'unknown': unknown, 'P1': p1, 'P2': p2, 'P3': p3, 'P4': p4, 'P5': p5,
            'keyAgreement': {**metric(matches), 'passed': enough and unknown == 0 and all(matches)},
            'P6': {'positive': p1['rate'], 'decoy': p2['rate'], 'passed': present(p1) and present(p2) and
                   p1['rate'] >= criteria['P6']['minimumPositiveRate'] and p2['rate'] <= criteria['P6']['maximumDecoyRate']}}


def pin(criteria_path, expected_hash, run_root, plan, *, now):
    criteria = load_criteria(criteria_path, expected_hash)
    stamp = now()
    if type(stamp) is not int or stamp < 0:
        raise ValueError('invalid injected clock')
    root = Path(run_root)
    root.mkdir(parents=True, exist_ok=True)
    receipt = {'criteriaHash': expected_hash, 'criteriaVersion': criteria['version'], 'plan': plan,
               'planHash': digest(plan), 'startedAt': stamp}
    # O_EXCL burns a version before any generation/callback; interrupted runs also spend it.
    with (root / (criteria['version'] + '.started.json')).open('xb') as stream:
        stream.write(canonical(receipt))
        stream.flush()
        os.fsync(stream.fileno())
    return criteria, receipt


def run(criteria_path, expected_hash, run_root, *, key, replicates=2000, seed=1, now,
        keys=None, evaluator=reference, fault_at=lambda point: None):
    if type(replicates) is not int or replicates < 2:
        raise ValueError('at least two planned replicates required')
    keys = list(keys) if keys is not None else [key]
    if not keys or any(not isinstance(k, bytes) or len(k) < 32 for k in keys) or len(set(keys)) != len(keys):
        raise ValueError('distinct private replicate keys required')
    plan = {'families': STRATA, 'replicates': replicates, 'keyCount': len(keys), 'seed': seed,
            'arms': ARMS, 'baselines': BASELINES, 'engine': 'toy-pl1-pl4-fix3', 'sourceHashes': source_hashes()}
    criteria, receipt = pin(criteria_path, expected_hash, run_root, plan, now=now)
    fault_at('criteria-pinned')
    result = {'receipt': receipt, 'scope': 'smoke-only', 'certified': False, 'groups': {},
              'P7': {'passed': False, 'status': 'realism-unavailable', 'naiveRates': 'reported-per-stratum',
                     'realVsSimDiscriminator': None, 'genomeWideMatch': None}}
    tokens = set()
    for family, strata in STRATA.items():
        for stratum in strata:
            records, passes = [], {a: 0 for a in ('reference', *ARMS, *BASELINES)}
            gates = ('C1', 'C5') if family == 'PL1' else ('C7', 'C7b')
            by_gate, selections = {g: [] for g in gates}, {a: [] for a in SELECTION_ARMS}
            per_key = []
            for ki, replicate_key in enumerate(keys):
                packs, parity = [], []
                counts = {a: 0 for a in passes}
                trials = {a: [] for a in SELECTION_ARMS}
                key_records, key_gates = [], {g: [] for g in gates}
                for i in range(replicates):
                    pack = generate(family, stratum, seed, i, replicate_key)
                    tokens.update(discovery_tokens({'answerKey': pack['truth'],
                        'canary': keyed(replicate_key, 'private-canary', family, stratum, seed, i).hex(),
                        'dataContract': {'sealed_private': {'hash': 'unavailable-private-hash'}}}))
                    payload = pack['files']['summary.tsv']
                    packs.append(pack)
                    parity.append((payload, pack['summary']))
                    try:
                        answer = evaluator(payload, family)
                    except Exception:
                        answer = None
                    row = {'truth': pack['truth'], 'answer': answer}
                    records.append(row); key_records.append(row)
                    counts['reference'] += grade(answer, pack['truth'])
                    data_analysis = answer if evaluator is reference else reference(payload, family)
                    data_features = structural_features(payload, pack['files']['ld.tsv'])
                    for arm in (*ARMS, *BASELINES):
                        arm_answer = naive(payload, family, arm, pack['files']['ld.tsv'], analysis=data_analysis, features=data_features)
                        counts[arm] += grade(arm_answer, pack['truth'])
                        if arm in trials:
                            trials[arm].append(selection_trial(arm_answer, pack['truth'], guessed_sign=arm == 'recall-only'))
                    for gate in gates:
                        gt = {g: {**v, 'labels': v['gates'][gate]} for g, v in pack['truth'].items()}
                        ga = {g: {'label': v.get('gates', {}).get(gate), 'sign': v.get('sign')} for g, v in answer.items()} if isinstance(answer, dict) and all(isinstance(v, dict) for v in answer.values()) else None
                        row = {'truth': gt, 'answer': ga, 'gate': gate}
                        by_gate[gate].append(row); key_gates[gate].append(row)
                diverse(parity)
                for arm in passes:
                    passes[arm] += counts[arm]
                for arm in trials:
                    selections[arm].extend(trials[arm])
                per_key.append({'keyIndex': ki, 'reference': rate(counts['reference'], replicates, criteria),
                    'armPassCounts': counts, 'endToEnd': summarize(key_records, criteria),
                    'gates': {g: summarize(rs, criteria) for g, rs in key_gates.items()},
                    'artefactClassifier': artefact_classifier(packs, criteria['confidence']),
                    'selectionAudits': {a: chance_audit(ts, criteria, key_count=len(keys)) for a, ts in trials.items()}})
            classifier = pool_auc([r['artefactClassifier'] for r in per_key], criteria['confidence'])
            audits = {a: chance_audit(ts, criteria, key_count=len(keys)) for a, ts in selections.items()}
            dropouts = [pool_auc([r['artefactClassifier'] for j, r in enumerate(per_key) if j != k], criteria['confidence'])
                        for k in range(len(keys))] if len(keys) >= 3 else []
            auc_ok = lambda c: c.get('bounds') is not None and c['bounds'][1] <= criteria['P7']['maximumArtefactAuc']
            artefacts_pass = auc_ok(classifier) and bool(dropouts) and all(auc_ok(c) for c in dropouts) and all(a['passed'] for a in audits.values())
            for r in per_key:
                r['valid'] = (family != 'PL1' and r['reference']['bounds'][0] >= criteria['calibration']['minimumReferenceLower'] and
                    r['endToEnd']['P1']['passed'] and r['endToEnd']['P2']['passed'] and
                    all(a['passed'] for a in r['selectionAudits'].values()) and artefacts_pass)
            robust = (replicates >= criteria['calibration']['replicatesPerKey'] and
                      len(keys) >= criteria['calibration']['minimumKeys'] and all(r['valid'] for r in per_key))
            result['groups'][family + '/' + stratum] = {
                'endToEnd': summarize(records, criteria), 'gates': {g: summarize(rs, criteria) for g, rs in by_gate.items()},
                'armPassCounts': passes, 'reference': rate(passes['reference'], len(keys)*replicates, criteria),
                'directionBlind': {a: rate(passes[a], len(keys)*replicates, criteria) for a in BASELINES},
                'perKey': per_key, 'validKeys': sum(r['valid'] for r in per_key), 'robust': robust,
                'selectionAudits': audits, 'artefactClassifier': classifier, 'leaveOneKeyOutAuc': dropouts,
                'artefactsPassed': artefacts_pass, 'calibration': 'valid' if robust else 'invalid',
                'disabledReason': 'deprecated-never-certifiable; KA3 replaces PL1' if family == 'PL1' else None}
    result['P7']['artefactClassifierAuc'] = {g: r['artefactClassifier'] for g, r in result['groups'].items()}
    result['P7']['artefactsPassed'] = all(r['artefactsPassed'] for r in result['groups'].values())
    load_criteria(criteria_path, expected_hash)
    if plan['sourceHashes'] != source_hashes():
        raise ValueError('frozen code changed during run')
    if DiscoveryScanner(tokens, set(), set()).hits(canonical(result).decode()):
        raise ValueError('private content in report')
    fault_at('before-report')
    with (Path(run_root) / (criteria['version'] + '.results.json')).open('xb') as stream:
        stream.write(canonical(result) + b'\n')
    return result


def auc(labels, scores):
    """Mann–Whitney AUC, average ranks for ties; undefined classes never pass."""
    from scipy.stats import rankdata
    if len(labels) != len(scores) or not labels or set(labels) != {False, True} or not all(math.isfinite(x) for x in scores):
        raise ValueError('AUC unavailable')
    positives = sum(labels)
    return float((sum(r for r, y in zip(rankdata(scores), labels) if y) - positives * (positives + 1) / 2) / (positives * (len(labels) - positives)))


def selection_trial(answer, truth, *, guessed_sign=False):
    """One selection per independent pack, conditional on its positive count.

    This diagnostic does not grade rejection labels. It detects perfect-leak selectors
    even when their complete answer could never pass the pack rubric.
    """
    chosen = [g for g, v in answer.items() if v.get('label') in ('L2', 'L3')]
    success = len(chosen) == 1 and truth[chosen[0]]['kind'] == 'positive' and answer[chosen[0]].get('sign') == truth[chosen[0]]['sign']
    chance = sum(t['kind'] == 'positive' for t in truth.values()) / len(truth) * (.5 if guessed_sign else 1)
    return bool(success), chance


def chance_audit(trials, criteria, *, key_count=None):
    """Exact two-sided Poisson-binomial tails (binomial for constant pack sizes).

    Preregistered familywise alpha and power in both directions at 20 percentage points.
    No detection at inadequate power is unavailable, never evidence of cleanliness.
    """
    spec = criteria.get('artefactArms', {'alpha': .01, 'minimumPower': .8, 'detectableExcess': .2})
    probs = [p for _, p in trials]
    def distribution(ps):
        d = np.array([1.])
        for p in ps:
            d = np.convolve(d, [1 - p, p])
        return d
    null = distribution(probs)
    key_count = criteria['calibration']['minimumKeys'] if key_count is None else key_count
    alpha = spec['alpha'] / (len(SELECTION_ARMS) * (key_count + 1) * sum(map(len, STRATA.values())))
    tail_alpha = alpha / 2
    critical = next((k for k in range(len(trials) + 1) if float(null[k:].sum()) <= tail_alpha), len(trials) + 1)
    # Degenerate all-positive/all-negative packs have no selector information.
    alternative = distribution([min(1., p + spec['detectableExcess']) if 0 < p < 1 else p for p in probs])
    power_upper = float(alternative[critical:].sum())
    critical_lower = next((k for k in range(len(trials), -1, -1) if float(null[:k+1].sum()) <= tail_alpha), -1)
    lower = distribution([max(0., p - spec['detectableExcess']) if 0 < p < 1 else p for p in probs])
    power_lower = float(lower[:critical_lower+1].sum())
    power = min(power_upper, power_lower)
    count = sum(ok for ok, _ in trials)
    pvalue = min(1., 2 * min(float(null[count:].sum()), float(null[:count + 1].sum())))
    powered = power >= spec['minimumPower']
    return {'count': count, 'n': len(trials), 'chanceRate': float(np.mean(probs)) if probs else None,
            'pValue': pvalue, 'alpha': alpha, 'criticalCount': critical, 'power': power,
            'tails': 'two-sided', 'powerUpper': power_upper, 'powerLower': power_lower,
            'passed': powered and pvalue > alpha,
            'status': 'exploitable' if pvalue <= alpha else 'no-excess-detected' if powered else 'underpowered'}


def artefact_classifier(packs, confidence=.95):
    """Train feature/direction on dev packs; freeze before evaluating disjoint test packs.

    Includes LD degree/rank/endpoints and within-pack composition/minority structure.
    Truth is used only as training/test labels. No outcome-effect magnitude is a feature.
    """
    features, labels = [], []
    for pack in packs:
        fs = structural_features(pack['files']['summary.tsv'], pack['files']['ld.tsv'])
        for gene, values in fs.items():
            features.append(values)
            labels.append(pack['truth'][gene]['kind'] == 'positive')
    split = sum(len(p['truth']) for p in packs[:len(packs) // 2])
    base = {'trainingPacks': len(packs) // 2, 'testPacks': len(packs) - len(packs) // 2}
    if not split or split == len(labels) or set(labels[:split]) != {False, True} or set(labels[split:]) != {False, True}:
        return {**base, 'auc': None, 'bounds': None, 'se': None, 'status': 'unavailable'}
    choices = [(auc(labels[:split], [sign * f[j] for f in features[:split]]), j, sign)
               for j in range(len(FEATURES)) for sign in (-1, 1)]
    _, column, sign = max(choices)
    metric = cluster_auc(labels[split:], [sign * f[column] for f in features[split:]],
                         [len(p['truth']) for p in packs[len(packs)//2:]], confidence)
    return {**base, **metric, 'feature': FEATURES[column], 'direction': sign, 'features': list(FEATURES), 'status': 'measured'}


def realism(metrics, criteria):
    """P7 admission consumes measured host results, never missing/skipped-as-true flags."""
    def finite(name):
        return type(metrics.get(name)) in (float, int) and math.isfinite(metrics[name])
    checks = {
        'naiveRates': finite('naive_rate') and finite('published_naive_rate') and 0 <= metrics['naive_rate'] <= 1 and 0 <= metrics['published_naive_rate'] <= 1 and abs(metrics['naive_rate'] - metrics['published_naive_rate']) <= criteria['P7']['naiveRateTolerance'],
        'discriminator': finite('realism_auc') and 0 <= metrics['realism_auc'] <= criteria['P7']['maximumRealismAuc'] and metrics.get('blind_judge_passed') is True,
        'genomeWide': metrics.get('genome_wide_match') is True,
        'artefacts': finite('artefact_auc') and 0 <= metrics['artefact_auc'] <= criteria['P7']['maximumArtefactAuc'] and metrics.get('artefact_arm_failed') is True}
    return {'passed': all(checks.values()), 'checks': checks}


def cluster_auc(labels, scores, sizes, confidence=.95):
    """AUC placement influence functions, clustered by independently generated pack.

    Genes within a pack never count as independent replicates. Student-t bound; no
    RNG/bootstrap instability. Scores/labels/influences are private and not exported.
    """
    y, x = np.asarray(labels, dtype=bool), np.asarray(scores, dtype=float)
    value = auc(labels, scores)
    pos, neg = np.sort(x[y]), np.sort(x[~y])
    influence = np.empty(len(y))
    placement = lambda a, b: (np.searchsorted(b, a, side='left') + np.searchsorted(b, a, side='right')) / (2*len(b))
    influence[y] = (placement(x[y], neg) - value) / len(pos)
    influence[~y] = (1 - placement(x[~y], pos) - value) / len(neg)
    starts = np.cumsum([0, *sizes])
    clusters = np.array([influence[a:b].sum() for a, b in zip(starts[:-1], starts[1:])])
    n = len(clusters)
    if n < 2:
        return {'auc': value, 'bounds': None, 'se': None}
    se = float(np.std(clusters, ddof=1) * math.sqrt(n))
    margin = float(student_t.ppf(confidence, n-1)) * se
    return {'auc': value, 'bounds': [max(0., value-margin), min(1., value+margin)], 'se': se,
            'unit': 'pack', 'n': n, 'method': 'cluster-placement-t'}


def pool_auc(metrics, confidence=.95):
    if len(metrics) < 2 or any(m.get('se') is None or m.get('bounds') is None for m in metrics):
        return {'auc': None, 'bounds': None, 'se': None, 'status': 'unavailable'}
    n = len(metrics)
    value = float(np.mean([m['auc'] for m in metrics]))
    within = math.sqrt(sum(m['se']**2 for m in metrics)) / n
    between = float(np.std([m['auc'] for m in metrics], ddof=1) / math.sqrt(n))
    se = max(within, between)
    margin = float(student_t.ppf(confidence, n-1)) * se
    return {'auc': value, 'bounds': [max(0., value-margin), min(1., value+margin)], 'se': se,
            'keys': n, 'unit': 'key/pack', 'method': 'pooled-max-within-between-t', 'status': 'measured'}
