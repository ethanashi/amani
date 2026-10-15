"""Small PL1/PL4 proofs. PL1 is DEPRECATED and never eligible for grading/certification. Adapted from sim_hap.py, bench.py and demo_decoy2.py.

The local Markov haplotypes are a toy replacement for unavailable stdpopsim, not real EUR LD.
Outcome means are driven by theta, not an independently chosen outcome z (critic KM5).
"""
import csv
import io
import math
import numpy as np
from scipy.special import logsumexp
from scipy.stats import norm
from .blinding import generator_seed, permutation, coordinates, canonical
from .policy import pharmacology_vote

N_OUT = int(4 / (1 / 27205 + 1 / 110881))
N_PQ = 34557
HEADER = ('variant', 'gene', 'cohort', 'chromosome', 'position', 'effect_allele', 'other_allele',
          'n', 'n_x', 'beta_x', 'se_x', 'beta_y', 'se_y', 'measurement', 'action',
          'variant_class', 'case_carriers', 'control_carriers', 'cases', 'controls')
FLOATS = {'beta_x', 'se_x', 'beta_y', 'se_y'}
INTS = {'chromosome', 'position', 'n', 'n_x', 'case_carriers', 'control_carriers', 'cases', 'controls'}
STRATA = {'PL1': ('ld-mid', 'ld-high'), 'PL4': ('forward', 'reversed')}


def encode(rows):
    lines = ['\t'.join(HEADER)]
    for row in sorted(rows, key=lambda r: (r['gene'], r['position'])):
        lines.append('\t'.join(f'{row[k]:.8f}' if k in FLOATS else str(row[k]) for k in HEADER))
    return ('\n'.join(lines) + '\n').encode()


def decode(payload):
    """One parser/serializer for generated and externally staged tables, with byte parity."""
    reader = csv.DictReader(io.StringIO(payload.decode('utf-8')), delimiter='\t')
    if tuple(reader.fieldnames or ()) != HEADER:
        raise ValueError('columns differ from pinned layout')
    rows = []
    for raw in reader:
        if set(raw) != set(HEADER) or any(v is None for v in raw.values()):
            raise ValueError('ragged row')
        row = {k: float(v) if k in FLOATS else int(v) if k in INTS else v for k, v in raw.items()}
        if not all(math.isfinite(row[k]) for k in FLOATS) or min(row['se_x'], row['se_y'], row['n'], row['n_x']) <= 0:
            raise ValueError('invalid numeric data')
        if (row['measurement'] not in ('abundance', 'activity') or row['action'] not in ('abundance', 'activity', 'ASO', 'inhibitor', 'activator')
                or row['variant_class'] not in ('loss', 'gain') or not 1 <= row['chromosome'] <= 22 or row['position'] <= 0
                or row['effect_allele'] not in ('A', 'C', 'G', 'T') or row['other_allele'] not in ('A', 'C', 'G', 'T')
                or row['effect_allele'] == row['other_allele']
                or not 0 <= row['case_carriers'] <= row['cases'] or not 0 <= row['control_carriers'] <= row['controls']
                or min(row['cases'], row['controls']) <= 0):
            raise ValueError('unknown or invalid structural metadata')
        rows.append(row)
    outcomes = {}
    for row in rows:
        locus = (row['variant'], row['cohort'])
        association = tuple(row[f] for f in ('chromosome', 'position', 'effect_allele', 'other_allele', 'n', 'beta_y', 'se_y'))
        if locus in outcomes and outcomes[locus] != association:
            raise ValueError('contradictory outcome association')
        outcomes[locus] = association
    for gene in {r['gene'] for r in rows}:
        part = [r for r in rows if r['gene'] == gene]
        for field in ('cohort', 'measurement', 'action', 'variant_class', 'case_carriers', 'control_carriers', 'cases', 'controls'):
            if len({r[field] for r in part}) != 1:
                raise ValueError('inconsistent gene metadata')
    if not rows or len({(r['gene'], r['variant']) for r in rows}) != len(rows) or encode(rows) != payload:
        raise ValueError('byte parity/order/precision failed')
    return rows


