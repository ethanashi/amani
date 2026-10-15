#!/usr/bin/env python3
"""Host-only scan of generated KA1 secrets against working files and this branch's patches.

Only a generic pass/fail is printed. Existing test_leakage.py supplies scanner controls.
"""
import argparse
import os
import subprocess
import sys
from pathlib import Path
sys.dont_write_bytecode=True
PKG=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(PKG/'lib'));sys.path.insert(0,str(PKG/'test'))
from biotasks import sealing
from biotasks.discovery.backtest_cards import host_root
from helpers import REPO
from test_leakage import Scanner, protected_tokens, SKIP_DIRS


def check(root):
    os.environ['BIO_GRADING_ROOT']=str(root/'grading');os.environ['BIO_SEALING_KEY']=str(root/'host.key')
    host_root();tokens=set();plain_hashes=set()
    import hashlib
    for path in (root/'grading').glob('dm-bt*/SEALED-KEY.json.enc'):
        private=sealing.load_json(path)
        # Challenge rows are subsets of public observations: their individual values/IDs are
        # deliberately public, while subset membership and numerical challenge key are private.
        secret = private['answerKey'].get('challenge', private['answerKey'])
        tokens.update(protected_tokens(secret));tokens.add(private['canary'])
        tokens.add(private['dataContract']['sealed_private']['hash'])
        plain_hashes.add(hashlib.sha256(sealing.canonical(private)).hexdigest())
    if not tokens:raise ValueError('no sealed backtest cards')
    scanner=Scanner(tokens,set(),plain_hashes)
    # The builder may write only in its package; its ignored research root is the host
    # mount, not an analyst/release surface. Scan every analyst projection separately.
    for analyst in (root/'analyst').iterdir():
        if scanner.scan_tree(analyst):raise ValueError('protected content in analyst projection')
    prior=set(SKIP_DIRS)
    try:
        SKIP_DIRS.add('.ka1-private')
        if scanner.scan_tree(REPO):raise ValueError('protected content found')
    finally:
        SKIP_DIRS.clear();SKIP_DIRS.update(prior)
    patch=subprocess.run(['git','log','-p','--all','--','packages/bio-tasks/discovery','packages/bio-tasks/lib/biotasks/discovery','packages/bio-tasks/test'],cwd=REPO,capture_output=True,check=True).stdout.decode(errors='replace')
    if scanner.hits(patch):raise ValueError('protected content in history')
    return True


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--run',type=Path,required=True);a=p.parse_args()
    try:
        check(a.run.resolve());print('KA1 generated-key leakage scan passed')
    except (ValueError,OSError):
        print('KA1 generated-key leakage scan failed');raise SystemExit(1)
