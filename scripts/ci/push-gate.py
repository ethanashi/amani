#!/usr/bin/env python3
import json
import os
from pathlib import Path
import subprocess
import sys
from datetime import datetime, timezone
from receipt import validate

here=Path(__file__).resolve().parent
repo=Path(subprocess.check_output(['git','rev-parse','--show-toplevel'],text=True).strip())
remote=sys.argv[1]
updates=[]
for line in sys.stdin:
    local, commit, dest, previous=line.split()
    if set(commit)=={'0'}: continue  # Deletions contain no commit to test.
    commit=subprocess.check_output(['git','rev-parse',commit+'^{commit}'],text=True).strip()
    updates.append((commit,'full' if remote=='origin' and dest=='refs/heads/main' else 'fast',dest))
reason=os.environ.get('AMANI_CI_OVERRIDE_REASON','').strip()
if reason:
    if len(reason)<12: sys.exit('STOP: emergency override requires a meaningful reason (12+ characters)')
    log=Path.home()/'.omerta-bio/ci/overrides.jsonl';log.parent.mkdir(parents=True,exist_ok=True)
    with log.open('a') as f:
        f.write(json.dumps(dict(at=datetime.now(timezone.utc).isoformat(),repository=str(repo),remote=remote,updates=updates,reason=reason))+'\n')
    print(f'EMERGENCY CI OVERRIDE logged: {log}',file=sys.stderr)
    sys.exit(0)
for commit,mode,dest in updates:
    try: validate(repo,commit,mode)
    except RuntimeError:
        if mode=='fast':
            subprocess.run([str(here/'ci.sh'),'fast',commit],check=False)
        try: validate(repo,commit,mode)
        except RuntimeError as e: sys.exit(f'{e}\nPush to {dest} blocked. Run scripts/ci/ci.sh {mode} {commit}.')
print('CI receipts verified for every pushed commit',file=sys.stderr)