def validate_structure(files):
    rows = decode(files['summary.tsv'])
    genes = sorted({r['gene'] for r in rows})
    import re
    if any(not re.fullmatch(r'G[0-9]{8,}', g) for g in genes):
        raise ValueError('noncanonical gene ID')
    ids = sorted(int(g[1:]) for g in genes)
    if ids != list(range(ids[0], ids[0] + len(ids))):
        raise ValueError('noncontiguous gene IDs')
    ld = decode_ld(files['ld.tsv'])
    # PL1 shares one locus across genes. PL4 has disjoint per-gene variant sets.
    blocks = [{r['variant'] for r in rows if r['gene'] == g} for g in genes]
    if any(len(block) != 16 for block in blocks):
        raise ValueError('gene locus must contain 16 variants')
    shared = len({r['variant'] for r in rows}) < len(rows)
    if shared and (len(genes) != 2 or blocks[0] != blocks[1]):
        raise ValueError('PL1 must share exactly one locus')
    if not shared and not np.array_equal(ld, np.eye(16)):
        raise ValueError('PL4 LD must be identity')


def haplotype_ld(rng, rho, p=16, diploids=512):
    # sim_hap's haplotype pairing, MAF filtering and genotype standardization.
    h = np.empty((2 * diploids, p), dtype=float)
    h[:, 0] = rng.binomial(1, .4, len(h))
    for j in range(1, p):
        h[:, j] = np.where(rng.random(len(h)) < rho, h[:, j - 1], rng.binomial(1, .4, len(h)))
    g = h[::2] + h[1::2]
    af = g.mean(0) / 2
    if np.any((af <= .01) | (af >= .99)):
        raise ValueError('monomorphic toy locus')
    x = (g - g.mean(0)) / g.std(0)
    return (x.T @ x) / len(x)


def mvn(rng, R, b, n):
    # bench.py: z ~ N(sqrt(N) R b, R), with numerical PSD clipping.
    w, v = np.linalg.eigh(R)
    return math.sqrt(n) * (R @ b) + (v * np.sqrt(np.clip(w, 0, None))) @ rng.standard_normal(len(b))


def generate(family, stratum, public_seed, replicate, key):
    # One unconditional draw: conditioning on any relevant gene biases small packs.
    # Per-gene compatibility/strength/sign draws are independent of the pack size.
    return _generate(family, stratum, public_seed, replicate, key, 0)


