"""CLI: python -m biotasks.oneshot <command> ...  (host-side only; never expose to an analyst).

    build-card CASE_DIR OUT_DIR [--variant N] [--offline]
    dry-run    CASE_DIR [--variant N]                       (never downloads, never seals)
    serve      CARD_DIR OUT_DIR --context-id ID
    grade      CARD_DIR REPORT (--context-id ID | --audit)
    verify     CARD_DIR
    scan       CARD_DIR TREE                                (originals/canary in any tree)

Every command prints one JSON object. Exit 0 = success (grade: verdict pass), 1 = refused or
failed, 2 = usage. Refusal messages never carry answer values or protected terms.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def _print(obj) -> None:
    sys.stdout.write(json.dumps(obj, sort_keys=True) + '\n')


def _refusal(e: BaseException) -> dict:
    from .leakage import LeakageError
    if isinstance(e, LeakageError):
        return {'status': 'refused', 'error': 'leakage', 'findings': [{'category': c, 'path': p} for c, p in e.findings]}
    message = str(e) if isinstance(e, ValueError) else type(e).__name__
    return {'status': 'refused', 'error': message[:500]}


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog='biotasks.oneshot', description='KB0 one-shot benchmark cards (host-side).')
    sub = p.add_subparsers(dest='command', required=True)
    b = sub.add_parser('build-card')
    b.add_argument('case_dir', type=Path)
    b.add_argument('out_dir', type=Path)
    b.add_argument('--variant', type=int, default=0)
    b.add_argument('--offline', action='store_true', help='never download; every source must be local')
    d = sub.add_parser('dry-run')
    d.add_argument('case_dir', type=Path)
    d.add_argument('--variant', type=int, default=0)
    s = sub.add_parser('serve')
    s.add_argument('card_dir', type=Path)
    s.add_argument('out_dir', type=Path)
    s.add_argument('--context-id', required=True)
    g = sub.add_parser('grade')
    g.add_argument('card_dir', type=Path)
    g.add_argument('report', type=Path)
    mode = g.add_mutually_exclusive_group(required=True)
    mode.add_argument('--context-id')
    mode.add_argument('--audit', action='store_true', help='host calibration grade, outside the one-shot registry')
    v = sub.add_parser('verify')
    v.add_argument('card_dir', type=Path)
    sc = sub.add_parser('scan')
    sc.add_argument('card_dir', type=Path)
    sc.add_argument('tree', type=Path)
    return p


def main(argv: list[str]) -> int:
    try:
        args = parser().parse_args(argv)
    except SystemExit as e:
        return 2 if e.code else 0
    try:
        from . import card as cards  # after argument parsing: usage errors never load the stack
    except (ImportError, SyntaxError) as e:
        # Wrong interpreter (e.g. a system python without numpy): one JSON object, no traceback.
        if args.command == 'grade':
            _print({'status': 'refused', 'card': None, 'verdict': 'fail', 'reason': 'interpreter', 'criteria': []})
        else:
            _print({'status': 'refused', 'error': f'harness dependencies unavailable under this interpreter ({type(e).__name__}); '
                    'use packages/bio-tasks/oneshot/oneshot.sh (the pixi python)'})
        return 1
    if args.command == 'grade':
        result = cards.grade(args.card_dir, args.report, context_id=args.context_id, audit=args.audit)
        _print(result)
        return 0 if result.get('verdict') == 'pass' else 1
    try:
        if args.command == 'build-card':
            result = cards.build_card(args.case_dir, args.out_dir, variant=args.variant, offline=args.offline)
        elif args.command == 'dry-run':
            result = cards.dry_run(args.case_dir, variant=args.variant)
        elif args.command == 'serve':
            result = cards.serve(args.card_dir, args.out_dir, args.context_id)
        elif args.command == 'verify':
            state = cards.verify_card(args.card_dir, deep=True)
            result = {'status': 'verified', 'card': state['card']['id'], 'files': len(state['files'])}
        else:
            findings = cards.scan(args.card_dir, args.tree, detailed=True)
            result = {'status': 'clean' if not findings else 'findings',
                      'findings': findings}
    except (Exception, SystemExit) as e:
        _print(_refusal(e))
        return 1
    _print(result)
    return 0 if result.get('status') in ('built', 'ok', 'served', 'verified', 'clean') else 1


def card_entry(command: str, card_dir: Path, argv: list[str]) -> int:
    """KA0-style entrypoints written into every card directory: stage.py and check.py."""
    p = argparse.ArgumentParser(prog=f'{command}.py')
    if command == 'stage':
        p.add_argument('--out', type=Path, required=True)
        p.add_argument('--context-id', required=True)
        args = p.parse_args(argv)
        return main(['serve', str(card_dir), str(args.out), '--context-id', args.context_id])
    p.add_argument('--report', type=Path, required=True)
    mode = p.add_mutually_exclusive_group(required=True)
    mode.add_argument('--context-id')
    mode.add_argument('--audit', action='store_true')
    args = p.parse_args(argv)
    extra = ['--context-id', args.context_id] if args.context_id else ['--audit']
    return main(['grade', str(card_dir), str(args.report), *extra])
