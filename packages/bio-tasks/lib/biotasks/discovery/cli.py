"""Standard task-directory entry points; host callers choose isolated key and grading roots."""
import argparse
import json
import os
import shutil
from pathlib import Path
from .blinding import canonical
from .families import reference, naive, recall_only, decode
from .staging import verify, check, host_root
from .metadata import copy_analyst


def dispatch(command, host, argv):
    parser = argparse.ArgumentParser()
    if command == 'stage':
        parser.add_argument('--out', type=Path, required=True)
        parser.add_argument('--context-id', required=True)
    elif command == 'check':
        parser.add_argument('--attempt', type=Path, required=True)
        parser.add_argument('--key', type=Path, default=host / 'SEALED-KEY.json.enc')
    else:
        parser.add_argument('--data', type=Path, required=True)
        parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args(argv)
    if command == 'check':
        result = check(args.attempt, args.key, host=host)
        print(json.dumps(result))
        return 0 if result['passed'] else 1
    from .card import load_card
    card = load_card(host, require_key=False)
    if command == 'stage':
        verify(host / 'inputs', card['datasetManifestHash'])
        root = host_root()
        out = args.out.resolve()
        if out.is_relative_to(root) or root.is_relative_to(out) or Path(os.environ['BIO_SEALING_KEY']).resolve().is_relative_to(out):
            raise ValueError('analyst/host roots overlap')
        if out.exists():
            raise ValueError('fresh stage required')
        from .card import CardRegistry
        CardRegistry(root / 'card-registry.sqlite').reserve(args.context_id, card)
        try:
            copy_analyst(host / 'inputs', out)
            verify(out, card['datasetManifestHash'])
        except BaseException:
            shutil.rmtree(out, ignore_errors=True)
            raise
        return 0
    config = json.loads((host / 'generator.json').read_bytes())
    if command == 'recall-only':
        verify(host / 'inputs', json.loads((host / 'card.json').read_bytes())['datasetManifestHash'])
        genes = sorted({r['gene'] for r in decode((host / 'inputs/data/summary.tsv').read_bytes())})
        answer = recall_only(genes, config['family'])
    else:
        payload = (args.data / 'summary.tsv').read_bytes()
        answer = reference(payload, config['family']) if command == 'reference' else naive(payload, config['family'], command, (args.data / 'ld.tsv').read_bytes())
    # Arm D and scripted naive answers are host outputs, never agent-readable key files.
    if not args.out.resolve().is_relative_to(host_root()):
        raise ValueError('reference/naive output requires private host root')
    args.out.mkdir(parents=True, exist_ok=False)
    (args.out / 'results.json').write_bytes(canonical(answer) + b'\n')
    return 0