def _generate(family, stratum, public_seed, replicate, key, draw):
    if family not in STRATA or stratum not in STRATA[family]:
        raise ValueError('unknown planted family/stratum')
    blind_stratum = stratum if family == 'PL1' else 'twin'
    context = [family, stratum, public_seed, replicate]
    rng = np.random.default_rng(generator_seed(key, f'{family}/{blind_stratum}' if family == 'PL1' else f'{family}/{blind_stratum}/{draw}', public_seed, replicate))
    p = 16
    genes = [f'entity-{i}' for i in range(2 if family == 'PL1' else int(rng.integers(2, 8)))]
    rename = permutation(key, context, 'gene', genes)
    # PL4 has disjoint loci; each uses the same local 16x16 identity LD panel.
    variant_ids = [str(j) for j in range(p * (1 if family == 'PL1' else len(genes)))]
    variants = permutation(key, context, 'snp', variant_ids)
    cohort = permutation(key, context, 'sample', ['cohort'])['cohort']
    remap, _ = coordinates(key, context, list(range(len(variant_ids))), preserve_order=True)
    R = np.eye(p)
    causal = int(rng.integers(3, p - 3))
    decoy = causal + int(rng.choice([-1, 1]))
    if family == 'PL1':
        lo, hi = (.4, .6) if stratum == 'ld-mid' else (.8, .95)
        for _ in range(32):
            R = haplotype_ld(rng, math.sqrt(.50 if stratum == 'ld-mid' else .875))
            if lo <= R[causal, decoy] ** 2 <= hi:
                break
        else:
            raise ValueError('LD stratum construction failed')
    rows, truth = [], {}
    sign = int(rng.choice([-1, 1]))
    by = np.zeros(p)
    by[causal] = sign * .22 * math.sqrt(.03)
    # One outcome GWAS draw for the shared PL1 locus, reused verbatim in both blocks.
    shared_zy = mvn(rng, R, by, N_OUT) if family == 'PL1' else None
    for i, original in enumerate(genes):
        gene = rename[original]
        bx = np.zeros(p)
        case, control, cases, controls = 0, 0, 8507, 9671
        measurement, action, variant_class = 'abundance', 'ASO', 'loss'
        if family == 'PL1':
            bx[causal if i == 0 else decoy] = math.sqrt(.03)
            theta = sign * .22
            truth_theta = theta if i == 0 else 0.0
            z_mean = abs(theta) * math.sqrt(N_OUT * .03)
            power = float(norm.sf(norm.isf(.025) - z_mean) + norm.cdf(-norm.isf(.025) - z_mean))
            labels = ['L2'] if i == 0 else ['insufficient', 'locus-level']
            kind = 'positive' if i == 0 else 'decoy'
            gates = {'C1': ['L2'], 'C5': labels}
            zy = shared_zy
            offset = 0
        else:
            # Independent draws, no fixed role counts or within-pack minority rule.
            flip = 1 if stratum == 'forward' else -1
            common = int(rng.choice([-1, 1])) * flip
            rare_direction = int(rng.choice([-1, 1])) * flip
            burden_sign = int(rng.choice([-1, 1]))
            variant_class = 'loss' if rare_direction * burden_sign < 0 else 'gain'
            compatible = bool(rng.integers(2))
            measurement = str(rng.choice(['abundance', 'activity']))
            activity_action = str(rng.choice(['inhibitor', 'activator']))
            action = ('ASO' if measurement == 'abundance' else activity_action) if compatible else (activity_action if measurement == 'abundance' else 'ASO')
            strength = str(rng.choice(['strong', 'null', 'weak'], p=[.8, .1, .1]))
            lead = int(rng.integers(3, p - 3))
            # Outcome sign is independent of the MR direction; exposure orientation supplies it.
            outcome_sign = int(rng.choice([-1, 1]))
            bx[lead] = .2 * common * outcome_sign
            truth_theta = common * .4
            by = np.zeros(p)
            by[lead] = .08 * outcome_sign
            zy = mvn(rng, R, by, N_OUT)
            odds_ratio = (4.0 if strength == 'strong' else 1.0 if strength == 'null' else 1.15) ** burden_sign
            freq = .02
            case = int(rng.binomial(cases, odds_ratio * freq / (1 - freq + odds_ratio * freq)))
            control = int(rng.binomial(controls, freq))
            power = 1.0
            # Theta stays private generator truth. Label/gate/sign assignment happens
            # below, using only the serialized observations that the analyst receives.
            labels, kind, gates = [], 'unassigned', {}
            offset = i * p
        zx = mvn(rng, R, bx, N_PQ)
        for j in range(p):
            chrom, pos = remap[offset + j]
            rows.append(dict(zip(HEADER, (variants[str(offset + j)], gene, cohort, chrom, pos, 'A', 'G', N_OUT,
                        N_PQ, float(zx[j] / math.sqrt(N_PQ)), 1 / math.sqrt(N_PQ),
                        float(zy[j] / math.sqrt(N_OUT)), 1 / math.sqrt(N_OUT), measurement, action,
                        variant_class, case, control, cases, controls))))
        truth[gene] = {'labels': labels, 'kind': kind, 'power': power, 'theta': truth_theta,
                       'sign': int(np.sign(truth_theta)), 'gates': gates}
    payload = encode(rows)
    observed = decode(payload)
    if family == 'PL4':
        for gene, t in truth.items():
            lead = max((r for r in observed if r['gene'] == gene), key=lambda r: abs(r['beta_x']/r['se_x']))
            ratio = lead['beta_y']/lead['beta_x']
            ratio_se = math.sqrt((lead['se_y']/lead['beta_x'])**2 + (lead['beta_y']*lead['se_x']/lead['beta_x']**2)**2)
            mr_supported = (lead['beta_x']/lead['se_x'])**2 >= 10 and abs(ratio/ratio_se) >= MR_THRESHOLD
            log_odds, burden_se = burden(lead['case_carriers'], lead['control_carriers'], lead['cases'], lead['controls'])
            rare = np.sign(log_odds) * (-1 if lead['variant_class'] == 'loss' else 1)
            c7 = ('insufficient' if abs(log_odds/burden_se) < BURDEN_THRESHOLD else
                  'L3' if mr_supported and rare == np.sign(ratio) else 'direction-conflict')
            label = c7 if pharmacology_vote(lead['measurement'], lead['action']) else 'pharmacology-mismatch'
            t.update(labels=[label], kind='positive' if label == 'L3' else 'null' if label == 'insufficient' else 'conflict',
                     sign=int(np.sign(ratio)), gates={'C7': [c7], 'C7b': [label]})
    ld = R
    ld_bytes = encode_ld(ld)
    return {'family': family, 'stratum': stratum, 'replicate': replicate, 'seed': public_seed,
            'files': {'summary.tsv': payload, 'ld.tsv': ld_bytes}, 'truth': truth,
            'summary': [float(np.mean([r['beta_y'] for r in rows])), float(np.std([r['beta_x'] for r in rows]))],
            'synthetic': True, 'entities': sorted(truth)}


