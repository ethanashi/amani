"""Domain-separated, length-delimited HMAC seeds and consistent keyed renaming."""
import hashlib
import hmac
import json
import math


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def keyed(key, domain, *parts):
    if not isinstance(key, bytes) or len(key) < 32:
        raise ValueError('host key missing or too short')
    return hmac.digest(key, canonical(['ka0/v1', domain, *parts]), 'sha256')


def generator_seed(key, task_id, public_seed, replicate=0):
    if not isinstance(task_id, str) or not task_id or any(type(x) is not int or x < 0 for x in (public_seed, replicate)):
        raise ValueError('invalid seed context')
    return int.from_bytes(keyed(key, 'generator', task_id, public_seed, replicate)[:16], 'big')


def permutation(key, context, kind, ids):
    """Map a closed ID universe bijectively; no original ordering survives in new IDs."""
    if kind not in ('gene', 'protein', 'sample', 'snp', 'compound') or not ids or len(set(ids)) != len(ids):
        raise ValueError('invalid ID universe')
    if not all(isinstance(i, str) and i for i in ids):
        raise ValueError('invalid ID')
    ordered = sorted(ids, key=lambda x: keyed(key, 'rename', context, kind, x))
    prefix = {'gene': 'G', 'protein': 'P', 'sample': 'S', 'snp': 'rs', 'compound': 'D'}[kind]
    offset = int.from_bytes(keyed(key, 'id-offset', context, kind)[:4], 'big') % 80000000 + 10000000
    return {old: f'{prefix}{offset + n}' for n, old in enumerate(ordered)}


def coordinates(key, context, positions, *, preserve_order=False):
    """Remap to fresh chromosome/spacing and permute loci. Return order for LD reindexing."""
    if not positions or len(set(positions)) != len(positions) or any(type(p) is not int or p < 0 for p in positions):
        raise ValueError('invalid coordinates')
    order = (sorted(range(len(positions)), key=lambda i: positions[i]) if preserve_order else
             sorted(range(len(positions)), key=lambda i: keyed(key, 'coordinate-order', context, positions[i])))
    chromosome = 1 + int.from_bytes(keyed(key, 'chromosome', context)[:2], 'big') % 22
    pos = 1000000 + int.from_bytes(keyed(key, 'offset', context)[:4], 'big') % 80000000
    mapped = {}
    for i in order:
        pos += 100 + int.from_bytes(keyed(key, 'spacing', context, positions[i])[:2], 'big')
        mapped[positions[i]] = (chromosome, pos)
    return mapped, order


def diverse(replicates):
    """Both payload bytes and numeric summaries must change; IDs alone cannot pass."""
    if len(replicates) < 2:
        raise ValueError('replicate diversity unavailable')
    hashes, summaries = [], []
    for payload, summary in replicates:
        if not isinstance(payload, bytes) or not payload or not summary or not all(math.isfinite(x) for x in summary):
            raise ValueError('invalid replicate')
        hashes.append(hashlib.sha256(payload).hexdigest())
        summaries.append(tuple(summary))
    if len(set(hashes)) != len(hashes) or len(set(summaries)) != len(summaries):
        raise ValueError('identical replicates refused')