def coloc(rows):
    # ABF on the standardized scale (W=.15^2); locked p12=5e-6.
    abfs = []
    for axis in ('x', 'y'):
        z = np.array([r[f'beta_{axis}'] / r[f'se_{axis}'] for r in rows])
        v = np.array([r[f'se_{axis}'] ** 2 for r in rows])
        abfs.append(.5 * np.log(v / (v + .15**2)) + .5 * z*z * .15**2 / (v + .15**2))
    a, b = abfs
    s1, s2, s12 = logsumexp(a), logsumexp(b), logsumexp(a + b)
    h3 = math.log(1e-8) + s1 + s2 + np.log1p(-np.exp(min(s12 - s1 - s2, -1e-12)))
    lh = np.array([0, math.log(1e-4) + s1, math.log(1e-4) + s2, h3, math.log(5e-6) + s12])
    return np.exp(lh - logsumexp(lh))


BURDEN_THRESHOLD = float(norm.isf(.0005))
MR_THRESHOLD = float(norm.isf(.025))


def burden(case, control, cases, controls):
    log_odds = math.log(((case + .5) / (cases - case + .5)) / ((control + .5) / (controls - control + .5)))
    se = math.sqrt(sum(1 / (v + .5) for v in (case, cases - case, control, controls - control)))
    return log_odds, se


def decode_ld(payload):
    matrix = np.loadtxt(io.BytesIO(payload))
    if (matrix.shape != (16, 16) or not np.isfinite(matrix).all() or
            not np.allclose(matrix, matrix.T) or not np.allclose(np.diag(matrix), 1) or
            np.any(np.abs(matrix) > 1.00000001) or encode_ld(matrix) != payload):
        raise ValueError('noncanonical LD')
    return matrix


def encode_ld(matrix):
    return ('\n'.join('\t'.join(f'{v:.8f}' for v in line) for line in matrix) + '\n').encode()


def reference(payload, family):
    """Scripted arm D sees data only. No truth, keys, stratum or original IDs supplied."""
    rows = decode(payload)
    results = {}
    for gene in sorted({r['gene'] for r in rows}):
        part = [r for r in rows if r['gene'] == gene]
        lead = max(part, key=lambda r: abs(r['beta_x'] / r['se_x']))
        estimate = lead['beta_y'] / lead['beta_x']
        se = math.sqrt(lead['se_y']**2 / lead['beta_x']**2 + lead['beta_y']**2 * lead['se_x']**2 / lead['beta_x']**4)
        c1 = lead['beta_x']**2 / lead['se_x']**2 >= 10 and abs(estimate / se) >= MR_THRESHOLD
        if family == 'PL1':
            pp = coloc(part)
            label = 'L2' if c1 and pp[4] >= .8 and pp[4] > pp[3] else 'insufficient'
            gates = {'C1': 'L2' if c1 else 'insufficient', 'C5': label}
        elif family == 'PL4':
            log_odds, burden_se = burden(lead['case_carriers'], lead['control_carriers'], lead['cases'], lead['controls'])
            rare = np.sign(log_odds) * (-1 if lead['variant_class'] == 'loss' else 1)
            c7 = ('insufficient' if abs(log_odds / burden_se) < BURDEN_THRESHOLD else
                  'L3' if rare == np.sign(estimate) and c1 else 'direction-conflict')
            label = c7 if pharmacology_vote(lead['measurement'], lead['action']) else 'pharmacology-mismatch'
            gates = {'C7': c7, 'C7b': label}
        else:
            raise ValueError('unknown family')
        results[gene] = {'label': label, 'sign': int(np.sign(estimate)), 'estimate': estimate,
                         'ci': [estimate - 1.96 * se, estimate + 1.96 * se], 'se': se, 'gates': gates}
    return results


def recall_only(gene_ids, family):
    # This arm receives only the public schema's identifiers, never observations or private truth.
    genes = sorted(gene_ids)
    return {g: {'label': ('L2' if family == 'PL1' else 'L3') if i == 0 else 'insufficient', 'sign': 1}
            for i, g in enumerate(genes)}


def structural_features(payload, ld_payload=None):
    rows = decode(payload)
    genes = sorted({r['gene'] for r in rows})
    leads = {g: max((r for r in rows if r['gene'] == g), key=lambda r: abs(r['beta_x'] / r['se_x'])) for g in genes}
    R = np.loadtxt(io.BytesIO(ld_payload)) if ld_payload is not None else None
    result = {}
    for g in genes:
        part = [r for r in rows if r['gene'] == g]
        lead = leads[g]
        j = part.index(lead)
        scores = np.sum(R**2, axis=1) if R is not None else np.ones(len(part))
        if len(scores) != len(part):
            raise ValueError('LD shape mismatch')
        composition = [sum(leads[h][field] == lead[field] for h in genes) / len(genes)
                       for field in ('variant_class', 'action', 'measurement')]
        signs = {h: int(np.sign(leads[h]['beta_y'] / leads[h]['beta_x'])) for h in genes}
        composition.append(sum(signs[h] == signs[g] for h in genes) / len(genes))
        result[g] = [genes.index(g), float(np.var([r['beta_x'] for r in part])),
                     float(scores[j]), float(np.mean(scores < scores[j])),
                     min(j, len(part) - 1 - j), int(j in (0, len(part) - 1)),
                     len(genes), *composition, sum(x == 1 / len(genes) for x in composition),
                     int(lead['measurement'] == 'activity'), int(lead['action'] == 'ASO')]
    return result


FEATURES = ('id-order', 'variance', 'ld-score', 'ld-rank', 'chain-distance', 'chain-endpoint',
            'pack-size', 'class-frequency', 'action-frequency', 'measurement-frequency',
            'sign-frequency', 'odd-one-out', 'measurement-is-activity', 'action-is-ASO')


def naive(payload, family, arm, ld_payload=None, *, analysis=None, features=None):
    if arm in ('direction-blind', 'direction-blind-conflict'):
        # Independent baseline: no reference output, variant-class direction, or truth input.
        rows = decode(payload)
        result = {}
        for gene in sorted({r['gene'] for r in rows}):
            lead = max((r for r in rows if r['gene'] == gene), key=lambda r: abs(r['beta_x']/r['se_x']))
            log_odds, burden_se = burden(lead['case_carriers'], lead['control_carriers'], lead['cases'], lead['controls'])
            label = ('pharmacology-mismatch' if not pharmacology_vote(lead['measurement'], lead['action']) else
                     'insufficient' if abs(log_odds/burden_se) < BURDEN_THRESHOLD else
                     'L3' if arm == 'direction-blind' else 'direction-conflict')
            result[gene] = {'label': label, 'sign': int(np.sign(lead['beta_y']/lead['beta_x']))}
        return result
    genes = sorted(analysis) if analysis is not None else sorted({r['gene'] for r in decode(payload)})
    if arm == 'recall-only':
        return recall_only(genes, family)
    if arm in ('always-abstain', 'always-conflict'):
        return {g: {'label': 'insufficient' if arm == 'always-abstain' else 'direction-conflict'} for g in genes}
    if arm == 'file-order':  # legacy alias, removed from registered arms (canonical file == ID order).
        arm = 'id-order'
    if arm not in ('id-order', 'variance', 'variance-min', 'ld-score', 'composition', 'mr-only', 'direction-blind', 'direction-blind-conflict'):
        raise ValueError('unknown naive arm')
    base = reference(payload, family) if analysis is None else analysis
    if arm == 'mr-only':
        return {g: {**v, 'label': 'L2' if family == 'PL1' else 'L3'} for g, v in base.items()}
    if arm == 'ld-score' and ld_payload is None:
        raise ValueError('LD required for ld-score arm')
    features = structural_features(payload, ld_payload) if features is None else features
    column = {'id-order': 0, 'variance': 1, 'variance-min': 1, 'ld-score': 2, 'composition': 11}[arm]
    chosen = (max if arm == 'variance' else min)(genes, key=lambda g: features[g][column])
    # Non-selected entities retain legal rejection labels. Selection accuracy is audited
    # separately, so a perfect positive selector cannot hide behind whole-pack failures.
    return {g: {'label': ('L2' if family == 'PL1' else 'L3') if g == chosen else
                ('insufficient' if family == 'PL1' or base[g]['label'] == 'L3' else base[g]['label']),
                'sign': base[g]['sign']} for g in genes}


def grade(answer, truth):
    if not isinstance(answer, dict) or set(answer) != set(truth):
        return False
    return all(isinstance(answer[g], dict) and answer[g].get('label') in t['labels'] and
               (t['kind'] != 'positive' or (type(answer[g].get('sign')) is int and answer[g]['sign'] == t['sign'])) for g, t in truth.items())
